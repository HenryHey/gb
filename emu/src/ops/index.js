import { registerLdOps } from './ld.js';
import { registerAluOps } from './alu.js';
import { registerControlFlowOps } from './jp_jr.js';
import { registerCallOps } from './call.js';
import { registerCbOps } from './cbs.js';

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
    imeEnableCountdown: 0,
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

function di(cpu) {
  cpu.ime = false;
  cpu.imeEnableCountdown = 0;
  return 4;
}

function stop(cpu) {
  cpu.pc = (cpu.pc + 1) & 0xffff;
  return 4;
}

function ei(cpu) {
  cpu.imeEnableCountdown = 2;
  return 4;
}

export const ops = [];
export const opNames = [];
export const opLen = [];
function def(op, name, fn, len = 1) {
  ops[op] = fn;
  opNames[op] = name;
  opLen[op] = len;
}

export const cbOps = [];
export const cbOpNames = [];
export const cbOpLen = [];
function defCB(op, name, fn, len = 1) {
  cbOps[op] = fn;
  cbOpNames[op] = name;
  cbOpLen[op] = len;
}

def(0x00, 'NOP', nop);
def(0x10, 'STOP', stop);
def(0x76, 'HALT', halt);
def(0xF3, 'DI', di);
def(0xFB, 'EI', ei);

registerLdOps(def);
registerAluOps(def);
registerControlFlowOps(def);
registerCallOps(def);
registerCbOps(defCB);


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
