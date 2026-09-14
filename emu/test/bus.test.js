import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart } from '../src/cart.js';
import { createIo } from '../src/io.js';
import { createPpu, ppuOamAccessible, ppuVramAccessible, readPpuReg } from '../src/ppu.js';

function makeBus(romBytes = []) {
  const rom = new Uint8Array(Math.max(0x150, romBytes.length));
  rom.set(romBytes);
  rom[0x147] = 0x00; // ROM ONLY
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), io, rom, ppu };
}

describe('bus memory map', () => {
  test('ROM read', () => {
    const { bus } = makeBus([0xce, 0xfa, 0xed, 0xfe]);
    expect(bus.read8(0x0000)).toBe(0xce);
    expect(bus.read8(0x0003)).toBe(0xfe);
  });

  test('ROM write is ignored', () => {
    const { bus, rom } = makeBus([0x42]);
    bus.write8(0x0000, 0x00);
    expect(rom[0]).toBe(0x42);
    expect(bus.read8(0x0000)).toBe(0x42);
  });

  test('VRAM read/write', () => {
    const { bus } = makeBus();
    bus.write8(0x8000, 0x11);
    bus.write8(0x9fff, 0x22);
    expect(bus.read8(0x8000)).toBe(0x11);
    expect(bus.read8(0x9fff)).toBe(0x22);
  });

  test('cart RAM reads open bus ($FF)', () => {
    const { bus } = makeBus();
    expect(bus.read8(0xa000)).toBe(0xff);
    expect(bus.read8(0xbfff)).toBe(0xff);
    bus.write8(0xa000, 0x55);
    expect(bus.read8(0xa000)).toBe(0xff);
  });

  test('WRAM read/write', () => {
    const { bus } = makeBus();
    bus.write8(0xc000, 0xaa);
    bus.write8(0xdfff, 0xbb);
    expect(bus.read8(0xc000)).toBe(0xaa);
    expect(bus.read8(0xdfff)).toBe(0xbb);
  });

  test('echo RAM mirrors WRAM (read)', () => {
    const { bus } = makeBus();
    bus.write8(0xc123, 0x77);
    expect(bus.read8(0xe123)).toBe(0x77);
  });

  test('echo RAM mirrors WRAM (write)', () => {
    const { bus } = makeBus();
    bus.write8(0xe456, 0x88);
    expect(bus.read8(0xc456)).toBe(0x88);
  });

  test('OAM read/write', () => {
    const { bus } = makeBus();
    bus.write8(0xfe00, 0x01);
    bus.write8(0xfe9f, 0x02);
    expect(bus.read8(0xfe00)).toBe(0x01);
    expect(bus.read8(0xfe9f)).toBe(0x02);
  });

  test('unusable region reads $FF', () => {
    const { bus } = makeBus();
    expect(bus.read8(0xfea0)).toBe(0xff);
    expect(bus.read8(0xfeff)).toBe(0xff);
    bus.write8(0xfea0, 0x00);
    expect(bus.read8(0xfea0)).toBe(0xff);
  });

  test('I/O stub defaults to $FF and accepts writes', () => {
    const { bus, ppu } = makeBus();
    expect(bus.read8(0xff00)).toBe(0xcf);
    expect(bus.read8(0xff7f)).toBe(0xff);
    bus.write8(0xff40, 0x91);
    expect(bus.read8(0xff40)).toBe(0x91);
    expect(ppu.lcdc).toBe(0x91);
  });

  test('HRAM is 127 bytes ($FF80–$FFFE)', () => {
    const { bus } = makeBus();
    bus.write8(0xff80, 0x01);
    bus.write8(0xfffe, 0x02);
    expect(bus.read8(0xff80)).toBe(0x01);
    expect(bus.read8(0xfffe)).toBe(0x02);
    expect(bus.hram.length).toBe(0x7f);
  });

  test('IE at $FFFF is separate from HRAM', () => {
    const { bus } = makeBus();
    bus.write8(0xfffe, 0xab);
    bus.write8(0xffff, 0xcd);
    expect(bus.read8(0xfffe)).toBe(0xab);
    expect(bus.read8(0xffff)).toBe(0xcd);
    expect(bus.ie).toBe(0xcd);
    bus.ie = 0x05;
    expect(bus.read8(0xffff)).toBe(0x05);
    expect(bus.read8(0xfffe)).toBe(0xab);
  });

  test('out-of-range ROM read returns $FF', () => {
    const { bus } = makeBus([0x01]);
    expect(bus.read8(0x0150)).toBe(0xff);
  });

  test('STAT read merges mode and sets bit 7', () => {
    const ppu = createPpu();
    ppu.mode = 2;
    ppu.stat = 0x08;
    ppu.lyc = 1;
    expect(readPpuReg(ppu, 0xff41)).toBe(0x8a);
  });

  test('PPU access helpers follow LCD mode rules', () => {
    const ppu = createPpu();
    ppu.lcdc = 0x80;
    ppu.mode = 3;
    expect(ppuVramAccessible(ppu)).toBe(false);
    expect(ppuOamAccessible(ppu)).toBe(false);
    ppu.mode = 2;
    expect(ppuVramAccessible(ppu)).toBe(true);
    expect(ppuOamAccessible(ppu)).toBe(false);
    ppu.lcdc = 0;
    expect(ppuVramAccessible(ppu)).toBe(true);
    expect(ppuOamAccessible(ppu)).toBe(true);
  });
});
