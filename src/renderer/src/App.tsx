import { ApiProvider } from './apiContext'
import { useAppStore } from './store'
import { Header } from './components/Header'
import { MiniMonth } from './components/Sidebar/MiniMonth'
import { TaskList } from './components/Sidebar/TaskList'
import { DayView } from './views/DayView'
import { WeekView } from './views/WeekView'
import { MonthView } from './views/MonthView'

export function App() {
  return (
    <ApiProvider api={window.api}>
      <div className="app-shell" dir="rtl">
        <aside className="sidebar">
          <div className="logo-row">
            <span className="wordmark">هنگام</span>
          </div>
          <MiniMonth />
          <TaskList />
        </aside>
        <main className="main-area">
          <Header />
          <ViewBody />
        </main>
      </div>
    </ApiProvider>
  )
}

function ViewBody() {
  const view = useAppStore((s) => s.view)
  if (view === 'week') return <WeekView />
  if (view === 'month') return <MonthView />
  return <DayView />
}
