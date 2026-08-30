# 09 — Background tiles

## Goal

When a scanline finishes mode 3, **draw the background** into that row of the framebuffer. Tetris’s title screen or playfield becomes recognizable (colors may be wrong until chapter 10).

## Why

The PPU does not store a bitmap. Games write **tile bitmaps** into VRAM (`$8000–$97FF`) and **tile maps** (`$9800–$9FFF`) that say which tile goes in each 8×8 slot. The PPU indexes those every line. Once you decode 2bpp, you have a Game Boy on screen.

## Why tiles, not a bitmap

160 × 144 × 2 bits ≈ 6 KiB for a raw framebuffer — almost all of VRAM — and scrolling would mean rewriting every pixel. Instead VRAM holds:

- **Tile data** (`$8000–$97FF`): up to 384 unique 8×8 patterns, 16 bytes each (2 bits per pixel).
- **Tile maps** (`$9800–$9FFF`): two 32×32 grids of tile *indices*. The visible screen is a 20×18 window into one 256×256-pixel map, scrolled by `SCX`/`SCY`.

Games rewrite a handful of map bytes or change `SCY` by 1. The PPU does the rest every mode 3.

**2bpp, two bytes per row:** the Game Boy is four shades, so two bitplanes. Byte 0 of a row is the low bit of each pixel; byte 1 is the high bit. Bit 7 is the **left** pixel (shift registers shifted left as the beam moved). Swap lo/hi and you get a plausible but wrong image — often ghost outlines.

**Two tile-addressing modes** (LCDC bit 4) are a compatibility leftover:

- Bit 4 = 1: unsigned index from `$8000` (OBJ always uses this too).
- Bit 4 = 0: signed index from `$9000` (tile `$00` at `$9000`, `$80` at `$8800`). The boot logo and many games use this “8800 addressing.”

**Two maps** (LCDC bit 3) let a game keep a playfield and a menu in VRAM at once and flip a bit.

LCDC bit 0 on DMG disables the background (white / colour 0). Chapter 10: it also disables the window.

You render **a whole scanline when mode 3 ends**, with `LY` still that line. That is a scanline renderer, not a pixel FIFO: cheaper, good enough, and why mode 3’s length being fixed did not matter until you care about mid-line effects.

Chapter 8 already left you a hook: `advanceMode` calls `renderScanline(ppu)` on the mode 3 → 0 transition, then later increments `ly` when leaving HBlank. Fill the stub in. Do not invent a second place that paints the line.

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

`LCDC` from [io-registers.md](../docs/reference/io-registers.md) — you already own these bits on `ppu.lcdc`:

- Bit 3: BG map `$9800` vs `$9C00`
- Bit 4: tile data `$8000` unsigned vs `$8800`/`$9000` signed
- Bit 0: BG enable (DMG). If 0, BG pixels are colour 0 (the lightest hardcoded green until chapter 10)

Skip-boot left `LCDC = $91`: LCD on, BG on, unsigned `$8000` tiles, map `$9800`. Tetris starts there. Games flip bits 3/4 later.

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

`bus.vram` is 8 KiB with index 0 = `$8000`. Every tile and map address in this chapter is a bus address; subtract `0x8000` before indexing.

## Wiring

VRAM still lives on the bus (chapter 5: `const vram = new Uint8Array(0x2000)`). The CPU writes it; the PPU must **read that same array**. A second buffer, or `createPpu()` allocating its own, stays empty while Tetris fills `bus.vram`.

`ppuStep(ppu, io, t)` and the chapter 8 tests do not know about VRAM. Keep that signature working: add an **optional** fourth argument and pass it from `tickEmu`, which already has the bus.

```js
// emu.js — tickEmu
ppuStep(emu.ppu, emu.io, dt, emu.bus.vram);

// ppu.js — thread vram into advanceMode; on mode 3 → 0:
renderScanline(ppu, vram);
```

In `renderScanline`, if `vram` is missing, return. Chapter 8’s `ppuStep(ppu, io, 70224)` calls then keep passing.

Do **not** hang VRAM off `createPpu()` and forget `reset`. `reset` does `Object.assign(emu.ppu, createPpu())`, which drops any extra fields you attached in `createEmu`. Passing `bus.vram` each tick survives that.

**Files:** `src/ppu.js` (helpers + fill in `renderScanline`), `src/emu.js` (`tickEmu` passes `emu.bus.vram`).  
**Host:** `src/main.js` — the Frame button already runs `runTCycles(emu, FRAME_T)` via `tickEmu`. After that (and after reset), blit:

```js
function blit(fb) {
  const canvas = document.querySelector('#screen');
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(fb, 160, 144), 0, 0);
}
```

Chapter 8 introduced this. If a leftover `frame()` helper still steps the CPU/timer **without** `ppuStep`, do not use it — `runFrame` / the Frame button is the loop you already have. `requestAnimationFrame` waits until [chapter 15](15-host-polish-and-audio.md); mash Frame, or loop `runFrame` in the console.

Optional: print `LY`, `LCDC`, `SCX`, `SCY` next to the CPU regs (chapter 8 asked for this). Garbage tiles are much easier to diagnose with those visible.

## Scanline renderer

Called at the **mode 3 → 0** transition, with `ly` still the current line:

```js
const GREEN = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];

function renderScanline(ppu, vram) {
  if (!vram) return;
  const y = ppu.ly;
  if (y >= 144) return;

  for (let x = 0; x < 160; x++) {
    let idx = 0;
    if (ppu.lcdc & 0x01) {
      const px = (ppu.scx + x) & 0xff;
      const py = (ppu.scy + y) & 0xff;
      const mapBase = (ppu.lcdc & 0x08) ? 0x9c00 : 0x9800;
      const tileId = vram[(mapBase + (py >> 3) * 32 + (px >> 3) - 0x8000];
      const addr = tileAddress(ppu.lcdc, tileId) - 0x8000;
      const lo = vram[addr + (py & 7) * 2];
      const hi = vram[addr + (py & 7) * 2 + 1];
      idx = colorIndex(lo, hi, px & 7);
    }
    putPixel(ppu.framebuffer, x, y, GREEN[idx]);
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

Use `idx` directly as a shade. Skip-boot `BGP = $FC` and game palette writes are chapter 10. Tetris will look too dark or inverted until then, but **shapes** should be right.

Pull `colorIndex` / `tileAddress` (and, if you like, a `sampleBg(ppu, vram, x, y)` that returns `idx`) out as helpers. Chapter 10’s window is the same decode with different coordinates and LCDC bit 6 instead of bit 3.

## Fine scroll

`SCX % 8` is the starting bit inside the first tile. The formula `(scx + x) & 7` already handles that. Do not align to tiles only.

## Pitfalls

- Using `ly` after incrementing it for HBlank. Render **before** `ly++` — the chapter 8 stub already does this if you leave the call where it is.
- Tile or map address without subtracting `0x8000` when indexing `vram[]`.
- Signed addressing implemented as `0x8800 + tileId * 16` without sign extension (`$00` must map to `$9000`, not `$8800`).
- 32-bit JS: `tileId * 16` is fine; `(py >> 3) * 32` is fine.
- Drawing 256 pixels or using map width 20 instead of 32.
- CPU writes to VRAM going to a different array than the PPU reads. Pass `emu.bus.vram`. Stashing it on `ppu` in `createEmu` only is wiped by `reset`.
- Filling in `renderScanline` but never blitting — the Frame button updates `LY` and the framebuffer in memory; the canvas stays white until `putImageData`.
- Calling a leftover `frame()` that omits `ppuStep`. Use `tickEmu` / `runFrame`.



## Checkpoint

Put these in `test/ch09-checkpoint.test.js`. No ROM required — plant bytes in `bus.vram` (or a bare `Uint8Array(0x2000)`).

```bash
cd emu && bun test test/ch09-checkpoint.test.js
```

Worked pixel from [docs/reference/ppu.md](../docs/reference/ppu.md): `LCDC = $91`, `SCX = SCY = 0`, map `$9800` tile id `$01`, tile `$01` row 0 = `$7C $7C` → pixels `0 3 3 3 3 3 0 0`. Step the PPU **252 T** from reset (mode 2 + mode 3) with that VRAM; line 0 of the framebuffer should match `GREEN[0]` then five `GREEN[3]`, then two `GREEN[0]`. If the whole row is colour 0, `vram` never arrived. If you get stripes, lo/hi are swapped.

Also worth asserting:

- **Signed addressing** — LCDC bit 4 clear, tile id `$00` reads bytes at `$9000` (vram offset `0x1000`), not `$8800`.
- **Fine scroll** — `SCX = 1` shifts that row one pixel left (the first on-screen pixel is the old second).
- **BG off** — LCDC bit 0 clear → the row is all `GREEN[0]`.
- **Correct** `ly` — after 252 T, `ppu.ly` is still 0 and the pixels landed in row 0, not row 1.

Then load Tetris, reset, run frames (Frame button or a short `for` of `runFrame`).

**Passing the unit tests above is the chapter 9 bar.** A commercial ROM may still flicker or show init junk — read [Tetris and other rabbit holes](#tetris-and-other-rabbit-holes-read-this-before-debugging) before chasing that.

On a **fully working** emulator you should eventually recognize the title screen, playfield, or at least a **stable** tiled image. At this stage in the course, a **one-frame sanity check** is enough: in the dev console, force `ppu.lcdc = $99` (or `$D3` if the game already switched map bases), call `runFrame()`, and confirm **tile shapes** appear. Colors may be wrong until chapter 10; the image may revert next frame when the game writes LCDC again — that is fine.

If you see repeating garbage, LCDC bit 4 is wrong. If you see a uniform color, BG enable/map base is wrong or VRAM is empty (CPU never got VBlank — go back to ch. 8) — or you never blit. If the image **scrolls junk vertically**, you are rendering with the wrong `ly` or wrapping badly.

Dr. Mario should also show a title or playing field once the rest of the machine catches up. Optional: Blargg `cpu_instrs` can print `Passed` on this same renderer ([test-roms.md](../docs/reference/test-roms.md)).

Screenshot your canvas when you get a recognizable frame — even a forced one. This is the first chapter that can look like a Game Boy.

## Tetris and other rabbit holes (read this before debugging)

While finishing this chapter, people often dump `LCDC`, `LY`, and VBlank PCs into the console and conclude the **background renderer** or **VBlank timing** is broken. Usually it is not. Use this table before rewriting `renderScanline` or adding a second interrupt check after `ppuStep`.

| Symptom | Likely cause | Where to look |
| --- | --- | --- |
| `ch09-checkpoint` passes but Tetris canvas flickers or stays blank most frames | Game init toggling LCDC (BG on for a line or two, then off again) | Chapters 6–8 (CPU/interrupt/timing), not tile decode |
| LCDC trace cycles `$D3 → $80 → $D3…` | Init loop in low ROM (`$0200–$0400`), not wrong map addressing | Trace PC; compare to reference emu — do not “fix” VBlank to LY≥144 only |
| Only **~2 scanlines** of tiles, then solid colour | `$80` write (BG bit 0 clear) mid-frame, right after `$D3` | Same — game code path |
| VBlank handler runs at **LY = 0** | IF set at LY=144 while **IME = 0**; long init; `EI` lands at line 0; pending bit fires there — **normal on hardware** | [06 — Interrupts](06-interrupts.md) (`EI` delay), [08 — PPU timing](08-ppu-timing.md) |
| Title / license never appears after many frames, but forced LCDC shows tiles | Renderer works; game never left init | Later chapters (10–12); optional Blargg `cpu_instrs` |
| Second `serviceIfNeeded` after `ppuStep` changes nothing | Deferral was not the blocker | Keep only if you also step PPU/timer for interrupt prologue cycles (see `tickEmu`) |

**Proof the renderer works** (dev console after Load + Reset):

```js
const e = emu();
e.ppu.lcdc = 0xd3; // or 0x99 for skip-boot map/tiles
runFrame();
```

If tile **shapes** appear, chapter 9 is done — move on to [palettes and window](10-palettes-and-window.md). A stable Tetris title that responds to Start is a **full-emulator** milestone (joypad, palettes, sprites, polish), not this checkpoint.

## Further reading

- [docs/reference/ppu.md](../docs/reference/ppu.md) (worked pixel example)
- [Pan Docs — Tile data](https://gbdev.io/pandocs/Tile_Data.html)
- Nazar part 4 *Graphics*
- DMG-01 tile RAM chapter (2bpp diagrams)



## Next

[10 — Palettes, window, LCD off](10-palettes-and-window.md)