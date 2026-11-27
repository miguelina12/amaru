// Vigilante anti-choques: decide cuándo y cómo avisar de obstáculos, SIN repetirse.
//
// Principios:
//  - Un objeto solo cuenta si se ha visto en varias imágenes seguidas (evita fantasmas).
//  - Cada obstáculo se anuncia una vez por "encuentro". Solo se repite si se acerca
//    a distancia de peligro o si desaparece y vuelve a aparecer.
//  - Parado no se avisa, salvo que algo venga directo hacia ti.
//  - Entre dos avisos normales pasan como mínimo unos segundos.

import * as labels from './labels.js';
import { stepsFor } from './geo.js';
import { canMove } from './plausibility.js';

const FORGET_MS = 4000; // si no se ve en este tiempo, el encuentro termina
const WARN_GAP_MS = 4000; // separación mínima entre avisos normales
const DANGER_REPEAT_MS = 5000;

export class Safety {
  /** ctx: { say, cue, sonar, walking(), stepLength(), navigating() } */
  constructor(ctx) {
    this.ctx = ctx;
    this.enabled = true;
    this.tracks = new Map(); // grupo -> { hits, lastSeen, d, v, warned, dangerAt }
    this.lastWarn = 0;
    this.lastObjects = [];
    this.confirm = 3; // imágenes seguidas para confirmar un objeto (2 en móviles lentos)
    this.frameMs = 250;
  }

  /** Ajusta la confirmación a la velocidad del detector. */
  setFrameTime(ms) {
    this.frameMs = 0.8 * this.frameMs + 0.2 * ms;
    this.confirm = this.frameMs > 400 ? 2 : 3;
  }

  _update(objects) {
    const now = Date.now();
    const seen = new Map();
    for (const o of objects) {
      if (o.dist == null) continue;
      const g = labels.group(o.cls);
      const prev = seen.get(g);
      if (!prev || (o.inPath && !prev.inPath) || (o.inPath === prev.inPath && o.dist < prev.dist)) seen.set(g, o);
    }
    for (const [g, o] of seen) {
      let t = this.tracks.get(g);
      if (!t || now - t.lastSeen > FORGET_MS) t = { hits: 0, lastSeen: 0, d: o.dist, v: 0, nv: 0, warned: false, dangerAt: 0 };
      if (now - t.lastSeen < 1500 && t.raw != null) {
        // velocidad con la que se acerca el objeto POR SÍ MISMO: restamos lo que caminas tú
        const closing = (t.raw - o.dist) / Math.max(0.1, (now - t.lastSeen) / 1000);
        const own = this.ctx.speed ? this.ctx.speed() : 0;
        t.v = 0.7 * t.v + 0.3 * Math.max(-3, Math.min(4, closing - own));
        t.nv++;
      }
      t.hits = now - t.lastSeen < Math.max(1200, 2.5 * this.frameMs) ? t.hits + 1 : 1;
      t.lastSeen = now;
      t.raw = o.dist;
      t.d = t.d == null ? o.dist : 0.5 * t.d + 0.5 * o.dist; // suaviza la distancia
      t.obj = o;
      this.tracks.set(g, t);
    }
    for (const [g, t] of this.tracks) if (now - t.lastSeen > FORGET_MS) this.tracks.delete(g);
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
    if (left < 0.2 && right < 0.2) return null;
    if (Math.abs(left - right) < 0.15) return 'none';
    return left < right ? 'izquierda' : 'derecha';
  }

  onDetections(objects) {
    this.lastObjects = objects;
    this._update(objects);
    if (!this.enabled) return;
    const now = Date.now();
    const moving = this.ctx.walking() || this.ctx.navigating();
    const sl = this.ctx.stepLength();

    // Obstáculos confirmados en el camino, del más cercano al más lejano
    const ahead = [...this.tracks.values()]
      .filter((t) => t.hits >= this.confirm && now - t.lastSeen < Math.max(600, 1.5 * this.frameMs) && t.obj.obstacle && t.obj.inPath)
      .sort((a, b) => a.d - b.d);

    const n = ahead[0];
    if (n) this.ctx.sonar.update(Math.max(0, 1 - n.d / 4), Math.max(-1, Math.min(1, n.obj.angle / 30)));
    else this.ctx.sonar.update(0);

    // Referencias (paso de peatones, semáforo): una vez por encuentro, solo caminando.
    if (moving && now - this.lastWarn > WARN_GAP_MS) {
      for (const t of this.tracks.values()) {
        if (t.warned || t.hits < this.confirm || !labels.LANDMARKS.has(t.obj.cls) || t.d > 12) continue;
        if (t.obj.obstacle && t.obj.inPath) continue; // ese ya lo avisa la parte de obstáculos
        if (Math.abs(t.obj.angle) > 25) continue;
        t.warned = true;
        this.lastWarn = now;
        this.ctx.say(`${labels.cap(labels.name(t.obj.cls))} delante.`, { priority: 'normal', remember: false });
        break;
      }
    }

    for (const t of ahead) {
      const o = t.obj;
      const hazard = labels.HAZARDS.has(o.cls);
      const vehicle = labels.VEHICLES.has(o.cls);
      // "Viene hacia ti" solo si puede moverse, se acerca más rápido que tú y lo hemos medido varias veces
      const approaching = canMove(o.cls) && t.nv >= 3 && t.v > 0.9 && t.d < 8 && t.d / t.v < 3;
      if (!moving && !approaching) continue;
      const pan = Math.max(-1, Math.min(1, o.angle / 30));
      const nm = labels.cap(labels.spoken(o));

      // PELIGRO
      if (t.d < (hazard ? 1.6 : 1.2) || approaching) {
        if (now - t.dangerAt < DANGER_REPEAT_MS) return;
        t.dangerAt = now;
        t.warned = true;
        this.lastWarn = now;
        this.ctx.cue.danger(pan);
        let msg;
        if (hazard) msg = `¡Alto! ${nm} justo delante.`;
        else if (approaching && t.d >= 1.2) msg = `¡Cuidado! ${nm} viene hacia ti.`;
        else {
          msg = `¡Alto! ${nm} delante.`;
          const side = this.freeSide(objects);
          if (side === 'izquierda' || side === 'derecha') msg += ` Pasa por la ${side}.`;
        }
        this.ctx.say(msg, { priority: 'urgent', remember: false });
        return;
      }

      // AVISO (una sola vez por encuentro)
      const warnAt = hazard ? 4 : vehicle ? 6 : 2.5;
      if (t.d < warnAt && !t.warned) {
        if (now - this.lastWarn < WARN_GAP_MS) return;
        t.warned = true;
        this.lastWarn = now;
        const steps = stepsFor(t.d, sl);
        this.ctx.cue.warn(pan);
        let msg = `${nm} delante, a ${steps} ${steps === 1 ? 'paso' : 'pasos'}.`;
        if (vehicle && Math.abs(t.v) < 0.5) msg = `${nm} parado delante, a ${steps} pasos.`;
        if (hazard) msg = `Cuidado: ${labels.name(o.cls)} delante, a ${steps} pasos.`;
        else if (labels.is(o.cls, 'l')) msg = `${nm} delante, a ${steps} pasos.`;
        else {
          const side = this.freeSide(objects);
          if (side === 'izquierda' || side === 'derecha') msg += ` Mejor por la ${side}.`;
        }
        this.ctx.say(msg, { priority: 'normal', remember: false });
        return;
      }
    }
  }

  /** Lista de objetos confirmados (vistos en varias imágenes): lo que Faro da por seguro. */
  confirmed() {
    const now = Date.now();
    return [...this.tracks.values()]
      .filter((t) => t.hits >= this.confirm && now - t.lastSeen < 2500)
      .map((t) => ({ ...t.obj, dist: t.d }));
  }

  // Las paredes lisas no se avisan: la heurística daba falsas alarmas.
  onQuality() {}
}
