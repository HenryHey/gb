import { createBus } from './bus.js';
import { createIo } from './io.js';
import { createJoypad } from './joypad.js';
import { skipBoot } from './skipboot.js';
import { createPpu, ppuStep } from './ppu.js';
import { cbOps, createCpu, ops, step } from './ops/index.js';
import { handleHalt, serviceIfNeeded, tickImeCountdown } from './interrupts.js';

/** One DMG frame in T-cycles (456 dots × 154 lines). */
export const FRAME_T = 70224;

export function createEmu(rom) {
  const io = createIo();
  const ppu = createPpu();
  const bus = createBus({ rom, io, ppu });
  const cpu = createCpu(bus);
  return { cpu, bus, io, rom, ppu };
}

export function reset(emu) {
  emu.bus.vram.fill(0);
  emu.bus.oam.fill(0);
  emu.bus.wram.fill(0);
  emu.bus.hram.fill(0);

  emu.io.regs.fill(0xff);
  emu.io.serialOut.length = 0;
  emu.io.divCounter = 0;
  emu.io.tima = 0;
  emu.io.tma = 0;
  emu.io.tac = 0;
  Object.assign(emu.io.joypad, createJoypad());

  Object.assign(emu.ppu, createPpu());
  skipBoot(emu);
  emu.ppu.lcdc = emu.io.regs[0x40];
  emu.ppu.bgp = emu.io.regs[0x47];
  emu.ppu.framebuffer.fill(255);
}

export function cpuStep(emu) {
  const { cpu } = emu;
  const t = cpu.halted ? handleHalt(emu) : step(cpu, ops, cbOps);
  tickImeCountdown(cpu);
  const extra = serviceIfNeeded(emu);
  return t + extra;
}

function incrementTima(io) {
  io.tima = (io.tima + 1) & 0xff;
  if (io.tima === 0) {
    io.tima = io.tma;
    io.requestIf(2);
  }
}

function timerStep(io, tCycles) {
  for (let i = 0; i < tCycles; i++) {
    io.divCounter = (io.divCounter + 1) & 0xffff;
    if (!(io.tac & 0x04)) continue;
    const bit = [9, 3, 5, 7][io.tac & 3];
    const oldBit = (io.divCounter - 1) & (1 << bit);
    const newBit = io.divCounter & (1 << bit);
    if (oldBit && !newBit) incrementTima(io);
  }
}

/** Advance CPU, timer, and PPU by one instruction (or HALT spin). */
export function tickEmu(emu) {
  const dt = cpuStep(emu);
  timerStep(emu.io, dt);
  ppuStep(emu.ppu, emu.io, dt, emu.bus.vram, emu.bus.oam);
  const extra = serviceIfNeeded(emu);
  if (extra) {
    timerStep(emu.io, extra);
    ppuStep(emu.ppu, emu.io, extra, emu.bus.vram, emu.bus.oam);
  }
  return dt + extra;
}

export function runN(emu, n) {
  let t = 0;
  for (let i = 0; i < n; i++) t += tickEmu(emu);
  return t;
}

/** Run until `target` T-cycles have elapsed. When halted, spin without fetch. */
export function runTCycles(emu, target) {
  let t = 0;
  while (t < target) t += tickEmu(emu);
  return t;
}

/** Run exactly one DMG frame (70224 T-cycles). */
export function runFrame(emu) {
  return runTCycles(emu, FRAME_T);
}
