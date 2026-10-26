// Chiamate dirette a Cognito dal browser, senza SDK AWS. Servono solo l'access token dell'utente
// (scope aws.cognito.signin.user.admin): nessuna firma SigV4.
//
// 1) API "idp" (JSON 1.1) su https://cognito-idp.<regione>.amazonaws.com/
//      POST /
//      content-type: application/x-amz-json-1.1
//      x-amz-target: AWSCognitoIdentityProviderService.<Operazione>
//    Corpi usati:
//      ChangePassword          {"PreviousPassword": "...", "ProposedPassword": "...", "AccessToken": "..."}
//      UpdateUserAttributes    {"UserAttributes": [{"Name": "email", "Value": "nuova@..."}], "AccessToken": "..."}
//                              (con AttributesRequireVerificationBeforeUpdate l'email cambia solo dopo il codice
//                               inviato al NUOVO indirizzo)
//      VerifyUserAttribute     {"AttributeName": "email", "Code": "123456", "AccessToken": "..."}
//      DeleteUser              {"AccessToken": "..."}
//    Risposta OK: 200 con `{}` (o corpo vuoto). Errore: 400 {"__type": "NotAuthorizedException", "message": "..."}.
//
// 2) Endpoint OAuth del dominio del login gestito (form urlencoded, nessun header speciale):
//      POST <COGNITO_DOMAIN>/oauth2/revoke   token=<refresh token>&client_id=<client id>
import { cognitoIdpUrl, config } from '../config';

export class CognitoError extends Error {
  constructor(public type: string, message: string) {
    super(message);
    this.name = 'CognitoError';
  }
}

/** Messaggi in italiano per gli errori piu' comuni; altrimenti il messaggio originale di Cognito. */
export function cognitoMessage(type: string, fallback: string): string {
  switch (type) {
    case 'NotAuthorizedException':
      return 'Password attuale errata oppure sessione scaduta. Riprova o accedi di nuovo.';
    case 'InvalidPasswordException':
      return 'La nuova password non rispetta i requisiti del pool (lunghezza e tipi di caratteri).';
    case 'LimitExceededException':
    case 'TooManyRequestsException':
      return 'Troppi tentativi. Attendi qualche minuto e riprova.';
    case 'CodeMismatchException':
      return 'Codice di verifica errato.';
    case 'ExpiredCodeException':
      return 'Il codice di verifica e\' scaduto: richiedine uno nuovo cambiando di nuovo l\'email.';
    case 'AliasExistsException':
      return 'Questo indirizzo email e\' gia\' in uso.';
    case 'InvalidParameterException':
      return fallback || 'Valore non valido.';
    default:
      return fallback || 'Operazione non riuscita.';
  }
}

async function idp(operation: string, body: Record<string, unknown>): Promise<void> {
  let res: Response;
  try {
    res = await fetch(cognitoIdpUrl(), {
      method: 'POST',
      headers: {
        'content-type': 'application/x-amz-json-1.1',
        'x-amz-target': `AWSCognitoIdentityProviderService.${operation}`,
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw new CognitoError('NetworkError', 'Impossibile contattare Cognito. Controlla la connessione.');
  }
  if (res.ok) return;
  let type = 'Unknown';
  let message = '';
  try {
    const data = (await res.json()) as { __type?: string; message?: string };
    type = (data.__type ?? type).split('#').pop() ?? type;
    message = data.message ?? '';
  } catch {
    /* corpo non JSON */
  }
  throw new CognitoError(type, cognitoMessage(type, message));
}

export const changePassword = (accessToken: string, previous: string, proposed: string) =>
  idp('ChangePassword', { PreviousPassword: previous, ProposedPassword: proposed, AccessToken: accessToken });

export const updateEmail = (accessToken: string, email: string) =>
  idp('UpdateUserAttributes', { UserAttributes: [{ Name: 'email', Value: email }], AccessToken: accessToken });

export const verifyEmailCode = (accessToken: string, code: string) =>
  idp('VerifyUserAttribute', { AttributeName: 'email', Code: code, AccessToken: accessToken });

export const deleteCognitoUser = (accessToken: string) => idp('DeleteUser', { AccessToken: accessToken });

/** Revoca il refresh token (e con esso i token derivati) sul dominio del login gestito. */
export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  const res = await fetch(`${config.cognitoDomain}/oauth2/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token: refreshToken, client_id: config.clientId }),
  });
  if (!res.ok) throw new CognitoError('RevokeFailed', `Revoca non riuscita (${res.status})`);
}
