import { describe, expect, test } from 'bun:test';
import { createIo } from '../src/io.js';
import { createPpu, ppuStep } from '../src/ppu.js';

/** Hardcoded DMG greens until chapter 10 applies BGP. */
const GREEN = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];

/** 252 T = mode 2 (80) + mode 3 (172); first scanline render, LY still 0. */
const FIRST_SCANLINE_T = 252;

function rgb(greenIdx) {
  const c = GREEN[greenIdx];
  return [(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 255];
}

function fbPixel(fb, x, y) {
  const i = (y * 160 + x) * 4;
  return [fb[i], fb[i + 1], fb[i + 2], fb[i + 3]];
}

function expectPixel(fb, x, y, greenIdx) {
  expect(fbPixel(fb, x, y)).toEqual(rgb(greenIdx));
}

/** Plant the worked example from docs/reference/ppu.md into VRAM. */
function plantWorkedExample(vram) {
  // Map $9800 → tile id $01 at (0, 0)
  vram[0x9800 - 0x8000] = 0x01;
  // Tile $01 row 0 at $8010 → $7C $7C → pixels 0 3 3 3 3 3 0 0
  vram[0x8010 - 0x8000] = 0x7c;
  vram[0x8010 - 0x8000 + 1] = 0x7c;
}

function stepPpu(ppu, io, t, vram) {
  ppuStep(ppu, io, t, vram);
}

describe('chapter 9 checkpoint', () => {
  test('worked pixel row matches GREEN shades after 252 T', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = 0x91;
    ppu.scx = 0;
    ppu.scy = 0;
    plantWorkedExample(vram);

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    const expected = [0, 3, 3, 3, 3, 3, 0, 0];
    for (let x = 0; x < 8; x++) {
      expectPixel(ppu.framebuffer, x, 0, expected[x]);
    }
  });

  // Signed addressing + BGP-aware colors moved to ch10-checkpoint.test.js
  test.skip('signed addressing: tile id $00 reads tile data at $9000', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = 0x81; // LCD on, BG on, signed tiles, map $9800
    ppu.scx = 0;
    ppu.scy = 0;

    vram[0x9800 - 0x8000] = 0x00; // tile id 0 → $9000
    vram[0x9000 - 0x8000] = 0xff; // row 0 lo → color index 1 at x=0
    vram[0x9000 - 0x8000 + 1] = 0x00;
    vram[0x8800 - 0x8000] = 0x00; // wrong base would give color index 2
    vram[0x8800 - 0x8000 + 1] = 0xff;

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    expectPixel(ppu.framebuffer, 0, 0, 1);
  });

  test('fine scroll: SCX = 1 shifts the row one pixel left', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = 0x91;
    ppu.scx = 1;
    ppu.scy = 0;
    plantWorkedExample(vram);

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    // Unscrolled row starts 0 3 3 …; SCX=1 drops the leading 0
    expectPixel(ppu.framebuffer, 0, 0, 3);
    expectPixel(ppu.framebuffer, 1, 0, 3);
  });

  test('BG disabled: LCDC bit 0 clear fills the row with GREEN[0]', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    ppu.lcdc = 0x90; // LCD on, BG off
    plantWorkedExample(vram);

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    for (let x = 0; x < 160; x++) {
      expectPixel(ppu.framebuffer, x, 0, 0);
    }
  });

  test('after 252 T, LY is still 0 and pixels land in row 0', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);

    plantWorkedExample(vram);
    stepPpu(ppu, io, FIRST_SCANLINE_T, vram);

    expect(ppu.ly).toBe(0);
    expectPixel(ppu.framebuffer, 1, 0, 3);
    expect(fbPixel(ppu.framebuffer, 1, 1)).toEqual([0, 0, 0, 0]); // row 1 not drawn yet
  });
});
