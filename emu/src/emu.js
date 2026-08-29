import { createBus } from './bus.js';
import { createIo } from './io.js';
import { skipBoot } from './skipboot.js';
import { cbOps, createCpu, ops, step } from './ops/index.js';
import { handleHalt, serviceIfNeeded, tickImeCountdown } from './interrupts.js';

/** One DMG frame in T-cycles (456 dots × 154 lines). */
export const FRAME_T = 70224;

export function createEmu(rom) {
  const io = createIo();
  const bus = createBus({ rom, io });
  const cpu = createCpu(bus);
  return { cpu, bus, io, rom };
}

export function reset(emu) {
  skipBoot(emu);
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

export function runN(emu, n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    const dt = cpuStep(emu);
    timerStep(emu.io, dt);
    t += dt;
  }
  return t;
}

/** Run until `target` T-cycles have elapsed. When halted, spin without fetch. */
export function runTCycles(emu, target) {
  let t = 0;
  while (t < target) {
    const dt = cpuStep(emu);
    timerStep(emu.io, dt);
    t += dt;
  }
  return t;
}
