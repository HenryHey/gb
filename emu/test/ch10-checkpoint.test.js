import { describe, expect, test } from 'bun:test';
import { createIo } from '../src/io.js';
import { createPpu, ppuStep } from '../src/ppu.js';
import { createEmu, reset, runTCycles } from '../src/emu.js';

const GREEN = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];

/** 252 T = mode 2 (80) + mode 3 (172); first scanline render, LY still 0. */
const FIRST_SCANLINE_T = 252;
/** Two scanlines through first window-map row 0 then row 1. */
const SECOND_SCANLINE_T = FIRST_SCANLINE_T + 456;

function rgb(greenIdx) {
  const c = GREEN[greenIdx];
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255];
}

function fbPixel(fb, x, y) {
  const i = (y * 160 + x) * 4;
  return [fb[i], fb[i + 1], fb[i + 2], fb[i + 3]];
}

function shadeIndex(bgp, colorIndex) {
  return (bgp >> (colorIndex * 2)) & 3;
}

function expectPixel(fb, x, y, colorIndex, bgp = 0xfc) {
  expect(fbPixel(fb, x, y)).toEqual(rgb(shadeIndex(bgp, colorIndex)));
}

function stepPpu(ppu, io, t, vram) {
  ppuStep(ppu, io, t, vram);
}

/** LCD on, BG+window, unsigned tiles $8000, BG map $9800, window map $9C00. */
function windowLcdc() {
  return 0x80 | 0x01 | 0x20 | 0x10 | 0x40;
}

function nopRom() {
  return new Uint8Array(0x8000);
}

function expectWhiteFramebuffer(fb) {
  expect([...fb].every((b) => b === 255)).toBe(true);
}

describe('chapter 10 checkpoint', () => {
  test('BGP $FC remaps VRAM index 1 to darkest shade', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = 0x91;
    ppu.bgp = 0xfc;
    vram[0x9800 - 0x8000] = 0x00;
    vram[0x8000 - 0x8000] = 0xff; // color index 1 at x=0
    vram[0x8000 - 0x8000 + 1] = 0x00;

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    expectPixel(ppu.framebuffer, 0, 0, 1, 0xfc);
  });

  test('signed addressing: tile id $00 reads tile data at $9000', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = 0x81; // LCD on, BG on, signed tiles, map $9800
    ppu.bgp = 0xe4; // identity remap so index 1 stays shade 1
    ppu.scx = 0;
    ppu.scy = 0;

    vram[0x9800 - 0x8000] = 0x00; // tile id 0 → $9000
    vram[0x9000 - 0x8000] = 0xff; // row 0 lo → color index 1 at x=0
    vram[0x9000 - 0x8000 + 1] = 0x00;
    vram[0x8800 - 0x8000] = 0x00; // wrong base would give color index 2
    vram[0x8800 - 0x8000 + 1] = 0xff;

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    expectPixel(ppu.framebuffer, 0, 0, 1, 0xe4);
  });

  test('window overlays BG from (WX-7, WY)', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = windowLcdc();
    ppu.wy = 0;
    ppu.wx = 87; // window starts at screen x = 80

    vram[0x9800 - 0x8000] = 0x00; // BG tile 0 → index 0
    vram[0x9c00 - 0x8000] = 0x01; // window tile 1 → index 3
    vram[0x8000 - 0x8000] = 0x00;
    vram[0x8000 - 0x8000 + 1] = 0x00;
    vram[0x8010 - 0x8000] = 0xff;
    vram[0x8010 - 0x8000 + 1] = 0xff;

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    expectPixel(ppu.framebuffer, 0, 0, 0); // BG only
    expectPixel(ppu.framebuffer, 80, 0, 3); // window only
  });

  test('window ignores SCX', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = windowLcdc();
    ppu.wy = 0;
    ppu.wx = 7;
    ppu.scx = 1;

    // BG tile 1 row 0 → 0 3 3 …; SCX=1 would show index 3 at x=0 without window
    vram[0x9800 - 0x8000] = 0x01;
    vram[0x8010 - 0x8000] = 0x7c;
    vram[0x8010 - 0x8000 + 1] = 0x7c;
    // Window map uses tile 0 → solid index 0
    vram[0x9c00 - 0x8000] = 0x00;
    vram[0x8000 - 0x8000] = 0x00;
    vram[0x8000 - 0x8000 + 1] = 0x00;

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    expectPixel(ppu.framebuffer, 0, 0, 0);
  });

  test('windowLine advances only on lines that draw window pixels', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = windowLcdc();
    ppu.wy = 0;
    ppu.wx = 7;

    vram[0x9c00 - 0x8000] = 0x01;
    vram[0x8010 - 0x8000] = 0x00; // window row 0 → index 0
    vram[0x8010 - 0x8000 + 1] = 0x00;
    vram[0x8012 - 0x8000] = 0xff; // window row 1 → index 3
    vram[0x8012 - 0x8000 + 1] = 0xff;

    stepPpu(ppu, io, SECOND_SCANLINE_T, vram);

    expect(ppu.windowLine).toBe(2);
    expectPixel(ppu.framebuffer, 0, 0, 0);
    expectPixel(ppu.framebuffer, 0, 1, 3);
  });

  test('LCD off clears framebuffer to white', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    expectWhiteFramebuffer(emu.ppu.framebuffer);

    emu.ppu.lcdc = 0x91;
    emu.bus.vram[0x9800 - 0x8000] = 0x00;
    emu.bus.vram[0x8000 - 0x8000] = 0xff;
    emu.bus.vram[0x8000 - 0x8000 + 1] = 0xff;

    runTCycles(emu, FIRST_SCANLINE_T);
    expect(emu.ppu.framebuffer[0]).not.toBe(255);

    emu.bus.write8(0xff40, 0x11); // LCD off
    expectWhiteFramebuffer(emu.ppu.framebuffer);
    expect(emu.ppu.ly).toBe(0);

    runTCycles(emu, FIRST_SCANLINE_T);
    expectWhiteFramebuffer(emu.ppu.framebuffer);
  });
});
