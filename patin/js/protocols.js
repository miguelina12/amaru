// Protocolo del patín: convierte las órdenes de la app en bytes para enviar por Bluetooth.
// Cada marca usa sus propios bytes, así que los comandos son plantillas configurables.

export const MAX_SPEED = 40; // km/h: límite máximo que permite la app (nunca se envía más)

export const clampSpeed = (v) => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(MAX_SPEED, n));
};

export function hexToBytes(hex) {
  const clean = String(hex).replace(/0x/gi, '').replace(/[\s,:-]/g, '');
  if (clean.length === 0) throw new Error('El comando está vacío');
  if (!/^[0-9a-f]+$/i.test(clean)) throw new Error('El comando tiene caracteres que no son hexadecimales');
  if (clean.length % 2) throw new Error('El comando tiene un número impar de cifras hexadecimales');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export const bytesToHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

const hex8 = (n) => (n & 0xff).toString(16).padStart(2, '0');
const hex16le = (n) => hex8(n) + hex8(n >> 8);

export const CHECKSUMS = {
  none: 'Sin suma de control',
  sum8: 'Suma de 1 byte (sum & 0xFF)',
  xor8: 'XOR de 1 byte',
  ninebot: 'Tipo 55 AA (suma invertida de 2 bytes, sin cabecera)',
};

export function withChecksum(bytes, kind = 'none') {
  if (kind === 'none' || !kind) return bytes;
  let tail;
  if (kind === 'sum8') tail = [bytes.reduce((a, b) => a + b, 0) & 0xff];
  else if (kind === 'xor8') tail = [bytes.reduce((a, b) => a ^ b, 0)];
  else if (kind === 'ninebot') {
    const sum = bytes.slice(2).reduce((a, b) => a + b, 0);
    const cs = ~sum & 0xffff;
    tail = [cs & 0xff, cs >> 8];
  } else throw new Error(`Suma de control desconocida: ${kind}`);
  const out = new Uint8Array(bytes.length + tail.length);
  out.set(bytes);
  out.set(tail, bytes.length);
  return out;
}

// Variables que se pueden usar dentro de una plantilla:
//   {v}     velocidad en km/h (1 byte)        {v10le} velocidad ×10 (2 bytes, little endian)
//   {r} {g} {b}  color de las luces (1 byte cada uno)
export function buildCommand(template, vars = {}, checksum = 'none') {
  if (!template || !String(template).trim()) throw new Error('Este comando no está configurado en Ajustes');
  const speed = vars.speed === undefined ? 0 : clampSpeed(vars.speed);
  const filled = String(template).replace(/\{(\w+)\}/g, (_, key) => {
    switch (key) {
      case 'v': return hex8(speed);
      case 'v10le': return hex16le(speed * 10);
      case 'r': return hex8(vars.r ?? 0);
      case 'g': return hex8(vars.g ?? 0);
      case 'b': return hex8(vars.b ?? 0);
      default: throw new Error(`Variable desconocida en la plantilla: {${key}}`);
    }
  });
  return withChecksum(hexToBytes(filled), checksum);
}

const uuid16 = (n) => `0000${n}-0000-1000-8000-00805f9b34fb`;

// Transportes Bluetooth más habituales en patines. Los comandos van vacíos: dependen del modelo.
export const TRANSPORTS = {
  nus: { name: 'Nordic UART (6E40…)', service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    write: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', notify: '6e400003-b5a3-f393-e0a9-e50e24dcca9e' },
  ffe0: { name: 'Serie FFE0 / FFE1', service: uuid16('ffe0'), write: uuid16('ffe1'), notify: uuid16('ffe1') },
  fff0: { name: 'Serie FFF0 / FFF2', service: uuid16('fff0'), write: uuid16('fff2'), notify: uuid16('fff1') },
};

export const COMMANDS = {
  powerOn: 'Encender',
  powerOff: 'Apagar',
  speed: 'Velocidad máxima',
  lightsOn: 'Luces encendidas',
  lightsOff: 'Luces apagadas',
  lightsBlink: 'Luces intermitentes',
  lightsColor: 'Color de las luces del panel',
};

export function defaultProfile() {
  return {
    name: 'Mi patín',
    namePrefix: '',
    transport: 'nus',
    ...TRANSPORTS.nus,
    checksum: 'none',
    withResponse: false,
    commands: Object.fromEntries(Object.keys(COMMANDS).map((k) => [k, ''])),
  };
}

export function normalizeProfile(p) {
  const base = defaultProfile();
  if (!p || typeof p !== 'object') return base;
  const out = { ...base, ...p, commands: { ...base.commands, ...(p.commands || {}) } };
  for (const k of ['service', 'write', 'notify']) out[k] = normalizeUuid(out[k]);
  if (!CHECKSUMS[out.checksum]) out.checksum = 'none';
  return out;
}

// Acepta "ffe0", "0xFFE0" o el UUID completo.
export function normalizeUuid(u) {
  const s = String(u || '').trim().toLowerCase().replace(/^0x/, '');
  if (/^[0-9a-f]{4}$/.test(s)) return uuid16(s);
  if (/^[0-9a-f]{8}$/.test(s)) return `${s}-0000-1000-8000-00805f9b34fb`;
  return s;
}

// Lee la velocidad actual si el patín la manda en sus notificaciones (opcional, plantilla tipo "byte 5").
export function parseTelemetry(bytes, speedByteIndex) {
  if (speedByteIndex === undefined || speedByteIndex === null || speedByteIndex === '') return null;
  const i = Number(speedByteIndex);
  if (!Number.isInteger(i) || i < 0 || i >= bytes.length) return null;
  return bytes[i];
}
