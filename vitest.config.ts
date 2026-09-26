import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@main': path.resolve(__dirname, 'src/main'),
      '@renderer': path.resolve(__dirname, 'src/renderer/src')
    }
  },
  test: {
    environment: 'node',
    environmentMatchGlobs: [
      ['tests/component/**', 'jsdom']
    ],
    globals: true,
    setupFiles: ['./tests/support/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/shared/**', 'src/main/**', 'src/renderer/src/**'],
      exclude: [
        'src/main/container.ts',
        'src/main/adapters/**',
        'src/main/index.ts',
        'src/renderer/src/main.tsx'
      ],
      // Fully covered today; keep them that way (checked by `npm run verify`).
      thresholds: Object.fromEntries(
        [
          'src/shared/{timeIrHolidays,notifications,datetime}.ts',
          'src/main/ipc.ts',
          'src/main/repo/{notifications,alertSettings}.ts',
          'src/main/services/{HolidayService,AlertMonitor,NotificationCenter,ReminderService}.ts',
          'src/renderer/src/{useMainBridge,useHolidays,useBackgroundActions,notificationStore,syncStore,syncMessages}.ts',
          'src/renderer/src/components/{NotificationBell,Header,SettingsDialog,icons}.tsx',
          'src/renderer/src/components/Settings/*.tsx'
        ].map((glob) => [glob, { statements: 100, branches: 100, functions: 100, lines: 100 }])
      )
    }
  }
})
