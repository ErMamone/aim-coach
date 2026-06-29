// ruleEngine.js (v2) — usa la referencia personal del usuario (baseline de calibration.js)
// en vez de perfiles de arma inventados. Las reglas flaggean DESVIOS del baseline propio.
//
// Streams de entrada:
//   1) mouse (capturador C#): {t, dx, dy, a:'move|down|up', b:'left|right'}
//   2) Overwolf Valorant: round_report (por ronda), weapon, phase
// Salida: feedback que se superficie solo en huecos muertos (post-muerte / fin ronda / buy).

const { sprayGestureQuality, BaselineCalibrator } = require('./calibration');

// baseline por defecto (placeholder hasta que el usuario calibre). Valores conservadores.
const DEFAULT_BASELINE = {
  pullPerMsBaseline: 0.5, pullPerMsFloor: 0.35,
  monotonicityBaseline: 0.9, monotonicityFloor: 0.75,
  flickBias: 0, flickStd: 20,
};

const AUTO_FIRE_MS = 110;          // hold mas largo que esto = spray sostenido, no tap
const SPAM_ICI_MS = 90;            // inter-click interval por debajo = sintoma de spam
const CORRECTION_WINDOW_MS = 90;   // ventana post-click para medir el ajuste del flick
const FLICK_ERR_COUNTS = 8;        // |ajuste| por debajo = flick "perfecto"; arriba = flojo/pasado
const FLICK_STREAK_N = 4;          // flicks flojos/pasados seguidos -> recomendar cambiar sens

class AimCoachEngine {
  constructor(opts = {}) {
    this.onFeedback = opts.onFeedback || (() => {});
    this.onCalProgress = opts.onCalProgress || (() => {}); // feedback de calibracion
    this.onFlick = opts.onFlick || (() => {});             // clasificacion por flick (flojo/perfecto/pasado)
    this.baseline = opts.baseline || DEFAULT_BASELINE;

    this._flickStreakType = null;  // racha de flicks del mismo error (flojo|pasado)
    this._flickStreakCount = 0;
    this.weapon = null;
    this.deadTime = false;
    this._timing = 'onDeath';      // 'instant' (practica/range) | 'onDeath' (partidas)

    this._calibrating = false;     // modo calibracion: junta sprays/overshoots en un BaselineCalibrator
    this._calibrator = null;

    this._leftDown = false;
    this._holdStart = 0;
    this._holdMoves = [];          // movimientos durante el hold (para calidad de gesto)
    this._lastMoveT = 0;
    this._recentSpeed = 0;
    this._lastClickT = 0;

    this._approachSign = 0;        // direccion horizontal de aproximacion al ultimo tap
    this._correction = null;       // {until, dx, approachSign} ventana de medicion de overshoot

    this._round = this._emptyRound();
    this._pending = [];
  }

  setBaseline(b) { this.baseline = { ...DEFAULT_BASELINE, ...b }; }

  // -------- modo calibracion --------
  // Junta sprays (y overshoots de flicks) hechos durante un drill, para derivar el baseline personal.
  startCalibration() {
    this._calibrator = new BaselineCalibrator();
    this._calibrating = true;
  }
  // Devuelve el baseline derivado. Lanza si hubo < 3 sprays.
  finishCalibration() {
    this._calibrating = false;
    const baseline = this._calibrator.build();
    this._calibrator = null;
    this.setBaseline(baseline);
    return baseline;
  }
  cancelCalibration() {
    this._calibrating = false;
    this._calibrator = null;
  }
  calibrationCount() {
    return this._calibrator ? this._calibrator.sprays.length : 0;
  }

  _emptyRound() {
    return { sprays: [], flicks: [], taps: 0, shortICIs: 0, overshoots: [], flickClasses: [], report: null };
  }

  // -------- entradas --------
  setWeapon(w) { this.weapon = w; }

  // Define CUANDO se superficie el feedback (mismo contenido, distinto momento):
  //  'instant' -> practica/range: evaluado y mostrado en vivo (flush por timer del background)
  //  'onDeath' -> partidas: evaluado y mostrado cuando morís
  setFeedbackTiming(mode) {
    this._timing = mode === 'instant' ? 'instant' : 'onDeath';
  }

  setPhase(phase) {
    this.deadTime = phase === 'buy' || phase === 'dead' || phase === 'roundEnd';
    // En partidas, la muerte es la ventana optima para dar info.
    if (this._timing === 'onDeath' && phase === 'dead') this._flush();
  }

  // Llamado por el background en modo practica (timer) para feedback en vivo.
  flushInstant() {
    if (this._timing === 'instant') this._flush();
  }

  // Evalua la ventana acumulada, superficie el feedback y resetea.
  _flush() {
    this._evaluateRoundRules();
    this._surface();
    this._round = this._emptyRound();
  }

  pushMouse(ev) {
    if (ev.a === 'down' && ev.b === 'left') this._onLeftDown(ev);
    else if (ev.a === 'up' && ev.b === 'left') this._onLeftUp(ev);
    else if (ev.a === 'move') this._onMove(ev);
  }

  // round_report de Valorant: solo lo guardamos (alimenta R6); el flush decide cuando mostrar.
  pushRoundReport(report) {
    this._round.report = report;
  }

  // -------- segmentacion --------
  _onMove(ev) {
    const dt = Math.max(1, ev.t - this._lastMoveT);
    const dist = Math.hypot(ev.dx, ev.dy);
    this._recentSpeed = 0.6 * this._recentSpeed + 0.4 * (dist / dt);
    this._lastMoveT = ev.t;
    this._lastDx = ev.dx;
    if (this._leftDown) this._holdMoves.push({ dy: ev.dy });

    // ventana de ajuste post-tap: acumulamos TODO el movimiento horizontal para
    // clasificar el flick (sigue en la direccion = flojo; vuelve = pasado; casi nada = perfecto).
    if (this._correction) {
      if (ev.t > this._correction.until) this._closeCorrection();
      else this._correction.netDx += ev.dx;
    }
  }

  _onLeftDown(ev) {
    if (this._correction) this._closeCorrection(); // cerrar medicion previa antes del nuevo tap
    if (this._lastClickT) {
      const ici = ev.t - this._lastClickT;
      if (ici < SPAM_ICI_MS) this._round.shortICIs++;
    }
    this._lastClickT = ev.t;
    this._approachSign = Math.sign(this._lastDx || 0);
    this._settledAtClick = this._recentSpeed < 0.15;

    this._leftDown = true;
    this._holdStart = ev.t;
    this._holdMoves = [];
  }

  _onLeftUp(ev) {
    this._leftDown = false;
    const durationMs = ev.t - this._holdStart;

    if (durationMs >= AUTO_FIRE_MS) {
      // spray sostenido -> calidad de gesto contra el baseline propio
      const q = sprayGestureQuality(this._holdMoves);
      if (q) this._round.sprays.push({ ...q, durationMs, pullPerMs: q.totalPull / durationMs });
      // en modo calibracion, ademas alimentamos el BaselineCalibrator
      if (this._calibrating && this._calibrator) {
        this._calibrator.addSpray(this._holdMoves, durationMs);
        this.onCalProgress({ sprays: this._calibrator.sprays.length });
      }
    } else {
      // tap -> abrir ventana para medir el ajuste del flick
      this._round.taps++;
      this._round.flicks.push({ settledBeforeClick: this._settledAtClick });
      this._correction = { until: ev.t + CORRECTION_WINDOW_MS, netDx: 0, approachSign: this._approachSign };
    }
  }

  _closeCorrection() {
    const c = this._correction; this._correction = null;
    if (!c || c.approachSign === 0) return;

    // aligned > 0: seguiste moviendo hacia el objetivo despues del tap = quedaste corto (FLOJO)
    // aligned < 0: volviste en sentido opuesto = te pasaste (PASADO)
    const aligned = c.netDx * c.approachSign;
    let type;
    if (aligned > FLICK_ERR_COUNTS) type = 'flojo';
    else if (aligned < -FLICK_ERR_COUNTS) type = 'pasado';
    else type = 'perfecto';

    // overshoot (con signo) para R4 y para la calibracion de baseline
    const overshoot = aligned < 0 ? Math.abs(c.netDx) * c.approachSign : 0;
    this._round.overshoots.push(overshoot);
    if (this._calibrating && this._calibrator) this._calibrator.addFlickOvershoot(overshoot);

    this._classifyFlick(type);
  }

  // Feedback preciso por flick + recomendacion de sens cuando hay racha del mismo error.
  _classifyFlick(type) {
    this._round.flickClasses.push(type);

    // etiqueta en vivo del flick (solo en practica: en partida distrae)
    if (this._timing === 'instant') this.onFlick(type);

    // racha de flojos/pasados seguidos
    if (type === 'flojo' || type === 'pasado') {
      if (this._flickStreakType === type) this._flickStreakCount++;
      else { this._flickStreakType = type; this._flickStreakCount = 1; }
    } else {
      this._flickStreakType = null; this._flickStreakCount = 0;
    }

    if (this._flickStreakCount >= FLICK_STREAK_N) {
      const rec = type === 'pasado'
        ? `${FLICK_STREAK_N} flicks pasados seguidos — probá BAJAR la sens.`
        : `${FLICK_STREAK_N} flicks flojos seguidos — probá SUBIR la sens.`;
      this._queue(95, rec);
      if (this._timing === 'instant') this._surface();
      this._flickStreakCount = 0; // evitar repetir cada flick
    }
  }

  // -------- reglas (todas relativas al baseline personal) --------
  _evaluateRoundRules() {
    const r = this._round, b = this.baseline;

    // R1: spam de clicks
    if (r.shortICIs >= 4) {
      this._queue(70, `Spam de clicks (${r.shortICIs} disparos muy seguidos). Tapeá mas controlado, dejá estabilizar el crosshair entre tiros.`);
    }

    // R2: recoil por debajo de TU baseline (pull flojo)
    const weakSprays = r.sprays.filter(s => s.pullPerMs < b.pullPerMsFloor && s.durationMs > 200);
    if (weakSprays.length >= 2) {
      const avg = (weakSprays.reduce((a, s) => a + s.pullPerMs, 0) / weakSprays.length).toFixed(2);
      this._queue(85, `Tu control de recoil cayó por debajo de tu baseline (pull ${avg}, tu referencia es ${b.pullPerMsBaseline}). Estás tirando mas flojo de lo que sabés. Volvé a bajar parejo.`);
    }

    // R3: gesto poco monotono (metiendo correcciones hacia arriba en pleno spray)
    const jerky = r.sprays.filter(s => s.monotonicity < b.monotonicityFloor && s.durationMs > 200);
    if (jerky.length >= 2) {
      this._queue(78, `Tu pull-down se está volviendo errático (monotonía ${jerky[0].monotonicity} vs baseline ${b.monotonicityBaseline}). Tirá en una sola dirección sostenida, sin micro-correcciones arriba.`);
    }

    // R4: overshoot anomalo respecto a TU distribucion personal
    const realOver = r.overshoots.filter(o => o !== 0);
    if (realOver.length >= 3) {
      const mean = realOver.reduce((a, o) => a + o, 0) / realOver.length;
      const deviation = mean - b.flickBias;
      if (Math.abs(deviation) > 1.5 * b.flickStd) {
        const dir = deviation > 0 ? 'pasándote mas de lo normal' : 'quedándote mas corto de lo normal';
        this._queue(75, `Tus flicks esta ronda están ${dir} (desvío ${Math.round(deviation)} counts vs tu sesgo habitual de ${b.flickBias}). Ajustá la fuerza del flick.`);
      }
    }

    // R5: clickear sin estabilizar
    const rushed = r.flicks.filter(f => !f.settledBeforeClick);
    if (r.flicks.length >= 3 && rushed.length / r.flicks.length > 0.6) {
      this._queue(72, `Disparás antes de estabilizar (${rushed.length}/${r.flicks.length} flicks). Frená el mouse un instante antes del click.`);
    }

    // R7: resumen de precision de flicks (flojo / perfecto / pasado)
    const fc = r.flickClasses;
    if (fc.length >= 3) {
      const flojo = fc.filter(t => t === 'flojo').length;
      const pasado = fc.filter(t => t === 'pasado').length;
      const ok = fc.filter(t => t === 'perfecto').length;
      if (flojo + pasado > ok) {
        const peor = pasado >= flojo ? 'te estás pasando' : 'te estás quedando corto';
        this._queue(65, `Flicks: ${ok} perfectos · ${flojo} flojos · ${pasado} pasados. En general ${peor}.`);
      }
    }

    // R6: round_report de Overwolf -> crosshair placement (ancla de resultado, grueso)
    if (r.report) {
      const hits = num(r.report.hit);
      const hs = num(r.report.headshot) + num(r.report.final_headshot);
      const body = num(r.report.bodyshots), legs = num(r.report.legshots);
      const total = hits || (hs + body + legs);
      if (total >= 4) {
        const hsRatio = hs / total;
        if (hsRatio < 0.2) this._queue(60, `Esta ronda: ${hs}/${total} a la cabeza. Apuntás bajo — subí el crosshair a altura de cabeza ANTES de ver al enemigo.`);
        else if (hsRatio > 0.5) this._queue(20, `Buen crosshair placement (${hs}/${total} headshots). Mantenelo.`);
      }
    }
  }

  _queue(prio, msg) { this._pending.push({ prio, msg }); }
  _surface() {
    if (!this._pending.length) return;
    this._pending.sort((a, b) => b.prio - a.prio);
    const top = this._pending.slice(0, 2);
    this._pending = [];
    for (const f of top) this.onFeedback(f);
  }
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
module.exports = { AimCoachEngine, DEFAULT_BASELINE };
