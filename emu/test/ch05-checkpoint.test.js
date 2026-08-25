import { describe, expect, test } from 'bun:test';
import { createEmu, FRAME_T, reset, runN, runTCycles } from '../src/emu.js';
import { cbOps, ops, step } from '../src/ops/index.js';

/** Minimal 32 KiB ROM with entry at $0100 and a nonzero header checksum. */
function gameRom() {
  const rom = new Uint8Array(0x8000).fill(0xff);
  rom[0x100] = 0xc3; // JP $0150
  rom[0x101] = 0x50;
  rom[0x102] = 0x01;
  rom[0x150] = 0x3e; // LD A, $42
  rom[0x151] = 0x42;
  rom[0x152] = 0x76; // HALT
  rom[0x14d] = 0x01;
  return rom;
}

describe('chapter 5 checkpoint', () => {
  test('skip-boot CPU state', () => {
    const emu = createEmu(gameRom());
    reset(emu);
    const { cpu } = emu;
    expect(cpu.pc).toBe(0x0100);
    expect(cpu.sp).toBe(0xfffe);
    expect(cpu.a).toBe(0x01);
    expect(cpu.f).toBe(0xb0);
    expect(cpu.b).toBe(0x00);
    expect(cpu.c).toBe(0x13);
    expect(cpu.d).toBe(0x00);
    expect(cpu.e).toBe(0xd8);
    expect(cpu.h).toBe(0x01);
    expect(cpu.l).toBe(0x4d);
    expect(cpu.ime).toBe(false);
    expect(cpu.halted).toBe(false);
  });

  test('skip-boot F when header checksum is zero', () => {
    const rom = gameRom();
    rom[0x14d] = 0x00;
    const emu = createEmu(rom);
    reset(emu);
    expect(emu.cpu.f).toBe(0x80);
  });

  test('skip-boot I/O registers', () => {
    const emu = createEmu(gameRom());
    reset(emu);
    expect(emu.io.regs[0x40]).toBe(0x91);
    expect(emu.io.regs[0x47]).toBe(0xfc);
    expect(emu.io.regs[0x0f]).toBe(0xe1);
    expect(emu.bus.ie).toBe(0);
  });

  test('first step leaves $0100 (JP entry)', () => {
    const emu = createEmu(gameRom());
    reset(emu);
    step(emu.cpu, ops, cbOps);
    expect(emu.cpu.pc).not.toBe(0x0100);
  });

  test('LD (HL), A at $FFFE does not corrupt IE', () => {
    const emu = createEmu(new Uint8Array(0x8000));
    reset(emu);
    emu.cpu.h = 0xff;
    emu.cpu.l = 0xfe;
    emu.cpu.a = 0x55;
    emu.bus.ie = 0xab;
    emu.cpu.pc = 0xc000;
    emu.bus.write8(0xc000, 0x77); // LD (HL), A
    step(emu.cpu, ops, cbOps);
    expect(emu.bus.read8(0xfffe)).toBe(0x55);
    expect(emu.bus.ie).toBe(0xab);
  });

  test('run thousands of instructions without throw', () => {
    const emu = createEmu(gameRom());
    reset(emu);
    expect(() => runN(emu, 5000)).not.toThrow();
    expect(emu.cpu.halted).toBe(true);
    expect(emu.cpu.a).toBe(0x42);
  });

  test('runTCycles spins when halted without advancing PC', () => {
    const emu = createEmu(gameRom());
    reset(emu);
    runN(emu, 3);
    expect(emu.cpu.halted).toBe(true);
    const pc = emu.cpu.pc;
    expect(runTCycles(emu, FRAME_T)).toBe(FRAME_T);
    expect(emu.cpu.pc).toBe(pc);
  });
});
