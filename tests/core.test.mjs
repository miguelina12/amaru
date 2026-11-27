import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, parseHeight, parseNumber, findBest } from '../js/intents.js';
import * as geo from '../js/geo.js';
import { RouteRecorder, reverseRoute, StepGuide } from '../js/navigator.js';
import { classFromSpanish, pluralName, indef } from '../js/labels.js';
import { Safety } from '../js/safety.js';
import { decode, nms } from '../js/detector.js';
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
  assert.equal(classFromSpanish('el sofá'), 'sofa');
  assert.equal(classFromSpanish('coche'), 'car');
  assert.equal(classFromSpanish('frigorífico'), 'refrigerator');
  assert.equal(classFromSpanish('la puerta corrediza'), 'sliding door');
  assert.equal(classFromSpanish('el inodoro'), 'toilet');
  assert.equal(classFromSpanish('una paloma'), 'pigeon');
  assert.equal(classFromSpanish('puerta'), 'door');
  assert.equal(classFromSpanish('las escaleras'), 'stairs');
  assert.equal(classFromSpanish('ornitorrinco'), null);
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

test('plurales y artículos', () => {
  assert.equal(pluralName('truck'), 'camiones');
  assert.equal(pluralName('bus'), 'autobuses');
  assert.equal(indef('stairs'), 'unas escaleras');
});

function mkSafety(walking = true) {
  const said = [];
  const s = new Safety({
    say: (t) => said.push(t), cue: { danger() {}, warn() {} }, sonar: { update() {} },
    walking: () => walking, stepLength: () => 0.7, navigating: () => false,
  });
  return { s, said };
}
const obj = (cls, dist, extra = {}) => ({ cls, dist, angle: 0, clock: 12, inPath: true, obstacle: true, lateral: 0, ...extra });

test('no repite el mismo aviso (anti-spam)', async () => {
  const { s, said } = mkSafety();
  for (let i = 0; i < 20; i++) { s.onDetections([obj('chair', 2.0)]); await new Promise((r) => setTimeout(r, 20)); }
  assert.equal(said.length, 1);
  assert.match(said[0], /Silla delante, a 3 pasos/);
});

test('un objeto visto en una sola imagen no genera aviso', () => {
  const { s, said } = mkSafety();
  s.onDetections([obj('person', 1.0)]);
  s.onDetections([]);
  assert.equal(said.length, 0);
});

test('parado no avisa de objetos quietos', () => {
  const { s, said } = mkSafety(false);
  for (let i = 0; i < 6; i++) s.onDetections([obj('chair', 1.0)]);
  assert.equal(said.length, 0);
});

test('peligro y escaleras', () => {
  const a = mkSafety();
  for (let i = 0; i < 4; i++) a.s.onDetections([obj('person', 0.9)]);
  assert.equal(a.said.length, 1);
  assert.match(a.said[0], /Alto! Persona/);
  const b = mkSafety();
  for (let i = 0; i < 4; i++) b.s.onDetections([obj('stairs', 3.0)]);
  assert.match(b.said[0], /escaleras delante/);
  const c = mkSafety();
  for (let i = 0; i < 4; i++) c.s.onDetections([obj('door', 2.0)]);
  assert.match(c.said[0], /^Puerta delante/);
});

test('decodificar YOLO y NMS', () => {
  // 2 clases, 3 anclas; formato [4 + C, N]
  const N = 3, C = 2;
  const out = new Float32Array((4 + C) * N);
  const set = (row, i, v) => { out[row * N + i] = v; };
  // ancla 0: puerta (clase 1) 0.9 ; ancla 1: casi igual 0.7 ; ancla 2: persona (clase 0) 0.2
  [[100, 100, 50, 100], [102, 101, 50, 100], [300, 300, 40, 40]].forEach(([cx, cy, w, h], i) => {
    set(0, i, cx); set(1, i, cy); set(2, i, w); set(3, i, h);
  });
  set(5, 0, 0.9); set(5, 1, 0.7); set(4, 2, 0.2);
  const wanted = new Map([[0, 'Person'], [1, 'door']]);
  const dets = nms(decode(out, C, N, wanted, 0.3, { scale: 0.5, dx: 0, dy: 0 }));
  assert.equal(dets.length, 1);
  assert.equal(dets[0].class, 'door');
  assert.deepEqual(dets[0].bbox, [150, 100, 100, 200]);
});

test('paso de peatones se anuncia una vez', () => {
  const { s, said } = mkSafety();
  for (let i = 0; i < 8; i++) s.onDetections([obj('crosswalk', 5, { obstacle: false, inPath: false })]);
  assert.deepEqual(said, ['Paso de peatones delante.']);
});

import { implausible } from '../js/plausibility.js';

test('sentido común: un coche aparcado no "viene hacia ti" cuando eres tú quien camina', async () => {
  const said = [];
  const s = new Safety({
    say: (t) => said.push(t), cue: { danger() {}, warn() {} }, sonar: { update() {} },
    walking: () => true, speed: () => 1.2, stepLength: () => 0.7, navigating: () => false,
  });
  // caminas a 1,2 m/s hacia un coche quieto: la distancia baja 1,2 m cada segundo
  let d = 7;
  for (let i = 0; i < 12; i++) {
    s.onDetections([obj('car', d)]);
    await new Promise((r) => setTimeout(r, 100));
    d -= 0.12;
  }
  assert.ok(!said.some((t) => /viene hacia ti/.test(t)), said.join(' | '));
  assert.ok(said.some((t) => /Coche parado delante/.test(t)), said.join(' | '));
});

test('sentido común: un coche que sí viene hacia ti', async () => {
  const said = [];
  const s = new Safety({
    say: (t) => said.push(t), cue: { danger() {}, warn() {} }, sonar: { update() {} },
    walking: () => false, speed: () => 0, stepLength: () => 0.7, navigating: () => false,
  });
  let d = 7;
  for (let i = 0; i < 10; i++) { s.onDetections([obj('car', d)]); await new Promise((r) => setTimeout(r, 100)); d -= 0.3; }
  assert.ok(said.some((t) => /viene hacia ti/.test(t)), said.join(' | '));
});

test('sentido común: una puerta nunca "viene hacia ti"', async () => {
  const said = [];
  const s = new Safety({
    say: (t) => said.push(t), cue: { danger() {}, warn() {} }, sonar: { update() {} },
    walking: () => false, speed: () => 0, stepLength: () => 0.7, navigating: () => false,
  });
  let d = 6;
  for (let i = 0; i < 10; i++) { s.onDetections([obj('door', d)]); await new Promise((r) => setTimeout(r, 100)); d -= 0.4; }
  assert.ok(!said.some((t) => /viene hacia ti/.test(t)));
});

test('filtro de sentido común', () => {
  const base = { score: 0.9, est: {}, clipped: {}, pxW: 100, pxH: 300 };
  assert.equal(implausible({ ...base, cls: 'person' }), null);
  assert.equal(implausible({ ...base, cls: 'person', pxW: 400, pxH: 200 }), 'forma no humana');
  assert.equal(implausible({ ...base, cls: 'person', score: 0.4 }), 'poca seguridad');
  assert.equal(implausible({ ...base, cls: 'car', score: 0.6 }, 'indoor'), 'no encaja dentro de casa');
  assert.equal(implausible({ ...base, cls: 'bed', score: 0.6 }, 'outdoor'), 'no encaja en la calle');
  assert.equal(implausible({ ...base, cls: 'chair', est: { byH: 1, byW: 4 } }), 'proporciones imposibles');
  assert.equal(implausible({ ...base, cls: 'person', est: { ground: 3 }, realH: 0.3 }), 'tamaño imposible');
});

import { merge } from '../js/detector.js';
import { group } from '../js/labels.js';

test('el especialista de casa manda cuando los dos ven lo mismo', () => {
  const general = [{ class: 'wooden door', score: 0.6, bbox: [0, 0, 100, 200] }, { class: 'dog', score: 0.8, bbox: [300, 300, 50, 50] }];
  const casa = [{ class: 'door', score: 0.5, bbox: [5, 5, 100, 200] }];
  const out = merge(general, casa, group);
  assert.equal(out.length, 2);
  assert.equal(out.find((d) => group(d.class) === 'puerta').source, 'casa');
});

test('sentido común con animales: "gato o perro", no "mapache"', () => {
  // puntuaciones reales del detector en la foto de un samoyedo
  const names = ['cat', 'raccoon', 'dog', 'person'];
  const N = 1, out = new Float32Array((4 + names.length) * N);
  out.set([100, 100, 80, 80], 0);
  out[4] = 0.66; out[5] = 0.51; out[6] = 0.33; out[7] = 0.01;
  const wanted = new Map(names.map((n, i) => [i, n]));
  const prior = Float32Array.from(names, (n) => (n === 'raccoon' ? 0.6 : 1));
  const groupIdx = [0, 1, 2, 3];
  const [d] = decode(out, names.length, N, wanted, 0.3, { scale: 1, dx: 0, dy: 0 }, groupIdx, prior);
  assert.equal(d.class, 'cat');
  assert.equal(d.alt, 'dog');
});
