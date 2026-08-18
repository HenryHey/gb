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

export function readImm8(cpu) {
  const v = cpu.bus.read8(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xffff;
  return v;
}

export function hl(c) {
  return ((c.h << 8) | c.l) & 0xffff;
}

export function bc(c) {
  return ((c.b << 8) | c.c) & 0xffff;
}

export function de(c) {
  return ((c.d << 8) | c.e) & 0xffff;
}

export function readImm16(cpu) {
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
 *  >> 24 is an arithmetic right shift, so the sign bit is copied into the vacated bits.
 */
export function toSigned(v) {
  return (v << 24) >> 24;
}

export const r8n = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
export const r8nMap = {
  B: 0,
  C: 1,
  D: 2,
  E: 3,
  H: 4,
  L: 5,
  '(HL)': 6,
  A: 7,
};

export const r8 = [
  (cpu) => cpu.b,
  (cpu) => cpu.c,
  (cpu) => cpu.d,
  (cpu) => cpu.e,
  (cpu) => cpu.h,
  (cpu) => cpu.l,
  (cpu) => cpu.bus.read8(hl(cpu)),
  (cpu) => cpu.a,
];

export const w8 = [
  (cpu, v) => (cpu.b = v),
  (cpu, v) => (cpu.c = v),
  (cpu, v) => (cpu.d = v),
  (cpu, v) => (cpu.e = v),
  (cpu, v) => (cpu.h = v),
  (cpu, v) => (cpu.l = v),
  (cpu, v) => cpu.bus.write8(hl(cpu), v),
  (cpu, v) => (cpu.a = v),
];

export const r16Map = {
  BC: 0,
  DE: 1,
  HL: 2,
  SP: 3,
};

export const w16 = [
  (cpu, v) => ((cpu.c = v & 0xff), (cpu.b = (v >> 8) & 0xff)),
  (cpu, v) => ((cpu.e = v & 0xff), (cpu.d = (v >> 8) & 0xff)),
  (cpu, v) => ((cpu.l = v & 0xff), (cpu.h = (v >> 8) & 0xff)),
  (cpu, v) => (cpu.sp = v),
];

export const r16 = [(cpu) => bc(cpu), (cpu) => de(cpu), (cpu) => hl(cpu), (cpu) => cpu.sp];

export const wMem8 = [
  (cpu, v) => cpu.bus.write8(bc(cpu), v),
  (cpu, v) => cpu.bus.write8(de(cpu), v),
  (cpu, v) => cpu.bus.write8(hl(cpu), v),
  (cpu, v) => cpu.bus.write8(cpu.sp, v),
];

export const rMem8 = [
  (cpu) => cpu.bus.read8(bc(cpu)),
  (cpu) => cpu.bus.read8(de(cpu)),
  (cpu) => cpu.bus.read8(hl(cpu)),
  (cpu) => cpu.bus.read8(cpu.sp),
];

export function inc8(cpu, r) {
  const v = r8[r](cpu);
  const result = (v + 1) & 0xff;
  w8[r](cpu, result);
  cpu.f = (cpu.f & C) | (result === 0 ? Z : 0) | ((v & 0xf) + 1 > 0xf ? H : 0);
  return r === 6 ? 12 : 4;
}

export function dec8(cpu, r) {
  const v = r8[r](cpu);
  const result = (v - 1) & 0xff;
  w8[r](cpu, result);
  cpu.f = (cpu.f & C) | N | (result === 0 ? Z : 0) | ((v & 0xf) === 0 ? H : 0);
  return r === 6 ? 12 : 4;
}

export function inc16(cpu, r) {
  const v = r16[r](cpu);
  const result = (v + 1) & 0xffff;
  w16[r](cpu, result);
  return 8;
}

export function dec16(cpu, r) {
  const v = r16[r](cpu);
  const result = (v - 1) & 0xffff;
  w16[r](cpu, result);
  return 8;
}
