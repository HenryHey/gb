# 02 — CPU core

## Goal

A SM83 register file, a fetch–decode–execute loop, and a handful of opcodes running a **tiny program in a fake memory array**. No cartridge, no PPU.

## Why

Every later peripheral is ticked with “however many T-cycles that instruction took.” If the CPU cannot fetch, decode, and return a cycle count, nothing else has a clock.

## Design

```
src/cpu.js     registers, flags, step()
src/ops.js     opcode table: Uint8 opcode → function(cpu) => tCycles
```

One object owns CPU state. Memory is injected as `{ read8, write8 }` so chapter 5 can swap in a real bus without rewriting opcodes.

```js
export function createCpu(bus) {
  return {
    bus,
    a: 0, f: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
    sp: 0, pc: 0,
    ime: false,
    halted: false,
    imeEnableCountdown: 0, // chapter 6
  };
}
```

### Flags

Store `f` as a byte, or store four booleans. Booleans are easier to get right; packing into `f` matters for `PUSH AF` / `POP AF`. Helper pair:

```js
export const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;

export function setZNHC(cpu, { z, n, h, c }) {
  cpu.f = (cpu.f & 0x0f) // stays 0
    | (z ? Z : 0) | (n ? N : 0) | (h ? H : 0) | (c ? C : 0);
  cpu.f &= 0xf0;
}
```

16-bit views:

```js
get hl() { return (this.h << 8) | this.l; }
set hl(v) { v &= 0xffff; this.h = v >> 8; this.l = v & 0xff; }
```

Same for `bc`, `de`, `af`, `sp`. `af` setter must `f &= 0xf0`.

### Fetch–decode–execute

```js
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
```

`ops` is an array of 256 functions (holes are `undefined` until you fill them). An object map works too; an array makes “what is left?” a `filter` away.

### Immediate operands

After fetching the opcode, `PC` already points at the next byte:

```js
function readImm8(cpu) {
  const v = cpu.bus.read8(cpu.pc);
  cpu.pc = (cpu.pc + 1) & 0xffff;
  return v;
}
function readImm16(cpu) {
  const lo = readImm8(cpu);
  const hi = readImm8(cpu);
  return lo | (hi << 8);
}
```

Little-endian: `LD HL, $1234` is bytes `21 34 12`.

## First opcodes

Implement these and nothing else yet:

| Opcode | Mnemonic | T-cycles |
| --- | --- | --- |
| `$00` | `NOP` | 4 |
| `$3E n` | `LD A, n` | 8 |
| `$06 n` | `LD B, n` | 8 |
| `$04` | `INC B` | 4 |
| `$05` | `DEC B` | 4 |
| `$18 e` | `JR e` | 12 |
| `$76` | `HALT` | 4 | stub: `cpu.halted = true` |

`JR e` uses a **signed** 8-bit offset from the address *after* the offset byte:

```js
function jr(cpu) {
  const e = (readImm8(cpu) << 24) >> 24; // sign-extend
  cpu.pc = (cpu.pc + e) & 0xffff;
  return 12;
}
```

`INC B` / `DEC B` set Z, N, H; **do not touch C**. Half-carry for INC: `((b & 0xf) + 1) > 0xf`. For DEC: `(b & 0xf) === 0`.

```js
function inc8(cpu, getter, setter) {
  const v = getter();
  const r = (v + 1) & 0xff;
  setter(r);
  cpu.f = (cpu.f & C) | (r === 0 ? Z : 0) | (((v & 0xf) + 1) > 0xf ? H : 0);
  return 4;
}
```

## Fake bus

```js
export function romBus(bytes) {
  const mem = new Uint8Array(0x10000);
  mem.set(bytes, 0);
  return {
    read8: (a) => mem[a & 0xffff],
    write8: (a, v) => { mem[a & 0xffff] = v; },
  };
}
```

## Pitfalls

- Forgetting `& 0xffff` on `PC` / `SP` / pairs. JS numbers are IEEE floats; `0xffff + 1 === 65536`.
- Sign-extending `JR` with `e > 127 ? e - 256 : e` — same as the shift trick.
- Putting flags in bits 0–3 of `F`.
- A giant `switch (opcode)` you will hate in two days. Fill a table as you go.

## Checkpoint

Program (assembled by hand):

```
3E 01     LD A, $01
06 02     LD B, $02
04        INC B        ; B = 3
18 00     JR 0         ; infinite loop at this JR
```

Bytes: `[0x3e, 0x01, 0x06, 0x02, 0x04, 0x18, 0x00]`

Run until `PC` is stable on the `JR` (two steps after you enter it, `PC` is back at the `JR` opcode). Expect `A === 1`, `B === 3`. Log registers each step.

Wire a button “step” and a `<pre>` of `AF BC DE HL SP PC`. This debugger stays for the rest of the course.

## Further reading

- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md)
- [Opcode table](https://gbdev.io/gb-opcodes/optables/classic)
- Nazar part 1 (dispatch idea; ignore Z80 claims)
- DMG-01 chapters 3.1–3.3 (registers, ADD, PC) — Rust, same ideas
