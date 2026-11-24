// Mapa de calles sin conexión (datos abiertos de OpenStreetMap).
// Se descarga UNA vez la zona alrededor del usuario; después todo se calcula en el teléfono:
// rutas a pie, direcciones ("calle Mayor 5"), lugares ("farmacia más cercana") y guía giro a giro.

import { haversine, bearing, angleDiff, turnPhrase, distancePhrase, cardinal, toLocal } from './geo.js';
import { normalize, similarity, parseNumber } from './intents.js';

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export function buildQuery(lat, lon, r) {
  const A = `(around:${Math.round(r)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  return `[out:json][timeout:120];
way["highway"]${A}->.r;
.r out body qt;
node(w.r);
out skel qt;
(
  node["addr:housenumber"]${A};
  node["amenity"]${A};
  node["shop"]${A};
  node["highway"~"^(crossing|traffic_signals|bus_stop)$"]${A};
  node["railway"~"^(station|subway_entrance|tram_stop)$"]${A};
);
out body qt;
(
  way["addr:housenumber"]${A};
  way["leisure"="park"]${A};
  way["amenity"~"^(hospital|school|clinic|marketplace|place_of_worship|police|university|pharmacy)$"]${A};
  way["shop"~"^(supermarket|mall)$"]${A};
);
out tags center qt;`;
}

const WALKABLE = new Set([
  'footway', 'pedestrian', 'path', 'steps', 'living_street', 'residential', 'service', 'unclassified',
  'tertiary', 'tertiary_link', 'secondary', 'secondary_link', 'primary', 'primary_link', 'track',
  'cycleway', 'corridor', 'road', 'trunk', 'trunk_link', 'crossing',
]);

const COST = {
  footway: 1, pedestrian: 1, living_street: 1, residential: 1, corridor: 1, crossing: 1,
  path: 1.2, service: 1.15, unclassified: 1.05, tertiary: 1.05, tertiary_link: 1.1,
  secondary: 1.1, secondary_link: 1.15, primary: 1.15, primary_link: 1.2, steps: 1.5,
  track: 1.3, cycleway: 1.4, road: 1.2, trunk: 2.5, trunk_link: 2.5,
};

/** Convierte la respuesta de Overpass en un formato compacto para guardar. */
export function compact(json, center, radius) {
  const coords = new Map();
  const tagsOf = new Map();
  const roads = [];
  const addr = [];
  const pois = [];
  for (const el of json.elements || []) {
    if (el.type === 'node') {
      coords.set(el.id, [el.lat, el.lon]);
      if (el.tags) tagsOf.set(el.id, { ...(tagsOf.get(el.id) || {}), ...el.tags });
    }
  }
  const used = new Set();
  for (const el of json.elements || []) {
    if (el.type !== 'way' || !el.tags) continue;
    const t = el.tags;
    const hw = t.highway;
    if (hw && el.nodes && WALKABLE.has(hw)) {
      const noFoot = t.foot === 'no' || ((t.access === 'private' || t.access === 'no') && t.foot !== 'yes');
      const trunkNoWalk = (hw === 'trunk' || hw === 'trunk_link') && !(t.foot === 'yes' || (t.sidewalk && t.sidewalk !== 'no'));
      if (!noFoot && !trunkNoWalk) {
        const kind = hw === 'footway' && t.footway === 'crossing' ? 'crossing' : hw === 'footway' && t.footway === 'sidewalk' ? 'sidewalk' : hw;
        roads.push([t.name || '', kind, el.nodes]);
        el.nodes.forEach((n) => used.add(n));
      }
    }
    const c = el.center;
    if (c && t['addr:housenumber'] && t['addr:street']) addr.push([t['addr:street'], t['addr:housenumber'], c.lat, c.lon]);
    if (c && !hw) {
      const k = poiKind(t);
      if (k) pois.push([t.name || '', k, c.lat, c.lon]);
    }
  }
  const cross = [];
  for (const [id, t] of tagsOf) {
    const p = coords.get(id);
    if (!p) continue;
    if (t['addr:housenumber'] && t['addr:street']) addr.push([t['addr:street'], t['addr:housenumber'], p[0], p[1]]);
    const k = poiKind(t);
    if (k) pois.push([t.name || '', k, p[0], p[1]]);
    if (used.has(id) && (t.highway === 'crossing' || t.crossing || t.highway === 'traffic_signals')) {
      const signals = t.crossing === 'traffic_signals' || t.highway === 'traffic_signals' || t['crossing:signals'] === 'yes';
      cross.push([id, signals ? 1 : 0]);
    }
  }
  const ids = [...used].filter((id) => coords.has(id));
  return {
    v: 1,
    date: Date.now(),
    center,
    radius,
    ids,
    lat: ids.map((id) => +coords.get(id)[0].toFixed(7)),
    lon: ids.map((id) => +coords.get(id)[1].toFixed(7)),
    roads: roads.map(([n, k, nodes]) => [n, k, nodes.filter((id) => coords.has(id))]).filter((r) => r[2].length > 1),
    addr,
    pois,
    cross,
  };
}

function poiKind(t) {
  if (t.highway === 'bus_stop') return 'highway=bus_stop';
  if (t.railway && /^(station|subway_entrance|tram_stop)$/.test(t.railway)) return 'railway=' + t.railway;
  if (t.amenity) return 'amenity=' + t.amenity;
  if (t.shop) return 'shop=' + t.shop;
  if (t.leisure === 'park') return 'leisure=park';
  return null;
}

// Categorías en español -> tipos de OSM
export const CATEGORIES = [
  [/farmacia/, ['amenity=pharmacy'], 'la farmacia'],
  [/supermercado|super\b|tienda de alimentacion/, ['shop=supermarket', 'shop=convenience'], 'el supermercado'],
  [/panaderia|pan\b/, ['shop=bakery'], 'la panadería'],
  [/cajero/, ['amenity=atm', 'amenity=bank'], 'el cajero'],
  [/banco/, ['amenity=bank'], 'el banco'],
  [/hospital|urgencias/, ['amenity=hospital'], 'el hospital'],
  [/centro de salud|ambulatorio|medico|clinica/, ['amenity=clinic', 'amenity=doctors'], 'el centro de salud'],
  [/parada (?:de|del) (?:autobus|bus|guagua|colectivo)|parada\b/, ['highway=bus_stop'], 'la parada de autobús'],
  [/metro|subte/, ['railway=subway_entrance', 'railway=station'], 'el metro'],
  [/estacion|tren/, ['railway=station'], 'la estación'],
  [/tranvia/, ['railway=tram_stop'], 'la parada de tranvía'],
  [/cafeteria|cafe\b/, ['amenity=cafe'], 'la cafetería'],
  [/\bbar\b/, ['amenity=bar', 'amenity=pub', 'amenity=cafe'], 'el bar'],
  [/restaurante|comer/, ['amenity=restaurant', 'amenity=fast_food'], 'el restaurante'],
  [/parque/, ['leisure=park'], 'el parque'],
  [/policia|comisaria/, ['amenity=police'], 'la policía'],
  [/correos/, ['amenity=post_office'], 'correos'],
  [/gasolinera/, ['amenity=fuel'], 'la gasolinera'],
  [/colegio|escuela/, ['amenity=school'], 'el colegio'],
  [/iglesia|parroquia/, ['amenity=place_of_worship'], 'la iglesia'],
  [/mercado/, ['amenity=marketplace'], 'el mercado'],
  [/estanco/, ['shop=tobacco'], 'el estanco'],
  [/peluqueria/, ['shop=hairdresser'], 'la peluquería'],
  [/fruteria/, ['shop=greengrocer'], 'la frutería'],
  [/carniceria/, ['shop=butcher'], 'la carnicería'],
  [/kiosco|quiosco/, ['shop=kiosk', 'shop=newsagent'], 'el quiosco'],
  [/ferreteria/, ['shop=hardware', 'shop=doityourself'], 'la ferretería'],
  [/papelera|papeleria/, ['shop=stationery'], 'la papelería'],
  [/\bbaño|aseo|servicio publico/, ['amenity=toilets'], 'los aseos'],
];

const STREET_PREFIX = /^(?:calle|c|cl|avenida|avda|av|plaza|pza|pl|paseo|po|camino|cmno|carretera|ctra|ronda|travesia|trv|glorieta|pasaje|callejon|rambla|bulevar|boulevard|via|calzada|jiron|carrera|cra|diagonal|costanilla|cuesta)\s+/;

export function streetKey(name) {
  let s = normalize(name);
  for (let i = 0; i < 2; i++) s = s.replace(STREET_PREFIX, '');
  s = s.replace(/^(?:de|del|la|el|los|las)\s+/, '').replace(/^(?:de|del|la|el|los|las)\s+/, '');
  return s.trim();
}

/** "Calle Mayor" -> "la Calle Mayor"; "Paseo del Prado" -> "el Paseo del Prado". */
export function withArticle(name, like) {
  const n = normalize(name);
  if (like) { const art = normalize(like).match(/^(la|el|los|las) /); if (art) return `${art[1]} ${name}`; }
  if (/^(calle|avenida|plaza|carretera|ronda|travesia|glorieta|rambla|gran via|calzada|carrera|diagonal|costanilla|cuesta|alameda)\b/.test(n)) return 'la ' + name;
  if (/^(paseo|camino|callejon|pasaje|bulevar|boulevard|jiron|parque)\b/.test(n)) return 'el ' + name;
  return name;
}

const KIND_LABEL = {
  footway: 'la acera', sidewalk: 'la acera', pedestrian: 'la zona peatonal', path: 'el camino', steps: 'las escaleras',
  crossing: 'el paso de peatones', service: 'la calle', living_street: 'la calle', cycleway: 'el camino', track: 'el camino',
  corridor: 'el pasillo',
};

/** Separa "calle mayor 5" en { street: 'calle mayor', number: '5' }. */
export function parseAddress(text) {
  const t = normalize(text).replace(/\bnumero\b|\bnum\b|\bn\b/g, ' ').replace(/\s+/g, ' ').trim();
  const m = t.match(/^(.*?)[\s,]+(\d+\s?[a-z]?)$/);
  if (m) return { street: m[1].trim(), number: m[2].replace(/\s/g, '') };
  // número en palabras al final: "calle mayor numero cinco" (solo si se dijo "número")
  if (/\bnumero\b/.test(normalize(text))) {
    const parts = normalize(text).split(/\bnumero\b/);
    const n = parseNumber(parts[1] || '');
    if (n != null) return { street: parts[0].trim(), number: String(n) };
  }
  return { street: t, number: null };
}

// ---------------------------------------------------------------- min-heap

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop() {
    const k = this.k, v = this.v;
    const top = v[0];
    const lk = k.pop(), lv = v.pop();
    if (k.length) {
      k[0] = lk; v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
}

// ---------------------------------------------------------------- MapData

const CELL = 0.002; // ~200 m

export class MapData {
  constructor(data) {
    this.data = data;
    const n = data.ids.length;
    this.lat = Float64Array.from(data.lat);
    this.lon = Float64Array.from(data.lon);
    this.index = new Map(data.ids.map((id, i) => [id, i]));
    this.adj = Array.from({ length: n }, () => []);
    this.roads = data.roads.map(([name, kind]) => ({ name, kind }));
    data.roads.forEach(([, kind, nodes], r) => {
      for (let k = 0; k + 1 < nodes.length; k++) {
        const a = this.index.get(nodes[k]), b = this.index.get(nodes[k + 1]);
        if (a == null || b == null || a === b) continue;
        const d = haversine(this.p(a), this.p(b));
        const w = d * (COST[kind] || 1.2);
        this.adj[a].push([b, w, r, d]);
        this.adj[b].push([a, w, r, d]);
      }
    });
    this.grid = new Map();
    for (let i = 0; i < n; i++) {
      if (!this.adj[i].length) continue;
      const key = this._cell(this.lat[i], this.lon[i]);
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(i);
    }
    this.cross = new Map(data.cross.map(([id, s]) => [this.index.get(id), s]));
    this.streetNames = [...new Set([...this.roads.map((r) => r.name).filter(Boolean), ...data.addr.map((a) => a[0])])];
  }

  p(i) { return { lat: this.lat[i], lon: this.lon[i] }; }
  _cell(lat, lon) { return `${Math.floor(lat / CELL)}:${Math.floor(lon / CELL)}`; }

  get stats() {
    return { streets: this.streetNames.length, addresses: this.data.addr.length, places: this.data.pois.length };
  }

  covers(p) {
    return haversine(p, this.data.center) < this.data.radius * 0.95;
  }

  nearestNode(p, rings = 2) {
    const cy = Math.floor(p.lat / CELL), cx = Math.floor(p.lon / CELL);
    let best = -1, bd = Infinity;
    for (let dy = -rings; dy <= rings; dy++) {
      for (let dx = -rings; dx <= rings; dx++) {
        const list = this.grid.get(`${cy + dy}:${cx + dx}`);
        if (!list) continue;
        for (const i of list) {
          const d = haversine(p, this.p(i));
          if (d < bd) { bd = d; best = i; }
        }
      }
    }
    return best < 0 ? null : { i: best, d: bd };
  }

  /** Calle más cercana a un punto: { name, kind, d } */
  streetAt(p) {
    const near = this.nearestNode(p, 1);
    if (!near) return null;
    let best = null;
    const seen = new Set();
    const cands = [];
    const cy = Math.floor(p.lat / CELL), cx = Math.floor(p.lon / CELL);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cands.push(...(this.grid.get(`${cy + dy}:${cx + dx}`) || []));
    for (const a of cands) {
      for (const [b, , r] of this.adj[a]) {
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const d = pointSegDist(p, this.p(a), this.p(b));
        const named = !!this.roads[r].name;
        // preferimos calles con nombre si están casi igual de cerca (la acera va junto a la calzada)
        const score = d - (named ? 8 : 0);
        if (!best || score < best.score) best = { score, d, name: this.roads[r].name, kind: this.roads[r].kind };
      }
    }
    return best;
  }

  /** Número de portal más cercano en una calle. */
  nearestNumber(p, streetName) {
    const key = streetKey(streetName);
    let best = null, bd = Infinity;
    for (const [st, num, lat, lon] of this.data.addr) {
      if (streetKey(st) !== key) continue;
      const d = haversine(p, { lat, lon });
      if (d < bd) { bd = d; best = num; }
    }
    return bd < 40 ? best : null;
  }

  /** Busca una dirección, una calle, una categoría o un lugar con nombre. */
  find(text, near) {
    const t = normalize(text);
    // 1) categorías: "farmacia", "la parada de autobús más cercana"
    for (const [re0, kinds, label] of CATEGORIES) {
      const re = new RegExp(`\\b(?:${re0.source})\\b`);
      if (!re.test(t)) continue;
      let best = null, bd = Infinity;
      for (const [name, kind, lat, lon] of this.data.pois) {
        if (!kinds.includes(kind)) continue;
        const d = near ? haversine(near, { lat, lon }) : 0;
        if (d < bd) {
          bd = d;
          const base = normalize(label).replace(/^(?:la|el|los) /, '');
          best = { lat, lon, label: !name ? label : normalize(name).includes(base) ? withArticle(name, label) : `${label} ${name}` };
        }
      }
      if (best) return { ...best, type: 'poi' };
      return { notFound: `No encuentro ${label} en el mapa descargado.` };
    }
    // 2) dirección o calle
    const { street, number } = parseAddress(t);
    const key = streetKey(street);
    if (key) {
      let bestName = null, bs = 0;
      for (const n of this.streetNames) {
        const s = similarity(key, streetKey(n));
        if (s > bs) { bs = s; bestName = n; }
      }
      if (bestName && bs >= 0.72) {
        const bk = streetKey(bestName);
        if (number) {
          const all = this.data.addr.filter((a) => streetKey(a[0]) === bk);
          const exact = all.filter((a) => normalize(a[1]).replace(/\s/g, '') === number);
          const pick = (list) => list.reduce((b, a) => (!b || (near && haversine(near, { lat: a[2], lon: a[3] }) < haversine(near, { lat: b[2], lon: b[3] })) ? a : b), null);
          if (exact.length) {
            const a = pick(exact);
            return { lat: a[2], lon: a[3], label: `${withArticle(bestName)}, número ${a[1]}`, type: 'address' };
          }
          if (all.length) {
            const want = parseInt(number, 10);
            const a = all.reduce((b, x) => (!b || Math.abs(parseInt(x[1], 10) - want) < Math.abs(parseInt(b[1], 10) - want) ? x : b), null);
            return { lat: a[2], lon: a[3], label: `${withArticle(bestName)}, número ${a[1]}`, type: 'address', note: `No tengo el número ${number}; te llevo al ${a[1]}, que es el más cercano.` };
          }
        }
        // punto de la calle más cercano a ti
        let bi = -1, bd = Infinity;
        this.data.roads.forEach(([name, , nodes]) => {
          if (!name || streetKey(name) !== bk) return;
          for (const id of nodes) {
            const i = this.index.get(id);
            if (i == null) continue;
            const d = near ? haversine(near, this.p(i)) : 0;
            if (d < bd) { bd = d; bi = i; }
          }
        });
        if (bi >= 0) {
          return { ...this.p(bi), label: withArticle(bestName), type: 'street', note: number ? `No tengo los números de esa calle; te llevo a ella.` : undefined };
        }
      }
    }
    // 3) lugar por su nombre: "Mercadona", "Farmacia Pérez"
    let best = null, bs = 0;
    for (const [name, , lat, lon] of this.data.pois) {
      if (!name) continue;
      const s = similarity(t, name);
      const d = near ? haversine(near, { lat, lon }) : 0;
      const score = s - d / 100000;
      if (s >= 0.75 && score > bs) { bs = score; best = { lat, lon, label: name, type: 'poi' }; }
    }
    return best;
  }

  /** Ruta a pie (A*). Devuelve { pts, roads, total } o null. */
  route(from, to) {
    const s = this.nearestNode(from), t = this.nearestNode(to);
    if (!s || !t) return null;
    const n = this.lat.length;
    const g = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    const prevRoad = new Int32Array(n).fill(-1);
    const target = this.p(t.i);
    const heap = new Heap();
    g[s.i] = 0;
    heap.push(haversine(this.p(s.i), target), s.i);
    const closed = new Uint8Array(n);
    let found = false;
    while (heap.size) {
      const u = heap.pop();
      if (closed[u]) continue;
      closed[u] = 1;
      if (u === t.i) { found = true; break; }
      for (const [v, w, r] of this.adj[u]) {
        const ng = g[u] + w;
        if (ng < g[v]) {
          g[v] = ng; prev[v] = u; prevRoad[v] = r;
          heap.push(ng + haversine(this.p(v), target), v);
        }
      }
    }
    if (!found) return null;
    const nodes = [], roads = [];
    for (let v = t.i; v !== -1; v = prev[v]) { nodes.push(v); if (prev[v] !== -1) roads.push(prevRoad[v]); }
    nodes.reverse(); roads.reverse();
    const pts = nodes.map((i) => this.p(i));
    let total = 0;
    for (let k = 0; k + 1 < pts.length; k++) total += haversine(pts[k], pts[k + 1]);
    return { nodes, pts, roads, total, startGap: s.d, endGap: t.d };
  }

  label(r) {
    const road = this.roads[r];
    return road.name ? withArticle(road.name) : KIND_LABEL[road.kind] || 'la calle';
  }

  /** Lista de maniobras e incidencias (pasos de peatones, escaleras) a lo largo de una ruta. */
  instructions(rt) {
    const { pts, roads, nodes } = rt;
    const cum = [0];
    for (let k = 0; k + 1 < pts.length; k++) cum.push(cum[k] + haversine(pts[k], pts[k + 1]));
    const bear = roads.map((_, k) => bearing(pts[k], pts[k + 1]));
    const key = (r) => (this.roads[r].name ? 'n:' + this.roads[r].name : 'k:' + this.roads[r].kind);
    // tramos (legs): aristas consecutivas por la misma calle
    const legs = [];
    for (let k = 0; k < roads.length; k++) {
      const last = legs[legs.length - 1];
      if (last && key(roads[k]) === key(last.road)) { last.end = k; }
      else legs.push({ road: roads[k], start: k, end: k });
    }
    // fusiona tramos sin nombre muy cortos (<6 m) que no son pasos de peatones
    const steps = [];
    legs.forEach((leg, i) => {
      const len = cum[leg.end + 1] - cum[leg.start];
      const kind = this.roads[leg.road].kind;
      if (i > 0 && len < 6 && kind !== 'crossing' && kind !== 'steps' && !this.roads[leg.road].name) {
        steps[steps.length - 1].end = leg.end;
      } else steps.push({ ...leg });
    });
    const out = [];
    steps.forEach((leg, i) => {
      const kind = this.roads[leg.road].kind;
      const lbl = this.label(leg.road);
      const s = cum[leg.start];
      if (i === 0) {
        out.push({ s, type: 'start', bearing: bear[leg.start], label: lbl, text: `sigue por ${lbl}` });
        return;
      }
      const prevLeg = steps[i - 1];
      const turn = angleDiff(bear[leg.start], bear[prevLeg.end]);
      let text;
      if (kind === 'crossing') text = 'cruza la calle por el paso de peatones';
      else if (kind === 'steps') text = 'hay escaleras; ve con cuidado';
      else if (Math.abs(turn) < 25) text = `sigue recto por ${lbl}`;
      else text = `${turnPhrase(turn)} por ${lbl}`;
      out.push({ s, type: kind === 'crossing' ? 'crossing' : 'turn', turn, label: lbl, text });
    });
    // giros fuertes dentro de una misma calle (esquinas de una acera)
    for (let k = 1; k < roads.length; k++) {
      if (key(roads[k]) !== key(roads[k - 1])) continue;
      const turn = angleDiff(bear[k], bear[k - 1]);
      const segLen = cum[k + 1] - cum[k];
      if (Math.abs(turn) > 60 && segLen > 8) out.push({ s: cum[k], type: 'turn', turn, label: this.label(roads[k]), text: `${turnPhrase(turn)}, siguiendo ${this.label(roads[k])}` });
    }
    // pasos de peatones marcados en el mapa
    const events = [];
    nodes.forEach((i, k) => {
      if (this.cross.has(i) && k > 0) events.push({ s: cum[k], signals: !!this.cross.get(i) });
    });
    out.sort((a, b) => a.s - b.s);
    return { cum, bear, maneuvers: out, events, total: cum[cum.length - 1] };
  }
}

export function pointSegDist(p, a, b) {
  const A = toLocal(p, a), B = toLocal(p, b);
  const dx = B.x - A.x, dy = B.y - A.y;
  const L = dx * dx + dy * dy;
  let t = L ? -(A.x * dx + A.y * dy) / L : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(A.x + t * dx, A.y + t * dy);
}

/** Proyección de un punto sobre la ruta: { s (metros recorridos), d (distancia a la ruta), k (segmento) } */
export function project(p, pts, cum, from = 0, to = pts.length - 1) {
  let best = { s: 0, d: Infinity, k: 0 };
  for (let k = Math.max(0, from); k < Math.min(to, pts.length - 1); k++) {
    const A = toLocal(p, pts[k]), B = toLocal(p, pts[k + 1]);
    const dx = B.x - A.x, dy = B.y - A.y;
    const L = dx * dx + dy * dy;
    let t = L ? -(A.x * dx + A.y * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(A.x + t * dx, A.y + t * dy);
    if (d < best.d) best = { s: cum[k] + t * (cum[k + 1] - cum[k]), d, k };
  }
  return best;
}

// ---------------------------------------------------------------- descarga y almacenamiento

export async function download(center, radius, fetchFn = fetch) {
  const body = 'data=' + encodeURIComponent(buildQuery(center.lat, center.lon, radius));
  let lastErr;
  for (const url of OVERPASS) {
    try {
      const res = await fetchFn(url, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return compact(await res.json(), { lat: center.lat, lon: center.lon }, radius);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('faro', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function saveMap(data) {
  const db = await idb();
  await new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(data, 'map');
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}

export async function loadMap() {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const r = db.transaction('kv').objectStore('kv').get('map');
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => res(null);
    });
  } catch { return null; }
}

// ---------------------------------------------------------------- guía giro a giro

export class MapGuide {
  /** ctx: { say, cue, heading(), stepLength(), position(), onArrive(name), reroute(guide), walking() } */
  constructor(map, dest, rt, ctx) {
    this.map = map;
    this.dest = dest;
    this.name = dest.label;
    this.ctx = ctx;
    this.kind = 'gps';
    this._load(rt);
  }

  _load(rt) {
    this.rt = rt;
    const ins = this.map.instructions(rt);
    this.cum = ins.cum;
    this.bear = ins.bear;
    this.man = ins.maneuvers;
    this.events = ins.events;
    this.total = ins.total + (rt.endGap || 0);
    this.k = 0;
    this.s = 0;
    this.mi = 1; // la 0 es la de salida
    this.said = new Set();
    this.off = 0;
    this.lastSay = Date.now();
    this.lastReroute = this.lastReroute || 0;
    this.lastDir = 0;
    this.dirBad = 0;
    this.pos = null;
  }

  start(intro = true) {
    const sl = this.ctx.stepLength();
    const mins = Math.max(1, Math.round(this.total / 70));
    const first = this.man[0];
    let msg = intro ? `Ruta a ${this.name}: ${distancePhrase(this.total, sl)}, unos ${mins} ${mins === 1 ? 'minuto' : 'minutos'}. ` : '';
    if (this.rt.startGap > 25) msg += `Primero acércate a ${first.label}, a unos ${Math.round(this.rt.startGap)} metros. `;
    const h = this.ctx.heading();
    if (first && h != null) {
      const rel = angleDiff(first.bearing, h);
      msg += Math.abs(rel) < 20 ? `Sigue recto por ${first.label}.` : `${cap(turnPhrase(rel))} para ir por ${first.label}, hacia el ${cardinal(first.bearing)}.`;
    } else if (first) msg += `Empieza por ${first.label}, hacia el ${cardinal(first.bearing)}.`;
    if (this.dest.note) msg += ' ' + this.dest.note;
    this.ctx.say(msg);
    this.lastSay = Date.now();
  }

  onPosition(p) {
    this.pos = p;
    const now = Date.now();
    let pr = project(p, this.rt.pts, this.cum, this.k - 3, this.k + 25);
    if (pr.d > 40) pr = project(p, this.rt.pts, this.cum);
    // no retrocedemos por el ruido del GPS
    if (pr.s >= this.s - 15) { this.s = Math.max(this.s, pr.s); this.k = pr.k; }

    // ¿fuera de la ruta?
    if (pr.d > Math.max(25, p.acc * 1.3)) this.off++;
    else this.off = 0;
    if (this.off >= 2 && now - this.lastReroute > 20000) {
      this.lastReroute = now;
      this.off = 0;
      this.ctx.say('Te has salido de la ruta. Recalculo.', { priority: 'urgent' });
      this.ctx.reroute(this);
      return;
    }

    const left = this.total - this.s;
    if (left < Math.max(8, Math.min(p.acc, 15)) || haversine(p, this.dest) < Math.max(8, Math.min(p.acc, 15))) {
      this.ctx.cue.arrive();
      this.ctx.say(`Has llegado a ${this.name}.`, { priority: 'urgent' });
      this.ctx.onArrive?.(this.name);
      return;
    }

    // siguiente maniobra
    while (this.mi < this.man.length && this.man[this.mi].s < this.s - 6) this.mi++;
    const m = this.man[this.mi];
    if (m) {
      const d = m.s - this.s;
      const id = this.mi;
      if (d <= 12 && !this.said.has('n' + id)) {
        this.said.add('n' + id).add('f' + id);
        this.ctx.cue.turn(m.turn > 0 ? 0.8 : m.turn < 0 ? -0.8 : 0);
        this._say(`Ahora, ${m.text}.`, 'urgent');
        return;
      }
      if (d <= 45 && d > 15 && !this.said.has('f' + id)) {
        this.said.add('f' + id);
        this._say(`En ${Math.round(d / 5) * 5} metros, ${m.text}.`);
        return;
      }
    }
    // pasos de peatones
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      const d = e.s - this.s;
      if (d > 0 && d <= 20 && !this.said.has('c' + i)) {
        this.said.add('c' + i);
        this._say(e.signals
          ? `Paso de peatones con semáforo en ${Math.round(d)} metros. Espera a que se pare el tráfico.`
          : `Paso de peatones en ${Math.round(d)} metros. Escucha bien antes de cruzar.`);
        return;
      }
    }
    // tranquilidad: cada minuto, si nada más que decir
    if (now - this.lastSay > 60000) {
      const cur = this.man.filter((x) => x.s <= this.s).pop() || this.man[0];
      this._say(`Vas bien, por ${cur.label}. Quedan ${distancePhrase(left, this.ctx.stepLength())}.`, 'low');
    }
  }

  _say(text, priority = 'normal') {
    this.lastSay = Date.now();
    this.ctx.say(text, { priority });
  }

  /** Avisa si caminas en sentido contrario a la ruta. */
  onHeading(h) {
    if (h == null || !this.pos || !this.ctx.walking()) { this.dirBad = 0; return; }
    const b = this.bear[Math.min(this.k, this.bear.length - 1)];
    if (b == null) return;
    const rel = angleDiff(b, h);
    this.dirBad = Math.abs(rel) > 75 ? this.dirBad + 1 : 0;
    if (this.dirBad > 20 && Date.now() - this.lastDir > 20000) {
      this.lastDir = Date.now();
      this.dirBad = 0;
      this._say(`Creo que vas en otra dirección. ${cap(turnPhrase(rel))}.`);
    }
  }

  onStep() {}

  progress() {
    const left = this.total - this.s;
    const m = this.man[this.mi];
    let msg = `Quedan ${distancePhrase(left, this.ctx.stepLength())} hasta ${this.name}.`;
    if (m) msg += ` Lo siguiente: ${m.text}, en ${Math.max(0, Math.round(m.s - this.s))} metros.`;
    return msg;
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
