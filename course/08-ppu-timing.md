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

Mode 3 is **fixed 172 T** in early chapters. On hardware it stretches with sprites and the window (pixel FIFO). Fixed lengths pass most commercial games; Mooneye PPU tests need variable length ([ToDo.md](../ToDo.md)).

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

### Bus wiring (minimum)

The mode machine lives in `ppu.js`, but games reach it through the bus. `LDH A,($FF44)` is just `read8(0xFF44)` — if that still returns the `io` stub `$FF`, Tetris spins forever on `CP $90` even when `ppu.ly` is moving internally.

Your bus already sends `$FF00–$FF7F` to `io.read` / `io.write`. Either give `io` a reference to `ppu` and delegate the LCD range, or handle `$FF40–$FF4B` in `bus.js` before falling through to `io`. Pick one place; do not duplicate register state in both `io.regs` and `ppu`.

| Addr | Reg | Read | Write |
| --- | --- | --- | --- |
| `$FF40` | LCDC | `ppu.lcdc` | `ppu.lcdc`; detect bit 7 **1→0** (LCD off) and **0→1** (LCD on) for reset behaviour below |
| `$FF41` | STAT | `(ppu.stat & 0xF8) \| ppu.mode \| (ly===lyc ? 4 : 0)` | writable bits 3–6 only — **ignore** writes to mode bits 0–1 and bit 2 |
| `$FF42` | SCY | `ppu.scy` | `ppu.scy` |
| `$FF43` | SCX | `ppu.scx` | `ppu.scx` |
| `$FF44` | LY | **`ppu.ly`** | **ignored** |
| `$FF45` | LYC | `ppu.lyc` | `ppu.lyc` |
| `$FF47` | BGP | `ppu.bgp` | `ppu.bgp` |
| `$FF48` | OBP0 | `ppu.obp0` | `ppu.obp0` |
| `$FF49` | OBP1 | `ppu.obp1` | `ppu.obp1` |
| `$FF4A` | WY | `ppu.wy` | `ppu.wy` |
| `$FF4B` | WX | `ppu.wx` | `ppu.wx` |

Skip `$FF46` (OAM DMA) until a later chapter. `$FF4C` does not exist on DMG — reads return `$FF`, writes are ignored.

On **LCDC write**, compare old and new bit 7:

- **1→0:** white framebuffer, `ly = 0`, `mode = 0`, `lineCycles = 0`, no VBlank requests.
- **0→1:** `ly = 0`, `mode = 2`, `lineCycles = 0` — beam starts fresh.

On reset / skip-boot, keep `ppu.lcdc` in sync with the post-boot `$91` you already store (either copy from `io.regs[0x40]` into a fresh `createPpu()`, or stop mirroring LCDC in `io.regs` once the PPU owns it).

**Files:** `src/bus.js` and/or `src/io.js`, plus `src/emu.js` if you pass `ppu` into `createBus` / `createIo`. **Verify:** `bun test test/ch08-checkpoint.test.js` — once `$FF44` reads `ppu.ly`, drop any test-only `io.read` patch for LY.

VRAM (`$8000–$9FFF`) and OAM (`$FE00–$FE9F`) stay on the bus as they are; this chapter does not add PPU access restrictions during mode 3.

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
- Mode 0 → increment LY. If LY === 144: mode 1, `io.requestIf(0)`, `ppu.frameReady = true`. Else mode 2.
- Mode 1: increment LY. If LY === 154: LY = 0, mode 2. Else stay in mode 1 (each 456 T-cycles is one VBlank line).

STAT bits 1–0 should reflect `mode`. Bit 2 is `ly === lyc`.

### STAT interrupts (minimum)

When **entering** a mode, if the corresponding enable bit is set, `io.requestIf(1)`. When `ly === lyc` becomes true, if STAT bit 6 is set, same. Do not fire every T-cycle.

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
  presentFrame(emu);
}

function presentFrame(emu, { force = false } = {}) {
  if (!force && !emu.ppu.frameReady) return;
  blit(emu.ppu.framebuffer);
  emu.ppu.frameReady = false;
}

function blit(fb) {
  const ctx = canvas.getContext("2d");
  const img = new ImageData(fb, 160, 144);
  ctx.putImageData(img, 0, 0);
}
```

The PPU sets `frameReady` at LY 144 (VBlank start). The host clears it after blitting so playback skips redundant canvas work between frames. Reset, load-state, and the Frame button use `force: true` to blit even when `frameReady` is false (LCD off or mid-frame snapshot).

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
- LCDC in two places (`io.regs` **and** `ppu.lcdc`) with no sync — skip-boot writes one, PPU reads the other, beam never runs.

## Checkpoint

Put these in `test/ch08-checkpoint.test.js` (or run in the debugger):

```bash
cd emu && bun test test/ch08-checkpoint.test.js
```

**One frame**

Reset, LCDC `$91`. Run one frame (70 224 T). `frameReady` true. IF bit 0 set at some point (the game may have cleared it — log on the edge). Tests: `one frame sets frameReady and requests VBlank IF`, `reset with LCDC $91; runFrame sets frameReady`.

**LY moves**

Spam “step 1000 T-cycles”; LY climbs 0→153→0. Tests: `LY visits 0..153 over one frame`, `1000-T chunks advance LY through a full frame`. Also `one large PPU step crosses mode boundaries` — a single `ppuStep` with 100 T must leave mode 2 (OAM) and enter mode 3 (draw); if you forget the `while (lineCycles >= length)` loop, large steps stall in the first mode.

**VBlank wait**

Tetris should **get past** the “wait for vblank” spin. Still a blank canvas. If PC is alive in a main loop rather than stuck on `LDH A,($FF44); CP $90; JR NZ`, you win. Test: `vblank wait loop exits instead of spinning forever` — requires `$FF44` → `ppu.ly` via bus wiring above.

**VBlank handler at LY = 0:** IF bit 0 is set when the beam **enters** LY=144, but the CPU only services it when `IME = 1`. Game init often runs long setup with interrupts off; `EI` at the end can land at **LY=0** of the next frame, so the vector at `$0040` runs there. That matches hardware — do not restrict VBlank service to LY 144–153. Chapter 9 has a fuller “rabbit hole” table if you are debugging a commercial ROM with the canvas open.

**LCD off**

Turn LCDC bit 7 off in the debugger; LY stays 0. Test: `LCD off keeps LY at 0 while T-cycles advance`.

## Further reading

- [docs/reference/ppu.md](../docs/reference/ppu.md)
- [Pan Docs — STAT](https://gbdev.io/pandocs/STAT.html)
- Nazar part 3 *GPU Timings* (same mode idea; his 172 is our fixed length too)

## Next

[09 — Background tiles](09-background.md)
