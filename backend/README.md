# Backend — Lambda in TypeScript

Il codice delle sette funzioni (sei di business più `db-migrate`, temporanea) e, accanto, lo SQL del database in
[`../database/`](../database). Le regole di dominio (route, oggetti JSON, variabili) stanno in
[`../deploy/contratto.md`](../deploy/contratto.md); le specifiche di ogni servizio nei file `lambda-*.md` della radice.

## Struttura

```
backend/
  src/shared/        codice comune a tutte le funzioni
    db.ts            pool pg (1 connessione) + token IAM + TLS
    auth.ts          currentUser, requireGroup, requireActiveUser
    errors.ts        errori tipizzati (400, 401, 403, 404, 409, 410, 422)
    http.ts          router interno, risposte JSON, parsing del body, errori -> formato del contratto
    validation.ts    controllo dei campi (a mano, nessuna libreria)
    sns.ts           pubblicazione degli eventi (mai bloccante)
    media.ts         whitelist dei tipi di file e chiavi S3
    log.ts           log JSON (una riga = un oggetto con level e code)
  src/functions/<nome>/index.ts    handler della funzione (solo cablaggio: crea pool/client e router)
  src/functions/<nome>/routes.ts   le route: qui sta la logica
  test/              test (node:test)
  scripts/           build, package, test
../database/schema.sql, roles.sql
```

Ogni funzione si compila in **un solo file** `dist/<nome>/index.js` (esbuild, CommonJS, target Node 22) che include anche
l'AWS SDK: lo zip è autosufficiente e non dipende dalla versione dell'SDK del runtime. Handler: `index.handler`.

## Comandi

```bash
npm ci
npm run typecheck     # tsc --noEmit (strict)
npm test              # test unitari; con PG_TEST_HOST impostato anche quelli su PostgreSQL vero (vedi sotto)
npm run build         # dist/<nome>/index.js
npm run package       # dist/<nome>.zip con index.js alla radice
```

`package` scrive gli zip con uno script Node (nessun comando di sistema richiesto). Il caricamento su Lambda lo descrive
il piano di deploy in `deploy/`.

## Funzioni, zip, variabili, dimensionamento

Le variabili sono quelle del contratto. `AWS_REGION` la imposta Lambda da sola. Nessuna password né chiave: le Lambda
nella VPC entrano nel proxy con un token IAM.

| Funzione | Zip | Variabili d'ambiente | Timeout | Memoria |
| --- | --- | --- | --- | --- |
| `real-estate-prod-property` | `property.zip` | `DB_HOST` (proxy), `DB_PORT`, `DB_NAME`, `DB_USER=property_user`, `FILES_BUCKET` (`SNS_TOPIC_ARN` è prevista dal contratto ma oggi **non serve**: la Property non pubblica eventi) | 30 s (la pulizia di S3 su immobili con molti file) | 256 MB |
| `real-estate-prod-users` | `users.zip` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER=users_user`, `SNS_TOPIC_ARN` | 15 s | 256 MB |
| `real-estate-prod-offers` | `offers.zip` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER=offers_user`, `SNS_TOPIC_ARN` | 15 s | 256 MB |
| `real-estate-prod-presigned` | `presigned.zip` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER=presigned_user`, `FILES_BUCKET` | 15 s | 256 MB |
| `real-estate-prod-files` | `files.zip` | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER=files_user`, `FILES_BUCKET` | 30 s | 256 MB |
| `real-estate-prod-mailer` (fuori VPC) | `mailer.zip` | `USER_POOL_ID`, `MAIL_FROM`, `SITE_URL` | 30 s (la coda ha il visibility timeout a 180 s) | 256 MB |
| `db-migrate` (**temporanea**, in VPC) | `db-migrate.zip` | `DB_HOST` = endpoint dell'**istanza RDS** (non del proxy), `DB_PORT`, `DB_NAME=realestate` | 120 s | 256 MB |

Il ruolo IAM di ogni funzione è quello di `lambda.md`. Il router di una funzione riceve `routeKey` ("GET /properties/{id}")
dall'evento di API Gateway: le route nel codice devono avere **la stessa chiave** di quelle create nell'API.

## Come ragiona ogni parte

**Connessione al database (`db.ts`).** Il pool è creato a livello di modulo, cioè *fuori* dall'handler: sopravvive tra
le invocazioni "calde" e la connessione non si riapre a ogni richiesta. Max 1 connessione, perché un'istanza Lambda fa una
richiesta alla volta (il numero totale lo governa l'RDS Proxy). La password è una **funzione async** che `pg` chiama a
ogni nuova connessione e che restituisce un token IAM (`@aws-sdk/rds-signer`, calcolo locale) rigenerato ogni 10 minuti,
prima dei 15 di validità. TLS con verifica del certificato. Se una connessione è morta mentre l'ambiente era congelato, le
`SELECT` vengono ritentate una volta, e le transazioni ritentano il solo `BEGIN`; una scrittura singola non si ripete
mai da sola (potrebbe duplicarsi).

**Autenticazione (`auth.ts`).** L'authorizer di API Gateway ha già validato il JWT: `currentUser` legge solo `sub` e
`cognito:groups` dai claim (e rifiuta tutto ciò che non è un access token). Il `sub` non viene **mai** dal body.
`cognito:groups` arriva come stringa `"[buyer agent]"`, non come array: `parseGroups` la gestisce. `requireActiveUser`
guarda se la riga `users` ha `deleted_at`: un token emesso prima della cancellazione dell'account vale ancora fino a 60
minuti, ma non può più scrivere (403).

**Errori (`http.ts`).** Le funzioni lanciano errori tipizzati (`NotFoundError`, `ConflictError`...) e il router li traduce
in `{"error": {"code", "message"}}`. Un errore imprevisto diventa 500 generico (i dettagli solo nel log); alcune violazioni
di vincolo di PostgreSQL diventano 409/422. Chiave esterna violata = 409: tipicamente l'utente non ha ancora fatto
`PUT /users/me`.

**SQL.** Sempre parametrizzato (`$1`, `$2`...). Dove la query è dinamica (filtri di `GET /properties`, `PUT /properties`)
i *nomi* di colonna vengono da una whitelist nel codice e i *valori* vanno sempre nei parametri.

**Eventi (`sns.ts`).** Si pubblica **dopo** il commit, con `eventId` (UUID), `type`, `recipientSub`, `occurredAt`, `data`:
mai l'email. Se la pubblicazione fallisce si scrive `SNS_PUBLISH_FAILED` nel log e la richiesta riesce comunque: un'email
persa non deve annullare un'offerta.

**Property.** Elenco pubblico solo `active`, con filtri, `limit`/`offset`, `total` e `coverKey` (la prima immagine
registrata per id). La cancellazione fa prima il database (le righe di offerte e file spariscono per la cascata) e poi
svuota `uploads/<id>/` su S3 elencando il prefisso e cancellando a blocchi da 1000. Se S3 fallisce dopo il commit scrive
`FILES_CLEANUP_FAILED` (`level` ERROR) e risponde 204 comunque.

**Users.** `PUT /users/me` è un solo `INSERT ... ON CONFLICT DO UPDATE`: crea, aggiorna i soli campi presenti nel body, e
non tocca una riga cancellata (410). `(xmax = 0)` dice se la riga è nuova (201 + evento `WELCOME`). `DELETE /users/me`
anonimizza in **una transazione** (profilo, immobili, offerte in sospeso) e dopo il `COMMIT` manda `OFFER_WITHDRAWN`
all'altra parte di ogni offerta ritirata.

**Offers.** Offerta solo da `buyer` e su immobile `active`. Accettare o rifiutare lo può fare **solo il proprietario**
(contratto); ritirare chi l'ha fatta o il proprietario; solo se `pending`, altrimenti 409 (l'`UPDATE ... WHERE status =
'pending'` evita le corse).

**Presigned.** Controlla utente attivo, proprietario e immobile non ritirato; poi firma un presigned POST in locale. La
chiave la decide il server (`uploads/<id>/<uuid>.<ext>`, ext dalla whitelist di `media.ts`). Oltre alle condizioni di
`config/presigned-post-conditions.json` (bucket, chiave esatta, prefisso `image/` o `video/`, `content-length-range`:
10 MiB le immagini, 100 MiB i video) il campo `Content-Type` è fissato al valore dichiarato, così il tipo caricato è
quello su cui abbiamo scelto l'estensione. La SPA deve inviare nel form **tutti** i `fields` e poi il file.

**Files.** Un handler per due tipi di evento. Evento S3: la chiave arriva URL-codificata (`+` per lo spazio) e va
decodificata; la notifica non porta il content-type, che si ricava dall'estensione (`media.ts`); si registra con un
`INSERT ... SELECT` che inserisce solo se l'immobile esiste ed è attivo, ed è idempotente (`object_key` UNIQUE). Se
l'immobile non c'è o è ritirato, cancella l'oggetto. Evento HTTP: elenco e `DELETE /files/{id}`.

**Mailer.** Per ogni messaggio SQS: valida l'evento, chiede l'email a Cognito (`AdminGetUser` con `Username = recipientSub`),
compone l'email in italiano (testo + HTML, con escape del titolo) e la invia con SES v2. Non lancia mai: risponde con
`batchItemFailures` per i soli errori **temporanei** (throttling, 5xx, timeout, invio sospeso...). Permanenti (messaggio
malformato, email non verificata, `MessageRejected`): log `{"level":"ERROR","code":"MAIL_PERMANENT_FAILURE"}`, che è
esattamente ciò che cerca il metric filter in `config/cloudwatch-metric-filter-mailer-permanent-failures.json`;
`UserNotFoundException` (utente cancellato): solo `INFO` `RECIPIENT_DELETED`. Nei log mai l'email né il messaggio degli
errori di AWS (può contenerla).

**Log (`log.ts`).** Una riga JSON con `level` e `code` al primo livello, scritta con `process.stdout.write`: con
`console.log` il formato "testo" di Lambda aggiunge un prefisso e i metric filter JSON non riconoscerebbero la riga.

## Database

- `schema.sql`: tabelle del contratto, indici sulle query reali, ed `updated_at` aggiornato da un **trigger**: così
  `users_user`, che può fare `UPDATE` solo di `status`, fa comunque avanzare `updated_at` senza GRANT in più.
- `roles.sql`: cinque utenti con le password passate come variabili psql (mai nel file), `REVOKE` da `PUBLIC`, `GRANT` al
  minimo e a livello di colonna. Il file è dichiarativo: azzera e riassegna i privilegi, quindi rieseguirlo è sicuro.
  Differenze rispetto all'esempio di `rds-postgres.md`, imposte dal codice: `property_user` legge anche `display_name`/`bio`
  di `users` (agente nel dettaglio) e `id, property_id, object_key, content_type` di `files` (`coverKey` nell'elenco);
  `files_user` e `presigned_user` leggono `owner_id` e `status` di `properties` (ownership e immobile ritirato).
  `property_user` non ha GRANT di scrittura su `offers` e `files`: la cascata gira coi permessi del proprietario delle tabelle.
- Applicazione a mano, con l'utente master: `psql ... -f database/schema.sql` poi `roles.sql` con
  `-v property_password=... -v users_password=... -v offers_password=... -v files_password=... -v presigned_password=...`.

## `db-migrate`: applicare gli SQL dall'interno della VPC

Il database sta in subnet private senza Internet: dalla console non c'è modo di lanciare gli SQL. `db-migrate` è una
Lambda **temporanea**, nella VPC, che si collega **direttamente all'istanza** con l'utente master (non al proxy, che
accetta solo gli utenti applicativi) e applica `schema.sql` e `roles.sql` incorporati nel bundle. Serve:

- ruolo con le sole policy gestite `AWSLambdaBasicExecutionRole` e `AWSLambdaVPCAccessExecutionRole` (niente `rds-db:connect`);
- subnet private A e B e `sg-lambda-internal`, e una regola **temporanea** su `sg-rds` che ammetta 5432 da quel gruppo
  (di norma `sg-rds` accetta solo dal proxy);
- l'istanza usa un certificato di una CA di RDS: il bundle di `eu-south-1` è incorporato (`rds-ca-eu-south-1.pem`).

Test dalla console (tab "Test"), evento JSON:

```json
{ "action": "migrate", "masterUser": "...", "masterPassword": "...",
  "passwords": { "property_user": "...", "users_user": "...", "offers_user": "...", "files_user": "...", "presigned_user": "..." } }
```

`"action": "status"` (solo `masterUser` e `masterPassword`) non modifica niente e riassume tabelle, ruoli e GRANT.
Crea il database `realestate` se manca (collegandosi prima a `postgres`), è idempotente (ruoli: creati o `ALTER ... PASSWORD`),
accetta password di almeno 12 caratteri e non scrive mai password nei log, nemmeno negli errori. **A fine setup si cancellano
funzione, ruolo IAM e regola temporanea su `sg-rds`.**

## Test

`npm test` esegue i test unitari (gruppi dei claim, router, validazioni, filtri e SQL, chiavi e condizioni del presigned,
eventi S3, classificazione errori e log della Mailer, sostituzione sicura delle password).

`test/integration.test.ts` gira solo se è impostato `PG_TEST_HOST`: crea un database nuovo, applica `schema.sql` e
`roles.sql` con la stessa funzione di `db-migrate` e fa passare le route vere connesse **come i cinque utenti**, con S3 e
SNS finti. Verifica che i GRANT bastino (cascata, anonimizzazione, registrazione file, offerte) e che le operazioni non
previste siano negate.

```bash
PG_TEST_HOST=127.0.0.1 PG_TEST_PORT=5432 PG_TEST_MASTER_USER=<utente con CREATEDB e CREATEROLE> \
PG_TEST_MASTER_PASSWORD=<password> npm test
```
