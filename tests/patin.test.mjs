import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSpeed, hexToBytes, bytesToHex, withChecksum, buildCommand, normalizeUuid, normalizeProfile, parseTelemetry, MAX_SPEED }
  from '../patin/js/protocols.js';

test('la velocidad nunca pasa de 0–40 km/h', () => {
  assert.equal(MAX_SPEED, 40);
  assert.equal(clampSpeed(55), 40);
  assert.equal(clampSpeed(-3), 0);
  assert.equal(clampSpeed('25.4'), 25);
  assert.equal(clampSpeed('abc'), 0);
  assert.deepEqual([...buildCommand('A0 {v}', { speed: 99 })], [0xa0, 40]);
});

test('hexadecimal', () => {
  assert.deepEqual([...hexToBytes('55 aa,0x03:ff')], [0x55, 0xaa, 0x03, 0xff]);
  assert.equal(bytesToHex(Uint8Array.of(1, 171)), '01 AB');
  assert.throws(() => hexToBytes('ABC'), /impar/);
  assert.throws(() => hexToBytes('zz'), /hexadecimales/);
  assert.throws(() => hexToBytes(' '), /vacío/);
});

test('sumas de control', () => {
  assert.deepEqual([...withChecksum(Uint8Array.of(0xff, 0x02), 'sum8')], [0xff, 0x02, 0x01]);
  assert.deepEqual([...withChecksum(Uint8Array.of(0x0f, 0xf0), 'xor8')], [0x0f, 0xf0, 0xff]);
  // 55 AA 03 20 01 10 0E → suma(03+20+01+10+0E)=0x42 → ~0x42 = 0xFFBD → BD FF
  assert.deepEqual([...withChecksum(hexToBytes('55AA032001100E'), 'ninebot')].slice(-2), [0xbd, 0xff]);
});

test('plantillas con variables', () => {
  assert.equal(bytesToHex(buildCommand('01 {v10le}', { speed: 25 })), '01 FA 00');
  assert.equal(bytesToHex(buildCommand('C0 {r}{g}{b}', { r: 255, g: 128, b: 0 })), 'C0 FF 80 00');
  assert.throws(() => buildCommand('', {}), /no está configurado/);
  assert.throws(() => buildCommand('01 {x}', {}), /desconocida/);
});

test('perfiles y UUID', () => {
  assert.equal(normalizeUuid('0xFFE0'), '0000ffe0-0000-1000-8000-00805f9b34fb');
  const p = normalizeProfile({ service: 'fff0', checksum: 'raro', commands: { powerOn: '01' } });
  assert.equal(p.service, '0000fff0-0000-1000-8000-00805f9b34fb');
  assert.equal(p.checksum, 'none');
  assert.equal(p.commands.powerOn, '01');
  assert.equal(p.commands.powerOff, '');
  assert.equal(parseTelemetry(Uint8Array.of(1, 2, 18), '2'), 18);
  assert.equal(parseTelemetry(Uint8Array.of(1), ''), null);
});
