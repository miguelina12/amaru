// Utilidades geométricas puras (sin dependencias, testeables en Node).

export const EARTH_R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function norm360(a) {
  return ((a % 360) + 360) % 360;
}

/** Diferencia angular en (-180, 180]. Positivo = el objetivo está a la derecha. */
export function angleDiff(target, current) {
  let d = norm360(target) - norm360(current);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function haversine(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumbo inicial de a hacia b, 0..360 (0 = norte, 90 = este). */
export function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x =
    Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
    Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return norm360(deg(Math.atan2(y, x)));
}

export function circularMean(angles) {
  const list = angles.filter((a) => a != null && !Number.isNaN(a));
  if (!list.length) return null;
  let s = 0, c = 0;
  for (const a of list) {
    s += Math.sin(rad(a));
    c += Math.cos(rad(a));
  }
  return norm360(deg(Math.atan2(s, c)));
}

/** Ángulo relativo -> hora del reloj (12 = delante, 3 = derecha, 9 = izquierda, 6 = detrás). */
export function clockOf(rel) {
  const h = Math.round(norm360(rel) / 30) % 12;
  return h === 0 ? 12 : h;
}

export function clockPhrase(rel) {
  const h = clockOf(rel);
  if (h === 12) return 'justo delante';
  if (h === 1) return 'a la una';
  return `a las ${h}`;
}

export function turnPhrase(rel) {
  const a = Math.abs(rel);
  const side = rel > 0 ? 'derecha' : 'izquierda';
  if (a < 15) return 'sigue recto';
  if (a < 45) return `ligeramente a la ${side}`;
  if (a < 135) return `gira a la ${side}`;
  return 'date la vuelta';
}

export function cardinal(h) {
  const names = ['norte', 'noreste', 'este', 'sureste', 'sur', 'suroeste', 'oeste', 'noroeste'];
  return names[Math.round(norm360(h) / 45) % 8];
}

export function stepsFor(meters, stepLength) {
  return Math.max(1, Math.round(meters / (stepLength || 0.65)));
}

export function distancePhrase(m, stepLength) {
  if (m < 1) return 'menos de un metro';
  const steps = stepsFor(m, stepLength);
  if (m < 25) return `${steps} ${steps === 1 ? 'paso' : 'pasos'}`;
  const rounded = m < 100 ? Math.round(m / 5) * 5 : Math.round(m / 10) * 10;
  if (m < 1000) return `${rounded} metros, unos ${Math.round(steps / 10) * 10} pasos`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} kilómetros`;
}

/** Proyección local plana (metros) alrededor de un origen, para distancias cortas. */
export function toLocal(origin, p) {
  const x = rad(p.lon - origin.lon) * EARTH_R * Math.cos(rad(origin.lat));
  const y = rad(p.lat - origin.lat) * EARTH_R;
  return { x, y };
}
