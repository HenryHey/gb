# 17 — Mooneye polish (optional)

## Goal

Run the [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite) against your emulator and fix the **easy** failures first — I/O open-bus behavior, consecutive `EI`, and a minimal MBC5 mapper — without chasing cycle-accurate PPU or instruction timing yet.

When you finish this chapter you should have a working harness (`bun run test:mooneye`), roughly **30** passing acceptance ROMs (out of ~62 DMG-filtered), and a clear map of what still fails and why.

This is **optional**. Chapter 15 already delivered a playable DMG emulator; [chapter 16](16-save-states.md) adds instant save states. Mooneye is the next accuracy tier.

## Why bother?

Commercial games (Tetris, Pokémon) are the course bar. Mooneye ROMs are small, deterministic programs that test **one hardware quirk each**. They tell you *which* subsystem is wrong when a game misbehaves in a subtle way.

Most Mooneye tests will still fail at this chapter’s bar. That is expected. The wins here are deliberately low-hanging:


| Fix                                     | Mooneye ROM                                       | What it proves                      |
| --------------------------------------- | ------------------------------------------------- | ----------------------------------- |
| Unused I/O bits read as 1               | `bits/unused_hwio-GS.gb`                          | Open-bus / stub register behavior   |
| Consecutive `EI` does not restart delay | `ei_sequence.gb`                                  | IME scheduling matches real silicon |
| Basic MBC5 ROM banking                  | `oam_dma/sources-GS.gb` loads (may still timeout) | Mapper `$1B` no longer crashes      |


Everything else in the failure list needs **instruction-cycle timing**, **cycle-accurate DMA**, or **PPU mode-3 stretch** — out of scope until you decide to go deeper.

## The harness

ROMs live in `test_carts/mooneye/acceptance/` (see `VERSION` for the upstream commit). The runner is in `emu/test/`:

```
emu/test/mooneye.js       load ROM, tick until serial reports result
emu/test/mooneye.test.js  per-ROM tests (skipped unless MOONEYE=1)
```

Mooneye reports pass/fail by writing six bytes to serial (`SB`/`SC`). Our serial stub in chapter 15 already captures those bytes in `io.serialOut`.

```bash
cd emu
bun run test:mooneye
```

The summary test prints a tally; individual ROM names appear as pass/fail in the test output.

### Pass / fail / timeout


| Serial bytes                         | Meaning                                |
| ------------------------------------ | -------------------------------------- |
| `03 05 08 0D 15 22` (Fibonacci)      | Pass                                   |
| `42 42 42 42 42 42`                  | Fail                                   |
| fewer than 6 bytes after ~120 frames | Timeout — ROM never finished reporting |


`includeMooneyeRom()` filters out boot-ROM tests and non-DMG variants (`-sgb`, `-mgb`, `-dmg0`, etc.). You only run DMG-relevant acceptance ROMs.

## Fix 1 — Unused I/O bits (`bits/unused_hwio-GS`)



### Hardware

On DMG, **unused bits in implemented registers read as 1**, and **unmapped** `$FFxx` **addresses read** `$FF` **and ignore writes**. Returning `0` from a stub makes games think hardware is in impossible states and is a common hang source.

Pan Docs and Mooneye agree on the pattern: write any value, read back, mask to the “live” bits — unused bits should still be 1.

Examples the test checks:


| Register                                                  | Unused bits (read as 1)               |
| --------------------------------------------------------- | ------------------------------------- |
| `SC` (`$FF02`)                                            | bits 1–6                              |
| `TAC` (`$FF07`)                                           | bits 7–3 (you may already `| 0xF8`)   |
| `IF` (`$FF0F`)                                            | bits 7–5 (you may already `| 0xE0`)   |
| `STAT` (`$FF41`)                                          | bit 7                                 |
| `NR10`, `NR30`, `NR32`, `NR41`, `NR44`                    | per-register masks                    |
| `NR52` (`$FF26`)                                          | bits 6–4 read 1; bit 7 reads 0 on DMG |
| `$FF03`, `$FF08–$FF0E`, holes in APU range, `$FF4D–$FF7F` | whole byte reads `$FF`                |


`IE` at `$FFFF` is the exception: bits 7–5 are **not** stuck high — they read what you wrote.

Chapter 5 said “read `$FF` for unimplemented I/O.” This chapter makes that precise.

### Design

```
src/io.js     UNMAPPED set, READ_HI masks, readStored()
src/bus.js    STAT read ORs bit 7
```



### Implementation

**Unmapped addresses** — ignore writes, always read `$FF`:

```js
const UNMAPPED = new Set([0x03, 0x08, /* … */, 0x29]);
for (let i = 0x4d; i <= 0x7f; i++) UNMAPPED.add(i);

// in read():  if (isUnmapped(offset)) return 0xff;
// in write(): if (isUnmapped(offset)) return;
```

Do **not** store writes to unmapped offsets in `regs[]`. A prior chapter’s generic `regs[offset] = v` fallback will make `unused_hwio` fail: write `$00`, read `$00` instead of `$FF`.

**Implemented registers with unused bits** — OR a read mask:

```js
const READ_HI = {
  0x02: 0x7e, // SC
  0x10: 0x80, // NR10
  0x1a: 0x7f, // NR30
  0x1c: 0x9f, // NR32
  0x20: 0xc0, // NR41
  0x23: 0x3f, // NR44
};

function readStored(regs, offset) {
  const hi = READ_HI[offset];
  if (hi !== undefined) return regs[offset] | hi;
  if (offset === 0x26) return (regs[offset] & 0x0f) | 0x70; // NR52
  return regs[offset];
}
```

**STAT** is owned by the PPU in `bus.js`, not `io.js`:

```js
case 0xff41:
  return 0x80 | (ppu.stat & 0x78) | ppu.mode | (ppu.ly === ppu.lyc ? 4 : 0);
```

Bit 7 must always read 1; bits 1–0 come from the current mode; bit 2 is the LYC=LY flag.

### Pitfalls

- Masking on **write** instead of **read** — games write `$00` and expect unused bits to still read 1.
- Treating `$FFFF` (`IE`) like other registers — upper bits are writable, not stuck.
- Forgetting `$FF4D–$FF7F` — Mooneye loops all 52 addresses.



### Verify

```bash
cd emu && MOONEYE=1 bun test mooneye.test.js -t "bits/unused_hwio"
```

Also run `bun test` — `serial.test.js` checks that `SC=0` still reads sensibly with the new mask.

## Fix 2 — Consecutive `EI` (`ei_sequence`)



### Hardware

Chapter 6 implemented `EI` as a **two-instruction delay** before `IME` turns on:

```js
cpu.imeEnableCountdown = 2;
// end of each instruction: decrement; at 0, IME = true
```

That passes `ei_timing.gb` (single `EI`, then `INC B`, interrupt fires once).

`ei_sequence.gb` runs **18 back-to-back** `EI` **opcodes**, then `DI`. It expects an interrupt to fire **during** the `EI` block — specifically with return address `$01A2` (after the second `EI`, before the third).

If every `EI` resets the countdown to 2, consecutive `EI`s never finish the delay: countdown stays at 1 forever until a non-`EI` instruction runs — but the next instruction is `DI`, which clears the countdown. Interrupt never fires → `$42` fail bytes.

Real hardware: **only the first** `EI` **in a run starts the delay**. Further `EI`s before IME enables do not restart it.

### Implementation

One line in `src/ops/control.js`:

```js
def(0xfb, 'EI', (cpu) => {
  if (!cpu.imeEnableCountdown) cpu.imeEnableCountdown = 2;
  return 4;
});
```

`DI` still clears immediately:

```js
cpu.ime = false;
cpu.imeEnableCountdown = 0;
```



### How to reason about it

Trace two consecutive `EI`s:

1. First `EI`: countdown `0 → 2`, then end-of-instruction tick `→ 1`.
2. Second `EI`: countdown already non-zero → **do not reset**. End tick `→ 0`, `IME = true`.
3. Interrupt can fire before the third `EI` at `$01A2`.

Single `EI` behavior is unchanged: `0 → 2 → 1 → (next insn) → 0 → IME`.

### Verify

```bash
MOONEYE=1 bun test mooneye.test.js -t "ei_sequence"
MOONEYE=1 bun test mooneye.test.js -t "ei_timing"
MOONEYE=1 bun test mooneye.test.js -t "rapid_di_ei"
bun test ch06-checkpoint.test.js
```

All four should pass.

## Fix 3 — MBC5 stub (`oam_dma/sources-GS`)



### Hardware

Some Mooneye ROMs use mapper type `$1B` (MBC5 + RAM + battery). Without it, `createCart()` throws and the harness crashes mid-run.

MBC5 ROM banking (minimal subset):


| Address range | Effect                           |
| ------------- | -------------------------------- |
| `$0000–$1FFF` | RAM enable (`$0A` in low nibble) |
| `$2000–$2FFF` | ROM bank low 8 bits              |
| `$3000–$3FFF` | ROM bank high bit (bit 8)        |
| `$4000–$5FFF` | RAM bank (ignore if no RAM)      |


Bank 0 is valid on MBC5 (unlike MBC1/MBC3 where bank 0 at `$4000–$7FFF` maps to bank 1).

### Implementation

Add to `src/cart.js`:

```js
if (header.type === 0x1b) {
  return createMbc5(rom, header);
}
```

Implement `createMbc5` with `romBankLow`, `romBankHigh`, and:

```js
function romBankIndex() {
  return ((romBankHigh << 8) | romBankLow) & (romBanks - 1);
}
```

This is enough for Mooneye’s small test ROMs. Rumble (`$6000–$7FFF` on some carts) can stay a no-op.

### Verify

```bash
MOONEYE=1 bun test mooneye.test.js -t "oam_dma/sources"
```

The ROM should **load** without throwing. It may still **timeout** — that test expects cycle-accurate OAM DMA from multiple source regions. Fixing the timeout is a later project (chapter 17 does not require it).

Update `ch13-checkpoint.test.js`: the “unimplemented mapper” test should use a type you still do not support (e.g. `$20`), not `$13` (MBC3) or `$1B` (MBC5).

## What still fails (and why)

After these three fixes, expect roughly **30 pass / 36 fail / 1 timeout** on the filtered suite. Group the remainder:


| Category                  | Example ROMs                                                                                           | Blocker                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| Instruction timing        | `call_timing`, `jp_timing`, `push_timing`, `pop_timing`, `ret_timing`, `rst_timing`, `add_sp_e_timing` | Per-opcode cycle counts must match hardware exactly       |
| OAM DMA timing            | `oam_dma_start`, `oam_dma_timing`, `oam_dma_restart`, `oam_dma/sources-GS`                             | DMA must steal bus cycles over ~160 µs                    |
| Timer edge cases          | `timer/tim00_div_trigger`, `timer/tima_reload`, `timer/rapid_toggle`                                   | DIV-to-TIMA phase, reload quirks                          |
| PPU timing                | `ppu/lcdon_timing-GS`, `ppu/stat_irq_blocking`, `ppu/intr_2_mode3_timing`                              | Mode 3 stretch, STAT blocking, LCD-on delay               |
| Interrupt dispatch quirks | `interrupts/ie_push`                                                                                   | Writing `$FFFF` during interrupt push can cancel dispatch |


Do not try to fix all of these in one sitting. Pick **one ROM**, read the `.s` source in the Mooneye repo, reproduce the failure, fix the smallest thing that makes that ROM pass, regression-test the suite.

## Suggested order for the next passes

1. `interrupts/ie_push.gb` — behavioral, no cycle counting; teaches interrupt dispatch internals.
2. `oam_dma_timing.gb` — stretch goal: DMA as a 160-cycle bus lockout instead of instant copy.
3. **One** `*_timing.gb` **from the CPU set** — forces you to audit opcode durations in `gb-opcodes.json`.
4. **PPU tests** — only after you accept mode-3 variable length or fixed-172 limitations.



## Checkpoint

- `bun run test:mooneye` runs without crashing; summary shows ≥ 30 passes.
- `bits/unused_hwio-GS.gb`, `ei_sequence.gb`, and `ei_timing.gb` pass.
- `oam_dma/sources-GS.gb` loads (no mapper throw); timeout is OK for this chapter.
- `bun test` still green (662+ unit tests).
- You can explain why consecutive `EI` must not reset `imeEnableCountdown`.



## Further reading

- [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite) — `.s` sources next to each `.gb`
- [docs/reference/io-registers.md](../docs/reference/io-registers.md) — stub vs implemented I/O
- [docs/reference/test-roms.md](../docs/reference/test-roms.md) — Blargg vs Mooneye vs commercial games
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) — when instruction-level timing is not enough
- [Pan Docs — MBC5](https://gbdev.io/pandocs/MBC5.html)

