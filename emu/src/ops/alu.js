import {
  dec8,
  dec16,
  inc8,
  inc16,
  r16,
  r16Map,
  r8,
  r8n,
  r8nMap,
  readImm8,
  setZNHC,
  toSigned,
  w16,
  Z,
  C,
  N,
  H,
} from './helpers.js';

export function registerAluOps(def) {
  // ADD A, r8 and ADD A, n8 instructions
  function add8(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const result = (cpu.a + src) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 0,
      h: (cpu.a & 0xf) + (src & 0xf) > 0xf ? 1 : 0,
      c: (cpu.a & 0xff) + (src & 0xff) > 0xff ? 1 : 0,
    });
    cpu.a = result;
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0x80 | src, `ADD A, ${r8n[src]}`, (cpu) => add8(cpu, src, false));
  }

  def(0xc6, 'ADD A, n8', (cpu) => add8(cpu, null));

  // ADD HL, r16 and ADD HL, n16 instructions
  function add16(cpu, r) {
    const src = r16[r](cpu);
    const hl = r16[r16Map.HL](cpu);
    const result = hl + src;
    setZNHC(cpu, {
      z: cpu.f & Z ? 1 : 0,
      n: 0,
      h: (hl & 0xfff) + (src & 0xfff) > 0xfff ? 1 : 0,
      c: (hl & 0xffff) + (src & 0xffff) > 0xffff ? 1 : 0,
    });
    w16[r16Map.HL](cpu, result);
    return 8;
  }
  def(0x09, `ADD HL, BC`, (cpu) => add16(cpu, r16Map.BC));
  def(0x19, `ADD HL, DE`, (cpu) => add16(cpu, r16Map.DE));
  def(0x29, `ADD HL, HL`, (cpu) => add16(cpu, r16Map.HL));
  def(0x39, `ADD HL, SP`, (cpu) => add16(cpu, r16Map.SP));

  // ADD SP, e8 instructions
  function addSp(cpu) {
    const unsigned_e = readImm8(cpu);
    const e = toSigned(unsigned_e);
    const sp = r16[r16Map.SP](cpu);
    setZNHC(cpu, {
      z: 0,
      n: 0,
      h: (cpu.sp & 0xf) + (unsigned_e & 0xf) > 0xf,
      c: (cpu.sp & 0xff) + unsigned_e > 0xff,
    });
    w16[r16Map.SP](cpu, sp + e);
    return 16;
  }
  def(0xe8, `ADD SP, e8`, (cpu) => addSp(cpu), 2);

  // ADC A, r8 and ADC A, n8 instructions
  function adc(cpu, r) {
    const cycles = r === r8nMap['(HL)'] || r === null ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const c = cpu.f & C ? 1 : 0;
    const result = (cpu.a + src + c) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 0,
      h: (cpu.a & 0xf) + (src & 0xf) + c > 0xf ? 1 : 0,
      c: (cpu.a & 0xff) + (src & 0xff) + c > 0xff ? 1 : 0,
    });
    cpu.a = result;
    return cycles;
  }

  for (let src = 0; src < 8; src++) {
    def(0x88 | src, `ADC A, ${r8n[src]}`, (cpu) => adc(cpu, src));
  }
  def(0xce, 'ADC A, n8', (cpu) => adc(cpu, null));

  // SUB A, r8 and SUB A, n8 instructions
  function sub8(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const result = (cpu.a - src) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 1,
      h: (cpu.a & 0xf) - (src & 0xf) < 0 ? 1 : 0,
      c: (cpu.a & 0xff) - (src & 0xff) < 0 ? 1 : 0,
    });
    cpu.a = result;
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0x90 | src, `SUB A, ${r8n[src]}`, (cpu) => sub8(cpu, src));
  }
  def(0xd6, 'SUB A, n8', (cpu) => sub8(cpu, null));

  // SBC A, r8 and SBC A, n8 instructions
  function sbc(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const c = cpu.f & C ? 1 : 0;
    const result = (cpu.a - src - c) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 1,
      h: (cpu.a & 0xf) - (src & 0xf) - c < 0 ? 1 : 0,
      c: (cpu.a & 0xff) - (src & 0xff) - c < 0 ? 1 : 0,
    });
    cpu.a = result;
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0x98 | src, `SBC A, ${r8n[src]}`, (cpu) => sbc(cpu, src));
  }
  def(0xde, 'SBC A, n8', (cpu) => sbc(cpu, null));

  // AND A, r8 and AND A, n8 instructions
  function and8(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const result = cpu.a & src & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 0,
      h: 1,
      c: 0,
    });
    cpu.a = result;
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0xa0 | src, `AND A, ${r8n[src]}`, (cpu) => and8(cpu, src));
  }
  def(0xe6, 'AND A, n8', (cpu) => and8(cpu, null));

  // XOR A, r8 and XOR A, n8 instructions
  function xor8(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const result = (cpu.a ^ src) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 0,
      h: 0,
      c: 0,
    });
    cpu.a = result;
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0xa8 | src, `XOR A, ${r8n[src]}`, (cpu) => xor8(cpu, src));
  }
  def(0xee, 'XOR A, n8', (cpu) => xor8(cpu, null));

  // OR A, r8 and OR A, n8 instructions
  function or8(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const result = (cpu.a | src) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 0,
      h: 0,
      c: 0,
    });
    cpu.a = result;
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0xb0 | src, `OR A, ${r8n[src]}`, (cpu) => or8(cpu, src));
  }
  def(0xf6, 'OR A, n8', (cpu) => or8(cpu, null));

  // CP A, r8 and CP A, n8 instructions
  function cp8(cpu, r) {
    const cycles = r === null || r === r8nMap['(HL)'] ? 8 : 4;
    const src = r === null ? readImm8(cpu) : r8[r](cpu);
    const result = (cpu.a - src) & 0xff;
    setZNHC(cpu, {
      z: result === 0 ? 1 : 0,
      n: 1,
      h: (cpu.a & 0xf) - (src & 0xf) < 0 ? 1 : 0,
      c: (cpu.a & 0xff) - (src & 0xff) < 0 ? 1 : 0,
    });
    return cycles;
  }
  for (let src = 0; src < 8; src++) {
    def(0xb8 | src, `CP A, ${r8n[src]}`, (cpu) => cp8(cpu, src));
  }
  def(0xfe, 'CP A, n8', (cpu) => cp8(cpu, null));

  // INC r8 and INC (HL) instructions
  for (let src = 0; src < 8; src++) {
    def(0x04 | (src << 3), `INC ${r8n[src]}`, (cpu) => inc8(cpu, src));
  }

  // DEC r8 and DEC (HL) instructions
  for (let src = 0; src < 8; src++) {
    def(0x05 | (src << 3), `DEC ${r8n[src]}`, (cpu) => dec8(cpu, src));
  }

  // INC r16 instructions
  def(0x03, `INC BC`, (cpu) => inc16(cpu, r16Map.BC));
  def(0x13, `INC DE`, (cpu) => inc16(cpu, r16Map.DE));
  def(0x23, `INC HL`, (cpu) => inc16(cpu, r16Map.HL));
  def(0x33, `INC SP`, (cpu) => inc16(cpu, r16Map.SP));

  // DEC r16 instructions
  def(0x0b, `DEC BC`, (cpu) => dec16(cpu, r16Map.BC));
  def(0x1b, `DEC DE`, (cpu) => dec16(cpu, r16Map.DE));
  def(0x2b, `DEC HL`, (cpu) => dec16(cpu, r16Map.HL));
  def(0x3b, `DEC SP`, (cpu) => dec16(cpu, r16Map.SP));

  // RLCA instruction
  function rlca(cpu) {
    setZNHC(cpu, { z: 0, n: 0, h: 0, c: cpu.a & 0b10000000 ? 1 : 0 });
    cpu.a = ((cpu.a << 1) | (cpu.a >> 7)) & 0xff;
    return 4;
  }

  def(0x07, 'RLCA', (cpu) => rlca(cpu));

  // RLA instruction
  function rla(cpu) {
    const c = cpu.f & C ? 1 : 0;
    setZNHC(cpu, { z: 0, n: 0, h: 0, c: cpu.a & 0b10000000 ? 1 : 0 });
    cpu.a = ((cpu.a << 1) | c) & 0xff;
    return 4;
  }

  def(0x17, 'RLA', (cpu) => rla(cpu));

  // RRCA instruction
  function rrca(cpu) {
    setZNHC(cpu, { z: 0, n: 0, h: 0, c: cpu.a & 0b00000001 ? 1 : 0 });
    cpu.a = ((cpu.a >> 1) | (cpu.a << 7)) & 0xff;
    return 4;
  }

  def(0x0f, 'RRCA', (cpu) => rrca(cpu));

  // RRA instruction
  function rra(cpu) {
    const c = cpu.f & C ? 1 : 0;
    setZNHC(cpu, { z: 0, n: 0, h: 0, c: cpu.a & 0b00000001 ? 1 : 0 });
    cpu.a = ((cpu.a >> 1) | (c << 7)) & 0xff;
    return 4;
  }

  def(0x1f, 'RRA', (cpu) => rra(cpu));

  // CPL instruction
  function cpl(cpu) {
    setZNHC(cpu, { z: cpu.f & Z ? 1 : 0, n: 1, h: 1, c: cpu.f & C ? 1 : 0 });
    cpu.a = ~cpu.a & 0xff;
    return 4;
  }

  def(0x2f, 'CPL', (cpu) => cpl(cpu));

  // SCF instruction
  function scf(cpu) {
    setZNHC(cpu, { z: cpu.f & Z ? 1 : 0, n: 0, h: 0, c: 1 });
    return 4;
  }

  def(0x37, 'SCF', (cpu) => scf(cpu));

  // CCF instruction
  function ccf(cpu) {
    setZNHC(cpu, { z: cpu.f & Z ? 1 : 0, n: 0, h: 0, c: cpu.f & C ? 0 : 1 });
    return 4;
  }

  def(0x3f, 'CCF', (cpu) => ccf(cpu));

  // DAA instruction
  function daa(cpu) {
    let adjustment = 0;
    let _c = cpu.f & C ? 1 : 0;
    if (cpu.f & N) {
      if (cpu.f & H) {
        adjustment += 0x06;
      }

      if (cpu.f & C) {
        adjustment += 0x60;
      }

      cpu.a = (cpu.a - adjustment) & 0xff;
    } else {
      if (cpu.f & H || (cpu.a & 0x0f) > 9) {
        adjustment += 0x06;
      }

      if (cpu.f & C || cpu.a > 0x99) {
        adjustment += 0x60;
        _c = 1;
      }
      cpu.a = (cpu.a + adjustment) & 0xff;
    }
    setZNHC(cpu, {
      z: cpu.a === 0 ? 1 : 0,
      n: cpu.f & N ? 1 : 0,
      h: 0,
      c: _c,
    });
    return 4;
  }

  def(0x27, 'DAA', (cpu) => daa(cpu));
}
