// simulate.js — alimenta el motor con un stream sintetico para verlo disparar reglas.
const { AimCoachEngine } = require('./ruleEngine');

const engine = new AimCoachEngine({
  onFeedback: (f) => console.log(`  >> [prio ${f.prio}] ${f.msg}`),
});

let t = 0;
const tick = (ms) => { t += ms; };

// helpers para inyectar eventos de mouse
const move = (dx, dy) => engine.pushMouse({ t, dx, dy, a: 'move', b: 'none' });
const down = () => engine.pushMouse({ t, dx: 0, dy: 0, a: 'down', b: 'left' });
const up   = () => engine.pushMouse({ t, dx: 0, dy: 0, a: 'up',   b: 'left' });

console.log('=== Ronda 1: jugador sub-compensa recoil en sprays con Vandal ===');
engine.setWeapon('Vandal');
engine.setPhase('active');

// dos sprays largos donde tira poco hacia abajo (sub-compensa: pullDy << expected)
for (let s = 0; s < 2; s++) {
  down();
  for (let i = 0; i < 30; i++) { tick(10); move(1, 1); } // 300ms de fuego, solo ~30px de pull (deberia ~105)
  up();
  tick(400);
}

// round_report de Overwolf: muchos hits pero casi nada a la cabeza -> apunta bajo
engine.pushRoundReport({ damage: 280, hit: 8, headshot: 1, final_headshot: 0, bodyshots: 5, legshots: 2 });

console.log('\n=== Ronda 2: jugador spamea clicks y dispara sin estabilizar ===');
engine.setWeapon('Sheriff');
engine.setPhase('active');

// 5 clicks muy seguidos (spam) mientras el mouse se mueve rapido (no estabiliza)
for (let i = 0; i < 5; i++) {
  move(40, 5); move(35, 3); // velocidad alta justo antes del click
  tick(20);
  down(); tick(15); up();   // tap rapido, ICI ~35ms
  tick(35);
}
engine.pushRoundReport({ damage: 150, hit: 3, headshot: 0, final_headshot: 1, bodyshots: 2, legshots: 0 });

console.log('\n=== Ronda 3: jugador limpio (control de recoil OK, buen placement) ===');
engine.setWeapon('Phantom');
engine.setPhase('active');
down();
for (let i = 0; i < 30; i++) { tick(10); move(1, 9); } // 300ms, ~270px pull (expected ~90 -> ratio alto pero un solo spray)
up();
tick(500);
// tap estabilizado
move(2, 1); tick(120); down(); tick(15); up();
engine.pushRoundReport({ damage: 300, hit: 5, headshot: 3, final_headshot: 1, bodyshots: 1, legshots: 0 });

console.log('\n(fin)');
