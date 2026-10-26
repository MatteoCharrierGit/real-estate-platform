# Fase 09 — Monitoraggio: allarmi, metric filter, eventi RDS

**Giorno 2. Durata: circa 45 minuti (più 15-20 minuti di attesa nella prova finale).** Prerequisiti: fase 02 (topic
`real-estate-prod-ops-alerts` con email confermata), fasi 05 e 08 (le Lambda sono già state invocate: esistono i loro log
group). Concetti e JSON: [cloudwatch.md](../cloudwatch.md), `config/cloudwatch-alarm-notifications-dlq.json`,
`config/cloudwatch-metric-filter-mailer-permanent-failures.json`, `config/rds-event-subscription-db.json`. È l'unica fase che
puoi tagliare se sei in ritardo: l'applicazione funziona anche senza.

Il monitoraggio serve a sapere **quando qualcosa si rompe senza stare davanti allo schermo**. Tutti gli allarmi hanno come
azione il topic `real-estate-prod-ops-alerts`, che ti manda un'email.

Regola per tutti gli allarmi: **TreatMissingData = "Treat missing data as good (not breaching)"**: se una metrica non ha
dati (coda vuota e inattiva), l'allarme resta `OK`.

## 9.1 Allarme sulla DLQ (il più importante)

Parametri di `config/cloudwatch-alarm-notifications-dlq.json`.

- [ ] **CloudWatch > Alarms > Create alarm > Select metric > SQS > Queue Metrics**: coda `real-estate-prod-notifications-dlq`,
      metrica **`ApproximateNumberOfMessagesVisible`**. Select metric.
  - Statistic **Maximum**; Period **5 minutes**.
  - Conditions: Static, **Greater than 0**. *Additional configuration*: Datapoints to alarm **1 out of 1**; Missing data
    treatment **Treat missing data as good**.
  - Actions: **In alarm** > *Select an existing SNS topic* > `real-estate-prod-ops-alerts`. **Add notification** > stato **OK** > lo stesso
    topic (così sai quando la DLQ è stata svuotata).
  - Alarm name: `real-estate-prod-notifications-dlq-not-empty`. Description: *Almeno un messaggio nella DLQ delle notifiche: un'email
    non inviata dopo 5 ricezioni.*

**Perché.** Un messaggio in DLQ vuol dire "5 tentativi falliti": un'email non è partita. Basta **un** messaggio per far scattare l'allarme.

## 9.2 Allarme sull'età dei messaggi in coda

- [ ] Nuovo allarme: SQS > Queue Metrics > coda `real-estate-prod-notifications-queue` > **`ApproximateAgeOfOldestMessage`**; Maximum; 5
      minuti; **Greater than 900** (15 minuti); 1 su 1; missing data *good*; azione In alarm -> `ops-alerts`. Nome:
      `real-estate-prod-notifications-queue-old-messages`.

**Perché.** Vede i problemi che la DLQ vede tardi: se la Mailer non viene proprio invocata, i messaggi invecchiano in coda prima di
arrivare in DLQ.

## 9.3 Errori permanenti della Mailer (metric filter + allarme)

Questi errori **non** arrivano in DLQ (sono scartati e loggati), quindi l'allarme DLQ non li vede.

- [ ] **CloudWatch > Log groups > `/aws/lambda/real-estate-prod-mailer` > Metric filters > Create metric filter**.
  - Filter pattern: `{ $.level = "ERROR" && $.code = "MAIL_PERMANENT_FAILURE" }`
  - Filter name: `real-estate-prod-mailer-permanent-failures`.
  - Metric namespace `RealEstate/Notifications`; Metric name `MailerPermanentFailures`; Metric value **1**; Default value **0**.
- [ ] **Create alarm** su quella metrica (namespace `RealEstate/Notifications`): Statistic **Sum**, 5 minuti, **> 0**, missing data *good*,
      azione -> `ops-alerts`. Nome `real-estate-prod-mailer-permanent-failures`.

**Perché.** Il log è JSON: il filtro conta le righe con `level = ERROR` e `code = MAIL_PERMANENT_FAILURE` (messaggio malformato,
email non verificata, destinatario non verificato in SES). Un utente che ha cancellato l'account è un caso previsto (`INFO`) e non conta.

**Se il log group non esiste** (la Mailer non è mai stata invocata): ripeti un'azione che mandi un'email (fase 08) o esegui un test della funzione.

## 9.4 Errori delle Lambda (6 allarmi)

Per ciascuna funzione (`real-estate-prod-property`, `-users`, `-offers`, `-presigned`, `-files`, `-mailer`):

- [ ] Create alarm > Metric > **Lambda > By Function Name** > `<funzione>` > **`Errors`**; Statistic **Sum**; 5 minuti; **> 0**; 1 su 1;
      missing data *good*; azione In alarm -> `ops-alerts`. Nome `real-estate-prod-<scope>-errors`.

**Perché.** Un errore non gestito di una Lambda diventa un 500 per l'utente: meglio saperlo subito. (Un "errore" qui è un'eccezione non
catturata; i 4xx voluti, come 403 e 409, sono risposte normali e non contano.)

## 9.5 Allarmi di RDS

- [ ] CPU: **RDS > Per-Database Metrics > `real-estate-prod-db` > `CPUUtilization`**; Average; 5 minuti; **> 80**; **3 datapoint su 3**
      (15 minuti di saturazione); missing data *good*; azione -> `ops-alerts`. Nome `real-estate-prod-db-cpu-high`.
- [ ] Connessioni: **`DatabaseConnections`**; Maximum; 5 minuti; > **80 % di `max_connections`**, 3 su 3. Per una `db.t4g.micro` (1 GiB)
      `max_connections` vale circa 110-120: usa come soglia **90** (calcola il valore vero in RDS > Parameter groups >
      `max_connections` se vuoi essere preciso). Nome `real-estate-prod-db-connections-high`.

**Perché.** CPU alta continua = query da ottimizzare o istanza da alzare; connessioni vicine al massimo = il pool del proxy si sta
saturando (*pinning*) o il carico cresce. Con il traffico di una demo difficilmente scattano: sono la rete di sicurezza.

## 9.6 Pulizia dei file non riuscita (Property Lambda)

- [ ] Log group `/aws/lambda/real-estate-prod-property` > Metric filters > Create: pattern `FILES_CLEANUP_FAILED`; namespace
      `RealEstate/Files`; metric `FilesCleanupFailed`; value 1; default 0. Poi un allarme (Sum > 0, 5 minuti -> `ops-alerts`).

**Perché.** Se, dopo aver cancellato un immobile, S3 non risponde, la Lambda logga `FILES_CLEANUP_FAILED` con il `propertyId` e risponde
comunque 204: i file rimasti si tolgono rilanciando la pulizia ([lambda-property.md](../lambda-property.md#cancellazione-di-un-immobile)).

## 9.7 Eventi di RDS (failover e guasti)

Un failover non è una metrica ma un **evento**: lo ricevi con una *event subscription*.
Parametri di `config/rds-event-subscription-db.json`.

- [ ] **RDS > Event subscriptions > Create event subscription**: Name `real-estate-prod-db-events`; Target: **ARN** > il topic
      `real-estate-prod-ops-alerts`; Source type **Instances**; *Specific instances* > `real-estate-prod-db`; Event categories **failover** e
      **failure**. Create.

**Perché.** Dopo un failover l'app dovrebbe già funzionare (il proxy si è ricollegato); l'email serve a sapere che è successo e che
la primaria ora sta nell'altra zona. Solo l'istanza del progetto e solo due categorie: niente email per backup e manutenzioni.
Per default un topic ammette gli eventi RDS dello stesso account: non serve una topic policy.

## 9.8 Retention dei log (economia)

- [ ] **CloudWatch > Log groups**: seleziona i group `/aws/lambda/real-estate-prod-*` > *Actions* > *Edit retention setting(s)* > **14 days**.
      (Senza, i log restano per sempre e costano pochi centesimi, ma crescono.)

## 9.9 Prova dal vivo: la DLQ e il redrive

Questa prova dimostra l'intero ciclo "email non partita -> messaggio in DLQ -> allarme -> redrive". Dura circa 20-25 minuti di attesa.

1. [ ] **Rompi la Mailer in modo reversibile**: Lambda > `real-estate-prod-mailer` > **Configuration > Concurrency > Edit** >
       *Reserve concurrency* = **0**. (Ogni invocazione viene rifiutata: i messaggi restano in coda e le ricezioni si accumulano.)
2. [ ] Genera una notifica: da `+buyer` fai un'offerta su un annuncio (fase 08, test 7).
3. [ ] SQS > coda > *Monitoring* o **Send and receive messages** > *Poll*: il messaggio c'è e il suo `Receive count` sale ogni ~3 minuti
       (visibility timeout 180 s).
4. [ ] Dopo **circa 15 minuti** (5 ricezioni x 180 s) il messaggio passa nella DLQ: SQS > `...-dlq` > **Messages available = 1**.
5. [ ] Entro 5-10 minuti scatta l'allarme `...-dlq-not-empty` (stato *In alarm*) e ti arriva l'**email dal topic `ops-alerts`**.
6. [ ] **Ripristina** la Mailer: *Concurrency* > **Use unreserved account concurrency**.
7. [ ] **Redrive**: SQS > `real-estate-prod-notifications-dlq` > **Start DLQ redrive** > *Redrive to source queue(s)* > velocità
       **Custom: 1 messaggio al secondo** > Redrive. Il messaggio torna nella coda (come messaggio nuovo, ricezioni a zero), la
       Mailer lo elabora, **arriva l'email dell'offerta** e la DLQ si svuota.
8. [ ] L'allarme torna **OK** (e ricevi l'email di ritorno a `OK`).

**Perché 1 al secondo.** È il limite di SES in sandbox; un redrive massiccio senza limite intaserebbe SES ([sqs.md](../sqs.md#procedura-operativa-quando-scatta-lallarme)).
Il redrive azzera il contatore: sono messaggi nuovi. In una situazione vera, prima del redrive **corregge la causa**
(guarda i log della Mailer per `messageId`): rimandare i messaggi senza aver riparato li fa finire di nuovo in DLQ.

Se dopo 25 minuti il messaggio non è in DLQ (il comportamento con concurrency 0 non è verificabile da qui), usa il metodo
alternativo: ripristina la concurrency e, nel ruolo `real-estate-prod-lambda-mailer-role`, cambia temporaneamente l'azione
`cognito-idp:AdminGetUser` della policy inline in `cognito-idp:DescribeUserPool` (la Mailer riceve `AccessDenied`, che per
il codice è un errore **temporaneo**), rifai l'offerta e **rimetti `AdminGetUser`** al termine. Non lasciare la policy modificata.

Se non hai la pazienza di aspettare 15 minuti, puoi fare solo i punti 1-3 e il 6; ma il test che conta (allarme + email) è il 4-5.

## Risultato della fase 09

- [ ] Allarmi: DLQ, età coda, errori permanenti Mailer, errori delle 6 Lambda, CPU e connessioni RDS, pulizia file.
- [ ] Event subscription RDS `real-estate-prod-db-events` (failover, failure).
- [ ] Retention dei log a 14 giorni.
- [ ] Prova DLQ: l'allarme è scattato, l'email è arrivata, il redrive ha recapitato l'email e la DLQ è tornata vuota.
- [ ] **Controlla che la Mailer non sia più a concurrency 0** (Configuration > Concurrency).

Prossimo (alla fine della presentazione): [10-troubleshooting-e-teardown.md](10-troubleshooting-e-teardown.md).
