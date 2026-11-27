import { VOCAB } from './vocab.js';
// Nombres en español de las 80 clases COCO, con género, tamaño real aproximado
// (alto/ancho en metros, para estimar distancias) y si cuentan como obstáculo.

// [nombre, género, altoReal, anchoReal, obstáculo]
const L = {
  person: ['persona', 'f', 1.7, 0.5, true],
  bicycle: ['bicicleta', 'f', 1.0, 1.7, true],
  car: ['coche', 'm', 1.5, 1.8, true],
  motorcycle: ['moto', 'f', 1.1, 2.0, true],
  airplane: ['avión', 'm', 0, 0, false],
  bus: ['autobús', 'm', 3.0, 2.5, true],
  train: ['tren', 'm', 3.5, 3.0, true],
  truck: ['camión', 'm', 3.0, 2.5, true],
  boat: ['barco', 'm', 0, 0, false],
  'traffic light': ['semáforo', 'm', 0.9, 0.35, false],
  'fire hydrant': ['boca de incendios', 'f', 0.7, 0.35, true],
  'stop sign': ['señal de stop', 'f', 0.75, 0.75, false],
  'parking meter': ['parquímetro', 'm', 1.4, 0.35, true],
  bench: ['banco', 'm', 0.85, 1.6, true],
  bird: ['pájaro', 'm', 0, 0, false],
  cat: ['gato', 'm', 0.3, 0.45, true],
  dog: ['perro', 'm', 0.55, 0.7, true],
  horse: ['caballo', 'm', 1.6, 2.2, true],
  sheep: ['oveja', 'f', 0.9, 1.1, true],
  cow: ['vaca', 'f', 1.4, 2.0, true],
  elephant: ['elefante', 'm', 3.0, 4.0, true],
  bear: ['oso', 'm', 1.2, 1.8, true],
  zebra: ['cebra', 'f', 1.4, 2.2, true],
  giraffe: ['jirafa', 'f', 5.0, 2.0, true],
  backpack: ['mochila', 'f', 0.5, 0.35, false],
  umbrella: ['paraguas', 'm', 0, 1.0, false],
  handbag: ['bolso', 'm', 0, 0, false],
  tie: ['corbata', 'f', 0, 0, false],
  suitcase: ['maleta', 'f', 0.65, 0.45, true],
  frisbee: ['disco volador', 'm', 0, 0, false],
  skis: ['esquís', 'm', 0, 0, false],
  snowboard: ['tabla de snowboard', 'f', 0, 0, false],
  'sports ball': ['pelota', 'f', 0, 0, false],
  kite: ['cometa', 'f', 0, 0, false],
  'baseball bat': ['bate', 'm', 0, 0, false],
  'baseball glove': ['guante', 'm', 0, 0, false],
  skateboard: ['monopatín', 'm', 0.12, 0.8, true],
  surfboard: ['tabla de surf', 'f', 0, 0, false],
  'tennis racket': ['raqueta', 'f', 0, 0, false],
  bottle: ['botella', 'f', 0.27, 0, false],
  'wine glass': ['copa', 'f', 0.2, 0, false],
  cup: ['taza', 'f', 0.1, 0, false],
  fork: ['tenedor', 'm', 0, 0, false],
  knife: ['cuchillo', 'm', 0, 0, false],
  spoon: ['cuchara', 'f', 0, 0, false],
  bowl: ['cuenco', 'm', 0, 0, false],
  banana: ['plátano', 'm', 0, 0, false],
  apple: ['manzana', 'f', 0, 0, false],
  sandwich: ['bocadillo', 'm', 0, 0, false],
  orange: ['naranja', 'f', 0, 0, false],
  broccoli: ['brócoli', 'm', 0, 0, false],
  carrot: ['zanahoria', 'f', 0, 0, false],
  'hot dog': ['perrito caliente', 'm', 0, 0, false],
  pizza: ['pizza', 'f', 0, 0, false],
  donut: ['donut', 'm', 0, 0, false],
  cake: ['pastel', 'm', 0, 0, false],
  chair: ['silla', 'f', 0.9, 0.5, true],
  couch: ['sofá', 'm', 0.85, 2.0, true],
  'potted plant': ['planta', 'f', 0.6, 0.45, true],
  bed: ['cama', 'f', 0.6, 1.5, true],
  'dining table': ['mesa', 'f', 0.75, 1.2, true],
  toilet: ['inodoro', 'm', 0.75, 0.4, true],
  tv: ['televisor', 'm', 0.6, 1.0, false],
  laptop: ['portátil', 'm', 0.22, 0.33, false],
  mouse: ['ratón', 'm', 0, 0, false],
  remote: ['mando a distancia', 'm', 0, 0, false],
  keyboard: ['teclado', 'm', 0, 0, false],
  'cell phone': ['móvil', 'm', 0, 0, false],
  microwave: ['microondas', 'm', 0.3, 0.5, false],
  oven: ['horno', 'm', 0.85, 0.6, true],
  toaster: ['tostadora', 'f', 0, 0, false],
  sink: ['fregadero', 'm', 0, 0.6, false],
  refrigerator: ['nevera', 'f', 1.75, 0.65, true],
  book: ['libro', 'm', 0, 0, false],
  clock: ['reloj', 'm', 0, 0, false],
  vase: ['jarrón', 'm', 0.3, 0, false],
  scissors: ['tijeras', 'f', 0, 0, false],
  'teddy bear': ['peluche', 'm', 0, 0, false],
  'hair drier': ['secador', 'm', 0, 0, false],
  toothbrush: ['cepillo de dientes', 'm', 0, 0, false],
};


// ---- Vocabulario completo de Faro (js/vocab.js): cada forma de pedirlo ("door", "wooden door"…)
// apunta al mismo concepto en español. Sustituye a las entradas COCO cuando coinciden.
const FLAGS = {};
const FIRST_PROMPT = {}; // nombre en español -> primer prompt
for (const [es, g, ps, h, w, f] of VOCAB) {
  for (const p of ps.split('|')) { L[p] = [es, g, h, w, f.includes('o')]; FLAGS[p] = f; }
  FIRST_PROMPT[es] = ps.split('|')[0];
}

// Sinónimos en español (sin tildes) -> nombre del concepto
const SYNONYMS = {
  persona: ['gente', 'alguien', 'hombre', 'mujer', 'nino', 'nina', 'personas', 'senor', 'senora', 'chico', 'chica'],
  'váter': ['inodoro', 'retrete', 'wc', 'water', 'vater', 'taza del vater'],
  nevera: ['frigorifico', 'refrigerador', 'heladera', 'frigo'],
  televisor: ['tele', 'television', 'tv'],
  'puerta corredera': ['puerta corrediza', 'corredera', 'corrediza'],
  puerta: ['entrada', 'salida', 'puertas'],
  escaleras: ['escalera', 'escalones', 'peldanos', 'escalon'],
  'pomo de la puerta': ['pomo', 'manilla', 'picaporte', 'tirador'],
  'interruptor de la luz': ['interruptor', 'llave de la luz'],
  'cubo de basura': ['basura', 'cubo'],
  'mando a distancia': ['mando'],
  'móvil': ['celular', 'telefono'],
  bicicleta: ['bici'],
  coche: ['auto', 'carro', 'automovil', 'vehiculo'],
  'autobús': ['guagua', 'colectivo', 'bus', 'micro'],
  perro: ['perrito', 'perros'],
  gato: ['gatito', 'gatos'],
  planta: ['maceta', 'plantas', 'tiesto'],
  farola: ['farol', 'farolas'],
  bolardo: ['pivote', 'pivotes', 'bolardos'],
  'paso de peatones': ['paso de cebra', 'cruce', 'paso peatonal'],
  'semáforo de peatones': ['semaforo peatonal', 'semaforo de peatones'],
  ordenador: ['computadora', 'pc'],
  lavavajillas: ['lavaplatos'],
  'sofá': ['sofa', 'sillon grande'],
  armario: ['ropero', 'placard'],
  'estantería': ['estante', 'balda', 'librería', 'libreria'],
  contenedor: ['contenedor de basura', 'contenedores'],
  lavabo: ['lavamanos'],
  fregadero: ['pila', 'tarja'],
  'pájaro': ['pajaro', 'ave', 'pajarito'],
};

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function info(cls) {
  const l = L[cls];
  if (!l) return { name: cls, g: 'm', h: 0, w: 0, obstacle: false };
  return { name: l[0], g: l[1], h: l[2], w: l[3], obstacle: l[4] };
}

export const name = (cls) => info(cls).name;
const ART = { m: ['un', 'el'], f: ['una', 'la'], mp: ['unos', 'los'], fp: ['unas', 'las'] };
export const indef = (cls) => `${ART[info(cls).g][0]} ${name(cls)}`;
export const def = (cls) => `${ART[info(cls).g][1]} ${name(cls)}`;
export function pluralName(cls) {
  const n = name(cls);
  if (plural(cls)) return n;
  const [first, ...rest] = n.split(' ');
  if (/s$/.test(first) && !/[áéíóú]s$/.test(first)) return n;
  const un = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u' };
  let p;
  if (/[aeiouáéó]$/.test(first)) p = first + 's';
  else if (/[áéíóú][nsl]$/.test(first)) p = first.replace(/[áéíóú](?=[nsl]$)/, (c) => un[c]) + 'es';
  else p = first + 'es';
  return [p, ...rest].join(' ');
}
export const plural = (cls) => info(cls).g.endsWith('p');
/** Clave común para clases equivalentes (Man/Woman/Person → persona). */
export const group = (cls) => name(cls);
/** Marcas del vocabulario (ver js/vocab.js). */
export const flags = (cls) => FLAGS[cls] ?? (L[cls]?.[4] ? 'o' : '');
export const is = (cls, f) => flags(cls).includes(f);
export const HAZARDS = { has: (cls) => is(cls, 'h') };
/** Referencias útiles que se anuncian una vez (puertas, pasos de peatones, semáforos…). */
export const LANDMARKS = { has: (cls) => is(cls, 'l') };
export const KNOWN = (cls) => cls in L;
export const promptFor = (es) => FIRST_PROMPT[es] || null;
/** Cómo decir un objeto detectado, con la duda si la hay: "perro o gato". */
export const spoken = (o) => (o.alt ? `${name(o.cls)} o ${name(o.alt)}` : name(o.cls));
export const spokenIndef = (o) => (o.alt ? `${indef(o.cls)} o ${indef(o.alt)}` : indef(o.cls));
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const COCO_VEHICLES = new Set(['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train']);
export const VEHICLES = { has: (cls) => is(cls, 'v') || COCO_VEHICLES.has(cls) };

/** Busca la clase (prompt del detector) que corresponde a lo que dice el usuario en español. */
export function classFromSpanish(word) {
  const w = norm(word).replace(/^(un|una|unos|unas|el|la|los|las|mi|mis)\s+/, '').replace(/\s+(mas cercan[oa]s?|cerca)$/, '').trim();
  if (!w) return null;
  const concepts = Object.keys(FIRST_PROMPT);
  // 1) nombre exacto (o en plural)
  for (const es of concepts) {
    const n = norm(es);
    if (w === n || w === n + 's' || w === n + 'es') return FIRST_PROMPT[es];
  }
  // 2) sinónimo exacto
  for (const [es, syns] of Object.entries(SYNONYMS)) if (syns.some((x) => w === norm(x))) return FIRST_PROMPT[es];
  // 3) contiene un nombre o sinónimo (el más largo primero: "puerta corredera" antes que "puerta")
  const all = [...concepts.map((es) => [norm(es), es]), ...Object.entries(SYNONYMS).flatMap(([es, xs]) => xs.map((x) => [norm(x), es]))]
    .sort((a, b) => b[0].length - a[0].length);
  for (const [n, es] of all) if (new RegExp(`\\b${n}\\b`).test(w)) return FIRST_PROMPT[es];
  return null;
}
