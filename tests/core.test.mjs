import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseHeight, parseNumber, findBest } from '../js/intents.js';
import * as geo from '../js/geo.js';
import { RouteRecorder, reverseRoute, StepGuide } from '../js/navigator.js';
import { classFromSpanish } from '../js/labels.js';
import { parseReply } from '../js/brain.js';
import { Store } from '../js/store.js';

const P = (t) => parse(t);

test('órdenes de navegación', () => {
  assert.equal(P('Faro, qué hay delante').intent, 'describe');
  assert.equal(P('oye faro llévame a la cocina').name, 'cocina');
  assert.deepEqual([P('Llévame a la cocina').intent, P('Llévame a la cocina').name], ['navigate', 'cocina']);
  assert.equal(P('guíame hasta el baño por favor').name, 'baño');
  assert.equal(P('Llévame al salón').name, 'salón');
  assert.equal(P('quiero ir a casa de mi madre').name, 'casa de mi madre');
  assert.equal(P('vuelve a la entrada').intent, 'navigate');
  assert.equal(P('vuelve').intent, 'go_back');
  assert.equal(P('Faro, llévame al portal').name, 'portal');
});

test('grabar rutas y lugares', () => {
  const r = P('graba la ruta a la cocina');
  assert.equal(r.intent, 'record_route');
  assert.equal(r.name, 'cocina');
  assert.equal(P('aprende el camino hasta el dormitorio').name, 'dormitorio');
  assert.equal(P('graba una ruta').intent, 'record_route');
  assert.equal(P('graba una ruta').name, undefined);
  assert.equal(P('he llegado').intent, 'finish');
  assert.equal(P('guarda este lugar como portal').name, 'portal');
  assert.equal(P('esto es la cocina').intent, 'save_place');
  assert.equal(P('recuerda este sitio como parada del bus').name, 'parada del bus');
  assert.equal(P('borra la cocina').intent, 'delete');
});

test('visión, orientación y utilidades', () => {
  assert.equal(P('¿Qué hay delante?').intent, 'describe');
  assert.equal(P('qué ves').intent, 'describe');
  assert.equal(P('busca una silla').intent, 'find');
  assert.equal(P('busca una silla').name, 'silla');
  assert.equal(P('¿dónde estoy?').intent, 'where');
  assert.equal(P('dónde está la cocina').intent, 'where_is');
  assert.equal(P('hacia dónde miro').intent, 'heading');
  assert.equal(P('para').intent, 'stop');
  assert.equal(P('enciende la linterna').intent, 'torch_on');
  assert.equal(P('activa el sónar').intent, 'sonar_on');
  assert.equal(P('apaga la cámara').intent, 'camera_off');
  assert.equal(P('habla más despacio').intent, 'slower');
  assert.equal(P('qué hora es').intent, 'time');
  assert.equal(P('activa el modo inteligente').intent, 'brain_on');
  assert.equal(P('cómo tengo la cámara').intent, 'aim');
  assert.equal(P('blablabla xyz').intent, 'unknown');
});

test('calibración', () => {
  assert.equal(P('calibra mis pasos').intent, 'calibrate');
  assert.equal(P('calibra con diez metros').meters, 10);
  assert.equal(P('calibra con 15 metros').meters, 15);
  const h = P('mido uno setenta');
  assert.equal(h.intent, 'calibrate_height');
  assert.equal(h.cm, 170);
  assert.equal(parseHeight('mido 1,65'), 165);
  assert.equal(parseHeight('mido 182'), 182);
  assert.equal(parseHeight('un metro ochenta y cinco'), 185);
  assert.equal(parseNumber('treinta y cinco'), 35);
  assert.equal(parseNumber('ciento veinte'), 120);
});

test('búsqueda difusa de nombres', () => {
  const names = ['cocina', 'baño', 'dormitorio', 'portal', 'parada del bus'];
  assert.equal(findBest('la cosina', names), 'cocina');
  assert.equal(findBest('bano', names), 'baño');
  assert.equal(findBest('parada', names), 'parada del bus');
  assert.equal(findBest('supermercado', names), null);
});

test('geometría', () => {
  const a = { lat: 40.4168, lon: -3.7038 };
  const b = { lat: 40.4178, lon: -3.7038 };
  assert.ok(Math.abs(geo.haversine(a, b) - 111.2) < 1);
  assert.ok(Math.abs(geo.bearing(a, b)) < 0.5 || Math.abs(geo.bearing(a, b) - 360) < 0.5);
  assert.equal(geo.angleDiff(10, 350), 20);
  assert.equal(geo.angleDiff(350, 10), -20);
  assert.equal(geo.clockOf(0), 12);
  assert.equal(geo.clockOf(90), 3);
  assert.equal(geo.clockOf(-90), 9);
  assert.equal(geo.turnPhrase(100), 'gira a la derecha');
  assert.equal(geo.turnPhrase(-30), 'ligeramente a la izquierda');
  assert.equal(geo.cardinal(92), 'este');
  assert.equal(geo.distancePhrase(3.25, 0.65), '5 pasos');
});

test('grabar una ruta con un giro y recorrerla', () => {
  const rec = new RouteRecorder('cocina', 'salón');
  for (let i = 0; i < 6; i++) rec.addStep(0 + (i % 2 ? 5 : -5));
  for (let i = 0; i < 4; i++) rec.addStep(90);
  const r = rec.finish(0.7);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].steps, 6);
  assert.equal(r.segments[1].steps, 4);
  assert.ok(Math.abs(geo.angleDiff(r.segments[1].heading, 90)) < 1);

  const back = reverseRoute(r);
  assert.equal(back.name, 'salón');
  assert.ok(Math.abs(geo.angleDiff(back.segments[0].heading, 270)) < 1);

  const said = [];
  let heading = 0, arrived = null;
  const g = new StepGuide(r, {
    say: (t) => said.push(t),
    cue: { ok() {}, turn() {}, arrive() {} },
    heading: () => heading,
    stepLength: () => 0.7,
    onArrive: (n) => { arrived = n; },
  });
  g.start();
  assert.equal(g.phase, 'walk');
  for (let i = 0; i < 6; i++) g.onStep();
  assert.equal(g.phase, 'turn');
  assert.ok(said.some((t) => /gira a la derecha/.test(t)));
  heading = 88;
  g.onHeading(heading);
  assert.equal(g.phase, 'walk');
  for (let i = 0; i < 4; i++) g.onStep();
  assert.equal(arrived, 'cocina');
});

test('reconocer nombres de objetos', () => {
  assert.equal(classFromSpanish('una silla'), 'chair');
  assert.equal(classFromSpanish('el sofá'), 'couch');
  assert.equal(classFromSpanish('coche'), 'car');
  assert.equal(classFromSpanish('frigorífico'), 'refrigerator');
  assert.equal(classFromSpanish('puerta'), null);
});

test('respuesta del modo inteligente', () => {
  const r = parseReply('Claro: {"accion":"navigate","nombre":"cocina","respuesta":"Vamos a la cocina."}');
  assert.deepEqual(r, { intent: 'navigate', name: 'cocina', say: 'Vamos a la cocina.' });
  assert.equal(parseReply('{"accion":"volar"}').intent, 'none');
});

test('memoria local', () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = new Store(storage);
  s.savePlace({ name: 'portal', lat: 1, lon: 2 });
  s.settings.stepLength = 0.71;
  s.save();
  const s2 = new Store(storage);
  assert.equal(s2.place('portal').lat, 1);
  assert.equal(s2.settings.stepLength, 0.71);
  assert.ok(s2.remove('portal'));
});
