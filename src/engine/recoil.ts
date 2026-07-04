/* recoil.ts — patrón de recoil por arma y scoring de la compensación del usuario
 * La referencia (curva de compensación esperada) se guarda en GRADOS (independiente de la sens); se
 * convierte a counts con el countsPerDegree de cada usuario. Puede venir AUTO-CAPTURADA (sprayeando en
 * pared) o del MODELO PARAMETRICO de PATTERNS (aproximado, ver abajo).
 */

import { RecoilPoint, RecoilCurve, RecoilScore, ScoreOptions } from './types';

/* FIRE_RATE — cadencia por arma (balas/seg); se usa para segmentar el hold en balas. */
const FIRE_RATE: { [weapon: string]: number } = {
  vandal: 9.75, phantom: 11, spectre: 13.33, bulldog: 10, guardian: 6.5,
  stinger: 16, ares: 13, odin: 12, default: 10,
};

/* msPerBullet — milisegundos por bala del arma (o el default si no está mapeada). */
export function msPerBullet(weapon: string): number {
  return 1000 / (FIRE_RATE[weapon] || FIRE_RATE.default);
}

/* ApproxPatternParams — parámetros de forma para construir un patrón aproximado.
 *  bullets    = balas del cargador
 *  vTotal     = grados verticales totales que sube (asíntota)
 *  vSteep     = qué tan rápido llega a la asíntota (más chico = más empinado al principio)
 *  protectedH = balas iniciales sin desvío horizontal (protegidas del yaw switch)
 *  hAmp       = amplitud horizontal en grados (swing a un lado y después al otro)
 *  hDir       = +1 arranca a la derecha, -1 a la izquierda
 */
interface ApproxPatternParams {
  bullets: number;
  vTotal: number;
  vSteep: number;
  protectedH: number;
  hAmp: number;
  hDir: number;
}

/* approxPattern — construye la curva de recoil acumulada (por bala, en grados) con la FORMA documentada.
 * IMPORTANTE: NO es un datamine exacto. Valorant no publica la curva por bala en grados y el patrón real
 * tiene aleatoriedad; esto modela la forma (sube vertical y después se abre horizontal). La MAGNITUD
 * (vTotal/hAmp) es la parte incierta a tunear. La referencia auto-capturada tiene prioridad sobre esto.
 */
export function approxPattern(params: ApproxPatternParams): RecoilCurve {
  const { bullets, vTotal, vSteep, protectedH, hAmp, hDir } = params;
  const pat: RecoilCurve = [];
  for (let i = 1; i <= bullets; i++) {
    const v = vTotal * (1 - Math.exp(-i / vSteep));
    let h = 0;
    if (i > protectedH) {
      const p = (i - protectedH) / (bullets - protectedH); // 0..1 sobre el tramo horizontal
      h = hDir * hAmp * Math.sin(p * Math.PI * 1.5);       // pico a un lado (~1/3) y después cruza al otro
    }
    pat.push({ v: Math.round(v * 100) / 100, h: Math.round(h * 100) / 100 });
  }
  return pat;
}

/* PATTERNS — referencia de recoil por arma (capturada de gameplay con tools/annotate_recoil.py).
 * OJO (patch 11.08): solo las PRIMERAS balas son deterministas/controlables (fase vertical, h≈0). Después
 * el patrón entra en zona RNG: mantiene un vaivén izq-der-izq pero con SPREAD aleatorio grande → esos valores
 * NO son un patrón fijo (por eso divergen). Ver DETERMINISTIC: cuántas balas se pueden controlar de verdad;
 * el scoring solo puntúa esa fase, el resto es "ráfaga/spread" y no se juzga como control.
 */
export const PATTERNS: { [weapon: string]: RecoilCurve } = {
  vandal: [
    { v: 0.0, h: 0.0 }, { v: 0.51, h: -0.02 }, { v: 0.81, h: 0.06 }, { v: 2.31, h: 0.08 },
    { v: 3.64, h: 0.0 }, { v: 5.09, h: -0.11 }, { v: 6.44, h: 0.23 }, { v: 6.81, h: 0.46 },
    { v: 7.39, h: 0.04 }, { v: 7.65, h: -0.67 }, { v: 7.63, h: -1.71 }, { v: 7.82, h: -0.51 },
    { v: 7.82, h: -0.18 }, { v: 7.96, h: 0.68 }, { v: 8.07, h: 1.17 }, { v: 8.08, h: 1.49 },
    { v: 8.37, h: 1.96 }, { v: 8.4, h: 0.96 }, { v: 8.62, h: -0.02 }, { v: 8.25, h: -1.53 },
    { v: 8.3, h: -1.75 }, { v: 8.19, h: -1.88 }, { v: 8.22, h: -2.03 }, { v: 8.2, h: -2.41 },
  ],
  phantom: [
    { v: 0.0, h: 0.0 }, { v: 0.39, h: -0.07 }, { v: 0.8, h: -0.05 }, { v: 1.83, h: -0.18 },
    { v: 2.81, h: 0.2 }, { v: 3.99, h: -0.01 }, { v: 5.09, h: 0.11 }, { v: 5.97, h: 0.62 },
    { v: 6.2, h: 1.51 }, { v: 6.46, h: 1.85 }, { v: 6.71, h: 1.92 }, { v: 6.54, h: 1.26 },
    { v: 6.66, h: 0.59 }, { v: 6.83, h: 0.49 }, { v: 6.64, h: -0.15 }, { v: 6.71, h: -0.62 },
    { v: 6.78, h: 0.02 }, { v: 6.7, h: 0.01 }, { v: 6.73, h: 0.27 }, { v: 6.86, h: 0.14 },
    { v: 7.1, h: -0.2 }, { v: 7.04, h: 0.11 }, { v: 7.17, h: 0.12 }, { v: 7.35, h: 0.46 },
    { v: 7.19, h: 0.4 }, { v: 7.43, h: -0.14 }, { v: 7.09, h: -1.03 }, { v: 7.38, h: -1.72 },
  ],
};

/* DETERMINISTIC — cuántas balas iniciales son CONTROLABLES (fase vertical, no-RNG) por arma. Después de
 * esto el spread es aleatorio (ráfaga) y no se puntúa como control. Basado en el patch 11.08 (Vandal 1-6/7
 * no-RNG) y en la observación de los datos (h≈0 hasta ~bala 8). Es más realista dominar 7 que fingir 24.
 */
export const DETERMINISTIC: { [weapon: string]: number } = { vandal: 7, phantom: 7 };
export const DEFAULT_DETERMINISTIC = 7;

/* HoldMove — un movimiento de mouse durante el hold del disparo (subconjunto de MouseSample). */
interface HoldMove {
  t: number;
  dx?: number;
  dy?: number;
}

/* curveFromHold — convierte el hold del usuario en su curva de compensación acumulada por bala (grados).
 * dy>0 = mouse hacia abajo = compensás el kick hacia arriba. Devuelve null si no hay datos suficientes.
 */
export function curveFromHold(
  holdMoves: HoldMove[],
  holdStart: number,
  weapon: string,
  countsPerDegree: number,
): RecoilCurve | null {
  if (!holdMoves || !holdMoves.length || !countsPerDegree) return null;
  const mpb = msPerBullet(weapon);
  const curve: RecoilCurve = [];
  let cumDx = 0, cumDy = 0, bullet = 0;
  for (const m of holdMoves) {
    cumDx += m.dx || 0;
    cumDy += m.dy || 0;
    const b = Math.floor((m.t - holdStart) / mpb);
    while (bullet <= b) {
      curve[bullet] = { v: cumDy / countsPerDegree, h: cumDx / countsPerDegree };
      bullet++;
    }
  }
  return curve.length ? curve : null;
}

/* buildReference — promedia varias curvas en la referencia auto-capturada (recorta a la más corta). */
export function buildReference(curves: RecoilCurve[]): RecoilCurve | null {
  const valid = (curves || []).filter(c => c && c.length >= 3);
  if (valid.length < 2) return null;
  const n = Math.min(...valid.map(c => c.length));
  const ref: RecoilCurve = [];
  for (let i = 0; i < n; i++) {
    let v = 0, h = 0;
    for (const c of valid) { v += c[i].v; h += c[i].h; }
    ref.push({ v: v / valid.length, h: h / valid.length });
  }
  return ref;
}

// Peso por bala: las primeras deciden los duelos, así que pesan más (decae exponencial).
function bulletWeight(i: number): number { return Math.pow(0.94, i); }
// Cuánto pesa cada eje en el score: en la fase controlable el VERTICAL (el climb) es lo principal.
const V_WEIGHT = 0.75, H_WEIGHT = 0.25;
const H_TOLERANCE = 0.5; // en la fase controlable el h esperado es ~0; toleramos ~0.5° de deriva

/* scoreSpray — puntúa el CONTROL de recoil del usuario: SOLO la fase determinista (primeras N balas,
 * opts.deterministic), porque después el spread es RNG y no se puede controlar. Vertical y horizontal
 * se calcan contra la referencia (ambos son deterministas en esta fase); las balas tempranas pesan más.
 * Devuelve score 0–100 + eje (vertical/horizontal) + tramo (early/mid/late) del peor error.
 */
export function scoreSpray(
  curve: RecoilCurve | null,
  ref: RecoilCurve | null,
  opts: ScoreOptions = {},
): RecoilScore | null {
  const det = opts.deterministic || DEFAULT_DETERMINISTIC;
  const n = Math.min((curve || []).length, (ref || []).length, det);
  if (n < 3 || !curve || !ref) return null;

  let wErrV = 0, wMagV = 0;                 // vertical (el climb controlable)
  let wErrH = 0, wRefH = 0;                 // horizontal (≈0 en esta fase)
  const segErr = [0, 0, 0], segMag = [0, 0, 0]; // error vertical por tramo (early/mid/late)

  for (let i = 0; i < n; i++) {
    const w = bulletWeight(i);
    const ev = Math.abs(curve[i].v - ref[i].v);
    wErrV += w * ev; wMagV += w * Math.abs(ref[i].v);
    // horizontal: calce vs la ref con un piso de tolerancia (el h esperado es chico en la fase controlable)
    wErrH += w * Math.abs(curve[i].h - ref[i].h); wRefH += w * Math.max(Math.abs(ref[i].h), H_TOLERANCE);

    const seg = i < n / 3 ? 0 : i < (2 * n) / 3 ? 1 : 2;
    segErr[seg] += w * ev; segMag[seg] += w * (Math.abs(ref[i].v) + 0.5);
  }

  const rV = wErrV / (wMagV || 1);
  const rH = wErrH / (wRefH || 1);
  const err = Math.min(1, V_WEIGHT * rV + H_WEIGHT * rH);
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - err))));

  // eje dominante del error
  let phase: RecoilScore['phase'] = null;
  if (rV > 0.2 && rV >= rH) phase = 'vertical';
  else if (rH > 0.2) phase = 'horizontal';

  // tramo con más error vertical relativo (early/mid/late), si es notable
  const ratios = segErr.map((e, s) => e / (segMag[s] || 1));
  const worst = ratios.indexOf(Math.max(...ratios));
  const segment: RecoilScore['segment'] = ratios[worst] > 0.3 ? (['early', 'mid', 'late'] as const)[worst] : null;

  return { score, phase, segment };
}

export type { RecoilPoint };
