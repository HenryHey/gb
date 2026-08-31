import { describe, expect, test } from 'bun:test';
import { createIo } from '../src/io.js';
import { createPpu, ppuStep } from '../src/ppu.js';
import { createEmu, FRAME_T, reset, runFrame, runTCycles, tickEmu } from '../src/emu.js';

/** 32 KiB ROM of NOPs so skip-boot at $0100 just burns T-cycles. */
function nopRom() {
  return new Uint8Array(0x8000);
}

/**
 * ROM that spins on `LDH A,($FF44); CP $90; JR NZ` until LY reaches 144,
 * then sets A=$01 and HALTs — the classic “wait for vblank” pattern.
 */
function vblankWaitRom() {
  const rom = nopRom();
  rom[0x150] = 0xf0; // LDH A,(LY)
  rom[0x151] = 0x44;
  rom[0x152] = 0xfe; // CP $90
  rom[0x153] = 0x90;
  rom[0x154] = 0x20; // JR NZ, loop
  rom[0x155] = 0xfa; // -6 → $0150
  rom[0x156] = 0x3e; // LD A,$01
  rom[0x157] = 0x01;
  rom[0x158] = 0x76; // HALT
  return rom;
}

function stepPpu(ppu, io, t) {
  ppuStep(ppu, io, t);
}

describe('chapter 8 checkpoint', () => {
  test('one frame sets frameReady and requests VBlank IF', () => {
    const ppu = createPpu();
    const io = createIo();
    let vblankRequested = false;
    const orig = io.requestIf.bind(io);
    io.requestIf = (bit) => {
      if (bit === 0) vblankRequested = true;
      orig(bit);
    };

    stepPpu(ppu, io, FRAME_T);

    expect(ppu.lcdc & 0x80).toBe(0x80);
    expect(ppu.frameReady).toBe(true);
    expect(vblankRequested).toBe(true);
  });

  test('one large PPU step crosses mode boundaries', () => {
    const ppu = createPpu();
    const io = createIo();
    expect(ppu.mode).toBe(2); // OAM scan

    stepPpu(ppu, io, 100);

    expect(ppu.mode).toBe(3); // past 80 T OAM → draw
  });

  test('LY visits 0..153 over one frame', () => {
    const ppu = createPpu();
    const io = createIo();
    const seen = new Set();

    for (let t = 0; t < FRAME_T; t++) {
      stepPpu(ppu, io, 1);
      seen.add(ppu.ly);
    }

    expect(seen.has(0)).toBe(true);
    expect(seen.has(153)).toBe(true);
    for (let ly = 0; ly <= 153; ly++) {
      expect(seen.has(ly)).toBe(true);
    }
  });

  test('1000-T chunks advance LY through a full frame', () => {
    const ppu = createPpu();
    const io = createIo();
    const seen = new Set([ppu.ly]);
    let wrapped = false;
    let prev = ppu.ly;

    for (let chunk = 0; chunk < 80; chunk++) {
      stepPpu(ppu, io, 1000);
      seen.add(ppu.ly);
      if (ppu.ly < prev) wrapped = true;
      prev = ppu.ly;
    }

    expect(seen.has(0)).toBe(true);
    expect(seen.has(153)).toBe(true);
    expect(Math.max(...seen)).toBe(153);
    expect(wrapped).toBe(true);
  });

  test('reset with LCDC $91; runFrame sets frameReady', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    expect(emu.ppu.lcdc).toBe(0x91);

    runFrame(emu);

    expect(emu.ppu.frameReady).toBe(true);
  });

  test('vblank wait loop exits instead of spinning forever', () => {
    const emu = createEmu(vblankWaitRom());
    reset(emu);
    emu.cpu.pc = 0x0150;

    const max = FRAME_T * 2;
    let t = 0;
    while (!emu.cpu.halted && t < max) t += tickEmu(emu);

    expect(emu.cpu.halted).toBe(true);
    expect(emu.cpu.a).toBe(0x01);
    expect(t).toBeLessThan(max);
  });

  test('LCD off keeps LY at 0 while T-cycles advance', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    emu.ppu.lcdc = 0x11; // LCDC bit 7 clear

    runTCycles(emu, FRAME_T);

    expect(emu.ppu.ly).toBe(0);
    expect(emu.ppu.mode).toBe(0);
  });
});
