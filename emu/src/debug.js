import { Z, N, H, C, opNames, cbOpNames, opLen } from './ops.js';

const el = document.querySelector('#debug');
const regsEl = document.querySelector('#regs');
const codeEl = document.querySelector('#code');

export function log(...args) {
  const line = args.map(format).join(' ');
  el.textContent += (el.textContent ? '\n' : '') + line;
  el.scrollTop = el.scrollHeight;
}

export function clear() {
  el.textContent = '';
}

export function renderCpu(cpu) {
  renderRegs(cpu);
  renderCode(cpu);
}

export function renderRegs(cpu) {
  const hex = (n, w) => n.toString(16).padStart(w, '0').toUpperCase();
  const af = ((cpu.a << 8) | cpu.f) & 0xffff;
  const bc = ((cpu.b << 8) | cpu.c) & 0xffff;
  const de = ((cpu.d << 8) | cpu.e) & 0xffff;
  const hl = ((cpu.h << 8) | cpu.l) & 0xffff;
  regsEl.textContent = [
    `A:${hex(cpu.a, 2)}  F:${hex(cpu.f, 2)}  B:${hex(cpu.b, 2)}  C:${hex(cpu.c, 2)}  D:${hex(cpu.d, 2)}  E:${hex(cpu.e, 2)}  H:${hex(cpu.h, 2)}  L:${hex(cpu.l, 2)}`,
    `AF:${hex(af, 4)}  BC:${hex(bc, 4)}  DE:${hex(de, 4)}  HL:${hex(hl, 4)}  SP:${hex(cpu.sp, 4)}  PC:${hex(cpu.pc, 4)}`,
    `Z:${cpu.f & Z ? 1 : 0}  N:${cpu.f & N ? 1 : 0}  H:${cpu.f & H ? 1 : 0}  C:${cpu.f & C ? 1 : 0}`,
  ].join('\n');
}

export function formatOpcode(opcode, cb) {
  const hex = (n) => '$' + n.toString(16).padStart(2, '0').toUpperCase();
  if (cb != null) {
    const name = cbOpNames[cb] ?? 'CB';
    return `${name}(${hex(0xcb)} ${hex(cb)})`;
  }
  const name = opNames[opcode] ?? '???';
  return `${name}(${hex(opcode)})`;
}

function decode(cpu, addr) {
  addr &= 0xffff;
  const opcode = cpu.bus.read8(addr);
  const cb = opcode === 0xcb ? cpu.bus.read8((addr + 1) & 0xffff) : null;
  const len = opcode === 0xcb ? 2 : (opLen[opcode] ?? 1);
  const bytes = [];
  for (let i = 0; i < len; i++) bytes.push(cpu.bus.read8((addr + i) & 0xffff));
  return { addr, bytes, len, text: formatOpcode(opcode, cb) };
}

function linesAroundPc(cpu, before, after) {
  const pc = cpu.pc & 0xffff;
  let best = [];
  for (let back = 1; back <= 32; back++) {
    const pre = [];
    let addr = (pc - back) & 0xffff;
    let hit = false;
    for (let n = 0; n < 32; n++) {
      const dist = (pc - addr) & 0xffff;
      if (dist === 0) {
        hit = true;
        break;
      }
      if (dist > 32) break;
      const inst = decode(cpu, addr);
      if (inst.len > dist) break;
      pre.push(inst);
      addr = (addr + inst.len) & 0xffff;
    }
    if (hit && pre.length >= best.length) best = pre;
  }

  const lines = best.slice(-before);
  let addr = pc;
  for (let i = 0; i <= after; i++) {
    const inst = decode(cpu, addr);
    lines.push(inst);
    addr = (addr + inst.len) & 0xffff;
  }
  return lines;
}

export function renderCode(cpu) {
  const pc = cpu.pc & 0xffff;
  const hex2 = (n) => n.toString(16).padStart(2, '0').toUpperCase();
  const hex4 = (n) => n.toString(16).padStart(4, '0').toUpperCase();
  codeEl.textContent = linesAroundPc(cpu, 10, 16)
    .map((inst) => {
      const mark = inst.addr === pc ? '>' : ' ';
      const bytes = inst.bytes.map(hex2).join(' ').padEnd(8);
      return `${mark} $${hex4(inst.addr)}  ${bytes}  ${inst.text}`;
    })
    .join('\n');
}

function format(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
