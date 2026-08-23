import { r8, w8, Z, C, H } from './helpers.js';

// op 0–7: RLC RRC RL RR SLA SRA SWAP SRL
function rotShift(op, v, cpu) {
  switch (op) {
    case 0: { // RLC — bit 7 wraps to bit 0 and C
      const c = (v >> 7) & 1;
      return { out: ((v << 1) | c) & 0xff, c };
    }
    case 1: { // RRC — bit 0 wraps to bit 7 and C
      const c = v & 1;
      return { out: ((v >> 1) | (c << 7)) & 0xff, c };
    }
    case 2: { // RL — rotate left through C
      const c = (v >> 7) & 1;
      return { out: ((v << 1) | (cpu.f & C ? 1 : 0)) & 0xff, c };
    }
    case 3: { // RR — rotate right through C
      const c = v & 1;
      return { out: ((v >> 1) | (cpu.f & C ? 0x80 : 0)) & 0xff, c };
    }
    case 4: { // SLA — shift left, incoming 0
      const c = (v >> 7) & 1;
      return { out: (v << 1) & 0xff, c };
    }
    case 5: { // SRA — arithmetic right, bit 7 copied
      const c = v & 1;
      return { out: (v >> 1) | (v & 0x80), c };
    }
    case 6: { // SWAP — exchange nibbles, C = 0
      return { out: ((v & 0x0f) << 4) | (v >> 4), c: 0 };
    }
    default: { // SRL — logical right, incoming 0
      const c = v & 1;
      return { out: v >> 1, c };
    }
  }
}


export function registerCbOps(defCB) {
  for (let byte = 0; byte < 256; byte++) {
    const r = byte & 7;
    const bit = (byte >> 3) & 7;
    const group = byte >> 6;
    defCB(byte, `CB ${byte.toString(16).padStart(2, '0').toUpperCase()}`, (cpu) => {
      const extra = r === 6; // (HL) costs more
      if (group === 0) {
        const v = r8[r](cpu);
        const { out, c } = rotShift(byte >> 3, v, cpu);
        w8[r](cpu, out);
        cpu.f = (out === 0 ? Z : 0) | (c ? C : 0); // N=H=0
        return extra ? 16 : 8;
      }
      if (group === 1) { // BIT
        const v = r8[r](cpu);
        const z = ((v >> bit) & 1) === 0;
        cpu.f = (cpu.f & C) | (z ? Z : 0) | H; // N=0, H=1
        return extra ? 12 : 8;
      }
      const v = r8[r](cpu);
      const out = group === 2 ? v & ~(1 << bit) : v | (1 << bit);
      w8[r](cpu, out);
      return extra ? 16 : 8;
    });
  }
}