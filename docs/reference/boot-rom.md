# Boot ROM (256-byte overlay)

At power-on the DMG CPU starts at `$0000`. A **256-byte boot ROM** baked into the console silicon overlays `$0000–$00FF` on top of the cartridge. When it finishes, it writes `$01` to `$FF50`, the overlay vanishes, and execution continues from cart `$0100`.

Pan Docs: [Power-Up Sequence](https://gbdev.io/pandocs/Power_Up_Sequence.html), [Bootstrap ROM](https://gbdev.io/pandocs/Power_Up_Sequence.html#bootstrap-rom). Walkthrough for writing your own: [course chapter 18](../../course/18-custom-boot-rom.md). Post-boot register values (skip-boot shortcut): [`skip-boot.md`](skip-boot.md).

## What the retail boot ROM does

1. `LD SP, $FFFE`
2. Clear VRAM (`$8000–$9FFF`)
3. Initialise audio (NR10–NR52) and play the startup chime
4. Read the **48-byte Nintendo logo** from cart `$0104–$0133`, expand it into tiles, scroll it on screen
5. Compare those same header bytes against a **reference copy** in the boot ROM — mismatch → infinite loop (anti-piracy)
6. Write `$01` to `$FF50` (unmap boot ROM)
7. Fall through to cart entry at `$0100` with the register file documented in [`skip-boot.md`](skip-boot.md)

If no cartridge is inserted, header reads are `$FF`, the logo renders as a black bar, checksum fails, and the console hangs.

## Emulator integration

| Phase | Bus `$0000–$00FF` | `PC` on reset | Notes |
| --- | --- | --- | --- |
| **Skip-boot** (ch. 05) | Cartridge | `$0100` | Apply post-boot state manually |
| **Boot ROM run** (ch. 18) | Boot ROM overlay | `$0000` | Needs PPU, timer, APU stub |

```js
// bus read — simplified
if (addr < 0x0100 && bootRomEnabled) return bootRom[addr];
if (addr < 0x8000) return cart.readRom(addr);
```

```js
// I/O write — $FF50 unmaps overlay
if (addr === 0xff50 && value !== 0) bootRomEnabled = false;
```

The disable sequence is always the last four bytes of the ROM:

```
$FC: 3E 01       LD A, $01
$FE: E0 50       LDH ($FF50), A
```

After `LDH ($FF50), A` completes, the **next** instruction fetch is from cart `$0100` (the boot ROM is already gone).

Requires a working **PPU** (VRAM, LCDC, BGP), **timer** (DIV advances during the delay), and at least an **APU register stub** (games like *Prehistorik Man* assume NR50/NR51 were written during boot).

## Custom boot ROM vs retail dump

| Approach | Pros | Cons |
| --- | --- | --- |
| **Skip-boot** | Trivial, no extra bytes | No logo animation; you must seed every post-boot register |
| **Retail dump** | Authentic scroll + chime | Copyrighted; do not redistribute with your emulator |
| **Custom generator** | Legal, shows *something* on boot, teaches the constraint | No logo checksum against cart header; ~8 chars of text max in 256 bytes |

Max Bonnefin's [256 Bytes to Boot](https://bonnef.in/posts/custom-boot-rom/) walks through a **custom generator**: embed a small font as 2bpp tiles, centre text on the tilemap, delay, then disable. The course chapter adapts that idea to JavaScript.

## 256-byte layout (custom text ROM)

Typical sections (sizes vary with message length):

| Address | Contents |
| --- | --- |
| `$00–$02` | `LD SP, $FFFE` |
| `$03–$0B` | VRAM clear loop |
| `$0C–$1B` | Audio init (keep NR50=`$77`, NR51=`$F3` for compatibility) |
| `$27–$37` | Tile copy loop (ROM → VRAM `$8000`) |
| `$38+` | Tile data (16 bytes/tile; blank tile at index 0) |
| … | Tilemap writes to `$9800` |
| … | LCD on (`BGP=$FC`, `LCDC=$91`) |
| … | Delay loop |
| … | `JP $00FC` |
| `$FC–$FF` | Boot disable (`LD A,$01` / `LDH ($FF50),A`) |

**Hard rule:** bytes `$FC–$FF` are reserved for the disable sequence. Everything else must fit below `$FC`.

## Tile encoding reminder

Each 8×8 tile is **16 bytes** (2 bpp). For each row, a low byte and high byte; bit 0 from low, bit 1 from high → colour 0–3. Font glyphs that use only colours 0 (white) and 3 (black) have **identical** low and high bytes per row.

## Testing

- Reset with boot ROM enabled: `PC` starts at `$0000`, not `$0100`.
- After ~400 ms (delay loop) or one frame, `$FF50` is written and `PC` reaches cart `$0100`.
- Post-boot registers match [`skip-boot.md`](skip-boot.md) (especially `A=$01`, `LCDC=$91`, `BGP=$FC`, `NR52=$F1`).
- Mooneye **boot ROM tests** under `test_carts/mooneye/acceptance/boot_*` need the **retail** ROM or a faithful reimplementation — a text-only custom ROM will not pass logo checksum tests.
