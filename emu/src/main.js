import './style.css';
import { parseHeader } from './cart.js';
import { log, renderCpu, formatOpcode } from './debug.js';
import { createEmu, reset, runTCycles, tickEmu, FRAME_T } from './emu.js';

let emu = createEmu(new Uint8Array());
reset(emu);
renderCpu(emu.cpu);

let running = false;

const input = document.querySelector('#rom');
const resetBtn = document.querySelector('#reset');
const playBtn = document.querySelector('#play');
const stepBtn = document.querySelector('#step');
const frameBtn = document.querySelector('#frame');
const debugUi = document.querySelector('#debug-ui');
const info = document.querySelector('#info');

function syncDebugUi() {
  document.body.classList.toggle('debug-ui', debugUi.checked);
}

syncDebugUi();
debugUi.addEventListener('change', syncDebugUi);

function setRunning(on) {
  running = on;
  playBtn.textContent = on ? 'Pause' : 'Play';
}

function loadRom(rom) {
  setRunning(false);
  emu = createEmu(rom);
  reset(emu);
  renderCpu(emu.cpu);
}

function advanceOneFrame({ logFrame = false } = {}) {
  const { cpu } = emu;
  const pcBefore = cpu.pc;
  const t = runTCycles(emu, FRAME_T);
  blit(emu.ppu.framebuffer);
  info.textContent = '';
  renderCpu(cpu);
  if (logFrame) {
    const haltNote = cpu.halted ? ' (HALT spin)' : '';
    log(
      `Frame ${t}T${haltNote}  PC $${pcBefore.toString(16).padStart(4, '0').toUpperCase()} → $${cpu.pc.toString(16).padStart(4, '0').toUpperCase()}`,
    );
  }
}

function hostTick() {
  if (running) {
    try {
      advanceOneFrame();
    } catch (err) {
      setRunning(false);
      info.textContent = err.message;
      log(err.message);
      renderCpu(emu.cpu);
    }
  }
  requestAnimationFrame(hostTick);
}

requestAnimationFrame(hostTick);

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

resetBtn.addEventListener('click', () => {
  try {
    setRunning(false);
    reset(emu);
    blit(emu.ppu.framebuffer);
    info.textContent = '';
    renderCpu(emu.cpu);
    log('Reset (skip-boot)');
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

playBtn.addEventListener('click', () => {
  setRunning(!running);
});

stepBtn.addEventListener('click', () => {
  setRunning(false);
  const { cpu } = emu;
  try {
    const wasHalted = cpu.halted;
    const opcode = wasHalted ? null : cpu.bus.read8(cpu.pc);
    const cb = opcode === 0xcb ? cpu.bus.read8((cpu.pc + 1) & 0xffff) : null;
    const t = tickEmu(emu);
    info.textContent = '';
    renderCpu(cpu);
    if (wasHalted) {
      log(`HALT  ${t}T`);
    } else {
      log(`${formatOpcode(opcode, cb)}  ${t}T`);
    }
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(cpu);
  }
});

frameBtn.addEventListener('click', () => {
  setRunning(false);
  try {
    advanceOneFrame({ logFrame: true });
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(emu.cpu);
  }
});

function blit(fb) {
  const canvas = document.querySelector('#screen');
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(fb, 160, 144), 0, 0);
}

function mapKey(code, down) {
  const j = emu.io.joypad;
  switch (code) {
    case 'ArrowDown':
    case 'KeyS':
      j.down = down;
      return true;
    case 'ArrowUp':
    case 'KeyW':
      j.up = down;
      return true;
    case 'ArrowLeft':
    case 'KeyA':
      j.left = down;
      return true;
    case 'ArrowRight':
    case 'KeyD':
      j.right = down;
      return true;
    case 'KeyZ':
    case 'KeyJ':
      j.a = down;
      return true;
    case 'KeyX':
    case 'KeyK':
      j.b = down;
      return true;
    case 'Enter':
      j.start = down;
      return true;
    case 'ShiftLeft':
    case 'ShiftRight':
    case 'Backspace':
      j.select = down;
      return true;
    default:
      return false;
  }
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (mapKey(e.code, true)) e.preventDefault();
});
window.addEventListener('keyup', (e) => mapKey(e.code, false));

if (import.meta.env.DEV) {
  window.emu = () => emu;
  window.runFrame = () => advanceOneFrame({ logFrame: true });
}
