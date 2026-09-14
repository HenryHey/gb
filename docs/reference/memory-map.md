# Memory map (DMG)

The CPU has a 16-bit address bus: `$0000–$FFFF`. There is no MMU in the console sense — cartridges and peripherals **decode the address**. Your emulator’s `read8` / `write8` *is* that decode.

```
0000-3FFF  16 KiB ROM bank 0          cartridge (fixed)
4000-7FFF  16 KiB ROM bank N          cartridge (mapper)
8000-9FFF   8 KiB VRAM                PPU
A000-BFFF   8 KiB external RAM        cartridge SRAM (if any)
C000-CFFF   4 KiB WRAM bank 0
D000-DFFF   4 KiB WRAM bank 1         (fixed on DMG; banked on CGB)
E000-FDFF  Echo RAM                   mirror of C000-DDFF
FE00-FE9F  OAM                        40 sprites × 4 bytes
FEA0-FEFF  Unusable                   Nintendo-prohibited; read $FF for this course
FF00-FF7F  I/O registers              see io-registers.md
FF80-FFFE  HRAM                       127 bytes, always CPU-accessible
FFFF       IE                         interrupt enable
```

## Which chapter owns which region

| Region | First appears | Notes |
| --- | --- | --- |
| `0000-7FFF` ROM | [ch. 01](../../course/01-project-shell.md) parse header; [ch. 05](../../course/05-memory-and-skip-boot.md) execute | Mapper in [ch. 13](../../course/13-mbc1.md)–[14](../../course/14-mbc3-and-saves.md); boot ROM overlay `$0000–$00FF` in [ch. 18](../../course/18-custom-boot-rom.md) |
| `8000-9FFF` VRAM | [ch. 09](../../course/09-background.md) | CPU can write anytime at this accuracy bar; real DMG blocks during mode 3 |
| `A000-BFFF` SRAM | [ch. 13](../../course/13-mbc1.md)–[14](../../course/14-mbc3-and-saves.md) | Gated by RAM enable |
| `C000-DFFF` WRAM | [ch. 05](../../course/05-memory-and-skip-boot.md) | 8 KiB on DMG |
| `E000-FDFF` Echo | [ch. 05](../../course/05-memory-and-skip-boot.md) | Mirror `addr - 0x2000` into WRAM |
| `FE00-FE9F` OAM | [ch. 11](../../course/11-sprites-and-dma.md) | DMA target |
| `FF00-FF7F` I/O | [ch. 05](../../course/05-memory-and-skip-boot.md) stubs, then per-chapter | |
| `FF80-FFFE` HRAM | [ch. 05](../../course/05-memory-and-skip-boot.md) | Stack often lives here (`SP = $FFFE` after boot) |
| `FFFF` IE | [ch. 06](../../course/06-interrupts.md) | |

## Implementation sketch

```js
read8(addr) {
  addr &= 0xffff;
  if (addr < 0x8000) return this.cart.readRom(addr);
  if (addr < 0xa000) return this.vram[addr - 0x8000];
  if (addr < 0xc000) return this.cart.readRam(addr);
  if (addr < 0xe000) return this.wram[addr - 0xc000];
  if (addr < 0xfe00) return this.wram[addr - 0xe000]; // echo
  if (addr < 0xfea0) return this.oam[addr - 0xfe00];
  if (addr < 0xff00) return 0xff;
  if (addr < 0xff80) return this.readIo(addr);
  if (addr < 0xffff) return this.hram[addr - 0xff80];
  return this.ie;
}
```

Writes follow the same ranges. **Writes to `0000–7FFF` never change ROM bytes** — they are mapper commands.

## Echo RAM

`E000–FDFF` is wired to the same RAM as `C000–DDFF`. Games almost never use it; some tests poke it. Mirror it. Do not give it its own array.

## Jump vectors (bank 0)

| Address | Use |
| --- | --- |
| `$0000`, `$0008`, … `$0038` | `RST` targets |
| `$0040` | VBlank ISR |
| `$0048` | STAT ISR |
| `$0050` | Timer ISR |
| `$0058` | Serial ISR |
| `$0060` | Joypad ISR |
| `$0100` | Cartridge entry after boot ROM unmaps |

## Cartridge header

`$0100–$014F` sits in ROM bank 0. Parse it in chapter 1; the CPU will execute through `$0100` from chapter 5 onward. See [Pan Docs — Cartridge Header](https://gbdev.io/pandocs/The_Cartridge_Header.html).
