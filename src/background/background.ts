// Background controller (ow-native). Corre como background page del app Overwolf.
// Orquesta: deteccion de Valorant, GEP (eventos del juego), stream de mouse (WebSocket
// del capturer C#), el motor de reglas, y las ventanas (config de escritorio + overlay in-game).

import { AimCoachEngine } from '../engine/ruleEngine';
import { verify360, sensMath } from '../engine/calibration';

const VALORANT_ID = 21640;
const GEP_FEATURES = ['game_info', 'me', 'match_info', 'kill', 'death', 'gep_internal'];
const CAPTURER_WS = 'ws://127.0.0.1:9595/';
const CONFIG_KEY = 'aimcoach_config';

let engine: any = null;
let valorantRunning = false;
let overlayVisible = false;

// sensibilidad del usuario (para verify360); el engine usa el baseline.
let dpi = 800;
let sens = 0.4;
let capturerPath = '';        // ruta absoluta al MouseCapturer.exe (se setea en config)
let capturerLaunched = false;
let overlayScale = 1;         // escala del TEXTO del overlay (ajustable desde config)
let overlayMaxItems = 3;      // cantidad de últimos errores a mostrar (ajustable desde config)
let overlayWidthPct = 0.30;   // ancho del overlay como % de la pantalla del juego
let overlayHeightPct = 0.45;  // alto del overlay como % de la pantalla del juego
let overlayCorner = 'top-left'; // esquina donde se ancla el overlay
let overlayOpacity = 1;       // opacidad del overlay (0.3–1)
let debug = false;            // Modo Debugger: emite logs verbosos (mouse/GEP/strafe/flicks) y muestra el panel
let calWeapon = 'vandal';     // arma seleccionada para calibrar (en el Range no se autodetecta)

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
  });
  loadSavedConfig();
  applySens();
  log('background iniciado');
  // Overlay-first: la config solo se abre sola si falta setup (ruta del capturer).
  // En uso normal todo va por el overlay + hotkeys. Abrila cuando quieras con Ctrl+Shift+C.
  if (!capturerPath) openWindow('config');
  launchCapturer();
  overwolf.windows.onMessageReceived.addListener((m: any) => onConfigMessage(m));
  initHotkeys();
  initGameDetection();
  initGep();
  connectMouseStream();
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
    if (typeof saved.debug === 'boolean') debug = saved.debug;
    if (typeof saved.calWeapon === 'string') calWeapon = saved.calWeapon;
    engine.setPracticeWeapon(calWeapon); // fallback de arma para el Range (GEP no la da)
    if (saved.baselines) {
      engine.setBaselines(saved.baselines);
      log('baselines por arma cargados: ' + Object.keys(saved.baselines).join(', '));
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
        if (typeof m.content.overlayScale === 'number' || typeof m.content.overlayMaxItems === 'number' || typeof m.content.overlayOpacity === 'number') sendOverlayConfig();
        if (typeof m.content.overlayWidthPct === 'number') overlayWidthPct = m.content.overlayWidthPct;
        if (typeof m.content.overlayHeightPct === 'number') overlayHeightPct = m.content.overlayHeightPct;
        if (typeof m.content.overlayCorner === 'string') overlayCorner = m.content.overlayCorner;
        if (typeof m.content.overlayWidthPct === 'number' || typeof m.content.overlayHeightPct === 'number' || typeof m.content.overlayCorner === 'string') applyOverlaySize();
        if (typeof m.content.debug === 'boolean') debug = m.content.debug;
        if (typeof m.content.calWeapon === 'string') { calWeapon = m.content.calWeapon; engine.setPracticeWeapon(calWeapon); }
        if (m.content.baselines) engine.setBaselines(m.content.baselines);
        log('config aplicada (dpi ' + dpi + ', sens ' + sens + ', arma ' + calWeapon + ')');
        launchCapturer(); // por si recien configuraron la ruta
      }
      break;
    case 'cal-360-start':
      startCal360();
      break;
    case 'cal-spray-start':
      startCalBaseline();
      break;
    case 'export-logs': {
      // arma el texto de los últimos 40 min con timestamp y lo manda a la config para descargar.
      const text = logBuffer.map(e => '[' + new Date(e.t).toLocaleTimeString() + '] ' + e.line).join('\n');
      sendToConfig('logs-export', { text });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Calibracion POR TIEMPO, dirigida desde el overlay in-game (sin botones stop,
// sin alt-tab en medio del drill). Se dispara por hotkey o desde la config.
// ---------------------------------------------------------------------------
const COUNTDOWN_SECS = 5;     // tiempo para alt-tab al juego antes de empezar
const REC_360_SECS = 6;       // ventana para hacer UNA vuelta limpia
const REC_SPRAY_SECS = 30;    // ventana para sprayear

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
  overlayCal(`${label} — empezá en ${n}…`);
  calInterval = setInterval(() => {
    n--;
    if (n > 0) overlayCal(`${label} — empezá en ${n}…`);
    else { stopCalInterval(); then(); }
  }, 1000);
}

function timedRecord(prompt: string, secs: number, onTick: () => string, done: () => void): void {
  stopCalInterval();
  let n = secs;
  const render = () => overlayCal(`${prompt} — ${n}s${onTick()}`);
  render();
  calInterval = setInterval(() => {
    n--;
    if (n > 0) render();
    else { stopCalInterval(); done(); }
  }, 1000);
}

function startCal360(): void {
  if (calBusy) return;
  if (!valorantRunning) { log('CAL: abrí Valorant primero'); sendToConfig('cal-msg', { text: 'Abrí Valorant primero.' }); return; }
  if (!mouseConnected) { log('CAL: capturer no conectado — corré MouseCapturer.exe'); sendToConfig('cal-msg', { text: 'Capturer no conectado: corré MouseCapturer.exe' }); return; }
  calBusy = true;
  openOverlay();
  log('CAL 360: empezando…');
  countdown('Calibración 360', () => {
    cal360Active = true; cal360Sum = 0;
    timedRecord('Girá UNA vuelta 360° limpia', REC_360_SECS, () => '', () => {
      cal360Active = false;
      const res = verify360(cal360Sum, dpi, sens);
      overlayCal(`360 ${res.ok ? 'OK' : 'revisar DPI'} · drift ${res.driftPct}%`, true);
      sendToConfig('cal-360-result', res);
      log('CAL 360: ' + cal360Sum + ' counts -> sens ' + res.measuredSens + ' (drift ' + res.driftPct + '%)');
      calBusy = false;
    });
  });
}

// Baseline simple: hacé TARGET_SPRAYS sprays (cualquier ráfaga), termina solo al llegar.
function startCalBaseline(): void {
  if (calBusy) return;
  if (!valorantRunning) { log('CAL: abrí Valorant primero'); sendToConfig('cal-msg', { text: 'Abrí Valorant primero.' }); return; }
  if (!mouseConnected) { log('CAL: capturer no conectado — corré MouseCapturer.exe'); sendToConfig('cal-msg', { text: 'Capturer no conectado: corré MouseCapturer.exe' }); return; }
  calBusy = true;
  openOverlay();
  log('CAL baseline: empezando…');
  countdown(`Calibración ${calWeapon}`, () => {
    engine.startCalibration(calWeapon);
    calBaselineActive = true;
    overlayCal(`${calWeapon}: hacé ${TARGET_SPRAYS} sprays — 0/${TARGET_SPRAYS}`);
    stopCalInterval();
    calInterval = setTimeout(() => { if (calBaselineActive) finishBaseline(); }, 60000); // safety
  });
}

function onCalSprayProgress(p: any): void {
  sendToConfig('cal-progress', p);
  if (!calBaselineActive) return;
  // accepted === false -> el spray no pasó el gate de calidad (flojo/reposición): no cuenta.
  if (p.accepted === false) { overlayCal(`Spray flojo, no cuenta — ${p.sprays}/${TARGET_SPRAYS}`); return; }
  overlayCal(`Sprays — ${p.sprays}/${TARGET_SPRAYS}`);
  if (p.sprays >= TARGET_SPRAYS) finishBaseline();
}

function finishBaseline(): void {
  if (!calBaselineActive) return;
  calBaselineActive = false;
  stopCalInterval();
  try {
    const result = engine.finishCalibration(); // { weapon, baseline }
    overlayCal(`Baseline ${result.weapon} ✓`, true);
    sendToConfig('cal-spray-result', result);
    log('CAL baseline ' + result.weapon + ': ' + JSON.stringify(result.baseline));
  } catch (err: any) {
    overlayCal('Pocos sprays, repetí', true);
    sendToConfig('cal-spray-result', { error: (err && err.message) || 'error' });
    log('CAL baseline error: ' + (err && err.message));
  }
  calBusy = false;
}

function overlayFlick(info: any): void {
  overwolf.windows.sendMessage('in_game', 'flick', { type: info.type }, () => {});
  logDebug(`FLICK ${info.type} · dur ${info.dur}ms · mag ${info.mag} · ajuste ${info.aligned} (umbral ${info.threshold})`);
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
    overlayVisible = true; log('overlay abierto');
    setTimeout(() => { sendOverlayConfig(); applyOverlaySize(); }, 300);
  });
}

function sendOverlayConfig(): void {
  overwolf.windows.sendMessage('in_game', 'overlay-cfg', { scale: overlayScale, maxItems: overlayMaxItems, opacity: overlayOpacity }, () => {});
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
    overwolf.windows.hide('in_game', () => { overlayVisible = false; log('overlay oculto'); });
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
    else log('Valorant no detectado todavia (abrilo y deberia engancharse)');
  });
}

function onValorantStart(): void {
  if (valorantRunning) return;
  valorantRunning = true;
  log('Valorant detectado -> registrando features y abriendo overlay');
  setRequiredFeatures();
  openOverlay();
}

function onValorantStop(): void {
  valorantRunning = false;
  log('Valorant cerrado');
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
    log('setRequiredFeatures fallo (' + (res && res.error) + ')' + (retries > 0 ? ' -> reintento' : ''));
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
  log(`GEP: capturando Valorant (${gepCount} updates) ultimo ${kind}: ${safe(payload).slice(0, 160)}`);
}

// payload onInfoUpdates2: { feature, info: { match_info | game_info: {...} }, ... }
function handleInfoUpdate(payload: any): void {
  const info = payload && payload.info;
  if (!info) return;

  // Modo de juego -> define el momento del feedback.
  const gameMode = info.match_info && info.match_info.game_mode;
  const scene = info.game_info && info.game_info.scene;
  if (gameMode || scene) updateTiming(gameMode, scene);

  // Agente equipado (para el recordatorio de habilidades pre-ronda). Codename interno, ej "BountyHunter_PC_C".
  if (info.me && info.me.agent) engine.setAgent(info.me.agent);
  // Disponibilidad de habilidades por tecla: {"C":true,"Q":true,"E":true,"X":false}. Puede venir como
  // objeto o como string JSON (GEP suele serializar los objetos anidados). El USO real se infiere de las
  // transiciones true->false dentro del engine.
  if (info.me && info.me.abilities != null) {
    let ab: any = info.me.abilities;
    if (typeof ab === 'string') { try { ab = JSON.parse(ab); } catch (_) { ab = null; } }
    if (ab) engine.setAbilities(ab);
  }

  const mi = info.match_info;
  if (mi) {
    for (const key of Object.keys(mi)) {
      if (key.indexOf('scoreboard_') === 0) {
        try {
          const row = JSON.parse(mi[key]);
          if (row.is_local && row.weapon) engine.setWeapon(cleanWeapon(row.weapon));
        } catch (_) {}
      }
    }
    // round_number: contador de ronda. Su CAMBIO dispara el recordatorio de habilidades (1 vez/ronda).
    if (mi.round_number) engine.setRoundNumber(mi.round_number);
    // round_phase: shopping (compra) | combat (activo) | end / game_end (fin de ronda)
    if (mi.round_phase === 'end' || mi.round_phase === 'game_end') engine.setPhase('roundEnd');
    else if (mi.round_phase === 'shopping') engine.setPhase('buy');
    else if (mi.round_phase === 'combat' || mi.round_number) engine.setPhase('active');
  }
}

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
  const msg = live ? 'Feedback en vivo' : 'Modo partida — feedback al final de ronda';
  overlayCal(msg, true);
  log('TIMING: ' + msg + (gameMode ? ' (mode ' + gameMode + ')' : '') + (scene ? ' (scene ' + scene + ')' : ''));
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
    if (ev.name === 'kill') { const cls = engine.pushKill(); log('KILL · contexto del tiro: ' + cls); }
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

function cleanWeapon(internal: string): string {
  const parts = internal.split('_');
  return parts[parts.length - 1];
}

// ---------------------------------------------------------------------------
// Stream de mouse (capturer C# por WebSocket)
// ---------------------------------------------------------------------------
// Lanza el capturer C# al iniciar la app, via el plugin Process Manager de Overwolf.
// Requiere plugins/process_manager.dll (desbloqueado) y la ruta del .exe configurada.
function launchCapturer(): void {
  if (capturerLaunched || mouseConnected) return; // ya corriendo / ya hay stream
  if (!capturerPath) {
    log('CAPTURER: ruta no configurada — poné la ruta del MouseCapturer.exe en la config (o corrélo a mano)');
    return;
  }
  overwolf.extensions.current.getExtraObject('process-manager-plugin', (res: any) => {
    if (!res || !res.success || !res.object) {
      log('CAPTURER: plugin process-manager no disponible (¿falta plugins/process_manager.dll desbloqueado?) ' + (res && res.error));
      return;
    }
    try {
      // launchProcess(path, args, envJSON, hidden, closeWithApp, callback)
      res.object.launchProcess(capturerPath, '', '{}', true, true, (r: any) => {
        if (r && r.error) log('CAPTURER: launchProcess error ' + r.error);
        else { capturerLaunched = true; log('CAPTURER: lanzado via process-manager'); }
      });
    } catch (e: any) {
      log('CAPTURER: launchProcess excepcion ' + (e && e.message));
    }
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
  ws.onopen = () => { mouseConnected = true; log('CAPTURER: WebSocket conectado (' + CAPTURER_WS + ') — stream de mouse activo'); };
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
        logDebug('CAPTURER: ' + mouseCount + ' eventos de mouse recibidos');
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
