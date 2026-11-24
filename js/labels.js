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


// ---- Vocabulario del detector de Faro (YOLOE, categorías elegidas para moverse sin ver).
// Las que coinciden con COCO (person, chair, car…) reutilizan las entradas de arriba.
const FARO = {
  door: ['puerta', 'f', 2.0, 0.85, true], stairs: ['escaleras', 'fp', 0, 1.0, true],
  table: ['mesa', 'f', 0.75, 1.2, true], sofa: ['sofá', 'm', 0.85, 2.0, true],
  van: ['furgoneta', 'f', 2.0, 1.9, true], pole: ['poste', 'm', 0, 0.15, true], 'street lamp': ['farola', 'f', 0, 0.3, true],
  tree: ['árbol', 'm', 0, 0.5, true], 'trash can': ['papelera', 'f', 0.9, 0.5, true], fence: ['valla', 'f', 0, 0, true],
  cabinet: ['armario', 'm', 0, 0, true], shelf: ['estantería', 'f', 0, 0, true], window: ['ventana', 'f', 0, 0, false],
  bathtub: ['bañera', 'f', 0.55, 1.6, true], 'washing machine': ['lavadora', 'f', 0.85, 0.6, true],
  stroller: ['carrito de bebé', 'm', 1.0, 0.6, true], wheelchair: ['silla de ruedas', 'f', 0.9, 0.65, true],
  'shopping cart': ['carrito', 'm', 1.0, 0.6, true], scooter: ['patinete', 'm', 1.0, 0.5, true],
  'traffic cone': ['cono', 'm', 0.5, 0.35, true], 'door handle': ['pomo de la puerta', 'm', 0, 0, false],
  'light switch': ['interruptor de la luz', 'm', 0, 0, false], column: ['columna', 'f', 0, 0.4, true],
  crosswalk: ['paso de peatones', 'm', 0, 0, false], box: ['caja', 'f', 0, 0, true],
};
for (const [k, v] of Object.entries(FARO)) L[k] = v;

const SYNONYMS = {
  person: ['gente', 'alguien', 'hombre', 'mujer', 'nino', 'nina', 'personas', 'señor', 'senor', 'señora', 'senora'],
  car: ['coches', 'auto', 'carro', 'automovil', 'vehiculo', 'taxi'],
  'dining table': ['mesas', 'mesita', 'escritorio'],
  chair: ['sillas', 'asiento', 'taburete'],
  couch: ['sillon', 'sofa'],
  bed: ['camas'],
  refrigerator: ['frigorifico', 'nevera', 'refrigerador', 'heladera'],
  toilet: ['vater', 'water', 'retrete', 'bano', 'wc'],
  'cell phone': ['telefono', 'movil', 'celular'],
  tv: ['television', 'tele', 'televisor'],
  cup: ['vaso', 'taza'],
  'potted plant': ['maceta', 'planta', 'plantas'],
  dog: ['perros', 'perrito'],
  bench: ['bancos', 'banco'],
  bus: ['autobus', 'bus', 'guagua', 'colectivo'],
  bicycle: ['bici', 'bicicleta'],
  'traffic light': ['semaforo', 'semaforos'],
  sink: ['lavabo', 'fregadero', 'pila'],
  bottle: ['botella', 'botellas'],
  backpack: ['mochila'],
  remote: ['mando'],
  door: ['puertas', 'entrada', 'salida', 'portal'],
  stairs: ['escalera', 'escalones', 'peldanos'],
  'street lamp': ['farolas', 'farol'],
  pole: ['postes', 'poste', 'pivote', 'bolardo'],
  'trash can': ['basura', 'cubo de basura', 'papelera', 'contenedor'],
  cabinet: ['armarios', 'mueble'],
  window: ['ventanas'],
  'door handle': ['pomo', 'manilla', 'picaporte', 'tirador'],
  'light switch': ['interruptor', 'llave de la luz'],
  crosswalk: ['paso de cebra', 'paso de peatones', 'cruce'],
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
export const HAZARDS = new Set(['stairs']);
/** Referencias útiles que se anuncian una vez, sin ser obstáculos. */
export const LANDMARKS = new Set(['crosswalk', 'traffic light']);
export const KNOWN = (cls) => cls in L;
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export const VEHICLES = new Set(['car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train', 'van', 'scooter']);

/** Busca la clase COCO que corresponde a una palabra en español. */
export function classFromSpanish(word) {
  const w = norm(word).replace(/^(un|una|el|la|los|las|mi)\s+/, '').trim();
  for (const [cls, l] of Object.entries(L)) {
    const n = norm(l[0]);
    if (w === n || w === n + 's' || w === n + 'es') return cls;
  }
  for (const [cls, syns] of Object.entries(SYNONYMS)) {
    if (syns.some((s) => w === norm(s) || w.includes(norm(s)))) return cls;
  }
  for (const [cls, l] of Object.entries(L)) {
    if (w.includes(norm(l[0]))) return cls;
  }
  return null;
}
