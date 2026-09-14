# Vigía Perú — Devpost Submission

> Copy-paste guide for the hackathon submission form. Fields are in **English**
> (international Arize + Google Cloud judges). The 3-minute video script lives in
> [`GUION_VIDEO.md`](GUION_VIDEO.md) (Spanish, for the live demo); a real analyzed
> dossier lives in [`PITCH.md`](PITCH.md) (demo backup).

---

## General info

### Project name (60 chars)
```
Vigía Perú
```
*(Alt with tagline baked in — 44 chars: `Vigía Perú — AI watchdog for public spending`)*

### Elevator pitch (200 chars)
```
11 AI agents audit Peru's public contracts for ~S/.1 (US$0.30) each: they read the bidding
docs, cross open data, and raise corruption-risk alerts — every one grounded in an official source.
```

---

## Project Story (About the project — paste as Markdown)

```markdown
## Inspiration

In Peru, corruption in public procurement isn't hidden — it's **public, in plain sight, and
unreadable**. Every tender, every awarded contract, every debarred company is *already* open
data on the State's procurement portals (SEACE/OECE). The information exists. What's missing is
the ability to read it.

Because a single suspicious contract is buried under 80-page scanned PDFs, scattered across a
dozen government portals (SEACE, OECE, SUNAT, INFOBRAS, ONPE, JNE, MEF…) that don't talk to each
other and don't share keys. A journalist or a prosecutor needs **days** to connect the dots on
**one** case — verify the winner's tax ID, read the bidding terms, check sanctions, map the
corporate network, compare prices, cite the law. There are **thousands** of new contracts every
month. Oversight, as it works today, is a slow, heroic, manual act that simply does not scale.

We were inspired by the work of investigative outlets like OjoPúblico (and their Funes model),
and we asked a deceptively simple question: **what if reviewing a state contract for corruption
signals cost one sol (≈ US$0.30) and took three minutes instead of three days?**

If the cost of oversight collapses to the price of a coffee, oversight stops being scarce. It
stops depending on a handful of overworked journalists and auditors. It becomes something anyone
— a citizen, a regional reporter, an NGO, a control body — can do, on any contract, at scale.
That is the bet behind Vigía Perú.

## What it does

**Vigía Perú** is a civic anti-corruption platform built on three layers.

**1) Machine layer — the AI watchdog.** You paste a contract identifier (a SEACE process code,
an OCDS id, or even a company's tax ID) and an **11-agent AI pipeline** goes to work. In about
three minutes it returns a complete, structured *dossier* on that contract:
- who called the tender and who won it (entity, bidders, awarded provider, amount);
- the **technical requirements extracted from the actual bidding PDFs** (line items, specs,
  quantities), via OCR;
- **risk signals ("banderas")** — e.g. a single bidder offering exactly 100% of the reference
  value, a winner whose tax ID was registered weeks before the award, a direct award without
  valid grounds, an addendum above the legal threshold, a sanctioned/debarred provider;
- the **corporate network** behind the winner (partners, legal representatives, related firms);
- a **market price check** of each item against real market medians to estimate overpricing;
- press coverage and political-financing context;
- and a final **journalistic verdict** that reads like a brief a reporter or prosecutor could act
  on — with alternative (benign) readings and suggested next steps.

Crucially, **every single risk signal is grounded in a verifiable official source**: the SEACE
contract code, a SUNAT record, and the specific **OECE normative legal opinion** it relies on.
We do not say "this is a crime." We say "this is a *risk signal*, and here is the evidence and
the law behind it." That distinction is the entire point — it keeps the platform legally
defensible and useful to professionals, not just provocative.

**2) Citizen layer — eyes on the ground.** Anyone can report a stalled or anomalous public work
with a **photo + geolocation**, plotted on an interactive map of Peru. Reports are anonymous by
default; we never publish citizens' personal data.

**3) Convergence layer — where it gets powerful.** When an automated alert (a "yellow" pin) and
an independent citizen report (a "red" pin) point at the **same** work or contract, the case
turns **black** — convergent evidence, ready to hand to a journalist or a control body.

Everything lives on an **interactive map of the country**: 🟡 automated alert · 🔴 citizen report
· ⬛ convergence. The platform also exposes its data through a remote **MCP server**, so a
journalist or prosecutor can query the risk signals from their own AI assistant — Vigía as a
*data source*, not just an app.

## How we built it

The reasoning engine is a **multi-agent system built on Google's Agent Development Kit (ADK)**.
A **coordinator** orchestrates ten specialist sub-agents plus an evaluator:

`orchestrator` (coordinates and persists) · `compliance` (hard codifiable rules) ·
`document_parser` (OCR + line-item extraction) · `document_legal_analyst` (legal RAG) ·
`market_analyst` (price vs market) · `web_research` (company profile) · `person_network`
(partners/representatives) · `political_financing` (ONPE) · `news_research` (press) ·
`citizen_reports` (red pins) · `report_writer` (verdict) · `evaluator` (self-eval).

Each agent runs on **Gemini 2.5 — Flash for the main reasoning and Flash-Lite for fast
extraction — through Vertex AI's global endpoint.**

- **Document understanding (the hard part).** Bidding files arrive as 30–90-page **scanned**
  PDFs. Our first approach — rasterizing each page and sending it to Gemini Vision — was slow,
  expensive, and frequently hit the time wall. We rebuilt it around **Document AI**: we OCR the
  whole document (imageless mode, in 30-page chunks because of the sync page limit), concatenate
  the text, and send it to Gemini in **a single call per document**. Real runs: a 58-page file →
  2 chunks → 116K chars; a 75-page file → 3 chunks → 183K chars → one Gemini call each.
- **Legal grounding (RAG).** We indexed **721 official OECE normative opinions** in **Vertex AI
  Search**. The legal-analyst agent retrieves the relevant opinion for each finding, so a flag
  becomes "contradicts OECE opinion N° 105-2023-DTN on article 76", not a vague suspicion.
- **The alert engine.** The MVP implements cross-check **C1 (RUC age vs winner)** and **C2
  (single bidder at ~100% of the reference value)**, plus codifiable hard rules (sanctioned/
  debarred provider, direct award without grounds, addendum > 25% of the original, fractioning,
  uncertified committee members…), each tied to its legal basis (Law 32069 / Law 30225).
- **Data layer.** **Cloud SQL for PostgreSQL + PostGIS** stores the procurement lifecycle,
  alerts, flags, corporate network, and geospatial pins. A lightweight **Hono/TypeScript read
  API on Cloud Run** (with cache + gzip) serves already-analyzed dossiers, so reads never hit the
  expensive orchestrator — only *new* analyses do.
- **Frontend.** **Next.js 14 + React + Tailwind on Cloud Run**, with a **Leaflet/OpenStreetMap**
  map of Peru and a live, streaming view of the agent pipeline (NDJSON) as it runs.
- **Ingestion relay.** Peruvian `.gob.pe` portals return 403 to cloud IPs, so we deployed a
  small **residential relay in Lima** (a FastAPI fetch/download service on a VPS, token-auth,
  systemd) that fetches OCDS records and PDFs from a Peruvian IP and stages large files to GCS.
- **MCP server.** A remote **Model Context Protocol** server on Cloud Run exposes the risk
  signals and their evidence as **read-only tools** to any LLM client.
- **Observability (Arize).** The entire agent loop is instrumented with **OpenInference** (the
  Google GenAI *and* Google ADK instrumentors) and dual-exported over OpenTelemetry to **Arize
  AX** and **Arize Phoenix**. Every tool call, every `transfer_to_agent`, and every Gemini turn
  is a traceable span, with tokens, cost and latency, organized as a full tree per contract.
- **Self-evaluation.** At the end of each analysis, **6 evaluators run inline** (4 LLM-as-judge +
  2 deterministic): flag support, evidence citation, price plausibility, object↔items coherence,
  **non-accusatory tone**, and pipeline completeness — surfaced in the UI alongside the cost.
- **Security.** All credentials live in **Secret Manager**; the orchestrator holds no plaintext
  keys.

## Challenges we ran into

- **Government portals block cloud IPs.** OECE/SEACE return 403 to any Google Cloud egress IP. We
  solved it with the **residential relay in Lima** so the pipeline reads the data from a Peruvian
  IP — without it, the whole machine layer is blind.
- **Document-heavy contracts blew the time budget.** An 85-page bidding base, page-by-page through
  Vision, hit the 30-minute wall. **Document AI OCR + one Gemini text call**, plus **Vertex AI's
  global endpoint**, fixed both the latency and the quota throttling — and *improved* quality,
  because nothing gets truncated anymore.
- **Hidden redundant work.** Profiling the traces in Arize, we found the same item being priced
  twice and the same PDF being OCR'd twice in a single run. Root causes: line-item dedup keyed on
  the raw item *number* (so "2" and "02" from two documents survived as duplicates), and no
  per-document parse cache. We fixed both — **semantic dedup** (by normalized description +
  quantity) and a **per-URL parse cache** — cutting redundant OCR and market calls.
- **Quota & concurrency for a live demo.** A single instance meant jurors running parallel
  analyses would 429 each other. We scaled out instances while keeping per-instance serialization,
  so several analyses run in parallel during judging.
- **Grounding without hallucination.** We added universal anti-hallucination rules to all agents
  ("never invent data; 'not found' is a valid answer; every risk signal needs a verifiable
  source; process *all* items") and an idempotent **persistence checkpoint** *before* the final
  verdict, so even a timeout never leaves an empty dossier.
- **Legal nuance.** Turning a statistical anomaly into a defensible "risk signal" required
  grounding each flag in the actual OECE legal corpus — which is why the Vertex AI Search RAG is
  not a nice-to-have but the backbone of the compliance story.

## Accomplishments that we're proud of

- A **working end-to-end pipeline**: paste a real contract code → a full corruption-risk dossier
  with legal citations, a corporate-network graph, a market check, and a verdict — in minutes.
- **≈ 1 sol (US$0.30) per analysis** — measured (≈ 12 Gemini calls, ≈ 245K tokens) and shown
  live in the dashboard. Oversight at the price of a coffee.
- **Full, real observability**: every agent decision is a traceable, evaluable span in Arize —
  and we used those traces to actually find and fix performance bugs, not just to look good.
- **Legally defensible by design**: every flag links to its official source and the relevant
  OECE opinion; we surface *signals*, never accusations.
- **Resilient on hostile infrastructure**: residential relay for blocked portals, global Vertex
  endpoint for quota, persistence checkpoint for timeouts.
- **Open source (MIT)** and non-profit, with the code public on GitHub.

## What we learned

- How to **trace, profile, and evaluate a real multi-agent loop** in production — ADK transfers,
  tool calls, and Gemini turns — instead of treating the model as a black box. Arize turned
  vague "it feels slow / it sometimes hallucinates" into specific, fixable findings.
- The **economics of document AI**: OCR-then-text beats page-by-page Vision on cost, latency,
  *and* fidelity for long structured documents — and the biggest wins came from removing
  *redundant* work (caching, dedup), not from a bigger model.
- Vertex AI's **global endpoint** is the right default for new projects fighting regional quota.
- Peru's open-procurement data (OCDS) is already rich enough to detect real red flags **today** —
  the bottleneck was never the data, it was **readability and cost**, and both are now solvable.
- Building anti-corruption tech is as much an **ethical engineering** problem as a technical one:
  the rules ("signal, not accusation"; "no citizens' personal data"; "always cite the source")
  had to be encoded into the agents' prompts and the system's guardrails, not just written in a
  README.

## What's next for Vigía Perú

- Implement the remaining high-value cross-checks: campaign-donor-turned-winner (ONPE × awards),
  family ties between officials and bidders, ghost works (INFOBRAS progress vs budget executed),
  cost overruns vs declared viability, and debarred firms hiding inside winning consortia.
- Expand from the pilot region (Áncash / Cusco) toward **national coverage**, with scheduled
  daily ingestion.
- **Citizen-report moderation** (two independent reports within 30 days to confirm a pin) and a
  formal **hand-off workflow** to journalists and the Comptroller / Public Prosecutor.
- Harden the MCP server so newsrooms and control bodies can plug Vigía into their own agents.
- Stay **open source, non-profit, no ads, no data monetization** — by design.
```

---

## Built with (tags)

```
google-cloud, vertex-ai, gemini, gemini-2-5-flash, agent-development-kit, document-ai,
vertex-ai-search, cloud-run, cloud-functions, cloud-sql, postgresql, postgis, secret-manager,
cloud-storage, model-context-protocol, arize, phoenix, openinference, opentelemetry, python,
fastapi, typescript, next.js, react, tailwindcss, hono, leaflet, openstreetmap, duckdb, pymupdf,
firebase, ocds
```

---

## "Try it out" links

- **Live demo:** https://vigia-peru-frontend-36169102688.us-central1.run.app
- **GitHub repo (MIT, open source):** https://github.com/EdwinSotto123/vigia-peru
- **Phoenix traces (observability):** https://app.phoenix.arize.com/s/edwin-soto-c

---

## Project Media

- **Image gallery (suggested):** the map with pins; a full risk dossier; the corporate-network
  graph; the Arize/Phoenix span tree; the live agent-pipeline view; the cost panel.
  (JPG/PNG, 3:2 ratio, ≤5 MB each.)
- **Video demo link:** _<paste the 3-min YouTube/Vimeo — script in `GUION_VIDEO.md`>_

---

## What Google Cloud products did you use in this project?

- **Vertex AI** — Gemini 2.5 **Flash** + **Flash-Lite**, **global endpoint** (the reasoning
  engine for all 11 agents)
- **Agent Development Kit (ADK)** — multi-agent orchestration (coordinator + `transfer_to_agent`)
- **Vertex AI Search** — semantic RAG over 721 OECE legal opinions (legal grounding)
- **Document AI** — OCR of bidding PDFs (per-use, imageless mode, 30-page chunks)
- **Cloud Run** — frontend, read API, orchestrator, and the MCP server
- **Cloud Functions (gen2)** — orchestrator entrypoint (Cloud Run-backed)
- **Cloud SQL for PostgreSQL (+ PostGIS)** — procurement lifecycle, alerts, flags, network, pins
- **Cloud Storage** — document/artifact staging from the relay
- **Secret Manager** — all credentials (no plaintext keys in the orchestrator)
- **Cloud Build + Artifact Registry** — container builds & deploys
- **Cloud Logging / Monitoring** — pipeline observability
- **Firebase Authentication** — demo login

## Please list all other tools or products you used in your project

- **Arize AX** and **Arize Phoenix** — agent observability + evaluation (dual OTEL export)
- **OpenInference / OpenTelemetry** — instrumentation standard (Google GenAI + Google ADK instrumentors)
- **Model Context Protocol (MCP)** — our own remote tool server
- **Next.js 14, React, TailwindCSS, Lucide** — frontend
- **Hono (TypeScript)** — read API on Cloud Run
- **FastAPI (Python)** — orchestrator runtime + the Lima ingestion relay
- **Leaflet + OpenStreetMap** — interactive map of Peru
- **PyMuPDF** — PDF page counting & chunking for OCR
- **DuckDB** — local analysis of the SEACE/OECE dataset (~2.5M rows; RNP alone is 1.44M)
- **Public data sources:** SEACE/OECE OCDS API, SUNAT (via decolecta / apis.net.pe),
  INFOBRAS (Comptroller), ONPE Claridad, JNE, MEF
