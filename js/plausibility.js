// "Sentido común" para el detector: descarta detecciones que no tienen lógica física o de contexto.
// Ejemplos: una "persona" más ancha que alta, un objeto con un tamaño imposible para su distancia,
// un coche dentro de casa o una cama en mitad de la calle.

import * as labels from './labels.js';

// Puntuación mínima por clase (las que el modelo confunde más piden más seguridad).
const MIN_SCORE = {
  person: 0.5, door: 0.5, stairs: 0.45,
  box: 0.6, column: 0.6, cabinet: 0.6, shelf: 0.6, fence: 0.55, window: 0.6, pole: 0.55,
  'trash can': 0.55, 'traffic cone': 0.55, 'door handle': 0.55, 'light switch': 0.55,
};
const DEFAULT_MIN = 0.45;

const OUTDOOR_ONLY = new Set(['car', 'bus', 'truck', 'van', 'motorcycle', 'train', 'crosswalk', 'traffic light', 'street lamp', 'traffic cone', 'fire hydrant', 'parking meter']);
const INDOOR_ONLY = new Set(['bed', 'sofa', 'couch', 'toilet', 'bathtub', 'washing machine', 'refrigerator', 'oven', 'sink', 'light switch']);
const MOVABLE = new Set(['person', 'dog', 'cat', 'horse', 'car', 'bus', 'truck', 'van', 'motorcycle', 'bicycle', 'scooter', 'train', 'stroller', 'wheelchair', 'shopping cart']);

export const canMove = (cls) => MOVABLE.has(cls);

/**
 * o: objeto enriquecido por vision.enrich (con est: {byH, byW, ground}, pxW, pxH, clipped).
 * scene: 'indoor' | 'outdoor' | 'unknown'
 * Devuelve null si es aceptable, o el motivo del descarte.
 */
export function implausible(o, scene = 'unknown') {
  const min = MIN_SCORE[o.cls] ?? DEFAULT_MIN;
  if (o.score < min) return 'poca seguridad';
  if (scene === 'indoor' && OUTDOOR_ONLY.has(o.cls) && o.score < 0.8) return 'no encaja dentro de casa';
  if (scene === 'outdoor' && INDOOR_ONLY.has(o.cls) && o.score < 0.8) return 'no encaja en la calle';

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
  if (o.cls === 'person' && o.pxH && o.pxW && !o.clipped?.top && !o.clipped?.bottom && o.pxH / o.pxW < 0.8) {
    return 'forma no humana';
  }
  return null;
}

export function filter(objects, scene) {
  return objects.filter((o) => !implausible(o, scene));
}
