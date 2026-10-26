# Frontend - SPA della piattaforma immobiliare

Single Page Application in **React 18 + Vite + TypeScript (strict) + React Router**, senza librerie UI e senza SDK AWS.
Gli stili sono CSS scritti a mano. L'interfaccia e' in italiano. Il contratto con backend e deploy e' in
[`../deploy/contratto.md`](../deploy/contratto.md).

## Struttura

```
frontend/
  index.html              pagina unica, nessuno script/stile inline
  public/favicon.svg      file statici copiati cosi' come sono in dist/
  src/
    main.tsx, App.tsx     avvio e rotte (le pagine riservate sono caricate a richiesta)
    config.ts             variabili VITE_* e URL derivati
    auth/
      oauth.ts            authorization code + PKCE, scambio token, refresh, logout, caso 410
      session.ts          token SOLO IN MEMORIA (+ flag non sensibili in sessionStorage)
      AuthProvider.tsx    al ricaricamento rifa' il giro silenzioso se c'e' l'indizio
      Guards.tsx          guardie di rotta per ruolo (solo UX)
    lib/
      api.ts              client fetch tipizzato (Bearer access token, errori del contratto)
      cognito.ts          ChangePassword, UpdateUserAttributes, DeleteUser, RevokeToken (fetch diretto)
      pkce.ts, jwt.ts     PKCE con WebCrypto, decodifica ID token e gruppi
      upload.ts           presigned POST con XMLHttpRequest (barra di avanzamento)
      validation.ts       validazioni dei form e dei file (10 MiB immagini, 100 MiB video)
      types.ts            tipi degli oggetti del contratto
    pages/, components/   schermate e componenti
    styles/               base.css, components.css, pages.css
```

## Variabili di build

Copia `.env.example` in `.env.production` (build) o `.env.local` (sviluppo). **`.env.production` non si committa**
(`.gitignore`). Le variabili `VITE_*` finiscono nel bundle, quindi non vanno usate per segreti: qui sono solo indirizzi
e l'ID pubblico dell'app client.

| Variabile | Esempio |
| --- | --- |
| `VITE_API_URL` | `https://<API_ID>.execute-api.eu-south-1.amazonaws.com` |
| `VITE_COGNITO_DOMAIN` | `https://<prefisso>.auth.eu-south-1.amazoncognito.com` |
| `VITE_COGNITO_CLIENT_ID` | ID dell'app client (pubblico, senza secret) |
| `VITE_COGNITO_REGION` | `eu-south-1` |
| `VITE_FILES_URL` | `https://files.mchaservice.tech` |

Se manca una variabile la pagina mostra un messaggio di configurazione invece di restare bianca.

## Comandi

```
npm install
npm run dev         # sviluppo (serve un backend raggiungibile e un app client con callback http://localhost:5173/callback)
npm run typecheck   # tsc --noEmit
npm test            # vitest: PKCE, JWT/gruppi, client API, validazioni
npm run build       # tsc --noEmit && vite build  ->  dist/
npm run preview     # serve dist/ in locale
```

## Come funziona l'accesso

1. "Accedi" salva in `sessionStorage` verifier e `state` PKCE e fa il redirect a `<COGNITO_DOMAIN>/oauth2/authorize`
   (scope `openid email aws.cognito.signin.user.admin`); "Registrati" usa `/signup` con gli stessi parametri.
2. `/callback` verifica `state`, scambia il `code` su `/oauth2/token` e tiene ID, access e refresh token **solo in memoria**.
3. Subito dopo chiama `PUT /users/me` (crea/aggiorna la riga utente). Se risponde **410** l'utente aveva gia' confermato
   la cancellazione: la SPA chiama `DeleteUser` e fa il logout.
4. All'API va l'**access token**; l'ID token serve solo alla SPA (email, gruppi `cognito:groups`).
5. Il token si rinnova da solo con `grant_type=refresh_token` quando scade entro 60 secondi.
6. Al ricaricamento della pagina la memoria e' vuota: se in `sessionStorage` c'e' il flag `re.hint` (nessun dato
   sensibile) la SPA rifa' il giro con `prompt=none`; finche' vale il cookie del login gestito (un'ora) non si ridigita la
   password. Se non c'e' sessione resta anonima.
7. Logout: `RevokeToken` (`/oauth2/revoke`), token buttati, redirect a `<COGNITO_DOMAIN>/logout`.
8. Cancellazione account: login con `prompt=login` -> pagina di conferma -> `DELETE /users/me` -> `DeleteUser` -> logout.

Le guardie di rotta nascondono solo le pagine che non servono: chi controlla davvero ruoli e proprieta' e' il backend.

## Vincoli della CSP

La distribuzione CloudFront impone `script-src 'self'; style-src 'self'` (vedi `../cloudfront.md`). Quindi:
niente `<script>` o `<style>` inline, niente attributi `style=` (in React niente `style={{...}}`: si usano classi CSS o
elementi nativi come `<progress>`), niente URI `data:`, niente font o script esterni. Vite e' configurato per questo
(`build.assetsInlineLimit: 0`, `cssCodeSplit: false`, `sourcemap: false`).
Verifica rapida dopo il build:

```
grep -rn 'style=' dist/ ; grep -n '<script' dist/index.html   # solo <script type="module" src="...">
```

## Pubblicazione su S3 e CloudFront

Si carica il **contenuto** di `dist/` nella radice del bucket del sito (non la cartella `dist` stessa):

```
aws s3 sync dist/assets s3://real-estate-prod-website-<SUFFIX>/assets \
  --cache-control "public, max-age=31536000, immutable" --delete
aws s3 cp dist/index.html s3://real-estate-prod-website-<SUFFIX>/index.html \
  --cache-control "no-cache" --content-type "text/html; charset=utf-8"
aws s3 cp dist/favicon.svg s3://real-estate-prod-website-<SUFFIX>/favicon.svg --cache-control "public, max-age=86400"
aws cloudfront create-invalidation --distribution-id <DIST_SITE_ID> --paths "/*"
```

- I file in `assets/` hanno l'hash del contenuto nel nome: un file con quel nome non cambia mai, quindi si puo'
  tenere in cache per un anno (`immutable`).
- `index.html` ha sempre lo stesso nome e punta agli asset della versione corrente: `no-cache` fa rivalidare ogni volta.
- L'**invalidazione** serve perche' CloudFront tiene `index.html` in cache all'edge: senza, gli utenti vedrebbero ancora
  la vecchia pagina che punta a asset vecchi (gli asset vecchi non vanno cancellati subito, per chi ha la pagina aperta).
  Per `/*` basta una sola invalidazione.
- Il fallback SPA (403/404 -> `/index.html` con 200) e' configurato sulla distribuzione: `/callback`, `/offers` ecc.
  funzionano anche aprendoli direttamente.

## Limiti noti

- **"I miei annunci"**: il contratto non ha un filtro per proprietario. La SPA scorre `GET /properties` (pagine da 50, al massimo
  1000 annunci) e tiene quelli con `ownerId` uguale al `sub`. Con molti annunci e' lento, e gli annunci ritirati non compaiono
  perche' la lista e' solo `active`. Il rimedio e' un parametro lato backend (es. `ownerId=me`).
- Dopo un upload la riga in `files` la crea la Files Lambda dalla notifica S3 (asincrona): la SPA rilegge l'elenco per qualche
  secondo finche' compare il nuovo file.
- La SPA non verifica la firma dei JWT (lo fa API Gateway): decodifica solo il payload per la UX.
- Nessuna modalita' mock: per provare la UI senza backend si possono intercettare le richieste (es. `page.route` di Playwright).
