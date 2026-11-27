import { MAX_SPEED, clampSpeed, buildCommand, bytesToHex, hexToBytes, TRANSPORTS, CHECKSUMS, COMMANDS,
  normalizeProfile, parseTelemetry } from './protocols.js';
import { BleLink, NativeBleLink, DemoLink, bluetoothAvailable, isNativeApp } from './ble.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const KEY = 'patin.profile';
const STATE_KEY = 'patin.state';

const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

let profile = normalizeProfile(load(KEY, null));
const state = { link: null, power: false, speed: clampSpeed(load(STATE_KEY, {}).speed ?? 25), lights: 'lightsOff', color: null };

// ---------- registro ----------
const logEl = $('#log');
function log(msg, kind = '') {
  const t = new Date().toLocaleTimeString('es', { hour12: false });
  const line = document.createElement('span');
  line.className = kind;
  line.textContent = `${t}  ${msg}\n`;
  logEl.prepend(line);
  while (logEl.childNodes.length > 200) logEl.lastChild.remove();
}
const setStatus = (text, kind = '') => { const s = $('#status'); s.textContent = text; s.dataset.kind = kind; };

// ---------- envío ----------
async function send(action, vars = {}) {
  if (!state.link) { setStatus('Conecta el patín primero', 'warn'); return false; }
  let bytes;
  try {
    bytes = buildCommand(profile.commands[action], vars, profile.checksum);
  } catch (e) {
    if (!(state.link instanceof DemoLink)) { setStatus(`${COMMANDS[action]}: ${e.message}`, 'warn'); log(`${COMMANDS[action]}: ${e.message}`, 'err'); return false; }
    bytes = new Uint8Array(0); // la demo funciona sin comandos configurados
  }
  try {
    await state.link.send(bytes, { action, ...vars });
    log(`→ ${COMMANDS[action]}${vars.speed !== undefined ? ` ${vars.speed} km/h` : ''}  ${bytesToHex(bytes) || '(demo)'}`, 'out');
    return true;
  } catch (e) {
    setStatus(`Error al enviar: ${e.message}`, 'err');
    log(`Error al enviar: ${e.message}`, 'err');
    return false;
  }
}

// ---------- conexión ----------
function setConnected(on) {
  $$('main button, main input:not(#import), main select').forEach((el) => {
    if (el.closest('#settings')) return;
    if (el.matches('[data-step], [data-speed], #speed, #power, #lights button, #colors button, #color-custom, #raw-send')) el.disabled = !on;
  });
  $('#connect').textContent = on ? 'Desconectar' : 'Conectar';
  $('#demo').hidden = on;
  if (!on) { $('#live').textContent = '--'; drawArc('#arc-speed', 0); }
}

async function connect(useDemo) {
  if (state.link) { state.link.disconnect(); return; }
  const link = useDemo ? new DemoLink() : isNativeApp() ? new NativeBleLink() : new BleLink();
  link.onData = onData;
  link.onClose = () => { state.link = null; setConnected(false); setPower(false); setStatus('Desconectado'); log('Desconectado'); };
  setStatus(useDemo ? 'Iniciando demostración…' : 'Buscando patín…');
  try {
    const name = await link.connect(profile);
    state.link = link;
    setConnected(true);
    setStatus(`Conectado a ${name}`, 'ok');
    log(`Conectado a ${name}`);
  } catch (e) {
    const msg = e.name === 'NotFoundError' ? 'No se eligió ningún patín' : e.message;
    setStatus(msg, 'err');
    log(msg, 'err');
  }
}

function onData(bytes) {
  const demo = state.link instanceof DemoLink;
  const v = demo ? bytes[2] : parseTelemetry(bytes, profile.speedByte);
  if (v !== null && v !== undefined) {
    $('#live').textContent = v;
    drawArc('#arc-speed', v / MAX_SPEED);
  }
  if (!demo) log(`← ${bytesToHex(bytes)}`, 'in');
}

// ---------- indicador ----------
const ARC_LEN = Math.PI * 85;
function drawArc(sel, frac) {
  const el = $(sel);
  el.style.strokeDasharray = `${ARC_LEN}`;
  el.style.strokeDashoffset = `${ARC_LEN * (1 - Math.max(0, Math.min(1, frac)))}`;
}

// ---------- encendido ----------
function setPower(on) {
  state.power = on;
  const b = $('#power');
  b.setAttribute('aria-pressed', String(on));
  $('#power-label').textContent = on ? 'Encendido' : 'Apagado';
}

function confirmDialog(text) {
  const d = $('#confirm');
  if (!d.showModal) return Promise.resolve(window.confirm(text));
  $('#confirm-text').textContent = text;
  d.showModal();
  return new Promise((res) => d.addEventListener('close', () => res(d.returnValue === 'yes'), { once: true }));
}

$('#power').addEventListener('click', async () => {
  if (state.power) {
    const ok = await confirmDialog('¿Apagar el patín? Hazlo solo cuando esté parado.');
    if (ok && await send('powerOff')) setPower(false);
  } else if (await send('powerOn')) {
    setPower(true);
    send('speed', { speed: state.speed }); // aplica el límite elegido nada más encender
  }
});

// ---------- velocidad ----------
const slider = $('#speed');
function showSpeed(v) {
  slider.value = v;
  $('#speed-out').textContent = v;
  $('#limit-label').textContent = v;
  slider.style.setProperty('--fill', `${(v / MAX_SPEED) * 100}%`);
  drawArc('#arc-limit', v / MAX_SPEED);
  $$('[data-speed]').forEach((c) => c.classList.toggle('on', Number(c.dataset.speed) === v));
}
async function applySpeed(v) {
  state.speed = clampSpeed(v);
  showSpeed(state.speed);
  save(STATE_KEY, { speed: state.speed });
  if (await send('speed', { speed: state.speed })) setStatus(`Velocidad máxima: ${state.speed} km/h`, 'ok');
}
slider.max = MAX_SPEED;
slider.addEventListener('input', () => showSpeed(clampSpeed(slider.value)));
slider.addEventListener('change', () => applySpeed(slider.value));
$$('[data-step]').forEach((b) => b.addEventListener('click', () => applySpeed(state.speed + Number(b.dataset.step))));
$$('[data-speed]').forEach((b) => b.addEventListener('click', () => applySpeed(Number(b.dataset.speed))));

// ---------- luces ----------
function showLights() {
  $$('#lights button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === state.lights)));
  $$('#colors button').forEach((b) => b.classList.toggle('on', b.dataset.color === state.color));
}
$$('#lights button').forEach((b) => b.addEventListener('click', async () => {
  if (await send(b.dataset.mode)) { state.lights = b.dataset.mode; showLights(); }
}));
async function setColor(hex) {
  const n = parseInt(hex, 16);
  if (await send('lightsColor', { r: n >> 16, g: (n >> 8) & 0xff, b: n & 0xff })) {
    state.color = hex;
    if (state.lights === 'lightsOff') state.lights = 'lightsOn';
    showLights();
  }
}
$$('#colors button').forEach((b) => b.addEventListener('click', () => setColor(b.dataset.color)));
$('#color-custom').addEventListener('change', (e) => setColor(e.target.value.slice(1)));

// ---------- consola ----------
$('#raw-send').addEventListener('click', async () => {
  try {
    const bytes = hexToBytes($('#raw').value);
    await state.link.send(bytes, { action: 'raw' });
    log(`→ ${bytesToHex(bytes)}`, 'out');
  } catch (e) { log(e.message, 'err'); }
});

// ---------- ajustes ----------
function fillSettings() {
  $('#f-transport').innerHTML = Object.entries(TRANSPORTS).map(([k, t]) => `<option value="${k}">${t.name}</option>`).join('')
    + '<option value="custom">Personalizado</option>';
  $('#f-checksum').innerHTML = Object.entries(CHECKSUMS).map(([k, t]) => `<option value="${k}">${t}</option>`).join('');
  $('#f-commands').innerHTML = Object.entries(COMMANDS).map(([k, label]) =>
    `<label>${label}<input data-cmd="${k}" spellcheck="false" placeholder="${k === 'speed' ? 'p. ej. 55 AA 04 20 03 {v} 00' : k === 'lightsColor' ? 'p. ej. A5 {r}{g}{b} 5A' : 'bytes en hexadecimal'}"></label>`).join('');
  for (const k of ['namePrefix', 'transport', 'service', 'write', 'notify', 'speedByte', 'checksum']) $(`#f-${k}`).value = profile[k] ?? '';
  $('#f-withResponse').checked = !!profile.withResponse;
  $$('[data-cmd]').forEach((i) => { i.value = profile.commands[i.dataset.cmd] || ''; });
}
$('#f-transport').addEventListener('change', (e) => {
  const t = TRANSPORTS[e.target.value];
  if (t) for (const k of ['service', 'write', 'notify']) $(`#f-${k}`).value = t[k];
});
function readSettings() {
  const p = { ...profile, commands: {} };
  for (const k of ['namePrefix', 'transport', 'service', 'write', 'notify', 'speedByte', 'checksum']) p[k] = $(`#f-${k}`).value.trim();
  p.withResponse = $('#f-withResponse').checked;
  $$('[data-cmd]').forEach((i) => { p.commands[i.dataset.cmd] = i.value.trim(); });
  return normalizeProfile(p);
}
$('#save').addEventListener('click', () => {
  const p = readSettings();
  for (const [k, tpl] of Object.entries(p.commands)) {
    if (!tpl) continue;
    try { buildCommand(tpl, { speed: 25, r: 1, g: 2, b: 3 }, p.checksum); } catch (e) { setStatus(`${COMMANDS[k]}: ${e.message}`, 'err'); return; }
  }
  profile = p;
  save(KEY, profile);
  fillSettings();
  setStatus(state.link ? 'Ajustes guardados (reconecta si cambiaste los UUID)' : 'Ajustes guardados', 'ok');
});
$('#export').addEventListener('click', async () => {
  if (isNativeApp()) { // en el APK no hay descargas: se copia al portapapeles
    try { await navigator.clipboard.writeText(JSON.stringify(readSettings(), null, 2)); setStatus('Perfil copiado al portapapeles', 'ok'); }
    catch { setStatus('No se pudo copiar el perfil', 'err'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(readSettings(), null, 2)], { type: 'application/json' }));
  a.download = 'perfil-patin.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#import').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    profile = normalizeProfile(JSON.parse(await f.text()));
    save(KEY, profile);
    fillSettings();
    setStatus('Perfil importado', 'ok');
  } catch { setStatus('Ese archivo no es un perfil válido', 'err'); }
  e.target.value = '';
});

// ---------- inicio ----------
$('#connect').addEventListener('click', () => connect(false));
$('#demo').addEventListener('click', () => connect(true));
fillSettings();
showSpeed(state.speed);
showLights();
setConnected(false);
drawArc('#arc-speed', 0);
if (!bluetoothAvailable()) setStatus('Sin Bluetooth web en este navegador: usa Chrome (Android/PC) o prueba la Demo', 'warn');
if (!Object.values(profile.commands).some(Boolean)) log('Configura los comandos de tu patín en «Ajustes del patín», o prueba la Demo.');
if (!isNativeApp() && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
