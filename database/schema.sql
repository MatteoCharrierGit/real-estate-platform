-- Schema del database `realestate` (vedi deploy/contratto.md, sezione "Schema del database").
-- Idempotente: si può rieseguire senza errori (IF NOT EXISTS, CREATE OR REPLACE, trigger ricreati).
-- Si applica con l'utente master, per esempio:
--   psql -h <endpoint> -U <master> -d realestate -v ON_ERROR_STOP=1 -f database/schema.sql
-- Le tabelle appartengono al master: è lui che esegue le cascate delle chiavi esterne (ON DELETE CASCADE),
-- per questo property_user non ha bisogno di GRANT sulle righe di `files` che spariscono con l'immobile.

-- ---------------------------------------------------------------------------
-- users: il profilo applicativo. Niente email (sta solo in Cognito). La riga non si cancella mai:
-- alla cancellazione dell'account si anonimizza (colonne NULL + deleted_at), vedi lambda-users.md.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    sub          text PRIMARY KEY,
    display_name text,
    phone        text,
    bio          text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    deleted_at   timestamptz
);

-- ---------------------------------------------------------------------------
-- properties: gli annunci. owner_id punta a users(sub), anche dopo l'anonimizzazione.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS properties (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id     text          NOT NULL REFERENCES users (sub),
    title        text          NOT NULL,
    description  text,
    price        numeric(12,2) NOT NULL CHECK (price >= 0),
    city         text          NOT NULL,
    address      text,
    listing_type text          CHECK (listing_type IN ('sale', 'rent')),
    rooms        int,
    bathrooms    int,
    area_sqm     int,
    status       text          NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
    created_at   timestamptz   NOT NULL DEFAULT now(),
    updated_at   timestamptz   NOT NULL DEFAULT now()
);

-- Elenco pubblico: WHERE status = 'active' [AND lower(city) = lower($n)] ORDER BY created_at DESC.
-- L'espressione lower(city) serve perché il filtro per città non distingue maiuscole e minuscole.
CREATE INDEX IF NOT EXISTS properties_status_city_idx ON properties (status, lower(city));
CREATE INDEX IF NOT EXISTS properties_status_created_idx ON properties (status, created_at DESC, id DESC);
-- "I miei immobili" e la cancellazione dell'account (UPDATE ... WHERE owner_id = $1).
CREATE INDEX IF NOT EXISTS properties_owner_idx ON properties (owner_id);

-- ---------------------------------------------------------------------------
-- offers: ON DELETE CASCADE, così cancellare un immobile toglie anche le sue offerte.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS offers (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_id bigint        NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    buyer_id    text          NOT NULL REFERENCES users (sub),
    amount      numeric(12,2) NOT NULL CHECK (amount > 0),
    message     text,
    status      text          NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending', 'accepted', 'rejected', 'withdrawn')),
    created_at  timestamptz   NOT NULL DEFAULT now(),
    updated_at  timestamptz   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS offers_property_idx ON offers (property_id);
CREATE INDEX IF NOT EXISTS offers_buyer_idx ON offers (buyer_id);

-- ---------------------------------------------------------------------------
-- files: metadati degli oggetti su S3. object_key è la chiave S3 (uploads/<propertyId>/<uuid>.<ext>);
-- UNIQUE perché la notifica S3 può arrivare due volte (at-least-once) e la registrazione deve essere idempotente.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS files (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    property_id  bigint      NOT NULL REFERENCES properties (id) ON DELETE CASCADE,
    object_key   text        NOT NULL UNIQUE,
    content_type text,
    size_bytes   bigint,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS files_property_idx ON files (property_id);

-- ---------------------------------------------------------------------------
-- updated_at: SCELTA = trigger BEFORE UPDATE (non aggiornamento manuale nel codice).
-- Motivo: users_user può fare UPDATE solo della colonna status (ritiro di immobili e offerte); con il
-- trigger updated_at avanza comunque, e senza concedere a nessuno UPDATE(updated_at). Le modifiche fatte
-- da un trigger a NEW non passano dai controlli sui privilegi di colonna.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS properties_set_updated_at ON properties;
CREATE TRIGGER properties_set_updated_at BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS offers_set_updated_at ON offers;
CREATE TRIGGER offers_set_updated_at BEFORE UPDATE ON offers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();
