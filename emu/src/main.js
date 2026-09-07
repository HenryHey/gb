import './style.css';
import { extractRomsFrom7z } from './archive7z.js';
import { loadSram, parseHeader, saveSram } from './cart.js';
import { log, renderCpu, renderVram, formatOpcode } from './debug.js';
import { createEmu, reset, runFrame, tickEmu } from './emu.js';
import { getSavedStateRaw, loadStateSlot, saveStateSlot, savedStateToJson } from './savestate.js';

let emu = createEmu(new Uint8Array());
reset(emu);
renderCpu(emu.cpu);

let running = false;
let clockOrigin = 0;
let framesDone = 0;
let pauseStarted = 0;
let pausedTotal = 0;
const FRAME_MS = 1000 / 59.7275;
const MAX_CATCHUP = 5;

const input = document.querySelector('#rom');
const romChoiceLabel = document.querySelector('#rom-choice-label');
const romChoice = document.querySelector('#rom-choice');
const resetBtn = document.querySelector('#reset');
const playBtn = document.querySelector('#play');
const stepBtn = document.querySelector('#step');
const loadSramBtn = document.querySelector('#load-sram');
const saveSramBtn = document.querySelector('#save-sram');
const frameBtn = document.querySelector('#frame');
const copySaveStateBtn = document.querySelector('#copy-save-state');
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
const MAX_PLAY_SCALE = 4;
const VIEWPORT_PAD = 16;
const CHROME_H = 96;

function shellSize(scale) {
  const canvasH = SCREEN_H * scale;
  const shellH = canvasH / LCD_HEIGHT;
  const shellW = (shellH * SHELL_W) / SHELL_H;
  return { canvasH, shellH, shellW };
}

function playScale(availW, availH) {
  for (let scale = MAX_PLAY_SCALE; scale >= 1; scale--) {
    const { canvasH, shellH, shellW } = shellSize(scale);
    const canvasTop = shellH * LCD_TOP;
    if (shellW <= availW && canvasTop + canvasH <= availH) return scale;
  }
  return 1;
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
  const { canvasH, shellH, shellW } = shellSize(scale);

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
  updateCopySaveStateBtn();
}

function updateCopySaveStateBtn() {
  if (!copySaveStateBtn) return;
  const hasSlot = debugUi.checked && emu.rom.length >= 0x150 && getSavedStateRaw(emu.rom) !== null;
  copySaveStateBtn.disabled = !hasSlot;
}

syncDebugUi();
debugUi.addEventListener('change', syncDebugUi);
window.addEventListener('resize', layoutDisplay);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && running) setRunning(false);
});

function resetClock(_now = performance.now()) {
  clockOrigin = 0;
  framesDone = 0;
  pauseStarted = 0;
  pausedTotal = 0;
}

function setRunning(on) {
  const now = performance.now();
  if (on && !running) {
    if (clockOrigin === 0) clockOrigin = now;
    if (pauseStarted) {
      pausedTotal += now - pauseStarted;
      pauseStarted = 0;
    }
  } else if (!on && running) {
    pauseStarted = now;
  }
  running = on;
  playBtn.textContent = on ? 'Pause' : 'Play';
}

/** @type {Array<{ path: string, name: string, data: Uint8Array }>} */
let archiveRoms = [];
/** @type {string | null} */
let currentRomFileName = null;
/** @type {string | null} */
let currentArchiveFileName = null;

function setRomChoiceVisible(visible) {
  romChoiceLabel.hidden = !visible;
  romChoice.hidden = !visible;
}

function clearRomChoice() {
  archiveRoms = [];
  currentRomFileName = null;
  currentArchiveFileName = null;
  romChoice.replaceChildren();
  setRomChoiceVisible(false);
}

function setRomSource({ romFileName, archiveFileName = null }) {
  currentRomFileName = romFileName;
  currentArchiveFileName = archiveFileName;
}

function populateRomChoice(roms) {
  archiveRoms = roms;
  romChoice.replaceChildren(
    ...roms.map((entry, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = roms.length > 1 && entry.path !== entry.name ? entry.path : entry.name;
      return opt;
    }),
  );
  setRomChoiceVisible(roms.length > 1);
}

function loadRomBytes(rom, { logHeader = true } = {}) {
  if (rom.length === 0) throw new Error('ROM file is empty');

  const header = parseHeader(rom);
  info.textContent = '';
  loadRom(rom);
  if (logHeader) log(header);
  return header;
}

function loadRom(rom) {
  setRunning(false);
  emu = createEmu(rom);
  reset(emu);
  resetClock();
  renderCpu(emu.cpu);
  updateCopySaveStateBtn();
}

function advanceOneFrame({ logFrame = false, blitFrame = true } = {}) {
  const { cpu } = emu;
  const pcBefore = cpu.pc;
  const t = runFrame(emu);
  framesDone++;
  if (blitFrame) blit(emu.ppu.framebuffer);
  info.textContent = '';
  if (logFrame) {
    const haltNote = cpu.halted ? ' (HALT spin)' : '';
    log(
      `Frame ${t}T${haltNote}  PC $${pcBefore.toString(16).padStart(4, '0').toUpperCase()} → $${cpu.pc.toString(16).padStart(4, '0').toUpperCase()}`,
    );
  }
}

function hostTick(now) {
  try {
    if (running && clockOrigin !== 0) {
      const pausedNow = pauseStarted ? now - pauseStarted : 0;
      const elapsed = now - clockOrigin - pausedTotal - pausedNow;
      const target = Math.floor(elapsed / FRAME_MS);
      let catchup = 0;
      while (framesDone < target && catchup < MAX_CATCHUP) {
        runFrame(emu);
        framesDone++;
        catchup++;
      }
    }
  } catch (err) {
    setRunning(false);
    info.textContent = err.message;
    log(err.message);
    renderCpu(emu.cpu);
  }

  if (running) blit(emu.ppu.framebuffer);
  requestAnimationFrame(hostTick);
}

requestAnimationFrame(hostTick);

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;

  try {
    clearRomChoice();
    const buf = await file.arrayBuffer();

    if (file.name.toLowerCase().endsWith('.7z')) {
      info.textContent = 'Extracting archive…';
      const roms = await extractRomsFrom7z(buf);
      populateRomChoice(roms);
      setRomSource({ romFileName: roms[0].name, archiveFileName: file.name });
      loadRomBytes(roms[0].data);
      return;
    }

    setRomSource({ romFileName: file.name });
    loadRomBytes(new Uint8Array(buf));
  } catch (err) {
    clearRomChoice();
    info.textContent = err.message;
    log(err.message);
  }
});

romChoice.addEventListener('change', () => {
  const entry = archiveRoms[Number(romChoice.value)];
  if (!entry) return;

  try {
    currentRomFileName = entry.name;
    loadRomBytes(entry.data);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

resetBtn.addEventListener('click', () => {
  try {
    setRunning(false);
    reset(emu);
    resetClock();
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

loadSramBtn.addEventListener('click', () => {
  try {
    const header = parseHeader(emu.rom);
    if (!emu.cart.ram?.length) {
      info.textContent = 'No battery SRAM on this cart';
      log('Load SRAM: no SRAM');
      return;
    }
    if (loadSram(emu.cart, header)) {
      info.textContent = '';
      log(`Loaded SRAM (${emu.cart.ram.length} bytes) — ${header.title}`);
    } else {
      info.textContent = 'No saved SRAM for this ROM';
      log(`Load SRAM: nothing saved for ${header.title}`);
    }
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

saveSramBtn.addEventListener('click', () => {
  try {
    const header = parseHeader(emu.rom);
    if (!emu.cart.ram?.length) {
      info.textContent = 'No battery SRAM on this cart';
      log('Save SRAM: no SRAM');
      return;
    }
    saveSram(emu.cart, header);
    info.textContent = '';
    log(`Saved SRAM (${emu.cart.ram.length} bytes) — ${header.title}`);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
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

copySaveStateBtn.addEventListener('click', async () => {
  try {
    const payload = savedStateToJson(emu.rom, {
      romFileName: currentRomFileName ?? undefined,
      archiveFileName: currentArchiveFileName ?? undefined,
    });
    if (!payload) {
      info.textContent = 'No saved state for this ROM';
      log('Copy save state: nothing saved');
      updateCopySaveStateBtn();
      return;
    }
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    info.textContent = '';
    log(`Copied save state to clipboard (${payload.title})`);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

function saveState() {
  if (emu.rom.length < 0x150) {
    info.textContent = 'Load a ROM before saving state';
    log('Save state: no ROM');
    return;
  }
  try {
    setRunning(false);
    saveStateSlot(emu);
    const header = parseHeader(emu.rom);
    info.textContent = '';
    log(`Saved state — ${header.title}`);
    setRunning(true);
    updateCopySaveStateBtn();
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
}

function loadState() {
  if (emu.rom.length < 0x150) {
    info.textContent = 'Load a ROM before loading state';
    log('Load state: no ROM');
    return;
  }
  try {
    setRunning(false);
    const loaded = loadStateSlot(emu.rom);
    if (!loaded) {
      info.textContent = 'No saved state for this ROM';
      log(`Load state: nothing saved for ${parseHeader(emu.rom).title}`);
      return;
    }
    emu = loaded;
    resetClock();
    blit(emu.ppu.framebuffer);
    info.textContent = '';
    renderCpu(emu.cpu);
    log(`Loaded state — ${parseHeader(emu.rom).title}`);
    setRunning(true);
    updateCopySaveStateBtn();
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(emu.cpu);
  }
}

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
  if (e.code === 'Digit1') {
    e.preventDefault();
    saveState();
    return;
  }
  if (e.code === 'Digit0') {
    e.preventDefault();
    loadState();
    return;
  }
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
