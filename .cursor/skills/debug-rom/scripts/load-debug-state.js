#!/usr/bin/env bun
/**
 * Load a GBSS JSON save state and resolve the matching ROM from roms/.
 *
 * Usage:
 *   bun .cursor/skills/debug-rom/scripts/load-debug-state.js state.json
 *   bun .cursor/skills/debug-rom/scripts/load-debug-state.js state.json --steps 100
 *   echo '{...}' | bun .cursor/skills/debug-rom/scripts/load-debug-state.js -
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractRomsFrom7z } from '../../../../emu/src/archive7z.js';
import { base64ToBytes, crc32, deserializeEmu } from '../../../../emu/src/savestate.js';
import { tickEmu } from '../../../../emu/src/emu.js';
import { cbOpNames, opNames } from '../../../../emu/src/ops/index.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ROMS_DIR = join(REPO_ROOT, 'roms');

function readPayload(path) {
  const raw = path === '-' ? readFileSync(0, 'utf8') : readFileSync(path, 'utf8');
  return JSON.parse(raw);
}

function readRomFile(path) {
  return new Uint8Array(readFileSync(path));
}

async function romFromArchive(archivePath, romFileName) {
  const buf = readFileSync(archivePath).buffer;
  const roms = await extractRomsFrom7z(buf);
  const match = roms.find((r) => r.name === romFileName || r.path.endsWith(`/${romFileName}`));
  if (!match) {
    const names = roms.map((r) => r.name).join(', ');
    throw new Error(`ROM "${romFileName}" not found in ${archivePath} (found: ${names || 'none'})`);
  }
  return match.data;
}

function walkRoms(dir, root = dir) {
  const hits = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const st = statSync(path);
    if (st.isDirectory()) {
      hits.push(...walkRoms(path, root));
      continue;
    }
    if (/\.(gb|gbc|7z)$/i.test(name)) {
      hits.push({ path, rel: path.slice(root.length + 1), name });
    }
  }
  return hits;
}

async function resolveRom(payload) {
  const { romFileName, archiveFileName, romCrc32, title } = payload;

  if (archiveFileName && romFileName) {
    const archivePath = join(ROMS_DIR, archiveFileName);
    const rom = await romFromArchive(archivePath, romFileName);
    if (crc32(rom) !== romCrc32) {
      throw new Error(
        `CRC mismatch for ${romFileName} in ${archiveFileName}: expected ${romCrc32}, got ${crc32(rom)}`,
      );
    }
    return { rom, source: `${archiveFileName} → ${romFileName}` };
  }

  if (romFileName) {
    const romPath = join(ROMS_DIR, romFileName);
    const rom = readRomFile(romPath);
    if (crc32(rom) !== romCrc32) {
      throw new Error(`CRC mismatch for ${romFileName}: expected ${romCrc32}, got ${crc32(rom)}`);
    }
    return { rom, source: romFileName };
  }

  if (!statSync(ROMS_DIR, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`roms/ not found at ${ROMS_DIR} — add the ROM or set romFileName in the save state`);
  }

  for (const entry of walkRoms(ROMS_DIR)) {
    if (entry.name.endsWith('.7z')) {
      const buf = readFileSync(entry.path).buffer;
      const roms = await extractRomsFrom7z(buf);
      for (const r of roms) {
        if (crc32(r.data) === romCrc32) {
          return { rom: r.data, source: `${entry.rel} → ${r.name}` };
        }
      }
      continue;
    }
    const rom = readRomFile(entry.path);
    if (crc32(rom) === romCrc32) {
      return { rom, source: entry.rel };
    }
  }

  throw new Error(
    `No ROM with CRC32 ${romCrc32} (${title ?? 'unknown title'}) under roms/. ` +
      'Copy the ROM there or include romFileName (and archiveFileName if loaded from .7z).',
  );
}

function formatOpcode(opcode, cb) {
  const hex = (n) => '$' + n.toString(16).padStart(2, '0').toUpperCase();
  if (cb != null) {
    const name = cbOpNames[cb] ?? 'CB';
    return `${name}(${hex(0xcb)} ${hex(cb)})`;
  }
  const name = opNames[opcode] ?? '???';
  return `${name}(${hex(opcode)})`;
}

function hex(n, w = 2) {
  return n.toString(16).padStart(w, '0').toUpperCase();
}

function summarize(emu) {
  const { cpu, ppu, io, bus } = emu;
  const opcode = bus.read8(cpu.pc);
  const cb = opcode === 0xcb ? bus.read8((cpu.pc + 1) & 0xffff) : null;
  return {
    title: payloadTitle(emu),
    pc: hex(cpu.pc, 4),
    sp: hex(cpu.sp, 4),
    af: hex((cpu.a << 8) | cpu.f, 4),
    bc: hex((cpu.b << 8) | cpu.c, 4),
    de: hex((cpu.d << 8) | cpu.e, 4),
    hl: hex((cpu.h << 8) | cpu.l, 4),
    ime: cpu.ime,
    halted: cpu.halted,
    imeEnableCountdown: cpu.imeEnableCountdown,
    ly: ppu.ly,
    lcdc: hex(ppu.lcdc),
    ie: hex(bus.ie),
    if_: hex(io.regs[0x0f]),
    divCounter: io.divCounter,
    instruction: formatOpcode(opcode, cb),
  };
}

function payloadTitle(emu) {
  const bytes = emu.rom.subarray(0x134, 0x144);
  return String.fromCharCode(...bytes).replace(/\0.*$/, '').trim();
}

function parseArgs(argv) {
  const positional = [];
  let steps = 0;
  let issue = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--steps') steps = Number(argv[++i]);
    else if (argv[i] === '--issue') issue = argv[++i];
    else positional.push(argv[i]);
  }
  return { path: positional[0], steps, issue };
}

const { path, steps, issue } = parseArgs(process.argv.slice(2));
if (!path) {
  console.error('Usage: bun load-debug-state.js <state.json|-> [--steps N] [--issue "description"]');
  process.exit(1);
}

const payload = readPayload(path);
if (payload.format !== 'GBSS') {
  throw new Error(`Expected format "GBSS", got ${JSON.stringify(payload.format)}`);
}

const { rom, source } = await resolveRom(payload);
const bytes = base64ToBytes(payload.base64);
const emu = deserializeEmu(bytes, rom);

if (steps > 0) {
  for (let i = 0; i < steps; i++) tickEmu(emu);
}

const out = {
  issue: issue ?? null,
  saveState: {
    format: payload.format,
    version: payload.version,
    title: payload.title,
    romCrc32: payload.romCrc32,
    romFileName: payload.romFileName ?? null,
    archiveFileName: payload.archiveFileName ?? null,
  },
  rom: { source, bytes: rom.length, crc32: crc32(rom) },
  machine: summarize(emu),
  stepsRun: steps,
};

console.log(JSON.stringify(out, null, 2));
