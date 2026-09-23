// Global test setup. jsdom-only matchers are guarded so this file works
// for both the node and jsdom vitest environments.
export {}

if (typeof document !== 'undefined') {
  await import('@testing-library/jest-dom/vitest')
}
