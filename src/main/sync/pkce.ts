// PKCE (RFC 7636) helpers for the Authorization Code + PKCE OAuth flow.
import { randomBytes, createHash } from 'node:crypto'

function base64url(input: Buffer): string {
  return input.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** A verifier of 43-128 chars from the unreserved URL character set (RFC 7636 4.1). */
export function createVerifier(): string {
  // 64 random bytes -> 86 base64url chars, well within the 43-128 bound.
  return base64url(randomBytes(64))
}

export function challengeFromVerifier(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest())
}

export function createState(): string {
  return base64url(randomBytes(16))
}
