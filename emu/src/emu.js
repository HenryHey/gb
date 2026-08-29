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

export function runN(emu, n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += cpuStep(emu);
  }
  return t;
}

/** Run until `target` T-cycles have elapsed. When halted, spin without fetch. */
export function runTCycles(emu, target) {
  let t = 0;
  const { cpu } = emu;
  while (t < target) {
    if (cpu.halted) {
      t += Math.min(4, target - t);
      continue;
    }
    t += cpuStep(emu);
  }
  return t;
}
