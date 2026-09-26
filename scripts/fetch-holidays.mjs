// Rebuilds the bundled src/shared/data/holidays/<year>.json files straight from
// time.ir, using the same fetch logic the running app uses at runtime
// (src/shared/timeIrHolidays.ts — no third-party mirror involved either way).
//
//   node scripts/fetch-holidays.mjs 1405 1406 1407
//
// Run this after time.ir confirms a lunar holiday (moon-sighting dates can move
// by a day from the initial estimate) or once a new Jalali year needs a file.
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { TimeIrClient } from '../src/shared/timeIrHolidays.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT_DIR = path.join(__dirname, '../src/shared/data/holidays')

const years = process.argv.slice(2).map(Number)
if (!years.length || years.some((y) => !Number.isInteger(y) || y < 1300 || y > 1500)) {
  console.error('usage: node scripts/fetch-holidays.mjs <jalali year>...')
  process.exit(1)
}

const client = new TimeIrClient()
for (const jy of years) {
  const days = await client.fetchYear(jy) // throws rather than writing a bad/partial year
  writeFileSync(path.join(OUT_DIR, `${jy}.json`), JSON.stringify(days, null, 4) + '\n')
  const holidays = days.filter((d) => d.is_holiday).length
  console.log(`wrote src/shared/data/holidays/${jy}.json (${days.length} days, ${holidays} holidays)`)
  await new Promise((r) => setTimeout(r, 1000)) // be polite between years
}
