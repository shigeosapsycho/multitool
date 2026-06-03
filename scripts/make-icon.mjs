// Renders resources/icon.svg to PNGs at standard ICO sizes, packs them into a
// multi-resolution Windows .ico, and writes the icons used by the Tauri build
// (src-tauri/icons/) plus a copy in the renderer public dir for the favicon.
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

// Packs PNG-payload entries into a macOS .icns container. The OSTypes below all
// accept PNG data on macOS 10.7+ (the app targets 11.0), so no extra encoder is
// needed — sharp renders each size and we frame it with the 8-byte ICNS header.
async function makeIcns(source) {
  // [OSType, pixel size]. Retina variants (ic11..ic14) reuse the same pixels as
  // their 1x counterparts at the next size up, which is how .icns encodes @2x.
  const entries = [
    ['icp4', 16],
    ['icp5', 32],
    ['ic11', 32], // 16@2x
    ['ic12', 64], // 32@2x
    ['ic07', 128],
    ['ic13', 256], // 128@2x
    ['ic08', 256],
    ['ic14', 512], // 256@2x
    ['ic09', 512],
    ['ic10', 1024], // 512@2x
  ]
  const parts = []
  for (const [osType, size] of entries) {
    const png = await sharp(source)
      .resize(size, size, { fit: 'cover' })
      .png({ compressionLevel: 9 })
      .toBuffer()
    const header = Buffer.alloc(8)
    header.write(osType, 0, 'ascii')
    header.writeUInt32BE(png.length + 8, 4) // length includes the 8-byte header
    parts.push(header, png)
  }
  const body = Buffer.concat(parts)
  const fileHeader = Buffer.alloc(8)
  fileHeader.write('icns', 0, 'ascii')
  fileHeader.writeUInt32BE(body.length + 8, 4)
  return Buffer.concat([fileHeader, body])
}

const icns = await makeIcns(svg)

await fs.writeFile(join(root, 'resources', 'icon.ico'), ico)
await fs.writeFile(join(root, 'tool_icon.ico'), ico)
// renderer also serves a copy from public/
await fs.writeFile(join(root, 'src', 'renderer', 'public', 'tool_icon.ico'), ico)

// Tauri icon set: needs specific filenames at specific sizes in src-tauri/icons/.
const tauriIconsDir = join(root, 'src-tauri', 'icons')
await fs.mkdir(tauriIconsDir, { recursive: true })

const tauri32 = await sharp(svg).resize(32, 32).png({ compressionLevel: 9 }).toBuffer()
const tauri128 = await sharp(svg).resize(128, 128).png({ compressionLevel: 9 }).toBuffer()
const tauri256 = await sharp(svg).resize(256, 256).png({ compressionLevel: 9 }).toBuffer()
const tauri512 = await sharp(svg).resize(512, 512).png({ compressionLevel: 9 }).toBuffer()

await fs.writeFile(join(tauriIconsDir, '32x32.png'), tauri32)
await fs.writeFile(join(tauriIconsDir, '128x128.png'), tauri128)
await fs.writeFile(join(tauriIconsDir, '128x128@2x.png'), tauri256)
await fs.writeFile(join(tauriIconsDir, 'icon.png'), tauri512)
await fs.writeFile(join(tauriIconsDir, 'icon.ico'), ico)
// macOS bundle icon (used by the dmg/.app build; ignored on Windows).
await fs.writeFile(join(tauriIconsDir, 'icon.icns'), icns)

console.log(
  `Wrote ${ico.length.toLocaleString()} bytes -> resources/icon.ico, tool_icon.ico, src/renderer/public/tool_icon.ico, src-tauri/icons/{32x32,128x128,128x128@2x,icon}.png, src-tauri/icons/icon.ico, src-tauri/icons/icon.icns`
)
