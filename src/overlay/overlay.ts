// Overlay in-game: recibe feedback del background (overwolf.windows messaging) y lo muestra.

import { T, Lang } from '../engine/messages';

interface Feedback { prio: number; msg: string; key?: string; }

let maxItems = 3; // cantidad de tipos de feedback a mostrar a la vez (configurable)
let lang: Lang = 'es'; // idioma de los textos propios del overlay (flick/self-test); lo manda el background (overlay-cfg)

// Atajo para traducir los textos que arma el propio overlay (dict compartido en messages.ts).
function t(key: string, params?: { [k: string]: string | number }): string { return T(key, lang, params); }

// Cuántas veces salió cada tipo (para el contador ×N). Se resetea al cambiar de contexto
// (Range<->partida) para que el conteo sea por sesión de práctica/partida, no de por vida.
let counts: { [key: string]: number } = {};

// Severidad visual según prioridad (triaje de un vistazo, misma prio que ya manda el motor):
//  crit (>=95, ej macro/ban, cambio de sens) = rojo · good (<=30, refuerzos) = verde · resto = neutro.
function severity(prio: number): string {
  if (prio >= 95) return ' crit';
  if (prio <= 30) return ' good';
  return '';
}

// Dashboard de estado: UNA fila por TIPO (key). Un mensaje nuevo del mismo tipo ACTUALIZA su fila
// en el lugar (y la sube arriba con un flash), no apila otra. Muestra ×N = veces que pasó ese tipo.
function show(f: Feedback): void {
  const list = document.getElementById('items');
  if (!list) return;
  const key = f.key || f.msg;
  counts[key] = (counts[key] || 0) + 1;
  const cls = 'fb' + severity(f.prio);
  let el = list.querySelector<HTMLDivElement>(`[data-key="${CSS.escape(key)}"]`);
  if (!el) {
    el = document.createElement('div');
    el.dataset.key = key;
  }
  el.className = cls;
  el.textContent = f.msg;
  if (counts[key] > 1) {
    const badge = document.createElement('span');
    badge.className = 'badge';
    badge.textContent = '×' + counts[key];
    el.appendChild(badge);
  }
  list.insertBefore(el, list.firstChild); // mover/insertar arriba (el más reciente primero)
  // flash breve para señalar que se actualizó
  el.classList.remove('flash');
  void el.offsetWidth; // reinicia la animación
  el.classList.add('flash');
  while (list.children.length > maxItems) list.removeChild(list.lastChild as Node);
}

let calClearTimer: any = null;
function showCal(text: string, done: boolean): void {
  const el = document.getElementById('cal');
  if (!el) return;
  if (calClearTimer) { clearTimeout(calClearTimer); calClearTimer = null; }
  if (!text) { el.classList.remove('show'); return; }
  el.textContent = text;
  el.classList.add('show');
  if (done) calClearTimer = setTimeout(() => el.classList.remove('show'), 4000);
}

let flickClearTimer: any = null;
function showFlick(type: string): void {
  const el = document.getElementById('flick');
  if (!el) return;
  if (flickClearTimer) { clearTimeout(flickClearTimer); flickClearTimer = null; }
  el.className = type; // flojo | perfecto | pasado | lento (el tipo crudo es la clase CSS, no se traduce)
  el.classList.add('show');
  el.textContent = t('flick.label', { type: t('flick.type.' + type) });
  flickClearTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

function setScale(scale: number): void {
  const s = Math.max(0.6, Math.min(3, scale || 1));
  document.documentElement.style.setProperty('--scale', String(s));
}

// Mini-traza de recoil in-game: tu recorrido (rojo) vs el patrón (verde) + score, unos segundos tras el spray.
let recoilClearTimer: any = null;
function showRecoil(tr: any): void {
  const box = document.getElementById('recoil');
  const canvas = box && box.querySelector('canvas');
  const ctx = canvas && canvas.getContext('2d');
  if (!box || !canvas || !ctx) return;
  const W = canvas.width, H = canvas.height, pad = 8, det = tr.deterministic || 7;
  const ref = tr.ref || [], curve = tr.curve || [], all = ref.concat(curve);
  if (!all.length) return;
  let maxV = 1, maxH = 0.001;
  for (const p of all) { maxV = Math.max(maxV, p.v); maxH = Math.max(maxH, Math.abs(p.h)); }
  const cx = W / 2, sV = (H - 2 * pad) / maxV, sH = (W / 2 - pad) / maxH;
  const mx = (h: number) => cx + h * sH, my = (v: number) => H - pad - v * sV; // v hacia arriba
  ctx.clearRect(0, 0, W, H);
  const path = (pts: any[], color: string) => {
    ctx.strokeStyle = color; ctx.lineWidth = 1.5;
    ctx.globalAlpha = 1; ctx.beginPath();
    pts.slice(0, det).forEach((p: any, i: number) => { const x = mx(p.h), y = my(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    if (pts.length > det) {
      ctx.globalAlpha = 0.3; ctx.beginPath();
      pts.slice(det - 1).forEach((p: any, i: number) => { const x = mx(p.h), y = my(p.v); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  path(ref, '#2ed3b7');
  path(curve, '#ff4655');
  const label = box.querySelector('.rlabel') as HTMLElement | null;
  if (label) label.textContent = t('recoil.label', { score: tr.score, weapon: tr.weapon || '' });
  box.classList.add('show');
  if (recoilClearTimer) clearTimeout(recoilClearTimer);
  recoilClearTimer = setTimeout(() => box.classList.remove('show'), 4000);
}

function setOpacity(opacity: number): void {
  const o = Math.max(0.3, Math.min(1, opacity || 1));
  const wrap = document.getElementById('wrap');
  if (wrap) wrap.style.opacity = String(o);
}

// Posición (left%/top% de la ventana) y tamaño de la mini-traza de recoil (ajustable desde la config).
function setRecoilLayout(left?: number, top?: number, scale?: number): void {
  const root = document.documentElement.style;
  if (typeof left === 'number') root.setProperty('--recoil-left', Math.max(0, Math.min(90, left)) + '%');
  if (typeof top === 'number') root.setProperty('--recoil-top', Math.max(0, Math.min(100, top)) + '%');
  if (typeof scale === 'number') root.setProperty('--recoil-scale', String(Math.max(0.5, Math.min(2.5, scale))));
}

overwolf.windows.onMessageReceived.addListener((message: any) => {
  if (message.id === 'feedback' && message.content) show(message.content as Feedback);
  else if (message.id === 'cal' && message.content) showCal(message.content.text, !!message.content.done);
  else if (message.id === 'flick' && message.content) showFlick(message.content.type);
  else if (message.id === 'recoil-trace' && message.content) showRecoil(message.content);
  else if (message.id === 'overlay-cfg' && message.content) {
    setScale(message.content.scale);
    if (typeof message.content.maxItems === 'number') maxItems = Math.max(1, message.content.maxItems);
    if (typeof message.content.opacity === 'number') setOpacity(message.content.opacity);
    if (typeof message.content.lang === 'string') lang = message.content.lang === 'en' ? 'en' : 'es';
    setRecoilLayout(message.content.recoilLeft, message.content.recoilTop, message.content.recoilScale);
  }
  // reset de contexto (Range<->partida): limpia lista y contadores para arrancar de cero.
  else if (message.id === 'reset') {
    counts = {};
    const list = document.getElementById('items');
    if (list) list.innerHTML = '';
  }
});

// Self-test: confirma que el overlay renderiza dentro del juego. Corre tras el overlay-cfg (que trae el
// idioma); si aún no llegó, cae al default ES.
setTimeout(() => show({ prio: 50, msg: t('overlay.selftest') }), 1200);

export {};
