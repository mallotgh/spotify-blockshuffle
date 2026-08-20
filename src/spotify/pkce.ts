import crypto from 'node:crypto';

export function generateCodeVerifier(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function codeChallengeS256(verifier: string): string {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}
