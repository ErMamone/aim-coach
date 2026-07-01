/* recoil.ts — patrón de recoil por arma y scoring de la compensación del usuario
 * La referencia (curva de compensación esperada) se guarda en GRADOS (independiente de la sens); se
 * convierte a counts con el countsPerDegree de cada usuario. Puede venir AUTO-CAPTURADA (sprayeando en
 * pared) o del MODELO PARAMETRICO de PATTERNS (aproximado, ver abajo).
 */

import { RecoilPoint, RecoilCurve, RecoilScore } from './types';

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

/* PATTERNS — patrones aproximados por arma (fallback cuando el usuario no auto-capturó su referencia). */
export const PATTERNS: { [weapon: string]: RecoilCurve } = {
  // Vandal: 25 balas, ~6 protegidas del yaw, T bien vertical y spread mayor que Phantom.
  vandal: approxPattern({ bullets: 25, vTotal: 13, vSteep: 5, protectedH: 6, hAmp: 3.5, hDir: 1 }),
  // Phantom: 30 balas, ~8 protegidas, un pelo menos vertical y menos spread; arranca leve derecha.
  phantom: approxPattern({ bullets: 30, vTotal: 12, vSteep: 5.5, protectedH: 8, hAmp: 3.0, hDir: 1 }),
};

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

/* scoreSpray — puntúa el spray del usuario contra la referencia. Devuelve score 0–100 + fase, o null. */
export function scoreSpray(curve: RecoilCurve | null, ref: RecoilCurve | null): RecoilScore | null {
  const n = Math.min((curve || []).length, (ref || []).length);
  if (n < 3 || !curve || !ref) return null;
  let errV = 0, errH = 0, magV = 0, magH = 0;
  for (let i = 0; i < n; i++) {
    errV += Math.abs(curve[i].v - ref[i].v);
    errH += Math.abs(curve[i].h - ref[i].h);
    magV += Math.abs(ref[i].v);
    magH += Math.abs(ref[i].h);
  }
  const totErr = errV + errH;
  const totMag = (magV + magH) || 1;
  const score = Math.max(0, Math.min(100, Math.round(100 * (1 - totErr / totMag))));
  const rV = errV / (magV || 1), rH = errH / (magH || 1);
  let phase: RecoilScore['phase'] = null;
  if (rV > 0.25 && rV >= rH) phase = 'vertical';
  else if (rH > 0.25) phase = 'horizontal';
  return { score, phase };
}

export type { RecoilPoint };
