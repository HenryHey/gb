# 10 — Palettes, window, LCD off

## Goal

Decode `BGP` so greys/greens match the game. Draw the **window** layer. LCD-off is white. Tetris’s background should look correct; Pokémon’s menus use the window.

## Why

Chapter 9 drew *indices*. This chapter is the rest of the picture hardware: a 2-bit palette remap, a second map that does not scroll (HUD), and “beam off.”

## Palettes

`BGP` (`$FF47`) packs four 2-bit shades:

```
bits 1–0  color index 0
bits 3–2  index 1
bits 5–4  index 2
bits 7–6  index 3
```

VRAM only stores **indices** 0–3. `BGP` is the remap to actual shades (lightest → darkest). That is why fade-ins, flashes, and “pause greys” are a single register write — the tiles do not change. Hardware 0 is white (lightest) and 3 is black. Skip-boot `BGP = $FC` = `11 11 11 00` → index 0 white, 1–3 black, which is what the boot logo used. Games rewrite it.

```js
function paletteShades(reg, colors = GREEN) {
  return [0, 1, 2, 3].map((i) => colors[(reg >> (i * 2)) & 3]);
}
```

Use BGP in `putPixel` instead of raw color index.

Optional palettes: classic green, grey (`#fff, #aaa, #555, #000`), or a switch in the UI. Do not change *which* BGP index you use — only the display colors.

## Window

A second 32×32 map, same tiles, not affected by SCX/SCY. It is a rectangle from `(WX-7, WY)` to the bottom-right of the screen.

The window exists because the background is a *scrolling camera*. Status bars, battle HUDs, and Tetris’s score column should stay put while the camera moves. The cheapest hardware for that is a second map that the PPU starts sampling once the beam reaches `(WX-7, WY)`, ignoring `SCX`/`SCY`.

`WX` is stored with a +7 offset (window at screen X=0 → `WX = 7`). That matches an internal pipeline delay. `WX = 0` glitches on hardware; clipping at −7 is fine here.

The window has its own **line counter**, not `LY - WY`. If the game enables the window mid-frame, or `WY` is large, the first *drawn* window line is row 0 of that map. Increment `windowLine` only when you actually plotted a window pixel. Pokémon menus smear if you count every LY.

LCDC:

- Bit 5: window enable
- Bit 6: window map `$9800` / `$9C00`
- Bit 4: **same tile data** as BG
- Bit 0: on DMG, this bit disables **both** BG and window

```js
// ppu state:
windowLine: 0, // internal counter

// when LCD turns on or off, reset windowLine to 0
```

For each visible scanline `y`:

```js
const winOn = (ppu.lcdc & 0x20) && (ppu.lcdc & 0x01) && y >= ppu.wy && ppu.wx <= 166;
let usedWindow = false;

for (let x = 0; x < 160; x++) {
  const useWin = winOn && x >= (ppu.wx - 7);
  let idx;
  if (useWin) {
    usedWindow = true;
    const wx = x - (ppu.wx - 7);
    const wy = ppu.windowLine; // NOT y - wy, except when every line was drawn
    idx = sampleMap(ppu, vram, {
      mapBit: 0x40,
      px: wx,
      py: wy,
    });
  } else {
    idx = sampleBg(ppu, vram, x, y);
  }
  putPixel(fb, x, y, bgp[idx]);
}
if (usedWindow) ppu.windowLine++;
```

`sampleMap` is the same tile decode as BG with a chosen map bit and pixel coords that do not add SCX/SCY.

## LCD off

If bit 7 of LCDC is clear, do not run modes (chapter 8). Fill the canvas white each host frame (or leave the last frame — white is less confusing). When turning back on, `windowLine = 0`.

## Pitfalls

- Applying BGP backwards (`colors[3 - idx]`).
- Window using SCX/SCY.
- Incrementing `windowLine` every LY even when the window was disabled → Pokémon menus smear.
- Treating WX as an on-screen X without −7.
- Window map bit mixed up with BG map bit.

## Checkpoint

Tetris: playfield and text use distinct greys, not three-shades-are-black. The well is readable.

If you have Pokémon from a later chapter, pause here conceptually: the battle/status **window** covering the bottom of the screen is this feature.

Force `WY = 0`, `WX = 7`, LCDC window bits on in the debugger: a second map should overlay from the top-left.

LCDC bit 7 = 0: white canvas, LY stuck at 0.

## Further reading

- [Pan Docs — Window](https://gbdev.io/pandocs/Window_Display.html)
- [Pan Docs — Palettes](https://gbdev.io/pandocs/Palettes.html)
- [docs/reference/ppu.md](../docs/reference/ppu.md)

## Next

[11 — Sprites and OAM DMA](11-sprites-and-dma.md)
