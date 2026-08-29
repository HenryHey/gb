const MODE_HBLANK = 0;
const MODE_VBLANK = 1;
const MODE_OAM = 2;
const MODE_DRAW = 3;

const STAT_LYC_FLAG = 0x04;   // bit 2: LY === LYC (read-only)
const STAT_HBLANK_IE = 0x08;  // bit 3: mode 0 interrupt enable
const STAT_VBLANK_IE = 0x10;  // bit 4: mode 1 interrupt enable
const STAT_OAM_IE = 0x20;     // bit 5: mode 2 interrupt enable
const STAT_LYC_IE = 0x40;     // bit 6: LYC coincidence interrupt enable

/** Enable bit for each mode; mode 3 (draw) has no STAT interrupt. */
const STAT_IE_BY_MODE = [STAT_HBLANK_IE, STAT_VBLANK_IE, STAT_OAM_IE, 0];

export function createPpu() {
  return {
    mode: MODE_OAM,
    lineCycles: 0, // T-cycles in the current mode
    ly: 0,
    lcdc: 0x91,
    stat: 0x84,
    lyc: 0,
    scx: 0, scy: 0, wy: 0, wx: 0,
    bgp: 0xfc, obp0: 0xff, obp1: 0xff,
    framebuffer: new Uint8ClampedArray(160 * 144 * 4),
    frameReady: false,
  };
}


export function ppuStep(ppu, io, t) {
  if (!(ppu.lcdc & 0x80)) {
    // LCD off
    ppu.ly = 0
    ppu.mode = MODE_HBLANK;
    ppu.lineCycles = 0;
    return;
  }

  ppu.lineCycles += t;
  while (ppu.lineCycles >= modeLength(ppu.mode)) {
    ppu.lineCycles -= modeLength(ppu.mode);
    advanceMode(ppu, io);
  }

  updateStatLyEquals(ppu, io);
}

function modeLength(mode) {
  return [204, 456, 80, 172][mode];
}

function advanceMode(ppu, io) {
  const ie = STAT_IE_BY_MODE[ppu.mode];
  switch (ppu.mode) {
    case MODE_HBLANK:
      ppu.ly++;
      if (ppu.ly === 144) {
        ppu.mode = MODE_VBLANK;
        io.requestIf(0);
        if (ie & ppu.stat & ie) io.requestIf(1);
        ppu.frameReady = true;
      } else {
        ppu.mode = MODE_OAM;
        if (ie & ppu.stat & ie) io.requestIf(1);
      }
      break;
    case MODE_VBLANK:
      ppu.ly++;
      if (ppu.ly === 154) {
        ppu.ly = 0;
        ppu.mode = MODE_OAM;
        if (ppu.stat & ie) io.requestIf(1);
      }
      break;
    case MODE_OAM:
      ppu.mode = MODE_DRAW;
      if (ie & ppu.stat & ie) io.requestIf(1);
      break;
    case MODE_DRAW:
      ppu.mode = MODE_HBLANK;
      if (ie & ppu.stat & ie) io.requestIf(1);
      renderScanline(ppu);
      break;
    default:
      throw new Error(`Invalid PPU mode: ${ppu.mode}`);
  }

}

function renderScanline(ppu) {
  return;
}

function updateStatLyEquals(ppu, io) {
  if (ppu.ly === ppu.lyc && (ppu.stat & STAT_LYC_IE)) {
    io.requestIf(1);
  }
}