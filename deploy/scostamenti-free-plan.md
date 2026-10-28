# Scostamenti del deploy reale (AWS free plan)

Il progetto descrive l'architettura completa: RDS Multi-AZ e RDS Proxy. Il deploy di prova è stato fatto su un account
con il **free plan**, che non consente nessuno dei due. Questa nota dice cosa è cambiato nel deploy reale e perché;
documentazione, policy e codice del progetto restano quelli dell'architettura completa.

## 1. RDS in istanza singola

Fase 01, punto 1.3: l'istanza `real-estate-prod-db` è **Single-AZ** (`db.t4g.micro`). Nessun'altra differenza: la
subnet group copre comunque due AZ, quindi passare a Multi-AZ sarebbe solo una modifica dell'istanza.

Cosa si perde: il failover automatico. Se l'AZ dell'istanza cade, il database è giù fino al ripristino.

## 2. Niente RDS Proxy: Lambda collegate direttamente all'istanza

La fase 03 si ferma al punto 3.7 (secret). I punti 3.8 e 3.9 (ruolo del proxy e proxy) non si fanno. Al loro posto:

| Cosa | Architettura completa | Deploy free plan |
| --- | --- | --- |
| Autenticazione IAM | attiva sul proxy | attiva **sull'istanza**: RDS > Modify > *Password and IAM database authentication* |
| Utenti PostgreSQL | il proxy entra con la password dei secret | `GRANT rds_iam TO property_user, users_user, offers_user, files_user, presigned_user;` eseguito come master (da quel momento quegli utenti entrano **solo** con token IAM) |
| `sg-rds` inbound 5432 | da `sg-rds-proxy` | da **`sg-lambda-internal`** |
| `sg-lambda-internal` outbound 5432 | verso `sg-rds-proxy` | verso **`sg-rds`** |
| Policy `rds-db:connect` delle Lambda (fase 05) | `...:dbuser:<PROXY_RESOURCE_ID>/<utente>` (`prx-...`) | `...:dbuser:<DBI_RESOURCE_ID>/<utente>`: l'ID risorsa dell'**istanza** (`db-...`, RDS > istanza > Configuration > *Resource ID*), non il suo nome |
| `DB_HOST` delle Lambda | endpoint del proxy | endpoint dell'**istanza** |
| TLS | certificato del proxy da CA pubblica, già noto a Node | l'istanza usa la CA di RDS, che Node 22 non carica da solo: variabile **`NODE_EXTRA_CA_CERTS=/var/runtime/ca-cert.pem`** sulle 5 Lambda con il database (property, users, offers, files, presigned) |

Il codice non cambia: `backend/src/shared/db.ts` firma già un token IAM per l'host che riceve, e quel token vale anche
per l'istanza. Prova fatta con una Lambda temporanea che usava proprio `db.ts`, in `sg-lambda-internal`: senza
`NODE_EXTRA_CA_CERTS` l'errore è `self-signed certificate in certificate chain`; con la variabile la connessione
entra come `property_user` con TLS verificato, anche a freddo (circa 1,5 s).

Cosa si perde:
- **Il pool di connessioni.** Ogni ambiente Lambda tiene la sua connessione direttamente sul database, e
  `db.t4g.micro` ne regge poche decine. Sotto carico le Lambda possono esaurirle (`too many connections`). In un
  esercizio con pochi utenti non succede.
- **Il failover trasparente.** Il proxy nasconde il cambio di istanza alle Lambda. Senza Multi-AZ però non c'è
  comunque un failover da nascondere.

I 5 secret della fase 3.7 restano ma non li usa nessuno. `sg-rds-proxy`, l'endpoint di Secrets Manager e il suo
security group non servono più e si cancellano con il teardown.

## 3. Correzioni trovate durante il controllo

- **Segnaposto rimasti tra parentesi angolari.** Nella policy dell'endpoint VPC di SNS e nella queue policy della coda
  delle notifiche l'account era scritto `<975473296217>`. Una policy così non si applica a niente: l'endpoint avrebbe
  negato `sns:Publish` alle Lambda. Entrambe rifatte dai JSON del repo, sostituendo solo `<ACCOUNT_ID>`; prova
  SNS -> SQS superata. Regola 4 del README: le `<` e `>` vanno via insieme al segnaposto.
- **Nome della DLQ.** È stata creata come `real-estate-prod-notification-dlq` invece di `...-notifications-dlq`.
  Rinominarla vorrebbe dire ricrearla, quindi resta così: nella fase 09 (allarme) e in `ops-dlq-redrive.json` va usato
  il nome reale.

## 4. Aggiunte per rendere la demo usabile

Non fanno parte dell'architettura documentata: servono solo al deploy di prova.

- **Gruppo assegnato alla registrazione.** Il README lo segnala come lacuna: nessuno mette gli utenti nei gruppi. Nel
  deploy di prova lo fa un trigger Cognito *Post confirmation*, `real-estate-prod-cognito-post-confirmation`
  (codice in [`extra/cognito-post-confirmation/index.mjs`](extra/cognito-post-confirmation/index.mjs), Node.js 22, fuori
  dalla VPC). Chi conferma la registrazione finisce in `buyer`; gli indirizzi nella variabile `AGENT_EMAILS` finiscono in
  `agent`. Il ruolo `real-estate-prod-lambda-cognito-post-confirmation-role` ha solo `cognito-idp:AdminAddUserToGroup`
  sul pool, e la funzione ammette come chiamante solo `cognito-idp.amazonaws.com` da quel pool. Se l'assegnazione
  fallisce la registrazione va avanti lo stesso, e il gruppo si mette a mano. Come per i gruppi messi a mano, il gruppo
  compare nel token al login successivo.
  In console si collega da Cognito > pool > *Extensions* > *Add Lambda trigger* > *Sign-up* > *Post confirmation*. Da CLI
  `update-user-pool` riporta ai valori predefiniti ogni impostazione che non gli si passa: va rimandata tutta la
  configurazione letta con `describe-user-pool`.
- **Annunci di prova.** 12 annunci (Torino, Pinerolese, Val Chisone) intestati all'agente demo, creati con la Property
  Lambda vera. Le 24 foto sono illustrazioni generate, caricate in `uploads/<id>/` e registrate dalla Files Lambda
  tramite la notifica S3, come un upload dal sito.
