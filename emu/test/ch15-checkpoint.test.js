import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createCart } from '../src/cart.js';
import { createEmu, reset } from '../src/emu.js';
import { createIo } from '../src/io.js';
import { createPpu } from '../src/ppu.js';

function makeBus() {
  const rom = new Uint8Array(0x8000);
  rom[0x147] = 0x00;
  const cart = createCart(rom);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ cart, io, ppu }), io, rom };
}

describe('APU register stub', () => {
  test('channel registers store writes and read back (not stuck at $FF)', () => {
    const { bus } = makeBus();
    bus.write8(0xff12, 0x34);
    bus.write8(0xff19, 0x56);
    expect(bus.read8(0xff12)).toBe(0x34);
    expect(bus.read8(0xff19)).toBe(0x56);
  });

  test('NR10 unused high bit reads as 1', () => {
    const { bus } = makeBus();
    bus.write8(0xff10, 0x77);
    expect(bus.read8(0xff10)).toBe(0xf7);
  });

  test('NR52 read reflects power bit and fixed high nibble', () => {
    const { bus } = makeBus();
    expect(bus.read8(0xff26)).toBe(0xff); // init: stored $FF → channel flags + $70

    bus.write8(0xff26, 0x80);
    expect(bus.read8(0xff26)).toBe(0xf0);

    bus.write8(0xff26, 0x00);
    expect(bus.read8(0xff26)).toBe(0x70);
  });

  test('wave RAM $FF30–$FF3F stores bytes', () => {
    const { bus } = makeBus();
    bus.write8(0xff30, 0x12);
    bus.write8(0xff3f, 0xab);
    expect(bus.read8(0xff30)).toBe(0x12);
    expect(bus.read8(0xff3f)).toBe(0xab);
  });

  test('unmapped I/O holes still read $FF', () => {
    const { bus } = makeBus();
    expect(bus.read8(0xff03)).toBe(0xff);
    expect(bus.read8(0xff08)).toBe(0xff);
  });

  test('writes to unmapped holes are ignored', () => {
    const { bus } = makeBus();
    bus.write8(0xff03, 0x42);
    expect(bus.read8(0xff03)).toBe(0xff);
  });

  test('power-off clears channel registers', () => {
    const { bus } = makeBus();
    bus.write8(0xff26, 0x80);
    bus.write8(0xff16, 0xc0);
    expect(bus.read8(0xff16)).toBe(0xc0);

    bus.write8(0xff26, 0x00);
    expect(bus.read8(0xff16)).toBe(0x00);
  });

  test('power-off clears wave RAM', () => {
    const { bus } = makeBus();
    bus.write8(0xff26, 0x80);
    bus.write8(0xff30, 0xab);
    expect(bus.read8(0xff30)).toBe(0xab);

    bus.write8(0xff26, 0x00);
    expect(bus.read8(0xff30)).toBe(0x00);
  });

  test('APU and wave RAM writes are ignored while powered off', () => {
    const { bus } = makeBus();
    bus.write8(0xff26, 0x00);
    bus.write8(0xff16, 0xc0);
    bus.write8(0xff30, 0xab);
    expect(bus.read8(0xff16)).toBe(0x00);
    expect(bus.read8(0xff30)).toBe(0x00);
  });
});

describe('chapter 15 checkpoint', () => {
  test('APU registers survive reset (re-seeded to post-boot values)', () => {
    const emu = createEmu(new Uint8Array(0x8000));
    reset(emu);
    emu.bus.write8(0xff14, 0x80);
    expect(emu.bus.read8(0xff14)).toBe(0x80);

    reset(emu);
    expect(emu.bus.read8(0xff14)).toBe(0xbf); // NR14 post-boot
  });

  test('games can read NR52 after configuring channel 2', () => {
    const { bus } = makeBus();
    bus.write8(0xff26, 0x80);
    bus.write8(0xff16, 0xc0); // NR21 duty/volume
    bus.write8(0xff19, 0x80); // NR24 trigger
    expect(bus.read8(0xff16)).toBe(0xc0);
    expect(bus.read8(0xff26) & 0x80).toBe(0x80);
  });

  test('skip-boot seeds NR10–NR52 to DMG post-boot values', () => {
    const emu = createEmu(new Uint8Array(0x8000));
    reset(emu);
    expect(emu.bus.read8(0xff10)).toBe(0x80); // NR10
    expect(emu.bus.read8(0xff12)).toBe(0xf3); // NR12
    expect(emu.bus.read8(0xff16)).toBe(0x3f); // NR21
    expect(emu.bus.read8(0xff24)).toBe(0x77); // NR50
    expect(emu.bus.read8(0xff25)).toBe(0xf3); // NR51
    expect(emu.bus.read8(0xff26)).toBe(0xf1); // NR52
  });
});
