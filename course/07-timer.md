# 07 — Timer

## Goal

`DIV`, `TIMA`, `TMA`, `TAC` ticking from the same T-cycles as the CPU. Tetris can seed RNG from `DIV`. A small program with TAC enabled should increment `TIMA` and, on overflow, request a timer interrupt.

## Why

`DIV` (`$FF04`) is the upper 8 bits of a 16-bit counter that increments **every T-cycle**. Games read it as “a cheap random number.” Tetris does. The programmable timer (`TIMA`) is how some titles schedule work independently of VBlank. Pokémon uses both.

Nazar’s timer is a reasonable sketch and **wrong about DIV writes**. Read this chapter and Pan Docs, not his reset behaviour.

## One crystal, two software views

The same 4.194304 MHz clock that drives the CPU also drives a 16-bit counter on the motherboard. There is no separate “timer chip clock.” That is why this chapter ticks from the T-cycle budget `cpuStep()` already returns.

```
every T-cycle:  divCounter = (divCounter + 1) & 0xffff
DIV  ($FF04)  = divCounter >> 8     “how many times have 256 T-cycles passed?”
TIMA ($FF05)  increments when a *chosen bit* of divCounter falls 1→0
TMA  ($FF06)  value TIMA reloads on overflow
TAC  ($FF07)  bit 2 = on/off; bits 1–0 = which bit of divCounter
```

**Why falling edges, not “add N and divide”?** Because writes to `DIV` *reset* `divCounter` to 0, and changing TAC can coincide with a bit already high. The edge model gets those interactions right. The period table (1024 / 16 / 64 / 256 T-cycles) is the same frequencies with less accuracy on those edges — sufficient for most games if **any write to** `$FF04` **zeros** `divCounter`.

`DIV` looks read-only to games: they `LDH A,($FF04)` to seed RNG. A write is a reset, not a store. That surprise is the number-one timer bug.

`TIMA` overflowing (`$FF → $00`) raises IF bit 2 and reloads from `TMA`. If `TMA` is 0, TIMA sits at 0 afterward — valid — but IF still fires **once per wrap**. Hardware delays the reload by 4 T-cycles; ignore that delay.

Skip-boot leaves DIV looking like `$AB` because the boot ROM ran for that long. Starting `divCounter` at `$AB00` is faking that elapsed time.

## Hardware model

Internally:

```
divCounter : 16-bit, +1 every T-cycle
DIV  = divCounter >> 8          ($FF04, read-only in practice; writes reset)
TIMA = $FF05                    increments when a selected edge fires
TMA  = $FF06                    reloaded into TIMA on overflow
TAC  = $FF07                    bit 2 = enable; bits 1–0 = clock
```

Clock select (when TAC enable is 1), TIMA increments when this **bit of** `divCounter` **has a falling edge**:


| TAC 1–0 | Hz     | Bit of `divCounter` |
| ------- | ------ | ------------------- |
| 00      | 4096   | 9                   |
| 01      | 262144 | 3                   |
| 10      | 65536  | 5                   |
| 11      | 16384  | 7                   |


Instruction-level version that is good enough: count T-cycles in a remainder and increment TIMA every `period` T-cycles:


| TAC 1–0 | Period (T-cycles per TIMA tick) |
| ------- | ------------------------------- |
| 00      | 1024                            |
| 01      | 16                              |
| 10      | 64                              |
| 11      | 256                             |


DIV still comes from `divCounter >> 8`. The bit-edge version is more accurate (TAC changes and DIV resets interact). The period version works for most games if **any write to** `$FF04` **sets** `divCounter = 0` (and you reset the TIMA remainder).

```js
const PERIOD = [1024, 16, 64, 256];

export function timerStep(io, tCycles) {
  for (let i = 0; i < tCycles; i++) {
    io.divCounter = (io.divCounter + 1) & 0xffff;
    if (!(io.tac & 0x04)) continue;
    const bit = [9, 3, 5, 7][io.tac & 3];
    const oldBit = (io.divCounter - 1) & (1 << bit);
    const newBit = io.divCounter & (1 << bit);
    if (oldBit && !newBit) incrementTima(io);
  }
}

function incrementTima(io) {
  io.tima = (io.tima + 1) & 0xff;
  if (io.tima === 0) {
    io.tima = io.tma;
    io.requestIf(2); // timer interrupt
  }
}
```

Looping T-cycles one-by-one is simple and cheap at 4 MHz / 60 fps in JS. You can also add `tCycles` to `divCounter` in one go and count how many falling edges occurred; do that later if a profiler complains.

**Overflow reload:** real hardware delays the TMA reload by 4 T-cycles and TIMA is 0 during that window. Ignore the delay. Instant `TIMA = TMA` is fine.

### MMIO

```js
read(addr) {
  if (addr === 0xff04) return (this.divCounter >> 8) & 0xff;
  if (addr === 0xff05) return this.tima;
  if (addr === 0xff06) return this.tma;
  if (addr === 0xff07) return this.tac | 0xf8;
}
write(addr, v) {
  if (addr === 0xff04) { this.divCounter = 0; return; }
  if (addr === 0xff05) { this.tima = v; return; }
  if (addr === 0xff06) { this.tma = v; return; }
  if (addr === 0xff07) { this.tac = v; return; }
}
```

Skip-boot: `divCounter` such that DIV reads `$AB` (`divCounter = 0xab00` is a decent start), `TIMA=0`, `TMA=0`, `TAC=$F8`.

### Wiring

After each CPU instruction (and during HALT spin):

```js
const t = cpuStep(emu);
timerStep(emu.io, t);
ppuStep(emu.ppu, t); // next chapter
```

**Files:** `src/timer.js` (`timerStep`), `src/io.js` (MMIO for `$FF04`–`$FF07`), `src/emu.js` (`tickEmu` calls `timerStep` alongside PPU).

## Pitfalls

- Incrementing DIV every instruction instead of every 256 T-cycles. `NOP` would then bump DIV too fast.
- `write DIV` incrementing or ignoring; it **resets**.
- TIMA incrementing while TAC enable is 0.
- Using M-cycles for the period table (off by 4).
- Not setting IF bit 2 on overflow. Pokémon’s IRQ handlers care; Tetris mostly reads DIV.
- Overflow to 0 without reloading TMA — the timer dies at 0 forever if TMA is 0, which is valid, but then IF must still fire **once per wrap**.



## Checkpoint

Put these in `test/ch07-checkpoint.test.js` (or run in the debugger):

**DIV moves**

Skip-boot, run 256 T-cycles of `NOP`. DIV should increase by 1 (approximately; 256 NOPs are 1024 T-cycles → DIV +4). Easier: run 70224 T-cycles; DIV should not still be `$AB`.

**TIMA program** (plant in WRAM or a tiny ROM):

```
3E 05     LD A, 5
E0 06     LDH (TMA), A
3E 00
E0 05     LDH (TIMA), A
3E 04     LD A, %00000100  ; enable, 4096 Hz
E0 07     LDH (TAC), A
76        HALT             ; wait for timer IF — needs IE bit 2 and IME
```

Simpler assertion without interrupts: enable TAC at 262144 Hz (`TAC = 0x05`), step 160 T-cycles, expect TIMA ≈ 10. Tune with the period table.

**Tetris:** after many frames of CPU+timer (still no PPU), `DIV` is noisy. When PPU VBlank exists, pieces will appear random rather than always the same sequence. If every game of Tetris starts with the same pieces later, DIV is stuck.

## Further reading

- [Pan Docs — Timer and Divider](https://gbdev.io/pandocs/Timer_and_Divider_Registers.html)
- [docs/reference/io-registers.md](../docs/reference/io-registers.md)
- Nazar part 10 (read, then ignore his DIV write)



## Next

[08 — PPU timing](08-ppu-timing.md)