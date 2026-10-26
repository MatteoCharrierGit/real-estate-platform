import { config } from './config';
import { createApi } from './lib/api';
import { getAccessToken, refreshTokens } from './auth/oauth';

// Istanza unica del client API, legata alla sessione in memoria.
// (import circolare con auth/oauth.ts: le funzioni vengono usate solo a runtime, non al caricamento del modulo.)
export const api = createApi({
  baseUrl: config.apiUrl,
  getToken: () => getAccessToken(),
  refreshToken: () => refreshTokens(),
});
