// Renders build/icon.svg -> build/icon.png (1024x1024) and build/icon.ico (multi-size).
// electron-builder builds icon.icns itself from the PNG for the mac target; the Windows
// target uses the .ico.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIco } from './ico.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const svg = readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf-8')
const render = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

writeFileSync(path.join(__dirname, '../build/icon.png'), render(1024))
console.log('wrote build/icon.png')

const icoSizes = [16, 24, 32, 48, 64, 128, 256]
writeFileSync(
  path.join(__dirname, '../build/icon.ico'),
  buildIco(icoSizes.map((size) => ({ size, data: render(size) })))
)
console.log('wrote build/icon.ico')
