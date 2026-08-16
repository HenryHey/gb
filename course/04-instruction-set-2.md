# 04 — Instruction set, part 2

## Goal

The `CB` prefix page, `HALT`/`STOP`/`DI`/`EI` (delay stub), and a complete unprefixed map. Hitting an illegal opcode throws. Still a flat memory array.

## Why

Games use `BIT`, `SWAP`, and rotates on `(HL)` constantly. A missing `CB` op is an instant crash at skip-boot.

## Why a whole second page

The 8080 had no bit-test, no nibble swap, and only a few rotates on `A`. The SM83 adds a **prefix**: `$CB` means “the next byte is from a different map.” That is cheaper in silicon than stretching every opcode to 9 bits, and it is why `step()` already special-cases `$CB` before the main table.

The second byte is again a bitfield, not 256 unrelated ops:

```
bits 7–6  group: rotate/shift/swap | BIT | RES | SET
bits 5–3  which rotate, or which bit 0–7
bits 2–0  same r as chapter 3 (6 = (HL))
```

So `makeCbOps` is one loop. `(HL)` is still “register 6,” and it still costs extra cycles: BIT must read memory; RES/SET must read-modify-write.

Rotates vs shifts vs `SWAP` are the same barrel with different wiring:

- **RLC/RRC** — the bit that falls off re-enters the other end *and* goes into C (nine-bit rotate that ignores old C).
- **RL/RR** — rotate **through** C: C is a ninth bit. This is how you shift a 16-bit value in `HL` one bit at a time.
- **SLA/SRL** — shift, incoming bit is 0. Logical.
- **SRA** — arithmetic shift: bit 7 (the sign) is copied down. `$80` becomes `$C0`, not `$40`.
- **SWAP** — exchange nibbles. Cheap packed-BCD / palette-index trick. Clears C.

Unprefixed `RLCA`/`RLA`/… are **older 8080 ops on `A` only**. They clear Z instead of setting it from the result. The CB versions on `A` *do* set Z. Do not reuse one function for both.

`$CB` itself costs 4 T-cycles. The 8/12/16 numbers in the opcode table are **totals**, prefix included.

### Illegal opcodes and CPU control

Eleven unprefixed bytes (`$D3 $DB $DD …`) were never bonded out. On a real SM83 they lock the CPU. If you hit one, your emulator has a bug (wrong jump, bad stack, executing data). `throw` with PC — do not `NOP` them or you will debug the wrong thing for hours.

`DI` / `EI` / `HALT` / `STOP` are not ALU. They are how the CPU talks to the interrupt pin and the clock:

- **`DI`**: mask interrupts *now* (`IME = 0`).
- **`EI`**: unmask *after the next instruction*. That delay is real silicon. Games write `EI` then `RET` or `HALT` and depend on the extra instruction running first. Implement the countdown now; chapter 6 is when it matters.
- **`HALT`**: stop fetching until `IE & IF` is non-zero. Saves battery on hardware. Until peripherals set `IF`, your stub just freezes PC — that is OK to observe.
- **`STOP`**: a DMG curiosity (very-low-power wait for a button). Commercial games you care about do not rely on it. Treat as a short `NOP`.

## CB encoding

Same bitfield as above. The loop:

```js
export function makeCbOps() {
  const cb = new Array(256);
  for (let byte = 0; byte < 256; byte++) {
    const r = byte & 7;
    const bit = (byte >> 3) & 7;
    const group = byte >> 6;
    cb[byte] = (cpu) => {
      const extra = r === 6; // (HL) costs more
      if (group === 0) {
        const v = r8[r](cpu);
        const { out, c } = rotShift(byte >> 3, v, cpu);
        w8[r](cpu, out);
        cpu.f = (out === 0 ? Z : 0) | (c ? C : 0); // N=H=0
        return extra ? 16 : 8;
      }
      if (group === 1) { // BIT
        const v = r8[r](cpu);
        const z = ((v >> bit) & 1) === 0;
        cpu.f = (cpu.f & C) | (z ? Z : 0) | H; // N=0, H=1
        return extra ? 12 : 8;
      }
      const v = r8[r](cpu);
      const out = group === 2 ? v & ~(1 << bit) : v | (1 << bit);
      w8[r](cpu, out);
      return extra ? 16 : 8;
    };
  }
  return cb;
}
```

`rotShift` index 0–7: `RLC RRC RL RR SLA SRA SWAP SRL`.

| Op | Result | C |
| --- | --- | --- |
| RLC | rotate left | old bit 7 |
| RRC | rotate right | old bit 0 |
| RL | rotate left **through** C | old bit 7 |
| RR | rotate right through C | old bit 0 |
| SLA | `v << 1`, bit 0 = 0 | old bit 7 |
| SRA | arithmetic `v >> 1`, bit 7 preserved | old bit 0 |
| SWAP | nibbles swapped | 0 |
| SRL | `v >> 1`, bit 7 = 0 | old bit 0 |

All set Z from the result, N=0, H=0.

Unprefixed `RLCA`/`RLA`/… are **not** the same as `CB RLC A`: they clear Z. Do not reuse the CB function blindly for `$07`.

Prefix `$CB` itself costs 4 T-cycles, already included in the 8/12/16 numbers in the table (those are **total**).

## Remaining unprefixed ops

Fill anything still `undefined` in `ops[]`. Checklist:

- All `LD` / ALU / `INC`/`DEC` / jumps / `PUSH`/`POP` / `RST`
- `DAA CPL SCF CCF`
- `DI` (`IME = 0`, countdown = 0)
- `EI` (`cpu.imeEnableCountdown = 2` — decrement at the **end** of each instruction, including `EI`; IME flips when it hits 0). Full interrupt service is chapter 6; the countdown can exist now.
- `HALT` — set `halted = true`. Chapter 6 wakes it.
- `STOP` (`$10`) — treat as 4 T-cycle NOP. Optionally skip a following `$00`.
- `LDH` variants if you skipped them

Timings: copy the [classic optable](https://gbdev.io/gb-opcodes/optables/classic). Conditional instructions have two numbers (taken / not).

## Illegal opcodes

```js
const ILLEGAL = new Set([0xd3, 0xdb, 0xdd, 0xe3, 0xe4, 0xeb, 0xec, 0xed, 0xf4, 0xfc, 0xfd]);
```

If `ops[i]` is still empty after you are “done,” it is either illegal or you missed a real instruction. Throw with `PC` and opcode. Do not silently `NOP` — you want the crash.

## Completeness check

```js
const missing = [];
for (let i = 0; i < 256; i++) {
  if (ILLEGAL.has(i)) continue;
  if (i === 0xcb) continue; // prefix
  if (!ops[i]) missing.push(i.toString(16));
}
console.log("missing", missing);
```

`missing` should be `[]`. Same for `cbOps` 0–255.

Optional: Vitest tests for a few CB ops (`SWAP A`, `BIT 7, H`, `SRL (HL)`).

## Pitfalls

- `BIT (HL)` is 12 T, `RES/SET (HL)` 16 T, not 8.
- `SRA` on `$80` is `$C0`, not `$40`.
- `SWAP` clears C.
- Double-counting PC increment on CB (the core already ate `$CB` and the second byte).
- Implementing `STOP` as an infinite halt with the LCD still running — just NOP it.

## Checkpoint

**CB SWAP**

```
3E AB     LD A, $AB
CB 37     SWAP A        ; A = $BA
76        HALT
```

Expect `A === 0xba`, Z=0, N=0, H=0, C=0.

**BIT**

```
06 80     LD B, $80
CB 78     BIT 7, B      ; Z=0, H=1, N=0
76        HALT
```

Expect Z clear, H set.

**Missing-table dump** is empty.

You now have a CPU. It still cannot see a cartridge header or VRAM. That is the next chapter.

## Further reading

- Opcode table CB page
- [Pan Docs — instruction set, CB block](https://gbdev.io/pandocs/CPU_Instruction_Set.html)
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md)
