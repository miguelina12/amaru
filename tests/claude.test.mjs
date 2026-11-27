import test from 'node:test';
import assert from 'node:assert/strict';
import { Claude, claudeProblem } from '../js/claude.js';

// Cliente falso: comprueba la petición y devuelve una respuesta como la de la API
function fake(reply, seen) {
  class APIError extends Error { constructor(status, m) { super(m); this.status = status; } }
  class AuthenticationError extends APIError {}
  class BadRequestError extends APIError {}
  class A {
    constructor(opts) { seen.opts = opts; }
    get beta() {
      return { messages: { create: async (req) => { seen.reqs.push(req); return reply(req); } } };
    }
  }
  Object.assign(A, { APIError, AuthenticationError, BadRequestError, PermissionDeniedError: class extends APIError {}, RateLimitError: class extends APIError {}, APIConnectionError: class extends Error {} });
  return A;
}

test('Claude: sin clave no está listo y lo dice', async () => {
  const c = new Claude(() => '');
  assert.equal(c.ready, false);
  await assert.rejects(c.interpret('hola', {}), (e) => e.code === 'nokey');
  assert.match(claudeProblem('nokey'), /clave/);
});

test('Claude: entiende una orden y recuerda la conversación', async () => {
  const seen = { reqs: [] };
  const c = new Claude(() => 'sk-ant-prueba');
  c.Anthropic = fake(() => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"accion":"navigate","nombre":"farmacia","respuesta":"Vamos."}' }] }), seen);
  const r = await c.interpret('me duele la cabeza, llévame a comprar algo', { lugares: [] });
  assert.deepEqual(r, { intent: 'navigate', name: 'farmacia', say: 'Vamos.' });
  const req = seen.reqs[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(seen.opts.apiKey, 'sk-ant-prueba');
  await c.interpret('¿y está abierta?', {});
  assert.equal(seen.reqs[1].messages.length, 3); // usuario, Claude, usuario
});

test('Claude: clave mala', async () => {
  const seen = { reqs: [] };
  const c = new Claude(() => 'sk-ant-mala');
  const A = fake(() => { throw new A.AuthenticationError(401, 'invalid x-api-key'); }, seen);
  c.Anthropic = A;
  await assert.rejects(c.interpret('hola', {}), (e) => e.code === 'badkey');
});
