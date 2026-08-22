import { describe, expect, test } from 'bun:test';
import { makeCpu, run } from './harness.js';

describe('chapter 3 checkpoint', () => {
  test('ADD flags', () => {
    const cpu = makeCpu({ bytes: [0x3e, 0x0f, 0xc6, 0x01, 0x76] });
    run(cpu);
    expect(cpu.halted).toBe(true);
    expect(cpu.a).toBe(0x10);
    expect(cpu.f).toBe(0x20);
  });

  test('CALL/RET', () => {
    const cpu = makeCpu({
      bytes: [0xcd, 0x06, 0x00, 0x76, 0x00, 0x00, 0x3e, 0x42, 0xc9],
      sp: 0xfffe,
    });
    run(cpu);
    expect(cpu.halted).toBe(true);
    expect(cpu.a).toBe(0x42);
    expect(cpu.sp).toBe(0xfffe);
  });

  test('DAA', () => {
    const cpu = makeCpu({ bytes: [0x3e, 0x15, 0xc6, 0x27, 0x27, 0x76] });
    run(cpu);
    expect(cpu.halted).toBe(true);
    expect(cpu.a).toBe(0x42);
  });
});
