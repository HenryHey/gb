export function createBus({ rom, io }) {
  const wram = new Uint8Array(0x2000);
  const hram = new Uint8Array(0x7f);
  const vram = new Uint8Array(0x2000); // PPU will own this later; bus can hold it
  const oam = new Uint8Array(0xa0);
  let ie = 0;

  function read8(addr) {
    addr &= 0xffff;
    if (addr < 0x8000) return rom[addr] ?? 0xff;
    if (addr < 0xa000) return vram[addr - 0x8000];
    if (addr < 0xc000) return 0xff; // no SRAM yet
    if (addr < 0xe000) return wram[addr - 0xc000];
    if (addr < 0xfe00) return wram[addr - 0xe000]; // echo
    if (addr < 0xfea0) return oam[addr - 0xfe00];
    if (addr < 0xff00) return 0xff;
    if (addr < 0xff80) return io.read(addr);
    if (addr < 0xffff) return hram[addr - 0xff80];
    return ie;
  }

  function write8(addr, v) {
    addr &= 0xffff;
    v &= 0xff;
    if (addr < 0x8000) return;
    if (addr < 0xa000) {
      vram[addr - 0x8000] = v;
      return;
    }
    if (addr < 0xc000) return;
    if (addr < 0xe000) {
      wram[addr - 0xc000] = v;
      return;
    }
    if (addr < 0xfe00) {
      wram[addr - 0xe000] = v;
      return;
    }
    if (addr < 0xfea0) {
      oam[addr - 0xfe00] = v;
      return;
    }
    if (addr < 0xff00) return;
    if (addr < 0xff80) {
      io.write(addr, v);
      return;
    }
    if (addr < 0xffff) {
      hram[addr - 0xff80] = v;
      return;
    }
    ie = v;
  }

  return {
    read8,
    write8,
    vram,
    oam,
    wram,
    hram,
    get ie() {
      return ie;
    },
    set ie(v) {
      ie = v & 0xff;
    },
  };
}
