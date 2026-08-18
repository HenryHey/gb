import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, test } from 'bun:test';
import isa from '../../docs/instruction_set.json';
import {
  C,
  cbOpNames,
  createCpu,
  cbOps,
  H,
  N,
  opLen,
  opNames,
  ops,
  romBus,
  step,
  Z,
} from '../src/ops.js';

export { C, H, N, Z, isa };

export const R8N = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
export const R8K = ['b', 'c', 'd', 'e', 'h', 'l', null, 'a'];

export function hexOp(n) {
  return '$' + n.toString(16).padStart(2, '0').toUpperCase();
}

export function spec(opcode, prefixed = false) {
  const key = '0x' + opcode.toString(16).padStart(2, '0').toUpperCase();
  return (prefixed ? isa.cbprefixed : isa.unprefixed)[key];
}

export function cyclesOf(opcode, { prefixed = false, taken = true } = {}) {
  const list = spec(opcode, prefixed).cycles;
  return taken || list.length === 1 ? list[0] : list[list.length - 1];
}

export function F({ z = false, n = false, h = false, c = false } = {}) {
  return (z ? Z : 0) | (n ? N : 0) | (h ? H : 0) | (c ? C : 0);
}

export function hlOf(cpu) {
  return ((cpu.h << 8) | cpu.l) & 0xffff;
}

export function getR8(cpu, i) {
  if (i === 6) return cpu.bus.read8(hlOf(cpu));
  return cpu[R8K[i]];
}

export function setR8(cpu, i, v) {
  v &= 0xff;
  if (i === 6) cpu.bus.write8(hlOf(cpu), v);
  else cpu[R8K[i]] = v;
}

export function pair(hi, lo) {
  return ((hi << 8) | lo) & 0xffff;
}

/** Bytes are placed at address 0. `mem` overlays extra locations afterwards. */
export function makeCpu({ bytes = [], mem = {}, ...regs } = {}) {
  const bus = romBus(Uint8Array.from(bytes));
  for (const [addr, v] of Object.entries(mem)) bus.write8(Number(addr), v);
  return Object.assign(createCpu(bus), { sp: 0xfffe }, regs);
}

export function tick(cpu) {
  return step(cpu, ops, cbOps);
}

const results = new Map();

function record(opcode, prefixed, ok) {
  const key = `${prefixed ? 'cb' : 'op'}:${opcode}`;
  const rec = results.get(key) ?? { opcode, prefixed, pass: 0, fail: 0 };
  if (ok) rec.pass++;
  else rec.fail++;
  results.set(key, rec);
  writePassingOpcodes();
}

function tracked(opcode, prefixed, fn) {
  return () => {
    try {
      fn();
      record(opcode, prefixed, true);
    } catch (err) {
      record(opcode, prefixed, false);
      throw err;
    }
  };
}

function passingOpcodes() {
  const list = [];
  for (const rec of results.values()) {
    if (rec.fail > 0 || rec.pass === 0) continue;
    if (rec.prefixed) {
      list.push({
        opcode: `$CB ${hexOp(rec.opcode)}`,
        name: cbOpNames[rec.opcode],
        length: 2,
      });
    } else {
      list.push({
        opcode: hexOp(rec.opcode),
        name: opNames[rec.opcode],
        length: opLen[rec.opcode] ?? 1,
      });
    }
  }
  list.sort((a, b) => a.opcode.localeCompare(b.opcode));
  return list;
}

function writePassingOpcodes() {
  const json = JSON.stringify(passingOpcodes(), null, 2) + '\n';
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  mkdirSync(resolve(root, 'public'), { recursive: true });
  writeFileSync(resolve(root, 'opcodes.json'), json);
  writeFileSync(resolve(root, 'public/opcodes.json'), json);
}

afterAll(writePassingOpcodes);
process.on('exit', writePassingOpcodes);

export function itOp(opcode, title, fn) {
  const meta = spec(opcode);
  if (!meta || meta.mnemonic.startsWith('ILLEGAL')) return;
  test.skipIf(!ops[opcode])(`${hexOp(opcode)} ${title}`, tracked(opcode, false, fn));
}

export function itCb(opcode, title, fn) {
  const meta = spec(opcode, true);
  if (!meta) return;
  test.skipIf(!cbOps[opcode])(`$CB ${hexOp(opcode)} ${title}`, tracked(opcode, true, fn));
}
