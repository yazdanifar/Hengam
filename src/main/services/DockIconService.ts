import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import { toFaDigits } from '@shared/format'
import type { JalaliDate } from '@shared/jalali'
import type { DockPort } from '../ports'

/** Renders the squircle/star/clock-face template with today's Jalali day burned in. */
export function renderDayIcon(jd: number, templateSvg: string, fontPath?: string): Buffer {
  const day = toFaDigits(jd)
  const fontSize = day.length <= 1 ? 220 : 190
  const svg = templateSvg.replace('{{DAY}}', day).replace('{{FONT_SIZE}}', String(fontSize))
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1024 },
    font: fontPath ? { fontFiles: [fontPath], loadSystemFonts: false } : undefined
  })
  return resvg.render().asPng()
}

export class DockIconService {
  private template: string

  constructor(
    private dock: DockPort,
    templatePath: string,
    private fontPath?: string
  ) {
    this.template = fs.readFileSync(templatePath, 'utf-8')
  }

  update(day: JalaliDate): void {
    const png = renderDayIcon(day.jd, this.template, this.fontPath)
    this.dock.setIcon(png)
  }
}
