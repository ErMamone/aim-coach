/* calibrate_demo.ts — harness de dev: muestra la matemática de sens, el verify360 y el baseline.
 * Correr con: npx tsc src/engine/calibrate_demo.ts --outDir .tmp --rootDir src/engine --module commonjs
 *   --target es2017 --esModuleInterop --skipLibCheck && node .tmp/calibrate_demo.js
 */

import { sensMath, verify360, BaselineCalibrator } from './calibration';

console.log('=== 1. Sens math (TenZ: 0.4 @ 800 DPI) ===');
const m = sensMath(800, 0.4);
console.log(`  counts/360: ${Math.round(m.countsPer360)} | counts/degree: ${m.countsPerDegree.toFixed(1)} | cm/360: ${m.cmPer360}`);
// para un kick vertical de 20 grados, el pull esperado en counts para ESTE usuario:
console.log(`  expected pull to counter 20 deg of kick: ${Math.round(20 * m.countsPerDegree)} counts`);

console.log('\n=== 2. 360 verification (hardware sanity check) ===');
// usuario dice sens 0.4 @ 800 dpi -> debería mover ~12857 counts en un 360.
// caso A: mueve 12900 (ok). caso B: mueve 6400 (mitad -> DPI reportado al doble del real)
console.log('  case A (moves 12900 counts):', verify360(12900, 800, 0.4));
console.log('  case B (moves 6400 counts): ', verify360(6400, 800, 0.4));

console.log('\n=== 3. Personal baseline from 3 calibration sprays ===');
const cal = new BaselineCalibrator();
// spray decente: tira parejo hacia abajo (~9 px/frame), monótono
cal.addSpray(Array.from({ length: 30 }, () => ({ dy: 9 + (Math.random() * 2 - 1) })), 300);
// spray un poco más flojo pero consistente
cal.addSpray(Array.from({ length: 30 }, () => ({ dy: 8 + (Math.random() * 2 - 1) })), 300);
// spray con algo de jerk (mete un par de correcciones hacia arriba)
cal.addSpray(Array.from({ length: 30 }, (_, i) => ({ dy: i % 11 === 0 ? -3 : 9 })), 300);
// drill de flicks: tiende a quedarse corto (undershoot ~ -15 counts) con algo de varianza
[-12, -18, -15, -20, -10, -16].forEach(o => cal.addFlickOvershoot(o));

const baseline = cal.build();
console.log('  derived baseline:', JSON.stringify(baseline, null, 2));
console.log(`\n  reading: pull baseline ${baseline.pullPerMsBaseline} px/ms; the engine warns if a round`);
console.log(`  drops below ${baseline.pullPerMsFloor} px/ms. Flick bias ${baseline.flickBias} -> systematic undershoot.`);
