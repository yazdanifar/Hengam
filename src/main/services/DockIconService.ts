import { Resvg } from '@resvg/resvg-js'
import fs from 'node:fs'
import { toFaDigits } from '@shared/format'
import type { JalaliDate } from '@shared/jalali'
import type { DockPort } from '../ports'

/** Renders the squircle/star/clock-face template with today's Jalali day burned in. */
export function renderDayIcon(jd: number, templateSvg: string, fontPath?: string): Buffer {
  const day = toFaDigits(jd)
  const fontSize = day.length <= 1 ? 290 : 250
  const svg = templateSvg.replace('{{DAY}}', day).replace('{{FONT_SIZE}}', String(fontSize))
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1024 },
    font: fontPath ? { fontFiles: [fontPath], loadSystemFonts: false } : undefined
  })
  return resvg.render().asPng()
}

/**
 * Renders the small-icon template: a full-bleed tile with the day number as large as it
 * fits, since the detailed Dock icon's digit is only a few pixels tall at tray sizes.
 */
export function renderSmallDayIcon(jd: number, templateSvg: string, fontPath?: string): Buffer {
  const day = toFaDigits(jd)
  const fontSize = day.length <= 1 ? 780 : 640
  const svg = templateSvg.replace('{{DAY}}', day).replace('{{FONT_SIZE}}', String(fontSize))
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: 256 },
    font: fontPath ? { fontFiles: [fontPath], loadSystemFonts: false } : undefined
  })
  return resvg.render().asPng()
}

export class DockIconService {
  private template: string
  private smallTemplate: string | undefined

  constructor(
    private dock: DockPort,
    templatePath: string,
    private fontPath?: string,
    smallTemplatePath?: string
  ) {
    this.template = fs.readFileSync(templatePath, 'utf-8')
    this.smallTemplate = smallTemplatePath ? fs.readFileSync(smallTemplatePath, 'utf-8') : undefined
  }

  update(day: JalaliDate): void {
    const png = renderDayIcon(day.jd, this.template, this.fontPath)
    this.dock.setIcon(png)
    if (this.smallTemplate && this.dock.setSmallIcon) {
      this.dock.setSmallIcon(renderSmallDayIcon(day.jd, this.smallTemplate, this.fontPath))
    }
  }
}
