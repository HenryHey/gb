# SM83 CPU quirks

Canonical: [CPU registers and flags](https://gbdev.io/pandocs/CPU_Registers_and_Flags.html), [instruction set](https://gbdev.io/pandocs/CPU_Instruction_Set.html), [opcode tables](https://gbdev.io/gb-opcodes/optables/classic), [gbz80(7)](https://rgbds.gbdev.io/docs/v0.9.4/gbz80.7).

The Game Boy CPU is an **SM83** (LR35902 on early DMG silicon). It is close to an Intel 8080 with a few Z80 extras and a few originals (`LDH`, `SWAP`, `LD HL,SP+e`). It is **not** a Z80.

## Registers

```
A F
B C
D E
H L
SP  16-bit
PC  16-bit
IME 1-bit  interrupt master enable (not a memory register)
```

`F` only uses the high nibble. Bits 3–0 are **always 0**. `POP AF` must mask `F &= 0xf0`.

| Bit of F | Flag |
| --- | --- |
| 7 | Z — result was zero |
| 6 | N — last op was a subtraction (BCD) |
| 5 | H — half-carry (nibble) |
| 4 | C — carry |

Pair reads/writes: `AF = (A << 8) | F`, etc.

## Clocks

- **T-cycle** (dot): 4 194 304 Hz. Count these.
- **M-cycle**: 4 T-cycles. Opcode tables often list M-cycles; multiply by 4.

Instruction timings in this course: use the opcode table’s T-cycle column. Conditional jumps/calls/returns take the **taken** or **not-taken** time.

## Half-carry (the usual bug)

Think in 8-bit ALU operations, even for 16-bit opcodes.

| Instruction | H set if carry/borrow from | C set if carry/borrow from |
| --- | --- | --- |
| 8-bit ADD/ADC/SUB/SBC/INC/DEC/CP | bit 3 | bit 7 (INC/DEC: C unchanged) |
| `ADD HL, rr` | bit 11 | bit 15 |
| `ADD SP, e` and `LD HL, SP+e` | bit 3 | bit 7 |

For ADD: `H = ((a & 0xf) + (b & 0xf) + cin) > 0xf`.  
For SUB: `H = ((a & 0xf) - (b & 0xf) - bin) < 0`.

`INC r` / `DEC r` update Z, N, H but **leave C alone**. `INC rr` / `DEC rr` update **no flags**.

## DAA

After an 8-bit add or sub, `DAA` adjusts `A` so the byte looks like two BCD digits. Use the flags, not “guess from A”:

```js
function daa(cpu) {
  let a = cpu.a;
  let adjust = 0;
  let c = false;
  if (cpu.flagN) {
    if (cpu.flagH) adjust |= 0x06;
    if (cpu.flagC) adjust |= 0x60;
    a = (a - adjust) & 0xff;
  } else {
    if (cpu.flagH || (a & 0x0f) > 9) adjust |= 0x06;
    if (cpu.flagC || a > 0x99) { adjust |= 0x60; c = true; }
    a = (a + adjust) & 0xff;
  }
  cpu.a = a;
  cpu.flagZ = a === 0;
  cpu.flagH = false;
  cpu.flagC = c || (cpu.flagN && cpu.flagC);
  // N unchanged
}
```

If `N` is set, carry stays as it was unless you also subtract `$60` because `C` was already set. Tetris uses `DAA` for scores. Wrong `DAA` = garbage numbers, sometimes crashes.

## `EI`, `DI`, `RETI`

- `DI`: `IME = 0` immediately.
- `EI`: `IME` becomes 1 **after the following instruction** (one-instruction delay). A second `EI` still delays.
- `RETI`: pop PC, `IME = 1` immediately.

Implement the delay with a 1-instruction counter (`imeEnableCountdown`), not by setting IME inside `EI` itself. Check interrupts **after** the instruction and **after** applying the countdown.

## `HALT`

When `HALT` executes:

- If `IME === 1`: sleep until `IE & IF !== 0`, then service the interrupt.
- If `IME === 0` and `IE & IF === 0`: sleep until `IE & IF !== 0`, then continue with the next opcode (no ISR).
- If `IME === 0` and `IE & IF !== 0`: **HALT bug** — the next byte is read twice (PC fails to increment). Optional for this course. A simple version: do not halt, fall through. Games you care about usually HALT with IME on.

While halted, still **tick PPU and timer** or the interrupt that should wake you never arrives.

## `STOP`

Opcode `$10`. On DMG it is obscure (joypad wake, skipped DIV). For this course: treat as a 1-byte `NOP` (some docs consume a following `$00`). Pokémon will not rely on it.

## CB prefix

`$CB` is a prefix. The next byte selects RLC/RRC/RL/RR/SLA/SRA/SWAP/SRL or BIT/RES/SET on `B,C,D,E,H,L,(HL),A`. Encode as `op = byte & 7` for the operand and `byte >> 3` for the operation. `(HL)` costs extra cycles.

`BIT n, r`: Z = bit is 0; N = 0; H = 1; C unchanged.

## Illegal opcodes

`$D3 $DB $DD $E3 $E4 $EB $EC $ED $F4 $FC $FD` lock a real CPU. If you hit one, `throw` with PC and opcode — you have a bug, not a game using them.

## `RST`, `CALL`, `PUSH`/`POP`

Stack grows **down**. `PUSH`: `SP -= 2`, write high byte at `SP+1`, low at `SP`. `POP`: inverse. `CALL` / `RST` push the **already incremented** PC (address of the next instruction).

## `LDH`

`LDH (n), A` writes `A` to `$FF00 + n`. `LDH A, (n)` reads it. `LD (C), A` / `LD A, (C)` use `$FF00 + C`. Games use these constantly for I/O.

## Accuracy bar for this course

Instruction-level: after each opcode, add its T-cycles to PPU, timer, and DMA. Per-memory-access cycle timing will be implemented in the future ([ToDo.md](../../ToDo.md)); instruction-level stepping passes most commercial games but not Mooneye timing tests.
