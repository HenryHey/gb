# 06 — Interrupts

## Goal

`IME`, `IE` (`$FFFF`), `IF` (`$FF0F`), interrupt service, `EI` delay, and `HALT` that **wakes**. You can force a VBlank and watch `PC` become `$0040`.

## Why

Games do not poll the LCD in a tight loop forever. They `EI` and `HALT` until VBlank (bit 0 of `IF`). Without interrupts, Tetris never advances a frame once it starts waiting. The timer (next chapter) and PPU (chapter 8) only matter because they **set bits in** `IF`.

## Hardware model

Interrupts are not a JS event emitter. They are three pieces of hardware plus five well-known addresses in bank 0:


| Piece   | Where          | Role                                                          |
| ------- | -------------- | ------------------------------------------------------------- |
| **IME** | inside the CPU | master switch. Off → never jump, even if something is pending |
| **IE**  | `$FFFF`        | which sources the *game* cares about                          |
| **IF**  | `$FF0F`        | which sources are *currently requesting*                      |


Five sources, low bit = highest priority:


| Bit | Name     | Vector  |
| --- | -------- | ------- |
| 0   | VBlank   | `$0040` |
| 1   | LCD STAT | `$0048` |
| 2   | Timer    | `$0050` |
| 3   | Serial   | `$0058` |
| 4   | Joypad   | `$0060` |


A peripheral (PPU, timer, joypad) can only **set a bit in** `IF`. It cannot jump. The CPU, after each instruction, looks at `IME && (IE & IF)`. If that is non-zero it:

1. Clears IME (so the handler is not re-entered immediately).
2. Clears the **lowest** set bit in `IF` (bit 0 = highest priority).
3. Pushes PC (the instruction that *would* have run next).
4. Jumps to `$0040 + 8 * bit`.

Those vectors sit in ROM bank 0 because that bank is always mapped. Games put a `JP handler` at `$0040`, `$0048`, … — five `JP`s is 15 bytes, which is why the vectors are 8 bytes apart.

A source wants service when `(IE & IF & (1 << k)) !== 0`. The CPU actually jumps only if `IME` **is 1**. If `IME` is 0, bits can still sit in `IF` (and `HALT` can still wake).

Unused bits of `IF` read as 1 (open-bus leftover). Store the lower 5 bits; on read return `ifReg | 0xe0`.

`EI` **delay:** `IME` turns on *after the following instruction*. Real silicon. The usual pair is `EI` then `HALT`: the `HALT` must execute with IME still 0, then IME rises, then the pending VBlank can wake and service. If you set IME inside `EI` itself, that pair desyncs (you fire, return, then HALT with IF already cleared — deadlock until the next frame’s bit, or worse). `DI` is immediate. `RETI` is “pop PC and IME = 1 *now*” — return-from-handler. You already stubbed `EI`/`DI`/`RETI` in chapter 4; this chapter wires the service path.

`HALT`**:** stop fetching to save power. Wake when `IE & IF !== 0`, *even if IME is 0*. If IME is 1, `serviceIfNeeded` then jumps to the vector. If IME is 0, execution continues at the next opcode so the game can `DI` around a critical section and still sleep. While halted you **must still tick PPU and timer** or IF never sets and you deadlock.

The HALT bug (`IME === 0` and something already pending when HALT runs: PC fails to increment) is optional. Tetris/Pokémon are fine without it. If a game misbehaves on HALT, revisit [cpu-quirks.md](../docs/reference/cpu-quirks.md).

## Design

```
src/interrupts.js   serviceIfNeeded, tickImeCountdown, handleHalt
src/io.js           IF read/write quirks, ifBits / ackIf / requestIf
src/emu.js          cpuStep wrapper; runN / runTCycles call cpuStep
src/ops/index.js    step(cpu, ops, cbOps) stays fetch/decode/execute — do not rename
src/ops/call.js     RETI already exists — verify, do not rewrite
test/ch06-checkpoint.test.js
```

Chapter 2’s `step(cpu, ops, cbOps)` is still one opcode. Wrap it:

```js
import { step, ops, cbOps } from './ops/index.js';
import { handleHalt, serviceIfNeeded, tickImeCountdown } from './interrupts.js';

export function cpuStep(emu) {
  const { cpu } = emu;
  const t = cpu.halted ? handleHalt(emu) : step(cpu, ops, cbOps);
  tickImeCountdown(cpu);
  const extra = serviceIfNeeded(emu);
  return t + extra;
}
```

Check interrupts **once per instruction**, in this order: execute (or halt spin) → `tickImeCountdown` → `serviceIfNeeded`. `serviceIfNeeded` runs even if the instruction was `EI` — but IME might still be 0 because of the delay. That is the whole point of the countdown.

Update `runN` / `runTCycles` in `emu.js` to call `cpuStep(emu)` instead of `step(cpu, ops, cbOps)`. Chapter 7’s timer will consume the T-cycle budget `cpuStep` returns.

### Implementation checklist

1. `io.js` **— IF on the bus** — special-case `$FF0F`; add helpers below.
2. `interrupts.js` — `tickImeCountdown`, `serviceIfNeeded`, `handleHalt`.
3. `emu.js` — `cpuStep`, wire `runN` / `runTCycles`.
4. **Tests** — three checkpoint scenarios in `test/ch06-checkpoint.test.js`.
5. **Smoke** — load Tetris, reset, run; still no VBlank yet, but no throws.



### `EI` delay

```js
function tickImeCountdown(cpu) {
  if (cpu.imeEnableCountdown > 0) {
    cpu.imeEnableCountdown--;
    if (cpu.imeEnableCountdown === 0) cpu.ime = true;
  }
}

// EI handler (already in control.js):
cpu.imeEnableCountdown = 2; // this instruction will decrement to 1; next instruction to 0
return 4;

// DI handler:
cpu.ime = false;
cpu.imeEnableCountdown = 0;
return 4;
```

`RETI` in `call.js`: pop PC, `cpu.ime = true`, `cpu.imeEnableCountdown = 0` (16 T-cycles for the opcode; interrupt prologue is separate).

### Service

```js
export function serviceIfNeeded(emu) {
  const pending = emu.bus.ie & emu.io.ifBits() & 0x1f;
  if (!pending) return 0;

  emu.cpu.halted = false; // wake even if IME is 0

  if (!emu.cpu.ime) return 0;

  emu.cpu.ime = false;
  for (let bit = 0; bit < 5; bit++) {
    if (pending & (1 << bit)) {
      emu.io.ackIf(bit);          // clear that IF bit
      push16(emu.cpu, emu.cpu.pc);
      emu.cpu.pc = 0x0040 + 8 * bit;
      return 20;                  // 5 M-cycles, common convention
    }
  }
  return 0;
}
```

20 T-cycles for the interrupt prologue is what most instruction-level emus use. Add them to PPU/timer later.

Games acknowledge IF from software too (`IF &= ~bit` via a load). Your `write8($FF0F)` must allow that. Writing `IF` is **not** OR — it sets the writable bits to the value (with unused bits stuck 1).

Peripherals (timer, PPU, joypad) **set** bits via `requestIf`:

```js
requestIf(bit) { this.regs[0x0f] |= 1 << bit; }
```

Chapter 7 and 8 call `io.requestIf(2)` and `io.requestIf(0)` instead of touching `regs` directly.

### HALT

```js
function handleHalt(emu) {
  // Stay halted; still return a chunk of T-cycles so PPU/timer advance.
  // 4 T-cycles per "step" is fine.
  if ((emu.bus.ie & emu.io.ifBits() & 0x1f) !== 0) {
    emu.cpu.halted = false;
    // If IME, serviceIfNeeded will run after this and jump.
    // If !IME, execution continues at PC+1 (HALT already consumed).
  }
  return 4;
}
```

If you `HALT` and never tick peripherals, you deadlock: IF never sets, HALT never ends. Chapter 8’s PPU will set VBlank. For this chapter’s checkpoint you set IF yourself.

### IF / IE on the bus

```js
// io.js
ifBits() { return this.regs[0x0f] & 0x1f; }
ackIf(bit) { this.regs[0x0f] &= ~(1 << bit); }
requestIf(bit) { this.regs[0x0f] |= 1 << bit; }
read(addr) {
  if (addr === 0xff0f) return this.regs[0x0f] | 0xe0;
  …
}
write(addr, v) {
  if (addr === 0xff0f) { this.regs[0x0f] = (v & 0x1f) | 0xe0; return; }
  …
}
```

IE is already on the bus at `$FFFF`. Mask writes `& 0x1f` or keep the whole byte; only bits 4–0 matter.

## What you should see with Tetris

After skip-boot, Tetris still sets up the LCD and eventually `HALT`s waiting for VBlank. Nothing sets IF bit 0 yet — no PPU — so the game **freezes with PC parked on** `HALT` **or spinning on** `LY`. That is expected.

What is **not** expected:

- `unimplemented xx at aaaa`
- Taking an interrupt before handlers exist (`IME = 1` at reset)
- `HALT` with `IE & IF !== 0` and `IME = 0` that never wakes

Once you can manually set IF and see `PC → $0040`, the interrupt path is wired. Timer (chapter 7) and PPU VBlank (chapter 8) will set IF for real.

## Pitfalls

- Servicing interrupts **before** `EI`’s following instruction. `EI; HALT` is a standard pair: if IME turns on too soon, you can fire, return, and HALT with IME on but IF already cleared — or the opposite desync. Use the countdown.
- Assuming the VBlank handler **must** run during LY 144–153. IF is **requested** at LY=144; **service** happens on the first enabled instruction after that. Long init with `DI` can defer it to LY=0 — Tetris does this routinely. See [09 — Background](09-background.md#tetris-and-other-rabbit-holes-read-this-before-debugging).
- Clearing **all** of IF when servicing one source.
- Not waking HALT when `IME === 0` but `IE & IF !== 0`. The CPU must continue so the game can `DI`/`EI` around critical sections.
- Pushing the wrong PC (already incremented vs not). Push the PC of the **next** instruction that would have run — which is the current `cpu.pc` after the last execute.
- Forgetting the 20 T-cycle cost → later, one frame’s worth of LCD will drift.
- Replacing `step(cpu, ops, cbOps)` with a new signature — breaks every test and opcode table. Add `cpuStep(emu)` as the outer wrapper.



## Checkpoint

Put these in `test/ch06-checkpoint.test.js` (or run in the debugger):

1. `IE = 0x01`, `IF = 0x01`, `IME = 1`, `PC = $150` (anything not a vector).
2. `cpuStep(emu)` once (a `NOP` at `$150` if you planted one).
3. Expect `PC === 0x0040`, `IME === false`, IF bit 0 **clear**, SP decreased by 2, stacked PC readable.

Second test: `IME = 0`, same IE/IF, `HALT`. After some halt-steps via `cpuStep`, `halted === false` and `PC` is the instruction after HALT, **not** `$0040`.

Third: `EI` then `NOP` then observe `IME === true` only **after** the `NOP`.

Tetris may still freeze: nothing sets IF bit 0 yet. One more chapter (timer) plus PPU VBlank will unstick it.

## Further reading

- [Pan Docs — Interrupts](https://gbdev.io/pandocs/Interrupts.html)
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) (`EI`, `HALT`)
- [docs/reference/io-registers.md](../docs/reference/io-registers.md) (`IF`, `IE`)
- Nazar part 8 (concept; his IME is too simple)



## Next

[07 — Timer](07-timer.md)