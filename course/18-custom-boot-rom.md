# 18 — Custom boot ROM

## Goal

Replace skip-boot with a **real 256-byte boot program** that runs at `$0000`, shows custom text on the LCD, then unmaps itself and falls into the cartridge at `$0100`. When you finish:

- The bus serves a boot ROM overlay for `$0000–$00FF` until `$FF50` is written.
- Reset starts at `PC = $0000` (not `$0100`).
- A small generator produces valid boot ROM bytes from a string like `"HELLO"`.
- Post-boot CPU and I/O match [skip-boot.md](../docs/reference/skip-boot.md) closely enough that Tetris still runs.

You will **not** replicate the Nintendo logo scroll, checksum, or startup chime. Those need the retail boot ROM or a much larger program. This chapter follows [Max Bonnefin's custom boot ROM write-up](https://bonnef.in/posts/custom-boot-rom/) — a legal, educational alternative that fits the same 256-byte silicon budget.

**Prerequisites:** chapters [05](05-memory-and-skip-boot.md) (bus), [07](07-timer.md) (DIV), [08](08-ppu-timing.md)–[10](10-palettes-and-window.md) (PPU + BGP), [15](15-host-polish-and-audio.md) (APU stub). Skip-boot must already work as a fallback.

## Why bother?

Chapter 5 **fakes** the boot ROM: you map the cartridge from `$0000` and paste register values. That is correct and fast. Running an actual boot program teaches three things skip-boot hides:

1. **The overlay** — `$0000–$00FF` is not always “ROM bank 0”. Hardware swaps the decode on a single I/O write.
2. **Post-boot state is program output** — every register value in [`skip-boot.md`](../docs/reference/skip-boot.md) is something the boot ROM *executed*, not magic constants.
3. **The 256-byte constraint** — real firmware where every byte is accounted for.

A **custom** generator also sidesteps distributing Nintendo's copyrighted boot ROM dump with your emulator. Pan Docs documents the behaviour; [Bonnefin's article](https://bonnef.in/posts/custom-boot-rom/) shows how to pack init + text + disable into exactly 256 bytes.

## Hardware recap

```
Power on
   │
   ▼
PC = $0000  ──►  boot ROM visible at $0000–$00FF
   │              (cartridge still visible at $0100+)
   ▼
Init SP, VRAM, audio, LCD
   │
   ▼
Show boot screen (scroll, text, or nothing)
   │
   ▼
Write $01 → $FF50  ──►  overlay OFF
   │
   ▼
Fetch next opcode from cart $0100  ──►  game runs
```

On hardware, the retail boot ROM also **checksums** cart `$0104–$0133` against an internal copy. Fail the compare → infinite loop. Your custom ROM can skip that — homebrew and test ROMs do not depend on it.

Reference cheat sheet: [`docs/reference/boot-rom.md`](../docs/reference/boot-rom.md).

## Design

```
src/bootrom.js       generateBootRom(text) → Uint8Array(256)
src/bus.js           bootRomEnabled flag; overlay reads
src/io.js            $FF50 write clears overlay
src/emu.js           reset(): boot path vs skip-boot path
test/bootrom.test.js generator + unmap behaviour
```

Keep **skip-boot** as a config flag (`useBootRom: false` by default) so tests and CI stay fast.

### Bus overlay

When `bootRomEnabled` is true, reads in `$0000–$00FF` come from the boot ROM array, not the cart:

```js
function read8(addr) {
  addr &= 0xffff;
  if (addr < 0x0100 && bootRomEnabled) return bootRom[addr];
  if (addr < 0x8000) return cart.readRom(addr);
  // … rest unchanged
}
```

Writes to `$0000–$00FF` during boot still hit the cart on real hardware (logo bytes live there). For a text-only custom ROM you usually do not write that range; ignoring writes is fine.

### `$FF50` disable

```js
// in io.write, when addr === 0xff50:
if (value !== 0) emu.bootRomEnabled = false;
```

The last instruction of every boot ROM is `LDH ($FF50), A` with `A = $01`. After that instruction completes, the **next** fetch must read cart `$0100`.

Pan Docs: [FF50 — BOOT](https://gbdev.io/pandocs/Power_Up_Sequence.html#ff50---boot-b).

### Reset paths

```js
export function reset(emu, { useBootRom = false } = {}) {
  clearMutableState(emu);
  if (useBootRom) {
    emu.bootRom = generateBootRom(emu.bootText ?? 'GB EMU');
    emu.bootRomEnabled = true;
    Object.assign(emu.cpu, { pc: 0, sp: 0, /* registers zeroed */ ime: false });
  } else {
    skipBoot(emu);
  }
}
```

When boot ROM mode is on, **do not** call `skipBoot()` — let the program produce post-boot state. You may still need to zero WRAM/OAM like hardware (random on real silicon; zeros in the emu).

## Building the 256-byte program

The retail ROM decompresses the Nintendo logo from the **cartridge header** — it does not store full tiles. A custom text ROM must embed font data in the 256 bytes itself, so the budget is tight (~8 characters with a minimal font).

Follow this **section order** (from [Bonnefin](https://bonnef.in/posts/custom-boot-rom/)):

### 1. Stack pointer (3 bytes)

```
$00: 31 FE FF    LD SP, $FFFE
```

Same as retail. Stack grows down from HRAM.

### 2. VRAM clear (9 bytes)

Clear `$8000–$9FFF` so stale tile data does not flash on screen:

```asm
XOR A           ; A = 0
LD HL, $9FFF
.loop:
  LD (HL-), A
  BIT 7, H      ; loop while H >= $80
  JR NZ, .loop
```

Machine code: `AF 21 FF 9F 32 CB 7C 20 FB`.

### 3. Audio init (~16 bytes)

Even if you play no sound, write the same NR values the retail boot ROM leaves behind. **Prehistorik Man** assumes NR50/NR51 are already set and never initialises them:

| Register | Value | Role |
| --- | --- | --- |
| NR52 (`$FF26`) | `$80` then `$F1` | Power APU on |
| NR11 | `$80` | Channel 1 length |
| NR12 | `$F3` | Envelope |
| NR50 | `$77` | Master volume |
| NR51 | `$F3` | Output routing |

Copy the full post-boot table from [`skip-boot.md`](../docs/reference/skip-boot.md) if a game is picky. Your chapter-15 APU stub already accepts these writes.

### 4. Tile copy loop (~17 bytes)

Font tiles live in the boot ROM as raw bytes. Copy them to VRAM `$8000`:

```asm
LD HL, $8000      ; dest
LD DE, tileData   ; source address — patched at generation time
LD BC, tileCount  ; byte count
.copy:
  LD A, (DE)
  LD (HL+), A
  INC DE
  DEC BC
  LD A, B
  OR C
  JR NZ, .copy
```

Calculate `DE` and `BC` when you **assemble** the ROM: tile data offset depends on how long the code sections above are.

### 5. Font tiles (16 bytes × N)

The Game Boy has no text mode — only 8×8 **tiles** in 2 bpp. Each tile is 16 bytes (low/high byte per row).

For glyphs using only white (colour 0) and black (colour 3), low and high bytes match per row. Example row of an `M`:

```
. ■ . . . ■ . .   →  both bytes 0x44
```

In JavaScript, convert an 8×8 pattern to 16 bytes:

```js
function glyphToTile(rows) {
  const tile = new Uint8Array(16);
  for (let y = 0; y < 8; y++) {
    let b = 0;
    for (let x = 0; x < 8; x++) {
      const c = rows[y][x] & 3;
      if (c & 1) b |= 1 << (7 - x);
      if (c & 2) b |= 1 << (7 - x); // same bit in high byte when only 0/3
    }
    tile[y * 2] = b;
    tile[y * 2 + 1] = b;
  }
  return tile;
}
```

**Tile 0** should be blank (16 zero bytes). After VRAM clear, the tilemap still points at tile 0 everywhere — a blank tile keeps the screen white.

Character tiles start at index **1**, stored sequentially in VRAM.

### 6. Tilemap (~12 bytes)

Background map at `$9800`. The visible window is 20×18 tiles; centre your string on a row:

```
column = (20 - text.length) / 2
addr   = $9800 + row * 32 + column
```

For `"HELLO"` (5 chars), row 8: `$9800 + 8*32 + 7 = $9907`.

```asm
LD HL, $9907
LD A, 1           ; first tile index
LD B, textLen
.map:
  LD (HL+), A
  INC A
  DEC B
  JR NZ, .map
```

### 7. LCD on (8 bytes)

```asm
LD A, $FC
LDH ($FF47), A    ; BGP: white bg, dark text colours
LD A, $91
LDH ($FF40), A    ; LCDC: LCD on, BG on, unsigned tiles, map $9800
```

The moment LCDC bit 7 is set, the PPU starts drawing — tiles and map must already be in VRAM.

### 8. Delay (~8 bytes)

Without a pause, boot disables itself before the user sees a frame:

```asm
LD BC, $FFFF
.delay:
  DEC BC
  LD A, B
  OR C
  JR NZ, .delay
```

~400 ms at 4.19 MHz — enough to read the text.

### 9. Jump to disable (3 bytes)

Code size varies with message length. Reserve **`$FC–$FF`** for the disable sequence and jump there:

```asm
JP $00FC
```

### 10. Boot disable — always at `$FC` (4 bytes)

```js
rom[0xfc] = 0x3e; // LD A, $01
rom[0xfd] = 0x01;
rom[0xfe] = 0xe0; // LDH ($FF50), A
rom[0xff] = 0x50;
```

Patch these **last** in the generator so earlier sections cannot overwrite them.

## The generator

Write `generateBootRom(text)` that:

1. Validates `text` length (start with ≤ 6–8 uppercase ASCII letters you have glyphs for).
2. Builds a `Uint8Array(256)` filled with `$00` (or `$FF` — `$00` is `NOP` if execution falls through by mistake).
3. Emits machine code sections in order, tracking `pos`.
4. Appends tile data (blank + one tile per character).
5. Patches `DE`/`BC` in the copy loop with the final tile-data offset and size.
6. Writes the fixed disable bytes at `$FC–$FF`.
7. Asserts `pos <= 0xfb` — overflow means shorter text or tighter code.

```js
export function generateBootRom(text) {
  const rom = new Uint8Array(256);
  let pos = 0;

  function emit(...bytes) {
    for (const b of bytes) {
      if (pos > 0xfb) throw new Error('boot ROM overflow');
      rom[pos++] = b;
    }
  }

  emit(0x31, 0xfe, 0xff); // LD SP, $FFFE
  // … VRAM clear, audio, copy loop placeholder, tilemap, LCD, delay …
  emit(0xc3, 0xfc, 0x00); // JP $00FC

  const tileBase = pos;
  // append blank tile + glyph tiles; patch copy loop with tileBase

  rom[0xfc] = 0x3e;
  rom[0xfd] = 0x01;
  rom[0xfe] = 0xe0;
  rom[0xff] = 0x50;
  return rom;
}
```

Unit-test the generator: correct length, disable bytes at `$FC`, tile bytes at expected offsets, no overflow for `"GB"` and `"HELLO"`.

## Wiring the host

Add a boot ROM toggle in the debug UI or URL flag:

```js
createEmu(rom, { useBootRom: true, bootText: 'TETRIS' });
```

On reset with boot ROM enabled, run until `bootRomEnabled` becomes false (or `PC >= 0x0100` and overlay off). **Then** compare registers to skip-boot expectations.

If you use the same frame loop as normal play, one or two frames during the delay is enough for the text to appear before `$0100`.

## What you should see

1. Reset with boot ROM on: debugger shows `PC` near `$0000`, `bootRomEnabled = true`.
2. LCD shows centred white background with black text (your string).
3. After the delay, `$FF50` is written; overlay off; `PC` in cart ROM (`$0100+`).
4. Tetris (or any ch. 15 game) runs normally afterward — same behaviour as skip-boot.
5. With boot ROM off, behaviour unchanged from chapter 5.

## Pitfalls

- **Calling `skipBoot()` and boot ROM** — double-initialises registers; pick one path per reset.
- **Starting at `$0100` with overlay still on** — fetches cart header as code; start at `$0000`.
- **LCDC before tiles** — turning the LCD on first shows garbage tiles.
- **Forgetting blank tile 0** — tilemap zeros after VRAM clear already point at tile 0; without a blank tile, you see noise.
- **Overflow past `$FB`** — long text or too many glyphs; shorten the string or drop audio init (not recommended).
- **PPU not stepping during boot** — delay loop runs but LCD never renders; ensure `ppu.step(tCycles)` still runs in your instruction loop.
- **Mooneye `boot_*` tests** — they expect the **retail** logo checksum path. A custom text ROM will not pass them; that is expected.

## Checkpoint

1. `bun test test/bootrom.test.js` — generator size, `$FC` tail, no overflow for a 5-letter string.
2. Manual: enable boot ROM, reset, watch custom text for ~½ s, then game starts.
3. After boot completes: `A = $01`, `SP = $FFFE`, `LCDC = $91`, `BGP = $FC` (compare to [`skip-boot.md`](../docs/reference/skip-boot.md)).
4. `useBootRom: false` — all existing checkpoint tests still pass.

Optional stretch goals (not required):

- Retail boot ROM dump loaded from a user-supplied file (do not commit the bytes).
- Scroll animation by updating SCY each frame during boot.
- Header checksum like retail (compare cart `$0104–$0133` to embedded reference).

## Further reading

- [256 Bytes to Boot — Max Bonnefin](https://bonnef.in/posts/custom-boot-rom/) — primary walkthrough this chapter adapts
- [Pan Docs — Power-Up Sequence](https://gbdev.io/pandocs/Power_Up_Sequence.html)
- [Pan Docs — Tile Data](https://gbdev.io/pandocs/Tile_Data.html) — 2bpp encoding
- [GBDev Wiki — Bootstrap ROM](https://gbdev.io/wiki/Gameboy_bootstrap_ROM)
- [Disassembled boot ROMs](https://github.com/gbdev/bootroms) — retail source for comparison
- [`docs/reference/boot-rom.md`](../docs/reference/boot-rom.md) — overlay + layout cheat sheet
- [`docs/reference/skip-boot.md`](../docs/reference/skip-boot.md) — target post-boot state

## Next

**Optional:** [99 — Mooneye polish](99-mooneye-polish.md) — accuracy pass. Boot ROM tests in Mooneye need the retail ROM, not this custom generator.
