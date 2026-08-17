import { log } from './debug.js'

export function createCpu(bus) {
    return {
        bus,
        a: 0, f: 0, b: 0, c: 0, d: 0, e: 0, h: 0, l: 0,
        sp: 0, pc: 0,
        ime: false,
        halted: false,
        imeEnableCountdown: 0, // chapter 6
    }
}

// flags
export const Z = 0x80, N = 0x40, H = 0x20, C = 0x10;

export function setZNHC(cpu, { z, n, h, c }) {
    cpu.f = (cpu.f & 0x0f) // stays 0
        | (z ? Z : 0) | (n ? N : 0) | (h ? H : 0) | (c ? C : 0);
    cpu.f &= 0xf0;
}

export function step(cpu, ops, cbOps) {
    const opcode = cpu.bus.read8(cpu.pc);
    cpu.pc = (cpu.pc + 1) & 0xffff;
    if (opcode === 0xcb) {
        const cb = cpu.bus.read8(cpu.pc);
        cpu.pc = (cpu.pc + 1) & 0xffff;
        return cbOps[cb](cpu); // chapter 4
    }
    const fn = ops[opcode];
    if (!fn) throw new Error(`unimplemented ${opcode.toString(16)} at ${(cpu.pc - 1).toString(16)}`);
    return fn(cpu);
}


function readImm8(cpu) {
    const v = cpu.bus.read8(cpu.pc);
    cpu.pc = (cpu.pc + 1) & 0xffff;
    return v;
}

function readImm16(cpu) {
    const lo = readImm8(cpu);
    const hi = readImm8(cpu);
    return lo | (hi << 8);
}

/**
 * Sign-extends an 8-bit unsigned value to a signed 8-bit integer.
 * readImm8 gives an unsigned byte (0–255), 
 * but Game Boy JR uses a signed 8-bit displacement (-128…+127).
 *
 * JavaScript has no int8, so this uses 32-bit arithmetic shifts:  
 *  << 24 moves the byte into bit 31 (the 32-bit sign bit).  
 *  \>> 24 is an arithmetic right shift, so the sign bit is copied into the vacated bits.
 */
function toSigned(v) {
    return (v << 24) >> 24;
}

function nop(cpu) {
    return 4;
}

function halt(cpu) {
    cpu.halted = true;
    return 4;
}

function jr(cpu) {
    const e = toSigned(readImm8(cpu));
    cpu.pc = (cpu.pc + e) & 0xffff;
    return 12;
}

function lda(cpu) {
    const e = readImm8(cpu);
    cpu.a = e;
    return 8;
}

function ldb(cpu) {
    const e = readImm8(cpu);
    cpu.b = e;
    return 8;
}

function inc8(cpu, getter, setter) {
    const v = getter();
    const r = (v + 1) & 0xff;
    setter(r);
    cpu.f = (cpu.f & C) | (r === 0 ? Z : 0) | (((v & 0xf) + 1) > 0xf ? H : 0);
    return 4;
}

function dec8(cpu, getter, setter) {
    const v = getter();
    const r = (v - 1) & 0xff;
    setter(r);
    // cpu.f = (cpu.f & C) | (r === 0 ? Z : 0) | (((b & 0xf) === 0 ? H : 0));
    return 4;
}

export const ops = [];
export const opNames = [];
export const opLen = [];
function def(op, name, fn, len = 1) {
    ops[op] = fn;
    opNames[op] = name;
    opLen[op] = len;
}
def(0x00, 'NOP', nop);
def(0x04, 'INC B', (cpu) => inc8(cpu, () => cpu.b, (v) => { cpu.b = v; }));
def(0x05, 'DEC B', (cpu) => dec8(cpu, () => cpu.b, (v) => { cpu.b = v; }));
def(0x06, 'LD B, n', ldb, 2);
def(0x18, 'JR e', jr, 2);
def(0x3e, 'LD A, n', lda, 2);
def(0x76, 'HALT', halt);

export const cbOps = [];
export const cbOpNames = [];


export function romBus(bytes) {
    const mem = new Uint8Array(0x10000);
    mem.set(bytes, 0);
    return {
        read8: (a) => mem[a & 0xffff],
        write8: (a, v) => { mem[a & 0xffff] = v; },
    };
}