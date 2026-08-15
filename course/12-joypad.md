# 12 — Joypad

## Goal

Map the keyboard to `$FF00`. **Play Tetris and Dr. Mario.**

## Why

The Game Boy does not have eight independent button wires. It has a **matrix**: the CPU writes which row to sense, then reads four bits. Your keyboard is not a matrix, so you keep eight booleans and **mux** them on read.

## Hardware

`$FF00` (P1 / JOYP):

| Bit | R/W | Meaning |
| --- | --- | --- |
| 7–6 | R | 1 |
| 5 | W | 0 = select **action** buttons (Start/Select/B/A) |
| 4 | W | 0 = select **d-pad** (Down/Up/Left/Right) |
| 3–0 | R | 0 = pressed (active-low) |

```js
export function createJoypad() {
  return {
    selectWrite: 0x30, // last bits 5–4 written to $FF00 (1 = not selected)
    start: false, select: false, b: false, a: false, // true = pressed
    down: false, up: false, left: false, right: false,
  };
}

export function readP1(j) {
  let nibble = 0x0f;
  if (!(j.selectWrite & 0x20)) {
    if (j.start) nibble &= ~0x08;
    if (j.select) nibble &= ~0x04;
    if (j.b) nibble &= ~0x02;
    if (j.a) nibble &= ~0x01;
  }
  if (!(j.selectWrite & 0x10)) {
    if (j.down) nibble &= ~0x08;
    if (j.up) nibble &= ~0x04;
    if (j.left) nibble &= ~0x02;
    if (j.right) nibble &= ~0x01;
  }
  return 0xc0 | (j.selectWrite & 0x30) | nibble;
}

export function writeP1(j, v) {
  j.selectWrite = v & 0x30;
}
```

Writes only update bits 5–4. Reads combine those bits with live button state.

Both rows selected: a button that is pressed in either row pulls that bit low (AND the two nibbles). Neither selected: `nibble = 0x0f`.

## Keyboard map (suggested)

| Key | Button |
| --- | --- |
| Arrow keys / WASD | D-pad |
| `Z` / `J` | A |
| `X` / `K` | B |
| Enter | Start |
| Shift / Backspace | Select |

```js
window.addEventListener("keydown", (e) => {
  if (map(e.code, true)) e.preventDefault();
});
window.addEventListener("keyup", (e) => map(e.code, false));
```

`preventDefault` stops arrows from scrolling the page. Ignore key repeat in `keydown` if you want (`e.repeat`).

## Joypad interrupt (optional)

When a selected button **transitions to pressed**, set IF bit 4. Tetris does not need it (it polls). Implement if you have time: edge-detect on the four visible bits.

## Host

Buttons must be sampled **asynchronously** from the CPU. The event listeners write booleans; `read8($FF00)` only reads them. Do not wait for a frame.

## Pitfalls

- Active-**high** buttons (1 = pressed). The game will see inverted controls or none.
- Mixing d-pad and action nibbles (Start on bit 0).
- Not storing bits 5–4 from the write — then a read cannot know which row to return.
- `keydown` on a `<input type=file>` stealing keys — click the canvas to focus, or listen on `window`.
- Mapping `key` (`"z"`) instead of `code` (`"KeyZ"`) and breaking on non-US layouts — `code` is stabler for games.

## Checkpoint

**Play Tetris.** Start (Enter) from the title, move pieces, rotate with A/B, drop. If the menu does not react, dump `$FF00` on each read in the console while you hold A — you should see bit 0 go to 0 when the action row is selected.

**Play Dr. Mario** the same way. Both are ROM-only 32 KiB; no MBC.

If the game boots but ignores you: LCD/CPU are fine, P1 is wrong. If it reacts once and sticks: you never got `keyup`.

You now have a Game Boy for launch titles. Next chapters unlock 64 KiB+ cartridges.

## Further reading

- [Pan Docs — Joypad](https://gbdev.io/pandocs/Joypad_Input.html)
- [docs/reference/io-registers.md](../docs/reference/io-registers.md)
- Nazar part 6 *Input*
