# Contratto tecnico — API, database, variabili, domini

Questo file è il punto di accordo tra **backend** (`backend/`), **frontend** (`frontend/`) e **piano di deploy**
(`deploy/`). Se cambia qualcosa qui, cambia in tutti e tre. Le decisioni di architettura restano quelle della
documentazione in radice (`00-architettura.md`, `decisioni.md`, ...): qui si precisa solo ciò che la documentazione lascia
aperto (nomi dei campi, colonne, domini).

## Domini e valori fissi

| Segnaposto della documentazione | Valore reale |
| --- | --- |
| `<SITE_DOMAIN>` | `app.mchaservice.tech` |
| `<FILES_DOMAIN>` | `files.mchaservice.tech` |
| Regione | `eu-south-1` (Milano); certificato ACM per CloudFront in `us-east-1` |
| API | dominio predefinito `https://<API_ID>.execute-api.eu-south-1.amazonaws.com` (nessun dominio personalizzato) |
| `<COGNITO_DOMAIN>` | dominio Cognito con prefisso, `https://<prefisso>.auth.eu-south-1.amazoncognito.com` |
| Database (nome) | `realestate` (il database `postgres` di default resta, serve al proxy) |
| Runtime Lambda | Node.js 22 (`nodejs22.x`), architettura `arm64`, handler `index.handler`, un solo file `index.js` per funzione (esbuild) |

## Lambda: variabili d'ambiente

| Variabile | Funzioni | Valore |
| --- | --- | --- |
| `DB_HOST` | property, users, offers, presigned, files | endpoint del **proxy** (`...proxy-xxxx.eu-south-1.rds.amazonaws.com`) |
| `DB_PORT` | idem | `5432` |
| `DB_NAME` | idem | `realestate` |
| `DB_USER` | idem | `property_user`, `users_user`, `offers_user`, `presigned_user`, `files_user` (uno per funzione) |
| `SNS_TOPIC_ARN` | property, users, offers | ARN del topic `real-estate-prod-notifications` |
| `FILES_BUCKET` | property, presigned, files | `real-estate-prod-files-<SUFFIX>` |
| `USER_POOL_ID` | mailer | ID del user pool |
| `MAIL_FROM` | mailer | indirizzo mittente verificato in SES |
| `SITE_URL` | mailer | `https://app.mchaservice.tech` (link nelle email) |

Nessuna password né chiave nelle variabili: le Lambda usano il token IAM per il proxy (`@aws-sdk/rds-signer`).

## Convenzioni dell'API

- JSON in entrata e in uscita, campi in `camelCase`, date ISO 8601 UTC, ID come **stringhe** (le colonne sono `bigint`).
- Errore: `{"error": {"code": "FORBIDDEN", "message": "..."}}` con status 400, 401, 403, 404, 409, 410, 422 o 500.
- Tutte le risposte hanno `content-type: application/json` (tranne 204). Niente header CORS nelle Lambda: li mette l'API.
- Utente attivo / ruoli: come in `api-gateway.md` (`currentUser`, `requireActiveUser`).

### Oggetti

```
Property  { id, title, description, price (number, euro), city, address, listingType: "sale"|"rent",
            rooms, bathrooms, areaSqm, status: "active"|"withdrawn", ownerId (assente se withdrawn),
            coverKey: string|null (chiave S3 della prima foto), createdAt }
User      { sub, displayName, phone, bio, createdAt }              // GET/PUT /users/me
PublicUser{ sub, displayName, bio }                                // GET /users/{id}
Offer     { id, propertyId, propertyTitle, buyerId, amount (number), message, status:
            "pending"|"accepted"|"rejected"|"withdrawn", createdAt, updatedAt, role: "buyer"|"owner" }
FileItem  { id, propertyId, key, contentType, sizeBytes, createdAt }
```

### Route

| Route | Body / query | Risposta |
| --- | --- | --- |
| `GET /properties` | query opzionali `city`, `listingType`, `minPrice`, `maxPrice`, `rooms` (minimo), `limit` (def. 20, max 50), `offset` | `200 {items: Property[], total}` solo `active` |
| `GET /properties/{id}` | — | `200 {property: Property, agent: PublicUser\|null}` (agent assente se ritirato) |
| `POST /properties` | `title, description, price, city, address, listingType, rooms, bathrooms, areaSqm` | `201 Property` (gruppo `agent`) |
| `PUT /properties/{id}` | stessi campi, tutti opzionali | `200 Property` (proprietario o `admin`; 409 se ritirato) |
| `DELETE /properties/{id}` | — | `204` (proprietario o `admin`) |
| `GET /users/me` | — | `200 User`; `404` se la riga non esiste ancora; `410` se cancellato |
| `PUT /users/me` | `displayName?, phone?, bio?` | `201 User` se creata (+ evento di benvenuto), `200 User` se aggiornata, `410` se cancellato |
| `DELETE /users/me` | — | `204` (anonimizza, vedi `lambda-users.md`) |
| `GET /users/{id}` | — | `200 PublicUser`; `404` se assente o cancellato |
| `POST /properties/{id}/offers` | `amount, message?` | `201 Offer` (gruppo `buyer`; 409 se immobile ritirato) |
| `GET /offers` | — | `200 {items: Offer[]}`: offerte fatte dal chiamante (`role:"buyer"`) e ricevute sui suoi immobili (`role:"owner"`) |
| `PUT /offers/{id}` | `{status: "accepted"\|"rejected"}` | `200 Offer`. **Solo il proprietario dell'immobile** (scelta più restrittiva del testo di `api-gateway.md`: l'acquirente non può accettare la propria offerta); 409 se non `pending` |
| `DELETE /offers/{id}` | — | `204`: ritiro (`withdrawn`) da parte di chi l'ha fatta o del proprietario; 409 se non `pending` |
| `POST /properties/{id}/uploads` | `{contentType, size}` (byte) | `200 {url, fields, key, expiresIn: 300}`; limiti: `image/*` ≤ 10 MiB, `video/*` ≤ 100 MiB; altro tipo → 422 |
| `GET /properties/{id}/files` | — | `200 {items: FileItem[]}` |
| `DELETE /files/{id}` | — | `204` (proprietario dell'immobile o `admin`) |

Il browser scarica i file da `https://files.mchaservice.tech/<key>`.

### Gruppi Cognito

`buyer`, `agent`, `admin`. **Nessun componente assegna i gruppi in automatico**: nella demo l'utente si registra dal login
gestito e poi l'amministratore lo mette nel gruppo dalla console (il nuovo gruppo compare nel token al login successivo).
La SPA, per un utente senza gruppi, mostra un avviso "account in attesa di un ruolo".

## Schema del database

```
users       (sub text PK, display_name text, phone text, bio text, created_at timestamptz default now(), deleted_at timestamptz)
properties  (id bigint identity PK, owner_id text NOT NULL REFERENCES users(sub), title text NOT NULL, description text,
             price numeric(12,2) NOT NULL, city text NOT NULL, address text, listing_type text CHECK in ('sale','rent'),
             rooms int, bathrooms int, area_sqm int, status text NOT NULL DEFAULT 'active' CHECK in ('active','withdrawn'),
             created_at timestamptz default now(), updated_at timestamptz default now())
offers      (id bigint identity PK, property_id bigint NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
             buyer_id text NOT NULL REFERENCES users(sub), amount numeric(12,2) NOT NULL, message text,
             status text NOT NULL DEFAULT 'pending' CHECK in ('pending','accepted','rejected','withdrawn'),
             created_at timestamptz default now(), updated_at timestamptz default now())
files       (id bigint identity PK, property_id bigint NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
             object_key text NOT NULL UNIQUE, content_type text, size_bytes bigint, created_at timestamptz default now())
```

I nomi delle colonne citate nei `GRANT` di `rds-postgres.md` (`id, owner_id, status, title`, `property_id, buyer_id, status,
amount`, `sub, deleted_at`) non cambiano. Utenti applicativi e `GRANT` minimi per ognuno li definisce
`database/roles.sql`.

## Eventi SNS (`recipientSub` + `data`, mai l'email)

`WELCOME`, `OFFER_CREATED`, `OFFER_ACCEPTED`, `OFFER_REJECTED`, `OFFER_WITHDRAWN` (formato in `sns.md`). Le email le
compone la Mailer in italiano, con `SITE_URL` nei link.

## Frontend: variabili di build (`.env.production`)

`VITE_API_URL`, `VITE_COGNITO_DOMAIN` (con `https://`), `VITE_COGNITO_CLIENT_ID`, `VITE_COGNITO_REGION` (`eu-south-1`),
`VITE_FILES_URL` (`https://files.mchaservice.tech`).

Vincoli della CSP di CloudFront (`cloudfront.md`): `script-src 'self'; style-src 'self'` → **nessuno script o stile
inline, nessun attributo `style=`, nessun `data:` URI, nessun font o script esterno**. Immagini solo da `'self'` e dal
dominio dei file; connessioni solo verso API, Cognito (`cognito-idp` e dominio del login) e il bucket dei file (upload).
