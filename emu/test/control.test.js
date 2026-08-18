import { describe, expect } from 'bun:test'
import { itOp, makeCpu, tick, Z } from './harness.js'

describe('control', () => {
  itOp(0x00, 'NOP advances PC and takes 4T', () => {
    const cpu = makeCpu({ bytes: [0x00], a: 0x12, f: Z, b: 0x34 })
    expect(tick(cpu)).toBe(4)
    expect(cpu.pc).toBe(1)
    expect(cpu.a).toBe(0x12)
    expect(cpu.f).toBe(Z)
    expect(cpu.b).toBe(0x34)
    expect(cpu.halted).toBe(false)
  })

  itOp(0x10, 'STOP consumes two bytes', () => {
    const cpu = makeCpu({ bytes: [0x10, 0x00], f: Z })
    expect(tick(cpu)).toBe(4)
    expect(cpu.pc).toBe(2)
    expect(cpu.f).toBe(Z)
  })

  itOp(0x76, 'HALT sets halted and takes 4T', () => {
    const cpu = makeCpu({ bytes: [0x76], f: Z })
    expect(tick(cpu)).toBe(4)
    expect(cpu.pc).toBe(1)
    expect(cpu.halted).toBe(true)
    expect(cpu.f).toBe(Z)
  })

  itOp(0xf3, 'DI clears IME immediately', () => {
    const cpu = makeCpu({ bytes: [0xf3], ime: true })
    expect(tick(cpu)).toBe(4)
    expect(cpu.pc).toBe(1)
    expect(cpu.ime).toBe(false)
  })

  itOp(0xfb, 'EI delays IME until the next instruction', () => {
    const cpu = makeCpu({ bytes: [0xfb], ime: false, imeEnableCountdown: 0 })
    expect(tick(cpu)).toBe(4)
    expect(cpu.pc).toBe(1)
    expect(cpu.ime).toBe(false)
    expect(cpu.imeEnableCountdown).toBeGreaterThan(0)
  })
})
