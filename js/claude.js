// Claude por internet (opcional): solo si pones tu clave de API de Anthropic en Ajustes.
// Sin clave o sin conexión, Faro sigue funcionando dentro del teléfono como siempre.
// La clave se guarda solo en este teléfono y se envía únicamente a api.anthropic.com.

// SDK oficial de Anthropic (v1.4.0) empaquetado para el navegador dentro de la app
const SDK = new URL('./vendor/anthropic-sdk-1.4.0.mjs', import.meta.url).href;
const MODEL = 'claude-opus-5-5';
const MAX_TURNS = 20; // al llegar aquí empezamos conversación nueva (no recortamos el historial)

export const CLAUDE_ACTIONS = [
  'navigate', 'record_route', 'finish', 'save_place', 'describe', 'look', 'find', 'where', 'where_is', 'heading',
  'list', 'calibrate', 'steps', 'go_back', 'stop', 'help', 'time', 'torch_on', 'torch_off', 'progress',
  'download_map', 'sonar_on', 'sonar_off', 'faster', 'slower', 'none',
];

const SYSTEM = `Eres Faro, el asistente de voz de una app que guía a personas ciegas por casa y por la calle.
Hablas español de forma cálida, natural y breve: tus respuestas se leen en voz alta, así que usa frases cortas,
sin listas, sin símbolos ni emojis, y como mucho 3 frases salvo que te pidan más detalle.

En cada turno recibes el estado de la app (lugares y rutas guardados, objetos que ve la cámara con su distancia,
la calle si se sabe, rumbo, pasos, si está navegando) y lo que ha dicho el usuario, transcrito por voz
(puede tener errores de reconocimiento: interpreta lo que quiso decir).

Decide una acción de la app y lo que vas a decir:
- Ir a un sitio (lugar guardado, calle con número, o tipo de sitio como "farmacia"): "navigate" con "nombre".
- Qué hay delante (lista rápida de objetos): "describe". Descripción detallada, leer un texto o un cartel, colores, "mira bien": "look".
- Buscar un objeto: "find" con "nombre". Dónde está un lugar guardado: "where_is" con "nombre".
- Grabar una ruta: "record_route" con "nombre"; terminarla: "finish". Guardar el sitio actual: "save_place" con "nombre".
- Otras órdenes de la app: usa la acción que corresponda de la lista.
- Conversación, preguntas generales, consejos de orientación y movilidad, o algo que la app no hace: "none" y responde tú.
Si la acción ejecuta algo, "respuesta" puede ir vacía (la app ya lo anuncia) o ser una frase corta de contexto.
Nunca inventes obstáculos, lugares ni distancias: usa solo los del estado. Ante cualquier duda de seguridad
(cruzar una calle, escaleras, tráfico), recuerda con naturalidad usar el bastón o el perro guía y escuchar el tráfico.`;

const SCHEMA = {
  type: 'object',
  properties: {
    accion: { type: 'string', enum: CLAUDE_ACTIONS },
    nombre: { type: 'string' },
    respuesta: { type: 'string' },
  },
  required: ['accion', 'nombre', 'respuesta'],
  additionalProperties: false,
};

const LOOK = `Eres los ojos de una persona ciega que lleva el móvil a la altura del pecho, con la cámara hacia delante.
Describe la foto en español, para oírla en voz alta: frases cortas, sin listas ni símbolos.
Primero lo importante para moverse con seguridad (obstáculos, escalones, puertas, por dónde se puede pasar,
con posición en horas del reloj y distancia aproximada en pasos). Después lo demás que sea útil.
Si hay texto legible (carteles, etiquetas, pantallas), léelo. Si la foto está borrosa, oscura o tapada, dilo y
explica cómo mover el teléfono. No inventes nada que no se vea. Máximo 5 frases salvo que te pregunten algo concreto.`;

export class Claude {
  /** getKey: función que devuelve la clave guardada (o vacío). */
  constructor(getKey) {
    this.getKey = getKey;
    this.client = null;
    this.key = null;
    this.Anthropic = null;
    this.history = [];
  }

  get hasKey() { return !!(this.getKey() || '').trim(); }
  get online() { return typeof navigator === 'undefined' || navigator.onLine !== false; }
  /** Listo para usarse ahora mismo: hay clave y hay conexión. */
  get ready() { return this.hasKey && this.online; }

  async _client() {
    const key = (this.getKey() || '').trim();
    if (!key) throw new ClaudeError('nokey');
    if (!this.client || this.key !== key) {
      if (!this.Anthropic) this.Anthropic = (await import(/* @vite-ignore */ SDK)).default;
      // La app corre en el navegador del propio usuario con su propia clave.
      this.client = new this.Anthropic({ apiKey: key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 30000 });
      this.key = key;
      this.history = [];
    }
    return this.client;
  }

  /** Interpreta una frase. Devuelve { intent, name, say }. */
  async interpret(utterance, state) {
    const client = await this._client();
    if (this.history.length >= MAX_TURNS * 2) this.history = [];
    const user = { role: 'user', content: `Estado: ${JSON.stringify(state)}\nUsuario: "${utterance}"` };
    let res;
    try {
      res = await this._send(client, [...this.history, user]);
    } catch (e) {
      // Si el historial da problemas, probamos una vez con conversación nueva
      if (this.history.length && e instanceof this.Anthropic.BadRequestError) {
        this.history = [];
        res = await this._send(client, [user]);
      } else throw this._wrap(e);
    }
    if (res.stop_reason === 'refusal') return { intent: 'none', say: 'Eso no puedo hacerlo. ¿Te ayudo con otra cosa?' };
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    this.history.push(user, { role: 'assistant', content: res.content });
    let j;
    try { j = JSON.parse(text); } catch { return { intent: 'none', say: text.slice(0, 400) }; }
    const intent = CLAUDE_ACTIONS.includes(j.accion) ? j.accion : 'none';
    return { intent, name: (j.nombre || '').trim() || undefined, say: (j.respuesta || '').trim() || undefined };
  }

  _send(client, messages) {
    return client.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      system: SYSTEM,
      messages,
    });
  }

  /** Describe una foto (JPEG en base64). question: lo que ha preguntado el usuario, si algo. */
  async look(jpegBase64, question, state) {
    const client = await this._client();
    let res;
    try {
      res = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 2048,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: { effort: 'low' },
        system: LOOK,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
            { type: 'text', text: `${question ? `Pregunta: "${question}"\n` : ''}Datos del teléfono: ${JSON.stringify(state)}` },
          ],
        }],
      });
    } catch (e) {
      throw this._wrap(e);
    }
    if (res.stop_reason === 'refusal') return 'No puedo describir esta imagen.';
    return res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
  }

  _wrap(e) {
    const A = this.Anthropic;
    if (e instanceof ClaudeError) return e;
    if (A && e instanceof A.AuthenticationError) return new ClaudeError('badkey');
    if (A && e instanceof A.PermissionDeniedError) return new ClaudeError('badkey');
    if (A && e instanceof A.RateLimitError) return new ClaudeError('busy');
    if (A && e instanceof A.APIConnectionError) return new ClaudeError('offline');
    if (A && e instanceof A.APIError && e.status === 402) return new ClaudeError('credit');
    if (A && e instanceof A.APIError && /credit|billing/i.test(e.message)) return new ClaudeError('credit');
    return new ClaudeError('other', e);
  }
}

export class ClaudeError extends Error {
  constructor(code, cause) {
    super(code);
    this.code = code;
    this.cause = cause;
  }
}

/** Frase para decir en voz alta cuando Claude no está disponible. */
export function claudeProblem(code) {
  return {
    nokey: 'Para que te entienda Claude, pon tu clave de API de Anthropic en Ajustes. Mientras tanto te entiendo con lo que hay en el teléfono.',
    badkey: 'Tu clave de Claude no es válida. Revísala en Ajustes. Mientras tanto te entiendo con lo que hay en el teléfono.',
    credit: 'Tu cuenta de Claude no tiene saldo. Mientras tanto te entiendo con lo que hay en el teléfono.',
    busy: 'Claude está ocupado ahora mismo. Inténtalo en un momento.',
    offline: 'No hay internet, así que no puedo usar a Claude. Te entiendo con lo que hay en el teléfono.',
    other: 'Claude no ha respondido. Te entiendo con lo que hay en el teléfono.',
  }[code] || 'Claude no ha respondido.';
}
