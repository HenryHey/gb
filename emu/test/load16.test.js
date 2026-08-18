import { describe, expect } from 'bun:test'
import { F, itOp, makeCpu, pair, tick, Z } from './harness.js'

describe('16-bit loads', () => {
  describe('LD rr, nn', () => {
    itOp(0x01, 'LD BC, nn', () => {
      const cpu = makeCpu({ bytes: [0x01, 0x34, 0x12], f: Z })
      expect(tick(cpu)).toBe(12)
      expect(cpu.pc).toBe(3)
      expect(pair(cpu.b, cpu.c)).toBe(0x1234)
      expect(cpu.f).toBe(Z)
    })

    itOp(0x11, 'LD DE, nn', () => {
      const cpu = makeCpu({ bytes: [0x11, 0x34, 0x12] })
      expect(tick(cpu)).toBe(12)
      expect(pair(cpu.d, cpu.e)).toBe(0x1234)
    })

    itOp(0x21, 'LD HL, nn', () => {
      const cpu = makeCpu({ bytes: [0x21, 0x34, 0x12] })
      expect(tick(cpu)).toBe(12)
      expect(pair(cpu.h, cpu.l)).toBe(0x1234)
    })

    itOp(0x31, 'LD SP, nn', () => {
      const cpu = makeCpu({ bytes: [0x31, 0x34, 0x12] })
      expect(tick(cpu)).toBe(12)
      expect(cpu.sp).toBe(0x1234)
    })
  })

  itOp(0x08, 'LD (nn), SP', () => {
    const cpu = makeCpu({ bytes: [0x08, 0x00, 0xc0], sp: 0x1234 })
    expect(tick(cpu)).toBe(20)
    expect(cpu.pc).toBe(3)
    expect(cpu.bus.read8(0xc000)).toBe(0x34)
    expect(cpu.bus.read8(0xc001)).toBe(0x12)
  })

  itOp(0xf9, 'LD SP, HL', () => {
    const cpu = makeCpu({ bytes: [0xf9], h: 0x12, l: 0x34, sp: 0, f: Z })
    expect(tick(cpu)).toBe(8)
    expect(cpu.sp).toBe(0x1234)
    expect(cpu.f).toBe(Z)
  })

  itOp(0xf8, 'LD HL, SP+e', () => {
    const cpu = makeCpu({ bytes: [0xf8, 0x02], sp: 0x0fff, f: F({ z: true, n: true }) })
    expect(tick(cpu)).toBe(12)
    expect(cpu.pc).toBe(2)
    expect(pair(cpu.h, cpu.l)).toBe(0x1001)
    // Z=0 N=0; H/C from the low-byte add: 0xff+0x02 overflows bit 3 and bit 7
    expect(cpu.f).toBe(F({ h: true, c: true }))
  })

  itOp(0xf8, 'LD HL, SP+e negative', () => {
    const cpu = makeCpu({ bytes: [0xf8, 0xfe], sp: 0x1002 })
    tick(cpu)
    expect(pair(cpu.h, cpu.l)).toBe(0x1000)
  })

  describe('PUSH / POP', () => {
    itOp(0xc5, 'PUSH BC', () => {
      const cpu = makeCpu({ bytes: [0xc5], b: 0x12, c: 0x34, sp: 0xfffe })
      expect(tick(cpu)).toBe(16)
      expect(cpu.sp).toBe(0xfffc)
      expect(cpu.bus.read8(0xfffd)).toBe(0x12)
      expect(cpu.bus.read8(0xfffc)).toBe(0x34)
    })

    itOp(0xd5, 'PUSH DE', () => {
      const cpu = makeCpu({ bytes: [0xd5], d: 0x12, e: 0x34, sp: 0xfffe })
      tick(cpu)
      expect(cpu.bus.read8(0xfffd)).toBe(0x12)
      expect(cpu.bus.read8(0xfffc)).toBe(0x34)
    })

    itOp(0xe5, 'PUSH HL', () => {
      const cpu = makeCpu({ bytes: [0xe5], h: 0x12, l: 0x34, sp: 0xfffe })
      tick(cpu)
      expect(cpu.bus.read8(0xfffd)).toBe(0x12)
      expect(cpu.bus.read8(0xfffc)).toBe(0x34)
    })

    itOp(0xf5, 'PUSH AF', () => {
      const cpu = makeCpu({ bytes: [0xf5], a: 0x12, f: 0xf0, sp: 0xfffe })
      expect(tick(cpu)).toBe(16)
      expect(cpu.bus.read8(0xfffd)).toBe(0x12)
      expect(cpu.bus.read8(0xfffc)).toBe(0xf0)
    })

    itOp(0xc1, 'POP BC', () => {
      const cpu = makeCpu({
        bytes: [0xc1],
        sp: 0xfffc,
        mem: { 0xfffc: 0x34, 0xfffd: 0x12 },
      })
      expect(tick(cpu)).toBe(12)
      expect(cpu.sp).toBe(0xfffe)
      expect(pair(cpu.b, cpu.c)).toBe(0x1234)
    })

    itOp(0xd1, 'POP DE', () => {
      const cpu = makeCpu({
        bytes: [0xd1],
        sp: 0xfffc,
        mem: { 0xfffc: 0x34, 0xfffd: 0x12 },
      })
      tick(cpu)
      expect(pair(cpu.d, cpu.e)).toBe(0x1234)
    })

    itOp(0xe1, 'POP HL', () => {
      const cpu = makeCpu({
        bytes: [0xe1],
        sp: 0xfffc,
        mem: { 0xfffc: 0x34, 0xfffd: 0x12 },
      })
      tick(cpu)
      expect(pair(cpu.h, cpu.l)).toBe(0x1234)
    })

    itOp(0xf1, 'POP AF masks F', () => {
      const cpu = makeCpu({
        bytes: [0xf1],
        sp: 0xfffc,
        mem: { 0xfffc: 0xff, 0xfffd: 0x12 },
      })
      expect(tick(cpu)).toBe(12)
      expect(cpu.a).toBe(0x12)
      expect(cpu.f).toBe(0xf0)
    })
  })
})
