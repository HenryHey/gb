# emu

Browser-hosted **DMG Game Boy emulator** for the [Game Boy Emulator Tutorial](../README.md). Vanilla ES modules, Vite dev server, Bun tests.

This directory is the reference implementation built across [course chapters 01–17](../course/00-introduction.md). If you are following the tutorial, you implement these files yourself — use this tree to compare or run checkpoints.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
bun dev
```

Open http://localhost:5173. Load a `.gb`, `.gbc`, or `.bin` ROM from the file picker, or a `.7z` archive containing one.

**Bring your own ROMs.** Put dumps you legally own in [`../roms/`](../roms/) (gitignored) for local use. Automated tests read from [`../test_carts/`](../test_carts/).

## Scripts

| Command | Description |
| --- | --- |
| `bun dev` | Vite dev server with HMR |
| `bun run build` | Production build to `dist/` |
| `bun run preview` | Serve `dist/` locally |
| `bun test` | Unit and chapter checkpoint tests |
| `bun run test:mooneye` | Mooneye acceptance ROMs (needs `../test_carts/mooneye/`) |
| `bun run lint` | ESLint |
| `bun run format:check` | Prettier check |

Run tests from this directory. Mooneye ROMs live one level up:

```bash
bun test
MOONEYE=1 bun test mooneye.test.js   # same as bun run test:mooneye
```

## Source layout

```
src/
  emu.js          machine loop: createEmu, reset, runFrame, tickEmu
  bus.js          16-bit address decode, OAM DMA
  cart.js         header parse, MBC1/MBC2/MBC3/MBC5
  ops/            SM83 instruction implementations + decode tables
  ppu.js          scanline timing and pixel output
  io.js           timer, serial stub, LCD/STAT/APU registers
  joypad.js       $FF00 matrix
  interrupts.js   IME, HALT, IRQ dispatch
  skipboot.js     post-boot register state
  savestate.js    GBSS save/load (localStorage + export)
  main.js         Vite host: canvas, controls, keyboard
  archive7z.js    .7z ROM extraction (7z-wasm)
test/             bun test suites and chNN-checkpoint tests
opcodes.html      browsable opcode reference (dev aid)
```

Hardware cheat sheets: [`../docs/reference/`](../docs/reference/).

## Controls

| Key | Game Boy |
| --- | --- |
| Arrow keys / WASD | D-pad |
| Z / J | A |
| X / K | B |
| Enter | Start |
| Shift / Backspace | Select |
| `1` | Quick save (localStorage) |
| `0` | Quick load |

Enable **Debugging** in the UI for register view, VRAM tile map, step / step-frame buttons, and **Copy save state** (GBSS JSON).

In dev mode, the console exposes `emu()` and `runFrame()` for inspection.

## Features

- Skip-boot DMG startup (no boot ROM execution)
- MBC1, MBC2 (512×4-bit RAM), MBC3 (incl. battery SRAM), MBC5 (incl. save-state round-trip)
- Background, window, sprites, timed OAM DMA
- APU register stub (silent)
- SRAM auto-save to `localStorage` for battery carts (debounced)
- Save states (GBSS format) via keyboard or debug UI
- Tab visibility pause and ~59.73 Hz frame pacing

## License

MIT — see [../LICENSE](../LICENSE).
