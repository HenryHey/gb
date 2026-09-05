import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart, parseHeader } from '../src/cart.js';
import { createIo } from '../src/io.js';
import { createPpu } from '../src/ppu.js';

/** Header $0148 ROM size codes → number of 16 KiB banks. */
const ROM_SIZE_CODE = { 2: 0x00, 4: 0x01, 8: 0x02, 16: 0x03, 32: 0x04, 64: 0x05 };

function stampBankMarkers(rom, banks) {
  for (let b = 0; b < banks; b++) {
    const base = b * 0x4000;
    rom[base] = 0x10 + b;
    rom[base + 0x123] = 0x20 + b;
  }
}

function makeRom({
  banks = 4,
  type = 0x00,
  ramId = 0x00,
  title = 'MBC1 TEST',
  sizeBytes,
} = {}) {
  const rom = new Uint8Array(sizeBytes ?? banks * 0x4000);
  stampBankMarkers(rom, banks);
  for (let i = 0; i < title.length && i < 16; i++) {
    rom[0x134 + i] = title.charCodeAt(i);
  }
  rom[0x147] = type;
  rom[0x148] = ROM_SIZE_CODE[banks] ?? 0x01;
  rom[0x149] = ramId;
  return rom;
}

function makeBus(rom) {
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), cart, rom, io, ppu };
}

function selectRomBank(bus, bank) {
  bus.write8(0x2000, bank);
}

describe('parseHeader', () => {
  test('Super Mario Land profile: MBC1, 64 KiB, no RAM', () => {
    const rom = makeRom({ banks: 4, type: 0x01, ramId: 0x00, title: 'SUPER MARIOLAND' });
    const h = parseHeader(rom);
    expect(h.type).toBe(0x01);
    expect(h.typeName).toBe('MBC1');
    expect(h.romBanks).toBe(4);
    expect(h.romBytes).toBe(0x10000);
    expect(h.ramKiB).toBe(0);
    expect(h.title).toBe('SUPER MARIOLAND');
  });
});

describe('ROM ONLY regression', () => {
  test('flat ROM read through bus', () => {
    const rom = makeRom({ banks: 2, type: 0x00, sizeBytes: 0x8000 });
    const { bus } = makeBus(rom);
    expect(bus.read8(0x0000)).toBe(0x10);
    expect(bus.read8(0x4123)).toBe(0x21);
  });

  test('ROM ONLY write does not mutate ROM bytes', () => {
    const rom = makeRom({ banks: 2, type: 0x00, sizeBytes: 0x8000 });
    const { bus } = makeBus(rom);
    bus.write8(0x0123, 0x00);
    bus.write8(0x2000, 0x05);
    expect(rom[0x0123]).toBe(0x20);
    expect(bus.read8(0x0123)).toBe(0x20);
  });
});

describe('MBC1 ROM banking', () => {
  test('$0000–$3FFF always maps ROM bank 0 in mode 0', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x01 }));
    selectRomBank(bus, 3);
    expect(bus.read8(0x0000)).toBe(0x10);
    expect(bus.read8(0x0123)).toBe(0x20);
  });

  test('switchable window defaults to ROM bank 1', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x01 }));
    expect(bus.read8(0x4000)).toBe(0x11);
    expect(bus.read8(0x4123)).toBe(0x21);
  });

  test('write to $2000–$3FFF selects the switchable ROM bank', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x01 }));
    selectRomBank(bus, 2);
    expect(bus.read8(0x4000)).toBe(0x12);
    selectRomBank(bus, 3);
    expect(bus.read8(0x4123)).toBe(0x23);
  });

  test('writing bank 0 selects bank 1 (never bank 0 in $4000–$7FFF)', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x01 }));
    selectRomBank(bus, 3);
    selectRomBank(bus, 0);
    expect(bus.read8(0x4000)).toBe(0x11);
    expect(bus.read8(0x4000)).not.toBe(0x10);
  });

  test('ROM bank index is masked to cart size', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x01 }));
    selectRomBank(bus, 5);
    expect(bus.read8(0x4000)).toBe(0x11);
  });

  test('MBC1 register writes do not mutate ROM bytes', () => {
    const rom = makeRom({ banks: 4, type: 0x01 });
    const { bus } = makeBus(rom);
    bus.write8(0x2000, 0x02);
    bus.write8(0x4000, 0xab);
    bus.write8(0x0000, 0x0a);
    expect(rom[0x8000]).toBe(0x12);
    expect(bus.read8(0x4000)).toBe(0x12);
  });

  test('upper ROM bits from $4000–$5FFF affect $4000–$7FFF', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x01 }));
    selectRomBank(bus, 2);
    expect(bus.read8(0x4000)).toBe(0x12);
    bus.write8(0x4000, 1);
    expect(bus.read8(0x4000)).toBe(0x32);
    bus.write8(0x4000, 0);
    expect(bus.read8(0x4000)).toBe(0x12);
  });
});

describe('MBC1 SRAM', () => {
  test('disabled RAM reads open bus ($FF)', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x02, ramId: 0x02 }));
    expect(bus.read8(0xa000)).toBe(0xff);
    bus.write8(0xa000, 0x55);
    expect(bus.read8(0xa000)).toBe(0xff);
  });

  test('RAM enable ($0A to $0000–$1FFF) unlocks read/write at $A000–$BFFF', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x02, ramId: 0x02 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0xa010, 0xde);
    bus.write8(0xbfff, 0xad);
    expect(bus.read8(0xa010)).toBe(0xde);
    expect(bus.read8(0xbfff)).toBe(0xad);
  });

  test('RAM enable only accepts low nibble $0A', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x02, ramId: 0x02 }));
    bus.write8(0x0000, 0x0b);
    bus.write8(0xa000, 0x42);
    expect(bus.read8(0xa000)).toBe(0xff);
    bus.write8(0x0000, 0x0a);
    bus.write8(0xa000, 0x42);
    expect(bus.read8(0xa000)).toBe(0x42);
  });

  test('mode 1 selects SRAM bank via $4000–$5FFF', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x03, ramId: 0x03 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0x6000, 1);
    bus.write8(0x4000, 0);
    bus.write8(0xa000, 0xaa);
    bus.write8(0x4000, 1);
    bus.write8(0xa000, 0xbb);
    bus.write8(0x4000, 0);
    expect(bus.read8(0xa000)).toBe(0xaa);
    bus.write8(0x4000, 1);
    expect(bus.read8(0xa000)).toBe(0xbb);
  });
});

describe('createCart', () => {
  test('throws for unimplemented mappers', () => {
    const rom = makeRom({ banks: 4, type: 0x20, ramId: 0x03 });
    expect(() => createCart(rom)).toThrow(/not implemented/i);
  });
});

describe('chapter 13 checkpoint', () => {
  test('bus delegates ROM reads and mapper writes to the cart', () => {
    const rom = makeRom({ banks: 4, type: 0x01, title: 'SUPER MARIOLAND' });
    const { bus } = makeBus(rom);
    expect(parseHeader(rom).typeName).toBe('MBC1');
    expect(bus.read8(0x0100)).toBe(rom[0x0100]);
    selectRomBank(bus, 2);
    expect(bus.read8(0x4000)).toBe(0x12);
    bus.write8(0x0123, 0x00);
    expect(rom[0x0123]).toBe(0x20);
  });
});
