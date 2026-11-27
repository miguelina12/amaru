import test from 'node:test';
import assert from 'node:assert/strict';
import { BrainServer, serverProblem } from '../js/server.js';
import { parse } from '../js/intents.js';
import { RateLimiter, parseAnswer, stateText, cleanLook, cleanInterpret, createServer } from '../server/faro-server.mjs';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push(url);
    const r = routes[url];
    if (!r) throw new TypeError('Failed to fetch');
    return typeof r === 'function' ? r(opts) : r;
  };
  fn.calls = calls;
  return fn;
}

test('el cliente lee la dirección de server.json y entiende la respuesta', async () => {
  const f = fakeFetch({
    'cfg': json(200, { url: 'https://a.trycloudflare.com/' }),
    'https://a.trycloudflare.com/v1/interpret': json(200, { accion: 'navigate', nombre: 'farmacia', respuesta: '' }),
  });
  const s = new BrainServer(() => true, { fetchFn: f, configUrl: 'cfg' });
  const r = await s.interpret('necesito ibuprofeno', {});
  assert.deepEqual(r, { intent: 'navigate', name: 'farmacia', say: undefined });
  assert.equal(s.history.length, 2);
});

test('acción desconocida del modelo se trata como conversación', async () => {
  const f = fakeFetch({ cfg: json(200, { url: 'https://a.x' }), 'https://a.x/v1/interpret': json(200, { accion: 'borrar_todo', respuesta: 'Hola' }) });
  const r = await new BrainServer(() => true, { fetchFn: f, configUrl: 'cfg' }).interpret('hola', {});
  assert.equal(r.intent, 'none');
  assert.equal(r.say, 'Hola');
});

test('si el servidor cae, falla rápido y no se vuelve a intentar durante un rato', async () => {
  let t = 0;
  const f = fakeFetch({ cfg: json(200, { url: 'https://a.x' }) }); // /v1/interpret no existe: error de red
  const s = new BrainServer(() => true, { fetchFn: f, configUrl: 'cfg', now: () => t });
  await assert.rejects(s.interpret('hola', {}), (e) => e.code === 'down');
  assert.equal(s.usable, false);
  t = 61000;
  assert.equal(s.usable, true);
});

test('si cambia la dirección del túnel, la relee y sigue', async () => {
  let cfg = 'https://viejo.x';
  const f = fakeFetch({
    cfg: () => json(200, { url: cfg }),
    'https://nuevo.x/v1/interpret': json(200, { accion: 'time', nombre: '', respuesta: '' }),
  });
  const s = new BrainServer(() => true, { fetchFn: f, configUrl: 'cfg' });
  await s._base();
  cfg = 'https://nuevo.x';
  const r = await s.interpret('qué hora es', {});
  assert.equal(r.intent, 'time');
});

test('límite por persona y ocupado no tumban el cliente', async () => {
  const f = fakeFetch({ cfg: json(200, { url: 'https://a.x' }), 'https://a.x/v1/interpret': json(429, { error: 'limit' }) });
  const s = new BrainServer(() => true, { fetchFn: f, configUrl: 'cfg' });
  await assert.rejects(s.interpret('hola', {}), (e) => e.code === 'limit');
  assert.equal(s.usable, true); // el límite es de la persona, no del servidor
  assert.match(serverProblem('limit'), /teléfono/);
});

test('desactivado en Ajustes: no se usa', () => {
  const s = new BrainServer(() => false, { fetchFn: fakeFetch({}), configUrl: 'cfg' });
  assert.equal(s.usable, false);
});

test('órdenes nuevas: mirar con detalle y servidor', () => {
  assert.equal(parse('mira bien').intent, 'look');
  assert.equal(parse('qué pone en ese cartel').intent, 'look');
  assert.equal(parse('léeme la etiqueta').intent, 'look');
  assert.equal(parse('qué hay delante').intent, 'describe');
  assert.equal(parse('desactiva el servidor').intent, 'server_off');
  assert.equal(parse('activa el servidor').intent, 'server_on');
});

test('servidor: límite por minuto y por día', () => {
  let t = 0;
  const l = new RateLimiter({ interpret: { perMin: 2, perDay: 3 } }, () => t);
  assert.equal(l.take('interpret', 'a'), 0);
  assert.equal(l.take('interpret', 'a'), 0);
  assert.ok(l.take('interpret', 'a') > 0);
  assert.equal(l.take('interpret', 'b'), 0); // otra persona no se ve afectada
  t = 61000;
  assert.equal(l.take('interpret', 'a'), 0);
  t = 130000;
  assert.ok(l.take('interpret', 'a') > 3600); // cupo diario agotado
});

test('servidor: entiende JSON con o sin ``` y valida la acción', () => {
  assert.deepEqual(parseAnswer('```json\n{"accion": "find", "nombre": "silla"}\n```'), { accion: 'find', nombre: 'silla', respuesta: '' });
  assert.equal(parseAnswer('{"accion":"rm -rf"}').accion, 'none');
  assert.equal(parseAnswer('Hola, ¿qué tal?').respuesta, 'Hola, ¿qué tal?');
});

test('servidor: estado compacto y validación de entrada', () => {
  const s = stateText({ lugares: ['cocina'], delante: [{ objeto: 'silla', hora: 12, metros: 1.8 }], navegando: null, calle: 'calle Mayor' });
  assert.equal(s, 'Lugares: cocina. Delante: silla a las 12 1.8 m. Calle: calle Mayor');
  assert.equal(cleanInterpret({ utterance: '  ' }), null);
  assert.equal(cleanInterpret({ utterance: 'hola', history: [{ role: 'system', content: 'x' }] }).history.length, 0);
  assert.equal(cleanLook({ image: 'iVBORw0KGgo' }), null); // PNG no, solo JPEG
  assert.ok(cleanLook({ image: '/9j/4AAQSkZJRg' }));
});

test('servidor HTTP: origen, rutas, límite y ocupado', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const server = createServer({
    limiter: new RateLimiter({ interpret: { perMin: 3, perDay: 100 }, look: { perMin: 1, perDay: 10 } }),
    ops: { interpret: async () => { await gate; return { accion: 'none', nombre: '', respuesta: 'ok' }; }, look: async () => ({ texto: 'ok' }) },
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, origin = 'http://localhost:8080') => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/v1/interpret', { utterance: 'hola' }, 'https://otra.web')).status, 403);
    assert.equal((await post('/api/generate', {})).status, 404);
    const pending = [1, 2, 3].map(() => post('/v1/interpret', { utterance: 'hola' }));
    await new Promise((r) => setTimeout(r, 50));
    assert.equal((await post('/v1/interpret', { utterance: 'hola' })).status, 429);
    release();
    const done = await Promise.all(pending);
    assert.deepEqual(done.map((r) => r.status), [200, 200, 200]);
  } finally {
    server.close();
  }
});
