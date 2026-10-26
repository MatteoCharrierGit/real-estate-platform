# Fase 01 — Rete e database

**Giorno 1. Durata: circa 2 ore, di cui 15-25 minuti di attesa di RDS in cui non devi fare nulla di bloccante.**
Prerequisiti: fase 00 (regione Milano abilitata, `<SUFFIX>`, password master scelta).
Concetti di fondo: [vpc.md](../vpc.md), [vpc-endpoints.md](../vpc-endpoints.md), [rds-postgres.md](../rds-postgres.md).

L'ordine è pensato per far partire **RDS il prima possibile**: gli serve solo la VPC, le subnet, il subnet group e il suo
security group. Gli endpoint e il resto li crei mentre RDS lavora.

## 1.1 VPC e subnet

Useremo la procedura guidata **VPC and more**, che crea VPC, subnet, route table e il gateway endpoint S3 in un colpo
solo (il piano originale non ha subnet pubbliche, Internet Gateway né NAT).

- [ ] **VPC > Your VPCs > Create VPC** > **VPC and more**.
  - Name tag auto-generation: attivo, prefisso `real-estate-prod`.
  - IPv4 CIDR: `10.0.0.0/16`. IPv6: nessuno. Tenancy: Default.
  - Number of Availability Zones: **2** (`eu-south-1a` e `eu-south-1b`).
  - Number of public subnets: **0**.
  - Number of private subnets: **2**. Apri *Customize subnets CIDR blocks*: `10.0.1.0/24` (A) e `10.0.2.0/24` (B).
  - NAT gateways: **None**.
  - VPC endpoints: **S3 Gateway**.
  - DNS options: spunta **Enable DNS hostnames** e **Enable DNS resolution**.
- [ ] Crea. Poi rinomina le due subnet in `private_subnet_A` (`10.0.1.0/24`, `eu-south-1a`) e `private_subnet_B`
      (`10.0.2.0/24`, `eu-south-1b`): clic sul nome > matita > salva.

**Perché.** Due subnet in due zone di disponibilità (AZ): RDS Multi-AZ e il proxy le richiedono. Niente NAT: sarebbe un
costo fisso per niente, perché dalla VPC arriviamo ai servizi AWS con gli endpoint ([vpc.md](../vpc.md)). I DNS attivi
servono perché gli endpoint "interface" usano nomi standard (`sns.eu-south-1.amazonaws.com`) che si risolvono a IP
privati (Private DNS).

**Verifica.**
- VPC > Your VPCs: `real-estate-prod-vpc` con `10.0.0.0/16`; in Details *DNS hostnames* ed *DNS resolution* = Enabled.
- Subnets: due subnet private in AZ diverse.
- VPC > Endpoints: un endpoint `com.amazonaws.eu-south-1.s3` di tipo **Gateway**, associato alle route table delle due
  subnet (scheda *Route tables*).
- Route tables delle subnet: due rotte, `10.0.0.0/16 local` e `pl-... (S3)`. **Nessuna** `0.0.0.0/0`.

Annota: ID VPC, ID di `private_subnet_A` e `B`.

**Se si rompe.** Se la procedura ha creato un NAT o un Internet Gateway: cancellali subito (costano). Se non compare
l'opzione "VPC and more", usa *VPC only* e crea a mano subnet e gateway endpoint S3.

## 1.2 Security group (i 6 firewall)

Per evitare riferimenti circolari (A cita B, B cita A) **crei prima i 6 gruppi vuoti**, poi aggiungi le regole.
Sono *stateful*: basta la regola nella direzione della connessione.

- [ ] **VPC > Security groups > Create security group**, VPC `real-estate-prod-vpc`, uno alla volta, **senza regole inbound**:

| Nome | Descrizione |
| --- | --- |
| `sg-lambda-internal` | ENI delle 5 Lambda di business |
| `sg-rds-proxy` | RDS Proxy |
| `sg-rds` | istanza RDS |
| `sg-endpoint-sns` | endpoint SNS |
| `sg-endpoint-secrets-manager` | endpoint Secrets Manager |
| `sg-db-migrate` | **temporaneo**, solo per la funzione di inizializzazione (fase 03) |

- [ ] **Nella creazione, rimuovi la regola outbound di default** ("All traffic, 0.0.0.0/0"): le regole di uscita sono
      volute, restrittive ([vpc.md](../vpc.md#security-group)). Se non l'hai tolta, la tolgono i passi sotto (apri il gruppo >
      Outbound rules > Edit).
- [ ] Ora aggiungi le regole. Per ciascun gruppo: **Edit inbound rules** / **Edit outbound rules**. Come *Source* o
      *Destination* scegli "Custom" e scrivi `sg-` per far comparire il gruppo giusto per nome.

| Gruppo | Inbound | Outbound |
| --- | --- | --- |
| `sg-lambda-internal` | nessuna | TCP 5432 -> `sg-rds-proxy`; TCP 443 -> `sg-endpoint-sns`; TCP 443 -> **prefix list S3** (`com.amazonaws.eu-south-1.s3`, `pl-...`) |
| `sg-rds-proxy` | TCP 5432 da `sg-lambda-internal` | TCP 5432 -> `sg-rds`; TCP 443 -> `sg-endpoint-secrets-manager` |
| `sg-rds` | TCP 5432 da `sg-rds-proxy` | nessuna |
| `sg-endpoint-sns` | TCP 443 da `sg-lambda-internal` | nessuna |
| `sg-endpoint-secrets-manager` | TCP 443 da `sg-rds-proxy` | nessuna |
| `sg-db-migrate` | nessuna | TCP 5432 -> `sg-rds` |

Nota sulla prefix list: nel campo *Destination* digita `pl-` o `com.amazonaws` e scegli `com.amazonaws.eu-south-1.s3`.
Annota l'ID `pl-...` e gli ID `sg-...` di tutti e 6.

**Perché.** Ogni connessione consentita è un arco del grafo: Lambda -> proxy -> DB, Lambda -> SNS, proxy -> Secrets
Manager, Lambda -> S3. Il DB accetta **solo** il proxy: le Lambda non possono parlargli direttamente. Usare un SG come
sorgente (e non un IP) fa sì che le regole reggano quando gli indirizzi cambiano. `sg-rds` non ha regole in uscita:
non serve, la risposta alla connessione ricevuta torna da sola.
**`sg-db-migrate`** è solo per la fase 03: aprirà **temporaneamente** `sg-rds` alla funzione di inizializzazione, poi lo
chiuderemo e cancelleremo.

**Verifica.** Apri `sg-rds-proxy`: Inbound = 1 regola (5432 da `sg-lambda-internal`), Outbound = 2 regole. Lo stesso
per gli altri. Nessun gruppo ha regole `0.0.0.0/0`.

**Se si rompe.** Non trovi il gruppo come sorgente: l'hai creato in un'altra VPC o regione.

## 1.3 Subnet group e istanza RDS

### 1.3.1 DB subnet group
- [ ] **RDS > Subnet groups > Create DB subnet group**: Name `real-estate-prod-db-subnets`, Description libera, VPC
      `real-estate-prod-vpc`, AZ `eu-south-1a` e `eu-south-1b`, subnet `private_subnet_A` e `private_subnet_B`.

**Perché.** Dice a RDS in quali subnet può mettere primaria e standby (almeno due AZ).

### 1.3.2 L'istanza
- [ ] **RDS > Databases > Create database**.
  - Creation method: **Standard create**. Engine: **PostgreSQL**. Engine version: **PostgreSQL 18.x** (la più recente
    offerta; se non è selezionabile a Milano scegli la 17: RDS Proxy la supporta ugualmente).
  - Templates: **Production** (serve a mostrare l'opzione Multi-AZ; la classe la cambi subito sotto).
  - Availability and durability: **Multi-AZ DB instance** (una primaria e una standby). **Non** "Multi-AZ DB cluster".
  - DB instance identifier: `real-estate-prod-db`.
  - Credentials: Master username `dbadmin`. Credentials management: **Self managed**; password = la master che hai scelto
    in fase 00 (24 caratteri alfanumerici).
  - Instance configuration: *Burstable classes (includes t classes)* > **db.t4g.micro**.
  - Storage: **gp3**, 20 GiB; *Enable storage autoscaling* con massimo 100 GiB.
  - Connectivity: *Don't connect to an EC2 compute resource*; Network type IPv4; VPC `real-estate-prod-vpc`; DB subnet
    group `real-estate-prod-db-subnets`; **Public access: No**; VPC security group: *Choose existing* > **togli `default`
    e aggiungi `sg-rds`**; Availability Zone: `eu-south-1a` (se non offerto, lascia "No preference").
  - Database authentication: **Password authentication**.
  - Monitoring: **disattiva Performance Insights** e Enhanced Monitoring (costi e non servono).
  - **Additional configuration** (espandi): Initial database name **`realestate`** (la funzione di migrazione lo creerebbe comunque se mancasse); Backup retention **7 days**; Backup
    window *Select window* **01:00** durata **0,5 h**; **Enable encryption** attivo con chiave `aws/rds` (default);
    *Enable auto minor version upgrade* attivo; Maintenance window **Sunday 02:00** durata **0,5 h**; **Enable deletion
    protection** attivo.
- [ ] Guarda il pannello *Estimated monthly costs* a destra: ti dà un'idea reale del costo (confrontala con il README).
- [ ] **Create database**. Lo stato passa a *Creating*. Aspetta con calma: **15-25 minuti**.

**Perché ciascuna scelta.** Multi-AZ: una copia sincrona in un'altra AZ per sopravvivere alla caduta di un data center
([rds-postgres.md](../rds-postgres.md)). Public access No e `sg-rds`: raggiungibile solo dal proxy. Nome DB `realestate`:
lo creiamo qui perché il codice SQL non lo fa. `dbadmin` è l'utente master, **non lo useranno mai le Lambda**. Deletion
protection: ti impedisce di cancellare il DB per sbaglio; la togli al teardown.

**Verifica (dopo l'attesa).** Stato **Available**. Aprendo l'istanza: *Configuration* > Multi-AZ = Yes; *Connectivity &
security* > *Endpoint* (annotalo come **endpoint dell'istanza RDS**), Public access No, Security group `sg-rds`.

**Se si rompe.** "db.t4g.micro non disponibile": scegli la `db.t3.micro` o `db.t4g.small` e prendine nota (cambia solo il
costo). "Il service-linked role non può essere creato": serve il permesso `iam:CreateServiceLinkedRole` (sei admin,
quindi non dovrebbe capitare). Non vedi l'opzione Multi-AZ: con il template Dev/Test può mancare, usa Production.

## 1.4 Mentre RDS si crea: gli endpoint VPC

Non aspettare davanti allo schermo: fai questo (10-15 minuti) mentre l'istanza è in *Creating*.

### 1.4.1 Endpoint SNS (interface)
- [ ] **VPC > Endpoints > Create endpoint**. Name `real-estate-prod-sns`. Type: **AWS services**. Service: cerca `sns` e scegli
      `com.amazonaws.eu-south-1.sns` (tipo *Interface*).
- [ ] VPC `real-estate-prod-vpc`. **Enable DNS name** attivo (Private DNS). Subnets: AZ A -> `private_subnet_A`, AZ B ->
      `private_subnet_B`. IP type IPv4. Security groups: **`sg-endpoint-sns`** (togli `default`).
- [ ] Policy: **Custom**; incolla `iam/resource-policies/vpc-endpoint-sns-policy.json` sostituendo `<ACCOUNT_ID>` (compare **due
      volte**: nel `Resource` e nella condizione `aws:PrincipalAccount`). Il topic `real-estate-prod-notifications` non
      esiste ancora: non è un problema, la policy è solo testo con l'ARN che avrà.
- [ ] Create endpoint.

### 1.4.2 Endpoint Secrets Manager (interface)
- [ ] Stessa procedura: nome `real-estate-prod-secretsmanager`, servizio `com.amazonaws.eu-south-1.secretsmanager`, Private DNS
      attivo, entrambe le subnet, security group **`sg-endpoint-secrets-manager`**, Policy **Full access** (default).

**Perché.** La VPC non ha Internet: senza endpoint le Lambda non raggiungerebbero SNS e il proxy non leggerebbe i secret
([vpc-endpoints.md](../vpc-endpoints.md)). Non servono endpoint per SQS, SES, Cognito (le usa la Mailer, fuori dalla VPC)
né per CloudWatch Logs.

**Verifica.** Dopo 2-5 minuti i due endpoint passano da *Pending* ad **Available**. Nella scheda *Subnets* di ciascuno
vedi una ENI per subnet. Il gateway S3 c'è già (punto 1.1). Annota gli ID `vpce-...` (utili al teardown).

**Se si rompe.** *DNS name* non attivabile: la VPC non ha DNS support/hostnames attivi (riguarda il punto 1.1). Servizio
non trovato nell'elenco: stai nella regione sbagliata.

## 1.5 Aspetta RDS

- [ ] Quando l'istanza è **Available** puoi proseguire. Se ci vuole ancora, passa alla [fase 02](02-messaggistica-e-storage.md)
      (non dipende dal DB) e torna alla [03](03-inizializzazione-db-e-proxy.md) quando è pronta.

## Risultato della fase 01 (puoi fermarti anche solo quando l'istanza è Available)

- [ ] VPC `real-estate-prod-vpc`, 2 subnet private, gateway endpoint S3 senza NAT/IGW.
- [ ] 6 security group con le regole della tabella.
- [ ] Istanza `real-estate-prod-db` Multi-AZ, Available, database `realestate`.
- [ ] Endpoint SNS e Secrets Manager Available.
- [ ] Annotati: ID VPC, subnet A e B, 6 SG, `pl-...`, endpoint dell'istanza, `vpce-...`.

Da questo momento **stai pagando** (circa 3 $ al giorno): non è un problema, ma non lasciare l'ambiente per settimane.
