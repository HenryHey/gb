const CART_TYPES = {
  0x00: 'ROM ONLY',
  0x01: 'MBC1',
  0x02: 'MBC1+RAM',
  0x03: 'MBC1+RAM+BATTERY',
  0x13: 'MBC3+RAM+BATTERY',
  // add others as you meet them; full table in Pan Docs
};

const ROM_BANKS = {
  0x00: 2,
  0x01: 4,
  0x02: 8,
  0x03: 16,
  0x04: 32,
  0x05: 64,
  0x06: 128,
};
const RAM_KIB = { 0x00: 0, 0x01: 2, 0x02: 8, 0x03: 32 };

function title(rom) {
  const bytes = rom.subarray(0x134, 0x144);
  let s = '';
  for (const b of bytes) {
    if (b === 0) break;
    s += String.fromCharCode(b);
  }
  return s;
}

/** Sum of $0134–$014C, as the boot ROM does. */
function headerChecksum(rom) {
  let x = 0;
  for (let i = 0x134; i <= 0x14c; i++) {
    x = (x - rom[i] - 1) & 0xff;
  }
  return x;
}

export function parseHeader(rom) {
  if (rom.length < 0x150) throw new Error('ROM too small for a header');
  const type = rom[0x147];
  const romId = rom[0x148];
  const ramId = rom[0x149];
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
  };
}

function createRomOnly(rom) {
  return {
    readRom(addr) {
      return rom[addr] ?? 0xff;
    },
    writeRom(_addr, _v) {},
    readRam(_addr) {
      return 0xff;
    },
    writeRam(_addr, _v) {},
  };
}

function createMbc1(rom, header) {
  const romBanks = header.romBanks; // power of 2
  const ram = new Uint8Array((header.ramKiB || 0) * 1024);
  let ramEnable = false;
  let romBank = 1;
  let ramBank = 0;
  let mode = 0;

  function mapRom00() {
    // Mode 0: always bank 0. Mode 1: banks 0x00/0x20/0x40/0x60.
    if (mode === 0) return 0;

    // Mode 1 — bank index for $0000–$3FFF (low ROM nibble forced to 0):
    //   bit  6 5 4 3 2 1 0
    //        R R 0 0 0 0 0   ramBank<<5 → banks 0x00 / 0x20 / 0x40 / 0x60
    return ((ramBank & 3) << 5) & (romBanks - 1);
  }

  function mapRom40() {
    // Both modes: 2 upper bits | 5-bit ROM bank (already 1..31).

    // Bank index (both modes):
    //   bit  6 5 4 3 2 1 0
    //        R R r r r r r r   ramBank<<5 | romBank (1..31, never 0)
    return (((ramBank & 3) << 5) | (romBank & 0x1f)) & (romBanks - 1);
  }

  function ramOffset() {
    return (mode === 1 ? ramBank : 0) * 0x2000;
  }

  function sramIndex(addr) {
    let i = ramOffset() + (addr - 0xa000);
    if (header.ramKiB === 2) i &= 0x7ff;
    return i;
  }

  return {
    readRom(addr) {
      if (addr < 0x4000) {
        const b = mapRom00();
        return rom[b * 0x4000 + addr];
      }
      const b = mapRom40();
      return rom[b * 0x4000 + (addr - 0x4000)];
    },
    writeRom(addr, v) {
      if (addr < 0x2000) {
        ramEnable = (v & 0x0f) === 0x0a;
      } else if (addr < 0x4000) {
        romBank = v & 0x1f || 1;
      } else if (addr < 0x6000) {
        ramBank = v & 0x03;
      } else {
        mode = v & 0x01;
      }
    },
    readRam(addr) {
      if (!ramEnable || ram.length === 0) return 0xff;
      return ram[sramIndex(addr)] ?? 0xff;
    },
    writeRam(addr, v) {
      if (!ramEnable || ram.length === 0) return;
      ram[sramIndex(addr)] = v;
    },
  };
}

function createMbc3(rom, header) {
  const romBanks = header.romBanks; // 64 for Red
  const ram = new Uint8Array((header.ramKiB || 0) * 1024);
  let ramEnable = false;
  let romBank = 1;
  let ramBank = 0;

  return {
    ram, // for save/load
    readRom(addr) {
      if (addr < 0x4000) {
        return rom[addr];
      }
      const b = (romBank & romBanks -1) || 1;
      return rom[b * 0x4000 + (addr - 0x4000)];
      
    },
    // Writes to ROM space configure the MBC (data is never stored in ROM).
    // Register selected by address bits A14/A13 (A15=0 in $0000–$7FFF):
    //
    //   addr range     A14 A13   register
    //   $0000–$1FFF      0   0    RAM enable       (addr < 0x2000)
    //   $2000–$3FFF      0   1    ROM bank         (addr < 0x4000)
    //   $4000–$5FFF      1   0    RAM bank         (addr < 0x6000)
    //   $6000–$7FFF      1   1    RTC latch
    writeRom(addr, v) {
      if (addr < 0x2000) {
        // 0x0f = 0000 1111 — keep low nibble; 0x0A = 0000 1010
        ramEnable = (v & 0x0f) === 0x0a;
      } else if (addr < 0x4000) {
        // 0x7f = 0111 1111 — 7-bit bank index; || 1 when game writes 0
        romBank = (v & 0x7f) || 1;
      } else if (addr < 0x6000) {
        // 0x07 = 0000 0111 — SRAM banks 0–3 (8 KiB each at $A000–$BFFF)
        ramBank = v & 0x07;
      } else {
        // $6000–$7FFF: RTC latch (freeze clock) — no-op without a clock chip
      }
    },
    readRam(addr) {
      if (!ramEnable) return 0xff;
      if (ramBank <= 3) {
        const i = ramBank * 0x2000 + (addr - 0xa000);
        return ram[i] ?? 0xff;
      }
      // RTC $08-$0C (not implemented)
      return 0;
    },
    writeRam(addr, v) {
      if (!ramEnable) return;
      if (ramBank <= 3 && ram.length) {
        ram[ramBank * 0x2000 + (addr - 0xa000)] = v;
      } 
    },
  };
}

function saveKey(header) {
  return `gb-sram:${header.title}:${header.headerChecksum.toString(16)}`;
}

export function loadSram(cart, header) {
  const raw = localStorage.getItem(saveKey(header));
  if (!raw || !cart.ram?.length) return false;
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  cart.ram.set(bytes.subarray(0, cart.ram.length));
  return true;
}

export function saveSram(cart, header) {
  if (!cart.ram?.length) return;
  localStorage.setItem(
    saveKey(header),
    btoa(String.fromCharCode(...cart.ram)),
  );
}

export function createCart(rom) {
  const header = parseHeader(rom);

  if (header.type === 0x00) {
    return createRomOnly(rom);
  }

  if ([0x01, 0x02, 0x03].includes(header.type)) {
    return createMbc1(rom, header);
  }
  if (header.type === 0x13) {
    return createMbc3(rom, header);
  }

  throw new Error(`Mapper ${header.typeName} not implemented`);
}
