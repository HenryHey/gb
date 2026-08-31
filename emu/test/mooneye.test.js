import { describe, expect, test } from 'bun:test';
import {
  decodeMooneyeSerial,
  includeMooneyeRom,
  listMooneyeRoms,
  loadMooneyeRom,
  MOONEYE_PASS,
  runMooneyeRom,
} from './mooneye.js';

const RUN_MOONEYE = Boolean(process.env.MOONEYE);

function formatSerial(serial) {
  return `[${serial.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`;
}

describe.skipIf(!RUN_MOONEYE)('mooneye acceptance', () => {
  const roms = listMooneyeRoms();

  test('ROM list is non-empty after DMG filtering', () => {
    expect(roms.length).toBeGreaterThan(0);
  });

  test('summary', () => {
    const tally = { pass: 0, fail: 0, timeout: 0, unknown: 0 };
    for (const relPath of roms) {
      const { result, serial } = runMooneyeRom(loadMooneyeRom(relPath));
      tally[result]++;
      const mark = result === 'pass' ? 'ok' : result;
      console.log(`${mark.padEnd(8)} ${relPath}${result !== 'pass' ? ' ' + formatSerial(serial) : ''}`);
    }
    console.log(
      `mooneye: ${tally.pass} pass, ${tally.fail} fail, ${tally.timeout} timeout, ${tally.unknown} unknown (${roms.length} total)`,
    );
  });

  for (const relPath of roms) {
    test(relPath, () => {
      const { result, serial } = runMooneyeRom(loadMooneyeRom(relPath));
      expect({ result, serial }).toEqual({ result: 'pass', serial: MOONEYE_PASS });
    });
  }
});

describe('mooneye harness', () => {
  test('includeMooneyeRom filters boot and non-DMG variants', () => {
    expect(includeMooneyeRom('boot_div-S.gb')).toBe(false);
    expect(includeMooneyeRom('boot_regs-dmgABC.gb')).toBe(false);
    expect(includeMooneyeRom('di_timing-GS.gb')).toBe(true);
    expect(includeMooneyeRom('ppu/vblank_stat_intr-GS.gb')).toBe(true);
    expect(includeMooneyeRom('bits/unused_hwio-GS.gb')).toBe(true);
    expect(includeMooneyeRom('boot_regs-sgb.gb')).toBe(false);
    expect(includeMooneyeRom('boot_regs-mgb.gb')).toBe(false);
    expect(includeMooneyeRom('instr/daa.gb')).toBe(true);
  });

  test('decodeMooneyeSerial recognizes pass, fail, and timeout', () => {
    expect(decodeMooneyeSerial(MOONEYE_PASS)).toBe('pass');
    expect(decodeMooneyeSerial([0x42, 0x42, 0x42, 0x42, 0x42, 0x42])).toBe('fail');
    expect(decodeMooneyeSerial([3, 5, 8])).toBe('timeout');
    expect(decodeMooneyeSerial([1, 2, 3, 4, 5, 6])).toBe('unknown');
  });

  test('instr/daa.gb passes when Mooneye ROMs are present', () => {
    const roms = listMooneyeRoms();
    if (!roms.includes('instr/daa.gb')) return;
    const { result, serial } = runMooneyeRom(loadMooneyeRom('instr/daa.gb'));
    expect(result).toBe('pass');
    expect(serial).toEqual(MOONEYE_PASS);
  });
});
