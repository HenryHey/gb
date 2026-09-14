# Skip-boot (DMG)

The real CPU starts at `$0000` with a 256-byte **boot ROM** overlaying the cartridge. It draws the Nintendo logo, beeps, checksums the header, then writes `$FF50` and falls into the game at `$0100`.

This course **skips** that program by default. You map the cartridge from `$0000`, set registers as if the boot ROM had just finished, and begin at `$0100`. To run a real boot program instead — including a **custom** 256-byte ROM you generate yourself — see [course chapter 18](../../course/18-custom-boot-rom.md) and [`boot-rom.md`](boot-rom.md). The retail Nintendo logo ROM is optional (copyrighted dump); Mooneye boot tests need that path.

Pan Docs: [Power-Up Sequence](https://gbdev.io/pandocs/Power_Up_Sequence.html). Values below are **DMG** (original Game Boy), recorded at `PC = $0100`.

## CPU registers

| Register | Value | Notes |
| --- | --- | --- |
| A | `$01` | Identifies DMG to games that check `A` |
| F | `$B0` | Z=1, N=0, H=1, C=1 — **if** the header checksum byte is not `$00`. If it *is* `$00`, H and C are clear (`F = $80`) |
| B | `$00` | |
| C | `$13` | |
| D | `$00` | |
| E | `$D8` | |
| H | `$01` | |
| L | `$4D` | |
| PC | `$0100` | |
| SP | `$FFFE` | |
| IME | `0` | Boot ROM leaves interrupts disabled |

Most commercial ROMs have a non-zero header checksum, so `F = $B0` is the usual choice. Computing it from the header is nicer:

```js
// header checksum is byte $014D; H and C match “checksum was nonzero”
const checksum = rom[0x14d];
cpu.f = checksum === 0 ? 0x80 : 0xb0;
```

WRAM, HRAM, VRAM, and OAM are **uninitialized** on hardware (random). Filling them with `0` is fine. Do not rely on zeros in a game you write; games you emulate will initialize what they use.

## Hardware registers (DMG)

| Name | Addr | Value |
| --- | --- | --- |
| P1 | `$FF00` | `$CF` |
| SB | `$FF01` | `$00` |
| SC | `$FF02` | `$7E` |
| DIV | `$FF04` | `$AB` |
| TIMA | `$FF05` | `$00` |
| TMA | `$FF06` | `$00` |
| TAC | `$FF07` | `$F8` |
| IF | `$FF0F` | `$E1` |
| NR10–NR52 | `$FF10–$FF26` | see Pan Docs; at least `NR52 = $F1` |
| Wave RAM | `$FF30–$FF3F` | boot ROM fills a known pattern; zeros work for a stub |
| LCDC | `$FF40` | `$91` LCD on, BG on, `$8000` addressing, map `$9800` |
| STAT | `$FF41` | `$85` |
| SCY/SCX | `$FF42/$FF43` | `$00` |
| LY | `$FF44` | `$00` |
| LYC | `$FF45` | `$00` |
| DMA | `$FF46` | `$FF` |
| BGP | `$FF47` | `$FC` |
| OBP0 / OBP1 | `$FF48/$FF49` | uninitialized; `$FF` or `$00` until the game writes them |
| WY / WX | `$FF4A/$FF4B` | `$00` |
| IE | `$FFFF` | `$00` |

`$FF50` (boot ROM bank) should look **already written** — boot ROM unmapped. Reads can return `$FF`.

## Minimum viable skip-boot

If you only set these, most DMG games still start:

```js
cpu.a = 0x01;
cpu.f = 0xb0;
cpu.b = 0x00; cpu.c = 0x13;
cpu.d = 0x00; cpu.e = 0xd8;
cpu.h = 0x01; cpu.l = 0x4d;
cpu.sp = 0xfffe;
cpu.pc = 0x0100;
cpu.ime = false;

io.lcdc = 0x91;
io.bgp  = 0xfc;
io.if   = 0xe1;
io.ie   = 0x00;
io.stat = 0x85;
```

Then implement the rest of I/O as you reach each chapter.

## Optional: run a boot ROM

1. Load 256 bytes at `$0000`, overlaying the cart.
2. Start `PC = 0`, registers zeroed.
3. On write to `$FF50` with a nonzero value, unmap the overlay. The instruction at `$00FE` is `LDH ($FF50), A`; the next fetch is from cart `$0100`.

Needs a working PPU, timer, and APU stub. Full walkthrough: [chapter 18](../../course/18-custom-boot-rom.md). Reference: [`boot-rom.md`](boot-rom.md). External guide: [256 Bytes to Boot](https://bonnef.in/posts/custom-boot-rom/).
