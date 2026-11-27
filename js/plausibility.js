// "Sentido común" para el detector: descarta detecciones que no tienen lógica física o de contexto.
// Ejemplos: una "persona" más ancha que alta, un objeto con un tamaño imposible para su distancia,
// un coche dentro de casa o una cama en mitad de la calle.

import * as labels from './labels.js';

// Puntuación mínima por concepto (los que el modelo confunde más piden más seguridad).
const MIN_SCORE = {
  persona: 0.5, puerta: 0.45, escaleras: 0.45,
  caja: 0.55, columna: 0.55, armario: 0.5, 'estantería': 0.5, valla: 0.55, ventana: 0.5, poste: 0.55,
  'cubo de basura': 0.5, cono: 0.55, 'pomo de la puerta': 0.55, 'interruptor de la luz': 0.55, enchufe: 0.6,
  alfombra: 0.6, charco: 0.6, agujero: 0.5, bordillo: 0.5, juguete: 0.6, zapato: 0.6,
  'araña': 0.6, mosca: 0.65, hormiga: 0.65, mosquito: 0.65, gusano: 0.65, cucaracha: 0.6,
};
const DEFAULT_MIN = 0.4;

export const canMove = (cls) => labels.is(cls, 'm') || ['person', 'dog', 'cat', 'horse', 'car', 'bus', 'truck', 'motorcycle', 'bicycle', 'train'].includes(cls);

/**
 * o: objeto enriquecido por vision.enrich (con est: {byH, byW, ground}, pxW, pxH, clipped).
 * scene: 'indoor' | 'outdoor' | 'unknown'
 * Devuelve null si es aceptable, o el motivo del descarte.
 */
export function implausible(o, scene = 'unknown') {
  const g = labels.group(o.cls);
  const min = MIN_SCORE[g] ?? DEFAULT_MIN;
  if (o.score < min) return 'poca seguridad';
  if (scene === 'indoor' && labels.is(o.cls, 'x') && o.score < 0.8) return 'no encaja dentro de casa';
  if (scene === 'outdoor' && labels.is(o.cls, 'i') && o.score < 0.8) return 'no encaja en la calle';

  const e = o.est || {};
  // El alto y el ancho deben dar distancias parecidas si el objeto es lo que dice ser.
  if (e.byH && e.byW) {
    const r = Math.max(e.byH, e.byW) / Math.min(e.byH, e.byW);
    if (r > 2.6) return 'proporciones imposibles';
  }
  // Tamaño real según la distancia al suelo (si se ve la base del objeto).
  const inf = labels.info(o.cls);
  if (e.ground && inf.h && !o.clipped?.top && !o.clipped?.bottom && o.realH != null) {
    if (o.realH > inf.h * 2.2 || o.realH < inf.h / 2.5) return 'tamaño imposible';
  }
  // Una persona de pie o sentada no es mucho más ancha que alta.
  if (g === 'persona' && o.pxH && o.pxW && !o.clipped?.top && !o.clipped?.bottom && o.pxH / o.pxW < 0.8) {
    return 'forma no humana';
  }
  return null;
}

export function filter(objects, scene) {
  return objects.filter((o) => !implausible(o, scene));
}
