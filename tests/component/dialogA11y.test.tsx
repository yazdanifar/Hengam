import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useDialogA11y } from '@renderer/useDialogA11y'
import { EventDialog } from '@renderer/components/EventDialog'
import { SettingsDialog } from '@renderer/components/SettingsDialog'
import { ApiProvider } from '@renderer/apiContext'
import { useSyncStore } from '@renderer/syncStore'
import { createFakeApi } from '../support/FakeApi'

function TestDialog({ onClose }: { onClose(): void }) {
  const { ref, dialogProps, titleId } = useDialogA11y(onClose)
  return (
    <div ref={ref} {...dialogProps}>
      <h2 id={titleId}>Title</h2>
      <button>First</button>
      <button>Last</button>
    </div>
  )
}

beforeEach(() => {
  useSyncStore.setState({ status: { phase: 'idle', connected: true, configured: true }, calendars: [], settingsOpen: true, busy: null })
})

describe('useDialogA11y', () => {
  it('sets role=dialog, aria-modal, and links aria-labelledby to the title', () => {
    render(<TestDialog onClose={() => {}} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', screen.getByText('Title').id)
  })

  it('Escape calls onClose', async () => {
    const user = userEvent.setup()
    let closed = false
    render(<TestDialog onClose={() => (closed = true)} />)
    await user.keyboard('{Escape}')
    expect(closed).toBe(true)
  })

  it('Tab cycles from the last focusable element back to the first', async () => {
    const user = userEvent.setup()
    render(<TestDialog onClose={() => {}} />)
    const last = screen.getByText('Last')
    last.focus()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByText('First'))
  })

  it('Shift+Tab cycles from the first focusable element to the last', async () => {
    const user = userEvent.setup()
    render(<TestDialog onClose={() => {}} />)
    const first = screen.getByText('First')
    first.focus()
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByText('Last'))
  })

  it('restores focus to whatever had it before the dialog opened, on unmount', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()

    const { unmount } = render(<TestDialog onClose={() => {}} />)
    unmount()

    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})

describe('useDialogA11y — adopted by EventDialog', () => {
  it('has role=dialog and Escape closes it', async () => {
    const user = userEvent.setup()
    const api = createFakeApi()
    let closed = false
    render(
      <ApiProvider api={api}>
        <EventDialog initialDate={new Date()} onClose={() => (closed = true)} onSave={() => {}} />
      </ApiProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(closed).toBe(true)
  })
})

describe('useDialogA11y — adopted by SettingsDialog', () => {
  it('has role=dialog and Escape closes it', async () => {
    const user = userEvent.setup()
    const api = createFakeApi({ google: { listCalendars: async () => [] } as any })
    let closed = false
    render(
      <ApiProvider api={api}>
        <SettingsDialog onClose={() => (closed = true)} />
      </ApiProvider>
    )
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(closed).toBe(true)
  })
})
