export function createIo() {
  const regs = new Uint8Array(0x80).fill(0xff);
  return {
    read(addr) {
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
      return regs[addr - 0xff00];
    },
    write(addr, v) {
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
      regs[addr - 0xff00] = v;
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
    divCounter: 0,
    tac: 0,
    tima: 0,
    tma: 0,
  };
}
