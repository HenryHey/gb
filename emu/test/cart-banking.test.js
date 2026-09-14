import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart, parseHeader } from '../src/cart.js';
import { createIo } from '../src/io.js';
import { createPpu } from '../src/ppu.js';

function stampBankMarkers(rom, banks) {
  for (let b = 0; b < banks; b++) {
    const base = b * 0x4000;
    rom[base] = (0x10 + b) & 0xff;
  }
}

function makeBus(rom) {
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), cart };
}

describe('non–power-of-two ROM bank wrap (MBC5)', () => {
  test('bank 72 on a 72-bank cart wraps to bank 0', () => {
    const banks = 72;
    const rom = new Uint8Array(banks * 0x4000);
    stampBankMarkers(rom, banks);
    rom[0x147] = 0x19;
    rom[0x148] = 0x52;

    const { bus } = makeBus(rom);
    bus.write8(0x2000, 72);
    bus.write8(0x3000, 0);
    expect(bus.read8(0x4000)).toBe(0x10);
    expect(bus.read8(0x4000)).not.toBe(0x58);
  });
});

describe('effectiveRomBanks clamps to file size', () => {
  test('header overshoot cannot read past ROM buffer', () => {
    const rom = new Uint8Array(4 * 0x4000);
    stampBankMarkers(rom, 4);
    rom[0x147] = 0x19;
    rom[0x148] = 0x06; // header claims 128 banks

    const { bus } = makeBus(rom);
    bus.write8(0x2000, 64);
    bus.write8(0x3000, 0);
    expect(bus.read8(0x4000)).toBe(0x10); // 64 % 4 === 0 → bank 0 within 4-bank file

    bus.write8(0x2000, 65);
    expect(bus.read8(0x4000)).toBe(0x11); // 65 % 4 === 1 → still in bounds, not OOB
  });
});

describe('bank-0 quirk after wrap (MBC2 / MBC3)', () => {
  test('MBC2: bank 4 on a 4-bank cart maps to bank 1, not bank 0', () => {
    const rom = new Uint8Array(4 * 0x4000);
    stampBankMarkers(rom, 4);
    rom[0x147] = 0x05;
    rom[0x148] = 0x01;

    const { bus } = makeBus(rom);
    bus.write8(0x2000, 4);
    expect(bus.read8(0x4000)).toBe(0x11);
    expect(bus.read8(0x4000)).not.toBe(0x10);
  });

  test('MBC3: bank 64 on a 64-bank cart maps to bank 1, not bank 0', () => {
    const rom = new Uint8Array(64 * 0x4000);
    stampBankMarkers(rom, 64);
    rom[0x147] = 0x13;
    rom[0x148] = 0x05;

    const { bus } = makeBus(rom);
    bus.write8(0x2000, 64);
    expect(bus.read8(0x4000)).toBe(0x11);
    expect(bus.read8(0x4000)).not.toBe(0x10);
  });
});

describe('large SRAM header codes', () => {
  test('$0149 = $04 allocates 128 KiB for MBC5', () => {
    const rom = new Uint8Array(4 * 0x4000);
    rom[0x147] = 0x1b;
    rom[0x148] = 0x01;
    rom[0x149] = 0x04;

    expect(parseHeader(rom).ramKiB).toBe(128);
    const { cart } = makeBus(rom);
    expect(cart.ram.length).toBe(128 * 1024);
  });
});
