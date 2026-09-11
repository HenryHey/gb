import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  createCart,
  hasBatterySram,
  loadSram,
  saveSram,
  sramKey,
} from '../src/cart.js';
import { crc32 } from '../src/crc32.js';

const ROM_SIZE_CODE = { 2: 0x00, 4: 0x01, 8: 0x02, 16: 0x03, 32: 0x04, 64: 0x05 };

function makeRom({ banks = 4, type = 0x00, ramId = 0x00, title = 'SRAM TEST', seed = 0 } = {}) {
  const rom = new Uint8Array(banks * 0x4000);
  rom[0x134] = title.charCodeAt(0);
  rom[0x147] = type;
  rom[0x148] = ROM_SIZE_CODE[banks] ?? 0x01;
  rom[0x149] = ramId;
  rom[0x14d] = 0x01;
  rom[0x2000 + seed] = 0xab;
  return rom;
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

describe('hasBatterySram', () => {
  test('battery-backed mapper types persist', () => {
    expect(hasBatterySram(0x03)).toBe(true);
    expect(hasBatterySram(0x13)).toBe(true);
    expect(hasBatterySram(0x1b)).toBe(true);
  });

  test('RAM without battery does not persist', () => {
    expect(hasBatterySram(0x02)).toBe(false);
    expect(hasBatterySram(0x01)).toBe(false);
    expect(hasBatterySram(0x1a)).toBe(false);
  });
});

describe('SRAM persistence', () => {
  test('sramKey uses whole-ROM CRC32', () => {
    const romA = makeRom({ title: 'GAME A', seed: 0 });
    const romB = makeRom({ title: 'GAME A', seed: 1 });
    expect(sramKey(romA)).toBe(`gb-sram:${crc32(romA).toString(16).padStart(8, '0')}`);
    expect(sramKey(romA)).not.toBe(sramKey(romB));
  });

  test('saveSram and loadSram round-trip battery carts only', () => {
    const rom = makeRom({ banks: 64, type: 0x13, ramId: 0x03 });
    const cart = createCart(rom);
    cart.ram.fill(0);
    cart.ram[0x10] = 0x42;

    saveSram(cart, rom);
    cart.ram.fill(0);
    expect(loadSram(cart, rom)).toBe(true);
    expect(cart.ram[0x10]).toBe(0x42);
  });

  test('MBC1+RAM without battery does not write localStorage', () => {
    const rom = makeRom({ type: 0x02, ramId: 0x02 });
    const cart = createCart(rom);
    cart.ram[0] = 0x55;

    saveSram(cart, rom);
    expect(slotStore.size).toBe(0);
    expect(loadSram(cart, rom)).toBe(false);
  });
});
