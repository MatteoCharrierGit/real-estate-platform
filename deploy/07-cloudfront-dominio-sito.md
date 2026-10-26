# Fase 07 — CloudFront, dominio e sito (la SPA)

**Giorno 2. Durata: circa 2 ore (più 10-20 minuti di attesa per la propagazione di CloudFront).** Prerequisiti: fase 00
(certificato ACM *Issued*), 02 (bucket), 04 (Cognito), 06 (`<API_ID>`). Concetti: [cloudfront.md](../cloudfront.md),
[s3.md](../s3.md). JSON: `iam/resource-policies/s3-website-bucket-policy.json`, `iam/resource-policies/s3-files-bucket-policy.json`.

Metti online il sito. L'ordine è: **headers di sicurezza -> due distribuzioni -> bucket policy -> DNS -> build e upload della SPA**.
Le bucket policy vengono *dopo* le distribuzioni perché contengono l'ID della distribuzione; finché non ci sono, i bucket sono
comunque chiusi a tutti.

## 7.1 Prima di cominciare

- [ ] Certificate Manager (**regione N. Virginia**): il certificato per `app.mchaservice.tech` e `files.mchaservice.tech` è **Issued**.
      Se è ancora *Pending*, risolvi prima (fase 00, punto 0.4): CloudFront non lo mostrerà nell'elenco.
- [ ] Hai annotati: `<SUFFIX>`, `<ACCOUNT_ID>`, `<API_ID>`, dominio Cognito, `<APP_CLIENT_ID>`.

## 7.2 La policy degli header di sicurezza (CSP)

La **Content-Security-Policy** (CSP) dice al browser da dove la pagina può caricare script e verso chi può fare richieste.
È una delle difese contro il furto dei token via XSS: la SPA tiene i token in memoria, e la CSP impedisce a uno script
iniettato di mandarli altrove ([cloudfront.md](../cloudfront.md#header-di-sicurezza-response-headers-policy)). La policy
gestita da AWS non include la CSP (dipende dai domini del progetto), quindi ne serve una nostra.

- [ ] **CloudFront > Policies > Response headers > Create response headers policy**. Name
      `real-estate-prod-site-security-headers`. Nelle sezioni:
  - **Security headers** (attiva ciascuno con *Override origin* se disponibile):

| Header | Valore |
| --- | --- |
| Content-Security-Policy | vedi il blocco qui sotto |
| Strict-Transport-Security | max-age **31536000** (senza includeSubDomains e senza preload) |
| X-Content-Type-Options | attivo (`nosniff`) |
| X-Frame-Options | **DENY** |
| Referrer-Policy | **strict-origin-when-cross-origin** |

  Valore della CSP, **su una sola riga**, con i tuoi valori al posto dei segnaposto:

  ```text
  default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://files.mchaservice.tech; media-src https://files.mchaservice.tech; connect-src 'self' https://<API_ID>.execute-api.eu-south-1.amazonaws.com https://cognito-idp.eu-south-1.amazonaws.com https://real-estate-prod-<SUFFIX>.auth.eu-south-1.amazoncognito.com https://real-estate-prod-files-<SUFFIX>.s3.eu-south-1.amazonaws.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'
  ```

  Segnaposto: `<API_ID>` (fase 06), `<SUFFIX>` (due volte), dominio Cognito (fase 04; se il tuo prefisso non è
  `real-estate-prod-<SUFFIX>`, scrivi quello vero). `<FILES_DOMAIN>` è già `files.mchaservice.tech`.
- [ ] Lascia vuote le sezioni *CORS* e *Custom headers*. Create.

**Cosa significa, riga per riga.**
- `script-src 'self'; style-src 'self'`: solo script e stili serviti dal nostro sito; **niente script o stili inline**, niente attributi
  `style=`, niente CDN esterne. (Per questo la SPA è scritta senza nulla di inline: [contratto.md](contratto.md#frontend-variabili-di-build-envproduction).)
- `img-src` e `media-src`: foto e video si caricano solo dal dominio dei file.
- `connect-src`: le chiamate `fetch` verso API, Cognito (API e dominio del login) e il **bucket dei file** (l'upload con il
  presigned POST va direttamente lì).
- `frame-ancestors 'none'` e `X-Frame-Options DENY`: nessuno può incorniciare il sito (clickjacking).
- HSTS: dal primo accesso il browser usa solo HTTPS.

**Verifica.** La policy compare in *Response headers policies*, tipo *Custom*.

**Se si rompe.** Un dominio dimenticato nella CSP **blocca una funzione** senza che nulla appaia nella pagina: il browser lo
segnala in console (F12 > Console, "Refused to connect/load ... because it violates the Content Security Policy"). Si corregge
modificando questa policy (si propaga in qualche minuto, poi `Ctrl+F5`).

## 7.3 Distribuzione del sito

- [ ] **CloudFront > Distributions > Create distribution** (il flusso guidato cambia spesso: i nomi che trovi possono
      differire; contano i valori).
  - Se ti viene chiesto un **piano di prezzo** (pricing plan/flat-rate), scegli quello a consumo / gratuito: il traffico del
    progetto è minimo. (Verifica in console: i nomi possono differire.)
  - **Origin**: tipo **Amazon S3**; bucket `real-estate-prod-website-<SUFFIX>` (l'endpoint REST
    `...s3.eu-south-1.amazonaws.com`, **non** l'endpoint "website"). *Origin access*: **Origin access control settings
    (recommended)** > *Create new OAC* (firma richieste: *Sign requests*; nome es. `real-estate-prod-website-oac`).
    Se la console propone "Allow private S3 bucket access to CloudFront" accettalo (crea l'OAC).
  - **Default cache behavior**: Viewer protocol policy **Redirect HTTP to HTTPS**; Allowed HTTP methods **GET, HEAD**;
    Compress objects: sì; Cache policy **CachingOptimized**; **Response headers policy** = `real-estate-prod-site-security-headers`.
  - **Settings**: *Alternate domain name (CNAME)*: **`app.mchaservice.tech`**; *Custom SSL certificate*: il certificato
    ACM (compare solo se *Issued* e in `us-east-1`); Security policy: la raccomandata (TLSv1.2 o superiore); Supported
    HTTP versions: HTTP/2 e HTTP/3; **Default root object: `index.html`**; Price class: *North America and Europe*;
    **AWS WAF: non attivare** (a pagamento, non serve qui).
  - Create distribution.
- [ ] Nella distribuzione > **Error pages > Create custom error response**, due volte:

| HTTP error code | Customize | Response page path | HTTP response code | Error caching min TTL |
| --- | --- | --- | --- | --- |
| 403 | Yes | `/index.html` | 200 | 10 |
| 404 | Yes | `/index.html` | 200 | 10 |

- [ ] Annota **Distribution ID** (`E...`) = `<DIST_SITE_ID>` e **Distribution domain name** (`dxxxxxxxx.cloudfront.net`).
- [ ] Se la console mostra il messaggio "Copy policy" per il bucket, **non incollarla come sta**: la bucket policy giusta è
      quella del punto 7.5 (include anche il blocco delle richieste senza TLS).

**Perché.**
- **Bucket privato + OAC**: CloudFront firma le richieste con *Origin Access Control* e la bucket policy ammette solo questa
  distribuzione. Nessuno legge il bucket direttamente.
- **403 e 404 -> `/index.html` con 200**: la SPA gestisce le sue "pagine" (per esempio `/properties/42`) nel browser; per S3 quel
  percorso non è un file. CloudFront non ha `s3:ListBucket`, quindi per un file che non esiste S3 risponde **403**, non 404:
  per questo servono entrambi ([cloudfront.md](../cloudfront.md#configurazione)).
- **Perché due distribuzioni**: gli error page valgono per tutta la distribuzione e "403/404 -> index.html" **non** deve toccare i
  file (un file mancante deve dare errore, non la SPA).
- **Redirect HTTP -> HTTPS** e HSTS: solo traffico cifrato.
- **Alias + certificato**: sono ciò che permette `https://app.mchaservice.tech` con certificato valido; il certificato deve
  stare in `us-east-1`.

## 7.4 Distribuzione dei file

- [ ] **Create distribution** di nuovo:
  - Origin: bucket `real-estate-prod-files-<SUFFIX>` (REST endpoint), OAC (puoi riusare quello esistente o crearne uno nuovo).
  - Cache behavior: Redirect HTTP to HTTPS, GET e HEAD, CachingOptimized. **Nessuna** response headers policy.
  - Alternate domain name: **`files.mchaservice.tech`**, stesso certificato ACM.
  - **Default root object: vuoto**. **Nessuna** custom error page.
  - Price class come sopra; WAF no. Create.
- [ ] Annota **`<DIST_FILES_ID>`** e il suo dominio `dyyyyyyyy.cloudfront.net`.

**Perché.** I file (foto e video) sono pubblici per chi ha il link, ma il bucket resta privato: la distribuzione legge con OAC
solo sotto `uploads/*` (vedi la policy sotto). Un file inesistente deve rispondere errore, non la SPA.

## 7.5 Le bucket policy

Ciascuna ha due statement: **permesso a quella sola distribuzione** (`AWS:SourceArn`, evita che una distribuzione di un altro
account legga il tuo bucket) e **Deny delle richieste senza TLS**.

- [ ] **S3 > `real-estate-prod-website-<SUFFIX>` > Permissions > Bucket policy > Edit**: se c'è una policy proposta dalla console
      **sostituiscila per intero** con `iam/resource-policies/s3-website-bucket-policy.json`, sostituendo `<SUFFIX>` (due volte nel
      Deny), `<ACCOUNT_ID>` e `<DIST_SITE_ID>`. Save.
- [ ] **S3 > `real-estate-prod-files-<SUFFIX>` > Permissions > Bucket policy > Edit**: `iam/resource-policies/s3-files-bucket-policy.json`
      con `<SUFFIX>`, `<ACCOUNT_ID>`, `<DIST_FILES_ID>`. Save. (Attenzione: l'Allow è su `uploads/*`, il Deny su tutto il bucket.)

**Verifica.** In *Permissions* di entrambi: *Block public access* = On; la policy salvata **senza** il badge "Public".

**Se si rompe.** `Invalid principal / policy has invalid resource`: `<SUFFIX>` non sostituito o nome diverso dal bucket.
Più avanti, `AccessDenied` su un file: ID distribuzione sbagliato nella policy.

## 7.6 DNS: `app.` e `files.` verso CloudFront

Aspetta che entrambe le distribuzioni abbiano *Status* **Enabled** e *Last modified* una data (non *Deploying*), di norma 5-15
minuti. Poi, in base a dove sta il tuo DNS (fase 00, punto 0.4):

**Caso B: DNS fuori da AWS.** Nel pannello DNS del tuo provider crea:

| Tipo | Nome / Host | Valore / Target | TTL |
| --- | --- | --- | --- |
| `CNAME` | `app` | `dxxxxxxxx.cloudfront.net` (dominio della distribuzione **sito**) | 300 |
| `CNAME` | `files` | `dyyyyyyyy.cloudfront.net` (dominio della distribuzione **file**) | 300 |

Se il provider aggiunge da solo il dominio, scrivi solo `app` e `files`. Se usa un proxy (Cloudflare) imposta **DNS only**
(nuvola grigia): con il proxy attivo il certificato e la CSP si comportano in modo diverso. Non servono record per
l'apex `mchaservice.tech`.

**Caso A: DNS su Route 53.** **Route 53 > Hosted zones > `mchaservice.tech` > Create record**: nome `app`, tipo **A**, *Alias* attivo,
*Route traffic to* > *Alias to CloudFront distribution* > scegli quella del sito. Ripeti per `files` con la distribuzione file
(opzionale: stesso record di tipo **AAAA** per IPv6).

**Perché.** Il DNS traduce `app.mchaservice.tech` nell'indirizzo di CloudFront; l'alias nella distribuzione dice a CloudFront
che quel nome è suo, il certificato prova che lo è.

**Verifica.**
- `nslookup app.mchaservice.tech` risponde con indirizzi CloudFront (o il CNAME `dxxx.cloudfront.net`). Propagazione: da pochi
  minuti a un'ora.
- `https://files.mchaservice.tech/` deve rispondere **403** (nessun oggetto alla radice e nessun `ListBucket`): significa che
  la catena dominio -> certificato -> CloudFront -> OAC -> bucket privato funziona. Un 403 qui è **buon segno**.
- Lucchetto del browser valido, certificato emesso per `app.mchaservice.tech`.

**Se si rompe.**
| Sintomo | Causa |
| --- | --- |
| `CNAMEAlreadyExists` creando la distribuzione | quel nome è già su un'altra distribuzione (anche tuo, cancellata da poco) |
| Errore certificato (`ERR_CERT_COMMON_NAME_INVALID`) | alias non aggiunto alla distribuzione, o DNS punta a quella sbagliata |
| `DNS_PROBE_FINISHED_NXDOMAIN` | record mancante o non ancora propagato; verifica nome (`app`, non `app.mchaservice.tech.mchaservice.tech`) |
| `403 Bad request / The request could not be satisfied` da CloudFront | l'alias non corrisponde all'host richiesto |
| `AccessDenied` XML da S3 sul sito | bucket policy senza l'ID distribuzione giusto, o OAC non selezionato nell'origin |

## 7.7 Build della SPA

Sul tuo PC, nel branch `deploy-aws`.

- [ ] Crea `frontend/.env.production` (non committarlo se contiene qualcosa di sensibile; qui sono tutti valori pubblici,
      finiscono comunque nel bundle):
  ```text
  VITE_API_URL=https://<API_ID>.execute-api.eu-south-1.amazonaws.com
  VITE_COGNITO_DOMAIN=https://real-estate-prod-<SUFFIX>.auth.eu-south-1.amazoncognito.com
  VITE_COGNITO_CLIENT_ID=<APP_CLIENT_ID>
  VITE_COGNITO_REGION=eu-south-1
  VITE_FILES_URL=https://files.mchaservice.tech
  ```
  Niente slash finale negli URL. (In alternativa copia `frontend/.env.example` in `frontend/.env.production` e riempilo: è lo stesso elenco.)
- [ ] ```text
  cd frontend
  npm ci
  npm run build
  ```
  Produce la cartella `frontend/dist/`.
- [ ] Controlli rapidi: `dist/index.html` esiste; `dist/assets/` contiene file `.js` e `.css` con un hash nel nome; in
      `index.html` **non ci sono `<script>` o `<style>` con codice dentro** (solo `src=` e `href=`): sarebbero bloccati dalla CSP.

**Perché.** Le `VITE_*` vengono "cotte" nel JavaScript al momento del build: la SPA non legge configurazioni a runtime. Per
questo il build va fatto **dopo** Cognito e API (altrimenti non conosceresti i valori) e va rifatto se cambiano.

## 7.8 Carica il sito e invalida la cache

- [ ] **S3 > `real-estate-prod-website-<SUFFIX>` > Upload > Add files / Add folder**: trascina **il contenuto** di `frontend/dist/`
      (il file `index.html`, gli altri file di primo livello come favicon o `robots.txt`, e la cartella `assets/`), in modo che
      `index.html` stia **alla radice** del bucket. Non caricare la cartella `dist` stessa. Upload.
- [ ] **CloudFront > distribuzione del sito > Invalidations > Create invalidation**: percorso **`/*`**. Create.
      (Dopo ogni nuovo deploy fai: upload + invalidation.)

**Perché l'invalidazione.** CloudFront tiene i file in cache (anche `index.html`): senza invalidare, gli utenti vedono la
versione vecchia fino alla scadenza. I file in `assets/` hanno l'hash nel nome, quindi non danno problemi; è `index.html` che
cambia a ogni build.

**Verifica.**
- [ ] `https://app.mchaservice.tech/` mostra la SPA. Apri la console del browser (F12): **nessun errore rosso**, in particolare
      nessun *"violates the following Content Security Policy directive"*.
- [ ] Un percorso interno, per esempio `https://app.mchaservice.tech/properties/1`, carica comunque la SPA (non una pagina
      d'errore XML): è la regola 403/404 -> `index.html`.
- [ ] Gli header: F12 > Network > clic sul documento > Response headers: `content-security-policy`, `strict-transport-security`,
      `x-frame-options: DENY`, `x-content-type-options: nosniff`.
- [ ] L'elenco annunci si carica (vuoto): significa che la SPA ha raggiunto l'API (Network: chiamata a `.../properties` con 200
      e nessun errore CORS).
- [ ] Il pulsante di login ti porta alla pagina di Cognito e, dopo il login, torna a `https://app.mchaservice.tech/callback`
      (lo provi per bene in fase 08).

**Se si rompe.**
| Sintomo | Causa |
| --- | --- |
| Pagina bianca, in console `Refused to load script` | CSP: stai servendo un build con script/stili inline o un dominio non elencato |
| `Refused to connect to ... because it violates ... connect-src` | manca un dominio nella CSP (7.2); correggi la policy |
| `blocked by CORS policy` | origine non ammessa dall'API (fase 06.3) o dal bucket (fase 02.4); controlla `https://app.mchaservice.tech` esatto |
| Pagina vecchia dopo un deploy | cache: crea l'invalidation `/*` e `Ctrl+F5` |
| `AccessDenied` XML | bucket policy / OAC (7.3 e 7.5) |
| L'URL funziona su `dxxx.cloudfront.net` ma non sul dominio | DNS o alias/certificato (7.6) |

## Risultato della fase 07 (puoi fermarti qui)

- [ ] Policy `real-estate-prod-site-security-headers` (CSP con i tuoi domini).
- [ ] Distribuzione sito (`app.mchaservice.tech`) e distribuzione file (`files.mchaservice.tech`), OAC, certificato, redirect HTTPS.
- [ ] Bucket policy salvate con gli ID delle distribuzioni; bucket ancora privati.
- [ ] DNS: due record verso CloudFront; `https://files.mchaservice.tech/` -> 403.
- [ ] SPA costruita, caricata alla radice del bucket, cache invalidata; il sito si apre su `https://app.mchaservice.tech` senza errori CSP.

Prossimo: [08-collaudo.md](08-collaudo.md).
