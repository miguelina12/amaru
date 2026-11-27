// Servidor "cerebro" de Faro: hace de puerta entre la app y un modelo local de Ollama.
// - Solo escucha en 127.0.0.1; a internet sale por Cloudflare Tunnel.
// - Ollama nunca se expone: este servidor solo permite dos operaciones (entender una frase y describir una foto).
// - Sin claves: límite de uso por persona (por IP) y una cola corta; si está lleno, responde 503 y la app
//   sigue con lo que hay en el teléfono.
// - No guarda frases ni fotos: solo cuenta peticiones en memoria para los límites.
// Sin dependencias: Node 18+.  Uso:  node server/faro-server.mjs

import http from 'node:http';
import { pathToFileURL } from 'node:url';

const PORT = +(process.env.FARO_PORT || 8787);
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.FARO_MODEL || 'gemma3:4b';
const ORIGINS = (process.env.FARO_ORIGINS || 'https://miguelina12.github.io,http://localhost:8080,http://127.0.0.1:8080')
  .split(',').map((s) => s.trim()).filter(Boolean);

// Límites por persona (IP). Un portátil sin GPU atiende una petición cada vez.
export const LIMITS = {
  interpret: { perMin: 8, perDay: 300 },
  look: { perMin: 2, perDay: 60 },
};
const MAX_QUEUE = 3; // peticiones esperando; más allá, "ocupado"
const MAX_BODY = 1.5 * 1024 * 1024; // una foto JPEG de 1024 px cabe de sobra
const TIMEOUT = { interpret: 30000, look: 120000 };

export const ACTIONS = [
  'navigate', 'record_route', 'finish', 'save_place', 'describe', 'look', 'find', 'where', 'where_is', 'heading',
  'list', 'calibrate', 'steps', 'go_back', 'stop', 'help', 'time', 'torch_on', 'torch_off', 'progress',
  'download_map', 'sonar_on', 'sonar_off', 'faster', 'slower', 'none',
];

// Instrucciones cortas a propósito: en CPU cada token del prompt cuesta (~45 tokens/s) y Gemma 3 no
// reutiliza la caché entre peticiones.
const SYSTEM = `Eres Faro, asistente de voz de una app que guía a personas ciegas. Español cálido y breve (máx. 2 frases, se lee en voz alta).
La frase viene del reconocimiento de voz: interpreta lo que quiso decir. Responde SOLO con JSON {"accion","nombre","respuesta"}.
Acciones: ${ACTIONS.join(', ')}.
navigate=ir a un sitio (lugar guardado, calle y número, o tipo de sitio como farmacia); describe=qué hay delante;
look=mirar con detalle, leer carteles o texto, colores; find=buscar objeto; where_is=dónde está un lugar guardado;
save_place=guardar el sitio actual; record_route/finish=grabar ruta/terminarla; none=conversar o algo que la app no hace (responde tú).
"nombre" vacío si no aplica. Es ciego: nunca le preguntes qué ve. No inventes lugares ni obstáculos.
Si hay riesgo (cruzar, escaleras, tráfico) recuerda el bastón o el perro guía.
Ejemplos: "me apetece ir a la cocina"->{"accion":"navigate","nombre":"cocina","respuesta":""}
"qué pone ahí"->{"accion":"look","nombre":"","respuesta":""}
"habla más despacio"->{"accion":"slower","nombre":"","respuesta":""}
"apunta que aquí está la parada del 27"->{"accion":"save_place","nombre":"parada del 27","respuesta":""}
"estoy perdido"->{"accion":"where","nombre":"","respuesta":"Tranquilo, te digo dónde estás."}`;

const LOOK = `Eres los ojos de una persona ciega que lleva el móvil a la altura del pecho con la cámara hacia delante.
Háblale de tú, en español, frases cortas para oír en voz alta, sin listas ni símbolos.
Primero lo importante para moverse: obstáculos, escalones, puertas, por dónde pasar, con hora del reloj
(12 es justo delante, 3 a la derecha, 9 a la izquierda) y distancia en pasos. Si hay texto, léelo tal cual.
Describe solo lo que ves en ESTA foto, una vez. Solo si casi no se ve nada (negra, muy borrosa o tapada),
dilo en una frase y sugiere encender la linterna o apuntar más arriba. No inventes nada. Máximo 4 frases.`;

/** El estado de la app en texto compacto (menos tokens que el JSON). */
export function stateText(st) {
  if (!st || typeof st !== 'object') return '';
  const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 15).join(', ') : '');
  const parts = [];
  if (list(st.lugares)) parts.push('Lugares: ' + list(st.lugares));
  if (list(st.rutas)) parts.push('Rutas: ' + list(st.rutas));
  if (Array.isArray(st.delante) && st.delante.length) {
    parts.push('Delante: ' + st.delante.slice(0, 6).map((o) => [o?.objeto, o?.hora != null && `a las ${o.hora}`, o?.metros != null && `${o.metros} m`].filter(Boolean).join(' ')).join('; '));
  }
  for (const [k, label] of [['navegando', 'Navegando a'], ['grabando', 'Grabando ruta'], ['calle', 'Calle'], ['rumbo', 'Mira al'], ['hora', 'Hora']]) {
    if (st[k] != null && st[k] !== '') parts.push(label + ': ' + String(st[k]).slice(0, 80));
  }
  return parts.join('. ').slice(0, 1200);
}

// ------------------------------------------------------------------ límites por persona

export class RateLimiter {
  constructor(limits, now = () => Date.now()) {
    this.limits = limits;
    this.now = now;
    this.hits = new Map(); // `${kind}|${ip}` -> [timestamps del último día]
  }

  /** Devuelve 0 si se permite (y lo cuenta), o los segundos que hay que esperar. */
  take(kind, ip) {
    const lim = this.limits[kind];
    const t = this.now();
    const key = kind + '|' + ip;
    const list = (this.hits.get(key) || []).filter((x) => t - x < 86400000);
    const lastMin = list.filter((x) => t - x < 60000);
    if (list.length >= lim.perDay) { this.hits.set(key, list); return Math.ceil((list[0] + 86400000 - t) / 1000); }
    if (lastMin.length >= lim.perMin) { this.hits.set(key, list); return Math.ceil((lastMin[0] + 60000 - t) / 1000); }
    list.push(t);
    this.hits.set(key, list);
    return 0;
  }

  sweep() {
    const t = this.now();
    for (const [k, v] of this.hits) {
      const keep = v.filter((x) => t - x < 86400000);
      if (keep.length) this.hits.set(k, keep); else this.hits.delete(k);
    }
  }
}

// ------------------------------------------------------------------ cola: el modelo atiende de uno en uno

class Queue {
  constructor(max) { this.max = max; this.running = false; this.waiting = []; }
  get size() { return this.waiting.length + (this.running ? 1 : 0); }
  get full() { return this.waiting.length >= this.max; }
  run(fn) {
    if (this.waiting.length >= this.max) return Promise.reject(Object.assign(new Error('busy'), { status: 503 }));
    return new Promise((resolve, reject) => { this.waiting.push({ fn, resolve, reject }); this._next(); });
  }
  async _next() {
    if (this.running || !this.waiting.length) return;
    const { fn, resolve, reject } = this.waiting.shift();
    this.running = true;
    try { resolve(await fn()); } catch (e) { reject(e); } finally { this.running = false; this._next(); }
  }
}

// ------------------------------------------------------------------ validación de lo que llega

const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

export function cleanInterpret(body) {
  const utterance = str(body?.utterance, 400).trim();
  if (!utterance) return null;
  const state = stateText(body?.state);
  const history = (Array.isArray(body?.history) ? body.history : [])
    .slice(-8)
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m) => ({ role: m.role, content: m.content.slice(0, 600) }));
  return { utterance, state, history };
}

export function cleanLook(body) {
  const image = typeof body?.image === 'string' ? body.image.replace(/^data:image\/\w+;base64,/, '') : '';
  if (!image || image.length > MAX_BODY || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) return null;
  // JPEG: empieza por FF D8 ("/9j/" en base64)
  if (!image.startsWith('/9j/')) return null;
  const state = stateText({ calle: body?.state?.calle, rumbo: body?.state?.rumbo });
  return { image, question: str(body?.question, 300).trim(), state };
}

export function parseAnswer(text) {
  let j;
  try { j = JSON.parse(text); } catch {
    const m = String(text).match(/\{[\s\S]*\}/);
    try { j = m && JSON.parse(m[0]); } catch {}
  }
  if (!j) return { accion: 'none', nombre: '', respuesta: String(text || '').trim().slice(0, 400) };
  return {
    accion: ACTIONS.includes(j.accion) ? j.accion : 'none',
    nombre: str(j.nombre, 120).trim(),
    respuesta: str(j.respuesta, 500).trim(),
  };
}

// ------------------------------------------------------------------ llamadas a Ollama

// Sin "format": con él, Ollama no reutiliza la caché de las instrucciones y cada frase tarda ~10 s más
// en CPU. parseAnswer ya extrae el JSON aunque venga entre ```.
async function ollamaChat(messages, { timeout, maxTokens }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(OLLAMA + '/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: MODEL,
        messages,
        stream: false,
        keep_alive: -1, // que no se descargue de la memoria entre peticiones
        options: { temperature: 0.3, num_ctx: 4096, num_predict: maxTokens },
      }),
    });
    if (!res.ok) throw Object.assign(new Error('ollama ' + res.status), { status: 502 });
    const j = await res.json();
    return j?.message?.content || '';
  } catch (e) {
    if (e.name === 'AbortError') throw Object.assign(new Error('timeout'), { status: 504 });
    if (!e.status) e.status = 502;
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function interpret({ utterance, state, history }) {
  const text = await ollamaChat(
    [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: `${state ? state + '\n' : ''}Usuario: "${utterance}"` }],
    { timeout: TIMEOUT.interpret, maxTokens: 120 },
  );
  return { ...parseAnswer(text), raw: text.slice(0, 600) };
}

async function look({ image, question, state }) {
  const text = await ollamaChat(
    [
      { role: 'system', content: LOOK },
      { role: 'user', content: `${question ? `Pregunta: "${question}"\n` : 'Describe lo que hay delante.\n'}${state}`, images: [image] },
    ],
    { timeout: TIMEOUT.look, maxTokens: 220 },
  );
  return { texto: text.replace(/[*#_`]/g, '').trim() };
}

// ------------------------------------------------------------------ HTTP

function clientIp(req) {
  // Detrás de Cloudflare Tunnel la IP real viene en CF-Connecting-IP. Como solo escuchamos en
  // 127.0.0.1, nadie puede falsearla saltándose el túnel.
  return String(req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '?');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('too big'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

export function createServer({ limiter = new RateLimiter(LIMITS), queue = new Queue(MAX_QUEUE), ops = { interpret, look } } = {}) {
  const stats = { ok: 0, limited: 0, busy: 0, errors: 0, since: new Date().toISOString() };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin && ORIGINS.includes(origin);
    const send = (status, obj, extra = {}) => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        ...(allowed ? { 'access-control-allow-origin': origin, vary: 'Origin' } : {}),
        ...extra,
      });
      res.end(JSON.stringify(obj));
    };

    if (req.method === 'OPTIONS') {
      if (!allowed) return send(403, { error: 'origin' });
      res.writeHead(204, {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'GET, POST',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
        vary: 'Origin',
      });
      return res.end();
    }

    const path = (req.url || '').split('?')[0];
    if (req.method === 'GET' && path === '/v1/health') {
      return send(200, { ok: true, model: MODEL, queue: queue.size, limits: LIMITS });
    }

    const kind = req.method === 'POST' && { '/v1/interpret': 'interpret', '/v1/look': 'look' }[path];
    if (!kind) return send(404, { error: 'not_found' });
    // Solo la app de Faro (u otra web que añadas en FARO_ORIGINS) puede usarlo desde un navegador.
    if (!allowed) return send(403, { error: 'origin' });

    try {
      const body = await readBody(req);
      const input = kind === 'interpret' ? cleanInterpret(body) : cleanLook(body);
      if (!input) return send(400, { error: 'bad_request' });
      if (queue.full) { stats.busy++; return send(503, { error: 'busy' }); } // no gasta el cupo de la persona
      const wait = limiter.take(kind, clientIp(req));
      if (wait) { stats.limited++; return send(429, { error: 'limit', retry: wait }, { 'retry-after': String(wait) }); }
      const out = await queue.run(() => ops[kind](input));
      stats.ok++;
      return send(200, out);
    } catch (e) {
      const status = e.status || 500;
      if (status === 503) stats.busy++; else stats.errors++;
      return send(status, { error: { 503: 'busy', 504: 'timeout', 413: 'too_big', 400: 'bad_request' }[status] || 'server' });
    }
  });

  server.stats = stats;
  setInterval(() => limiter.sweep(), 3600000).unref();
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createServer();
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Faro: cerebro en http://127.0.0.1:${PORT} con ${MODEL} (Ollama en ${OLLAMA})`);
    console.log('Orígenes permitidos:', ORIGINS.join(', '));
  });
  // Resumen cada hora (sin contenido de las peticiones)
  setInterval(() => console.log(new Date().toISOString(), JSON.stringify(server.stats)), 3600000).unref();
  // Calentar el modelo para que la primera persona no espere la carga
  fetch(OLLAMA + '/api/chat', { method: 'POST', body: JSON.stringify({ model: MODEL, messages: [], keep_alive: -1 }) }).catch(() => {});
}
