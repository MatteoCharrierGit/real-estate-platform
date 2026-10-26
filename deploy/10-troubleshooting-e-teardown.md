# Fase 10 — Troubleshooting e teardown

Due parti: **A.** errori tipici e come ragionare quando qualcosa non va; **B.** come cancellare tutto, nell'ordine giusto, per
smettere di pagare. Il teardown va fatto **il giorno stesso della presentazione**: RDS, proxy ed endpoint costano anche con
zero traffico (circa 3 $ al giorno, [README](README.md#costi-e-teardown-in-breve)).

---

# A. Troubleshooting

## Il metodo (vale sempre)

Segui la richiesta lungo la catena e fermati dove si rompe:

```text
Browser -> CloudFront -> (SPA)            F12 > Console, Network
Browser -> API Gateway (JWT, CORS)         log di accesso /aws/apigateway/real-estate-prod-api
API Gateway -> Lambda                      log /aws/lambda/real-estate-prod-<scope>
Lambda -> RDS Proxy -> RDS                 errori di connessione nei log Lambda; RDS Proxy > Targets
Lambda -> SNS -> SQS -> Mailer -> SES      Monitoring della coda; log Mailer; SES
Browser -> S3 (upload)                     Network (POST verso il bucket); log Files Lambda
```

1. Leggi il **codice di stato** e il **corpo** nel Network del browser. 2. Apri il **log** del livello che l'ha prodotto.
3. Cerca la riga con `ERROR`. 4. Confronta con le tabelle sotto. 5. Non cambiare tre cose insieme.

## Tabella dei sintomi

| Sintomo | Probabile causa | Dove correggere |
| --- | --- | --- |
| Console non mostra le risorse create | regione sbagliata (non Milano) | selettore regione |
| `Region not enabled` | Milano non abilitata | 00.1.2 |
| CloudFront non mostra il certificato | certificato non in `us-east-1` o ancora *Pending* | 00.4 |
| ACM resta *Pending validation* | record CNAME sbagliato (nome doppio, proxy attivo) | 00.4 |
| `redirect_mismatch` al login | callback nell'app client diverso da `https://app.mchaservice.tech/callback` | 04.3 |
| Login ok ma 401 sulle API | Audience non è l'ID app client; Issuer sbagliato; stai mandando l'ID token invece dell'access token | 06.2 |
| 403 sulle route che scrivono | utente senza gruppo, o token emesso prima di assegnare il gruppo (esci e rientra); `deleted_at` valorizzato | 08.2 |
| `blocked by CORS policy` | origine non ammessa (API 06.3; bucket file 02.4) | 06.3 / 02.4 |
| `Refused to ... Content Security Policy` | dominio mancante nella CSP | 07.2 |
| Pagina vecchia dopo il deploy | cache CloudFront | invalidation `/*` |
| `Task timed out` nella Lambda in VPC | SG sbagliati / proxy non Available / subnet | 01.2, 03.9, 05.2 |
| `PAM authentication failed` | `<PROXY_RESOURCE_ID>` o utente nella policy; `DB_USER` | 05.1 |
| `password authentication failed for user "..."` (dal proxy) | secret con password diversa da quella del DB | 03.7 |
| `relation ... does not exist` / `permission denied for table` | migrazione non eseguita / `GRANT`: rilancia `db-migrate` (idempotente) | 03 |
| Foto caricata ma non registrata | notifica S3 o permesso Files mancanti | 05.4 |
| Foto non visibile | bucket policy file / DNS di `files.` / chiave sbagliata | 07.5, 07.6 |
| Presigned POST rifiutato da S3 (`403`) | condizioni: tipo, dimensione, scadenza 5 min; CORS del bucket | 02.4, codice Presigned |
| Email non arrivano | vedi tabella 08.5: coda, log Mailer, SES sandbox (destinatario verificato) | - |
| `MessageRejected` | destinatario non verificato in SES | 00.5 |
| Messaggi in DLQ | causa nei log della Mailer, poi redrive | 09.9 |
| Costi più alti del previsto | endpoint, proxy, DB sempre accesi; NAT creato per sbaglio | Cost Explorer; 01.1 |

## Errori di rete: lista di controllo

- Le 5 Lambda: **stesse due subnet e `sg-lambda-internal`**.
- `sg-lambda-internal` -> `sg-rds-proxy` 5432 (outbound) **e** `sg-rds-proxy` accetta 5432 da `sg-lambda-internal` (inbound).
- `sg-rds-proxy` -> `sg-rds` 5432 e `sg-rds` accetta dal proxy.
- `sg-rds-proxy` -> `sg-endpoint-secrets-manager` 443; endpoint con **Private DNS** attivo.
- `sg-lambda-internal` -> `sg-endpoint-sns` 443 e verso la prefix list S3 (443).
- Route table delle due subnet: rotta verso l'endpoint gateway S3.
- Nessun `0.0.0.0/0` da nessuna parte (e nessun NAT).

## Pausa lunga (weekend)

RDS supporta **Stop temporarily** anche in Multi-AZ per PostgreSQL, fino a **7 giorni** (poi si riaccende da solo; **verifica in
console**: può richiedere molto tempo per un'istanza Multi-AZ). Mentre è fermo le API che usano il DB rispondono 500, **proxy ed
endpoint continuano a costare** e lo storage resta. Il risparmio è di circa 1 $ al giorno: per una pausa di 2 giorni non vale il
rischio di dimenticarsene. Se hai finito, fai direttamente il teardown.

---

# B. Teardown completo (nell'ordine giusto)

**Perché l'ordine conta.** Molte risorse non si cancellano finché qualcosa le usa: la distribuzione CloudFront va prima
disabilitata, il certificato non si cancella se è in uso, i security group non si cancellano se un altro gruppo li cita o se
una ENI di una Lambda è ancora agganciata, il bucket va svuotato, l'istanza RDS ha la protezione dalla cancellazione. Questo
è l'ordine che evita quasi tutti i `DependencyViolation`.

Prima di cominciare: salva ciò che ti serve (screenshot del collaudo, log). **La cancellazione è irreversibile.**

- [ ] **1. CloudFront.**
  - Distribuzione sito e distribuzione file: *Settings > Edit > **disattiva** (Enabled = off)* o *Disable*. Aspetta lo stato *Deployed*
    (5-15 min), poi **Delete**.
  - Poi: *Origin access* (OAC) e *Policies > Response headers* `real-estate-prod-site-security-headers`: Delete.
- [ ] **2. DNS e certificato.** Elimina i record `app`, `files` e i due CNAME `_xxx` di validazione ACM (dal tuo provider o da Route 53). Poi
      **ACM (us-east-1) > il certificato > Delete** (funziona solo se nessuna distribuzione lo usa più). Se hai creato una *hosted zone*
      Route 53 solo per questo progetto, cancellala (0,5 $ al mese).
- [ ] **3. S3.** Per ciascuno dei due bucket: **Empty** (digita `permanently delete`), poi **Delete** (digita il nome).
- [ ] **4. API Gateway.** Elimina l'API `real-estate-prod-api`. Poi il log group `/aws/apigateway/real-estate-prod-api`.
- [ ] **5. Lambda.** Elimina le 6 funzioni (il trigger SQS della Mailer sparisce con lei). Poi cancella i log group
      `/aws/lambda/real-estate-prod-*`.
  - **Aspetta 20-30 minuti prima dei passi sulla rete (8)**: le ENI delle Lambda in VPC restano agganciate ancora a lungo e
    bloccano subnet e security group. Intanto prosegui con 6, 7 e 9.
- [ ] **6. RDS Proxy e database.**
  - *RDS > Event subscriptions*: elimina `real-estate-prod-db-events`.
  - *RDS > Proxies* > `real-estate-prod-db-proxy` > **Delete**. Aspetta.
  - *RDS > Databases* > `real-estate-prod-db` > **Modify** > togli **Deletion protection** > applica subito. Poi **Delete**:
    **deseleziona** "Create final snapshot" e "Retain automated backups", spunta la conferma, digita `delete me`. Una Multi-AZ
    ci mette qualche minuto.
  - *RDS > Subnet groups*: elimina `real-estate-prod-db-subnets`. Se hai fatto snapshot manuali, cancellali (Snapshots).
- [ ] **7. Secrets Manager.** Elimina i 5 secret `real-estate/prod/database/*`. La console impone una finestra di recupero di **minimo 7
      giorni** (*Schedule deletion*); la cancellazione immediata esiste solo da CLI (`--force-delete-without-recovery`).
      Verifica in fattura se un secret in attesa di cancellazione viene ancora addebitato: di norma no.
- [ ] **8. Rete** (dopo l'attesa del punto 5).
  - *VPC > Endpoints*: elimina i due *interface* (SNS, Secrets Manager) e, se vuoi, il gateway S3. Aspetta che spariscano.
  - *VPC > Security groups*: i gruppi si citano a vicenda, quindi **prima svuota le regole** (Inbound e Outbound) di tutti e 6
    (`sg-lambda-internal`, `sg-rds-proxy`, `sg-rds`, `sg-endpoint-sns`, `sg-endpoint-secrets-manager`, `sg-db-migrate`), **poi**
    elimina i gruppi. Se compare `DependencyViolation` per una ENI: aspetta ancora e riprova (controlla *EC2 > Network interfaces*:
    devono sparire quelle `Lambda` e quelle degli endpoint).
  - *VPC > Your VPCs* > `real-estate-prod-vpc` > **Delete VPC** (la console elimina anche subnet e route table se le scegli).
- [ ] **9. Messaggistica.** *SQS*: elimina `...-queue` e `...-dlq`. *SNS*: elimina le sottoscrizioni e i topic
      `real-estate-prod-notifications` e `real-estate-prod-ops-alerts`.
- [ ] **10. CloudWatch.** *Alarms*: elimina tutti gli allarmi `real-estate-prod-*`. I *metric filter* sono spariti con i log group. Controlla
      che non restino log group `/aws/...real-estate-prod...`.
- [ ] **11. Cognito.** Nel pool: **Domain > Delete domain**; **Settings > Deletion protection > disattiva**; poi **Delete user pool**
      (digita il nome per confermare).
- [ ] **12. SES e IAM.** *SES > Identities*: elimina le identità (mittente e indirizzi di prova). *IAM > Roles*: elimina i ruoli
      `real-estate-prod-*` (6 delle Lambda + `real-estate-prod-rds-proxy-secrets-role`; quello di `db-migrate` se non l'hai già
      eliminato). Le policy inline spariscono con i ruoli. L'utente `matteo-admin` tienilo se ti serve.
- [ ] **13. Budget.** Lascia il budget: ti avvisa se qualcosa è rimasto acceso.

## Controllo finale (il giorno dopo)

- [ ] **EC2 > Network interfaces** (Milano): vuoto. **EC2 > Elastic IPs** e **NAT gateways**: vuoti (non dovrebbero esistere).
- [ ] **RDS**: nessuna istanza, nessun proxy, nessuno snapshot.
- [ ] **S3**: nessun bucket `real-estate-prod-*`. **CloudFront**: nessuna distribuzione.
- [ ] **Billing > Cost Explorer**, raggruppa per **Service** e per **Day**: dopo 24-48 ore i costi giornalieri devono essere a zero (salvo i
      secret in finestra di recupero e Route 53, se usata).
- [ ] **Resource Explorer / Tag Editor** (Milano e `us-east-1`): ricerca `real-estate`: niente di residuo.

Se la fattura continua a salire, trova la voce in Cost Explorer (Group by: Usage type): il nome del tipo d'uso dice quale servizio.
