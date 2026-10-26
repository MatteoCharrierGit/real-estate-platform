# Fase 04 — Cognito: utenti, login e gruppi

**Giorno 2. Durata: circa 1 ora.** Prerequisiti: fase 00 (`<SUFFIX>`). Non dipende dal resto dell'infrastruttura.
Concetti: [cognito.md](../cognito.md). Valori dei JSON: `config/cognito-user-pool.json`, `config/cognito-app-client.json`.

Cognito è la directory degli utenti e il "portiere" che emette i token. Qui non incolli JSON: quei due file sono
l'elenco dei valori da impostare nei campi della console, che ti riporto sotto.

> La console di Cognito è cambiata molto di recente (procedura guidata "Define your application", piani Lite/Essentials/Plus,
> managed login contro Hosted UI classico). I **valori** sotto sono quelli che contano; i nomi delle schermate possono
> differire: verifica in console. Se la procedura guidata ti propone un "Single-page application", usala pure, poi controlla
> ogni riga delle tabelle sotto nella configurazione risultante.

## 4.1 User pool

Una cosa da sapere prima di cliccare: **l'attributo di accesso (email) si sceglie alla creazione e non si cambia più**. Se
sbagli, cancelli il pool e ricomincia.

- [ ] Regione **Milano**. **Amazon Cognito > User pools > Create user pool**.

| Impostazione | Valore |
| --- | --- |
| Nome del pool | `real-estate-prod-user-pool` |
| Feature plan | **Essentials** (default: gratis fino a 10.000 utenti attivi al mese; il progetto ne ha una manciata) |
| Sign-in identifiers (Cognito user pool sign-in options) | **Email** (solo email: né username né telefono) |
| Self-registration | **Attiva** (l'utente si registra da solo dal login gestito) |
| Required attributes | **email** (obbligatorio) |
| MFA | **No MFA** (per la demo; si può attivare dopo) |
| Password policy | default Cognito |
| Account recovery | solo **email** |
| Cognito-assisted verification | **Invia codice per email** e **verifica automaticamente l'attributo email** (`AutoVerifiedAttributes: email`) |
| Cambio email | **Keep original attribute value active when an update is pending** (`AttributesRequireVerificationBeforeUpdate`): finché l'utente non conferma il codice sul nuovo indirizzo, resta attiva la vecchia email già verificata |
| Invio delle email di Cognito | **Send email with Cognito** (il servizio di default: nessun SES da configurare; limite 50 email al giorno, abbondante) |
| Deletion protection | lasciala **attiva**: la disattivi al teardown |

**Perché.** Con l'email come attributo di accesso Cognito assegna come `username` interno un identificativo **uguale al
`sub`**, che non cambia mai anche se l'utente cambia email. Per questo la Mailer potrà chiedere l'email con
`AdminGetUser(Username = sub)` ([cognito.md](../cognito.md#user-pool-lemail-è-lattributo-di-accesso)). L'email sta
**solo** qui: il database non la conserva.

- [ ] Annota lo **User pool ID** (`eu-south-1_XXXXXXXXX`) = `<USER_POOL_ID>`. (L'ARN contiene lo stesso ID.)

## 4.2 Dominio del login gestito

- [ ] Nel pool > **Branding > Domain** (o *App integration > Domain*) > **Create Cognito domain**: prefisso
      `real-estate-prod-<SUFFIX>` (deve essere unico nella regione; non può contenere `aws`, `amazon` o `cognito`).
  - **Branding version**: scegli **Hosted UI (classic)**. La versione "Managed login" richiede di creare uno *stile* di
    branding per far apparire le pagine; la classica funziona subito, con lo stesso flusso (authorization code + PKCE).
- [ ] Annota il **dominio completo**: `https://real-estate-prod-<SUFFIX>.auth.eu-south-1.amazoncognito.com`
      (è `<COGNITO_DOMAIN>` nella CSP e `VITE_COGNITO_DOMAIN` nella SPA).

**Perché.** La SPA non ha una sua pagina di login: reindirizza al login di Cognito, che fa registrazione, verifica email,
login e reset password, e rimanda indietro un *authorization code*. Meno codice da scrivere e da proteggere.

## 4.3 App client della SPA

- [ ] **App integration > App clients > Create app client** (o *Create user pool client*).

| Impostazione | Valore |
| --- | --- |
| Application type | **Single-page application (SPA)** / **Public client** |
| App client name | `real-estate-prod-spa` |
| Client secret | **Nessuno** (`GenerateSecret: false`: il codice della SPA è leggibile da chiunque) |
| Authentication flows | lascia **ALLOW_REFRESH_TOKEN_AUTH**; non servono gli altri (il login passa dalla pagina gestita) |
| Allowed callback URLs | `https://app.mchaservice.tech/callback` |
| Allowed sign-out URLs | `https://app.mchaservice.tech/` |
| Identity providers | **Cognito user pool** (`SupportedIdentityProviders: COGNITO`) |
| OAuth 2.0 grant types | **Authorization code grant** (solo questo: niente *Implicit*) |
| OpenID Connect scopes | **`openid`**, **`email`**, **`aws.cognito.signin.user.admin`** (nessun altro, nessun resource server) |
| Access token validity | **60 minuti** |
| ID token validity | **60 minuti** |
| Refresh token validity | default |
| Token revocation | **Attivo** (`EnableTokenRevocation`) |
| Attribute permissions, write | **`email`**, **`name`** (solo quelli che l'utente può cambiare da sé) |

- [ ] Salva. Annota l'**App client ID** (stringa di ~26 caratteri) = `<APP_CLIENT_ID>`.

**Perché ciascuna scelta.**
- *Nessun client secret + PKCE*: per una SPA il flusso raccomandato; il secret non si potrebbe tenere segreto.
- *Scope `aws.cognito.signin.user.admin`*: senza, l'access token non può chiamare le API di Cognito sull'utente stesso
  (`UpdateUserAttributes`, `ChangePassword`, `DeleteUser`) e la cancellazione dell'account darebbe `NotAuthorizedException`
  ([cognito.md](../cognito.md#cancellazione-dellaccount)).
- *60 minuti*: AWS sconsiglia di scendere sotto l'ora con il login gestito (il cookie di sessione dura un'ora).
- *Callback e sign-out*: sono **gli unici URL a cui Cognito rimanderà** l'utente; un URL diverso viene rifiutato (difesa
  contro i reindirizzamenti verso siti falsi). Nota: usiamo il dominio vero, quindi il login funzionerà davvero solo
  dopo la fase 07; fino ad allora puoi aprire la pagina di login ma il ritorno non ha un sito da cui arrivare.

## 4.4 Gruppi

Il **ruolo applicativo** è un gruppo del pool: finisce nel claim `cognito:groups` del token e le Lambda lo usano.

- [ ] Pool > **Groups > Create group**, tre volte: `buyer`, `agent`, `admin` (descrizioni libere, nessun IAM role, precedenza
      qualsiasi, per esempio 10, 20, 5).

**Importante — lacuna della documentazione.** **Nessuna Lambda assegna i gruppi.** Un utente appena registrato non ha nessun
gruppo e, per le Lambda, non può né creare annunci (serve `agent`) né fare offerte (serve `buyer`). Nella demo i gruppi li
dai **tu a mano**, qui in console (*Users > utente > Group memberships > Add user to group*), dopo che l'utente si è
registrato; il gruppo compare nel token solo al **login successivo** (esci dal sito e rientra). Lo farai in fase 08.

**Verifica.** Pool > Groups: i tre gruppi.

## 4.5 Prova la pagina di login (senza completare il giro)

- [ ] Apri nel browser (sostituendo i valori):
  ```text
  https://real-estate-prod-<SUFFIX>.auth.eu-south-1.amazoncognito.com/login?client_id=<APP_CLIENT_ID>&response_type=code&scope=openid+email+aws.cognito.signin.user.admin&redirect_uri=https://app.mchaservice.tech/callback
  ```
  Deve comparire la pagina di login di Cognito (con *Sign up*). Se compare un errore `redirect_mismatch` o `invalid_request`,
  il callback nell'app client non coincide *carattere per carattere* (https, niente slash finale in più, `/callback`).

**Se si rompe.**
| Sintomo | Causa |
| --- | --- |
| `Domain already exists` | prefisso occupato: cambia `<SUFFIX>` solo nel prefisso e annotalo |
| `redirect_mismatch` | callback diverso da quello salvato |
| `invalid_scope` | hai chiesto uno scope che l'app client non ha abilitato (in particolare `aws.cognito.signin.user.admin`) |
| Pagina bianca / nessun stile | hai scelto *Managed login* senza stile: passa a *Hosted UI (classic)* o crea lo stile |

## Risultato della fase 04

- [ ] User pool `real-estate-prod-user-pool` (accesso con email, verifica email automatica).
- [ ] Dominio `https://real-estate-prod-<SUFFIX>.auth.eu-south-1.amazoncognito.com`.
- [ ] App client pubblico `real-estate-prod-spa`, authorization code, 3 scope, callback/logout su `app.mchaservice.tech`.
- [ ] Gruppi `buyer`, `agent`, `admin`.
- [ ] Annotati: `<USER_POOL_ID>`, `<APP_CLIENT_ID>`, dominio Cognito.

Prossimo: [05-lambda.md](05-lambda.md).
