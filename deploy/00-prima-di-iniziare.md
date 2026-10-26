# Fase 00 — Prima di iniziare

**Giorno 1. Durata: 1,5 - 2 ore.** Prerequisiti: un account AWS con i 200 euro di credito, accesso al tuo dominio
`mchaservice.tech` (pannello DNS) e al tuo indirizzo email.

Obiettivo: preparare il terreno. Alcune cose qui richiedono **tempo di attesa** (abilitare la regione, validare il
certificato, verificare le email): le avvii subito e lavorano mentre fai le fasi successive.

## 0.1 Account, utente di lavoro, regione

### 0.1.1 Non lavorare da root
- [ ] Console > in alto a destra il nome account > **Security credentials**: attiva l'**MFA** sull'utente root (app
      authenticator). Poi non userai più root, salvo per i passi che lo richiedono (il prossimo punto).
- [ ] **IAM > Users > Create user**: nome `matteo-admin`, spunta *Provide user access to the AWS Management Console*,
      password a tua scelta. Permessi: *Attach policies directly* > `AdministratorAccess`. Crea.
- [ ] Esci, rientra con l'utente IAM (il link di accesso è nella pagina IAM dashboard, "Sign-in URL"). Attiva l'MFA anche
      su questo utente (IAM > Users > matteo-admin > Security credentials > Assign MFA device).

**Perché.** Root ha poteri illimitati e non si può limitare; un utente IAM con MFA è la prassi minima. Qui l'utente è
admin perché stai creando di tutto: per questo la policy `iam/policies/deploy-pass-role.json` (che serve a un'identità
di deploy *ristretta*) non serve applicarla ([README](README.md#lacune-e-divergenze-della-documentazione-da-sapere-con-onestà), punto 5).

**Verifica.** In alto a destra vedi `matteo-admin @ <ACCOUNT_ID>`. Annota `<ACCOUNT_ID>` (12 cifre) nella tabella dei valori.

### 0.1.2 Abilita la regione Milano
Milano (`eu-south-1`) è una regione **opt-in**: è spenta finché non la accendi ([decisioni.md](../decisioni.md#disponibilità-dei-servizi-a-milano)).
- [ ] Root (qui serve davvero, oppure un utente IAM con permessi account se hai abilitato l'accesso IAM alla fatturazione):
      menu account > **Account** > sezione *AWS Regions* > **Europe (Milan)** > *Enable*. L'attivazione richiede da
      pochi minuti a circa un'ora.
- [ ] Nel frattempo continua: i punti 0.2 - 0.5 non dipendono da Milano (tranne SES, che aspetterai).

**Verifica.** Dal selettore regione (in alto a destra) *Europe (Milan) eu-south-1* è selezionabile e dentro la console
di un servizio (es. VPC) non compare l'errore "region not enabled". **Da qui in poi: regione = Milano**, tranne dove
scritto.

**Se si rompe.** "Not authorized to enable region": serve root o l'utente con permessi `account:EnableRegion`.

### 0.1.3 Free plan?
- [ ] **Billing and Cost Management > Home**: guarda se l'account è sul *Free plan* o sul *Paid plan*. Se è sul Free
      plan e nelle fasi seguenti un servizio ti risponde che non è disponibile per il tuo piano, usa *Upgrade plan*: i
      crediti restano validi. (Verifica in console: la regola e i nomi possono cambiare.)

## 0.2 Controllo dei costi (non saltare)

- [ ] **Billing > Budgets > Create budget** > *Use a template (simplified)* > *Monthly cost budget*: importo **40 USD**,
      la tua email. Il template crea gli avvisi all'85 % e al 100 % effettivi e al 100 % previsto. Aggiungi tu un secondo
      budget da **10 USD** se vuoi un campanello precoce.

**Perché.** I costi fissi (RDS, proxy, endpoint) corrono anche se non fai nulla ([README](README.md#costi-e-teardown-in-breve)).
Un budget non blocca la spesa, ma ti avvisa.

**Verifica.** Il budget compare in Budgets con stato *OK*.

## 0.3 Tool sul tuo PC e build degli zip

La console carica solo codice già compilato. Prepara qui gli artefatti, così le fasi 03, 05 e 07 sono solo "carica".

- [ ] Installa **Node.js 22** (LTS) e `npm`. Controllo: `node -v` mostra `v22.x`. (Alternativa: CloudShell, vedi README.)
- [ ] Dal clone del repo, branch `deploy-aws`:
  ```text
  cd backend
  npm ci
  npm run build
  npm run package
  ```
  Produce gli zip in `backend/dist/`: `property.zip`, `users.zip`, `offers.zip`, `presigned.zip`, `files.zip`,
  `mailer.zip` e `db-migrate.zip` (un `.zip` per ogni cartella di `backend/src/functions/`). Ogni zip contiene un solo
  `index.js`: l'handler è `index.handler`. Se vuoi, `npm test` e `npm run typecheck` verificano il codice prima di impacchettare.
- [ ] Controlla che ogni zip pesi qualche centinaio di KB e non decine di MB (la Presigned e le Lambda con `pg` pesano di più).

La SPA la compili più avanti (fase 07), perché ha bisogno di valori che nascono dopo (ID API, ID app client).

**Perché.** Il TypeScript va trasformato in JavaScript; esbuild fa un solo file per funzione (niente `node_modules` da
caricare).

**Se si rompe.** `npm ci` fallisce: versione di Node vecchia. `npm run package` dice che manca `dist/<nome>/index.js`: esegui prima `npm run build`.

## 0.4 Certificato ACM per CloudFront (si valida mentre lavori)

CloudFront accetta certificati solo dalla regione **N. Virginia (`us-east-1`)**, anche se il resto è a Milano.

- [ ] In alto a destra cambia regione in **US East (N. Virginia)**.
- [ ] **Certificate Manager > Request certificate > Request a public certificate**.
  - Domain names: `app.mchaservice.tech` e, con *Add another name to this certificate*, `files.mchaservice.tech`.
  - Validation method: **DNS validation**. Key algorithm: RSA 2048 (default).
- [ ] Apri il certificato appena creato (stato *Pending validation*): nella tabella *Domains* vedi, per ciascun nome, un
      record **CNAME** da creare (nome e valore). Tienilo aperto.

### Dove sta il tuo DNS?
Scoprilo: dal pannello del registrar dove hai comprato `mchaservice.tech`, o controllando i nameserver del dominio
(per esempio con un sito come dnschecker.org, record NS). Se i nameserver sono `ns-xxx.awsdns-xx.*` il DNS è già
su **Route 53**; altrimenti è dal tuo registrar o da un altro provider (Cloudflare, Aruba, GoDaddy, Namecheap...).

**Caso A: il DNS è su Route 53.** Nella pagina del certificato clicca **Create records in Route 53** > Create records.
Fatto: ACM crea i CNAME da solo. (Route 53 si usa dalla regione globale; la zona ospitata `mchaservice.tech` esiste già.)

**Caso B: il DNS è fuori da AWS** (la situazione più probabile). Nel pannello DNS del tuo provider crea **due record
CNAME**, uno per ciascun nome, copiando nome e valore dalla pagina di ACM:
| Campo | Cosa mettere |
| --- | --- |
| Tipo | `CNAME` |
| Nome / Host | la parte prima del tuo dominio: ACM mostra `_abc123.app.mchaservice.tech.`: molti provider aggiungono da soli `.mchaservice.tech`, quindi scrivi solo `_abc123.app` (senza il dominio e senza il punto finale). Se il provider *non* lo aggiunge, scrivi per intero |
| Valore / Target | `_xyz789.acm-validations.aws.` (copiato da ACM; il punto finale è facoltativo, dipende dal provider) |
| TTL | il minimo (300 secondi) |
Se il tuo provider usa un proxy (es. Cloudflare), imposta questi record come **DNS only** (nuvola grigia), non proxati.

**Perché.** ACM deve provare che il dominio è tuo: pubblica un valore, tu lo metti nel DNS, ACM lo trova. Il certificato
serve a CloudFront per servire `https://app.mchaservice.tech` con un certificato valido (HTTPS è obbligatorio).

**Verifica.** Dopo 5-30 minuti lo stato diventa **Issued**. Torna qui a controllare tra una fase e l'altra. Annota l'**ARN
del certificato** (pagina del certificato, in alto): serve in fase 07. Poi torna alla regione Milano.

**Se si rompe.** Dopo un'ora ancora *Pending validation*: record sbagliato. Errore tipico: nome doppio
(`_abc.app.mchaservice.tech.mchaservice.tech`). Controlla con `nslookup -type=CNAME _abc123.app.mchaservice.tech` (deve
rispondere il valore di ACM).

## 0.5 SES: mittente e indirizzi di prova

SES (l'invio delle email) parte in **sandbox**: spedisce solo ad indirizzi verificati ([ses.md](../ses.md)). Si
verifica a mano, ora, perché richiede di cliccare un link ricevuto per email.

- [ ] Regione **Milano**. **Amazon SES > Configuration > Identities > Create identity** > *Email address* > `<MAIL_FROM>`
      (il tuo indirizzo). Crea. SES invia un'email con un link: aprila e clicca.
- [ ] Stesso procedimento per ciascun indirizzo che userai come utente di prova. Trucco: se usi Gmail, gli alias con il
      `+` arrivano tutti nella tua casella ma per SES sono indirizzi diversi, ciascuno da verificare:
      `tuonome+buyer@gmail.com`, `tuonome+agent@gmail.com`, `tuonome+admin@gmail.com`. Verifica tutti e tre.

**Perché.** In sandbox la Mailer può scrivere solo a identità verificate (la policy `lambda-mailer.json` lo prevede:
`identity/*`). Il caso reale (chiedere l'uscita dalla sandbox) richiede una richiesta ad AWS e giorni: per la demo non serve.

**Verifica.** In Identities tutte hanno stato **Verified**. Nota: a Milano l'**SMTP di SES non c'è**: la Mailer usa l'API, quindi va bene.

**Se si rompe.** L'email di verifica non arriva: guarda lo spam; riprova *Resend*.

## 0.6 Decisioni e valori che scegli adesso

Scrivi nel tuo file di appunti:
- [ ] `<SUFFIX>`: per esempio `mcha26`. Solo minuscole e cifre. I bucket diventano `real-estate-prod-website-mcha26` e
      `real-estate-prod-files-mcha26`.
- [ ] `<MAIL_FROM>`: l'indirizzo verificato al punto 0.5.
- [ ] Email del team per gli allarmi: la tua (può essere la stessa).
- [ ] Password master del database e **5 password applicative**: usa un password manager. 24 caratteri **solo
      lettere e cifre** (niente simboli: finiranno in un JSON e in un URL). Ti servono in fase 01 (master) e 03 (le altre).

## 0.7 (Facoltativo) La policy di deploy ristretta

Se vuoi vedere il `PassRole` all'opera: IAM > Policies > Create policy > JSON, incolla
`iam/policies/deploy-pass-role.json` sostituendo `<ACCOUNT_ID>`. Non serve al funzionamento: come utente admin hai già il
permesso. Salta se vai di fretta.

## Risultato della fase 00 (puoi fermarti qui)

- [ ] Utente IAM con MFA, budget creato, regione Milano abilitata.
- [ ] Zip in `backend/dist/`.
- [ ] Certificato ACM richiesto (anche se ancora *Pending*) e record di validazione inseriti.
- [ ] Mittente e indirizzi di prova SES verificati.
- [ ] Tabella dei valori iniziata: `<ACCOUNT_ID>`, `<SUFFIX>`, `<MAIL_FROM>`, email team, ARN certificato.

Prossimo: [01-rete-e-database.md](01-rete-e-database.md).
