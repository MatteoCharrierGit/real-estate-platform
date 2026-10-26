# Fase 03 — Inizializzazione del database, secret e RDS Proxy

**Giorno 1 (ultima fase). Durata: circa 2 ore.** Prerequisiti: fase 01 (RDS **Available**, `sg-db-migrate`, `sg-rds`) e le
5 password applicative scelte e salvate nel password manager. Concetti: [rds-postgres.md](../rds-postgres.md),
[secrets-manager.md](../secrets-manager.md), [rds-proxy.md](../rds-proxy.md).

Questa è la fase più delicata: ha l'ordine più rigido, perché ogni pezzo presuppone il precedente:

```text
istanza (01) -> utenti e tabelle (3.1-3.5) -> secret (3.6) -> ruolo del proxy (3.7) -> proxy (3.8)
```

## Il problema: come si entra in un database che non ha Internet?

L'istanza sta in subnet private, senza accesso pubblico, e `sg-rds` accetta solo il proxy. Nessun client SQL del tuo PC
può arrivarci. Gli utenti applicativi e le tabelle vanno però creati **dentro** il database. La soluzione senza
tirare su server: una **Lambda temporanea dentro la VPC**, `real-estate-prod-db-migrate`, che si collega all'istanza con
l'utente master, esegue `database/schema.sql` e `database/roles.sql` e finisce. La esegui dalla console (scheda *Test*),
poi la cancelli. Il codice è in `backend/src/functions/db-migrate`; i file SQL sono impacchettati nello zip.

La funzione apre **temporaneamente** una porta: per qualche minuto `sg-rds` accetta anche `sg-db-migrate`. Poi la richiudiamo.

## 3.1 Prima di tutto: l'istanza è pronta?

- [ ] RDS > Databases > `real-estate-prod-db` = **Available**. Annota l'**endpoint dell'istanza**
      (`real-estate-prod-db.xxxx.eu-south-1.rds.amazonaws.com`), che trovi in *Connectivity & security*.

## 3.2 Ruolo della funzione temporanea

- [ ] **IAM > Roles > Create role** > *AWS service* > *Lambda* > Next. Policy da collegare (cerca per nome):
      `AWSLambdaBasicExecutionRole` e `AWSLambdaVPCAccessExecutionRole`. Nome ruolo:
      `real-estate-prod-lambda-db-migrate-role`. Create.

**Perché.** Il ruolo dà alla funzione solo due cose: scrivere i log e creare le interfacce di rete nella VPC. Non ha
permessi su database (non usa IAM: entra con la password master), né su altro. La trust relationship è quella di
`iam/trust-relationships/lambda.json` (`lambda.amazonaws.com` può assumerlo): la schermata "AWS service > Lambda" la
produce uguale.

## 3.3 La funzione

- [ ] **Lambda > Create function** > *Author from scratch*:
  - Name `real-estate-prod-db-migrate`; Runtime **Node.js 22.x**; Architecture **arm64**.
  - *Change default execution role* > *Use an existing role* > `real-estate-prod-lambda-db-migrate-role`.
  - *Additional configurations* > **Enable VPC**: VPC `real-estate-prod-vpc`; Subnets `private_subnet_A` e
    `private_subnet_B`; Security groups: **solo `sg-db-migrate`**.
  - Create function. (La prima creazione con VPC può richiedere un paio di minuti.)
- [ ] Scheda **Code** > *Upload from* > **.zip file** > `backend/dist/db-migrate.zip` > Save. Poi *Runtime settings* > Edit:
      Handler `index.handler`.
- [ ] Scheda **Configuration** > *General configuration* > Edit: Memory **256 MB**, Timeout **1 min**. Poi *Environment
      variables*: `DB_HOST` = l'endpoint **dell'istanza** annotato al punto 3.1, `DB_PORT` = `5432`, `DB_NAME` = `realestate`
      (sono le tre variabili che legge `backend/src/functions/db-migrate/index.ts`; `DB_PORT` e `DB_NAME` hanno comunque questi
      valori come default). **Non** il proxy: il proxy non esiste ancora e non conosce questi utenti. Nessuna password nelle
      variabili: le passi solo nell'evento di test.

**Perché.** Dentro la VPC, nelle stesse subnet del DB, con un SG dedicato: così la regola da aprire su `sg-rds` è
una sola, precisa, e si chiude cancellando quel gruppo. Memoria e timeout bastano a poche istruzioni SQL.

**Verifica.** Configuration > VPC mostra le due subnet e `sg-db-migrate`. Stato della funzione *Active*.

**Se si rompe.** *The provided execution role does not have permissions to call CreateNetworkInterface*: manca
`AWSLambdaVPCAccessExecutionRole`. Funzione bloccata in *Pending*: attendi.

## 3.4 Apri temporaneamente il database a `sg-db-migrate`

- [ ] **VPC > Security groups > `sg-rds` > Edit inbound rules > Add rule**: Type *PostgreSQL* (TCP 5432), Source `sg-db-migrate`,
      Description `TEMPORANEA db-migrate`. Salva. (Resta anche la regola da `sg-rds-proxy`.)

## 3.5 Esegui la migrazione

- [ ] Nella funzione > scheda **Test** > *Create new event* (non salvarlo: se la console non te lo permette,
      incolla il JSON senza premere *Save*). Corpo (sostituisci i valori con le tue password; **niente simboli, almeno 12 caratteri**: la funzione rifiuta le più corte):
  ```json
  {
    "action": "migrate",
    "masterUser": "dbadmin",
    "masterPassword": "<PASSWORD_MASTER>",
    "passwords": {
      "property_user": "<PW_PROPERTY>",
      "users_user": "<PW_USERS>",
      "offers_user": "<PW_OFFERS>",
      "files_user": "<PW_FILES>",
      "presigned_user": "<PW_PRESIGNED>"
    }
  }
  ```
- [ ] **Test**. Il risultato è nel riquadro *Execution results*.
- [ ] (Facoltativo, sola lettura) Un secondo evento `{"action": "status", "masterUser": "dbadmin", "masterPassword": "<PASSWORD_MASTER>"}`
      restituisce lo stato senza modificare nulla: ti serve per ricontrollare tabelle e utenti.

**Cosa succede.** Si apre una connessione TLS all'istanza come `dbadmin`, nel database `realestate`; `schema.sql` crea
`users`, `properties`, `offers`, `files` (e il trigger di `updated_at`); `roles.sql` crea i 5 utenti con le tue password e
assegna i `GRANT` minimi ([rds-postgres.md](../rds-postgres.md#utenti-postgresql)): per esempio `users_user` può cambiare
solo la colonna `status` di immobili e offerte e non ha `DELETE`.

**Verifica.** La funzione risponde `{"ok": true, "action": "migrate", "database": {"name": "realestate", ...}, "summary": {...}}`
con l'elenco delle tabelle e degli utenti creati (`users`, `properties`, `offers`, `files`; i 5 utenti applicativi). Un fallimento
risponde `{"ok": false, "step": "...", "error": "..."}` e **non** mostra mai le password. Nei log (*Log output*) non devono comparire le password: se le vedi, cancella il log group
(punto 3.6 sotto) e segnalalo.

Il file SQL è **idempotente**: rieseguire la migrazione riporta il database allo stato descritto (utile se hai sbagliato
una password: la correggi e la rilanci).

**Se si rompe.**
| Sintomo | Causa probabile |
| --- | --- |
| `ETIMEDOUT` / timeout | manca la regola su `sg-rds`, o la funzione non ha `sg-db-migrate`, o è in subnet sbagliate |
| `password authentication failed for user "dbadmin"` | password master errata (quella impostata in 1.3.2) |
| `no pg_hba.conf entry ... no encryption` | la connessione non usa TLS: PostgreSQL 15+ su RDS lo impone (il codice usa già TLS con il bundle CA di RDS) |
| `database "realestate" does not exist` | non dovrebbe capitare: se manca, `migrate` lo crea; se vedi questo errore con `status`, esegui prima `migrate` |
| Errore SQL | copia il messaggio: ripetere è sicuro, ma non lasciare il lavoro a metà senza capirlo |

## 3.6 Pulizia: chiudi il varco e butta la funzione

- [ ] **`sg-rds` > Edit inbound rules**: **elimina** la regola da `sg-db-migrate`. Deve restare **solo** la regola da `sg-rds-proxy`.
- [ ] **Lambda > `real-estate-prod-db-migrate` > Actions > Delete function.**
- [ ] **CloudWatch > Log groups > `/aws/lambda/real-estate-prod-db-migrate` > Delete** (conteneva l'esecuzione con le password
      nell'evento: i log di Lambda non le mostrano di norma, ma non c'è motivo di tenerli).
- [ ] **IAM > Roles > `real-estate-prod-lambda-db-migrate-role` > Delete.**
- [ ] `sg-db-migrate`: **non cancellarlo ora**. Le interfacce di rete (ENI) della funzione restano agganciate per fino a
      circa 20-30 minuti dopo la cancellazione e bloccano l'eliminazione del gruppo ("has a dependent object"). Lo cancelli
      alla fine della giornata (o al teardown). Senza regole in uscita ormai inutili non fa danni, e `sg-rds` non lo cita più.

**Perché.** Un varco aperto "solo per un attimo" tende a restare: la regola temporanea è la più facile da dimenticare.
Controlla due volte che `sg-rds` abbia un'unica regola inbound.

## 3.7 Secret (uno per utente)

Il proxy non conosce le password: le legge da Secrets Manager. Ne servono 5, con **le stesse password** usate al punto 3.5.

- [ ] **Secrets Manager > Store a new secret** (regione Milano). Secret type: **Credentials for Amazon RDS database**
      (oppure *Other type of secret*: entrambi producono il JSON `{"username","password"}` che il proxy si aspetta).
  - User name `property_user`, Password = la password di `property_user`. Encryption key: **`aws/secretsmanager`** (default).
  - Database: seleziona `real-estate-prod-db`.
  - Next > Secret name `real-estate/prod/database/property_user` > Next (rotazione: **disabilitata**) > Store.
- [ ] Ripeti per `users_user`, `offers_user`, `files_user`, `presigned_user` (nomi `real-estate/prod/database/<utente>`).
- [ ] Per ciascuno apri il secret e annota l'**ARN completo** (finisce con un suffisso casuale, es. `-AbCdEf`).
      **Non usare l'ARN senza suffisso**: la policy del ruolo del proxy richiede quello completo ([rds-proxy.md](../rds-proxy.md)).

**Perché.** Il proxy entra nel database con la password; le Lambda no (usano IAM): così nessuna password sta nel codice,
nelle variabili o in Git. **Il secret dell'utente master non si crea né si associa al proxy.** Un secret non crea
l'utente nel DB: l'utente c'è già grazie al punto 3.5; il secret è solo la copia della sua password. Rotazione:
non configurata ([secrets-manager.md](../secrets-manager.md#rotazione)).

**Verifica.** 5 secret nell'elenco, nomi esatti. In ognuno, *Retrieve secret value* mostra `username` e `password` giusti.

**Se si rompe.** Password diversa da quella del DB: il proxy non riuscirà ad autenticarsi (lo vedrai al punto 3.9 come
target non sano). Si corregge con *Edit* > *Retrieve secret value* > modifica.

## 3.8 Ruolo del proxy

- [ ] **IAM > Roles > Create role** > *Custom trust policy*: incolla `iam/trust-relationships/rds-proxy.json`
      (`rds.amazonaws.com` può assumere il ruolo; nessun segnaposto). Next: **non collegare policy gestite**. Nome
      `real-estate-prod-rds-proxy-secrets-role`. Create.
- [ ] Apri il ruolo > *Add permissions* > *Create inline policy* > JSON: `iam/policies/rds-proxy-read-secrets.json` dove la
      `Resource` diventa la **lista dei 5 ARN completi** dei secret:
  ```json
  "Resource": [
    "arn:aws:secretsmanager:eu-south-1:<ACCOUNT_ID>:secret:real-estate/prod/database/property_user-AbCdEf",
    "arn:aws:secretsmanager:eu-south-1:<ACCOUNT_ID>:secret:real-estate/prod/database/users_user-......",
    "arn:aws:secretsmanager:eu-south-1:<ACCOUNT_ID>:secret:real-estate/prod/database/offers_user-......",
    "arn:aws:secretsmanager:eu-south-1:<ACCOUNT_ID>:secret:real-estate/prod/database/files_user-......",
    "arn:aws:secretsmanager:eu-south-1:<ACCOUNT_ID>:secret:real-estate/prod/database/presigned_user-......"
  ]
  ```
  (Copia gli ARN reali dal punto 3.7: i `......` sono i tuoi suffissi.) Nome policy `read-application-database-secrets`.

**Perché.** È il secondo dei due ruoli di cui parla `rds-proxy.md`: il ruolo **del proxy** (può leggere i secret), diverso
dai ruoli delle Lambda (che non li leggono mai). Non ha `rds-db:connect`: verso il database il proxy usa la password. Non
serve la policy `rds-proxy-decrypt-secrets.json`: usiamo la chiave gestita `aws/secretsmanager` che autorizza già da sola
([kms.md](../kms.md)).

**Verifica.** Il ruolo ha 1 policy inline con 5 risorse; la trust mostra `rds.amazonaws.com`.

## 3.9 RDS Proxy

- [ ] **RDS > Proxies > Create proxy**.
  - Engine compatibility: **PostgreSQL**. Proxy identifier: `real-estate-prod-db-proxy`.
  - Idle client connection timeout: default (30 min). **Require Transport Layer Security: attivo**.
  - Target group: Database `real-estate-prod-db`. Connection pool maximum connections: default (100 %).
  - Authentication: *Secrets Manager secrets*: aggiungi i **5 secret**. IAM role: *Choose existing* >
    `real-estate-prod-rds-proxy-secrets-role`. **IAM authentication: Required.**
    **Default authentication scheme: no/"None"** (non scegliere IAM end-to-end: quella è un'altra modalità, scartata in
    `decisioni.md`). Se in console il tipo di autenticazione del client è per-secret, lascia quello proposto per PostgreSQL
    (`SCRAM-SHA-256`).
  - Connectivity: VPC `real-estate-prod-vpc`; Subnets `private_subnet_A` e `private_subnet_B`; VPC security group:
    **`sg-rds-proxy`** (togli `default`). Enhanced logging: no.
- [ ] Create proxy. Stato *Creating*: **5-15 minuti**.

**Perché.** Il proxy tiene poche connessioni verso il DB e smista le molte connessioni brevi delle Lambda; le Lambda
entrano con un token IAM firmato localmente (nessuna password), il proxy poi usa la password del secret
([rds-proxy.md](../rds-proxy.md#autenticazione-iam-di-una-lambda-passo-per-passo)). Costa anche a vuoto: è una delle voci
fisse del conto.

**Verifica (a proxy Available).**
- Proxy details: *Status* **Available**; annota il **Proxy endpoint** (`real-estate-prod-db-proxy.proxy-xxxx.eu-south-1.rds.amazonaws.com`).
- Scheda **Target groups** > `default`: **Registered targets** = `real-estate-prod-db` con *Target health* **Available**
  (compare dopo qualche minuto). Se l'utente `rdsproxyadmin` compare nel DB, è il proxy: non toccarlo.
- Annota l'**ID risorsa** `<PROXY_RESOURCE_ID>`: è la parte `prx-...` dell'ARN del proxy
  (`arn:aws:rds:eu-south-1:<ACCOUNT_ID>:db-proxy:prx-0abc123...`). **Non** il nome, **non** l'ID dell'istanza.

**Se si rompe.**
| Sintomo | Causa |
| --- | --- |
| Target *Unavailable* con "authentication failed" | password del secret diversa da quella nel DB: correggi il secret o rilancia `db-migrate`... ma la funzione è già cancellata: ricreala (3.2-3.5) oppure correggi il secret |
| Target *Unavailable* "unable to reach the database" | `sg-rds` non accetta `sg-rds-proxy`, o `sg-rds-proxy` non ha l'uscita 5432 verso `sg-rds` |
| Il proxy non crea: "role cannot be assumed" | trust del ruolo sbagliata (`rds.amazonaws.com`) |
| `AccessDenied` sulla lettura dei secret | ARN senza suffisso o con regione/account diversi nella policy |
| Non si vede l'opzione IAM | verifica in console: i nomi possono differire (cerca "IAM authentication" in Authentication) |

## Risultato della fase 03 (fine del giorno 1: puoi fermarti qui)

- [ ] Tabelle e utenti applicativi creati; `sg-rds` con una sola regola inbound; funzione `db-migrate` cancellata.
- [ ] 5 secret `real-estate/prod/database/<utente>` e ruolo `real-estate-prod-rds-proxy-secrets-role`.
- [ ] Proxy `real-estate-prod-db-proxy` Available, target Available, TLS e IAM richiesti.
- [ ] Annotati: endpoint del proxy, `<PROXY_RESOURCE_ID>`, i 5 ARN dei secret.
- [ ] (Controlla il certificato ACM: dovrebbe essere *Issued*.)
- [ ] Ricontrolla il budget. Da ora l'ambiente costa circa 3 $ al giorno fino al teardown.

Domani: [04-cognito.md](04-cognito.md).
