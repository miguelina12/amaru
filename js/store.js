// Memoria local del teléfono: ajustes, lugares y rutas. Nada sale del dispositivo.

const KEY = 'amaru.v1';

const DEFAULTS = {
  settings: {
    rate: 1,
    pitch: 1,
    voiceName: null,
    stepLength: 0.65,
    calibrated: false,
    heightCm: null,
    sonar: false,
    brain: false,
    handsFree: false,
    sensitivity: 1,
  },
  places: {},
  routes: {},
};

export class Store {
  constructor(storage = globalThis.localStorage) {
    this.storage = storage;
    let data = {};
    try { data = JSON.parse(storage?.getItem(KEY) || '{}'); } catch { data = {}; }
    this.data = {
      settings: { ...DEFAULTS.settings, ...(data.settings || {}) },
      places: data.places || {},
      routes: data.routes || {},
    };
  }

  get settings() {
    return this.data.settings;
  }

  save() {
    try { this.storage?.setItem(KEY, JSON.stringify(this.data)); } catch {}
  }

  placeNames() { return Object.keys(this.data.places); }
  routeNames() { return Object.keys(this.data.routes); }
  place(n) { return this.data.places[n] || null; }
  route(n) { return this.data.routes[n] || null; }

  savePlace(p) {
    this.data.places[p.name] = { ...p, created: Date.now() };
    this.save();
  }

  saveRoute(r) {
    this.data.routes[r.name] = { ...r, created: Date.now() };
    this.save();
  }

  remove(name) {
    let ok = false;
    if (this.data.places[name]) { delete this.data.places[name]; ok = true; }
    if (this.data.routes[name]) { delete this.data.routes[name]; ok = true; }
    if (ok) this.save();
    return ok;
  }
}
