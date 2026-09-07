# PPU cheat sheet (DMG, scanline renderer)

Pan Docs: [LCD Control](https://gbdev.io/pandocs/LCDC.html), [STAT](https://gbdev.io/pandocs/STAT.html), [Rendering](https://gbdev.io/pandocs/Rendering.html), [Tile Data](https://gbdev.io/pandocs/Tile_Data.html).

This course uses a **scanline renderer**: when a line finishes mode 3, decode 160 pixels into a framebuffer. Not a pixel FIFO. Mode 3 length is **fixed 172 T-cycles** in early chapters; variable length will be implemented in the future ([ToDo.md](../../ToDo.md)). Fixed lengths pass most commercial games; Mooneye PPU tests need the accurate model.

## Frame

- 154 scanlines per frame: LY = 0..143 visible, 144..153 VBlank.
- 456 T-cycles per line.
- 154 × 456 = **70 224 T-cycles per frame** (~59.7 Hz).

### Modes (fixed lengths)

| Mode | Name | T-cycles | LY | STAT bits 1–0 |
| --- | --- | --- | --- | --- |
| 2 | OAM scan | 80 | 0–143 | 2 |
| 3 | Drawing | 172 | 0–143 | 3 |
| 0 | HBlank | 204 | 0–143 | 0 |
| 1 | VBlank | 456 × 10 | 144–153 | 1 |

80 + 172 + 204 = 456.

At LY 144, enter mode 1 and **set IF bit 0** (VBlank). Also fire STAT mode-1 interrupt if STAT bit 4 is set.

When LY hits 154, wrap to 0 and enter mode 2 for the next frame. Present the framebuffer to the canvas **once per frame** (start of VBlank is a good moment).

## LCD off

If LCDC bit 7 is 0:

- Screen is white (or last frame — white is simpler).
- LY = 0, mode = 0.
- Do not increment LY. Do not request VBlank.
- When the game turns the LCD back on, reset the mode machine to mode 2, LY = 0, cycle counter = 0.

## Tile data (2bpp)

Each tile is 8×8 pixels, 16 bytes. Two bytes per row: lo then hi. Bit 7 is the leftmost pixel.

```
row y of tile at addr:
  lo = vram[addr + y * 2]
  hi = vram[addr + y * 2 + 1]
  colorIndex(x) = ((hi >> (7 - x)) & 1) << 1 | ((lo >> (7 - x)) & 1)
```

`colorIndex` is 0–3. Palette maps it to a shade.

### Addressing

LCDC bit 4:

- **1:** tile ID is unsigned. Base `$8000`. Tile `N` at `$8000 + N * 16`.
- **0:** tile ID is signed. Base `$9000`. Tile `N` at `$9000 + signed(N) * 16` (tile 0 at `$9000`, 128 at `$8800`, 255/`-1` at `$8FF0`).

BG/window tile maps: 32×32 IDs at `$9800` or `$9C00` (LCDC bits 3 and 6). Only 20×18 tiles are visible; SCX/SCY wrap the 256×256 map.

```
mapBase = (lcdc bit 3 ? 0x9c00 : 0x9800) - 0x8000  // offset into VRAM
pixelX = (scx + x) & 0xff
pixelY = (scy + ly) & 0xff
tileX = pixelX >> 3
tileY = pixelY >> 3
tileId = vram[mapBase + tileY * 32 + tileX]
```

## Palettes

`BGP` (`$FF47`): 8 bits, 2 bits per color index.

```
shade(i) = (bgp >> (i * 2)) & 0b11   // 0 lightest … 3 darkest on hardware
```

A typical canvas mapping:

```js
const DMG = [0xe0f8d0, 0x88c070, 0x346856, 0x081820]; // green
```

OBJ palettes `OBP0` / `OBP1` work the same, but **color index 0 is transparent** (never drawn; BGP’s 0 is opaque).

## Window

If LCDC bit 5 is set:

- Window starts at screen Y = `WY`.
- Window column 0 is at screen X = `WX - 7`.
- Internal line counter (window LY) increments for each scanline where the window is actually drawn, not for every LY.
- Tile map from LCDC bit 6; tile data from the same LCDC bit 4 as the background.

If `WX = 0` the first column is chopped; if `WX = 166` the window is off-screen. Tetris does not need a perfect window; Pokémon menus do.

## Sprites (OBJ)

OAM: 40 entries × 4 bytes at `$FE00`.

| Byte | Field | Notes |
| --- | --- | --- |
| 0 | Y | screen Y + 16 |
| 1 | X | screen X + 8 |
| 2 | tile | 8×16: bit 0 ignored (even tile + next) |
| 3 | flags | 7 = BG priority, 6 = Y flip, 5 = X flip, 4 = OBP1, 3–0 unused on DMG |

On a scanline:

1. Find objects whose Y range includes this line (Y − 16 … Y − 16 + height − 1). Height 8 or 16 from LCDC bit 2.
2. Keep the **first 10 in OAM order**.
3. Draw them. On DMG, **lower X wins**; if X ties, **earlier in OAM wins**. Draw back-to-front (stable sort by X descending, then OAM index descending) so the winner overwrites.

BG priority (flag bit 7): if set, OBJ pixels only show where BG color index is 0.

LCDC bit 1 disables all objects. LCDC bit 0 (DMG) disables BG/window; objects can still show.

## OAM DMA

Write of `src` to `$FF46` copies `$src00–$src9F` → `$FE00–$FE9F`.

Early chapters: copy immediately (or over 160 T-cycles) and, while DMA is active, CPU reads from `$FE00–$FEFF` / `$FF00–$FF7F` except HRAM should see `$FF` if you bother. Games run DMA from a tiny routine in HRAM. Timed 160 M-cycle DMA will be implemented in the future ([ToDo.md](../../ToDo.md)).

## STAT interrupts (keep it simple)

On **mode transition**, if the corresponding STAT enable bit is set, set IF bit 1. On `LY == LYC` becoming true, if STAT bit 6 is set, set IF bit 1. Real hardware has a STAT IRQ blocking quirk (no interrupt if you enter a selected mode from another selected mode). Ignore it until a game glitches.

VBlank (IF bit 0) is **separate** from STAT mode-1. Request both when appropriate.

## Worked example: one BG pixel

`LCDC = $91`, `SCX = 0`, `SCY = 0`, `LY = 0`, `BGP = $FC` (`11 11 11 00` → index 0 is shade 0, 1–3 are shade 3).

- Map `$9800`, tile data `$8000`.
- Tile ID at `$9800` is `$01`.
- Tile bytes at `$8010`: suppose row 0 is `$7C $7C` → pixels `0 3 3 3 3 3 0 0` (classic Nintendo-logo-ish blob).
- Pixel 0 (left) is index 0 → BGP shade 0 → lightest green.

If you see a scrambled grid, you have signed vs unsigned tile addressing backwards (LCDC bit 4). If you see stripes, lo/hi bytes swapped. If the whole screen is one color, you are not advancing LY or not presenting the framebuffer.
