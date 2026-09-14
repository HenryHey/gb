import { describe, expect, test } from 'bun:test';
import { ramKiBFromCode, romBanksFromCode } from '../src/cart.js';

describe('romBanksFromCode', () => {
  test.each([
    [0x00, 2],
    [0x01, 4],
    [0x02, 8],
    [0x03, 16],
    [0x04, 32],
    [0x05, 64],
    [0x06, 128],
    [0x07, 256],
    [0x08, 512],
    [0x52, 72],
    [0x53, 80],
    [0x54, 96],
  ])('$0148 = $%02x → %i banks', (romId, banks) => {
    expect(romBanksFromCode(romId)).toBe(banks);
  });

  test('unknown ROM size code returns undefined', () => {
    expect(romBanksFromCode(0xff)).toBeUndefined();
    expect(romBanksFromCode(0x09)).toBeUndefined();
  });
});

describe('ramKiBFromCode', () => {
  test.each([
    [0x00, 0],
    [0x01, 2],
    [0x02, 8],
    [0x03, 32],
    [0x04, 128],
    [0x05, 64],
  ])('$0149 = $%02x → %i KiB', (ramId, kiB) => {
    expect(ramKiBFromCode(ramId)).toBe(kiB);
  });

  test('unknown RAM size code returns undefined', () => {
    expect(ramKiBFromCode(0xff)).toBeUndefined();
    expect(ramKiBFromCode(0x06)).toBeUndefined();
  });
});
