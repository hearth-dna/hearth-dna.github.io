// Serves the assembled GitHub Pages site (make pages-site) the way Pages does: files as they are,
// a directory as its index.html, anything else as 404.html with status 404. Built-ins only.
import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'

const [root = '.site', port = '5181'] = process.argv.slice(2)
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json',
}
createServer((req, res) => {
  let path = join(root, normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)))
  if (existsSync(path) && statSync(path).isDirectory()) path = join(path, 'index.html')
  const found = existsSync(path) && statSync(path).isFile()
  const file = found ? path : join(root, '404.html')
  res.writeHead(found ? 200 : 404, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' })
  createReadStream(file).pipe(res)
}).listen(Number(port), () => console.log(`serving ${root} on http://localhost:${port}/`))
