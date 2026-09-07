# 15 — Host polish, APU stub, wrap-up

## Goal

A browser app you can leave running: `requestAnimationFrame` pacing, a tiny debugger overlay, APU registers that do not hang games, and an **optional** square-wave beep. Then stop and know what you did not build.

## Frame pacing

70 224 T-cycles ≈ 59.7 Hz. `requestAnimationFrame` is ~60 Hz on most displays.

The Game Boy does not know about monitors. Your `runFrame` already simulates one GB frame of T-cycles. The host’s job is to call that **about 60 times a second** and blit, without blocking the UI thread. `requestAnimationFrame` is a vsync hook, not a Game Boy feature — it just happens to match the LCD’s ~59.7 Hz well enough.

Do not spin `while (true)`: the tab would freeze and input would never land. One GB frame per rAF is the right default. 120 Hz displays would then run the Game Boy at 2× unless you accumulate timestamps (second snippet below).

```js
let running = false;

function tick() {
  if (running) {
    runFrame(emu); // exactly one GB frame of T-cycles
    blit(emu);
    updateDebug(emu);
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
```

**Do not** run unbounded `while (true)` on the main thread. One GB frame per rAF is the right default. If the host is 120 Hz, you still run one GB frame per callback unless you accumulate timestamps:

```js
let acc = 0;
function tick(now) {
  const dt = Math.min(now - last, 100);
  last = now;
  acc += dt;
  const frameMs = 1000 / 59.7275;
  while (acc >= frameMs) {
    if (running) runFrame(emu);
    acc -= frameMs;
  }
  blit(emu);
  requestAnimationFrame(tick);
}
```

A Pause button, a “frame step,” and a speed slider (`runFrame` 2× per host frame) are worth an hour.

## Debugger overlay

You already print registers. Keep it:

- `AF BC DE HL SP PC IME IE IF LY mode romBank`
- Last opcode byte
- Pause on unimplemented (you throw already)
- Optional: disassemble one instruction at PC (even a `opNames[256]` table)

This is how you finish Pokémon when a trainer battle hangs — not with more PPU theory.

## APU stub (required)

Games write `$FF10–$FF26` and wave RAM `$FF30–$FF3F`. If those reads return `$FF` forever, some titles think the APU is off or locked.

The APU is four analogue channels (two pulse, wave, noise) clocked from the same crystal, with a frame sequencer for length/envelope/sweep. That is a project of its own. What games *require* is the **MMIO contract**:

- Registers exist and hold the last write (not open `$FF` for everything).
- `NR52` bit 7 is master power. Power-off clears most regs; power-on does not start sound by itself.
- Skip-boot leaves `NR52 = $F1` (APU on, leftover channel-1 flag) because the boot ROM played a beep.

A stub that implements that contract lets Tetris and Pokémon run silently. The optional square wave below is host audio driven from channel 2’s frequency bits — a morale feature, not an APU.

Minimum:

```js
const apu = new Uint8Array(0x30); // FF10–FF3F

function apuRead(addr) {
  const i = addr - 0xff10;
  // NR52: bit 7 = power, bits 3–0 = channel-on (stub: 0)
  if (addr === 0xff26) return (apu[0x16] & 0x80) | 0x70;
  return apu[i];
}

function apuWrite(addr, v) {
  if (addr === 0xff26) {
    apu[0x16] = v & 0x80;
    if (!(v & 0x80)) apu.fill(0); // power off clears most regs
    return;
  }
  if (!(apu[0x16] & 0x80) && addr !== 0xff26) return;
  apu[addr - 0xff10] = v;
}
```

Skip-boot `NR52 = $F1` (APU on, channel 1 leftover). Copy the other NR values from [skip-boot.md](../docs/reference/skip-boot.md) if a game is picky.

Wave RAM can be zeros. Tetris and Pokémon play silently and should not freeze.

Serial (`$FF01/$FF02`): keep the stub. Optional debug: on write to `$FF02` with bit 7 set, `console.log(String.fromCharCode($FF01))` — Blargg tests print this way.

## Optional: Web Audio square wave

Not a Game Boy APU. A morale feature.

- Channel 2 registers `NR21–NR24`: duty, length (ignore), envelope (ignore), frequency.
- Frequency: `131072 / (2048 - n)` Hz where `n` is 11 bits from NR23/NR24.
- Trigger: write to NR24 with bit 7 set → start/restart an `OscillatorNode` type `"square"`.
- NR52 bit 7 off → `osc.stop()`.

This is enough to hear Tetris’s theme badly. A real APU needs frame sequencer, length, envelope, sweep, wave, LFSR noise, capacitor high-pass. Out of scope.

## UX extras (pick any)

- Drag-and-drop ROM on the canvas
- Fullscreen
- Integer scale (2×/3×/4×) with `image-rendering: pixelated`
- Mute toggle for the optional beep

## What you built

A DMG interpreter with:

- Full SM83 ISA (instruction-level T-cycles)
- Bus, skip-boot
- Interrupts, DIV/TIMA
- Scanline PPU: BG, window, sprites, DMA
- Joypad
- MBC1, MBC3, SRAM saves
- APU register stub

That is a **playable** emulator.

## What you did not build

| Topic | Why it can wait |
| --- | --- |
| Cycle-accurate PPU (pixel FIFO, mode 3 stretch) | Mooneye / dmg-acid2 perfection |
| HALT bug, OAM corruption, STAT IRQ blocking | Obscure; few commercial DMG titles |
| CGB (double speed, palettes, VRAM banks) | Different machine |
| MBC5, rumble, camera, printer | Optional [appendix 99](99-mooneye-polish.md); full cart features can wait |
| Real APU | Large project of its own |
| Serial link | Two emulators |
| Boot ROM / Nintendo logo | Cosmetic; legal dump required |
| WASM / Worker | Performance; JS is fine for DMG |

When a **specific game** glitches, debug that glitch (often `EI`/`HALT`, window line counter, MBC bank 0, DMA) before chasing cycle accuracy.

## Suggested next play

- Kirby’s Dream Land (MBC1)
- The Legend of Zelda: Link’s Awakening (MBC1+RAM+battery) — save already works
- Blargg `cpu_instrs` with the serial log hook
- dmg-acid2 for PPU pride

## Checkpoint

- rAF loop at ~60 fps, Pause works, canvas scales crisply.
- Tetris is silent but playable; optional square wave beeps if you did the extra.
- Pokémon still saves.
- You can explain, out loud, the `stepInstruction` → `timer.step` → `ppu.step` loop from chapter 0.

That is the end of the core course. Go play something.

**Optional:** [16 — Save states](16-save-states.md) — fixed-layout snapshots (mGBA as reference, not compatibility). [99 — Mooneye polish](99-mooneye-polish.md) — run the Mooneye harness and fix accuracy gaps one ROM at a time.

## Next

[16 — Save states](16-save-states.md)

## Further reading

- [Pan Docs — Audio](https://gbdev.io/pandocs/Audio.html)
- [docs/SOURCES.md](../docs/SOURCES.md)
- [docs/reference/test-roms.md](../docs/reference/test-roms.md)
- [TCAGBD](https://github.com/Gekkio/gb-ctr) if you want the next accuracy tier
