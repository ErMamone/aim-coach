// Overlay in-game: recibe feedback del background (overwolf.windows messaging) y lo muestra.

interface Feedback { prio: number; msg: string; }

let maxItems = 3; // cantidad de últimos errores a mostrar (configurable)

// Lista PERSISTENTE de los últimos N feedbacks (el más nuevo arriba; los viejos se descartan).
function show(f: Feedback): void {
  const list = document.getElementById('items');
  if (!list) return;
  const el = document.createElement('div');
  el.className = 'fb' + (f.prio <= 25 ? ' good' : '');
  el.textContent = f.msg;
  list.insertBefore(el, list.firstChild);
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

overwolf.windows.onMessageReceived.addListener((message: any) => {
  if (message.id === 'feedback' && message.content) show(message.content as Feedback);
  else if (message.id === 'cal' && message.content) showCal(message.content.text, !!message.content.done);
  else if (message.id === 'flick' && message.content) showFlick(message.content.type);
  else if (message.id === 'overlay-cfg' && message.content) {
    setScale(message.content.scale);
    if (typeof message.content.maxItems === 'number') maxItems = Math.max(1, message.content.maxItems);
  }
});

// Self-test: confirma que el overlay renderiza dentro del juego.
setTimeout(() => show({ prio: 50, msg: 'Aim Coach: overlay activo in-game.' }), 1200);

export {};
