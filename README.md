# هنگام (Hengam)

A Persian (Jalali) daily planner for macOS, built with Electron + React. Week starts
on Saturday (شنبه), everything is Jalali-first with the Gregorian date shown
alongside, digits are Persian, and official Iranian holidays/occasions are shown
from a data file scraped from time.ir.

## Requirements

- Node.js and npm
- Xcode Command Line Tools (`xcode-select --install`) — needed to compile
  `better-sqlite3` for Electron's Node-API ABI

## Getting started

```bash
npm install       # also rebuilds better-sqlite3 for Electron via postinstall
npm run dev       # launch in development
npm test          # run the test suite
npm run build:mac # produce an unsigned arm64 .dmg in dist/
```

## Project status / scope notes

This implements the full local-first planner: Jalali day/week/month views with
overlapping-event layout, recurring events (daily/weekly/monthly/yearly on the
Jalali calendar, with per-occurrence edit exceptions), a per-day task list,
reminders via macOS notifications, a dynamic Dock icon showing today's Jalali
day, a menu-bar tray, and SQLite storage behind a ports/adapters architecture
so services are unit-testable with fakes.

A few pieces from the original design are intentionally reduced in this pass,
to keep the delivered app real and runnable rather than aspirational:

- **Google Calendar sync**: the OAuth PKCE helpers and the local↔Google event
  mapper (including the Jalali-monthly → RDATE translation) are implemented
  and unit-tested (`src/main/sync/pkce.ts`, `src/main/sync/mapper.ts`), but the
  full pull/push sync engine with conflict resolution, the settings UI, and
  the OAuth loopback server are not wired up yet.
- **Drag to move/resize** on the time grid is not implemented yet; events are
  created via the slot-click dialog.
- **End-to-end (Playwright), Gherkin feature specs, and mutation testing
  (Stryker)** described in the original plan are not set up; the test suite
  here is unit + integration (in-memory SQLite with transactional rollback,
  fakes for the clock/notifier/power events/etc).

Everything else — including the Electron/better-sqlite3 native module build,
the full IPC round trip, holiday data fetching, and the rendered UI — has been
run and verified in this environment, not just written.
