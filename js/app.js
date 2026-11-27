// Faro — orquestador principal.

import { Voice, Listener } from './voice.js';
import * as audio from './audio.js';
import { Pedometer, Compass, Gps } from './sensors.js';
import { Store } from './store.js';
import { RouteRecorder, StepGuide, GpsGuide, reverseRoute, describeRoute } from './navigator.js';
import { Vision } from './vision.js';
import { Safety } from './safety.js';
import { parse, parseBest, INTENT_DESC, findBest, cleanName, hasWake, stripWake, normalize } from './intents.js';
import { Brain } from './brain.js';
import { Claude, claudeProblem } from './claude.js';
import * as geo from './geo.js';
import * as labels from './labels.js';
import { MapData, MapGuide, download as downloadMap, saveMap, loadMap, withArticle as withArt } from './map.js';

const $ = (id) => document.getElementById(id);

const store = new Store();
const S = store.settings;
const voice = new Voice(S, () => store.save());
const listener = new Listener();
const ped = new Pedometer();
const compass = new Compass();
const gps = new Gps();
const vision = new Vision($('video'), () => compass.pitch);
const sonar = new audio.Sonar();
const brain = new Brain();
const claude = new Claude(() => S.claudeKey);

const app = {
  nav: null, // StepGuide | GpsGuide
  recording: null, // RouteRecorder
  trail: new RouteRecorder('el punto de partida', null), // migas de pan para "volver"
  calib: null,
  finding: null,
  awaiting: null, // { kind, ... } esperando respuesta del usuario
  lastRoute: null,
  here: null, // nombre del último lugar donde está el usuario
  listening: false,
  aimBad: false,
  map: null, // MapData: calles descargadas de OpenStreetMap
  lastAim: 0,
};

const stepLength = () => S.stepLength || 0.65;

function say(text, opts) {
  voice.say(text, opts);
  log(text);
  chat(text, false);
}

/** Conversación visible (para acompañantes o baja visión). */
function chat(text, me) {
  const el = $('chat');
  if (!el || !text) return;
  const li = document.createElement('li');
  if (me) li.className = 'me';
  li.textContent = text;
  el.append(li);
  while (el.children.length > 60) el.firstChild.remove();
  el.scrollTop = el.scrollHeight;
}

function log(text) {
  const el = $('caption');
  if (el) el.textContent = text;
}

function heard(text) {
  const el = $('heard');
  if (el) el.textContent = text ? `«${text}»` : '';
  if (text) chat(text, true);
}

const safety = new Safety({
  say, cue: audio.cue, sonar,
  walking: () => ped.walking,
  speed: () => ped.speed(stepLength()),
  stepLength,
  navigating: () => !!app.nav,
});

/** ¿Dentro o fuera? Con buena señal GPS reciente, casi seguro en la calle. */
vision.getScene = () => {
  const p = gps.last;
  if (!p || Date.now() - p.t > 20000) return 'indoor';
  if (p.acc <= 15) return 'outdoor';
  if (p.acc >= 40) return 'indoor';
  return 'unknown';
};

// ------------------------------------------------------------------ arranque

$('startBtn').addEventListener('click', start, { once: true });

async function start() {
  audio.unlock();
  voice.unlock();
  $('start').hidden = true;
  $('app').hidden = false;

  const [okMotion, okOrient] = await Promise.all([ped.requestPermission(), compass.requestPermission()]);
  ped.sensitivity = S.sensitivity || 1;
  ped.start();
  compass.start();
  gps.start();
  keepAwake();
  if (S.sonar) sonar.start();

  let camOk = true;
  try {
    await vision.startCamera();
  } catch {
    camOk = false;
  }
  app.camOk = camOk;
  app.motionOk = okMotion;
  app.orientOk = okOrient;

  const tips = ['Hola, soy Faro. Toca el botón grande para hablarme.'];
  if (camOk) tips.push('Lleva el teléfono a la altura del pecho, con la cámara hacia delante.');
  else tips.push('No he podido abrir la cámara; te guío con pasos y GPS, pero sin avisos de obstáculos.');
  if (!okMotion || !okOrient) tips.push('No tengo permiso para los sensores de movimiento.');
  if (!S.calibrated) tips.push('Cuando quieras, di: calibra mis pasos.');
  say(tips.join(' '));
  if (!listener.supported) say('Este navegador no reconoce la voz. Usa los botones o escribe.');

  if (camOk) {
    vision.start();
    vision.loadModel()
      .then(() => { audio.cue.ok(); updateInfo(); })
      .catch(() => (app.modelFailed = true, say('No he podido cargar el detector de obstáculos. Conéctate a internet una vez para descargarlo.')));
  }
  setInterval(aimCoach, 2500);
  setInterval(updateInfo, 2000);
  updateInfo();
  loadMap().then((d) => { if (d) { app.map = new MapData(d); log('Mapa de calles cargado'); } }).catch(() => {});
  if (S.brain) enableBrain(true);
  if (S.handsFree) handsFreeLoop();
}

async function keepAwake() {
  try {
    let lock = await navigator.wakeLock?.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (document.visibilityState === 'visible') lock = await navigator.wakeLock?.request('screen');
    });
    void lock;
  } catch {}
}

// ------------------------------------------------------------------ eventos de sensores

ped.addEventListener('step', () => {
  const h = compass.heading;
  app.recording?.addStep(h);
  app.trail.addStep(h);
  app.calib?.onStep();
  app.nav?.onStep();
  updateInfo();
});

let lastHeadingEvt = 0;
compass.addEventListener('change', () => {
  const now = Date.now();
  if (now - lastHeadingEvt < 250) return;
  lastHeadingEvt = now;
  app.nav?.onHeading?.(compass.heading);
});

gps.addEventListener('position', (e) => {
  const p = e.detail;
  app.recording?.addGps(p);
  app.trail.addGps(p);
  app.calib?.onPosition?.(p);
  if (app.nav?.kind === 'gps') app.nav.onPosition(p);
  updateInfo();
});

vision.addEventListener('detections', (e) => {
  const { objects, W, H } = e.detail;
  safety.setFrameTime(vision.frameMs || 250);
  safety.onDetections(objects);
  if (app.finding) onFinding(objects);
  drawOverlay(objects, W, H);
});

vision.addEventListener('quality', (e) => safety.onQuality(e.detail));

// ------------------------------------------------------------------ "enfócame": colocación de la cámara

function aimProblem({ strict = false } = {}) {
  const b = compass.pitch, g = compass.roll, q = vision.quality;
  if (!vision.stream) return null;
  if (q?.covered) return 'La cámara parece tapada.';
  if (b != null) {
    if (b < (strict ? 55 : 40)) return 'Levanta un poco el teléfono, la cámara mira al suelo.';
    if (b > (strict ? 115 : 130)) return 'Baja un poco el teléfono, la cámara mira al techo.';
  }
  if (g != null && Math.abs(g) > (strict ? 30 : 45)) return 'Endereza el teléfono.';
  if (q?.dark) return 'dark';
  if (strict && q?.blurry) return 'La imagen está borrosa. Limpia la lente o sujeta el teléfono más quieto.';
  return null;
}

// Avisa de la colocación solo si el problema dura (~7 s) y sin repetirse.
const aim = { cur: null, count: 0, spoken: null, spokenAt: 0, torchTried: false, darkSaid: 0 };

async function aimCoach() {
  const p = aimProblem();
  const now = Date.now();
  if (p === 'dark') {
    if (!vision.torchOn && !aim.torchTried) {
      aim.torchTried = true;
      if (await vision.torch(true)) say('Hay poca luz, enciendo la linterna.', { priority: 'low', remember: false });
    } else if (!vision.torchOn && now - aim.darkSaid > 120000) {
      aim.darkSaid = now;
      say('Hay muy poca luz, no veo bien.', { priority: 'low', remember: false });
    }
    return;
  }
  if (p !== aim.cur) { aim.cur = p; aim.count = 0; }
  aim.count++;
  if (p && aim.count >= 3 && (p !== aim.spoken || now - aim.spokenAt > 30000)) {
    aim.spoken = p;
    aim.spokenAt = now;
    say(p, { priority: 'low', remember: false });
  } else if (!p && aim.spoken && aim.count >= 2) {
    aim.spoken = null;
    audio.cue.ok(); // solo un sonido, sin hablar
  }
}

// ------------------------------------------------------------------ escucha

$('talk').addEventListener('click', () => listenOnce());
$('btnWhat').addEventListener('click', () => handle('qué hay delante'));
$('btnWhere').addEventListener('click', () => handle('dónde estoy'));
$('btnStop').addEventListener('click', () => handle('para'));
$('btnRepeat').addEventListener('click', () => handle('repite'));

// Ajustes
function openSettings(open) {
  $('settings').hidden = !open;
  if (open) { updateInfo(); $('btnClose').focus(); } else $('btnSettings').focus();
}
$('btnSettings').addEventListener('click', () => openSettings(true));
$('btnClose').addEventListener('click', () => openSettings(false));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('settings').hidden) openSettings(false); });
for (const b of document.querySelectorAll('[data-cmd]')) {
  b.addEventListener('click', () => { openSettings(false); handle(b.dataset.cmd); });
}
$('tglSonar').addEventListener('click', () => handle(S.sonar ? 'desactiva el sónar' : 'activa el sónar').then(updateInfo));
$('tglHands').addEventListener('click', () => { openSettings(false); handle(S.handsFree ? 'desactiva manos libres' : 'activa manos libres'); });
$('tglTorch').addEventListener('click', () => handle(vision.torchOn ? 'apaga la linterna' : 'enciende la linterna').then(updateInfo));
$('checksBox').addEventListener('toggle', updateInfo);
$('keyForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('keyIn').value.trim();
  $('keyIn').value = '';
  if (!v) return;
  if (!/^sk-ant-/.test(v)) return say('Eso no parece una clave de Anthropic. Empieza por s k guion a n t.');
  S.claudeKey = v;
  store.save();
  app.keyHinted = true;
  openSettings(false);
  updateInfo();
  say('Clave guardada. Ahora te entenderá Claude cuando haya internet. Prueba a decir: mira bien.');
});
$('keyDel').addEventListener('click', () => {
  S.claudeKey = '';
  store.save();
  claude.history = [];
  updateInfo();
  say('Clave borrada. Te entiendo solo con lo que hay en el teléfono.');
});
$('tglBrain').addEventListener('click', () => { openSettings(false); handle(brain.ready || S.brain ? 'desactiva el modo inteligente' : 'activa el modo inteligente'); });
$('tglCam').addEventListener('click', () => { $('camwrap').classList.toggle('off'); updateInfo(); });
$('typeForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('typeIn').value.trim();
  $('typeIn').value = '';
  openSettings(false);
  if (v) handle(v);
});

async function listenOnce() {
  if (!listener.supported) return say('No puedo escuchar en este navegador. Usa los botones o escribe.');
  if (app.listening) return;
  voice.stop();
  listener.hints = ['Faro', ...store.placeNames(), ...store.routeNames(), 'llévame a', 'qué hay delante', 'dónde estoy'];
  app.listening = true;
  $('talk').classList.add('on');
  $('talkLabel').textContent = 'Te escucho';
  $('talkHint').textContent = 'habla ahora';
  audio.cue.listen();
  try {
    const alts = await listener.listen({ onPartial: (t) => { const el = $('heard'); if (el) el.textContent = t ? `«${t}…»` : ''; } });
    audio.cue.heard();
    if (alts?.length) await handle(alts);
    else say('No te he oído. Toca otra vez y habla.', { remember: false });
  } catch (e) {
    if (String(e.message).includes('not-allowed')) say('Necesito permiso para usar el micrófono.');
    else say('No he podido escuchar. Inténtalo otra vez.');
  } finally {
    app.listening = false;
    $('talk').classList.remove('on');
    $('talkLabel').textContent = 'Toca para hablar';
    $('talkHint').textContent = 'en cualquier parte de este botón';
  }
  // Después de la primera escucha, prepara el reconocimiento dentro del teléfono (sin bloquear).
  if (!app.localChecked) { app.localChecked = true; listener.prepareLocal(); }
}

async function handsFreeLoop() {
  if (!listener.supported) return;
  while (S.handsFree) {
    await voice.idle();
    if (app.listening) { await sleep(300); continue; }
    app.listening = true;
    let text = null;
    try { text = await listener.listen({ timeoutMs: 12000 }); } catch { await sleep(1500); }
    app.listening = false;
    const woke = text?.filter((t) => hasWake(t));
    if (woke?.length) {
      audio.cue.heard();
      const rest = woke.map((t) => stripWake(normalize(t))).filter(Boolean);
      if (rest.length) await handle(rest);
      else await listenOnce();
    }
  }
}

/** Foto actual de la cámara en JPEG (base64), como mucho 1024 px de lado. */
function snapshot() {
  const v = vision.video;
  if (!v || v.readyState < 2 || !v.videoWidth) return null;
  const k = Math.min(1, 1024 / Math.max(v.videoWidth, v.videoHeight));
  const c = document.createElement('canvas');
  c.width = Math.round(v.videoWidth * k);
  c.height = Math.round(v.videoHeight * k);
  c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8).split(',')[1];
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ cerebro: interpretar órdenes

function brainState() {
  return {
    lugares: store.placeNames(),
    rutas: store.routeNames(),
    delante: (vision.last || []).slice(0, 6).map((o) => ({ objeto: labels.name(o.cls), hora: o.clock, metros: o.dist && +o.dist.toFixed(1) })),
    navegando: app.nav ? app.nav.route?.name || app.nav.name : null,
    grabando: app.recording?.name || null,
    rumbo: compass.heading != null ? geo.cardinal(compass.heading) : null,
    gps: gps.last ? Math.round(gps.last.acc) + ' m de precisión' : 'sin señal',
    pasos: ped.count,
    calle: (() => { const p = gps.last; const st = p && app.map?.covers(p) ? app.map.streetAt(p) : null; return st?.name || null; })(),
    hora: new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }),
  };
}

/** raw: texto, o lista de transcripciones posibles del reconocimiento de voz. */
async function handle(raw) {
  const alts = Array.isArray(raw) ? raw : [raw];
  let cmd = parseBest(alts);
  raw = cmd.text && alts.find((a) => normalize(a) === cmd.text) || alts[0];
  heard(raw);

  if (app.awaiting && !['stop', 'help', 'repeat'].includes(cmd.intent)) {
    const a = app.awaiting;
    app.awaiting = null;
    return a.resolve(cmd, raw);
  }

  // Claude (por internet, con tu clave): para lo que las reglas no entienden con seguridad
  if ((cmd.intent === 'unknown' || cmd.fuzzy) && claude.hasKey) {
    if (!claude.online) {
      if (!app.offlineSaid) { app.offlineSaid = true; say(claudeProblem('offline'), { priority: 'low' }); }
    } else {
      try {
        const r = await claude.interpret(raw, brainState());
        if (r.say) say(r.say);
        if (r.intent === 'none') return;
        if (['navigate', 'find', 'where_is', 'save_place', 'record_route'].includes(r.intent) && !r.name) return;
        if (r.intent === 'look') return handlers.look({ text: normalize(raw), question: raw });
        return run({ ...r, name: r.name && cleanName(r.name), text: normalize(raw) });
      } catch (e) {
        say(claudeProblem(e.code));
      }
    }
  } else if (cmd.intent === 'unknown' && !app.keyHinted) {
    // Sin clave: lo decimos una vez, y seguimos con lo que hay en el teléfono
    app.keyHinted = true;
    say('Si pones tu clave de Claude en Ajustes, te entenderé mucho mejor y podremos conversar.', { priority: 'low' });
  }

  // No lo entiendo y el teléfono puede con el modo inteligente: lo ofrezco (una vez por sesión)
  if (cmd.intent === 'unknown' && !cmd.suggestion && !brain.ready && !brain.loading && Brain.supported && !app.brainOffered) {
    app.brainOffered = true;
    say('No te he entendido. Si activo el modo inteligente, entenderé frases libres y podremos conversar, sin internet después de descargarlo una vez. ¿Lo activo? Di sí o no.');
    app.awaiting = { resolve: (c) => (c.intent === 'yes' ? enableBrain() : say('Vale. Puedes activarlo cuando quieras en Ajustes.')) };
    return;
  }

  if (cmd.intent === 'unknown' && cmd.suggestion && !brain.ready) {
    const sug = cmd.suggestion;
    say(`No estoy seguro. ¿Querías ${INTENT_DESC[sug] || sug}? Di sí o no.`);
    app.awaiting = { resolve: (c) => (c.intent === 'yes' ? run({ intent: sug, text: '' }) : say('Vale. Dímelo de otra forma.')) };
    return;
  }

  if (cmd.intent === 'unknown' && brain.ready) {
    say('Déjame pensar.', { priority: 'low', remember: false });
    try {
      const r = await brain.interpret(raw, brainState());
      if (r) {
        if (r.say) say(r.say);
        if (r.intent === 'none') return;
        if (['navigate', 'find', 'where_is', 'save_place'].includes(r.intent) && !r.name) return;
        cmd = { ...r, name: r.name && cleanName(r.name), text: normalize(raw) };
      }
    } catch {}
  }
  return run(cmd);
}

async function run(cmd) {
  const H = handlers[cmd.intent] || handlers.unknown;
  return H(cmd);
}

const handlers = {
  empty() {},

  unknown() {
    say(brain.ready
      ? 'No estoy seguro de lo que necesitas. Dímelo de otra forma.'
      : 'No te he entendido. Prueba, por ejemplo: llévame a la cocina, qué hay delante, o di ayuda.');
  },

  help() {
    say('Puedo avisarte de obstáculos con la cámara, decirte qué hay delante y buscar objetos. ' +
      'Para tu casa: di "graba ruta a la cocina", camina, y al llegar di "he llegado". Después di "llévame a la cocina". ' +
      'En la calle: di "guarda este lugar como portal" y luego "llévame al portal". ' +
      'Para ir por calles con su nombre, di una vez: descarga el mapa. Luego: llévame a la calle Mayor 5, o a la farmacia más cercana. ' +
      'También: dónde estoy, hacia dónde miro, calibra mis pasos, vuelve, activa el sónar, y para.');
  },

  repeat() { if (voice.last) voice.say(voice.last); },
  greet() { say('Hola. Estoy aquí. ¿A dónde vamos?'); },
  thanks() { say('De nada. Aquí sigo.'); },
  yes() { say('Vale.'); },
  no() { say('De acuerdo.'); },

  stop() {
    voice.stop();
    const had = [];
    if (app.nav) { had.push('la guía'); app.nav = null; }
    if (app.finding) { had.push('la búsqueda'); app.finding = null; }
    if (app.calib) { had.push('la calibración'); app.calib = null; }
    if (had.length) say(`He parado ${had.join(' y ')}.`, { priority: 'urgent' });
    else if (app.recording) say('Sigo grabando la ruta. Di "he llegado" para guardarla o "cancela la grabación".', { priority: 'urgent' });
    else say('Vale, en silencio. Sigo vigilando obstáculos.', { priority: 'urgent' });
  },

  // ---------- rutas

  record_route(cmd) {
    if (!cmd.name) {
      say('¿Cómo se llama el sitio al que vamos?');
      app.awaiting = { resolve: (c, raw) => handlers.record_route({ name: cleanName(c.name || raw) }) };
      return;
    }
    if (app.nav) app.nav = null;
    app.recording = new RouteRecorder(cmd.name, app.here);
    audio.cue.ok();
    say(`Grabando el camino hasta ${cmd.name}${app.here ? ' desde ' + app.here : ''}. ` +
      'Camina con normalidad, con el teléfono delante. Cuando llegues, di "he llegado".');
  },

  cancel_record() {
    if (!app.recording) return say('No estaba grabando ninguna ruta.');
    app.recording = null;
    say('Grabación cancelada.');
  },

  finish() {
    if (app.calib?.finish) return app.calib.finish();
    if (app.recording) {
      const r = app.recording.finish(stepLength(), gps.good(25));
      app.recording = null;
      if (!r.segments.length && r.track.length < 2) return say('No he detectado pasos, así que no he guardado la ruta. Prueba otra vez caminando con el teléfono en la mano.');
      store.saveRoute(r);
      const g = gps.good(25);
      if (g && !store.place(r.name)) store.savePlace({ name: r.name, lat: g.lat, lon: g.lon, acc: g.acc });
      arrivedAt(r.name);
      audio.cue.arrive();
      return say(`Ruta a ${r.name} guardada: ${describeRoute(r, stepLength())}. Cuando quieras volver aquí, di "llévame a ${r.name}".`);
    }
    if (app.nav) {
      const n = app.nav.route?.name || app.nav.name;
      app.nav = null;
      arrivedAt(n);
      return say(`Perfecto, estás en ${n}.`);
    }
    say('No estaba grabando ninguna ruta.');
  },

  navigate(cmd) {
    const routes = store.routeNames(), places = store.placeNames();
    const known = [...new Set([...routes, ...places])];
    // Lugares y rutas tuyos primero; si no, el mapa de calles.
    const name = findBest(cmd.name, known, app.map ? 0.75 : 0.6);
    if (!name) {
      if (app.map) return navigateMap(cmd.name);
      return say(known.length
        ? `No conozco ${cmd.name}. Conozco: ${known.slice(0, 8).join(', ')}. Si es una calle o un sitio de tu barrio, primero di: descarga el mapa.`
        : `Todavía no conozco ${cmd.name}. Si es una calle o un sitio de tu barrio, di: descarga el mapa. Si es dentro de casa, di: graba ruta a ${cmd.name}, y camina hasta allí.`);
    }
    app.finding = null;
    const route = store.route(name);
    const place = store.place(name);
    const gpsOk = gps.good(25);
    if (route && route.track?.length >= 2 && gpsOk) {
      startNav(new GpsGuide(name, route.track, navCtx()));
      app.lastRoute = route;
    } else if (place?.lat != null && gpsOk && (!route || geo.haversine(gpsOk, place) > 40)) {
      startNav(new GpsGuide(name, [place], navCtx()));
    } else if (route) {
      if (route.origin && app.here && normalize(route.origin) !== normalize(app.here)) {
        say(`Ojo: esta ruta empieza en ${route.origin}, y creo que estás en ${app.here}.`);
      }
      startNav(new StepGuide(route, navCtx()));
      app.lastRoute = route;
    } else if (place?.lat != null) {
      startNav(new GpsGuide(name, [place], navCtx()));
    } else {
      say(`Sé que existe ${name}, pero no tengo un camino. Graba una ruta diciendo "graba ruta a ${name}".`);
    }
  },

  go_back() {
    if (app.lastRoute) {
      const back = reverseRoute(app.lastRoute);
      say(`Te llevo de vuelta a ${back.name}.`);
      startNav(back.track.length >= 2 && gps.good(25) ? new GpsGuide(back.name, back.track, navCtx()) : new StepGuide(back, navCtx()));
      app.lastRoute = null;
      return;
    }
    const t = app.trail.finish(stepLength(), gps.good(25));
    if (t.totalSteps < 3) return say('No tengo un camino reciente para deshacer.');
    const back = reverseRoute(t, app.here || 'el punto de partida');
    startNav(back.track.length >= 2 && gps.good(25) ? new GpsGuide(back.name, back.track, navCtx()) : new StepGuide(back, navCtx()));
  },

  progress() {
    if (app.nav) say(app.nav.progress());
    else say('Ahora mismo no te estoy guiando a ningún sitio.');
  },

  async download_map() {
    const p = gps.good(60);
    if (!p) return say('Necesito señal GPS para saber qué zona descargar. Sal a la calle o acércate a una ventana y vuelve a pedírmelo.');
    if (!navigator.onLine) return say('Necesito conexión a internet solo para esta descarga.');
    const R = 2000;
    say('Descargo el mapa de calles de 2 kilómetros a tu alrededor, de OpenStreetMap. Es una sola vez y puede tardar un minuto.');
    try {
      const data = await downloadMap(p, R);
      await saveMap(data);
      app.map = new MapData(data);
      const st = app.map.stats;
      audio.cue.ok();
      const pl = (n, a, b) => `${n} ${n === 1 ? a : b}`;
      say(`Mapa guardado: ${pl(st.streets, 'calle', 'calles')}, ${pl(st.addresses, 'número de portal', 'números de portal')} y ${pl(st.places, 'lugar', 'lugares')}. Ya funciona sin internet. Prueba: llévame a la farmacia más cercana, o llévame a la calle y número que quieras.`);
    } catch {
      say('No he podido descargar el mapa. Comprueba la conexión y vuelve a intentarlo en un rato.');
    }
  },

  // ---------- lugares

  save_place(cmd) {
    const name = cmd.name;
    const g = gps.good(30);
    store.savePlace(g ? { name, lat: g.lat, lon: g.lon, acc: g.acc } : { name, indoor: true });
    arrivedAt(name);
    audio.cue.ok();
    if (g) say(`Guardado ${name}, con una precisión de ${Math.round(g.acc)} metros.`);
    else say(`He anotado que estás en ${name}. Como no hay buena señal GPS, para volver aquí graba una ruta: desde otro sitio di "graba ruta a ${name}" y camina hasta aquí.`);
  },

  set_origin(cmd) {
    const n = findBest(cmd.name, store.placeNames()) || cmd.name;
    arrivedAt(n);
    say(`Entendido, estás en ${n}.`);
  },

  delete(cmd) {
    const name = findBest(cmd.name, [...store.placeNames(), ...store.routeNames()]);
    if (!name) return say(`No encuentro ${cmd.name}.`);
    say(`¿Seguro que quieres borrar ${name}? Di sí o no.`);
    app.awaiting = {
      resolve: (c) => {
        if (c.intent === 'yes') { store.remove(name); say(`${labels.cap(name)} borrado.`); }
        else say('No he borrado nada.');
      },
    };
  },

  list() {
    const p = store.placeNames(), r = store.routeNames();
    if (!p.length && !r.length) return say('Todavía no he aprendido ningún lugar.');
    let msg = '';
    if (r.length) msg += `Rutas: ${r.join(', ')}. `;
    const onlyPlaces = p.filter((x) => !r.includes(x));
    if (onlyPlaces.length) msg += `Lugares: ${onlyPlaces.join(', ')}.`;
    say(msg);
  },

  where() {
    const p = gps.last;
    const parts = [];
    if (app.here) parts.push(`Lo último que sé es que estabas en ${app.here}.`);
    if (!p || Date.now() - p.t > 30000) {
      parts.push('No tengo señal GPS. Probablemente estás en interior.');
    } else {
      const known = store.placeNames().map((n) => store.place(n)).filter((x) => x.lat != null && geo.haversine(p, x) < 1500);
      if (known.length) {
        known.sort((a, b) => geo.haversine(p, a) - geo.haversine(p, b));
        const n = known[0];
        const d = geo.haversine(p, n);
        const rel = compass.heading != null ? geo.angleDiff(geo.bearing(p, n), compass.heading) : null;
        parts.push(d < 15 ? `Estás en ${n.name}.` : `Estás a ${geo.distancePhrase(d, stepLength())} de ${n.name}${rel != null ? ', ' + geo.clockPhrase(rel) : ''}.`);
      }
      const st = app.map && app.map.covers(p) ? app.map.streetAt(p) : null;
      if (st?.name && st.d < 40) {
        const num = app.map.nearestNumber(p, st.name);
        parts.unshift(`Estás en ${withArt(st.name)}${num ? ', cerca del número ' + num : ''}.`);
      } else if (!known.length) {
        parts.push(app.map
          ? `Tengo tu posición, con ${Math.round(p.acc)} metros de precisión, pero estás fuera del mapa descargado.`
          : `Tengo tu posición, con ${Math.round(p.acc)} metros de precisión. Para saber el nombre de la calle, di: descarga el mapa.`);
      }
      if (p.acc > 30) parts.push('La señal es débil.');
    }
    if (compass.heading != null) parts.push(`Miras hacia el ${geo.cardinal(compass.heading)}.`);
    say(parts.join(' '));
  },

  where_is(cmd) {
    const name = findBest(cmd.name, [...store.placeNames(), ...store.routeNames()]);
    if (!name) {
      const cls = labels.classFromSpanish(cmd.name);
      if (cls) return handlers.find({ name: cmd.name });
      return say(`No conozco ${cmd.name}.`);
    }
    const pl = store.place(name), p = gps.good(40);
    if (pl?.lat != null && p) {
      const d = geo.haversine(p, pl);
      const rel = compass.heading != null ? geo.angleDiff(geo.bearing(p, pl), compass.heading) : null;
      return say(`${labels.cap(name)} está a ${geo.distancePhrase(d, stepLength())}${rel != null ? ', ' + geo.clockPhrase(rel) : ''}.`);
    }
    const r = store.route(name);
    if (r) return say(`Tengo la ruta a ${name}: ${describeRoute(r, stepLength())}${r.origin ? ', desde ' + r.origin : ''}.`);
    say(`No sé a qué distancia está ${name} ahora mismo.`);
  },

  heading() {
    if (compass.heading == null) return say('No tengo brújula en este momento. Mueve el teléfono en forma de ocho para calibrarla.');
    say(`Miras hacia el ${geo.cardinal(compass.heading)}.`);
  },

  // ---------- visión

  async describe() {
    if (!vision.stream) return say('La cámara está apagada.');
    if (!vision.model) return say('El detector todavía se está cargando.');
    // Solo lo que se ha visto de forma estable; si aún no hay nada estable, miramos un momento.
    let objs = safety.confirmed();
    if (!objs.length) { await sleep(900); objs = safety.confirmed(); }
    const q = vision.quality;
    if (!objs.length) {
      let m = 'No reconozco objetos delante.';
      if (q?.dark) m += ' Hay poca luz.';
      else if (q && q.centerStd < 11) m += ' Puede que tengas una pared o superficie lisa enfrente.';
      return say(m);
    }
    const sorted = [...objs].sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
    const byGroup = new Map();
    for (const o of sorted) {
      const g = labels.group(o.cls);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(o);
    }
    const NUM = ['', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis'];
    const parts = [...byGroup.values()].slice(0, 5).map((list) => {
      const o = list[0];
      const where = o.clock === 12 ? 'delante' : `a las ${o.clock}`;
      const d = o.dist != null ? `, a ${geo.distancePhrase(o.dist, stepLength())}` : '';
      if (list.length > 1) {
        const n = list.length < NUM.length ? NUM[list.length] : list.length;
        const fem = labels.info(o.cls).g.startsWith('f');
        return `${n} ${labels.pluralName(o.cls)}, ${fem ? 'la más cercana' : 'el más cercano'} ${where}${d}`;
      }
      return `${labels.spokenIndef(o)} ${where}${d}`;
    });
    say('Veo ' + joinY(parts) + '.');
  },

  /** Descripción detallada con Claude: lee carteles, colores, por dónde pasar… */
  async look(cmd = {}) {
    if (!vision.stream) return say('La cámara está apagada.');
    if (!claude.hasKey) { say(claudeProblem('nokey')); return handlers.describe(); }
    if (!claude.online) { say(claudeProblem('offline')); return handlers.describe(); }
    const img = snapshot();
    if (!img) return say('Todavía no tengo imagen de la cámara. Espera un momento.');
    say('Mirando.', { priority: 'low', remember: false });
    audio.cue.listen?.();
    try {
      const st = brainState();
      const text = await claude.look(img, cmd.question || '', { delante: st.delante, calle: st.calle, rumbo: st.rumbo });
      say(text || 'No he podido describir la imagen.');
    } catch (e) {
      say(claudeProblem(e.code));
      return handlers.describe();
    }
  },

  find(cmd) {
    const cls = labels.classFromSpanish(cmd.name);
    if (!cls) {
      return say(`Todavía no sé reconocer ${cmd.name}. Reconozco unas 250 cosas: muebles, puertas, ventanas, escaleras, electrodomésticos, el baño, la calle, vehículos y casi 80 animales. Prueba con otra palabra.`);
    }
    if (!vision.model) return say('El detector todavía se está cargando.');
    app.finding = { cls, started: Date.now(), lastSay: 0, lastSeen: 0 };
    say(`Buscando ${labels.indef(cls)}. Gira despacio sobre ti mismo con el teléfono delante.`);
  },

  // ---------- pasos

  calibrate(cmd) {
    if (cmd.meters) return calibrateKnown(cmd.meters);
    const g = gps.good(12);
    if (g) return calibrateGps();
    say('Para medir tus pasos puedo usar: tu altura, por ejemplo di "mido uno setenta"; ' +
      'o una distancia conocida, di "calibra con diez metros" y camina esa distancia. ' +
      'En la calle, con buena señal GPS, también puedo calibrar solo.');
  },

  calibrate_height(cmd) {
    const sl = +(cmd.cm * 0.414 / 100).toFixed(2);
    S.heightCm = cmd.cm;
    S.stepLength = sl;
    S.calibrated = true;
    store.save();
    say(`Perfecto. Con ${cmd.cm} centímetros, tu paso mide unos ${Math.round(sl * 100)} centímetros. Para más precisión, calibra caminando una distancia conocida.`);
  },

  steps() {
    say(`Llevas ${ped.count} pasos, unos ${Math.round(ped.count * stepLength())} metros. Tu paso mide ${Math.round(stepLength() * 100)} centímetros${S.calibrated ? '' : ', aunque aún no está calibrado'}.`);
  },

  reset_steps() { ped.count = 0; say('Contador de pasos a cero.'); },

  // ---------- ajustes y utilidades

  time() {
    const d = new Date();
    say(`Son las ${d.getHours()} y ${d.getMinutes() === 0 ? 'en punto' : d.getMinutes()}.`);
  },
  date() {
    say('Hoy es ' + new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) + '.');
  },
  async battery() {
    try {
      const b = await navigator.getBattery();
      say(`Batería al ${Math.round(b.level * 100)} por ciento${b.charging ? ', cargando' : ''}.`);
    } catch { say('No puedo leer la batería en este teléfono.'); }
  },
  async torch_on() { say((await vision.torch(true)) ? 'Linterna encendida.' : 'No puedo encender la linterna en este teléfono.'); },
  async torch_off() { await vision.torch(false); say('Linterna apagada.'); },
  sonar_on() { S.sonar = true; store.save(); sonar.start(); say('Sónar activado: cuanto más rápido pite, más cerca está el obstáculo. El sonido a un lado indica de qué lado está.'); },
  sonar_off() { S.sonar = false; store.save(); sonar.stop(); say('Sónar desactivado.'); },
  camera_on() {
    (vision.stream ? Promise.resolve() : vision.startCamera())
      .then(() => { vision.start(); safety.enabled = true; say('Vigilancia de obstáculos activada.'); })
      .catch(() => say('No puedo abrir la cámara.'));
  },
  camera_off() { safety.enabled = false; vision.stopCamera(); sonar.update(0); say('Cámara apagada. Ya no te aviso de obstáculos; ve con cuidado.'); },
  aim() { const p = aimProblem({ strict: true }); say(!p ? 'La cámara está bien colocada.' : p === 'dark' ? 'Hay poca luz.' : p); },
  faster() { S.rate = Math.min(2, +(S.rate + 0.15).toFixed(2)); store.save(); say('Así hablo más rápido.'); },
  slower() { S.rate = Math.max(0.6, +(S.rate - 0.15).toFixed(2)); store.save(); say('Así hablo más despacio.'); },
  next_voice() { const n = voice.nextVoice(); say(n ? `Ahora hablo con la voz ${n}. ¿Te gusta?` : 'Solo tengo una voz en español en este teléfono.'); },
  brain_on() { enableBrain(); },
  brain_off() { S.brain = false; store.save(); try { brain.engine?.unload?.(); } catch {} brain.engine = null; brain.history = []; say('Modo inteligente desactivado.'); updateInfo(); },
  handsfree_on() {
    S.handsFree = true; store.save();
    say('Manos libres activado. Empieza tus órdenes diciendo "Faro", por ejemplo: Faro, qué hay delante.');
    handsFreeLoop();
  },
  handsfree_off() { S.handsFree = false; store.save(); listener.abort(); say('Manos libres desactivado. Toca la pantalla para hablarme.'); },
};

function joinY(parts) {
  return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' y ' + parts[parts.length - 1];
}

// ------------------------------------------------------------------ navegación

function navCtx() {
  return {
    say, cue: audio.cue,
    heading: () => compass.heading,
    stepLength,
    position: () => gps.good(40),
    walking: () => ped.walking,
    onArrive: (name) => { app.nav = null; arrivedAt(name); },
    reroute: (guide) => {
      const p = gps.good(40) || guide.pos;
      const rt = p && app.map?.route(p, guide.dest);
      if (rt) { guide._load(rt); guide.start(false); }
    },
  };
}

function navigateMap(text) {
  const p = gps.good(40) || gps.last;
  const dest = app.map.find(text, p);
  if (!dest) return say(`No encuentro ${text} en el mapa. Prueba con el nombre de la calle y el número, o con un tipo de sitio, como farmacia o parada de autobús.`);
  if (dest.notFound) return say(dest.notFound);
  if (!p) return say(`He encontrado ${dest.label}, pero necesito señal GPS para guiarte. Sal a un sitio abierto.`);
  if (!app.map.covers(p)) return say('Estás fuera de la zona del mapa descargado. Di: descarga el mapa, para bajar esta zona.');
  const rt = app.map.route(p, dest);
  app.finding = null;
  if (!rt) {
    say(`No encuentro un camino a pie hasta ${dest.label}; te indico la dirección en línea recta.`);
    return startNav(new GpsGuide(dest.label, [dest], navCtx()));
  }
  startNav(new MapGuide(app.map, dest, rt, navCtx()));
}

function startNav(guide) {
  app.nav = guide;
  guide.start();
}

function arrivedAt(name) {
  app.here = name;
  app.trail = new RouteRecorder(name, null);
}

// ------------------------------------------------------------------ búsqueda de objetos

function onFinding(objects) {
  const f = app.finding;
  const now = Date.now();
  if (now - f.started > 90000) {
    app.finding = null;
    return say(`No he encontrado ${labels.indef(f.cls)}. Dejo de buscar.`);
  }
  const hits = objects.filter((o) => labels.group(o.cls) === labels.group(f.cls) || (o.alt && labels.group(o.alt) === labels.group(f.cls))).sort((a, b) => (a.dist ?? 99) - (b.dist ?? 99));
  if (!hits.length) {
    if (now - Math.max(f.lastSeen, f.started) > 8000 && now - f.lastSay > 8000) {
      f.lastSay = now;
      say('Aún no lo veo. Sigue girando despacio.', { priority: 'low' });
    }
    return;
  }
  const o = hits[0];
  f.lastSeen = now;
  if (o.dist != null && o.dist < 0.9 && o.clock === 12) {
    app.finding = null;
    audio.cue.arrive();
    return say(`${labels.cap(labels.def(o.cls))} está justo delante de ti, al alcance de la mano.`, { priority: 'urgent' });
  }
  if (now - f.lastSay < 3500) return;
  f.lastSay = now;
  audio.cue.turn(Math.max(-1, Math.min(1, o.angle / 30)));
  const where = o.clock === 12 ? 'justo delante' : `a las ${o.clock}`;
  const d = o.dist != null ? `, a ${geo.distancePhrase(o.dist, stepLength())}` : '';
  say(`${labels.cap(labels.def(o.cls))} está ${where}${d}.`, { priority: 'low' });
}

// ------------------------------------------------------------------ calibración de pasos

function finishCalib(meters, steps) {
  app.calib = null;
  if (steps < 6) return say('He contado muy pocos pasos. Repite la calibración caminando a tu ritmo normal.');
  const sl = meters / steps;
  if (sl < 0.3 || sl > 1.1) return say(`Me sale un paso de ${Math.round(sl * 100)} centímetros, que no parece correcto. Repitamos la calibración.`);
  S.stepLength = +sl.toFixed(3);
  S.calibrated = true;
  store.save();
  audio.cue.ok();
  say(`Calibrado. Has dado ${steps} pasos en ${Math.round(meters)} metros: tu paso mide ${Math.round(sl * 100)} centímetros.`);
}

function calibrateKnown(meters) {
  const c = { steps: 0, onStep() { c.steps++; }, finish: () => finishCalib(meters, c.steps) };
  app.calib = c;
  say(`De acuerdo. Camina en línea recta ${meters} metros a tu ritmo normal. Cuando llegues, di "he llegado".`);
}

function calibrateGps() {
  const TARGET = 50;
  const c = {
    steps: 0, start: null, samples: [],
    onPosition(p) {
      if (p.acc > 12) return;
      if (!c.start) { c.samples.push(p); if (c.samples.length >= 3) { c.start = avg(c.samples); say('Ya. Empieza a caminar recto.'); } }
    },
    onStep() {
      if (!c.start) return;
      c.steps++;
      if (c.steps === TARGET) {
        const end = gps.good(12);
        if (!end) { app.calib = null; return say('He perdido la señal GPS. Prueba con "calibra con diez metros".'); }
        finishCalib(geo.haversine(c.start, end), c.steps);
      }
    },
  };
  app.calib = c;
  say(`Calibración con GPS. Quédate quieto unos segundos en un sitio abierto, y cuando te avise camina recto unos ${TARGET} pasos por un camino seguro.`);
}

function avg(ps) {
  return { lat: ps.reduce((a, p) => a + p.lat, 0) / ps.length, lon: ps.reduce((a, p) => a + p.lon, 0) / ps.length };
}

// ------------------------------------------------------------------ modo inteligente

async function enableBrain(silent = false) {
  if (!Brain.supported) return say('Este teléfono no admite el modo inteligente, porque su navegador no tiene WebGPU. Sigo entendiendo las órdenes normales.');
  if (brain.ready) return say('El modo inteligente ya está activo.');
  if (!silent) say('Activando el modo inteligente. La primera vez descargo un modelo de entre uno y dos gigas y medio, según tu teléfono, que después funciona sin conexión y sin enviar nada fuera del teléfono. Te aviso cuando esté listo.');
  let lastPct = -1;
  try {
    await brain.load((pr) => {
      const pct = Math.floor(pr * 4) * 25;
      if (pct > lastPct && pct > 0 && pct < 100) { lastPct = pct; say(`Modo inteligente al ${pct} por ciento.`, { priority: 'low', remember: false }); }
    });
    S.brain = true;
    store.save();
    say('Modo inteligente listo. Ahora puedes hablarme con más libertad.');
  } catch {
    say('No he podido cargar el modo inteligente. Necesito conexión la primera vez y bastante memoria libre.');
  }
}

// ------------------------------------------------------------------ pantalla (para acompañantes)

function updateInfo() {
  const p = gps.last;
  const gpsOk = p && Date.now() - p.t < 30000;
  const parts = [];
  if (app.recording) parts.push('● grabando ruta');
  if (app.nav) parts.push(`→ ${app.nav.route?.name || app.nav.name}`);
  parts.push(gpsOk ? `GPS ±${Math.round(p.acc)} m` : 'GPS buscando…');
  parts.push(`${ped.count} pasos`);
  parts.push(`paso ${Math.round(stepLength() * 100)} cm`);
  parts.push(`brújula ${compass.heading != null ? geo.cardinal(compass.heading) : 'no'}`);
  parts.push(`cámara ${app.camOk ? 'sí' : 'no'}`);
  const st = $('status');
  if (st) st.textContent = parts.join(' · ');

  const set = (id, on) => { const b = $(id); if (b) b.setAttribute('aria-pressed', String(!!on)); };
  set('tglSonar', S.sonar);
  set('tglHands', S.handsFree);
  set('tglTorch', vision.torchOn);
  set('tglBrain', brain.ready || brain.loading);
  const ks = $('keyState');
  if (ks) ks.textContent = claude.hasKey ? `Clave guardada (…${S.claudeKey.slice(-4)}).` : 'Sin clave: Faro funciona solo con lo que hay en el teléfono.';
  if ($('keyDel')) $('keyDel').hidden = !claude.hasKey;
  set('tglCam', !$('camwrap')?.classList.contains('off'));

  const ul = $('checks');
  if (!ul || !$('checksBox')?.open && ul.children.length) return;
  const rows = [
    ['ok', 'Voz', speechSynthesis.getVoices().length ? 'sí' : 'cargando voces…'],
    [listener.supported ? 'ok' : 'no', 'Escucha', listener.supported ? 'sí' : 'no: usa los botones o escribe en Ajustes'],
    [app.camOk ? 'ok' : 'no', 'Cámara', app.camOk ? 'sí' : 'no hay permiso o no hay cámara'],
    [vision.model ? 'ok' : app.modelFailed ? 'no' : 'meh', 'Detector de obstáculos',
      vision.model ? (vision.kind?.includes('casa') ? 'general + especialista de casa' : 'general') + (vision.kind?.includes('webgpu') ? ', rápido (WebGPU)' : ', modo lento (sin WebGPU)')
        : app.modelFailed ? 'no se pudo descargar' : 'cargando…'],
    [gpsOk ? 'ok' : 'meh', 'GPS', gpsOk ? `precisión ±${Math.round(p.acc)} m` : 'buscando señal (en casa es normal)'],
    [compass.heading != null ? 'ok' : 'no', 'Brújula', compass.heading != null ? 'sí' : 'no da datos'],
    [app.motionOk !== false ? 'ok' : 'no', 'Contador de pasos', app.motionOk !== false ? 'sí' : 'sin permiso de movimiento'],
    [claude.ready ? 'ok' : claude.hasKey ? 'meh' : 'no', 'Claude (por internet)',
      claude.ready ? 'activo con tu clave' : claude.hasKey ? 'clave puesta, pero sin internet' : 'sin clave; ponla en Ajustes'],
    [brain.ready ? 'ok' : Brain.supported ? 'meh' : 'no', 'Modo inteligente',
      brain.ready ? `activo (${brain.model.split('-q4')[0]})` : brain.loading ? 'descargando…' : Brain.supported ? 'apagado; actívalo en Ajustes' : 'este navegador no tiene WebGPU'],
    [app.map ? 'ok' : 'meh', 'Mapa de calles', app.map ? 'descargado' : 'no; di "descarga el mapa"'],
    ['wakeLock' in navigator ? 'ok' : 'meh', 'Pantalla encendida', 'wakeLock' in navigator ? 'sí' : 'puede apagarse sola'],
  ];
  ul.replaceChildren(...rows.map(([c, k, v]) => {
    const li = document.createElement('li');
    li.className = c;
    li.innerHTML = `<b>${c === 'ok' ? '✓' : c === 'no' ? '✗' : '…'}</b> ${k}: <span></span>`;
    li.lastChild.textContent = v;
    return li;
  }));
}

/** Dibuja los objetos sobre el vídeo, que se muestra con object-fit: cover (recortado, sin deformar). */
function drawOverlay(objects, W, H) {
  const c = $('overlay');
  if (!c || !W) return;
  const dpr = window.devicePixelRatio || 1;
  const cw = c.clientWidth, ch = c.clientHeight;
  if (c.width !== Math.round(cw * dpr) || c.height !== Math.round(ch * dpr)) {
    c.width = Math.round(cw * dpr);
    c.height = Math.round(ch * dpr);
  }
  const g = c.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, cw, ch);
  const k = Math.max(cw / W, ch / H);
  const ox = (cw - W * k) / 2, oy = (ch - H * k) / 2;
  g.font = '700 15px system-ui, sans-serif';
  g.lineWidth = 3;
  g.lineJoin = 'round';
  for (const o of objects) {
    const [x, y, w, h] = o.bbox;
    const X = ox + x * k, Y = oy + y * k, Wd = w * k, Ht = h * k;
    const danger = o.inPath && o.obstacle && o.dist != null && o.dist < 2.5;
    const col = danger ? '#ff453a' : o.inPath && o.obstacle ? '#ffd60a' : 'rgba(255,255,255,.85)';
    g.strokeStyle = col;
    g.beginPath();
    g.roundRect ? g.roundRect(X, Y, Wd, Ht, 12) : g.rect(X, Y, Wd, Ht);
    g.stroke();
    const label = `${labels.spoken(o)}${o.dist != null ? ' · ' + o.dist.toFixed(1) + ' m' : ''}`;
    const tw = g.measureText(label).width + 16;
    const ly = Math.min(ch - 28, Math.max(4, Y - 28));
    const lx = Math.min(cw - tw - 4, Math.max(4, X));
    g.fillStyle = col;
    g.beginPath();
    g.roundRect ? g.roundRect(lx, ly, tw, 24, 12) : g.rect(lx, ly, tw, 24);
    g.fill();
    g.fillStyle = danger ? '#fff' : '#111';
    g.fillText(label, lx + 8, ly + 17);
  }
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// para depurar desde la consola
window.faro = { handle, app, store, vision, ped, compass, gps };
