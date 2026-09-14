import { createBus } from './bus.js';
import { createCart } from './cart.js';
import { createIo } from './io.js';
import { createJoypad } from './joypad.js';
import { skipBoot } from './skipboot.js';
import { createPpu, ppuStep } from './ppu.js';
import { cbOps, createCpu, ops, step } from './ops/index.js';
import { handleHalt, serviceIfNeeded, tickImeCountdown } from './interrupts.js';
import { timerStep } from './timer.js';

/** One DMG frame in T-cycles (456 dots × 154 lines). */
export const FRAME_T = 70224;

export function createEmu(rom, { onCartRamWrite } = {}) {
  const io = createIo();
  const ppu = createPpu();
  const romBuf =
    rom.length >= 0x150 ? rom : Uint8Array.from({ length: 0x150 }, (_, i) => rom[i] ?? 0);
  const cart = createCart(romBuf);
  const bus = createBus({ cart, io, ppu, onCartRamWrite });
  const cpu = createCpu(bus);
  return { cpu, bus, io, rom: romBuf, cart, ppu, frameRemainder: 0 };
}

export function reset(emu) {
  emu.cart.reset();
  emu.bus.resetDma();
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
  emu.frameRemainder = 0;
}

export function cpuStep(emu) {
  const { cpu } = emu;
  const t = cpu.halted ? handleHalt(emu) : step(cpu, ops, cbOps);
  tickImeCountdown(cpu);
  const extra = serviceIfNeeded(emu);
  return t + extra;
}

/** Advance CPU, timer, and PPU by one instruction (or HALT spin). */
export function tickEmu(emu) {
  const dt = cpuStep(emu);
  emu.bus.dmaStep(dt);
  timerStep(emu.io, dt);
  ppuStep(emu.ppu, emu.io, dt, emu.bus.vram, emu.bus.oam);
  const extra = serviceIfNeeded(emu);
  if (extra) {
    emu.bus.dmaStep(extra);
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

/**
 * Run one DMG frame (70224 T-cycles). Instruction-level stepping may overshoot
 * the per-frame budget; `frameRemainder` carries overshoot into the next call
 * so N frames advance N × 70224 T-cycles (plus the last frame's overshoot).
 */
export function runFrame(emu) {
  const budget = FRAME_T - emu.frameRemainder;
  const ran = runTCycles(emu, budget);
  emu.frameRemainder = ran - budget;
  return ran;
}
