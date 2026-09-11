const MODE_HBLANK = 0;
const MODE_OAM = 2;

export function createBus({ cart, io, ppu, onCartRamWrite }) {
  const wram = new Uint8Array(0x2000);
  const hram = new Uint8Array(0x7f);
  const vram = new Uint8Array(0x2000); // PPU will own this later; bus can hold it
  const oam = new Uint8Array(0xa0);
  let ie = 0;

  let dmaReg = 0xff;
  let dmaActive = false;
  let dmaLock = false;
  let dmaSrc = 0; // source page written to $FF46
  let dmaIndex = 0; // bytes copied so far (0..0xA0)
  let dmaCountdown = 0; // T-cycles until first byte of this transfer

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
    const restarting = dmaActive;
    dmaReg = src & 0xff;
    dmaSrc = dmaReg;
    dmaIndex = 0;
    dmaActive = true;
    dmaCountdown = 8; // M1 delay after write before first byte of this transfer
    dmaLock = restarting; // restarted DMA: previous transfer still blocks OAM
  }

  function readDmaSource(addr) {
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

    if (dmaLock && addr >= 0xfe00 && addr < 0xfea0) {
      return 0xff;
    }

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
      if (onCartRamWrite && cart.ram?.length && cart.state?.ramEnable) {
        onCartRamWrite();
      }
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

  function dmaStep(tCycles) {
    if (!dmaActive) return;
    while (tCycles > 0 && dmaActive) {
      if (dmaCountdown > 0) {
        const step = Math.min(tCycles, dmaCountdown);
        dmaCountdown -= step;
        tCycles -= step;
        continue;
      }
      // One M-cycle = 4 T-cycles = one source byte → OAM (no idle gap between bytes)
      if (dmaIndex < 0xa0) {
        dmaLock = true;
        oam[dmaIndex] = readDmaSource((dmaSrc << 8) + dmaIndex);
        dmaIndex++;
        tCycles -= Math.min(tCycles, 4);
      } else {
        dmaActive = false;
        dmaLock = false;
      }
    }
  }

  function finishDma() {
    while (dmaActive) dmaStep(4);
  }

  function resetDma() {
    dmaReg = 0xff;
    dmaActive = false;
    dmaLock = false;
    dmaSrc = 0;
    dmaIndex = 0;
    dmaCountdown = 0;
  }

  function getDmaState() {
    return { dmaReg, dmaActive, dmaLock, dmaSrc, dmaIndex, dmaCountdown };
  }

  function setDmaState(s) {
    dmaReg = s.dmaReg & 0xff;
    dmaActive = !!s.dmaActive;
    dmaLock = !!s.dmaLock;
    dmaSrc = s.dmaSrc & 0xff;
    dmaIndex = s.dmaIndex & 0xff;
    dmaCountdown = s.dmaCountdown & 0xff;
  }

  return {
    dmaStep,
    finishDma,
    resetDma,
    getDmaState,
    setDmaState,
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
