import { describe, expect, test } from 'bun:test';
import { createIo } from '../src/io.js';

describe('serial', () => {
  test('starting a transfer captures SB and clears SC bit 7', () => {
    const io = createIo();
    io.write(0xff01, 0x42);
    io.write(0xff02, 0x83);
    expect(io.read(0xff02) & 0x80).toBe(0);
    expect(io.serialOut).toEqual([0x42]);
  });

  test('Mooneye is_serial_broken sees a working port after writing SC=0', () => {
    const io = createIo();
    io.write(0xff02, 0);
    expect(io.read(0xff02) & 0x81).toBe(0);
  });

  test('multiple bytes accumulate in serialOut', () => {
    const io = createIo();
    for (const b of [3, 5, 8, 13, 21, 34]) {
      io.write(0xff01, b);
      io.write(0xff02, 0x83);
    }
    expect(io.serialOut).toEqual([3, 5, 8, 13, 21, 34]);
  });
});
