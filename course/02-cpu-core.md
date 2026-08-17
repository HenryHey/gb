# 02 — CPU core

## Goal

A SM83 register file, a fetch–decode–execute loop, and a handful of opcodes running a **tiny program in a fake memory array**. No cartridge, no PPU.

## Why

Every later peripheral is ticked with “however many T-cycles that instruction took.” If the CPU cannot fetch, decode, and return a cycle count, nothing else has a clock.

This chapter is easy to experience as copy-paste: eight letters, a `step` function, seven opcodes. The code is small because the **chip** is small. Read the hardware model once, then type the snippets as a map of that chip, not as a shopping list.

## The chip you are modeling

The original Game Boy (DMG) has no operating system. After a tiny boot ROM (skipped until chapter 5), the CPU sits at `$0100` and runs cartridge bytes forever. Your `createCpu` object is that chip’s visible state.

The CPU is a Sharp **SM83** (early silicon is labelled LR35902). It is close to an Intel 8080 with a few Z80 extras (`JR`, `CB` bit ops) and a few Game Boy originals (`LDH`, `SWAP`). It is **not** a Z80: no IX/IY, no shadow registers, no `IN`/`OUT`. Tutorials that say “Z80” are using a nickname. If a Z80 manual and Pan Docs disagree, Pan Docs wins.

```
  4.194304 MHz T-cycles
       │
   ┌───▼────┐     16-bit address
   │  SM83  │◄──────────────────►  64 KiB bus (a fake array for now)
   │ A F    │
   │ B C    │   PC = next byte to fetch
   │ D E    │   SP = stack (grows down)
   │ H L    │   A  = ALU destination
   │ SP PC  │   F  = Z N H C in the high nibble
   └────────┘
```

If a line of tutorial code feels arbitrary, it is almost always one of these:

1. **A real 8-bit latch** (`A`, `B`, `C`, …)
2. **A 16-bit window** over two latches (`HL = (H << 8) | L`)
3. **A flag** the ALU sets for later branches / `DAA`
4. **A bus access** (`read8` / `write8`)
5. **A T-cycle count** the rest of the machine will consume

## Design

```
src/cpu.js     registers, flags, step()
src/ops.js     opcode table: Uint8 opcode → function(cpu) => tCycles
```

One object owns CPU state. Memory is injected as `{ read8, write8 }` so chapter 5 can swap in a real bus without rewriting opcodes. The SM83 never “sees” ROM vs RAM vs I/O — it only ever names a 16-bit address.

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

`ime`, `halted`, and `imeEnableCountdown` are not memory-mapped. They are internal CPU state (a pin, a sleep latch, a delay counter). Leave them on the object now; they do nothing until interrupts exist.

### Registers: 8-bit ALU, 16-bit windows

The silicon is 8-bit. `A B C D E H L` are real 8-bit latches. `F` is the flags latch. `PC` and `SP` are 16-bit because they have to address 64 KiB.

The pairs `AF`, `BC`, `DE`, `HL` are **not extra registers**. They are two bytes glued together so 16-bit opcodes can move pointers around.

- **`A`** is the accumulator: almost every ALU op reads and writes it.
- **`HL`** is the workhorse pointer. A huge fraction of the ISA is “do something with the byte at the address in HL.”
- **`BC` / `DE`** are extra pointers (and scratch).
- **`SP`** is the stack pointer. The stack grows **down**: `PUSH` decrements, then writes.
- **`PC`** is “where we are in the program.” After every opcode fetch, `PC` already points at the next byte — that is why immediates are just “read whatever `PC` is looking at.”

16-bit views:

```js
get hl() { return (this.h << 8) | this.l; }
set hl(v) { v &= 0xffff; this.h = v >> 8; this.l = v & 0xff; }
```

Same for `bc`, `de`, `af`, `sp`. `af` setter must `f &= 0xf0`.

`PC`, `SP`, and pairs wrap at 16 bits (`& 0xffff`). JavaScript numbers are IEEE floats; `0xffff + 1 === 65536`, which is not a valid Game Boy address.

### Flags

On real hardware, `F` is one register the CPU can `PUSH`/`POP` with `A`. Only the high nibble is used. Bits 3–0 are **always 0**.

| Bit of F | Flag | Meaning |
| --- | --- | --- |
| 7 | **Z** | result was zero |
| 6 | **N** | last op was a subtraction (so `DAA` knows which way to adjust) |
| 5 | **H** | half-carry: carry between the two nibbles of a byte |
| 4 | **C** | carry out of the byte |
| 3–0 | — | unused; `POP AF` must force these to 0 |

Store `f` as a byte, or store four booleans. Booleans are easier to get right; packing into `f` matters for `PUSH AF` / `POP AF`. Helper pair:

```js
export const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;

export function setZNHC(cpu, { z, n, h, c }) {
  cpu.f = (cpu.f & 0x0f) // stays 0
    | (z ? Z : 0) | (n ? N : 0) | (h ? H : 0) | (c ? C : 0);
  cpu.f &= 0xf0;
}
```

**Half-carry** exists because the Game Boy still has `DAA` (decimal adjust) so scores can be two BCD digits packed in one byte. `DAA` needs to know “did the low nibble overflow past 9 / 15?” — that is a carry from bit 3 into bit 4. You will implement `DAA` in chapter 3; get `H` right on `INC`/`DEC` now or it will be wrong twice.

`INC r` / `DEC r` set Z, N, H but **leave C alone**. Incrementing a counter should not trash the carry you just used in an `ADC`.

### Fetch–decode–execute

One instruction on the SM83:

1. **Fetch** the byte at `PC`. That byte *is* the opcode.
2. **Advance `PC`** so it now points at the rest of the instruction (an immediate, or the next opcode).
3. **Decode** by looking the byte up in a 256-entry table. `$CB` is a prefix: the *next* byte selects a second 256-entry page of bit/rotate ops (chapter 4).
4. **Execute**: mutate registers and/or call `bus.read8` / `bus.write8`.
5. **Return T-cycles**: how long that instruction took on the 4.19 MHz clock.

That last step is the architectural contract of the whole emulator. The CPU does not run until it feels like stopping. Every opcode has a fixed duration. Later, the PPU, timer, and DMA all advance by that same number.

Opcode tables often list **M-cycles** (`1 M-cycle = 4 T-cycles`). Count **T-cycles** in code so PPU and timer share a unit. `NOP` is 4 T; `LD A, n` is 8 T because it must read a second byte.

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

The Game Boy is **little-endian**: low byte first. `LD HL, $1234` is bytes `21 34 12` — opcode, then `L = $34`, then `H = $12`.

## First opcodes

Implement these and nothing else yet. You only implement a handful because the rest of the ISA is the **same families with different register bits** (chapter 3). These seven are enough to feel fetch → mutate → return cycles.

| Opcode | Mnemonic | T-cycles | What the hardware is doing |
| --- | --- | --- | --- |
| `$00` | `NOP` | 4 | Waste 4 T-cycles; used for timing |
| `$3E n` | `LD A, n` | 8 | Copy an immediate into the accumulator |
| `$06 n` | `LD B, n` | 8 | Same, into `B` |
| `$04` | `INC B` | 4 | 8-bit ALU on `B`; flags Z/N/H, **not C** |
| `$05` | `DEC B` | 4 | Same, subtract 1 |
| `$18 e` | `JR e` | 12 | `PC +=` signed offset; cheap local branch |
| `$76` | `HALT` | 4 | Stop fetching until an interrupt (stub: `cpu.halted = true`) |

`JR e` uses a **signed** 8-bit offset from the address *after* the offset byte (i.e. after you have already consumed it). `JR 0` (`$18 $00`) is a no-op jump: offset 0 means “the next instruction,” which is the byte after this `JR`. To loop on the `JR` itself you need offset `-2` (`$18 $FE`), because fetch has already advanced `PC` by 2.

```js
function jr(cpu) {
  const e = (readImm8(cpu) << 24) >> 24; // sign-extend
  cpu.pc = (cpu.pc + e) & 0xffff;
  return 12;
}
```

`(e << 24) >> 24` is JavaScript’s way of sign-extending an 8-bit value. `e > 127 ? e - 256 : e` is the same idea.

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

This is not cheating — it is the CPU’s view of the world. The SM83 only ever does `read8(addr)` / `write8(addr)`. Chapter 5 is when `addr` starts meaning ROM vs VRAM vs I/O.

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
18 FE     JR -2        ; infinite loop at this JR
```

Bytes: `[0x3e, 0x01, 0x06, 0x02, 0x04, 0x18, 0xfe]`

Run until `PC` is stable on the `JR` (two steps after you enter it, `PC` is back at the `JR` opcode). Expect `A === 1`, `B === 3`. Log registers each step.

Wire a button “step” and a `<pre>` of `AF BC DE HL SP PC`. This debugger stays for the rest of the course. Those are the same registers a real Game Boy debugger would show.

## Further reading

- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md)
- [Opcode table](https://gbdev.io/gb-opcodes/optables/classic)
- Nazar part 1 (dispatch idea; ignore Z80 claims)
- DMG-01 chapters 3.1–3.3 (registers, ADD, PC) — Rust, same ideas
