const MODE_HBLANK = 0;
const MODE_VBLANK = 1;
const MODE_OAM = 2;
const MODE_DRAW = 3;

const STAT_LYC_FLAG = 0x04;   // bit 2: LY === LYC (read-only)
const STAT_HBLANK_IE = 0x08;  // bit 3: mode 0 interrupt enable
const STAT_VBLANK_IE = 0x10;  // bit 4: mode 1 interrupt enable
const STAT_OAM_IE = 0x20;     // bit 5: mode 2 interrupt enable
const STAT_LYC_IE = 0x40;     // bit 6: LYC coincidence interrupt enable

const GREEN = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];

export function createPpu() {
  return {
    mode: MODE_OAM,            // current PPU mode (STAT bits 0–1): 0 HBlank, 1 VBlank, 2 OAM, 3 Draw
    lineCycles: 0,             // T-cycles elapsed in the current mode on this line
    ly: 0,                     // current scanline 0–153 ($FF44)
    lcdc: 0x91,                // LCD control ($FF40); boot: LCD on, BG on, map $9800, tiles $8000
    stat: 0x84,                // LCD status ($FF41) writable interrupt-enable bits; mode/LYC flag merged on read
    lyc: 0,                    // LY compare target ($FF45); STAT bit 2 set when ly === lyc
    scx: 0,                    // BG scroll X ($FF43)
    scy: 0,                    // BG scroll Y ($FF42)
    wy: 0,                     // window top Y ($FF4A)
    wx: 0,                     // window left X + 7 ($FF4B)
    bgp: 0xfc,                 // BG palette ($FF47); 2 bits per color index 0–3
    obp0: 0xff,                // sprite palette 0 ($FF48); index 0 is transparent
    obp1: 0xff,                // sprite palette 1 ($FF49); index 0 is transparent
    framebuffer: new Uint8ClampedArray(160 * 144 * 4), // RGBA pixels; host blits once per frame
    frameReady: false,         // set at LY 144 (VBlank start); cleared after presenting the framebuffer
  };
}


export function ppuStep(ppu, io, t, vram) {
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
    advanceMode(ppu, io, vram);
  }

  updateStatLyEquals(ppu, io);
}

function modeLength(mode) {
  return [204, 456, 80, 172][mode];
}

function advanceMode(ppu, io, vram) {
  switch (ppu.mode) {
    case MODE_HBLANK:
      ppu.ly++;
      if (ppu.ly === 144) {
        ppu.mode = MODE_VBLANK;
        io.requestIf(0);
        if (ppu.stat & STAT_VBLANK_IE) io.requestIf(1);
        ppu.frameReady = true;
      } else {
        ppu.mode = MODE_OAM;
        if (ppu.stat & STAT_OAM_IE) io.requestIf(1);
      }
      break;
    case MODE_VBLANK:
      ppu.ly++;
      if (ppu.ly === 154) {
        ppu.ly = 0;
        ppu.mode = MODE_OAM;
        if (ppu.stat & STAT_OAM_IE) io.requestIf(1);
      }
      break;
    case MODE_OAM:
      ppu.mode = MODE_DRAW;
      break;
    case MODE_DRAW:
      ppu.mode = MODE_HBLANK;
      if (ppu.stat & STAT_HBLANK_IE) io.requestIf(1);
      renderScanline(ppu, vram);
      break;
    default:
      throw new Error(`Invalid PPU mode: ${ppu.mode}`);
  }

}

function colorIndex(lo, hi, x) {
  const bit = 7 - x;
  return ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1); // 0–3
}


function tileAddress(lcdc, tileId) {
  if (lcdc & 0x10) {
    return 0x8000 + tileId * 16;           // tileId 0–255
  }
  return 0x9000 + ((tileId << 24) >> 24) * 16; // signed
}

function renderScanline(ppu, vram) {
  if (!vram) return;

  const y = ppu.ly;
  if (y >= 144) return;

  for (let x = 0; x < 160; x++) {
    let idx = 0;
    if (ppu.lcdc & 0x01) {
      const px = (ppu.scx + x) & 0xff;
      const py = (ppu.scy + y) & 0xff;
      const mapBase = (ppu.lcdc & 0x08) ? 0x9c00 : 0x9800;
      const tileId = vram[mapBase + (py >> 3) * 32 + (px >> 3) - 0x8000]; 
      const addr = tileAddress(ppu.lcdc, tileId) - 0x8000;
      const lo = vram[addr + (py & 7) * 2];
      const hi = vram[addr + (py & 7) * 2 + 1];
      idx = colorIndex(lo, hi, px & 7);
    }

    putPixel(ppu.framebuffer, x, y, GREEN[idx]);
  }
  return;
}

function putPixel(fb, x, y, rgb) {
  const i = (y * 160 + x) * 4;
  fb[i] = (rgb >> 16) & 0xff;
  fb[i + 1] = (rgb >> 8) & 0xff;
  fb[i + 2] = rgb & 0xff;
  fb[i + 3] = 255;
}

function updateStatLyEquals(ppu, io) {
  if (ppu.ly === ppu.lyc && (ppu.stat & STAT_LYC_IE)) {
    io.requestIf(1);
  }
}