// "Modo inteligente": un modelo de lenguaje que se ejecuta DENTRO del teléfono (WebLLM + WebGPU).
// No llama a ninguna API: se descarga una vez y después funciona sin conexión.
// Se usa para entender frases que las reglas no reconocen y para conversar.

const WEBLLM = 'https://esm.run/@mlc-ai/web-llm';
const MODELS = ['Qwen2.5-1.5B-Instruct-q4f16_1-MLC', 'Llama-3.2-1B-Instruct-q4f16_1-MLC'];

export const ACTIONS = [
  'navigate', 'record_route', 'finish', 'save_place', 'describe', 'find', 'where', 'where_is', 'heading',
  'list', 'calibrate', 'steps', 'go_back', 'stop', 'help', 'time', 'torch_on', 'torch_off', 'progress', 'download_map', 'none',
];

const SYSTEM = `Eres Faro, el asistente de una app de guiado para personas ciegas. Hablas español, con frases cortas, cálidas y claras.
Recibes el estado de la app y lo que dice el usuario. Responde SOLO con un JSON:
{"accion": una de ${JSON.stringify(ACTIONS)}, "nombre": "lugar u objeto si aplica, si no vacío", "respuesta": "lo que dirás en voz alta (máx. 2 frases)"}
Reglas:
- Si el usuario quiere ir a un sitio (lugar guardado, calle con número, o tipo de sitio como farmacia): accion "navigate" con "nombre" (por ejemplo "calle Mayor 5" o "farmacia").
- Si pregunta qué hay delante: "describe". Si busca un objeto: "find".
- Si pide algo que la app no puede hacer, accion "none" y explícalo con amabilidad.
- Nunca inventes obstáculos ni lugares: usa solo los del estado.
- La seguridad es lo primero: recuerda usar el bastón si hay duda.`;

export class Brain {
  constructor() {
    this.engine = null;
    this.loading = false;
    this.model = null;
  }

  static get supported() {
    return typeof navigator !== 'undefined' && !!navigator.gpu;
  }

  get ready() {
    return !!this.engine;
  }

  async load(onProgress) {
    if (this.engine || this.loading) return;
    this.loading = true;
    try {
      const webllm = await import(/* @vite-ignore */ WEBLLM);
      let lastErr;
      for (const m of MODELS) {
        try {
          this.engine = await webllm.CreateMLCEngine(m, {
            initProgressCallback: (r) => onProgress?.(r.progress ?? 0, r.text || ''),
          });
          this.model = m;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (!this.engine) throw lastErr || new Error('No se pudo cargar el modelo');
    } finally {
      this.loading = false;
    }
  }

  async interpret(utterance, state) {
    if (!this.engine) return null;
    const reply = await this.engine.chat.completions.create({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `Estado: ${JSON.stringify(state)}\nUsuario: "${utterance}"` },
      ],
      temperature: 0.2,
      max_tokens: 160,
    });
    const text = reply?.choices?.[0]?.message?.content || '';
    return parseReply(text);
  }
}

export function parseReply(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return text.trim() ? { intent: 'none', say: text.trim().slice(0, 300) } : null;
  try {
    const j = JSON.parse(m[0]);
    const intent = ACTIONS.includes(j.accion) ? j.accion : 'none';
    return { intent, name: (j.nombre || '').trim() || undefined, say: (j.respuesta || '').trim() || undefined };
  } catch {
    return null;
  }
}
