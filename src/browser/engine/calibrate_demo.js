// calibrate_demo.js
const { sensMath, verify360, BaselineCalibrator } = require('./calibration');

console.log('=== 1. Matematica de sens (TenZ: 0.4 @ 800 DPI) ===');
const m = sensMath(800, 0.4);
console.log(`  counts/360: ${Math.round(m.countsPer360)} | counts/grado: ${m.countsPerDegree.toFixed(1)} | cm/360: ${m.cmPer360}`);
// para un kick vertical de 20 grados, el pull esperado en counts para ESTE usuario:
console.log(`  pull esperado para contrarrestar 20 deg de kick: ${Math.round(20 * m.countsPerDegree)} counts`);

console.log('\n=== 2. Verificacion del 360 (sanity check de hardware) ===');
// usuario dice sens 0.4 @ 800 dpi -> deberia mover ~12857 counts en un 360.
// caso A: mueve 12900 (ok). caso B: mueve 6400 (mitad -> DPI reportado al doble del real)
console.log('  caso A (mueve 12900 counts):', verify360(12900, 800, 0.4));
console.log('  caso B (mueve 6400 counts): ', verify360(6400, 800, 0.4));

console.log('\n=== 3. Baseline personal desde 3 sprays de calibracion ===');
const cal = new BaselineCalibrator();
// spray decente: tira parejo hacia abajo (~9 px/frame), monotono
cal.addSpray(Array.from({ length: 30 }, () => ({ dy: 9 + (Math.random() * 2 - 1) })), 300);
// spray un poco mas flojo pero consistente
cal.addSpray(Array.from({ length: 30 }, () => ({ dy: 8 + (Math.random() * 2 - 1) })), 300);
// spray con algo de jerk (mete un par de correcciones hacia arriba)
cal.addSpray(Array.from({ length: 30 }, (_, i) => ({ dy: i % 11 === 0 ? -3 : 9 })), 300);
// drill de flicks: tiende a quedarse corto (undershoot ~ -15 counts) con algo de varianza
[-12, -18, -15, -20, -10, -16].forEach(o => cal.addFlickOvershoot(o));

const baseline = cal.build();
console.log('  baseline derivado:', JSON.stringify(baseline, null, 2));
console.log(`\n  lectura: pull baseline ${baseline.pullPerMsBaseline} px/ms; el motor alertara si una ronda`);
console.log(`  cae por debajo de ${baseline.pullPerMsFloor} px/ms. Flick bias ${baseline.flickBias} -> undershoot sistematico.`);
