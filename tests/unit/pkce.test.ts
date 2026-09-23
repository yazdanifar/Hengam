import { describe, expect, it } from 'vitest'
import { challengeFromVerifier, createState, createVerifier } from '@main/sync/pkce'

describe('pkce', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'
    expect(challengeFromVerifier(verifier)).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })

  it('verifier is 43-128 chars from the unreserved character set', () => {
    for (let i = 0; i < 20; i++) {
      const v = createVerifier()
      expect(v.length).toBeGreaterThanOrEqual(43)
      expect(v.length).toBeLessThanOrEqual(128)
      expect(v).toMatch(/^[A-Za-z0-9_-]+$/)
    }
  })

  it('state values are unique', () => {
    const states = new Set(Array.from({ length: 50 }, () => createState()))
    expect(states.size).toBe(50)
  })
})
