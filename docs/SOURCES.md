# External references

This folder holds **original** cheat sheets in [`reference/`](reference/). Everything below is third-party material — use live links, not copies in this repo.

Treat **Pan Docs** as the hardware source of truth. Use the two tutorials for *shape* (how someone once explained a subsystem), not for timings, flags, or “is this opcode a Z80 instruction?”

## Inventory

| Source | URL | Use it for | Do not use it for |
| --- | --- | --- | --- |
| **Pan Docs** (gbdev) | [gbdev.io/pandocs](https://gbdev.io/pandocs/) | Every register, the ISA, MBC maps, boot sequence, obscure behaviour | A coding order — it is a reference, not a course |
| **Nazar JS series** | [GameBoy Emulation in JavaScript](https://imrannazar.com/series/gameboy-emulation-in-javascript) (2010–2011, parts 1–10) | A JS-flavored walkthrough of CPU → MMU → GPU → input → sprites → interrupts → MBC1 → timers | Opcode completeness, cycle accuracy, interrupts/`EI`, timers, PPU mode lengths, CPU identity |
| **DMG-01** (Ryan Levick) | [rylev.github.io/DMG-01](https://rylev.github.io/DMG-01/public/book/) | Pedagogy for registers, flags, decode, 2bpp tiles | A finished emulator. The book stops around tile RAM / memory map |

### Nazar series — direct links

| Part | Topic | URL |
| --- | --- | --- |
| 1 | CPU | [cpu](https://imrannazar.com/series/gameboy-emulation-in-javascript/cpu) |
| 2 | Memory | [memory](https://imrannazar.com/series/gameboy-emulation-in-javascript/memory) |
| 3 | GPU timings | [gpu-timing](https://imrannazar.com/series/gameboy-emulation-in-javascript/gpu-timing) |
| 4 | Graphics | [graphics](https://imrannazar.com/series/gameboy-emulation-in-javascript/graphics) |
| 5 | Integration | [integration](https://imrannazar.com/series/gameboy-emulation-in-javascript/integration) |
| 6 | Input | [input](https://imrannazar.com/series/gameboy-emulation-in-javascript/input) |
| 7 | Sprites | [sprites](https://imrannazar.com/series/gameboy-emulation-in-javascript/sprites) |
| 8 | Interrupts | [interrupts](https://imrannazar.com/series/gameboy-emulation-in-javascript/interrupts) |
| 9 | Memory banking | [memory-banks](https://imrannazar.com/series/gameboy-emulation-in-javascript/memory-banks) |
| 10 | Timers | [timers](https://imrannazar.com/series/gameboy-emulation-in-javascript/timers) |

Nazar’s series **never published a Sound part** (part 10 teases it). There is no APU tutorial. Implement a stub from Pan Docs ([Audio](https://gbdev.io/pandocs/Audio.html)) as in [course chapter 15](../course/15-host-polish-and-audio.md).

DMG-01 is a **Rust** book. The ideas transfer; the code does not. Prefer the patterns in this course (bus `read8`/`write8`, opcode tables, `step(tCycles)`).

## How the three sources disagree (Nazar errata)

Nazar is the most tempting to copy because it is already JavaScript. Copy the *architecture*, not the details. Known problems:

1. **The CPU is not a Z80.** It is a Sharp **SM83** core (early silicon is labelled LR35902). No IX/IY, no shadow registers, no `IN`/`OUT`, a different `CB` map, different timings, different flag behaviour. If a Z80 manual and Pan Docs disagree, Pan Docs wins.
2. **The ISA in the articles is a sample, not the set.** Tetris will hit opcodes the series never implements. You need all 256 unprefixed ops (minus the 11 illegal ones) plus the `CB` page.
3. **M-cycles vs T-cycles.** Hardware people count **T-cycles** (dots) at 4 194 304 Hz. 1 M-cycle = 4 T-cycles. Nazar’s `_clock.m` / `_clock.t` pair is easy to get backwards. This course counts T-cycles everywhere.
4. **`EI` is delayed.** `IME` becomes true *after the next instruction*, not immediately. `RETI` enables IME immediately. Getting this wrong desyncs games that do `EI` / `HALT`.
5. **`HALT` is not “sleep until I feel like it.”** The CPU stops fetching until an interrupt is pending. The HALT bug (when `IME` is 0 and `IE & IF != 0`) is deferred to a future chapter ([ToDo.md](../ToDo.md)); do not cargo-cult a broken HALT.
6. **`DIV` is not a free-running 8-bit incrementer you poke.** Internally it is the upper byte of a 16-bit counter that ticks every T-cycle. **Any write to `$FF04` resets that counter to 0.** TIMA’s input is a bit of that same counter, selected by TAC.
7. **PPU mode lengths are simplified.** Nazar uses fixed 80 / 172 / 204 T-cycles for modes 2 / 3 / 0. Mode 3 actually stretches with sprites and window. Fixed lengths work for most commercial games in early chapters; variable length will be implemented in the future ([ToDo.md](../ToDo.md)). Do not treat 172 as gospel.
8. **Interrupt dispatch is incomplete.** Real hardware checks `IME && (IE & IF)` after each instruction, services the **lowest set bit** among VBlank, STAT, Timer, Serial, Joypad, pushes PC, clears IME and that IF bit, then jumps to `$0040 + 8*n`.
9. **OAM DMA (`$FF46`) is missing or hand-waved.** Games copy sprite tables with it. Early chapters use an instant 160-byte copy; timed 160 M-cycle transfer will be implemented in the future ([ToDo.md](../ToDo.md)).
10. **MBC1 bank 0 quirk.** Writing `0` to the ROM-bank register selects bank **1**, not 0. Upper-bit holes at banks `$20`, `$40`, `$60` exist in 1 MiB+ carts. Nazar’s MBC1 is a sketch.
11. **I/O open bus.** Unimplemented I/O should usually read as `$FF` (with some unused bits stuck high). Returning `0` makes games think devices are in impossible states.

When in doubt: [Pan Docs](https://gbdev.io/pandocs/) → [`docs/reference/`](reference/) cheat sheets → this course’s chapter → Nazar/DMG-01 for a second explanation.

## More links

- [SM83 opcode tables](https://gbdev.io/gb-opcodes/optables/classic)
- [gbz80(7) instruction descriptions](https://rgbds.gbdev.io/docs/v0.9.4/gbz80.7)
- [Game Boy: Complete Technical Reference (TCAGBD)](https://github.com/Gekkio/gb-ctr) — denser than Pan Docs; optional later reading
- [gbdev Awesome list](https://gbdev.io/list.html)
- [jsGB source](https://github.com/Two9A/jsGB) — Nazar’s reference emulator (archival)
