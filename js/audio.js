// Sonidos espaciales (izquierda/derecha) y vibración. Todo generado en el dispositivo.

let ctx = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlock() {
  ac();
}

export function beep({ freq = 880, dur = 0.12, pan = 0, vol = 0.35, type = 'sine', delay = 0 } = {}) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime + delay;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o;
  node.connect(g);
  node = g;
  if (c.createStereoPanner) {
    const p = c.createStereoPanner();
    p.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), t);
    node.connect(p);
    node = p;
  }
  node.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch {}
}

export const cue = {
  listen() { beep({ freq: 660, dur: 0.08 }); beep({ freq: 990, dur: 0.1, delay: 0.09 }); vibrate(30); },
  heard() { beep({ freq: 990, dur: 0.08 }); beep({ freq: 660, dur: 0.1, delay: 0.09 }); },
  ok() { beep({ freq: 880, dur: 0.09 }); beep({ freq: 1320, dur: 0.12, delay: 0.1 }); vibrate(40); },
  step() { beep({ freq: 520, dur: 0.04, vol: 0.12 }); },
  turn(pan) { beep({ freq: 740, dur: 0.15, pan }); },
  warn(pan = 0) { beep({ freq: 600, dur: 0.18, pan, type: 'triangle' }); vibrate([120, 60, 120]); },
  danger(pan = 0) {
    for (let i = 0; i < 3; i++) beep({ freq: 1200, dur: 0.1, pan, type: 'square', vol: 0.3, delay: i * 0.13 });
    vibrate([300, 80, 300, 80, 300]);
  },
  arrive() {
    [660, 880, 1100, 1320].forEach((f, i) => beep({ freq: f, dur: 0.14, delay: i * 0.12 }));
    vibrate([80, 60, 80, 60, 200]);
  },
};

/** Sónar tipo sensor de aparcamiento: más cerca = pitidos más rápidos y agudos. */
export class Sonar {
  constructor() {
    this.on = false;
    this.prox = 0; // 0 = nada, 1 = muy cerca
    this.pan = 0;
    this._t = null;
  }
  start() {
    if (this.on) return;
    this.on = true;
    this._tick();
  }
  stop() {
    this.on = false;
    clearTimeout(this._t);
  }
  update(prox, pan = 0) {
    this.prox = Math.max(0, Math.min(1, prox));
    this.pan = pan;
  }
  _tick() {
    if (!this.on) return;
    let wait = 400;
    if (this.prox > 0.05) {
      beep({ freq: 420 + 900 * this.prox, dur: 0.05, pan: this.pan, vol: 0.18 + 0.2 * this.prox });
      wait = 1100 - 1000 * this.prox;
    }
    this._t = setTimeout(() => this._tick(), Math.max(90, wait));
  }
}
