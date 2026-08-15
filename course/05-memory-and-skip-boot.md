# 05 — Memory map and skip-boot

## Goal

Replace the flat array with a **real bus**: ROM, WRAM, HRAM, echo RAM, I/O stubs. Skip the boot ROM. Load Tetris (or any ROM-only dump) and watch **PC move** without hitting unimplemented opcodes.

The canvas stays black. That is success.

## Why

The CPU only ever talks to `read8`/`write8`. Cartridges, VRAM, joypad, and timers are all just addresses. Once the bus exists, every later chapter is “decode this range instead of returning `$FF`.”

## Design

```
src/bus.js     read8/write8
src/cart.js    already parses the header; now supplies rom bytes
src/emu.js     owns cpu, bus, reset()
```

Cartridge for this chapter: **ROM ONLY**. `$0000–$7FFF` maps `rom[addr]` (32 KiB). Writes ignored. Larger ROMs still map the first 32 KiB; they will jump into the wrong bank until chapter 13 — do not use Pokémon yet.

```js
export function createBus({ rom, io }) {
  const wram = new Uint8Array(0x2000);
  const hram = new Uint8Array(0x7f);
  const vram = new Uint8Array(0x2000); // PPU will own this later; bus can hold it
  const oam  = new Uint8Array(0xa0);
  let ie = 0;

  function read8(addr) {
    addr &= 0xffff;
    if (addr < 0x8000) return rom[addr] ?? 0xff;
    if (addr < 0xa000) return vram[addr - 0x8000];
    if (addr < 0xc000) return 0xff;          // no SRAM yet
    if (addr < 0xe000) return wram[addr - 0xc000];
    if (addr < 0xfe00) return wram[addr - 0xe000]; // echo
    if (addr < 0xfea0) return oam[addr - 0xfe00];
    if (addr < 0xff00) return 0xff;
    if (addr < 0xff80) return io.read(addr);
    if (addr < 0xffff) return hram[addr - 0xff80];
    return ie;
  }
  // write8: ROM writes ignored; IE at 0xffff; io.write for FF00–FF7F
  return { read8, write8, vram, oam, wram, hram, get ie() { return ie; }, set ie(v) { ie = v & 0xff; } };
}
```

For 32 KiB ROMs, `rom[addr]` with `addr < 0x8000` is correct. If `rom.length === 0x8000`, there is no bank 1 distinct from the second half — it is already in the file at `$4000`.

### I/O stub

```js
export function createIo() {
  const regs = new Uint8Array(0x80).fill(0xff);
  return {
    read(addr) { return regs[addr - 0xff00]; },
    write(addr, v) { regs[addr - 0xff00] = v; },
    regs,
  };
}
```

Returning `$FF` for unread hardware is the right default. Chapter 6 will special-case `IF`; chapter 7 `DIV`/`TIMA`; chapter 8 `LCDC`/`LY`; etc. You may already write through to `regs[]` so later chapters can overlay.

**Do not** implement random CGB registers. `$FF4D` (speed switch) should read `$FF` on DMG.

### Skip-boot

On “Reset” / after load:

```js
import { DMG_AFTER_BOOT } from "./skipboot.js";

export function reset(emu) {
  const { cpu } = emu;
  Object.assign(cpu, {
    a: 0x01, f: 0xb0,
    b: 0x00, c: 0x13,
    d: 0x00, e: 0xd8,
    h: 0x01, l: 0x4d,
    sp: 0xfffe, pc: 0x0100,
    ime: false, halted: false, imeEnableCountdown: 0,
  });
  if (emu.rom[0x14d] === 0) cpu.f = 0x80;
  emu.io.regs[0x40] = 0x91; // LCDC
  emu.io.regs[0x47] = 0xfc; // BGP
  emu.io.regs[0x0f] = 0xe1; // IF
  emu.bus.ie = 0;
  // full table: docs/reference/skip-boot.md
}
```

WRAM/HRAM/VRAM can stay zeros.

### The run loop (still no PPU)

```js
export function runN(emu, n) {
  let t = 0;
  for (let i = 0; i < n; i++) {
    t += step(emu.cpu, ops, cbOps);
  }
  return t;
}
```

Add a “Run 70224 T-cycles” button (one fake frame) and a live register dump. If `halted`, either skip fetch (spin) or still count cycles — until chapter 6, `HALT` will freeze PC, which is OK to observe.

## What you should see with Tetris

Tetris’s entry is at `$0100`. After skip-boot it will:

1. Jump away from the header.
2. Zero memory, set up the stack in HRAM.
3. Enable the LCD, copy tiles, wait for VBlank.

Without a PPU, **`LY` never changes** and VBlank never fires. The game will eventually `HALT` waiting for an interrupt, or spin on `LY`. That is expected. What is **not** expected:

- `unimplemented xx at aaaa`
- `PC` stuck at `$0100` (you are not stepping)
- `PC` in `$0000–$00FF` looping the header (you started at 0 instead of `$0100`)

Log the first ~30 opcodes (mnemonic optional) to confirm you are in game code, not repeating `NOP`.

32 KiB Dr. Mario should behave the same class of “runs then waits on LCD.”

## Pitfalls

- Mapping ROM as `rom[addr]` for a **1 MiB** Pokémon dump: `$4000–$7FFF` must be a bank, not `rom[addr]`. Wait for MBC3. Tetris is 32 768 bytes.
- Writing to ROM “to implement MBC later” by mutating `rom[]`. Never mutate ROM; record mapper state separately.
- Echo RAM not mirrored → rare, but cheap to do now.
- `IE` at `$FFFF` accidentally stored in HRAM (HRAM is `$FF80–$FFFE` only — **127** bytes).
- `SP = $FFFE` and `PUSH` writing `hram[0x7e]` — index is `addr - 0xff80`. Off-by-one here corrupts IE.
- Starting with IME = 1. Boot left it 0.

## Checkpoint

1. Load Tetris. Header still displays.
2. Reset. `PC = $0100`, `SP = $FFFE`, `A = $01`.
3. Step 1: you should not still be at `$0100` unless the opcode was `NOP` (Tetris usually has `NOP; JP`).
4. Run several thousand instructions. **No throw.** PC is in RAM or ROM game code (`$0150+` or HRAM).
5. Optional: Blargg `cpu_instrs` will **not** pass yet (needs timer, often serial/PPU). Do not debug it this chapter.

Debugger should show hex dumps of `PC` and last opcode. You will live here.

## Further reading

- [docs/reference/memory-map.md](../docs/reference/memory-map.md)
- [docs/reference/skip-boot.md](../docs/reference/skip-boot.md)
- [docs/reference/io-registers.md](../docs/reference/io-registers.md)
- [Pan Docs — Memory map](https://gbdev.io/pandocs/Memory_Map.html)
- Nazar part 2 *Memory* (ranges; his BIOS overlay you are skipping)
