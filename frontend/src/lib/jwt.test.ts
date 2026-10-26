import { describe, expect, it } from 'vitest';
import { decodeJwt, groupsFromClaims, userFromIdToken } from './jwt';

const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `${b64u({ alg: 'RS256' })}.${b64u(payload)}.firma`;

describe('JWT', () => {
  it('decodifica il payload, anche con caratteri non ASCII', () => {
    const t = jwt({ sub: 'abc', name: 'Perché è così' });
    expect(decodeJwt<{ name: string }>(t).name).toBe('Perché è così');
  });
  it('estrae email e gruppi noti dall\'ID token', () => {
    const t = jwt({ sub: 'u1', email: 'a@b.it', 'cognito:groups': ['agent', 'boh', 'admin'] });
    expect(userFromIdToken(t)).toEqual({ sub: 'u1', email: 'a@b.it', groups: ['agent', 'admin'] });
  });
  it('nessun gruppo -> lista vuota', () => {
    expect(groupsFromClaims({})).toEqual([]);
    expect(groupsFromClaims({ 'cognito:groups': 'agent' })).toEqual([]);
  });
  it('rifiuta token malformati', () => {
    expect(() => decodeJwt('nonunjwt')).toThrow();
  });
});
