# 14 — MBC3 and saves

## Goal

MBC3 ROM/RAM banking and SRAM in `localStorage`. **Pokémon Red/Blue** boots, you can start a game, refresh the page, and continue.

## Why

Pokémon Red (USA) is header type **`$13`**: MBC3 + 32 KiB SRAM + battery, **no RTC**. Gold/Silver (`$10`) need a clock; we stub RTC registers so a mistaken Gold dump does not crash, but we do not emulate days/hours.

MBC3 is simpler than MBC1 in one way (no mode bit, banks `$20/$40/$60` exist) and more annoying in another (RAM bank can mean RTC).

## Bigger ROM, battery RAM, optional clock

Pokémon is 1 MiB (64 × 16 KiB). MBC1’s 5-bit bank register cannot name 64 banks, and its “holes” at `$20/$40/$60` would be fatal. MBC3 uses a **7-bit** ROM bank and **always** maps bank 0 at `$0000–$3FFF`. Writing 0 still becomes 1 in `$4000–$7FFF`.

32 KiB of SRAM is four 8 KiB pages at `$A000–$BFFF`, selected by `ramBank` 0–3. A coin-cell on the cart keeps that RAM alive when the console is off — that is the “battery” in `MBC3+RAM+BATTERY`. Your `localStorage` is that coin-cell. Pokémon checksums the save; zeros look like “new game,” intact SRAM looks like “continue.”

`ramBank` values `$08–$0C` are RTC registers (seconds, minutes, …) on carts that have a clock. Red/Blue never select those. Return 0 / ignore writes so a Gold dump does not explode; do not invent a clock.

RAM enable (`$0A` in `$0000–$1FFF`) is the same lock as MBC1: the game unlocks, copies save data, locks. Persist SRAM on `pagehide` or a debounce after `writeRam`, not every byte.

## MBC3

[docs/reference/mbc.md](../docs/reference/mbc.md).

```js
export function createMbc3(rom, header) {
  const romBanks = header.romBanks; // 64 for Red
  const ram = new Uint8Array((header.ramKiB || 0) * 1024);
  let ramEnable = false;
  let romBank = 1;
  let ramBank = 0;

  return {
    ram, // for save/load
    readRom(addr) {
      if (addr < 0x4000) return rom[addr];
      const b = (romBank & (romBanks - 1)) || 1;
      return rom[b * 0x4000 + (addr - 0x4000)];
    },
    writeRom(addr, v) {
      if (addr < 0x2000) ramEnable = (v & 0x0f) === 0x0a;
      else if (addr < 0x4000) romBank = (v & 0x7f) || 1;
      else if (addr < 0x6000) ramBank = v;
      else { /* latch: ignore */ }
    },
    readRam(addr) {
      if (!ramEnable) return 0xff;
      if (ramBank <= 3) {
        const i = ramBank * 0x2000 + (addr - 0xa000);
        return ram[i] ?? 0xff;
      }
      // RTC $08–$0C
      return 0;
    },
    writeRam(addr, v) {
      if (!ramEnable) return;
      if (ramBank <= 3 && ram.length) {
        ram[ramBank * 0x2000 + (addr - 0xa000)] = v;
      }
    },
  };
}
```

`$0000–$3FFF` is **always** bank 0 on MBC3 (no MBC1 mode-1 hole). ROM bank is 7 bits.

Wire `createCart` types `$0F–$13` to this constructor. `$0F` has no SRAM; `$10` has RTC — same code, empty or stubbed RAM.

## Saves

Pokémon checksums SRAM. If it looks uninitialized, you get “new game.” If you persist it, you get “continue.”

```js
function saveKey(header) {
  return `gb-sram:${header.title}:${header.headerChecksum.toString(16)}`;
}

export function loadSram(cart, header) {
  const raw = localStorage.getItem(saveKey(header));
  if (!raw || !cart.ram?.length) return;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  cart.ram.set(bytes.subarray(0, cart.ram.length));
}

export function saveSram(cart, header) {
  if (!cart.ram?.length) return;
  localStorage.setItem(
    saveKey(header),
    btoa(String.fromCharCode(...cart.ram)),
  );
}
```

`String.fromCharCode(...cart.ram)` can blow the spread limit on huge arrays; 32 KiB is OK. For safety, chunk or use a loop.

When to save:

- `pagehide` / `beforeunload`
- A “Save SRAM” button
- Debounce writes: Pokémon writes SRAM in a burst; saving 1s after the last `writeRam` is enough

Load once after `createCart`. Do not load on every frame.

A “Delete save” button that `localStorage.removeItem` helps you test new-game vs continue.

## Battery-less MBC3

If `ramKiB === 0`, skip persistence. Reads at `$A000` stay `$FF`.

## Pitfalls

- Applying MBC1’s “upper bits in `$0000`” to MBC3.
- `romBank = v & 0x1f` (too narrow) — Pokémon has 64 banks, needs 7 bits.
- Saving before RAM enable, or saving the whole 32 KiB as zeros at boot and **overwriting** a good save on load order bugs (load after allocating ram, not before).
- Treating `$13` as “needs RTC.” It does not.
- Pokémon hanging on a white screen: often still CPU/PPU, not MBC. Log bank writes: you should see `romBank` change after the copyright screen. If it stays 1 forever, writes to `$2000` are not reaching `writeRom` (bus sent them to ROM array).
- Window layer (ch. 10) missing → garbled menus but overworld might work.

## Checkpoint

Pokémon Red/Blue:

1. Copyright → title → “PRESS START.”
2. New game, name a player, walk in Pallet Town.
3. Refresh the browser, load the same ROM: **CONTINUE** appears and works.

If the intro battle (Gengar vs Nidorino) plays, your sprites, BG, and window are in good shape.

Regression: Tetris, Dr. Mario, Super Mario Land.

## Further reading

- [Pan Docs — MBC3](https://gbdev.io/pandocs/MBC3.html)
- [docs/reference/mbc.md](../docs/reference/mbc.md)
- [docs/reference/test-roms.md](../docs/reference/test-roms.md)

## Next

[15 — Host polish, APU stub, wrap-up](15-host-polish-and-audio.md)
