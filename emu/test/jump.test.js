import { describe, expect } from 'bun:test';
import { C, itOp, makeCpu, pair, tick, Z } from './harness.js';

describe('jumps and calls', () => {
  itOp(0xc3, 'JP nn', () => {
    const cpu = makeCpu({ bytes: [0xc3, 0x34, 0x12], f: Z });
    expect(tick(cpu)).toBe(16);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.f).toBe(Z);
  });

  itOp(0xe9, 'JP HL', () => {
    const cpu = makeCpu({ bytes: [0xe9], h: 0x12, l: 0x34, f: Z });
    expect(tick(cpu)).toBe(4);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.f).toBe(Z);
  });

  const jpCc = [
    [0xc2, 'NZ', (f) => !(f & Z)],
    [0xca, 'Z', (f) => !!(f & Z)],
    [0xd2, 'NC', (f) => !(f & C)],
    [0xda, 'C', (f) => !!(f & C)],
  ];
  for (const [op, name, taken] of jpCc) {
    itOp(op, `JP ${name}, nn taken`, () => {
      const f = name === 'Z' || name === 'C' ? (name === 'Z' ? Z : C) : 0;
      const cpu = makeCpu({ bytes: [op, 0x34, 0x12], f });
      expect(taken(cpu.f)).toBe(true);
      expect(tick(cpu)).toBe(16);
      expect(cpu.pc).toBe(0x1234);
    });

    itOp(op, `JP ${name}, nn not taken still consumes nn`, () => {
      const f = name === 'Z' || name === 'C' ? 0 : name === 'NZ' ? Z : C;
      const cpu = makeCpu({ bytes: [op, 0x34, 0x12], f });
      expect(taken(cpu.f)).toBe(false);
      expect(tick(cpu)).toBe(12);
      expect(cpu.pc).toBe(3);
    });
  }

  itOp(0x18, 'JR e +0 lands after the instruction', () => {
    const cpu = makeCpu({ bytes: [0x18, 0x00], f: Z });
    expect(tick(cpu)).toBe(12);
    expect(cpu.pc).toBe(2);
    expect(cpu.f).toBe(Z);
  });

  itOp(0x18, 'JR e -2 loops to start', () => {
    const cpu = makeCpu({ bytes: [0x18, 0xfe] });
    tick(cpu);
    expect(cpu.pc).toBe(0);
  });

  itOp(0x18, 'JR e +5', () => {
    const cpu = makeCpu({ bytes: [0x18, 0x05] });
    tick(cpu);
    expect(cpu.pc).toBe(7);
  });

  const jrCc = [
    [0x20, 'NZ', (f) => !(f & Z)],
    [0x28, 'Z', (f) => !!(f & Z)],
    [0x30, 'NC', (f) => !(f & C)],
    [0x38, 'C', (f) => !!(f & C)],
  ];
  for (const [op, name, taken] of jrCc) {
    itOp(op, `JR ${name}, e taken`, () => {
      const f = name === 'Z' || name === 'C' ? (name === 'Z' ? Z : C) : 0;
      const cpu = makeCpu({ bytes: [op, 0x05], f });
      expect(taken(cpu.f)).toBe(true);
      expect(tick(cpu)).toBe(12);
      expect(cpu.pc).toBe(7);
    });

    itOp(op, `JR ${name}, e not taken`, () => {
      const f = name === 'Z' || name === 'C' ? 0 : name === 'NZ' ? Z : C;
      const cpu = makeCpu({ bytes: [op, 0x05], f });
      expect(taken(cpu.f)).toBe(false);
      expect(tick(cpu)).toBe(8);
      expect(cpu.pc).toBe(2);
    });
  }

  itOp(0xcd, 'CALL nn pushes next PC', () => {
    const cpu = makeCpu({ bytes: [0xcd, 0x34, 0x12], sp: 0xfffe, f: Z });
    expect(tick(cpu)).toBe(24);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.sp).toBe(0xfffc);
    expect(cpu.bus.read8(0xfffc)).toBe(0x03);
    expect(cpu.bus.read8(0xfffd)).toBe(0x00);
    expect(cpu.f).toBe(Z);
  });

  const callCc = [
    [0xc4, 'NZ'],
    [0xcc, 'Z'],
    [0xd4, 'NC'],
    [0xdc, 'C'],
  ];
  for (const [op, name] of callCc) {
    itOp(op, `CALL ${name}, nn taken`, () => {
      const f = name === 'Z' || name === 'C' ? (name === 'Z' ? Z : C) : 0;
      const cpu = makeCpu({ bytes: [op, 0x34, 0x12], f, sp: 0xfffe });
      expect(tick(cpu)).toBe(24);
      expect(cpu.pc).toBe(0x1234);
      expect(cpu.sp).toBe(0xfffc);
    });

    itOp(op, `CALL ${name}, nn not taken`, () => {
      const f = name === 'Z' || name === 'C' ? 0 : name === 'NZ' ? Z : C;
      const cpu = makeCpu({ bytes: [op, 0x34, 0x12], f, sp: 0xfffe });
      expect(tick(cpu)).toBe(12);
      expect(cpu.pc).toBe(3);
      expect(cpu.sp).toBe(0xfffe);
    });
  }

  itOp(0xc9, 'RET pops PC', () => {
    const cpu = makeCpu({
      bytes: [0xc9],
      sp: 0xfffc,
      mem: { 0xfffc: 0x34, 0xfffd: 0x12 },
      f: Z,
    });
    expect(tick(cpu)).toBe(16);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.sp).toBe(0xfffe);
  });

  itOp(0xd9, 'RETI pops PC and enables IME', () => {
    const cpu = makeCpu({
      bytes: [0xd9],
      sp: 0xfffc,
      ime: false,
      mem: { 0xfffc: 0x34, 0xfffd: 0x12 },
    });
    expect(tick(cpu)).toBe(16);
    expect(cpu.pc).toBe(0x1234);
    expect(cpu.ime).toBe(true);
  });

  const retCc = [
    [0xc0, 'NZ'],
    [0xc8, 'Z'],
    [0xd0, 'NC'],
    [0xd8, 'C'],
  ];
  for (const [op, name] of retCc) {
    itOp(op, `RET ${name} taken`, () => {
      const f = name === 'Z' || name === 'C' ? (name === 'Z' ? Z : C) : 0;
      const cpu = makeCpu({
        bytes: [op],
        f,
        sp: 0xfffc,
        mem: { 0xfffc: 0x34, 0xfffd: 0x12 },
      });
      expect(tick(cpu)).toBe(20);
      expect(cpu.pc).toBe(0x1234);
    });

    itOp(op, `RET ${name} not taken`, () => {
      const f = name === 'Z' || name === 'C' ? 0 : name === 'NZ' ? Z : C;
      const cpu = makeCpu({ bytes: [op], f, sp: 0xfffc });
      expect(tick(cpu)).toBe(8);
      expect(cpu.pc).toBe(1);
      expect(cpu.sp).toBe(0xfffc);
    });
  }

  const rst = [0x00, 0x08, 0x10, 0x18, 0x20, 0x28, 0x30, 0x38];
  for (let i = 0; i < rst.length; i++) {
    const op = 0xc7 | (i << 3);
    itOp(op, `RST ${rst[i].toString(16).padStart(2, '0')}`, () => {
      const cpu = makeCpu({ bytes: [op], sp: 0xfffe });
      expect(tick(cpu)).toBe(16);
      expect(cpu.pc).toBe(rst[i]);
      expect(cpu.sp).toBe(0xfffc);
      expect(pair(cpu.bus.read8(0xfffd), cpu.bus.read8(0xfffc))).toBe(0x0001);
    });
  }
});
