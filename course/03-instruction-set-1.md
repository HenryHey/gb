# 03 — Instruction set, part 1

## Goal

Loads, ALU, control flow, and the stack. Enough that a handwritten program can `CALL` a function that `ADD`s and `RET`s. Still a flat 64 KiB array for memory.

## Why

Commercial games are built from these. The `CB` page (chapter 4) is large but mechanical. Get flags and the stack right here or Tetris will jump into the weeds.

Keep [the opcode table](https://gbdev.io/gb-opcodes/optables/classic) and [gbz80(7)](https://rgbds.gbdev.io/docs/v0.9.4/gbz80.7) open. Do not memorize 200 rows; implement **families**.

## The ISA is a bitfield, not a list

The SM83 inherited the 8080 trick of stuffing the operand into the opcode. Bits are not random decoration:

```
8-bit r:  B C D E H L (HL) A     indices 0–7   (6 means “the byte at HL”)
16-bit:   BC DE HL SP            (PUSH/POP replace SP with AF)
```

That is why `LD r, r'` is the block `$40–$7F` and why `HALT` is `$76`: `LD (HL), (HL)` would have been that encoding, so they reused the hole. ALU ops `$80–$BF` use the same 3-bit source; the next 3 bits pick ADD/ADC/SUB/SBC/AND/XOR/OR/CP.

`(HL)` as “register 6” is the architectural joke that makes the ISA dense: most 8-bit ops can target memory without a second addressing mode. It also costs extra T-cycles — a memory access is not a register latch.

Other shapes that look like special cases are hardware shortcuts:

- **`LDH`** (`$FF00+n` and `$FF00+C`) exists because I/O lives in the high page. Games talk to the PPU, timer, and joypad constantly; a 2-byte “load from `$FFnn`” beats a 3-byte absolute address.
- **`LDI` / `LDD`** (`HL+` / `HL-`) are copy-loop helpers: transfer a byte, then bump the pointer. Tile copies and `memcpy`-shaped game code use them.
- **The stack grows down** because that is how 8080-family chips did it. `CALL`/`RST` push the *already incremented* PC (address of the next instruction), then jump. `RET` pops it. `SP` after skip-boot is `$FFFE`, so the first `PUSH` writes `$FFFD`/`$FFFC` in HRAM — the only RAM the CPU can always reach, even during OAM DMA (chapter 11).
- **`DAA`** is leftover BCD. Tetris stores scores as packed decimal in `A`, then `ADD` + `DAA` instead of converting binary to decimal. `N` and `H` exist largely so `DAA` knows what just happened. Wrong `DAA` = garbage numbers on the well, sometimes a crash.
- **Conditional jumps** only test `Z` and `C` (four conditions: NZ, Z, NC, C). There is no “if half-carry” branch. Games that care about `H` inspect `F` or use `DAA`.

Implement one family with a loop over those 3-bit indices. Copying 50 near-identical functions by hand is how this chapter turns into a month.

## Design: operand tables

Same 3-bit encoding as above, now as tables:

```
8-bit r: B C D E H L (HL) A     indices 0–7
16-bit  : BC DE HL SP           (PUSH/POP: BC DE HL AF)
```

```js
const r8 = [
  (c) => c.b, (c) => c.c, (c) => c.d, (c) => c.e,
  (c) => c.h, (c) => c.l, (c) => c.bus.read8(hl(c)), (c) => c.a,
];
const w8 = [
  (c, v) => { c.b = v; }, /* … */
  (c, v) => { c.bus.write8(hl(c), v); },
  (c, v) => { c.a = v; },
];
```

Then `LD r, r'` (`$40–$7F` except `$76` HALT) is:

```js
for (let dst = 0; dst < 8; dst++) {
  for (let src = 0; src < 8; src++) {
    const op = 0x40 | (dst << 3) | src;
    if (op === 0x76) continue;
    ops[op] = (cpu) => {
      w8[dst](cpu, r8[src](cpu));
      return (dst === 6 || src === 6) ? 8 : 4;
    };
  }
}
```

ALU in `$80–$BF` is the same 3-bit source with `op = (opcode >> 3) & 7` selecting ADD/ADC/SUB/SBC/AND/XOR/OR/CP.

That pattern is the difference between a weekend and a month.

## Families to implement

### 8-bit loads

- `LD r, r'` / `LD r, n` / `LD (HL), n`
- `LD A, (BC|DE|HL+|HL-|nn)` and the stores the other way
- `LDH (n), A` / `LDH A, (n)` / `LD (C), A` / `LD A, (C)` — **I/O page `$FF00+n`**. Even with a fake bus, implement the addressing now.

`HL+` / `HL-` (`LDI` / `LDD`): transfer then increment or decrement HL.

### 16-bit loads

- `LD rr, nn`
- `LD SP, HL`
- `LD (nn), SP` — write SP little-endian to absolute address
- `LD HL, SP+e` — signed `e`; flags from the **low byte** add (H from bit 3, C from bit 7); Z=0, N=0
- `PUSH rr` / `POP rr` — `POP AF` masks F

```js
function push16(cpu, v) {
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, v >> 8);
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, v & 0xff);
}
function pop16(cpu) {
  const lo = cpu.bus.read8(cpu.sp); cpu.sp = (cpu.sp + 1) & 0xffff;
  const hi = cpu.bus.read8(cpu.sp); cpu.sp = (cpu.sp + 1) & 0xffff;
  return (hi << 8) | lo;
}
```

PUSH AF: 16 T-cycles. POP AF: 12.

### ALU (A ← A ⊙ src)

| Op | Z | N | H | C |
| --- | --- | --- | --- | --- |
| ADD/ADC | result==0 | 0 | nibble carry | byte carry |
| SUB/SBC/CP | result==0 | 1 | nibble borrow | byte borrow |
| AND | result==0 | 0 | **1** | 0 |
| XOR/OR | result==0 | 0 | 0 | 0 |

`CP` is `SUB` without storing. `ADC`/`SBC` include the old C as cin/bin.

```js
function add8(a, b, cin) {
  const sum = a + b + cin;
  return {
    r: sum & 0xff,
    z: (sum & 0xff) === 0,
    n: false,
    h: ((a & 0xf) + (b & 0xf) + cin) > 0xf,
    c: sum > 0xff,
  };
}
```

`INC r` / `DEC r`: C unchanged. `INC rr` / `DEC rr`: **no flags**, 8 T-cycles.

`ADD HL, rr`: 8 T-cycles; Z unchanged; N=0; H from bit 11; C from bit 15.

`ADD SP, e`: 16 T-cycles; Z=0, N=0; H/C from the low-byte add like `LD HL, SP+e`.

### Rotates on A (unprefixed)

`RLCA RLA RRCA RRA`: 4 T-cycles. Z=0, N=0, H=0, C=old bit out. `RLCA` wraps bit 7 into bit 0 **and** into C. `RLA` injects old C into bit 0.

### Misc

- `CPL`: `A ^= 0xff`; N=1, H=1
- `SCF`: C=1, N=0, H=0
- `CCF`: C=!C, N=0, H=0 (Z unchanged)
- `DAA`: see [cpu-quirks.md](../docs/reference/cpu-quirks.md). Implement it now; test it. Tetris scores depend on it.
- `NOP`, already done

### Jumps and calls

| Op | Notes |
| --- | --- |
| `JP nn` | 16 T |
| `JP HL` | 4 T, `PC = HL` (not a memory read) |
| `JP cc, nn` | 16 taken / 12 not |
| `JR e` | 12 |
| `JR cc, e` | 12 taken / 8 not |
| `CALL nn` | push PC, then JP; 24 T |
| `CALL cc, nn` | 24 / 12 |
| `RET` | pop PC; 16 T |
| `RET cc` | 20 taken / 8 not |
| `RST n` | `CALL` to `$00/$08/…/$38`; 16 T |

Conditions: `NZ Z NC C` encoded as bits. `cc` is `(opcode >> 3) & 3` in the usual slots.

```js
function cond(cpu, cc) {
  switch (cc) {
    case 0: return !(cpu.f & Z);
    case 1: return !!(cpu.f & Z);
    case 2: return !(cpu.f & C);
    case 3: return !!(cpu.f & C);
  }
}
```

Not-taken `JP cc, nn` must still **consume** the two immediate bytes.

## Pitfalls

- `ADD HL, rr` leaving Z alone — tests and games care.
- `POP AF` leaving bits 3–0 set → later `PUSH AF` / compares explode.
- `CALL` pushing the address of the immediate instead of the next instruction. Fetch nn first, *then* push the already-advanced PC.
- `LDH` using `n` as an absolute address instead of `$FF00|n`.
- `DAA` implemented from a Z80 manual.

## Checkpoint

Write a helper `run(cpu, max = 1000)` that steps until `HALT` or `max`.

**Test 1 — ADD flags**

```
3E 0F     LD A, $0F
C6 01     ADD A, $01     ; A=$10, Z=0, N=0, H=1, C=0
76        HALT
```

Expect `A === 0x10`, `F === 0x20`.

**Test 2 — CALL/RET**

```
CD 06 00  CALL $0006
76        HALT
00        NOP            ; padding so CALL target is $0006
3E 42     LD A, $42
C9        RET
```

Bytes: `cd 06 00 76 00 00 3e 42 c9` with `PC` starting at 0, `SP` at `$FFFE`. Expect `A === 0x42`, `SP` restored.

**Test 3 — DAA**

```
3E 15     LD A, $15
C6 27     ADD A, $27     ; binary $3C, BCD should become $42 after DAA
27        DAA
76        HALT
```

Expect `A === 0x42`.

If these three pass, move on. Do not implement every opcode before the tests — implement the families the tests need, then fill the rest of the families.

## Further reading

- [Pan Docs — CPU instruction set](https://gbdev.io/pandocs/CPU_Instruction_Set.html)
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) (half-carry, DAA)
- DMG-01 3.2–3.4
