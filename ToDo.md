# Future chapters

Features not yet covered in the course. Each line is a candidate for a new chapter.

- **Complete APU** — frame sequencer, pulse/wave/noise channels, mixing
- **Pixel FIFO PPU** — variable mode-3 length, mid-line effects
- **Cycle-accurate memory timing** — per-access T-cycles (Blargg `mem_timing`)
- **HALT bug** — PC fails to advance when `IME=0` and `IE & IF ≠ 0`
- **OAM corruption bug** — DMG sprite-table corruption during inc/dec (Blargg `oam_bug`)
- **STAT IRQ blocking** — mode/stat interrupts blocked during certain PPU states
- **Timed OAM DMA** — 160 M-cycle transfer with startup delay and OAM lock
- **DMA bus conflicts** — external-bus reads during DMA (`sources-GS`, CPU vs DMA)
- **Boot ROM** — 256-byte overlay, `$FF50` unmap, logo scroll
- **MBC3 RTC** — real-time clock for Gold/Silver day/night
- **MBC5 rumble** — rumble motor register stub → host feedback
- **Exotic mappers** — HuC1/3, MMM01, MBC6/7, TAMA5
- **Game Boy Camera / MBC7** — camera ROM and accelerometer
- **Game Boy Color** — double speed, VRAM banks, palettes
- **Super Game Boy** — SNES-side border and palettes
- **Serial link** — two-emulator link cable
- **WASM / Worker** — off-main-thread core for performance
