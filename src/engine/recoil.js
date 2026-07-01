// recoil.js — patrón de recoil por arma y scoring de la compensación del usuario.
// La referencia (curva de compensación esperada) se guarda en GRADOS (independiente de la sens);
// se convierte a counts con countsPerDegree de cada usuario. Puede venir AUTO-CAPTURADA
// (sprayeando en pared) o DATAMINEADA (hardcodeada, por completar con valores reales).

// Cadencia por arma (balas/seg) -> ms por bala, para segmentar el hold.
const FIRE_RATE = {
  vandal: 9.75, phantom: 11, spectre: 13.33, bulldog: 10, guardian: 6.5,
  stinger: 16, ares: 13, odin: 12, default: 10,
};
function msPerBullet(weapon) { return 1000 / (FIRE_RATE[weapon] || FIRE_RATE.default); }

// Patrones DATAMINEADOS (cumulativo por bala, en grados: {v: pull hacia abajo, h: horizontal con signo}).
// TODO: cargar los valores reales de Valorant por arma. Vacío = se usa la referencia auto-capturada.
const PATTERNS = {
  // vandal: [ { v: 0.0, h: 0.0 }, ... ],
  // phantom: [ ... ],
};

// Convierte el hold del usuario en una curva de compensación acumulada por bala (en grados).
// holdMoves: [{ t, dx, dy }] durante el hold. dy>0 = mouse abajo = compensás el kick hacia arriba.
function curveFromHold(holdMoves, holdStart, weapon, countsPerDegree) {
  if (!holdMoves || !holdMoves.length || !countsPerDegree) return null;
  const mpb = msPerBullet(weapon);
  const curve = [];
  let cumDx = 0, cumDy = 0, bullet = 0;
  for (const m of holdMoves) {
    cumDx += m.dx || 0; cumDy += m.dy || 0;
    const b = Math.floor((m.t - holdStart) / mpb);
    while (bullet <= b) { curve[bullet] = { v: cumDy / countsPerDegree, h: cumDx / countsPerDegree }; bullet++; }
  }
  return curve.length ? curve : null;
}

// Promedia varias curvas -> referencia auto-capturada (recorta a la más corta).
function buildReference(curves) {
  const valid = (curves || []).filter(c => c && c.length >= 3);
  if (valid.length < 2) return null;
  const n = Math.min(...valid.map(c => c.length));
  const ref = [];
  for (let i = 0; i < n; i++) {
    let v = 0, h = 0;
    for (const c of valid) { v += c[i].v; h += c[i].h; }
    ref.push({ v: v / valid.length, h: h / valid.length });
  }
  return ref;
}

// Puntúa un spray contra la referencia. Devuelve { score 0-100, phase } o null.
function scoreSpray(curve, ref) {
  const n = Math.min((curve || []).length, (ref || []).length);
  if (n < 3) return null;
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
  let phase = null;
  if (rV > 0.25 && rV >= rH) phase = 'vertical';
  else if (rH > 0.25) phase = 'horizontal';
  return { score, phase };
}

module.exports = { msPerBullet, curveFromHold, buildReference, scoreSpray, PATTERNS };
