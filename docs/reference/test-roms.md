# Test ROMs and when to run them

Commercial games are the course checkpoints. Test ROMs tell you *why* a game is wrong. None are vendored here; download them yourself.

Do **not** block a chapter on a red test screen. A playable Tetris with a failing Blargg subtest is still a successful chapter.

## Freely downloadable

| Suite | URL | What it is |
| --- | --- | --- |
| Blargg `cpu_instrs` | [retrio/gb-test-roms](https://github.com/retrio/gb-test-roms) | Instruction result + flags. Needs a working CPU, timer (for the framework), serial *or* a way to read the result from the bitmap/VRAM. Individual ROMs in `cpu_instrs/individual/` |
| Blargg `instr_timing` | same repo | Opcode durations. Needs instruction-level T-cycle counts |
| Blargg `mem_timing` | same repo | Memory-cycle timing — **out of scope** |
| Blargg `halt_bug` | same repo | Optional |
| Blargg `oam_bug` | same repo | DMG OAM corruption — **out of scope** |
| dmg-acid2 | [mattcurrie/dmg-acid2](https://github.com/mattcurrie/dmg-acid2) | PPU: BG, window, sprites, priority. Visual |
| Mooneye Test Suite | [Gekkio/mooneye-test-suite](https://github.com/Gekkio/mooneye-test-suite) | Hardware quirks. Most fail at this course’s accuracy bar |

Homebrew that is nice as “does anything show up?”:

- [gbdev homebrew list](https://gbdev.io/list.html)
- Tiny intros / 32 KiB ROM-only demos

## Suggested pairing with chapters

| After chapter | Try | Expect |
| --- | --- | --- |
| 4–5 CPU + bus | Handwritten programs in the chapter | Pass |
| 5 skip-boot | Tetris: PC moves | Pass (black screen) |
| 7 timer | Blargg `cpu_instrs` (needs timer + some output) | Maybe; serial is stubbed so use the on-screen result if your PPU exists, or wait until ch. 9 |
| 9–11 PPU | Tetris visible; dmg-acid2 | Tetris yes; acid2 partial |
| 12 joypad | Play Tetris / Dr. Mario | Pass |
| 13 MBC1 | Super Mario Land | Pass |
| 14 MBC3 | Pokémon Red | Pass |
| 15 | Blargg `cpu_instrs` with a framebuffer | Aim to pass; do not spiral |

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

Kirby’s Dream Land is another friendly MBC1 title. Avoid CGB-only dumps (`$0143` has bit 7 set and the game uses color features). Dual-mode CGB games often still run on DMG if you skip-boot as DMG.
