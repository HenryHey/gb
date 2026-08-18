const CART_TYPES = {
  0x00: 'ROM ONLY',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+BATTERY',
  0x13: 'MBC3+RAM+BATTERY',
  // add others as you meet them; full table in Pan Docs
}

const ROM_BANKS = {
  0x00: 2,
  0x01: 4,
  0x02: 8,
  0x03: 16,
  0x04: 32,
  0x05: 64,
  0x06: 128,
}
const RAM_KIB = { 0x00: 0, 0x01: 2, 0x02: 8, 0x03: 32 }

function title(rom) {
  const bytes = rom.subarray(0x134, 0x144)
  let s = ''
  for (const b of bytes) {
    if (b === 0) break
    s += String.fromCharCode(b)
  }
  return s
}

/** Sum of $0134–$014C, as the boot ROM does. */
function headerChecksum(rom) {
  let x = 0
  for (let i = 0x134; i <= 0x14c; i++) {
    x = (x - rom[i] - 1) & 0xff
  }
  return x
}

export function parseHeader(rom) {
  if (rom.length < 0x150) throw new Error('ROM too small for a header')
  const type = rom[0x147]
  const romId = rom[0x148]
  const ramId = rom[0x149]
  return {
    title: title(rom),
    type,
    typeName: CART_TYPES[type] ?? `unknown($${type.toString(16)})`,
    romBytes: rom.length,
    romBanks: ROM_BANKS[romId],
    ramKiB: RAM_KIB[ramId] ?? 0,
    headerChecksum: rom[0x14d],
    headerChecksumOk: headerChecksum(rom) === rom[0x14d],
    cgbFlag: rom[0x143],
  }
}
