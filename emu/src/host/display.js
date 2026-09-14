import { renderVram } from '../debug.js';

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

export function createDisplay({ displayWrap, screenCanvas, debugUi, getEmu }) {
  const screenCtx = screenCanvas.getContext('2d');
  const screenImageData = screenCtx.createImageData(SCREEN_W, SCREEN_H);

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

  function blit(fb) {
    screenImageData.data.set(fb);
    screenCtx.putImageData(screenImageData, 0, 0);
    if (debugUi.checked) renderVram(getEmu().cpu);
  }

  /** Blit when a new frame is ready; clear `frameReady` after presenting. */
  function presentFrame({ force = false } = {}) {
    const { ppu } = getEmu();
    if (!force && !ppu.frameReady) return;
    blit(ppu.framebuffer);
    ppu.frameReady = false;
  }

  return { layoutDisplay, presentFrame };
}
