# هنگام (Hengam)

A Persian (Jalali) daily planner for macOS and Windows, built with Electron + React. Week starts
on Saturday (شنبه), everything is Jalali-first with the Gregorian date shown
alongside, digits are Persian, and official Iranian holidays/occasions are shown
from a data file scraped from time.ir.

## Requirements

- Node.js and npm
- To compile `better-sqlite3` for Electron's Node-API ABI:
  - macOS: Xcode Command Line Tools (`xcode-select --install`)
  - Windows: Visual Studio Build Tools ("Desktop development with C++") and Python 3

## Getting started

```bash
npm install       # also rebuilds better-sqlite3 for Electron via postinstall
npm run dev       # launch in development
npm test          # run the test suite
npm run build:mac # produce an unsigned arm64 .dmg in dist/ (run on a Mac)
npm run build:win # produce an unsigned x64 NSIS installer in dist/ (run on Windows)
```

The native `better-sqlite3` module is built for the machine you run `npm install` on, so
each platform's package must be built on that platform.

## Google Calendar sync

Two-way sync (pull remote changes in, push local creates/edits/deletes out) via OAuth 2.0
Authorization Code + PKCE, on a local loopback redirect — no client secret ships baked into
the app beyond what Google requires for a Desktop-app OAuth client (which, per RFC 8252
§8.5, is not actually secret for an installed app; PKCE is the real protection).

To run it locally:

1. In [Google Cloud Console](https://console.cloud.google.com), create a project, enable
   the **Calendar API**, configure the OAuth consent screen (External, publish to
   Production — Testing-mode refresh tokens for this scope expire after 7 days), and create
   an OAuth client of type **Desktop app**.
2. Copy `.env.example` to `.env` and fill in `MAIN_VITE_GOOGLE_CLIENT_ID` /
   `MAIN_VITE_GOOGLE_CLIENT_SECRET`. Without these, sync stays disabled and the Settings
   dialog says so — the app runs fine either way.
3. `npm run dev` (or a built app), open the gear icon in the header, and connect.

Sync runs automatically on launch, on wake/unlock, and every 5 minutes, plus on demand from
Settings or the tray's "همگام‌سازی" item. Conflicts (a 412 from Google) resolve by newest
`updated` timestamp, with ties favoring the local edit. See `src/main/sync/` for the engine
(`GoogleAuth`, `GoogleCalendarClient`, `SyncService`) and `src/main/sync/mapper.ts` for the
Jalali monthly/yearly → RDATE translation that makes non-Gregorian recurrence round-trip.

Known limitations: per-occurrence overrides can only be pushed once Google has assigned
them an instance id (i.e. after they've been seen once via pull); the Jalali RDATE list
only extends 3 years ahead and can be disturbed by editing the series in Google's own UI
(the private `jalaliRule` extended property is the source of truth Hengam trusts back).

## Project status / scope notes

This implements the full local-first planner: Jalali day/week/month views with
overlapping-event layout, recurring events (daily/weekly/monthly/yearly on the
Jalali calendar, with per-occurrence edit exceptions), a per-day task list,
reminders via OS notifications, a dynamic Dock/taskbar/tray icon showing today's Jalali
day, a menu-bar (macOS) / system-tray (Windows) tray with Google sync status, two-way Google Calendar sync, and
SQLite storage behind a ports/adapters architecture so services are
unit-testable with fakes.

A few pieces from the original design are intentionally reduced in this pass,
to keep the delivered app real and runnable rather than aspirational:

- **Drag to move/resize** on the time grid is not implemented yet; events are
  created via the slot-click dialog.
- **End-to-end (Playwright), Gherkin feature specs, and mutation testing
  (Stryker)** described in the original plan are not set up; the test suite
  here is unit + integration (in-memory SQLite with transactional rollback,
  fakes for the clock/notifier/power events/etc).

Everything else — including the Electron/better-sqlite3 native module build,
the full IPC round trip, holiday data fetching, and the rendered UI — has been
run and verified in this environment, not just written.
