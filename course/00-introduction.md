# 00 — Introduction

## Goal

Build a mental model of a Game Boy emulator that you can keep in your head for the next fifteen chapters, and know which documents to trust when something disagrees.

## What you are building

An emulator is not a Game Boy made of JavaScript. It is a **program that, from the game’s point of view, is indistinguishable enough from the hardware** that the game’s machine code does the same thing.

For this course, “indistinguishable enough” means:

- Tetris, Dr. Mario, Super Mario Land, and Pokémon Red/Blue are playable in a browser.
- You drive a 160×144 canvas from emulated VRAM, and a joypad from the keyboard.
- You are **not** matching every Mooneye test or every audio click.

That is a deliberately lower bar than a research emulator, and a higher bar than a CPU simulator that never draws a pixel.

## The machine in one page

The original Game Boy (project code **DMG**) is:

| Piece | What it does in the emu |
| --- | --- |
| **SM83 CPU** | Fetch a byte at `PC`, decode, mutate registers and memory, take some number of **T-cycles** |
| **16-bit bus** | `read8` / `write8` that decode `$0000–$FFFF` into ROM, RAM, VRAM, I/O |
| **Cartridge** | ROM bytes plus, for larger games, an MBC that banks 16 KiB windows |
| **PPU** | Walks scanlines on a 456-T-cycle rhythm, reads VRAM/OAM, writes pixels |
| **Timer** | A divider clock and a programmable TIMA that can interrupt |
| **Joypad** | A 2×4 button matrix at `$FF00` |
| **APU** | Four sound channels. We **stub** the registers so games do not hang |

There is no operating system. The cartridge *is* the program. After a tiny boot ROM (which we skip), the CPU runs whatever is at `$0100` forever.

```
                    4.194304 MHz T-cycles
  ┌─────────┐              │
  │  SM83   │──read/write──┤
  └─────────┘              │
                     ┌─────┴──────┐
                     │    bus     │
                     └─┬───┬───┬──┘
               ROM/MBC PPU timer I/O
                       │
                    canvas
```

## The only loop that matters

```js
function stepInstruction() {
  if (pendingInterrupt()) serviceInterrupt(); // chapter 6
  const opcode = read8(cpu.pc++);
  const tCycles = execute(opcode);            // chapters 2–4
  ppu.step(tCycles);                          // chapters 8–11
  timer.step(tCycles);                        // chapter 7
  dma.step(tCycles);                          // chapter 11
}

function runFrame() {
  const FRAME = 70224; // T-cycles
  while (cyclesThisFrame < FRAME) stepInstruction();
  blitToCanvas();
  requestAnimationFrame(runFrame);
}
```

Everything you add later — STAT interrupts, TIMA overflow, joypad — is either *more work inside `execute`* or *more work inside those `step` functions*. If you feel lost in chapter 11, come back here.

### T-cycles vs M-cycles

The CPU clock is **4 194 304 Hz**. One tick at that rate is a **T-cycle** (also called a **dot** when talking about the PPU). Opcode tables often list **M-cycles**, where `1 M-cycle = 4 T-cycles`. `NOP` is 1 M-cycle = 4 T-cycles. Count T-cycles in code so PPU and timer share a unit.

A frame is 154 scanlines × 456 T-cycles = **70 224 T-cycles** ≈ 59.7 Hz. That is why `requestAnimationFrame` (≈60 Hz) is a decent host beat.

## Sources of truth

| Priority | Source | Role |
| --- | --- | --- |
| 1 | [Pan Docs](https://gbdev.io/pandocs/) ([local dump](../docs/Pan%20Docs/Pan%20Docs.html)) | Hardware |
| 2 | [`docs/reference/`](../docs/reference/) | Tables you will keep open while coding |
| 3 | This `course/` directory | Order, patterns, checkpoints |
| 4 | Nazar JS series / DMG-01 ([`docs/SOURCES.md`](../docs/SOURCES.md)) | Second explanations; **not** timings |

Nazar calls the CPU a Z80 and ships a partial ISA. If you copy his opcode list, Tetris will hit an unimplemented instruction and you will think the game is broken. It is not. Read the errata.

## How each chapter is structured

- **Goal** — what exists when you are done.
- **Why / the hardware** — what the silicon is doing, so the code is a map of the machine, not a shopping list.
- **Design** — one pattern, not three alternatives.
- **Implementation** — snippets you generalize. Not a paste-ready emulator.
- **Pitfalls** — the bugs everyone hits.
- **Checkpoint** — something you can *see* or *assert*.
- **Further reading** — Pan Docs section + local dump.

If a chapter feels like copy-paste, stop at the hardware section and name which part of the machine each snippet is: a latch, a bus decode, a flag, a cycle count, or a host-side convenience. Chapter 2 spells that out for the CPU; later chapters do the same for the bus, interrupts, timer, PPU, joypad, and mappers.

If a checkpoint fails, do not skip ahead. Later chapters assume the bus, the interrupt line, and T-cycle stepping already exist.

## What we will not do

Game Boy Color, Super Game Boy, rumble, MBC5, a pixel-FIFO PPU, a complete APU, cycle-accurate memory accesses, or shipping ROMs. Chapter 15 lists follow-on work.

## Checkpoint

No code yet. You should be able to answer, without looking:

1. What function runs after every instruction besides the CPU itself?
2. How many T-cycles is a frame?

## Further reading

- [Pan Docs — Specs](https://gbdev.io/pandocs/Specifications.html)
- [docs/SOURCES.md](../docs/SOURCES.md)
- Nazar part 1, *The CPU* (concept only): [`docs/JS Emu/…The CPU…`](../docs/JS%20Emu/GameBoy%20Emulation%20in%20JavaScript_%20The%20CPU%20-%20Imran%20Nazar.html)
- DMG-01 architecture overview: [`docs/Rust tutorial/…`](../docs/Rust%20tutorial/DMG-01_%20How%20to%20Emulate%20a%20Game%20Boy.html)

## Next

[01 — Project shell and cartridge header](01-project-shell.md)
