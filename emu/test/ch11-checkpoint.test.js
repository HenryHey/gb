import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart } from '../src/cart.js';
import { createIo } from '../src/io.js';
import { createPpu, ppuStep } from '../src/ppu.js';

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

function shadeIndex(palette, colorIndex) {
  return (palette >> (colorIndex * 2)) & 3;
}

function expectPixel(fb, x, y, colorIndex, palette = 0xfc) {
  expect(fbPixel(fb, x, y)).toEqual(rgb(shadeIndex(palette, colorIndex)));
}

function makeBus(romBytes = []) {
  const rom = new Uint8Array(Math.max(0x150, romBytes.length));
  rom.set(romBytes);
  rom[0x147] = 0x00;
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), io, rom, ppu };
}

function stepPpu(ppu, io, t, vram, oam) {
  ppuStep(ppu, io, t, vram, oam);
}

function setOamEntry(oam, i, y, x, tile, flags = 0) {
  const base = i * 4;
  oam[base] = y;
  oam[base + 1] = x;
  oam[base + 2] = tile;
  oam[base + 3] = flags;
}

/** LCD on, BG + OBJ, unsigned tiles $8000, BG map $9800. */
function spriteLcdc() {
  return 0x80 | 0x01 | 0x02 | 0x10;
}

function fillTileRow(vram, tile, row, lo, hi) {
  const addr = tile * 16 + row * 2;
  vram[addr] = lo;
  vram[addr + 1] = hi;
}

describe('chapter 11 checkpoint', () => {
  test('DMA copies 160 bytes from WRAM page into OAM', () => {
    const { bus } = makeBus();
    for (let i = 0; i < 0xa0; i++) {
      bus.write8(0xc000 + i, (0x10 + i) & 0xff);
    }
    bus.write8(0xff46, 0xc0);
    for (let i = 0; i < 0xa0; i++) {
      expect(bus.read8(0xfe00 + i)).toBe((0x10 + i) & 0xff);
    }
  });

  test('DMA register readback returns last written source page', () => {
    const { bus } = makeBus();
    expect(bus.read8(0xff46)).toBe(0xff);
    bus.write8(0xff46, 0xd0);
    expect(bus.read8(0xff46)).toBe(0xd0);
  });

  test('OBJ color index 0 is transparent (BG shows through)', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);
    const oam = new Uint8Array(0xa0);

    ppu.lcdc = spriteLcdc();
    ppu.bgp = 0xe4;
    ppu.obp0 = 0xe4;

    vram[0x9800 - 0x8000] = 0x00;
    fillTileRow(vram, 0, 0, 0xff, 0x00); // BG tile 0 → index 1 at x=0
    fillTileRow(vram, 1, 0, 0x00, 0x00); // OBJ tile 1 fully transparent

    setOamEntry(oam, 0, 16, 8, 1);

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram, oam);

    expectPixel(ppu.framebuffer, 0, 0, 1, 0xe4);
  });

  test('OBJ pixel uses OBP0 shade for non-zero color index', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);
    const oam = new Uint8Array(0xa0);

    ppu.lcdc = spriteLcdc();
    ppu.bgp = 0xfc;
    ppu.obp0 = 0xe4; // identity remap

    vram[0x9800 - 0x8000] = 0x00;
    fillTileRow(vram, 0, 0, 0x00, 0x00); // BG index 0
    fillTileRow(vram, 0, 0, 0xff, 0xff); // OBJ tile 0 row 0 → index 3

    setOamEntry(oam, 0, 16, 8, 0);

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram, oam);

    expectPixel(ppu.framebuffer, 0, 0, 3, 0xe4);
  });

  test('BG priority flag blocks sprite over non-zero BG pixels', () => {
    const vram = new Uint8Array(0x2000);
    vram[0x9800 - 0x8000] = 0x00;
    fillTileRow(vram, 0, 0, 0xff, 0xff); // BG index 3
    fillTileRow(vram, 1, 0, 0xff, 0x00); // OBJ tile 1 row 0 → index 1

    const oamBlocked = new Uint8Array(0xa0);
    setOamEntry(oamBlocked, 0, 16, 8, 1, 0x80);
    const ppuBlocked = createPpu();
    ppuBlocked.lcdc = spriteLcdc();
    ppuBlocked.bgp = 0xe4;
    ppuBlocked.obp0 = 0xe4;
    stepPpu(ppuBlocked, createIo(), FIRST_SCANLINE_T, vram, oamBlocked);
    expectPixel(ppuBlocked.framebuffer, 0, 0, 3, 0xe4);

    const oamDrawn = new Uint8Array(0xa0);
    setOamEntry(oamDrawn, 0, 16, 8, 1, 0x00);
    const ppuDrawn = createPpu();
    ppuDrawn.lcdc = spriteLcdc();
    ppuDrawn.bgp = 0xe4;
    ppuDrawn.obp0 = 0xe4;
    stepPpu(ppuDrawn, createIo(), FIRST_SCANLINE_T, vram, oamDrawn);
    expectPixel(ppuDrawn.framebuffer, 0, 0, 1, 0xe4);
  });

  test('only first 10 OAM entries on a line are considered', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);
    const oam = new Uint8Array(0xa0);

    ppu.lcdc = spriteLcdc();
    ppu.bgp = 0xfc;
    ppu.obp0 = 0xe4;

    vram[0x9800 - 0x8000] = 0x00;
    fillTileRow(vram, 0, 0, 0x00, 0x00); // BG index 0
    fillTileRow(vram, 1, 0, 0xff, 0xff); // dropped sprite tile → index 3

    for (let i = 0; i < 10; i++) {
      setOamEntry(oam, i, 16, 240, 0); // on line 0, off-screen right
    }
    setOamEntry(oam, 10, 16, 8, 1); // 11th on line — should be dropped

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram, oam);

    expectPixel(ppu.framebuffer, 0, 0, 0, 0xfc);
  });

  test('sprite priority: lower X wins at overlapping pixels', () => {
    const ppu = createPpu();
    const io = createIo();
    const vram = new Uint8Array(0x2000);
    const oam = new Uint8Array(0xa0);

    ppu.lcdc = spriteLcdc();
    ppu.bgp = 0xfc;
    ppu.obp0 = 0xe4;

    vram[0x9800 - 0x8000] = 0x00;
    fillTileRow(vram, 0, 0, 0x00, 0x00);
    fillTileRow(vram, 1, 0, 0xff, 0x00); // tile 1 → index 1
    fillTileRow(vram, 2, 0, 0xff, 0xff); // tile 2 → index 3

    setOamEntry(oam, 0, 16, 8, 1); // screen x 0–7, shade 1
    setOamEntry(oam, 1, 16, 12, 2); // screen x 4–11, shade 3

    stepPpu(ppu, io, FIRST_SCANLINE_T, vram, oam);

    expectPixel(ppu.framebuffer, 4, 0, 1, 0xe4);
    expectPixel(ppu.framebuffer, 7, 0, 1, 0xe4);
  });
});
