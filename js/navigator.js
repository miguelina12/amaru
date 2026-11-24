// Grabación y guiado de rutas.
//  - Interior (sin GPS): tramos de "N pasos con rumbo X" medidos con podómetro + brújula.
//  - Exterior: además, puntos GPS cada pocos metros. Guiado hacia un lugar o siguiendo la traza.

import {
  angleDiff, bearing, circularMean, clockPhrase, distancePhrase, haversine, norm360, stepsFor, turnPhrase,
} from './geo.js';

const TURN_DEG = 35;

export class RouteRecorder {
  constructor(name, origin) {
    this.name = name;
    this.origin = origin || null;
    this.segments = [];
    this.track = [];
    this.cur = null;
    this.pending = [];
    this.steps = 0;
  }

  addStep(heading) {
    this.steps++;
    if (!this.cur) {
      this.cur = { headings: [heading], steps: 1 };
      return;
    }
    const mean = circularMean(this.cur.headings);
    if (heading == null || mean == null) {
      this.cur.steps++;
      this.cur.headings.push(heading);
      return;
    }
    if (Math.abs(angleDiff(heading, mean)) > TURN_DEG) {
      this.pending.push(heading);
      if (this.pending.length >= 2) {
        const pm = circularMean(this.pending);
        if (Math.abs(angleDiff(pm, mean)) > TURN_DEG) {
          this._close();
          this.cur = { headings: [...this.pending], steps: this.pending.length };
        } else this._mergePending();
        this.pending = [];
      }
    } else {
      this._mergePending();
      this.cur.headings.push(heading);
      this.cur.steps++;
    }
  }

  _mergePending() {
    if (!this.pending.length || !this.cur) return;
    this.cur.headings.push(...this.pending);
    this.cur.steps += this.pending.length;
    this.pending = [];
  }

  _close() {
    if (this.cur) this.segments.push({ heading: circularMean(this.cur.headings), steps: this.cur.steps });
    this.cur = null;
  }

  addGps(p) {
    if (!p || p.acc > 25) return;
    const last = this.track[this.track.length - 1];
    if (!last || haversine(last, p) >= 8) this.track.push({ lat: p.lat, lon: p.lon });
  }

  finish(stepLength, endPos) {
    this._mergePending();
    this._close();
    if (endPos && endPos.acc <= 25) this.addGps(endPos);
    // fusiona tramos contiguos con rumbo parecido y absorbe tramos de 1 paso
    const out = [];
    for (const s of this.segments) {
      const prev = out[out.length - 1];
      if (prev && (s.steps <= 1 || prev.heading == null || s.heading == null ||
          Math.abs(angleDiff(s.heading, prev.heading)) <= TURN_DEG)) {
        const h = prev.heading == null || s.heading == null ? (prev.heading ?? s.heading)
          : circularMean([...Array(prev.steps).fill(prev.heading), ...Array(s.steps).fill(s.heading)]);
        prev.heading = h;
        prev.steps += s.steps;
      } else out.push({ ...s });
    }
    for (const s of out) s.meters = +(s.steps * stepLength).toFixed(2);
    return {
      name: this.name,
      origin: this.origin,
      segments: out,
      track: this.track,
      totalSteps: this.steps,
      totalMeters: +(this.steps * stepLength).toFixed(1),
    };
  }
}

export function reverseRoute(route, newName) {
  return {
    name: newName || route.origin || 'el punto de partida',
    origin: route.name,
    segments: [...route.segments].reverse().map((s) => ({
      ...s,
      heading: s.heading == null ? null : norm360(s.heading + 180),
    })),
    track: [...(route.track || [])].reverse(),
    totalSteps: route.totalSteps,
    totalMeters: route.totalMeters,
  };
}

export function describeRoute(route, stepLength) {
  const n = route.segments.length;
  const steps = route.segments.reduce((a, s) => a + stepsFor(s.meters, stepLength), 0);
  return `${n} ${n === 1 ? 'tramo' : 'tramos'}, unos ${steps} pasos`;
}

// ------------------------------------------------------------------ Guía por pasos (interior)

export class StepGuide {
  /** ctx: { say(text, opts), cue, heading(), stepLength(), onArrive() } */
  constructor(route, ctx) {
    this.route = route;
    this.ctx = ctx;
    this.i = 0;
    this.done = 0;
    this.phase = 'turn';
    this.lastHint = 0;
    this.lastDrift = 0;
    this.kind = 'steps';
  }

  get seg() {
    return this.route.segments[this.i];
  }

  need() {
    return stepsFor(this.seg.meters, this.ctx.stepLength());
  }

  start() {
    const r = this.route;
    const total = r.segments.reduce((a, s) => a + stepsFor(s.meters, this.ctx.stepLength()), 0);
    let intro = `Te guío hasta ${r.name}. Son unos ${total} pasos`;
    if (r.origin) intro += `, empezando desde ${r.origin}`;
    this.ctx.say(intro + '.');
    this._instruct(true);
  }

  _instruct(first = false) {
    const seg = this.seg;
    this.done = 0;
    const n = this.need();
    const h = this.ctx.heading();
    const pre = first ? '' : 'Ahora, ';
    if (seg.heading != null && h != null) {
      const rel = angleDiff(seg.heading, h);
      if (Math.abs(rel) > 25) {
        this.phase = 'turn';
        this.ctx.cue.turn(rel > 0 ? 0.8 : -0.8);
        this.ctx.say(`${pre}${turnPhrase(rel)}, despacio. Te aviso cuando estés bien orientado.`);
        this.lastHint = Date.now();
        return;
      }
    }
    this.phase = 'walk';
    this.ctx.say(`${pre}camina recto ${n} ${n === 1 ? 'paso' : 'pasos'}.`);
  }

  onHeading(h) {
    const seg = this.seg;
    if (!seg || seg.heading == null || h == null) return;
    const rel = angleDiff(seg.heading, h);
    const now = Date.now();
    if (this.phase === 'turn') {
      if (Math.abs(rel) <= 18) {
        this.phase = 'walk';
        this.ctx.cue.ok();
        const n = this.need() - this.done;
        this.ctx.say(`Así, bien. Camina recto ${n} ${n === 1 ? 'paso' : 'pasos'}.`, { priority: 'urgent' });
      } else if (now - this.lastHint > 3500) {
        this.lastHint = now;
        this.ctx.cue.turn(rel > 0 ? 0.8 : -0.8);
        this.ctx.say(Math.abs(rel) < 45 ? `Un poco más a la ${rel > 0 ? 'derecha' : 'izquierda'}.` : turnPhrase(rel) + '.', { priority: 'low' });
      }
    }
  }

  onStep() {
    if (!this.seg) return;
    this.done++;
    const n = this.need();
    const left = n - this.done;
    const h = this.ctx.heading();
    if (this.seg.heading != null && h != null && this.phase === 'walk') {
      const rel = angleDiff(this.seg.heading, h);
      if (Math.abs(rel) > 30 && Date.now() - this.lastDrift > 4000) {
        this.lastDrift = Date.now();
        this.ctx.say(`Te estás desviando. Corrige un poco a la ${rel > 0 ? 'derecha' : 'izquierda'}.`, { priority: 'low' });
      }
    }
    if (left <= 0) {
      this.i++;
      if (this.i >= this.route.segments.length) {
        this.ctx.cue.arrive();
        this.ctx.say(`Has llegado a ${this.route.name}.`, { priority: 'urgent' });
        this.ctx.onArrive?.(this.route.name);
        return;
      }
      this.ctx.cue.turn(0);
      this._instruct();
    } else if (left === 3 || left === 1 || (left % 10 === 0 && n > 12)) {
      this.ctx.say(left === 1 ? 'Un paso más.' : `Quedan ${left} pasos.`, { priority: 'low' });
    }
  }

  progress() {
    let left = this.need() - this.done;
    for (let j = this.i + 1; j < this.route.segments.length; j++) left += stepsFor(this.route.segments[j].meters, this.ctx.stepLength());
    return `Quedan unos ${Math.max(0, left)} pasos hasta ${this.route.name}.`;
  }
}

// ------------------------------------------------------------------ Guía GPS (exterior)

export class GpsGuide {
  /** waypoints: [{lat,lon}], el último es el destino. */
  constructor(name, waypoints, ctx) {
    this.name = name;
    this.wps = waypoints;
    this.ctx = ctx;
    this.i = 0;
    this.lastSay = 0;
    this.lastTurn = null;
    this.pos = null;
    this.kind = 'gps';
  }

  start() {
    const p = this.ctx.position();
    if (p) this.onPosition(p, true);
    else this.ctx.say(`Buscando señal GPS para ir a ${this.name}. Sal a un sitio abierto si puedes.`);
  }

  _target() {
    return this.wps[this.i];
  }

  onPosition(p, force = false) {
    this.pos = p;
    // avanza puntos intermedios
    while (this.i < this.wps.length - 1 && haversine(p, this.wps[this.i]) < Math.max(10, p.acc * 0.8)) this.i++;
    const final = this.wps[this.wps.length - 1];
    const dFinal = haversine(p, final);
    if (dFinal < Math.max(6, Math.min(p.acc, 15))) {
      this.ctx.cue.arrive();
      this.ctx.say(`Has llegado a ${this.name}, con un margen de unos ${Math.round(p.acc)} metros.`, { priority: 'urgent' });
      this.ctx.onArrive?.(this.name);
      return;
    }
    this._announce(force);
  }

  onHeading() {
    if (!this.pos) return;
    const h = this.ctx.heading();
    if (h == null) return;
    const rel = angleDiff(bearing(this.pos, this._target()), h);
    const turn = turnPhrase(rel);
    if (turn !== this.lastTurn && Date.now() - this.lastSay > 2500) this._announce(true);
  }

  _announce(force) {
    const now = Date.now();
    if (!force && now - this.lastSay < 15000) return;
    const t = this._target();
    const d = haversine(this.pos, t);
    const h = this.ctx.heading();
    const sl = this.ctx.stepLength();
    const what = this.i < this.wps.length - 1 ? 'el siguiente punto' : this.name;
    let msg;
    if (h == null) {
      msg = `${this.name} está a ${distancePhrase(haversine(this.pos, this.wps[this.wps.length - 1]), sl)}.`;
    } else {
      const rel = angleDiff(bearing(this.pos, t), h);
      this.lastTurn = turnPhrase(rel);
      msg = Math.abs(rel) < 15
        ? `Vas bien. ${what} está recto, a ${distancePhrase(d, sl)}.`
        : `${capitalize(turnPhrase(rel))}. ${what} está ${clockPhrase(rel)}, a ${distancePhrase(d, sl)}.`;
    }
    if (this.pos.acc > 30) msg += ' La señal GPS es débil, ve con cuidado.';
    this.lastSay = now;
    this.ctx.say(msg, { priority: force ? 'normal' : 'low' });
  }

  progress() {
    if (!this.pos) return 'Todavía no tengo tu posición.';
    return `${capitalize(this.name)} está a ${distancePhrase(haversine(this.pos, this.wps[this.wps.length - 1]), this.ctx.stepLength())}.`;
  }

  onStep() {}
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
