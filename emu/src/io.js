import { createJoypad, readP1, writeP1 } from './joypad.js';

/** Offsets ($FF00 + n) with no hardware behind them — read $FF, ignore writes. */
const UNMAPPED = new Set([
  0x03, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x15, 0x1f, 0x27, 0x28, 0x29,
]);
for (let i = 0x4d; i <= 0x7f; i++) UNMAPPED.add(i);

/** Unused bits that read as 1 on DMG (Mooneye `bits/unused_hwio-GS`). */
const READ_HI = {
  0x02: 0x7e, // SC
  0x10: 0x80, // NR10
  0x1a: 0x7f, // NR30
  0x1c: 0x9f, // NR32
  0x20: 0xc0, // NR41
  0x23: 0x3f, // NR44
};

function isUnmapped(offset) {
  return UNMAPPED.has(offset);
}

function readStored(regs, offset) {
  const hi = READ_HI[offset];
  if (hi !== undefined) return regs[offset] | hi;
  if (offset === 0x26) return (regs[offset] & 0x8f) | 0x70; // NR52: bit 7 + channel flags; bits 6-4 read 1
  return regs[offset];
}

export function createIo() {
  const regs = new Uint8Array(0x80).fill(0xff);
  const serialOut = [];
  const joypad = createJoypad();

  function completeSerialTransfer(scValue) {
    serialOut.push(regs[0x01]);
    regs[0x02] = scValue & 0x7f;
  }

  return {
    read(addr) {
      const offset = addr - 0xff00;
      if (isUnmapped(offset)) return 0xff;

      // IF ($FF0F): lower 5 bits are flags; bits 7-5 read as 1 on real hardware.
      //
      //   bit:  7 6 5 4 3 2 1 0
      //         1 1 1 . . . . .   <- always 1 (mask 0xE0 = 11100000)
      //               ^ ^ ^ ^ ^   <- interrupt flags (mask 0x1F = 00011111)
      if (addr === 0xff0f) return regs[0x0f] | 0xe0;
      if (addr === 0xff04) return (this.divCounter >> 8) & 0xff;
      if (addr === 0xff05) return this.tima;
      if (addr === 0xff06) return this.tma;
      if (addr === 0xff07) return this.tac | 0xf8;
      if (addr === 0xff00) return readP1(joypad);
      return readStored(regs, offset);
    },
    write(addr, v) {
      const offset = addr - 0xff00;
      if (isUnmapped(offset)) return;

      if (addr === 0xff0f) {
        // Store only the 5 flag bits; force upper bits to 1 in our copy.
        // (v & 0x1f) keeps bits 4-0; | 0xe0 sets bits 7-5 to 1.
        regs[0x0f] = (v & 0x1f) | 0xe0;
        return;
      }
      if (addr === 0xff04) {
        this.divCounter = 0;
        return;
      }
      if (addr === 0xff05) {
        this.tima = v;
        return;
      }
      if (addr === 0xff06) {
        this.tma = v;
        return;
      }
      if (addr === 0xff07) {
        this.tac = v;
        return;
      }
      if (addr === 0xff02) {
        regs[0x02] = v;
        if (v & 0x80) completeSerialTransfer(v);
        return;
      }
      if (addr === 0xff00) {
        writeP1(joypad, v);
        return;
      }
      regs[offset] = v;
    },
    ifBits() {
      return regs[0x0f] & 0x1f;
    },
    ackIf(bit) {
      // Clear one flag: AND with the inverse of a single-bit mask.
      //
      //   1 << bit     sets bit `bit` to 1, rest to 0   e.g. bit 2 -> 0b00000100
      //   ~(1 << bit)  flips that: bit `bit` is 0, rest are 1
      //   regs &= ...  keeps every bit except the one we want to clear
      regs[0x0f] &= ~(1 << bit);
    },
    requestIf(bit) {
      // Set one flag: OR with a single-bit mask.
      //
      //   1 << bit     e.g. bit 0 -> 0b00000001, bit 3 -> 0b00001000
      //   regs |= ...  turns that bit on without changing the others
      regs[0x000f] |= 1 << bit;
    },
    regs,
    joypad,
    serialOut,
    divCounter: 0,
    tac: 0,
    tima: 0,
    tma: 0,
  };
}
