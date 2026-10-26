// Variabili di build (contratto: deploy/contratto.md). Vite le sostituisce a compile time.
const strip = (v: string | undefined) => (v ?? '').trim().replace(/\/+$/, '');

export const config = {
  apiUrl: strip(import.meta.env.VITE_API_URL),
  cognitoDomain: strip(import.meta.env.VITE_COGNITO_DOMAIN),
  clientId: (import.meta.env.VITE_COGNITO_CLIENT_ID ?? '').trim(),
  region: (import.meta.env.VITE_COGNITO_REGION ?? '').trim(),
  filesUrl: strip(import.meta.env.VITE_FILES_URL),
};

/** Nomi delle variabili mancanti (vuoto se la configurazione e' completa). */
export function missingConfig(): string[] {
  const names: Array<[string, string]> = [
    ['VITE_API_URL', config.apiUrl],
    ['VITE_COGNITO_DOMAIN', config.cognitoDomain],
    ['VITE_COGNITO_CLIENT_ID', config.clientId],
    ['VITE_COGNITO_REGION', config.region],
    ['VITE_FILES_URL', config.filesUrl],
  ];
  return names.filter(([, v]) => !v).map(([n]) => n);
}

/** Endpoint regionale di Cognito per le API pubbliche (ChangePassword, DeleteUser, ...). */
export const cognitoIdpUrl = () => `https://cognito-idp.${config.region}.amazonaws.com/`;

/** URL pubblico di un file (foto/video): il browser lo legge dalla distribuzione CloudFront dei file. */
export const fileUrl = (key: string) => `${config.filesUrl}/${key.replace(/^\/+/, '')}`;
