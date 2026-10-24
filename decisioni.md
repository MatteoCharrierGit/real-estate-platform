# Decisioni

Le scelte prese con il loro motivo, le alternative considerate e scartate, le domande ancora aperte e gli sviluppi
futuri. Ogni riga rimanda al file del servizio che la spiega per intero.

## Decisioni prese

### Architettura e rete

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Architettura serverless | Traffico basso e variabile: si paga per richiesta, scala da zero, nessun server da gestire | [00-architettura.md](00-architettura.md) |
| Regione `eu-south-1` (Milano) | Dati in Italia, latenza bassa per utenti italiani; tutti i servizi usati ci sono. È una regione *opt-in*, da abilitare nell'account | [Disponibilità dei servizi](#disponibilità-dei-servizi-a-milano) |
| Una VPC `10.0.0.0/16` con due subnet private `/24` in due AZ | Il subnet group di RDS (primaria e standby in AZ diverse) e il proxy chiedono 2 AZ; le `/24` lasciano spazio alle ENI (il proxy vuole almeno 10 IP liberi per subnet) | [vpc.md](vpc.md) |
| Niente subnet pubbliche, Internet Gateway e NAT | Il traffico utente entra da CloudFront e API Gateway, fuori dalla VPC; non chiamiamo API esterne; il NAT è un costo fisso inutile | [vpc.md](vpc.md) |
| Endpoint VPC: interface SNS, interface Secrets Manager, gateway S3 (gratuito) | Unico modo per raggiungere i servizi AWS dalla VPC senza NAT; solo quelli che servono davvero | [vpc-endpoints.md](vpc-endpoints.md) |
| Private DNS sugli interface endpoint (`enableDnsSupport`, `enableDnsHostnames`) | L'SDK usa i nomi standard dei servizi senza modifiche al codice | [vpc-endpoints.md](vpc-endpoints.md) |
| Security group solo sulle risorse nella VPC, regole SG → SG | I servizi gestiti fuori dalla VPC non hanno ENI; le regole tra gruppi restano valide quando cambiano gli IP | [vpc.md](vpc.md#security-group) |
| Nessun PrivateLink per Cognito | Le Lambda nella VPC non chiamano Cognito: l'authorizer valida i token da sé; la Mailer, unica a chiamarlo (`AdminGetUser`), è fuori dalla VPC | [cognito.md](cognito.md#sicurezza-e-rete) |

### Frontend e storage

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Bucket del sito privato, letto da CloudFront con OAC; niente static website hosting | Nessun accesso diretto al bucket, HTTPS e cache | [cloudfront.md](cloudfront.md), [s3.md](s3.md) |
| Errori 403/404 → `/index.html` sulla distribuzione del sito | Routing della SPA; il 403 perché CloudFront non ha `s3:ListBucket` | [cloudfront.md](cloudfront.md#configurazione) |
| Due distribuzioni CloudFront, sito e file | La regola SPA vale per tutta la distribuzione e non deve toccare i file; cache ed errori diversi | [cloudfront.md](cloudfront.md) |
| Dominio `*.cloudfront.net` per la presentazione | Un dominio personalizzato richiederebbe un certificato ACM in `us-east-1` | [cloudfront.md](cloudfront.md#configurazione) |
| **File degli utenti pubblici** tramite la distribuzione dei file; bucket privato | Sono le foto e i video degli annunci: chi ha il link li vede | [s3.md](s3.md) |
| Upload diretto con **presigned POST** (non PUT), firmato dalla Presigned Lambda | Il file non passa dal backend (limiti 10 MB e 6 MB); solo il POST limita la dimensione | [lambda-presigned.md](lambda-presigned.md) |
| Chiave dell'oggetto decisa dalla Lambda, scadenza 5 minuti, `image/` (10 MB) o `video/` (limite più alto) | Il client non sceglie dove scrivere; un solo prefisso di `Content-Type` per firma | [lambda-presigned.md](lambda-presigned.md#configurazione) |
| **Notifica S3 `ObjectCreated`** su `uploads/` verso la Files Lambda, che registra il file | Il database si aggiorna solo con gli upload riusciti, senza fidarsi del client | [lambda-files.md](lambda-files.md) |
| Gateway endpoint S3 per la cancellazione dei file | La Files Lambda cancella oggetti dalla VPC; il gateway è gratuito | [vpc-endpoints.md](vpc-endpoints.md) |
| Block Public Access e ACL disattivate su entrambi i bucket | I file sono pubblici solo tramite CloudFront | [s3.md](s3.md#configurazione) |

### Autenticazione e API

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| HTTP API e non REST API | Costa meno, ha authorizer JWT e CORS integrati: tutto ciò che serve | [api-gateway.md](api-gateway.md#perché-unhttp-api) |
| Authorizer JWT nativo, nessuna Lambda Authorizer | La cache di una Lambda Authorizer vale per tutte le route; senza cache servirebbe il DB a ogni richiesta | [api-gateway.md](api-gateway.md#autorizzazione-su-due-livelli) |
| **Il frontend manda all'HTTP API l'access token**; l'email la legge la Mailer da Cognito (decisione presa dopo la discussione con il docente) | Buona pratica OIDC: l'access token autorizza le API. Resta l'authorizer JWT (issuer = user pool, audience controllata su `client_id`), senza scope personalizzati né resource server. Le Lambda usano solo `sub` e `cognito:groups` dai claim. Gli eventi portano `recipientSub`, il database non ha l'email, e la Mailer la legge con `AdminGetUser` (pool con l'email come attributo di accesso, quindi `username` = `sub`). Vantaggi: nessuna email nei token né nelle richieste, email sempre aggiornata, meno dati personali nel DB, nessun componente nuovo. Svantaggi: la Mailer dipende da Cognito (se non risponde: retry e DLQ) e il suo ruolo può leggere gli utenti del pool | [cognito.md](cognito.md#decisione-allapi-va-laccess-token) |
| Durata di ID e access token 60 minuti | Con il login gestito AWS sconsiglia di scendere sotto l'ora: il cookie di sessione vale un'ora, un token più corto non accorcia la sessione | [cognito.md](cognito.md#app-client-della-spa) |
| Token in memoria nella SPA, CSP da CloudFront, revoca al logout | Difese contro il furto del token; rischio residuo dichiarato: l'authorizer non vede le revoche, un token rubato vale fino a un'ora | [cognito.md](cognito.md#furto-del-token), [cloudfront.md](cloudfront.md#header-di-sicurezza-response-headers-policy) |
| Autorizzazione su due livelli: ruolo (gruppi Cognito) e ownership (nella Lambda, con il DB) | L'authorizer sa chi sei; se la risorsa è tua lo sa solo il database | [api-gateway.md](api-gateway.md#autorizzazione-su-due-livelli) |
| Gruppi `buyer`, `agent`, `admin` nel user pool; solo user pool, niente identity pool | I ruoli applicativi arrivano nel token; gli upload usano il presigned POST, non credenziali AWS nel browser | [cognito.md](cognito.md) |
| **Account modificato e cancellato dal frontend direttamente con Cognito** | Le Lambda nella VPC non raggiungono Cognito. `PUT /users/me` dopo ogni login crea o aggiorna la riga con il solo `sub`; nuovo login di conferma, `DELETE /users/me`, poi `DeleteUser` (scope `aws.cognito.signin.user.admin` sull'app client), poi logout. Se `DeleteUser` fallisce, `PUT /users/me` risponde 410 e la SPA riprova `DeleteUser` | [cognito.md](cognito.md#cancellazione-dellaccount), [lambda-users.md](lambda-users.md) |
| Route esplicite, lettura degli annunci pubblica | Il preflight `OPTIONS` lo gestisce il CORS senza authorizer; un visitatore vede gli annunci | [api-gateway.md](api-gateway.md#route) |
| CORS sull'HTTP API e sul bucket dei file | Il sito chiama due origini diverse | [api-gateway.md](api-gateway.md#cors), [s3.md](s3.md#cors-del-bucket-dei-file) |
| Throttling sullo stage | Difesa dagli abusi; WAF non si associa a un'HTTP API | [api-gateway.md](api-gateway.md#throttling) |

### Business logic e dati

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Cinque Lambda di business, una per scope con router interno (Property, Users, Offers, Presigned, Files), più la Mailer | Semplicità, come un controller per risorsa; ruolo IAM per scope | [lambda.md](lambda.md) |
| In VPC solo le Lambda che usano il database, in entrambe le subnet | Il proxy esiste solo nella VPC | [lambda.md](lambda.md#lambda-nella-vpc) |
| Presigned Lambda **nella** VPC | Prima di firmare controlla nel database che l'utente sia il proprietario | [lambda-presigned.md](lambda-presigned.md) |
| Mailer Lambda **fuori** dalla VPC | Non usa il database: niente endpoint per SQS e SES, meno cold start e costi | [lambda-mailer.md](lambda-mailer.md) |
| **RDS for PostgreSQL Multi-AZ DB instance** `real-estate-prod-db`: primaria attiva in AZ-1, standby a riposo in AZ-2, replica sincrona (sostituisce il cluster Aurora) | Dati relazionali. Il cambio è un'**indicazione del docente, per costo e semplicità**: la reader di Aurora serviva solo al failover, e il Multi-AZ di RDS dà la stessa alta disponibilità (failover automatico, stesso endpoint) con un servizio più semplice e meno costoso | [rds-postgres.md](rds-postgres.md) |
| PostgreSQL 18, `db.t4g.micro`, gp3 20 GiB con autoscaling, backup 7 giorni | La 18 è la major più recente su RDS e supportata da RDS Proxy a Milano, con supporto standard fino a febbraio 2031 (la 17 fino a febbraio 2030; la 19 non è ancora su RDS); gli altri valori sono i minimi sensati per il carico del progetto, dichiarati come scelte | [rds-postgres.md](rds-postgres.md#configurazione) |
| **Alla cancellazione dell'account anonimizziamo**: immobili e offerte restano senza dati personali. Una transazione della Users Lambda: riga `users` con il solo `sub` e `deleted_at`, immobili a `withdrawn`, offerte `pending` (sue o ricevute) a `withdrawn`; accettate e rifiutate invariate | Le offerte riguardano anche l'altra parte, che va avvisata (`OFFER_WITHDRAWN`); le chiavi esterne restano valide; il `sub` dopo `DeleteUser` non porta a nessuno, perché l'email stava solo in Cognito; niente S3 nella transazione | [lambda-users.md](lambda-users.md#cancellazione-dellaccount-anonimizzazione) |
| `users_user` con `UPDATE (status)` su `properties` e `offers`, nessun cambio IAM | Il ritiro tocca solo la colonna di stato; IAM decide chi entra nel proxy, i `GRANT` cosa si fa sulle tabelle | [rds-postgres.md](rds-postgres.md#utenti-postgresql) |
| Scritture rifiutate (403) per un `sub` con `deleted_at`; `PUT /users/me` risponde 410 e non ricrea il profilo | Un token emesso prima di `DeleteUser` vale fino a 60 minuti: così può solo leggere. Costo: una query per ogni richiesta che scrive | [api-gateway.md](api-gateway.md#authorizer-jwt) |
| File degli immobili ritirati lasciati su S3 | Sono le foto della casa, non dati personali; la Users Lambda non ha permessi su S3 | [lambda-property.md](lambda-property.md#immobili-ritirati) |
| RDS Proxy | Pooling delle connessioni delle Lambda, autenticazione IAM, failover più rapido. Non strettamente necessario con il nostro traffico, adottato per sicurezza | [rds-proxy.md](rds-proxy.md) |
| Lambda → proxy con IAM e TLS; proxy → database con la password del secret | Nessuna password nelle Lambda; la password la vede solo il proxy | [rds-proxy.md](rds-proxy.md) |
| Un utente PostgreSQL e un secret per ogni Lambda con DB | IAM decide chi entra e con quale utente, i `GRANT` cosa può fare | [rds-postgres.md](rds-postgres.md#utenti-postgresql) |
| Connessione al DB aperta fuori dall'handler | Riuso tra le invocazioni | [lambda.md](lambda.md#connessione-al-database) |

### Notifiche

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| SNS → SQS → Mailer Lambda → SES (non EventBridge) | SQS dà buffer e retry, SNS permette altri consumer senza toccare le Lambda; allineato al diagramma | [sns.md](sns.md) |
| Pubblicano solo Property, Users e Offers | Sono le sole che generano eventi da notificare | [sns.md](sns.md#iam) |
| L'evento contiene `recipientSub` e i dati dell'email, non l'indirizzo | La Mailer non ha bisogno del database; l'email la chiede a Cognito con `AdminGetUser` | [sns.md](sns.md#formato-degli-eventi), [lambda-mailer.md](lambda-mailer.md#da-dove-arriva-lemail) |
| DLQ dopo 5 ricezioni (`maxReceiveCount`), visibility timeout 180 s (6 × 30 s) | Raccomandazioni AWS per le code lette da Lambda: 5 lascia margine anche alle ricezioni perse per throttling; 180 s evita che un messaggio torni visibile a metà. Un messaggio che fallisce sempre arriva in DLQ in circa 15 minuti | [sqs.md](sqs.md#perché-5-ricezioni-e-180-secondi) |
| Retention 4 giorni coda e 14 giorni DLQ | La scadenza si conta dall'ingresso nella coda originale: in DLQ un messaggio resta analizzabile almeno ~10 giorni | [sqs.md](sqs.md#retention-perché-14-giorni-nella-dlq-e-4-nella-coda) |
| DLQ sulla coda, non sulla Lambda; niente DLQ su SNS né on-failure destination sulla Files Lambda | Con l'event source mapping SQS i fallimenti li gestisce la `RedrivePolicy` della coda; le destination di Lambda valgono per le invocazioni asincrone | [sqs.md](sqs.md#perché-la-dlq-sta-sulla-coda-e-non-sulla-lambda) |
| Event source mapping: batch 10, finestra 0 s, `ReportBatchItemFailures`, concorrenza massima 2 | Batch parziali: un'email fallita non fa ripetere le altre né le spinge verso la DLQ; concorrenza al minimo consentito per proteggere SES in sandbox (1 email/s) e la quota di Cognito | [lambda-mailer.md](lambda-mailer.md#event-source-mapping) |
| Errori temporanei ritentati, errori permanenti loggati e scartati | Ritentare un messaggio malformato, un utente cancellato o un destinatario rifiutato non serve; un metric filter con allarme li rende visibili | [lambda-mailer.md](lambda-mailer.md#classificazione-degli-errori) |
| Doppioni rari delle email accettati | Coda standard at-least-once; deduplicare richiederebbe un database nella Mailer. I batch parziali li riducono | [lambda-mailer.md](lambda-mailer.md#idempotenza) |
| Allarmi su DLQ non vuota ed età dei messaggi in coda, verso il topic `real-estate-prod-ops-alerts` con email del team | Qualcuno deve sapere che un'email non è partita | [cloudwatch.md](cloudwatch.md#configurazione) |
| Event subscription di RDS (`failover`, `failure`) sullo stesso topic | Il failover è un evento, non una metrica: il team deve sapere che la primaria è cambiata | [cloudwatch.md](cloudwatch.md#eventi-di-rds-failover-e-guasti) |
| Redrive manuale con procedura scritta e policy dell'operatore `ops-dlq-redrive.json` | Si rimandano i messaggi solo dopo aver corretto la causa, a velocità bassa per non saturare SES | [sqs.md](sqs.md#procedura-operativa-quando-scatta-lallarme) |
| Coda cifrata con SSE-SQS | SNS non consegna a una coda cifrata con `aws/sqs` | [kms.md](kms.md) |
| `RawMessageDelivery` sulla sottoscrizione | La Mailer riceve il messaggio senza la busta JSON di SNS | [sns.md](sns.md#configurazione) |
| SES via API, in sandbox per la demo | A Milano l'SMTP non c'è; la sandbox basta inviando a indirizzi verificati | [ses.md](ses.md) |

### IAM e sicurezza

| Decisione | Motivo | Dettagli |
| --- | --- | --- |
| Nomi espliciti `real-estate-<ambiente>-<componente>-<scopo>`; ID reali come segnaposto `<...>` in Git | Si capisce a colpo d'occhio cosa fa ogni ruolo; niente ID reali né password nel repository | [iam.md](iam.md#tutti-i-ruoli) |
| Un execution role per Lambda, policy del progetto sugli ARN precisi; policy gestite solo per log e VPC | Least privilege e audit chiari; le azioni ENI richiedono comunque `Resource: "*"` | [lambda.md](lambda.md#iam) |
| Ruolo del proxy `real-estate-prod-rds-proxy-secrets-role` | Rinominato per seguire la convenzione | [rds-proxy.md](rds-proxy.md#iam) |
| `aws:SourceArn` (e `aws:SourceAccount` per S3) in tutte le resource policy verso servizi | Prevenire il confused deputy | [iam.md](iam.md#confused-deputy) |
| Deny delle richieste senza TLS sui bucket; TLS obbligatorio sul proxy e verso il database | Cifratura in transito ovunque | [s3.md](s3.md#bucket-policy), [rds-proxy.md](rds-proxy.md) |
| Cifratura a riposo: RDS `aws/rds`, S3 SSE-S3, SQS SSE-SQS, secret `aws/secretsmanager` | Chiavi gestite da AWS, gratuite; CMK solo se servisse | [kms.md](kms.md) |
| `iam:PassRole` dell'identità di deploy limitato ai ruoli del progetto e ai servizi Lambda e RDS | Non si può "prestare" un ruolo a un altro servizio | [iam.md](iam.md#identità-di-deploy-e-iampassrole) |
| Endpoint policy sull'endpoint SNS (facoltativa) | Least privilege anche sulla rete | [vpc-endpoints.md](vpc-endpoints.md#iam) |

## Alternative considerate e non adottate

| Alternativa | Perché no | Quando avrebbe senso |
| --- | --- | --- |
| Container su ECS Fargate | Sempre accesi, costo fisso | Carico costante, applicazione già containerizzata |
| REST API | Costa di più; non ci servono usage plan, API key, validazione, cache | Se servisse WAF diretto o usage plan |
| Una Lambda per route | Più funzioni da gestire | Permessi IAM più fini per singola route |
| Lambda Authorizer per l'ownership | Cache condivisa tra le route o DB a ogni richiesta, latenza e cold start | Regole che l'authorizer JWT non sa esprimere, senza DB e fuori dalla VPC |
| Identity pool | Non servono credenziali AWS nel browser | Accesso diretto dei client ai servizi AWS |
| Trigger Cognito per creare la riga utente | `PUT /users/me` basta | — |
| `AdminDeleteUser` dalla Users Lambda, interface endpoint `cognito-idp` o evento verso una Lambda fuori VPC | Dalla VPC non c'è strada; l'endpoint Cognito esiste ma con limiti | — |
| **Cancellazione a cascata** di immobili, offerte e file alla cancellazione dell'account | L'altra parte di un'offerta ne perderebbe la storia; i file su S3 li può togliere solo la Property o la Files, non la Users Lambda, e una transazione non comprende S3 | — |
| **Anonimizzare solo il profilo** lasciando pubblici gli immobili | Annunci senza un agente che risponda, che continuerebbero a ricevere offerte e upload | — |
| Nessun evento per le offerte ritirate dalla cancellazione | L'altra parte vedrebbe sparire una trattativa in corso senza saperlo | — |
| Lasciare su S3 i file di un immobile cancellato | Spazio pagato per niente e file ancora raggiungibili da chi ha il link | — |
| Cancellare i file con un evento SNS → Files Lambda | La Files Lambda non è in ascolto su SNS: servirebbe un'altra coda o un endpoint Lambda. La Property ha già il gateway endpoint S3, gratuito | Se la pulizia diventasse lenta (molti file) e non dovesse pesare sulla richiesta |
| Lifecycle rule di S3 sui file orfani | Le lifecycle rule lavorano per prefisso o tag ed età, non sanno se l'immobile esiste | Come rete di sicurezza, con un tag messo sui file da cancellare |
| Conferma dell'upload dal client (`POST /files/confirm`) | Il client può mentire o non chiamare | — |
| Presigned PUT | Non limita la dimensione | — |
| File privati con CloudFront signed URL o presigned GET della Files Lambda | I file degli annunci sono pubblici per decisione | Se si aggiungessero documenti privati (contratti, documenti d'identità) |
| Una sola distribuzione con behavior `/files/*` | La regola SPA 403/404 toccherebbe i file | — |
| EventBridge al posto di SNS | Le Lambda in VPC avrebbero bisogno di un endpoint EventBridge; SNS basta per il fan-out | Molti consumer con regole di filtro su pattern |
| Solo SQS, senza SNS | Nessun consumer aggiuntivo possibile senza toccare le Lambda | Se il canale resterà uno solo |
| NAT Gateway | Costo fisso, nessuna API esterna | Se servisse chiamare un'API esterna: una subnet pubblica per AZ con NAT |
| RDS Proxy con IAM end-to-end (`DefaultAuthScheme=IAM_AUTH`) | Scelto il modello con secret, più comune e già documentato | Per semplificare: niente secret, endpoint e permessi KMS, ma utenti DB con `rds_iam` |
| Nessun RDS Proxy | Rischio di esaurire `max_connections`, niente IAM | Poche Lambda con connessioni riusate fuori dall'handler |
| Aurora PostgreSQL, un cluster con writer e reader su due AZ (**la scelta precedente**) | Sostituito su indicazione del docente: più costoso, e la reader serviva solo al failover, non alle letture | Molte letture da distribuire, failover più rapido, storage che cresce da solo |
| Aurora Serverless v2 | Valutata con Aurora; caduta insieme ad Aurora per semplicità | Carico molto variabile, per pagare solo la capacità usata |
| RDS Multi-AZ **DB cluster** (una writer e due standby leggibili in tre AZ) | Tre istanze, più costoso; le letture distribuite non ci servono | Se servissero letture dalle standby e failover più rapido |
| RDS Single-AZ | Nessuna alta disponibilità: se cade l'istanza o la sua AZ il database è fermo | Ambiente di sviluppo o prove brevi |
| Francoforte o Irlanda | Dati in Italia e latenza | Funzioni nuove disponibili subito, regione non opt-in |
| Chiave KMS del cliente (CMK) | Le chiavi gestite bastano | Controllo e audit sulla chiave; servono key policy e `rds-proxy-decrypt-secrets.json` |
| Lambda@Edge o CloudFront Functions | Il sito statico è pubblico, i dati stanno dietro l'API | — |

### Alternative valutate per token ed email

Per passare all'access token bisognava decidere da dove prendere l'email per le notifiche. Scelta: la Mailer la chiede
a Cognito con `AdminGetUser` ([cognito.md](cognito.md#decisione-allapi-va-laccess-token)). Le altre strade valutate:

| Alternativa | Perché scartata |
| --- | --- |
| **ID token all'API** (la scelta precedente) | L'ID token serve a identificare l'utente presso il client, non ad autorizzare le API; e porta l'email in ogni richiesta |
| **Pre Token Generation Lambda** (evento V2_0, piano Essentials) che aggiunge `email` all'access token | Una Lambda in più su ogni emissione di token, e l'email di nuovo nel token, per un dato che serve solo alla Mailer |
| **Endpoint `/oauth2/userInfo`** chiamato dalle Lambda con l'access token | Sta sul dominio del user pool: i domain endpoint non passano dagli interface endpoint (PrivateLink) e un user pool con dominio non è compatibile con PrivateLink. Senza NAT non si raggiunge dalla VPC ([fonte](https://docs.aws.amazon.com/cognito/latest/developerguide/vpc-interface-endpoints.html)) |
| **Cache in memoria nella Lambda** (mappa LRU `sub` → email) | Le istanze sono tante, separate e di vita breve: la cache sarebbe quasi sempre vuota, e dalla VPC non c'è una fonte raggiungibile per riempirla. La cache vera è il database o, come scelto, Cognito stesso |
| **ID token mandato come prova solo in `PUT /users/me`** e verificato con il JWKS | Legittimo, ma il JWKS va scaricato dalla VPC senza Internet; e l'email tornerebbe nel database |
| **Lambda Authorizer** con `aws-jwt-verify` più `GetUser` (vedrebbe anche le revoche) | Verifica scritta da noi, una Lambda su ogni richiesta non in cache, latenza e un punto di rottura in più. Non serve se l'email la chiede la Mailer |

## Disponibilità dei servizi a Milano

| Servizio | In `eu-south-1`? | Note |
| --- | --- | --- |
| Cognito user pool | Sì (verificato: [endpoint Cognito](https://docs.aws.amazon.com/general/latest/gr/cognito_identity.html)) | Anche le identity pool, che non usiamo |
| SES | Sì via API (verificato: [endpoint SES](https://docs.aws.amazon.com/general/latest/gr/ses.html)) | **L'SMTP non c'è a Milano**: la Mailer usa l'API. In sandbox 200 email ogni 24 ore, 1 al secondo |
| RDS Proxy con RDS for PostgreSQL | Sì (verificato: [regioni RDS Proxy](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.RDS_Fea_Regions_DB-eng.Feature.RDSProxy.html), RDS for PostgreSQL dalla 10 alla 18, tutte le minor disponibili) | Con un'istanza Multi-AZ il proxy segue da sé la primaria |
| RDS for PostgreSQL Multi-AZ DB instance | Sì, è la funzione standard di alta disponibilità di RDS for PostgreSQL ([Multi-AZ DB instance](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZSingleStandby.html)); non c'è una tabella per regione, la combinazione classe + versione + Multi-AZ si conferma con `describe-orderable-db-instance-options` | La finestra di manutenzione di default a Milano si sceglie nel blocco 02:00-10:00 UTC |
| Lambda, HTTP API, S3, SNS, SQS, Secrets Manager, CloudWatch, endpoint VPC `sns`, `secretsmanager` e gateway `s3` | Sì | Servizi di base presenti in tutte le regioni commerciali; non verificati riga per riga |
| CloudFront, IAM | Globali | Il certificato ACM per CloudFront va in `us-east-1` |

Verificato anche sulla documentazione AWS: nel Multi-AZ DB instance la standby è sincrona e non serve letture; failover
tipico 60-120 secondi con lo stesso nome DNS; durante il failover RDS Proxy accetta connessioni sullo stesso indirizzo
senza dipendere dal DNS e chiude solo le transazioni in corso; retention dei backup da 0 a 35 giorni (7 di default in
console), log delle transazioni ogni 5 minuti; patch del sistema operativo prima sulla standby; gp3 da 20 GiB con
baseline 3000 IOPS; il topic SNS ammette per default gli eventi RDS dello stesso account; il ruolo del proxy (trust, `GetSecretValue`, `kms:Decrypt` con
`kms:ViaService`) è identico all'esempio ufficiale; prerequisiti di rete del proxy (2 subnet in AZ diverse, 10 IP
liberi); nelle HTTP API la cache della Lambda Authorizer è facoltativa e per default vale per tutte le route, e
l'access logging non richiede il ruolo CloudWatch dell'account; SNS non consegna a code cifrate con `aws/sqs`.
Verificato anche: l'authorizer JWT controlla `client_id` quando manca `aud`, e l'access token di Cognito non ha `aud`
senza resource binding; con `UsernameAttributes` lo `username` è un UUID uguale al `sub`, e `AdminGetUser` accetta il
`sub`; `AdminGetUser` è nella categoria di quota UserRead e conta per i MAU; con il login gestito i token non vanno
sotto l'ora; i domain endpoint di Cognito non passano da PrivateLink; visibility timeout 6 × timeout e
`maxReceiveCount` almeno 5 per le code lette da Lambda; formato di `batchItemFailures`; concorrenza massima dell'event
source mapping da 2 a 1000; scadenza nella DLQ contata dall'ingresso nella coda originale; DLQ sulla coda e non sulla
funzione con SQS come event source; permessi minimi del redrive; `SecurityHeadersPolicy` senza CSP.
Nessuna risorsa è stata creata su un account AWS: la documentazione descrive la configurazione prevista.

## Sviluppi futuri

- **WAF** davanti all'API, mettendo CloudFront davanti all'HTTP API (WAF è già possibile sulle distribuzioni CloudFront).
- Read replica di RDS, con un endpoint del proxy dedicato, se un giorno servisse distribuire le letture.
- **SES in produzione**: richiesta di uscita dalla sandbox e verifica del dominio del mittente (DKIM).
- Rotazione automatica dei secret con una Lambda di rotazione.
- Ambienti separati (oggi c'è solo `prod`), Infrastructure as Code (CloudFormation, Terraform o CDK), stima dei costi con
  il Pricing Calculator, modello dati, scansione antivirus dei file caricati, dominio
  personalizzato.
- Pulizia dei file degli immobili ritirati, riusando la cancellazione di un immobile della Property Lambda (oggi restano
  su S3).

## Costi complessivi

La parte più costosa è il database: le due istanze del Multi-AZ (primaria e standby) più il proxy, che si paga in base
alle vCPU dell'istanza. È comunque meno della coppia writer + reader di Aurora usata prima. Poi
gli interface endpoint, per AZ (un NAT costerebbe di più). Lambda, API Gateway, S3, SQS, SNS, SES, Cognito e CloudFront
restano nel livello gratuito o a pochi centesimi con il traffico del progetto. Prima di creare risorse reali: AWS
Budgets con un allarme a 5-10 € e il Pricing Calculator; a fine prove si cancella ciò che costa anche a vuoto (istanza
RDS, proxy, endpoint).
