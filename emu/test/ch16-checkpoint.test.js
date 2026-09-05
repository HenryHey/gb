import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createEmu, reset, runN } from '../src/emu.js';
import {
  GBSS_MAGIC,
  GBSS_VERSION,
  base64ToBytes,
  bytesToBase64,
  crc32,
  deserializeEmu,
  loadStateSlot,
  saveStateSlot,
  serializeEmu,
  stateKey,
} from '../src/savestate.js';

const ROM_SIZE_CODE = { 2: 0x00, 4: 0x01, 8: 0x02, 16: 0x03, 32: 0x04, 64: 0x05 };

function makeRom({
  banks = 4,
  type = 0x00,
  ramId = 0x00,
  title = 'SAVE TEST',
  sizeBytes,
  seed = 0,
} = {}) {
  const rom = new Uint8Array(sizeBytes ?? banks * 0x4000);
  for (let b = 0; b < banks; b++) {
    const base = b * 0x4000;
    rom[base] = 0x10 + b + seed;
    rom[base + 0x123] = 0x20 + b + seed;
  }
  for (let i = 0; i < title.length && i < 16; i++) {
    rom[0x134 + i] = title.charCodeAt(i);
  }
  rom[0x147] = type;
  rom[0x148] = ROM_SIZE_CODE[banks] ?? 0x01;
  rom[0x149] = ramId;
  rom[0x14d] = 0x01;
  return rom;
}

function freshEmu(rom, { skipReset = false } = {}) {
  const emu = createEmu(rom);
  if (!skipReset) reset(emu);
  return emu;
}

function cpuSnapshot(cpu) {
  return {
    a: cpu.a,
    f: cpu.f,
    b: cpu.b,
    c: cpu.c,
    d: cpu.d,
    e: cpu.e,
    h: cpu.h,
    l: cpu.l,
    sp: cpu.sp,
    pc: cpu.pc,
    ime: cpu.ime,
    halted: cpu.halted,
    imeEnableCountdown: cpu.imeEnableCountdown,
  };
}

function roundTrip(emu) {
  return deserializeEmu(serializeEmu(emu), emu.rom);
}

/** @type {Map<string, string> | undefined} */
let slotStore;

beforeEach(() => {
  slotStore = new Map();
  globalThis.localStorage = {
    getItem: (key) => slotStore.get(key) ?? null,
    setItem: (key, value) => slotStore.set(key, value),
    removeItem: (key) => slotStore.delete(key),
  };
});

afterEach(() => {
  delete globalThis.localStorage;
});

describe('GBSS format', () => {
  test('serialize writes magic, version, and ROM CRC32', () => {
    const rom = makeRom({ banks: 2, type: 0x00 });
    const bytes = serializeEmu(freshEmu(rom));
    const view = new DataView(bytes.buffer);

    expect(view.getUint32(0, true)).toBe(GBSS_MAGIC);
    expect(view.getUint32(4, true)).toBe(GBSS_VERSION);
    expect(view.getUint32(8, true)).toBe(crc32(rom));
    expect(bytes.byteLength).toBe(0x4220);
  });

  test('stateKey is scoped to title and header checksum', () => {
    const rom = makeRom({ title: 'TETRIS' });
    expect(stateKey(rom)).toBe('gb-state:TETRIS:1');
  });
});

describe('serialize / deserialize', () => {
  test('round-trips CPU registers', () => {
    const rom = makeRom({ banks: 2, type: 0x00 });
    const emu = freshEmu(rom);
    Object.assign(emu.cpu, {
      a: 0x12,
      f: 0x30,
      b: 0xab,
      c: 0xcd,
      d: 0x34,
      e: 0x56,
      h: 0x78,
      l: 0x9a,
      sp: 0xc000,
      pc: 0x4567,
      ime: true,
      halted: true,
      imeEnableCountdown: 1,
    });

    const restored = roundTrip(emu);
    expect(cpuSnapshot(restored.cpu)).toEqual(cpuSnapshot(emu.cpu));
  });

  test('round-trips WRAM and HRAM through the bus', () => {
    const rom = makeRom({ banks: 2, type: 0x00 });
    const emu = freshEmu(rom);
    emu.bus.write8(0xc000, 0xde);
    emu.bus.write8(0xd000, 0xad);
    emu.bus.write8(0xff90, 0xbe);
    emu.bus.ie = 0x5a;

    const restored = roundTrip(emu);
    expect(restored.bus.read8(0xc000)).toBe(0xde);
    expect(restored.bus.read8(0xd000)).toBe(0xad);
    expect(restored.bus.read8(0xff90)).toBe(0xbe);
    expect(restored.bus.ie).toBe(0x5a);
  });

  test('round-trips PPU ly and timer divCounter', () => {
    const rom = makeRom({ banks: 2, type: 0x00 });
    const emu = freshEmu(rom);
    emu.ppu.ly = 72;
    emu.ppu.lineCycles = 123;
    emu.io.divCounter = 0x3456;
    emu.io.tima = 0x11;
    emu.io.tma = 0x22;
    emu.io.tac = 0x05;

    const restored = roundTrip(emu);
    expect(restored.ppu.ly).toBe(72);
    expect(restored.ppu.lineCycles).toBe(123);
    expect(restored.io.divCounter).toBe(0x3456);
    expect(restored.io.tima).toBe(0x11);
    expect(restored.io.tma).toBe(0x22);
    expect(restored.io.tac).toBe(0x05);
  });

  test('DIV phase survives round-trip after stepping', () => {
    const rom = makeRom({ banks: 2, type: 0x00 });
    const emu = freshEmu(rom);
    runN(emu, 250);

    const divBefore = emu.io.divCounter;
    const restored = roundTrip(emu);
    expect(restored.io.divCounter).toBe(divBefore);
  });

  test('rejects ROM mismatch on load', () => {
    const romA = makeRom({ title: 'ROM A', seed: 0 });
    const romB = makeRom({ title: 'ROM B', seed: 7 });
    const bytes = serializeEmu(freshEmu(romA));

    expect(() => deserializeEmu(bytes, romB)).toThrow(/ROM mismatch/i);
  });

  test('rejects truncated payloads', () => {
    const rom = makeRom({ banks: 2, type: 0x00 });
    const bytes = serializeEmu(freshEmu(rom));
    expect(() => deserializeEmu(bytes.subarray(0, 0x100), rom)).toThrow(/truncated/i);
  });

  test('requires a full cartridge header before save', () => {
    const emu = freshEmu(makeRom({ banks: 2, type: 0x00 }));
    emu.rom = new Uint8Array(0x100);
    expect(() => serializeEmu(emu)).toThrow(/ROM/i);
  });
});

describe('MBC3 save state', () => {
  test('round-trips ROM bank selection', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03, title: 'POKEMON RED' });
    const emu = freshEmu(rom);

    emu.bus.write8(0x2000, 5);
    expect(emu.bus.read8(0x4000)).toBe(0x15);
    expect(emu.cart.state.romBank).toBe(5);

    const restored = roundTrip(emu);
    expect(restored.cart.state.romBank).toBe(5);
    expect(restored.bus.read8(0x4000)).toBe(0x15);
  });

  test('round-trips cart SRAM bytes', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03, title: 'POKEMON RED' });
    const emu = freshEmu(rom);

    emu.bus.write8(0x0000, 0x0a);
    emu.bus.write8(0xa010, 0x42);
    emu.bus.write8(0xbfff, 0x99);

    const restored = roundTrip(emu);
    expect(restored.bus.read8(0xa010)).toBe(0x42);
    expect(restored.bus.read8(0xbfff)).toBe(0x99);
  });
});

describe('localStorage slot', () => {
  test('saveStateSlot and loadStateSlot round-trip', () => {
    const rom = makeRom({ banks: 2, type: 0x00, title: 'TETRIS' });
    const emu = freshEmu(rom);
    emu.cpu.pc = 0x2345;
    emu.bus.write8(0xc123, 0x55);

    saveStateSlot(emu);
    const restored = loadStateSlot(rom);

    expect(restored).not.toBeNull();
    expect(restored.cpu.pc).toBe(0x2345);
    expect(restored.bus.read8(0xc123)).toBe(0x55);
  });

  test('loadStateSlot returns null when nothing saved', () => {
    const rom = makeRom({ title: 'EMPTY' });
    expect(loadStateSlot(rom)).toBeNull();
  });

  test('base64 helpers round-trip bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 255, 0x42]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe('chapter 16 checkpoint', () => {
  test('GBSS snapshot restores a runnable machine without reset()', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03, title: 'POKEMON RED' });
    const emu = freshEmu(rom);

    emu.cpu.pc = 0x0300;
    emu.ppu.ly = 10;
    emu.io.divCounter = 0x1200;
    emu.bus.write8(0x2000, 3);
    emu.bus.write8(0x0000, 0x0a);
    emu.bus.write8(0xa000, 0x7e);

    const restored = roundTrip(emu);

    expect(restored.cpu.pc).toBe(0x0300);
    expect(restored.ppu.ly).toBe(10);
    expect(restored.io.divCounter).toBe(0x1200);
    expect(restored.bus.read8(0x4000)).toBe(0x13);
    expect(restored.bus.read8(0xa000)).toBe(0x7e);
    expect(restored.bus.read8(0x0100)).toBe(rom[0x0100]);
  });
});
