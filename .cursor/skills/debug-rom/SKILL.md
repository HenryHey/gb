---
name: debug-rom
description: >-
  Debug Game Boy ROM issues from a GBSS JSON save state and an issue description.
  Resolves the ROM from roms/ using romFileName and archiveFileName, loads machine
  state headlessly, and investigates CPU/PPU/timer/interrupt behavior. Use when the
  user invokes /debugRom, shares a copied save state JSON, or asks to debug a game
  hang, glitch, or wrong behavior at a specific moment.
disable-model-invocation: true
---

# /debugRom

Reproduce and diagnose emulator bugs from a **JSON save state** (clipboard export from the debug UI) plus a short **issue description**.

## Inputs

The user provides:

1. **Save state JSON** — from **Copy save state** in the emulator (debug UI, key `1` to save first). Shape:

```json
{
  "format": "GBSS",
  "version": 1,
  "title": "TETRIS",
  "romCrc32": 1234567890,
  "romFileName": "tetris.gb",
  "archiveFileName": "games.7z",
  "base64": "..."
}
```

- `romFileName` — inner ROM name (always present when copied from the UI).
- `archiveFileName` — present when the ROM was loaded from a `.7z`; omit for a direct `.gb` load.

2. **Issue description** — what is wrong (hang, wrong graphics, crash after N frames, wrong audio, etc.).

If JSON is pasted inline, write it to a temp file (e.g. `/tmp/debug-state.json`) before running the loader.

## ROM resolution

ROMs live in **`roms/`** at the repo root (gitignored). The loader resolves in order:

| Save state fields | ROM path |
| --- | --- |
| `archiveFileName` + `romFileName` | Extract `romFileName` from `roms/{archiveFileName}` |
| `romFileName` only | `roms/{romFileName}` |
| Neither (fallback) | Scan `roms/` for any `.gb`/`.gbc`/`.7z` whose CRC32 matches `romCrc32` |

CRC32 must match `romCrc32` in the JSON or load fails with `ROM mismatch`.

## Step 1 — Load state

From repo root:

```bash
bun .cursor/skills/debug-rom/scripts/load-debug-state.js /path/to/state.json --issue "game hangs after line clear"
```

Optional: advance the machine before summarizing:

```bash
bun .cursor/skills/debug-rom/scripts/load-debug-state.js state.json --steps 500 --issue "..."
```

Output is JSON with `machine` (PC, registers, LY, LCDC, IE/IF, current instruction) and `rom.source` (how the ROM was found).

**The loader does not run the game or fix visuals** — it only deserializes state and prints a summary. To verify a graphics fix, reload the emulator (`bun dev`) and play, or extend the script to render a frame headlessly.

## Step 2 — Investigate

Use the issue description and loaded state to narrow the subsystem:

| Symptom | Likely area | Course / files |
| --- | --- | --- |
| Hang / infinite loop | CPU halt, interrupts, timer | `course/06-interrupts.md`, `src/interrupts.js`, `src/ops/control.js` |
| Wrong or frozen picture | PPU, LCDC, STAT, LY | `course/08`-`10`, `src/ppu.js`, `src/bus.js` |
| Wrong tiles / scroll | Background, window, VRAM | `course/09-background.md`, `course/10-palettes-and-window.md` |
| Save/load broken | MBC, cart RAM | `course/14-mbc3-and-saves.md`, `src/cart.js` |
| Timing-sensitive test fail | Mooneye-style accuracy | `course/99-mooneye-polish.md`, `bun run test:mooneye` |
| State wrong after load | GBSS deserialize | `course/16-save-states.md`, `src/savestate.js` |

Concrete checks:

- **PC + instruction** — decode loop at `$xxxx`? Stuck in HALT with IME off?
- **IE / IF / IME** — pending interrupt never serviced?
- **LY, LCDC, mode** — LCD off when game expects on? Mid-frame oddity?
- **MBC banks** — wrong ROM bank at `$4000`?
- **Step forward** — re-run loader with `--steps 1`, `10`, `100` and see when behavior diverges from expectation.

For deeper stepping, import `deserializeEmu`, `tickEmu`, `runFrame` in a one-off script under `emu/` or extend the loader.

## Step 3 — Fix and verify

1. Make the smallest fix in the relevant `emu/src/` file.
2. Run targeted tests: `cd emu && bun test path/to/relevant.test.js`
3. Re-load the same save state; confirm PC/registers/PPU progress as expected.
4. If the bug was accuracy-related, run `bun run test:mooneye` or the matching Mooneye ROM filter.

## Guide-first default

This skill **implements** debugging (load state, run tools, propose fixes). When the user only asks *how* to debug without invoking `/debugRom`, still point them here and to `course/16-save-states.md` for exporting states — but do not edit code unless they ask.

## Exporting a save state (for the user)

1. Enable **Debug UI** in the emulator.
2. Load the ROM, reproduce the bug, press **`1`** to save state.
3. Click **Copy save state** — JSON lands on the clipboard.
4. Paste into chat with `/debugRom` and describe the issue.
