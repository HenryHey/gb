# 99 — Mooneye polish (optional appendix)

## Goal

Run the [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite) against your emulator and fix accuracy gaps **one ROM at a time**. This appendix tracks that work; it is not part of the main course sequence (chapters 0–16).

When you finish the baseline fixes you should have a working harness (`bun run test:mooneye`), roughly **30** passing acceptance ROMs (out of ~62 DMG-filtered), and a clear map of what still fails and why.

## Why bother?

Commercial games are the checkpoint bar. Mooneye ROMs are small, deterministic programs that test **one hardware quirk each**. They tell you *which* subsystem is wrong when a game misbehaves in a subtle way.

## Progress tracker

Re-run `bun run test:mooneye` after each fix and update this table.


| #   | Fix                                       | Mooneye ROM                   | Status                   |
| --- | ----------------------------------------- | ----------------------------- | ------------------------ |
| 1   | Unused I/O bits read as 1                 | `bits/unused_hwio-GS.gb`      | done                     |
| 2   | Consecutive `EI` does not restart delay   | `ei_sequence.gb`              | done                     |
| 3   | Basic MBC5 ROM banking                    | `oam_dma/sources-GS.gb` loads | done (may still timeout) |
| 4   | Non-atomic interrupt dispatch (`IE` push) | `interrupts/ie_push.gb`       | done                     |
| 5   | Cycle-accurate OAM DMA                    | `oam_dma_timing.gb`           | done                     |
| 6   | One CPU `*_timing.gb`                     | e.g. `push_timing.gb`         | pending                  |
| 7   | PPU timing suite                          | e.g. `ppu/lcdon_timing-GS.gb` | pending                  |


**Latest tally:** 31 pass · 30 fail · 1 timeout · 62 DMG-filtered total (after Fix 5 — `oam_dma_start`, `oam_dma_timing`, `oam_dma_restart` pass).

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

Chapter 5 said “read `$FF` for unimplemented I/O.” This appendix makes that precise.

### Design

```
src/io.js     UNMAPPED set, READ_HI masks, readStored()
src/bus.js    STAT read ORs bit 7
```



### Verify

```bash
cd emu && MOONEYE=1 bun test mooneye.test.js -t "bits/unused_hwio"
```

Also run `bun test` — `serial.test.js` checks that `SC=0` still reads sensibly with the new mask.

## Fix 2 — Consecutive `EI` (`ei_sequence`)



### Hardware

Chapter 6 implemented `EI` as a **two-instruction delay** before `IME` turns on. Real silicon: **only the first** `EI` **in a run starts the delay**. Further `EI`s before IME enables do not restart it.

### Implementation

One line in `src/ops/control.js`:

```js
def(0xfb, 'EI', (cpu) => {
  if (!cpu.imeEnableCountdown) cpu.imeEnableCountdown = 2;
  return 4;
});
```



### Verify

```bash
MOONEYE=1 bun test mooneye.test.js -t "ei_sequence"
MOONEYE=1 bun test mooneye.test.js -t "ei_timing"
MOONEYE=1 bun test mooneye.test.js -t "rapid_di_ei"
bun test ch06-checkpoint.test.js
```



## Fix 3 — MBC5 stub (`oam_dma/sources-GS`)

See [chapter 17 — Remaining mappers](17-remaining-mappers.md) for the full MBC5 implementation. This appendix item is the Mooneye-specific smoke test.

### Hardware

Some Mooneye ROMs use mapper type `$1B` (MBC5 + RAM + battery). Without it, `createCart()` throws and the harness crashes mid-run.

### Verify

```bash
MOONEYE=1 bun test mooneye.test.js -t "oam_dma/sources"
```

The ROM should **load** without throwing. It may still **timeout** — that test expects cycle-accurate OAM DMA from multiple source regions.

## Fix 4 — Non-atomic interrupt dispatch (`interrupts/ie_push`)



### Hardware

Interrupt dispatch on real hardware is **not atomic**. It takes **4 M-cycles** (~20 T-cycles):

1. **Decision** — at the end of an instruction, if `IME && (IE & IF)`, dispatch begins.
2. **M1** — push the **high byte** of PC onto the stack (one real bus write).
3. **M2** — push the **low byte** of PC (second bus write).
4. **M3–M4** — load the vector address into PC.

During M1 and M2 the CPU still performs **real memory writes**. If `SP` points so the push targets `$FFFF` (`IE`), the pushed byte overwrites `IE`. That can change which interrupt is pending — or cancel dispatch entirely.

Read the Mooneye source (upstream `acceptance/interrupts/ie_push.s`) for four rounds:


| Round | Setup                                       | Expected behavior                                                                                                                                   |
| ----- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `SP = $0000`, Timer IRQ pending             | High-byte push writes to `$FFFF` (`IE`). New `IE` no longer enables Timer → `IE & IF == 0` → dispatch **cancelled**, PC → `$0000`, **IF unchanged** |
| 2     | Joypad IRQ pending, `IME` should still be 0 | No dispatch (proves round 1 left `IME = 0`)                                                                                                         |
| 3     | `SP = $0001`, Serial IRQ pending            | Low-byte push hits `$FFFF` — **too late to cancel** → normal dispatch to Serial vector, **IF bit cleared**                                          |
| 4     | VBlank + STAT pending, `SP = $0000`         | Push to `$FFFF` changes `IE` so only STAT remains enabled → dispatch **STAT** (not VBlank), clear STAT in IF, **VBlank bit stays set**              |


Key rules:

- Clear `IME` **immediately** when dispatch starts (before the push).
- Do **not** clear `IF` until dispatch **commits** (vector loaded). If cancelled during the **high-byte** push, leave `IF` alone.
- After the high-byte push, **re-read** `IE & IF` and take the **lowest set bit** for the vector (priority can change mid-dispatch).
- Cancellation (`IE & IF == 0` after high-byte push): set `PC = $0000`, charge the prologue cost, done.
- Lower-byte push **cannot cancel** — even if M2 clobbers `IE` so `IE & IF == 0` (round 3), still dispatch using the bit chosen after M1. After M2, re-read `IE & IF` only to **update priority** (round 4); if the re-read is empty, keep the M1 bit.

Reference: [gbdoc — Interrupts](https://mgba-emu.github.io/gbdoc/) (dispatch is not atomic; `$0000` on failed vector lookup).

### What we do wrong today

`serviceIfNeeded` in `src/interrupts.js` is a single atomic block:

```js
emu.cpu.ime = false;
emu.io.ackIf(bit);           // IF cleared too early
push16(emu.cpu, emu.cpu.pc); // both bytes instantly — no bus side effects mid-push
emu.cpu.pc = 0x0040 + bit * 8;
return 20;
```

That passes chapter 6 checkpoints and `intr_timing.gb`, but fails `ie_push.gb` because:

1. `IF` is cleared before the push, so round 1 cannot observe an uncleared Timer bit after cancellation.
2. `push16` writes both bytes in one call — no chance for the high-byte write to `$FFFF` to change `IE` mid-dispatch.
3. The vector bit is chosen once at the start, not re-evaluated after the high-byte push (round 4).



### Design

Keep chapter 6’s **“check once per instruction”** wrapper (`cpuStep` → `tickImeCountdown` → `serviceIfNeeded`). Change **only** the dispatch body:

```
src/interrupts.js   byte-at-a-time push, re-check IE&IF, cancel → $0000
src/ops/index.js    optional: interruptDispatch field on cpu (null when idle)
src/ops/ld.js       push16 stays as-is for opcodes — do not reuse inside dispatch
```

You can implement dispatch either as:

- **A small state machine** on `cpu` (`interruptDispatch: null | { pc, phase }`) stepped across calls to `serviceIfNeeded`, or
- **One synchronous function** that still does two separate `bus.write8` calls with a re-check between them (enough for `ie_push` without sub-instruction stepping).

The synchronous two-write version is the smallest diff; a state machine pays off later when you charge PPU/timer per M-cycle of the prologue.

Pseudocode for the synchronous approach:

```js
function lowestPendingBit(emu) {
  const pending = emu.bus.ie & emu.io.ifBits() & 0x1f;
  if (!pending) return -1;
  for (let bit = 0; bit < 5; bit++) {
    if (pending & (1 << bit)) return bit;
  }
  return -1;
}

export function serviceIfNeeded(emu) {
  const pending = emu.bus.ie & emu.io.ifBits() & 0x1f;
  if (!pending) return 0;

  emu.cpu.halted = false; // wake on pending IRQ even when IME is 0 (HALT path)

  if (!emu.cpu.ime) return 0;

  const { cpu } = emu;
  const returnPc = cpu.pc;

  cpu.ime = false;

  // M1 — high byte (real bus write; may hit $FFFF / IE)
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, (returnPc >> 8) & 0xff);

  let bit = lowestPendingBit(emu);
  if (bit < 0) {
    cpu.pc = 0x0000;
    return 20;
  }

  // M2 — low byte (too late to cancel; may still clobber IE — round 3)
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, returnPc & 0xff);

  const updated = lowestPendingBit(emu);
  if (updated >= 0) bit = updated; // round 4: priority can change after M1

  emu.io.ackIf(bit);
  cpu.pc = 0x0040 + bit * 8;
  return 20;
}
```

### Pitfalls

- Clearing `IF` **before the push** — round 1 checks Timer bit is still set after cancellation.
- **Cancelling after the low-byte push** — round 3 writes `$35` to `$FFFF` during M2, clearing the Serial enable bit; `IE & IF` becomes 0, but dispatch must still jump to the Serial vector. Only M1 can cancel.
- Using `push16()` inside dispatch — it hides the mid-push re-check; use two explicit `write8` calls.
- Forgetting `IME = 0` **before the push** — round 2 expects no Joypad dispatch.
- Dropping **`halted = false` when `IE & IF` is pending** — chapter 6 had this before the IME check; `handleHalt` also wakes, but `di_timing-GS`, `halt_ime*_timing`, and several PPU timing ROMs regress without it in `serviceIfNeeded`.
- `$0000` **mapping** — the test ROM places `jp hl` at `$0000`; your cart must still fetch from ROM bank 0 there (normal for Mooneye builds).
- Breaking `ch06-checkpoint.test.js` — the basic VBlank dispatch path must still land on `$0040` with IF cleared and stacked PC correct.



### Verify

```bash
MOONEYE=1 bun test mooneye.test.js -t "interrupts/ie_push"
MOONEYE=1 bun test mooneye.test.js -t "intr_timing"
bun test ch06-checkpoint.test.js
bun test
```

Expect **26 pass** on the Mooneye summary after this fix (+1).

## Fix 5 — Cycle-accurate OAM DMA (`oam_dma_timing`)



### Hardware

Chapter 11 implemented OAM DMA as an **instant 160-byte copy** when `$FF46` is written. Real hardware spreads the transfer over **160 M-cycles** (640 T-cycles, ~1.4 scanlines).

Pan Docs summary:

- Writing the **source page** (high byte of the address) to `$FF46` starts DMA.
- The copy is `$XX00–$XX9F` → `$FE00–$FE9F`, one byte per M-cycle, via normal `read8` semantics on the source side.
- On **DMG**, once the transfer is actively copying, the CPU cannot read OAM — OAM reads return `$FF`. HRAM (`$FF80–$FFFE`) remains usable; that is why games copy a tiny “wait for DMA” loop into HRAM first.
- The `$FF46` write itself is an I/O write (4 T-cycles). **OAM is still accessible for roughly two M-cycles after the write** before the lock begins.

Mooneye documents the start delay explicitly in `oam_dma_start.s`:

| M-cycle after `$FF46` write | Behavior |
| --- | --- |
| M0 | Write to `$FF46` (starts DMA) |
| M1 | Previous/new transfer not yet locking OAM — CPU can still execute code that touches `$FE00` |
| M2+ | OAM locked for CPU reads; fetches/reads from `$FE00–$FE9F` see `$FF` |

**Restarting DMA:** a second write to `$FF46` while a transfer is running does **not** instantly abort the old one. The previous transfer keeps going until the **new** transfer reaches its M2 lock point, then the new source page takes over.

Four acceptance ROMs exercise this (read the `.s` sources in `test_carts/mooneye/acceptance/` or upstream):


| ROM | What it checks |
| --- | --- |
| `oam_dma_start.gb` | M0/M1/M2 startup: an `INC B` at `$FE00` still runs (M1), but OAM reads during the lock return `$FF`; restarted DMA keeps the old lock until the new write’s M2 |
| `oam_dma_timing.gb` | Total duration ≈160 M-cycles: a `dec b` / `jr nz` busy loop (40 × 4 M-cycles) ends DMA; reading `$FE00` one T-cycle **before** end → `$FF`, one T-cycle **after** → copied byte (`$01` from `$8000`) |
| `oam_dma_restart.gb` | Same duration checks as `oam_dma_timing`, but triggers a **second** `$FF46` write mid-transfer |
| `oam_dma/sources-GS.gb` | Copies from ROM / WRAM / HRAM / (trap) OAM pages — needs correct source reads **and** DMA address decoding (see pitfalls) |


Reference: [Pan Docs — OAM DMA transfer](https://gbdev.io/pandocs/OAM_DMA_Transfer.html).

### What we do wrong today

`writeDma` in `src/bus.js` copies all 160 bytes synchronously inside the `$FF46` write handler:

```js
function writeDma(src) {
  src &= 0xff;
  dmaReg = src;
  const base = src << 8;
  for (let i = 0; i < 0xa0; i++) {
    oam[i] = read8(base + i);
  }
}
```

That passes chapter 11 (`ch11-checkpoint.test.js`) and the simple `oam_dma/basic.gb` / `oam_dma/reg_read.gb` ROMs, but fails timing tests because:

1. DMA finishes in **zero emulated time** — busy-wait loops never overlap the transfer.
2. OAM is never locked — reads during “DMA” return real OAM bytes instead of `$FF`.
3. There is no M1 startup window — `oam_dma_start.gb` expects an instruction at `$FE00` to run **before** the lock.
4. A second `$FF46` write replaces state instantly instead of following restart semantics.



### Design

Keep `$FF46` in `bus.js` (not `io.js`). Replace the instant loop with **DMA state** stepped on T-cycles in the main loop.

```
src/bus.js    dma state, byte-at-a-time copy, OAM lock on read8
src/emu.js    call bus.dmaStep(dt) from tickEmu alongside timer/PPU
```

Suggested state (closure variables or fields on the bus object):

```js
let dmaReg = 0xff;
let dmaActive = false;
let dmaSrc = 0;       // source page written to $FF46
let dmaIndex = 0;     // bytes copied so far (0..0xA0)
let dmaCountdown = 0; // T-cycles until next M-cycle action
```

**On `$FF46` write** (M0):

- `dmaReg = src & 0xff`, `dmaSrc = dmaReg`, `dmaIndex = 0`, `dmaActive = true`
- `dmaCountdown = 8` — two M-cycles of startup before the first byte copies
- **Restart:** if a transfer is already active, keep `dmaLock = true` immediately (the old transfer still owns OAM through the new write’s M1). Otherwise clear `dmaLock`.

**Each tick** — in `tickEmu`, after `cpuStep` returns `dt` T-cycles (and again on interrupt prologue `extra` cycles):

```js
function dmaStep(tCycles) {
  if (!dmaActive) return;
  while (tCycles > 0 && dmaActive) {
    if (dmaCountdown > 0) {
      const step = Math.min(tCycles, dmaCountdown);
      dmaCountdown -= step;
      tCycles -= step;
      continue;
    }
    if (dmaIndex < 0xa0) {
      dmaLock = true;
      oam[dmaIndex] = readDmaSource((dmaSrc << 8) + dmaIndex);
      dmaIndex++;
      tCycles -= Math.min(tCycles, 4); // one byte per M-cycle — no extra idle gap
    } else {
      dmaActive = false;
      dmaLock = false;
    }
  }
}
```

Use a separate **`readDmaSource`** helper (same as `read8` but without the OAM lock) for the copy path.

**OAM lock** — separate `dmaLock` flag, not `dmaActive` alone:

```js
if (dmaLock && addr >= 0xfe00 && addr < 0xfea0) return 0xff;
```

Lock turns on when the **first byte** copies (after the 8 T-cycle startup), or **immediately** on a restart write while a previous transfer is still running.

**Chapter 11 unit test** — `ch11-checkpoint.test.js` calls `bus.write8($FF46)` without running `tickEmu`. Export `bus.finishDma()` that drains the transfer synchronously; call it after the write in that test.

**Do not** set `dmaCountdown = 4` after each byte — that doubles the transfer time and breaks `oam_dma_timing.gb`.



### Pitfalls

- **Instant copy** — the most common failure; timing ROMs time out or report `42`.
- **Idle gap between bytes** — `dmaCountdown = 4` after each copy makes the transfer ~320 M-cycles; `oam_dma_timing.gb` fails.
- **Locking on `dmaActive` alone** — OAM reads go `$FF` during the M1 startup window; `oam_dma_start.gb` cannot execute `INC B` at `$FE00`.
- **Clearing `dmaLock` on restart** — a second `$FF46` write while DMA runs must keep OAM locked through M1; `oam_dma_start.gb` round 2 expects `B = 0`.
- **Locking all memory** — Mooneye timing ROMs only need OAM reads to return `$FF`. Returning `$FF` for ROM/WRAM everywhere is a myth and breaks less, but `oam_dma/sources-GS.gb` needs real source reads through `read8`.
- **`sources-GS` address decoding** — when the DMA unit reads `$FE00–$FE9F`, that address is driven on the **external** bus, not OAM. An emulator that “copies OAM to OAM” or skips the transfer fails the `$FE00` source page trap. Full bus-conflict modeling (CPU vs DMA on the same bus) will be implemented in the future ([ToDo.md](../ToDo.md)).
- **Forgetting to step DMA on interrupt prologue cycles** — if `serviceIfNeeded` returns extra T-cycles, those cycles should advance DMA too (same as PPU/timer).
- **Breaking chapter 11** — after DMA completes, all 160 bytes must match the old instant-copy behavior; `ch11-checkpoint.test.js` should still pass.



### Verify

```bash
MOONEYE=1 bun test mooneye.test.js -t "oam_dma_timing"
MOONEYE=1 bun test mooneye.test.js -t "oam_dma_start"
MOONEYE=1 bun test mooneye.test.js -t "oam_dma_restart"
MOONEYE=1 bun test mooneye.test.js -t "oam_dma/"
bun test ch11-checkpoint.test.js
bun test
```

Expect **+3** on the Mooneye summary (`oam_dma_start`, `oam_dma_timing`, `oam_dma_restart`). `oam_dma/sources-GS.gb` may still fail or timeout until source decoding / bus conflicts are implemented — that is OK for this fix.

## What still fails (and why)

After fixes 1–4, expect roughly **26 pass / 35 fail / 1 timeout**. Group the remainder:


| Category           | ROMs still failing                                                                                             | Blocker                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Instruction timing | `call_timing`, `jp_timing`, `push_timing`, `pop_timing`, `ret_timing`, `rst_timing`, `add_sp_e_timing`, … (14) | Per-opcode cycle counts must match hardware exactly |
| OAM DMA timing     | `oam_dma/sources-GS` (fail/timeout)                                                                            | DMA address decoding for `$FE00` source page        |
| Timer edge cases   | `timer/tim00_div_trigger`, `timer/tima_reload`, `timer/rapid_toggle`, … (8)                                    | DIV-to-TIMA phase, reload quirks                    |
| PPU timing         | `ppu/lcdon_timing-GS`, `ppu/stat_irq_blocking`, `ppu/intr_2_mode3_timing`, … (10)                              | Mode 3 stretch, STAT blocking, LCD-on delay         |


Do not try to fix all of these in one sitting. Pick **one ROM**, read the `.s` source in the Mooneye repo, reproduce the failure, fix the smallest thing that makes that ROM pass, regression-test the suite.

## Suggested order for the next passes

1. **`oam_dma_timing.gb`** — Fix 5 above; implement 160 M-cycle DMA with OAM lock and startup delay.
2. **One** `*_timing.gb` **from the CPU set** — forces you to audit opcode durations in `gb-opcodes.json`.
3. **PPU tests** — only after you accept mode-3 variable length or fixed-172 limitations.
4. **`oam_dma/sources-GS.gb`** — optional stretch; needs DMA address decoding beyond basic timing.



## Checkpoint

- `bun run test:mooneye` runs without crashing.
- Fixes 1–4 pass.
- `bun test` still green (unit + chapter checkpoints).
- Fixes 1–5 pass (`oam_dma_start`, `oam_dma_timing`, `oam_dma_restart`; not `sources-GS`).



## Further reading

- [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite) — `.s` sources next to each `.gb`
- [gbdoc — Interrupts](https://mgba-emu.github.io/gbdoc/)
- [docs/reference/io-registers.md](../docs/reference/io-registers.md) — stub vs implemented I/O
- [docs/reference/test-roms.md](../docs/reference/test-roms.md) — Blargg vs Mooneye vs commercial games
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) — when instruction-level timing is not enough
- [Pan Docs — OAM DMA transfer](https://gbdev.io/pandocs/OAM_DMA_Transfer.html)
- [Pan Docs — MBC5](https://gbdev.io/pandocs/MBC5.html)

