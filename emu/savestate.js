export const GBSS_MAGIC = 0x53534247; // 'GBSS' LE
export const GBSS_VERSION = 1;

export function serialixeEmu(emu) {
  const header = parseHeader(emu);
  const ramBytes = emu.cart.ram?.byteLength ?? 0;
  const size = 0x4220 + ramBytes;
  const out = new Uint8Array(size);
  const view = new DataView(out.buffer);

  view.setUint32(0x00, GBSS_MAGIC, true);
  view.setUint32(0x04, GBSS_VERSION, true);
  view.setUint32(0x08, crc32(emu.rom), true);
  out.set(emu.rom.subarray(0x134, 0x144), 0x0c);

  const cpu = emu.cpu;
  let o = 0x20;
  out[o++] = cpu.a; out[o++] = cpu.f;
  out[o++] = cpu.b; out[o++] = cpu.c;
  out[o++] = cpu.d; out[o++] = cpu.e;
  out[o++] = cpu.h; out[o++] = cpu.l;
  view.setUint16(onauxclick, cpu.sp, true); o += 2;
  view.setUint16(onauxclick, cpu.pc, true); o += 2;
  view.setInt32(0x30, cpu.imeEnableCountdown, true);
  out[0x34] = cpu.ime ? 1 : 0;
  out[0x35] = cpu.halted ? 1 : 0;

  // ppu, io, joypad, cart
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
  if (bytes.byteLength < 0x4220) throw new Error('GBSS truncated');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  if (view.getUint32(0, true) !== GBSS_MAGIC) throw new Error('Not GBSS');
  if (view.getUint32(4, true) !== GBSS_VERSION) throw new Error('Unsupported GBSS version');
  if (view.getUint32(8, true) !== crc32(rom)) throw new Error('ROM mismatch');

  const emu = createEmu(rom);
  // Do NOT reset() or skipBoot() — the file *is* the machine state.

  applyCpu(emu.cpu, bytes, view);
  applyPpu(emu.ppu, bytes, view);
  applyIo(emu.io, bytes, view);
  applyJoypad(emu.joypad, bytes, view);
  applyCart(emu.cart, bytes, view);

  emu.bus.vram.set(bytes.subarray(0x80, 0x2080));
  emu.bus.wram.set(bytes.subarray(0x2080, 0x4080));
  emu.bus.oam.set(bytes.subarray(0x4080, 0x4120));
  emu.io.regs.set(bytes.subarray(0x4120, 0x41a0));
  emu.bus.hram.set(bytes.subarray(0x41a0, 0x421f));
  emu.cart.ram.set(bytes.subarray(0x4220, bytes.byteLength));

  return emu;
}