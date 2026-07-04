/* run.ts — corre toda la batería (unit tests puros + casos de reglas) e imprime un reporte. Sale con
 * código != 0 si falla algo (gate real para husky/CI). Correr con: `yarn test`.
 */

import { CASES } from './cases';
import { runCase } from './harness';
import { UNITS } from './units';

declare const process: { exit(code?: number): void };

let failed = 0;
const total = UNITS.length + CASES.length;
console.log(`\nAim Coach — engine test battery (${UNITS.length} units + ${CASES.length} rule cases)\n`);

for (const u of UNITS) {
  try { u.run(); console.log(`  PASS  [unit] ${u.name}`); }
  catch (e: any) { failed++; console.log(`  FAIL  [unit] ${u.name}\n        ${e && e.message}`); }
}

for (const c of CASES) {
  const r = runCase(c);
  if (r.ok) {
    console.log(`  PASS  [rule] ${r.name}`);
  } else {
    failed++;
    console.log(`  FAIL  [rule] ${r.name}`);
    console.log(`        problems: ${r.problems.join(' · ')}`);
    console.log(`        fired: [${r.fired.join(', ') || '—'}]`);
  }
}

console.log(`\n${total - failed}/${total} passed${failed ? ` · ${failed} FAILED` : ' · all green'}\n`);
process.exit(failed ? 1 : 0);
