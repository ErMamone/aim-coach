/* messages.ts — textos del overlay in-game en ES/EN (fuente única de i18n del overlay).
 * Cubre el coaching del engine Y el texto de UI del overlay (calibración, estado, flick, self-test) que
 * emiten el background y el overlay. Se resuelve con T(key, lang, params). Los NOMBRES propios (agente,
 * habilidades, arma) van como params sin traducir. Interpolación con {param}. El idioma lo sabe cada
 * emisor: el engine via setLang, el background/overlay via la var `lang` (config.lang -> overlay-cfg).
 */

export type Lang = 'es' | 'en';

const M: { [key: string]: { es: string; en: string } } = {
  // habilidades pre-ronda (short = detail)
  'abilityPre.short': { es: '{agent}: preparate — {names}', en: '{agent}: get ready — {names}' },
  'abilityPre.skipped': { es: '{agent}: la ronda pasada no usaste ninguna — usá {names}', en: "{agent}: you used none last round — use {names}" },

  // hs-rate
  'hsRate.bad.short': { es: 'Pocos headshots — subí la mira', en: 'Few headshots — raise your aim' },
  'hsRate.bad.detail': { es: '{pct}% de tus kills a la cabeza ({hs}/{kills}). Pre-aimeá a altura de cabeza.', en: '{pct}% of your kills to the head ({hs}/{kills}). Pre-aim at head height.' },
  'hsRate.good.short': { es: 'Buenos headshots ✓ ({pct}%)', en: 'Good headshots ✓ ({pct}%)' },
  'hsRate.good.detail': { es: '{hs}/{kills} kills a la cabeza. Mantené esa altura de mira.', en: '{hs}/{kills} kills to the head. Keep that aim height.' },

  // kills
  'killGood.short': { es: 'Kill en movimiento ✓', en: 'Kill on the move ✓' },
  'killGood.detail': { es: 'Kill {ctx} — móvil y preciso.', en: 'Kill {ctx} — mobile and precise.' },
  'killCtx.counter': { es: 'counter-strafeando', en: 'counter-strafing' },
  'killCtx.moving': { es: 'moviéndote', en: 'while moving' },
  'killStatic.short': { es: 'Kill quieto — movete más', en: 'Kill while static — move more' },
  'killStatic.detail': { es: 'Mataste parado: bien, pero sos predecible.', en: 'You killed standing still: fine, but predictable.' },

  // racha de flicks -> recomendar sens/velocidad
  'streak.pasado.short': { es: 'Bajá la sens ~10% — te pasás seguido', en: 'Lower sens ~10% — you overshoot a lot' },
  'streak.pasado.detail': { es: '{n} flicks pasados seguidos (ya descartando pulso): patrón de sens, no error puntual.', en: '{n} overshot flicks in a row (pulse already ruled out): a sens pattern, not a one-off.' },
  'streak.flojo.short': { es: 'Subí la sens ~10% — te quedás corto', en: 'Raise sens ~10% — you undershoot' },
  'streak.flojo.detail': { es: '{n} flicks flojos seguidos (ya descartando pulso): patrón de sens, no error puntual.', en: '{n} undershot flicks in a row (pulse already ruled out): a sens pattern, not a one-off.' },
  'streak.lento.short': { es: 'Sé más rápido — apuntá y dispará, no trackees', en: 'Be faster — aim and shoot, don’t track' },
  'streak.lento.detail': { es: '{n} flicks lentos seguidos: llegás bien pero tarde. Snap al objetivo, no lo persigas.', en: '{n} slow flicks in a row: you land but late. Snap to the target, don’t chase it.' },

  // macro / mouse
  'macro.short': { es: '⚠ Posible macro o mouse fallando', en: '⚠ Possible macro or faulty mouse' },
  'macro.detail': { es: '{n} clicks en {ms}ms — riesgo de ban. Revisá tu mouse/configuración.', en: '{n} clicks in {ms}ms — ban risk. Check your mouse/config.' },

  // recoil-score
  'recoilGood.short': { es: 'Recoil dominado ({score}%)', en: 'Recoil mastered ({score}%)' },
  'recoilGood.detail': { es: 'Controlaste las primeras {det} balas al {score}%. Así. (después es spread RNG)', en: 'You controlled the first {det} bullets at {score}%. Like that. (then it’s RNG spread)' },
  'recoilBad.short': { es: 'Recoil {score}% — mejorá {axis}{seg}', en: 'Recoil {score}% — fix {axis}{seg}' },
  'recoilBad.detail': { es: 'Control de las primeras {det} balas: {score}%. Te desviaste en {axisDetail}{seg}.', en: 'First {det} bullets control: {score}%. You drifted on {axisDetail}{seg}.' },
  'axis.pull': { es: 'el pull', en: 'the pull' },
  'axis.horizontal': { es: 'el horizontal', en: 'the horizontal' },
  'axisDetail.pull': { es: 'el pull vertical (bajá más parejo)', en: 'the vertical pull (pull down more evenly)' },
  'axisDetail.horizontal': { es: 'el horizontal', en: 'the horizontal' },
  'seg.early': { es: ' al arranque', en: ' at the start' },
  'seg.mid': { es: ' al medio', en: ' mid-spray' },
  'seg.late': { es: ' al final', en: ' at the end' },

  // spam de clicks
  'spam.short': { es: 'Tapeá más controlado', en: 'Tap more controlled' },
  'spam.detail': { es: 'Spam de clicks ({n} disparos muy seguidos). Dejá estabilizar el crosshair entre tiros.', en: 'Click spam ({n} shots too fast). Let the crosshair settle between shots.' },

  // recoil vs baseline (R2) / jerky (R3)
  'recoilWeak.short': { es: 'Bajá el recoil más parejo', en: 'Pull down more evenly' },
  'recoilWeak.detail': { es: 'Recoil flojo: pull {avg} vs tu baseline {baseline}. Estás tirando más flojo de lo que sabés.', en: 'Weak recoil: pull {avg} vs your baseline {baseline}. You’re pulling softer than you can.' },
  'jerky.short': { es: 'Pull-down en una sola dirección', en: 'Pull down in one direction' },
  'jerky.detail': { es: 'Pull-down errático (monotonía {mono} vs {base}). Sin micro-correcciones arriba.', en: 'Erratic pull-down (monotonicity {mono} vs {base}). No micro-corrections upward.' },

  // flick-bias (R4)
  'flickBias.over.short': { es: 'Frená un toque el flick', en: 'Ease off the flick a touch' },
  'flickBias.under.short': { es: 'Llegá un toque más con el flick', en: 'Reach a touch more with the flick' },
  'flickBias.detail': { es: 'Flicks {dir} (desvío {dev} counts vs tu sesgo {bias}).', en: 'Flicks {dir} (deviation {dev} counts vs your bias {bias}).' },
  'flickBias.dir.over': { es: 'pasándote', en: 'overshooting' },
  'flickBias.dir.under': { es: 'quedándote corto', en: 'undershooting' },

  // rushed (R5)
  'rushed.short': { es: 'Frená antes de tirar (tiros lentos)', en: 'Stop before shooting (slow flicks)' },
  'rushed.detail': { es: '{rushed}/{deliberate} tiros apuntados sin frenar antes del click.', en: '{rushed}/{deliberate} aimed shots without stopping before the click.' },

  // resumen de flicks (R7)
  'summary.lento.short': { es: 'Sé más rápido con los flicks', en: 'Be faster with your flicks' },
  'summary.pasado.short': { es: 'En general te pasás — frená el flick', en: 'Overall you overshoot — ease the flick' },
  'summary.flojo.short': { es: 'En general te quedás corto — llegá más', en: 'Overall you undershoot — reach more' },
  'summary.detail': { es: 'Flicks: {ok} perfectos · {flojo} flojos · {pasado} pasados · {lento} lentos.', en: 'Flicks: {ok} perfect · {flojo} short · {pasado} over · {lento} slow.' },

  // strafe (R8)
  'strafeMove.short': { es: 'Frená al disparar (counter-strafe)', en: 'Stop when shooting (counter-strafe)' },
  'strafeMove.detail': { es: '{moving}/{shots} tiros caminando. Movete, pero soltá/revertí la tecla un instante antes de tirar.', en: '{moving}/{shots} shots while walking. Move, but release/reverse the key an instant before shooting.' },
  'strafeStatic.short': { es: 'Te estás quedando quieto — movete', en: 'You’re standing still — move' },
  'strafeStatic.detail': { es: '{static}/{shots} tiros parado. Sos predecible: movete entre disparos y counter-strafeá.', en: '{static}/{shots} shots standing. Predictable: move between shots and counter-strafe.' },
  'strafeKill.short': { es: 'Buenos kills en movimiento ({n})', en: 'Good kills on the move ({n})' },
  'strafeKill.detail': { es: 'Mataste counter-strafeando {n} veces. Eso es lo ideal: móvil y preciso.', en: 'You killed counter-strafing {n} times. That’s ideal: mobile and precise.' },

  // habilidades no usadas
  'abilities.short': { es: 'No usaste habilidades', en: 'You used no abilities' },
  'abilities.named': { es: 'No usaste ninguna habilidad esta ronda. Tenías: {names} — inflan tu impacto.', en: 'You used no abilities this round. You had: {names} — they boost your impact.' },
  'abilities.generic': { es: 'Recordá usar tus habilidades (C/Q/E) — inflan tu impacto en la ronda.', en: 'Remember to use your abilities (C/Q/E) — they boost your round impact.' },

  // placement (R6)
  'placement.low.short': { es: 'Subí la mira — apuntás muy bajo', en: 'Raise your aim — too low' },
  'placement.low.detail': { es: 'Hace {n} rondas pegás a las piernas/abajo.', en: 'For {n} rounds you’re hitting legs/low.' },
  'placement.chest.short': { es: 'Mirá a la CABEZA, no al pecho', en: 'Aim for the HEAD, not the chest' },
  'placement.chest.detail': { es: 'Hace {n} rondas pegás al pecho. Crosshair placement: pre-aimeá a altura de cabeza.', en: 'For {n} rounds you’re hitting the chest. Crosshair placement: pre-aim at head height.' },
  'placementOk.short': { es: 'Buen placement 👍', en: 'Good placement 👍' },
  'placementOk.detail': { es: '{hs}/{total} a la cabeza. Mantenelo.', en: '{hs}/{total} to the head. Keep it.' },

  // ---- UI del overlay (NO coaching): calibración/estado que emite el background, y labels del overlay ----
  // Calibración (banner #cal). {label}/{prompt} ya vienen traducidos (son otras keys de acá).
  'cal.countdown': { es: '{label} — empezá en {n}…', en: '{label} — start in {n}…' },
  'cal.recording': { es: '{prompt} — {n}s{tick}', en: '{prompt} — {n}s{tick}' },
  'cal.title360': { es: 'Calibración 360', en: '360° calibration' },
  'cal.turn360': { es: 'Girá UNA vuelta 360° limpia', en: 'Do ONE clean 360° turn' },
  'cal.result360': { es: '360 {status} · drift {drift}%', en: '360 {status} · drift {drift}%' },
  'cal.ok360': { es: 'OK', en: 'OK' },
  'cal.checkDpi': { es: 'revisar DPI', en: 'check DPI' },
  'cal.titleWeapon': { es: 'Calibración {weapon}', en: '{weapon} calibration' },
  'cal.doSprays': { es: '{weapon}: hacé {n} sprays — 0/{n}', en: '{weapon}: do {n} sprays — 0/{n}' },
  'cal.weakSpray': { es: 'Spray flojo, no cuenta — {done}/{n}', en: 'Weak spray, doesn’t count — {done}/{n}' },
  'cal.sprays': { es: 'Sprays — {done}/{n}', en: 'Sprays — {done}/{n}' },
  'cal.baselineDone': { es: 'Baseline {weapon} ✓', en: 'Baseline {weapon} ✓' },
  'cal.fewSprays': { es: 'Pocos sprays, repetí', en: 'Too few sprays, retry' },
  'cal.needValorant': { es: 'Abrí Valorant primero.', en: 'Open Valorant first.' },
  'cal.needCapturer': { es: 'Capturer no conectado: corré AimCoach-MouseCapturer.exe', en: 'Capturer not connected: run AimCoach-MouseCapturer.exe' },

  // Timing (banner #cal, al cambiar de contexto Range<->partida)
  'timing.live': { es: 'Feedback en vivo', en: 'Live feedback' },
  'timing.match': { es: 'Modo partida — feedback al final de ronda', en: 'Match mode — feedback at round end' },

  // Flick pill (#flick) — {type} traducido por flick.type.*; el tipo crudo sigue siendo la clase CSS.
  'flick.label': { es: 'Flick {type}', en: 'Flick {type}' },
  'flick.type.flojo': { es: 'flojo', en: 'weak' },
  'flick.type.perfecto': { es: 'perfecto', en: 'perfect' },
  'flick.type.pasado': { es: 'pasado', en: 'over' },
  'flick.type.lento': { es: 'lento', en: 'slow' },

  // Mini-traza de recoil (#recoil) y self-test del overlay
  'recoil.label': { es: 'Recoil {score}% · {weapon}', en: 'Recoil {score}% · {weapon}' },
  'overlay.selftest': { es: 'Aim Coach: overlay activo in-game.', en: 'Aim Coach: overlay active in-game.' },

  // Estado del capturer (supervisor del stream de mouse)
  'capturer.down': { es: '⚠ Capturer sin conexión — sin datos de mouse', en: '⚠ Capturer offline — no mouse data' },
  'capturer.recovered': { es: 'Capturer reconectado ✓', en: 'Capturer reconnected ✓' },
};

/* T — texto en el idioma dado, con interpolación {param}. Si falta la key, devuelve la key (visible = bug). */
export function T(key: string, lang: Lang, params?: { [k: string]: string | number }): string {
  const entry = M[key];
  let s = entry ? entry[lang] : key;
  if (params) for (const k in params) s = s.split('{' + k + '}').join(String(params[k]));
  return s;
}

/* auditMessages — chequeo de integridad del diccionario (para tests): devuelve la lista de problemas.
 * Verifica que cada key tenga ES y EN no vacíos y que los {params} coincidan entre ambos idiomas
 * (una traducción a la que le falta un {param} rompería la interpolación sin que nadie se entere). */
export function auditMessages(): string[] {
  const issues: string[] = [];
  const params = (s: string) => (s.match(/\{(\w+)\}/g) || []).slice().sort().join(',');
  for (const key in M) {
    const e = M[key];
    if (!e.es) issues.push(`${key}: falta ES`);
    if (!e.en) issues.push(`${key}: falta EN`);
    if (e.es && e.en && params(e.es) !== params(e.en)) issues.push(`${key}: params ES/EN no coinciden (${params(e.es)} vs ${params(e.en)})`);
  }
  return issues;
}
