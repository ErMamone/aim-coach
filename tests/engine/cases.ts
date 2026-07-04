/* cases.ts — LA DATA de los tests del motor (declarativa, data-driven).
 * Cada caso: una secuencia de eventos (mini-DSL de harness.ts) + qué feedback DEBE / NO DEBE salir.
 * Acá van los magic numbers para pegarle a cada umbral; el harness queda limpio. Agregar cobertura = agregar
 * una fila. Convenciones útiles:
 *   - El warm-up (WARMUP_MS=15s desde el 1er tiro) gatea las reglas de ronda -> por eso muchos casos hacen
 *     ['wait', 16000] antes de ['flush'] / ['phase','roundEnd'].
 *   - Macro / kill-good / kill-static / hs-rate se superficia sin pasar por las reglas de ronda (no gateado).
 *   - Reglas relativas al baseline (recoil/jerky/flick-bias) SOLO disparan con baseline calibrado del arma.
 */

import { Case } from './harness';

const WARM: [ 'wait', number ] = ['wait', 16000]; // pasar el warm-up

export const CASES: Case[] = [
  // ---------------- warm-up (anti "cosas raras" al arrancar) ----------------
  {
    name: 'warm-up: 6 tiros quietos ANTES de 15s -> silencio',
    events: [['timing', 'instant'], ['shots', 6], ['flush']],
    notExpect: ['strafe-static'],
  },
  {
    name: 'warm-up: mismos 6 tiros DESPUÉS de 15s -> ya opina',
    events: [['timing', 'instant'], ['shots', 6], WARM, ['flush']],
    expect: ['strafe-static'],
  },
  {
    name: 'warm-up: macro (riesgo de ban) NO se gatea, avisa aunque recién arranques',
    events: [['timing', 'instant'], ['macroClicks', 5]],
    expect: ['macro'],
  },

  // ---------------- gate de baseline ----------------
  {
    name: 'baseline gate: 2 sprays flojos SIN calibrar -> no marca recoil',
    events: [['timing', 'instant'], ['practiceWeapon', 'vandal'],
      ['spray', 400, 2], ['wait', 500], ['spray', 400, 2], WARM, ['flush']],
    notExpect: ['recoil'],
  },
  {
    name: 'baseline gate: mismos sprays CON baseline calibrado -> marca recoil flojo',
    events: [['timing', 'instant'], ['practiceWeapon', 'vandal'], ['baseline', 'vandal', { pullPerMsFloor: 0.5 }],
      ['spray', 400, 2], ['wait', 500], ['spray', 400, 2], WARM, ['flush']],
    expect: ['recoil'],
  },
  {
    name: 'jerky: pull poco monótono CON baseline -> marca jerky (y no recoil flojo)',
    events: [['timing', 'instant'], ['practiceWeapon', 'vandal'], ['baseline', 'vandal', { pullPerMsFloor: 0.35, monotonicityFloor: 0.75 }],
      ['spray', 400, 10, 40, 0.3], ['wait', 500], ['spray', 400, 10, 40, 0.3], WARM, ['flush']],
    expect: ['jerky'],
    notExpect: ['recoil'],
  },

  // ---------------- spam de clicks ----------------
  {
    name: 'spam: 5 clicks muy seguidos (ICI corto) -> marca spam',
    events: [['timing', 'instant'], ['spam', 5], WARM, ['flush']],
    expect: ['spam'],
  },

  // ---------------- strafe (movimiento al disparar) ----------------
  {
    name: 'strafe-static: 6 tiros parado -> "te quedás quieto"',
    events: [['timing', 'instant'], ['shots', 6], WARM, ['flush']],
    expect: ['strafe-static'],
  },
  {
    name: 'strafe-move: 6 tiros caminando (W apretada) -> "frená al disparar"',
    events: [['timing', 'instant'], ['keyDown', 'w'], ['shots', 6], ['keyUp', 'w'], WARM, ['flush']],
    expect: ['strafe-move'],
  },
  {
    name: 'strafe-kill: 2 kills en movimiento -> refuerzo positivo',
    events: [['timing', 'instant'], ['keyDown', 'w'],
      ['shots', 1], ['kill'], ['wait', 300], ['shots', 1], ['kill'],
      ['keyUp', 'w'], WARM, ['flush']],
    expect: ['strafe-kill'],
  },

  // ---------------- kills (contexto inmediato, no gateado) ----------------
  {
    name: 'kill-good: matar en movimiento -> refuerzo inmediato',
    events: [['timing', 'instant'], ['keyDown', 'w'], ['shots', 1], ['kill']],
    expect: ['kill-good'],
  },
  {
    name: 'kill-static: matar parado -> "movete más"',
    events: [['timing', 'instant'], ['shots', 1], ['kill']],
    expect: ['kill-static'],
  },

  // ---------------- hs-rate (placement real por kill) ----------------
  {
    name: 'hs-rate: 5 kills con pocos headshots -> "subí la mira"',
    events: [['timing', 'instant'],
      ['kill'], ['kill'], ['kill'], ['kill'], ['kill'], ['flush']],
    expect: ['hs-rate'],
  },

  // ---------------- placement (round_report, solo partidas) ----------------
  {
    name: 'placement-ok: buena altura de mira (headshots) -> felicita',
    events: [['timing', 'onDeath'], ['report', { hit: 10, headshot: 5, bodyshots: 4, legshots: 1 }], ['phase', 'roundEnd']],
    expect: ['placement-ok'],
  },
  {
    name: 'placement low: 2 rondas pegando a las piernas -> "apuntás bajo"',
    events: [['timing', 'onDeath'],
      ['report', { hit: 10, headshot: 1, bodyshots: 4, legshots: 5 }], ['phase', 'roundEnd'],
      ['report', { hit: 10, headshot: 1, bodyshots: 4, legshots: 5 }], ['phase', 'roundEnd']],
    expect: ['placement'],
  },
  {
    name: 'placement chest: 3 rondas al pecho (no cabeza) -> crosshair placement',
    events: [['timing', 'onDeath'],
      ['report', { hit: 10, headshot: 1, bodyshots: 7, legshots: 2 }], ['phase', 'roundEnd'],
      ['report', { hit: 10, headshot: 1, bodyshots: 7, legshots: 2 }], ['phase', 'roundEnd'],
      ['report', { hit: 10, headshot: 1, bodyshots: 7, legshots: 2 }], ['phase', 'roundEnd']],
    expect: ['placement'],
  },

  // ---------------- recoil-score (warm-up gate; necesita sens + patrón del arma) ----------------
  {
    name: 'recoil-score: spray sostenido DURANTE warm-up -> no puntúa (gate)',
    events: [['timing', 'instant'], ['practiceWeapon', 'vandal'], ['sens', 27], ['spray', 400, 6]],
    notExpect: ['recoil-score'],
  },
  {
    name: 'hs-rate: 5 kills con headshots -> también evalúa (misma key)',
    events: [['timing', 'instant'],
      ['kill'], ['headshot'], ['kill'], ['headshot'], ['kill'], ['headshot'], ['kill'], ['headshot'], ['kill'], ['headshot'],
      ['flush']],
    expect: ['hs-rate'],
  },

  // ---------------- flicks (clasificación + rachas + sesgo) ----------------
  {
    name: 'flick-summary: 3 flicks flojos -> resumen "quedás corto"',
    events: [['timing', 'instant'], ['flick', 'flojo', 3], WARM, ['flush']],
    expect: ['flick-summary'],
  },
  {
    name: 'flicks perfectos: jugador limpio -> sin regaños',
    events: [['timing', 'instant'], ['flick', 'perfecto', 5], WARM, ['flush']],
    notExpect: ['flick-summary', 'sens-rec', 'speed-rec'],
  },
  {
    name: 'racha flojo: 8 flicks cortos seguidos -> recomendar subir sens',
    events: [['timing', 'instant'], ['flick', 'flojo', 8]],
    expect: ['sens-rec'],
  },
  {
    name: 'racha pasado: 8 flicks pasados seguidos -> recomendar bajar sens',
    events: [['timing', 'instant'], ['flick', 'pasado', 8]],
    expect: ['sens-rec'],
  },
  {
    name: 'racha lento: 8 flicks lentos seguidos -> recomendar ser más rápido',
    events: [['timing', 'instant'], ['flick', 'lento', 8]],
    expect: ['speed-rec'],
  },
  {
    name: 'flick-bias CON baseline: 3 flicks pasados -> sesgo anómalo',
    events: [['timing', 'instant'], ['practiceWeapon', 'vandal'], ['baseline', 'vandal', {}],
      ['flick', 'pasado', 3], WARM, ['flush']],
    expect: ['flick-bias'],
  },
  {
    name: 'flick-bias gate: mismos 3 pasados SIN baseline -> no marca sesgo',
    events: [['timing', 'instant'], ['flick', 'pasado', 3], WARM, ['flush']],
    notExpect: ['flick-bias'],
  },
  {
    name: 'resumen pasado: 3 flicks pasados -> "en general te pasás"',
    events: [['timing', 'instant'], ['flick', 'pasado', 3], WARM, ['flush']],
    expect: ['flick-summary'],
  },
  {
    name: 'resumen lento: 3 flicks lentos -> "sé más rápido"',
    events: [['timing', 'instant'], ['flick', 'lento', 3], WARM, ['flush']],
    expect: ['flick-summary'],
  },

  // ---------------- recoil-score real (después del warm-up, spray descontrolado) ----------------
  {
    name: 'recoil-score: spray descontrolado después del warm-up -> puntúa (bad)',
    // un tiro arranca el warm-up, el wait lo pasa, y RECIÉN ahí el spray se puntúa.
    // spray largo (llega a las 7 balas deterministas) sin compensar (dy=0) -> score claramente bajo.
    events: [['timing', 'instant'], ['practiceWeapon', 'vandal'], ['sens', 27], ['shots', 1], WARM, ['spray', 800, 0]],
    expect: ['recoil-score'],
  },

  // ---------------- kill sin tiro reciente (no atribuye contexto) ----------------
  {
    name: 'kill sin tiro reciente: no marca kill-good ni kill-static',
    events: [['timing', 'instant'], ['kill']],
    notExpect: ['kill-good', 'kill-static'],
  },

  // ---------------- habilidades: NO se coachan (GEP no da el uso real) ----------------
  {
    name: 'abilities: NUNCA se avisa de habilidades (ni en partida peleada) — feature removida',
    events: [['timing', 'onDeath'], ['phase', 'active'], ['keyDown', 'e'], ['keyUp', 'e'], ['shots', 3], WARM, ['phase', 'roundEnd']],
    notExpect: ['abilities', 'ability-pre'],
  },
];
