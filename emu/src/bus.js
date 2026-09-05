const MODE_HBLANK = 0;
const MODE_OAM = 2;

export function createBus({ cart, io, ppu }) {
  const wram = new Uint8Array(0x2000);
  const hram = new Uint8Array(0x7f);
  const vram = new Uint8Array(0x2000); // PPU will own this later; bus can hold it
  const oam = new Uint8Array(0xa0);
  let ie = 0;
  let dmaReg = 0xff;

  function isPpuReg(addr) {
    if (!ppu) return false;
    if (addr === 0xff46 || addr === 0xff4c) return false;
    return addr >= 0xff40 && addr <= 0xff4b;
  }

  function readPpuReg(addr) {
    switch (addr) {
      case 0xff40:
        return ppu.lcdc;
      case 0xff41:
        return 0x80 | (ppu.stat & 0x78) | ppu.mode | (ppu.ly === ppu.lyc ? 4 : 0);
      case 0xff42:
        return ppu.scy;
      case 0xff43:
        return ppu.scx;
      case 0xff44:
        return ppu.ly;
      case 0xff45:
        return ppu.lyc;
      case 0xff47:
        return ppu.bgp;
      case 0xff48:
        return ppu.obp0;
      case 0xff49:
        return ppu.obp1;
      case 0xff4a:
        return ppu.wy;
      case 0xff4b:
        return ppu.wx;
      default:
        return 0xff;
    }
  }

  function writeLcdc(v) {
    const old = ppu.lcdc;
    ppu.lcdc = v;
    const wasOn = old & 0x80;
    const nowOn = v & 0x80;
    if (wasOn && !nowOn) {
      ppu.ly = 0;
      ppu.mode = MODE_HBLANK;
      ppu.lineCycles = 0;
      ppu.windowLine = 0;
      ppu.wyTriggered = false;
      ppu.framebuffer.fill(255);
    } else if (!wasOn && nowOn) {
      ppu.ly = 0;
      ppu.mode = MODE_OAM;
      ppu.lineCycles = 0;
      ppu.windowLine = 0;
      ppu.wyTriggered = false;
    }
  }

  function writePpuReg(addr, v) {
    switch (addr) {
      case 0xff40:
        writeLcdc(v);
        return;
      case 0xff41:
        ppu.stat = (ppu.stat & ~0x78) | (v & 0x78);
        return;
      case 0xff42:
        ppu.scy = v;
        return;
      case 0xff43:
        ppu.scx = v;
        return;
      case 0xff44:
        return;
      case 0xff45:
        ppu.lyc = v;
        return;
      case 0xff47:
        ppu.bgp = v;
        return;
      case 0xff48:
        ppu.obp0 = v;
        return;
      case 0xff49:
        ppu.obp1 = v;
        return;
      case 0xff4a:
        ppu.wy = v;
        return;
      case 0xff4b:
        ppu.wx = v;
        return;
    }
  }

  function writeDma(src) {
    src &= 0xff;
    dmaReg = src;
    const base = src << 8;
    for (let i = 0; i < 0xa0; i++) {
      oam[i] = read8(base + i);
    }
  }

  function readIo(addr) {
    if (addr === 0xff4c) return 0xff;
    if (addr === 0xff46) return dmaReg;
    if (isPpuReg(addr)) return readPpuReg(addr);
    return io.read(addr);
  }

  function writeIo(addr, v) {
    if (addr === 0xff4c) return;
    if (addr === 0xff46) return writeDma(v);
    if (isPpuReg(addr)) {
      writePpuReg(addr, v);
      return;
    }
    io.write(addr, v);
  }

  function read8(addr) {
    addr &= 0xffff;
    if (addr < 0x8000) return cart.readRom(addr);
    if (addr < 0xa000) return vram[addr - 0x8000];
    if (addr < 0xc000) return cart.readRam(addr);
    if (addr < 0xe000) return wram[addr - 0xc000];
    if (addr < 0xfe00) return wram[addr - 0xe000]; // echo
    if (addr < 0xfea0) return oam[addr - 0xfe00];
    if (addr < 0xff00) return 0xff;
    if (addr < 0xff80) return readIo(addr);
    if (addr < 0xffff) return hram[addr - 0xff80];
    return ie;
  }

  function write8(addr, v) {
    addr &= 0xffff;
    v &= 0xff;
    if (addr < 0x8000) {
      cart.writeRom(addr, v);
      return;
    }
    if (addr < 0xa000) {
      vram[addr - 0x8000] = v;
      return;
    }
    if (addr < 0xc000) {
      cart.writeRam(addr, v);
      return;
    }
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
      writeIo(addr, v);
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
