import './style.css'
import { parseHeader } from './cart.js'
import { log } from './debug.js'

const input = document.querySelector('#rom');
const info = document.querySelector('#info');

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  try {
    const buf = await file.arrayBuffer();
    const rom = new Uint8Array(buf);
    if (rom.length === 0) throw new Error('ROM file is empty');

    const header = parseHeader(rom);
    log(header)
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});
