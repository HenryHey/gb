export function createJoypad() {
  return {
    selectWrite: 0x00, // post-boot: both select lines low until game writes P1
    start: false,
    select: false,
    b: false,
    a: false, // true = pressed
    down: false,
    up: false,
    left: false,
    right: false,
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
