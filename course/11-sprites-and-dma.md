# 11 — Sprites and OAM DMA

## Goal

Draw objects (sprites) on top of the background. Implement `$FF46` OAM DMA. Tetris pieces, Mario, and Dr. Mario vitamins become visible.

## Why

Background is a scrolling tilemap. Anything that moves freely is an **OBJ**: 40 records in OAM (`$FE00–$FE9F`). Games almost never `LD` 160 bytes into OAM in a loop during VBlank — they write a source page and trigger **DMA**.

Without DMA, OAM stays empty and you only see BG. Without OBJ render, DMA is invisible.

Chapter 10 left you a scanline renderer with BGP, window, and `paletteShades`. This chapter adds a second compositing pass and the bus hook that fills OAM each frame.

## Objects are a separate layer with a tiny table

The background is a camera over a grid. A falling Tetris piece, Mario, a vitamin — those change X/Y every frame and are not aligned to the 8×8 map. The PPU keeps **40 sprites** in a dedicated 160-byte RAM (OAM), each:

```
Y+16, X+8, tile index, flags
```

The +16 / +8 offsets mean “0 hides the sprite off the top / left.” That is cheaper than signed coordinates in 8 bits.

Constraints that look like bugs are the scanline hardware:

- **10 sprites per line.** Mode 2 walks OAM in index order and keeps the first 10 whose Y hits this `LY`. The rest are dropped (the famous flicker when too much overlaps).
- **Priority:** smallest X wins; ties go to earlier OAM index. Colour 0 is transparent (you see BG through it). “BG priority” flag means “only draw over BG colour 0” — sprites behind trees, etc.
- **OBJ tiles always live at `$8000`**, ignoring LCDC bit 4. 8×16 mode (LCDC bit 2) pairs two tiles; bit 0 of the index is ignored.

`OBP0` / `OBP1` (`$FF48` / `$FF49`) work like BGP for sprites. Two palettes so enemies and the player can differ without extra tile art. **`ppu.obp0` / `ppu.obp1` are already wired** through the bus from chapter 10; use `paletteShades` on them the same way you do for BGP.

LCDC bit 1 enables objects. Skip-boot `LCDC = $91` has it **clear** — games turn it on when they are ready to show sprites.

### Why DMA exists

During mode 2/3 the PPU owns the OAM/VRAM buses. Copying 160 bytes with `LD` in a VBlank is tight and fights the PPU. Write a page number to `$FF46` and a **DMA unit** copies `$XX00–$XX9F` into OAM in 160 T-cycles. While that runs, the CPU may only use HRAM (the bus is busy). Games build a shadow OAM in WRAM, then `LDH ($46), A` once per frame.

Instruction-level: an instant 160-byte copy passes most commercial games. A 160 T-cycle lock (other addresses read `$FF`) is the next accuracy step if sprites flicker; timed DMA will be implemented in the future ([ToDo.md](../ToDo.md)).

## OAM entry

```
byte 0  Y + 16
byte 1  X + 8
byte 2  tile index
byte 3  flags: 7 BG-priority, 6 Y-flip, 5 X-flip, 4 palette (OBP1 vs OBP0)
```

8×16 mode (LCDC bit 2): height 16, tile index bit 0 ignored; top tile is `tile & 0xfe`, bottom is `+1` (after Y-flip these swap).

LCDC bit 1 must be set or you draw no objects.

## Wiring

**You already had (chapters 5–10):**

- `bus.oam` — 160 bytes, read/write at `$FE00–$FE9F`.
- `ppu.obp0` / `ppu.obp1` — mirrored on `$FF48` / `$FF49`.
- `renderScanline(ppu, vram)` — BGP + window.
- `colorIndex`, `paletteShades`, `putPixel` in `ppu.js`.

**This chapter adds:**

1. **OAM DMA in `bus.js`.** `$FF46` is **not** a PPU register (`isPpuReg` excludes it). On write, copy `$src00–$src9F` → `oam[]` via `read8`, remember `src` for reads.
2. **Pass OAM into the PPU** — optional fifth argument on `ppuStep` / `renderScanline`, threaded from `tickEmu`.
3. **`spritesOnLine` + sprite compositing** inside `renderScanline`.

**Files:** `src/bus.js`, `src/ppu.js`, `src/emu.js`.  
**Tests:** `test/ch11-checkpoint.test.js`.

Do **not** allocate a second OAM buffer on `ppu` — `reset` rebuilds `ppu` from `createPpu()` and would drop it. Use `bus.oam`.

### Thread OAM through the emulator

```js
// emu.js — tickEmu (both ppuStep calls)
ppuStep(emu.ppu, emu.io, dt, emu.bus.vram, emu.bus.oam);
```

```js
// ppu.js
export function ppuStep(ppu, io, t, vram, oam) {
  …
  advanceMode(ppu, io, vram, oam);
}

function advanceMode(ppu, io, vram, oam) {
  …
  case MODE_DRAW:
    ppu.mode = MODE_HBLANK;
    if (ppu.stat & STAT_HBLANK_IE) io.requestIf(1);
    renderScanline(ppu, vram, oam);
    break;
}
```

If `oam` is omitted, the BG/window pass still runs; the sprite pass is skipped (`if (!oam || !(ppu.lcdc & 0x02)) return`). Chapter 8–10 tests keep passing.

## Which sprites on this line

```js
function spritesOnLine(ppu, oam, ly) {
  const h = (ppu.lcdc & 0x04) ? 16 : 8;
  const sprites = [];
  for (let i = 0; i < 40; i++) {
    const y = oam[i * 4] - 16;
    if (ly >= y && ly < y + h) sprites.push(i);
    if (sprites.length === 10) break; // hardware cap
  }

  sprites.sort((a, b) => {
    const ax = oam[a * 4 + 1];
    const bx = oam[b * 4 + 1];
    if (ax !== bx) return bx - ax; // larger X first
    return b - a; // later OAM first
  });
  return sprites;
}
```

DMG **priority**: among pixels, the object with **smallest X** wins; ties go to **earlier OAM index**. Draw in reverse priority so the winner is painted last (sort above).

Then for each sprite, for each of 8 pixels on this scanline, if the sprite pixel’s color index is **0**, skip (transparent). Else if BG-priority is set **and** the BG color index already in the line is not 0, skip. Else write OBJ shade from OBP0/OBP1.

Keep a per-line array of BG color indices (0–3), not just RGB, so priority can inspect them.

## Scanline order

Extend chapter 10’s `renderScanline`:

1. Allocate `bgIdx[160]` and precompute `bgShades`, `obp0Shades`, `obp1Shades` once per line (256 palette regs × 4 entries — do not call `paletteShades` inside the 160-pixel loop).
2. Render BG+window as in chapter 10 — store each pixel’s **VRAM color index** in `bgIdx[x]`, then `putPixel` with `bgShades[idx]`.
3. If LCDC bit 1 is set and `oam` is present, run the sprite pass below on top of that row.
4. If LCDC bit 1 is clear, skip step 3.

BG + window loop (unchanged from chapter 10, now recording indices):

```js
function renderScanline(ppu, vram, oam) {
  if (!vram) return;

  const y = ppu.ly;
  if (y >= 144) return;

  const bgIdx = new Uint8Array(160);
  const bgShades = paletteShades(ppu.bgp);
  const obp0Shades = paletteShades(ppu.obp0);
  const obp1Shades = paletteShades(ppu.obp1);

  const winOn = ppu.lcdc & 0x20 && ppu.lcdc & 0x01 && y >= ppu.wy && ppu.wx <= 166;
  let usedWindow = false;

  for (let x = 0; x < 160; x++) {
    let idx;
    const useWin = winOn && x >= ppu.wx - 7;
    if (useWin) {
      usedWindow = true;
      const wx = x - (ppu.wx - 7);
      const wy = ppu.windowLine;
      idx = sampleMap(ppu, vram, { mapBit: 0x40, px: wx, py: wy });
    } else {
      idx = sampleBg(ppu, vram, x, y);
    }

    bgIdx[x] = idx;
    putPixel(ppu.framebuffer, x, y, bgShades[idx]);
  }
  if (usedWindow) ppu.windowLine++;

  if (!oam || !(ppu.lcdc & 0x02)) return;

  const sprites = spritesOnLine(ppu, oam, y);
  for (const i of sprites) {
    const base = i * 4;
    const oamY = oam[base];
    const oamX = oam[base + 1];
    const tileIndex = oam[base + 2];
    const flags = oam[base + 3];
    const h = (ppu.lcdc & 0x04) ? 16 : 8;
    const screenX = oamX - 8;
    if (screenX <= -8 || screenX >= 160) continue;

    let row = y - (oamY - 16);
    if (flags & 0x40) {
      row = h - 1 - row;
    }

    const tile = (h === 16)
      ? (tileIndex & 0xfe) + (row >= 8 ? 1 : 0)
      : tileIndex;

    const rowInTile = row & 7;
    const addr = tile * 16 + rowInTile * 2; // OBJ tiles always $8000-based in vram[]

    const shades = flags & 0x10 ? obp1Shades : obp0Shades;

    for (let xFine = 0; xFine < 8; xFine++) {
      const x = screenX + xFine;
      if (x < 0 || x >= 160) continue;

      let col = xFine;
      if (flags & 0x20) {
        col = 7 - col;
      }

      const idx = colorIndex(vram[addr], vram[addr + 1], col);
      if (idx === 0) continue;
      if ((flags & 0x80) && bgIdx[x] !== 0) continue;

      putPixel(ppu.framebuffer, x, y, shades[idx]);
    }
  }
}
```

OBJ tile data is **always** unsigned from `$8000`, ignoring LCDC bit 4. Reuse `colorIndex` from chapter 9 — do not call `tileAddress` for objects.

X/Y of 0 or 248+ hide the sprite off-screen. Still count toward the 10-per-line cap if the Y range matches.

## OAM DMA

On write to `$FF46` in `bus.js`:

```js
let dmaReg = 0xff;

function writeDma(src) {
  src &= 0xff;
  dmaReg = src;
  const base = src << 8;
  for (let i = 0; i < 0xa0; i++) {
    oam[i] = read8(base + i);
  }
}

function readIo(addr) {
  if (addr === 0xff4c) return 0xff;
  if (addr === 0xff46) return dmaReg;
  …
}

function writeIo(addr, v) {
  if (addr === 0xff4c) return;
  if (addr === 0xff46) return writeDma(v);
  …
}
```

Hook this from `writeIo` when `addr === 0xff46`. Do **not** route DMA through `io.write` alone — the copy must touch `bus.oam` via `read8`.

**Source:** `$00–$F1` pages (160 bytes ending before the next page). Games use WRAM (`$C000+`) or ROM. Reading through `read8` is correct (DMA from `$FE00` is nonsense but harmless).

**During DMA** the CPU should only access HRAM. Instruction-level: either ignore that or, while `dmaLeft > 0`, have `read8`/`write8` outside `$FF80–$FFFE` return `$FF` / no-op. Instant copy without a lock passes most games. If sprites flicker, add the 160 T-cycle lock and decrement `dmaLeft` in `tickEmu` alongside PPU/timer.

Trigger DMA on **write**, not read. Reading `$FF46` returns the last written value (`$FF` after reset).

## Pitfalls

- Using LCDC bit 4 for OBJ tiles.
- Forgetting +8 / +16 offsets (sprites appear shifted).
- Y-flip in 8×16 without swapping tiles.
- Drawing all 40 sprites (drop the 10 cap — usually OK) vs dropping **priority** (causes overlapping garbage).
- Color 0 of OBJ using OBP (it must be transparent).
- Applying BGP to sprite pixels — use OBP0/OBP1 only.
- Compositing sprites before BG/window (priority and BG-behind-trees break).
- DMA copying 256 bytes or treating `src` as a 16-bit address already.
- A second OAM array on `ppu` that `reset` wipes — use `bus.oam`.
- OAM writes during mode 2/3 blocked on hardware; ignore at this accuracy.

## Checkpoint

`test/ch11-checkpoint.test.js` — no ROM required. Plant bytes in `bus.vram` / `bus.oam` (or bare arrays passed to `ppuStep`).

```bash
cd emu && bun test test/ch11-checkpoint.test.js
```

Helpers: `FIRST_SCANLINE_T = 252` (mode 2 + mode 3 on the first visible line), `expectPixel`, `spriteLcdc()` = LCD on + BG + OBJ + unsigned tiles.

| Test | What it proves |
| --- | --- |
| DMA copies 160 bytes from WRAM page into OAM | `write8($FF46, $C0)` after shadow OAM at `$C000` |
| DMA register readback | `read8($FF46)` returns last written page |
| OBJ color index 0 is transparent | BG shows through at overlapping pixel |
| OBJ pixel uses OBP0 shade | Non-zero tile index → shade from OBP0 |
| BG priority flag blocks sprite | Flag bit 7 + BG index ≠ 0 → sprite skipped |
| Only first 10 OAM entries on a line | 11th entry on same line is dropped |
| Sprite priority: lower X wins | Two overlapping sprites → smaller X overwrites |

Then load Tetris, reset, run frames. **Passing the unit tests is the chapter 11 bar.**

Tetris: falling pieces and next-piece preview are sprites. If the well exists but pieces do not, DMA or OBJ enable (LCDC bit 1) is wrong. If pieces are “holes” in the well, priority/transparency is inverted.

Dr. Mario: viruses and vitamins.

You still cannot **play** — no keypad. That is the next chapter. Watching the demo / title animate is enough.

## Further reading

- [Pan Docs — OAM](https://gbdev.io/pandocs/OAM.html)
- [Pan Docs — OAM DMA](https://gbdev.io/pandocs/OAM_DMA_Transfer.html)
- [docs/reference/ppu.md](../docs/reference/ppu.md)
- Nazar part 7 *Sprites* (compositing idea; verify priority against Pan Docs)

## Next

[12 — Joypad](12-joypad.md)
