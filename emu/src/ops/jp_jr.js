import { readImm8, readImm16, r16, r16Map, Z, C, toSigned } from './helpers.js';

export function registerControlFlowOps(def) {
  // JP nn instruction
  function jp(cpu) {
    cpu.pc = readImm16(cpu);
    return 16;
  }
  def(0xc3, 'JP nn', (cpu) => jp(cpu), 3);

  // JP HL instruction
  function jpHL(cpu) {
    cpu.pc = r16[r16Map.HL](cpu);
    return 4;
  }
  def(0xe9, 'JP HL', (cpu) => jpHL(cpu));


  function cond(cpu, cc) {
    switch (cc) {
      case 0: return !(cpu.f & Z);
      case 1: return !!(cpu.f & Z);
      case 2: return !(cpu.f & C);
      case 3: return !!(cpu.f & C);
    }
  }

  // JP cc, nn
  function jpCond(cpu, opcode) {
    const new_pc = readImm16(cpu);
    if (cond(cpu, (opcode >> 3) & 3)) {
      cpu.pc = new_pc;
      return 16;
    }
    return 12;
  }

  const jpCondOpcodes = [0xC2, 0xD2, 0xCA, 0xDA]
  for (const opcode of jpCondOpcodes) {
    def(opcode, `JP ${opcode}, nn`, (cpu) => jpCond(cpu, opcode), 3);
  }

  // JR e instruction
  function jrE(cpu) {
    const e = toSigned(readImm8(cpu));
    cpu.pc = (cpu.pc + e) & 0xffff;
    return 12;
  }
  def(0x18, 'JR e', (cpu) => jrE(cpu), 2);


  // JR cc, e instruction
  function jrCondE(cpu, opcode) {
    const e = toSigned(readImm8(cpu));
    if (cond(cpu, (opcode >> 3) & 3)) {
      cpu.pc = (cpu.pc + e) & 0xffff;
      return 12;
    }
    return 8;
  }

  const jrCondEOpcodes = [0x20, 0x30, 0x28, 0x38]
  for (const opcode of jrCondEOpcodes) {
    def(opcode, `JR ${opcode}, e`, (cpu) => jrCondE(cpu, opcode), 2);
  }
}
