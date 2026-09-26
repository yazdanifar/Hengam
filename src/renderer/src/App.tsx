import { ApiProvider } from './apiContext'
import { useAppStore } from './store'
import { useSyncStore } from './syncStore'
import { useMainBridge } from './useMainBridge'
import { Header } from './components/Header'
import { MiniMonth } from './components/Sidebar/MiniMonth'
import { SettingsDialog } from './components/SettingsDialog'
import { DayView } from './views/DayView'
import { WeekView } from './views/WeekView'
import { MonthView } from './views/MonthView'

export function App() {
  return (
    <ApiProvider api={window.api}>
      <AppBody />
    </ApiProvider>
  )
}

function AppBody() {
  useMainBridge()
  const settingsOpen = useSyncStore((s) => s.settingsOpen)
  const closeSettings = useSyncStore((s) => s.closeSettings)

  return (
    <div className="app-shell" dir="rtl">
      <aside className="sidebar">
        <div className="logo-row">
          <span className="wordmark">هنگام</span>
        </div>
        <MiniMonth />
      </aside>
      <main className="main-area">
        <Header />
        <ViewBody />
      </main>
      {settingsOpen && <SettingsDialog onClose={closeSettings} />}
    </div>
  )
}

function ViewBody() {
  const view = useAppStore((s) => s.view)
  if (view === 'week') return <WeekView />
  if (view === 'month') return <MonthView />
  return <DayView />
}
