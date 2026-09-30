import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EventDialog } from '@renderer/components/EventDialog'
import type { EventRecord, Occurrence } from '@shared/types'

const NON_RECURRING: EventRecord = {
  id: 'ev-1',
  title: 'جلسه',
  color: '#3b82f6',
  startTs: new Date(2026, 8, 22, 9, 0).getTime(),
  endTs: new Date(2026, 8, 22, 10, 0).getTime(),
  allDay: false,
  reminders: [],
  createdAt: 0,
  updatedAt: 0,
  dirty: true,
  editSeq: 0
}

const RECURRING: EventRecord = {
  ...NON_RECURRING,
  id: 'ev-2',
  title: 'روزانه',
  rrule: { freq: 'daily', interval: 1 }
}

function occurrenceOf(ev: EventRecord, dayOffset: number): Occurrence {
  return {
    eventId: ev.id,
    occurrenceStartTs: ev.startTs + dayOffset * 86400_000,
    title: ev.title,
    color: ev.color,
    startTs: ev.startTs + dayOffset * 86400_000,
    endTs: ev.endTs + dayOffset * 86400_000,
    allDay: false,
    isRecurring: !!ev.rrule
  }
}

describe('EventDialog — editing', () => {
  it('prefills every field from the existing event', () => {
    render(
      <EventDialog
        initialDate={new Date(NON_RECURRING.startTs)}
        existing={NON_RECURRING}
        onClose={() => {}}
        onSave={() => {}}
      />
    )
    expect(screen.getByText('ویرایش رویداد')).toBeInTheDocument()
    expect(screen.getByLabelText('عنوان')).toHaveValue('جلسه')
    expect(screen.getByLabelText('شروع')).toHaveValue('09:00')
    expect(screen.getByLabelText('پایان')).toHaveValue('10:00')
  })

  it('saving a non-recurring event calls onSave with no scope prompt', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EventDialog
        initialDate={new Date(NON_RECURRING.startTs)}
        existing={NON_RECURRING}
        onClose={() => {}}
        onSave={onSave}
      />
    )
    await user.clear(screen.getByLabelText('عنوان'))
    await user.type(screen.getByLabelText('عنوان'), 'جلسه جدید')
    await user.click(screen.getByText('ذخیره'))

    expect(onSave).toHaveBeenCalledTimes(1)
    const [result, scope] = onSave.mock.calls[0]
    expect(result.title).toBe('جلسه جدید')
    expect(scope).toBeUndefined()
  })

  it('saving a recurring event shows a scope prompt and forwards the chosen scope', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const occ = occurrenceOf(RECURRING, 3)
    render(
      <EventDialog
        initialDate={new Date(occ.startTs)}
        existing={RECURRING}
        occurrence={occ}
        onClose={() => {}}
        onSave={onSave}
      />
    )
    await user.click(screen.getByText('ذخیره'))
    expect(screen.getByText('ذخیره برای کدام مورد؟')).toBeInTheDocument()

    await user.click(screen.getByText('فقط همین مورد'))
    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][1]).toBe('this')
  })

  it('a whole-series save keeps the series anchored on its original day', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const occ = occurrenceOf(RECURRING, 3) // clicked the 4th day of the series
    render(
      <EventDialog
        initialDate={new Date(occ.startTs)}
        existing={RECURRING}
        occurrence={occ}
        onClose={() => {}}
        onSave={onSave}
      />
    )
    await user.click(screen.getByText('ذخیره'))
    await user.click(screen.getByText('همهٔ موارد'))

    const [result, scope] = onSave.mock.calls[0]
    expect(scope).toBe('all')
    // Anchored on RECURRING.startTs's own day, not the clicked occurrence's day 3 days later.
    expect(new Date(result.startTs).getDate()).toBe(new Date(RECURRING.startTs).getDate())
  })

  it('shows a delete button only when editing, routed through the scope prompt', async () => {
    const user = userEvent.setup()
    const onDelete = vi.fn()
    const occ = occurrenceOf(RECURRING, 0)
    const { rerender } = render(
      <EventDialog initialDate={new Date()} onClose={() => {}} onSave={() => {}} />
    )
    expect(screen.queryByText('حذف')).not.toBeInTheDocument()

    rerender(
      <EventDialog
        initialDate={new Date(occ.startTs)}
        existing={RECURRING}
        occurrence={occ}
        onClose={() => {}}
        onSave={() => {}}
        onDelete={onDelete}
      />
    )
    await user.click(screen.getByText('حذف'))
    expect(screen.getByText('حذف کدام مورد؟')).toBeInTheDocument()
    await user.click(screen.getByText('همهٔ موارد'))
    expect(onDelete).toHaveBeenCalledWith('all')
  })
})

describe('EventDialog — reminders', () => {
  it('adding a reminder and choosing hours saves it in minutes', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EventDialog initialDate={new Date(NON_RECURRING.startTs)} existing={NON_RECURRING} onClose={() => {}} onSave={onSave} />
    )
    await user.click(screen.getByText('+ افزودن اعلان'))
    await user.clear(screen.getByLabelText('مقدار اعلان'))
    await user.type(screen.getByLabelText('مقدار اعلان'), '2')
    await user.selectOptions(screen.getByLabelText('واحد اعلان'), 'ساعت')
    await user.click(screen.getByText('ذخیره'))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0].reminders).toEqual([120])
  })

  it('prefills existing reminders in their natural unit', () => {
    const withReminders: EventRecord = { ...NON_RECURRING, reminders: [10, 120] }
    render(
      <EventDialog initialDate={new Date(withReminders.startTs)} existing={withReminders} onClose={() => {}} onSave={() => {}} />
    )
    const values = screen.getAllByLabelText('مقدار اعلان').map((el) => (el as HTMLInputElement).value)
    const units = screen.getAllByLabelText('واحد اعلان').map((el) => (el as HTMLSelectElement).value)
    expect(values).toEqual(['10', '2'])
    expect(units).toEqual(['m', 'h'])
  })

  it('hides the add button once 5 reminders are set', () => {
    const maxed: EventRecord = { ...NON_RECURRING, reminders: [5, 10, 15, 20, 25] }
    render(<EventDialog initialDate={new Date(maxed.startTs)} existing={maxed} onClose={() => {}} onSave={() => {}} />)
    expect(screen.queryByText('+ افزودن اعلان')).not.toBeInTheDocument()
  })

  it('removing a reminder row drops it from the saved list', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const withReminders: EventRecord = { ...NON_RECURRING, reminders: [10, 60] }
    render(
      <EventDialog initialDate={new Date(withReminders.startTs)} existing={withReminders} onClose={() => {}} onSave={onSave} />
    )
    await user.click(screen.getAllByLabelText('حذف اعلان')[0])
    await user.click(screen.getByText('ذخیره'))
    expect(onSave.mock.calls[0][0].reminders).toEqual([60])
  })

  it('a 0-minute reminder (at start time) shows as 0 minutes and saves', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const atStart: EventRecord = { ...NON_RECURRING, reminders: [0] }
    render(<EventDialog initialDate={new Date(atStart.startTs)} existing={atStart} onClose={() => {}} onSave={onSave} />)
    expect(screen.getByLabelText('مقدار اعلان')).toHaveValue('0')
    expect(screen.getByLabelText('واحد اعلان')).toHaveValue('m')
    await user.click(screen.getByText('ذخیره'))
    expect(onSave.mock.calls[0][0].reminders).toEqual([0])
  })

  it('a blank reminder value is rejected rather than saved as 0', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EventDialog initialDate={new Date(NON_RECURRING.startTs)} existing={NON_RECURRING} onClose={() => {}} onSave={onSave} />
    )
    await user.click(screen.getByText('+ افزودن اعلان'))
    await user.clear(screen.getByLabelText('مقدار اعلان'))
    await user.click(screen.getByText('ذخیره'))
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('مقدار اعلان نامعتبر است')).toBeInTheDocument()
  })
})

describe('EventDialog — edge cases', () => {
  it('editing an all-day event keeps it all-day', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    const allDay: EventRecord = {
      ...NON_RECURRING,
      startTs: new Date(2026, 8, 22).getTime(),
      endTs: new Date(2026, 8, 23).getTime(),
      allDay: true
    }
    render(<EventDialog initialDate={new Date(allDay.startTs)} existing={allDay} onClose={() => {}} onSave={onSave} />)
    expect(screen.getByLabelText('شروع')).toBeDisabled()
    await user.click(screen.getByText('ذخیره'))
    expect(onSave.mock.calls[0][0]).toMatchObject({ allDay: true, startTs: allDay.startTs, endTs: allDay.endTs })
  })

  it('an overridden occurrence prefills its own title, not the series title', () => {
    const occ: Occurrence = { ...occurrenceOf(RECURRING, 3), title: 'فقط این یکی', color: '#ff0000' }
    render(
      <EventDialog
        initialDate={new Date(occ.startTs)}
        existing={RECURRING}
        occurrence={occ}
        onClose={() => {}}
        onSave={() => {}}
      />
    )
    expect(screen.getByLabelText('عنوان')).toHaveValue('فقط این یکی')
  })

  it('"only this one" is unavailable once reminders or recurrence were changed', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(
      <EventDialog
        initialDate={new Date(RECURRING.startTs)}
        existing={RECURRING}
        occurrence={occurrenceOf(RECURRING, 2)}
        onClose={() => {}}
        onSave={onSave}
      />
    )
    await user.click(screen.getByText('+ افزودن اعلان'))
    await user.click(screen.getByText('ذخیره'))
    expect(screen.getByText('فقط همین مورد')).toBeDisabled()
    await user.click(screen.getByText('همهٔ موارد'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ reminders: [10] }), 'all')
  })
})
