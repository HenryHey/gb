import { describe, expect } from 'bun:test';
import { C, F, itOp, makeCpu, tick, Z } from './harness.js';

describe('rotates on A', () => {
  itOp(0x07, 'RLCA', () => {
    const cpu = makeCpu({ bytes: [0x07], a: 0x85, f: Z });
    expect(tick(cpu)).toBe(4);
    expect(cpu.a).toBe(0x0b);
    expect(cpu.f).toBe(C);
  });

  itOp(0x0f, 'RRCA', () => {
    const cpu = makeCpu({ bytes: [0x0f], a: 0x3b, f: Z });
    tick(cpu);
    expect(cpu.a).toBe(0x9d);
    expect(cpu.f).toBe(C);
  });

  itOp(0x17, 'RLA', () => {
    const cpu = makeCpu({ bytes: [0x17], a: 0x80, f: C });
    tick(cpu);
    expect(cpu.a).toBe(0x01);
    expect(cpu.f).toBe(C);
  });

  itOp(0x1f, 'RRA', () => {
    const cpu = makeCpu({ bytes: [0x1f], a: 0x01, f: 0 });
    tick(cpu);
    expect(cpu.a).toBe(0x00);
    expect(cpu.f).toBe(C);
  });
});

describe('misc', () => {
  itOp(0x2f, 'CPL', () => {
    const cpu = makeCpu({ bytes: [0x2f], a: 0x35, f: C });
    expect(tick(cpu)).toBe(4);
    expect(cpu.a).toBe(0xca);
    expect(cpu.f).toBe(F({ n: true, h: true, c: true }));
  });

  itOp(0x37, 'SCF', () => {
    const cpu = makeCpu({ bytes: [0x37], f: F({ z: true, n: true, h: true }) });
    expect(tick(cpu)).toBe(4);
    expect(cpu.f).toBe(F({ z: true, c: true }));
  });

  itOp(0x3f, 'CCF', () => {
    const cpu = makeCpu({ bytes: [0x3f], f: F({ z: true, n: true, h: true, c: true }) });
    tick(cpu);
    expect(cpu.f).toBe(Z);
  });

  itOp(0x3f, 'CCF sets C when clear', () => {
    const cpu = makeCpu({ bytes: [0x3f], f: Z });
    tick(cpu);
    expect(cpu.f).toBe(F({ z: true, c: true }));
  });

  itOp(0x27, 'DAA after ADD $15+$27', () => {
    const cpu = makeCpu({ bytes: [0x27], a: 0x3c, f: F({ h: true }) });
    expect(tick(cpu)).toBe(4);
    expect(cpu.a).toBe(0x42);
    expect(cpu.f).toBe(0);
  });

  itOp(0x27, 'DAA after ADD that needs both nibbles', () => {
    const cpu = makeCpu({ bytes: [0x27], a: 0x9a, f: 0 });
    tick(cpu);
    expect(cpu.a).toBe(0x00);
    expect(cpu.f).toBe(F({ z: true, c: true }));
  });

  itOp(0x27, 'DAA after SUB', () => {
    const cpu = makeCpu({ bytes: [0x27], a: 0x00, f: F({ z: true, n: true, h: true, c: true }) });
    tick(cpu);
    expect(cpu.a).toBe(0x9a);
    expect(cpu.f).toBe(F({ n: true, c: true }));
  });
});
