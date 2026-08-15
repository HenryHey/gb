# 09 — Background tiles

## Goal

When a scanline finishes mode 3, **draw the background** into that row of the framebuffer. Tetris’s title screen or playfield becomes recognizable (colors may be wrong until chapter 10).

## Why

The PPU does not store a bitmap. Games write **tile bitmaps** into VRAM (`$8000–$97FF`) and **tile maps** (`$9800–$9FFF`) that say which tile goes in each 8×8 slot. The PPU indexes those every line. Once you decode 2bpp, you have a Game Boy on screen.

## Tile format

8×8 pixels, 16 bytes, 2 bits per pixel. For row `y` (0–7):

```
lo = vram[tileAddr + y * 2]
hi = vram[tileAddr + y * 2 + 1]
```

Pixel `x` (0 = left) uses bit `7 - x` of each byte:

```js
function colorIndex(lo, hi, x) {
  const bit = 7 - x;
  return ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1); // 0–3
}
```

If lo/hi are swapped you get a valid-looking but wrong image (often “ghost” outlines).

## Maps and addressing

`LCDC` from [io-registers.md](../docs/reference/io-registers.md):

- Bit 3: BG map `$9800` vs `$9C00`
- Bit 4: tile data `$8000` unsigned vs `$8800`/`$9000` signed
- Bit 0: BG enable (DMG). If 0, BG pixels are white (index 0 / BGP shade 0)

```js
function tileAddress(lcdc, tileId) {
  if (lcdc & 0x10) {
    return 0x8000 + tileId * 16;           // tileId 0–255
  }
  return 0x9000 + ((tileId << 24) >> 24) * 16; // signed
}
```

`tileId` is a byte from the map. Signed: values `$80–$FF` are −128…−1, pointing at `$8800–$8FFF`.

Visible 160×144 is a window into a 256×256 map (32×32 tiles) scrolled by `SCX`/`SCY`. Coordinates wrap with `& 0xff`.

## Scanline renderer

Call this at the **mode 3 → 0** transition, with `ly` still the current line:

```js
function renderScanline(ppu, vram) {
  const y = ppu.ly;
  if (y >= 144) return;
  const pal = dmgShades(ppu.bgp); // chapter 10; for now hardcode 4 greens

  for (let x = 0; x < 160; x++) {
    let idx = 0;
    if (ppu.lcdc & 0x01) {
      const px = (ppu.scx + x) & 0xff;
      const py = (ppu.scy + y) & 0xff;
      const mapBase = (ppu.lcdc & 0x08) ? 0x9c00 : 0x9800;
      const tileId = vram[(mapBase + (py >> 3) * 32 + (px >> 3)) - 0x8000];
      const addr = tileAddress(ppu.lcdc, tileId) - 0x8000;
      const lo = vram[addr + (py & 7) * 2];
      const hi = vram[addr + (py & 7) * 2 + 1];
      idx = colorIndex(lo, hi, px & 7);
    }
    putPixel(ppu.framebuffer, x, y, pal[idx]);
  }
}

function putPixel(fb, x, y, rgb) {
  const i = (y * 160 + x) * 4;
  fb[i] = (rgb >> 16) & 0xff;
  fb[i + 1] = (rgb >> 8) & 0xff;
  fb[i + 2] = rgb & 0xff;
  fb[i + 3] = 255;
}
```

Temporary palette if BGP is not decoded yet:

```js
const GREEN = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];
```

Use `idx` directly as a shade. Tetris will look too dark or inverted until BGP is applied, but **shapes** should be right.

## Fine scroll

`SCX % 8` is the starting bit inside the first tile. The formula `(scx + x) & 7` already handles that. Do not align to tiles only.

## Pitfalls

- Using `ly` after incrementing it for HBlank. Render **before** `ly++`.
- Tile address without subtracting `0x8000` when indexing `vram[]`.
- Signed addressing implemented as `0x8800 + tileId * 16` without sign extension (`$00` must map to `$9000`, not `$8800`).
- 32-bit JS: `tileId * 16` is fine; `(py >> 3) * 32` is fine.
- Drawing 256 pixels or using map width 20 instead of 32.
- CPU writes to VRAM going to a different array than the PPU reads.

## Checkpoint

Load Tetris, run frames (rAF or a “play” toggle that loops `frame()`).

You should recognize:

- The title screen (“TETRIS” / Nintendo license text), or
- The playfield well, or
- At least a **stable tiled image**, not snow.

If you see repeating garbage, LCDC bit 4 is wrong. If you see a uniform color, BG enable/map base is wrong or VRAM is empty (CPU never got VBlank — go back to ch. 8). If the image **scrolls junk vertically**, you are rendering with the wrong `ly` or wrapping badly.

Dr. Mario should also show a title or playing field.

Screenshot your canvas. This is the first chapter that looks like a Game Boy.

## Further reading

- [docs/reference/ppu.md](../docs/reference/ppu.md) (worked pixel example)
- [Pan Docs — Tile data](https://gbdev.io/pandocs/Tile_Data.html)
- Nazar part 4 *Graphics*
- DMG-01 tile RAM chapter (2bpp diagrams)
