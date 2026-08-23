export function registerControlOps(def) {
  def(0x00, 'NOP', () => 4);

  def(0x10, 'STOP', (cpu) => {
    cpu.pc = (cpu.pc + 1) & 0xffff;
    return 4;
  });

  def(0x76, 'HALT', (cpu) => {
    cpu.halted = true;
    return 4;
  });

  def(0xf3, 'DI', (cpu) => {
    cpu.ime = false;
    cpu.imeEnableCountdown = 0;
    return 4;
  });

  def(0xfb, 'EI', (cpu) => {
    cpu.imeEnableCountdown = 2;
    return 4;
  });
}
