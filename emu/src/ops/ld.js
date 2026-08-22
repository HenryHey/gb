import {
  dec16,
  inc16,
  r16,
  r16Map,
  r8,
  r8n,
  r8nMap,
  rMem8,
  readImm8,
  readImm16,
  setZNHC,
  toSigned,
  w8,
  w16,
  wMem8,
  Z,
  N,
  H,
  C,
} from './helpers.js';

export function push16(cpu, v) {
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, v >> 8);
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, v & 0xff);
  return 16;
}

export function registerLdOps(def) {
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
  def(0x01, 'LD BC, n16', (cpu) => ld16(cpu, r16Map.BC, readImm16(cpu)), 3);
  def(0x11, 'LD DE, n16', (cpu) => ld16(cpu, r16Map.DE, readImm16(cpu)), 3);
  def(0x21, 'LD HL, n16', (cpu) => ld16(cpu, r16Map.HL, readImm16(cpu)), 3);
  def(0x31, 'LD SP, n16', (cpu) => ld16(cpu, r16Map.SP, readImm16(cpu)), 3);

  // LD [nn], r8 instructions
  function lda8(cpu, dst, src) {
    wMem8[dst](cpu, r8[src](cpu));
    return 8;
  }
  def(0x02, 'LD (nn), r8', (cpu) => lda8(cpu, r16Map.BC, r8nMap.A), 2);
  def(0x12, 'LD (nn), r8', (cpu) => lda8(cpu, r16Map.DE, r8nMap.A), 2);

  // LDI (LD [HL+], A)
  function ldi(cpu) {
    w8[r8nMap['(HL)']](cpu, cpu.a);
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

  // LD instructions for all combinations of r8 and w8 (0x40 - 0x7f)
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

  // LD A, [nn] instructions
  function ld8Mem(cpu, src) {
    cpu.a = rMem8[src](cpu);
    return 8;
  }
  def(0x0a, 'LD A, [BC]', (cpu) => ld8Mem(cpu, r16Map.BC));
  def(0x1a, 'LD A, [DE]', (cpu) => ld8Mem(cpu, r16Map.DE));

  // LD A, [HL+] instruction
  function ld8MemInc(cpu) {
    cpu.a = rMem8[r16Map.HL](cpu);
    inc16(cpu, r16Map.HL);
    return 8;
  }
  def(0x2a, 'LD A, [HL+]', ld8MemInc);

  // LD A, [HL-] instruction
  function ld8MemDec(cpu) {
    cpu.a = rMem8[r16Map.HL](cpu);
    dec16(cpu, r16Map.HL);
    return 8;
  }
  def(0x3a, 'LD A, [HL-]', ld8MemDec);

  // LDH (n), A instruction
  function ldh8(cpu) {
    cpu.bus.write8(0xff00 | readImm8(cpu), cpu.a);
    return 12;
  }
  def(0xe0, 'LDH (n), A', ldh8, 2);

  // LDH A, [n] instruction
  function ldh8Mem(cpu) {
    cpu.a = cpu.bus.read8(0xff00 | readImm8(cpu));
    return 12;
  }
  def(0xf0, 'LDH A, [n]', ldh8Mem, 2);

  // LDH (C), A instruction
  function ldh8C(cpu) {
    cpu.bus.write8(0xff00 | cpu.c, cpu.a);
    return 8;
  }
  def(0xe2, 'LDH (C), A', ldh8C);

  // LD A, [C] instruction
  function ldh8MemC(cpu) {
    cpu.a = cpu.bus.read8(0xff00 | cpu.c);
    return 8;
  }
  def(0xf2, 'LD A, [C]', ldh8MemC);

  // LD [nn], A instruction
  function ld16A(cpu) {
    cpu.bus.write8(readImm16(cpu), r8[r8nMap.A](cpu));
    return 16;
  }
  def(0xea, 'LD (nn), A', ld16A, 3);

  // LD [nn], SP instruction
  function ld16SP(cpu) {
    cpu.bus.write16(readImm16(cpu), cpu.sp);
    return 20;
  }
  def(0x08, 'LD (nn), SP', ld16SP, 3);

  // LD HL, SP+e8 instruction
  function ld16SPInc(cpu) {
    const unsigned_e = readImm8(cpu);
    const e = toSigned(unsigned_e);
    w16[r16Map.HL](cpu, (cpu.sp + e) & 0xffff);
    setZNHC(cpu, {
      z: 0,
      n: 0,
      h: (cpu.sp & 0xf) + (unsigned_e & 0xf) > 0xf,
      c: (cpu.sp & 0xff) + unsigned_e > 0xff,
    });
    return 12;
  }
  def(0xf8, 'LD HL, SP+e8', ld16SPInc, 2);

  // LD SP, HL instruction
  function ld16SPHL(cpu) {
    cpu.sp = r16[r16Map.HL](cpu);
    return 8;
  }
  def(0xf9, 'LD SP, HL', ld16SPHL);

  // LD A, (nn) instruction
  function ld16Mem(cpu) {
    cpu.a = cpu.bus.read8(readImm16(cpu));
    return 16;
  }
  def(0xfa, 'LD A, (nn)', ld16Mem, 3);

  def(0xc5, 'PUSH BC', (cpu) => push16(cpu, r16[r16Map.BC](cpu)));
  def(0xd5, 'PUSH DE', (cpu) => push16(cpu, r16[r16Map.DE](cpu)));
  def(0xe5, 'PUSH HL', (cpu) => push16(cpu, r16[r16Map.HL](cpu)));
  def(0xf5, 'PUSH AF', (cpu) => push16(cpu, r16[r16Map.AF](cpu)));

  function pop16(cpu, r) {
    const lo = cpu.bus.read8(cpu.sp);
    cpu.sp = (cpu.sp + 1) & 0xffff;
    const hi = cpu.bus.read8(cpu.sp);
    cpu.sp = (cpu.sp + 1) & 0xffff;
    w16[r](cpu, (hi << 8) | lo);
    if (r === r16Map.AF) {
      setZNHC(cpu, {
        z: cpu.f & Z ? 1 : 0,
        n: cpu.f & N ? 1 : 0,
        h: cpu.f & H ? 1 : 0,
        c: cpu.f & C ? 1 : 0,
      });
    }
    return 12;
  }
  def(0xc1, 'POP BC', (cpu) => pop16(cpu, r16Map.BC));
  def(0xd1, 'POP DE', (cpu) => pop16(cpu, r16Map.DE));
  def(0xe1, 'POP HL', (cpu) => pop16(cpu, r16Map.HL));
  def(0xf1, 'POP AF', (cpu) => pop16(cpu, r16Map.AF));
}
