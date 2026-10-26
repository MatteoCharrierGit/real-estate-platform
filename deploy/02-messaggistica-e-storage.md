# Fase 02 — Messaggistica e storage

**Giorno 1. Durata: circa 1,5 ore.** Prerequisiti: fase 00. **Non dipende dal database**: si può fare mentre RDS si crea
(fase 01) o dopo. Concetti: [sns.md](../sns.md), [sqs.md](../sqs.md), [s3.md](../s3.md), [kms.md](../kms.md).

Crei le "tubature" delle notifiche (SNS -> SQS, con la coda degli scarti) e i due bucket privati. Nessuna di queste
risorse è ancora collegata a una Lambda: succederà in fase 05.

## 2.1 Topic SNS

- [ ] **SNS > Topics > Create topic**: Type **Standard**, Name `real-estate-prod-notifications`. Lascia il resto
      (nessuna cifratura con chiave tua, nessuna policy personalizzata). Create.
- [ ] Annota l'**ARN** (`arn:aws:sns:eu-south-1:<ACCOUNT_ID>:real-estate-prod-notifications`).
- [ ] Secondo topic: Standard, Name `real-estate-prod-ops-alerts`. Annota l'ARN.
- [ ] Nel topic `ops-alerts` > **Create subscription**: Protocol **Email**, Endpoint = email del team (la tua). Create.
      Ti arriva un'email "AWS Notification - Subscription Confirmation": **clicca *Confirm subscription***.

**Perché due topic.** Il primo porta gli eventi verso gli utenti (pubblicano le Lambda), il secondo gli allarmi verso il
team (pubblica CloudWatch): pubblico e mittenti diversi ([cloudwatch.md](../cloudwatch.md#topic-real-estate-prod-ops-alerts)).
Il topic non ha bisogno di una policy aggiuntiva: quella di default ammette il tuo account.

**Verifica.** Nel topic `ops-alerts` la sottoscrizione email ha stato **Confirmed** (non *Pending confirmation*).

**Se si rompe.** Email non arrivata: spam; oppure rifai *Request confirmation* sulla sottoscrizione.

## 2.2 Coda e dead-letter queue (DLQ)

Prima la DLQ, poi la coda principale (che la cita).

### 2.2.1 La DLQ
- [ ] **SQS > Create queue**: Type **Standard**, Name `real-estate-prod-notifications-dlq`.
  - Configuration: Message retention period **14 days** (1209600 s, il massimo). Il resto di default.
  - Encryption: **Enabled**, tipo **Amazon SQS key (SSE-SQS)**.
  - Dead-letter queue: *Disabled*.
  - Access policy: Basic, *Only the queue owner*.
- [ ] Crea. Annota l'ARN.

### 2.2.2 La coda principale
- [ ] **Create queue**: Standard, Name `real-estate-prod-notifications-queue`.
  - Visibility timeout **3 minutes** (= 180 s). Message retention **4 days** (345600 s). Delivery delay 0. Maximum
    message size default. Receive message wait time 0.
  - Encryption: **Enabled**, **Amazon SQS key (SSE-SQS)** (vedi sotto il perché).
  - **Access policy**: scegli **Advanced** e incolla `iam/resource-policies/sqs-notifications-queue-policy.json`
    sostituendo `<ACCOUNT_ID>` (compare **due volte**: coda e topic).
  - **Dead-letter queue**: *Enabled*, coda `real-estate-prod-notifications-dlq`, **Maximum receives = 5**.
- [ ] Crea. Annota ARN e URL.

### 2.2.3 Restringi chi può usare la DLQ
- [ ] Torna alla DLQ > **Edit** > *Dead-letter queue* ... sezione **Redrive allow policy**: **By queue** e inserisci
      l'ARN di `real-estate-prod-notifications-queue`. Salva.

**Perché.** I valori derivano da `config/sqs-notifications-queue-attributes.json` e `...-dlq-attributes.json`:
- *Visibility timeout 180 s = 6 volte il timeout della Mailer (30 s)*: così un messaggio in lavorazione non ricompare a metà.
- *5 ricezioni*: dopo 5 tentativi falliti (circa 15 minuti) il messaggio va nella DLQ e scatta l'allarme ([sqs.md](../sqs.md#perché-5-ricezioni-e-180-secondi)).
- *DLQ 14 giorni, coda 4*: la scadenza si conta dall'ingresso nella coda originale; la DLQ deve durare di più.
- **SSE-SQS e non la chiave `aws/sqs`**: SNS non riesce a consegnare in una coda cifrata con `aws/sqs`
  ([kms.md](../kms.md#perché-la-coda-usa-sse-sqs-e-non-awssqs)). Se in console vedi solo la scelta di una chiave KMS,
  scegli SSE-SQS (*Amazon SQS key*): è un'opzione diversa da *AWS KMS*.
- La *queue policy* ammette solo il nostro topic a scrivere (anti *confused deputy*).
- Il *redrive allow policy* dice quale coda può usare la DLQ come scarto.

**Verifica.** In entrambe le code: *Encryption* = Amazon SQS key (SSE-SQS). Nella principale, *Dead-letter queue* =
Enabled con `maxReceiveCount` 5. Nella DLQ, *Redrive allow policy* = By queue.

**Se si rompe.** Errore "invalid policy": un `<ACCOUNT_ID>` non sostituito, o JSON incollato con virgolette storte.

## 2.3 Sottoscrizione SNS -> SQS

- [ ] **SNS > Topics > `real-estate-prod-notifications` > Create subscription**: Protocol **Amazon SQS**; Endpoint = ARN della
      coda `real-estate-prod-notifications-queue`; spunta **Enable raw message delivery**. Create.

**Perché.** *Raw message delivery* (`config/sns-subscription-attributes.json`) consegna il messaggio così come lo
pubblichiamo, senza la busta JSON di SNS: la Mailer si aspetta il corpo diretto.

**Verifica con una prova.**
- [ ] SNS > topic > **Publish message**: Message body `{"test": true}` > Publish.
- [ ] SQS > coda > **Send and receive messages** > *Poll for messages*: vedi il messaggio con corpo `{"test": true}`
      (non una busta con `Type`, `MessageId`, ...: se la vedi, il raw delivery non è attivo).
- [ ] **Purge** la coda (SQS > coda > Purge) per non lasciare questo messaggio finto alla Mailer: lo scarterebbe come
      "messaggio malformato" e te lo troveresti nei log come errore permanente.

**Se si rompe.** Nessun messaggio: la queue policy è sbagliata (ARN del topic) o la coda è cifrata con una chiave KMS
invece che SSE-SQS.

## 2.4 Bucket S3

### 2.4.1 Bucket del sito
- [ ] **S3 > Create bucket**: Region **Europe (Milan)**, name `real-estate-prod-website-<SUFFIX>`.
  - Object Ownership: **ACLs disabled (Bucket owner enforced)**.
  - **Block all public access: tutte e 4 le caselle attive** (default).
  - Bucket versioning: Disabled. Default encryption: **SSE-S3**. Bucket Key: indifferente.
- [ ] Non creare nessuna bucket policy ora e **non attivare** *Static website hosting*.

### 2.4.2 Bucket dei file
- [ ] Come sopra: name `real-estate-prod-files-<SUFFIX>`, ACL disabilitate, Block Public Access attivo, SSE-S3.
- [ ] Apri il bucket > **Permissions > Cross-origin resource sharing (CORS) > Edit**: incolla `config/s3-files-cors.json`
      con `<SITE_DOMAIN>` = `app.mchaservice.tech`, cioè l'origine `https://app.mchaservice.tech`:
  ```json
  {
    "CORSRules": [
      {
        "ID": "AllowPresignedPostFromSite",
        "AllowedOrigins": ["https://app.mchaservice.tech"],
        "AllowedMethods": ["POST"],
        "AllowedHeaders": ["*"],
        "MaxAgeSeconds": 3000
      }
    ]
  }
  ```
  La console S3 accetta oggi il CORS in formato JSON (un array di regole in alcune versioni: se ti dà errore di formato,
  incolla solo il contenuto dell'array `CORSRules`; verifica in console: i nomi possono differire).

**Perché.** I due bucket sono **privati**: nessuno li legge direttamente. Il sito sarà letto solo da CloudFront (con OAC,
fase 07), i file solo da CloudFront e scritti dal browser con un presigned POST ([s3.md](../s3.md)). Il CORS serve perché
l'upload parte dal browser (origine `app.mchaservice.tech`) verso un'altra origine (il bucket): senza quella regola il
browser lo blocca. SSE-S3 è la cifratura a riposo gratuita e gestita da S3.

**Verifica.** Per entrambi i bucket: *Permissions* > *Block public access* = "On" per tutte e 4 le voci, *Bucket policy*
vuota. Nel bucket dei file, CORS salvato. *Properties* > *Default encryption* = SSE-S3.

**Se si rompe.** "Bucket name not available": il nome è globale, cambia `<SUFFIX>` (e annotalo!). Ricorda che il nome
dei bucket compare in policy, CSP e IAM: se cambi suffisso, ricontrolla gli appunti.

La **notifica `ObjectCreated`** verso la Files Lambda sul bucket dei file la configuri in fase 05, perché presuppone che la
funzione esista e che abbia il permesso per S3.

## Risultato della fase 02 (puoi fermarti qui)

- [ ] Topic `real-estate-prod-notifications` e `real-estate-prod-ops-alerts` (email confermata).
- [ ] Coda `...-queue` e `...-dlq` cifrate SSE-SQS, DLQ collegata (5 ricezioni), sottoscrizione SNS -> SQS con raw delivery.
- [ ] Prova: un messaggio SNS arriva in coda (poi purgata).
- [ ] Due bucket privati, CORS sul bucket dei file.
- [ ] Annotati: ARN dei due topic, ARN di coda e DLQ, nomi dei bucket.

Prossimo: [03-inizializzazione-db-e-proxy.md](03-inizializzazione-db-e-proxy.md) (richiede che RDS sia *Available*).
