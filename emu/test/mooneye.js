import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEmu, FRAME_T, reset, tickEmu } from '../src/emu.js';

export const MOONEYE_PASS = [3, 5, 8, 13, 21, 34];
export const MOONEYE_FAIL_BYTE = 0x42;

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const MOONEYE_ACCEPTANCE_DIR = join(REPO_ROOT, 'test_carts/mooneye/acceptance');

/** ~120 frames — enough for Mooneye's on-screen reporting path. */
export const MOONEYE_MAX_CYCLES = 120 * FRAME_T;

/** DMG-relevant acceptance ROMs; boot-ROM and other-model variants excluded. */
export function includeMooneyeRom(relPath) {
  const base = relPath.split('/').pop().replace(/\.gb$/, '');
  if (base.startsWith('boot_')) return false;
  if (base.endsWith('-dmg0')) return false;
  if (base.endsWith('-sgb2')) return false;
  if (base.endsWith('-sgb')) return false;
  if (base.endsWith('-mgb') && !base.includes('dmgABCmgb')) return false;
  if (base.endsWith('-S') && !base.endsWith('-GS')) return false;
  return true;
}

function walkGb(dir, root = dir) {
  const paths = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) paths.push(...walkGb(path, root));
    else if (name.endsWith('.gb')) paths.push(relative(root, path));
  }
  return paths.sort();
}

export function listMooneyeRoms({ acceptanceDir = MOONEYE_ACCEPTANCE_DIR } = {}) {
  return walkGb(acceptanceDir).filter(includeMooneyeRom);
}

export function loadMooneyeRom(relPath, { acceptanceDir = MOONEYE_ACCEPTANCE_DIR } = {}) {
  return readFileSync(join(acceptanceDir, relPath));
}

export function decodeMooneyeSerial(serial) {
  if (serial.length < 6) return 'timeout';
  if (serial.every((b) => b === MOONEYE_FAIL_BYTE)) return 'fail';
  if (serial.every((b, i) => b === MOONEYE_PASS[i])) return 'pass';
  return 'unknown';
}

export function runMooneyeRom(romBytes, { maxCycles = MOONEYE_MAX_CYCLES } = {}) {
  const emu = createEmu(romBytes);
  reset(emu);
  let cycles = 0;
  while (cycles < maxCycles && emu.io.serialOut.length < 6) {
    cycles += tickEmu(emu);
  }
  const serial = [...emu.io.serialOut];
  return { cycles, serial, result: decodeMooneyeSerial(serial) };
}
