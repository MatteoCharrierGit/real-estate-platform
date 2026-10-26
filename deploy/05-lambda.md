# Fase 05 — Le 6 Lambda

**Giorno 2. Durata: 2,5 - 3 ore.** Prerequisiti: fasi 01-04 (servono: `<PROXY_RESOURCE_ID>`, endpoint del proxy, ARN del
topic, nomi dei bucket, `<USER_POOL_ID>`, `<MAIL_FROM>`, gli zip in `backend/dist/`). Concetti: [lambda.md](../lambda.md) e i
file `../lambda-*.md`. JSON: `iam/policies/lambda-*.json`, `iam/resource-policies/lambda-files-allow-s3.json`,
`config/lambda-mailer-event-source-mapping.json`, `config/s3-files-notification.json`.

Una Lambda è codice eseguito su richiesta, con un **ruolo IAM** (cosa può fare il codice) e, per le 5 di business, una
collocazione nella VPC (per raggiungere il proxy). Per ognuna fai: **ruolo -> funzione -> variabili -> zip**. L'ordine è
volutamente questo: non puoi creare la funzione senza il ruolo.

## Il quadro

| Funzione | Ruolo | VPC | Utente DB | Zip |
| --- | --- | --- | --- | --- |
| `real-estate-prod-property` | `real-estate-prod-lambda-property-role` | sì (`sg-lambda-internal`) | `property_user` | `property.zip` |
| `real-estate-prod-users` | `real-estate-prod-lambda-users-role` | sì | `users_user` | `users.zip` |
| `real-estate-prod-offers` | `real-estate-prod-lambda-offers-role` | sì | `offers_user` | `offers.zip` |
| `real-estate-prod-presigned` | `real-estate-prod-lambda-presigned-role` | sì | `presigned_user` | `presigned.zip` |
| `real-estate-prod-files` | `real-estate-prod-lambda-files-role` | sì | `files_user` | `files.zip` |
| `real-estate-prod-mailer` | `real-estate-prod-lambda-mailer-role` | **no** | - | `mailer.zip` |

Impostazioni comuni: Runtime **Node.js 22.x**, architettura **arm64**, handler `index.handler`, memoria **256 MB**.
Timeout: **15 secondi** per le 5 di business (l'API ne concede al massimo 30; nel VPC la prima richiesta è più lenta),
**30 secondi** per la Mailer (la coda ha visibility timeout 180 s = 6 x 30).

## 5.1 I 6 ruoli IAM

Per ciascuna riga della tabella sopra:

- [ ] **IAM > Roles > Create role** > *AWS service* > **Lambda** > Next.
  (È la trust relationship di `iam/trust-relationships/lambda.json`: `lambda.amazonaws.com` può assumere il ruolo.)
- [ ] Policy gestite da collegare (cerca per nome):
  - le 5 di business: **`AWSLambdaBasicExecutionRole`** e **`AWSLambdaVPCAccessExecutionRole`**;
  - la Mailer: **solo `AWSLambdaBasicExecutionRole`** (è fuori dalla VPC).
- [ ] Nome ruolo = quello della tabella. Create role.
- [ ] Riapri il ruolo > **Add permissions > Create inline policy > JSON**: incolla il file corrispondente, **dopo aver
      sostituito tutti i segnaposto**:

| Ruolo | File da incollare | Segnaposto da sostituire |
| --- | --- | --- |
| property | `iam/policies/lambda-property.json` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>`, `<SUFFIX>` |
| users | `iam/policies/lambda-users.json` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>` |
| offers | `iam/policies/lambda-offers.json` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>` |
| presigned | `iam/policies/lambda-presigned.json` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>`, `<SUFFIX>` |
| files | `iam/policies/lambda-files.json` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>`, `<SUFFIX>` |
| mailer | `iam/policies/lambda-mailer.json` | `<ACCOUNT_ID>`, `<USER_POOL_ID>`, `<MAIL_FROM>` |

  Nome della policy inline: per esempio `lambda-property-policy`, ecc.

**Perché.** Un ruolo per funzione = permessi minimi: se la Offers venisse compromessa non potrebbe cancellare file né
leggere la coda ([lambda.md](../lambda.md#execution-role)). Le policy gestite danno log e (per le 5) la creazione delle
ENI nella VPC; quelle nostre danno solo `rds-db:connect` per **un** utente PostgreSQL, `sns:Publish` sul **nostro** topic,
`s3` solo sul prefisso `uploads/`, ecc. `<PROXY_RESOURCE_ID>` è l'`prx-...` annotato in fase 03: se metti l'ID
sbagliato, la funzione non riesce a collegarsi e vedrai `PAM authentication failed` o `access denied for user`.

**Controlla a mano prima di salvare**: nessun `<...>` residuo nel JSON. L'editor IAM ti avvisa se il JSON è invalido ma
**non** se un ARN è sbagliato.

**Verifica.** Ogni ruolo ha 2 policy gestite (1 per la Mailer) + 1 inline. IAM > Roles, cerca `real-estate-prod`: 6 ruoli
(più quello del proxy).

## 5.2 Le 5 Lambda di business (stessa procedura, 5 volte)

Per ciascuna: **property, users, offers, presigned, files**.

- [ ] **Lambda > Create function** > *Author from scratch*:
  - Function name: `real-estate-prod-<scope>`. Runtime **Node.js 22.x**. Architecture **arm64**.
  - *Change default execution role* > *Use an existing role* > il ruolo di quella funzione.
  - *Advanced settings* > **Enable VPC**: VPC `real-estate-prod-vpc`; Subnets **entrambe** (`private_subnet_A` e `private_subnet_B`);
    Security groups: **solo `sg-lambda-internal`** (togli quello di default se compare).
  - Create function.
- [ ] Scheda **Code** > *Upload from* > *.zip file* > `backend/dist/<scope>.zip` > Save.
  *Runtime settings* > Edit > Handler **`index.handler`**.
- [ ] Scheda **Configuration > General configuration > Edit**: Memory **256 MB**, Timeout **15 sec**.
- [ ] **Configuration > Environment variables > Edit**: aggiungi quelle della tabella:

| Variabile | property | users | offers | presigned | files |
| --- | --- | --- | --- | --- | --- |
| `DB_HOST` | **endpoint del proxy** (`...proxy-xxxx.eu-south-1.rds.amazonaws.com`) | idem | idem | idem | idem |
| `DB_PORT` | `5432` | `5432` | `5432` | `5432` | `5432` |
| `DB_NAME` | `realestate` | `realestate` | `realestate` | `realestate` | `realestate` |
| `DB_USER` | `property_user` | `users_user` | `offers_user` | `presigned_user` | `files_user` |
| `SNS_TOPIC_ARN` | ARN di `real-estate-prod-notifications` | idem | idem | - | - |
| `FILES_BUCKET` | `real-estate-prod-files-<SUFFIX>` | - | - | idem | idem |

(La tabella segue il [contratto](contratto.md#lambda-variabili-dambiente) ed è quella che il codice legge: `backend/src/shared/db.ts` e le `index.ts` delle funzioni.)

**Perché.** `DB_HOST` è il **proxy**, non l'istanza: le Lambda non devono mai raggiungere direttamente il DB (`sg-rds`
non le ammette). Nessuna password: il codice genera un token IAM (valido 15 minuti, calcolato in locale) e lo usa come
password su TLS ([rds-proxy.md](../rds-proxy.md#autenticazione-iam-di-una-lambda-passo-per-passo)). Due subnet in due AZ: la
funzione sopravvive alla caduta di una zona. Il codice apre la connessione **fuori dall'handler**, per riusarla tra le
invocazioni.

**Verifica (dopo aver fatto tutte e 5).** Per la Property (la più semplice) esegui un test dal vivo:
- [ ] Funzione `real-estate-prod-property` > **Test** > nuovo evento (formato "payload 2.0" di HTTP API):
  ```json
  {
    "version": "2.0",
    "routeKey": "GET /properties",
    "rawPath": "/properties",
    "rawQueryString": "",
    "headers": {},
    "requestContext": { "http": { "method": "GET", "path": "/properties" } },
    "isBase64Encoded": false
  }
  ```
- [ ] **Test**. Atteso: `statusCode` **200** e un corpo con `"items": []` e `"total": 0`. Il primo test può durare 5-15
      secondi (creazione delle interfacce di rete e cold start): normale.

Questo test dimostra **in un colpo solo** che funzionano: ruolo, VPC, security group, proxy, IAM auth, utente del DB,
`GRANT` e tabelle. Se passa, il database è collegato bene.

**Se si rompe (la tabella più importante della fase).**
| Sintomo nel log (CloudWatch > Log groups > `/aws/lambda/real-estate-prod-property`) | Causa |
| --- | --- |
| `Task timed out after 15.00 seconds` | la funzione non raggiunge il proxy: SG sbagliato (`sg-lambda-internal` -> `sg-rds-proxy` 5432), subnet sbagliate, o il proxy non è Available |
| `PAM authentication failed for user "property_user"` / `password authentication failed` | token IAM rifiutato: `rds-db:connect` con `<PROXY_RESOURCE_ID>` o utente sbagliato nella policy; `DB_USER` diverso da quello del ruolo |
| `no pg_hba.conf entry ... SSL off` o errore TLS | TLS: il codice dovrebbe già usarlo; controlla che `DB_HOST` sia il proxy |
| `relation "properties" does not exist` | la migrazione (fase 03) non è stata eseguita sul database `realestate` |
| `permission denied for table ...` | manca un `GRANT`: rilancia la migrazione, che è idempotente |
| `AccessDeniedException ... sns:Publish` | policy del ruolo o `SNS_TOPIC_ARN` sbagliati |
| `Cannot find module` / `index.handler is undefined` | zip sbagliato o handler diverso da `index.handler` |
| L'errore "Unable to connect to endpoint" verso SNS (dopo) | endpoint SNS non Available o `sg-endpoint-sns` non accetta `sg-lambda-internal` |

## 5.3 La Mailer (fuori dalla VPC)

- [ ] **Create function**: `real-estate-prod-mailer`, Node.js 22.x, arm64, ruolo `real-estate-prod-lambda-mailer-role`.
      **Non** abilitare la VPC.
- [ ] Code: upload `backend/dist/mailer.zip`; handler `index.handler`.
- [ ] Configuration > General: Memory **256 MB**, Timeout **30 sec**.
- [ ] Environment variables: `USER_POOL_ID` = `<USER_POOL_ID>`; `MAIL_FROM` = `<MAIL_FROM>` (esattamente l'indirizzo verificato in
      SES); `SITE_URL` = `https://app.mchaservice.tech`.

**Perché fuori dalla VPC.** Non usa il database: così non servono endpoint per SQS, SES e Cognito, e c'è meno cold start
e meno costi ([lambda-mailer.md](../lambda-mailer.md#configurazione)). Raggiunge SES e Cognito sulla rete di AWS.

### 5.3.1 Il trigger della coda (event source mapping)

- [ ] Mailer > **Configuration > Triggers > Add trigger** > **SQS**:
  - SQS queue: `real-estate-prod-notifications-queue`.
  - **Activate trigger**: sì.
  - **Batch size 10**. **Batch window 0**.
  - Spunta **Report batch item failures** (`ReportBatchItemFailures`).
  - **Maximum concurrency 2** (il minimo consentito).
  - Add.

**Perché.** *Batch item failures*: se un solo messaggio del batch fallisce, torna in coda solo quello (altrimenti tutto il
batch, con email doppie). *Concurrency 2*: protegge SES (in sandbox 1 email al secondo) e la quota di Cognito
([lambda-mailer.md](../lambda-mailer.md#event-source-mapping)).

**Verifica.** Trigger con stato **Enabled**. Se la console dice che il visibility timeout è troppo basso rispetto al timeout
della funzione, controlla fase 02 (180 s) e questo punto (30 s).

**Se si rompe.** `The provided execution role does not have permissions to call ReceiveMessage on SQS`: policy della
Mailer con l'ARN della coda sbagliato (`<ACCOUNT_ID>` o nome).

## 5.4 La Files Lambda: i due permessi in ingresso, nell'ordine giusto

La Files è invocata da due sorgenti: API Gateway (fase 06) e S3 (qui). **Prima il permesso, poi la notifica**, altrimenti
S3 rifiuta la configurazione ([lambda-files.md](../lambda-files.md#chi-la-può-invocare)).

### 5.4.1 Permesso per S3
- [ ] Lambda `real-estate-prod-files` > **Configuration > Permissions > Resource-based policy statements > Add permissions**
      > **AWS service**:
  - Service: **S3**. Statement ID: `AllowFilesBucketNotifications`. Source ARN: `arn:aws:s3:::real-estate-prod-files-<SUFFIX>`.
    **Source account: `<ACCOUNT_ID>`**. Action: `lambda:InvokeFunction`.
  - Save.

Corrisponde a `iam/resource-policies/lambda-files-allow-s3.json`: il principal `s3.amazonaws.com` può invocare **solo** da
quel bucket **e** dal tuo account (la seconda condizione evita che, se il bucket venisse cancellato, un altro account
ricrei un bucket con lo stesso nome e invochi la tua funzione). Questa è una *resource-based policy*: dice **chi può
chiamare la funzione**, mentre il ruolo dice **cosa può fare la funzione**.

### 5.4.2 La notifica sul bucket
- [ ] **S3 > `real-estate-prod-files-<SUFFIX>` > Properties > Event notifications > Create event notification**:
  - Name `RegisterCompletedUploads`. **Prefix `uploads/`**. Event types: **All object create events** (`s3:ObjectCreated:*`).
  - Destination: **Lambda function** > *Choose from your Lambda functions* > `real-estate-prod-files`. Save changes.

Corrisponde a `config/s3-files-notification.json` (`LambdaFunctionArn` = `arn:aws:lambda:eu-south-1:<ACCOUNT_ID>:function:real-estate-prod-files`).

**Perché.** Il database viene aggiornato **solo dagli upload riusciti**, senza fidarsi di una conferma del client
([s3.md](../s3.md#notifica-objectcreated-verso-la-files-lambda)). L'invocazione la fa il servizio Lambda, non passa dalla
rete della VPC: non serve un endpoint.

**Verifica.** Il bucket mostra la notifica in *Event notifications*; nessun errore al salvataggio.

**Se si rompe.** *Unable to validate the following destination configurations*: il permesso 5.4.1 manca, o ha un bucket o un
account diversi. Ricontrollalo e riprova.

## 5.5 Cosa NON fare ora

- Non creare ancora i permessi per API Gateway: li crea la console quando colleghi le route (fase 06).
- Non pubblicare versioni né alias: per questo progetto basta `$LATEST`.
- Non impostare *reserved concurrency*.

## 5.6 Smoke test della Mailer (facoltativo ma utile)

Si fa meglio in fase 08 con un utente reale. Se vuoi un anticipo: Mailer > Test con un evento SQS finto che abbia un
`body` JSON con `type` e `recipientSub` inesistente: dovrebbe loggare `RECIPIENT_DELETED` (utente non trovato, caso
previsto, livello INFO) e restituire `batchItemFailures: []`. Questo prova ruolo, Cognito e permessi (non l'invio SES).

## Risultato della fase 05

- [ ] 6 ruoli con policy; 6 funzioni con zip, handler e variabili.
- [ ] La Property risponde 200 al test (DB raggiunto via proxy con IAM).
- [ ] Mailer collegata alla coda (trigger Enabled, batch 10, concurrency 2, batch item failures).
- [ ] Permesso S3 -> Files e notifica `uploads/` sul bucket dei file.
- [ ] Annotati: ARN delle 6 funzioni.

Prossimo: [06-api-gateway.md](06-api-gateway.md).
