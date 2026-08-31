import { describe, expect, test } from 'bun:test';
import { createBus } from '../src/bus.js';
import { createIo } from '../src/io.js';
import { createJoypad, readP1, writeP1 } from '../src/joypad.js';
import { createPpu } from '../src/ppu.js';
import { createEmu, reset } from '../src/emu.js';

function makeBus(romBytes = []) {
  const rom = Uint8Array.from(romBytes);
  const io = createIo();
  const ppu = createPpu();
  return { bus: createBus({ rom, io, ppu }), io, rom, ppu };
}

describe('joypad', () => {
  test('default read matches skip-boot P1 ($CF)', () => {
    const j = createJoypad();
    expect(readP1(j)).toBe(0xcf);
  });

  test('write stores only bits 5–4', () => {
    const j = createJoypad();
    writeP1(j, 0xab);
    expect(j.selectWrite).toBe(0x20);
    expect(readP1(j) & 0x30).toBe(0x20);
  });

  test('action row: A pressed is active-low on bit 0', () => {
    const j = createJoypad();
    writeP1(j, 0x10); // bit 5 = 0 selects action buttons
    j.a = true;
    expect(readP1(j)).toBe(0xde);
  });

  test('d-pad row: Right pressed is active-low on bit 0', () => {
    const j = createJoypad();
    writeP1(j, 0x20); // bit 4 = 0 selects d-pad
    j.right = true;
    expect(readP1(j)).toBe(0xee);
  });

  test('neither row selected returns nibble $F', () => {
    const j = createJoypad();
    writeP1(j, 0x30);
    j.a = true;
    j.right = true;
    expect(readP1(j)).toBe(0xff);
  });

  test('both rows selected ANDs the two nibbles', () => {
    const j = createJoypad();
    writeP1(j, 0x00);
    j.a = true;
    j.right = true;
    expect(readP1(j)).toBe(0xce);
  });

  test('bus read/write at $FF00', () => {
    const { bus, io } = makeBus();
    expect(bus.read8(0xff00)).toBe(0xcf);
    bus.write8(0xff00, 0x10);
    io.joypad.a = true;
    expect(bus.read8(0xff00)).toBe(0xde);
  });
});

describe('chapter 12 checkpoint', () => {
  test('reset clears pressed buttons', () => {
    const emu = createEmu(new Uint8Array(0x8000));
    emu.io.joypad.a = true;
    emu.io.joypad.down = true;
    reset(emu);
    expect(emu.io.joypad.a).toBe(false);
    expect(emu.io.joypad.down).toBe(false);
    expect(emu.bus.read8(0xff00)).toBe(0xcf);
  });

  test('all eight buttons map to correct bits when their row is selected', () => {
    const j = createJoypad();

    writeP1(j, 0x10);
    j.start = true;
    expect(readP1(j) & 0x08).toBe(0);
    j.start = false;
    j.select = true;
    expect(readP1(j) & 0x04).toBe(0);
    j.select = false;
    j.b = true;
    expect(readP1(j) & 0x02).toBe(0);
    j.b = false;
    j.a = true;
    expect(readP1(j) & 0x01).toBe(0);

    writeP1(j, 0x20);
    j.a = false;
    j.down = true;
    expect(readP1(j) & 0x08).toBe(0);
    j.down = false;
    j.up = true;
    expect(readP1(j) & 0x04).toBe(0);
    j.up = false;
    j.left = true;
    expect(readP1(j) & 0x02).toBe(0);
    j.left = false;
    j.right = true;
    expect(readP1(j) & 0x01).toBe(0);
  });
});
