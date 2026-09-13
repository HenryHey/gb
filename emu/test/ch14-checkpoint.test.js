import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart, loadSram, parseHeader, saveSram } from '../src/cart.js';
import { createEmu, reset } from '../src/emu.js';
import { createIo } from '../src/io.js';
import { createPpu } from '../src/ppu.js';

const ROM_SIZE_CODE = { 2: 0x00, 4: 0x01, 8: 0x02, 16: 0x03, 32: 0x04, 64: 0x05 };

function stampBankMarkers(rom, banks) {
  for (let b = 0; b < banks; b++) {
    const base = b * 0x4000;
    rom[base] = 0x10 + b;
    rom[base + 0x123] = 0x20 + b;
  }
}

function makeRom({ banks = 64, type = 0x13, ramId = 0x03, title = 'POKEMON RED', sizeBytes } = {}) {
  const rom = new Uint8Array(sizeBytes ?? banks * 0x4000);
  stampBankMarkers(rom, banks);
  for (let i = 0; i < title.length && i < 16; i++) {
    rom[0x134 + i] = title.charCodeAt(i);
  }
  rom[0x147] = type;
  rom[0x148] = ROM_SIZE_CODE[banks] ?? 0x05;
  rom[0x149] = ramId;
  rom[0x14d] = 0x01;
  return rom;
}

function makeBus(rom) {
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), cart, rom, io, ppu };
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

describe('MBC3 ROM banking', () => {
  test('$0000–$3FFF always maps ROM bank 0', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13 }));
    bus.write8(0x2000, 40);
    expect(bus.read8(0x0000)).toBe(0x10);
    expect(bus.read8(0x0123)).toBe(0x20);
    expect(bus.read8(0x4000)).toBe(0x38);
  });

  test('7-bit ROM bank index supports 64 banks', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13 }));
    bus.write8(0x2000, 63);
    expect(bus.read8(0x4000)).toBe(0x4f);
    expect(bus.read8(0x4123)).toBe(0x5f);
  });

  test('writing bank 0 selects bank 1 in $4000–$7FFF', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13 }));
    bus.write8(0x2000, 5);
    bus.write8(0x2000, 0);
    expect(bus.read8(0x4000)).toBe(0x11);
    expect(bus.read8(0x4000)).not.toBe(0x10);
  });

  test('ROM bank index is masked to cart size', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13 }));
    bus.write8(0x2000, 65);
    expect(bus.read8(0x4000)).toBe(0x11);
  });
});

describe('MBC3 SRAM', () => {
  test('disabled RAM reads open bus ($FF)', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13, ramId: 0x03 }));
    expect(bus.read8(0xa000)).toBe(0xff);
    bus.write8(0xa000, 0x55);
    expect(bus.read8(0xa000)).toBe(0xff);
  });

  test('RAM enable unlocks read/write at $A000–$BFFF', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13, ramId: 0x03 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0xa010, 0xde);
    bus.write8(0xbfff, 0xad);
    expect(bus.read8(0xa010)).toBe(0xde);
    expect(bus.read8(0xbfff)).toBe(0xad);
  });

  test('SRAM bank select via $4000–$5FFF', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13, ramId: 0x03 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0x4000, 0);
    bus.write8(0xa000, 0xaa);
    bus.write8(0x4000, 1);
    bus.write8(0xa000, 0xbb);
    bus.write8(0x4000, 2);
    bus.write8(0xa000, 0xcc);
    bus.write8(0x4000, 0);
    expect(bus.read8(0xa000)).toBe(0xaa);
    bus.write8(0x4000, 1);
    expect(bus.read8(0xa000)).toBe(0xbb);
    bus.write8(0x4000, 2);
    expect(bus.read8(0xa000)).toBe(0xcc);
  });

  test('RTC register banks read 0 and ignore writes', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13, ramId: 0x03 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0x4000, 0); // SRAM bank 0
    bus.write8(0xa000, 0x42);
    bus.write8(0x4000, 4); // ramBank > 3 → RTC stub (implementation masks to 3 bits)
    bus.write8(0xa000, 0x55); // ignored
    expect(bus.read8(0xa000)).toBe(0);
    bus.write8(0x4000, 0);
    expect(bus.read8(0xa000)).toBe(0x42); // SRAM bank 0 intact
  });
});

describe('SRAM persistence', () => {
  test('saveSram and loadSram round-trip MBC3 battery cart', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03, title: 'POKEMON RED' });
    const cart = createCart(rom);
    cart.ram.fill(0);
    cart.ram[0x100] = 0x42;
    cart.ram[0x2000] = 0x99;

    saveSram(cart, rom);
    cart.ram.fill(0);
    expect(loadSram(cart, rom)).toBe(true);
    expect(cart.ram[0x100]).toBe(0x42);
    expect(cart.ram[0x2000]).toBe(0x99);
  });

  test('MBC3 without battery does not persist', () => {
    const rom = makeRom({ banks: 4, type: 0x12, ramId: 0x02, title: 'NO BATT' });
    const cart = createCart(rom);
    cart.ram[0] = 0x55;

    saveSram(cart, rom);
    expect(slotStore.size).toBe(0);
    expect(loadSram(cart, rom)).toBe(false);
  });
});

describe('chapter 14 checkpoint', () => {
  test('Pokémon Red profile: MBC3+RAM+BATTERY, 1 MiB ROM, 32 KiB SRAM', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03, title: 'POKEMON RED' });
    const h = parseHeader(rom);
    expect(h.typeName).toBe('MBC3+RAM+BATTERY');
    expect(h.romBanks).toBe(64);
    expect(h.ramKiB).toBe(32);
  });

  test('bus delegates MBC3 mapper writes without mutating ROM', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03 });
    const { bus } = makeBus(rom);
    bus.write8(0x2000, 10);
    bus.write8(0x0000, 0x0a);
    bus.write8(0xa123, 0xbe);
    expect(rom[0x4000]).not.toBe(0xbe);
    expect(bus.read8(0x4000)).toBe(0x1a);
    expect(bus.read8(0xa123)).toBe(0xbe);
  });

  test('reset restores MBC3 defaults after mapper changes', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03 });
    const emu = createEmu(rom);
    reset(emu);

    emu.bus.write8(0x2000, 10);
    emu.bus.write8(0x4000, 2);
    emu.bus.write8(0x0000, 0x0a);
    expect(emu.cart.state).toEqual({ ramEnable: true, romBank: 10, ramBank: 2 });
    expect(emu.bus.read8(0x4000)).toBe(0x1a);

    reset(emu);

    expect(emu.cart.state).toEqual({ ramEnable: false, romBank: 1, ramBank: 0 });
    expect(emu.bus.read8(0x4000)).toBe(0x11);
  });
});
