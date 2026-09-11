# Game Boy Emulator Tutorial

A step-by-step course for building a **DMG (original Game Boy) emulator** in JavaScript, with a working browser host and a test suite you can run after every chapter.

You implement the emulator yourself by following the chapters. The repo ships the course text, reference notes, checkpoint tests, and a completed reference implementation under `emu/`.

## Quick start

Requires [Bun](https://bun.sh).

```bash
cd emu
bun install
bun dev          # browser emulator at http://localhost:5173
bun test         # unit + checkpoint tests
bun run test:mooneye   # Mooneye acceptance suite (optional)
```

Load a `.gb` or `.gbc` ROM from the file picker, or drop a `.7z` archive containing one. **You must supply your own ROM files** — see [ROMs](#roms) below.

## How to use this repo

1. Read [course/00-introduction.md](course/00-introduction.md) for the mental model and tooling.
2. Work through chapters **01–17** in order. Each chapter adds one subsystem and ends with a checkpoint you can verify.
3. Keep [docs/reference/](docs/reference/) open while coding (memory map, opcodes, quirks).
4. Use [docs/reference/test-roms.md](docs/reference/test-roms.md) to pick commercial or homebrew ROMs that match what you have implemented so far.

Chapters **0–15** build a playable DMG emulator. **16** adds save states; **17** covers remaining mappers (MBC5, MBC2, MBC3 routing). [course/99-mooneye-polish.md](course/99-mooneye-polish.md) is an optional accuracy pass against the Mooneye suite.

## Repository layout

| Path | Contents |
| --- | --- |
| [`course/`](course/) | Tutorial chapters (start here) |
| [`emu/`](emu/) | Vite app + emulator source and tests |
| [`docs/reference/`](docs/reference/) | Cheat sheets (memory map, opcodes, test ROM guide) |
| [`docs/SOURCES.md`](docs/SOURCES.md) | External references, errata, and link index |
| [`test_carts/`](test_carts/) | Blargg and Mooneye **test** ROMs for automated testing |
| [`roms/`](roms/) | Gitignored — place your own ROM dumps here for local dev |

## Reference material

Hardware truth and second opinions live **online**. This repo keeps only original cheat sheets under `docs/reference/`; follow these links while working through the course.

| Priority | Source | Role |
| --- | --- | --- |
| 1 | [Pan Docs](https://gbdev.io/pandocs/) | Hardware reference — registers, timing, mappers, quirks |
| 2 | [`docs/reference/`](docs/reference/) | Tables kept open while coding |
| 3 | [`course/`](course/) | Build order, patterns, checkpoints |
| 4 | Secondary tutorials (below) | Alternate explanations — **not** timings |

### Essential links

- [Pan Docs](https://gbdev.io/pandocs/) — primary hardware reference
- [SM83 opcode tables](https://gbdev.io/gb-opcodes/optables/classic)
- [gbz80(7) instruction descriptions](https://rgbds.gbdev.io/docs/v0.9.4/gbz80.7)
- [gbdev Awesome list](https://gbdev.io/list.html)

### Secondary tutorials

Use for intuition and architecture; read the [Nazar errata](docs/SOURCES.md#how-the-three-sources-disagree-nazar-errata) before copying JavaScript from the JS series.

| Tutorial | URL | Notes |
| --- | --- | --- |
| **Imran Nazar — GameBoy Emulation in JavaScript** | [Series index](https://imrannazar.com/series/gameboy-emulation-in-javascript) | JS walkthrough, parts 1–10; partial ISA, simplified timings |
| **Ryan Levick — DMG-01** | [Book](https://rylev.github.io/DMG-01/public/book/) | Rust book; good pedagogy for registers, flags, tiles |
| **TCAGBD** (optional) | [Gekkio/gb-ctr](https://github.com/Gekkio/gb-ctr) | Denser than Pan Docs |

Part-by-part Nazar links and full errata: [docs/SOURCES.md](docs/SOURCES.md).

## ROMs

**This repository does not include commercial game ROMs.**

- Put ROMs you legally own in `roms/` (gitignored) for local testing and the debug-rom workflow.
- `test_carts/` contains freely distributed **test** ROMs (Blargg, Mooneye) used by `bun test` and `bun run test:mooneye`. Do not redistribute them outside emulator-development contexts without checking each suite’s terms.

Game Boy hardware and Nintendo trademarks belong to their respective owners. This project is an educational emulator and is not affiliated with Nintendo.

## Tests

From `emu/`:

| Command | Purpose |
| --- | --- |
| `bun test` | Default suite — CPU, bus, PPU, mappers, checkpoints |
| `bun run test:mooneye` | Mooneye acceptance ROMs under `test_carts/mooneye/` |
| `bun run lint` | ESLint |
| `bun run format:check` | Prettier |

## Third-party material

- **Course and emulator code** in this repo: [MIT License](LICENSE).
- **Test ROMs** in `test_carts/` are by their respective authors (e.g. Shay Green / Blargg, Gekkio / Mooneye).
- **External tutorials and Pan Docs** are linked from [docs/SOURCES.md](docs/SOURCES.md); they are not vendored in this repository.

## License

MIT — see [LICENSE](LICENSE).
