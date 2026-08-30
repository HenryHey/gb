import { push16 } from './ops/ld.js';

export function handleHalt(emu) {
  // Stay halted; still return a chunk of T-cycles so PPU/timer advance.
  // 4 T-cycles per "step" is fine.
  if ((emu.bus.ie & emu.io.ifBits() & 0x1f) !== 0) {
    emu.cpu.halted = false;
    // If IME, serviceIfNeeded will run after this and jump.
    // If !IME, execution continues at PC+1 (HALT already consumed).
  }
  return 4;
}

export function serviceIfNeeded(emu) {
  const pending = emu.bus.ie & emu.io.ifBits() & 0x1f;
  if (!pending) return 0;

  emu.cpu.halted = false; // wake even if IME is 0

  if (!emu.cpu.ime) return 0;

  emu.cpu.ime = false;
  for (let bit = 0; bit < 5; bit++) {
    if (pending & (1 << bit)) {
      emu.io.ackIf(bit); // clear that IF bit
      push16(emu.cpu, emu.cpu.pc);
      emu.cpu.pc = 0x0040 + bit * 8;
      return 20; // 5 M-cycles, common convention
    }
  }
  return 0;
}

export function tickImeCountdown(cpu) {
  if (cpu.imeEnableCountdown > 0) {
    cpu.imeEnableCountdown--;
    if (cpu.imeEnableCountdown === 0) {
      cpu.ime = true;
    }
  }
}
