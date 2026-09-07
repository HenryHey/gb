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

function lowestPendingBit(emu) {
  const pending = emu.bus.ie & emu.io.ifBits() & 0x1f;
  if (!pending) return -1;
  for (let bit = 0; bit < 5; bit++) {
    if (pending & (1 << bit)) return bit;
  }
  return -1;
}

export function serviceIfNeeded(emu) {
  const pending = emu.bus.ie & emu.io.ifBits() & 0x1f;
  if (!pending) return 0;

  emu.cpu.halted = false;

  if (!emu.cpu.ime) return 0;

  const { cpu } = emu;
  const returnPc = cpu.pc;

  cpu.ime = false;

  // M1 - high byte (real bus write; may hit $FFFF / IE)
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, (returnPc >> 8) & 0xff);

  let bit = lowestPendingBit(emu);
  if (bit < 0) {
    cpu.pc = 0x0000;
    return 20;
  }

  // M2 - low byte (cancellation no longer possible)
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, returnPc & 0xff);

  const updated = lowestPendingBit(emu);
  if (updated >= 0) bit = updated; // round 4: priority can change after M1

  emu.io.ackIf(bit);
  cpu.pc = 0x0040 + bit * 8;
  return 20;
}

export function tickImeCountdown(cpu) {
  if (cpu.imeEnableCountdown > 0) {
    cpu.imeEnableCountdown--;
    if (cpu.imeEnableCountdown === 0) {
      cpu.ime = true;
    }
  }
}
