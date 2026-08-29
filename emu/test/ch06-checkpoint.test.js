import { describe, expect, test } from 'bun:test';
import { createEmu, cpuStep, reset } from '../src/emu.js';

/** 32 KiB ROM of NOPs so $0150 is a safe plant address. */
function nopRom() {
  return new Uint8Array(0x8000);
}

function stackedPc(emu) {
  const lo = emu.bus.read8(emu.cpu.sp);
  const hi = emu.bus.read8((emu.cpu.sp + 1) & 0xffff);
  return ((hi << 8) | lo) & 0xffff;
}

describe('chapter 6 checkpoint', () => {
  test('IME + IE + IF services VBlank at $0040', () => {
    const emu = createEmu(nopRom());
    reset(emu);
    emu.bus.ie = 0x01;
    emu.bus.write8(0xff0f, 0x01);
    emu.cpu.ime = true;
    emu.cpu.pc = 0x0150;
    const sp = emu.cpu.sp;

    cpuStep(emu);

    expect(emu.cpu.pc).toBe(0x0040);
    expect(emu.cpu.ime).toBe(false);
    expect(emu.io.ifBits() & 0x01).toBe(0);
    expect(emu.cpu.sp).toBe((sp - 2) & 0xffff);
    expect(stackedPc(emu)).toBe(0x0151);
  });

  test('HALT wakes on IE & IF without jumping when IME is 0', () => {
    const rom = nopRom();
    rom[0x150] = 0x76; // HALT
    const emu = createEmu(rom);
    reset(emu);
    emu.bus.ie = 0x01;
    emu.bus.write8(0xff0f, 0x01);
    emu.cpu.ime = false;
    emu.cpu.pc = 0x0150;

    cpuStep(emu);
    for (let i = 0; i < 4 && emu.cpu.halted; i++) cpuStep(emu);

    expect(emu.cpu.halted).toBe(false);
    expect(emu.cpu.pc).toBe(0x0151);
    expect(emu.cpu.pc).not.toBe(0x0040);
    expect(emu.cpu.ime).toBe(false);
  });

  test('EI enables IME only after the following instruction', () => {
    const rom = nopRom();
    rom[0x150] = 0xfb; // EI
    rom[0x151] = 0x00; // NOP
    const emu = createEmu(rom);
    reset(emu);
    emu.bus.ie = 0;
    emu.bus.write8(0xff0f, 0);
    emu.cpu.ime = false;
    emu.cpu.pc = 0x0150;

    cpuStep(emu);
    expect(emu.cpu.ime).toBe(false);
    expect(emu.cpu.pc).toBe(0x0151);

    cpuStep(emu);
    expect(emu.cpu.ime).toBe(true);
  });
});
