import { describe, expect } from 'bun:test'
import { C, F, getR8, itCb, makeCpu, R8N, setR8, tick } from './harness.js'

const KINDS = ['RLC', 'RRC', 'RL', 'RR', 'SLA', 'SRA', 'SWAP', 'SRL']

function rotShift(kind, v, carryIn) {
  let out
  let c
  switch (kind) {
    case 0:
      c = (v >> 7) & 1
      out = ((v << 1) | c) & 0xff
      break
    case 1:
      c = v & 1
      out = ((v >> 1) | (c << 7)) & 0xff
      break
    case 2:
      c = (v >> 7) & 1
      out = ((v << 1) | (carryIn ? 1 : 0)) & 0xff
      break
    case 3:
      c = v & 1
      out = ((v >> 1) | (carryIn ? 0x80 : 0)) & 0xff
      break
    case 4:
      c = (v >> 7) & 1
      out = (v << 1) & 0xff
      break
    case 5:
      c = v & 1
      out = (v >> 1) | (v & 0x80)
      break
    case 6:
      c = 0
      out = ((v & 0x0f) << 4) | (v >> 4)
      break
    default:
      c = v & 1
      out = v >> 1
  }
  return { out, c: !!c }
}

function cpuFor(cb, { v, f = 0 }) {
  const r = cb & 7
  const cpu = makeCpu({ bytes: [0xcb, cb], f, h: 0xc0, l: 0x00 })
  setR8(cpu, r, v)
  return cpu
}

describe('CB prefix', () => {
  describe('rotates, shifts, SWAP', () => {
    for (let kind = 0; kind < 8; kind++) {
      for (let r = 0; r < 8; r++) {
        const cb = (kind << 3) | r
        itCb(cb, `${KINDS[kind]} ${R8N[r]}`, () => {
          const v = 0x85
          const carryIn = true
          const cpu = cpuFor(cb, { v, f: carryIn ? C : 0 })
          const { out, c } = rotShift(kind, v, carryIn)
          expect(tick(cpu)).toBe(r === 6 ? 16 : 8)
          expect(cpu.pc).toBe(2)
          expect(getR8(cpu, r)).toBe(out)
          expect(cpu.f).toBe(F({ z: out === 0, c }))
        })
      }
    }
  })

  describe('BIT', () => {
    for (let bit = 0; bit < 8; bit++) {
      for (let r = 0; r < 8; r++) {
        const cb = 0x40 | (bit << 3) | r
        itCb(cb, `BIT ${bit}, ${R8N[r]}`, () => {
          const v = 0xa5
          const cpu = cpuFor(cb, { v, f: C })
          const z = ((v >> bit) & 1) === 0
          expect(tick(cpu)).toBe(r === 6 ? 12 : 8)
          expect(cpu.pc).toBe(2)
          expect(getR8(cpu, r)).toBe(v)
          expect(cpu.f).toBe(F({ z, h: true, c: true }))
        })
      }
    }
  })

  describe('RES', () => {
    for (let bit = 0; bit < 8; bit++) {
      for (let r = 0; r < 8; r++) {
        const cb = 0x80 | (bit << 3) | r
        itCb(cb, `RES ${bit}, ${R8N[r]}`, () => {
          const cpu = cpuFor(cb, { v: 0xff, f: C })
          expect(tick(cpu)).toBe(r === 6 ? 16 : 8)
          expect(getR8(cpu, r)).toBe(0xff & ~(1 << bit))
          expect(cpu.f).toBe(C)
        })
      }
    }
  })

  describe('SET', () => {
    for (let bit = 0; bit < 8; bit++) {
      for (let r = 0; r < 8; r++) {
        const cb = 0xc0 | (bit << 3) | r
        itCb(cb, `SET ${bit}, ${R8N[r]}`, () => {
          const cpu = cpuFor(cb, { v: 0x00, f: C })
          expect(tick(cpu)).toBe(r === 6 ? 16 : 8)
          expect(getR8(cpu, r)).toBe(1 << bit)
          expect(cpu.f).toBe(C)
        })
      }
    }
  })
})
