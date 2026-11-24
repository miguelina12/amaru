// Podómetro (acelerómetro), brújula (orientación) y GPS. Todo con sensores del teléfono.

import { norm360 } from './geo.js';

async function askPermission(Ev) {
  if (typeof Ev !== 'undefined' && typeof Ev.requestPermission === 'function') {
    try { return (await Ev.requestPermission()) === 'granted'; } catch { return false; }
  }
  return true;
}

// ------------------------------------------------------------------ Podómetro

export class Pedometer extends EventTarget {
  constructor() {
    super();
    this.count = 0;
    this.lastStep = 0;
    this.running = false;
    this._lp = 9.81;
    this._base = 9.81;
    this._var = 1;
    this._above = false;
    this._peakT = 0;
    this._candidate = 0;
    this.sensitivity = 1; // multiplicador del umbral
    this._intervals = [];
    this._on = this._on.bind(this);
  }

  requestPermission() {
    return askPermission(window.DeviceMotionEvent);
  }

  start() {
    if (this.running) return;
    this.running = true;
    window.addEventListener('devicemotion', this._on);
  }

  stop() {
    this.running = false;
    window.removeEventListener('devicemotion', this._on);
  }

  get walking() {
    return Date.now() - this.lastStep < 1600;
  }

  /** Velocidad al caminar en m/s (0 si estás parado). */
  speed(stepLength = 0.65) {
    if (!this.walking || this._intervals.length < 2) return 0;
    const avg = this._intervals.reduce((a, b) => a + b, 0) / this._intervals.length;
    return stepLength / (avg / 1000);
  }

  _on(e) {
    const a = e.accelerationIncludingGravity;
    if (!a || a.x == null) return;
    const m = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
    const t = e.timeStamp || performance.now();
    // filtro paso bajo + línea base lenta
    this._lp += 0.25 * (m - this._lp);
    this._base += 0.02 * (m - this._base);
    const x = this._lp - this._base;
    this._var = 0.985 * this._var + 0.015 * x * x;
    const thr = Math.max(0.55, 0.9 * Math.sqrt(this._var)) * this.sensitivity;

    if (!this._above && x > thr) {
      this._above = true;
      this._peakT = t;
    } else if (this._above && x < 0) {
      this._above = false;
      const dt = this._peakT - this._lastPeak;
      if (!this._lastPeak || dt > 260) {
        this._lastPeak = this._peakT;
        this._register(dt);
      }
    }
  }

  _register(dt) {
    // Exigimos dos picos con ritmo de marcha para empezar a contar (evita sacudidas).
    if (!(dt > 260 && dt < 2000)) {
      this._candidate = 1;
      return;
    }
    if (this._candidate === 1) {
      this._candidate = 2;
      this._emit(); // contamos también el primer paso
    }
    this._emit();
  }

  _emit() {
    const now = Date.now();
    if (this.lastStep && now - this.lastStep < 2000) {
      this._intervals.push(now - this.lastStep);
      if (this._intervals.length > 6) this._intervals.shift();
    } else this._intervals = [];
    this.count++;
    this.lastStep = now;
    this.dispatchEvent(new CustomEvent('step', { detail: { count: this.count } }));
  }
}

// ------------------------------------------------------------------ Brújula

/** Rumbo hacia el que mira la cámara trasera (fórmula de la especificación W3C). */
export function cameraHeading(alpha, beta, gamma) {
  const r = Math.PI / 180;
  const cX = Math.cos(beta * r), cY = Math.cos(gamma * r), cZ = Math.cos(alpha * r);
  const sX = Math.sin(beta * r), sY = Math.sin(gamma * r), sZ = Math.sin(alpha * r);
  void cX;
  const Vx = -cZ * sY - sZ * sX * cY;
  const Vy = -sZ * sY + cZ * sX * cY;
  let h = Math.atan(Vx / Vy);
  if (Vy < 0) h += Math.PI;
  else if (Vx < 0) h += 2 * Math.PI;
  return norm360(h / r);
}

export class Compass extends EventTarget {
  constructor() {
    super();
    this.heading = null;
    this.pitch = null; // beta: 90 = teléfono vertical
    this.roll = null; // gamma
    this.absolute = false;
    this._s = 0;
    this._c = 0;
    this._on = this._on.bind(this);
  }

  requestPermission() {
    return askPermission(window.DeviceOrientationEvent);
  }

  start() {
    if ('ondeviceorientationabsolute' in window) {
      this.absolute = true;
      window.addEventListener('deviceorientationabsolute', this._on, true);
    } else {
      window.addEventListener('deviceorientation', this._on, true);
    }
  }

  _on(e) {
    if (e.beta != null) this.pitch = e.beta;
    if (e.gamma != null) this.roll = e.gamma;
    let h = null;
    if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
      h = e.webkitCompassHeading; // iOS
    } else if (e.alpha != null && (e.absolute || this.absolute)) {
      const flat = Math.abs(e.beta) < 25 && Math.abs(e.gamma) < 25;
      h = flat ? norm360(360 - e.alpha) : cameraHeading(e.alpha, e.beta, e.gamma);
    }
    if (h == null || Number.isNaN(h)) return;
    // suavizado circular
    const r = (h * Math.PI) / 180;
    const k = this.heading == null ? 1 : 0.2;
    this._s += k * (Math.sin(r) - this._s);
    this._c += k * (Math.cos(r) - this._c);
    this.heading = norm360((Math.atan2(this._s, this._c) * 180) / Math.PI);
    this.dispatchEvent(new CustomEvent('change', { detail: this.heading }));
  }
}

// ------------------------------------------------------------------ GPS

export class Gps extends EventTarget {
  constructor() {
    super();
    this.last = null;
    this.error = null;
    this._id = null;
  }

  get available() {
    return 'geolocation' in navigator;
  }

  start() {
    if (!this.available || this._id != null) return;
    this._id = navigator.geolocation.watchPosition(
      (p) => {
        this.error = null;
        this.last = {
          lat: p.coords.latitude,
          lon: p.coords.longitude,
          acc: p.coords.accuracy,
          speed: p.coords.speed,
          course: p.coords.heading,
          t: p.timestamp,
        };
        this.dispatchEvent(new CustomEvent('position', { detail: this.last }));
      },
      (err) => {
        this.error = err;
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 },
    );
  }

  /** Última posición si es reciente y suficientemente precisa. */
  good(maxAcc = 25, maxAgeMs = 10000) {
    const p = this.last;
    return p && p.acc <= maxAcc && Date.now() - p.t < maxAgeMs ? p : null;
  }
}
