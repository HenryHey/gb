# MBC reference

Pan Docs: [MBC1](https://gbdev.io/pandocs/MBC1.html), [MBC2](https://gbdev.io/pandocs/MBC2.html), [MBC3](https://gbdev.io/pandocs/MBC3.html), [MBC5](https://gbdev.io/pandocs/MBC5.html), [header type byte](https://gbdev.io/pandocs/The_Cartridge_Header.html).

The CPU always sees 32 KiB of ROM space. Larger games put a **mapper** on the cartridge that banks 16 KiB windows. Writes to `$0000–$7FFF` are **commands**, not RAM.

## Cartridge type (`$0147`) you will hit

| Code | Type | Games (examples) |
| --- | --- | --- |
| `$00` | ROM ONLY | Tetris, Dr. Mario |
| `$01` | MBC1 | Super Mario Land (no SRAM) |
| `$03` | MBC1+RAM+BATTERY | many 90s titles |
| `$05` | MBC2 | Built-in 512 × 4-bit RAM |
| `$06` | MBC2+BATTERY | Same + battery for RAM |
| `$0F–$13` | MBC3 variants | `$13` Red/Blue; `$10` Gold/Silver (RTC) |
| `$19–$1E` | MBC5 family | `$1B` common for large ROM + RAM + battery |

Red/Blue is **`$13`**: RAM + battery, **no** RTC. Stub RTC registers anyway so a Gold ROM does not explode if you try one later.

ROM size `$0148`, RAM size `$0149` tell you how many banks to allocate. See Pan Docs tables. Pokémon Red: 64 × 16 KiB ROM (1 MiB), 4 × 8 KiB SRAM.

## ROM ONLY

`$0000–$7FFF` is the first (and only) 32 KiB. Ignore writes. `$A000–$BFFF` reads `$FF`.

## MBC1

State:

```js
{
  ramEnable: false,  // 0x0A in low nibble of $0000-1FFF
  romBank: 1,        // 5 bits from $2000-3FFF
  ramBank: 0,        // 2 bits from $4000-5FFF
  mode: 0,           // 1 bit from $6000-7FFF
}
```

### Registers (write)

| Address | Action |
| --- | --- |
| `$0000–$1FFF` | RAM enable: `(value & 0x0f) === 0x0a` |
| `$2000–$3FFF` | ROM bank low: `romBank = value & 0x1f`; **if that is 0, use 1** |
| `$4000–$5FFF` | RAM bank / ROM upper: `ramBank = value & 0x03` |
| `$6000–$7FFF` | Mode: `mode = value & 0x01` |

### Reads

**`$0000–$3FFF`**

- Mode 0: always ROM bank 0.
- Mode 1: bank `(ramBank << 5)` (banks `$00`, `$20`, `$40`, `$60` on 1 MiB carts). For ≤512 KiB ROM this still looks like bank 0.

**`$4000–$7FFF`**

Always `(ramBank << 5) | romBank` (masked). Mode does **not** drop the upper bits here.

- Mode 0: `$0000–$3FFF` = bank 0; SRAM bank 0.
- Mode 1: `$0000–$3FFF` = `(ramBank << 5)`; SRAM bank `ramBank`.

Always mask with `(numRomBanks - 1)` if the count is a power of two (it is).

**`$A000–$BFFF`**

If RAM disabled or no SRAM: read `$FF`, ignore writes.  
If mode 0: SRAM bank 0 only (2 KiB or 8 KiB).  
If mode 1: SRAM bank `ramBank` (up to 4 × 8 KiB).

### Bank 0 quirk

`romBank = (value & 0x1f) || 1` — never map bank 0 into `$4000–$7FFF` via the 5-bit register. Combined with upper bits you *can* reach `$20/$40/$60` in the `$0000` window (mode 1) but not as the lower 5 bits alone.

### 2 KiB RAM (header `$01`)

Only `$A000–$A7FF` is real; wrap or ignore the rest. Rare. Pokémon is 32 KiB.

## MBC3

State:

```js
{
  ramEnable: false,
  romBank: 1,      // 7 bits, 0 means 1
  ramBank: 0,      // 0–3 RAM, 0x08–0x0C RTC
  // RTC latch: optional stub
}
```

### Registers (write)

| Address | Action |
| --- | --- |
| `$0000–$1FFF` | RAM/RTC enable: `(value & 0x0f) === 0x0a` |
| `$2000–$3FFF` | `romBank = value & 0x7f`; if 0, use 1. **Banks `$20/$40/$60` work.** |
| `$4000–$5FFF` | `ramBank = value` (0–3 or `$08–$0C`) |
| `$6000–$7FFF` | RTC latch (0 then 1). Stub: ignore |

### Reads

- `$0000–$3FFF`: always ROM bank 0.
- `$4000–$7FFF`: ROM bank `romBank` (masked).
- `$A000–$BFFF`: if ramBank is 0–3, that SRAM bank (8 KiB). If `$08–$0C` and you stub RTC, return 0. If disabled, `$FF`.

## MBC2

State:

```js
{ ramEnable: false, romBank: 1 }  // 4-bit ROM bank; 0 → 1 in $4000–$7FFF
```

512 bytes × 4-bit RAM at `$A000–$A1FF`. Reads: `0xF0 | nibble`. `$A200–$BFFF` reads `$FF`.

### Registers (write)

| Address | Action |
| --- | --- |
| `$0000–$1FFF`, A8=0 | RAM enable: `(value & 0x0f) === 0x0a` |
| `$0000–$1FFF`, A8=1 | `romBank = (value & 0x0f) \|\| 1` |
| `$2000–$3FFF` | `romBank = (value & 0x0f) \|\| 1` |

### Reads

- `$0000–$3FFF`: ROM bank 0.
- `$4000–$7FFF`: ROM bank `romBank` (masked to cart size).

## MBC5

State:

```js
{
  ramEnable: false,
  romBankLow: 0,   // $2000–$2FFF
  romBankHigh: 0,  // $3000–$3FFF (1 bit)
  ramBank: 0,      // $4000–$5FFF (4 bits)
}
```

9-bit ROM bank: `(romBankHigh << 8) | romBankLow`. **Bank 0 is valid** in `$4000–$7FFF` (no `\|\| 1` quirk).

### Registers (write)

| Address | Action |
| --- | --- |
| `$0000–$1FFF` | RAM enable: `(value & 0x0f) === 0x0a` |
| `$2000–$2FFF` | `romBankLow = value` |
| `$3000–$3FFF` | `romBankHigh = value & 0x01` |
| `$4000–$5FFF` | `ramBank = value & 0x0f` |
| `$6000–$7FFF` | Rumble carts: bit 3 on/off — stub OK |

### Reads

- `$0000–$3FFF`: always ROM bank 0.
- `$4000–$7FFF`: ROM bank `(romBankHigh << 8) | romBankLow` (masked).
- `$A000–$BFFF`: same as MBC3 SRAM (8 KiB per bank, `ramEnable` gate).

Types `$1C–$1E` add rumble on `$6000–$7FFF`; types `$19–$1B` omit rumble.

## Saves

Battery means SRAM must survive a refresh. `localStorage` keyed by ROM title + header checksum is enough:

```js
localStorage.setItem(saveKey, btoa(String.fromCharCode(...sram)));
```

Load on cart insert. Pokémon stores the save in SRAM; if the signature is missing it starts a new game — that is the game, not your mapper.

## Header ROM/RAM sizes

| `$0148` | ROM |
| --- | --- |
| `$00` | 32 KiB (2 banks) |
| `$01` | 64 KiB (4) |
| `$02` | 128 KiB (8) |
| `$03` | 256 KiB (16) |
| `$04` | 512 KiB (32) |
| `$05` | 1 MiB (64) — Pokémon Red |
| `$06` | 2 MiB (128) |
| `$07` | 4 MiB (256) |
| `$08` | 8 MiB (512) |
| `$52` | 1.1 MiB (72) |
| `$53` | 1.2 MiB (80) |
| `$54` | 1.5 MiB (96) |

Bank indices wrap with `% romBanks`, where `romBanks = min(header, rom.length / 16 KiB)`.

| `$0149` | SRAM |
| --- | --- |
| `$00` | none |
| `$01` | 2 KiB (unused in Pan Docs; MBC1 2 KiB carts) |
| `$02` | 8 KiB |
| `$03` | 32 KiB (4 banks) — Pokémon Red |
| `$04` | 128 KiB (16 banks) |
| `$05` | 64 KiB (8 banks) |
