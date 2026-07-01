// Overlay in-game: recibe feedback del background (overwolf.windows messaging) y lo muestra.

interface Feedback { prio: number; msg: string; key?: string; }

let maxItems = 3; // cantidad de tipos de feedback a mostrar a la vez (configurable)

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
  el.className = type; // flojo | perfecto | pasado
  el.classList.add('show');
  el.textContent = 'Flick ' + type;
  flickClearTimer = setTimeout(() => el.classList.remove('show'), 1500);
}

function setScale(scale: number): void {
  const s = Math.max(0.6, Math.min(3, scale || 1));
  document.documentElement.style.setProperty('--scale', String(s));
}

function setOpacity(opacity: number): void {
  const o = Math.max(0.3, Math.min(1, opacity || 1));
  const wrap = document.getElementById('wrap');
  if (wrap) wrap.style.opacity = String(o);
}

overwolf.windows.onMessageReceived.addListener((message: any) => {
  if (message.id === 'feedback' && message.content) show(message.content as Feedback);
  else if (message.id === 'cal' && message.content) showCal(message.content.text, !!message.content.done);
  else if (message.id === 'flick' && message.content) showFlick(message.content.type);
  else if (message.id === 'overlay-cfg' && message.content) {
    setScale(message.content.scale);
    if (typeof message.content.maxItems === 'number') maxItems = Math.max(1, message.content.maxItems);
    if (typeof message.content.opacity === 'number') setOpacity(message.content.opacity);
  }
  // reset de contexto (Range<->partida): limpia lista y contadores para arrancar de cero.
  else if (message.id === 'reset') {
    counts = {};
    const list = document.getElementById('items');
    if (list) list.innerHTML = '';
  }
});

// Self-test: confirma que el overlay renderiza dentro del juego.
setTimeout(() => show({ prio: 50, msg: 'Aim Coach: overlay activo in-game.' }), 1200);

export {};
