import test from 'node:test';
import assert from 'node:assert/strict';
import { compact, MapData, MapGuide, parseAddress, streetKey, withArticle, buildQuery } from '../js/map.js';
import { parse } from '../js/intents.js';

// Barrio de prueba (formato Overpass):
//
//            4 (Calle Luna 2)
//            |
//  1 ------- 2 ------- 3   Calle Mayor (oeste -> este); 3 tiene paso de peatones con semáforo
//            |
//            5 (farmacia al lado)
//  6 - 7  camino privado (no debe usarse)
const N = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
const osm = {
  elements: [
    { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential', name: 'Calle Mayor' } },
    { type: 'way', id: 101, nodes: [4, 2, 5], tags: { highway: 'residential', name: 'Calle de la Luna' } },
    { type: 'way', id: 102, nodes: [6, 7], tags: { highway: 'service', access: 'private' } },
    N(1, 40.4, -3.7), N(2, 40.4, -3.699), N(3, 40.4, -3.698), N(4, 40.401, -3.699), N(5, 40.399, -3.699),
    N(6, 40.402, -3.7), N(7, 40.402, -3.699),
    N(3, 40.4, -3.698, { highway: 'crossing', crossing: 'traffic_signals' }),
    N(20, 40.40001, -3.69805, { 'addr:street': 'Calle Mayor', 'addr:housenumber': '5' }),
    N(21, 40.40001, -3.69895, { 'addr:street': 'Calle Mayor', 'addr:housenumber': '7' }),
    N(22, 40.401, -3.69895, { 'addr:street': 'Calle de la Luna', 'addr:housenumber': '2' }),
    N(30, 40.3991, -3.69895, { amenity: 'pharmacy', name: 'Farmacia Sol' }),
    N(31, 40.4001, -3.6999, { shop: 'supermarket', name: 'Mercadona' }),
  ],
};

const data = compact(osm, { lat: 40.4, lon: -3.699 }, 2000);
const map = new MapData(data);

test('convierte los datos y descarta caminos privados', () => {
  assert.equal(data.roads.length, 2);
  assert.equal(data.addr.length, 3);
  assert.equal(data.pois.length, 2);
  assert.deepEqual(data.cross, [[3, 1]]);
  assert.ok(buildQuery(40.4, -3.7, 2000).includes('around:2000,40.400000,-3.700000'));
});

test('nombres de calles y direcciones', () => {
  assert.equal(streetKey('Calle de la Luna'), 'luna');
  assert.equal(withArticle('Calle Mayor'), 'la Calle Mayor');
  assert.deepEqual(parseAddress('calle mayor 5'), { street: 'calle mayor', number: '5' });
  assert.deepEqual(parseAddress('calle mayor número cinco'), { street: 'calle mayor', number: '5' });
});

test('busca direcciones, calles y lugares', () => {
  const me = { lat: 40.4, lon: -3.7 };
  const a = map.find('calle mayor 5', me);
  assert.equal(a.label, 'la Calle Mayor, número 5');
  const b = map.find('calle mayor 9', me);
  assert.match(b.note, /te llevo al 7/);
  assert.equal(map.find('la calle luna', me).type, 'street');
  assert.equal(map.find('la farmacia más cercana', me).label, 'la Farmacia Sol');
  assert.equal(map.find('mercadona', me).label, 'Mercadona');
  assert.equal(map.find('calle inventada 3', me), null);
});

test('calle en la que estoy', () => {
  const s = map.streetAt({ lat: 40.40003, lon: -3.6995 });
  assert.equal(s.name, 'Calle Mayor');
  assert.equal(map.nearestNumber({ lat: 40.40001, lon: -3.6981 }, 'Calle Mayor'), '5');
});

test('ruta con giro a la izquierda y paso de peatones', () => {
  const rt = map.route({ lat: 40.4, lon: -3.7 }, { lat: 40.401, lon: -3.699 });
  assert.ok(rt);
  assert.ok(Math.abs(rt.total - (85 + 111)) < 5, String(rt.total));
  const ins = map.instructions(rt);
  assert.equal(ins.maneuvers[0].label, 'la Calle Mayor');
  assert.equal(ins.maneuvers[1].text, 'gira a la izquierda por la Calle de la Luna');
  const rt2 = map.route({ lat: 40.4, lon: -3.7 }, { lat: 40.4, lon: -3.698 });
  assert.equal(map.instructions(rt2).events.length, 1);
});

test('guía giro a giro, recalcula y llega', () => {
  const said = [];
  let rerouted = 0, arrived = null;
  const dest = { lat: 40.401, lon: -3.699, label: 'la Calle de la Luna, número 2' };
  const rt = map.route({ lat: 40.4, lon: -3.7 }, dest);
  const ctx = {
    say: (t) => said.push(t), cue: { turn() {}, arrive() {} }, heading: () => 90, stepLength: () => 0.7,
    walking: () => true, onArrive: (n) => { arrived = n; },
    reroute: (g) => { rerouted++; g._load(map.route(g.pos, dest)); },
  };
  const g = new MapGuide(map, dest, rt, ctx);
  g.start();
  assert.match(said[0], /Ruta a la Calle de la Luna, número 2/);
  assert.match(said[0], /Sigue recto por la Calle Mayor/);
  // caminamos hacia el este por la Calle Mayor
  for (const lon of [-3.6997, -3.6995, -3.6993, -3.69915, -3.6990]) g.onPosition({ lat: 40.4, lon, acc: 5 });
  assert.ok(said.some((t) => /^En \d+ metros, gira a la izquierda por la Calle de la Luna/.test(t)), said.join(' | '));
  assert.ok(said.some((t) => /^Ahora, gira a la izquierda/.test(t)), said.join(' | '));
  // nos desviamos 60 m al sur dos veces -> recalcula
  g.onPosition({ lat: 40.3994, lon: -3.6985, acc: 5 });
  g.onPosition({ lat: 40.3994, lon: -3.6985, acc: 5 });
  assert.equal(rerouted, 1);
  // llegamos
  g.onPosition({ lat: 40.401, lon: -3.699, acc: 5 });
  assert.equal(arrived, 'la Calle de la Luna, número 2');
});

test('órdenes del mapa', () => {
  assert.equal(parse('descarga el mapa').intent, 'download_map');
  assert.equal(parse('bájate el mapa de mi zona').intent, 'download_map');
  assert.equal(parse('llévame a la calle mayor 5').name, 'calle mayor 5');
  assert.equal(parse('llévame a la farmacia más cercana').name, 'farmacia más cercana');
});
