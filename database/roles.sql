-- Utenti PostgreSQL applicativi e GRANT minimi (vedi rds-postgres.md, "Utenti PostgreSQL").
-- Si applica DOPO schema.sql, con l'utente master, nel database `realestate`:
--   psql -h <endpoint> -U <master> -d realestate -v ON_ERROR_STOP=1 \
--        -v property_password="$PW_PROPERTY" -v users_password="$PW_USERS" -v offers_password="$PW_OFFERS" \
--        -v files_password="$PW_FILES" -v presigned_password="$PW_PRESIGNED" -f database/roles.sql
-- Le password arrivano SOLO come variabili psql (mai scritte qui). Sono le stesse dei secret che legge l'RDS Proxy.
-- La funzione db-migrate (backend/src/functions/db-migrate) sostituisce le stesse variabili con un literal
-- correttamente quotato, quindi il file si esegue allo stesso modo da lì.
--
-- Idempotente e "dichiarativo": i ruoli si creano se mancano, altrimenti si aggiorna la password; poi i privilegi
-- vengono azzerati e riassegnati da capo, così rieseguire il file riporta sempre allo stato descritto qui.
--
-- Regole di PostgreSQL che spiegano alcuni GRANT:
--  * UPDATE/DELETE con WHERE o RETURNING, e INSERT ... ON CONFLICT, leggono colonne: servono anche i SELECT
--    sulle colonne usate.
--  * Le colonne identity (id) si riempiono da sole: per l'INSERT non serve USAGE sulla sequenza.
--  * updated_at lo aggiorna un trigger (schema.sql): nessuno ha bisogno di UPDATE(updated_at).
--  * La cascata ON DELETE CASCADE gira con i permessi del proprietario delle tabelle (il master): property_user
--    cancella un immobile e spariscono offerte e file senza GRANT di DELETE su quelle tabelle.

-- 1. Ruoli. La password passa da un parametro di sessione (psql non sostituisce le variabili dentro il blocco DO).
-- (IS NOT NULL: così l'output di psql non mostra le password.)
SELECT set_config('app.pw_property_user',  :'property_password',  false) IS NOT NULL AS property_loaded,
       set_config('app.pw_users_user',     :'users_password',     false) IS NOT NULL AS users_loaded,
       set_config('app.pw_offers_user',    :'offers_password',    false) IS NOT NULL AS offers_loaded,
       set_config('app.pw_files_user',     :'files_password',     false) IS NOT NULL AS files_loaded,
       set_config('app.pw_presigned_user', :'presigned_password', false) IS NOT NULL AS presigned_loaded;

DO $do$
DECLARE
    r text;
BEGIN
    FOREACH r IN ARRAY ARRAY['property_user', 'users_user', 'offers_user', 'files_user', 'presigned_user'] LOOP
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
            EXECUTE format('CREATE USER %I PASSWORD %L', r, current_setting('app.pw_' || r));
        ELSE
            EXECUTE format('ALTER USER %I PASSWORD %L', r, current_setting('app.pw_' || r));
        END IF;
    END LOOP;
END
$do$;

-- Le password non devono restare nella sessione.
SELECT set_config('app.pw_property_user',  '', false) = '' AS property_cleared,
       set_config('app.pw_users_user',     '', false) = '' AS users_cleared,
       set_config('app.pw_offers_user',    '', false) = '' AS offers_cleared,
       set_config('app.pw_files_user',     '', false) = '' AS files_cleared,
       set_config('app.pw_presigned_user', '', false) = '' AS presigned_cleared;

-- 2. Via i privilegi di PUBLIC e azzeramento di quelli già dati (così il file è rieseguibile).
DO $do$
BEGIN
    EXECUTE format('REVOKE ALL ON DATABASE %I FROM PUBLIC', current_database());
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO property_user, users_user, offers_user, files_user, presigned_user',
                   current_database());
END
$do$;

REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public
    FROM property_user, users_user, offers_user, files_user, presigned_user;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public
    FROM property_user, users_user, offers_user, files_user, presigned_user;

GRANT USAGE ON SCHEMA public TO property_user, users_user, offers_user, files_user, presigned_user;

-- 3. Controllo "utente attivo" (requireActiveUser): tutti leggono sub e deleted_at di users.
GRANT SELECT (sub, deleted_at) ON users TO offers_user, files_user, presigned_user;

-- 4. property_user: annunci.
--    users: sub/deleted_at per requireActiveUser + display_name/bio per l'agente nel dettaglio dell'immobile.
GRANT SELECT (sub, display_name, bio, deleted_at) ON users TO property_user;
--    properties: elenco e dettaglio (SELECT), POST (INSERT senza id/status/date, che hanno i default),
--    PUT (UPDATE dei soli campi dell'annuncio: non owner_id né status), DELETE.
GRANT SELECT, DELETE ON properties TO property_user;
GRANT INSERT (owner_id, title, description, price, city, address, listing_type, rooms, bathrooms, area_sqm)
    ON properties TO property_user;
GRANT UPDATE (title, description, price, city, address, listing_type, rooms, bathrooms, area_sqm)
    ON properties TO property_user;
--    files: solo per coverKey (prima foto dell'immobile) nell'elenco. Niente scritture: la cascata non le richiede.
GRANT SELECT (id, property_id, object_key, content_type) ON files TO property_user;

-- 5. users_user: profilo, e ritiro di immobili e offerte alla cancellazione dell'account. Nessun DELETE.
GRANT SELECT ON users TO users_user;
GRANT INSERT (sub, display_name, phone, bio) ON users TO users_user;
GRANT UPDATE (display_name, phone, bio, deleted_at) ON users TO users_user;
GRANT SELECT (id, owner_id, status, title) ON properties TO users_user;
GRANT UPDATE (status) ON properties TO users_user;
GRANT SELECT (id, property_id, buyer_id, status, amount) ON offers TO users_user;
GRANT UPDATE (status) ON offers TO users_user;

-- 6. offers_user: offerte. Legge l'immobile (esiste? attivo? chi è il proprietario? titolo per l'evento).
GRANT SELECT (id, owner_id, status, title) ON properties TO offers_user;
GRANT SELECT ON offers TO offers_user;
GRANT INSERT (property_id, buyer_id, amount, message) ON offers TO offers_user;
GRANT UPDATE (status) ON offers TO offers_user;

-- 7. files_user: metadati dei file. Legge l'immobile per registrare (esiste? attivo?) e per l'ownership.
GRANT SELECT (id, owner_id, status) ON properties TO files_user;
GRANT SELECT, DELETE ON files TO files_user;
GRANT INSERT (property_id, object_key, content_type, size_bytes) ON files TO files_user;

-- 8. presigned_user: solo il controllo "è il proprietario di un immobile attivo?". Nessuna scrittura.
GRANT SELECT (id, owner_id, status) ON properties TO presigned_user;
