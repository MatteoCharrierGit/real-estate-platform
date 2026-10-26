# Fase 06 — API Gateway (HTTP API)

**Giorno 2. Durata: circa 1,5 ore.** Prerequisiti: fase 04 (`<USER_POOL_ID>`, `<APP_CLIENT_ID>`) e fase 05 (le 5 Lambda di
business esistono). Concetti: [api-gateway.md](../api-gateway.md). JSON: `config/http-api-cors.json`,
`iam/resource-policies/lambda-allow-api-gateway.json`.

L'HTTP API è la porta d'ingresso del backend: riceve le richieste del browser, controlla il token (per le route
protette), applica CORS e inoltra alla Lambda giusta. Costruisci tre cose: le **route** (16, con 5 integrazioni
Lambda), l'**authorizer JWT** (il controllo del token) e le **impostazioni dello stage** (CORS, log, throttling).

## Le 16 route

Le route sono **esplicite** (niente `$default` né `ANY /{proxy+}`): così il CORS risponde da solo ai preflight `OPTIONS`
senza passare dall'authorizer.

| # | Metodo e percorso | Lambda | Accesso |
| --- | --- | --- | --- |
| 1 | `GET /properties` | property | pubblica |
| 2 | `GET /properties/{id}` | property | pubblica |
| 3 | `POST /properties` | property | **JWT** (gruppo `agent`, controllato dalla Lambda) |
| 4 | `PUT /properties/{id}` | property | JWT |
| 5 | `DELETE /properties/{id}` | property | JWT |
| 6 | `GET /users/me` | users | JWT |
| 7 | `PUT /users/me` | users | JWT |
| 8 | `DELETE /users/me` | users | JWT |
| 9 | `GET /users/{id}` | users | pubblica |
| 10 | `POST /properties/{id}/offers` | offers | JWT |
| 11 | `GET /offers` | offers | JWT |
| 12 | `PUT /offers/{id}` | offers | JWT |
| 13 | `DELETE /offers/{id}` | offers | JWT |
| 14 | `POST /properties/{id}/uploads` | presigned | JWT |
| 15 | `GET /properties/{id}/files` | files | pubblica |
| 16 | `DELETE /files/{id}` | files | JWT |

**Scrivi i percorsi esattamente così** (`{id}` compreso): le Lambda scelgono la logica dalla *routeKey* dell'evento, cioè dalla
stringa `"METODO /percorso/{param}"` come configurata qui. Un percorso scritto diversamente (`{propertyId}`, uno slash in più)
produce una risposta 404 dalla Lambda anche se l'API sembra a posto.

**Pubbliche (4):** 1, 2, 9, 15. **Con JWT (12):** tutte le altre. `GET /users/me` e `GET /users/{id}` convivono: API Gateway
sceglie sempre il percorso più specifico (`/users/me` batte `/users/{id}`).

**Perché due livelli di controllo.** Il JWT dice *chi sei* (firma, issuer, scadenza, app client giusti). Il **ruolo**
(gruppo) e l'**ownership** (l'immobile è tuo?) li controllano poi le Lambda, perché dipendono dai dati nel database
([api-gateway.md](../api-gateway.md#autorizzazione-su-due-livelli)).

## 6.1 Crea l'API con le integrazioni e le route

- [ ] **API Gateway > Create API > HTTP API > Build**. Regione **Milano**.
- [ ] **Step 1 (Integrations)**: *Add integration* > **Lambda** (5 volte), ciascuna con la sua funzione:
      `real-estate-prod-property`, `-users`, `-offers`, `-presigned`, `-files`. Version 2.0 (default). API name:
      **`real-estate-prod-api`**.
- [ ] **Step 2 (Routes)**: *Add route* per ciascuna delle 16 righe della tabella: scegli metodo, scrivi il percorso e collega
      l'integrazione giusta. Dopo averne aggiunta una la console te ne propone un'altra: continua finché sono 16.
      I segnaposto si scrivono tra graffe, esattamente `{id}`.
- [ ] **Step 3 (Stages)**: lascia lo stage **`$default`** con **Auto-deploy attivo**. (Con `$default` l'URL non ha prefisso
      di stage: `https://<API_ID>.execute-api.eu-south-1.amazonaws.com/properties`.)
- [ ] Review and create > Create.
- [ ] Annota **API ID** (es. `a1b2c3d4e5`) = `<API_ID>` e **Invoke URL**
      (`https://<API_ID>.execute-api.eu-south-1.amazonaws.com`) = `VITE_API_URL`.

**Perché `$default` e integrazione "proxy".** Ogni route usa la *Lambda proxy integration* (payload 2.0): la Lambda riceve
l'intera richiesta HTTP come evento e restituisce status, header e corpo. Le Lambda hanno un router interno per scope
([lambda.md](../lambda.md#una-lambda-per-scope-con-router-interno)). Lo stage `$default` è la scelta più semplice per le
HTTP API.

**Verifica.** API Gateway > l'API > **Routes**: 16 route, ciascuna con un'integrazione collegata alla funzione giusta
(clic sulla route: *Integration details*). Controlla soprattutto che `/properties/{id}/uploads` vada a **presigned** e
`/properties/{id}/files` a **files** (sono le due che si confondono con `/properties/{id}`).

**Permessi di invocazione.** Quando colleghi un'integrazione la console aggiunge da sola alla Lambda una **resource-based
policy** che ammette `apigateway.amazonaws.com` a invocarla da *questa* API (con condizione `AWS:SourceArn` sull'ARN
dell'API). È la stessa cosa che descrive `iam/resource-policies/lambda-allow-api-gateway.json` (là con `<API_ID>/*`: la
console crea statement per route, equivalenti o più stretti). Per controllare: Lambda > Configuration > Permissions >
*Resource-based policy statements*. **Perché la condizione `SourceArn`:** senza, qualunque API Gateway di qualunque
account potrebbe invocare la tua funzione (*confused deputy*).

**Se una route risponde 500** con "Internal Server Error" e nei log (o nella risposta di test) compare *Invalid permissions
on Lambda function*: manca la policy per quella funzione. Aggiungila a mano (Lambda > Add permissions > AWS service):
principal `apigateway.amazonaws.com`, action `lambda:InvokeFunction`, source ARN
`arn:aws:execute-api:eu-south-1:<ACCOUNT_ID>:<API_ID>/*`, statement id `AllowHttpApiInvoke`.

## 6.2 L'authorizer JWT

- [ ] API > **Authorization > Manage authorizers > Create**: Authorizer type **JWT**; Name `cognito-access-token`;
  - Identity source: **`$request.header.Authorization`** (il prefisso `Bearer` è accettato).
  - Issuer URL: **`https://cognito-idp.eu-south-1.amazonaws.com/<USER_POOL_ID>`** (esattamente, senza slash finale).
  - Audience: **`<APP_CLIENT_ID>`**.
  - Create.
- [ ] Sempre in **Authorization**: nell'elenco delle route seleziona **ciascuna delle 12 route protette** (3-8, 10-14, 16 della tabella)
      > *Attach authorizer* > `cognito-access-token`. Controlla che le 4 pubbliche (1, 2, 9, 15)
      risultino **senza** authorizer.

**Perché.** L'authorizer verifica firma (chiavi pubbliche JWKS del pool), issuer, audience e scadenza **senza chiamare
Cognito** a ogni richiesta; se il token non va, risponde 401 e la Lambda non parte. L'**audience** si confronta con il
claim `aud` se c'è, altrimenti con **`client_id`**: l'access token di Cognito non ha `aud`, quindi il controllo avviene su
`client_id` e per questo Audience = ID dell'app client ([api-gateway.md](../api-gateway.md#authorizer-jwt)). Alle Lambda
arrivano `sub` e `cognito:groups` in `event.requestContext.authorizer.jwt.claims`. **Nessuno scope sulle route**: i
permessi applicativi sono i gruppi.

**Attenzione al formato dei gruppi.** Il claim `cognito:groups` arriva come **stringa**, per esempio `"[buyer agent]"`,
non come array JSON; il codice lo gestisce con la funzione comune `currentUser`. La documentazione dice di verificarlo alla
prima prova: lo farai in fase 08 guardando i log.

**Verifica.** Authorization: authorizer elencato; ogni route protetta ne mostra uno, le pubbliche no.

## 6.3 CORS

- [ ] API > **CORS > Configure** (valori da `config/http-api-cors.json`, con `<SITE_DOMAIN>` = `app.mchaservice.tech`):
  - Access-Control-Allow-Origin: **`https://app.mchaservice.tech`** (solo questo; niente `*`).
  - Access-Control-Allow-Methods: **GET, POST, PUT, DELETE**.
  - Access-Control-Allow-Headers: **`authorization`**, **`content-type`**.
  - Access-Control-Max-Age: **3600**. Access-Control-Allow-Credentials: no. Expose headers: nessuno.
  - Save.

**Perché.** Il sito (`app.mchaservice.tech`) e l'API (`...execute-api...amazonaws.com`) hanno **origini diverse**: il browser
fa prima una richiesta `OPTIONS` (*preflight*) per chiedere "posso?". Con questa configurazione l'API risponde da sola, senza
authorizer e senza invocare Lambda. Ammettere *solo* la tua origine impedisce ad altri siti di far chiamare l'API dal browser
dei tuoi utenti. Se in futuro vuoi provare la SPA in locale (`http://localhost:5173`) aggiungi quell'origine, e toglila dopo.

## 6.4 Log di accesso e throttling dello stage

- [ ] **CloudWatch > Log groups > Create log group**: nome **`/aws/apigateway/real-estate-prod-api`**, retention **14 days**.
      Copia il suo ARN.
- [ ] API > **Stages > `$default` > Logging > Edit**: *Access logging* attivo; *Log destination ARN* = l'ARN del log group;
      formato log: scegli un preset JSON. Save.
- [ ] API > **Stages > `$default` > Throttling (Default route throttling) > Edit**: Rate **20** richieste al secondo,
      Burst **40**. Save.

**Perché.** I log dicono chi chiama cosa e con che esito (indispensabile per i collaudi). Il throttling è una difesa
minima contro gli abusi: oltre il limite l'API risponde 429. Per le HTTP API **non serve il ruolo CloudWatch a livello
account** (serve solo alle REST API): basta indicare il log group. AWS WAF non si può associare direttamente a una HTTP API
([api-gateway.md](../api-gateway.md#throttling)).

## 6.5 Prove da riga di comando (o dal browser)

Sostituisci `<API>` con l'Invoke URL.

- [ ] Rotta pubblica: apri `<API>/properties` nel browser o `curl -i <API>/properties`.
      Atteso: **200** e `{"items":[],"total":0}` (elenco vuoto, non c'è ancora nessun immobile). Dimostra
      API -> Lambda -> proxy -> DB.
- [ ] Rotta protetta senza token: `curl -i -X POST <API>/properties -H "content-type: application/json" -d "{}"`.
      Atteso: **401 Unauthorized** (risposta dell'authorizer: la Lambda non è nemmeno partita).
- [ ] Preflight consentito:
  ```text
  curl -i -X OPTIONS <API>/properties -H "Origin: https://app.mchaservice.tech" -H "Access-Control-Request-Method: GET"
  ```
  Atteso: **204** con `access-control-allow-origin: https://app.mchaservice.tech`.
- [ ] Preflight da un'origine diversa: stesso comando con `Origin: https://example.com`. Atteso: nessun header
      `access-control-allow-origin` nella risposta.
- [ ] Pubblica: `<API>/properties/1/files` -> risposta della Files Lambda (404 o elenco vuoto: dipende dal codice, ma **non** 401/500).

Il test con un token vero lo fai in fase 08.

**Se si rompe.**
| Sintomo | Causa |
| --- | --- |
| 500 / `{"message":"Internal Server Error"}` su `GET /properties` | permesso di invocazione mancante (vedi sopra) o la Lambda fallisce: guarda i log della funzione (CloudWatch) |
| `{"message":"Not Found"}` | percorso/metodo non esistono come route, o stage sbagliato nell'URL (con `$default` **non** va `/prod`) |
| 401 anche con token valido | Issuer/Audience sbagliati (Audience = ID app client; Issuer con l'ID del pool); token = ID token invece dell'access token (l'authorizer accetta l'ID token, ma le Lambda lo rifiutano con 401/403: `token_use`) |
| 403 `Forbidden` | route protetta con authorizer ma chiamata senza header `Authorization`, o API chiamata da un'origine non CORS dal browser |
| 429 | throttling raggiunto |
| Timeout 503/504 | la Lambda ha impiegato più di 30 secondi |

## Risultato della fase 06 (puoi fermarti qui)

- [ ] API `real-estate-prod-api`, stage `$default`, 16 route, 5 integrazioni Lambda.
- [ ] Authorizer `cognito-access-token` su 12 route; 4 pubbliche.
- [ ] CORS limitato a `https://app.mchaservice.tech`.
- [ ] Log di accesso su `/aws/apigateway/real-estate-prod-api`; throttling 20/40.
- [ ] `GET /properties` -> 200; `POST /properties` senza token -> 401; preflight -> 204.
- [ ] Annotati: `<API_ID>`, Invoke URL.

Prossimo: [07-cloudfront-dominio-sito.md](07-cloudfront-dominio-sito.md).
