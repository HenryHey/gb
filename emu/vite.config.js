import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const opcodesPath = resolve(root, 'opcodes.json')
const publicOpcodesPath = resolve(root, 'public/opcodes.json')

function readOpcodesJson() {
  try {
    return readFileSync(opcodesPath)
  } catch {
    return Buffer.from('[]\n')
  }
}

function copyOpcodesToPublic() {
  mkdirSync(resolve(root, 'public'), { recursive: true })
  const contents = readOpcodesJson()
  if (existsSync(publicOpcodesPath) && readFileSync(publicOpcodesPath).equals(contents)) return
  writeFileSync(publicOpcodesPath, contents)
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
  plugins: [
    {
      name: 'serve-opcodes-json',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = req.url?.split('?')[0]
          if (url === '/opcodes.json' && req.method === 'GET') {
            res.setHeader('Content-Type', 'application/json')
            res.end(readOpcodesJson())
            return
          }
          next()
        })
        server.watcher.add(opcodesPath)
        server.watcher.on('change', (file) => {
          if (file === opcodesPath) server.ws.send({ type: 'full-reload' })
        })
      },
      buildStart() {
        copyOpcodesToPublic()
      },
    },
  ],
})
