# Test ROMs and when to run them

Commercial games are the course checkpoints. Test ROMs tell you *why* a game is wrong. None are vendored here; download them yourself.

Do **not** block a chapter on a red test screen. A passing checkpoint with a failing Blargg subtest is still a successful chapter.

## Freely downloadable

| Suite | URL | What it is |
| --- | --- | --- |
| Blargg `cpu_instrs` | [retrio/gb-test-roms](https://github.com/retrio/gb-test-roms) | Instruction result + flags. Needs a working CPU, timer (for the framework), serial *or* a way to read the result from the bitmap/VRAM. Individual ROMs in `cpu_instrs/individual/` |
| Blargg `instr_timing` | same repo | Opcode durations. Needs instruction-level T-cycle counts |
| Blargg `mem_timing` | same repo | Memory-cycle timing — will be implemented in the future ([ToDo.md](../../ToDo.md)) |
| Blargg `halt_bug` | same repo | Optional |
| Blargg `oam_bug` | same repo | DMG OAM corruption — will be implemented in the future ([ToDo.md](../../ToDo.md)) |
| dmg-acid2 | [mattcurrie/dmg-acid2](https://github.com/mattcurrie/dmg-acid2) | PPU: BG, window, sprites, priority. Visual |
| Mooneye Test Suite | [Gekkio/mooneye-test-suite](https://github.com/Gekkio/mooneye-test-suite) | Hardware quirks. Most fail until [appendix 99](../course/99-mooneye-polish.md) accuracy fixes |

Homebrew that is nice as “does anything show up?”:

- [gbdev homebrew list](https://gbdev.io/list.html)
- Tiny intros / 32 KiB ROM-only demos

## What you can run after each checkpoint

Each chapter unlocks more of the DMG library. Use any ROM you own that matches the cart type for that stage.

| After chapter | Cart / hardware needed | What works | Example ROMs |
| --- | --- | --- | --- |
| 5 skip-boot | ROM ONLY (32 KiB) | PC moves; game code runs (black screen) | Tetris, Dr. Mario, any 32 KiB homebrew |
| 6 interrupts | ROM ONLY | Same; `HALT`/`EI`/`RETI` wired (still no VBlank) | Same |
| 7 timer | ROM ONLY | DIV/TIMA; RNG from `DIV` works | Same |
| 8 PPU timing | ROM ONLY | VBlank loop exits; blank/white canvas | Same |
| 9 background | ROM ONLY | BG tiles visible (palettes may be wrong) | Same |
| 10 palettes + window | ROM ONLY | Correct greys; window/HUD layers | Same; Pokémon menus start looking right once MBC3 lands |
| 11 sprites + DMA | ROM ONLY | Moving objects, OAM DMA | Same |
| 12 joypad | ROM ONLY | **Playable** ROM-only games from keyboard | Tetris, Dr. Mario, Kirby’s Dream Land (needs ch. 13) |
| 13 MBC1 | MBC1 | Multi-bank ROMs load and run | Super Mario Land, Kirby’s Dream Land, Link’s Awakening |
| 14 MBC3 + saves | MBC3 + battery SRAM | Large ROMs + persistent saves | Pokémon Red/Blue |
| 15 host polish | Any supported mapper so far | Full browser app; APU stub (silent) | Most common DMG titles on MBC1/MBC3 |
| 16 save states | Same | Instant snapshots | Any game from ch. 15 |
| 17 remaining mappers | + MBC5, MBC2 | Mooneye MBC5 ROMs load; more retail titles | Donkey Kong Land III, Shantae, MBC2 carts |
| 99 Mooneye polish | Per-ROM | Deterministic quirk tests pass one by one | Mooneye acceptance suite |

CGB-only dumps (`$0143` bit 7 set with color features) need [Game Boy Color](../../ToDo.md). Dual-mode CGB games often still run on DMG skip-boot if they do not rely on color I/O.

## Suggested pairing with chapters

| After chapter | Try | Expect |
| --- | --- | --- |
| 4–5 CPU + bus | Handwritten programs in the chapter | Pass |
| 5 skip-boot | Any ROM ONLY: PC moves | Pass (black screen) |
| 7 timer | Blargg `cpu_instrs` (needs timer + some output) | Maybe; serial is stubbed so use the on-screen result if your PPU exists, or wait until ch. 9 |
| 9–11 PPU | ROM ONLY title visible; dmg-acid2 | Commercial ROM yes; acid2 partial until PPU polish |
| 12 joypad | Play any ROM ONLY game | Pass |
| 13 MBC1 | Any MBC1 title | Pass |
| 14 MBC3 | Pokémon Red or other MBC3+SRAM | Pass |
| 15 | Blargg `cpu_instrs` with a framebuffer | Aim to pass; do not spiral |
| 16 (optional) | Mooneye acceptance (`bun run test:mooneye`) | Improves with appendix 99 fixes |
| 17 | MBC5 homebrew / Mooneye `oam_dma/sources-GS` | Load without mapper throw |

## Mooneye harness (appendix 99)

ROMs under `test_carts/mooneye/acceptance/`. Run:

```bash
cd emu && bun run test:mooneye
```

Pass = six serial bytes `03 05 08 0D 15 22`. Fail = `42` repeated. See [course/99-mooneye-polish.md](../course/99-mooneye-polish.md).

## Reading Blargg results without serial

`cpu_instrs` prints a status string via the PPU (once graphics work) and also via serial (`SB`/`SC`). If serial is a stub, wait until chapter 9 and look at the screen: `Passed` or a list of failed opcodes.

A cheap debug hook used by many emulators (not hardware): if a game writes to `$FF02` with bit 7 set, log `$FF01` as a character. Blargg’s framework does that. Optional.

## Versioning

If you claim a pass, note the **ROM filename and version** (Blargg ROMs are numbered). Mooneye tests change; cite a git commit if you use them later.

## Games as tests (legal)

Use dumps **you own**. This repo will never include `.gb` files.

| Game | Cart | Proves |
| --- | --- | --- |
| Tetris | ROM ONLY 32 KiB | CPU, timer, BG, sprites, joypad |
| Dr. Mario | ROM ONLY 32 KiB | Same; slightly different PPU/LCDC use |
| Super Mario Land | MBC1, 64 KiB | Banking |
| Pokémon Red/Blue | MBC3+RAM+BATTERY 1 MiB / 32 KiB SRAM | MBC3, saves |
| Kirby’s Dream Land | MBC1 | Another friendly MBC1 title |
| Link’s Awakening | MBC1+RAM+battery | MBC1 saves (chapter 14 persistence) |

Any ROM matching the cart column for your current chapter is a valid smoke test — you are not limited to this table.
