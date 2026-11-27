// Comprensión de órdenes en español, 100 % local (sin APIs).
// Convierte frases naturales en { intent, name?, number? }.

export function normalize(s) {
  return pretty(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Igual que normalize pero conservando tildes y eñes (para decir los nombres bien). */
export function pretty(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFC')
    .replace(/[¿?¡!.;:"'()«»]/g, ' ')
    .replace(/,(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNITS = {
  cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21,
  veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25,
  veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const HUNDREDS = {
  cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500,
  seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
};

/** Lee el primer número de un texto (cifras o palabras). */
export function parseNumber(text) {
  const t = normalize(text);
  const dig = t.match(/(\d+(?:[.,]\d+)?)/);
  if (dig) return parseFloat(dig[1].replace(',', '.'));
  const words = t.split(' ');
  let total = null, i = 0;
  for (; i < words.length; i++) {
    const w = words[i];
    if (w in HUNDREDS) { total = (total || 0) + HUNDREDS[w]; continue; }
    if (w in TENS) { total = (total || 0) + TENS[w]; continue; }
    if (w in UNITS) { total = (total || 0) + UNITS[w]; continue; }
    if (w === 'y' && total != null) continue;
    if (w === 'mil' && total != null) { total *= 1000; continue; }
    if (total != null) break;
  }
  return total;
}

/** Altura en centímetros: "mido 1,70", "mido uno setenta", "un metro setenta", "170". */
export function parseHeight(text) {
  const t = normalize(text);
  const dig = t.match(/(\d+(?:[.,]\d+)?)(?:\s*(?:y|con)?\s*(\d{1,2}))?/);
  if (dig) {
    let v = parseFloat(dig[1].replace(',', '.'));
    if (v < 3) {
      if (dig[2] && Number.isInteger(v)) v = v * 100 + parseInt(dig[2], 10);
      else v *= 100;
    }
    return v >= 80 && v <= 230 ? Math.round(v) : null;
  }
  const m = t.match(/\b(?:un|uno)\s+(?:metro\s+)?(?:con\s+)?(.+)$/);
  if (m) {
    const rest = parseNumber(m[1]);
    if (rest != null && rest < 100) return 100 + rest;
  }
  const n = parseNumber(t);
  return n != null && n >= 80 && n <= 230 ? n : null;
}

const ARTICLES = /^(?:(?:a|al|hasta|hacia|para|de|del|la|el|los|las|mi|mis|lo|un|una|este|esta|sitio|lugar)\s+)+/;

export function cleanName(n) {
  let s = normalize(n)
    .replace(/\b(por favor|porfa|porfavor|gracias|ahora|ya)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(ARTICLES, '').trim();
  return s;
}

/** Recupera la grafía original (con tildes) de un nombre extraído del texto normalizado. */
export function withAccents(name, raw) {
  const nt = normalize(raw).split(' ');
  const pt = pretty(raw).split(' ');
  const want = name.split(' ');
  if (nt.length !== pt.length) return name;
  for (let i = nt.length - want.length; i >= 0; i--) {
    if (want.every((w, j) => nt[i + j] === w)) return pt.slice(i, i + want.length).join(' ');
  }
  return name;
}

const WAKE = /^(?:oye\s+|hola\s+)?(?:faro|faros|pharo|el faro)\b[\s,]*/;

export function stripWake(t) {
  return t.replace(WAKE, '').trim();
}

export function hasWake(text) {
  return WAKE.test(normalize(text)) || /\b(faro|faros|pharo)\b/.test(normalize(text));
}

const ON = '(?:activa|activar|enciende|encender|prende|pon|empieza|inicia|arranca|abre)';
const OFF = '(?:apaga|apagar|desactiva|desactivar|quita|pausa|deten|cierra)';

// Orden importante: las reglas más específicas primero.
const RULES = [
  ['download_map', /\b(?:descarga|descargar|bajate|baja|actualiza|actualizar|consigue)\b.*\bmapas?\b/],
  ['stop', /^(?:para|parar|detente|deten|alto|basta|stop|silencio|calla|callate|cancela|cancelar|cancelalo|frena)(?: (?:todo|ya|de hablar|la guia|la navegacion))?$/],
  ['stop', /\b(?:cancela|deten|para|termina)(?: la)? (?:navegacion|guia|busqueda|calibracion)\b/],
  ['cancel_record', /\b(?:cancela|descarta|borra|anula)(?: la)? grabacion\b/],
  ['yes', /^(?:si|vale|de acuerdo|ok|okay|claro|correcto|afirmativo|hazlo|adelante|venga)(?: .*)?$/],
  ['no', /^(?:no|negativo|mejor no|no gracias)$/],
  ['repeat', /\b(?:repite|repitelo|repetir|otra vez|que (?:has dicho|dijiste|decias)|no te (?:he )?entendi(?:do)?)\b/],
  ['help', /\b(?:ayuda|ayudame|que (?:puedes|sabes) hacer|comandos|instrucciones|como funciona)\b/],
  ['finish', /\b(?:he llegado|ya llegue|llegue|ya estoy|estoy aqui|fin de (?:la )?ruta|termina(?:r)? (?:de grabar|la grabacion|la ruta)|para de grabar|guarda(?:r)? (?:la )?ruta|guardala|ya esta|listo)\b/],
  ['record_route', /\b(?:graba|grabar|grabame|aprende|aprender|memoriza|memorizar|recuerda|recordar|ensename)\b.*?\b(?:ruta|camino|recorrido|trayecto)\b(?<name>.*)$/],
  ['calibrate_height', /\b(?:mido|mi altura es|mi estatura es|tengo una altura de|mi altura|estatura)\b/],
  ['calibrate', /\b(?:calibra|calibrar|calibracion|mide (?:mis|los) pasos|medir (?:mis|los) pasos|ajusta (?:mis|los) pasos)\b/],
  ['set_origin', /\b(?:estoy en|me encuentro en|empiezo en|salgo de|estoy junto a)\s+(?<name>.+)$/],
  ['navigate', /\b(?:volver|vuelve|regresa|regresar|vuelveme|regresame)\s+(?:a|al|hasta|hacia)\s+(?<name>.+)$/],
  ['go_back', /\b(?:volver|vuelve|regresa|regresar|de vuelta|deshaz el camino|deshacer el camino|vuelta atras|camino de vuelta)\b/],
  ['navigate', /\b(?:llevame|guiame|dirigeme|acompaname|llevarme|guiarme|quiero ir|quisiera ir|necesito ir|vamos|vamonos|ir|ve|como (?:voy|llego|se va)|navega)\b\s+(?<name>.+)$/],
  ['where_is', /^(?:donde (?:esta|queda|tengo)|a que distancia (?:esta|queda)|cuanto (?:falta|queda) (?:para|hasta)(?: llegar a)?|que tan lejos (?:esta|queda))\s+(?<name>.+)$/],
  ['progress', /\b(?:cuanto (?:falta|queda)|ya (?:casi )?llegamos|falta mucho)\b/],
  ['save_place', /\b(?:guarda|guardar|guardame|memoriza|apunta|marca|recuerda|anota|registra)\b(?:\s+(?:este|esta|el|la|mi|aqui|esto))*(?:\s+(?:lugar|sitio|punto|posicion|ubicacion|sitio))?(?:\s+(?:como|con el nombre de|con el nombre|llamado|que se llama))?\s+(?<name>.+)$/],
  ['save_place', /^(?:esto es|aqui (?:esta|es)|estamos en|este es|esta es)\s+(?<name>.+)$/],
  ['delete', /\b(?:borra|borrar|elimina|eliminar|olvida|olvidar|quita)\b(?:\s+(?:el|la|lugar|sitio|ruta|camino))*\s+(?<name>.+)$/],
  ['find', /\b(?:busca|buscar|buscame|encuentra|encontrar|encuentrame|localiza|donde hay)\s+(?<name>.+)$/],
  ['look', /\b(?:mira bien|mira con detalle|(?:describe|describeme|cuentame)(?: lo que (?:hay|ves))?(?: (?:con|en|al)) detalle|con (?:mas )?detalle|que pone|que dice (?:el|la|ese|esa|este|esta)|leeme|lee (?:el|la|lo|esto|eso|ese|esa)|de que color|que color)\b/],
  ['describe', /\b(?:que (?:hay|ves|tengo|veo)|describe|describeme|describir|mira|que es esto|que me rodea|alrededor|lo que hay)\b/],
  ['where', /\b(?:donde estoy|mi (?:ubicacion|posicion)|en que (?:sitio|lugar|calle|parte) estoy|localizame|ubicame|donde me encuentro)\b/],
  ['heading', /\b(?:hacia donde (?:miro|voy|estoy mirando|apunto)|brujula|orientacion|que direccion|donde esta el norte|hacia que lado)\b/],
  ['list', /\b(?:(?:que|cuales) (?:lugares|sitios|rutas|caminos)|lista(?: de)? (?:lugares|sitios|rutas)|mis (?:lugares|sitios|rutas)|que conoces|que sabes)\b/],
  ['steps', /\b(?:cuantos pasos|pasos (?:llevo|he dado)|distancia (?:recorrida|llevo)|cuanto (?:he )?(?:caminado|andado)|longitud de (?:mi|mis) pasos?)\b/],
  ['reset_steps', /\b(?:reinicia|pon a cero|resetea|borra) (?:el contador de |los )?pasos\b/],
  ['time', /\bque hora\b/],
  ['date', /\b(?:que dia|que fecha|fecha de hoy)\b/],
  ['battery', /\bbateria\b/],
  ['torch_on', new RegExp(`\\b${ON} (?:la )?(?:linterna|luz|flash)\\b`)],
  ['torch_off', new RegExp(`\\b${OFF} (?:la )?(?:linterna|luz|flash)\\b`)],
  ['sonar_on', new RegExp(`\\b${ON}(?: el)? (?:sonar|pitido|pitidos|radar)\\b`)],
  ['sonar_off', new RegExp(`\\b${OFF}(?: el)? (?:sonar|pitido|pitidos|radar)\\b`)],
  ['server_on', new RegExp(`\\b${ON}\\b.*\\bservidor\\b`)],
  ['server_off', new RegExp(`\\b${OFF}\\b.*\\bservidor\\b`)],
  ['brain_on', new RegExp(`\\b${ON}\\b.*\\b(?:modo inteligente|inteligencia|cerebro|ia)\\b`)],
  ['brain_off', new RegExp(`\\b${OFF}\\b.*\\b(?:modo inteligente|inteligencia|cerebro|ia)\\b`)],
  ['handsfree_on', new RegExp(`\\b(?:${ON}(?: el)? (?:modo )?manos libres|escucha(?:me)? (?:siempre|todo el rato|continuamente))\\b`)],
  ['handsfree_off', new RegExp(`\\b${OFF}(?: el)? (?:modo )?manos libres\\b`)],
  ['camera_off', new RegExp(`\\b${OFF}\\b.*\\b(?:camara|vigilancia|obstaculos|deteccion)\\b`)],
  ['camera_on', new RegExp(`\\b${ON}\\b.*\\b(?:camara|vigilancia|obstaculos|deteccion)\\b`)],
  ['aim', /\b(?:como (?:esta|tengo|sostengo) (?:la camara|el telefono|el movil)|enfoque|enfoca|apunto bien|estoy apuntando bien|bien colocado)\b/],
  ['faster', /\b(?:mas rapido|mas deprisa|habla rapido|acelera)\b/],
  ['slower', /\b(?:mas (?:despacio|lento|lentamente)|habla despacio|ve despacio)\b/],
  ['next_voice', /\b(?:cambia(?:r)? (?:de |la )?voz|otra voz|siguiente voz)\b/],
  ['greet', /^(?:hola|buenos dias|buenas tardes|buenas noches|buenas|hey|oye)$/],
  ['thanks', /\b(?:gracias|muchas gracias|genial|perfecto)\b/],
];

// ---------- Orden más parecida (cuando el reconocimiento de voz escribe mal las palabras)

const EXAMPLES = {
  describe: ['que hay delante', 'que ves', 'que tengo enfrente', 'describe lo que hay', 'que hay alrededor', 'mira delante'],
  where: ['donde estoy', 'en que calle estoy', 'cual es mi ubicacion', 'donde me encuentro'],
  heading: ['hacia donde miro', 'donde esta el norte', 'en que direccion voy'],
  help: ['ayuda', 'que puedes hacer', 'como funciona'],
  stop: ['para', 'detente', 'silencio', 'callate'],
  steps: ['cuantos pasos llevo', 'cuanto he caminado'],
  time: ['que hora es', 'dime la hora'],
  list: ['que lugares conoces', 'lista de lugares', 'cuales son mis rutas'],
  repeat: ['repite', 'repitelo', 'que has dicho'],
  go_back: ['vuelve', 'volver atras', 'llevame de vuelta', 'deshaz el camino'],
  finish: ['he llegado', 'ya estoy aqui', 'fin de la ruta'],
  calibrate: ['calibra mis pasos', 'mide mis pasos'],
  progress: ['cuanto falta', 'cuanto queda', 'falta mucho'],
  download_map: ['descarga el mapa', 'baja el mapa', 'actualiza el mapa'],
  torch_on: ['enciende la linterna', 'pon la luz'],
  aim: ['como tengo la camara', 'apunto bien'],
};

export const INTENT_DESC = {
  describe: 'que te diga qué hay delante', look: 'que mire con detalle', where: 'saber dónde estás', heading: 'saber hacia dónde miras',
  help: 'la ayuda', stop: 'que pare', steps: 'saber cuántos pasos llevas', time: 'saber la hora',
  list: 'la lista de lugares', repeat: 'que repita', go_back: 'volver por donde has venido', finish: 'decir que has llegado',
  calibrate: 'calibrar tus pasos', progress: 'saber cuánto falta', download_map: 'descargar el mapa',
  torch_on: 'encender la linterna', aim: 'comprobar la cámara',
};

function fuzzyEq(a, b) {
  if (a === b) return true;
  const n = Math.min(a.length, b.length);
  if (n >= 4 && levenshtein(a, b) <= 1) return true;
  if (n >= 7 && levenshtein(a, b) <= 2) return true;
  return false;
}

function dice(a, b) {
  const used = new Set();
  let m = 0;
  for (const x of a) {
    const j = b.findIndex((y, k) => !used.has(k) && fuzzyEq(x, y));
    if (j >= 0) { used.add(j); m++; }
  }
  return (2 * m) / (a.length + b.length);
}

/** La orden de ejemplo más parecida: { intent, score } (score 0..1). */
export function guess(text) {
  const t = normalize(text).replace(/\s+/g, ' ').split(' ').filter(Boolean);
  // une palabras partidas: "de lante" -> "delante", "don de" -> "donde"
  const joined = [];
  for (let i = 0; i < t.length; i++) {
    if (i + 1 < t.length && ['delante', 'donde', 'enfrente', 'alrededor'].includes(t[i] + t[i + 1])) { joined.push(t[i] + t[i + 1]); i++; }
    else joined.push(t[i].replace(/^k$/, 'que').replace(/^ay$/, 'hay'));
  }
  let best = { intent: null, score: 0 };
  for (const [intent, list] of Object.entries(EXAMPLES)) {
    for (const ex of list) {
      const sc = dice(joined, ex.split(' '));
      if (sc > best.score) best = { intent, score: sc };
    }
  }
  return best;
}

export function parse(raw) {
  const r = parseRules(raw);
  if (r.intent !== 'unknown') return r;
  const g = guess(r.text);
  if (g.score >= 0.72) return { intent: g.intent, text: r.text, fuzzy: true };
  if (g.score >= 0.5) return { ...r, suggestion: g.intent };
  return r;
}

/** De varias transcripciones posibles, la primera que se entiende (prefiere las exactas). */
export function parseBest(alternatives) {
  const list = alternatives.filter(Boolean);
  const parsed = list.map((a) => parse(a));
  return parsed.find((p) => p.intent !== 'unknown' && !p.fuzzy)
    || parsed.find((p) => p.intent !== 'unknown')
    || parsed[0] || { intent: 'empty', text: '' };
}

function parseRules(raw) {
  const text = stripWake(normalize(raw));
  if (!text) return { intent: 'empty', text };
  for (const [intent, re] of RULES) {
    const m = text.match(re);
    if (!m) continue;
    const out = { intent, text };
    if (m.groups && m.groups.name != null) {
      const name = cleanName(m.groups.name);
      if (name) out.name = withAccents(name, raw);
    }
    if (intent === 'calibrate') {
      const n = parseNumber(text);
      if (n != null && /\bmetros?\b/.test(text)) out.meters = n;
    }
    if (intent === 'calibrate_height') {
      out.cm = parseHeight(text);
      if (out.cm == null) continue;
    }
    if (intent === 'record_route' && out.name && /^(?:nuevo|nueva)$/.test(out.name)) delete out.name;
    if (['navigate', 'save_place', 'delete', 'find', 'where_is', 'set_origin'].includes(intent) && !out.name) continue;
    return out;
  }
  return { intent: 'unknown', text };
}

// ---------- Búsqueda difusa de nombres ----------

export function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

export function similarity(a, b) {
  a = cleanName(a);
  b = cleanName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const ta = new Set(a.split(' ')), tb = new Set(b.split(' '));
  const common = [...ta].filter((t) => tb.has(t)).length;
  const tokenScore = common / Math.max(ta.size, tb.size);
  const lev = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  return Math.max(tokenScore * 0.95, lev);
}

/** Devuelve el mejor candidato (string) o null. */
export function findBest(name, candidates, threshold = 0.6) {
  let best = null, score = 0;
  for (const c of candidates) {
    const s = similarity(name, c);
    if (s > score) { score = s; best = c; }
  }
  return score >= threshold ? best : null;
}
