// Renders resources/icon.svg to PNGs at standard ICO sizes, packs them into a
// multi-resolution Windows .ico, and writes resources/icon.ico (used by the
// running BrowserWindow) and tool_icon.ico (used by electron-builder for the
// .exe shell icon).
import { promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import pngToIco from 'png-to-ico'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'resources', 'icon.svg')
const sizes = [16, 24, 32, 48, 64, 128, 256]

const svg = await fs.readFile(svgPath)

const pngs = await Promise.all(
  sizes.map((size) =>
    sharp(svg)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer()
  )
)

const ico = await pngToIco(pngs)

await fs.writeFile(join(root, 'resources', 'icon.ico'), ico)
await fs.writeFile(join(root, 'tool_icon.ico'), ico)
// renderer also serves a copy from public/
await fs.writeFile(join(root, 'src', 'renderer', 'public', 'tool_icon.ico'), ico)

console.log(`Wrote ${ico.length.toLocaleString()} bytes -> resources/icon.ico, tool_icon.ico, src/renderer/public/tool_icon.ico`)
