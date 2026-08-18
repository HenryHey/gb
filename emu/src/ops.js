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

const r16n = ['BC', 'DE', 'HL', 'SP'];
const r16Map = {
  BC: 0,
  DE: 1,
  HL: 2,
  SP: 3,
};

const w16 = [
  (cpu, v) => (cpu.c = v & 0xff, cpu.b = (v >> 8) & 0xff),
  (cpu, v) => (cpu.e = v & 0xff, cpu.d = (v >> 8) & 0xff),
  (cpu, v) => (cpu.l = v & 0xff, cpu.h = (v >> 8) & 0xff),
  (cpu, v) => (cpu.sp = v),
]

const r16 = [
  (cpu) => bc(cpu),
  (cpu) => de(cpu),
  (cpu) => hl(cpu),
  (cpu) => cpu.sp,
]

const wMem8 = [
  (cpu, v) => cpu.bus.write8(bc(cpu), v),
  (cpu, v) => cpu.bus.write8(de(cpu), v),
  (cpu, v) => cpu.bus.write8(hl(cpu), v),
  (cpu, v) => cpu.bus.write8(cpu.sp, v),
]

const rMem8 = [
  (cpu) => cpu.bus.read8(bc(cpu)),
  (cpu) => cpu.bus.read8(de(cpu)),
  (cpu) => cpu.bus.read8(hl(cpu)),
  (cpu) => cpu.bus.read8(cpu.sp),
]

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

function ld8(cpu, r, v) {
  w8[r](cpu, v);
  return r === 6 ? 12 : 8;
}

function ld16(cpu, r, v) {
  w16[r](cpu, v);
  return 12;
}

function lda8(cpu, dst, src) {
  wMem8[dst](cpu, r8[src](cpu));
  return 8;
}

function ld8Mem(cpu, src, inc = false, dec = false) {
  w8[r8nMap.A](cpu, rMem8[src](cpu));
  return 8;
}

function ld8MemInc(cpu) {
  w8[r8nMap.A](cpu, rMem8[r16Map.HL](cpu));
  inc16(cpu, r16Map.HL);
  return 8;
}

function ld8MemDec(cpu) {
  w8[r8nMap.A](cpu, rMem8[r16Map.HL](cpu));
  dec16(cpu, r16Map.HL);
  return 8;
}

function ldh8(cpu, n) {
  cpu.bus.write8(0xff00 | n, r8[r8nMap.A](cpu));
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

function ldi(cpu) {
  w8[r8nMap['(HL)']](cpu, r8[r8nMap.A](cpu));
  inc16(cpu, r16Map.HL);
  return 8;
}

function ldd(cpu) {
  w8[r8nMap['(HL)']](cpu, r8[r8nMap.A](cpu));
  dec16(cpu, r16Map.HL);
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

// LD n8 instructions
def(0x06, 'LD B, n8', (cpu) => ld8(cpu, r8nMap.B, readImm8(cpu)), 2);
def(0x16, 'LD D, n8', (cpu) => ld8(cpu, r8nMap.D, readImm8(cpu)), 2);
def(0x26, 'LD H, n8', (cpu) => ld8(cpu, r8nMap.H, readImm8(cpu)), 2);
def(0x36, 'LD (HL), n8', (cpu) => ld8(cpu, r8nMap['(HL)'], readImm8(cpu)), 2);
def(0x0e, 'LD C, n8', (cpu) => ld8(cpu, r8nMap.C, readImm8(cpu)), 2);
def(0x1e, 'LD E, n8', (cpu) => ld8(cpu, r8nMap.E, readImm8(cpu)), 2);
def(0x2e, 'LD L, n8', (cpu) => ld8(cpu, r8nMap.L, readImm8(cpu)), 2);
def(0x3e, 'LD A, n8', (cpu) => ld8(cpu, r8nMap.A, readImm8(cpu)), 2);

// LD n16 instructions
def(0x01, 'LD BC, n16', (cpu) => ld16(cpu, r16Map.BC, readImm16(cpu)), 2);
def(0x11, 'LD DE, n16', (cpu) => ld16(cpu, r16Map.DE, readImm16(cpu)), 2);
def(0x21, 'LD HL, n16', (cpu) => ld16(cpu, r16Map.HL, readImm16(cpu)), 2);
def(0x31, 'LD SP, n16', (cpu) => ld16(cpu, r16Map.SP, readImm16(cpu)), 2);

// LD [nn], r8 instructions
def(0x02, 'LD (nn), r8', (cpu) => lda8(cpu, r16Map.BC, r8nMap.A), 2);
def(0x12, 'LD (nn), r8', (cpu) => lda8(cpu, r16Map.DE, r8nMap.A), 2);

// LDI (LD [HL+], A)
def(0x22, 'LD (HL+), A', ldi);

// LDD (LD [HL-], A)
def(0x32, 'LD (HL-), A', ldd);

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
def(0x0A, 'LD A, [BC]', (cpu) => ld8Mem(cpu, r16Map.BC));
def(0x1A, 'LD A, [DE]', (cpu) => ld8Mem(cpu, r16Map.DE));
def(0x2A, 'LD A, [HL+]', ld8MemInc);
def(0x3A, 'LD A, [HL-]', ld8MemDec);

// Generate LDH instructions
def((0xE0), 'LDH (n), A', (cpu) => {
  cpu.bus.write8(0xff00 | readImm8(cpu), r8[r8nMap.A](cpu));
  return 12;
}, 2);
def((0xF0), 'LDH A, [a8]', (cpu) => {
  w8[r8nMap.A](cpu, cpu.bus.read8(0xff00 | readImm8(cpu)));
  return 12;
}, 2);
def((0xE2), 'LDH (C), A', (cpu) => {
  cpu.bus.write8(0xff00 | r8[r8nMap.C](cpu), r8[r8nMap.A](cpu));
  return 8;
}, 2);
def(0xF2, 'LD A, [C]', (cpu) => {
  w8[r8nMap.A](cpu, cpu.bus.read8(0xff00 | r8[r8nMap.C](cpu)));
  return 8;
}, 2);

// Generate LD [nn], A instruction
def(0xEA, 'LD (nn), A', (cpu) => {
  cpu.bus.write8(readImm16(cpu), r8[r8nMap.A](cpu));
  return 16;
}, 3);

// Generate LD A, (nn) instruction
def(0xFA, 'LD A, (nn)', (cpu) => {
  w8[r8nMap.A](cpu, cpu.bus.read8(readImm16(cpu)));
  return 16;
}, 3);

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
