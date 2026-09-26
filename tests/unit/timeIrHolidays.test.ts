import { afterEach, describe, expect, it, vi } from 'vitest'
import { HolidayFetchError, TimeIrClient, rscRows, toRawHolidayDays } from '@shared/timeIrHolidays'

const PAGE = 'https://www.time.ir/event-year'
const ACTION_A = 'a'.repeat(42)
const ACTION_B = 'b'.repeat(42)

interface Ev {
  jalali_year: number
  jalali_month: number
  jalali_day: number
  title: string
  is_holiday: boolean
}

const ev = (jm: number, jd: number, title: string, isHoliday: boolean, jy = 1405): Ev => ({
  jalali_year: jy,
  jalali_month: jm,
  jalali_day: jd,
  title,
  is_holiday: isHoliday
})

/** A plausible year: two holidays at the start of every month (24 total, Nowruz first),
 *  plus an ordinary occasion, and one spill-over day from the previous year. */
function yearMonths(jy = 1405, holidaysPerMonth = 2) {
  return Array.from({ length: 12 }, (_, i) => ({
    event_list: [
      ...Array.from({ length: holidaysPerMonth }, (_, d) => ev(i + 1, d + 1, `تعطیل ${i + 1}-${d + 1}`, true, jy)),
      ev(i + 1, 20, 'مناسبت', false, jy),
      ...(i === 0 ? [ev(12, 29, 'روز پیش از سال', true, jy - 1)] : [])
    ]
  }))
}

/** An RSC stream: envelope row, a multi-line text row (like time.ir's HTML event bodies,
 *  which carry no trailing newline), then the data row. */
function rsc(dataRow: string): string {
  const html = '<h2>چرا مهم است؟</h2>\n<p>line two</p>'
  return `0:{"a":"$@1","f":"","b":"x"}\n2:T${Buffer.byteLength(html).toString(16)},${html}1:${dataRow}\n`
}

const okRow = (data: unknown) => JSON.stringify({ status_code: 200, message: 'ok', data })

const chunkDeclaring = (id: string) =>
  `var N=e.i(1);let w=(0,N.createServerReference)("${id}",N.callServer,void 0,N.findSourceMapURL,"fetchEventYearlyCalendarAction");`

/** A scripted time.ir: `site.actionId` is the id the live build accepts. */
function fakeSite() {
  const site = {
    actionId: ACTION_A,
    postResponse: (_jy: number): Response => new Response(rsc(okRow(yearMonths(_jy)))),
    pageStatus: 200,
    calls: [] as { url: string; init?: RequestInit }[]
  }
  const fetchFn = vi.fn(async (url: string, init?: RequestInit): Promise<Response> => {
    site.calls.push({ url, init })
    if (url === PAGE && init?.method === 'POST') {
      const headers = init.headers as Record<string, string>
      if (headers['next-action'] !== site.actionId) return new Response('0:{"a":"$@1"}\n1:E{"digest":"x"}\n')
      const [jy] = JSON.parse(init.body as string) as [number]
      return site.postResponse(jy)
    }
    if (url === PAGE) {
      return new Response(
        `<html><script src="/_next/static/chunks/one.js"></script><script src="/_next/static/chunks/two.js"></script></html>`,
        { status: site.pageStatus }
      )
    }
    if (url.endsWith('/one.js')) return new Response('console.log("nothing here")')
    if (url.endsWith('/two.js')) return new Response(chunkDeclaring(site.actionId))
    throw new Error(`unexpected ${url}`)
  })
  return { site, fetchFn, client: new TimeIrClient(fetchFn) }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(HolidayFetchError)
    return (err as HolidayFetchError).code
  }
  throw new Error('expected a rejection')
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('rscRows', () => {
  it('splits JSON rows on newlines and walks text rows by their byte length', () => {
    const rows = rscRows(Buffer.from(rsc('{"x":1}')))
    expect(rows.get('0')).toBe('{"a":"$@1","f":"","b":"x"}')
    expect(rows.get('2')).toBe('<h2>چرا مهم است؟</h2>\n<p>line two</p>')
    expect(rows.get('1')).toBe('{"x":1}')
  })

  it('reads a final row with no trailing newline, and ignores trailing bytes that are not a row', () => {
    const rows = rscRows(Buffer.from('0:{}\n1:{"last":true}'))
    expect(rows.get('1')).toBe('{"last":true}')
    expect(rscRows(Buffer.from('0:{}\ngarbage')).size).toBe(1)
  })
})

describe('toRawHolidayDays', () => {
  it('groups events by Jalali date, drops other years, dedupes titles and ORs is_holiday', () => {
    const days = toRawHolidayDays(1405, [
      { event_list: [ev(1, 2, 'دوم', false), ev(1, 1, 'نوروز', true), ev(1, 1, '  نوروز  ', true)] },
      { event_list: [ev(1, 2, 'تعطیل  دوم', true), ev(12, 29, 'سال قبل', true, 1404)] }
    ])
    expect(days).toEqual([
      { date: '1405-01-01', is_holiday: true, events: [{ description: 'نوروز', is_holiday: true }] },
      {
        date: '1405-01-02',
        is_holiday: true,
        events: [
          { description: 'دوم', is_holiday: false },
          { description: 'تعطیل دوم', is_holiday: true }
        ]
      }
    ])
  })
})

describe('TimeIrClient.fetchYear', () => {
  it('finds the action by name, posts the year with browser headers, and returns the converted year', async () => {
    const { client, site } = fakeSite()
    const days = await client.fetchYear(1405)

    expect(days.filter((d) => d.is_holiday)).toHaveLength(24)
    expect(days[0]).toEqual({ date: '1405-01-01', is_holiday: true, events: [{ description: 'تعطیل 1-1', is_holiday: true }] })
    const post = site.calls.find((c) => c.init?.method === 'POST')!
    const headers = post.init!.headers as Record<string, string>
    expect(headers['next-action']).toBe(ACTION_A)
    expect(headers.origin).toBe('https://www.time.ir')
    expect(headers.referer).toBe(PAGE)
    expect(headers['user-agent']).toMatch(/Mozilla/)
    expect(post.init!.body).toBe('[1405]')
  })

  it('caches the action id across years instead of re-scanning the site', async () => {
    const { client, site } = fakeSite()
    await client.fetchYear(1405)
    await client.fetchYear(1406)
    expect(site.calls.filter((c) => c.url === PAGE && !c.init?.method)).toHaveLength(1)
  })

  it('looks the action id up again, once, after time.ir redeploys with a new one', async () => {
    const { client, site } = fakeSite()
    await client.fetchYear(1405)
    site.actionId = ACTION_B

    await expect(client.fetchYear(1406)).resolves.toHaveLength(12 * 3)
    const posts = site.calls.filter((c) => c.init?.method === 'POST').map((c) => (c.init!.headers as any)['next-action'])
    expect(posts).toEqual([ACTION_A, ACTION_A, ACTION_B])
  })

  it('does not re-scan on a network failure with a cached id — the site did not change, the network did', async () => {
    const { client, site, fetchFn } = fakeSite()
    await client.fetchYear(1405)
    fetchFn.mockRejectedValueOnce(new TypeError('fetch failed'))
    expect(await codeOf(client.fetchYear(1406))).toBe('network')
    expect(site.calls.filter((c) => c.url === PAGE && !c.init?.method)).toHaveLength(1)
  })

  it('surfaces a failure on the first try without retrying, since there was no cached id to blame', async () => {
    const { client, site } = fakeSite()
    site.postResponse = () => new Response('oops', { status: 502 })
    expect(await codeOf(client.fetchYear(1405))).toBe('server')
    expect(site.calls.filter((c) => c.init?.method === 'POST')).toHaveLength(1)
  })

  it.each([
    [403, 'blocked'],
    [429, 'blocked'],
    [500, 'server']
  ])('maps an HTTP %i on the page to %s', async (status, code) => {
    const { client, site } = fakeSite()
    site.pageStatus = status
    expect(await codeOf(client.fetchYear(1405))).toBe(code)
  })

  it('reports network when fetch itself rejects', async () => {
    const client = new TimeIrClient(async () => {
      throw new TypeError('getaddrinfo ENOTFOUND')
    })
    expect(await codeOf(client.fetchYear(1405))).toBe('network')
  })

  it('reports site_changed when no chunk declares the action', async () => {
    const client = new TimeIrClient(async (url) =>
      url === PAGE ? new Response('<html>no scripts</html>') : new Response('')
    )
    expect(await codeOf(client.fetchYear(1405))).toBe('site_changed')
  })

  it.each([
    ['no data row', '0:{"a":"$@1"}\n'],
    ['an error row', '0:{"a":"$@1"}\n1:E{"digest":"1"}\n'],
    ['an unreadable data row', '0:{"a":"$@1"}\n1:{not json\n']
  ])('reports site_changed for %s', async (_name, body) => {
    const { client, site } = fakeSite()
    site.postResponse = () => new Response(body)
    expect(await codeOf(client.fetchYear(1405))).toBe('site_changed')
  })

  it('reports server when the upstream API answers with a non-200 status', async () => {
    const { client, site } = fakeSite()
    site.postResponse = () => new Response(rsc(JSON.stringify({ status_code: 500, message: 'down', data: null })))
    expect(await codeOf(client.fetchYear(1405))).toBe('server')
  })

  it.each([
    ['not 12 months', () => yearMonths().slice(0, 11)],
    ['Nowruz not a holiday', () => yearMonths().map((m, i) => (i === 0 ? { event_list: m.event_list.slice(1) } : m))],
    ['too few holidays', () => yearMonths(1405, 1)],
    ['too many holidays', () => yearMonths(1405, 3)]
  ])('rejects an implausible year (%s) as invalid_data', async (_name, months) => {
    const { client, site } = fakeSite()
    site.postResponse = () => new Response(rsc(okRow(months())))
    expect(await codeOf(client.fetchYear(1405))).toBe('invalid_data')
  })

  it('uses the global fetch by default', async () => {
    const { fetchFn } = fakeSite()
    vi.stubGlobal('fetch', fetchFn)
    await expect(new TimeIrClient().fetchYear(1405)).resolves.toBeDefined()
    expect(fetchFn).toHaveBeenCalled()
  })
})
