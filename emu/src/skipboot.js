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
}
