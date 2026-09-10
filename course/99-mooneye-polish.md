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
| 6a  | M-cycle CPU stepping                      | (infrastructure)              | pending                  |
| 6b  | PUSH / POP memory timing                  | `push_timing.gb`              | pending                  |
| 6c  | JP / CALL imm16 fetch timing              | `jp_timing.gb`                | pending                  |
| 6d  | RET / RST / RETI stack timing               | `ret_timing.gb`               | pending                  |
| 7a  | LCD-on delay + bus access                 | `ppu/lcdon_timing-GS.gb`      | pending                  |
| 7b  | STAT IRQ blocking                         | `ppu/stat_irq_blocking.gb`    | pending                  |
| 7c  | STAT interrupt edge timing                | `ppu/intr_2_mode3_timing.gb`  | pending                  |
| 7d  | LYC latch when LCD off                    | `ppu/stat_lyc_onoff.gb`       | pending                  |
| 7e  | VBlank + mode-2 at LY 144                 | `ppu/vblank_stat_intr-GS.gb`  | pending                  |
| 7f  | Variable mode-3 length (SCX / sprites)     | `ppu/hblank_ly_scx_timing-GS.gb` | pending              |


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

## Fix 6 — CPU memory-access timing (`*_timing.gb`)



### Hardware

Chapter 4–7 implemented the CPU as **instruction-level**: each opcode runs to completion, returns a total T-cycle count, and only then do timer, PPU, and DMA advance. That matches [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) and is enough for Tetris and Pokémon.

Mooneye’s remaining CPU timing ROMs need **M-cycle accuracy** — *when* each memory access inside a multi-cycle instruction happens, not just the final duration. On hardware every memory read/write is a separate 4 T-cycle M-cycle; DMA, DIV, and OAM lock can observe the bus **mid-instruction**.

After Fix 5 the suite has **12 failing** CPU/stack timing ROMs (below). Another **10** `*_timing.gb` ROMs already pass because they only check **total** instruction length synced via timer/DIV (`add_sp_e_timing`, `ld_hl_sp_e_timing`, `div_timing`, `ei_timing`, `di_timing-GS`, `halt_ime*`, `intr_timing`, `reti_intr_timing`, …).


| ROM | What it checks |
| --- | --- |
| `push_timing.gb` | PUSH `rr`: M1 internal delay, M2 high-byte write, M3 low-byte write (OAM DMA overlap) |
| `pop_timing.gb` | POP `rr`: M1 low-byte read, M2 high-byte read (DIV increment alignment) |
| `jp_timing.gb` | JP `nn`: M1/M2 imm16 fetch, M3 internal delay |
| `jp_cc_timing.gb` | JP `cc, nn`: same fetch timing when branch taken |
| `call_timing.gb` | CALL `nn`: M1/M2 imm16 fetch, M3 delay, M4/M5 PC push |
| `call_timing2.gb` | Second round of `call_timing` with different DMA alignment |
| `call_cc_timing.gb` | CALL `cc, nn` when condition true |
| `call_cc_timing2.gb` | Second round of conditional CALL |
| `ret_timing.gb` | RET: M1/M2 PC pop, M3 internal delay (OAM DMA overlap) |
| `ret_cc_timing.gb` | RET `cc` when condition true |
| `rst_timing.gb` | RST: M1 delay, M2/M3 PC push (like PUSH) |
| `reti_timing.gb` | RETI: same stack timing as RET + IME enable |

Reference: [Pan Docs — CPU instruction set](https://gbdev.io/pandocs/CPU_Instruction_Set.html), Mooneye `.s` comments for M-cycle breakdowns.

### What we do wrong today

Opcodes execute **atomically**. Memory helpers run back-to-back with no T-cycles between them:

```js
// src/ops/ld.js — both stack writes in one instant
export function push16(cpu, v) {
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, v >> 8);
  cpu.sp = (cpu.sp - 1) & 0xffff;
  cpu.bus.write8(cpu.sp, v & 0xff);
  return 16;
}

// src/ops/helpers.js — both operand bytes fetched instantly
export function readImm16(cpu) {
  const lo = readImm8(cpu);
  const hi = readImm8(cpu);
  return lo | (hi << 8);
}
```

`tickEmu` advances timer/PPU/DMA **once per finished instruction**:

```js
export function tickEmu(emu) {
  const dt = cpuStep(emu);          // whole instruction
  emu.bus.dmaStep(dt);
  timerStep(emu.io, dt);
  ppuStep(emu.ppu, emu.io, dt, ...);
  ...
}
```

Mooneye aligns bus events to specific M-cycles:

- **`push_timing` / `rst_timing` / `call_timing` / `jp_timing` / `ret_timing`** — start OAM DMA, busy-wait until the transfer is one T-cycle before/after ending, then execute the opcode. If the imm16 **high byte** is fetched from `$FE00` while DMA still locks OAM, the read returns `$FF` and the jump/call target is wrong. Atomic fetch breaks that alignment.
- **`pop_timing`** — points SP at `$FF04` (DIV), counts `nop`s so a DIV increment (256 T) lands on M1/M2/M3 of POP, and checks which byte was affected.

Total cycle **counts** in `gb-opcodes.json` and opcode handlers are already correct for many opcodes (hence passing `add_sp_e_timing`, etc.). Fix 6 is about **splitting** memory operations across M-cycles so the rest of the machine can tick between them.

### Design

Work through **6a → 6d**. Fix 5 (cycle-accurate DMA) is a **hard dependency** — most stack/fetch tests overlap OAM DMA.

```
src/emu.js          tickEmu steps partial T-cycles between M-cycles
src/ops/index.js    step() respects mid-instruction state
src/ops/ld.js       push16 / pop16 / readImm16 split across M-cycles
src/ops/call.js     CALL / RET / RST / RETI split across M-cycles
src/ops/jp_jr.js    JP nn / JP cc split imm16 fetch
src/interrupts.js   IME countdown + IRQ check still once per *finished* instruction
```

#### Fix 6a — M-cycle stepping infrastructure

Add a **`cpu.exec`** field (or equivalent) that tracks a partially executed instruction:

```js
// null when idle; otherwise { finish, mCycle, ... }
cpu.exec = null;
```

Two workable shapes:

1. **Global M-cycle loop** — `cpuStep` always advances exactly one M-cycle (4 T), returns 4, and `tickEmu` always runs DMA/timer/PPU for those 4 T. Opcodes register multi-M-cycle sequences.
2. **Yielding opcodes** — `step()` returns early with `{ cycles: 4, done: false }` until the instruction completes; `cpuStep` loops or `tickEmu` re-enters until `done`.

Pick one; Mooneye only needs memory-access boundaries, not a full SM83 microcode table.

Rules:

- **Fetch** (`step` reading opcode/`$CB`) is M0 of the instruction — already separate from the handler.
- After each **memory access** M-cycle, return control so `dmaStep` / `timerStep` / `ppuStep` run for 4 T (or the correct count for internal delays — see M-cycle tables below).
- **Interrupt dispatch** (Fix 4) already uses two explicit `write8` calls; keep IRQ checks at **instruction boundaries** (after `cpu.exec` clears), not mid-PUSH.
- **`HALT`** still returns 4 T per spin without starting `cpu.exec`.
- Unit tests that call `step()` once expecting a finished instruction may need `runUntilInstructionDone(emu)` helper.

#### Fix 6b — PUSH / POP (`push_timing`, `pop_timing`)

Hardware M-cycle maps (from Mooneye sources):

| Instruction | M0 | M1 | M2 | M3 |
| --- | --- | --- | --- | --- |
| PUSH `rr` | decode | internal | write high byte | write low byte |
| POP `rr` | decode | read low byte | read high byte | — |

Implementation notes:

- **PUSH** — do not call `push16()` as one blob. Decrement SP and write high byte on M2; decrement SP and write low byte on M3. M1 is idle (still costs 4 T).
- **POP** — read low byte on M1, read high byte on M2; update `rr` after both. M3 for RET is internal delay (see 6d); POP itself is 3 M-cycles (12 T).

`push_timing.gb` expects:

- First PUSH: high-byte write at M2 while OAM DMA still allows OAM writes → `POP HL` reads `$4224`.
- Second PUSH: high-byte write at M3 while OAM is locked → high byte lost, `POP DE` sees `$81xx` from DMA-filled OAM.

`pop_timing.gb` expects DIV bit to flip during M1/M2/M3 — verify with `assert` on `B`, `C`, `D`, `E`, `A` after scripted `nop` counts (61/62 T offsets).

#### Fix 6c — JP / CALL imm16 fetch (`jp_timing`, `jp_cc_timing`, `call_timing*`)

| Instruction | M0 | M1 | M2 | M3 | M4 | M5 |
| --- | --- | --- | --- | --- | --- | --- |
| JP `nn` | decode | read `nn` low | read `nn` high | internal | — | — |
| CALL `nn` | decode | read `nn` low | read `nn` high | internal | push PC high | push PC low |

Conditional variants (`JP cc`, `CALL cc`) fetch **both operand bytes** before evaluating the condition — same M1/M2 timing whether taken or not; only M3+ differ (JP taken: internal + PC update; CALL taken: push; not taken: shorter path, 12 T total for JP cc).

Do **not** use `readImm16()` inside these handlers. Fetch low byte on M1, high byte on M2 as separate bus reads (PC advances one byte per read). CALL push uses the same split push as 6b on M4/M5.

The Mooneye HRAM test copies `JP $1a00` / `CALL $1a00` so the **high byte of `nn` lives in OAM** during the fetch. Aligning DMA end to M2 makes the high byte `$FF` → jump/call to `$xxCA` (fail path) vs `$1a` → success path.

Apply the same pattern to all four CALL/JP ROMs (`call_timing2`, `call_cc_timing2` are second alignment rounds).

#### Fix 6d — RET / RST / RETI (`ret_timing`, `ret_cc_timing`, `rst_timing`, `reti_timing`)

| Instruction | M0 | M1 | M2 | M3 | M4 |
| --- | --- | --- | --- | --- | --- |
| RET | decode | read PC low | read PC high | internal | — |
| RST | decode | internal | push PC high | push PC low | — |
| RETI | same as RET | | | | IME=1 after pop |

- **RET** — split `ret()` in `call.js` like POP: low byte M1, high byte M2, idle M3. `ret_timing.gb` overlaps RET’s high-byte read with OAM DMA (similar to PUSH).
- **RET `cc`** — when condition false, 8 T (2 M-cycles); when true, use RET timing (20 T).
- **RST** — M1 internal, then PUSH-style M2/M3 writes. `rst_timing.gb` checks high vs low push relative to DMA (expects wrong high byte `$81`, correct low `$9E` in round 1).
- **RETI** — identical stack timing to RET; set `cpu.ime = true` and clear `imeEnableCountdown` **after** the M3 delay (same instant as hardware). `reti_intr_timing.gb` already passes; `reti_timing.gb` fails on stack access timing, not IME semantics.

### Pitfalls

- **Only fixing `gb-opcodes.json` totals** — `push_timing` still fails; the test never compares your JSON, it compares bus observation mid-instruction.
- **Keeping atomic `push16` / `readImm16`** — wrap them for chapter tests if needed, but Mooneye paths must use split M-cycles.
- **Advancing DMA/timer/PPU once at the end of a split instruction** — must tick **between** M-cycles or OAM lock alignment is wrong.
- **Running interrupt dispatch mid-PUSH** — keep `serviceIfNeeded` at instruction end only (after `cpu.exec` is null).
- **Breaking Fix 4 `ie_push`** — non-atomic IRQ dispatch is separate; its two `write8` calls are already sequential.
- **Breaking chapter 4–6 checkpoints** — finished-instruction behaviour must stay identical; only *when* subsystems tick changes.
- **Fix 5 regression** — DMA M1 startup window must still work; these tests rely on it.

### Verify

Work through one sub-fix at a time:

```bash
# 6b
MOONEYE=1 bun test mooneye.test.js -t "push_timing"
MOONEYE=1 bun test mooneye.test.js -t "pop_timing"

# 6c
MOONEYE=1 bun test mooneye.test.js -t "jp_timing"
MOONEYE=1 bun test mooneye.test.js -t "jp_cc_timing"
MOONEYE=1 bun test mooneye.test.js -t "call_timing"

# 6d
MOONEYE=1 bun test mooneye.test.js -t "ret_timing"
MOONEYE=1 bun test mooneye.test.js -t "ret_cc_timing"
MOONEYE=1 bun test mooneye.test.js -t "rst_timing"
MOONEYE=1 bun test mooneye.test.js -t "reti_timing"

# Full stack-timing set + regressions
MOONEYE=1 bun test mooneye.test.js -t "push_timing|pop_timing|jp_timing|call_timing|ret_timing|rst_timing|reti_timing"
bun test ch04-checkpoint.test.js
bun test ch06-checkpoint.test.js
bun test ch11-checkpoint.test.js
bun test
```

Expect **+12** on the Mooneye summary when all of 6b–6d pass (31 → 43). Partial progress is normal — update the progress table as each sub-fix lands.

## Fix 7 — PPU timing suite (`ppu/*`)



### Hardware

Chapter 8 built a **fixed-length** mode machine: 80 T OAM → 172 T draw → 204 T HBlank, plus 456 T VBlank lines. That is enough for Tetris and Pokémon. Mooneye’s PPU acceptance ROMs need **cycle-accurate edges**: LCD-on quirks, CPU bus restrictions during modes 2–3, STAT IRQ blocking, LYC latch behaviour, and (for the hardest tests) **variable mode-3 length** from SCX and sprites.

Read the `.s` sources upstream in [mooneye-test-suite/acceptance/ppu/](https://github.com/Gekkio/mooneye-test-suite/tree/master/acceptance/ppu). After Fix 5 the suite has **2 / 11** PPU ROMs passing (`intr_1_2_timing-GS`, `intr_2_0_timing`); the rest report `42`.


| ROM | What it checks |
| --- | --- |
| `lcdon_timing-GS.gb` | LY, STAT, and OAM/VRAM **read** accessibility after LCDC bit 7 goes 0→1 |
| `lcdon_write_timing-GS.gb` | Same window, but **writes** to OAM/VRAM |
| `stat_irq_blocking.gb` | Internal STAT line stays set when hopping between enabled modes; only mode 3 clears it |
| `intr_2_mode3_timing.gb` | T-cycles from STAT mode-2 IRQ until STAT reads mode 3 |
| `intr_2_mode0_timing.gb` | T-cycles from STAT mode-2 IRQ until STAT reads mode 0 (HBlank) |
| `intr_2_oam_ok_timing.gb` | T-cycles from STAT mode-2 IRQ until OAM reads return real data (not `$FF`) |
| `intr_2_mode0_timing_sprites.gb` | Like `intr_2_mode0_timing`, but mode-3 length depends on sprite count |
| `stat_lyc_onoff.gb` | LYC coincidence bit latched when LCD off; interrupt only when comparison **changes** on LCD on |
| `vblank_stat_intr-GS.gb` | Mode-2 STAT IRQ at LY 144 fires at the **same instant** as VBlank (IF bit 0) |
| `hblank_ly_scx_timing-GS.gb` | Mode-3 length varies with `SCX mod 8`; affects HBlank IRQ → LY increment delay |

References: [Pan Docs — LCD Status register (STAT)](https://gbdev.io/pandocs/STAT.html), [Pan Docs — LCD Timing](https://gbdev.io/pandocs/LCDC.html#lcd-status-stat), [docs/reference/ppu.md](../docs/reference/ppu.md).

### What we do wrong today

**LCD on jumps to mode 2.** `writeLcdc` in `src/bus.js` sets `mode = MODE_OAM` when bit 7 goes 0→1. Hardware starts line 0 in **mode 0** (HBlank), skips the OAM scan, and is **2 T-cycles late** relative to a normal line.

**No CPU bus restrictions.** `read8` / `write8` always reach OAM and VRAM. During mode 2 the CPU cannot read OAM (`$FF`); during mode 3 it cannot read or write OAM or VRAM.

**STAT IRQs fire naïvely.** `advanceMode` calls `io.requestIf(1)` on every mode entry when the matching STAT enable bit is set. Hardware has an **internal STAT line** that is **not cleared** when entering one enabled mode from another enabled mode — only **mode 3** clears it. See `stat_irq_blocking.gb`.

**Fixed mode-3 length (172 T).** `modeLength(3)` is a constant. Real hardware stretches mode 3 by `SCX mod 8` (and by sprites). `hblank_ly_scx_timing-GS.gb` and `intr_2_mode0_timing_sprites.gb` need this.

**LYC comparison ignores LCD-off latch.** `updateStatLyEquals` runs only inside `ppuStep` while the LCD is on. When the LCD is off, the LYC coincidence bit is **frozen**; writes to `$FF45` do not update it until the comparison clock runs again.

**No mode-2 STAT IRQ at LY 144.** Entering VBlank sets IF bit 0 but does not also raise STAT when bit 5 (mode-2 IE) is enabled — `vblank_stat_intr-GS.gb` compares DIV timestamps and expects them to match.

### Design

Work through **7a → 7f** in order. Each sub-fix should pass its ROM(s) before moving on. Files:

```
src/ppu.js     mode machine, STAT line, LYC latch, variable mode 3
src/bus.js     LCD-on edge, OAM/VRAM access gating (needs ppu.mode)
src/emu.js     thread ppu into bus if needed for access checks
```

#### Fix 7a — LCD-on delay (`lcdon_timing-GS`, `lcdon_write_timing-GS`)

When LCDC bit 7 goes **0→1** (in `writeLcdc`):

- Set `ly = 0`, `lineCycles = 0`, `mode = MODE_HBLANK` (mode 0) — **not** mode 2.
- Set a flag such as `ppu.lcdJustEnabled = true` (or `firstLineAfterEnable = true`).

In `ppuStep`, while `lcdJustEnabled` is true for **line 0 only**:

- **Skip mode 2** entirely: from mode 0 go straight to mode 3 when the first HBlank slice ends (Mooneye: “line 0 starts with mode 0 and goes straight to mode 3”).
- Shorten the first line’s timings by **2 T** (the PPU starts late). The test samples at cycles 0, 17, 60, 110, … — three passes offset the LCDC write by 0, 1, and 2 `nop`s before reading.
- Clear `lcdJustEnabled` when line 0 completes (LY becomes 1); lines 1+ use normal 80/172/204 timing.

Expected LY after LCD enable (from `lcdon_timing-GS.s`, all three pass offsets combined):

```
00 00 00 00 01 01 01 02   (pass 1 — write then read immediately)
00 00 00 01 01 01 02 02   (pass 2 — 1 nop before reads)
00 00 00 01 01 01 02 02   (pass 3 — 2 nops before reads)
```

Implement **7a together with bus access** (below) — the same ROMs check OAM/VRAM accessibility at each cycle.

**OAM / VRAM access** — in `bus.js` `read8` / `write8`, when LCD is on (`ppu.lcdc & 0x80`):

| PPU mode | OAM `$FE00–$FE9F` | VRAM `$8000–$9FFF` |
| --- | --- | --- |
| 0 HBlank | read/write OK | read/write OK |
| 1 VBlank | read/write OK | read/write OK |
| 2 OAM scan | **read → `$FF`**, write ignored | read/write OK |
| 3 Draw | **read → `$FF`**, write ignored | **read → `$FF`**, write ignored |

DMA (`dmaLock`) is independent — OAM lock during DMA still returns `$FF` as in Fix 5.

`lcdon_write_timing-GS.gb` uses the same cycle windows but checks that **writes stick** (value `$81`) when access is allowed and are **discarded** (memory stays `$00`) when blocked.

#### Fix 7b — STAT IRQ blocking (`stat_irq_blocking`)

Track an internal **`statSignal`** (or `statIrqLine`) on the PPU:

- When a STAT condition becomes true (mode entry with IE bit set, or LY=LYC rising edge with bit 6 set), set `statSignal = true` and `io.requestIf(1)` **only if** the signal was previously false **or** the condition is one that clears and re-asserts per hardware rules.
- **Entering a mode whose STAT IE bit is enabled does not request IF** if `statSignal` is already true from a previous enabled mode — the internal line was never cleared.
- **Entering mode 3 (draw) clears `statSignal`.** After mode 3 ends, the next enabled mode can raise IF again.

The test (`stat_irq_blocking.s`) enables all STAT IE bits, loops LY 0..143 with LYC=LY, waits for LYC match during mode 0 while keeping LY=LYC through mode 2, and expects **no STAT IRQ** in the inner loop because the line stays asserted from mode 2 through mode 0 without passing through mode 3.

Pseudocode sketch inside `advanceMode`:

```js
function requestStatIf(ppu, io, reason) {
  // reason: 'mode0' | 'mode1' | 'mode2' | 'lyc'
  if (!statIeBitEnabled(ppu, reason)) return;
  if (ppu.statSignal) return; // blocked — internal line still high
  ppu.statSignal = true;
  io.requestIf(1);
}

function enterMode3(ppu) {
  ppu.statSignal = false; // only mode 3 clears the internal line
  ppu.mode = MODE_DRAW;
}
```

LYC coincidence needs the same signal: if LY=LYC stays true across mode boundaries without mode 3, do not re-fire.

#### Fix 7c — STAT interrupt edge timing (`intr_2_mode3`, `intr_2_mode0`, `intr_2_oam_ok`)

These ROMs HALT with only STAT enabled, wait for **mode-2** STAT IRQ at a chosen scanline, then count `nop`s until STAT (or OAM) reads show the next mode.

| ROM | Poll target | Expected `nop` counts (B register) |
| --- | --- | --- |
| `intr_2_mode3_timing.gb` | STAT mode === 3 | delay 3 → B=1, delay 2 → B=2 |
| `intr_2_mode0_timing.gb` | STAT mode !== 0 (wait until HBlank) | delay 46 → B=1, delay 45 → B=2 |
| `intr_2_oam_ok_timing.gb` | OAM read !== `$FF` | delay 46 → B=1, delay 45 → B=2 |

They pass only when:

1. STAT mode-2 IRQ fires at the **correct T-cycle** within mode 2 (start of OAM scan after HBlank).
2. Mode lengths match hardware (fixed 172 T is OK for the non-sprite variants **if** LCD-on and STAT blocking are already correct).
3. OAM accessibility in `bus.js` turns off at mode 2 start and back on at mode 3 end — the OAM test counts from the IRQ handler until `$FF` clears.

If 7a–7b pass but these still fail, log `ppu.mode`, `ppu.lineCycles`, and IF/STAT at each T-cycle against the Mooneye source — the off-by-one is usually IRQ fire timing (edge of mode transition vs start of `ppuStep` slice).

#### Fix 7d — LYC latch when LCD off (`stat_lyc_onoff`)

When LCDC bit 7 is **0**:

- **Freeze** the LYC coincidence state: keep exposing `(ppu.ly === ppu.lyc)` on STAT bit 2 as it was when the LCD turned off (store `ppu.lycMatchLatched`).
- **Ignore writes to `$FF45`** for comparison purposes until the LCD is on again (still store `ppu.lyc` for when the clock restarts).
- Do **not** run `updateStatLyEquals` while the LCD is off.

When LCDC bit 7 goes **0→1**:

- Recompute LY vs LYC with `ly = 0` and the current `lyc`.
- Fire STAT IRQ (bit 6) **only if** the coincidence bit **changes** compared to the latched value — not if both old and new comparisons are “equal” (see round 2 vs round 4 in `stat_lyc_onoff.s`).

Four rounds in the test:

| Round | LCD off while | LYC change while off | LCD on | Expect |
| --- | --- | --- | --- | --- |
| 1 | match (LY=$90) | yes ($90→$01) | yes | bit clears ($C0), **STAT IRQ** |
| 2 | match | yes ($90→$00, still match logically) | yes | bit stays ($C4), **no IRQ** |
| 3 | no match | yes ($00→$01) | yes | bit stays ($C0), **no IRQ** |
| 4 | no match | no | yes | bit sets, **STAT IRQ** |

#### Fix 7e — VBlank + mode-2 at LY 144 (`vblank_stat_intr-GS`)

When **LY becomes 144** (end of visible line 143, entering VBlank):

- Always `io.requestIf(0)` (VBlank) as today.
- **Also**, if STAT bit 5 (mode-2 / OAM IE) is set, treat this as a mode-2 STAT condition and `io.requestIf(1)` at the **same T-cycle** — the test compares DIV deltas between pure VBlank and STAT-at-144 and expects identical timing (rounds 1&3 → `$01`, rounds 2&4 → `$00`).

This is separate from the mode-1 STAT IE (bit 4). Bit 5 is “OAM scan interrupt enable,” but hardware also uses it at the VBlank boundary on line 144.

#### Fix 7f — Variable mode-3 length (`hblank_ly_scx_timing-GS`, `intr_2_mode0_timing_sprites`)

Mode 3 is **not** always 172 T, and mode 0 is **not** always 204 T — a scanline is always **456 T** total (80 T mode 2 + mode 3 + mode 0). On DMG with no sprites, **SCX fine scroll** (`SCX & 7`, latched at mode-3 start) lengthens mode 3 and **shortens HBlank by the same amount**:

```js
const scxFine = ppu.scx & 7;
const mode3Len = 172 + scxFine;
const mode0Len = 204 - scxFine;
// mode2Len stays 80; 80 + mode3Len + mode0Len === 456
```

`hblank_ly_scx_timing-GS.s` enables STAT HBlank IE (bit 3), HALTs on HBlank IRQ, then counts `nop`s until `LY` increments. Because HBlank is shorter when `SCX & 7` is larger, the same handler overhead crosses the LY increment on fewer `nop`s:

| `SCX mod 8` | T-cycles from STAT IRQ to LY increment (approx.) | Test `delay_a` / `delay_b` |
| --- | --- | --- |
| 0 | 51 | 2 / 3 |
| 1–4 | 50 | 1 / 2 |
| 5–7 | 49 | 0 / 1 |

`intr_2_mode0_timing_sprites.gb` adds **sprite penalty** on top: mode 3 grows by **2 T per sprite** on the line (up to 10 sprites), and mode 0 shrinks accordingly.

This is the largest jump in complexity. A full pixel FIFO is out of scope; per-line `mode3Len` / `mode0Len` from latched SCX (+ sprites) is enough for these Mooneye ROMs. Commercial games may need more later.

### Pitfalls

- **Jumping to mode 2 on LCD enable** — the single most common `lcdon_timing-GS` failure; chapter 8 explicitly said mode 2, but Mooneye documents the hardware exception for line 0.
- **Gating VRAM in mode 2** — only OAM is locked during mode 2; VRAM stays accessible until mode 3.
- **Clearing `statSignal` on every mode change** — breaks `stat_irq_blocking`; only mode 3 clears it.
- **Re-firing LYC IRQ every line** while LY=LYC — use `lycMatchPrev` (you already have this) **and** respect the LCD-off latch from 7d.
- **Fixed 172 T forever** — `intr_2_mode0_timing` may pass with fixed length, but `hblank_ly_scx_timing-GS` and `intr_2_mode0_timing_sprites` will not.
- **Breaking chapter 8–11 checkpoints** — LCD off still forces LY=0, mode 0, white screen; one frame is still 70 224 T; Tetris VBlank wait must keep working.
- **Forgetting `halted = false` on pending IRQ** — already required for Fix 4; PPU timing HALT tests depend on it.

### Verify

Work through one sub-fix at a time:

```bash
# 7a — LCD on + bus access
MOONEYE=1 bun test mooneye.test.js -t "lcdon_timing"
MOONEYE=1 bun test mooneye.test.js -t "lcdon_write_timing"

# 7b
MOONEYE=1 bun test mooneye.test.js -t "stat_irq_blocking"

# 7c
MOONEYE=1 bun test mooneye.test.js -t "intr_2_mode3_timing"
MOONEYE=1 bun test mooneye.test.js -t "intr_2_mode0_timing"
MOONEYE=1 bun test mooneye.test.js -t "intr_2_oam_ok_timing"

# 7d
MOONEYE=1 bun test mooneye.test.js -t "stat_lyc_onoff"

# 7e
MOONEYE=1 bun test mooneye.test.js -t "vblank_stat_intr"

# 7f
MOONEYE=1 bun test mooneye.test.js -t "hblank_ly_scx_timing"
MOONEYE=1 bun test mooneye.test.js -t "intr_2_mode0_timing_sprites"

# Full PPU folder + chapter regressions
MOONEYE=1 bun test mooneye.test.js -t "ppu/"
bun test test/ch08-checkpoint.test.js
bun test test/ch09-checkpoint.test.js
bun test test/ch11-checkpoint.test.js
bun test
```

Expect **+9** on the Mooneye summary when all of 7a–7f pass (11/11 PPU ROMs; two already pass today). Partial progress is normal — update the progress table rows as each sub-fix lands.

## What still fails (and why)

After fixes 1–5, expect roughly **31 pass / 30 fail / 1 timeout**. Group the remainder:


| Category           | ROMs still failing                                                                                             | Blocker                                                       |
| ------------------ | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| CPU memory timing  | 12× `push_timing`, `pop_timing`, `jp_timing`, `call_timing*`, `ret_timing`, `rst_timing`, … (see Fix 6)      | M-cycle memory access timing; instructions run atomically today |
| OAM DMA timing     | `oam_dma/sources-GS` (fail/timeout)                                                                            | DMA address decoding for `$FE00` source page                  |
| Timer edge cases   | `timer/tim00_div_trigger`, `timer/tima_reload`, `timer/rapid_toggle`, … (8)                                    | DIV-to-TIMA phase, reload quirks                              |
| PPU timing         | 9× `ppu/*` (see Fix 7)                                                                                         | LCD-on delay, bus gating, STAT blocking, mode-3 stretch       |


Do not try to fix all of these in one sitting. Pick **one ROM**, read the `.s` source in the Mooneye repo, reproduce the failure, fix the smallest thing that makes that ROM pass, regression-test the suite.

## Suggested order for the next passes

1. **Fix 6a** — M-cycle stepping in `tickEmu` / `cpuStep` (infrastructure for everything below).
2. **Fix 6b** — `push_timing` + `pop_timing` (simplest split stack ops).
3. **Fix 6c–6d** — JP/CALL fetch timing, then RET/RST/RETI.
4. **Fix 7a** — `lcdon_timing-GS` + `lcdon_write_timing-GS` (LCD-on delay and OAM/VRAM gating).
5. **Fix 7b–7e** — STAT quirks in order (blocking → edge timing → LYC latch → VBlank/144).
6. **Fix 7f** — variable mode-3 length (`hblank_ly_scx_timing-GS`, sprites variant).
7. **`oam_dma/sources-GS.gb`** — optional stretch; needs DMA address decoding beyond basic timing.



## Checkpoint

- `bun run test:mooneye` runs without crashing.
- Fixes 1–5 pass (`oam_dma_start`, `oam_dma_timing`, `oam_dma_restart`; not `sources-GS`).
- `bun test` still green (unit + chapter checkpoints).
- Fix 6 (optional): all 12 stack/fetch timing ROMs pass; chapter CPU checkpoints still green.
- Fix 7 (optional): all 11 `ppu/*` acceptance ROMs pass; `ch08`–`ch11` checkpoints still green.



## Further reading

- [Mooneye Test Suite](https://github.com/Gekkio/mooneye-test-suite) — `.s` sources next to each `.gb`
- [gbdoc — Interrupts](https://mgba-emu.github.io/gbdoc/)
- [docs/reference/ppu.md](../docs/reference/ppu.md) — scanline renderer vs Mooneye accuracy bar
- [docs/reference/io-registers.md](../docs/reference/io-registers.md) — stub vs implemented I/O
- [docs/reference/test-roms.md](../docs/reference/test-roms.md) — Blargg vs Mooneye vs commercial games
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) — when instruction-level timing is not enough
- [Pan Docs — STAT](https://gbdev.io/pandocs/STAT.html)
- [Pan Docs — OAM DMA transfer](https://gbdev.io/pandocs/OAM_DMA_Transfer.html)
- [Pan Docs — MBC5](https://gbdev.io/pandocs/MBC5.html)
- [course/08-ppu-timing.md](08-ppu-timing.md) — baseline mode machine this appendix extends

