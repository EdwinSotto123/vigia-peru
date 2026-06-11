# Data sources

Vigía Perú combines a **local snapshot of Peru's public-procurement lifecycle** (for offline
analysis and rule development) with **live external sources** queried at analysis time.

> **The raw local dataset is not included in this repository.** It is ~739 MB and contains
> personal data (the RNP registry holds the names and national IDs of company partners and legal
> representatives). Redistributing it would violate our own ethics rule #2 — *"we do not publish
> citizens' personal data"* — and several files exceed GitHub's 100 MB per-file limit. We document
> the schema here and point to the official open-data sources instead.

---

## 1. Primary dataset — SEACE/OECE procurement (OCDS)

A 2026 snapshot (~2.5M rows) covering the **full lifecycle** of a Peruvian public contract. The
master key that threads through almost everything is **`codigoconvocatoria`**; people/companies are
keyed by **`ruc_*`** (companies, 11 digits) and **`numero_documento` / DNI** (natural persons,
8 digits).

| Phase | Table(s) | Key columns | Why it matters |
|---|---|---|---|
| **Planning** | `plan_anual_contratacion` (PAC) | `ruc_entidad` + description | What an entity *intended* to buy vs what it actually bought |
| **Call for bids** | `datos_de_la_convocatoria`, `miembros_comite`, `nulos`, `procesos_desiertos` | `codigoconvocatoria` | Process type, timelines, evaluation committee, voided/deserted processes |
| **Bidding** | `listado_de_ofertantes`, `proveedores_y_consorcios` | `codigoconvocatoria`, `ruc_postor` | Who bid; consortium composition |
| **Award** | `datos_de_adjudicacion`, `contratacion_directa` | `codigoconvocatoria`, `ruc_proveedor` | Winner, awarded amount, direct-award grounds |
| **Execution** | `contratos`, `ordenes_compra_y_servicio` | `codigoconvocatoria`, `ruc_contratista` | Contract amounts, addenda, purchase orders (fractioning) |
| **Post-control** | `arbitraje`, `PRONUNCIAMIENTOS` | `codigoconvocatoria` | Arbitration, formal rulings |

### Master / complementary data (`datos_complementarios/`)

| Table | Content | Notes |
|---|---|---|
| `entidades_contratantes` | Contracting entities (buyers) | Keyed by RUC |
| `rnp_proveedores` | National Registry of Providers: partners, legal representatives, governing bodies | **~1.44M rows — contains personal data (names, IDs)** |
| `sanciones` | Sanctioned/debarred providers, penalties, judicial disqualifications | Used by the hard compliance rules |
| `sican_certificados` | Valid SICAN certifications (procurement officials) | Committee-eligibility checks |
| `opiniones_normativas` | **721 OECE legal opinions** | Indexed in **Vertex AI Search** for the legal-grounding RAG |
| `PRONUNCIAMIENTOS` | OECE pronouncements | Post-control |

Additional regional/electoral tables in the snapshot: `ELECCIONES`, `SANCIONADOS`,
`lista_aportantes` (campaign donors), `postulantes_congreso`, `VISITANTES_ENTIDADES`, `mef`.

---

## 2. Live external sources

Queried at analysis time (most `.gob.pe` portals block cloud IPs, so requests route through a
residential relay in Lima; see [`../downloader`](../downloader)).

| Source | Category | Used for | Access |
|---|---|---|---|
| **OECE — Contrataciones Abiertas** | Contracts | The OCDS record for a tender (buyer, items, bidders, winner, documents) | REST API + downloads |
| **SUNAT** (via `apis.net.pe` / decolecta) | Companies | RUC age & status of the winning provider (cross-check **C1**) | REST API (token) |
| **INFOBRAS** (Comptroller) | Public works | Physical progress of a work | Web / downloads |
| **MEF** — Consulta Amigable / Datos Abiertos | Budget | PIA, PIM, executed amount | CSV / scrape |
| **ONPE — Portal Claridad** | Political finance | Campaign contributions (donor → winner cross-check) | Web |
| **JNE — Plataforma Electoral** | Officials | Officials' CVs (family/role links) | Web + PDFs |
| **SUNARP, OSCE debarment list, Judiciary (CEJ)** | Various | Corporate ownership, debarment, court records | Web |

---

## 3. Risk cross-checks (alert engine)

The MVP implements two cross-checks end-to-end plus a set of codifiable hard rules:

| ID | Cross-check | Signal |
|---|---|---|
| **C1** | RUC age vs winner | Company wins a contract with a tax ID registered < 90 days earlier |
| **C2** | Single bidder | One bidder offering ~100% of the reference value where competition was expected |

| Hard rule | Tables | Legal basis |
|---|---|---|
| Winner with an active sanction at award date | `adjudicacion` × `sanciones` | Art. 50 TUO Law 30225 |
| Winner with an active judicial disqualification | `adjudicacion` × judicial disqualifications | idem |
| Addendum > 25% of the original amount | `contratos.monto_adicional` | Art. 34 TUO Law 30225 |
| Direct award without valid grounds | `contratacion_directa.causal` | Art. 27 TUO Law 30225 |
| Committee member without a valid SICAN certification | `miembros_comite` × `sican_*` | Art. 8 Regulation |
| Fractioning (repeated small purchase orders) | `ordenes_compra_y_servicio` | Art. 20 Regulation |

Every red flag must **cite the relevant OECE normative opinion** (retrieved from Vertex AI Search),
turning a "presumed irregularity" into "contradicts OECE opinion D0XX-202X on article N".

---

## 4. Join keys (cheat sheet)

| Key | Meaning | Format |
|---|---|---|
| `codigoconvocatoria` | Master process key — threads the whole lifecycle | string |
| `ruc_*` | Company tax ID (entity, bidder, provider, contractor) | 11-digit string |
| `numero_documento` / `RUC_DNI` | Natural person | 8-digit DNI string |

> Names are normalized to upper-case without accents for joins (the original form is also kept).

---

## 5. How to obtain the data

The local snapshot is regenerable from the official open-data portals:

- **OECE / CONOSCE open data** — procurement lifecycle (PAC, calls, awards, contracts, orders).
- **OECE Contrataciones Abiertas** — OCDS API per process.
- **SUNAT / apis.net.pe** — company registry.
- **MEF Datos Abiertos** — budget execution.
- **ONPE, JNE, INFOBRAS** — political finance, officials, public works.

For local analysis we use **DuckDB**, which reads the `.xlsx`/`.csv` files natively and handles the
1.44M-row RNP table without loading everything into memory.
