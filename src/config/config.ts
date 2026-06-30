// Ventana de config (escritorio): sensibilidad + calibracion (360 + sprays) + baseline + logs.
// require lo provee webpack al bundlear.
declare function require(module: string): any;
const { sensMath } = require('../engine/calibration');

const CONFIG_KEY = 'aimcoach_config';

interface AppConfig {
  dpi: number;
  sens: number;
  capturerPath?: string;
  overlayScale?: number;
  overlayMaxItems?: number;
  calWeapon?: string;
  baselines?: { [weapon: string]: any };
}

function loadConfig(): AppConfig {
  try {
    const c = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (c) return c;
  } catch (_) {}
  return { dpi: 800, sens: 0.4 };
}

function saveConfig(c: AppConfig): void {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
}

let config = loadConfig();

const $ = (id: string) => document.getElementById(id);
const dpiInput = $('dpi') as HTMLInputElement;
const sensInput = $('sens') as HTMLInputElement;

function applyToBackground(): void {
  overwolf.windows.sendMessage('background', 'apply-config', config, () => {});
}

// ---- sensibilidad ----
function renderSensReadout(): void {
  const dpi = parseFloat(dpiInput.value);
  const sens = parseFloat(sensInput.value);
  const el = $('sensReadout');
  if (!el || !dpi || !sens) return;
  const m = sensMath(dpi, sens);
  el.innerHTML =
    `<b>${m.cmPer360} cm/360°</b> · ${Math.round(m.countsPer360)} counts/360° · ` +
    `${m.countsPerDegree.toFixed(2)} counts/grado`;
}

function renderBaseline(): void {
  const el = $('baselineView');
  if (!el) return;
  const b = config.baselines || {};
  const weapons = Object.keys(b);
  if (!weapons.length) { el.textContent = '— (ningún arma calibrada, usando default)'; return; }
  el.textContent = weapons.map(w =>
    `${w}: pull ${b[w].pullPerMsBaseline} · mono ${b[w].monotonicityBaseline} · flickBias ${b[w].flickBias}`
  ).join('\n');
}

dpiInput.addEventListener('input', renderSensReadout);
sensInput.addEventListener('input', renderSensReadout);

$('saveSens')?.addEventListener('click', () => {
  config.dpi = parseFloat(dpiInput.value);
  config.sens = parseFloat(sensInput.value);
  saveConfig(config);
  applyToBackground();
  setStatus('cal360Status', 'Sensibilidad guardada.', 'ok');
});

const calWeaponSelect = $('calWeapon') as HTMLSelectElement;
calWeaponSelect?.addEventListener('change', () => {
  config.calWeapon = calWeaponSelect.value;
  saveConfig(config);
  applyToBackground();
});

const capturerInput = $('capturerPath') as HTMLInputElement;
$('saveCapturer')?.addEventListener('click', () => {
  config.capturerPath = capturerInput.value.trim();
  saveConfig(config);
  applyToBackground();
  setStatus('capturerStatus', 'Ruta guardada. La app intentará lanzar el capturer.', 'ok');
});

// ---- overlay: tamaño y cantidad de errores ----
const overlayScaleInput = $('overlayScale') as HTMLInputElement;
const overlayMaxInput = $('overlayMaxItems') as HTMLInputElement;
function renderOverlayLabels(): void {
  const sv = $('overlayScaleVal'); if (sv) sv.textContent = parseFloat(overlayScaleInput.value).toFixed(1) + '×';
}
overlayScaleInput?.addEventListener('input', () => {
  config.overlayScale = parseFloat(overlayScaleInput.value);
  renderOverlayLabels(); saveConfig(config); applyToBackground();
});
overlayMaxInput?.addEventListener('input', () => {
  config.overlayMaxItems = parseInt(overlayMaxInput.value, 10) || 3;
  saveConfig(config); applyToBackground();
});

// ---- helpers UI ----
function setStatus(id: string, text: string, cls = ''): void {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}
function setDisabled(id: string, disabled: boolean): void {
  const el = $(id) as HTMLButtonElement;
  if (el) el.disabled = disabled;
}

// ---- calibracion (disparo unico; el flujo es por tiempo, dirigido en el overlay) ----
$('cal360Start')?.addEventListener('click', () => {
  overwolf.windows.sendMessage('background', 'cal-360-start', {}, () => {});
  setStatus('cal360Status', 'Mirá el overlay in-game: cuenta regresiva y girá una vuelta limpia.');
});
$('calSprayStart')?.addEventListener('click', () => {
  overwolf.windows.sendMessage('background', 'cal-spray-start', {}, () => {});
  setStatus('calSprayStatus', 'Mirá el overlay in-game: 30s para sprayear en el Range.');
});

// ---- overlay / log ----
$('toggleBtn')?.addEventListener('click', () =>
  overwolf.windows.sendMessage('background', 'toggle-overlay', {}, () => {})
);
$('clearBtn')?.addEventListener('click', () => {
  const el = $('log');
  if (el) el.innerHTML = '';
});

function addLine(text: string): void {
  const el = $('log');
  if (!el) return;
  const div = document.createElement('div');
  div.className =
    'line' +
    (/error|fall|fail|threw/i.test(text) ? ' err' : '') +
    (/\bok\b|detectad|conectad|activ|capturando|derivado/i.test(text) ? ' ok' : '');
  div.textContent = '[' + new Date().toLocaleTimeString() + '] ' + text;
  el.appendChild(div);
  el.scrollTop = el.scrollHeight;
}

// ---- mensajes del background ----
overwolf.windows.onMessageReceived.addListener((m: any) => {
  switch (m.id) {
    case 'log':
      if (m.content) addLine(m.content.line);
      break;
    case 'cal-progress':
      if (m.content) setStatus('calSprayStatus', `Calibrando… ${m.content.sprays} sprays capturados.`);
      break;
    case 'cal-msg':
      if (m.content) setStatus('calSprayStatus', m.content.text, 'err');
      break;
    case 'cal-spray-result':
      if (m.content && m.content.baseline && m.content.weapon) {
        if (!config.baselines) config.baselines = {};
        config.baselines[m.content.weapon] = m.content.baseline;
        saveConfig(config);
        applyToBackground();
        renderBaseline();
        setStatus('calSprayStatus', `Baseline de ${m.content.weapon} calibrado y guardado.`, 'ok');
      } else {
        setStatus('calSprayStatus', 'No se pudo: ' + (m.content && m.content.error), 'err');
      }
      break;
    case 'cal-360-result':
      if (m.content) {
        const r = m.content;
        setStatus('cal360Status',
          `Sens medida ${r.measuredSens} vs ${r.reportedSens} (drift ${r.driftPct}%) — ${r.ok ? 'OK' : 'revisá DPI/aceleración'}`,
          r.ok ? 'ok' : 'err');
      }
      break;
  }
});

// ---- controles de ventana (mover / minimizar / cerrar) ----
let currentWindowId = '';
overwolf.windows.getCurrentWindow((res: any) => {
  if (res && res.success && res.window) currentWindowId = res.window.id;
});
$('titlebar')?.addEventListener('mousedown', (e) => {
  if ((e.target as HTMLElement).closest('.winctrls')) return; // no arrastrar desde los botones
  if (currentWindowId) overwolf.windows.dragMove(currentWindowId);
});
$('winMin')?.addEventListener('click', () => { if (currentWindowId) overwolf.windows.minimize(currentWindowId); });
$('winClose')?.addEventListener('click', () => { if (currentWindowId) overwolf.windows.close(currentWindowId); });

// redimensionado (ventana sin marco -> grips en borde derecho, inferior y esquina)
$('gripR')?.addEventListener('mousedown', () => { if (currentWindowId) overwolf.windows.dragResize(currentWindowId, overwolf.windows.enums.WindowDragEdge.Right); });
$('gripB')?.addEventListener('mousedown', () => { if (currentWindowId) overwolf.windows.dragResize(currentWindowId, overwolf.windows.enums.WindowDragEdge.Bottom); });
$('gripBR')?.addEventListener('mousedown', () => { if (currentWindowId) overwolf.windows.dragResize(currentWindowId, overwolf.windows.enums.WindowDragEdge.BottomRight); });

// ---- init ----
dpiInput.value = String(config.dpi);
sensInput.value = String(config.sens);
capturerInput.value = config.capturerPath || '';
overlayScaleInput.value = String(config.overlayScale || 1);
overlayMaxInput.value = String(config.overlayMaxItems || 3);
if (calWeaponSelect && config.calWeapon) calWeaponSelect.value = config.calWeapon;
renderOverlayLabels();
renderSensReadout();
renderBaseline();
applyToBackground();
addLine('Config lista. El overlay vive dentro del juego: abrí Valorant y se abre solo. Toggle: Ctrl+Shift+A.');

export {};
