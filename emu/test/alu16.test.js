import { describe, expect } from 'bun:test';
import { F, itOp, makeCpu, pair, tick, Z } from './harness.js';

describe('16-bit ALU', () => {
  describe('INC / DEC rr', () => {
    itOp(0x03, 'INC BC', () => {
      const cpu = makeCpu({ bytes: [0x03], b: 0x12, c: 0xff, f: Z });
      expect(tick(cpu)).toBe(8);
      expect(pair(cpu.b, cpu.c)).toBe(0x1300);
      expect(cpu.f).toBe(Z);
    });

    itOp(0x13, 'INC DE', () => {
      const cpu = makeCpu({ bytes: [0x13], d: 0xff, e: 0xff });
      tick(cpu);
      expect(pair(cpu.d, cpu.e)).toBe(0);
    });

    itOp(0x23, 'INC HL', () => {
      const cpu = makeCpu({ bytes: [0x23], h: 0x00, l: 0xff });
      tick(cpu);
      expect(pair(cpu.h, cpu.l)).toBe(0x0100);
    });

    itOp(0x33, 'INC SP', () => {
      const cpu = makeCpu({ bytes: [0x33], sp: 0xffff, f: Z });
      expect(tick(cpu)).toBe(8);
      expect(cpu.sp).toBe(0);
      expect(cpu.f).toBe(Z);
    });

    itOp(0x0b, 'DEC BC', () => {
      const cpu = makeCpu({ bytes: [0x0b], b: 0x13, c: 0x00, f: Z });
      expect(tick(cpu)).toBe(8);
      expect(pair(cpu.b, cpu.c)).toBe(0x12ff);
      expect(cpu.f).toBe(Z);
    });

    itOp(0x1b, 'DEC DE', () => {
      const cpu = makeCpu({ bytes: [0x1b], d: 0x00, e: 0x00 });
      tick(cpu);
      expect(pair(cpu.d, cpu.e)).toBe(0xffff);
    });

    itOp(0x2b, 'DEC HL', () => {
      const cpu = makeCpu({ bytes: [0x2b], h: 0x01, l: 0x00 });
      tick(cpu);
      expect(pair(cpu.h, cpu.l)).toBe(0x00ff);
    });

    itOp(0x3b, 'DEC SP', () => {
      const cpu = makeCpu({ bytes: [0x3b], sp: 0x0001, f: Z });
      tick(cpu);
      expect(cpu.sp).toBe(0);
      expect(cpu.f).toBe(Z);
    });
  });

  describe('ADD HL, rr', () => {
    itOp(0x09, 'ADD HL, BC', () => {
      const cpu = makeCpu({ bytes: [0x09], h: 0x0f, l: 0xff, b: 0x00, c: 0x01, f: Z });
      expect(tick(cpu)).toBe(8);
      expect(pair(cpu.h, cpu.l)).toBe(0x1000);
      expect(cpu.f).toBe(F({ z: true, h: true }));
    });

    itOp(0x19, 'ADD HL, DE', () => {
      const cpu = makeCpu({ bytes: [0x19], h: 0xff, l: 0xff, d: 0x00, e: 0x01, f: 0 });
      tick(cpu);
      expect(pair(cpu.h, cpu.l)).toBe(0);
      expect(cpu.f).toBe(F({ h: true, c: true }));
    });

    itOp(0x29, 'ADD HL, HL', () => {
      const cpu = makeCpu({ bytes: [0x29], h: 0x40, l: 0x00, f: Z });
      tick(cpu);
      expect(pair(cpu.h, cpu.l)).toBe(0x8000);
      expect(cpu.f).toBe(Z);
    });

    itOp(0x39, 'ADD HL, SP', () => {
      const cpu = makeCpu({ bytes: [0x39], h: 0x00, l: 0x01, sp: 0xffff, f: Z });
      tick(cpu);
      expect(pair(cpu.h, cpu.l)).toBe(0);
      expect(cpu.f).toBe(F({ z: true, h: true, c: true }));
    });
  });

  itOp(0xe8, 'ADD SP, e', () => {
    const cpu = makeCpu({ bytes: [0xe8, 0x02], sp: 0x0fff, f: F({ z: true, n: true }) });
    expect(tick(cpu)).toBe(16);
    expect(cpu.pc).toBe(2);
    expect(cpu.sp).toBe(0x1001);
    expect(cpu.f).toBe(F({ h: true, c: true }));
  });
});
