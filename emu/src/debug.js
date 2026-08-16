const el = document.querySelector('#debug');

export function log(...args) {
  const line = args.map(format).join(' ');
  el.textContent += (el.textContent ? '\n' : '') + line;
  el.scrollTop = el.scrollHeight;
}

export function clear() {
  el.textContent = '';
}

function format(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
