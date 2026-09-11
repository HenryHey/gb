import { describe, expect, test } from 'bun:test';
import SevenZip from '7z-wasm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { extractRomsFrom7z } from '../src/archive7z.js';

const root = resolve(import.meta.dir, '..');

function minimalRom(title) {
  const rom = new Uint8Array(0x8000).fill(0xff);
  rom[0x147] = 0x00;
  for (let i = 0; i < title.length && i < 16; i++) rom[0x134 + i] = title.charCodeAt(i);
  return rom;
}

async function makeTestArchive() {
  const sevenZip = await SevenZip({ print: () => {}, printErr: () => {} });
  sevenZip.FS.writeFile('/tetris.gb', minimalRom('TETRIS'));
  sevenZip.FS.writeFile(
    '/halt_bug.gb',
    readFileSync(resolve(root, '../test_carts/blargg/halt_bug.gb')),
  );
  sevenZip.callMain(['a', 'test.7z', 'tetris.gb', 'halt_bug.gb']);
  return sevenZip.FS.readFile('test.7z').buffer;
}

describe('extractRomsFrom7z', () => {
  test('extracts all .gb files from a .7z archive', async () => {
    const archive = await makeTestArchive();
    const roms = await extractRomsFrom7z(archive);

    expect(roms).toHaveLength(2);
    expect(roms.map((r) => r.name).sort()).toEqual(['halt_bug.gb', 'tetris.gb']);
    expect(roms[0].data.length).toBeGreaterThan(0);
  });

  test('throws when archive has no ROMs', async () => {
    const sevenZip = await SevenZip({ print: () => {}, printErr: () => {} });
    sevenZip.FS.writeFile('/readme.txt', 'no roms here');
    sevenZip.callMain(['a', 'empty.7z', 'readme.txt']);
    const archive = sevenZip.FS.readFile('empty.7z').buffer;

    await expect(extractRomsFrom7z(archive)).rejects.toThrow('No .gb or .gbc ROM found');
  });
});
