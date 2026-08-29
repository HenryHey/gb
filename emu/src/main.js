import './style.css';
import { parseHeader } from './cart.js';
import { log, renderCpu, formatOpcode } from './debug.js';
import { createEmu, reset, runTCycles, FRAME_T } from './emu.js';
import { cbOps, ops, step } from './ops/index.js';

let emu = createEmu(new Uint8Array());
reset(emu);
renderCpu(emu.cpu);

const input = document.querySelector('#rom');
const bytesInput = document.querySelector('#bytes');
const loadBytes = document.querySelector('#load-bytes');
const resetBtn = document.querySelector('#reset');
const stepBtn = document.querySelector('#step');
const frameBtn = document.querySelector('#frame');
const info = document.querySelector('#info');

function loadRom(rom) {
  emu = createEmu(rom);
  reset(emu);
  renderCpu(emu.cpu);
}

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  try {
    const buf = await file.arrayBuffer();
    const rom = new Uint8Array(buf);
    if (rom.length === 0) throw new Error('ROM file is empty');

    const header = parseHeader(rom);
    info.textContent = '';
    loadRom(rom);
    log(header);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

loadBytes.addEventListener('click', () => {
  try {
    const rom = parseByteArray(bytesInput.value);
    info.textContent = '';
    loadRom(rom);
    log(`Loaded ${rom.length} byte${rom.length === 1 ? '' : 's'} (header skipped)`);
    log(formatBytes(rom));
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

bytesInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    loadBytes.click();
  }
});

resetBtn.addEventListener('click', () => {
  try {
    reset(emu);
    info.textContent = '';
    renderCpu(emu.cpu);
    log('Reset (skip-boot)');
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

stepBtn.addEventListener('click', () => {
  const { cpu } = emu;
  try {
    if (cpu.halted) {
      log('HALT');
      renderCpu(cpu);
      return;
    }
    const opcode = cpu.bus.read8(cpu.pc);
    const cb = opcode === 0xcb ? cpu.bus.read8((cpu.pc + 1) & 0xffff) : null;
    const t = step(cpu, ops, cbOps);
    info.textContent = '';
    renderCpu(cpu);
    log(`${formatOpcode(opcode, cb)}  ${t}T`);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(cpu);
  }
});

frameBtn.addEventListener('click', () => {
  const { cpu } = emu;
  const pcBefore = cpu.pc;
  try {
    const t = runTCycles(emu, FRAME_T);
    info.textContent = '';
    renderCpu(cpu);
    const haltNote = cpu.halted ? ' (HALT spin)' : '';
    log(
      `Frame ${t}T${haltNote}  PC $${pcBefore.toString(16).padStart(4, '0').toUpperCase()} → $${cpu.pc.toString(16).padStart(4, '0').toUpperCase()}`,
    );
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(cpu);
  }
});

/** Accept a JS array (`[0x3e, 0x01]`) or a hex dump (`3e 01 06`). */
function parseByteArray(text) {
  const src = text.trim();
  if (!src) throw new Error('No bytes entered');

  if (src.startsWith('[')) {
    const jsonish = src.replace(/0x([0-9a-fA-F]+)/gi, (_, h) => String(parseInt(h, 16)));
    let arr;
    try {
      arr = JSON.parse(jsonish);
    } catch {
      throw new Error('Invalid byte array');
    }
    if (!Array.isArray(arr) || arr.length === 0) {
      throw new Error('Byte array is empty');
    }
    if (!arr.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
      throw new Error('Byte array must contain integers 0–255');
    }
    return new Uint8Array(arr);
  }

  const tokens = src.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const bytes = tokens.map((tok) => {
    const hex = tok.replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{1,2}$/.test(hex)) {
      throw new Error(`Invalid byte: ${tok}`);
    }
    return parseInt(hex, 16);
  });
  if (!bytes.length) throw new Error('No bytes entered');
  return new Uint8Array(bytes);
}

function formatBytes(rom) {
  return '[' + [...rom].map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ') + ']';
}

export function frame(emu) {
  let budget = FRAME_T;
  while (budget > 0) {
    const t = cpuStep(emu);
    timerStep(emu.io, t);
    budget -= t;

  }

  blit(emu.ppu.framebuffer);

}

function blit(fb) {
  const canvas = document.querySelector('#screen');
  const ctx = canvas.getContext('2d');
  const img = new ImageData(fb, 160, 144);
  ctx.putImageData(img, 0, 0);
}