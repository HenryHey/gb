import { registerLdOps } from './ld.js';

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

// flags
export const Z = 0x80,
  N = 0x40,
  H = 0x20,
  C = 0x10;

export function setZNHC(cpu, { z, n, h, c }) {
  cpu.f =
    (cpu.f & 0x0f) | // stays 0
    (z ? Z : 0) |
    (n ? N : 0) |
    (h ? H : 0) |
    (c ? C : 0);
  cpu.f &= 0xf0;
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

function readImm8(cpu) {
  const v = cpu.bus.read8(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xffff;
  return v;
}

function hl(c) {
  return ((c.h << 8) | c.l) & 0xffff;
}

function bc(c) {
  return ((c.b << 8) | c.c) & 0xffff;
}

function de(c) {
  return ((c.d << 8) | c.e) & 0xffff;
}

function readImm16(cpu) {
  const lo = readImm8(cpu);
  const hi = readImm8(cpu);
  return lo | (hi << 8);
}

/**
 * Sign-extends an 8-bit unsigned value to a signed 8-bit integer.
 * readImm8 gives an unsigned byte (0–255),
 * but Game Boy JR uses a signed 8-bit displacement (-128…+127).
 *
 * JavaScript has no int8, so this uses 32-bit arithmetic shifts:  
 *  << 24 moves the byte into bit 31 (the 32-bit sign bit).  
 *  \>> 24 is an arithmetic right shift, so the sign bit is copied into the vacated bits.
 */
function toSigned(v) {
  return (v << 24) >> 24;
}

const r8n = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const r8nMap = {
  B: 0,
  C: 1,
  D: 2,
  E: 3,
  H: 4,
  L: 5,
  '(HL)': 6,
  A: 7,
};

const r8 = [
  (cpu) => cpu.b,
  (cpu) => cpu.c,
  (cpu) => cpu.d,
  (cpu) => cpu.e,
  (cpu) => cpu.h,
  (cpu) => cpu.l,
  (cpu) => cpu.bus.read8(hl(cpu)),
  (cpu) => cpu.a,
];

const w8 = [
  (cpu, v) => (cpu.b = v),
  (cpu, v) => (cpu.c = v),
  (cpu, v) => (cpu.d = v),
  (cpu, v) => (cpu.e = v),
  (cpu, v) => (cpu.h = v),
  (cpu, v) => (cpu.l = v),
  (cpu, v) => cpu.bus.write8(hl(cpu), v),
  (cpu, v) => (cpu.a = v),
];

const r16Map = {
  BC: 0,
  DE: 1,
  HL: 2,
  SP: 3,
};

const w16 = [
  (cpu, v) => ((cpu.c = v & 0xff), (cpu.b = (v >> 8) & 0xff)),
  (cpu, v) => ((cpu.e = v & 0xff), (cpu.d = (v >> 8) & 0xff)),
  (cpu, v) => ((cpu.l = v & 0xff), (cpu.h = (v >> 8) & 0xff)),
  (cpu, v) => (cpu.sp = v),
];

const r16 = [(cpu) => bc(cpu), (cpu) => de(cpu), (cpu) => hl(cpu), (cpu) => cpu.sp];

const wMem8 = [
  (cpu, v) => cpu.bus.write8(bc(cpu), v),
  (cpu, v) => cpu.bus.write8(de(cpu), v),
  (cpu, v) => cpu.bus.write8(hl(cpu), v),
  (cpu, v) => cpu.bus.write8(cpu.sp, v),
];

const rMem8 = [
  (cpu) => cpu.bus.read8(bc(cpu)),
  (cpu) => cpu.bus.read8(de(cpu)),
  (cpu) => cpu.bus.read8(hl(cpu)),
  (cpu) => cpu.bus.read8(cpu.sp),
];

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

function inc8(cpu, r) {
  const v = r8[r](cpu);
  const result = (v + 1) & 0xff;
  w8[r](cpu, result);
  cpu.f = (cpu.f & C) | (result === 0 ? Z : 0) | ((v & 0xf) + 1 > 0xf ? H : 0);
  return r === 6 ? 12 : 4;
}

function dec8(cpu, r) {
  const v = r8[r](cpu);
  const result = (v - 1) & 0xff;
  w8[r](cpu, result);
  cpu.f = (cpu.f & C) | N | (result === 0 ? Z : 0) | ((v & 0xf) === 0 ? H : 0);
  return r === 6 ? 12 : 4;
}

function inc16(cpu, r) {
  const v = r16[r](cpu);
  const result = (v + 1) & 0xffff;
  w16[r](cpu, result);
  return 8;
}

function dec16(cpu, r) {
  const v = r16[r](cpu);
  const result = (v - 1) & 0xffff;
  w16[r](cpu, result);
  return 8;
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

registerLdOps(def, {
  readImm8,
  readImm16,
  r8n,
  r8nMap,
  r8,
  w8,
  r16Map,
  w16,
  wMem8,
  rMem8,
  inc16,
  dec16,
});

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
  };
}
