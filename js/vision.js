// Cámara + detección de objetos en el propio teléfono (TensorFlow.js + COCO-SSD).
// También mide la calidad de imagen (luz, nitidez, cámara tapada) y textura central
// para avisar de posibles paredes lisas que el detector no reconoce.

import * as labels from './labels.js';
import { clockOf } from './geo.js';

const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
const COCO = 'https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js';

const CAMERA_HEIGHT = 1.3; // m, teléfono a la altura del pecho
const LONG_SIDE_FOV = 64; // grados, cámara principal típica
const CORRIDOR = 0.45; // m a cada lado del eje de marcha

function loadScript(src) {
  return new Promise((res, rej) => {
    if (document.querySelector(`script[src="${src}"]`)) return res();
    const s = document.createElement('script');
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

export class Vision extends EventTarget {
  constructor(video, getPitch) {
    super();
    this.video = video;
    this.getPitch = getPitch || (() => null);
    this.model = null;
    this.stream = null;
    this.track = null;
    this.running = false;
    this.torchOn = false;
    this.last = [];
    this.lastAt = 0;
    this.quality = null;
    this._n = 0;
    this._c = document.createElement('canvas');
    this._c.width = 80;
    this._c.height = 60;
    this._g = this._c.getContext('2d', { willReadFrequently: true });
  }

  async startCamera() {
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 } },
    });
    this.video.srcObject = this.stream;
    this.track = this.stream.getVideoTracks()[0];
    await this.video.play().catch(() => {});
    try {
      const caps = this.track.getCapabilities?.() || {};
      if (caps.focusMode?.includes?.('continuous')) await this.track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] });
    } catch {}
  }

  stopCamera() {
    this.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.track = null;
  }

  async loadModel() {
    if (this.model) return;
    await loadScript(TFJS);
    await loadScript(COCO);
    try { await window.tf.setBackend('webgl'); } catch {}
    await window.tf.ready();
    this.model = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
  }

  get ready() {
    return !!this.model && this.video.readyState >= 2;
  }

  async torch(on) {
    try {
      const caps = this.track?.getCapabilities?.() || {};
      if (!caps.torch) return false;
      await this.track.applyConstraints({ advanced: [{ torch: on }] });
      this.torchOn = on;
      return true;
    } catch {
      return false;
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._loop();
  }

  stop() {
    this.running = false;
  }

  async _loop() {
    while (this.running) {
      const t0 = performance.now();
      try {
        if (this.video.readyState >= 2) {
          if (this._n++ % 3 === 0) this._quality();
          if (this.model) await this.detectNow();
        }
      } catch (e) {
        console.warn(e);
      }
      const wait = Math.max(60, 220 - (performance.now() - t0));
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  async detectNow() {
    if (!this.model || this.video.readyState < 2) return this.last;
    const preds = await this.model.detect(this.video, 12, 0.42);
    const W = this.video.videoWidth, H = this.video.videoHeight;
    const pitch = this.getPitch();
    this.last = preds.map((p) => enrich(p, W, H, pitch));
    this.lastAt = Date.now();
    this.dispatchEvent(new CustomEvent('detections', { detail: { objects: this.last, W, H } }));
    return this.last;
  }

  _quality() {
    const g = this._g, w = 80, h = 60;
    g.drawImage(this.video, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    const gray = new Float32Array(w * h);
    let sum = 0;
    for (let i = 0; i < w * h; i++) {
      const v = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      gray[i] = v;
      sum += v;
    }
    const mean = sum / (w * h);
    let vs = 0, lap = 0, lapSq = 0, nLap = 0;
    let cSum = 0, cSq = 0, cN = 0, cEdges = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const v = gray[i];
        vs += (v - mean) ** 2;
        const L = 4 * v - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
        lap += L;
        lapSq += L * L;
        nLap++;
        if (x > w * 0.3 && x < w * 0.7 && y > h * 0.25 && y < h * 0.8) {
          cSum += v; cSq += v * v; cN++;
          const gx = Math.abs(gray[i + 1] - gray[i - 1]);
          const gy = Math.abs(gray[i + w] - gray[i - w]);
          if (gx + gy > 36) cEdges++;
        }
      }
    }
    const std = Math.sqrt(vs / nLap);
    const lapMean = lap / nLap;
    const sharp = lapSq / nLap - lapMean * lapMean;
    const cMean = cSum / cN;
    const q = {
      brightness: mean,
      contrast: std,
      sharpness: sharp,
      centerStd: Math.sqrt(Math.max(0, cSq / cN - cMean * cMean)),
      centerEdges: cEdges / cN,
      covered: mean < 14 && std < 7,
      dark: mean < 45,
      blurry: sharp < 40,
    };
    this.quality = q;
    this.dispatchEvent(new CustomEvent('quality', { detail: q }));
  }
}

/** Añade distancia, ángulo, hora del reloj y si está en el camino. */
export function enrich(p, W, H, pitch) {
  const [x, y, w, h] = p.bbox;
  const inf = labels.info(p.class);
  const f = Math.max(W, H) / 2 / Math.tan(((LONG_SIDE_FOV / 2) * Math.PI) / 180);
  const clipTop = y < 4, clipBot = y + h > H - 4;
  const clipL = x < 4, clipR = x + w > W - 4;
  const est = [];
  if (inf.h && !clipTop && !clipBot) est.push((inf.h * f) / h);
  if (inf.w && !clipL && !clipR) est.push((inf.w * f) / w);
  if (!clipBot && pitch != null && pitch > 20 && pitch < 140) {
    const down = 90 - pitch + (Math.atan((y + h - H / 2) / f) * 180) / Math.PI;
    if (down > 3) est.push(CAMERA_HEIGHT / Math.tan((down * Math.PI) / 180));
  }
  let dist = est.length ? Math.min(...est) : null;
  if (dist == null && h > 0.7 * H) dist = 0.7;
  if (dist != null) dist = Math.max(0.3, Math.min(dist, 30));

  const cx = x + w / 2;
  const angle = (Math.atan((cx - W / 2) / f) * 180) / Math.PI;
  let inPath;
  if (dist != null) {
    const left = (dist * (x - W / 2)) / f;
    const right = (dist * (x + w - W / 2)) / f;
    inPath = right > -CORRIDOR && left < CORRIDOR;
  } else {
    inPath = x + w > W * 0.35 && x < W * 0.65;
  }
  return {
    cls: p.class,
    score: p.score,
    bbox: p.bbox,
    dist,
    angle,
    clock: clockOf(angle),
    zone: angle < -12 ? 'izquierda' : angle > 12 ? 'derecha' : 'delante',
    inPath,
    lateral: dist != null ? (dist * (cx - W / 2)) / f : null,
    obstacle: inf.obstacle,
  };
}
