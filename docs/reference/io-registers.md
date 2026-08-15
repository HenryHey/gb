# DMG I/O registers used by this course

All addresses are in `$FF00–$FF7F` plus `IE` at `$FFFF`. Bits marked unused often read as 1. If you have not implemented a register yet, **read `$FF`** and ignore writes — returning `0` is a common hang.

Pan Docs: [Hardware Registers](https://gbdev.io/pandocs/Hardware_Reg_List.html).

## Implement for playable Tetris / Pokémon

| Addr | Name | Chapter | Role |
| --- | --- | --- | --- |
| `$FF00` | P1 / JOYP | 12 | Button matrix (active-low) |
| `$FF04` | DIV | 7 | Divider; any write resets |
| `$FF05` | TIMA | 7 | Timer counter |
| `$FF06` | TMA | 7 | Timer reload |
| `$FF07` | TAC | 7 | Timer control (bits 2–0) |
| `$FF0F` | IF | 6 | Interrupt flags (bits 4–0) |
| `$FF10–$FF3F` | APU | 15 | Stub: store bytes, NR52 bit 7 |
| `$FF40` | LCDC | 8–11 | LCD on, BG/window/obj enable, maps, tile data |
| `$FF41` | STAT | 8 | Mode 0–2, LYC=LY, STAT interrupt sources |
| `$FF42` | SCY | 9 | BG scroll Y |
| `$FF43` | SCX | 9 | BG scroll X |
| `$FF44` | LY | 8 | Current scanline (0–153); writes ignored (or reset LY — ignore is fine) |
| `$FF45` | LYC | 8 | LY compare |
| `$FF46` | DMA | 11 | OAM DMA source page |
| `$FF47` | BGP | 10 | BG palette |
| `$FF48` | OBP0 | 11 | OBJ palette 0 |
| `$FF49` | OBP1 | 11 | OBJ palette 1 |
| `$FF4A` | WY | 10 | Window Y |
| `$FF4B` | WX | 10 | Window X + 7 |
| `$FF50` | BANK | 5 | Boot ROM unmap (skip-boot: already unmapped) |
| `$FFFF` | IE | 6 | Interrupt enable (bits 4–0) |

## Stub for the whole course

| Addr | Name | Stub |
| --- | --- | --- |
| `$FF01` | SB | Store; serial never completes |
| `$FF02` | SC | Store; ignore transfer start |
| `$FF03`, `$FF08–$FF0E`, unused holes | — | Read `$FF` |
| `$FF4C–$FF4F`, `$FF51–$FF7F` | CGB | Read `$FF` (DMG) |

## Bit layouts you will type often

### LCDC (`$FF40`)

| Bit | Meaning |
| --- | --- |
| 7 | LCD enable |
| 6 | Window tile map: 0 = `$9800`, 1 = `$9C00` |
| 5 | Window enable |
| 4 | BG/window tile data: 0 = `$8800` signed, 1 = `$8000` unsigned |
| 3 | BG tile map: 0 = `$9800`, 1 = `$9C00` |
| 2 | OBJ size: 0 = 8×8, 1 = 8×16 |
| 1 | OBJ enable |
| 0 | BG and window enable (DMG) |

If bit 7 is 0: LCD is off, LY stays 0, STAT mode is 0, screen is white. Do not run the PPU mode machine while the LCD is off (or reset it when turning on).

### STAT (`$FF41`)

| Bit | Meaning |
| --- | --- |
| 7 | Unused (read 1) |
| 6 | LYC=LY interrupt enable |
| 5 | Mode 2 (OAM) interrupt enable |
| 4 | Mode 1 (VBlank) interrupt enable |
| 3 | Mode 0 (HBlank) interrupt enable |
| 2 | LYC=LY flag (read-only) |
| 1–0 | Mode (read-only): 0 HBlank, 1 VBlank, 2 OAM scan, 3 drawing |

Writes to bits 2–0 are ignored. Mode 1 STAT interrupt is **in addition to** the dedicated VBlank interrupt at `$0040`.

### TAC (`$FF07`)

| Bit | Meaning |
| --- | --- |
| 2 | Enable |
| 1–0 | Clock select: 00 = 4096 Hz, 01 = 262144 Hz, 10 = 65536 Hz, 11 = 16384 Hz |

Unused bits 7–3 often read as 1 (`$F8` after boot with enable clear).

### IF / IE bits

| Bit | Source | Vector |
| --- | --- | --- |
| 0 | VBlank | `$0040` |
| 1 | STAT | `$0048` |
| 2 | Timer | `$0050` |
| 3 | Serial | `$0058` |
| 4 | Joypad | `$0060` |

Upper bits of IF read as 1 (`$E1` after boot with only VBlank leftover from the boot ROM).

### JOYP (`$FF00`)

Write bits 5–4 to select a row; read bits 3–0 as buttons (0 = pressed):

| Bit | Select buttons (bit 5 = 0) | Select d-pad (bit 4 = 0) |
| --- | --- | --- |
| 3 | Start | Down |
| 2 | Select | Up |
| 1 | B | Left |
| 0 | A | Right |

Bits 7–6 read 1. If both rows are selected, OR the two nibbles (both pressed). If neither is selected, buttons read 1.

## After skip-boot (DMG)

See [`skip-boot.md`](skip-boot.md) for the full table. The values games actually depend on: `LCDC=$91`, `BGP=$FC`, `IE=$00`, `IF=$E1`, `P1=$CF`, `DIV` whatever, `LY=0`.
