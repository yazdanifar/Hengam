import { useState } from 'react'
import type { EventRecord, Occurrence } from '@shared/types'
import { useApi } from './apiContext'
import type { EventDialogResult } from './components/EventDialog'

export interface EventDialogState {
  date: Date
  existing?: EventRecord
  occurrence?: Occurrence
}

/** Shared create/edit/delete plumbing for the event dialog, used identically by
 *  DayView, WeekView and MonthView — they only differ in which range they refetch. */
export function useEventDialog(refetch: () => void) {
  const api = useApi()
  const [dialog, setDialog] = useState<EventDialogState | null>(null)

  function openCreate(date: Date) {
    setDialog({ date })
  }

  async function openEdit(occ: Occurrence) {
    const existing = await api.events.get(occ.eventId)
    if (!existing) {
      // Gone since the view last loaded (e.g. deleted by a sync). Opening anyway would
      // show a create dialog pre-filled with the stale occurrence and save a duplicate.
      refetch()
      return
    }
    setDialog({ date: new Date(occ.startTs), existing, occurrence: occ })
  }

  function close() {
    setDialog(null)
  }

  async function handleSave(result: EventDialogResult, scope?: 'this' | 'all') {
    if (dialog?.existing) {
      await api.events.update({
        id: dialog.existing.id,
        ...result,
        scope,
        occurrenceStartTs: dialog.occurrence?.occurrenceStartTs
      })
    } else {
      await api.events.create(result)
    }
    setDialog(null)
    refetch()
  }

  async function handleDelete(scope?: 'this' | 'all') {
    if (!dialog?.existing) return
    await api.events.remove(dialog.existing.id, scope, dialog.occurrence?.occurrenceStartTs)
    setDialog(null)
    refetch()
  }

  return { dialog, openCreate, openEdit, close, handleSave, handleDelete }
}
