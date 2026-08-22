import { describe, expect, test } from 'bun:test';
import { opLen } from '../src/ops/index.js';
import { C, getR8, hexOp, hlOf, itOp, makeCpu, R8N, spec, tick, Z } from './harness.js';

const INIT = { a: 0x77, b: 0x11, c: 0x22, d: 0x33, e: 0x44, h: 0xc0, l: 0x10 };
const HL_MEM = 0x66;
const FLAGS = Z | C;

function cpuWithRegs(bytes, extra = {}) {
  const { mem, ...regs } = extra;
  return makeCpu({
    bytes,
    ...INIT,
    f: FLAGS,
    ...regs,
    mem: { 0xc010: HL_MEM, ...mem },
  });
}

function srcVal(i) {
  return i === 6 ? HL_MEM : INIT[R8N[i].toLowerCase()];
}

describe('8-bit loads', () => {
  describe("LD r, r'", () => {
    for (let dst = 0; dst < 8; dst++) {
      for (let src = 0; src < 8; src++) {
        const op = 0x40 | (dst << 3) | src;
        if (op === 0x76) continue;
        const extra = dst === 6 || src === 6;
        itOp(op, `LD ${R8N[dst]}, ${R8N[src]}`, () => {
          const cpu = cpuWithRegs([op]);
          const expected = srcVal(src);
          const hlAddr = 0xc010;
          expect(tick(cpu)).toBe(extra ? 8 : 4);
          expect(cpu.pc).toBe(1);
          expect(cpu.f).toBe(FLAGS);
          if (dst === 6) expect(cpu.bus.read8(hlAddr)).toBe(expected);
          else expect(getR8(cpu, dst)).toBe(expected);
          for (let i = 0; i < 8; i++) {
            if (i === dst) continue;
            if (i === 6) {
              if (dst !== 6) expect(cpu.bus.read8(hlAddr)).toBe(HL_MEM);
              continue;
            }
            expect(getR8(cpu, i)).toBe(srcVal(i));
          }
        });
      }
    }
  });

  describe('LD r, n / LD (HL), n', () => {
    const ops = [0x06, 0x0e, 0x16, 0x1e, 0x26, 0x2e, 0x36, 0x3e];
    for (let r = 0; r < 8; r++) {
      const op = ops[r];
      itOp(op, `LD ${R8N[r]}, n`, () => {
        const cpu = cpuWithRegs([op, 0xab]);
        expect(tick(cpu)).toBe(r === 6 ? 12 : 8);
        expect(cpu.pc).toBe(2);
        expect(cpu.f).toBe(FLAGS);
        expect(getR8(cpu, r)).toBe(0xab);
      });
    }
  });

  describe('LD A, (rr) / LD (rr), A', () => {
    itOp(0x0a, 'LD A, (BC)', () => {
      const cpu = cpuWithRegs([0x0a], { b: 0xc0, c: 0x20, mem: { 0xc020: 0x5a } });
      expect(tick(cpu)).toBe(8);
      expect(cpu.a).toBe(0x5a);
      expect(cpu.pc).toBe(1);
    });

    itOp(0x1a, 'LD A, (DE)', () => {
      const cpu = cpuWithRegs([0x1a], { d: 0xc0, e: 0x20, mem: { 0xc020: 0x5a } });
      expect(tick(cpu)).toBe(8);
      expect(cpu.a).toBe(0x5a);
    });

    itOp(0x02, 'LD (BC), A', () => {
      const cpu = cpuWithRegs([0x02], { a: 0x5a, b: 0xc0, c: 0x20 });
      expect(tick(cpu)).toBe(8);
      expect(cpu.bus.read8(0xc020)).toBe(0x5a);
    });

    itOp(0x12, 'LD (DE), A', () => {
      const cpu = cpuWithRegs([0x12], { a: 0x5a, d: 0xc0, e: 0x20 });
      expect(tick(cpu)).toBe(8);
      expect(cpu.bus.read8(0xc020)).toBe(0x5a);
    });

    itOp(0x2a, 'LD A, (HL+)', () => {
      const cpu = cpuWithRegs([0x2a], { h: 0xc0, l: 0x20, mem: { 0xc020: 0x5a } });
      expect(tick(cpu)).toBe(8);
      expect(cpu.a).toBe(0x5a);
      expect(hlOf(cpu)).toBe(0xc021);
    });

    itOp(0x3a, 'LD A, (HL-)', () => {
      const cpu = cpuWithRegs([0x3a], { h: 0xc0, l: 0x20, mem: { 0xc020: 0x5a } });
      expect(tick(cpu)).toBe(8);
      expect(cpu.a).toBe(0x5a);
      expect(hlOf(cpu)).toBe(0xc01f);
    });

    itOp(0x22, 'LD (HL+), A', () => {
      const cpu = cpuWithRegs([0x22], { a: 0x5a, h: 0xc0, l: 0x20 });
      expect(tick(cpu)).toBe(8);
      expect(cpu.bus.read8(0xc020)).toBe(0x5a);
      expect(hlOf(cpu)).toBe(0xc021);
    });

    itOp(0x32, 'LD (HL-), A', () => {
      const cpu = cpuWithRegs([0x32], { a: 0x5a, h: 0xc0, l: 0x20 });
      expect(tick(cpu)).toBe(8);
      expect(cpu.bus.read8(0xc020)).toBe(0x5a);
      expect(hlOf(cpu)).toBe(0xc01f);
    });

    itOp(0xfa, 'LD A, (nn)', () => {
      const cpu = cpuWithRegs([0xfa, 0x20, 0xc0], { mem: { 0xc020: 0x5a } });
      expect(tick(cpu)).toBe(16);
      expect(cpu.pc).toBe(3);
      expect(cpu.a).toBe(0x5a);
    });

    itOp(0xea, 'LD (nn), A', () => {
      const cpu = cpuWithRegs([0xea, 0x20, 0xc0], { a: 0x5a });
      expect(tick(cpu)).toBe(16);
      expect(cpu.pc).toBe(3);
      expect(cpu.bus.read8(0xc020)).toBe(0x5a);
    });
  });

  describe('LDH', () => {
    itOp(0xe0, 'LDH (n), A', () => {
      const cpu = cpuWithRegs([0xe0, 0x80], { a: 0x5a });
      expect(tick(cpu)).toBe(12);
      expect(cpu.pc).toBe(2);
      expect(cpu.bus.read8(0xff80)).toBe(0x5a);
    });

    itOp(0xf0, 'LDH A, (n)', () => {
      const cpu = cpuWithRegs([0xf0, 0x80], { mem: { 0xff80: 0x5a } });
      expect(tick(cpu)).toBe(12);
      expect(cpu.a).toBe(0x5a);
    });

    itOp(0xe2, 'LDH (C), A', () => {
      const cpu = cpuWithRegs([0xe2], { a: 0x5a, c: 0x80 });
      expect(tick(cpu)).toBe(8);
      expect(cpu.pc).toBe(1);
      expect(cpu.bus.read8(0xff80)).toBe(0x5a);
    });

    itOp(0xf2, 'LDH A, (C)', () => {
      const cpu = cpuWithRegs([0xf2], { c: 0x80, mem: { 0xff80: 0x5a } });
      expect(tick(cpu)).toBe(8);
      expect(cpu.pc).toBe(1);
      expect(cpu.a).toBe(0x5a);
    });

    for (const opcode of [0xe2, 0xf2]) {
      test(`${hexOp(opcode)} opLen matches instruction set`, () => {
        expect(opLen[opcode]).toBe(spec(opcode).bytes);
      });
    }
  });
});
