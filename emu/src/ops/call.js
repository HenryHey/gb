import { push16 } from './ld.js';
import { cond, readImm16 } from './helpers.js';

export function registerCallOps(def) {
  // CALL a16 instruction
  function callA16(cpu) {
    const a16 = readImm16(cpu);
    push16(cpu, cpu.pc);
    cpu.pc = a16;
    return 24;
  }

  def(0xcd, 'CALL a16', (cpu) => callA16(cpu), 3);

  // CALL cc, a16 instructions
  function callCond(cpu, opcode) {
    const a16 = readImm16(cpu);
    if (cond(cpu, (opcode >> 3) & 3)) {
      push16(cpu, cpu.pc);
      cpu.pc = a16;
      return 24;
    }
    return 12;
  }

  const callCondOpcodes = [0xc4, 0xcc, 0xd4, 0xdc];
  for (const opcode of callCondOpcodes) {
    def(opcode, `CALL ${opcode}, a16`, (cpu) => callCond(cpu, opcode), 3);
  }

  // RET instruction
  function ret(cpu) {
    const lo = cpu.bus.read8(cpu.sp);
    cpu.sp = (cpu.sp + 1) & 0xffff;
    const hi = cpu.bus.read8(cpu.sp);
    cpu.sp = (cpu.sp + 1) & 0xffff;
    cpu.pc = (hi << 8) | lo;
    return 16;
  }

  def(0xc9, 'RET', (cpu) => ret(cpu));

  // RET cc instruction
  function retCond(cpu, opcode) {
    if (cond(cpu, (opcode >> 3) & 3)) {
      ret(cpu);
      return 20;
    }
    return 8;
  }

  const retCondOpcodes = [0xc0, 0xc8, 0xd0, 0xd8];
  for (const opcode of retCondOpcodes) {
    def(opcode, `RET ${opcode}`, (cpu) => retCond(cpu, opcode));
  }

  // RST n instruction
  function rst(cpu, n) {
    push16(cpu, cpu.pc);
    cpu.pc = n;
    return 16;
  }

  const rstOpcodes = [0xc7, 0xcf, 0xd7, 0xdf, 0xe7, 0xef, 0xf7, 0xff];
  const rstAddresses = [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38];
  for (let i = 0; i < rstOpcodes.length; i++) {
    const opcode = rstOpcodes[i];
    def(opcode, `RST ${opcode}`, (cpu) => rst(cpu, rstAddresses[i]));
  }
}
