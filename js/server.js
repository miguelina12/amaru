// Cerebro de Faro por internet: un modelo abierto (Gemma 3) en el ordenador de quien mantiene Faro.
// Sin claves ni cuentas. Lo que las reglas del teléfono no entienden se envía a ese servidor; las fotos solo
// cuando la persona dice "mira bien" o "léeme el cartel". Si el servidor no responde, Faro sigue con lo que
// hay en el teléfono. Se puede desactivar en Ajustes.
//
// La dirección del servidor cambia cuando se reinicia, así que se lee de server.json (publicado junto a la app).

export const SERVER_ACTIONS = [
  'navigate', 'record_route', 'finish', 'save_place', 'describe', 'look', 'find', 'where', 'where_is', 'heading',
  'list', 'calibrate', 'steps', 'go_back', 'stop', 'help', 'time', 'torch_on', 'torch_off', 'progress',
  'download_map', 'sonar_on', 'sonar_off', 'faster', 'slower', 'none',
];

const TIMEOUT = { interpret: 30000, look: 100000 };
const RETRY_AFTER = 60000; // tras un fallo, no insistimos durante un minuto (para no hacer esperar a nadie)

export class BrainServer {
  /**
   * enabled: función que dice si la persona lo tiene activado.
   * fetchFn / configUrl: inyectables para las pruebas.
   */
  constructor(enabled, { fetchFn = (...a) => fetch(...a), configUrl = new URL('../server.json', import.meta.url).href, now = () => Date.now() } = {}) {
    this.enabled = enabled;
    this.fetch = fetchFn;
    this.configUrl = configUrl;
    this.now = now;
    this.url = null;
    this.downUntil = 0;
    this.history = [];
  }

  get online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  /** Merece la pena preguntarle ahora (activado, con internet y sin un fallo reciente). */
  get usable() { return !!this.enabled() && this.online && this.now() >= this.downUntil; }

  async _base(force = false) {
    if (this.url && !force) return this.url;
    const res = await this.fetch(this.configUrl, { cache: 'no-store' });
    if (!res.ok) throw new ServerError('nourl');
    const j = await res.json();
    if (!j?.url || !/^https:\/\//.test(j.url)) throw new ServerError('nourl');
    this.url = j.url.replace(/\/+$/, '');
    return this.url;
  }

  async _post(path, body, timeout) {
    let base;
    try { base = await this._base(); } catch (e) { throw this._down(e instanceof ServerError ? e : new ServerError('nourl')); }
    const call = async (b) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeout);
      try {
        return await this.fetch(b + path, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
        });
      } finally { clearTimeout(t); }
    };
    let res;
    try {
      res = await call(base);
    } catch (e) {
      if (e?.name === 'AbortError') throw this._down(new ServerError('timeout'));
      // Puede que el servidor se haya reiniciado con otra dirección: la releemos una vez
      try {
        const fresh = await this._base(true);
        if (fresh === base) throw e;
        res = await call(fresh);
      } catch (e2) {
        throw this._down(new ServerError(e2?.name === 'AbortError' ? 'timeout' : 'down'));
      }
    }
    if (res.status === 429) throw new ServerError('limit'); // límite de la persona: no marca el servidor como caído
    if (res.status === 503) throw this._down(new ServerError('busy'), 20000);
    if (!res.ok) throw this._down(new ServerError('down'));
    return res.json();
  }

  _down(err, ms = RETRY_AFTER) {
    this.downUntil = this.now() + ms;
    return err;
  }

  /** Interpreta una frase. Devuelve { intent, name, say }. */
  async interpret(utterance, state) {
    const j = await this._post('/v1/interpret', { utterance, state, history: this.history }, TIMEOUT.interpret);
    const intent = SERVER_ACTIONS.includes(j?.accion) ? j.accion : 'none';
    const name = (j?.nombre || '').trim() || undefined;
    const say = (j?.respuesta || '').trim() || undefined;
    this.history.push({ role: 'user', content: `Usuario: "${utterance}"` }, { role: 'assistant', content: JSON.stringify({ accion: intent, nombre: name || '', respuesta: say || '' }) });
    this.history = this.history.slice(-8);
    return { intent, name, say };
  }

  /** Describe una foto (JPEG en base64). */
  async look(jpegBase64, question, state) {
    const j = await this._post('/v1/look', { image: jpegBase64, question, state }, TIMEOUT.look);
    return (j?.texto || '').trim();
  }
}

export class ServerError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Frase para decir en voz alta cuando el servidor no está disponible. */
export function serverProblem(code) {
  return {
    limit: 'Has usado mucho el servidor de Faro en poco tiempo. Espera un poco. Mientras, te entiendo con lo que hay en el teléfono.',
    busy: 'El servidor de Faro está ocupado. Te entiendo con lo que hay en el teléfono.',
    timeout: 'El servidor de Faro tarda demasiado. Sigo con lo que hay en el teléfono.',
    offline: 'No hay internet. Te entiendo con lo que hay en el teléfono.',
    off: 'El servidor de Faro está desactivado en Ajustes.',
  }[code] || 'El servidor de Faro no responde ahora. Sigo con lo que hay en el teléfono.';
}

export const PRIVACY_NOTE = 'Aviso: cuando no entiendo una frase, la envío al servidor de Faro, un ordenador de quien mantiene la app, ' +
  'con los nombres de tus lugares y la calle si la sé; y si dices "mira bien", también una foto de la cámara. Viajan cifradas a través de Cloudflare y el servidor no las guarda. Puedes desactivarlo en Ajustes.';
