import { parseHeader } from './cart.js';
import { crc32 } from './crc32.js';
import { createEmu } from './emu.js';

export { crc32 };

export const GBSS_MAGIC = 0x53534247; // 'GBSS' LE
export const GBSS_VERSION = 1;

const BASE_SIZE = 0x4220;

export function stateKey(rom) {
  const h = parseHeader(rom);
  return `gb-state:${h.title}:${h.headerChecksum.toString(16)}`;
}

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

export function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function writePpu(out, view, ppu) {
  out[0x40] = ppu.mode;
  view.setUint16(0x41, ppu.lineCycles, true);
  out[0x43] = ppu.ly;
  out[0x44] = ppu.lcdc;
  out[0x45] = ppu.stat;
  out[0x46] = ppu.lyc;
  out[0x47] = ppu.scy;
  out[0x48] = ppu.scx;
  out[0x49] = ppu.wy;
  out[0x4a] = ppu.wx;
  out[0x4b] = ppu.bgp;
  out[0x4c] = ppu.obp0;
  out[0x4d] = ppu.obp1;
  out[0x4e] = ppu.windowLine & 0xff;
  out[0x4f] = ppu.wyTriggered ? 1 : 0;
  out[0x36] = ppu.lycMatchPrev ? 1 : 0;
  out[0x37] = ppu.frameReady ? 1 : 0;
}

function readPpu(ppu, view) {
  ppu.mode = view.getUint8(0x40);
  ppu.lineCycles = view.getUint16(0x41, true);
  ppu.ly = view.getUint8(0x43);
  ppu.lcdc = view.getUint8(0x44);
  ppu.stat = view.getUint8(0x45);
  ppu.lyc = view.getUint8(0x46);
  ppu.scy = view.getUint8(0x47);
  ppu.scx = view.getUint8(0x48);
  ppu.wy = view.getUint8(0x49);
  ppu.wx = view.getUint8(0x4a);
  ppu.bgp = view.getUint8(0x4b);
  ppu.obp0 = view.getUint8(0x4c);
  ppu.obp1 = view.getUint8(0x4d);
  ppu.windowLine = view.getUint8(0x4e);
  ppu.wyTriggered = view.getUint8(0x4f) !== 0;
  ppu.lycMatchPrev = view.getUint8(0x36) !== 0;
  ppu.frameReady = view.getUint8(0x37) !== 0;
}

function writeDma(out, dma) {
  out[0x74] = dma.dmaReg;
  out[0x75] = dma.dmaActive ? 1 : 0;
  out[0x76] = dma.dmaLock ? 1 : 0;
  out[0x77] = dma.dmaSrc;
  out[0x78] = dma.dmaIndex;
  out[0x79] = dma.dmaCountdown;
}

function readDma(bus, view) {
  bus.setDmaState({
    dmaReg: view.getUint8(0x74),
    dmaActive: view.getUint8(0x75) !== 0,
    dmaLock: view.getUint8(0x76) !== 0,
    dmaSrc: view.getUint8(0x77),
    dmaIndex: view.getUint8(0x78),
    dmaCountdown: view.getUint8(0x79),
  });
}

function writeTimer(out, view, io) {
  view.setUint16(0x50, io.divCounter, true);
  out[0x52] = io.tima;
  out[0x53] = io.tma;
  out[0x54] = io.tac;
}

function readTimer(io, view) {
  io.divCounter = view.getUint16(0x50, true);
  io.tima = view.getUint8(0x52);
  io.tma = view.getUint8(0x53);
  io.tac = view.getUint8(0x54);
}

function writeJoypad(out, joypad) {
  out[0x58] = joypad.selectWrite;
  out[0x59] = joypad.start ? 1 : 0;
  out[0x5a] = joypad.select ? 1 : 0;
  out[0x5b] = joypad.b ? 1 : 0;
  out[0x5c] = joypad.a ? 1 : 0;
  out[0x5d] = joypad.down ? 1 : 0;
  out[0x5e] = joypad.up ? 1 : 0;
  out[0x5f] = joypad.left ? 1 : 0;
  out[0x60] = joypad.right ? 1 : 0;
}

function readJoypad(joypad, view) {
  joypad.selectWrite = view.getUint8(0x58);
  joypad.start = view.getUint8(0x59) !== 0;
  joypad.select = view.getUint8(0x5a) !== 0;
  joypad.b = view.getUint8(0x5b) !== 0;
  joypad.a = view.getUint8(0x5c) !== 0;
  joypad.down = view.getUint8(0x5d) !== 0;
  joypad.up = view.getUint8(0x5e) !== 0;
  joypad.left = view.getUint8(0x5f) !== 0;
  joypad.right = view.getUint8(0x60) !== 0;
}

function writeCart(out, view, cart, mapperType) {
  const ramBytes = cart.ram?.byteLength ?? 0;
  out[0x64] = mapperType;
  if (cart.state) {
    out[0x65] = cart.state.ramEnable ? 1 : 0;
    const romBank = cart.state.romBank ?? cart.state.romBankLow ?? 0;
    view.setUint16(0x66, romBank, true);
    out[0x68] = cart.state.ramBank ?? 0;
    out[0x69] = cart.state.mode ?? 0;
    out[0x6a] = cart.state.romBankHigh ?? 0;
  }
  view.setUint32(0x70, ramBytes, true);
}

function readCart(cart, view) {
  if (!cart.state) return;
  cart.state.ramEnable = view.getUint8(0x65) !== 0;
  const romBank = view.getUint16(0x66, true);
  if ('romBank' in cart.state) cart.state.romBank = romBank;
  if ('romBankLow' in cart.state) cart.state.romBankLow = romBank & 0xff;
  cart.state.ramBank = view.getUint8(0x68);
  if ('mode' in cart.state) cart.state.mode = view.getUint8(0x69);
  if ('romBankHigh' in cart.state) cart.state.romBankHigh = view.getUint8(0x6a);
}

export function serializeEmu(emu) {
  if (emu.rom.length < 0x150) throw new Error('Load a ROM before saving state');

  const header = parseHeader(emu.rom);
  const ramBytes = emu.cart.ram?.byteLength ?? 0;
  const out = new Uint8Array(BASE_SIZE + ramBytes);
  const view = new DataView(out.buffer);

  view.setUint32(0x00, GBSS_MAGIC, true);
  view.setUint32(0x04, GBSS_VERSION, true);
  view.setUint32(0x08, crc32(emu.rom), true);
  out.set(emu.rom.subarray(0x134, 0x144), 0x0c);
  out[0x1c] = 0; // DMG

  const cpu = emu.cpu;
  let o = 0x20;
  out[o++] = cpu.a;
  out[o++] = cpu.f;
  out[o++] = cpu.b;
  out[o++] = cpu.c;
  out[o++] = cpu.d;
  out[o++] = cpu.e;
  out[o++] = cpu.h;
  out[o++] = cpu.l;
  view.setUint16(o, cpu.sp, true);
  o += 2;
  view.setUint16(o, cpu.pc, true);
  view.setInt32(0x30, cpu.imeEnableCountdown, true);
  out[0x34] = cpu.ime ? 1 : 0;
  out[0x35] = cpu.halted ? 1 : 0;

  writePpu(out, view, emu.ppu);
  writeTimer(out, view, emu.io);
  writeJoypad(out, emu.io.joypad);
  writeCart(out, view, emu.cart, header.type);
  writeDma(out, emu.bus.getDmaState());

  out.set(emu.bus.vram, 0x80);
  out.set(emu.bus.wram, 0x2080);
  out.set(emu.bus.oam, 0x4080);
  out.set(emu.io.regs, 0x4120);
  out.set(emu.bus.hram, 0x41a0);
  out[0x421f] = emu.bus.ie;
  if (ramBytes) out.set(emu.cart.ram, 0x4220);

  return out;
}

export function deserializeEmu(bytes, rom) {
  if (rom.length < 0x150) throw new Error('Load a ROM before loading state');
  if (bytes.byteLength < BASE_SIZE) throw new Error('GBSS truncated');

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GBSS_MAGIC) throw new Error('Not GBSS');
  if (view.getUint32(4, true) !== GBSS_VERSION) throw new Error('Unsupported GBSS version');
  if (view.getUint32(8, true) !== crc32(rom)) throw new Error('ROM mismatch');

  const ramBytes = view.getUint32(0x70, true);
  if (bytes.byteLength < BASE_SIZE + ramBytes) throw new Error('GBSS truncated');

  const emu = createEmu(rom);
  const cpu = emu.cpu;

  cpu.a = view.getUint8(0x20);
  cpu.f = view.getUint8(0x21);
  cpu.b = view.getUint8(0x22);
  cpu.c = view.getUint8(0x23);
  cpu.d = view.getUint8(0x24);
  cpu.e = view.getUint8(0x25);
  cpu.h = view.getUint8(0x26);
  cpu.l = view.getUint8(0x27);
  cpu.sp = view.getUint16(0x28, true);
  cpu.pc = view.getUint16(0x2a, true);
  cpu.imeEnableCountdown = view.getInt32(0x30, true);
  cpu.ime = view.getUint8(0x34) !== 0;
  cpu.halted = view.getUint8(0x35) !== 0;

  readPpu(emu.ppu, view);
  readTimer(emu.io, view);
  readJoypad(emu.io.joypad, view);
  readCart(emu.cart, view);
  readDma(emu.bus, view);

  emu.bus.vram.set(bytes.subarray(0x80, 0x2080));
  emu.bus.wram.set(bytes.subarray(0x2080, 0x4080));
  emu.bus.oam.set(bytes.subarray(0x4080, 0x4120));
  emu.io.regs.set(bytes.subarray(0x4120, 0x41a0));
  emu.bus.hram.set(bytes.subarray(0x41a0, 0x421f));
  emu.bus.ie = view.getUint8(0x421f);
  if (ramBytes && emu.cart.ram) {
    emu.cart.ram.set(bytes.subarray(0x4220, 0x4220 + ramBytes));
  }

  return emu;
}

export function saveStateSlot(emu) {
  const key = stateKey(emu.rom);
  localStorage.setItem(key, bytesToBase64(serializeEmu(emu)));
  return key;
}

export function loadStateSlot(rom) {
  const key = stateKey(rom);
  const raw = localStorage.getItem(key);
  if (!raw) return null;
  return deserializeEmu(base64ToBytes(raw), rom);
}

export function getSavedStateRaw(rom) {
  if (rom.length < 0x150) return null;
  const key = stateKey(rom);
  const base64 = localStorage.getItem(key);
  if (!base64) return null;
  return { key, base64 };
}

/** JSON-serializable export of the stored slot (for clipboard / sharing). */
export function savedStateToJson(rom, { romFileName, archiveFileName } = {}) {
  const raw = getSavedStateRaw(rom);
  if (!raw) return null;
  const header = parseHeader(rom);
  const payload = {
    format: 'GBSS',
    version: GBSS_VERSION,
    key: raw.key,
    title: header.title,
    romCrc32: crc32(rom),
    base64: raw.base64,
  };
  if (romFileName) payload.romFileName = romFileName;
  if (archiveFileName) payload.archiveFileName = archiveFileName;
  return payload;
}
