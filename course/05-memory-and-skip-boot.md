# 05 — Memory map and skip-boot

## Goal

Replace the flat array with a **real bus**: ROM, WRAM, HRAM, echo RAM, I/O stubs. Skip the boot ROM. Load Tetris (or any ROM-only dump) and watch **PC move** without hitting unimplemented opcodes.

The canvas stays black. That is success.

## Why

The CPU only ever talks to `read8`/`write8`. Cartridges, VRAM, joypad, and timers are all just addresses. Once the bus exists, every later chapter is “decode this range instead of returning `$FF`.”

## A 16-bit bus, not an MMU

The SM83 has 16 address pins. That is 64 KiB, period. There is no virtual memory. The **cartridge and the motherboard decode the address**: `$0000–$7FFF` is ROM on the cart, `$8000–$9FFF` is VRAM next to the PPU, `$FF00–$FF7F` is a row of I/O chips, `$FFFF` is a single interrupt-enable latch.

Your `read8` / `write8` *is* that decode. The nested `if (addr < …)` chain is not a software invention — it is the chip-select map.

```
0000-3FFF  ROM bank 0     cartridge, always visible (header + RST/IRQ vectors live here)
4000-7FFF  ROM bank N     still just “the rest of the 32 KiB file” until MBC1
8000-9FFF  VRAM           8 KiB the PPU will paint from; CPU can write it for now
A000-BFFF  cart RAM       empty until chapters 13–14; read $FF
C000-DFFF  WRAM           8 KiB on the motherboard — game variables, stack sometimes
E000-FDFF  echo RAM       the same WRAM wired to a second address range (cheap decode leftover)
FE00-FE9F  OAM            40 sprites × 4 bytes (chapter 11)
FEA0-FEFF  unusable       Nintendo said do not use; return $FF
FF00-FF7F  I/O            joypad, timer, PPU, APU, DMA — stub $FF until each chapter
FF80-FFFE  HRAM           127 bytes, always reachable (even during DMA)
FFFF       IE             interrupt enable (one byte, not part of HRAM)
```

**Echo RAM** is the same physical WRAM at two addresses. Mirror it (`addr - 0x2000`). Do not allocate a second array.

**HRAM is 127 bytes, not 128.** `$FFFF` is `IE`. Off-by-one here means `PUSH` at `SP = $FFFE` corrupts the interrupt mask.

**Writes to** `$0000–$7FFF` **never change ROM.** On a real cart those writes are mapper commands (chapter 13). Ignore them for ROM-only games; never mutate the `Uint8Array`.

**Open bus / unused I/O reads** `$FF`**.** Returning `0` makes games think devices exist in impossible states.

### Skip-boot is faking a chip overlay

On hardware, a 256-byte boot ROM covers `$0000–$00FF` at reset. It draws the Nintendo logo from the header, checksums it, then writes `$FF50` which **unmaps** that overlay. Execution falls through into cart ROM at `$0100` with a known register file.

This course does not run that program (you would need a boot ROM dump). Instead you:

1. Map cart ROM from `$0000` immediately (no overlay).
2. Stuff the CPU and I/O with the values the boot ROM *would have left* (`A = $01` so games can detect DMG, `PC = $0100`, `SP = $FFFE`, `IME = 0`, `LCDC = $91`, …).
3. Start stepping.

If you start at `PC = 0` you execute the header (logo tiles as “code”) and die. If you start with `IME = 1` you take interrupts before the game has installed handlers. The skip-boot table is not flavour — it is the post-conditions of a program you chose not to run. Full values: [docs/reference/skip-boot.md](../docs/reference/skip-boot.md).

## Design

```
src/bus.js      read8/write8
src/skipboot.js post-boot CPU + I/O values (DMG)
src/cart.js     already parses the header; now supplies rom bytes
src/emu.js      owns cpu, bus, reset() → skipBoot()
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

Put the post-boot values in `src/skipboot.js`. Call `skipBoot(emu)` on “Reset” / after load — `createEmu()` leaves the CPU at zeroes (`PC = 0`); skip-boot is what moves you to `$0100`.

```js
// src/skipboot.js
export function skipBoot(emu) {
  const { cpu } = emu;
  Object.assign(cpu, {
    a: 0x01,
    f: 0xb0,
    b: 0x00,
    c: 0x13,
    d: 0x00,
    e: 0xd8,
    h: 0x01,
    l: 0x4d,
    sp: 0xfffe,
    pc: 0x0100,
    ime: false,
    halted: false,
    imeEnableCountdown: 0,
  });
  if (emu.rom[0x14d] === 0) cpu.f = 0x80;
  emu.io.regs[0x40] = 0x91; // LCDC
  emu.io.regs[0x47] = 0xfc; // BGP
  emu.io.regs[0x0f] = 0xe1; // IF
  emu.bus.ie = 0;
  // full table: docs/reference/skip-boot.md
}
```

`emu.js` wires it in:

```js
import { skipBoot } from "./skipboot.js";

export function reset(emu) {
  skipBoot(emu);
}
```

WRAM/HRAM/VRAM can stay zeros. Tests: `test/skipboot.test.js`, `test/ch05-checkpoint.test.js`.

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

Without a PPU, `LY` **never changes** and VBlank never fires. The game will eventually `HALT` waiting for an interrupt, or spin on `LY`. That is expected. What is **not** expected:

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

**Later (optional):** [18 — Custom boot ROM](18-custom-boot-rom.md) — run a real 256-byte boot program instead of faking post-boot state.



## Next

[06 — Interrupts](06-interrupts.md)