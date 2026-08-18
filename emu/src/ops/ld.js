export function registerLdOps(
  def,
  { readImm8, readImm16, r8n, r8nMap, r8, w8, r16Map, w16, wMem8, rMem8, inc16, dec16 },
) {
  // LD n8 instructions
  function ld8(cpu, r, v) {
    w8[r](cpu, v);
    return r === 6 ? 12 : 8;
  }
  def(0x06, 'LD B, n8', (cpu) => ld8(cpu, r8nMap.B, readImm8(cpu)), 2);
  def(0x16, 'LD D, n8', (cpu) => ld8(cpu, r8nMap.D, readImm8(cpu)), 2);
  def(0x26, 'LD H, n8', (cpu) => ld8(cpu, r8nMap.H, readImm8(cpu)), 2);
  def(0x36, 'LD (HL), n8', (cpu) => ld8(cpu, r8nMap['(HL)'], readImm8(cpu)), 2);
  def(0x0e, 'LD C, n8', (cpu) => ld8(cpu, r8nMap.C, readImm8(cpu)), 2);
  def(0x1e, 'LD E, n8', (cpu) => ld8(cpu, r8nMap.E, readImm8(cpu)), 2);
  def(0x2e, 'LD L, n8', (cpu) => ld8(cpu, r8nMap.L, readImm8(cpu)), 2);
  def(0x3e, 'LD A, n8', (cpu) => ld8(cpu, r8nMap.A, readImm8(cpu)), 2);

  // LD n16 instructions
  function ld16(cpu, r, v) {
    w16[r](cpu, v);
    return 12;
  }
  def(0x01, 'LD BC, n16', (cpu) => ld16(cpu, r16Map.BC, readImm16(cpu)), 2);
  def(0x11, 'LD DE, n16', (cpu) => ld16(cpu, r16Map.DE, readImm16(cpu)), 2);
  def(0x21, 'LD HL, n16', (cpu) => ld16(cpu, r16Map.HL, readImm16(cpu)), 2);
  def(0x31, 'LD SP, n16', (cpu) => ld16(cpu, r16Map.SP, readImm16(cpu)), 2);

  // LD [nn], r8 instructions
  function lda8(cpu, dst, src) {
    wMem8[dst](cpu, r8[src](cpu));
    return 8;
  }
  def(0x02, 'LD (nn), r8', (cpu) => lda8(cpu, r16Map.BC, r8nMap.A), 2);
  def(0x12, 'LD (nn), r8', (cpu) => lda8(cpu, r16Map.DE, r8nMap.A), 2);

  // LDI (LD [HL+], A)
  function ldi(cpu) {
    w8[r8nMap['(HL)']](cpu, r8[r8nMap.A](cpu));
    inc16(cpu, r16Map.HL);
    return 8;
  }
  def(0x22, 'LD (HL+), A', ldi);

  // LDD (LD [HL-], A)
  function ldd(cpu) {
    w8[r8nMap['(HL)']](cpu, r8[r8nMap.A](cpu));
    dec16(cpu, r16Map.HL);
    return 8;
  }
  def(0x32, 'LD (HL-), A', ldd);

  // Generate LD instructions for all combinations of r8 and w8 (0x40 - 0x7f)
  for (let dst = 0; dst < 8; dst++) {
    for (let src = 0; src < 8; src++) {
      const op = 0x40 | (dst << 3) | src;
      if (op === 0x76) continue; // Skip HALT
      def(op, `LD ${r8n[dst]}, ${r8n[src]}`, (cpu) => {
        w8[dst](cpu, r8[src](cpu));
        return dst === 6 || src === 6 ? 8 : 4;
      });
    }
  }

  // Generate LD A, [nn] instructions
  function ld8Mem(cpu, src) {
    w8[r8nMap.A](cpu, rMem8[src](cpu));
    return 8;
  }
  def(0x0a, 'LD A, [BC]', (cpu) => ld8Mem(cpu, r16Map.BC));
  def(0x1a, 'LD A, [DE]', (cpu) => ld8Mem(cpu, r16Map.DE));

  // Generate LD A, [HL+] instruction
  function ld8MemInc(cpu) {
    w8[r8nMap.A](cpu, rMem8[r16Map.HL](cpu));
    inc16(cpu, r16Map.HL);
    return 8;
  }
  def(0x2a, 'LD A, [HL+]', ld8MemInc);

  // Generate LD A, [HL-] instruction
  function ld8MemDec(cpu) {
    w8[r8nMap.A](cpu, rMem8[r16Map.HL](cpu));
    dec16(cpu, r16Map.HL);
    return 8;
  }
  def(0x3a, 'LD A, [HL-]', ld8MemDec);

  // Generate LDH (n), A instruction
  function ldh8(cpu) {
    cpu.bus.write8(0xff00 | readImm8(cpu), r8[r8nMap.A](cpu));
    return 12;
  }
  def(0xe0, 'LDH (n), A', ldh8, 2);

  // Generate LDH A, [n] instruction
  function ldh8Mem(cpu) {
    w8[r8nMap.A](cpu, cpu.bus.read8(0xff00 | readImm8(cpu)));
    return 12;
  }
  def(0xf0, 'LDH A, [n]', ldh8Mem, 2);

  // Generate LDH (C), A instruction
  function ldh8C(cpu) {
    cpu.bus.write8(0xff00 | r8[r8nMap.C](cpu), r8[r8nMap.A](cpu));
    return 8;
  }
  def(0xe2, 'LDH (C), A', ldh8C, 2);

  // Generate LD A, [C] instruction
  function ldh8MemC(cpu) {
    w8[r8nMap.A](cpu, cpu.bus.read8(0xff00 | r8[r8nMap.C](cpu)));
    return 8;
  }
  def(0xf2, 'LD A, [C]', ldh8MemC, 2);

  // Generate LD [nn], A instruction
  function ld16A(cpu) {
    cpu.bus.write8(readImm16(cpu), r8[r8nMap.A](cpu));
    return 16;
  }
  def(0xea, 'LD (nn), A', ld16A, 3);

  // Generate LD A, (nn) instruction
  function ld16Mem(cpu) {
    w8[r8nMap.A](cpu, cpu.bus.read8(readImm16(cpu)));
    return 16;
  }
  def(0xfa, 'LD A, (nn)', ld16Mem, 3);
}
