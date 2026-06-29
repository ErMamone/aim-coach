// ruleEngine.js (v2) — usa la referencia personal del usuario (baseline de calibration.js)
// en vez de perfiles de arma inventados. Las reglas flaggean DESVIOS del baseline propio.
//
// Streams de entrada:
//   1) mouse (capturador C#): {t, dx, dy, a:'move|down|up', b:'left|right'}
//   2) Overwolf Valorant: round_report (por ronda), weapon, phase
// Salida: feedback que se superficie solo en huecos muertos (post-muerte / fin ronda / buy).

const { sprayGestureQuality } = require('./calibration');

// baseline por defecto (placeholder hasta que el usuario calibre). Valores conservadores.
const DEFAULT_BASELINE = {
  pullPerMsBaseline: 0.5, pullPerMsFloor: 0.35,
  monotonicityBaseline: 0.9, monotonicityFloor: 0.75,
  flickBias: 0, flickStd: 20,
};

const AUTO_FIRE_MS = 110;          // hold mas largo que esto = spray sostenido, no tap
const SPAM_ICI_MS = 90;            // inter-click interval por debajo = sintoma de spam
const CORRECTION_WINDOW_MS = 90;   // ventana post-click para medir overshoot

class AimCoachEngine {
  constructor(opts = {}) {
    this.onFeedback = opts.onFeedback || (() => {});
    this.baseline = opts.baseline || DEFAULT_BASELINE;
    this.weapon = null;
    this.deadTime = false;

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

  _emptyRound() {
    return { sprays: [], flicks: [], taps: 0, shortICIs: 0, overshoots: [], report: null };
  }

  // -------- entradas --------
  setWeapon(w) { this.weapon = w; }

  setPhase(phase) {
    const wasDead = this.deadTime;
    this.deadTime = phase === 'buy' || phase === 'dead' || phase === 'roundEnd';
    if (this.deadTime && !wasDead) this._surface();
  }

  pushMouse(ev) {
    if (ev.a === 'down' && ev.b === 'left') this._onLeftDown(ev);
    else if (ev.a === 'up' && ev.b === 'left') this._onLeftUp(ev);
    else if (ev.a === 'move') this._onMove(ev);
  }

  pushRoundReport(report) {
    this._round.report = report;
    this._evaluateRoundRules();
    this.setPhase('roundEnd');
    this._round = this._emptyRound();
  }

  // -------- segmentacion --------
  _onMove(ev) {
    const dt = Math.max(1, ev.t - this._lastMoveT);
    const dist = Math.hypot(ev.dx, ev.dy);
    this._recentSpeed = 0.6 * this._recentSpeed + 0.4 * (dist / dt);
    this._lastMoveT = ev.t;
    this._lastDx = ev.dx;
    if (this._leftDown) this._holdMoves.push({ dy: ev.dy });

    // si hay ventana de correccion abierta, acumular SOLO el movimiento opuesto a la aproximacion
    if (this._correction) {
      if (ev.t > this._correction.until) this._closeCorrection();
      else {
        const s = Math.sign(ev.dx);
        if (s === -this._correction.approachSign) this._correction.dx += ev.dx; // correccion real
        else if (s === this._correction.approachSign) this._closeCorrection();   // arranca el flick siguiente
      }
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
    } else {
      // tap -> abrir ventana para medir overshoot (correccion opuesta a la aproximacion)
      this._round.taps++;
      this._round.flicks.push({ settledBeforeClick: this._settledAtClick });
      this._correction = { until: ev.t + CORRECTION_WINDOW_MS, dx: 0, approachSign: this._approachSign };
    }
  }

  _closeCorrection() {
    const c = this._correction; this._correction = null;
    if (!c || c.approachSign === 0) return;
    // overshoot = correccion en sentido OPUESTO a la aproximacion (te pasaste y volviste)
    const corrSign = Math.sign(c.dx);
    if (corrSign !== 0 && corrSign === -c.approachSign) {
      this._round.overshoots.push(Math.abs(c.dx) * c.approachSign); // signo = direccion del flick original
    } else {
      this._round.overshoots.push(0); // sin correccion opuesta = no overshoot detectado
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
