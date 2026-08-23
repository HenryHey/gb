import { describe, expect, test } from 'bun:test';
import { cbOps, ops } from '../src/ops/index.js';
import { F, makeCpu, run } from './harness.js';

const ILLEGAL = new Set([0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd]);

describe('chapter 4 checkpoint', () => {
  test('CB SWAP', () => {
    const cpu = makeCpu({ bytes: [0x3e, 0xab, 0xcb, 0x37, 0x76] });
    run(cpu);
    expect(cpu.halted).toBe(true);
    expect(cpu.a).toBe(0xba);
    expect(cpu.f).toBe(F());
  });

  test('BIT', () => {
    const cpu = makeCpu({ bytes: [0x06, 0x80, 0xcb, 0x78, 0x76] });
    run(cpu);
    expect(cpu.halted).toBe(true);
    expect(cpu.b).toBe(0x80);
    expect(cpu.f).toBe(F({ h: true }));
  });

  test('unprefixed table is complete', () => {
    const missing = [];
    for (let i = 0; i < 256; i++) {
      if (ILLEGAL.has(i)) continue;
      if (i === 0xcb) continue; // prefix
      if (!ops[i]) missing.push(i.toString(16));
    }
    expect(missing).toEqual([]);
  });

  test('CB table is complete', () => {
    const missing = [];
    for (let i = 0; i < 256; i++) {
      if (!cbOps[i]) missing.push(i.toString(16));
    }
    expect(missing).toEqual([]);
  });
});
