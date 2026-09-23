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
      ]
    }
  }
})
