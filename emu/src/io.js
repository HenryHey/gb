export function createIo() {
  const regs = new Uint8Array(0x80).fill(0xff);
  return {
    read(addr) {
      return regs[addr - 0xff00];
    },
    write(addr, v) {
      regs[addr - 0xff00] = v;
    },
    regs,
  };
}
