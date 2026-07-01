/* calibration.ts — auto-calibración por usuario
 * NO calibra el "objetivo" sprayeando (sería circular). Hace tres cosas:
 *   1. Matemática de sens: DPI + sens -> counts<->grados (objetivo absoluto, determinista).
 *   2. Baseline personal: a partir de drills deriva la referencia y varianza DEL USUARIO, para
 *      flaggear desvíos de su propio baseline (no de una verdad absoluta que no tenemos).
 *   3. Calidad de gesto del spray: monotonía, suavidad. No necesita patrones dataminados del arma.
 */

import { SprayQuality, Baseline } from './types';

/* VALORANT_YAW — grados por count a sens 1.0 (confirmado: Valorant siempre raw input, sin accel). */
export const VALORANT_YAW = 0.07;

/* SensMath — conversión de sensibilidad derivada de DPI + sens in-game. */
export interface SensMath {
  dpi: number;
  sens: number;
  degreesPerCount: number;
  countsPerDegree: number;
  countsPer360: number;
  cmPer360: number;
}

/* Verify360Result — resultado del sanity check del giro de 360°. */
export interface Verify360Result {
  measuredSens: number;
  reportedSens: number;
  driftPct: number;
  ok: boolean;
}

/* sensMath — 1. Matemática de sensibilidad: de DPI + sens a las conversiones counts<->grados. */
export function sensMath(dpi: number, sens: number): SensMath {
  const degreesPerCount = sens * VALORANT_YAW;
  const countsPerDegree = 1 / degreesPerCount;
  const countsPer360 = 360 * countsPerDegree;
  const cmPer360 = (countsPer360 / dpi) * 2.54;
  return { dpi, sens, degreesPerCount, countsPerDegree, countsPer360, cmPer360: +cmPer360.toFixed(2) };
}

/* countsToCounterDegrees — counts de mouse necesarios para contrarrestar un desplazamiento angular dado. */
export function countsToCounterDegrees(degrees: number, sens: number): number {
  return degrees / (sens * VALORANT_YAW);
}

/* verify360 — sanity check del 360: con el |dx| total de UN giro limpio deriva la sens real y la compara
 * con la reportada. Un drift alto => DPI mal configurada o aceleración activada.
 */
export function verify360(totalAbsDx: number, dpi: number, reportedSens: number): Verify360Result {
  const measuredSens = 360 / (totalAbsDx * VALORANT_YAW); // de countsPer360 = 360/(sens*yaw)
  const driftPct = Math.abs(measuredSens - reportedSens) / reportedSens * 100;
  return {
    measuredSens: +measuredSens.toFixed(4),
    reportedSens,
    driftPct: +driftPct.toFixed(1),
    ok: driftPct < 8, // <8% = ruido del giro manual; más que eso = problema de hardware
  };
}

/* HoldMove — movimiento de mouse durante el hold (subconjunto de MouseSample). */
interface HoldMove {
  dy: number;
}

/* sprayGestureQuality — 3. Calidad de gesto de un spray a partir de los movimientos del hold.
 * Convención: dy > 0 = mouse hacia abajo = compensando el kick hacia arriba. Null si hay pocos frames.
 */
export function sprayGestureQuality(holdMoves: HoldMove[]): SprayQuality | null {
  if (holdMoves.length < 3) return null;
  const dys = holdMoves.map(m => m.dy);
  const totalPull = dys.reduce((a, d) => a + d, 0);

  // monotonía: fracción de frames que compensan en la dirección correcta
  const compensating = dys.filter(d => d > 0).length;
  const monotonicity = compensating / dys.length;

  // suavidad: desvío estándar de los incrementos (más bajo = más suave), normalizado por la media
  const mean = totalPull / dys.length;
  const variance = dys.reduce((a, d) => a + (d - mean) ** 2, 0) / dys.length;
  const jerk = mean !== 0 ? Math.sqrt(variance) / Math.abs(mean) : Infinity;

  return {
    totalPull: Math.round(totalPull),
    monotonicity: +monotonicity.toFixed(2),  // 1.0 = siempre hacia abajo, nunca corrijo arriba
    jerk: +jerk.toFixed(2),                   // 0 = pull perfectamente parejo
  };
}

/* CAL_MIN_MONOTONICITY — gate de calidad: un spray de calibración es válido solo si es un pull hacia
 * abajo controlado. Por debajo, el gesto es reposición / pull invertido / tap sucio y ensuciaría el
 * baseline (causaba baselines inconsistentes: 0.077 mono 0.46 vs 0.273 mono 1.0 para la misma arma).
 */
const CAL_MIN_MONOTONICITY = 0.6;

/* CalibratedSpray — un spray aceptado en el pool de calibración. */
type CalibratedSpray = SprayQuality & { durationMs: number; pullPerMs: number };

/* BaselineCalibrator — 2. Ingiere los drills del usuario y deriva SU baseline + umbrales personalizados. */
export class BaselineCalibrator {
  sprays: CalibratedSpray[] = [];
  flickOvershoots: number[] = [];

  /* addSpray — agrega un spray del drill si pasa el gate de calidad. Devuelve true si entró al pool.
   * La duración mínima (spray sostenido) se gatea aguas arriba en el motor.
   */
  addSpray(holdMoves: HoldMove[], durationMs: number): boolean {
    const q = sprayGestureQuality(holdMoves);
    if (!q) return false;
    const pullPerMs = q.totalPull / durationMs;
    if (q.monotonicity < CAL_MIN_MONOTONICITY || pullPerMs <= 0 || !isFinite(q.jerk)) return false;
    this.sprays.push({ ...q, durationMs, pullPerMs });
    return true;
  }

  /* addFlickOvershoot — agrega un overshoot medido en el drill de flicks (counts; signo = dirección). */
  addFlickOvershoot(overshootCounts: number): void {
    this.flickOvershoots.push(overshootCounts);
  }

  /* build — produce el baseline: referencia personal + umbrales para que el motor flaggee desvíos. */
  build(): Baseline {
    if (this.sprays.length < 3) throw new Error('necesito al menos 3 sprays de calibracion');

    const medianPullPerMs = median(this.sprays.map(s => s.pullPerMs));
    const monoMedian = median(this.sprays.map(s => s.monotonicity));
    const jerkMedian = median(this.sprays.map(s => s.jerk));

    // sesgo direccional en flicks: media de overshoots con signo (negativo = undershoot sistemático)
    const flickBias = this.flickOvershoots.length
      ? this.flickOvershoots.reduce((a, b) => a + b, 0) / this.flickOvershoots.length : 0;
    const flickStd = std(this.flickOvershoots);

    return {
      // referencia personal (NO verdad absoluta: es el nivel actual del usuario)
      pullPerMsBaseline: +medianPullPerMs.toFixed(3),
      monotonicityBaseline: +monoMedian.toFixed(2),
      jerkBaseline: +jerkMedian.toFixed(2),
      // umbrales: el motor flaggea cuando una ronda cae notablemente por debajo del baseline propio
      pullPerMsFloor: +(medianPullPerMs * 0.7).toFixed(3),   // 30% peor que tu baseline = alerta
      monotonicityFloor: +(monoMedian * 0.85).toFixed(2),
      // flicks
      flickBias: +flickBias.toFixed(1),    // >0 overshoot sistemático, <0 undershoot
      flickStd: +flickStd.toFixed(1),      // tu varianza personal -> umbral de "flick anómalo"
    };
  }
}

/* median — mediana de un arreglo (robusta a outliers, mejor que la media para el baseline). */
function median(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* std — desvío estándar poblacional de un arreglo. */
function std(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}
