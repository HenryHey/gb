/** DMG post-boot APU values at PC = $0100 (Pan Docs Power-Up Sequence). */
const POST_BOOT_APU = [
  [0x10, 0x80], // NR10
  [0x11, 0xbf], // NR11
  [0x12, 0xf3], // NR12
  [0x13, 0xff], // NR13
  [0x14, 0xbf], // NR14
  [0x16, 0x3f], // NR21
  [0x17, 0x00], // NR22
  [0x18, 0xff], // NR23
  [0x19, 0xbf], // NR24
  [0x1a, 0x7f], // NR30
  [0x1b, 0xff], // NR31
  [0x1c, 0x9f], // NR32
  [0x1d, 0xff], // NR33
  [0x1e, 0xbf], // NR34
  [0x20, 0xff], // NR41
  [0x21, 0x00], // NR42
  [0x22, 0x00], // NR43
  [0x23, 0xbf], // NR44
  [0x24, 0x77], // NR50
  [0x25, 0xf3], // NR51
  [0x26, 0xf1], // NR52: APU on, ch1 flag (boot beep)
];

export function skipBoot(emu) {
  const { cpu } = emu;
  Object.assign(cpu, {
    a: 0x01,
    f: 0xb0,
    b: 0x00,
    c: 0x13,
    d: 0x00,
    e: 0xd8,
    h: 0x01,
    l: 0x4d,
    sp: 0xfffe,
    pc: 0x0100,
    ime: false,
    halted: false,
    imeEnableCountdown: 0,
  });
  if (emu.rom[0x14d] === 0) cpu.f = 0x80;
  emu.io.regs[0x40] = 0x91;
  emu.io.regs[0x47] = 0xfc;
  emu.io.regs[0x0f] = 0xe1;
  emu.io.divCounter = 0xab00;
  emu.io.tima = 0;
  emu.io.tma = 0;
  emu.io.tac = 0;
  emu.bus.ie = 0;
  for (const [offset, value] of POST_BOOT_APU) emu.io.regs[offset] = value;
}
