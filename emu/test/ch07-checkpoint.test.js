import { describe, expect, test } from 'bun:test';
import { createEmu, reset, runN } from '../src/emu.js';

/** 32 KiB ROM of NOPs so skip-boot at $0100 just burns T-cycles. */
function nopRom() {
  return new Uint8Array(0x8000);
}

describe('chapter 7 checkpoint', () => {
  test('skip-boot DIV reads $AB; TIMA/TMA/TAC are post-boot', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    expect(emu.bus.read8(0xff04)).toBe(0xab);
    expect(emu.bus.read8(0xff05)).toBe(0);
    expect(emu.bus.read8(0xff06)).toBe(0);
    expect(emu.bus.read8(0xff07)).toBe(0xf8);
  });

  test('256 NOPs advance DIV by 4', () => {
    const emu = createEmu(nopRom());
    reset(emu);

    runN(emu, 256); // 256 × 4 T = 1024 T-cycles → DIV +4

    expect(emu.bus.read8(0xff04)).toBe(0xaf);
  });

  test('write to DIV resets the divider', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    runN(emu, 256);
    expect(emu.bus.read8(0xff04)).not.toBe(0);

    emu.bus.write8(0xff04, 0xff);
    expect(emu.bus.read8(0xff04)).toBe(0);
  });

  test('TIMA increments when TAC enables 262144 Hz', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    emu.bus.write8(0xff04, 0); // known phase
    emu.bus.write8(0xff05, 0);
    emu.bus.write8(0xff06, 0);
    emu.bus.write8(0xff07, 0x05); // enable, 16 T-cycles per tick

    runN(emu, 40); // 160 T-cycles → TIMA ≈ 10

    const tima = emu.bus.read8(0xff05);
    expect(tima).toBeGreaterThanOrEqual(8);
    expect(tima).toBeLessThanOrEqual(12);
  });

  test('TIMA overflow reloads TMA and requests IF bit 2', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    emu.bus.write8(0xff0f, 0);
    emu.bus.write8(0xff04, 0);
    emu.bus.write8(0xff06, 0x05);
    emu.bus.write8(0xff05, 0xff);
    emu.bus.write8(0xff07, 0x05);

    runN(emu, 4); // 16 T-cycles — one tick at 262144 Hz

    expect(emu.bus.read8(0xff05)).toBe(0x05);
    expect(emu.io.ifBits() & 0x04).toBe(0x04);
  });
});
