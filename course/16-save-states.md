# 16 — Save states

## Goal

Instant **save states**: freeze the whole machine mid-game, write one binary blob, reload it later and continue exactly where you left off — without relying on the game’s battery save.

When you finish this chapter you should have `serializeEmu(emu)` / `deserializeEmu(bytes, rom)` in something like `src/savestate.js`, your own **GBSS v1** file layout, Save/Load buttons in the UI, and tests that round-trip a known state.

This is **optional** polish after chapter 15. Chapter 14’s SRAM persistence is a different feature (what Pokémon writes to the cart). Save states snapshot **your emulator’s** full RAM and peripheral state.

**Not a compatibility exercise.** mGBA’s `[GBSerializedState](https://github.com/mgba-emu/mgba/blob/master/include/mgba/internal/gb/serialize.h)` is a **reference** for how a mature emulator organizes save/load — fixed layout, header validation, memory blobs at the end. You are **not** reading or writing mGBA’s files. Offsets, magic, and field names here are **yours**; they only need to round-trip in *this* project.

## Save states vs battery saves


|              | Battery save (ch. 14)                                       | Save state (this chapter)                          |
| ------------ | ----------------------------------------------------------- | -------------------------------------------------- |
| **What**     | Cart SRAM only (`$A000–$BFFF`)                              | CPU, WRAM, VRAM, OAM, I/O, MBC regs, PPU timing, … |
| **When**     | Game calls its save routine                                 | Any time you press Save state                      |
| **Survives** | Real power-off; portable across emulators if format matches | Same ROM + same emulator version                   |
| **Size**     | 2–32 KiB                                                    | ~50–120 KiB uncompressed for DMG                   |


Do not confuse them. A save state **includes** cart RAM, so loading one restores Pokémon’s party even if you never flushed SRAM to `localStorage`.

## The pattern (learned from mGBA)

Emulators pick one of three patterns. mGBA’s is the simplest to copy as a **student**:

1. **Fixed struct** — one known byte layout, little-endian.
2. **Header first** — magic, version, ROM identity.
3. **Subsystem blocks** — CPU, PPU, timer, cart state as packed fields.
4. **Memory blobs last** — VRAM, WRAM, OAM, I/O, HRAM, cart RAM as raw `Uint8Array` copies.
5. **Validate before apply** — reject wrong ROM or version; do not half-mutate live `emu`.

Save = walk the layout and write bytes. Load = read bytes and copy back. No JSON, no pointer registration, no dependency on mGBA’s 71 680-byte struct.

Skim mGBA’s comment block in `serialize.h` once to see how they group fields — then **close it** and implement GBSS v1 for *your* objects only.

```
[ magic + version + rom id ]
[ cpu | ppu | timer | joypad | cart ]
[ vram | wram | oam | io | hram | ie | cart ram ]
```

## GBSS v1 — your format

Magic ASCII `**GBSS**`, version `**1**`, then blocks in a fixed order. All multi-byte integers are **little-endian**.


| Offset   | Size | Field                                                                                |
| -------- | ---- | ------------------------------------------------------------------------------------ |
| `0x0000` | 4    | `'GBSS'`                                                                             |
| `0x0004` | 4    | Version `1`                                                                          |
| `0x0008` | 4    | ROM CRC32 (whole file — identifies which game this state belongs to)                 |
| `0x000C` | 16   | Title bytes `$0134–$0143` (not necessarily NUL-terminated)                           |
| `0x001C` | 1    | Model `0` = DMG                                                                      |
| `0x001D` | 3    | Reserved (zero)                                                                      |
| `0x0020` | 16   | CPU: `a,f,b,c,d,e,h,l,sp,pc` (see below)                                             |
| `0x0030` | 4    | `imeEnableCountdown` (i32)                                                           |
| `0x0034` | 1    | `ime` (0/1)                                                                          |
| `0x0035` | 1    | `halted` (0/1)                                                                       |
| `0x0036` | 2    | Reserved                                                                             |
| `0x0040` | 16   | PPU: `mode`, `lineCycles` (u16), `ly`, shadow regs, `windowLine` (u16), `frameReady` |
| `0x0050` | 8    | Timer: `divCounter` (u16), `tima`, `tma`, `tac`, reserved                            |
| `0x0058` | 12   | Joypad: `selectWrite` + eight button flags                                           |
| `0x0064` | 16   | Cart: `mapperType`, `ramEnable`, banks, `mode` (MBC1), `ramBytes` (u32)              |
| `0x0074` | 12   | Reserved                                                                             |
| `0x0080` | 8192 | VRAM                                                                                 |
| `0x2080` | 8192 | WRAM                                                                                 |
| `0x4080` | 160  | OAM                                                                                  |
| `0x4120` | 128  | I/O (`$FF00–$FF7F` stored copy in `io.regs`)                                         |
| `0x41A0` | 127  | HRAM                                                                                 |
| `0x421F` | 1    | IE (`$FFFF`, from `bus.ie`)                                                          |
| `0x4220` | *n*  | Cart RAM (`ramBytes`, max 32768)                                                     |


**Total:** `0x4220 + ramBytes`. With 32 KiB cart RAM ≈ **41 KiB** — fine for `localStorage` or a file download.

Bump `GBSS_VERSION` when you add fields. Old saves from a previous version are allowed to fail — you only owe compatibility to **your own** prior releases if you care.

### CPU block

Store `a` and `f` separately, matching `createCpu`. Also save:

- `ime`, `halted`
- `imeEnableCountdown`

You do not need event-scheduler fields (`cycles`, `nextEvent`, …) until the core is event-driven. Frame-boundary snapshots are enough for this course.

### PPU block — source of truth

In your bus, `**LY` lives on `ppu`, not in `io.regs**`. STAT mode bits are merged on read from `ppu.mode` and `ppu.ly === ppu.lyc`. Save `**ppu.ly**`, `**ppu.mode**`, `**ppu.lineCycles**`, and the shadow fields (`lcdc`, `stat`, `scy`, …) — not whatever a read of `$FF44` would return.

Include `frameReady` if your host blit skips work when it is false.

### Timer block — not just `$FF04–$FF07`

Games see `DIV` as `divCounter >> 8`. TIMA/TMA/TAC are in `io.regs`, but `**divCounter` is separate** on `io`. Saving only `io.regs` loses divider phase — after load, timer tests and some games drift.

Save: `divCounter`, `tima`, `tma`, `tac`. On load, write timer fields **into** the live `io` object, not only into `regs`.

### Cart / MBC block

Save whatever your mapper needs to restore banking: `ramEnable`, `romBank`, `ramBank`, MBC1 `mode`, MBC5 high bank bit, etc.

Expose mapper state on the cart object so you can serialize it. Closure locals in `createMbc1` are invisible to a serializer:

```js
// cart.js — pattern to aim for
return {
  ram,
  mapper: 'mbc3',
  state: { ramEnable, romBank, ramBank },
  readRom, writeRom, readRam, writeRam,
};
```

Serialize `mapperType` from `header.type`, the `state` object, and `**ram` bytes** (even when `ramEnable` is false — the game’s save data lives there).

Do **not** embed the ROM in the save file. Store CRC32 + title; on load, require the user’s loaded ROM to match.

### Memory blobs

Put contiguous RAM copies at the end — same *idea* as mGBA, different offsets and sizes. `**ie` is separate** — in your bus it lives on `bus.ie`, not in the 128-byte I/O page (`$FF00–$FF7F`).

Echo RAM (`$E000–$FDFF`) is not stored; it mirrors WRAM bank 0. Reload WRAM and echo works.

## Design

```
src/savestate.js   crc32, serializeEmu, deserializeEmu, GBSS_VERSION
src/cart.js        expose cart.ram + cart.state (refactor MBC closures)
src/main.js        Save state / Load state buttons; pause before snapshot
test/ch16-checkpoint.test.js
```

### When to snapshot

Save at a **frame boundary** — after `runFrame(emu)` or when paused. Mid-instruction saves are possible once you store DMA progress; until then, frame end is the contract.

Pause the rAF loop before serialize so a tick does not race the copy.

### Serialize

```js
export const GBSS_MAGIC = 0x53534247; // 'GBSS' LE
export const GBSS_VERSION = 1;

export function serializeEmu(emu) {
  const header = parseHeader(emu.rom);
  const ramBytes = emu.cart.ram?.byteLength ?? 0;
  const size = 0x4220 + ramBytes;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  view.setUint32(0x00, GBSS_MAGIC, true);
  view.setUint32(0x04, GBSS_VERSION, true);
  view.setUint32(0x08, crc32(emu.rom), true);
  out.set(emu.rom.subarray(0x134, 0x144), 0x0c);

  const cpu = emu.cpu;
  let o = 0x20;
  out[o++] = cpu.a; out[o++] = cpu.f;
  out[o++] = cpu.b; out[o++] = cpu.c;
  out[o++] = cpu.d; out[o++] = cpu.e;
  out[o++] = cpu.h; out[o++] = cpu.l;
  view.setUint16(o, cpu.sp, true); o += 2;
  view.setUint16(o, cpu.pc, true); o += 2;
  view.setInt32(0x30, cpu.imeEnableCountdown, true);
  out[0x34] = cpu.ime ? 1 : 0;
  out[0x35] = cpu.halted ? 1 : 0;

  // ppu, io, joypad, cart — same pattern at 0x40, 0x50, …

  out.set(emu.bus.vram, 0x80);
  out.set(emu.bus.wram, 0x2080);
  out.set(emu.bus.oam, 0x4080);
  out.set(emu.io.regs, 0x4120);
  out.set(emu.bus.hram, 0x41a0);
  out[0x421f] = emu.bus.ie;
  if (ramBytes) out.set(emu.cart.ram, 0x4220);

  return out;
}
```

Use `**out.set(array)**` for every `Uint8Array` — deep copy, not a shared reference.

### Deserialize (validate, then apply)

```js
export function deserializeEmu(bytes, rom) {
  if (bytes.byteLength < 0x4220) throw new Error('GBSS truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, true) !== GBSS_MAGIC) throw new Error('Not GBSS');
  if (view.getUint32(4, true) !== GBSS_VERSION) throw new Error('Unsupported GBSS version');
  if (view.getUint32(8, true) !== crc32(rom)) throw new Error('ROM mismatch');

  const emu = createEmu(rom);
  // Do NOT reset() or skipBoot() — the file *is* the machine state.

  applyCpu(emu.cpu, bytes, view);
  applyPpu(emu.ppu, bytes, view);
  // …

  emu.bus.vram.set(bytes.subarray(0x80, 0x2080));
  // …

  return emu;
}
```

**ROM mismatch** must hard-fail. Loading Pokémon state into a Tetris ROM corrupts memory silently.

**Version mismatch** must hard-fail unless you write an explicit v1→v2 migrator.

### ROM identity (CRC32)

Hash the whole ROM file with IEEE CRC32 (~30 lines, table-driven). mGBA does the same thing; you are copying the **idea**, not their on-disk bytes. `headerChecksum` alone is weaker (collisions across different ROMs).

### Host wiring

Wire save/load in `src/main.js`. Pause briefly for the snapshot, then resume on save; start playing after a successful load. One slot per ROM in `localStorage`:

| Key | Action |
| --- | --- |
| **`1`** | Save state |
| **`0`** | Load state |

```js
import { loadStateSlot, saveStateSlot } from './savestate.js';

function saveState() {
  setRunning(false);
  saveStateSlot(emu);
  log(`Saved state — ${parseHeader(emu.rom).title}`);
  setRunning(true);
}

function loadState() {
  setRunning(false);
  const loaded = loadStateSlot(emu.rom);
  if (!loaded) {
    log('Load state: nothing saved for this ROM');
    return;
  }
  emu = loaded;
  resetClock();
  blit(emu.ppu.framebuffer);
  renderCpu(emu.cpu);
  setRunning(true);
}

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  if (e.code === 'Digit1') {
    e.preventDefault();
    saveState();
    return;
  }
  if (e.code === 'Digit0') {
    e.preventDefault();
    loadState();
    return;
  }
  // … joypad keys
});
```

`saveStateSlot` / `loadStateSlot` live in `src/savestate.js` and use `stateKey(rom)` → `gb-state:${title}:${headerChecksum}`. For large blobs, chunk base64 encode/decode (same note as chapter 14).

## Pitfalls

- **`reset()` after load** — wipes the snapshot you just applied. Deserialize into a fresh `createEmu(rom)` and skip `reset` / `skipBoot`.
- **Shallow copy** — `return { cpu: emu.cpu }` shares mutable objects. Copy scalars and `Uint8Array` contents.
- **Saving `io.regs` but not `divCounter`** — DIV/TIMA phase wrong after load.
- **Saving `$FF44` from regs** — your `LY` is on `ppu`; restore `ppu.ly`.
- **MBC state in closures** — serializer cannot see `let romBank` inside `createMbc3`. Refactor to `cart.state`.
- **MBC1 missing `cart.ram`** — chapter 14 exposed `ram` on MBC3; MBC1/MBC5 need it too for save states and SRAM persistence.
- **Saving mid-DMA** — your DMA is instant; frame boundary hides the problem. If you add timed DMA later, save `dmaRemaining`.
- **APU stub** — saving `NR10–NR3F` in `io.regs` is enough; do not trigger sound pulses on load.
- **Chasing mGBA byte parity** — wastes time; GBSS only has to match *your* structs.

## Tests

`test/ch16-checkpoint.test.js` (chapter 16 checkpoint):

1. **Round-trip registers** — set `cpu.pc = 0x4567`, serialize → deserialize → expect equal.
2. **WRAM byte** — write pattern at `$C000`, round-trip, read back through bus.
3. **ROM mismatch** — serialize with ROM A, deserialize with ROM B → throws.
4. **MBC3 bank** — switch ROM bank, round-trip, `read8` at `$4000` matches.
5. **DIV phase** — run 250 instructions, round-trip, `divCounter` equal.
6. **localStorage slot** — `saveStateSlot` / `loadStateSlot` round-trip via mocked storage.

Run: `bun test test/ch16-checkpoint.test.js`.

Manual: play Pokémon, save state on overworld, reload page, load state — party and position restored without using CONTINUE.

## What you can omit for now


| Field (in a full emulator)  | Why skip for now       |
| --------------------------- | ---------------------- |
| Audio PSG / frame sequencer | APU is a stub          |
| Global cycle counters       | No event scheduler     |
| CGB VRAM bank / palettes    | DMG only               |
| SGB border RAM              | Not emulated           |
| HDMA / DMA in progress      | Instant DMA            |
| RTC latched state           | Red/Blue have no clock |


When you add a feature, add its block to GBSS and bump the version.

## Checkpoint

- **`1` / `0` keys** save and load the single state slot (pause first).
- `bun test test/ch16-checkpoint.test.js` passes.
- Tetris: save mid-game, load, gameplay continues.
- Pokémon: save state restores party/position; distinct from SRAM CONTINUE (both can coexist).
- You can explain GBSS layout (header → blocks → memory) and why ROM CRC32 is in the header — without referencing mGBA offsets.

## Further reading

- [mGBA `serialize.h](https://github.com/mgba-emu/mgba/blob/master/include/mgba/internal/gb/serialize.h)` — **reference only**: see how they partition a large struct
- [mGBA `serialize.c](https://github.com/mgba-emu/mgba/blob/master/src/gb/serialize.c)` — `GBSerialize` / `GBDeserialize` walkthrough
- [Gregory Gaines — Adding save states](https://www.gregorygaines.com/blog/adding-save-states-to-an-emulator/) — memento pattern and deep copy

## Next

**Optional:** [99 — Mooneye polish](99-mooneye-polish.md) — run the Mooneye harness and fix accuracy gaps one ROM at a time.