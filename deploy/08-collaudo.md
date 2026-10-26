# Fase 08 — Collaudo end-to-end

**Giorno 2. Durata: circa 1 ora (più qualche minuto per le email).** Prerequisiti: tutte le fasi 00-07 e il sito aperto su
`https://app.mchaservice.tech`. Questa fase non crea nulla di nuovo: **prova che ogni freccia del diagramma funziona**, in
ordine. Se un test fallisce, non passare al successivo: guarda i log indicati in fondo.

Per i test servono **tre utenti** con indirizzi diversi, tutti **verificati in SES** (fase 00, punto 0.5): per esempio
`tuonome+buyer@gmail.com`, `tuonome+agent@gmail.com`, `tuonome+admin@gmail.com` (tutti nella stessa casella). Usa tre finestre
del browser separate (o una finestra in incognito per ciascuno) per restare collegato con utenti diversi.

## 8.1 Registrazione e login (Cognito + Users Lambda + Mailer)

- [ ] Finestra A: apri `https://app.mchaservice.tech` e premi **Accedi / Registrati**. Ti ritrovi su Cognito (`...amazoncognito.com`).
      **Sign up** con l'indirizzo `+agent`, scegli una password. Cognito invia un **codice di verifica** (via il suo servizio
      email, funziona con qualsiasi indirizzo). Inseriscilo.
- [ ] Torni sul sito (URL `https://app.mchaservice.tech/callback`, poi la home) già loggato.
- [ ] Ripeti con `+buyer` (finestra B) e `+admin` (finestra C).

**Cosa è successo dietro le quinte (e dove lo vedi).**
1. Il browser ha fatto il giro *authorization code + PKCE* con Cognito (le Network del browser mostrano `/oauth2/token`).
2. Subito dopo il login la SPA ha chiamato `PUT /users/me` con l'access token: **API Gateway** ha validato il JWT, la
   **Users Lambda** ha creato la riga nel database (via proxy, con IAM) e ha pubblicato l'evento `WELCOME` su SNS.
3. SNS -> SQS -> **Mailer** -> `AdminGetUser` su Cognito -> SES: ti arriva un'**email di benvenuto** all'indirizzo `+agent`.

**Verifica.**
- [ ] Cognito > Users: i tre utenti, stato **Confirmed**, email verificata.
- [ ] L'email di benvenuto arriva (entro 1 minuto, controlla anche lo spam) all'indirizzo di ciascun utente.
      Se non arriva: vedi "Dove guardare" sotto (Mailer, SQS, SES).
- [ ] Network del browser: `PUT /users/me` risponde **201** la prima volta (poi 200), non 401/403/500.

## 8.2 Assegna i gruppi (passo manuale: la documentazione non lo automatizza)

- [ ] **Cognito > User pool > Users > l'utente `+agent` > Group memberships > Add user to group > `agent`**.
- [ ] `+buyer` -> `buyer`. `+admin` -> `admin`.
- [ ] In ogni finestra **esci dal sito e rientra** (Esci, poi Accedi): il gruppo compare nell'access token solo al login
      successivo. Senza questo, i prossimi test danno 403 anche se il gruppo c'è.

**Perché.** Il ruolo è il claim `cognito:groups` del token: le Lambda lo leggono, l'authorizer no. Un utente senza gruppo
vede il messaggio "account in attesa di un ruolo" ([contratto.md](contratto.md#gruppi-cognito)).

**Verifica del claim.** Se vuoi vedere cosa c'è davvero nel token, decodificalo **in locale**, non su siti web (un access token
è come una chiave: non incollarlo in servizi di terzi). Dal DevTools del browser (Application/Network) copia il token e, sul
tuo PC, `echo <token> | cut -d. -f2 | base64 -d` mostra `sub`, `cognito:groups` (array), `client_id`, `token_use: "access"`.
Nelle Lambda lo stesso claim arriva come stringa `"[agent]"`: se `POST /properties` funziona per l'agente, la conversione
è corretta (era il punto da verificare alla prima prova, [api-gateway.md](../api-gateway.md#authorizer-jwt)).

## 8.3 Checklist funzionale

Esegui nell'ordine. "Atteso" è ciò che deve succedere.

| # | Chi | Azione | Atteso |
| --- | --- | --- | --- |
| 1 | visitatore (finestra senza login) | apri l'elenco annunci | pagina visibile senza account; elenco (vuoto) |
| 2 | `+buyer` | prova a creare un annuncio (se la SPA lo permette, o con "Pubblica") | rifiutato: **403** (manca il gruppo `agent`) |
| 3 | `+agent` | crea un annuncio con titolo, prezzo, città | **201**, compare nell'elenco e nel dettaglio; visibile anche al visitatore |
| 4 | `+agent` | carica **una foto** (JPG < 10 MB) nell'annuncio | upload ok; la foto compare nel dettaglio; l'URL è su `https://files.mchaservice.tech/uploads/<id>/<uuid>.jpg` |
| 5 | (console) | S3 > bucket file > `uploads/<id>/`: l'oggetto c'è; CloudWatch > log Files Lambda: invocazione da S3; l'elenco `GET .../files` lo mostra | la riga nel database è stata creata **dalla notifica S3**, non dal browser |
| 6 | `+agent` | prova una foto > 10 MB o un file non immagine/video | rifiutato (lato Presigned **422**, o S3 rifiuta il POST per `content-length-range`) |
| 7 | `+buyer` | fai un'offerta sull'annuncio | **201**; l'agente riceve l'email "nuova offerta" (`OFFER_CREATED`) |
| 8 | `+buyer` | prova ad **accettare** la propria offerta | rifiutato (accettare/rifiutare è solo del proprietario) |
| 9 | `+agent` | **accetta** l'offerta | stato `accepted`; il buyer riceve l'email (`OFFER_ACCEPTED`) |
| 10 | `+buyer` | fai una seconda offerta e **ritirala** | stato `withdrawn` (`DELETE /offers/{id}`, 204); ritirare di nuovo la stessa offerta, o una già `accepted`, dà **409** (solo le `pending` cambiano stato) |
| 11 | `+admin` | modifica/cancella l'annuncio di un altro | permesso (l'admin può) |
| 12 | `+buyer` | prova a modificare l'annuncio dell'agente | **403** (ownership) |
| 13 | `+agent` | cancella una foto | sparisce dal sito; l'oggetto sparisce da S3 |
| 14 | `+agent` | **cancella l'annuncio** | 204; l'intero prefisso `uploads/<id>/` sparisce da S3 (controlla nel bucket); l'annuncio non è più nell'elenco |
| 15 | `+buyer` | **cancella l'account** (ti chiede di rifare il login con la password: è `prompt=login`) | dopo la cancellazione l'utente non esiste più in Cognito; l'agente (se c'erano offerte `pending`) riceve `OFFER_WITHDRAWN`; la riga `users` resta solo con il `sub` |
| 16 | - | token scaduto | dopo 60 minuti, la SPA rifà il giro del login: l'utente non ridà la password finché il cookie del login gestito vale |

Dettagli: l'email del buyer non è nel database né nei token (sta solo in Cognito), la Mailer la legge con `AdminGetUser`.
Nella mail non c'è alcun dato dell'utente cancellato.

## 8.4 Controlli di sicurezza rapidi

- [ ] Senza token: `curl -i -X POST https://<API_ID>.execute-api.eu-south-1.amazonaws.com/properties` -> **401**.
- [ ] Il bucket dei file non è leggibile direttamente:
      `https://real-estate-prod-files-<SUFFIX>.s3.eu-south-1.amazonaws.com/uploads/qualcosa.jpg` -> **403 AccessDenied** (la lettura
      pubblica passa solo da `files.mchaservice.tech`).
- [ ] Il bucket del sito non è leggibile direttamente (stesso test sul suo endpoint) -> 403.
- [ ] `https://app.mchaservice.tech` con `http://` reindirizza a HTTPS.
- [ ] RDS: Connectivity & security -> **Publicly accessible: No**; `sg-rds` con una sola regola in entrata (dal proxy).
- [ ] CORS: dalla console del browser su un altro sito, una `fetch` all'API è bloccata; dal sito funziona.
- [ ] IAM Access Analyzer (facoltativo): nessun bucket o ruolo esposto fuori dall'account.

## 8.5 Dove guardare quando un test fallisce

| Cosa fallisce | Dove guardare |
| --- | --- |
| Errore nella pagina | F12 > Console (CSP, CORS) e Network (stato e corpo della risposta) |
| 401 | authorizer (Issuer, Audience, tipo di token, scadenza): fase 06.2 |
| 403 con token valido | gruppo mancante o token vecchio (esci e rientra); poi log della Lambda dello scope |
| 500 | CloudWatch > Log groups > `/aws/lambda/real-estate-prod-<scope>` (ultimo log stream); più `/aws/apigateway/real-estate-prod-api` |
| Lambda non raggiunge il DB | vedi tabella nella fase 05.2 |
| Foto non si carica | Network: la POST verso `...s3.eu-south-1.amazonaws.com` (CORS/CSP); risposta della Presigned |
| Foto caricata ma non appare | log della Files Lambda; notifica S3 configurata (fase 05.4); bucket policy dei file (fase 07.5) |
| Email non arriva | in ordine: SQS (la coda ha messaggi? `ApproximateNumberOfMessagesVisible`), log Mailer (`/aws/lambda/real-estate-prod-mailer`, cerca `MAIL_SENT`, `MAIL_RETRY`, `MAIL_PERMANENT_FAILURE`), SES (destinatario verificato?), spam |
| Email "MessageRejected" | destinatario non verificato in SES (sandbox) |

## Risultato della fase 08

- [ ] Tutti i punti 1-15 della checklist passano; `PUT /users/me` 201 al primo login.
- [ ] Email di benvenuto, nuova offerta, esito offerta, offerta ritirata ricevute.
- [ ] Controlli di sicurezza: tutti come previsto.
- [ ] La DLQ è vuota (SQS > `...-dlq` > Messages available = 0).

La **prova della DLQ e dell'allarme** (scatta davvero?) la fai in fase 09, dopo aver creato gli allarmi.

Prossimo: [09-monitoraggio.md](09-monitoraggio.md).
