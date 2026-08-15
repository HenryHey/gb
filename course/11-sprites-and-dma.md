# 11 — Sprites and OAM DMA

## Goal

Draw objects (sprites) on top of the background. Implement `$FF46` OAM DMA. Tetris pieces, Mario, and Dr. Mario vitamins become visible.

## Why

Background is a scrolling tilemap. Anything that moves freely is an **OBJ**: 40 records in OAM (`$FE00–$FE9F`). Games almost never `LD` 160 bytes into OAM in a loop during VBlank — they write a source page and trigger **DMA**.

Without DMA, OAM stays empty and you only see BG. Without OBJ render, DMA is invisible.

## OAM entry

```
byte 0  Y + 16
byte 1  X + 8
byte 2  tile index
byte 3  flags: 7 BG-priority, 6 Y-flip, 5 X-flip, 4 palette (OBP1 vs OBP0)
```

8×16 mode (LCDC bit 2): height 16, tile index bit 0 ignored; top tile is `tile & 0xfe`, bottom is `+1` (after Y-flip these swap).

LCDC bit 1 must be set or you draw no objects.

## Which sprites on this line

```js
function spritesOnLine(ppu, oam, ly) {
  const h = (ppu.lcdc & 0x04) ? 16 : 8;
  const list = [];
  for (let i = 0; i < 40; i++) {
    const y = oam[i * 4] - 16;
    if (ly >= y && ly < y + h) list.push(i);
    if (list.length === 10) break; // hardware cap, OAM order
  }
  return list;
}
```

DMG **priority**: among pixels, the object with **smallest X** wins; ties go to **earlier OAM index**. Draw in reverse priority so the winner is painted last:

```js
list.sort((a, b) => {
  const ax = oam[a * 4 + 1], bx = oam[b * 4 + 1];
  if (ax !== bx) return bx - ax; // larger X first
  return b - a;                  // later OAM first
});
```

Then for each sprite, for each of 8 pixels, if the sprite pixel’s color index is **0**, skip (transparent). Else if BG-priority is set **and** the BG color index already in the line is not 0, skip. Else write OBJ shade from OBP0/OBP1.

Keep a per-line array of BG color indices (0–3), not just RGB, so priority can inspect them.

```js
function renderSpritePixel(…) {
  let row = ly - (y - 16);
  if (flags & 0x40) row = h - 1 - row;
  const tile = (h === 16) ? (tileIndex & 0xfe) + ((row >= 8) ? 1 : 0) : tileIndex;
  const rowInTile = row & 7;
  const addr = tile * 16 + rowInTile * 2; // OBJ tiles always $8000-based
  let col = xFine; // 0–7
  if (flags & 0x20) col = 7 - col;
  const idx = colorIndex(vram[addr], vram[addr + 1], col);
  if (idx === 0) return;
  …
}
```

OBJ tile data is **always** unsigned from `$8000`, ignoring LCDC bit 4.

X/Y of 0 or 248+ hide the sprite off-screen. Still count toward the 10-per-line cap if the Y range matches.

## OAM DMA

Write `src` to `$FF46`:

```js
writeDma(src) {
  src &= 0xff;
  const base = src << 8;
  for (let i = 0; i < 0xa0; i++) {
    this.oam[i] = this.bus.read8(base + i);
  }
  // optional: this.dmaLeft = 160; // T-cycles
}
```

**Source:** `$00–$F1` pages. Games use WRAM (`$C000+`) or ROM. Reading through `bus.read8` is correct (except DMA from `$FE00` is nonsense).

**During DMA** the CPU should only access HRAM. Instruction-level: either ignore that or, while `dmaLeft > 0`, have `read8`/`write8` outside `$FF80–$FFFE` return `$FF` / no-op. Instant copy without a lock still plays Tetris and Pokémon. If sprites flicker, add the 160 T-cycle lock.

Trigger DMA on **write**, not read. Reading `$FF46` can return the last written value.

## Scanline order

1. Clear line BG index buffer.
2. Render BG+window, storing indices and RGB.
3. Render sprites as above.
4. If LCDC OBJ bit is off, skip step 3.

## Pitfalls

- Using LCDC bit 4 for OBJ tiles.
- Forgetting +8 / +16 offsets (sprites appear shifted).
- Y-flip in 8×16 without swapping tiles.
- Drawing all 40 sprites (drop the 10 cap — usually OK — vs dropping **priority** — causes overlapping garbage).
- Color 0 of OBJ using OBP (it must be transparent).
- DMA copying 256 bytes or from `src` as a 16-bit address already.
- OAM writes during mode 2/3 blocked on hardware; ignore at this accuracy.

## Checkpoint

Tetris: falling pieces and next-piece preview are sprites. If the well exists but pieces do not, DMA or OBJ enable is wrong. If pieces are “holes” in the well, priority/transparency is inverted.

Dr. Mario: viruses and vitamins.

You still cannot **play** — no keypad. That is the next chapter. Watching the demo / title animate is enough.

## Further reading

- [Pan Docs — OAM](https://gbdev.io/pandocs/OAM.html)
- [Pan Docs — OAM DMA](https://gbdev.io/pandocs/OAM_DMA_Transfer.html)
- [docs/reference/ppu.md](../docs/reference/ppu.md)
- Nazar part 7 *Sprites* (compositing idea; verify priority against Pan Docs)
