import { describe, expect } from 'bun:test'
import { C, F, getR8, itOp, makeCpu, R8N, setR8, tick, Z } from './harness.js'

function add8(a, b, cin) {
  const sum = a + b + cin
  return {
    r: sum & 0xff,
    f: F({
      z: (sum & 0xff) === 0,
      h: (a & 0xf) + (b & 0xf) + cin > 0xf,
      c: sum > 0xff,
    }),
  }
}

function sub8(a, b, bin) {
  const diff = a - b - bin
  return {
    r: diff & 0xff,
    f: F({
      z: (diff & 0xff) === 0,
      n: true,
      h: (a & 0xf) - (b & 0xf) - bin < 0,
      c: diff < 0,
    }),
  }
}

function setupR8(opcode, { a, src, f = 0 }) {
  const r = opcode & 7
  const cpu = makeCpu({ bytes: [opcode], a, f, h: 0xc0, l: 0x00 })
  if (r === 7) cpu.a = src
  else setR8(cpu, r, src)
  return cpu
}

function expectAlu(cpu, { a, f, srcKept, r }) {
  expect(cpu.a).toBe(a)
  expect(cpu.f).toBe(f)
  expect(cpu.pc).toBe(1)
  if (r !== 7 && srcKept != null) expect(getR8(cpu, r)).toBe(srcKept)
}

describe('8-bit ALU', () => {
  describe('ADD A, r', () => {
    for (let r = 0; r < 8; r++) {
      const op = 0x80 | r
      itOp(op, `ADD A, ${R8N[r]} half-carry`, () => {
        const src = r === 7 ? 0x0f : 0x01
        const a = r === 7 ? 0x0f : 0x0f
        const cpu = setupR8(op, { a, src })
        const { r: out, f } = add8(cpu.a, src, 0)
        expect(tick(cpu)).toBe(r === 6 ? 8 : 4)
        expectAlu(cpu, { a: out, f, srcKept: src, r })
      })

      itOp(op, `ADD A, ${R8N[r]} zero + carry`, () => {
        const src = r === 7 ? 0x80 : 0x01
        const a = r === 7 ? 0x80 : 0xff
        const cpu = setupR8(op, { a, src, f: C })
        const { r: out, f } = add8(a, src, 0)
        tick(cpu)
        expectAlu(cpu, { a: out, f, srcKept: src, r })
      })
    }
  })

  describe('ADC A, r', () => {
    for (let r = 0; r < 8; r++) {
      const op = 0x88 | r
      itOp(op, `ADC A, ${R8N[r]} with C`, () => {
        const src = r === 7 ? 0x0f : 0x00
        const a = r === 7 ? 0x0f : 0x0f
        const cpu = setupR8(op, { a, src, f: C })
        const { r: out, f } = add8(a, src, 1)
        expect(tick(cpu)).toBe(r === 6 ? 8 : 4)
        expectAlu(cpu, { a: out, f, srcKept: src, r })
      })
    }
  })

  describe('SUB A, r', () => {
    for (let r = 0; r < 8; r++) {
      const op = 0x90 | r
      itOp(op, `SUB A, ${R8N[r]}`, () => {
        const src = r === 7 ? 0x10 : 0x01
        const a = r === 7 ? 0x10 : 0x10
        const cpu = setupR8(op, { a, src })
        const { r: out, f } = sub8(a, src, 0)
        expect(tick(cpu)).toBe(r === 6 ? 8 : 4)
        expectAlu(cpu, { a: out, f, srcKept: src, r })
      })
    }
  })

  describe('SBC A, r', () => {
    for (let r = 0; r < 8; r++) {
      const op = 0x98 | r
      itOp(op, `SBC A, ${R8N[r]} with C`, () => {
        const src = r === 7 ? 0x08 : 0x00
        const a = r === 7 ? 0x08 : 0x10
        const cpu = setupR8(op, { a, src, f: C })
        const { r: out, f } = sub8(a, src, 1)
        tick(cpu)
        expectAlu(cpu, { a: out, f, srcKept: src, r })
      })
    }
  })

  describe('AND / XOR / OR / CP', () => {
    for (let r = 0; r < 8; r++) {
      itOp(0xa0 | r, `AND A, ${R8N[r]}`, () => {
        const src = r === 7 ? 0xf0 : 0x0f
        const a = r === 7 ? 0xf0 : 0xff
        const cpu = setupR8(0xa0 | r, { a, src, f: C })
        const out = a & src
        expect(tick(cpu)).toBe(r === 6 ? 8 : 4)
        expectAlu(cpu, { a: out, f: F({ z: out === 0, h: true }), srcKept: src, r })
      })

      itOp(0xa8 | r, `XOR A, ${R8N[r]}`, () => {
        const src = r === 7 ? 0xff : 0xff
        const a = r === 7 ? 0xff : 0xff
        const cpu = setupR8(0xa8 | r, { a, src, f: C })
        const out = a ^ src
        tick(cpu)
        expectAlu(cpu, { a: out, f: F({ z: out === 0 }), srcKept: src, r })
      })

      itOp(0xb0 | r, `OR A, ${R8N[r]}`, () => {
        const src = r === 7 ? 0x00 : 0x0f
        const a = r === 7 ? 0x00 : 0xf0
        const cpu = setupR8(0xb0 | r, { a, src, f: C })
        const out = a | src
        tick(cpu)
        expectAlu(cpu, { a: out, f: F({ z: out === 0 }), srcKept: src, r })
      })

      itOp(0xb8 | r, `CP A, ${R8N[r]}`, () => {
        const src = r === 7 ? 0x10 : 0x01
        const a = r === 7 ? 0x10 : 0x10
        const cpu = setupR8(0xb8 | r, { a, src })
        const { f } = sub8(a, src, 0)
        expect(tick(cpu)).toBe(r === 6 ? 8 : 4)
        expectAlu(cpu, { a, f, srcKept: src, r })
      })
    }
  })

  describe('ALU A, n', () => {
    itOp(0xc6, 'ADD A, n', () => {
      const cpu = makeCpu({ bytes: [0xc6, 0x01], a: 0x0f })
      const { r, f } = add8(0x0f, 0x01, 0)
      expect(tick(cpu)).toBe(8)
      expect(cpu.pc).toBe(2)
      expect(cpu.a).toBe(r)
      expect(cpu.f).toBe(f)
    })

    itOp(0xce, 'ADC A, n', () => {
      const cpu = makeCpu({ bytes: [0xce, 0x00], a: 0x0f, f: C })
      const { r, f } = add8(0x0f, 0x00, 1)
      tick(cpu)
      expect(cpu.a).toBe(r)
      expect(cpu.f).toBe(f)
    })

    itOp(0xd6, 'SUB A, n', () => {
      const cpu = makeCpu({ bytes: [0xd6, 0x01], a: 0x10 })
      const { r, f } = sub8(0x10, 0x01, 0)
      tick(cpu)
      expect(cpu.a).toBe(r)
      expect(cpu.f).toBe(f)
    })

    itOp(0xde, 'SBC A, n', () => {
      const cpu = makeCpu({ bytes: [0xde, 0x00], a: 0x10, f: C })
      const { r, f } = sub8(0x10, 0x00, 1)
      tick(cpu)
      expect(cpu.a).toBe(r)
      expect(cpu.f).toBe(f)
    })

    itOp(0xe6, 'AND A, n', () => {
      const cpu = makeCpu({ bytes: [0xe6, 0x0f], a: 0xff, f: C })
      tick(cpu)
      expect(cpu.a).toBe(0x0f)
      expect(cpu.f).toBe(F({ h: true }))
    })

    itOp(0xee, 'XOR A, n', () => {
      const cpu = makeCpu({ bytes: [0xee, 0xff], a: 0xff, f: C })
      tick(cpu)
      expect(cpu.a).toBe(0)
      expect(cpu.f).toBe(Z)
    })

    itOp(0xf6, 'OR A, n', () => {
      const cpu = makeCpu({ bytes: [0xf6, 0x0f], a: 0xf0, f: C })
      tick(cpu)
      expect(cpu.a).toBe(0xff)
      expect(cpu.f).toBe(0)
    })

    itOp(0xfe, 'CP A, n', () => {
      const cpu = makeCpu({ bytes: [0xfe, 0x01], a: 0x10 })
      const { f } = sub8(0x10, 0x01, 0)
      tick(cpu)
      expect(cpu.a).toBe(0x10)
      expect(cpu.f).toBe(f)
    })
  })
})

describe('INC / DEC r', () => {
  const inc = [0x04, 0x0c, 0x14, 0x1c, 0x24, 0x2c, 0x34, 0x3c]
  const dec = [0x05, 0x0d, 0x15, 0x1d, 0x25, 0x2d, 0x35, 0x3d]

  for (let r = 0; r < 8; r++) {
    itOp(inc[r], `INC ${R8N[r]}`, () => {
      const cpu = makeCpu({ bytes: [inc[r]], f: C, h: 0xc0, l: 0x00 })
      setR8(cpu, r, 0x0f)
      const t = tick(cpu)
      expect(t).toBe(r === 6 ? 12 : 4)
      expect(getR8(cpu, r)).toBe(0x10)
      expect(cpu.f).toBe(F({ h: true, c: true }))
    })

    itOp(inc[r], `INC ${R8N[r]} wraps to zero`, () => {
      const cpu = makeCpu({ bytes: [inc[r]], f: 0, h: 0xc0, l: 0x00 })
      setR8(cpu, r, 0xff)
      tick(cpu)
      expect(getR8(cpu, r)).toBe(0)
      expect(cpu.f).toBe(F({ z: true, h: true }))
    })

    itOp(dec[r], `DEC ${R8N[r]}`, () => {
      const cpu = makeCpu({ bytes: [dec[r]], f: C, h: 0xc0, l: 0x00 })
      setR8(cpu, r, 0x10)
      expect(tick(cpu)).toBe(r === 6 ? 12 : 4)
      expect(getR8(cpu, r)).toBe(0x0f)
      expect(cpu.f).toBe(F({ n: true, h: true, c: true }))
    })

    itOp(dec[r], `DEC ${R8N[r]} to zero`, () => {
      const cpu = makeCpu({ bytes: [dec[r]], f: 0, h: 0xc0, l: 0x00 })
      setR8(cpu, r, 0x01)
      tick(cpu)
      expect(getR8(cpu, r)).toBe(0)
      expect(cpu.f).toBe(F({ z: true, n: true }))
    })
  }
})
