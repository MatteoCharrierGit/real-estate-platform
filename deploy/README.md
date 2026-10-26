# Piano di deploy su AWS — dalla console, in due giorni

Questa cartella è il piano per mettere online l'intera architettura descritta nella documentazione in radice
(`../00-architettura.md` e i file dei singoli servizi), usando **la dashboard (console web) di AWS** per tutto ciò che si
può fare da lì. Non c'è nessuno script che crea l'infrastruttura al posto tuo: ogni risorsa la crei tu, con un clic e un
valore alla volta, e per ogni passo trovi **cosa fare, come farlo, perché, come verificare e cosa fare se si rompe**.

Il codice che mancava (Lambda, SQL, SPA) è stato scritto in questo branch: `backend/`, `database/`, `frontend/`. Il
contratto che tiene insieme API, schema e variabili è in [contratto.md](contratto.md): leggilo una volta, ti servirà a
capire cosa passa tra le parti.

## Cosa non si fa dalla console (e cosa si fa sul tuo PC)

| Cosa | Dove | Perché non dalla console |
| --- | --- | --- |
| Compilare e impacchettare le 6 Lambda (+ la funzione temporanea `db-migrate`) in zip | sul tuo PC (Node.js 22): `cd backend && npm ci && npm run build && npm run package` (zip in `backend/dist/`) | la console carica zip già pronti, non compila TypeScript |
| Compilare la SPA | sul tuo PC: `cd frontend && npm ci && npm run build` | idem |
| Creare utenti PostgreSQL e tabelle | **dalla console**, con la funzione temporanea `real-estate-prod-db-migrate` ([03](03-inizializzazione-db-e-proxy.md)) | il database sta in una subnet privata senza Internet: nessun client SQL può arrivarci da fuori |

Tutto il resto (rete, RDS, proxy, Cognito, SNS/SQS/SES, Lambda, API Gateway, S3, CloudFront, ACM, allarmi) è da
console. Se non vuoi installare Node sul PC puoi usare AWS CloudShell (icona del terminale in alto) solo per
compilare: verifica in console se è disponibile a Milano, altrimenti aprilo in un'altra regione (serve solo come
macchina per `npm`, non per creare risorse).

## Come è organizzato

| Giorno | File | Cosa si fa | Tempo stimato |
| --- | --- | --- | --- |
| 1 | [00-prima-di-iniziare.md](00-prima-di-iniziare.md) | account, regione Milano, budget, utente admin, build locali, certificato ACM, SES, tabella dei valori | 1,5 - 2 h |
| 1 | [01-rete-e-database.md](01-rete-e-database.md) | VPC, subnet, security group, **avvio di RDS** (15-20 min di attesa), endpoint | 2 h |
| 1 | [02-messaggistica-e-storage.md](02-messaggistica-e-storage.md) | SNS, SQS + DLQ, topic degli allarmi, bucket S3 (mentre RDS si crea) | 1,5 h |
| 1 | [03-inizializzazione-db-e-proxy.md](03-inizializzazione-db-e-proxy.md) | utenti e tabelle del DB, secret, ruolo e RDS Proxy | 2 h |
| 2 | [04-cognito.md](04-cognito.md) | user pool, app client, dominio di login, gruppi | 1 h |
| 2 | [05-lambda.md](05-lambda.md) | ruoli IAM, 6 funzioni, VPC, variabili, trigger SQS e S3 | 2,5 - 3 h |
| 2 | [06-api-gateway.md](06-api-gateway.md) | HTTP API, authorizer JWT, 16 route, CORS, log, throttling | 1,5 h |
| 2 | [07-cloudfront-dominio-sito.md](07-cloudfront-dominio-sito.md) | CSP, due distribuzioni, bucket policy, DNS, build e upload della SPA | 2 h |
| 2 | [08-collaudo.md](08-collaudo.md) | prove end-to-end, ruoli, email, DLQ | 1 h |
| 2 | [09-monitoraggio.md](09-monitoraggio.md) | allarmi, metric filter, event subscription RDS | 45 min |
| - | [10-troubleshooting-e-teardown.md](10-troubleshooting-e-teardown.md) | errori tipici e cancellazione completa per fermare i costi | - |

**Punti di pausa sicuri** (puoi chiudere il computer e riprendere): fine fase 00, fine fase 02, fine fase 03 (fine del
giorno 1: da qui in poi non ci sono più attese lunghe), fine fase 06, fine fase 07. In mezzo a una fase no: ogni fase
ha una sezione "Risultato" che dice quando puoi fermarti.

Il giorno 2 è più lungo del giorno 1. Se sei in ritardo, taglia la fase 09 (monitoraggio): è l'unica che non blocca il
funzionamento.

## Regole del lavoro

1. **Regione sempre `eu-south-1` (Milano)**, in alto a destra nella console. Fanno eccezione solo ACM per CloudFront
   (`us-east-1`), CloudFront e IAM (globali). Metà degli "non vedo la risorsa" nasce da una regione sbagliata.
2. **Annota ogni valore appena lo crei** nella tabella qui sotto (copiala in un file di testo locale, non nel repo).
   Ogni fase dice cosa annotare e dove si userà.
3. **Nomi esatti**: `real-estate-prod-...` come nella documentazione. Le policy fanno riferimento ai nomi: un nome
   diverso significa un `AccessDenied` misterioso.
4. **Segnaposto `<...>` nei JSON**: non incollare mai un JSON con un `<...>` dentro. Prima li sostituisci tutti.
5. **Nessuna password nel repo né in chat**: le password dei database stanno in un password manager.
6. Dopo ogni fase fai la sua "Verifica". Se non passa, non andare avanti: l'errore si trova più facilmente subito.

## Valori fissi del progetto

| Cosa | Valore |
| --- | --- |
| Regione | `eu-south-1` (Milano) |
| Sito | `app.mchaservice.tech` |
| File (foto e video) | `files.mchaservice.tech` |
| `<SITE_DOMAIN>` nei JSON | `app.mchaservice.tech` |
| `<FILES_DOMAIN>` nella CSP | `files.mchaservice.tech` |
| `<SUFFIX>` | scegline uno tuo, minuscolo, 5-8 caratteri (es. `mcha26`). Rende unici i nomi dei bucket |
| `<MAIL_FROM>` | un indirizzo email tuo che puoi aprire (es. il tuo Gmail): sarà il mittente delle notifiche |
| Nome database | `realestate` |
| Utenti PostgreSQL | `property_user`, `users_user`, `offers_user`, `presigned_user`, `files_user` |

## Tabella dei valori da annotare

Compilala man mano. "Nasce" = dove lo vedi per la prima volta; "Serve" = dove lo userai.

| Valore | Nasce (fase, schermata) | Serve |
| --- | --- | --- |
| `<ACCOUNT_ID>` (12 cifre) | 00, menu in alto a destra | quasi tutti i JSON (03, 05, 06, 09) |
| `<SUFFIX>` | 00, lo scegli | bucket (02), policy (05), CSP (07) |
| `<MAIL_FROM>` | 00, lo scegli | SES (00), policy Mailer e variabile (05) |
| Email del team (allarmi) | 00 | topic `ops-alerts` (02) |
| ARN certificato ACM (us-east-1) | 00, ACM | distribuzioni CloudFront (07) |
| ID VPC, ID subnet A e B, ID route table | 01, VPC | RDS, proxy, Lambda (01, 03, 05) |
| ID dei 6 security group | 01, EC2 > Security groups | RDS, endpoint, proxy, Lambda (01, 03, 05) |
| `<PL_S3>` prefix list S3 (`pl-...`) | 01, nelle regole dei SG | regola di uscita di `sg-lambda-internal` (01) |
| Password master del DB + utente master | 01, la scegli | funzione `db-migrate` (03). Mai nel repo |
| Endpoint dell'istanza RDS | 01, RDS > istanza | funzione `db-migrate` (03) |
| 5 password applicative del DB | 03, le generi | evento di `db-migrate` e secret (03) |
| ARN completi dei 5 secret (`-AbCdEf`) | 03, Secrets Manager | policy del ruolo del proxy (03) |
| Endpoint del proxy | 03, RDS > Proxies | variabile `DB_HOST` delle 5 Lambda (05) |
| `<PROXY_RESOURCE_ID>` (`prx-...`) | 03, dall'ARN del proxy | policy dei 5 ruoli Lambda (05) |
| ARN del topic `real-estate-prod-notifications` | 02, SNS | policy Lambda (05), endpoint SNS (01), variabile `SNS_TOPIC_ARN` (05) |
| ARN topic `real-estate-prod-ops-alerts` | 02, SNS | allarmi ed event subscription (09) |
| ARN coda e DLQ | 02, SQS | trigger Mailer (05), allarmi (09) |
| `<USER_POOL_ID>` | 04, Cognito | policy Mailer, variabile Mailer (05), authorizer (06) |
| `<APP_CLIENT_ID>` | 04, Cognito > App client | authorizer (06), build della SPA (07) |
| Dominio Cognito (`https://<prefisso>.auth.eu-south-1.amazoncognito.com`) | 04 | CSP (07), build della SPA (07) |
| ARN delle 6 Lambda | 05 | notifica S3 (05), API (06) |
| `<API_ID>` e URL dell'API | 06, API Gateway | CSP e build della SPA (07) |
| ID e dominio `dxxxx.cloudfront.net` della distribuzione del sito | 07 | bucket policy sito, DNS (07) |
| ID e dominio della distribuzione dei file | 07 | bucket policy file, DNS (07) |

## Dipendenze circolari e come le abbiamo risolte

La documentazione ha un ordine di creazione (`../00-architettura.md#ordine-di-creazione`), ma alcune risorse si
nominano a vicenda. Ecco dove e come si risolve:

| Circolarità | Soluzione |
| --- | --- |
| L'URL del sito serve a Cognito (callback), al CORS dell'API e di S3, alla CSP | Il dominio è **già deciso** (`app.mchaservice.tech`): lo conosci dal minuto zero, quindi nessun ritocco. È il vantaggio di usare un dominio proprio invece di `*.cloudfront.net` |
| L'ID dell'API serve alla CSP (header di CloudFront) e al build della SPA | Si crea l'API **prima** di CloudFront (fase 06 prima della 07). La policy degli header si scrive una volta sola, con l'ID giusto |
| Distribuzione CloudFront e bucket policy si nominano a vicenda (la policy contiene l'ARN della distribuzione) | Si creano prima i bucket (fase 02, privati, senza policy), poi le distribuzioni (07), poi si incollano le bucket policy. Intanto il bucket è comunque chiuso a tutti |
| Il permesso S3 → Files Lambda deve esistere **prima** della notifica sul bucket | Fase 05: prima il permesso sulla funzione, poi la notifica |
| L'ID del proxy (`prx-...`) è dentro le policy dei ruoli Lambda | Il proxy si crea in fase 03, i ruoli Lambda in fase 05: l'ID è già noto |
| Il proxy ha bisogno dei secret, i secret degli utenti del DB, gli utenti del DB dell'istanza | Ordine: istanza (01) → utenti e tabelle (03, funzione `db-migrate`) → secret (03) → proxy (03) |
| Il certificato per CloudFront deve essere già emesso quando crei la distribuzione | Si richiede **subito** (fase 00): la validazione DNS richiede minuti e finisce mentre fai altro |
| L'authorizer dell'API ha bisogno di user pool e app client | Cognito (04) prima dell'API (06) |

## Lacune e divergenze della documentazione (da sapere con onestà)

1. **I gruppi Cognito non li assegna nessuno.** La documentazione descrive `buyer`, `agent`, `admin` ma non dice chi mette
   un utente in un gruppo. Nella demo lo fai **tu a mano dalla console** ([04](04-cognito.md), [08](08-collaudo.md)). Il
   gruppo compare nel token solo al login successivo.
2. **`<SITE_DOMAIN>` nei JSON** va sostituito con `app.mchaservice.tech`, e nei CORS/CSP il dominio dei file con
   `files.mchaservice.tech`. La documentazione parla di `*.cloudfront.net`: con un dominio proprio servono in più il
   certificato ACM in `us-east-1`, gli "alternate domain names" nelle distribuzioni e i record DNS ([07](07-cloudfront-dominio-sito.md)).
3. **SES è in sandbox**: spedisce solo a indirizzi verificati. Verifichi il mittente e gli indirizzi dei tuoi utenti di
   prova ([00](00-prima-di-iniziare.md)). Le email di registrazione di Cognito non passano da SES (usano il servizio email
   di default di Cognito) e funzionano con qualsiasi indirizzo.
4. **Accettare o rifiutare un'offerta lo può fare solo il proprietario dell'immobile** (vedi [contratto.md](contratto.md)):
   `api-gateway.md` dice "chi ha fatto l'offerta o il proprietario", ma l'acquirente che accetta la propria offerta non ha senso.
   L'acquirente la ritira con `DELETE /offers/{id}`.
5. **`iam/policies/deploy-pass-role.json`** serve a un'identità di deploy *ristretta*. Tu lavori con un utente admin,
   quindi non serve applicarla: la applichi solo se vuoi provare il least privilege anche su di te (opzionale, [00](00-prima-di-iniziare.md)).
6. **L'HTTP API non ha "stage di produzione" con prefisso**: usiamo lo stage `$default`, quindi l'URL è
   `https://<API_ID>.execute-api.eu-south-1.amazonaws.com` senza `/prod`. È coerente con la CSP e con `VITE_API_URL`.
7. **Il database `realestate` lo crea RDS** alla creazione dell'istanza (campo "Initial database name"), non il codice
   SQL. Il database `postgres` di default resta (serve al proxy).
8. **Il CloudFront "pricing plan"**: da poco la console CloudFront può proporre piani a prezzo fisso. Scegli il
   pay-as-you-go/free se te lo chiede; i nomi esatti non sono verificabili da qui ([07](07-cloudfront-dominio-sito.md)).
9. **I nomi delle schermate**: AWS cambia spesso la console. Dove il piano dice "verifica in console: i nomi possono
   differire" è un avviso onesto, non una lacuna: il concetto resta quello, cambiano le etichette.

## Dove vanno incollati i JSON della documentazione

Ogni file elencato indica la fase in cui lo usi. Sostituisci sempre i segnaposto indicati.

| File | Fase | Dove si incolla | Segnaposto da sostituire |
| --- | --- | --- | --- |
| `iam/trust-relationships/lambda.json` | 05 | IAM > Ruoli > Crea ruolo > "Custom trust policy" (oppure scegli "AWS service > Lambda": produce la stessa) | nessuno |
| `iam/trust-relationships/rds-proxy.json` | 03 | IAM > Ruoli > Crea ruolo > Custom trust policy | nessuno |
| `iam/policies/rds-proxy-read-secrets.json` | 03 | policy inline del ruolo del proxy | `<APPLICATION_SECRET_ARN>`: sostituisci la lista con i **5 ARN completi** |
| `iam/policies/rds-proxy-decrypt-secrets.json` | - | non serve (usiamo `aws/secretsmanager`, non una CMK) | - |
| `iam/policies/lambda-connect-proxy.json` | 05 | template: è già specializzato nelle 5 policy qui sotto | - |
| `iam/policies/lambda-property.json` | 05 | policy inline del ruolo `...-lambda-property-role` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>`, `<SUFFIX>` |
| `iam/policies/lambda-users.json` | 05 | idem, ruolo `...-lambda-users-role` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>` |
| `iam/policies/lambda-offers.json` | 05 | idem, ruolo `...-lambda-offers-role` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>` |
| `iam/policies/lambda-presigned.json` | 05 | idem, ruolo `...-lambda-presigned-role` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>`, `<SUFFIX>` |
| `iam/policies/lambda-files.json` | 05 | idem, ruolo `...-lambda-files-role` | `<ACCOUNT_ID>`, `<PROXY_RESOURCE_ID>`, `<SUFFIX>` |
| `iam/policies/lambda-mailer.json` | 05 | idem, ruolo `...-lambda-mailer-role` | `<ACCOUNT_ID>`, `<USER_POOL_ID>`, `<MAIL_FROM>` |
| `iam/policies/ops-dlq-redrive.json` | 09 (facoltativa) | solo se usi un utente non admin per il redrive | `<ACCOUNT_ID>` |
| `iam/policies/deploy-pass-role.json` | 00 (facoltativa) | vedi punto 5 sopra | `<ACCOUNT_ID>` |
| `iam/resource-policies/lambda-allow-api-gateway.json` | 06 | la crea la console quando colleghi la route (vedi [06](06-api-gateway.md)); il JSON documenta il risultato | `<ACCOUNT_ID>`, `<API_ID>`, `<FUNCTION_NAME>` |
| `iam/resource-policies/lambda-files-allow-s3.json` | 05 | Lambda files > Configuration > Permissions > Resource-based policy statements > Add permissions | `<ACCOUNT_ID>`, `<SUFFIX>` |
| `iam/resource-policies/s3-website-bucket-policy.json` | 07 | S3 > bucket sito > Permissions > Bucket policy | `<SUFFIX>`, `<ACCOUNT_ID>`, `<DIST_SITE_ID>` |
| `iam/resource-policies/s3-files-bucket-policy.json` | 07 | S3 > bucket file > Permissions > Bucket policy | `<SUFFIX>`, `<ACCOUNT_ID>`, `<DIST_FILES_ID>` |
| `iam/resource-policies/sqs-notifications-queue-policy.json` | 02 | SQS > coda > Access policy > Edit | `<ACCOUNT_ID>` |
| `iam/resource-policies/vpc-endpoint-sns-policy.json` | 01 | VPC > Endpoints > endpoint SNS > Policy > Custom | `<ACCOUNT_ID>` |
| `config/cognito-user-pool.json`, `config/cognito-app-client.json` | 04 | non si incollano: sono l'elenco dei valori da impostare nei campi della console | `<SITE_DOMAIN>` = `app.mchaservice.tech`, `<USER_POOL_ID>` |
| `config/http-api-cors.json` | 06 | API Gateway > CORS > Configure | `<SITE_DOMAIN>` |
| `config/s3-files-cors.json` | 02 | S3 > bucket file > Permissions > CORS (formato JSON) | `<SITE_DOMAIN>` |
| `config/s3-files-notification.json` | 05 | non si incolla: la console S3 usa campi (Properties > Event notifications) con gli stessi valori | `<ACCOUNT_ID>` |
| `config/sns-subscription-attributes.json` | 02 | casella "Enable raw message delivery" della sottoscrizione | nessuno |
| `config/sqs-notifications-queue-attributes.json`, `config/sqs-notifications-dlq-attributes.json` | 02 | campi della creazione della coda (valori elencati nella fase) | `<ACCOUNT_ID>` |
| `config/lambda-mailer-event-source-mapping.json` | 05 | campi del trigger SQS della Mailer | `<ACCOUNT_ID>` |
| `config/cloudwatch-alarm-notifications-dlq.json` | 09 | campi della creazione dell'allarme | `<ACCOUNT_ID>` |
| `config/cloudwatch-metric-filter-mailer-permanent-failures.json` | 09 | CloudWatch > log group Mailer > Metric filters | nessuno |
| `config/rds-event-subscription-db.json` | 09 | RDS > Event subscriptions | `<ACCOUNT_ID>` |
| `config/presigned-post-conditions.json` | - | solo descrittivo: le condizioni sono nel codice della Presigned Lambda | - |

## Costi e teardown in breve

Stime per **eu-south-1**, con i servizi accesi 24 ore su 24. I prezzi di Milano non sono verificabili da qui riga per
riga: sono stime con un margine di circa il 30 %, controllale col [Pricing Calculator](https://calculator.aws/) e, dopo
il primo giorno, in Billing > Cost Explorer (i dati arrivano con 24 ore di ritardo).

| Voce | Costo stimato al giorno | Si ferma? |
| --- | --- | --- |
| RDS PostgreSQL `db.t4g.micro` Multi-AZ (due istanze) | circa 1 $ | sì, "Stop temporarily" fino a 7 giorni, ma storage e proxy continuano |
| Storage gp3 20 GiB Multi-AZ | circa 0,2 $ | no |
| RDS Proxy (fatturato per vCPU dell'istanza: 2) | circa 0,8 $ | **no**: costa anche con il DB fermo, si può solo cancellare |
| 2 interface endpoint x 2 AZ (SNS, Secrets Manager) | circa 1,2 $ | **no**, solo cancellandoli |
| 5 secret Secrets Manager | circa 0,07 $ | no |
| Lambda, API Gateway, SQS, SNS, Cognito, CloudFront, S3, CloudWatch | pochi centesimi (livello gratuito) | - |
| Route 53 (solo se la usi): zona ospitata | 0,5 $ al mese | - |
| **Totale** | **circa 3,3 $ al giorno, circa 23-25 $ per 7 giorni** | |

Sono ben sotto i tuoi 200 euro. Non conviene spegnere cose di notte: si risparmia circa 1 $ e si rischia di dimenticare
qualcosa (e il proxy e gli endpoint non si spengono comunque). Se invece fai una pausa lunga (weekend), puoi fermare
l'istanza RDS (si riaccende da sola dopo 7 giorni; mentre è ferma le API che usano il DB rispondono 500).

Due raccomandazioni: crei il **budget con allarmi** (fase 00) e a fine presentazione fai il **teardown completo**
([10](10-troubleshooting-e-teardown.md)) il giorno stesso. Se l'account è sul "Free plan" di AWS (account nuovi), verifica
in Billing se alcuni servizi richiedono il passaggio al piano a pagamento (i crediti restano validi).

## Glossario veloce degli ID

| Cosa | Aspetto | Dove serve |
| --- | --- | --- |
| ARN | `arn:aws:servizio:regione:account:risorsa` | policy IAM |
| ID proxy | `prx-0123456789abcdef0` | `rds-db:connect` |
| ID distribuzione | `E2ABCDEF123456` | bucket policy (`AWS:SourceArn`) |
| ID API | `a1b2c3d4e5` | CSP, CORS, authorizer |
| Prefix list S3 | `pl-xxxxxxxx` | regola di uscita del security group |

Per i concetti (cos'è un ruolo, un security group, ecc.) vedi il glossario in [`../README.md`](../README.md).
