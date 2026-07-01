/* agents.ts — datos estáticos de agentes de Valorant
 * Fuente: valorant-api.com (agentes jugables, 2026-07-01). GEP `me.agent` y el scoreboard usan el
 * CODENAME interno (developerName), no el nombre visible: mapeamos codename(lowercase) -> nombre + habilidades.
 * Habilidades por TECLA: C=Grenade, Q=Ability1, E=Ability2, X=Ultimate (mapeo fijo del juego).
 * Sirve para nombrar la habilidad detrás de cada tecla en los mensajes de coaching.
 */

import { AgentData, AbilityKey } from './types';

const AGENTS: { [code: string]: AgentData } = {
  rift: { name: 'Astra', ab: { C: 'Gravity Well', Q: 'Nova Pulse', E: 'Nebula  / Dissipate', X: 'Astral Form / Cosmic Divide' } },
  breach: { name: 'Breach', ab: { C: 'Aftershock', Q: 'Flashpoint', E: 'Fault Line', X: 'Rolling Thunder' } },
  sarge: { name: 'Brimstone', ab: { C: 'Stim Beacon', Q: 'Incendiary', E: 'Sky Smoke', X: 'Orbital Strike' } },
  deadeye: { name: 'Chamber', ab: { C: 'Trademark', Q: 'Headhunter', E: 'Rendezvous', X: 'Tour De Force' } },
  smonk: { name: 'Clove', ab: { C: 'Pick-me-up', Q: 'Meddle', E: 'Ruse', X: 'Not Dead Yet' } },
  gumshoe: { name: 'Cypher', ab: { C: 'Trapwire', Q: 'Cyber Cage', E: 'Spycam', X: 'Neural Theft' } },
  cable: { name: 'Deadlock', ab: { C: 'Barrier Mesh', Q: 'Sonic Sensor', E: 'GravNet', X: 'Annihilation' } },
  bountyhunter: { name: 'Fade', ab: { C: 'Prowler', Q: 'Seize', E: 'Haunt', X: 'Nightfall' } },
  aggrobot: { name: 'Gekko', ab: { C: 'Mosh Pit', Q: 'Wingman', E: 'Dizzy', X: 'Thrash' } },
  mage: { name: 'Harbor', ab: { C: 'Storm Surge', Q: 'High Tide', E: 'Cove', X: 'Reckoning' } },
  sequoia: { name: 'Iso', ab: { C: 'Contingency', Q: 'Undercut', E: 'Double Tap', X: 'Kill Contract' } },
  wushu: { name: 'Jett', ab: { C: 'Cloudburst', Q: 'Updraft', E: 'Tailwind', X: 'Blade Storm' } },
  grenadier: { name: 'KAY/O', ab: { C: 'FRAG/ment', Q: 'FLASH/drive', E: 'ZERO/point', X: 'NULL/cmd' } },
  killjoy: { name: 'Killjoy', ab: { C: 'Nanoswarm', Q: 'ALARMBOT', E: 'TURRET', X: 'Lockdown' } },
  iris: { name: 'Miks', ab: { C: 'M-pulse', Q: 'Harmonize', E: 'Waveform', X: 'Bassquake' } },
  sprinter: { name: 'Neon', ab: { C: 'Fast Lane', Q: 'Relay Bolt', E: 'High Gear', X: 'Overdrive' } },
  wraith: { name: 'Omen', ab: { C: 'Shrouded Step', Q: 'Paranoia', E: 'Dark Cover', X: 'From the Shadows' } },
  phoenix: { name: 'Phoenix', ab: { C: 'Blaze', Q: 'Hot Hands', E: 'Curveball', X: 'Run it Back' } },
  clay: { name: 'Raze', ab: { C: 'Boom Bot', Q: 'Blast Pack', E: 'Paint Shells', X: 'Showstopper' } },
  vampire: { name: 'Reyna', ab: { C: 'Leer', Q: 'Devour', E: 'Dismiss', X: 'Empress' } },
  thorne: { name: 'Sage', ab: { C: 'Barrier Orb', Q: 'Slow Orb', E: 'Healing Orb', X: 'Resurrection' } },
  guide: { name: 'Skye', ab: { C: 'Regrowth', Q: 'Trailblazer', E: 'Guiding Light', X: 'Seekers' } },
  hunter: { name: 'Sova', ab: { C: 'Owl Drone', Q: 'Shock Bolt', E: 'Recon Bolt', X: "Hunter's Fury" } },
  cashew: { name: 'Tejo', ab: { C: 'Stealth Drone', Q: 'Special Delivery', E: 'Guided Salvo', X: 'Armageddon' } },
  pine: { name: 'Veto', ab: { C: 'Crosscut', Q: 'Chokehold', E: 'Interceptor', X: 'Evolution' } },
  pandemic: { name: 'Viper', ab: { C: 'Snake Bite', Q: 'Poison Cloud', E: 'Toxic Screen', X: "Viper's Pit" } },
  nox: { name: 'Vyse', ab: { C: 'Razorvine', Q: 'Shear', E: 'Arc Rose', X: 'Steel Garden' } },
  terra: { name: 'Waylay', ab: { C: 'Saturate', Q: 'Lightspeed', E: 'Refract', X: 'Convergent Paths' } },
  stealth: { name: 'Yoru', ab: { C: 'FAKEOUT', Q: 'BLINDSIDE', E: 'GATECRASH', X: 'DIMENSIONAL DRIFT' } },
};

/* agentName — nombre visible del agente a partir del codename (o null si no lo conocemos). */
export function agentName(code: string | null): string | null {
  const a = AGENTS[String(code || '').toLowerCase()];
  return a ? a.name : null;
}

/* abilityName — nombre de la habilidad de una tecla para un codename (o null). */
export function abilityName(code: string | null, key: string): string | null {
  const a = AGENTS[String(code || '').toLowerCase()];
  return (a && a.ab[String(key || '').toUpperCase() as AbilityKey]) || null;
}

export { AGENTS };
