// Conexión Bluetooth (Web Bluetooth) y un patín simulado para probar la app sin hardware.
import { bytesToHex, TRANSPORTS } from './protocols.js';

const CHUNK = 20; // tamaño seguro de paquete BLE (MTU por defecto)

// Dentro del APK (Capacitor) no hay Bluetooth web: se usa el plugin Bluetooth nativo.
export const isNativeApp = () => !!globalThis.Capacitor?.isNativePlatform?.();
export const bluetoothAvailable = () => isNativeApp() || (typeof navigator !== 'undefined' && !!navigator.bluetooth);

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const fromNative = (v) => {
  if (typeof v === 'string') return Uint8Array.from((v.replace(/[^0-9a-f]/gi, '').match(/../g) || []).map((h) => parseInt(h, 16)));
  if (v instanceof DataView) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  return new Uint8Array(0);
};

export class NativeBleLink {
  constructor() {
    this.ble = globalThis.Capacitor.registerPlugin('BluetoothLe');
    this.onData = () => {};
    this.onClose = () => {};
    this.deviceId = null;
    this.listeners = [];
    this.name = '';
  }

  async connect(profile) {
    const ble = this.ble;
    await ble.initialize({ androidNeverForLocation: true });
    const { value: on } = await ble.isEnabled();
    if (!on) {
      try { await ble.requestEnable(); } catch { throw new Error('Activa el Bluetooth del móvil'); }
    }
    const optionalServices = [...new Set([profile.service, ...Object.values(TRANSPORTS).map((t) => t.service)])];
    const opts = { optionalServices };
    if (profile.namePrefix) opts.namePrefix = profile.namePrefix;
    let device;
    try {
      device = await ble.requestDevice(opts);
    } catch (e) {
      const err = new Error(/cancel/i.test(e.message) ? 'No se eligió ningún patín' : e.message);
      err.name = 'NotFoundError';
      throw err;
    }
    this.deviceId = device.deviceId;
    this.name = device.name || 'Patín';
    this.profile = profile;
    this.listeners.push(await ble.addListener(`disconnected|${this.deviceId}`, () => { this.deviceId = null; this.onClose(); }));
    await ble.connect({ deviceId: this.deviceId, timeout: 15000 });
    const { services = [] } = await ble.getServices({ deviceId: this.deviceId }).catch(() => ({}));
    const svc = services.find((s) => s.uuid.toLowerCase() === profile.service);
    if (services.length && !svc) {
      const list = services.map((s) => s.uuid).join(', ');
      await ble.disconnect({ deviceId: this.deviceId }).catch(() => {});
      throw new Error(`El patín no tiene el servicio configurado. Servicios encontrados: ${list}`);
    }
    if (profile.notify) {
      try {
        const base = { deviceId: this.deviceId, service: profile.service, characteristic: profile.notify };
        this.listeners.push(await ble.addListener(`notification|${this.deviceId}|${profile.service}|${profile.notify}`,
          (ev) => this.onData(fromNative(ev?.value))));
        await ble.startNotifications(base);
      } catch { /* sin notificaciones */ }
    }
    return this.name;
  }

  async send(bytes) {
    if (!this.deviceId) throw new Error('No hay ningún patín conectado');
    const base = { deviceId: this.deviceId, service: this.profile.service, characteristic: this.profile.write };
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const value = toHex(bytes.slice(i, i + CHUNK));
      if (this.profile.withResponse) await this.ble.write({ ...base, value });
      else await this.ble.writeWithoutResponse({ ...base, value });
    }
  }

  disconnect() {
    const id = this.deviceId;
    this.listeners.forEach((l) => l.remove?.());
    this.listeners = [];
    if (id) this.ble.disconnect({ deviceId: id }).catch(() => {});
    this.deviceId = null;
    this.onClose();
  }
}

export class BleLink {
  constructor() {
    this.device = null;
    this.writeChar = null;
    this.onData = () => {};
    this.onClose = () => {};
    this.name = '';
  }

  async connect(profile) {
    if (!bluetoothAvailable()) throw new Error('Este navegador no tiene Bluetooth web. Usa Chrome en Android o en el ordenador.');
    const optionalServices = [...new Set([profile.service, ...Object.values(TRANSPORTS).map((t) => t.service)])];
    const opts = profile.namePrefix
      ? { filters: [{ namePrefix: profile.namePrefix }], optionalServices }
      : { acceptAllDevices: true, optionalServices };
    this.device = await navigator.bluetooth.requestDevice(opts);
    this.name = this.device.name || 'Patín';
    this.device.addEventListener('gattserverdisconnected', () => this.onClose());
    const server = await this.device.gatt.connect();
    let service;
    try {
      service = await server.getPrimaryService(profile.service);
    } catch {
      const found = await server.getPrimaryServices().catch(() => []);
      const list = found.map((s) => s.uuid).join(', ') || 'ninguno visible';
      throw new Error(`El patín no tiene el servicio configurado. Servicios encontrados: ${list}`);
    }
    this.writeChar = await service.getCharacteristic(profile.write);
    this.withResponse = !!profile.withResponse;
    if (profile.notify) {
      try {
        const n = await service.getCharacteristic(profile.notify);
        n.addEventListener('characteristicvaluechanged', (e) => {
          const v = e.target.value;
          this.onData(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        });
        await n.startNotifications();
      } catch { /* sin notificaciones: la app funciona igual, solo no recibe datos */ }
    }
    return this.name;
  }

  async send(bytes) {
    if (!this.writeChar) throw new Error('No hay ningún patín conectado');
    for (let i = 0; i < bytes.length; i += CHUNK) {
      const part = bytes.slice(i, i + CHUNK);
      if (!this.withResponse && this.writeChar.writeValueWithoutResponse) await this.writeChar.writeValueWithoutResponse(part);
      else if (this.writeChar.writeValueWithResponse) await this.writeChar.writeValueWithResponse(part);
      else await this.writeChar.writeValue(part);
    }
  }

  disconnect() {
    if (this.device?.gatt?.connected) this.device.gatt.disconnect();
    this.writeChar = null;
  }
}

// Patín de demostración: responde a las órdenes y "circula" a una velocidad que respeta el límite.
export class DemoLink {
  constructor() {
    this.onData = () => {};
    this.onClose = () => {};
    this.name = 'Patín de demostración';
    this.timer = null;
    this.speed = 0;
    this.on = false;
    this.limit = 25;
  }

  async connect() {
    await new Promise((r) => setTimeout(r, 400));
    this.timer = setInterval(() => {
      const target = this.on ? Math.min(this.limit, 12 + 10 * Math.sin(Date.now() / 4000) + 10) : 0;
      this.speed += (target - this.speed) * 0.25;
      this.onData(Uint8Array.of(0xde, 0x01, Math.max(0, Math.round(this.speed))));
    }, 500);
    return this.name;
  }

  // La demo entiende las órdenes por su significado (la app se lo indica), no por los bytes.
  async send(bytes, meta = {}) {
    if (meta.action === 'powerOn') this.on = true;
    if (meta.action === 'powerOff') this.on = false;
    if (meta.action === 'speed') this.limit = meta.speed;
    console.debug('[demo] →', bytesToHex(bytes), meta);
  }

  disconnect() {
    clearInterval(this.timer);
    this.timer = null;
    this.onClose();
  }
}
