import './opcodes.css'
import tables from './gb-opcodes.json'

const R16 = new Set(['AF', 'BC', 'DE', 'HL', 'SP'])
const HEX = '0123456789ABCDEF'

function formatOperand(op, next) {
  if (op.increment && next?.name === 'e8') return `${op.name} + e8`
  let name = op.name
  if (op.increment) name += '+'
  if (op.decrement) name += '-'
  return op.immediate ? name : `[${name}]`
}

function formatMnemonic(op) {
  if (!op || op.mnemonic.startsWith('ILLEGAL')) return '—'
  if (op.mnemonic === 'PREFIX') return 'PREFIX $CB'
  const parts = []
  const operands = op.operands ?? []
  for (let i = 0; i < operands.length; i++) {
    const cur = operands[i]
    const next = operands[i + 1]
    parts.push(formatOperand(cur, next))
    if (cur.increment && next?.name === 'e8') i++
  }
  return parts.length ? `${op.mnemonic} ${parts.join(', ')}` : op.mnemonic
}

function group(op, prefixed) {
  if (!op || op.mnemonic.startsWith('ILLEGAL')) return 'illegal'
  if (prefixed) return 'bit'
  const m = op.mnemonic
  if (['NOP', 'STOP', 'HALT', 'DI', 'EI', 'PREFIX'].includes(m)) return 'control'
  if (['JR', 'JP', 'RET', 'RETI', 'CALL', 'RST'].includes(m)) return 'jump'
  if (['PUSH', 'POP'].includes(m)) return 'load16'
  if (m === 'LDH') return 'load'
  if (['RLCA', 'RLA', 'RRCA', 'RRA'].includes(m)) return 'bit'
  if (
    [
      'ADD',
      'ADC',
      'SUB',
      'SBC',
      'AND',
      'XOR',
      'OR',
      'CP',
      'INC',
      'DEC',
      'DAA',
      'CPL',
      'SCF',
      'CCF',
    ].includes(m)
  ) {
    const dest = op.operands?.[0]
    if (dest && R16.has(dest.name) && dest.immediate) return 'arithmetic16'
    return 'arithmetic'
  }
  if (m === 'LD') {
    const dest = op.operands?.[0]
    const src = op.operands?.[1]
    if (dest && R16.has(dest.name) && dest.immediate) return 'load16'
    if (src?.name === 'SP') return 'load16'
    return 'load'
  }
  return 'control'
}

function implementedSets(list) {
  const unprefixed = new Set()
  const cbprefixed = new Set()
  for (const item of list) {
    const raw = String(item.opcode).toUpperCase()
    const cb = raw.match(/\$CB\s*\$?([0-9A-F]{2})/)
    if (cb) {
      cbprefixed.add(parseInt(cb[1], 16))
      continue
    }
    const hex = raw.replace(/\$/g, '').trim()
    if (/^[0-9A-F]{1,2}$/.test(hex)) unprefixed.add(parseInt(hex, 16))
  }
  return { unprefixed, cbprefixed }
}

async function loadImplemented() {
  const res = await fetch('/opcodes.json', { cache: 'no-store' })
  if (!res.ok) throw new Error('Could not read opcodes.json')
  return implementedSets(await res.json())
}

function renderTable(ops, done, prefixed) {
  const table = document.createElement('table')
  table.className = 'op-table'
  const head = table.createTHead().insertRow()
  head.insertCell().textContent = ''
  for (const col of HEX) {
    const th = document.createElement('th')
    th.textContent = `x${col}`
    head.appendChild(th)
  }

  const body = table.createTBody()
  for (let hi = 0; hi < 16; hi++) {
    const row = body.insertRow()
    const rh = document.createElement('th')
    rh.className = 'row-h'
    rh.textContent = `${HEX[hi]}x`
    row.appendChild(rh)
    for (let lo = 0; lo < 16; lo++) {
      const code = (hi << 4) | lo
      const key = '0x' + code.toString(16).padStart(2, '0').toUpperCase()
      const op = ops[key]
      const cell = row.insertCell()
      const kind = group(op, prefixed)
      cell.className = kind
      if (done.has(code)) cell.classList.add('implemented')
      if (kind === 'illegal') {
        cell.textContent = '—'
        continue
      }
      const cycles = (op.cycles ?? []).join('/')
      const flags = op.flags ?? {}
      cell.innerHTML =
        `<div class="mn">${formatMnemonic(op)}</div>` +
        `<div class="meta"><span>${op.bytes ?? ''}</span><span>${cycles}</span></div>` +
        `<div class="flags">${flags.Z ?? '-'} ${flags.N ?? '-'} ${flags.H ?? '-'} ${flags.C ?? '-'}</div>`
    }
  }
  return table
}

const done = await loadImplemented()
document
  .querySelector('#unprefixed')
  .appendChild(renderTable(tables.unprefixed, done.unprefixed, false))
document
  .querySelector('#cbprefixed')
  .appendChild(renderTable(tables.cbprefixed, done.cbprefixed, true))
document.querySelector('#status').textContent =
  `${done.unprefixed.size} / 256 unprefixed · ${done.cbprefixed.size} / 256 CB implemented`
