// Background controller (ow-native). Corre como background page del app Overwolf.
// Orquesta: deteccion de Valorant, GEP (eventos del juego), stream de mouse (WebSocket
// del capturer C#), el motor de reglas, y las ventanas (config de escritorio + overlay in-game).

import { AimCoachEngine } from '../engine/ruleEngine';
import { verify360, sensMath } from '../engine/calibration';
import { T, Lang } from '../engine/messages';

const VALORANT_ID = 21640;
const GEP_FEATURES = ['game_info', 'me', 'match_info', 'kill', 'death', 'gep_internal'];
const CAPTURER_WS = 'ws://127.0.0.1:9595/';
const CONFIG_KEY = 'aimcoach_config';
const CAPTURER_EXE = 'AimCoach-MouseCapturer.exe'; // nombre del exe extraído (= nombre del proceso, identificable)
const CAPTURER_SRC = 'native/' + CAPTURER_EXE;     // ruta relativa a la raíz del paquete (lo bundlea webpack)
const CAPTURER_HEALTH_MS = 60000;                // cada cuánto el supervisor chequea el stream de mouse (1 min)
const CAPTURER_MAX_STRIKES = 3;                  // intentos fallidos seguidos antes de reportar el error

let engine: any = null;
let valorantRunning = false;
let overlayVisible = false;

// sensibilidad del usuario (para verify360); el engine usa el baseline.
let dpi = 800;
let sens = 0.4;
let capturerPath = '';        // ruta absoluta al AimCoach-MouseCapturer.exe (se setea en config)
let capturerLaunched = false;
let overlayScale = 1;         // escala del TEXTO del overlay (ajustable desde config)
let overlayMaxItems = 3;      // cantidad de últimos errores a mostrar (ajustable desde config)
let overlayWidthPct = 0.30;   // ancho del overlay como % de la pantalla del juego
let overlayHeightPct = 0.45;  // alto del overlay como % de la pantalla del juego
let overlayCorner = 'top-left'; // esquina donde se ancla el overlay
let overlayOpacity = 1;       // opacidad del overlay (0.3–1)
let recoilLeft = 15;          // posición X de la mini-traza de recoil (% de la ventana)
let recoilTop = 50;           // posición Y de la mini-traza de recoil (% de la ventana)
let recoilScale = 1;          // tamaño de la mini-traza de recoil
let debug = false;            // Modo Debugger: emite logs verbosos (mouse/GEP/strafe/flicks) y muestra el panel
let calWeapon = 'vandal';     // arma seleccionada para calibrar (en el Range no se autodetecta)
let lang: Lang = 'es';        // idioma del overlay (config.lang); se propaga al overlay via overlay-cfg

// Atajo para traducir el texto de UI del overlay que produce el background (dict en messages.ts).
function t(key: string, params?: { [k: string]: string | number }): string { return T(key, lang, params); }

// estado del stream de mouse y de la calibracion del giro 360
let mouseConnected = false;
let cal360Active = false;
let cal360Sum = 0;

// modo de juego -> momento del feedback (practica = instant, resto = al morir)
let timing = 'onDeath';
let instantTimer: any = null;
const INSTANT_FLUSH_MS = 3000;

// heartbeats para ver que la captura esta viva sin floodear
let mouseCount = 0;
let lastMouseLog = 0;
let gepCount = 0;
let lastGepLog = 0;

// Supervisor del capturer: vigila el stream de mouse y reporta si se cae (ej. borraron el exe).
let capturerHealthTimer: any = null;
let capturerStrikes = 0;        // health-checks fallidos seguidos (sin stream de mouse)
let capturerReported = false;   // ya reportamos esta caída (evita spamear el mismo error)
let lastCapturerDst = '';       // ruta del exe extraído (para el diagnóstico del reporte)

function safe(a: any): string {
  try { return typeof a === 'string' ? a : JSON.stringify(a); } catch (_) { return String(a); }
}

// Buffer de logs para exportar (últimos LOG_RETENTION_MS). Guarda solo lo que efectivamente se logueó.
const LOG_RETENTION_MS = 40 * 60 * 1000;
const logBuffer: { t: number; line: string }[] = [];

// Log normal: consola (dev tools) + ventana de config + buffer de exportación. Siempre visible.
function log(msg: string, ...args: any[]): void {
  const line = msg + (args.length ? ' ' + args.map(safe).join(' ') : '');
  console.log('[AimCoach]', line);
  const t = Date.now();
  logBuffer.push({ t, line });
  while (logBuffer.length && logBuffer[0].t < t - LOG_RETENTION_MS) logBuffer.shift();
  overwolf.windows.sendMessage('config', 'log', { line }, () => {});
}

// Log de debug (mouse, GEP-events, strafe, flicks): solo cuando el Modo Debugger está activo.
function logDebug(msg: string): void {
  if (debug) log(msg);
}

function start(): void {
  engine = new AimCoachEngine({
    onFeedback: (f: any) => showFeedback(f),
    onFlick: (info: any) => overlayFlick(info),
    onStrafe: (info: any) => {
      logDebug(`STRAFE ${info.class}${info.keys ? '(' + info.keys + ')' : ''} · sinceStop ${info.sinceStop == null ? '—' : info.sinceStop + 'ms'}`);
    },
    onCalProgress: (p: any) => onCalSprayProgress(p),
    onRecoilScored: (tr: any) => { // traza para el Recoil Trainer (config) + mini-traza en el overlay
      sendToConfig('recoil-trace', tr);
      overwolf.windows.sendMessage('in_game', 'recoil-trace', tr, () => {});
    },
  });
  loadSavedConfig();
  applySens();
  log('background started');
  // Overlay-first: la config solo se abre sola si falta setup (ruta del capturer).
  // En uso normal todo va por el overlay + hotkeys. Abrila cuando quieras con Ctrl+Shift+C.
  if (!capturerPath) openWindow('config');
  launchCapturer();
  overwolf.windows.onMessageReceived.addListener((m: any) => onConfigMessage(m));
  initHotkeys();
  initGameDetection();
  initGep();
  connectMouseStream();
  startCapturerSupervisor(); // vigila el stream de mouse y reporta si se cae (self-heal + log-trace)
}

function sendToConfig(id: string, content: any): void {
  overwolf.windows.sendMessage('config', id, content, () => {});
}

function applySens(): void {
  try { engine.setSens(sensMath(dpi, sens).countsPerDegree); } catch (_) {}
}

function loadSavedConfig(): void {
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null');
    if (!saved) return;
    if (typeof saved.dpi === 'number') dpi = saved.dpi;
    if (typeof saved.sens === 'number') sens = saved.sens;
    if (saved.recoilRefs) engine.setRecoilRefs(saved.recoilRefs);
    if (typeof saved.capturerPath === 'string') capturerPath = saved.capturerPath;
    if (typeof saved.overlayScale === 'number') overlayScale = saved.overlayScale;
    if (typeof saved.overlayMaxItems === 'number') overlayMaxItems = saved.overlayMaxItems;
    if (typeof saved.overlayWidthPct === 'number') overlayWidthPct = saved.overlayWidthPct;
    if (typeof saved.overlayHeightPct === 'number') overlayHeightPct = saved.overlayHeightPct;
    if (typeof saved.overlayCorner === 'string') overlayCorner = saved.overlayCorner;
    if (typeof saved.overlayOpacity === 'number') overlayOpacity = saved.overlayOpacity;
    if (typeof saved.recoilLeft === 'number') recoilLeft = saved.recoilLeft;
    if (typeof saved.recoilTop === 'number') recoilTop = saved.recoilTop;
    if (typeof saved.recoilScale === 'number') recoilScale = saved.recoilScale;
    if (typeof saved.debug === 'boolean') debug = saved.debug;
    if (typeof saved.lang === 'string') { lang = saved.lang === 'en' ? 'en' : 'es'; engine.setLang(lang); } // idioma del overlay
    if (typeof saved.calWeapon === 'string') calWeapon = saved.calWeapon;
    engine.setPracticeWeapon(calWeapon); // fallback de arma para el Range (GEP no la da)
    if (saved.baselines) {
      engine.setBaselines(saved.baselines);
      log('per-weapon baselines loaded: ' + Object.keys(saved.baselines).join(', '));
    }
  } catch (_) {}
}

// Mensajes que llegan desde la ventana de config.
function onConfigMessage(m: any): void {
  switch (m.id) {
    case 'toggle-overlay':
      toggleOverlay();
      break;
    case 'apply-config':
      if (m.content) {
        if (typeof m.content.dpi === 'number') dpi = m.content.dpi;
        if (typeof m.content.sens === 'number') sens = m.content.sens;
        if (typeof m.content.dpi === 'number' || typeof m.content.sens === 'number') applySens();
        if (m.content.recoilRefs) engine.setRecoilRefs(m.content.recoilRefs);
        if (typeof m.content.capturerPath === 'string') capturerPath = m.content.capturerPath;
        if (typeof m.content.overlayScale === 'number') overlayScale = m.content.overlayScale;
        if (typeof m.content.overlayMaxItems === 'number') overlayMaxItems = m.content.overlayMaxItems;
        if (typeof m.content.overlayOpacity === 'number') overlayOpacity = m.content.overlayOpacity;
        if (typeof m.content.recoilLeft === 'number') recoilLeft = m.content.recoilLeft;
        if (typeof m.content.recoilTop === 'number') recoilTop = m.content.recoilTop;
        if (typeof m.content.recoilScale === 'number') recoilScale = m.content.recoilScale;
        if (typeof m.content.lang === 'string') {
          lang = m.content.lang === 'en' ? 'en' : 'es';
          engine.setLang(lang);
          // Los mensajes ya visibles quedaron en el idioma viejo: limpiamos el overlay para que las próximas
          // notificaciones se vean en el idioma nuevo (el texto ya renderizado no se re-traduce solo).
          overwolf.windows.sendMessage('in_game', 'reset', {}, () => {});
        }
        if (['overlayScale', 'overlayMaxItems', 'overlayOpacity', 'recoilLeft', 'recoilTop', 'recoilScale'].some(k => typeof m.content[k] === 'number') || typeof m.content.lang === 'string') sendOverlayConfig();
        if (typeof m.content.overlayWidthPct === 'number') overlayWidthPct = m.content.overlayWidthPct;
        if (typeof m.content.overlayHeightPct === 'number') overlayHeightPct = m.content.overlayHeightPct;
        if (typeof m.content.overlayCorner === 'string') overlayCorner = m.content.overlayCorner;
        if (typeof m.content.overlayWidthPct === 'number' || typeof m.content.overlayHeightPct === 'number' || typeof m.content.overlayCorner === 'string') applyOverlaySize();
        if (typeof m.content.debug === 'boolean') debug = m.content.debug;
        if (typeof m.content.calWeapon === 'string') { calWeapon = m.content.calWeapon; engine.setPracticeWeapon(calWeapon); }
        if (m.content.baselines) engine.setBaselines(m.content.baselines);
        log('config applied (dpi ' + dpi + ', sens ' + sens + ', weapon ' + calWeapon + ')');
        launchCapturer(); // por si recien configuraron la ruta
      }
      break;
    case 'clear-overlay':
      // Limpieza manual desde la config: vacía la lista + contadores del overlay (arranca de cero).
      overwolf.windows.sendMessage('in_game', 'reset', {}, () => {});
      break;
    case 'cal-360-start':
      startCal360();
      break;
    case 'cal-spray-start':
      startCalBaseline();
      break;
    case 'export-logs': {
      // arma el texto de los últimos 40 min con timestamp y lo GUARDA en el Escritorio (fácil de encontrar
      // y compartir para soporte). Reporta la ruta a la config para mostrarla al usuario.
      const text = logBuffer.map(e => '[' + new Date(e.t).toLocaleTimeString() + '] ' + e.line).join('\n');
      saveLogsToDesktop(text || '(no logs)');
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Export de logs al Escritorio (soporte). No se puede pedir el "Escritorio" a Overwolf directo; se deriva
// el home del usuario desde getStoragePath(appData) (AppData NUNCA se redirige, siempre bajo el perfil) y
// se prueban las carpetas Desktop / OneDrive\Desktop (OneDrive suele redirigir el Escritorio). Fallback:
// la carpeta escribible de la app. Escribe con overwolf.io.writeFileContents (permiso FileSystem).
// ---------------------------------------------------------------------------
function saveLogsToDesktop(text: string): void {
  const space = overwolf.extensions.io.enums.StorageSpace.appData;
  overwolf.extensions.io.getStoragePath(space, (s: any) => {
    const storage = (s && s.path) || '';
    const home = deriveUserHome(storage);
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const fname = 'AimCoach-log-' + ts + '.txt';
    resolveDesktopDir(home, (dir) => {
      const target = (dir || storage).replace(/\\+$/, '');
      if (!target) { log('LOGS: no writable path'); sendToConfig('logs-saved', { ok: false }); return; }
      const dst = target + '\\' + fname;
      overwolf.io.writeFileContents(dst, text, overwolf.io.enums.eEncoding.UTF8, false, (res: any) => {
        if (res && res.success) { log('LOGS: saved to ' + dst); sendToConfig('logs-saved', { ok: true, path: dst, onDesktop: !!dir }); }
        else { log('LOGS: write failed (' + (res && res.error) + ')'); sendToConfig('logs-saved', { ok: false, path: dst, error: res && res.error }); }
      });
    });
  });
}

// home del usuario a partir de un path bajo AppData (ej "C:\Users\me\AppData\Local\..." -> "C:\Users\me").
function deriveUserHome(p: string): string {
  const i = p.toLowerCase().indexOf('\\appdata\\');
  return i > 0 ? p.slice(0, i) : '';
}

// Devuelve la primera carpeta de Escritorio que EXISTE (Desktop normal o redirigido a OneDrive), o null.
function resolveDesktopDir(home: string, cb: (dir: string | null) => void): void {
  if (!home) { cb(null); return; }
  const candidates = [home + '\\Desktop', home + '\\OneDrive\\Desktop'];
  let i = 0;
  const next = () => {
    if (i >= candidates.length) { cb(null); return; }
    const c = candidates[i++];
    overwolf.io.exist(c, (r: any) => (r && r.success && r.exist) ? cb(c) : next());
  };
  next();
}

// ---------------------------------------------------------------------------
// Calibracion POR TIEMPO, dirigida desde el overlay in-game (sin botones stop,
// sin alt-tab en medio del drill). Se dispara por hotkey o desde la config.
// ---------------------------------------------------------------------------
const COUNTDOWN_SECS = 5;     // tiempo para alt-tab al juego antes de empezar
const REC_360_SECS = 6;       // ventana para hacer UNA vuelta limpia

let calBusy = false;
let calInterval: any = null;
let calBaselineActive = false;
const TARGET_SPRAYS = 5;   // baseline: con esta cantidad de sprays alcanza (corto y simple)

function stopCalInterval(): void {
  if (calInterval) { clearInterval(calInterval); calInterval = null; }
}

function overlayCal(text: string, done = false): void {
  overwolf.windows.sendMessage('in_game', 'cal', { text, done }, () => {});
}

function countdown(label: string, then: () => void): void {
  stopCalInterval();
  let n = COUNTDOWN_SECS;
  overlayCal(t('cal.countdown', { label, n }));
  calInterval = setInterval(() => {
    n--;
    if (n > 0) overlayCal(t('cal.countdown', { label, n }));
    else { stopCalInterval(); then(); }
  }, 1000);
}

function timedRecord(prompt: string, secs: number, onTick: () => string, done: () => void): void {
  stopCalInterval();
  let n = secs;
  const render = () => overlayCal(t('cal.recording', { prompt, n, tick: onTick() }));
  render();
  calInterval = setInterval(() => {
    n--;
    if (n > 0) render();
    else { stopCalInterval(); done(); }
  }, 1000);
}

function startCal360(): void {
  if (calBusy) return;
  if (!valorantRunning) { log('CAL: open Valorant first'); sendToConfig('cal-msg', { text: t('cal.needValorant') }); return; }
  if (!mouseConnected) { log('CAL: capturer not connected — run AimCoach-MouseCapturer.exe'); sendToConfig('cal-msg', { text: t('cal.needCapturer') }); return; }
  calBusy = true;
  openOverlay();
  log('CAL 360: starting…');
  countdown(t('cal.title360'), () => {
    cal360Active = true; cal360Sum = 0;
    timedRecord(t('cal.turn360'), REC_360_SECS, () => '', () => {
      cal360Active = false;
      const res = verify360(cal360Sum, dpi, sens);
      overlayCal(t('cal.result360', { status: t(res.ok ? 'cal.ok360' : 'cal.checkDpi'), drift: res.driftPct }), true);
      sendToConfig('cal-360-result', res);
      log('CAL 360: ' + cal360Sum + ' counts -> sens ' + res.measuredSens + ' (drift ' + res.driftPct + '%)');
      calBusy = false;
    });
  });
}

// Baseline simple: hacé TARGET_SPRAYS sprays (cualquier ráfaga), termina solo al llegar.
function startCalBaseline(): void {
  if (calBusy) return;
  if (!valorantRunning) { log('CAL: open Valorant first'); sendToConfig('cal-msg', { text: t('cal.needValorant') }); return; }
  if (!mouseConnected) { log('CAL: capturer not connected — run AimCoach-MouseCapturer.exe'); sendToConfig('cal-msg', { text: t('cal.needCapturer') }); return; }
  calBusy = true;
  openOverlay();
  log('CAL baseline: starting…');
  countdown(t('cal.titleWeapon', { weapon: calWeapon }), () => {
    engine.startCalibration(calWeapon);
    calBaselineActive = true;
    overlayCal(t('cal.doSprays', { weapon: calWeapon, n: TARGET_SPRAYS }));
    stopCalInterval();
    calInterval = setTimeout(() => { if (calBaselineActive) finishBaseline(); }, 60000); // safety
  });
}

function onCalSprayProgress(p: any): void {
  sendToConfig('cal-progress', p);
  if (!calBaselineActive) return;
  // accepted === false -> el spray no pasó el gate de calidad (flojo/reposición): no cuenta.
  if (p.accepted === false) { overlayCal(t('cal.weakSpray', { done: p.sprays, n: TARGET_SPRAYS })); return; }
  overlayCal(t('cal.sprays', { done: p.sprays, n: TARGET_SPRAYS }));
  if (p.sprays >= TARGET_SPRAYS) finishBaseline();
}

function finishBaseline(): void {
  if (!calBaselineActive) return;
  calBaselineActive = false;
  stopCalInterval();
  try {
    const result = engine.finishCalibration(); // { weapon, baseline }
    overlayCal(t('cal.baselineDone', { weapon: result.weapon }), true);
    sendToConfig('cal-spray-result', result);
    log('CAL baseline ' + result.weapon + ': ' + JSON.stringify(result.baseline));
  } catch (err: any) {
    overlayCal(t('cal.fewSprays'), true);
    sendToConfig('cal-spray-result', { error: (err && err.message) || 'error' });
    log('CAL baseline error: ' + (err && err.message));
  }
  calBusy = false;
}

function overlayFlick(info: any): void {
  overwolf.windows.sendMessage('in_game', 'flick', { type: info.type }, () => {});
  logDebug(`FLICK ${info.type} · dur ${info.dur}ms · mag ${info.mag} · adjust ${info.aligned} (threshold ${info.threshold})`);
}

// ---------------------------------------------------------------------------
// Ventanas
// ---------------------------------------------------------------------------
function openWindow(name: string, cb?: () => void): void {
  overwolf.windows.obtainDeclaredWindow(name, (res) => {
    if (!res.success) { log('obtainDeclaredWindow error ' + name + ': ' + res.error); return; }
    overwolf.windows.restore(name, () => { if (cb) cb(); });
  });
}

function openOverlay(): void {
  openWindow('in_game', () => {
    overlayVisible = true; log('overlay opened');
    setTimeout(() => { sendOverlayConfig(); applyOverlaySize(); }, 300);
  });
}

function sendOverlayConfig(): void {
  overwolf.windows.sendMessage('in_game', 'overlay-cfg', { scale: overlayScale, maxItems: overlayMaxItems, opacity: overlayOpacity, recoilLeft, recoilTop, recoilScale, lang }, () => {});
}

// Tamaño Y POSICIÓN del overlay = % de la resolución del juego (matchea cualquier pantalla).
// La posición se ancla a la esquina elegida (con un margen), para no tapar el minimapa etc.
function applyOverlaySize(): void {
  overwolf.games.getRunningGameInfo2((info: any) => {
    const gi = info && info.gameInfo;
    const sw = (gi && (gi.logicalWidth || gi.width)) || 1920;
    const sh = (gi && (gi.logicalHeight || gi.height)) || 1080;
    const w = Math.round(sw * overlayWidthPct);
    const h = Math.round(sh * overlayHeightPct);
    const margin = 12;
    const left = overlayCorner.indexOf('right') >= 0 ? Math.max(0, sw - w - margin) : margin;
    const top = overlayCorner.indexOf('bottom') >= 0 ? Math.max(0, sh - h - margin) : margin;
    overwolf.windows.obtainDeclaredWindow('in_game', (res: any) => {
      if (!res || !res.success || !res.window) return;
      const id = res.window.id;
      overwolf.windows.changeSize({ window_id: id, width: w, height: h });
      overwolf.windows.changePosition(id, left, top, () => {});
    });
  });
}

function toggleOverlay(): void {
  if (overlayVisible) {
    overwolf.windows.hide('in_game', () => { overlayVisible = false; log('overlay hidden'); });
  } else {
    openOverlay();
  }
}

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------
function initHotkeys(): void {
  overwolf.settings.hotkeys.onPressed.addListener((e) => {
    if (e.name === 'aimcoach_toggle') toggleOverlay();
    else if (e.name === 'aimcoach_cal_360') startCal360();
    else if (e.name === 'aimcoach_cal_baseline') startCalBaseline();
    else if (e.name === 'aimcoach_config') openWindow('config');
  });
}

// ---------------------------------------------------------------------------
// Deteccion de juego
// ---------------------------------------------------------------------------
function initGameDetection(): void {
  overwolf.games.onGameInfoUpdated.addListener((e: any) => {
    const gi = e && e.gameInfo;
    if (!gi || gi.classId !== VALORANT_ID) return;
    if (gi.isRunning && !valorantRunning) onValorantStart();
    else if (!gi.isRunning && valorantRunning) onValorantStop();
  });

  overwolf.games.getRunningGameInfo2((info: any) => {
    const gi = info && info.gameInfo;
    if (gi && gi.isRunning && gi.classId === VALORANT_ID) onValorantStart();
    else log('Valorant not detected yet (open it and it should attach)');
  });
}

function onValorantStart(): void {
  if (valorantRunning) return;
  valorantRunning = true;
  log('Valorant detected -> registering features and opening overlay');
  setRequiredFeatures();
  openOverlay();
}

function onValorantStop(): void {
  valorantRunning = false;
  log('Valorant closed');
  overwolf.windows.close('in_game', () => {});
  overlayVisible = false;
  timing = 'onDeath';
  if (instantTimer) { clearInterval(instantTimer); instantTimer = null; }
}

// ---------------------------------------------------------------------------
// GEP (Game Events Provider) - lee Valorant
// ---------------------------------------------------------------------------
function setRequiredFeatures(retries = 30): void {
  overwolf.games.events.setRequiredFeatures(GEP_FEATURES, (res: any) => {
    if (res && res.success) {
      log('setRequiredFeatures OK: ' + safe(res.supportedFeatures));
      return;
    }
    log('setRequiredFeatures failed (' + (res && res.error) + ')' + (retries > 0 ? ' -> retry' : ''));
    if (retries > 0) setTimeout(() => setRequiredFeatures(retries - 1), 2000);
  });
}

function initGep(): void {
  overwolf.games.events.onError.addListener((err: any) => log('GEP error ' + safe(err)));

  overwolf.games.events.onInfoUpdates2.addListener((payload: any) => {
    heartbeatGep('info', payload);
    handleInfoUpdate(payload);
  });

  overwolf.games.events.onNewEvents.addListener((payload: any) => {
    heartbeatGep('event', payload);
    handleGameEvents(payload);
  });
}

function heartbeatGep(kind: string, payload: any): void {
  gepCount++;
  const now = Date.now();
  if (now - lastGepLog < 2000) return;
  lastGepLog = now;
  log(`GEP: capturing Valorant (${gepCount} updates) last ${kind}: ${safe(payload).slice(0, 160)}`);
}

// payload onInfoUpdates2: { feature, info: { match_info | game_info: {...} }, ... }
function handleInfoUpdate(payload: any): void {
  const info = payload && payload.info;
  if (!info) return;

  // Modo de juego -> define el momento del feedback.
  const gameMode = info.match_info && info.match_info.game_mode;
  const scene = info.game_info && info.game_info.scene;
  if (gameMode || scene) updateTiming(gameMode, scene);


  const mi = info.match_info;
  if (mi) {
    for (const key of Object.keys(mi)) {
      if (key.indexOf('scoreboard_') === 0) {
        try {
          const row = JSON.parse(mi[key]);
          if (row.is_local) {
            if (row.weapon) {
              const w = cleanWeapon(row.weapon);
              if (w !== lastWeapon) { logDebug('WEAPON -> ' + w + ' (from "' + row.weapon + '")'); lastWeapon = w; }
              engine.setWeapon(w);
            }
          }
        } catch (_) {}
      }
    }
    // round_phase: shopping (compra) | combat (activo) | end / game_end (fin de ronda).
    // OJO: 'active' SOLO en combat (antes lo seteaba round_number, que viene siempre -> contaba habilidades
    // en la compra). Ahora la fase de combate es limpia y el conteo de habilidades es correcto.
    // DIAGNÓSTICO (Debugger): logueamos cada transición de fase para confirmar que 'combat' realmente llega
    // (si no, _inCombat nunca se activa y las habilidades no se cuentan aunque `me.abilities` sí venga).
    if (mi.round_phase != null && mi.round_phase !== lastPhase) { logDebug('PHASE ' + mi.round_phase); lastPhase = mi.round_phase; }
    if (mi.round_phase === 'end' || mi.round_phase === 'game_end') engine.setPhase('roundEnd');
    else if (mi.round_phase === 'shopping') engine.setPhase('buy');
    else if (mi.round_phase === 'combat') engine.setPhase('active');
  }
}
let lastWeapon = '';
let lastPhase = '';    // diagnóstico (Debugger): última round_phase logueada (dedupe)

// Práctica (Range) -> feedback instantáneo (timer). Resto -> feedback al morir.
function updateTiming(gameMode: string, scene: string): void {
  // Range y Deathmatch = accion continua -> feedback en vivo. Resto (bomb/swift/etc.) = al final de ronda.
  const live = gameMode === 'Range' || scene === 'Range' || gameMode === 'Deathmatch';
  const newTiming = live ? 'instant' : 'onDeath';
  if (newTiming === timing) return;
  timing = newTiming;
  engine.setFeedbackTiming(timing);
  manageInstantTimer();
  // cambió el contexto (Range<->partida): limpiamos la lista + contadores del overlay para arrancar de cero.
  overwolf.windows.sendMessage('in_game', 'reset', {}, () => {});
  const msg = t(live ? 'timing.live' : 'timing.match');
  overlayCal(msg, true);
  log('TIMING: ' + (live ? 'live' : 'match') + (gameMode ? ' (mode ' + gameMode + ')' : '') + (scene ? ' (scene ' + scene + ')' : ''));
}

function manageInstantTimer(): void {
  if (instantTimer) { clearInterval(instantTimer); instantTimer = null; }
  if (timing === 'instant') instantTimer = setInterval(() => engine.flushInstant(), INSTANT_FLUSH_MS);
}

// payload onNewEvents: { events: [ { name, data }, ... ] }
function handleGameEvents(payload: any): void {
  const events = (payload && payload.events) || [];
  for (const ev of events) {
    if (!ev || !ev.name) continue;
    logDebug('GEP-EVENT ' + ev.name + (ev.data !== undefined ? ' = ' + safe(ev.data).slice(0, 100) : ''));
    if (ev.name === 'match_info' && ev.data) tryRoundReport(ev.data);
    if (ev.name === 'kill') { const cls = engine.pushKill(); log('KILL · shot context: ' + cls); }
    if (ev.name === 'headshot') engine.pushHeadshot();
    if (ev.name === 'death') engine.setPhase('dead');
    if (ev.name === 'match_end') engine.setPhase('roundEnd');
  }
}

function tryRoundReport(data: any): void {
  try {
    const obj = typeof data === 'string' ? JSON.parse(data) : data;
    const rr = obj.round_report || (obj.match_info && obj.match_info.round_report);
    if (rr) engine.pushRoundReport(typeof rr === 'string' ? JSON.parse(rr) : rr);
  } catch (_) {}
}

// Nombre de arma normalizado a lowercase (las keys de PATTERNS/DETERMINISTIC/baselines son lowercase).
function cleanWeapon(internal: string): string {
  const parts = internal.split('_');
  return parts[parts.length - 1].toLowerCase();
}

// ---------------------------------------------------------------------------
// Stream de mouse (capturer C# por WebSocket)
// ---------------------------------------------------------------------------
// Lanza el capturer C# al iniciar la app, via el plugin Process Manager de Overwolf.
// El exe viene BUNDLEADO en el paquete (webpack -> dist/native/): como una app ow-native no puede
// ejecutar un archivo desde dentro del paquete, se EXTRAE una vez a la carpeta escribible de la app
// (appData) y se lanza desde ahí. `capturerPath` (config) queda como override manual para dev.
function launchCapturer(): void {
  if (capturerLaunched || mouseConnected) return; // ya corriendo / ya hay stream
  if (capturerPath) { launchCapturerAt(capturerPath); return; } // override manual (dev)
  ensureBundledCapturer((exePath) => {
    if (exePath) launchCapturerAt(exePath);
    else log('CAPTURER: could not prepare bundled exe — run AimCoach-MouseCapturer.exe manually or set the path in config');
  });
}

// Extrae el exe bundleado a appData\capturer-<version>\ (una sola vez por versión) y devuelve su ruta
// absoluta. La subcarpeta por versión hace que un update de la app re-extraiga el exe nuevo.
function ensureBundledCapturer(cb: (exePath: string | null) => void): void {
  overwolf.extensions.current.getManifest((mres: any) => {
    const version = (mres && mres.meta && mres.meta.version) || '0';
    const folder = 'capturer-' + version;
    const space = overwolf.extensions.io.enums.StorageSpace.appData;
    overwolf.extensions.io.getStoragePath(space, (sres: any) => {
      if (!sres || !sres.success || !sres.path) { log('CAPTURER: failed to get storage path ' + (sres && sres.error)); cb(null); return; }
      const dst = sres.path + '\\' + folder + '\\' + CAPTURER_EXE;
      lastCapturerDst = dst; // para el diagnóstico del supervisor
      overwolf.io.exist(dst, (exres: any) => {
        if (exres && exres.success && exres.exist) { cb(dst); return; } // ya extraído (misma versión)
        // aseguramos la carpeta y copiamos el exe una sola vez (el override reescribe si estaba a medias)
        overwolf.extensions.io.createDirectory(space, folder, () => {
          overwolf.io.copyFile(CAPTURER_SRC, dst, true, false, (cpres: any) => {
            if (cpres && cpres.success) { log('CAPTURER: exe extracted to ' + dst); cb(dst); }
            else { log('CAPTURER: copyFile failed (' + (cpres && cpres.error) + ') — did yarn build:native run before the build?'); cb(null); }
          });
        });
      });
    });
  });
}

// Lanza el exe (ruta absoluta) via el plugin Process Manager. Requiere plugins/process_manager.dll desbloqueado.
function launchCapturerAt(exePath: string): void {
  overwolf.extensions.current.getExtraObject('process-manager-plugin', (res: any) => {
    if (!res || !res.success || !res.object) {
      log('CAPTURER: process-manager plugin unavailable (missing unblocked plugins/process_manager.dll?) ' + (res && res.error));
      return;
    }
    try {
      // launchProcess(path, args, envJSON, hidden, closeWithApp, callback)
      res.object.launchProcess(exePath, '', '{}', true, true, (r: any) => {
        if (r && r.error) log('CAPTURER: launchProcess error ' + r.error);
        else { capturerLaunched = true; log('CAPTURER: launched via process-manager (' + exePath + ')'); }
      });
    } catch (e: any) {
      log('CAPTURER: launchProcess exception ' + (e && e.message));
    }
  });
}

// ---------------------------------------------------------------------------
// Supervisor del capturer: health-check cada CAPTURER_HEALTH_MS. Si el stream de mouse no está vivo,
// cuenta un strike, intenta auto-curarse (re-lanza; re-extrae si borraron el exe) y, tras
// CAPTURER_MAX_STRIKES seguidos, deja un log-trace de error decente (exportable) y lo marca en el overlay.
// Se auto-limpia al reconectar. El diagnóstico se recalcula contra la versión actual -> sigue válido tras updates.
// ---------------------------------------------------------------------------
function startCapturerSupervisor(): void {
  if (capturerHealthTimer) return;
  capturerHealthTimer = setInterval(capturerHealthTick, CAPTURER_HEALTH_MS);
}

function capturerHealthTick(): void {
  if (mouseConnected) { // sano o recuperado
    if (capturerReported || capturerStrikes > 0) onCapturerRecovered();
    capturerStrikes = 0; capturerReported = false;
    return;
  }
  if (capturerReported) return; // ya reportado: no re-lanzamos en loop; el reconnect del WS lo engancha si vuelve
  capturerStrikes++;
  log('CAPTURER: no mouse stream (attempt ' + capturerStrikes + '/' + CAPTURER_MAX_STRIKES + ') — retrying launch');
  capturerLaunched = false; // permitir re-lanzar (self-heal: ensureBundledCapturer re-extrae si el exe no está)
  launchCapturer();
  if (capturerStrikes >= CAPTURER_MAX_STRIKES) { capturerReported = true; reportCapturerFailure(); }
}

function onCapturerRecovered(): void {
  log('CAPTURER: mouse stream restored');
  // actualiza la marca del overlay (misma key -> reemplaza la fila del error por una en verde)
  overwolf.windows.sendMessage('in_game', 'feedback', { prio: 25, msg: t('capturer.recovered'), key: 'capturer-down' }, () => {});
}

// Junta el estado real (versión, exe extraído, plugin) y deja un trace multi-línea con la causa probable.
function reportCapturerFailure(): void {
  overwolf.extensions.current.getManifest((m: any) => {
    const version = (m && m.meta && m.meta.version) || '?';
    const space = overwolf.extensions.io.enums.StorageSpace.appData;
    overwolf.extensions.io.getStoragePath(space, (s: any) => {
      const dst = lastCapturerDst || (((s && s.path) || '?') + '\\capturer-' + version + '\\' + CAPTURER_EXE);
      overwolf.io.exist(dst, (e: any) => {
        const exeExists = !!(e && e.success && e.exist);
        overwolf.extensions.current.getExtraObject('process-manager-plugin', (p: any) => {
          const pluginOk = !!(p && p.success && p.object);
          const reason = !pluginOk ? 'process-manager plugin unavailable (missing unblocked plugins/process_manager.dll?)'
            : !exeExists ? 'extracted exe is missing (deleted? extraction or build:native failed?)'
              : 'exe exists but does not open the WebSocket (crashed / blocked by antivirus / port 9595 in use?)';
          const trace = [
            'CAPTURER ERROR — no mouse stream after ' + CAPTURER_MAX_STRIKES + ' attempts (~' + CAPTURER_MAX_STRIKES + ' min).',
            '  likely cause: ' + reason,
            '  app version: ' + version,
            '  expected exe: ' + dst + ' (exists: ' + exeExists + ')',
            '  process-manager plugin: ' + (pluginOk ? 'ok' : 'MISSING'),
            '  WebSocket: ' + CAPTURER_WS + ' (connected: ' + mouseConnected + ')',
            '  action: reinstall/update the app (re-extracts the exe) or run AimCoach-MouseCapturer.exe manually.',
          ].join('\n');
          log(trace);
          // marca visible en el overlay (feedback crítico, deduplicado por key; se limpia al reconectar)
          overwolf.windows.sendMessage('in_game', 'feedback', { prio: 97, msg: t('capturer.down'), key: 'capturer-down' }, () => {});
        });
      });
    });
  });
}

function connectMouseStream(): void {
  let ws: WebSocket;
  try {
    ws = new WebSocket(CAPTURER_WS);
  } catch (_) {
    setTimeout(connectMouseStream, 1500);
    return;
  }
  ws.onopen = () => { mouseConnected = true; log('CAPTURER: WebSocket connected (' + CAPTURER_WS + ') — mouse stream active'); };
  ws.onmessage = (msg: MessageEvent) => {
    try {
      const ev = JSON.parse(msg.data);
      if (ev.type === 'key') { engine.pushKey(ev); return; }
      if (cal360Active && ev.a === 'move') cal360Sum += Math.abs(ev.dx);
      engine.pushMouse(ev);
      mouseCount++;
      const now = Date.now();
      if (now - lastMouseLog > 3000) {
        lastMouseLog = now;
        logDebug('CAPTURER: ' + mouseCount + ' mouse events received');
      }
    } catch (_) {}
  };
  ws.onclose = () => { mouseConnected = false; setTimeout(connectMouseStream, 1500); };
  ws.onerror = () => { try { ws.close(); } catch (_) {} };
}

// ---------------------------------------------------------------------------
// Feedback -> overlay
// ---------------------------------------------------------------------------
function showFeedback(feedback: any): void {
  // overlay: solo el mensaje corto/accionable. log: el detalle con numeros.
  overwolf.windows.sendMessage('in_game', 'feedback', { prio: feedback.prio, msg: feedback.msg, key: feedback.key }, () => {});
  log('FEEDBACK: ' + (feedback.detail || feedback.msg));
}

start();

export {};
