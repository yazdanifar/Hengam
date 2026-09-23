// Types import.meta.env for the main bundle. electron-vite exposes MAIN_VITE_* keys
// from .env files at build time; tsconfig has no "vite/client" types entry, so this
// is the only thing that makes `import.meta.env` typecheck under `tsc -p tsconfig.json`.
interface ImportMetaEnv {
  readonly MAIN_VITE_GOOGLE_CLIENT_ID?: string
  readonly MAIN_VITE_GOOGLE_CLIENT_SECRET?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
