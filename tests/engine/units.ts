/* units.ts — unit tests de las funciones PURAS del motor (calibración, recoil, agentes, i18n).
 * Complementan los tests de reglas (cases.ts): acá se ejercita la matemática directamente, sin pasar por
 * el pipeline de mouse. Cada unit es `{ name, run }` donde `run` tira Error si algo no cuadra.
 */

import { AimCoachEngine } from '../../src/engine/ruleEngine';
import { sensMath, countsToCounterDegrees, verify360, sprayGestureQuality, BaselineCalibrator } from '../../src/engine/calibration';
import { msPerBullet, approxPattern, curveFromHold, buildReference, scoreSpray, PATTERNS, DETERMINISTIC, DEFAULT_DETERMINISTIC } from '../../src/engine/recoil';
import { agentName, abilityName } from '../../src/engine/agents';
import { auditMessages } from '../../src/engine/messages';
import { RecoilCurve } from '../../src/engine/types';

export interface Unit { name: string; run: () => void; }

function assert(cond: boolean, msg: string): void { if (!cond) throw new Error(msg); }
function near(a: number, b: number, tol: number, what: string): void {
  if (Math.abs(a - b) > tol) throw new Error(`${what}: esperaba ~${b}, dio ${a} (tol ${tol})`);
}

export const UNITS: Unit[] = [
  // ---------------- calibration.ts ----------------
  {
    name: 'sensMath: TenZ 0.4 @ 800 DPI',
    run: () => {
      const m = sensMath(800, 0.4);
      near(m.countsPerDegree, 35.71, 0.1, 'countsPerDegree');
      near(m.countsPer360, 12857, 5, 'countsPer360');
      near(m.cmPer360, 40.82, 0.1, 'cmPer360');
    },
  },
  {
    name: 'countsToCounterDegrees: 20° a sens 0.4',
    run: () => near(countsToCounterDegrees(20, 0.4), 714.29, 1, 'counts'),
  },
  {
    name: 'verify360: giro correcto = ok, giro a la mitad = drift',
    run: () => {
      assert(verify360(12857, 800, 0.4).ok, 'giro correcto debería ser ok');
      const half = verify360(6400, 800, 0.4);
      assert(!half.ok, 'giro a la mitad NO debería ser ok');
      assert(half.driftPct > 8, 'drift debería ser alto');
    },
  },
  {
    name: 'sprayGestureQuality: <3 frames = null; pull parejo = mono 1',
    run: () => {
      assert(sprayGestureQuality([{ dy: 1 }, { dy: 1 }]) === null, '<3 frames debería ser null');
      const q = sprayGestureQuality([{ dy: 9 }, { dy: 9 }, { dy: 9 }])!;
      assert(q !== null, 'debería devolver calidad');
      near(q.totalPull, 27, 0.01, 'totalPull');
      near(q.monotonicity, 1, 0.01, 'monotonicity');
    },
  },
  {
    name: 'BaselineCalibrator: acepta spray monótono, rechaza el sucio, deriva baseline',
    run: () => {
      const cal = new BaselineCalibrator();
      const good = Array.from({ length: 30 }, () => ({ dy: 9 }));
      const dirty = Array.from({ length: 30 }, () => ({ dy: -9 })); // pull invertido -> mono 0
      assert(cal.addSpray(good, 300) === true, 'spray bueno debería entrar');
      assert(cal.addSpray(dirty, 300) === false, 'spray sucio NO debería entrar');
      cal.addSpray(good, 300); cal.addSpray(good, 300); // 3 buenos en total
      cal.addFlickOvershoot(-15); cal.addFlickOvershoot(-15);
      const b = cal.build();
      assert(b.pullPerMsBaseline > 0, 'pullPerMsBaseline debería ser > 0');
      near(b.pullPerMsFloor, b.pullPerMsBaseline * 0.7, 0.01, 'floor = 70% del baseline');
      assert(b.flickBias < 0, 'flickBias debería reflejar el undershoot (< 0)');
    },
  },
  {
    name: 'BaselineCalibrator.build: <3 sprays tira error',
    run: () => {
      const cal = new BaselineCalibrator();
      let threw = false;
      try { cal.build(); } catch { threw = true; }
      assert(threw, 'build con 0 sprays debería tirar error');
    },
  },

  // ---------------- recoil.ts ----------------
  {
    name: 'msPerBullet: vandal vs default',
    run: () => { near(msPerBullet('vandal'), 102.56, 0.1, 'vandal'); near(msPerBullet('desconocida'), 100, 0.01, 'default'); },
  },
  {
    name: 'PATTERNS/DETERMINISTIC: vandal y phantom cargados',
    run: () => {
      assert(PATTERNS.vandal.length === 24, 'vandal 24 balas');
      assert(PATTERNS.phantom.length === 28, 'phantom 28 balas');
      assert(DETERMINISTIC.vandal === 7 && DETERMINISTIC.phantom === 7, 'deterministic 7');
      assert(DEFAULT_DETERMINISTIC === 7, 'default deterministic 7');
    },
  },
  {
    name: 'approxPattern: sube vertical monótono',
    run: () => {
      const p = approxPattern({ bullets: 10, vTotal: 8, vSteep: 3, protectedH: 3, hAmp: 2, hDir: 1 });
      assert(p.length === 10, '10 balas');
      for (let i = 1; i < p.length; i++) assert(p[i].v >= p[i - 1].v, 'v debería ser monótono creciente');
      assert(p[0].h === 0, 'primera bala sin horizontal (protegida)');
    },
  },
  {
    name: 'curveFromHold: null sin datos; con hold arma la curva',
    run: () => {
      assert(curveFromHold(null as any, 0, 'vandal', 27) === null, 'null sin holdMoves');
      assert(curveFromHold([{ t: 0, dy: 1 }], 0, 'vandal', 0) === null, 'null sin countsPerDegree');
      const c = curveFromHold([{ t: 0, dy: 36 }, { t: 110, dy: 36 }, { t: 220, dy: 36 }], 0, 'vandal', 36);
      assert(!!c && c.length >= 1, 'debería armar curva');
      near(c![0].v, 1, 0.5, 'v acumulado en grados');
    },
  },
  {
    name: 'buildReference: <2 curvas = null; promedia 2',
    run: () => {
      const c1: RecoilCurve = [{ v: 1, h: 0 }, { v: 2, h: 0 }, { v: 3, h: 0 }];
      const c2: RecoilCurve = [{ v: 3, h: 0 }, { v: 4, h: 0 }, { v: 5, h: 0 }];
      assert(buildReference([c1]) === null, '<2 curvas = null');
      const ref = buildReference([c1, c2])!;
      assert(ref.length === 3, 'recorta a la más corta');
      near(ref[0].v, 2, 0.01, 'promedio bala 0');
    },
  },
  {
    name: 'scoreSpray: calce perfecto = 100; descontrolado = bajo (vertical); corto = null',
    run: () => {
      const ref = PATTERNS.vandal.slice(0, 7);
      assert(scoreSpray(ref, ref, { deterministic: 7 })!.score === 100, 'calce perfecto = 100');
      assert(scoreSpray(null, ref) === null, 'curva null = null');
      const flat: RecoilCurve = Array.from({ length: 7 }, () => ({ v: 0, h: 0 }));
      const bad = scoreSpray(flat, PATTERNS.vandal, { deterministic: 7 })!;
      assert(bad.score < 55, `descontrolado debería puntuar bajo, dio ${bad.score}`);
      assert(bad.phase === 'vertical', 'el eje del error debería ser vertical');
    },
  },

  // ---------------- agents.ts ----------------
  {
    name: 'agents: nombre y habilidad por codename (case-insensitive); desconocido = null',
    run: () => {
      assert(agentName('bountyhunter') === 'Fade', 'bountyhunter = Fade');
      assert(agentName('desconocido') === null, 'desconocido = null');
      assert(abilityName('bountyhunter', 'C') === 'Prowler', 'C = Prowler');
      assert(abilityName('bountyhunter', 'x') === 'Nightfall', 'x (minúscula) = Nightfall');
      assert(abilityName('desconocido', 'C') === null, 'desconocido = null');
    },
  },

  // ---------------- ruleEngine: flujo de calibración (por mouse) ----------------
  {
    name: 'engine calibración: 3 sprays sostenidos -> deriva baseline del arma',
    run: () => {
      let clock = 1_000_000;
      const e = new AimCoachEngine({ now: () => clock });
      e.setSens(sensMath(800, 0.4).countsPerDegree);
      e.startCalibration('vandal');
      for (let s = 0; s < 3; s++) {
        e.pushMouse({ t: clock, dx: 0, dy: 0, a: 'down', b: 'left' });
        for (let i = 0; i < 40; i++) { clock += 10; e.pushMouse({ t: clock, dx: 0, dy: 9, a: 'move', b: 'none' }); }
        e.pushMouse({ t: clock, dx: 0, dy: 0, a: 'up', b: 'left' });
        clock += 500;
      }
      assert(e.calibrationCount() === 3, `deberían haber entrado 3 sprays, entraron ${e.calibrationCount()}`);
      const res = e.finishCalibration();
      assert(res.weapon === 'vandal', 'arma calibrada = vandal');
      assert(res.baseline.pullPerMsBaseline > 0, 'baseline derivado con pull > 0');
    },
  },

  // ---------------- messages.ts (i18n) ----------------
  {
    name: 'i18n: todas las keys tienen ES y EN, y los {params} coinciden',
    run: () => {
      const issues = auditMessages();
      assert(issues.length === 0, 'problemas de i18n:\n    - ' + issues.join('\n    - '));
    },
  },
];
