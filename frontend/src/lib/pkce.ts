// PKCE (RFC 7636) con WebCrypto: nessuna libreria.

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Stringa casuale URL-safe (default 32 byte -> 43 caratteri, entro 43..128 richiesti da PKCE). */
export function randomString(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return base64url(buf);
}

/** code_challenge = BASE64URL(SHA-256(code_verifier)) (metodo S256). */
export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export async function createPkce(): Promise<{ verifier: string; challenge: string; state: string }> {
  const verifier = randomString(32);
  return { verifier, challenge: await challengeFor(verifier), state: randomString(16) };
}
