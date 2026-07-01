// ruleEngine.js (v2) — usa la referencia personal del usuario (baseline de calibration.js)
// en vez de perfiles de arma inventados. Las reglas flaggean DESVIOS del baseline propio.
//
// Streams de entrada:
//   1) mouse (capturador C#): {t, dx, dy, a:'move|down|up', b:'left|right'}
//   2) Overwolf Valorant: round_report (por ronda), weapon, phase
// Salida: feedback que se superficie solo en huecos muertos (post-muerte / fin ronda / buy).

const { sprayGestureQuality, BaselineCalibrator } = require('./calibration');
const recoil = require('./recoil');

// baseline por defecto (placeholder hasta que el usuario calibre). Valores conservadores.
const DEFAULT_BASELINE = {
  pullPerMsBaseline: 0.5, pullPerMsFloor: 0.35,
  monotonicityBaseline: 0.9, monotonicityFloor: 0.75,
  flickBias: 0, flickStd: 20,
};

const AUTO_FIRE_MS = 110;          // hold mas largo que esto = ya no es tap simple
const SUSTAINED_MS = 350;          // hold mas largo que esto = spray sostenido (recoil real). Entre medio = miniburst
const DEDUP_MS = 12000;            // no repetir el MISMO tipo de mensaje antes de este tiempo
const COUNTER_STRAFE_MS = 100;     // frenar la tecla hasta ~100ms antes del tiro = contra-strafe real (bien)
const STATIC_MS = 1000;            // sin moverte por mas de esto al disparar = ESTATICO (predecible)
const KILL_AFTER_SHOT_MS = 1500;   // kill dentro de esto tras un tiro -> se atribuye a ese contexto de movimiento
const MOVE_SHOT_RATIO = 0.5;       // fraccion de tiros de un tipo para avisar
const SPAM_ICI_MS = 90;            // inter-click interval por debajo = sintoma de spam
const CORRECTION_WINDOW_MS = 90;   // ventana post-click para medir el ajuste del flick
const FLICK_ERR_COUNTS = 10;       // piso de |ajuste| tolerado (counts) — abajo de esto siempre "perfecto"
const FLICK_ERR_RATIO = 0.14;      // tolerancia como % del recorrido del flick (flicks largos toleran mas)
const MIN_FLICK_MAG = 35;          // recorrido minimo (counts) para que un tap cuente como flick real
const FLICK_MAX_ADJ_RATIO = 1.5;   // si |ajuste| > este x el flick, no es correccion sino el flick SIGUIENTE -> se descarta
const FAST_FLICK_MS = 160;         // flick mas rapido que esto = reactivo: el pulso mete micro-desvios, se tolera mas
const FAST_FLICK_TOL = 2.0;        // multiplicador de tolerancia para flicks rapidos
const SLOW_FLICK_MS = 250;         // solo flicks deliberados (mas lentos que esto) se juzgan por "estabilizar"
const FLICK_SLOW_MS = 300;         // en-target pero mas lento que esto (+ margen por distancia) = "lento", no "perfecto"
const FLICK_SLOW_PER_COUNT = 0.15; // margen extra de tiempo por count de recorrido (flicks grandes tardan mas)
const FLICK_STREAK_N = 8;          // flicks flojos/pasados seguidos (reales) -> recomendar cambiar sens
const MACRO_WINDOW_MS = 150;       // ventana para detectar rafaga de clicks inhumana
const MACRO_CLICKS = 5;            // clicks dentro de la ventana = posible macro / mouse defectuoso
const PLACEMENT_LOW_STREAK = 2;    // rondas seguidas pegando A LAS PIERNAS/abajo -> aviso (apuntás muy bajo)
const PLACEMENT_CHEST_STREAK = 3;  // rondas seguidas pegando AL PECHO (no cabeza) -> crosshair placement bajo

class AimCoachEngine {
  constructor(opts = {}) {
    this.onFeedback = opts.onFeedback || (() => {});
    this.onCalProgress = opts.onCalProgress || (() => {}); // feedback de calibracion
    this.onFlick = opts.onFlick || (() => {});             // clasificacion por flick (flojo/perfecto/pasado)
    this.onStrafe = opts.onStrafe || (() => {});           // info de movimiento por tiro (para debug/tuneo)
    this.baselines = opts.baselines || {};                 // baseline POR ARMA: { vandal: {...}, phantom: {...} }
    this._calWeapon = null;                                // arma que se esta calibrando
    this._countsPerDegree = 0;                             // conversion counts<->grados (de la sens del usuario)
    this._recoilRefs = opts.recoilRefs || {};             // curva de recoil de referencia POR ARMA (grados)
    this._calCurves = [];                                  // curvas capturadas durante la calibracion

    this._flickStreakType = null;  // racha de flicks del mismo error (flojo|pasado)
    this._flickStreakCount = 0;
    this._recentClicks = [];       // timestamps de clicks recientes (deteccion de macro)
    this._lowStreak = 0;           // rondas seguidas pegando a las piernas/abajo
    this._chestStreak = 0;         // rondas seguidas pegando al pecho (no cabeza)
    this._recentMsgs = {};         // {key: timestamp} para no repetir el mismo tipo de mensaje
    this._keys = {};               // teclas de teclado actualmente presionadas (WASD/QECXF/...)
    this._moveStopT = 0;           // ultimo momento en que soltaste TODAS las teclas de movimiento
    this._lastKillT = 0;           // para correlacionar el evento headshot con el kill reciente
    this._killCount = 0;           // kills de la sesion (para el % de headshots)
    this._hsKillCount = 0;         // kills a la cabeza

    // medicion del gesto del flick (para evaluar segun velocidad/magnitud, no parejo)
    this._approachActive = false;
    this._approachStartT = 0;
    this._approachDist = 0;
    this._flickDur = 0;
    this._flickMag = 0;
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

  // Carga todos los baselines por arma (desde la config guardada).
  setBaselines(map) { this.baselines = map || {}; }
  // Conversion de sens (counts por grado) para el scoring de recoil.
  setSens(countsPerDegree) { this._countsPerDegree = countsPerDegree || 0; }
  // Referencias de recoil por arma (auto-capturadas o dataminadas).
  setRecoilRefs(map) { this._recoilRefs = map || {}; }
  _recoilRef(weapon) { return this._recoilRefs[weapon] || recoil.PATTERNS[weapon] || null; }

  // Baseline del arma equipada (cae al default si esa arma no fue calibrada).
  _activeBaseline() {
    return (this.weapon && this.baselines[this.weapon]) || DEFAULT_BASELINE;
  }

  // -------- modo calibracion (por arma) --------
  // weapon: arma que se esta calibrando (ej 'vandal'). Junta sprays para derivar SU baseline.
  startCalibration(weapon) {
    this._calWeapon = weapon || 'generic';
    this._calibrator = new BaselineCalibrator();
    this._calibrating = true;
    this._calCurves = [];
  }
  // Deriva el baseline + la referencia de recoil, los guarda bajo el arma y los devuelve.
  finishCalibration() {
    this._calibrating = false;
    const baseline = this._calibrator.build();
    this._calibrator = null;
    const weapon = this._calWeapon || 'generic';
    this.baselines[weapon] = { ...DEFAULT_BASELINE, ...baseline };
    const recoilRef = recoil.buildReference(this._calCurves);
    if (recoilRef) this._recoilRefs[weapon] = recoilRef;
    this._calCurves = [];
    return { weapon, baseline, recoilRef };
  }
  cancelCalibration() {
    this._calibrating = false;
    this._calibrator = null;
  }
  calibrationCount() {
    return this._calibrator ? this._calibrator.sprays.length : 0;
  }

  _emptyRound() {
    return { sprays: [], flicks: [], taps: 0, shortICIs: 0, overshoots: [], flickClasses: [],
             shots: 0, shotsMoving: 0, shotsCounter: 0, shotsStatic: 0, kills: 0, killsGood: 0, abilities: {}, report: null };
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
    // En partidas el feedback se muestra al TERMINAR la ronda (se ve completo en la fase de compra).
    if (this._timing === 'onDeath' && phase === 'roundEnd') this._flush();
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

  // Teclado (WASD movimiento, QECXF habilidades). ev: {t, type:'key', a:'down'|'up', k}
  pushKey(ev) {
    if (ev.a === 'down') {
      this._keys[ev.k] = ev.t;
      if (ev.k === 'q' || ev.k === 'e' || ev.k === 'c' || ev.k === 'x') this._round.abilities[ev.k] = true;
    } else if (ev.a === 'up') {
      delete this._keys[ev.k];
      if (this._isMoveKey(ev.k) && !this._anyMoveHeld()) this._moveStopT = ev.t;
    }
  }
  _isMoveKey(k) { return k === 'w' || k === 'a' || k === 's' || k === 'd'; }
  _anyMoveHeld() { return !!(this._keys.w || this._keys.a || this._keys.s || this._keys.d); }

  // Headshot de GEP (llega justo despues del kill si fue a la cabeza).
  pushHeadshot() {
    if (Date.now() - this._lastKillT < 800) this._hsKillCount++;
  }

  // Cada N kills, evalua el % a la cabeza (placement REAL por kill).
  _evalHsRate() {
    const rate = this._hsKillCount / this._killCount;
    if (rate < 0.3) {
      this._queue(66, 'Pocos headshots — subí la mira', `${Math.round(rate * 100)}% de tus kills a la cabeza (${this._hsKillCount}/${this._killCount}). Pre-aimeá a altura de cabeza.`, 'hs-rate');
    } else if (rate >= 0.5) {
      this._queue(30, `Buenos headshots ✓ (${Math.round(rate * 100)}%)`, `${this._hsKillCount}/${this._killCount} kills a la cabeza. Mantené esa altura de mira.`, 'hs-rate');
    }
    this._surface();
  }

  // Kill de GEP: se atribuye al contexto de movimiento del ultimo tiro reciente (validacion por resultado).
  // Devuelve la clase (para loguear) y superficie feedback inmediato.
  pushKill() {
    this._round.kills++;
    this._killCount++;
    this._lastKillT = Date.now();
    if (this._killCount % 5 === 0) this._evalHsRate();
    const ls = this._lastStrafe;
    const recent = ls && (Date.now() - ls.wall) < KILL_AFTER_SHOT_MS;
    const cls = recent ? ls.class : 'sin-tiro-reciente';
    if (recent && (ls.class === 'counter' || ls.class === 'moviendo')) {
      this._round.killsGood++;
      this._queue(35, 'Kill en movimiento ✓', `Kill ${ls.class === 'counter' ? 'counter-strafeando' : 'moviéndote'} — móvil y preciso.`, 'kill-good');
      this._surface();
    } else if (recent && ls.class === 'quieto') {
      this._queue(34, 'Kill quieto — movete más', 'Mataste parado: bien, pero sos predecible.', 'kill-static');
      this._surface();
    }
    return cls;
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
    if (this._leftDown) this._holdMoves.push({ t: ev.t, dx: ev.dx, dy: ev.dy });

    // medir el "flick" (recorrido y duracion desde que arrancó a moverse estando quieto)
    if (!this._leftDown && !this._correction) {
      if (this._recentSpeed < 0.15) {
        this._approachActive = false; // quieto: el proximo movimiento arranca un flick nuevo
      } else {
        if (!this._approachActive) { this._approachActive = true; this._approachStartT = ev.t; this._approachDist = 0; }
        this._approachDist += Math.abs(ev.dx);
      }
    }

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
    this._checkMacro(ev.t);

    // strafe: clasificar el CONTEXTO de movimiento del tiro
    this._round.shots++;
    const moving = this._anyMoveHeld();
    const sinceStop = this._moveStopT ? (ev.t - this._moveStopT) : 999999;
    let sclass;
    if (moving) { sclass = 'moviendo'; this._round.shotsMoving++; }                    // disparaste caminando (impreciso)
    else if (this._moveStopT && sinceStop < COUNTER_STRAFE_MS) { sclass = 'counter'; this._round.shotsCounter++; } // frenaste justo antes (ideal)
    else if (sinceStop > STATIC_MS) { sclass = 'quieto'; this._round.shotsStatic++; }   // parado hace rato (predecible)
    else sclass = 'ok';                                                                 // parado hace poco, normal
    this._lastStrafe = { class: sclass, wall: Date.now() };
    // Solo emitimos info de strafe cuando hubo MOVIMIENTO reciente (moviéndote o frenaste hace poco).
    // Tiros totalmente parados/de espera no generan evento de strafe (era ruido).
    if (moving || sinceStop < STATIC_MS) {
      this.onStrafe({ class: sclass, sinceStop, keys: ['w', 'a', 's', 'd'].filter(k => this._keys[k]).join('') });
    }

    this._approachSign = Math.sign(this._lastDx || 0);
    this._settledAtClick = this._recentSpeed < 0.15;
    // duracion y recorrido del flick que termino en este click
    this._flickDur = this._approachActive ? (ev.t - this._approachStartT) : 0;
    this._flickMag = this._approachDist || 0;
    // reset: el PROXIMO flick se mide desde este disparo (si no, al flickear sin parar
    // se acumula infinito porque nunca te quedás quieto).
    this._approachActive = false;
    this._approachDist = 0;

    this._leftDown = true;
    this._holdStart = ev.t;
    this._holdMoves = [];
  }

  _onLeftUp(ev) {
    this._leftDown = false;
    const durationMs = ev.t - this._holdStart;

    if (durationMs >= AUTO_FIRE_MS) {
      const q = sprayGestureQuality(this._holdMoves);
      // Solo los sprays SOSTENIDOS (>=350ms) se evaluan como recoil. Un miniburst de 2-3 balas
      // NO es control de recoil (es un flick con ráfaga) -> no lo juzgamos para no marcar falsos.
      if (q && durationMs >= SUSTAINED_MS) {
        this._round.sprays.push({ ...q, durationMs, pullPerMs: q.totalPull / durationMs });
      }
      if (this._calibrating && this._calibrator) {
        // baseline: cualquier ráfaga
        if (q) { this._calibrator.addSpray(this._holdMoves, durationMs); this.onCalProgress({ sprays: this._calibrator.sprays.length }); }
        // recoil: capturar la curva de compensación de los sprays sostenidos
        if (durationMs >= SUSTAINED_MS && this._countsPerDegree) {
          const curve = recoil.curveFromHold(this._holdMoves, this._holdStart, this._calWeapon, this._countsPerDegree);
          if (curve) this._calCurves.push(curve);
        }
      } else if (durationMs >= SUSTAINED_MS && this._countsPerDegree) {
        this._scoreRecoil(); // spray en vivo -> puntuar contra la referencia
      }
    } else {
      // tap -> abrir ventana para medir el ajuste del flick (guardamos duracion y magnitud)
      this._round.taps++;
      this._round.flicks.push({ settledBeforeClick: this._settledAtClick, flickDur: this._flickDur, flickMag: this._flickMag });
      this._correction = {
        until: ev.t + CORRECTION_WINDOW_MS, netDx: 0, approachSign: this._approachSign,
        flickDur: this._flickDur, flickMag: this._flickMag,
      };
    }
  }

  _closeCorrection() {
    const c = this._correction; this._correction = null;
    if (!c || c.approachSign === 0) return;

    // Si no hubo un flick real (casi no te moviste: ya estabas en el objetivo), no se juzga.
    if ((c.flickMag || 0) < MIN_FLICK_MAG) return;

    // Si el "ajuste" es mucho mayor que el flick, no es una correccion: es el movimiento
    // hacia el SIGUIENTE objetivo capturado por la ventana. No se clasifica (evita falsos).
    if (Math.abs(c.netDx) > c.flickMag * FLICK_MAX_ADJ_RATIO) return;

    // aligned > 0: seguiste hacia el objetivo despues del tap = corto (FLOJO)
    // aligned < 0: volviste en sentido opuesto = te pasaste (PASADO)
    const aligned = c.netDx * c.approachSign;

    // Umbral ESCALADO: tolera mas en flicks largos (% del recorrido) y en flicks rapidos/reactivos
    // (el pulso y el click meten micro-desvios inevitables que NO son error de aim).
    let threshold = Math.max(FLICK_ERR_COUNTS, c.flickMag * FLICK_ERR_RATIO);
    if (c.flickDur > 0 && c.flickDur < FAST_FLICK_MS) threshold *= FAST_FLICK_TOL;

    let type;
    if (aligned > threshold) type = 'flojo';
    else if (aligned < -threshold) type = 'pasado';
    else {
      // en target: es "perfecto" solo si ademas fue RAPIDO. Si tardo mucho, "lento" (llegaste bien pero tarde).
      const slowMs = FLICK_SLOW_MS + c.flickMag * FLICK_SLOW_PER_COUNT;
      type = (c.flickDur > slowMs) ? 'lento' : 'perfecto';
    }

    // overshoot (con signo) para R4 y para la calibracion de baseline
    const overshoot = aligned < 0 ? Math.abs(c.netDx) * c.approachSign : 0;
    this._round.overshoots.push(overshoot);
    if (this._calibrating && this._calibrator) this._calibrator.addFlickOvershoot(overshoot);

    this._classifyFlick(type, {
      dur: Math.round(c.flickDur || 0), mag: Math.round(c.flickMag || 0),
      aligned: Math.round(aligned), threshold: Math.round(threshold),
    });
  }

  // Feedback preciso por flick + recomendacion de sens cuando hay racha del mismo error.
  _classifyFlick(type, info) {
    this._round.flickClasses.push(type);

    // etiqueta en vivo del flick (solo en practica: en partida distrae). Incluye metricas para el log de debug.
    if (this._timing === 'instant') this.onFlick({ type, ...(info || {}) });

    // racha del mismo error seguido (flojo | pasado | lento)
    if (type === 'flojo' || type === 'pasado' || type === 'lento') {
      if (this._flickStreakType === type) this._flickStreakCount++;
      else { this._flickStreakType = type; this._flickStreakCount = 1; }
    } else {
      this._flickStreakType = null; this._flickStreakCount = 0;
    }

    if (this._flickStreakCount >= FLICK_STREAK_N) {
      // Ya descontamos pulso/velocidad: si son N seguidos del mismo tipo, es un PATRON, no error puntual.
      let short, detail;
      if (type === 'pasado') {
        short = 'Bajá la sens ~10% — te pasás seguido';
        detail = `${FLICK_STREAK_N} flicks pasados seguidos (ya descartando pulso): patrón de sens, no error puntual.`;
      } else if (type === 'flojo') {
        short = 'Subí la sens ~10% — te quedás corto';
        detail = `${FLICK_STREAK_N} flicks flojos seguidos (ya descartando pulso): patrón de sens, no error puntual.`;
      } else {
        short = 'Sé más rápido — apuntá y dispará, no trackees';
        detail = `${FLICK_STREAK_N} flicks lentos seguidos: llegás bien pero tarde. Snap al objetivo, no lo persigas.`;
      }
      this._queue(95, short, detail, type === 'lento' ? 'speed-rec' : 'sens-rec');
      if (this._timing === 'instant') this._surface();
      this._flickStreakCount = 0; // evitar repetir cada flick
    }
  }

  // Prevencion de errores: rafaga de clicks inhumana (macro o mouse con doble-click).
  // Se reporta SIEMPRE al instante porque es info critica (riesgo de ban).
  _checkMacro(t) {
    this._recentClicks.push(t);
    this._recentClicks = this._recentClicks.filter(ct => t - ct <= MACRO_WINDOW_MS);
    if (this._recentClicks.length >= MACRO_CLICKS) {
      this._queue(99, '⚠ Posible macro o mouse fallando', `${this._recentClicks.length} clicks en ${MACRO_WINDOW_MS}ms — riesgo de ban. Revisá tu mouse/configuración.`, 'macro');
      this._surface();
      this._recentClicks = [];
    }
  }

  // Puntúa un spray sostenido contra la referencia de recoil del arma equipada.
  _scoreRecoil() {
    const ref = this._recoilRef(this.weapon);
    if (!ref) return;
    const curve = recoil.curveFromHold(this._holdMoves, this._holdStart, this.weapon, this._countsPerDegree);
    const res = recoil.scoreSpray(curve, ref);
    if (!res) return;
    if (res.score >= 90) {
      this._queue(28, `Recoil dominado (${res.score}%)`, `Control de recoil ${res.score}% vs tu referencia. Así.`, 'recoil-score');
    } else if (res.score < 70) {
      const where = res.phase === 'horizontal' ? 'el tramo horizontal (contrá el spread)' : 'el pull vertical (bajá más parejo)';
      this._queue(75, `Recoil ${res.score}% — mejorá ${res.phase === 'horizontal' ? 'el horizontal' : 'el pull'}`,
        `Control ${res.score}%: te desviaste en ${where}.`, 'recoil-score');
    }
    if (this._timing === 'instant') this._surface();
  }

  // -------- reglas (todas relativas al baseline personal) --------
  _evaluateRoundRules() {
    const r = this._round, b = this._activeBaseline();

    // R1: spam de clicks
    if (r.shortICIs >= 4) {
      this._queue(70, 'Tapeá más controlado', `Spam de clicks (${r.shortICIs} disparos muy seguidos). Dejá estabilizar el crosshair entre tiros.`, 'spam');
    }

    // R2: recoil por debajo de TU baseline (pull flojo)
    const weakSprays = r.sprays.filter(s => s.pullPerMs < b.pullPerMsFloor && s.durationMs > 200);
    if (weakSprays.length >= 2) {
      const avg = (weakSprays.reduce((a, s) => a + s.pullPerMs, 0) / weakSprays.length).toFixed(2);
      this._queue(85, 'Bajá el recoil más parejo', `Recoil flojo: pull ${avg} vs tu baseline ${b.pullPerMsBaseline}. Estás tirando más flojo de lo que sabés.`, 'recoil');
    }

    // R3: gesto poco monotono (metiendo correcciones hacia arriba en pleno spray)
    const jerky = r.sprays.filter(s => s.monotonicity < b.monotonicityFloor && s.durationMs > 200);
    if (jerky.length >= 2) {
      this._queue(78, 'Pull-down en una sola dirección', `Pull-down errático (monotonía ${jerky[0].monotonicity} vs ${b.monotonicityBaseline}). Sin micro-correcciones arriba.`, 'jerky');
    }

    // R4: overshoot anomalo respecto a TU distribucion personal
    const realOver = r.overshoots.filter(o => o !== 0);
    if (realOver.length >= 3) {
      const mean = realOver.reduce((a, o) => a + o, 0) / realOver.length;
      const deviation = mean - b.flickBias;
      if (Math.abs(deviation) > 1.5 * b.flickStd) {
        const short = deviation > 0 ? 'Frená un toque el flick' : 'Llegá un toque más con el flick';
        const dir = deviation > 0 ? 'pasándote' : 'quedándote corto';
        this._queue(75, short, `Flicks ${dir} (desvío ${Math.round(deviation)} counts vs tu sesgo ${b.flickBias}).`, 'flick-bias');
      }
    }

    // R5: clickear sin estabilizar — SOLO en flicks deliberados (lentos). En flicks rapidos
    // disparar mientras la mira llega es normal (no hay tiempo de frenar), no se penaliza.
    const deliberate = r.flicks.filter(f => (f.flickMag || 0) >= MIN_FLICK_MAG && (f.flickDur || 0) >= SLOW_FLICK_MS);
    const rushed = deliberate.filter(f => !f.settledBeforeClick);
    if (deliberate.length >= 3 && rushed.length / deliberate.length > 0.7) {
      this._queue(72, 'Frená antes de tirar (tiros lentos)', `${rushed.length}/${deliberate.length} tiros apuntados sin frenar antes del click.`, 'rushed');
    }

    // R7: resumen de precision de flicks (flojo / perfecto / pasado)
    const fc = r.flickClasses;
    if (fc.length >= 3) {
      const flojo = fc.filter(t => t === 'flojo').length;
      const pasado = fc.filter(t => t === 'pasado').length;
      const lento = fc.filter(t => t === 'lento').length;
      const ok = fc.filter(t => t === 'perfecto').length;
      if (flojo + pasado + lento > ok) {
        // el peor problema define el consejo
        let short;
        if (lento >= flojo && lento >= pasado) short = 'Sé más rápido con los flicks';
        else if (pasado >= flojo) short = 'En general te pasás — frená el flick';
        else short = 'En general te quedás corto — llegá más';
        this._queue(65, short, `Flicks: ${ok} perfectos · ${flojo} flojos · ${pasado} pasados · ${lento} lentos.`, 'flick-summary');
      }
    }

    // R8: contexto de movimiento al disparar.
    if (r.shots >= 6) {
      if (r.shotsMoving / r.shots > MOVE_SHOT_RATIO) {
        this._queue(80, 'Frená al disparar (counter-strafe)',
          `${r.shotsMoving}/${r.shots} tiros caminando. Movete, pero soltá/revertí la tecla un instante antes de tirar.`, 'strafe-move');
      } else if (r.shotsStatic / r.shots > 0.6) {
        this._queue(78, 'Te estás quedando quieto — movete',
          `${r.shotsStatic}/${r.shots} tiros parado. Sos predecible: movete entre disparos y counter-strafeá.`, 'strafe-static');
      }
    }
    // Refuerzo positivo: kills counter-strafeando (móvil + preciso = lo ideal).
    if (r.killsGood >= 2) {
      this._queue(30, `Buenos kills en movimiento (${r.killsGood})`,
        `Mataste counter-strafeando ${r.killsGood} veces. Eso es lo ideal: móvil y preciso.`, 'strafe-kill');
    }

    // Habilidades: nudge SOLO en partidas (en práctica molestaría). Si no usaste ninguna.
    if (this._timing !== 'instant' && Object.keys(r.abilities).length === 0 && r.shots >= 3) {
      this._queue(40, 'No usaste habilidades', 'Recordá usar tus habilidades (Q/E/C/X) — inflan tu impacto en la ronda.', 'abilities');
    }

    // R6: round_report de Overwolf -> crosshair placement (ancla de resultado, grueso)
    if (r.report) {
      const hits = num(r.report.hit);
      const hs = num(r.report.headshot) + num(r.report.final_headshot);
      const body = num(r.report.bodyshots), legs = num(r.report.legshots);
      const total = hits || (hs + body + legs);
      if (total >= 4) {
        // Jerarquia: CABEZA (ideal) > PECHO (aceptable pero mira baja) > RESTO (malo).
        const hsRatio = hs / total, bodyRatio = body / total, legRatio = legs / total;

        if (legRatio > 0.3) {
          // pegás a las piernas/abajo: muy bajo
          this._chestStreak = 0;
          this._lowStreak++;
          if (this._lowStreak >= PLACEMENT_LOW_STREAK) {
            this._queue(72, 'Subí la mira — apuntás muy bajo', `Hace ${this._lowStreak} rondas pegás a las piernas/abajo.`, 'placement');
            this._lowStreak = 0;
          }
        } else if (hsRatio < 0.3 && bodyRatio >= 0.5) {
          // pegás al pecho pero casi nada a la cabeza: crosshair placement bajo
          this._lowStreak = 0;
          this._chestStreak++;
          if (this._chestStreak >= PLACEMENT_CHEST_STREAK) {
            this._queue(70, 'Mirá a la CABEZA, no al pecho', `Hace ${this._chestStreak} rondas pegás al pecho. Crosshair placement: pre-aimeá a altura de cabeza.`, 'placement');
            this._chestStreak = 0;
          }
        } else if (hsRatio >= 0.4) {
          // buena altura de mira
          this._lowStreak = 0; this._chestStreak = 0;
          this._queue(20, 'Buen placement 👍', `${hs}/${total} a la cabeza. Mantenelo.`, 'placement-ok');
        }
        // rondas mixtas/intermedias: no incrementan ni resetean (ni premio ni castigo)
      }
    }
  }

  // short = mensaje corto/accionable para el overlay; detail = version con numeros para el log.
  _queue(prio, short, detail, key) {
    this._pending.push({ prio, short, detail: detail || short, key: key || short });
  }
  _surface() {
    if (!this._pending.length) return;
    this._pending.sort((a, b) => b.prio - a.prio);
    const now = Date.now();
    const out = [];
    for (const f of this._pending) {
      if (now - (this._recentMsgs[f.key] || 0) < DEDUP_MS) continue; // ya lo dijimos hace poco
      this._recentMsgs[f.key] = now;
      out.push(f);
      if (out.length >= 2) break;
    }
    this._pending = [];
    for (const f of out) this.onFeedback({ prio: f.prio, msg: f.short, detail: f.detail });
  }
}

function num(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
module.exports = { AimCoachEngine, DEFAULT_BASELINE };
