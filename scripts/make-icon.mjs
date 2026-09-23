// Renders build/icon.svg -> build/icon.png (1024x1024). electron-builder then
// builds icon.icns itself from that PNG for the mac target.
import { Resvg } from '@resvg/resvg-js'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const svg = readFileSync(path.join(__dirname, '../build/icon.svg'), 'utf-8')
const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1024 } })
const png = resvg.render().asPng()
writeFileSync(path.join(__dirname, '../build/icon.png'), png)
console.log('wrote build/icon.png')
