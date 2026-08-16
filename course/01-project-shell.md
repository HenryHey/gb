# 01 — Project shell and cartridge header

## Goal

A Vite app that loads a `.gb` file and prints the **cartridge header**: title, mapper type, ROM size, RAM size, header checksum. No CPU yet.

## Why the header exists

There is no OS and no “file format” the console understands beyond **raw bytes on a 16-bit bus**. The cartridge *is* the program. Bank 0 of every cartridge has a contract Nintendo burned into the boot ROM: a fixed structure at `$0100–$014F`.

On a real Game Boy, a 256-byte boot ROM overlays `$0000–$00FF` at power-on. It copies the Nintendo logo from `$0104`, scrolls it, checksums `$0134–$014C`, then writes `$FF50` to unmap itself and fall into the game at `$0100`. You are not executing any of that yet — you are only **reading the contract** so later chapters know:

- which mapper chip sits on the cartridge (`$0147`)
- how many 16 KiB ROM banks exist (`$0148`)
- whether battery SRAM exists (`$0149`)

Skip-boot (chapter 5) and MBCs (chapters 13–14) need those three bytes. The title and checksum are how you know you actually loaded a ROM, not a zip file.

The header lives in the same address space the CPU will later execute. `$0100` is both “start of header” and “first instruction after boot.” That is why Tetris begins with `NOP; JP $0150`: jump over the logo and metadata into real code.

## Design

```
emu/
  index.html      canvas + file input + a <pre> for header text
  src/main.js     wires the file picker
  src/cart.js     parseHeader(rom: Uint8Array)
```

Vanilla ES modules. No React. The canvas is 160×144 CSS-scaled (e.g. 3×) with `image-rendering: pixelated`.

### Scaffold

```bash
bun create vite emu --template vanilla
cd emu
bun install
bun dev
```

You can keep `emu/` as a sibling of `course/` in this repo. Add `emu/node_modules/` and `emu/dist/` to `.gitignore` if you commit the project. Do not commit `.gb` files.

### `index.html` (minimal)

```html
<input type="file" id="rom" accept=".gb,.gbc,.bin" />
<pre id="info">Load a ROM</pre>
<canvas id="screen" width="160" height="144"></canvas>
```

```css
canvas {
  width: 480px;
  height: 432px;
  image-rendering: pixelated;
  background: #081820;
}
```

## Implementation

The ROM is just bytes. `File.arrayBuffer()` → `new Uint8Array(buf)`.

### Logo (optional sanity check)

`$0104–$0133` must match Nintendo’s 48-byte logo for a real boot ROM to proceed. For skip-boot you can ignore it. Dumping `rom.slice(0x104, 0x134)` and comparing to Pan Docs is a good “I actually read the file” check.

### Title

`$0134–$0143` is an uppercase ASCII title, padded with `$00`. On later carts `$0143` is the CGB flag — if bit 7 is set the title is only `$0134–$0142`. For DMG-era dumps, 16 bytes is fine:

```js
export function title(rom) {
  const bytes = rom.subarray(0x134, 0x144);
  let s = "";
  for (const b of bytes) {
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}
```

### Type, sizes, checksum

```js
const CART_TYPES = {
  0x00: "ROM ONLY",
  0x01: "MBC1",
  0x02: "MBC1+RAM",
  0x03: "MBC1+RAM+BATTERY",
  0x13: "MBC3+RAM+BATTERY",
  // add others as you meet them; full table in Pan Docs
};

const ROM_BANKS = { 0x00: 2, 0x01: 4, 0x02: 8, 0x03: 16, 0x04: 32, 0x05: 64, 0x06: 128 };
const RAM_KIB   = { 0x00: 0, 0x01: 2, 0x02: 8, 0x03: 32 };

export function parseHeader(rom) {
  if (rom.length < 0x150) throw new Error("ROM too small for a header");
  const type = rom[0x147];
  const romId = rom[0x148];
  const ramId = rom[0x149];
  return {
    title: title(rom),
    type,
    typeName: CART_TYPES[type] ?? `unknown($${type.toString(16)})`,
    romBytes: rom.length,
    romBanks: ROM_BANKS[romId],
    ramKiB: RAM_KIB[ramId] ?? 0,
    headerChecksum: rom[0x14d],
    headerChecksumOk: headerChecksum(rom) === rom[0x14d],
    cgbFlag: rom[0x143],
  };
}

/** Sum of $0134–$014C, as the boot ROM does. */
export function headerChecksum(rom) {
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) {
    x = (x - rom[i] - 1) & 0xff;
  }
  return x;
}
```

Entry point at `$0100` is usually `NOP; JP $0150` or similar. You do not execute it yet. You can still show `entry = rom[0x100].toString(16)` for curiosity.

CGB-only carts have `$0143` with bit 7 set **and** the game uses color I/O. Dual-mode games (bit 7 set, bit 6 clear) often still run on a DMG skip-boot. Prefer dumps named `(World)`, `(USA)`, `(DMG)` for this course.

## Pitfalls

- **File is a `.zip`.** Pokémon dumps are often zipped. The header will look like `PK\x03\x04…`. Unzip first.
- **Overdump / headered ROM.** If `rom.length` is not in `{32,64,128,…} * 1024`, you may have a 512-byte copier header. Rare for `.gb` files from modern dumpers. If title is garbage, check `rom[0x134]`.
- **Text encoding.** Titles are ASCII. Do not `TextDecoder('utf-8')` the whole slice if you care about padding NULs.

## Checkpoint

Load three files if you have them:

| ROM | Title (typical) | Type | ROM | RAM |
| --- | --- | --- | --- | --- |
| Tetris | `TETRIS` | `$00` ROM ONLY | 32 KiB | 0 |
| Dr. Mario | `DR.MARIO` | `$00` ROM ONLY | 32 KiB | 0 |
| Pokémon Red (USA) | `POKEMON RED` | `$13` MBC3+RAM+BATTERY | 1 MiB | 32 KiB |

Header checksum should report OK for an intact dump.

Also: clicking the file input should not crash if the file is 0 bytes — throw a readable error.

## Further reading

- [Pan Docs — Cartridge Header](https://gbdev.io/pandocs/The_Cartridge_Header.html)
- [docs/reference/memory-map.md](../docs/reference/memory-map.md) (header sits in bank 0)
- [docs/reference/mbc.md](../docs/reference/mbc.md) (type bytes)
- Nazar part 9 sketches the header before MBC1
