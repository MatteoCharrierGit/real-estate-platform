import { describe, expect, it } from 'vitest';
import { challengeFor, createPkce, randomString } from './pkce';

describe('PKCE', () => {
  it('calcola la challenge S256 dell\'esempio RFC 7636 (appendice B)', async () => {
    expect(await challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('genera stringhe URL-safe di lunghezza valida e diverse a ogni chiamata', async () => {
    const a = await createPkce();
    const b = await createPkce();
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
    expect(a.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.state).not.toBe(b.state);
    expect(a.verifier).not.toBe(b.verifier);
    expect(randomString(64)).toMatch(/^[A-Za-z0-9_-]{86}$/);
  });
});
