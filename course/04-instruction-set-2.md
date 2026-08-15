# 04 — Instruction set, part 2

## Goal

The `CB` prefix page, `HALT`/`STOP`/`DI`/`EI` (delay stub), and a complete unprefixed map. Hitting an illegal opcode throws. Still a flat memory array.

## Why

Games use `BIT`, `SWAP`, and rotates on `(HL)` constantly. A missing `CB` op is an instant crash at skip-boot.

## CB encoding

Byte after `$CB`:

```
bits 7–6  00 = rotate/shift/swap    01 = BIT    10 = RES    11 = SET
bits 5–3  operation or bit index 0–7
bits 2–0  register, same 8-bit r as chapter 3  (6 = (HL))
```

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
