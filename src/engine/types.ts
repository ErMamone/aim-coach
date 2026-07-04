/* types.ts — DTOs del motor de coaching
 * Contratos compartidos entre el capturer, el motor de reglas y las ventanas (background/overlay/config).
 * Son interfaces "tontas" (data holders, estilo DTO de Java): describen la FORMA de los datos que viajan
 * entre módulos, sin lógica. Un solo lugar donde mirar qué campos existen y qué significan.
 */

/* AbilityKey — tecla de habilidad de Valorant (C/Q/E = comprables/signature, X = ultimate). */
export type AbilityKey = 'C' | 'Q' | 'E' | 'X';

/* MouseSample — muestra de mouse del capturer C# (llega por WebSocket).
 * a='move' trae dx/dy; a='down'/'up' trae el botón b.
 */
export interface MouseSample {
  t: number;
  a: 'move' | 'down' | 'up';
  b?: 'left' | 'right';
  dx?: number;
  dy?: number;
}

/* KeySample — tecla del capturer C# (WASD de movimiento, QECX de habilidades, etc.). */
export interface KeySample {
  t: number;
  type: 'key';
  a: 'down' | 'up';
  k: string;
}

/* RecoilPoint — desplazamiento acumulado del patrón de recoil en una bala, en GRADOS.
 * v = componente vertical (pull hacia abajo para compensar el kick), h = horizontal con signo.
 */
export interface RecoilPoint {
  v: number;
  h: number;
}

/* RecoilCurve — curva de recoil (o de compensación del usuario) como puntos por bala. */
export type RecoilCurve = RecoilPoint[];

/* RecoilScore — resultado de puntuar un spray contra la referencia. */
export interface RecoilScore {
  score: number;                          // 0–100 (100 = control perfecto)
  phase: 'vertical' | 'horizontal' | null; // EJE donde más se desvió (para el consejo)
  segment: 'early' | 'mid' | 'late' | null; // TRAMO del spray donde más se desvió el vertical
}

/* ScoreOptions — opciones de scoring.
 *  deterministic = cuántas balas iniciales son CONTROLABLES (no-RNG); solo esas se puntúan. Después es
 *                  spread aleatorio (ráfaga) que no se puede controlar y no se juzga.
 */
export interface ScoreOptions {
  deterministic?: number;
}

/* SprayQuality — métricas de calidad del gesto de un spray (sin patrón dataminado). */
export interface SprayQuality {
  totalPull: number;     // suma de dy en el hold (counts): >0 = compensaste hacia abajo
  monotonicity: number;  // 0–1: fracción de frames tirando en la dirección correcta
  jerk: number;          // desvío estándar de los incrementos / media: 0 = pull perfectamente parejo
}

/* Baseline — referencia personal del usuario POR ARMA + umbrales derivados (de la calibración). */
export interface Baseline {
  pullPerMsBaseline: number;
  pullPerMsFloor: number;
  monotonicityBaseline: number;
  monotonicityFloor: number;
  jerkBaseline?: number;
  flickBias: number;
  flickStd: number;
}

/* AgentData — datos estáticos de un agente: nombre visible + nombre de habilidad por tecla. */
export interface AgentData {
  name: string;
  ab: Partial<Record<AbilityKey, string>>;
}

/* AbilityAvailability — disponibilidad booleana por tecla (GEP me.abilities). */
export type AbilityAvailability = Partial<Record<AbilityKey, boolean>>;

/* Feedback — mensaje de coaching que sale del motor hacia el overlay.
 * msg = texto corto/accionable (overlay); detail = versión con números (log); key = tipo (dedup/colapso).
 */
export interface Feedback {
  prio: number;
  msg: string;
  detail: string;
  key: string;
}

/* StrafeInfo — contexto de movimiento de un tiro (debug/tuneo). sinceStop=null si nunca frenaste. */
export interface StrafeInfo {
  class: 'moviendo' | 'counter' | 'quieto' | 'ok';
  sinceStop: number | null;
  keys: string;
}

/* FlickInfo — clasificación de un flick (para el overlay + debug). */
export interface FlickInfo {
  type: 'flojo' | 'perfecto' | 'pasado' | 'lento';
  dur?: number;
  mag?: number;
  aligned?: number;
  threshold?: number;
}

/* CalProgress — avance de la calibración de baseline. accepted=false => el spray no pasó el gate. */
export interface CalProgress {
  sprays: number;
  accepted?: boolean;
}

/* RecoilTrace — datos para dibujar la traza del spray: tu recorrido vs el patrón ideal + el score.
 * curve y ref están en GRADOS (comparables directamente). Lo consume el "Recoil Trainer" de la config.
 */
export interface RecoilTrace {
  weapon: string | null;
  source: 'personal' | 'datamined';
  score: number;
  phase: RecoilScore['phase'];
  segment: RecoilScore['segment'];
  curve: RecoilCurve;    // tu recorrido (compensación real)
  ref: RecoilCurve;      // el patrón/referencia esperado
  deterministic: number; // hasta qué bala es controlable (el resto es spread RNG)
}

/* EngineOptions — dependencias/estado inicial que se le inyecta al motor (callbacks estilo listener). */
export interface EngineOptions {
  onFeedback?: (f: Feedback) => void;
  onCalProgress?: (p: CalProgress) => void;
  onFlick?: (info: FlickInfo) => void;
  onStrafe?: (info: StrafeInfo) => void;
  onRecoilScored?: (t: RecoilTrace) => void;
  baselines?: { [weapon: string]: Baseline };
  recoilRefs?: { [weapon: string]: RecoilCurve };
  now?: () => number; // reloj inyectable (default Date.now). Los tests lo controlan para evaluar warm-up/dedup deterministamente.
}
