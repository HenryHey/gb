import './style.css';
import { parseHeader } from './cart.js';
import { log, renderCpu, renderVram, formatOpcode } from './debug.js';
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
const displayWrap = document.querySelector('.display-wrap');
const screenCanvas = document.querySelector('#screen');
const screenCtx = screenCanvas.getContext('2d');
const screenImageData = screenCtx.createImageData(160, 144);

const SCREEN_W = 160;
const SCREEN_H = 144;
const SHELL_W = 623;
const SHELL_H = 1024;
const LCD_TOP = 0.13;
const LCD_HEIGHT = 0.308;
const LCD_WIDTH = (LCD_HEIGHT * SCREEN_W) / SCREEN_H / (SHELL_W / SHELL_H);
const MAX_PLAY_SCALE = 3;
const VIEWPORT_PAD = 32;
const CHROME_H = 140;

function playScale(availW, availH) {
  const shellH = Math.min(availH, (availW * SHELL_H) / SHELL_W);
  const shellW = (shellH * SHELL_W) / SHELL_H;
  const lcdH = shellH * LCD_HEIGHT;
  const lcdW = shellW * LCD_WIDTH;
  const scale = Math.min(
    MAX_PLAY_SCALE,
    Math.floor(lcdH / SCREEN_H),
    Math.floor(lcdW / SCREEN_W),
  );
  return Math.max(1, scale);
}

function clearPlayLayout() {
  displayWrap.style.width = '';
  displayWrap.style.height = '';
  screenCanvas.style.width = '';
  screenCanvas.style.height = '';
  screenCanvas.style.left = '';
  screenCanvas.style.top = '';
}

function layoutDisplay() {
  if (debugUi.checked) {
    clearPlayLayout();
    return;
  }

  const availW = window.innerWidth - VIEWPORT_PAD;
  const availH = window.innerHeight - CHROME_H;
  const scale = playScale(availW, availH);
  const canvasW = SCREEN_W * scale;
  const canvasH = SCREEN_H * scale;
  const shellH = canvasH / LCD_HEIGHT;
  const shellW = (shellH * SHELL_W) / SHELL_H;

  displayWrap.style.width = `${shellW}px`;
  displayWrap.style.height = `${shellH}px`;
  screenCanvas.style.width = `${canvasW}px`;
  screenCanvas.style.height = `${canvasH}px`;
  screenCanvas.style.left = `${(shellW - canvasW) / 2}px`;
  screenCanvas.style.top = `${shellH * LCD_TOP}px`;
}

function syncDebugUi() {
  document.body.classList.toggle('debug-ui', debugUi.checked);
  layoutDisplay();
}

syncDebugUi();
debugUi.addEventListener('change', syncDebugUi);
window.addEventListener('resize', layoutDisplay);

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
  const wasRunning = running;
  setRunning(!running);
  if (wasRunning) renderCpu(emu.cpu);
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
    renderCpu(emu.cpu);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(emu.cpu);
  }
});

function blit(fb) {
  screenImageData.data.set(fb);
  screenCtx.putImageData(screenImageData, 0, 0);
  if (debugUi.checked) renderVram(emu.cpu);
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
  window.runFrame = () => {
    advanceOneFrame({ logFrame: true });
    renderCpu(emu.cpu);
  };
}
