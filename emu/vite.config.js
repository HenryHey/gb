import { defineConfig } from 'vite'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const opcodesPath = resolve(root, 'opcodes.json')
const publicOpcodesPath = resolve(root, 'public/opcodes.json')

function writeIfChanged(path, contents) {
  let prev = ''
  try {
    prev = readFileSync(path, 'utf8')
  } catch {
    /* missing is fine */
  }
  if (prev === contents) return
  writeFileSync(path, contents)
}

async function writeOpcodesFromTables() {
  const url = pathToFileURL(resolve(root, 'src/ops.js')).href + '?t=' + Date.now()
  const { listImplementedOpcodes } = await import(url)
  const json = JSON.stringify(listImplementedOpcodes(), null, 2) + '\n'
  writeIfChanged(opcodesPath, json)
  writeIfChanged(publicOpcodesPath, json)
}

function sendOpcodesJson(req, res, next) {
  const url = req.url?.split('?')[0]
  if (url === '/opcodes.json' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json')
    res.end(readFileSync(opcodesPath))
    return
  }
  if (url !== '/__write-opcodes' || req.method !== 'POST') {
    next()
    return
  }
  const chunks = []
  req.on('data', (chunk) => chunks.push(chunk))
  req.on('end', () => {
    writeIfChanged(opcodesPath, Buffer.concat(chunks).toString('utf8'))
    writeIfChanged(publicOpcodesPath, Buffer.concat(chunks).toString('utf8'))
    res.statusCode = 204
    res.end()
  })
}

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        opcodes: resolve(root, 'opcodes.html'),
      },
    },
  },
  server: {
    watch: {
      ignored: ['**/opcodes.json'],
    },
  },
  plugins: [
    {
      name: 'write-opcodes-json',
      async configureServer(server) {
        await writeOpcodesFromTables()
        server.middlewares.use(sendOpcodesJson)
      },
      async buildStart() {
        await writeOpcodesFromTables()
      },
      async handleHotUpdate({ file }) {
        if (file.endsWith('ops.js')) await writeOpcodesFromTables()
      },
    },
  ],
})
