import type { SecretStore } from '@main/ports'

export class FakeSecretStore implements SecretStore {
  private store = new Map<string, string>()

  async get(key: string): Promise<string | undefined> {
    return this.store.get(key)
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key)
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.store)
  }
}
