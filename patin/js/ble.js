// Conexión Bluetooth (Web Bluetooth) y un patín simulado para probar la app sin hardware.
import { bytesToHex, TRANSPORTS } from './protocols.js';

const CHUNK = 20; // tamaño seguro de paquete BLE (MTU por defecto)

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

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
