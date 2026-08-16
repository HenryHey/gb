# 08 — PPU timing

## Goal

A PPU **mode machine**: LY 0–153, modes 2→3→0 on visible lines, mode 1 for 10 lines of VBlank, VBlank interrupt once per frame. A host loop that runs **70 224 T-cycles** and then blits (still a blank/white framebuffer).

No tiles yet. You are building the clock the renderer will hang off.

## Why

The LCD is a raster. Software syncs to it via `LY`, `LYC`, STAT, and the VBlank interrupt. If LY is stuck at 0, games spin forever in “wait for vblank.” If you never set IF bit 0, they `HALT` forever.

## A CRT-shaped LCD

The Game Boy LCD is not a framebuffer chip. It is a **scanline beam**: left to right, top to bottom, 160 visible dots per line, 144 visible lines, then 10 lines with the beam off (VBlank) so the CPU can touch VRAM in peace.

One dot = one T-cycle. That is why the PPU and CPU share a clock and why `step()`’s return value is the right unit.

```
one line = 456 T-cycles:
  mode 2   80 T    OAM scan     — PPU walks the 40 sprites; CPU should stay out of OAM
  mode 3  172 T    draw         — PPU reads VRAM; CPU should stay out of VRAM (we ignore the lock)
  mode 0  204 T    HBlank       — line done; CPU may write VRAM/OAM until the next mode 2
one frame = 154 lines × 456 = 70 224 T  (~59.7 Hz)
  LY 0–143   visible (modes 2→3→0)
  LY 144–153 VBlank (mode 1, 456 T each). Entering LY=144 sets IF bit 0.
```

Mode 3 is **fixed 172 T** in this course. On hardware it stretches with sprites and the window (pixel FIFO). Fixed lengths play Tetris/Pokémon; they fail Mooneye PPU tests. That is the accuracy bar from chapter 0.

`LY` (`$FF44`) is “which line is the beam on.” Games poll it (`wait until LY === $90`) or enable the VBlank interrupt. Writes to `LY` are ignored — you cannot rewind the beam. `LYC` + STAT bit 2 are “tell me when we hit this line” (HUD splits, effects).

**LCD off** (LCDC bit 7 = 0) stops the beam. LY stays 0, no VBlank requests. Games blank the screen to copy tiles without fighting mode 3. If you keep ticking LY while the LCD is off, a game that turns it back on immediately sees LY=90 and desyncs.

You are not drawing tiles yet. This chapter is the **clock** the renderer will hang off: when mode 3 ends, chapter 9 will paint that `LY` into a 160×144 buffer. Until then a white framebuffer plus a moving `LY` is success.

## Frame geometry

```
for ly in 0..143:
    mode 2  80 T     OAM scan
    mode 3 172 T     draw   ← you will render the line when this ends (ch. 9)
    mode 0 204 T     HBlank
for ly in 144..153:
    mode 1 456 T     VBlank (enter IF VBlank at ly==144)
```

456 × 154 = 70 224.

## Design

```js
export function createPpu() {
  return {
    mode: 2,
    lineCycles: 0, // T-cycles in the current mode
    ly: 0,
    lcdc: 0x91,
    stat: 0x84,
    lyc: 0,
    scx: 0, scy: 0, wy: 0, wx: 0,
    bgp: 0xfc, obp0: 0xff, obp1: 0xff,
    framebuffer: new Uint8ClampedArray(160 * 144 * 4),
    frameReady: false,
  };
}
```

Own LCD registers in the PPU (or in `io` with the PPU reading them). `bus.read(0xff44)` returns `ppu.ly`. Writes to LY ignored. LCDC/STAT/SCX/… go to the PPU.

```js
export function ppuStep(ppu, io, t) {
  if (!(ppu.lcdc & 0x80)) {
    // LCD off
    ppu.ly = 0;
    ppu.mode = 0;
    ppu.lineCycles = 0;
    return;
  }
  ppu.lineCycles += t;
  while (ppu.lineCycles >= modeLength(ppu.mode)) {
    ppu.lineCycles -= modeLength(ppu.mode);
    advanceMode(ppu, io);
  }
  updateStatLyEquals(ppu, io);
}

function modeLength(mode) {
  return [204, 456, 80, 172][mode];
}
```

`advanceMode`:

- Mode 2 → 3.
- Mode 3 → 0, and **later** call `renderScanline(ppu)` (stub for now).
- Mode 0 → increment LY. If LY === 144: mode 1, `io.if |= 1`, `ppu.frameReady = true`. Else mode 2.
- Mode 1: increment LY. If LY === 154: LY = 0, mode 2. Else stay in mode 1 (each 456 T-cycles is one VBlank line).

STAT bits 1–0 should reflect `mode`. Bit 2 is `ly === lyc`.

### STAT interrupts (minimum)

When **entering** a mode, if the corresponding enable bit is set, `io.if |= 0x02`. When `ly === lyc` becomes true, if STAT bit 6 is set, same. Do not fire every T-cycle.

STAT mode-1 interrupt is **in addition to** VBlank (IF bit 0).

### LCD off

When LCDC bit 7 goes 1→0: white screen, LY=0, mode 0, no VBlank requests. When 0→1: start at mode 2, LY=0, `lineCycles=0`. Detect the edge in `write LCDC`.

### Host frame loop

```js
const FRAME = 70224;

function frame(emu) {
  let budget = FRAME;
  while (budget > 0) {
    const t = stepInstruction(emu);
    timerStep(emu.io, t);
    ppuStep(emu.ppu, emu.io, t);
    budget -= t;
  }
  blit(emu.ppu.framebuffer);
}

function blit(fb) {
  const ctx = canvas.getContext("2d");
  const img = new ImageData(fb, 160, 144);
  ctx.putImageData(img, 0, 0);
}
```

Until chapter 9, fill the framebuffer with white (`rgba 224,248,208,255` or similar) once at reset so the canvas is not random.

`requestAnimationFrame(frame)` can wait until chapter 15; a “frame” button is enough now.

### Debugger

Show `LY`, `mode`, `STAT`, `LCDC`. After one frame: `LY` should have wrapped (you will often sample it mid-frame; after *exactly* 70224 it depends on leftover cycles — check that LY **changes** over time and that IF bit 0 has been set at least once).

## Pitfalls

- Using 144 VBlank lines or 153 as wrap (wrap at **154**, lines 144–153 inclusive is 10 lines).
- Mode lengths in M-cycles.
- Running the mode machine while LCD is off → spurious VBlanks, games enable LCD and immediately see LY=90.
- `while (lineCycles >= length)` forgotten: one instruction can be 24 T-cycles and cross a mode boundary; a 20 T-cycle interrupt can too.
- Blitting every instruction. Once per frame.
- STAT writable bits 1–0: ignore writes to mode bits.

## Checkpoint

1. Reset, LCDC `$91`. Run one frame (70 224 T). `frameReady` true. IF bit 0 set at some point (the game may have cleared it — log on the edge).
2. Debugger: spam “step 1000 T-cycles”; LY climbs 0→153→0.
3. Tetris: it should **get past** the “wait for vblank” spin. Still a blank canvas. If PC is alive in a main loop rather than stuck on `LDH A,($FF44); CP $90; JR NZ`, you win.
4. Turn LCDC bit 7 off in the debugger; LY stays 0.

## Further reading

- [docs/reference/ppu.md](../docs/reference/ppu.md)
- [Pan Docs — STAT](https://gbdev.io/pandocs/STAT.html)
- Nazar part 3 *GPU Timings* (same mode idea; his 172 is our fixed length too)
