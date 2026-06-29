// calibration.js
// Auto-calibracion por usuario. NO calibra el "objetivo" sprayeando (eso seria circular).
// Hace tres cosas:
//   1. Matematica de sens: DPI + sens -> counts<->grados (objetivo absoluto, determinista).
//   2. Baseline personal: a partir de drills, deriva la referencia y varianza DEL USUARIO,
//      para flaggear desvios de su propio baseline (no de una verdad absoluta que no tenemos).
//   3. Calidad de gesto del spray: monotonia, suavidad, escalado con la duracion.
//      No necesita patrones dataminados del arma.

const VALORANT_YAW = 0.07; // grados por count a sens 1.0 (confirmado: Valorant siempre raw input, sin accel)

// ---------- 1. Matematica de sensibilidad ----------
function sensMath(dpi, sens) {
  const degreesPerCount = sens * VALORANT_YAW;
  const countsPerDegree = 1 / degreesPerCount;
  const countsPer360 = 360 * countsPerDegree;
  const cmPer360 = (countsPer360 / dpi) * 2.54;
  return { dpi, sens, degreesPerCount, countsPerDegree, countsPer360, cmPer360: +cmPer360.toFixed(2) };
}

// counts de mouse necesarios para contrarrestar un desplazamiento angular dado (cuando tengas
// patrones dataminados del arma, esto te da el pull esperado en counts para este usuario)
function countsToCounterDegrees(degrees, sens) {
  return degrees / (sens * VALORANT_YAW);
}

// sanity check del 360: el usuario hace UN giro limpio, contamos |dx| total, derivamos su sens real.
// Si difiere de la reportada -> DPI mal configurada o accel activada.
function verify360(totalAbsDx, dpi, reportedSens) {
  const measuredSens = 360 / (totalAbsDx * VALORANT_YAW); // de countsPer360 = 360/(sens*yaw)
  const driftPct = Math.abs(measuredSens - reportedSens) / reportedSens * 100;
  return {
    measuredSens: +measuredSens.toFixed(4),
    reportedSens,
    driftPct: +driftPct.toFixed(1),
    ok: driftPct < 8, // <8% lo tomamos como ruido del giro manual; mas que eso = problema de hardware
  };
}

// ---------- 3. Calidad de gesto de un spray (sin patron dataminado) ----------
// Recibe la secuencia de eventos de movimiento DURANTE el hold del click: [{dy}, ...]
// Convencion: dy > 0 = mouse hacia abajo = compensando el kick hacia arriba.
function sprayGestureQuality(holdMoves) {
  if (holdMoves.length < 3) return null;
  const dys = holdMoves.map(m => m.dy);
  const totalPull = dys.reduce((a, d) => a + d, 0);

  // monotonia: fraccion de frames que compensan en la direccion correcta
  const compensating = dys.filter(d => d > 0).length;
  const monotonicity = compensating / dys.length;

  // suavidad: desviacion estandar de los incrementos (mas bajo = mas suave). Normalizada por la media.
  const mean = totalPull / dys.length;
  const variance = dys.reduce((a, d) => a + (d - mean) ** 2, 0) / dys.length;
  const jerk = mean !== 0 ? Math.sqrt(variance) / Math.abs(mean) : Infinity;

  return {
    totalPull: Math.round(totalPull),
    monotonicity: +monotonicity.toFixed(2),  // 1.0 = siempre tiro hacia abajo, nunca corrijo arriba
    jerk: +jerk.toFixed(2),                   // 0 = pull perfectamente parejo
  };
}

// ---------- 2. Calibrador de baseline ----------
// Ingiere los drills de calibracion del usuario y deriva SU referencia + umbrales personalizados.
class BaselineCalibrator {
  constructor() { this.sprays = []; this.flickOvershoots = []; }

  // agregar un spray del drill: holdMoves = movimientos durante el hold, durationMs = largo del fuego
  addSpray(holdMoves, durationMs) {
    const q = sprayGestureQuality(holdMoves);
    if (q) this.sprays.push({ ...q, durationMs, pullPerMs: q.totalPull / durationMs });
  }

  // agregar un overshoot medido en el drill de flicks (en counts; signo = direccion)
  addFlickOvershoot(overshootCounts) { this.flickOvershoots.push(overshootCounts); }

  // produce la calibracion: referencia personal + umbrales para que el motor flaggee desvios
  build() {
    if (this.sprays.length < 3) throw new Error('necesito al menos 3 sprays de calibracion');

    const pulls = this.sprays.map(s => s.pullPerMs);
    const medianPullPerMs = median(pulls);
    const monoMedian = median(this.sprays.map(s => s.monotonicity));
    const jerkMedian = median(this.sprays.map(s => s.jerk));

    // sesgo direccional en flicks: media de overshoots con signo (negativo = undershoot sistematico)
    const flickBias = this.flickOvershoots.length
      ? this.flickOvershoots.reduce((a, b) => a + b, 0) / this.flickOvershoots.length : 0;
    const flickStd = std(this.flickOvershoots);

    return {
      // referencia personal de recoil (NO verdad absoluta: es el nivel actual del usuario)
      pullPerMsBaseline: +medianPullPerMs.toFixed(3),
      monotonicityBaseline: +monoMedian.toFixed(2),
      jerkBaseline: +jerkMedian.toFixed(2),
      // umbrales: el motor flaggea cuando una ronda cae notablemente por debajo del baseline propio
      pullPerMsFloor: +(medianPullPerMs * 0.7).toFixed(3),   // 30% peor que tu baseline = alerta
      monotonicityFloor: +(monoMedian * 0.85).toFixed(2),
      // flicks
      flickBias: +flickBias.toFixed(1),    // >0 overshoot sistematico, <0 undershoot
      flickStd: +flickStd.toFixed(1),      // tu varianza personal -> umbral de "flick anomalo"
    };
  }
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function std(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length);
}

module.exports = { sensMath, countsToCounterDegrees, verify360, sprayGestureQuality, BaselineCalibrator, VALORANT_YAW };
