/* ruleEngine.ts — motor de reglas de coaching (el "cerebro")
 * Usa la referencia PERSONAL del usuario (baseline de calibration.ts) en vez de perfiles de arma
 * inventados: las reglas flaggean DESVIOS del propio baseline. Es JS plano agnóstico de plataforma
 * (no toca overwolf.*): recibe streams y emite feedback por callbacks.
 *
 * Streams de entrada:
 *   1) mouse (capturer C#): MouseSample / KeySample
 *   2) Overwolf Valorant: round_report (por ronda), weapon, phase, agent, abilities, round_number
 * Salida: Feedback que se superficie solo en huecos muertos (post-muerte / fin de ronda / práctica en vivo).
 */

import { sprayGestureQuality, BaselineCalibrator } from './calibration';
import * as recoil from './recoil';
import { T } from './messages';
import {
  Feedback, CalProgress, FlickInfo, StrafeInfo, Baseline, RecoilCurve, RecoilTrace, EngineOptions,
} from './types';

/* DEFAULT_BASELINE — baseline placeholder hasta que el usuario calibre (valores conservadores). */
const DEFAULT_BASELINE: Baseline = {
  pullPerMsBaseline: 0.5, pullPerMsFloor: 0.35,
  monotonicityBaseline: 0.9, monotonicityFloor: 0.75,
  flickBias: 0, flickStd: 20,
};

const AUTO_FIRE_MS = 110;          // hold más largo que esto = ya no es tap simple
const SUSTAINED_MS = 350;          // hold más largo que esto = spray sostenido (recoil real). Entre medio = miniburst
/* RECOIL_CUTS — cortes de score de recoil según la FUENTE de la referencia (tuneables):
 *  - personal  = referencia auto-capturada (tu propio promedio): mide CONSISTENCIA -> exigente.
 *  - datamined = patrón real APROXIMADO (recoil.PATTERNS): mide CORRECCION vs un objetivo de magnitud
 *    incierta y con aleatoriedad -> más indulgente para no marcar falsos.
 */
const RECOIL_CUTS: { [source: string]: { good: number; bad: number } } = {
  personal: { good: 90, bad: 70 },
  datamined: { good: 78, bad: 55 },
};
const DEDUP_MS = 12000;            // no repetir el MISMO tipo de mensaje antes de este tiempo
const COUNTER_STRAFE_MS = 100;     // frenar la tecla hasta ~100ms antes del tiro = contra-strafe real (bien)
const STATIC_MS = 1000;            // sin moverte por más de esto al disparar = ESTATICO (predecible)
const KILL_AFTER_SHOT_MS = 1500;   // kill dentro de esto tras un tiro -> se atribuye a ese contexto de movimiento
const MOVE_SHOT_RATIO = 0.5;       // fracción de tiros de un tipo para avisar
const SPAM_ICI_MS = 90;            // inter-click interval por debajo = síntoma de spam
const CORRECTION_WINDOW_MS = 90;   // ventana post-click para medir el ajuste del flick
const FLICK_ERR_COUNTS = 10;       // piso de |ajuste| tolerado (counts) — abajo de esto siempre "perfecto"
const FLICK_ERR_RATIO = 0.14;      // tolerancia como % del recorrido del flick (flicks largos toleran más)
const MIN_FLICK_MAG = 35;          // recorrido mínimo (counts) para que un tap cuente como flick real
const FLICK_MAX_ADJ_RATIO = 1.5;   // si |ajuste| > este x el flick, no es corrección sino el flick SIGUIENTE -> se descarta
const FAST_FLICK_MS = 160;         // flick más rápido que esto = reactivo: el pulso mete micro-desvíos, se tolera más
const FAST_FLICK_TOL = 2.0;        // multiplicador de tolerancia para flicks rápidos
const SLOW_FLICK_MS = 250;         // solo flicks deliberados (más lentos que esto) se juzgan por "estabilizar"
const FLICK_SLOW_MS = 300;         // en-target pero más lento que esto (+ margen por distancia) = "lento", no "perfecto"
const FLICK_SLOW_PER_COUNT = 0.15; // margen extra de tiempo por count de recorrido (flicks grandes tardan más)
const FLICK_STREAK_N = 8;          // flicks flojos/pasados seguidos (reales) -> recomendar cambiar sens
const MACRO_WINDOW_MS = 150;       // ventana para detectar ráfaga de clicks inhumana
const MACRO_CLICKS = 5;            // clicks dentro de la ventana = posible macro / mouse defectuoso
const PLACEMENT_LOW_STREAK = 2;    // rondas seguidas pegando A LAS PIERNAS/abajo -> aviso (apuntás muy bajo)
const PLACEMENT_CHEST_STREAK = 3;  // rondas seguidas pegando AL PECHO (no cabeza) -> crosshair placement bajo
const WARMUP_MS = 15000;           // ventana de "calentamiento" desde tu PRIMER tiro del contexto: en ese rato
                                   // no opinamos (evita juzgar los primeros tiros de prueba = "cosas raras" al arrancar).
                                   // Por tiempo (no por cantidad) para servir igual a taps rápidos y a sprays sueltos.

/* Round — estado acumulado de la ventana actual (ronda en partida, o tramo en vivo en práctica). */
interface Round {
  sprays: any[];
  flicks: any[];
  taps: number;
  shortICIs: number;
  overshoots: number[];
  flickClasses: string[];
  shots: number;
  shotsMoving: number;
  shotsCounter: number;
  shotsStatic: number;
  kills: number;
  killsGood: number;
  report: any;
}

/* Correction — ventana de medición del ajuste post-tap (para clasificar el flick). */
interface Correction {
  until: number;
  netDx: number;
  approachSign: number;
  flickDur: number;
  flickMag: number;
}

/* QueuedFeedback — feedback encolado antes de superficiarse (short = overlay, detail = log). */
interface QueuedFeedback {
  prio: number;
  short: string;
  detail: string;
  key: string;
}

/* AimCoachEngine — orquesta segmentación de inputs, reglas y emisión de feedback. */
class AimCoachEngine {
  // callbacks (estilo listener) que el background conecta
  onFeedback: (f: Feedback) => void;
  onCalProgress: (p: CalProgress) => void;
  onFlick: (info: FlickInfo) => void;
  onStrafe: (info: StrafeInfo) => void;
  onRecoilScored: (t: RecoilTrace) => void;

  baselines: { [weapon: string]: Baseline };
  weapon: string | null;         // arma equipada según GEP (solo llega en partidas)
  deadTime: boolean;
  private _inCombat = false;     // fase de combate: SOLO acá contamos usos de habilidad (no en la compra)
  private _ctxWarmUntil = 0;     // fin del warm-up del contexto (this._now()+WARMUP_MS, seteado en el primer tiro; 0 = sin tirar aún)

  private _calWeapon: string | null;
  private _countsPerDegree: number;   // conversión counts<->grados (de la sens del usuario)
  private _recoilRefs: { [weapon: string]: RecoilCurve };
  private _calCurves: RecoilCurve[];

  private _flickStreakType: string | null;
  private _flickStreakCount: number;
  private _recentClicks: number[];    // timestamps de clicks recientes (detección de macro)
  private _lowStreak: number;         // rondas seguidas pegando a las piernas/abajo
  private _chestStreak: number;       // rondas seguidas pegando al pecho (no cabeza)
  private _recentMsgs: { [key: string]: number }; // {key: timestamp} para no repetir el mismo mensaje
  private _keys: { [key: string]: number };        // teclas actualmente presionadas (WASD/QECX/...)
  private _moveStopT: number;         // último momento en que soltaste TODAS las teclas de movimiento
  private _lastKillT: number;         // para correlacionar el evento headshot con el kill reciente
  private _killCount: number;         // kills de la sesión (para el % de headshots)
  private _hsKillCount: number;       // kills a la cabeza

  // medición del gesto del flick (para evaluar según velocidad/magnitud, no parejo)
  private _approachActive: boolean;
  private _approachStartT: number;
  private _approachDist: number;
  private _flickDur: number;
  private _flickMag: number;
  private _practiceWeapon: string | null; // fallback de arma cuando GEP no la da (Range)
  private _timing: 'instant' | 'onDeath'; // 'instant' (práctica/range) | 'onDeath' (partidas)
  private _lang: 'es' | 'en' = 'es';       // idioma de los mensajes del overlay

  private _calibrating: boolean;
  private _calibrator: BaselineCalibrator | null;

  private _leftDown: boolean;
  private _holdStart: number;
  private _holdMoves: any[];           // movimientos durante el hold (para calidad de gesto)
  private _lastMoveT: number;
  private _recentSpeed: number;
  private _lastClickT: number;
  private _lastDx: number;
  private _settledAtClick: boolean;
  private _lastStrafe?: { class: StrafeInfo['class']; wall: number };

  private _approachSign: number;       // dirección horizontal de aproximación al último tap
  private _correction: Correction | null; // ventana de medición de overshoot

  private _round: Round;
  private _pending: QueuedFeedback[];
  private _now: () => number; // reloj (default Date.now; inyectable para tests deterministas de warm-up/dedup)

  constructor(opts: EngineOptions = {}) {
    this._now = opts.now || Date.now;
    this.onFeedback = opts.onFeedback || (() => {});
    this.onCalProgress = opts.onCalProgress || (() => {});
    this.onFlick = opts.onFlick || (() => {});
    this.onStrafe = opts.onStrafe || (() => {});
    this.onRecoilScored = opts.onRecoilScored || (() => {});
    this.baselines = opts.baselines || {};       // baseline POR ARMA: { vandal: {...}, phantom: {...} }
    this._calWeapon = null;
    this._countsPerDegree = 0;
    this._recoilRefs = opts.recoilRefs || {};    // curva de recoil de referencia POR ARMA (grados)
    this._calCurves = [];

    this._flickStreakType = null;
    this._flickStreakCount = 0;
    this._recentClicks = [];
    this._lowStreak = 0;
    this._chestStreak = 0;
    this._recentMsgs = {};
    this._keys = {};
    this._moveStopT = 0;
    this._lastKillT = 0;
    this._killCount = 0;
    this._hsKillCount = 0;

    this._approachActive = false;
    this._approachStartT = 0;
    this._approachDist = 0;
    this._flickDur = 0;
    this._flickMag = 0;
    this.weapon = null;
    this._practiceWeapon = null;
    this.deadTime = false;
    this._timing = 'onDeath';

    this._calibrating = false;
    this._calibrator = null;

    this._leftDown = false;
    this._holdStart = 0;
    this._holdMoves = [];
    this._lastMoveT = 0;
    this._recentSpeed = 0;
    this._lastClickT = 0;
    this._lastDx = 0;
    this._settledAtClick = false;

    this._approachSign = 0;
    this._correction = null;

    this._round = this._emptyRound();
    this._pending = [];
  }

  /* setBaselines — carga todos los baselines por arma (desde la config guardada). */
  setBaselines(map: { [weapon: string]: Baseline }): void { this.baselines = map || {}; }
  /* setSens — conversión de sens (counts por grado) para el scoring de recoil. */
  setSens(countsPerDegree: number): void { this._countsPerDegree = countsPerDegree || 0; }
  /* setRecoilRefs — referencias de recoil por arma (auto-capturadas). */
  setRecoilRefs(map: { [weapon: string]: RecoilCurve }): void { this._recoilRefs = map || {}; }

  /* _recoilRef — referencia de recoil + su fuente. PRIORIDAD al patrón capturado (real, ground-truth);
   * la referencia personal (auto-capturada) queda solo como fallback para armas sin patrón cargado.
   */
  private _recoilRef(weapon: string | null): { ref: RecoilCurve; source: 'personal' | 'datamined' } | null {
    if (!weapon) return null;
    const datamined = recoil.PATTERNS[weapon];
    if (datamined) return { ref: datamined, source: 'datamined' };
    const personal = this._recoilRefs[weapon];
    if (personal) return { ref: personal, source: 'personal' };
    return null;
  }

  /* _activeBaseline — baseline del arma equipada (cae al default si esa arma no fue calibrada). */
  private _activeBaseline(): Baseline {
    const w = this._activeWeapon();
    return (w && this.baselines[w]) || DEFAULT_BASELINE;
  }

  /* _hasBaseline — ¿hay baseline REAL calibrado para el arma efectiva? (si no, _activeBaseline cae al
   * DEFAULT y las reglas relativas al baseline no significan nada -> no se disparan). */
  private _hasBaseline(): boolean {
    const w = this._activeWeapon();
    return !!(w && this.baselines[w]);
  }

  // -------- modo calibración (por arma) --------
  /* startCalibration — arranca a juntar sprays del arma indicada para derivar SU baseline. */
  startCalibration(weapon: string): void {
    this._calWeapon = weapon || 'generic';
    this._calibrator = new BaselineCalibrator();
    this._calibrating = true;
    this._calCurves = [];
  }
  /* finishCalibration — deriva el baseline + la referencia de recoil, los guarda y los devuelve. */
  finishCalibration(): { weapon: string; baseline: Baseline; recoilRef: RecoilCurve | null } {
    this._calibrating = false;
    const baseline = this._calibrator!.build();
    this._calibrator = null;
    const weapon = this._calWeapon || 'generic';
    this.baselines[weapon] = { ...DEFAULT_BASELINE, ...baseline };
    const recoilRef = recoil.buildReference(this._calCurves);
    if (recoilRef) this._recoilRefs[weapon] = recoilRef;
    this._calCurves = [];
    return { weapon, baseline, recoilRef };
  }
  cancelCalibration(): void {
    this._calibrating = false;
    this._calibrator = null;
  }
  calibrationCount(): number {
    return this._calibrator ? this._calibrator.sprays.length : 0;
  }

  private _emptyRound(): Round {
    return {
      sprays: [], flicks: [], taps: 0, shortICIs: 0, overshoots: [], flickClasses: [],
      shots: 0, shotsMoving: 0, shotsCounter: 0, shotsStatic: 0, kills: 0, killsGood: 0, report: null,
    };
  }

  // -------- entradas --------
  setWeapon(w: string | null): void { this.weapon = w; }
  /* setPracticeWeapon — fallback de arma cuando GEP no reporta arma (Range). */
  setPracticeWeapon(w: string | null): void { this._practiceWeapon = w || null; }
  /* _activeWeapon — arma efectiva para baseline/recoil: la de GEP si existe, si no la de práctica. */
  private _activeWeapon(): string | null { return this.weapon || this._practiceWeapon; }

  /* setFeedbackTiming — define CUÁNDO se superficie el feedback (mismo contenido, distinto momento):
   *  'instant' -> práctica/range: evaluado y mostrado en vivo (flush por timer del background)
   *  'onDeath' -> partidas: evaluado y mostrado al terminar la ronda
   */
  setFeedbackTiming(mode: string): void {
    const next = mode === 'instant' ? 'instant' : 'onDeath';
    if (next !== this._timing) this.resetContext(); // cambió el contexto (Range<->partida): re-calentar
    this._timing = next;
  }

  /* resetContext — arranca de cero el warm-up + la ventana acumulada y limpia el dedup. Lo llama el
   * background al cambiar de contexto o cuando el usuario limpia el overlay a mano (así el próximo feedback
   * se ve enseguida, ej. tras cambiar de idioma). NO borra baselines ni progreso de calibración.
   */
  resetContext(): void {
    this._ctxWarmUntil = 0;
    this._round = this._emptyRound();
    this._pending = [];
    this._recentMsgs = {};
    this._flickStreakType = null;
    this._flickStreakCount = 0;
  }

  /* setLang — idioma de los mensajes de coaching del overlay ('es' | 'en'). */
  setLang(lang: string): void { this._lang = lang === 'en' ? 'en' : 'es'; }
  /* _t — texto de mensaje en el idioma actual (ver messages.ts). */
  private _t(key: string, params?: { [k: string]: string | number }): string { return T(key, this._lang, params); }

  setPhase(phase: string): void {
    this.deadTime = phase === 'buy' || phase === 'dead' || phase === 'roundEnd';
    if (phase === 'active') this._inCombat = true;
    else if (phase === 'buy' || phase === 'roundEnd' || phase === 'dead') this._inCombat = false;
    // En partidas el feedback se muestra al TERMINAR la ronda (se ve completo en la fase de compra).
    if (this._timing === 'onDeath' && phase === 'roundEnd') this._flush();
  }

  /* flushInstant — lo llama el background por timer en modo práctica para feedback en vivo. */
  flushInstant(): void {
    if (this._timing === 'instant') this._flush();
  }

  /* _flush — evalúa la ventana acumulada, superficie el feedback y resetea. */
  private _flush(): void {
    this._evaluateRoundRules();
    this._surface();
    this._round = this._emptyRound();
  }

  pushMouse(ev: any): void {
    if (ev.a === 'down' && ev.b === 'left') this._onLeftDown(ev);
    else if (ev.a === 'up' && ev.b === 'left') this._onLeftUp(ev);
    else if (ev.a === 'move') this._onMove(ev);
  }

  /* pushKey — teclado: solo WASD para movimiento/strafe. (El uso de habilidades NO se coacha: GEP no da el
   * cast real — me.abilities nunca se popula — y el keypress no distingue un cast de una tecla en cooldown.)
   */
  pushKey(ev: any): void {
    if (ev.a === 'down') {
      this._keys[ev.k] = ev.t;
    } else if (ev.a === 'up') {
      delete this._keys[ev.k];
      if (this._isMoveKey(ev.k) && !this._anyMoveHeld()) this._moveStopT = ev.t;
    }
  }
  private _isMoveKey(k: string): boolean { return k === 'w' || k === 'a' || k === 's' || k === 'd'; }
  private _anyMoveHeld(): boolean { return !!(this._keys.w || this._keys.a || this._keys.s || this._keys.d); }

  /* pushHeadshot — headshot de GEP (llega justo después del kill si fue a la cabeza). */
  pushHeadshot(): void {
    if (this._now() - this._lastKillT < 800) this._hsKillCount++;
  }

  /* _evalHsRate — cada N kills, evalúa el % a la cabeza (placement REAL por kill). */
  private _evalHsRate(): void {
    const rate = this._hsKillCount / this._killCount;
    if (rate < 0.3) {
      const p = { pct: Math.round(rate * 100), hs: this._hsKillCount, kills: this._killCount };
      this._queue(66, this._t('hsRate.bad.short'), this._t('hsRate.bad.detail', p), 'hs-rate');
    } else if (rate >= 0.5) {
      const p = { pct: Math.round(rate * 100), hs: this._hsKillCount, kills: this._killCount };
      this._queue(30, this._t('hsRate.good.short', p), this._t('hsRate.good.detail', p), 'hs-rate');
    }
    this._surface();
  }

  /* pushKill — kill de GEP: se atribuye al contexto de movimiento del último tiro reciente (validación por
   * resultado). Devuelve la clase (para loguear) y superficie feedback inmediato.
   */
  pushKill(): string {
    this._round.kills++;
    this._killCount++;
    this._lastKillT = this._now();
    if (this._killCount % 5 === 0) this._evalHsRate();
    const ls = this._lastStrafe;
    const recent = ls && (this._now() - ls.wall) < KILL_AFTER_SHOT_MS;
    const cls = recent ? ls!.class : 'sin-tiro-reciente';
    if (recent && (ls!.class === 'counter' || ls!.class === 'moviendo')) {
      this._round.killsGood++;
      const ctx = this._t(ls!.class === 'counter' ? 'killCtx.counter' : 'killCtx.moving');
      this._queue(35, this._t('killGood.short'), this._t('killGood.detail', { ctx }), 'kill-good');
      this._surface();
    } else if (recent && ls!.class === 'quieto') {
      this._queue(34, this._t('killStatic.short'), this._t('killStatic.detail'), 'kill-static');
      this._surface();
    }
    return cls;
  }

  /* pushRoundReport — round_report de Valorant: solo lo guardamos (alimenta R6); el flush decide cuándo mostrar. */
  pushRoundReport(report: any): void {
    this._round.report = report;
  }

  // -------- segmentación --------
  private _onMove(ev: any): void {
    const dt = Math.max(1, ev.t - this._lastMoveT);
    const dist = Math.hypot(ev.dx, ev.dy);
    this._recentSpeed = 0.6 * this._recentSpeed + 0.4 * (dist / dt);
    this._lastMoveT = ev.t;
    this._lastDx = ev.dx;
    if (this._leftDown) this._holdMoves.push({ t: ev.t, dx: ev.dx, dy: ev.dy });

    // medir el "flick" (recorrido y duración desde que arrancó a moverse estando quieto)
    if (!this._leftDown && !this._correction) {
      if (this._recentSpeed < 0.15) {
        this._approachActive = false; // quieto: el próximo movimiento arranca un flick nuevo
      } else {
        if (!this._approachActive) { this._approachActive = true; this._approachStartT = ev.t; this._approachDist = 0; }
        this._approachDist += Math.abs(ev.dx);
      }
    }

    // ventana de ajuste post-tap: acumulamos TODO el movimiento horizontal para clasificar el flick
    // (sigue en la dirección = flojo; vuelve = pasado; casi nada = perfecto).
    if (this._correction) {
      if (ev.t > this._correction.until) this._closeCorrection();
      else this._correction.netDx += ev.dx;
    }
  }

  private _onLeftDown(ev: any): void {
    if (this._correction) this._closeCorrection(); // cerrar medición previa antes del nuevo tap
    if (this._lastClickT) {
      const ici = ev.t - this._lastClickT;
      if (ici < SPAM_ICI_MS) this._round.shortICIs++;
    }
    this._lastClickT = ev.t;
    this._checkMacro(ev.t);

    // strafe: clasificar el CONTEXTO de movimiento del tiro
    this._round.shots++;
    if (!this._ctxWarmUntil) this._ctxWarmUntil = this._now() + WARMUP_MS; // arranca el warm-up en tu primer tiro del contexto
    const moving = this._anyMoveHeld();
    const sinceStop = this._moveStopT ? (ev.t - this._moveStopT) : 999999;
    let sclass: StrafeInfo['class'];
    if (moving) { sclass = 'moviendo'; this._round.shotsMoving++; }                    // disparaste caminando (impreciso)
    else if (this._moveStopT && sinceStop < COUNTER_STRAFE_MS) { sclass = 'counter'; this._round.shotsCounter++; } // frenaste justo antes (ideal)
    else if (sinceStop > STATIC_MS) { sclass = 'quieto'; this._round.shotsStatic++; }   // parado hace rato (predecible)
    else sclass = 'ok';                                                                 // parado hace poco, normal
    this._lastStrafe = { class: sclass, wall: this._now() };
    // Solo emitimos info de strafe cuando hubo MOVIMIENTO reciente (moviéndote o frenaste hace poco).
    // Tiros totalmente parados/de espera no generan evento de strafe (era ruido).
    if (moving || sinceStop < STATIC_MS) {
      // sinceStop = null cuando nunca frenaste (evita el centinela 999999 en el log de debug).
      this.onStrafe({ class: sclass, sinceStop: this._moveStopT ? sinceStop : null, keys: ['w', 'a', 's', 'd'].filter(k => this._keys[k]).join('') });
    }

    this._approachSign = Math.sign(this._lastDx || 0);
    this._settledAtClick = this._recentSpeed < 0.15;
    // duración y recorrido del flick que terminó en este click
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

  private _onLeftUp(ev: any): void {
    this._leftDown = false;
    const durationMs = ev.t - this._holdStart;

    if (durationMs >= AUTO_FIRE_MS) {
      const q = sprayGestureQuality(this._holdMoves);
      // Solo los sprays SOSTENIDOS (>=350ms) se evalúan como recoil. Un miniburst de 2-3 balas
      // NO es control de recoil (es un flick con ráfaga) -> no lo juzgamos para no marcar falsos.
      if (q && durationMs >= SUSTAINED_MS) {
        this._round.sprays.push({ ...q, durationMs, pullPerMs: q.totalPull / durationMs });
      }
      if (this._calibrating && this._calibrator) {
        // baseline: SOLO sprays sostenidos que pasen el gate de calidad del calibrador cuentan.
        // Un miniburst o un gesto de reposición se descarta y NO avanza el contador (avisamos por qué).
        if (durationMs >= SUSTAINED_MS) {
          const accepted = this._calibrator.addSpray(this._holdMoves, durationMs);
          this.onCalProgress({ sprays: this._calibrator.sprays.length, accepted });
          // recoil: capturar la curva de compensación solo de los sprays ACEPTADOS
          if (accepted && this._countsPerDegree) {
            const curve = recoil.curveFromHold(this._holdMoves, this._holdStart, this._calWeapon!, this._countsPerDegree);
            if (curve) this._calCurves.push(curve);
          }
        }
      } else if (durationMs >= SUSTAINED_MS && this._countsPerDegree) {
        this._scoreRecoil(); // spray en vivo -> puntuar contra la referencia
      }
    } else {
      // tap -> abrir ventana para medir el ajuste del flick (guardamos duración y magnitud)
      this._round.taps++;
      this._round.flicks.push({ settledBeforeClick: this._settledAtClick, flickDur: this._flickDur, flickMag: this._flickMag });
      this._correction = {
        until: ev.t + CORRECTION_WINDOW_MS, netDx: 0, approachSign: this._approachSign,
        flickDur: this._flickDur, flickMag: this._flickMag,
      };
    }
  }

  private _closeCorrection(): void {
    const c = this._correction; this._correction = null;
    if (!c || c.approachSign === 0) return;

    // Si no hubo un flick real (casi no te moviste: ya estabas en el objetivo), no se juzga.
    if ((c.flickMag || 0) < MIN_FLICK_MAG) return;

    // Si el "ajuste" es mucho mayor que el flick, no es una corrección: es el movimiento
    // hacia el SIGUIENTE objetivo capturado por la ventana. No se clasifica (evita falsos).
    if (Math.abs(c.netDx) > c.flickMag * FLICK_MAX_ADJ_RATIO) return;

    // aligned > 0: seguiste hacia el objetivo después del tap = corto (FLOJO)
    // aligned < 0: volviste en sentido opuesto = te pasaste (PASADO)
    const aligned = c.netDx * c.approachSign;

    // Umbral ESCALADO: tolera más en flicks largos (% del recorrido) y en flicks rápidos/reactivos
    // (el pulso y el click meten micro-desvíos inevitables que NO son error de aim).
    let threshold = Math.max(FLICK_ERR_COUNTS, c.flickMag * FLICK_ERR_RATIO);
    if (c.flickDur > 0 && c.flickDur < FAST_FLICK_MS) threshold *= FAST_FLICK_TOL;

    let type: FlickInfo['type'];
    if (aligned > threshold) type = 'flojo';
    else if (aligned < -threshold) type = 'pasado';
    else {
      // en target: es "perfecto" solo si además fue RAPIDO. Si tardó mucho, "lento" (llegaste bien pero tarde).
      const slowMs = FLICK_SLOW_MS + c.flickMag * FLICK_SLOW_PER_COUNT;
      type = (c.flickDur > slowMs) ? 'lento' : 'perfecto';
    }

    // overshoot (con signo) para R4 y para la calibración de baseline
    const overshoot = aligned < 0 ? Math.abs(c.netDx) * c.approachSign : 0;
    this._round.overshoots.push(overshoot);
    if (this._calibrating && this._calibrator) this._calibrator.addFlickOvershoot(overshoot);

    this._classifyFlick(type, {
      dur: Math.round(c.flickDur || 0), mag: Math.round(c.flickMag || 0),
      aligned: Math.round(aligned), threshold: Math.round(threshold),
    });
  }

  /* _classifyFlick — feedback preciso por flick + recomendación de sens cuando hay racha del mismo error. */
  private _classifyFlick(type: FlickInfo['type'], info: Partial<FlickInfo>): void {
    this._round.flickClasses.push(type);

    // etiqueta en vivo del flick (solo en práctica: en partida distrae). Incluye métricas para el log de debug.
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
      const k = type === 'pasado' ? 'streak.pasado' : type === 'flojo' ? 'streak.flojo' : 'streak.lento';
      this._queue(95, this._t(`${k}.short`), this._t(`${k}.detail`, { n: FLICK_STREAK_N }), type === 'lento' ? 'speed-rec' : 'sens-rec');
      if (this._timing === 'instant') this._surface();
      this._flickStreakCount = 0; // evitar repetir cada flick
    }
  }

  /* _checkMacro — prevención de errores: ráfaga de clicks inhumana (macro o mouse con doble-click).
   * Se reporta SIEMPRE al instante porque es info crítica (riesgo de ban).
   */
  private _checkMacro(t: number): void {
    this._recentClicks.push(t);
    this._recentClicks = this._recentClicks.filter(ct => t - ct <= MACRO_WINDOW_MS);
    if (this._recentClicks.length >= MACRO_CLICKS) {
      this._queue(99, this._t('macro.short'), this._t('macro.detail', { n: this._recentClicks.length, ms: MACRO_WINDOW_MS }), 'macro');
      this._surface();
      this._recentClicks = [];
    }
  }

  /* _scoreRecoil — puntúa el CONTROL de recoil de un spray sostenido. Solo mide la fase DETERMINISTA
   * (primeras N balas, no-RNG); después el spread es aleatorio y no se juzga como control.
   */
  private _scoreRecoil(): void {
    if (this._ctxWarmUntil && this._now() < this._ctxWarmUntil) return; // warm-up: no puntuar los primeros sprays de prueba
    const w = this._activeWeapon();
    const r = this._recoilRef(w);
    if (!r) return;
    const curve = recoil.curveFromHold(this._holdMoves, this._holdStart, w!, this._countsPerDegree);
    const det = recoil.DETERMINISTIC[w!] || recoil.DEFAULT_DETERMINISTIC;
    const res = recoil.scoreSpray(curve, r.ref, { deterministic: det });
    if (!res) return;
    // traza para el "Recoil Trainer" de la config (tu recorrido vs el patrón; det = hasta dónde es controlable)
    if (curve) this.onRecoilScored({ weapon: w, source: r.source, score: res.score, phase: res.phase, segment: res.segment, curve, ref: r.ref, deterministic: det });
    const cuts = RECOIL_CUTS[r.source] || RECOIL_CUTS.personal;
    if (res.score >= cuts.good) {
      this._queue(28, this._t('recoilGood.short', { score: res.score }), this._t('recoilGood.detail', { det, score: res.score }), 'recoil-score');
    } else if (res.score < cuts.bad) {
      // eje (qué corregir) + tramo (dónde de la fase controlable lo perdés)
      const axis = this._t(res.phase === 'horizontal' ? 'axis.horizontal' : 'axis.pull');
      const axisDetail = this._t(res.phase === 'horizontal' ? 'axisDetail.horizontal' : 'axisDetail.pull');
      const seg = res.segment ? this._t('seg.' + res.segment) : '';
      this._queue(75, this._t('recoilBad.short', { score: res.score, axis, seg }),
        this._t('recoilBad.detail', { det, score: res.score, axisDetail, seg }), 'recoil-score');
    }
    if (this._timing === 'instant') this._surface();
  }

  // -------- reglas (todas relativas al baseline personal) --------
  private _evaluateRoundRules(): void {
    // Warm-up: en los primeros WARMUP_MS desde tu primer tiro no opinamos (evita "cosas raras" al arrancar).
    // Macro (riesgo de ban) NO pasa por acá: siempre se avisa.
    if (this._ctxWarmUntil && this._now() < this._ctxWarmUntil) return;

    const r = this._round, b = this._activeBaseline();
    const hasBaseline = this._hasBaseline(); // R2/R3/R4 comparan contra TU baseline: sin calibrar no significan nada

    // R1: spam de clicks
    if (r.shortICIs >= 4) {
      this._queue(70, this._t('spam.short'), this._t('spam.detail', { n: r.shortICIs }), 'spam');
    }

    // R2: recoil por debajo de TU baseline (pull flojo) — solo con baseline calibrado
    const weakSprays = r.sprays.filter(s => s.pullPerMs < b.pullPerMsFloor && s.durationMs > 200);
    if (hasBaseline && weakSprays.length >= 2) {
      const avg = (weakSprays.reduce((a, s) => a + s.pullPerMs, 0) / weakSprays.length).toFixed(2);
      this._queue(85, this._t('recoilWeak.short'), this._t('recoilWeak.detail', { avg, baseline: b.pullPerMsBaseline }), 'recoil');
    }

    // R3: gesto poco monótono (metiendo correcciones hacia arriba en pleno spray) — solo con baseline calibrado
    const jerky = r.sprays.filter(s => s.monotonicity < b.monotonicityFloor && s.durationMs > 200);
    if (hasBaseline && jerky.length >= 2) {
      this._queue(78, this._t('jerky.short'), this._t('jerky.detail', { mono: jerky[0].monotonicity, base: b.monotonicityBaseline }), 'jerky');
    }

    // R4: overshoot anómalo respecto a TU distribución personal — solo con baseline calibrado
    const realOver = r.overshoots.filter(o => o !== 0);
    if (hasBaseline && realOver.length >= 3) {
      const mean = realOver.reduce((a, o) => a + o, 0) / realOver.length;
      const deviation = mean - b.flickBias;
      if (Math.abs(deviation) > 1.5 * b.flickStd) {
        const short = this._t(deviation > 0 ? 'flickBias.over.short' : 'flickBias.under.short');
        const dir = this._t(deviation > 0 ? 'flickBias.dir.over' : 'flickBias.dir.under');
        this._queue(75, short, this._t('flickBias.detail', { dir, dev: Math.round(deviation), bias: b.flickBias }), 'flick-bias');
      }
    }

    // R5: clickear sin estabilizar — SOLO en flicks deliberados (lentos). En flicks rápidos
    // disparar mientras la mira llega es normal (no hay tiempo de frenar), no se penaliza.
    const deliberate = r.flicks.filter(f => (f.flickMag || 0) >= MIN_FLICK_MAG && (f.flickDur || 0) >= SLOW_FLICK_MS);
    const rushed = deliberate.filter(f => !f.settledBeforeClick);
    if (deliberate.length >= 3 && rushed.length / deliberate.length > 0.7) {
      this._queue(72, this._t('rushed.short'), this._t('rushed.detail', { rushed: rushed.length, deliberate: deliberate.length }), 'rushed');
    }

    // R7: resumen de precisión de flicks (flojo / perfecto / pasado)
    const fc = r.flickClasses;
    if (fc.length >= 3) {
      const flojo = fc.filter(t => t === 'flojo').length;
      const pasado = fc.filter(t => t === 'pasado').length;
      const lento = fc.filter(t => t === 'lento').length;
      const ok = fc.filter(t => t === 'perfecto').length;
      if (flojo + pasado + lento > ok) {
        // el peor problema define el consejo
        const sk = (lento >= flojo && lento >= pasado) ? 'summary.lento.short' : pasado >= flojo ? 'summary.pasado.short' : 'summary.flojo.short';
        this._queue(65, this._t(sk), this._t('summary.detail', { ok, flojo, pasado, lento }), 'flick-summary');
      }
    }

    // R8: contexto de movimiento al disparar.
    if (r.shots >= 6) {
      if (r.shotsMoving / r.shots > MOVE_SHOT_RATIO) {
        this._queue(80, this._t('strafeMove.short'), this._t('strafeMove.detail', { moving: r.shotsMoving, shots: r.shots }), 'strafe-move');
      } else if (r.shotsStatic / r.shots > 0.6) {
        this._queue(78, this._t('strafeStatic.short'), this._t('strafeStatic.detail', { static: r.shotsStatic, shots: r.shots }), 'strafe-static');
      }
    }
    // Refuerzo positivo: kills counter-strafeando (móvil + preciso = lo ideal).
    if (r.killsGood >= 2) {
      this._queue(30, this._t('strafeKill.short', { n: r.killsGood }), this._t('strafeKill.detail', { n: r.killsGood }), 'strafe-kill');
    }

    // (Habilidades: NO se coacha. GEP no da el uso real de habilidades — me.abilities nunca se popula — y
    //  el keypress no distingue un cast de una tecla en cooldown; no inventamos un dato que no tenemos.)

    // R6: round_report de Overwolf -> crosshair placement (ancla de resultado, grueso)
    if (r.report) {
      const hits = num(r.report.hit);
      const hs = num(r.report.headshot) + num(r.report.final_headshot);
      const body = num(r.report.bodyshots), legs = num(r.report.legshots);
      const total = hits || (hs + body + legs);
      if (total >= 4) {
        // Jerarquía: CABEZA (ideal) > PECHO (aceptable pero mira baja) > RESTO (malo).
        const hsRatio = hs / total, bodyRatio = body / total, legRatio = legs / total;

        if (legRatio > 0.3) {
          // pegás a las piernas/abajo: muy bajo
          this._chestStreak = 0;
          this._lowStreak++;
          if (this._lowStreak >= PLACEMENT_LOW_STREAK) {
            this._queue(72, this._t('placement.low.short'), this._t('placement.low.detail', { n: this._lowStreak }), 'placement');
            this._lowStreak = 0;
          }
        } else if (hsRatio < 0.3 && bodyRatio >= 0.5) {
          // pegás al pecho pero casi nada a la cabeza: crosshair placement bajo
          this._lowStreak = 0;
          this._chestStreak++;
          if (this._chestStreak >= PLACEMENT_CHEST_STREAK) {
            this._queue(70, this._t('placement.chest.short'), this._t('placement.chest.detail', { n: this._chestStreak }), 'placement');
            this._chestStreak = 0;
          }
        } else if (hsRatio >= 0.4) {
          // buena altura de mira
          this._lowStreak = 0; this._chestStreak = 0;
          this._queue(20, this._t('placementOk.short'), this._t('placementOk.detail', { hs, total }), 'placement-ok');
        }
        // rondas mixtas/intermedias: no incrementan ni resetean (ni premio ni castigo)
      }
    }
  }

  /* _queue — encola feedback. short = mensaje corto/accionable (overlay); detail = versión con números (log). */
  private _queue(prio: number, short: string, detail: string, key: string): void {
    this._pending.push({ prio, short, detail: detail || short, key: key || short });
  }

  /* _surface — ordena por prioridad, deduplica por tipo (ventana DEDUP_MS) y emite hasta 2 feedbacks. */
  private _surface(): void {
    if (!this._pending.length) return;
    this._pending.sort((a, b) => b.prio - a.prio);
    const now = this._now();
    const out: QueuedFeedback[] = [];
    for (const f of this._pending) {
      if (now - (this._recentMsgs[f.key] || 0) < DEDUP_MS) continue; // ya lo dijimos hace poco
      this._recentMsgs[f.key] = now;
      out.push(f);
      if (out.length >= 2) break;
    }
    this._pending = [];
    for (const f of out) this.onFeedback({ prio: f.prio, msg: f.short, detail: f.detail, key: f.key });
  }
}

/* num — parsea a número tolerando strings/undefined (los round_report vienen como strings). */
function num(v: any): number { const n = parseFloat(v); return isNaN(n) ? 0 : n; }

export { AimCoachEngine, DEFAULT_BASELINE };
