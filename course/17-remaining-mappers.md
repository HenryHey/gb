# 17 — Remaining mappers

## Goal

Implement the **rest of the common cartridge mappers** so more ROMs load without throwing. When you finish:

- **MBC5** ROM/RAM banking works (types `$19–$1E`).
- **MBC2** works for its small built-in RAM (types `$05–$06`).
- **All MBC3 header codes** (`$0F–$13`) route to your existing MBC3 constructor — not just `$13`.
- Mooneye ROMs that need MBC5 **load** instead of crashing `createCart()`.

You do **not** need rumble motors, Game Boy Camera, or MBC7 accelerometers for this chapter. Stub rumble writes; ignore exotic chips.

## Why

Chapters [13](13-mbc1.md) and [14](14-mbc3-and-saves.md) cover the mappers most launch-era games use. Later titles and test ROMs often pick **MBC5**: up to 8 MiB ROM, simpler banking than MBC1’s mode bit, and **bank 0 is allowed** in `$4000–$7FFF` (unlike MBC1/MBC3’s “write 0 → use 1” rule).

Your `createCart()` probably throws on anything outside `$00`, `$01–$03`, and `$13`. That is fine until you try Mooneye’s `oam_dma/sources-GS.gb` (header `$1B`) or a Donkey Kong Land dump. One more cart chapter unlocks a large slice of the library without touching CPU or PPU.

## What is left on the table

| Mapper | Header types | Priority | Notes |
| --- | --- | --- | --- |
| **MBC5** | `$19–$1E` | **Do this** | Shantae, Donkey Kong Land III, many homebrew tests |
| **MBC3 family** | `$0F–$13` | **Wire routing** | Same silicon you built in ch. 14; Gold/Silver is `$10` |
| **MBC2** | `$05–$06` | **Nice to have** | 512 × 4-bit RAM on-chip; few commercial titles |
| MBC3 RTC | `$10`, `$0F` | Stub OK for now | Full RTC in [ToDo.md](../ToDo.md); Gold/Silver day/night needs it |
| MBC5 rumble | `$1C–$1E` | Stub OK | Host rumble feedback in [ToDo.md](../ToDo.md) |
| HuC1/3, MMM01, MBC6/7, TAMA5 | various | Future ([ToDo.md](../ToDo.md)) | Rare; add when a specific ROM demands it |

Pan Docs has the full [cartridge type table](https://gbdev.io/pandocs/The_Cartridge_Header.html#0147---cartridge-type).

## Design — one factory, many chips

Keep the pattern from chapter 13: `createCart(rom)` parses the header, picks a constructor, returns `{ readRom, writeRom, readRam, writeRam, ram, state, mapperType }`.

Group type bytes instead of a long `if` chain:

```js
const MBC1_TYPES = new Set([0x01, 0x02, 0x03]);
const MBC2_TYPES = new Set([0x05, 0x06]);
const MBC3_TYPES = new Set([0x0f, 0x10, 0x11, 0x12, 0x13]);
const MBC5_TYPES = new Set([0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e]);

export function createCart(rom) {
  const header = parseHeader(rom);
  const t = header.type;

  if (t === 0x00) return createRomOnly(rom, header);
  if (MBC1_TYPES.has(t)) return createMbc1(rom, header);
  if (MBC2_TYPES.has(t)) return createMbc2(rom, header);
  if (MBC3_TYPES.has(t)) return createMbc3(rom, header);
  if (MBC5_TYPES.has(t)) return createMbc5(rom, header);

  throw new Error(`Mapper ${header.typeName} not implemented`);
}
```

Extend `CART_TYPES` in `parseHeader` as you add families so error messages stay readable.

Every mapper should expose **`cart.state`** (for [chapter 16](16-save-states.md) GBSS) and **`cart.ram`** when battery RAM exists — even if `ram.length === 0`.

---

## MBC5

Reference: [Pan Docs — MBC5](https://gbdev.io/pandocs/MBC5.html), [docs/reference/mbc.md](../docs/reference/mbc.md).

MBC5 is the “big ROM” mapper. Think of it as MBC3 with an extra address bit and **without** the bank-0 quirk.

### State

```js
{
  ramEnable: false,
  romBankLow: 0,   // 8 bits from $2000–$2FFF
  romBankHigh: 0,  // 1 bit from $3000–$3FFF  → 9-bit bank index total
  ramBank: 0,      // 4 bits from $4000–$5FFF
  // rumbleOn: false  // optional, types $1C–$1E only
}
```

### Registers (write to `$0000–$7FFF`)

| Address | Action |
| --- | --- |
| `$0000–$1FFF` | RAM enable: `(value & 0x0f) === 0x0a` |
| `$2000–$2FFF` | `romBankLow = value` (all 8 bits) |
| `$3000–$3FFF` | `romBankHigh = value & 0x01` |
| `$4000–$5FFF` | `ramBank = value & 0x0f` |
| `$6000–$7FFF` | Rumble (if cart has it): `(value & 0x08) !== 0` — stub is fine |

### Reads

```js
function romBankIndex(state, romBanks) {
  const bank = (state.romBankHigh << 8) | state.romBankLow;
  return bank & (romBanks - 1); // romBanks is power of two from header
}

readRom(addr) {
  if (addr < 0x4000) return rom[addr];           // always bank 0
  const b = romBankIndex(state, romBanks);
  return rom[b * 0x4000 + (addr - 0x4000)];      // bank 0 IS valid here
}
```

**Pitfall:** applying MBC3’s `(v & 0x7f) || 1` to MBC5. Games *do* map bank 0 into `$4000–$7FFF` on MBC5.

**Pitfall:** using `$2000–$3FFF` for the low bank byte. MBC5 splits low (`$2000–$2FFF`) and high (`$3000–$3FFF`). Mooneye and several commercial ROMs write both.

SRAM at `$A000–$BFFF` matches MBC3: 8 KiB per `ramBank`, gated by `ramEnable`. Persist battery types (`$1B`, `$1E`) with the same `loadSram` / `saveSram` from chapter 14.

### Suggested test ROM

Any small MBC5 homebrew, or Mooneye `acceptance/oam_dma/sources-GS.gb` — goal for this chapter is **load + bank switch**, not passing the full DMA timing test ([appendix 99](99-mooneye-polish.md)).

---

## MBC3 family routing

You already implemented MBC3 for Pokémon (`$13`). The same chip answers for:

| Code | Type |
| --- | --- |
| `$0F` | MBC3 + TIMER + BATTERY (no RAM) |
| `$10` | MBC3 + TIMER + RAM + BATTERY (Gold/Silver) |
| `$11` | MBC3 |
| `$12` | MBC3 + RAM |
| `$13` | MBC3 + RAM + BATTERY |

Wire **all five** to `createMbc3`. Behavior differences are header RAM size and whether the game touches RTC registers (`ramBank` `$08–$0C`).

For `$10` / `$0F`, keep the chapter 14 RTC stub (reads return 0, latch ignored) until the RTC chapter ([ToDo.md](../ToDo.md)). Gold/Silver’s day/night cycle needs RTC; Red/Blue does not.

**Pitfall:** only accepting `$13` in `createCart` while testing a `$10` ROM — the fix is routing, not new banking logic.

---

## MBC2

Reference: [Pan Docs — MBC2](https://gbdev.io/pandocs/MBC2.html).

MBC2 is odd: **512 × 4-bit** RAM built into the mapper (not a separate SRAM chip). Only `$A000–$A1FF` is valid; reads return `$F0 | nibble`.

### State

```js
{ ramEnable: false, romBank: 1 }  // romBank is 4 bits; 0 means 1 in $4000–$7FFF
```

### Registers

| Address | Action |
| --- | --- |
| `$0000–$1FFF`, **A8 = 0** (`addr & 0x100 === 0`) | RAM enable: `(value & 0x0f) === 0x0a` |
| `$0000–$1FFF`, **A8 = 1** (`addr & 0x100 !== 0`) | `romBank = (value & 0x0f) \|\| 1` |
| `$2000–$3FFF` | `romBank = (value & 0x0f) \|\| 1` |
| `$4000–$7FFF` | (no effect on MBC2) |

**A8** is address bit 8 — the same bit that distinguishes `$0100` from `$0000`. MBC2 uses it inside `$0000–$1FFF` to pick RAM enable vs ROM bank; do not treat the whole range as RAM enable only.

### RAM

Allocate 512 bytes (store only the low nibble; OR `$F0` on read):

```js
readRam(addr) {
  if (!ramEnable || addr >= 0xa200) return 0xff;
  return 0xf0 | (ram[addr - 0xa000] & 0x0f);
}
writeRam(addr, v) {
  if (!ramEnable || addr >= 0xa200) return;
  ram[addr - 0xa000] = v & 0x0f;
}
```

`$0000–$3FFF` always maps ROM bank 0 (like MBC3). `$4000–$7FFF` uses `romBank` (4 bits, 0 → 1).

Type `$06` has battery; persist the 512-byte array like SRAM if you care about saves.

---

## Save states (chapter 16 hook-up)

GBSS already reserves cart fields for `ramEnable`, ROM bank (16-bit), `ramBank`, MBC1 `mode`, and MBC5 `romBankHigh`. After adding MBC5/MBC2:

1. Keep **`cart.state`** as the single source of truth (no closure-only locals).
2. For MBC5, serialize `(romBankHigh << 8) | romBankLow` into the 16-bit ROM bank slot — `savestate.js` already falls back to `romBankLow`.
3. For MBC2, the 16-bit slot can hold the 4-bit `romBank`; no `romBankHigh`.
4. Include **`cart.ram`** bytes in the blob for any mapper with RAM (MBC2’s 512 bytes count).

Bump `GBSS_VERSION` only if you change the on-disk layout; new mappers using the existing cart block do not require a bump.

---

## Implementation order

1. **MBC5** — unblocks Mooneye and the most retail ROMs.
2. **MBC3 routing** — one-line factory change; test with a `$10` header if you have Gold/Silver.
3. **MBC2** — self-contained; good practice for address-bit decode.
4. **Rumble stub** — optional `state.rumbleOn` on `$6000–$7FFF` for `$1C–$1E`.
5. **RTC** — [ToDo.md](../ToDo.md); Gold/Silver day/night cycle.

## Files to touch

```
src/cart.js              createMbc5, createMbc2, factory sets, CART_TYPES
test/ch17-checkpoint.test.js   synthetic ROMs per mapper
docs/reference/mbc.md      MBC5 + MBC2 register tables (lookup while coding)
```

Regression: `bun test test/ch13-checkpoint.test.js`, `bun test test/ch16-checkpoint.test.js`.

## Pitfalls

- **MBC3 bank-0 rule on MBC5** — breaks banking silently; instructions jump into the header.
- **MBC5 low/high split** — using the MBC1 `$2000–$3FFF` window for both bytes.
- **MBC2 `$0000–$1FFF`** — ignoring address bit 8; RAM enable and ROM bank share the range.
- **MBC2 read mask** — forgetting `0xF0` on read; games expect the upper nibble to be ones.
- **SRAM size** — trust `header.ramKiB` from `$0149`; MBC5 `$1A` has no RAM even though the mapper supports it.
- **Throwing on unknown type** — Mooneye runs many ROMs in one process; one unimplemented mapper aborts the whole suite.

## Tests

Add `test/ch17-checkpoint.test.js`. Reuse the `makeRom` / `stampBankMarkers` pattern from `ch13-checkpoint.test.js`.

1. **MBC5 bank 0** — write `romBankLow = 0`, `romBankHigh = 0`, read `$4000` → bank 0 marker (not bank 1).
2. **MBC5 9-bit bank** — set low + high, read `$4000` → correct 16 KiB window.
3. **MBC5 RAM** — enable, switch `ramBank`, read/write `$A000`.
4. **MBC3 `$10` loads** — `createCart` does not throw; same banking as `$13`.
5. **MBC2 RAM enable** — write `$0A` to `$0000` (A8 clear), not `$0100`.
6. **MBC2 nibble RAM** — write `$05` at `$A000`, read back `$F5`.
7. **Regression** — MBC1 Mario Land + MBC3 + ROM ONLY still pass.

Run: `bun test test/ch17-checkpoint.test.js`.

Mooneye smoke (optional):

```bash
MOONEYE=1 bun test mooneye.test.js -t "oam_dma/sources"
```

Expect **load without throw**; full pass may still need appendix 99 timing fixes.

## Checkpoint

- `bun test test/ch17-checkpoint.test.js` passes.
- `createCart` accepts `$19–$1E`, `$0F–$13`, and `$05–$06`.
- Mooneye `oam_dma/sources-GS.gb` loads (no mapper throw).
- Tetris, Super Mario Land, Pokémon Red still work.
- Save-state round-trip on an MBC5 ROM restores ROM bank (switch bank, save, load, `read8($4000)` unchanged).

## Further reading

- [Pan Docs — MBC5](https://gbdev.io/pandocs/MBC5.html)
- [Pan Docs — MBC2](https://gbdev.io/pandocs/MBC2.html)
- [Pan Docs — Cartridge header](https://gbdev.io/pandocs/The_Cartridge_Header.html)
- [docs/reference/mbc.md](../docs/reference/mbc.md)
- [SameBoy MBC implementations](https://github.com/LIJI32/SameBoy/tree/master/Core) — readable reference when Pan Docs feels sparse

## Next

**Optional:** [99 — Mooneye polish](99-mooneye-polish.md) — cycle-accurate fixes (OAM DMA, `ei` timing, interrupt dispatch) now that mappers load.
