// Vigilante anti-choques: decide cuándo y cómo avisar de obstáculos.

import * as labels from './labels.js';
import { stepsFor } from './geo.js';

export class Safety {
  /** ctx: { say, cue, sonar, walking(), stepLength(), navigating() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = true;
    this.lastAlert = new Map(); // clave -> tiempo
    this.track = new Map(); // cls -> { d, t, v }
    this.flatCount = 0;
    this.lastFlat = 0;
    this.lastObjects = [];
  }

  _can(key, ms) {
    const t = this.lastAlert.get(key) || 0;
    if (Date.now() - t < ms) return false;
    this.lastAlert.set(key, Date.now());
    return true;
  }

  _approach(o) {
    const now = Date.now();
    const prev = this.track.get(o.cls);
    let v = 0;
    if (prev && now - prev.t < 1500 && o.dist != null && prev.d != null) {
      const inst = (prev.d - o.dist) / ((now - prev.t) / 1000);
      v = 0.6 * prev.v + 0.4 * inst; // m/s acercándose (+)
    }
    this.track.set(o.cls, { d: o.dist, t: now, v });
    return v;
  }

  freeSide(objects) {
    let left = 0, right = 0;
    for (const o of objects) {
      if (!o.obstacle || o.dist == null || o.dist > 3.5 || o.lateral == null) continue;
      const w = labels.info(o.cls).w || 0.5;
      const l0 = o.lateral - w / 2, l1 = o.lateral + w / 2;
      if (l1 > -1.3 && l0 < -0.3) left += 1 / o.dist;
      if (l1 > 0.3 && l0 < 1.3) right += 1 / o.dist;
    }
    if (left < 0.2 && right < 0.2) return 'cualquier lado';
    if (Math.abs(left - right) < 0.15) return null;
    return left < right ? 'izquierda' : 'derecha';
  }

  onDetections(objects) {
    this.lastObjects = objects;
    if (!this.enabled) return;
    const moving = this.ctx.walking() || this.ctx.navigating();
    const sl = this.ctx.stepLength();
    const inPath = objects
      .filter((o) => o.obstacle && o.inPath && o.dist != null)
      .sort((a, b) => a.dist - b.dist);

    // sónar
    const n = inPath[0];
    if (n) this.ctx.sonar.update(Math.max(0, 1 - n.dist / 4), Math.max(-1, Math.min(1, n.angle / 30)));
    else this.ctx.sonar.update(0);

    for (const o of inPath) {
      const v = this._approach(o);
      const vehicle = labels.VEHICLES.has(o.cls);
      const ttc = v > 0.2 ? o.dist / v : Infinity;
      const pan = Math.max(-1, Math.min(1, o.angle / 30));
      const nm = labels.cap(labels.name(o.cls));

      if (o.dist < 1.3 || ttc < 1.8) {
        if (!moving && ttc === Infinity && o.dist > 0.8) continue;
        if (!this._can('danger:' + o.cls, 2500)) continue;
        const side = this.freeSide(objects);
        this.ctx.cue.danger(pan);
        let msg = `¡Alto! ${nm} justo delante.`;
        if (ttc < 1.8 && o.dist >= 1.3) msg = `¡Cuidado! ${nm} acercándose de frente.`;
        if (side === 'izquierda' || side === 'derecha') msg += ` Pasa por la ${side}.`;
        else if (side == null) msg += ' Detente y gira un poco para buscar paso.';
        this.ctx.say(msg, { priority: 'urgent', remember: false });
        return;
      }
      const warnDist = vehicle ? 7 : 2.8;
      if (o.dist < warnDist && (moving || vehicle || v > 0.3)) {
        if (!this._can('warn:' + o.cls, vehicle ? 5000 : 6000)) continue;
        const steps = stepsFor(o.dist, sl);
        const side = this.freeSide(objects);
        this.ctx.cue.warn(pan);
        let msg = `${nm} delante, a ${steps} ${steps === 1 ? 'paso' : 'pasos'}.`;
        if (side === 'izquierda' || side === 'derecha') msg += ` Desvíate a la ${side}.`;
        this.ctx.say(msg, { priority: 'urgent', remember: false });
        return;
      }
    }

    // objetos muy cerca a los lados mientras caminas
    if (moving) {
      for (const o of objects) {
        if (!o.obstacle || o.inPath || o.dist == null || o.dist > 1.0) continue;
        if (!this._can('side:' + o.cls + o.zone, 7000)) continue;
        this.ctx.say(`${labels.cap(labels.name(o.cls))} muy cerca, a tu ${o.zone}.`, { priority: 'low', remember: false });
        break;
      }
    }
  }

  /** Paredes lisas, puertas cerradas, armarios: el detector no los reconoce. */
  onQuality(q) {
    if (!this.enabled || q.covered || q.dark) { this.flatCount = 0; return; }
    const moving = this.ctx.walking();
    const nothingDetected = !this.lastObjects.some((o) => o.inPath && o.obstacle);
    const flat = q.centerStd < 11 && q.centerEdges < 0.03;
    if (moving && nothingDetected && flat) this.flatCount++;
    else this.flatCount = Math.max(0, this.flatCount - 1);
    if (this.flatCount >= 3 && Date.now() - this.lastFlat > 8000) {
      this.lastFlat = Date.now();
      this.flatCount = 0;
      this.ctx.cue.warn(0);
      this.ctx.say('Cuidado, puede haber una pared o una superficie lisa delante. Tantea con el bastón.', { priority: 'urgent', remember: false });
    }
  }
}
