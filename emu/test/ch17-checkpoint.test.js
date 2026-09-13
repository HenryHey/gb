import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart } from '../src/cart.js';
import { createEmu, reset } from '../src/emu.js';
import { createIo } from '../src/io.js';
import { createPpu } from '../src/ppu.js';
import { deserializeEmu, serializeEmu } from '../src/savestate.js';

/** Header $0148 ROM size codes → number of 16 KiB banks. */
const ROM_SIZE_CODE = { 2: 0x00, 4: 0x01, 8: 0x02, 16: 0x03, 32: 0x04, 64: 0x05, 128: 0x06 };

function stampBankMarkers(rom, banks) {
  for (let b = 0; b < banks; b++) {
    const base = b * 0x4000;
    rom[base] = (0x10 + b) & 0xff;
    rom[base + 0x123] = (0x20 + b) & 0xff;
  }
}

function makeRom({
  banks = 4,
  type = 0x00,
  ramId = 0x00,
  title = 'CH17 TEST',
  sizeBytes,
  romId,
} = {}) {
  const rom = new Uint8Array(sizeBytes ?? banks * 0x4000);
  stampBankMarkers(rom, banks);
  for (let i = 0; i < title.length && i < 16; i++) {
    rom[0x134 + i] = title.charCodeAt(i);
  }
  rom[0x147] = type;
  rom[0x148] = romId ?? ROM_SIZE_CODE[banks] ?? 0x01;
  rom[0x149] = ramId;
  return rom;
}

function makeBus(rom) {
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), cart, rom, io, ppu };
}

function roundTrip(emu) {
  return deserializeEmu(serializeEmu(emu), emu.rom);
}

describe('createCart routing', () => {
  test('accepts MBC2, full MBC3 family, and MBC5 types', () => {
    expect(() => createCart(makeRom({ type: 0x05 }))).not.toThrow();
    expect(() => createCart(makeRom({ type: 0x06 }))).not.toThrow();
    for (const type of [0x0f, 0x10, 0x11, 0x12, 0x13]) {
      expect(() => createCart(makeRom({ type, banks: 64, ramId: 0x03 }))).not.toThrow();
    }
    for (const type of [0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e]) {
      expect(() => createCart(makeRom({ type, ramId: 0x02 }))).not.toThrow();
    }
  });
});

describe('MBC5 ROM banking', () => {
  test('bank 0 is valid in $4000–$7FFF (not remapped to bank 1)', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x19 }));
    bus.write8(0x2000, 0x00);
    bus.write8(0x3000, 0x00);
    expect(bus.read8(0x4000)).toBe(0x10);
    expect(bus.read8(0x4000)).not.toBe(0x11);
  });

  test('9-bit ROM bank from low + high bytes selects the correct window', () => {
    const banks = 512;
    const rom = makeRom({ banks, type: 0x19, sizeBytes: banks * 0x4000, romId: 0xff });
    const { bus } = makeBus(rom);

    bus.write8(0x2000, 0x2c);
    bus.write8(0x3000, 0x00);
    expect(bus.read8(0x4000)).toBe((0x10 + 44) & 0xff);

    bus.write8(0x2000, 0x2c);
    bus.write8(0x3000, 0x01);
    expect(bus.read8(0x4000)).toBe((0x10 + 300) & 0xff);
  });
});

describe('MBC5 SRAM', () => {
  test('enable, bank switch, read/write at $A000', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x1b, ramId: 0x03 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0x4000, 0);
    bus.write8(0xa010, 0xde);
    bus.write8(0x4000, 1);
    bus.write8(0xa010, 0xbe);
    bus.write8(0x4000, 0);
    expect(bus.read8(0xa010)).toBe(0xde);
    bus.write8(0x4000, 1);
    expect(bus.read8(0xa010)).toBe(0xbe);
  });
});

describe('MBC3 family routing', () => {
  test('$10 loads and banks like $13', () => {
    const rom = makeRom({ banks: 64, type: 0x10, ramId: 0x03, title: 'GOLD' });
    expect(() => createCart(rom)).not.toThrow();

    const { bus } = makeBus(rom);
    bus.write8(0x2000, 5);
    expect(bus.read8(0x4000)).toBe(0x15);
    expect(bus.read8(0x4123)).toBe(0x25);
  });
});

describe('MBC2', () => {
  test('RAM enable via $0000 (A8 clear), not $0100', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x05 }));

    bus.write8(0x0100, 0x0a);
    bus.write8(0xa000, 0x05);
    expect(bus.read8(0xa000)).toBe(0xff);

    bus.write8(0x0000, 0x0a);
    bus.write8(0xa000, 0x05);
    expect(bus.read8(0xa000)).toBe(0xf5);
  });

  test('nibble RAM stores low four bits and reads with $F0 high nibble', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x05 }));
    bus.write8(0x0000, 0x0a);
    bus.write8(0xa000, 0x05);
    expect(bus.read8(0xa000)).toBe(0xf5);
    bus.write8(0xa001, 0xa7);
    expect(bus.read8(0xa001)).toBe(0xf7);
  });

  test('ROM bank via A8=1 in $0000–$1FFF and $2000–$3FFF', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x05 }));
    expect(bus.read8(0x4000)).toBe(0x11);

    bus.write8(0x0101, 0x03);
    expect(bus.read8(0x4000)).toBe(0x13);

    bus.write8(0x2000, 0x02);
    expect(bus.read8(0x4000)).toBe(0x12);
  });

  test('$A200–$BFFF reads open bus', () => {
    const { bus } = makeBus(makeRom({ banks: 4, type: 0x05 }));
    bus.write8(0x0000, 0x0a);
    expect(bus.read8(0xa1ff)).toBe(0xf0);
    expect(bus.read8(0xa200)).toBe(0xff);
  });
});

describe('MBC2 save state', () => {
  test('round-trips ROM bank selection', () => {
    const rom = makeRom({ banks: 4, type: 0x06, title: 'MBC2 SAVE' });
    const emu = createEmu(rom);
    reset(emu);

    emu.bus.write8(0x2000, 0x03);
    expect(emu.bus.read8(0x4000)).toBe(0x13);
    expect(emu.cart.state.romBank).toBe(3);

    const restored = roundTrip(emu);
    expect(restored.cart.state.romBank).toBe(3);
    expect(restored.bus.read8(0x4000)).toBe(0x13);
  });

  test('round-trips nibble RAM and ramEnable', () => {
    const rom = makeRom({ banks: 4, type: 0x06, title: 'MBC2 SAVE' });
    const emu = createEmu(rom);
    reset(emu);

    emu.bus.write8(0x0000, 0x0a);
    emu.bus.write8(0xa000, 0x05);
    emu.bus.write8(0xa010, 0xa7);
    expect(emu.bus.read8(0xa000)).toBe(0xf5);
    expect(emu.bus.read8(0xa010)).toBe(0xf7);
    expect(emu.cart.ram[0x00]).toBe(0x05);
    expect(emu.cart.ram[0x10]).toBe(0x07);

    const restored = roundTrip(emu);
    expect(restored.cart.state.ramEnable).toBe(true);
    expect(restored.bus.read8(0xa000)).toBe(0xf5);
    expect(restored.bus.read8(0xa010)).toBe(0xf7);
    expect(restored.cart.ram[0x00]).toBe(0x05);
    expect(restored.cart.ram[0x10]).toBe(0x07);
  });
});

describe('MBC5 save state', () => {
  test('round-trips ROM bank selection', () => {
    const rom = makeRom({ banks: 8, type: 0x1b, ramId: 0x02, title: 'MBC5 SAVE' });
    const emu = createEmu(rom);
    reset(emu);

    emu.bus.write8(0x2000, 0x03);
    emu.bus.write8(0x3000, 0x01);
    expect(emu.bus.read8(0x4000)).toBe((0x10 + 0x103) & 0xff);

    const restored = roundTrip(emu);
    expect(restored.bus.read8(0x4000)).toBe((0x10 + 0x103) & 0xff);
  });
});

describe('regression', () => {
  test('ROM ONLY flat read', () => {
    const { bus } = makeBus(makeRom({ banks: 2, type: 0x00, sizeBytes: 0x8000 }));
    expect(bus.read8(0x0000)).toBe(0x10);
    expect(bus.read8(0x4123)).toBe(0x21);
  });

  test('MBC1 Super Mario Land profile still banks', () => {
    const rom = makeRom({ banks: 4, type: 0x01, ramId: 0x00, title: 'SUPER MARIOLAND' });
    const { bus } = makeBus(rom);
    expect(bus.read8(0x4000)).toBe(0x11);
    bus.write8(0x2000, 2);
    expect(bus.read8(0x4000)).toBe(0x12);
    expect(bus.read8(0x0000)).toBe(0x10);
  });

  test('MBC3 Pokémon-style cart still banks', () => {
    const { bus } = makeBus(makeRom({ banks: 64, type: 0x13, ramId: 0x03, title: 'POKEMON RED' }));
    bus.write8(0x2000, 5);
    expect(bus.read8(0x4000)).toBe(0x15);
    bus.write8(0x0000, 0x0a);
    bus.write8(0xa010, 0x42);
    expect(bus.read8(0xa010)).toBe(0x42);
  });
});

describe('chapter 17 checkpoint', () => {
  test('remaining mappers load and respond to banking writes', () => {
    const mbc5 = makeBus(makeRom({ banks: 4, type: 0x1b, ramId: 0x02 }));
    mbc5.bus.write8(0x2000, 0);
    mbc5.bus.write8(0x3000, 0);
    expect(mbc5.bus.read8(0x4000)).toBe(0x10);

    const mbc2 = makeBus(makeRom({ banks: 4, type: 0x05 }));
    mbc2.bus.write8(0x0000, 0x0a);
    mbc2.bus.write8(0xa000, 0x05);
    expect(mbc2.bus.read8(0xa000)).toBe(0xf5);

    expect(() => createCart(makeRom({ banks: 64, type: 0x10, ramId: 0x03 }))).not.toThrow();
  });
});
