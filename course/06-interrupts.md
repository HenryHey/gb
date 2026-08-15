# 06 — Interrupts

## Goal

`IME`, `IE` (`$FFFF`), `IF` (`$FF0F`), interrupt service, `EI` delay, and `HALT` that **wakes**. You can force a VBlank and watch `PC` become `$0040`.

## Why

Games do not poll the LCD in a tight loop forever. They `EI` and `HALT` until VBlank (bit 0 of `IF`). Without interrupts, Tetris never advances a frame once it starts waiting. The timer (next chapter) and PPU (chapter 8) only matter because they **set bits in `IF`**.

## Hardware model

Five sources, low bit = high priority:

| Bit | Name | Vector |
| --- | --- | --- |
| 0 | VBlank | `$0040` |
| 1 | LCD STAT | `$0048` |
| 2 | Timer | `$0050` |
| 3 | Serial | `$0058` |
| 4 | Joypad | `$0060` |

A source wants service when `(IE & IF & (1 << k)) !== 0`. The CPU actually jumps only if **`IME` is 1**. If `IME` is 0, bits can still sit in `IF` (and `HALT` can still wake).

Unused bits of `IF` read as 1. Store `ifReg` as 5 bits; on read return `ifReg | 0xe0`.

## Design

Check interrupts **once per instruction**, in this order:

```js
export function step(cpu, emu) {
  const t = cpu.halted ? handleHalt(emu) : executeOne(cpu);
  tickImeCountdown(cpu);
  const extra = serviceIfNeeded(emu);
  return t + extra;
}
```

`serviceIfNeeded` runs even if the instruction was `EI` — but IME might still be 0 because of the delay. That is the whole point of the countdown.

### `EI` delay

```js
function tickImeCountdown(cpu) {
  if (cpu.imeEnableCountdown > 0) {
    cpu.imeEnableCountdown--;
    if (cpu.imeEnableCountdown === 0) cpu.ime = true;
  }
}

// EI handler:
cpu.imeEnableCountdown = 2; // this instruction will decrement to 1; next instruction to 0
return 4;

// DI handler:
cpu.ime = false;
cpu.imeEnableCountdown = 0;
return 4;
```

`RETI`: `PC = pop16(cpu); cpu.ime = true; cpu.imeEnableCountdown = 0;` (16 T-cycles for the opcode; interrupt prologue is separate).

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

The HALT bug (`IME === 0` && pending already true when HALT executes) is **optional**. If a game misbehaves on HALT, revisit [cpu-quirks.md](../docs/reference/cpu-quirks.md). Tetris/Pokémon are fine with the simple version.

If you `HALT` and never tick peripherals, you deadlock: IF never sets, HALT never ends. Chapter 8’s PPU will set VBlank. For this chapter’s checkpoint you set IF yourself.

## IF / IE on the bus

```js
// io
ifBits() { return this.regs[0x0f] & 0x1f; }
ackIf(bit) { this.regs[0x0f] &= ~(1 << bit); }
read(addr) {
  if (addr === 0xff0f) return this.regs[0x0f] | 0xe0;
  …
}
write(addr, v) {
  if (addr === 0xff0f) { this.regs[0x0f] = v | 0xe0; return; }
  …
}
```

IE is already on the bus at `$FFFF`. Mask writes `& 0x1f` or keep the whole byte; only bits 4–0 matter.

## Pitfalls

- Servicing interrupts **before** `EI`’s following instruction. `EI; HALT` is a standard pair: if IME turns on too soon, you can fire, return, and HALT with IME on but IF already cleared — or the opposite desync. Use the countdown.
- Clearing **all** of IF when servicing one source.
- Not waking HALT when `IME === 0` but `IE & IF !== 0`. The CPU must continue so the game can `DI`/`EI` around critical sections.
- Pushing the wrong PC (already incremented vs not). Push the PC of the **next** instruction that would have run — which is the current `cpu.pc` after the last execute.
- Forgetting the 20 T-cycle cost → later, one frame’s worth of LCD will drift.

## Checkpoint

After skip-boot, in the debugger or a unit test:

1. `IE = 0x01`, `IF = 0x01`, `IME = 1`, `PC = $150` (anything not a vector).
2. `step()` once (a `NOP` at `$150` if you planted one, or just call `serviceIfNeeded` after a step).
3. Expect `PC === 0x0040`, `IME === false`, IF bit 0 **clear**, SP decreased by 2, stacked PC readable.

Second test: `IME = 0`, same IE/IF, `HALT`. After some halt-steps, `halted === false` and `PC` is the instruction after HALT, **not** `$0040`.

Third: `EI` then `NOP` then observe `IME === true` only **after** the `NOP`.

Tetris may still freeze: nothing sets IF bit 0 yet. One more chapter (timer) plus PPU VBlank will unstick it.

## Further reading

- [Pan Docs — Interrupts](https://gbdev.io/pandocs/Interrupts.html)
- [docs/reference/cpu-quirks.md](../docs/reference/cpu-quirks.md) (`EI`, `HALT`)
- Nazar part 8 (concept; his IME is too simple)
