// Detector YOLOE con vocabulario propio (puertas, escaleras, postes, personas, muebles, vehículos…)
// ejecutado en el propio teléfono con ONNX Runtime Web (WebGPU si existe, si no WebAssembly).
// El modelo viaja con la app (models/), no se llama a ningún servidor de IA.

const ORT_VER = '1.22.0';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VER}/dist/`;

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

export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

/** NMS. groupOf(cls) agrupa clases equivalentes (hombre/mujer/persona) para no duplicar. */
export function nms(dets, thr = 0.45, groupOf = (c) => c) {
  dets.sort((a, b) => b.score - a.score);
  const keep = [];
  for (const d of dets) {
    const g = groupOf(d.class);
    if (keep.some((k) => groupOf(k.class) === g && iou(k.bbox, d.bbox) > thr)) continue;
    keep.push(d);
  }
  return keep;
}

/**
 * Decodifica la salida YOLOv8 [1, 4 + C, N] (cx, cy, w, h en píxeles del tensor S×S).
 * wanted: Map índiceClase -> nombre. Solo se consideran esas clases.
 */
export function decode(out, C, N, wanted, minScore, lb, groupIdx = null, prior = null) {
  const dets = [];
  for (let i = 0; i < N; i++) {
    let best = -1, bs = minScore, alt = -1, as = 0;
    for (const [c] of wanted) {
      const s = prior ? out[(4 + c) * N + i] * prior[c] : out[(4 + c) * N + i];
      if (s > bs) {
        if (best >= 0 && (!groupIdx || groupIdx[best] !== groupIdx[c]) && bs > as) { alt = best; as = bs; }
        bs = s; best = c;
      } else if (s > as && s > minScore * 0.5 && (!groupIdx || best < 0 || groupIdx[best] !== groupIdx[c])) { alt = c; as = s; }
    }
    if (best < 0) continue;
    const cx = out[i], cy = out[N + i], w = out[2 * N + i], h = out[3 * N + i];
    const x = (cx - w / 2 - lb.dx) / lb.scale;
    const y = (cy - h / 2 - lb.dy) / lb.scale;
    const d = { class: wanted.get(best), score: bs, bbox: [x, y, w / lb.scale, h / lb.scale] };
    if (alt >= 0 && groupIdx && groupIdx[alt] !== groupIdx[best]) { d.alt = wanted.get(alt); d.altScore = as; }
    dets.push(d);
  }
  return dets;
}

export class YoloDetector {
  constructor({ modelUrl, names, wanted, size = 416, groupOf, prior }) {
    this.modelUrl = modelUrl;
    this.names = names; // array de nombres de clase del modelo
    this.size = size;
    this.groupOf = groupOf;
    this.wanted = new Map();
    names.forEach((n, i) => { if (wanted.has(n)) this.wanted.set(i, n); });
    // índice de concepto por clase, para saber si la "segunda opción" es otra cosa distinta
    // "sentido común": peso de cada clase (p. ej. animales raros en una ciudad pesan menos)
    this.prior = prior ? Float32Array.from(names, (n) => prior(n)) : null;
    const gmap = new Map();
    this.groupIdx = names.map((n) => { const g = groupOf ? groupOf(n) : n; if (!gmap.has(g)) gmap.set(g, gmap.size); return gmap.get(g); });
    this.session = null;
    this.backend = null;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.input = new Float32Array(3 * size * size);
  }

  async load() {
    const gpu = !!navigator.gpu;
    await loadScript(ORT_CDN + (gpu ? 'ort.webgpu.min.js' : 'ort.wasm.min.js'));
    const ort = window.ort;
    ort.env.wasm.wasmPaths = ORT_CDN;
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
    const tries = gpu ? [['webgpu'], ['wasm']] : [['wasm']];
    let err;
    for (const eps of tries) {
      try {
        this.session = await ort.InferenceSession.create(this.modelUrl, { executionProviders: eps, graphOptimizationLevel: 'all' });
        this.backend = eps[0];
        break;
      } catch (e) { err = e; }
    }
    if (!this.session) throw err;
  }

  /** source: <video> o <img>. Devuelve [{class, score, bbox:[x,y,w,h]}] en píxeles de la imagen. */
  async detect(source, W, H, minScore = 0.3) {
    const S = this.size, g = this.ctx;
    const scale = Math.min(S / W, S / H);
    const dw = Math.round(W * scale), dh = Math.round(H * scale);
    const dx = Math.floor((S - dw) / 2), dy = Math.floor((S - dh) / 2);
    g.fillStyle = 'rgb(114,114,114)';
    g.fillRect(0, 0, S, S);
    g.drawImage(source, 0, 0, W, H, dx, dy, dw, dh);
    const px = g.getImageData(0, 0, S, S).data;
    const plane = S * S, inp = this.input;
    for (let i = 0; i < plane; i++) {
      inp[i] = px[i * 4] / 255;
      inp[plane + i] = px[i * 4 + 1] / 255;
      inp[2 * plane + i] = px[i * 4 + 2] / 255;
    }
    const ort = window.ort;
    const feeds = { [this.session.inputNames[0]]: new ort.Tensor('float32', inp, [1, 3, S, S]) };
    const res = await this.session.run(feeds);
    const t = res[this.session.outputNames[0]];
    const [, , N] = t.dims;
    const data = t.data instanceof Float32Array ? t.data : await t.getData();
    // filas: 4 de caja + clases (+ 32 coeficientes de máscara que ignoramos)
    const dets = decode(data, this.names.length, N, this.wanted, minScore, { scale, dx, dy }, this.groupIdx, this.prior);
    return nms(dets, 0.45, this.groupOf).slice(0, 20);
  }
}

/**
 * Une las detecciones del detector general y del especialista de casa.
 * Si los dos ven lo mismo (mismo concepto, mucho solape), gana el especialista,
 * que está entrenado con fotos reales de casas (puertas, ventanas, armarios…).
 */
export function merge(general, specialist, groupOf = (c) => c) {
  const tagged = [
    ...specialist.map((d) => ({ ...d, _rank: d.score + 0.2, source: 'casa' })),
    ...general.map((d) => ({ ...d, _rank: d.score, source: 'general' })),
  ];
  tagged.sort((a, b) => b._rank - a._rank);
  const keep = [];
  for (const d of tagged) {
    const g = groupOf(d.class);
    if (keep.some((k) => groupOf(k.class) === g && iou(k.bbox, d.bbox) > 0.45)) continue;
    keep.push(d);
  }
  return keep.map(({ _rank, ...d }) => d);
}
