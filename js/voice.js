// Voz (síntesis del propio sistema) y escucha (reconocimiento en el dispositivo cuando existe).

const PREFERRED = /(monica|mónica|paulina|marisol|helena|laura|elvira|dalia|lucia|lucía|sabina|esperanza|jorge|diego|pablo|alvaro|álvaro)/i;
const QUALITY = /(natural|neural|enhanced|premium|mejorada|siri)/i;
const POOR = /(compact|espeak|robot)/i;

export class Voice {
  constructor(settings, save) {
    this.s = settings;
    this.save = save || (() => {});
    this.synth = window.speechSynthesis || null;
    this.voices = [];
    this.voice = null;
    this.last = '';
    this._keep = new Set();
    this.onChange = null;
    if (!this.synth) return;
    const load = () => {
      this.voices = this.synth.getVoices().filter((v) => /^es\b|^es-/i.test(v.lang));
      this.voice = this._choose();
    };
    load();
    this.synth.addEventListener?.('voiceschanged', load);
  }

  get available() {
    return !!this.synth;
  }

  _score(v) {
    let s = 0;
    if (v.localService) s += 4; // en el dispositivo: sin servicios externos
    if (QUALITY.test(v.name)) s += 4;
    if (PREFERRED.test(v.name)) s += 2;
    if (/google/i.test(v.name)) s += 1;
    if (POOR.test(v.name)) s -= 5;
    const lang = (navigator.language || 'es-ES').toLowerCase();
    if (v.lang.toLowerCase() === lang) s += 2;
    else if (v.lang.toLowerCase() === 'es-es') s += 1;
    return s;
  }

  _choose() {
    if (!this.voices.length) return null;
    if (this.s.voiceName) {
      const v = this.voices.find((x) => x.name === this.s.voiceName);
      if (v) return v;
    }
    return [...this.voices].sort((a, b) => this._score(b) - this._score(a))[0];
  }

  nextVoice() {
    if (!this.voices.length) return null;
    const sorted = [...this.voices].sort((a, b) => this._score(b) - this._score(a));
    const i = sorted.indexOf(this.voice);
    this.voice = sorted[(i + 1) % sorted.length];
    this.s.voiceName = this.voice.name;
    this.save();
    return this.voice.name;
  }

  /** Desbloquea la voz en iOS (debe llamarse dentro de un gesto del usuario). */
  unlock() {
    if (!this.synth) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    this.synth.speak(u);
  }

  /**
   * priority: 'urgent' interrumpe todo (avisos de choque),
   *           'normal' se encola, 'low' se descarta si ya está hablando.
   */
  say(text, { priority = 'normal', remember = true } = {}) {
    if (!text || !this.synth) return;
    if (remember) this.last = text;
    if (priority === 'low' && this.synth.speaking) return;
    const speak = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = this.voice?.lang || 'es-ES';
      if (this.voice) u.voice = this.voice;
      u.rate = this.s.rate || 1;
      u.pitch = this.s.pitch || 1;
      u.volume = 1;
      this._keep.add(u); // evita que Chrome pierda la referencia y no dispare onend
      u.onstart = () => this.onChange?.(true);
      u.onend = u.onerror = () => {
        this._keep.delete(u);
        if (!this.synth.speaking) this.onChange?.(false);
      };
      this.synth.speak(u);
    };
    if (priority === 'urgent' && (this.synth.speaking || this.synth.pending)) {
      this.synth.cancel();
      setTimeout(speak, 60);
    } else speak();
  }

  get speaking() {
    return !!this.synth && (this.synth.speaking || this.synth.pending);
  }

  stop() {
    this.synth?.cancel();
  }

  /** Espera a que termine de hablar (para no escucharse a sí misma). */
  async idle(maxMs = 15000) {
    const t0 = Date.now();
    while (this.speaking && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 120));
  }
}

export class Listener {
  constructor(lang) {
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    // Tu variante de español (es-MX, es-AR, es-ES…) reconoce mejor tu acento.
    const nav = (navigator.languages || [navigator.language || '']).find((l) => /^es\b|^es-/i.test(l));
    this.lang = lang || nav || 'es-ES';
    this.hints = []; // palabras que esperamos oír (nombres de lugares, órdenes)
    this.local = false;
    this.rec = null;
  }

  get supported() {
    return !!this.SR;
  }

  /** Intenta usar (y descargar si hace falta) el reconocimiento de voz en el propio teléfono. */
  async prepareLocal() {
    const SR = this.SR;
    if (!SR) return false;
    try {
      if (typeof SR.available === 'function') {
        const st = await SR.available({ langs: [this.lang], processLocally: true });
        if (st === 'available') this.local = true;
        else if ((st === 'downloadable' || st === 'downloading') && typeof SR.install === 'function') {
          this.local = !!(await SR.install({ langs: [this.lang], processLocally: true }));
        }
      } else if (typeof SR.availableOnDevice === 'function') {
        const st = await SR.availableOnDevice(this.lang);
        if (st === 'available') this.local = true;
        else if (st === 'downloadable' && typeof SR.installOnDevice === 'function') {
          this.local = !!(await SR.installOnDevice(this.lang));
        }
      }
    } catch {
      this.local = false;
    }
    return this.local;
  }

  /** Escucha una frase. Resuelve con la lista de transcripciones posibles (la mejor primero) o null. */
  listen({ timeoutMs = 9000 } = {}) {
    return new Promise((resolve, reject) => {
      if (!this.SR) return reject(new Error('unsupported'));
      this.abort();
      const rec = new this.SR();
      this.rec = rec;
      rec.lang = this.lang;
      rec.interimResults = false;
      rec.continuous = false;
      rec.maxAlternatives = 5;
      try {
        // Pistas de vocabulario (solo navegadores que lo admiten)
        if ('phrases' in rec && window.SpeechRecognitionPhrase && this.hints.length) {
          rec.phrases = this.hints.slice(0, 50).map((p) => new window.SpeechRecognitionPhrase(p, 3));
        }
      } catch {}
      if (this.local) {
        if ('processLocally' in rec) rec.processLocally = true;
        else if ('mode' in rec) rec.mode = 'ondevice-only';
      }
      let done = false;
      const finish = (v, err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        this.rec = null;
        err ? reject(err) : resolve(v);
      };
      const timer = setTimeout(() => { try { rec.stop(); } catch {} }, timeoutMs);
      rec.onresult = (e) => {
        const res = e.results[0];
        const alts = [];
        for (let i = 0; i < res.length; i++) alts.push(res[i]);
        alts.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
        finish(alts.map((a) => a.transcript.trim()).filter(Boolean));
      };
      rec.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') finish(null);
        else finish(null, new Error(e.error));
      };
      rec.onend = () => finish(null);
      try { rec.start(); } catch (e) { finish(null, e); }
    });
  }

  abort() {
    try { this.rec?.abort(); } catch {}
    this.rec = null;
  }
}
