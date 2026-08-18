import { registerLdOps } from './ld.js';
import { dec8, inc8, r8nMap, readImm8, toSigned } from './helpers.js';

export { Z, N, H, C, setZNHC } from './helpers.js';

export function createCpu(bus) {
  return {
    bus,
    a: 0,
    f: 0,
    b: 0,
    c: 0,
    d: 0,
    e: 0,
    h: 0,
    l: 0,
    sp: 0,
    pc: 0,
    ime: false,
    halted: false,
    imeEnableCountdown: 0, // chapter 6
  };
}

export function step(cpu, ops, cbOps) {
  const opcode = cpu.bus.read8(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xffff;
  if (opcode === 0xcb) {
    const cb = cpu.bus.read8(cpu.pc);
    cpu.pc = (cpu.pc + 1) & 0xffff;
    return cbOps[cb](cpu); // chapter 4
  }
  const fn = ops[opcode];
  if (!fn) throw new Error(`unimplemented ${opcode.toString(16)} at ${(cpu.pc - 1).toString(16)}`);
  return fn(cpu);
}

function nop() {
  return 4;
}

function halt(cpu) {
  cpu.halted = true;
  return 4;
}

function jr(cpu) {
  const e = toSigned(readImm8(cpu));
  cpu.pc = (cpu.pc + e) & 0xffff;
  return 12;
}

export const ops = [];
export const opNames = [];
export const opLen = [];
function def(op, name, fn, len = 1) {
  ops[op] = fn;
  opNames[op] = name;
  opLen[op] = len;
}
def(0x00, 'NOP', nop);
def(0x18, 'JR e', jr, 2);
def(0x76, 'HALT', halt);

registerLdOps(def);

// INC AND DEC instructions
def(0x04, 'INC B', (cpu) => inc8(cpu, r8nMap.B));
def(0x14, 'INC D', (cpu) => inc8(cpu, r8nMap.D));
def(0x24, 'INC H', (cpu) => inc8(cpu, r8nMap.H));
def(0x34, 'INC (HL)', (cpu) => inc8(cpu, r8nMap['(HL)']));
def(0x0c, 'INC C', (cpu) => inc8(cpu, r8nMap.C));
def(0x1c, 'INC E', (cpu) => inc8(cpu, r8nMap.E));
def(0x2c, 'INC L', (cpu) => inc8(cpu, r8nMap.L));
def(0x3c, 'INC A', (cpu) => inc8(cpu, r8nMap.A));

def(0x05, 'DEC B', (cpu) => dec8(cpu, r8nMap.B));
def(0x15, 'DEC D', (cpu) => dec8(cpu, r8nMap.D));
def(0x25, 'DEC H', (cpu) => dec8(cpu, r8nMap.H));
def(0x35, 'DEC (HL)', (cpu) => dec8(cpu, r8nMap['(HL)']));
def(0x0d, 'DEC C', (cpu) => dec8(cpu, r8nMap.C));
def(0x1d, 'DEC E', (cpu) => dec8(cpu, r8nMap.E));
def(0x2d, 'DEC L', (cpu) => dec8(cpu, r8nMap.L));
def(0x3d, 'DEC A', (cpu) => dec8(cpu, r8nMap.A));

export const cbOps = [];
export const cbOpNames = [];

export function listImplementedOpcodes() {
  const list = [];
  for (let op = 0; op < 256; op++) {
    if (ops[op]) {
      list.push({
        opcode: '$' + op.toString(16).padStart(2, '0').toUpperCase(),
        name: opNames[op],
        length: opLen[op] ?? 1,
      });
    }
  }
  for (let op = 0; op < 256; op++) {
    if (cbOps[op]) {
      list.push({
        opcode: '$CB $' + op.toString(16).padStart(2, '0').toUpperCase(),
        name: cbOpNames[op],
        length: 2,
      });
    }
  }
  return list;
}

export function romBus(bytes) {
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, 0);
  return {
    read8: (a) => mem[a & 0xffff],
    write8: (a, v) => {
      mem[a & 0xffff] = v;
    },
    read16: (a) => mem[a & 0xffff] | (mem[(a + 1) & 0xffff] << 8),
    write16: (a, v) => {
      mem[a & 0xffff] = v & 0xff;
      mem[(a + 1) & 0xffff] = (v >> 8) & 0xff;
    },
  };
}
