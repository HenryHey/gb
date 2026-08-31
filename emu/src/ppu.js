const MODE_HBLANK = 0;
const MODE_VBLANK = 1;
const MODE_OAM = 2;
const MODE_DRAW = 3;

const STAT_HBLANK_IE = 0x08; // bit 3: mode 0 interrupt enable
const STAT_VBLANK_IE = 0x10; // bit 4: mode 1 interrupt enable
const STAT_OAM_IE = 0x20; // bit 5: mode 2 interrupt enable
const STAT_LYC_IE = 0x40; // bit 6: LYC coincidence interrupt enable

const GREEN = [0xe0f8d0, 0x88c070, 0x346856, 0x081820];

export function createPpu() {
  return {
    mode: MODE_OAM, // current PPU mode (STAT bits 0–1): 0 HBlank, 1 VBlank, 2 OAM, 3 Draw
    lineCycles: 0, // T-cycles elapsed in the current mode on this line
    ly: 0, // current scanline 0–153 ($FF44)
    lcdc: 0x91, // LCD control ($FF40); boot: LCD on, BG on, map $9800, tiles $8000
    stat: 0x84, // LCD status ($FF41) writable interrupt-enable bits; mode/LYC flag merged on read
    lyc: 0, // LY compare target ($FF45); STAT bit 2 set when ly === lyc
    scx: 0, // BG scroll X ($FF43)
    scy: 0, // BG scroll Y ($FF42)
    wy: 0, // window top Y ($FF4A)
    wx: 0, // window left X + 7 ($FF4B)
    bgp: 0xfc, // BG palette ($FF47); 2 bits per color index 0–3
    obp0: 0xff, // sprite palette 0 ($FF48); index 0 is transparent
    obp1: 0xff, // sprite palette 1 ($FF49); index 0 is transparent
    framebuffer: new Uint8ClampedArray(160 * 144 * 4), // RGBA pixels; host blits once per frame
    frameReady: false, // set at LY 144 (VBlank start); cleared after presenting the framebuffer
    windowLine: 0, // nternal counter, when LCD turns on or off, reset windowline to 0
  };
}

export function ppuStep(ppu, io, t, vram, oam) {
  if (!(ppu.lcdc & 0x80)) {
    // LCD off
    ppu.ly = 0;
    ppu.mode = MODE_HBLANK;
    ppu.lineCycles = 0;
    return;
  }

  ppu.lineCycles += t;
  while (ppu.lineCycles >= modeLength(ppu.mode)) {
    ppu.lineCycles -= modeLength(ppu.mode);
    advanceMode(ppu, io, vram, oam);
  }

  updateStatLyEquals(ppu, io);
}

function modeLength(mode) {
  return [204, 456, 80, 172][mode];
}

function advanceMode(ppu, io, vram, oam) {
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
      renderScanline(ppu, vram, oam);
      break;
    default:
      throw new Error(`Invalid PPU mode: ${ppu.mode}`);
  }
}

function colorIndex(lo, hi, x) {
  const bit = 7 - x;
  return (((hi >> bit) & 1) << 1) | ((lo >> bit) & 1); // 0–3
}

function tileAddress(lcdc, tileId) {
  if (lcdc & 0x10) {
    return 0x8000 + tileId * 16; // tileId 0–255
  }
  return 0x9000 + ((tileId << 24) >> 24) * 16; // signed
}

function sampleBg(ppu, vram, x, y) {
  let idx = 0;
  if (ppu.lcdc & 0x01) {
    const px = (ppu.scx + x) & 0xff;
    const py = (ppu.scy + y) & 0xff;
    const mapBase = ppu.lcdc & 0x08 ? 0x9c00 : 0x9800;
    const tileId = vram[mapBase + (py >> 3) * 32 + (px >> 3) - 0x8000];
    const addr = tileAddress(ppu.lcdc, tileId) - 0x8000;
    const lo = vram[addr + (py & 7) * 2];
    const hi = vram[addr + (py & 7) * 2 + 1];
    idx = colorIndex(lo, hi, px & 7);
  }
  return idx;
}

function sampleMap(ppu, vram, { mapBit, px, py }) {
  const mapBase = ppu.lcdc & mapBit ? 0x9c00 : 0x9800;
  const tileId = vram[mapBase + (py >> 3) * 32 + (px >> 3) - 0x8000];
  const addr = tileAddress(ppu.lcdc, tileId) - 0x8000;
  const lo = vram[addr + (py & 7) * 2];
  const hi = vram[addr + (py & 7) * 2 + 1];
  return colorIndex(lo, hi, px & 7);
}

function renderScanline(ppu, vram, oam) {
  if (!vram) return;

  const y = ppu.ly;
  if (y >= 144) return;

  const bgIdx = new Uint8Array(160);

  const winOn = ppu.lcdc & 0x20 && ppu.lcdc & 0x01 && y >= ppu.wy && ppu.wx <= 166;
  let usedWindow = false;

  for (let x = 0; x < 160; x++) {
    let idx;
    const useWin = winOn && x >= ppu.wx - 7;
    if (useWin) {
      usedWindow = true;
      const wx = x - (ppu.wx - 7);
      const wy = ppu.windowLine; // NOT y - wy, except when every line was drawn
      idx = sampleMap(ppu, vram, {
        mapBit: 0x40,
        px: wx,
        py: wy,
      });
    } else {
      idx = sampleBg(ppu, vram, x, y);
    }

    bgIdx[x] = idx;
    putPixel(ppu.framebuffer, x, y, paletteShades(ppu.bgp, GREEN)[idx]);
  }
  if (usedWindow) ppu.windowLine++;

  if (!oam || !(ppu.lcdc & 0x02)) return;

  const sprites = spritesOnLine(ppu, oam, y);
  for (const i of sprites) {
    const base = i* 4;
    const oamY = oam[base];
    const oamX = oam[base + 1];
    const tileIndex = oam[base + 2];
    const flags = oam[base + 3];
    const h = (ppu.lcdc & 0x04) ? 16 : 8;
    const screenX = oamX - 8;
    if (screenX <= -8 || screenX >= 160) continue;

    let row = y - (oamY - 16);
    if (flags & 0x40) {
      row = h -1 -row;
    }

    const tile = (h === 16)
      ? (tileIndex & 0xfe) + (row >= 8 ? 1 : 0)
      : tileIndex;

    const rowInTile = row & 7;
    const addr = tile * 16 + rowInTile * 2; // OBJ tiles always $8000-based in vram[]

    // OAM flags bit 4: 0 → OBP0 ($FF48), 1 → OBP1 ($FF49)
    const obp = flags & 0x10 ? ppu.obp1 : ppu.obp0;

    const shades = paletteShades(obp, GREEN);

    for (let xFine = 0; xFine < 8; xFine++) {
      const x = screenX + xFine;
      if (x < 0 || x >= 160) continue;

      let col = xFine;
      if (flags & 0x20) {
        col = 7 - col;
      }

      const idx = colorIndex(vram[addr], vram[addr+1], col);
      if (idx === 0) continue;
      if ((flags & 0x80) && bgIdx[x] !== 0) continue;

      putPixel(ppu.framebuffer, x, y, shades[idx]);
    }
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

function paletteShades(reg, colors = GREEN) {
  // BGP: bits 7-6 = index 3, 5-4 = index 2, 3-2 = index 1, 1-0 = index 0
  //       +---+---+---+---+---+---+---+---+
  // reg = | 3 | 3 | 2 | 2 | 1 | 1 | 0 | 0 |  (each pair is a 2-bit shade 0-3)
  //       +---+---+---+---+---+---+---+---+
  // i=0: >>0 &3  i=1: >>2 &3  i=2: >>4 &3  i=3: >>6 &3
  return [0, 1, 2, 3].map((i) => colors[(reg >> (i * 2)) & 3]);
}

function updateStatLyEquals(ppu, io) {
  if (ppu.ly === ppu.lyc && ppu.stat & STAT_LYC_IE) {
    io.requestIf(1);
  }
}

function spritesOnLine(ppu, oam, ly) {
  const h = (ppu.lcdc & 0x04) ? 16 : 8;
  const sprites = [];
  for (let i = 0; i < 40; i++) {
    const y = oam[i * 4] - 16;
    if (ly >= y && ly < y + h) sprites.push(i);
    if (sprites.length === 10) break; // hardware cap
  }

  sprites.sort((a, b) => {
    const ax = oam[a * 4 + 1];
    const bx = oam[b * 4 + 1];
    if (ax !== bx) return bx - ax; // larger X first
    return b - a; // later OAM first
  });
  return sprites;
}