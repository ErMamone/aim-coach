/* harness.ts — runner data-driven del motor de reglas.
 * La idea: TODO lo "feo" (secuencias de eventos, magic numbers para pegarle a un umbral) vive en la DATA
 * (cases.ts), y acá queda solo el intérprete limpio + los constructores de gestos reusables. Así agregar
 * cobertura = agregar una fila de datos, no escribir código de test.
 *
 * Reloj: el motor recibe `now` inyectable; acá lo manejamos con `clock`, que también timestampea los
 * eventos de mouse. Un solo timeline determinista -> warm-up/dedup evaluables sin depender del wall-clock.
 */

import { AimCoachEngine, DEFAULT_BASELINE } from '../../src/engine/ruleEngine';
import { Baseline } from '../../src/engine/types';

/* Ev — el mini-DSL de eventos. Cada tupla es [op, ...args]. Ver el intérprete en Driver.apply. */
export type Ev =
  | ['timing', 'instant' | 'onDeath']
  | ['practiceWeapon', string]
  | ['weapon', string]
  | ['sens', number]                                    // countsPerDegree (habilita el scoring de recoil)
  | ['baseline', string, Partial<Baseline>]             // setea baseline calibrado del arma (merge sobre el DEFAULT)
  | ['agent', string]
  | ['abilities', { [k: string]: boolean }]
  | ['roundNumber', number]
  | ['phase', string]                                   // active | buy | roundEnd | dead (roundEnd flushea en partidas)
  | ['report', any]                                     // round_report de GEP (placement)
  | ['wait', number]                                    // avanza el reloj N ms (sin evento)
  | ['keyDown', string] | ['keyUp', string]             // WASD (strafe)
  | ['shots', number]                                   // N taps quietos (down/up rápidos, separados)
  | ['spam', number]                                    // N clicks con ICI < umbral de spam
  | ['macroClicks', number]                             // N downs en <150ms (macro / mouse fallando)
  | ['spray', number, number, number?, number?]         // durationMs, dyPorFrame, frames?, negFrac? (sustained spray)
  | ['flick', 'flojo' | 'pasado' | 'perfecto' | 'lento', number?] // N flicks del tipo dado (aproach + tap + ajuste)
  | ['kill'] | ['headshot']
  | ['flush'];                                          // flushInstant (superficia en modo práctica)

export interface Case {
  name: string;
  events: Ev[];
  expect?: string[];      // keys de feedback que DEBEN aparecer
  notExpect?: string[];   // keys que NO deben aparecer
}

export interface CaseResult { name: string; ok: boolean; fired: string[]; problems: string[]; }

/* Driver — una corrida aislada del motor con reloj controlado. Acumula las keys de feedback emitidas. */
class Driver {
  // Arranca alto (como Date.now() real): el motor asume timestamps grandes/no-cero en varios lados
  // (dedup `now - recentMsgs[key]` con default 0; `_keys[k]=t` truthy; `_moveStopT`). Arrancar en 0 rompería eso.
  private clock = 1_000_000;
  readonly fired: string[] = [];
  private readonly engine: AimCoachEngine;

  constructor() {
    this.engine = new AimCoachEngine({
      now: () => this.clock,
      onFeedback: (f) => { if (f.key) this.fired.push(f.key); },
    });
  }

  private move(dx: number, dy: number, dt: number): void {
    this.clock += dt;
    this.engine.pushMouse({ t: this.clock, dx, dy, a: 'move', b: 'none' });
  }
  private down(): void { this.engine.pushMouse({ t: this.clock, dx: 0, dy: 0, a: 'down', b: 'left' }); }
  private up(): void { this.engine.pushMouse({ t: this.clock, dx: 0, dy: 0, a: 'up', b: 'left' }); }

  // tap quieto: down + hold corto (< AUTO_FIRE_MS) + up. Cuenta como 1 disparo, sin flick.
  private tap(gapAfter: number): void {
    this.down(); this.clock += 15; this.up(); this.clock += gapAfter;
  }

  // spray sostenido: down + N frames de pull (dy) + up, con duración total durationMs.
  private spray(durationMs: number, dy: number, frames: number, negFrac: number): void {
    const n = Math.max(3, frames), step = durationMs / n, negUntil = Math.floor(n * negFrac);
    this.down();
    for (let i = 0; i < n; i++) this.move(0, i < negUntil ? -dy : dy, step);
    this.up();
  }

  /* flick — un gesto de flick clasificable: aproximación en +x (arma flickMag/dir/dur), tap, y un ajuste
   * post-click DENTRO de la ventana de corrección + un move que la cierra. El "kind" define el ajuste:
   *   flojo = seguís hacia el objetivo · pasado = volvés · perfecto = casi nada + rápido · lento = casi nada + lento.
   * (Los números están calibrados contra los umbrales del motor; si cambian los umbrales, ajustar acá.) */
  private flick(kind: 'flojo' | 'pasado' | 'perfecto' | 'lento'): void {
    const slow = kind === 'lento';
    const steps = slow ? 40 : 10, dt = slow ? 10 : 5; // lento = aproximación larga en tiempo (flickDur alto)
    for (let i = 0; i < steps; i++) this.move(10, 0, dt);       // aproach: dx>0, rápido -> approachSign +1, mag = steps*10
    this.down(); this.clock += 15; this.up();                   // tap
    const adjust = kind === 'flojo' ? 40 : kind === 'pasado' ? -40 : 2; // ajuste dentro de la ventana (90ms)
    this.move(adjust, 0, 30);
    this.move(0, 0, 100);                                        // move fuera de la ventana -> cierra y clasifica
  }

  apply(ev: Ev): void {
    const e = this.engine as any;
    switch (ev[0]) {
      case 'timing': e.setFeedbackTiming(ev[1]); break;
      case 'practiceWeapon': e.setPracticeWeapon(ev[1]); break;
      case 'weapon': e.setWeapon(ev[1]); break;
      case 'sens': e.setSens(ev[1]); break;
      case 'baseline': e.baselines[ev[1]] = { ...DEFAULT_BASELINE, ...ev[2] }; break;
      case 'agent': e.setAgent(ev[1]); break;
      case 'abilities': e.setAbilities(ev[1]); break;
      case 'roundNumber': e.setRoundNumber(ev[1]); break;
      case 'phase': e.setPhase(ev[1]); break;
      case 'report': e.pushRoundReport(ev[1]); break;
      case 'wait': this.clock += ev[1]; break;
      case 'keyDown': e.pushKey({ t: this.clock, a: 'down', k: ev[1] }); break;
      case 'keyUp': e.pushKey({ t: this.clock, a: 'up', k: ev[1] }); break;
      case 'shots': for (let i = 0; i < ev[1]; i++) this.tap(300); break;
      case 'spam': for (let i = 0; i < ev[1]; i++) this.tap(40); break; // ICI ~55ms < SPAM_ICI_MS
      case 'macroClicks': for (let i = 0; i < ev[1]; i++) { this.down(); this.up(); this.clock += 20; } break;
      case 'spray': this.spray(ev[1], ev[2], ev[3] ?? Math.round(ev[1] / 10), ev[4] ?? 0); break;
      case 'flick': for (let i = 0; i < (ev[2] ?? 1); i++) this.flick(ev[1]); break;
      case 'kill': e.pushKill(); break;
      case 'headshot': e.pushHeadshot(); break;
      case 'flush': e.flushInstant(); break;
    }
  }
}

/* runCase — corre un caso y compara las keys emitidas contra expect/notExpect. */
export function runCase(c: Case): CaseResult {
  const d = new Driver();
  for (const ev of c.events) d.apply(ev);
  const fired = d.fired;
  const problems: string[] = [];
  for (const k of c.expect || []) if (!fired.includes(k)) problems.push(`falta '${k}'`);
  for (const k of c.notExpect || []) if (fired.includes(k)) problems.push(`sobra '${k}'`);
  return { name: c.name, ok: problems.length === 0, fired, problems };
}
