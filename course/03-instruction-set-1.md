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

- `LDH` (`$FF00+n` and `$FF00+C`) exists because I/O lives in the high page. Games talk to the PPU, timer, and joypad constantly; a 2-byte “load from `$FFnn`” beats a 3-byte absolute address.
- `LDI` **/** `LDD` (`HL+` / `HL-`) are copy-loop helpers: transfer a byte, then bump the pointer. Tile copies and `memcpy`-shaped game code use them.
- **The stack grows down** because that is how 8080-family chips did it. `CALL`/`RST` push the *already incremented* PC (address of the next instruction), then jump. `RET` pops it. `SP` after skip-boot is `$FFFE`, so the first `PUSH` writes `$FFFD`/`$FFFC` in HRAM — the only RAM the CPU can always reach, even during OAM DMA (chapter 11).
- `DAA` is leftover BCD. Tetris stores scores as packed decimal in `A`, then `ADD` + `DAA` instead of converting binary to decimal. `N` and `H` exist largely so `DAA` knows what just happened. Wrong `DAA` = garbage numbers on the well, sometimes a crash.
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
  (c, v) => { c.b = v; },
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
      (w8[dst])(cpu, r8[src](cpu));
      return (dst === 6 || src === 6) ? 8 : 4;
    };
  }
}
```

ALU in `$80–$BF` is the same 3-bit source with `op = (opcode >> 3) & 7` selecting ADD/ADC/SUB/SBC/AND/XOR/OR/CP.

That pattern is the difference between a weekend and a month.

## Families to implement

Each family is one loop over operand indices. Below: what the command does, which encodings belong together, and the quirks that bite emulators.

### LD — copy source → destination

**No flags.** `(HL)` is register index 6 — a memory operand costs extra T-cycles.

| Variant | What it does | Quirks |
| --- | --- | --- |
| `LD r, r'` | `$40–$7F`: copy between 8-bit registers or `(HL)` | `$76` is `HALT`, not `LD (HL),(HL)`. 4 T (8 if either side is `(HL)`). |
| `LD r, n` / `LD (HL), n` | Immediate byte into register or `(HL)` | 8 T; 12 if destination is `(HL)`. |
| `LD A, (BC\|DE)` / `LD (BC\|DE), A` | Byte at address in pair ↔ `A` | 8 T. |
| `LD A, (HL+)` / `LD (HL+), A` | Transfer, then `HL++` | 8 T. Read/store happens **before** the bump. |
| `LD A, (HL-)` / `LD (HL-), A` | Transfer, then `HL--` | Same as above. Tile copies love these. |
| `LD A, (nn)` / `LD (nn), A` | Absolute 16-bit address ↔ `A` | 16 T, 3-byte instruction. |
| `LDH (n), A` / `LDH A, (n)` | `A` ↔ `$FF00 + n` | **Not** absolute `n` — always the I/O page. 12 T. |
| `LD (C), A` / `LD A, (C)` | `A` ↔ `$FF00 + C` | Same I/O page, offset from `C`. 8 T. |
| `LD rr, nn` | 16-bit immediate into `BC`, `DE`, `HL`, or `SP` | 12 T. |
| `LD SP, HL` | `SP ← HL` | 8 T. |
| `LD (nn), SP` | Store `SP` little-endian at absolute address | 20 T. |
| `LD HL, SP+e` | `HL ← SP + signed e` | Sets H/C from the **low-byte** add (bit 3 / bit 7). Z=0, N=0. 12 T. |

### PUSH / POP — 16-bit stack transfer

Stack grows **down**. High byte lands at the higher address.

| Variant | What it does | Quirks |
| --- | --- | --- |
| `PUSH rr` | Decrement `SP` twice, write pair | `rr` is `BC`, `DE`, `HL`, or `AF`. 16 T. |
| `POP rr` | Read pair, increment `SP` twice | **`POP AF` must mask `F &= 0xF0`** — low nibble of `F` is always 0. 12 T. |

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

### ADD — add into A or a 16-bit pair

8-bit: `A ← A + src`. 16-bit: `HL ← HL + rr` or `SP ← SP + e`.

| Variant | Flags | Quirks |
| --- | --- | --- |
| `ADD A, r` / `ADD A, n` | Z, N=0, H (nibble), C (byte) | Block `$80–$87` + `$C6`. `(HL)` source: 8 T, else 4 / 8 for immediate. |
| `ADD HL, rr` | **Z unchanged**, N=0, H (bit 11), C (bit 15) | 8 T. Games and tests care about Z being left alone. |
| `ADD SP, e` | Z=0, N=0, H/C from **low-byte** add | 16 T. Same H/C math as `LD HL, SP+e`. |

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

### ADC — add with carry

Same as `ADD`, but includes old **C** as carry-in. Block `$88–$8F` + `$CE`.

### SUB — subtract from A

`A ← A − src`. Sets Z, N=1, H (nibble borrow), C (byte borrow). Block `$90–$97` + `$D6`.

### SBC — subtract with borrow

Same as `SUB`, but includes old **C** as borrow-in. Block `$98–$9F` + `$DE`.

### AND / XOR / OR — bitwise on A

`A ← A ⊙ src`. All set Z from the result, N=0.

| Op | H | C |
| --- | --- | --- |
| `AND` | **forced 1** | 0 |
| `XOR` / `OR` | 0 | 0 |

Blocks `$A0–$A7`, `$A8–$AF`, `$B0–$B7` + `$E6` / `$EE` / `$F6`.

### CP — compare (subtract without store)

Identical flag math to `SUB`, but **`A` is not written**. Block `$B8–$BF` + `$FE`. Useful for `A == value` tests.

### INC / DEC — increment or decrement

| Variant | What it does | Quirks |
| --- | --- | --- |
| `INC r` / `DEC r` | ±1 on 8-bit register or `(HL)` | Updates Z, N, H. **C is unchanged.** `(HL)`: 12 T, else 4. |
| `INC rr` / `DEC rr` | ±1 on 16-bit pair | **No flags.** 8 T. |

### RLCA / RLA / RRCA / RRA — rotate A through C

All 4 T. Z=0, N=0, H=0. **C = bit shifted out.**

| Op | What it does |
| --- | --- |
| `RLCA` | Bit 7 → bit 0 **and** into C (wrap, no old C) |
| `RLA` | Bit 7 → C; old C → bit 0 |
| `RRCA` | Bit 0 → bit 7 **and** into C |
| `RRA` | Bit 0 → C; old C → bit 7 |

Prefixed `$CB` rotates (chapter 4) are a separate family — different encodings, extra cycles for `(HL)`.

### CPL / SCF / CCF / DAA — flag and BCD helpers

| Op | Effect |
| --- | --- |
| `CPL` | `A ^= 0xFF`; N=1, H=1; Z and C unchanged |
| `SCF` | C=1; N=0, H=0; Z unchanged |
| `CCF` | C = !C; N=0, H=0; **Z unchanged** |
| `DAA` | Adjust `A` for BCD using N, H, C | See [cpu-quirks.md](../docs/reference/cpu-quirks.md). Tetris scores depend on it. |

### NOP / HALT

| Op | Quirk |
| --- | --- |
| `NOP` (`$00`) | Already done. 4 T. |
| `HALT` (`$76`) | Stops fetching until an interrupt. Tick PPU/timer while halted or you never wake up. |

### JP / JR — jump

| Variant | What it does | Quirks |
| --- | --- | --- |
| `JP nn` | `PC ← nn` | 16 T. |
| `JP HL` | `PC ← HL` | 4 T. **Register copy**, not a memory read at `HL`. |
| `JP cc, nn` | Jump if condition | 16 T taken / 12 not. **Always consume** the 2 immediate bytes even when not taken. |
| `JR e` | `PC ← PC + signed e` | 12 T. |
| `JR cc, e` | Relative jump if condition | 12 T taken / 8 not. |

Conditions: `NZ`, `Z`, `NC`, `C` — encoded as `(opcode >> 3) & 3` in the conditional slots.

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

### CALL / RET / RST — subroutine calls

| Variant | What it does | Quirks |
| --- | --- | --- |
| `CALL nn` | Push PC, then jump | Push the **already incremented** PC (address of next instruction). 24 T. |
| `CALL cc, nn` | Conditional call | 24 T taken / 12 not. Consume immediates when not taken. |
| `RET` | Pop into PC | 16 T. |
| `RET cc` | Conditional return | 20 T taken / 8 not. |
| `RST n` | Push PC, jump to `$00`, `$08`, … `$38` | Compact `CALL`. 16 T. |

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



## Next

[04 — Instruction set, part 2](04-instruction-set-2.md)