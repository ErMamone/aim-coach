// Ventana de config (escritorio): sensibilidad + calibracion (360 + sprays) + baseline + logs.
import { sensMath } from '../engine/calibration';

const CONFIG_KEY = 'aimcoach_config';

interface AppConfig {
  dpi: number;
  sens: number;
  capturerPath?: string;
  overlayScale?: number;
  overlayMaxItems?: number;
  overlayWidthPct?: number;
  overlayHeightPct?: number;
  overlayCorner?: string;   // 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
  overlayOpacity?: number;  // 0.3–1
  recoilLeft?: number;      // mini-traza de recoil: X (% de la ventana)
  recoilTop?: number;       // mini-traza de recoil: Y (% de la ventana)
  recoilScale?: number;     // mini-traza de recoil: tamaño
  debug?: boolean;  // Modo Debugger: muestra el panel de logs internos
  lang?: string;    // idioma de la UI: 'es' | 'en'
  calWeapon?: string;
  baselines?: { [weapon: string]: any };
  recoilRefs?: { [weapon: string]: any };
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

const config = loadConfig();

// ---- i18n (ES/EN): diccionario + t() con interpolación {var}; el HTML estático usa data-i18n ----
type Lang = 'es' | 'en';
const I18N: { [key: string]: { es: string; en: string } } = {
  debug: { es: 'Modo Debugger', en: 'Debug mode' },
  'sens.title': { es: 'Sensibilidad', en: 'Sensitivity' },
  'sens.help': { es: 'Poné el DPI de tu mouse y la sens de Valorant. Con eso convertimos tus movimientos a grados y podemos medir tu aim.', en: 'Set your mouse DPI and Valorant sensitivity. We convert your movement into degrees to measure your aim.' },
  'sens.dpi': { es: 'DPI del mouse', en: 'Mouse DPI' },
  'sens.ingame': { es: 'Sensibilidad in-game', en: 'In-game sensitivity' },
  save: { es: 'Guardar', en: 'Save' },
  'sens.readout': { es: '<b>{cm} cm/360°</b> · {counts} counts/360° · {cpd} counts/grado', en: '<b>{cm} cm/360°</b> · {counts} counts/360° · {cpd} counts/degree' },
  'cap.title': { es: 'Capturer (mouse)', en: 'Capturer (mouse)' },
  'cap.help': { es: 'El capturer lee tu mouse en crudo. Pegá la ruta del <b>AimCoach-MouseCapturer.exe</b> y la app lo lanza sola (necesita <code>plugins/process_manager.dll</code> desbloqueado).', en: 'The capturer reads raw mouse input. Paste the path to <b>AimCoach-MouseCapturer.exe</b> and the app launches it (needs <code>plugins/process_manager.dll</code> unblocked).' },
  'cap.path': { es: 'Ruta del ejecutable', en: 'Executable path' },
  'cap.save': { es: 'Guardar ruta', en: 'Save path' },
  'ovpos.title': { es: 'Overlay · posición', en: 'Overlay · position' },
  'ovpos.corner': { es: 'Esquina (clic en el punto)', en: 'Corner (click a dot)' },
  opacity: { es: 'Opacidad', en: 'Opacity' },
  'ovsize.title': { es: 'Overlay · tamaño', en: 'Overlay · size' },
  width: { es: 'Ancho', en: 'Width' },
  height: { es: 'Alto', en: 'Height' },
  text: { es: 'Texto', en: 'Text' },
  maxmsg: { es: 'Máx. de mensajes', en: 'Max messages' },
  'cal360.title': { es: 'Calibración · giro 360', en: 'Calibration · 360 turn' },
  'cal360.help': { es: 'Chequea que tu DPI/sens estén bien: girás UNA vuelta limpia en el juego y la app mide si coincide. Disparala con el botón o <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>.', en: 'Checks your DPI/sens are right: do ONE clean turn in-game and the app measures whether it matches. Trigger it with the button or <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd>.' },
  'cal360.btn': { es: 'Calibrar 360 (in-game)', en: 'Calibrate 360 (in-game)' },
  'calbase.title': { es: 'Calibración · recoil por arma', en: 'Calibration · per-weapon recoil' },
  'calbase.help': { es: 'Cada arma sprayea distinto. Elegí el arma, entrá al Range con ESA arma y hacé 5 sprays sostenidos: la app aprende TU curva de recoil y la usa como referencia en el Recoil Trainer.', en: 'Each weapon sprays differently. Pick the weapon, enter the Range with THAT weapon and do 5 sustained sprays: the app learns YOUR recoil curve and uses it as the reference in the Recoil Trainer.' },
  'calbase.weapon': { es: 'Arma a calibrar', en: 'Weapon to calibrate' },
  'calbase.btn': { es: 'Calibrar arma', en: 'Calibrate weapon' },
  or: { es: 'o', en: 'or' },
  'baselines.title': { es: 'Baselines por arma', en: 'Per-weapon baselines' },
  'actions.title': { es: 'Acciones', en: 'Actions' },
  'actions.toggle': { es: 'Mostrar / ocultar overlay', en: 'Show / hide overlay' },
  'actions.clearOverlay': { es: 'Limpiar overlay', en: 'Clear overlay' },
  'actions.readout': { es: 'El <b>Modo Debugger</b> (arriba a la derecha) abre la consola de logs. Off por defecto.', en: '<b>Debug mode</b> (top-right) opens the log console. Off by default.' },
  'recoil.title': { es: 'Recoil Trainer', en: 'Recoil Trainer' },
  'recoil.help': { es: 'Sprayeá sostenido en el Range: acá ves tu recorrido (rojo) vs el patrón ideal (verde). Donde se separan, ahí perdés el control.', en: 'Do a sustained spray in the Range: here you see your path (red) vs the ideal pattern (green). Where they split is where you lose control.' },
  'recoil.empty': { es: 'Sprayeá sostenido en el Range para ver tu traza.', en: 'Do a sustained spray in the Range to see your trace.' },
  'recoil.ideal': { es: 'Ideal', en: 'Ideal' },
  'recoil.you': { es: 'Vos', en: 'You' },
  'recoil.best': { es: 'mejor', en: 'best' },
  'recoil.avg': { es: 'prom', en: 'avg' },
  'recoil.posx': { es: 'Traza in-game · X', en: 'In-game trace · X' },
  'recoil.posy': { es: 'Traza in-game · Y', en: 'In-game trace · Y' },
  'recoil.size': { es: 'Traza in-game · tamaño', en: 'In-game trace · size' },
  'recoil.phaseV': { es: 'pull vertical', en: 'vertical pull' },
  'recoil.phaseH': { es: 'horizontal', en: 'horizontal' },
  'recoil.segEarly': { es: 'al arranque', en: 'early' },
  'recoil.segMid': { es: 'al medio', en: 'mid-spray' },
  'recoil.segLate': { es: 'al final', en: 'late' },
  'ad.tag': { es: 'Publicidad', en: 'Advertisement' },
  'ad.msg': { es: 'Estos ads ayudan a mantener la app viva. Considerá desbloquearlos para bancar el proyecto.', en: 'These ads keep the app alive. Consider unblocking them to support the project.' },
  console: { es: 'Consola', en: 'Console' },
  export: { es: 'Exportar (40 min)', en: 'Export (40 min)' },
  clear: { es: 'Limpiar', en: 'Clear' },
  'baseline.empty': { es: '— (ningún arma calibrada, usando default)', en: '— (no weapon calibrated, using default)' },
  'status.sensSaved': { es: 'Sensibilidad guardada.', en: 'Sensitivity saved.' },
  'status.pathSaved': { es: 'Ruta guardada. La app intentará lanzar el capturer.', en: 'Path saved. The app will try to launch the capturer.' },
  'status.cal360Start': { es: 'Mirá el overlay in-game: cuenta regresiva y girá una vuelta limpia.', en: 'Watch the in-game overlay: countdown, then do one clean turn.' },
  'status.calSprayStart': { es: 'Mirá el overlay in-game: 30s para sprayear en el Range.', en: 'Watch the in-game overlay: 30s to spray in the Range.' },
  'status.calProgress': { es: 'Calibrando… {n} sprays capturados.', en: 'Calibrating… {n} sprays captured.' },
  'status.calDone': { es: 'Baseline de {weapon} calibrado y guardado.', en: '{weapon} baseline calibrated and saved.' },
  'status.calDoneRecoil': { es: 'Baseline + recoil de {weapon} calibrado y guardado.', en: '{weapon} baseline + recoil calibrated and saved.' },
  'status.calFail': { es: 'No se pudo: {error}', en: 'Failed: {error}' },
  'status.cal360Result': { es: 'Sens medida {measured} vs {reported} (drift {drift}%) — {verdict}', en: 'Measured sens {measured} vs {reported} (drift {drift}%) — {verdict}' },
  'status.ok360': { es: 'OK', en: 'OK' },
  'status.bad360': { es: 'revisá DPI/aceleración', en: 'check DPI/acceleration' },
  'log.ready': { es: 'Config lista. El overlay vive dentro del juego: abrí Valorant y se abre solo. Toggle: Ctrl+Shift+A.', en: 'Config ready. The overlay lives in-game: open Valorant and it opens on its own. Toggle: Ctrl+Shift+A.' },
};
let lang: Lang = (config.lang === 'en' ? 'en' : 'es');
function t(key: string, vars?: { [k: string]: string | number }): string {
  const entry = I18N[key];
  let s = entry ? entry[lang] : key;
  if (vars) for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]));
  return s;
}

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
  el.innerHTML = t('sens.readout', { cm: m.cmPer360, counts: Math.round(m.countsPer360), cpd: m.countsPerDegree.toFixed(2) });
}

function renderBaseline(): void {
  const el = $('baselineView');
  if (!el) return;
  const b = config.baselines || {};
  const weapons = Object.keys(b);
  if (!weapons.length) { el.textContent = t('baseline.empty'); return; }
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
  setStatus('cal360Status', t('status.sensSaved'), 'ok');
});

const calWeaponSelect = $('calWeapon') as HTMLSelectElement;
calWeaponSelect?.addEventListener('change', () => {
  config.calWeapon = calWeaponSelect.value;
  saveConfig(config);
  applyToBackground();
});

// La ruta del capturer ya NO se configura desde la UI (un input de .exe no va en una app productiva).
// Se persiste en config.capturerPath (dev) y en producción se resolverá al .exe bundleado (ver deploy).

// ---- overlay: tamaño (% pantalla), texto y cantidad de errores ----
const overlayScaleInput = $('overlayScale') as HTMLInputElement;
const overlayMaxInput = $('overlayMaxItems') as HTMLInputElement;
const overlayWInput = $('overlayWidthPct') as HTMLInputElement;
const overlayHInput = $('overlayHeightPct') as HTMLInputElement;
const cornerDots = Array.from(document.querySelectorAll<HTMLButtonElement>('.corner-dot'));
const overlayOpacityInput = $('overlayOpacity') as HTMLInputElement;
function renderCorner(): void {
  const c = config.overlayCorner || 'top-left';
  cornerDots.forEach(d => d.classList.toggle('sel', d.dataset.corner === c));
}
cornerDots.forEach(d => d.addEventListener('click', () => {
  config.overlayCorner = d.dataset.corner;
  renderCorner(); saveConfig(config); applyToBackground();
}));
function renderOverlayLabels(): void {
  const sv = $('overlayScaleVal'); if (sv) sv.textContent = parseFloat(overlayScaleInput.value).toFixed(1) + '×';
  const ow = $('owVal'); if (ow) ow.textContent = overlayWInput.value + '%';
  const oh = $('ohVal'); if (oh) oh.textContent = overlayHInput.value + '%';
  const op = $('opacityVal'); if (op) op.textContent = overlayOpacityInput.value + '%';
}
overlayOpacityInput?.addEventListener('input', () => {
  config.overlayOpacity = (parseInt(overlayOpacityInput.value, 10) || 100) / 100;
  renderOverlayLabels(); saveConfig(config); applyToBackground();
});
// ---- posición/tamaño de la mini-traza de recoil en el overlay ----
const recoilLeftInput = $('recoilLeft') as HTMLInputElement;
const recoilTopInput = $('recoilTop') as HTMLInputElement;
const recoilScaleInput = $('recoilScale') as HTMLInputElement;
function renderRecoilLabels(): void {
  const x = $('recoilLeftVal'); if (x && recoilLeftInput) x.textContent = recoilLeftInput.value + '%';
  const y = $('recoilTopVal'); if (y && recoilTopInput) y.textContent = recoilTopInput.value + '%';
  const s = $('recoilScaleVal2'); if (s && recoilScaleInput) s.textContent = parseFloat(recoilScaleInput.value).toFixed(1) + '×';
}
recoilLeftInput?.addEventListener('input', () => { config.recoilLeft = parseInt(recoilLeftInput.value, 10); renderRecoilLabels(); saveConfig(config); applyToBackground(); });
recoilTopInput?.addEventListener('input', () => { config.recoilTop = parseInt(recoilTopInput.value, 10); renderRecoilLabels(); saveConfig(config); applyToBackground(); });
recoilScaleInput?.addEventListener('input', () => { config.recoilScale = parseFloat(recoilScaleInput.value); renderRecoilLabels(); saveConfig(config); applyToBackground(); });
overlayScaleInput?.addEventListener('input', () => {
  config.overlayScale = parseFloat(overlayScaleInput.value);
  renderOverlayLabels(); saveConfig(config); applyToBackground();
});
overlayMaxInput?.addEventListener('input', () => {
  config.overlayMaxItems = parseInt(overlayMaxInput.value, 10) || 6;
  saveConfig(config); applyToBackground();
});
overlayWInput?.addEventListener('input', () => {
  config.overlayWidthPct = (parseInt(overlayWInput.value, 10) || 30) / 100;
  renderOverlayLabels(); saveConfig(config); applyToBackground();
});
overlayHInput?.addEventListener('input', () => {
  config.overlayHeightPct = (parseInt(overlayHInput.value, 10) || 45) / 100;
  renderOverlayLabels(); saveConfig(config); applyToBackground();
});
// ---- Modo Debugger: abre/cierra el drawer de consola (abajo) + logueo verboso ----
const debugToggleBtn = $('debugToggle') as HTMLButtonElement;
const logDrawer = $('logDrawer');
function renderDebug(): void {
  const on = !!config.debug;
  debugToggleBtn?.classList.toggle('on', on);
  logDrawer?.classList.toggle('show', on);
}
debugToggleBtn?.addEventListener('click', () => {
  config.debug = !config.debug;
  renderDebug(); saveConfig(config); applyToBackground();
});

// ---- Exportar logs: pide al background el buffer (últimos 40 min) y lo descarga como archivo ----
$('exportLogs')?.addEventListener('click', () => {
  overwolf.windows.sendMessage('background', 'export-logs', {}, () => {});
});
function downloadLogs(text: string): void {
  const blob = new Blob([text || '(sin logs)'], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'aimcoach-logs-' + new Date().toISOString().replace(/[:.]/g, '-') + '.txt';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- helpers UI ----
function setStatus(id: string, text: string, cls = ''): void {
  const el = $(id);
  if (!el) return;
  el.textContent = text;
  el.className = 'status' + (cls ? ' ' + cls : '');
}

// ---- calibracion (disparo unico; el flujo es por tiempo, dirigido en el overlay) ----
$('cal360Start')?.addEventListener('click', () => {
  overwolf.windows.sendMessage('background', 'cal-360-start', {}, () => {});
  setStatus('cal360Status', t('status.cal360Start'));
});
$('calSprayStart')?.addEventListener('click', () => {
  overwolf.windows.sendMessage('background', 'cal-spray-start', {}, () => {});
  setStatus('calSprayStatus', t('status.calSprayStart'));
});

// ---- overlay / log ----
$('toggleBtn')?.addEventListener('click', () =>
  overwolf.windows.sendMessage('background', 'toggle-overlay', {}, () => {})
);
// Limpia las notificaciones del overlay a mano (el background reenvía 'reset' al overlay).
$('clearOverlayBtn')?.addEventListener('click', () =>
  overwolf.windows.sendMessage('background', 'clear-overlay', {}, () => {})
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

// ---- Recoil Trainer: dibuja tu recorrido (rojo) vs el patrón ideal (verde) en el canvas ----
let lastRecoilTrace: any = null;
// progreso por arma en la sesión: cantidad, suma (para el promedio) y mejor score.
const recoilStats: { [weapon: string]: { n: number; sum: number; best: number } } = {};
function updateRecoilStats(tr: any): void {
  const w = tr.weapon || '';
  const s = recoilStats[w] || (recoilStats[w] = { n: 0, sum: 0, best: 0 });
  s.n++; s.sum += tr.score; s.best = Math.max(s.best, tr.score);
}
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}
function drawRecoilTrace(tr: any): void {
  const canvas = $('recoilCanvas') as HTMLCanvasElement | null;
  const ctx = canvas && canvas.getContext('2d');
  if (!canvas || !ctx) return;
  const W = canvas.width, H = canvas.height, pad = 16;
  ctx.clearRect(0, 0, W, H);
  const ref = tr.ref || [], curve = tr.curve || [];
  const all = ref.concat(curve);
  if (!all.length) return;
  // escala: v (vertical, hacia abajo) y |h| (horizontal) para que entren en el canvas
  let maxV = 1, maxH = 0.001;
  for (const p of all) { maxV = Math.max(maxV, p.v); maxH = Math.max(maxH, Math.abs(p.h)); }
  const cx = W / 2, sV = (H - 2 * pad) / maxV, sH = (W / 2 - pad) / maxH;
  // v hacia ARRIBA: la bala 1 (v=0) queda abajo (punto de mira) y el patrón SUBE, como el spray real.
  const mapX = (h: number) => cx + h * sH, mapY = (v: number) => H - pad - v * sV;
  // eje central
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(cx, pad); ctx.lineTo(cx, H - pad); ctx.stroke();
  const det = tr.deterministic || 7;
  // dibuja la parte CONTROLABLE (0..det) sólida y el SPREAD RNG (det..fin) tenue.
  const drawPath = (pts: any[], color: string) => {
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
    // fase controlable (sólida)
    ctx.globalAlpha = 1; ctx.beginPath();
    pts.slice(0, det).forEach((p: any, i: number) => { const x = mapX(p.h), y = mapY(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // fase spread RNG (tenue, desde el último punto controlable)
    if (pts.length > det) {
      ctx.globalAlpha = 0.3; ctx.beginPath();
      pts.slice(det - 1).forEach((p: any, i: number) => { const x = mapX(p.h), y = mapY(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    pts.forEach((p: any, i: number) => { ctx.globalAlpha = i < det ? 1 : 0.35; ctx.beginPath(); ctx.arc(mapX(p.h), mapY(p.v), 2, 0, Math.PI * 2); ctx.fill(); });
    ctx.globalAlpha = 1;
  };
  drawPath(ref, cssVar('--teal', '#2ed3b7'));   // ideal
  drawPath(curve, cssVar('--accent', '#ff4655')); // vos
  // línea que marca dónde termina lo controlable (empieza el spread RNG)
  if (ref.length > det) {
    const yd = mapY(ref[det - 1].v);
    ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(6, yd); ctx.lineTo(W - 6, yd); ctx.stroke(); ctx.setLineDash([]);
  }
  const scoreEl = $('recoilScore');
  if (scoreEl) {
    const phaseWord = tr.phase === 'horizontal' ? t('recoil.phaseH') : tr.phase === 'vertical' ? t('recoil.phaseV') : '';
    const segKey = tr.segment === 'early' ? 'recoil.segEarly' : tr.segment === 'mid' ? 'recoil.segMid' : tr.segment === 'late' ? 'recoil.segLate' : '';
    const detail = (phaseWord || segKey) ? `<div class="weapon">${phaseWord}${segKey ? ' ' + t(segKey) : ''}</div>` : '';
    // progreso de la sesión: mejor y promedio por arma
    const s = recoilStats[tr.weapon || ''];
    const stats = s ? `<div class="weapon">${t('recoil.best')} ${s.best}% · ${t('recoil.avg')} ${Math.round(s.sum / s.n)}% · ${s.n}×</div>` : '';
    scoreEl.innerHTML = `${tr.score}% <span class="weapon">${tr.weapon || ''}</span>${detail}${stats}`;
  }
}

// ---- mensajes del background ----
overwolf.windows.onMessageReceived.addListener((m: any) => {
  switch (m.id) {
    case 'log':
      if (m.content) addLine(m.content.line);
      break;
    case 'recoil-trace':
      if (m.content) { lastRecoilTrace = m.content; updateRecoilStats(m.content); drawRecoilTrace(m.content); }
      break;
    case 'logs-export':
      if (m.content) downloadLogs(m.content.text);
      break;
    case 'cal-progress':
      if (m.content) setStatus('calSprayStatus', t('status.calProgress', { n: m.content.sprays }));
      break;
    case 'cal-msg':
      if (m.content) setStatus('calSprayStatus', m.content.text, 'err');
      break;
    case 'cal-spray-result':
      if (m.content && m.content.baseline && m.content.weapon) {
        if (!config.baselines) config.baselines = {};
        config.baselines[m.content.weapon] = m.content.baseline;
        if (m.content.recoilRef) {
          if (!config.recoilRefs) config.recoilRefs = {};
          config.recoilRefs[m.content.weapon] = m.content.recoilRef;
        }
        saveConfig(config);
        applyToBackground();
        renderBaseline();
        setStatus('calSprayStatus', t(m.content.recoilRef ? 'status.calDoneRecoil' : 'status.calDone', { weapon: m.content.weapon }), 'ok');
      } else {
        setStatus('calSprayStatus', t('status.calFail', { error: (m.content && m.content.error) || '' }), 'err');
      }
      break;
    case 'cal-360-result':
      if (m.content) {
        const r = m.content;
        setStatus('cal360Status',
          t('status.cal360Result', { measured: r.measuredSens, reported: r.reportedSens, drift: r.driftPct, verdict: t(r.ok ? 'status.ok360' : 'status.bad360') }),
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

// ---- ayuda interactiva: el botón "?" abre/cierra la explicación corta de la card ----
document.querySelectorAll<HTMLButtonElement>('.card-head .help').forEach((btn) => {
  btn.addEventListener('click', () => {
    const body = btn.closest('.card-head')?.nextElementSibling;
    if (body && body.classList.contains('help-body')) body.classList.toggle('show');
  });
});

// ---- Overwolf ads (muteados): dos slots finos (arriba y abajo), solo escritorio, nunca en el overlay.
// Carga el SDK en runtime e inicia cada slot si aparece; en dev queda el placeholder. ----
declare const OwAd: any;
(() => {
  const s = document.createElement('script');
  s.src = 'https://content.overwolf.com/libs/ads/latest/owads.min.js';
  s.async = true;
  document.head.appendChild(s);
  const initSlot = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    try {
      const ad = new OwAd(el, { size: { width: 728, height: 90 } }); // banner fino (tamaño fijo del SDK)
      ad.addEventListener('player_loaded', () => { try { ad.mute(); } catch (_) {} fitAds(); }); // arranca muteado + ajusta escala
    } catch (_) {}
  };
  let tries = 0;
  const timer = setInterval(() => {
    if (typeof OwAd === 'undefined' && tries++ < 20) return; // el SDK puede tardar; reintentamos
    clearInterval(timer);
    if (typeof OwAd === 'undefined') return; // sin SDK (dev): dejamos el placeholder
    initSlot('ad-top');
    initSlot('ad-bottom');
  }, 500);
})();

// El ad tiene tamaño fijo (728x90); lo escalamos para que entre EXACTO en el ancho de su card y
// ajustamos el alto de la card al tamaño escalado (transform no afecta el layout, lo fijamos a mano).
function fitAds(): void {
  document.querySelectorAll<HTMLElement>('.ad-slot').forEach((slot) => {
    const card = slot.parentElement as HTMLElement | null;
    if (!card) return;
    const avail = card.clientWidth - 20; // descontamos el padding lateral de la card
    const scale = Math.max(0.2, Math.min(1, avail / 728));
    slot.style.transform = `scale(${scale})`;
    slot.style.transformOrigin = 'center center';
    card.style.height = Math.round(90 * scale + 28) + 'px'; // 28 = padding vertical de la card (18+10)
  });
}
window.addEventListener('resize', fitAds);

// ---- switch de idioma (ES/EN): aplica los textos estáticos (data-i18n) y re-renderiza los dinámicos ----
const langButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('#langSwitch button'));
function applyLang(l: Lang): void {
  lang = l;
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    // no pisamos slots de ad ya cargados (tienen un iframe hijo); solo textos hoja
    if (el.children.length === 0) el.textContent = t(el.dataset.i18n as string);
  });
  document.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml || ''); });
  renderSensReadout();
  renderBaseline();
  if (lastRecoilTrace) drawRecoilTrace(lastRecoilTrace); // no perder la traza al cambiar idioma
  langButtons.forEach((b) => b.classList.toggle('on', b.dataset.lang === l));
}
langButtons.forEach((b) => b.addEventListener('click', () => {
  const l: Lang = b.dataset.lang === 'en' ? 'en' : 'es';
  config.lang = l; saveConfig(config); applyLang(l);
  applyToBackground(); // propaga el idioma al background -> engine.setLang + lang del overlay (overlay-cfg)
}));

// ---- init ----
dpiInput.value = String(config.dpi);
sensInput.value = String(config.sens);
overlayScaleInput.value = String(config.overlayScale || 1);
overlayMaxInput.value = String(config.overlayMaxItems || 6);
overlayWInput.value = String(Math.round((config.overlayWidthPct || 0.30) * 100));
overlayHInput.value = String(Math.round((config.overlayHeightPct || 0.45) * 100));
renderCorner();
overlayOpacityInput.value = String(Math.round((config.overlayOpacity || 1) * 100));
if (recoilLeftInput) recoilLeftInput.value = String(config.recoilLeft ?? 15);
if (recoilTopInput) recoilTopInput.value = String(config.recoilTop ?? 50);
if (recoilScaleInput) recoilScaleInput.value = String(config.recoilScale ?? 1);
renderRecoilLabels();
renderDebug();
if (calWeaponSelect && config.calWeapon) calWeaponSelect.value = config.calWeapon;
renderOverlayLabels();
applyToBackground();
applyLang(lang); // aplica idioma + re-renderiza sensReadout/baseline
fitAds();        // escala los slots de ad al ancho de su card
addLine(t('log.ready'));

export {};
