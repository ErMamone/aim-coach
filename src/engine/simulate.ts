/* simulate.ts — harness de dev: alimenta el motor con un stream sintético para verlo disparar reglas.
 * Correr con: npx tsc src/engine/simulate.ts --outDir .tmp --rootDir src/engine --module commonjs
 *   --target es2017 --esModuleInterop --skipLibCheck && node .tmp/simulate.js
 */

import { AimCoachEngine } from './ruleEngine';

const engine = new AimCoachEngine({
  onFeedback: (f) => console.log(`  >> [prio ${f.prio}] ${f.msg}`),
});

let t = 0;
const tick = (ms: number): void => { t += ms; };

// helpers para inyectar eventos de mouse
const move = (dx: number, dy: number) => engine.pushMouse({ t, dx, dy, a: 'move', b: 'none' });
const down = () => engine.pushMouse({ t, dx: 0, dy: 0, a: 'down', b: 'left' });
const up = () => engine.pushMouse({ t, dx: 0, dy: 0, a: 'up', b: 'left' });

console.log('=== Round 1: player under-compensates recoil on Vandal sprays ===');
engine.setWeapon('Vandal');
engine.setPhase('active');

// dos sprays largos donde tira poco hacia abajo (sub-compensa: pullDy << expected)
for (let s = 0; s < 2; s++) {
  down();
  for (let i = 0; i < 30; i++) { tick(10); move(1, 1); } // 300ms de fuego, solo ~30px de pull (debería ~105)
  up();
  tick(400);
}

// round_report de Overwolf: muchos hits pero casi nada a la cabeza -> apunta bajo
engine.pushRoundReport({ damage: 280, hit: 8, headshot: 1, final_headshot: 0, bodyshots: 5, legshots: 2 });

console.log('\n=== Round 2: player spams clicks and shoots without settling ===');
engine.setWeapon('Sheriff');
engine.setPhase('active');

// 5 clicks muy seguidos (spam) mientras el mouse se mueve rápido (no estabiliza)
for (let i = 0; i < 5; i++) {
  move(40, 5); move(35, 3); // velocidad alta justo antes del click
  tick(20);
  down(); tick(15); up();   // tap rápido, ICI ~35ms
  tick(35);
}
engine.pushRoundReport({ damage: 150, hit: 3, headshot: 0, final_headshot: 1, bodyshots: 2, legshots: 0 });

console.log('\n=== Round 3: clean player (recoil control OK, good placement) ===');
engine.setWeapon('Phantom');
engine.setPhase('active');
down();
for (let i = 0; i < 30; i++) { tick(10); move(1, 9); } // 300ms, ~270px pull
up();
tick(500);
// tap estabilizado
move(2, 1); tick(120); down(); tick(15); up();
engine.pushRoundReport({ damage: 300, hit: 5, headshot: 3, final_headshot: 1, bodyshots: 1, legshots: 0 });

console.log('\n(end)');
