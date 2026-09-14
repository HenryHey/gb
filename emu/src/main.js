import './style.css';
import { log, renderCpu, formatOpcode } from './debug.js';
import { createEmu, reset, tickEmu } from './emu.js';
import { createClock } from './host/clock.js';
import { createDebugUi } from './host/debug-ui.js';
import { createDisplay } from './host/display.js';
import { bindInput } from './host/input.js';
import { createPersistence } from './host/persistence.js';
import { createRomLoader } from './host/rom.js';

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

let emu = createEmu(new Uint8Array());
const getEmu = () => emu;
const setEmu = (next) => {
  emu = next;
};

reset(emu);
renderCpu(emu.cpu);

const display = createDisplay({ displayWrap, screenCanvas, debugUi, getEmu });

/** @type {ReturnType<typeof createRomLoader> | null} */
let rom = null;

function syncRomUi() {
  document.body.classList.toggle('rom-loaded', rom?.hasRomLoaded() ?? false);
  display.layoutDisplay();
}

const debugUiHost = createDebugUi({
  debugUi,
  copySaveStateBtn,
  getEmu,
  getRomSource: () => rom?.getRomSource() ?? { romFileName: null, archiveFileName: null },
  syncRomUi,
});

const clock = createClock({
  getEmu,
  presentFrame: display.presentFrame,
  playBtn,
  info,
});

const persistence = createPersistence({
  getEmu,
  setEmu,
  setRunning: clock.setRunning,
  resetClock: clock.resetClock,
  presentFrame: display.presentFrame,
  updateCopySaveStateBtn: debugUiHost.updateCopySaveStateBtn,
  info,
});

rom = createRomLoader({
  input,
  romChoiceLabel,
  romChoice,
  info,
  getEmu,
  setEmu,
  setRunning: clock.setRunning,
  flushSramSave: persistence.flushSramSave,
  resetClock: clock.resetClock,
  scheduleSramSave: persistence.scheduleSramSave,
  setSramPersistHeader: persistence.setSramPersistHeader,
  syncRomUi,
  updateCopySaveStateBtn: debugUiHost.updateCopySaveStateBtn,
});

debugUiHost.syncDebugUi();
debugUi.addEventListener('change', debugUiHost.syncDebugUi);
window.addEventListener('resize', display.layoutDisplay);
window.addEventListener('pagehide', () => {
  persistence.flushSramSave();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && clock.isRunning()) clock.setRunning(false);
});

clock.start();
rom.bindFilePicker();
persistence.bindSramButtons(loadSramBtn, saveSramBtn);
debugUiHost.bindCopySaveStateBtn(info);
bindInput({ getEmu, saveState: persistence.saveState, loadState: persistence.loadState });

resetBtn.addEventListener('click', () => {
  try {
    clock.setRunning(false);
    reset(getEmu());
    clock.resetClock();
    display.presentFrame({ force: true });
    info.textContent = '';
    renderCpu(getEmu().cpu);
    log('Reset (skip-boot)');
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
  }
});

playBtn.addEventListener('click', () => {
  const wasRunning = clock.isRunning();
  clock.setRunning(!wasRunning);
  if (wasRunning) renderCpu(getEmu().cpu);
});

stepBtn.addEventListener('click', () => {
  clock.setRunning(false);
  const cpu = getEmu().cpu;
  try {
    const wasHalted = cpu.halted;
    const opcode = wasHalted ? null : cpu.bus.read8(cpu.pc);
    const cb = opcode === 0xcb ? cpu.bus.read8((cpu.pc + 1) & 0xffff) : null;
    const t = tickEmu(getEmu());
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
  clock.setRunning(false);
  try {
    clock.advanceOneFrame({ logFrame: true });
    renderCpu(getEmu().cpu);
  } catch (err) {
    info.textContent = err.message;
    log(err.message);
    renderCpu(getEmu().cpu);
  }
});

if (import.meta.env.DEV) {
  window.emu = () => getEmu();
  window.runFrame = () => {
    clock.advanceOneFrame({ logFrame: true });
    renderCpu(getEmu().cpu);
  };
}
