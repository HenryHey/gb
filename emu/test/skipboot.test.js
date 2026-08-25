import { describe, expect, test } from 'bun:test';
import { createEmu } from '../src/emu.js';
import { skipBoot } from '../src/skipboot.js';
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

describe('skipBoot', () => {
  test('after load, skipBoot applies DMG post-boot state', () => {
    const emu = createEmu(gameRom());
    expect(emu.cpu.pc).toBe(0);

    skipBoot(emu);

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
    expect(emu.io.regs[0x40]).toBe(0x91);
    expect(emu.io.regs[0x47]).toBe(0xfc);
    expect(emu.io.regs[0x0f]).toBe(0xe1);
    expect(emu.bus.ie).toBe(0);
  });

  test('F uses $80 when header checksum is zero', () => {
    const rom = gameRom();
    rom[0x14d] = 0x00;
    const emu = createEmu(rom);
    skipBoot(emu);
    expect(emu.cpu.f).toBe(0x80);
  });

  test('first step after skipBoot leaves cartridge entry', () => {
    const emu = createEmu(gameRom());
    skipBoot(emu);
    step(emu.cpu, ops, cbOps);
    expect(emu.cpu.pc).not.toBe(0x0100);
  });
});
