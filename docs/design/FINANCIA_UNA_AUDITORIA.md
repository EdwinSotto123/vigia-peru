# Financia una auditoría — concepto, integración y plan

> Estado: **propuesta de diseño** (2026-09-14). Nada de esto está implementado.
> Decisiones tomadas con el equipo: financiadores **empresas y ciudadanos desde el
> inicio**; mapa con drill-down **departamento → provincia → distrito**; Vigía
> todavía **no tiene entidad legal** (persona natural / proyecto).

---

## 1. El concepto en una frase

**El Estado publica todos sus contratos; nadie tiene capacidad de leerlos. Vigía
vende exactamente eso: capacidad de lectura independiente, contrato por contrato.**

Cada zona del Perú tiene una cola de contratos públicos que Vigía todavía no
analizó. Analizar uno cuesta ≈ S/ 1 (US$ 0.30) en cómputo + IA, medido. Una
persona o empresa puede **financiar la capacidad de auditar** N contratos de
una zona. A cambio recibe **reconocimiento público proporcional y verificable**:
qué contratos se procesaron gracias a su aporte, qué señales se encontraron,
y un lugar en el ranking de impacto.

Lo que el financiador **compra**: procesamiento. Lo que **no compra**: qué
contratos se procesan primero, qué dice el análisis, si algo se publica o no.

### Vocabulario (obligatorio en UI y copy)

| Decimos | No decimos |
|---|---|
| financiar capacidad de auditoría | comprar / adquirir una región |
| auditoría financiada por X | región de X / patrocinada por X |
| contratos procesados gracias a X | resultados de X |
| cola de auditoría de la zona | territorio / mapa de conquista |
| comprobante de impacto | recibo de compra |
| aliado de transparencia | cliente / dueño / sponsor |

---

## 2. Análisis de la estructura actual — dónde se engancha

| Pieza existente | Qué hace hoy | Cómo se integra |
|---|---|---|
| `frontend/app/(public)/donar/page.tsx` (580 líneas) | Página de donación estática: tiers S/ 20/50/200, costos de infra, "S/ 1 = un contrato" | **Se reemplaza** por la experiencia "Financia una auditoría". El argumento "S/ 1 = un contrato" ya existe: ahora se vuelve literal y verificable. |
| `components/PeruChoropleth.tsx` (d3-geo, departamentos + provincias) | Mapa del dashboard con pines de alertas/reportes | **Se reutiliza** con un modo nuevo `mode="financiamiento"`: colorea por estado de campaña en vez de por severidad. Ya tiene drill-down a provincias (`peru-provinces.json`). Falta geometría distrital (INEI/geoBoundaries ADM3, ~1 800 polígonos, descargable con `fetch_peru_geo.py` extendido). |
| `app/(dashboard)/region/[id]` | Detalle de región: alertas, presupuesto MEF, provincias | Gana una tarjeta "Capacidad de auditoría" (cola, financiado, procesado) y un CTA "Financiar esta zona". |
| `components/landing/*` (HeroMap, ScrollStory, PlataformaTabs) | Landing con mapa cinemático y tabs de plataforma | Sección nueva antes del footer: **métricas globales de la campaña** + mini-mapa de estados + top 3 del ranking. Un solo CTA: "Financiar una auditoría". |
| `backend/api` (Hono, lectura) | `/alertas`, `/entidades`, `/reportes` | Router nuevo `/financiamiento/*` (lectura pública) + `/contribuciones/*` (escritura autenticada, webhooks). Es el lugar correcto: ya tiene Firebase Auth y Cloud SQL. |
| `backend/agent` (orquestador) | Analiza una convocatoria por `ocid` | No cambia su lógica. Se le agrega un **campo de trazabilidad**: `contribucion_id` en la corrida (para acreditar el procesamiento). Y un **worker de cola** que toma contratos `asignados` y los manda a analizar. |
| DB: `convocatorias(ocid, entidad_ruc, region)`, `entidades(ubigeo, provincia, distrito)`, `alertas(ocid, score, estado)` | Ya sabemos a qué zona pertenece cada contrato (vía `entidades.ubigeo`) y cuáles fueron analizados (`alertas`) | La **cola** es `convocatorias` sin `alertas` — no hay que inventar datos. La migración `09_financiamiento.sql` agrega zonas, contribuciones, asignaciones y ranking. |
| `backend/scrapers/oece_ocds` | Ingesta incremental por región | Alimenta la cola: cada release nuevo = un contrato pendiente más en su distrito. |
| Firebase Auth (login demo) | Email/password | Cuenta de financiador: perfil público (nombre/logo) o anónimo. |

**Conclusión:** no hay que romper nada. El 80 % es lectura sobre tablas que ya
existen + una capa nueva de contribuciones. El único cambio en el pipeline de
análisis es una columna de trazabilidad.

---

## 3. Experiencia de usuario

### 3.1 Landing → sección "Financia una auditoría"

```
┌────────────────────────────────────────────────────────────────────┐
│  12 450 contratos financiados · S/ 14 900 destinados a auditoría   │
│  18 regiones con auditoría activa · 3 200 señales de riesgo halladas│
│                                                                     │
│   [mini-mapa: estados por departamento]   🥇 Empresa X · 1 000     │
│                                           🥈 Colectivo Y ·  640    │
│                                           🥉 Anónimo ·      500    │
│                                                                     │
│              [ Financiar una auditoría → ]                          │
└────────────────────────────────────────────────────────────────────┘
```

### 3.2 Mapa de campaña (`/financiar`)

Reemplaza `/donar`. Mapa d3-geo a pantalla completa con **cuatro estados por
zona**, cada uno con color y textura propios (no solo color, por accesibilidad):

| Estado | Regla | Visual |
|---|---|---|
| **Pendiente** | financiado < 10 % de la cola | gris claro, hachurado |
| **Parcialmente financiada** | 10 % ≤ financiado < 100 % | ámbar, anillo de progreso en el centroide |
| **Financiada** | financiado ≥ cola, procesado < cola | verde claro |
| **Procesada** | procesado ≥ cola (y cola > 0) | verde pleno + ✓ |
| Sin datos | cola = 0 (no hay contratos ingresados) | gris muy claro, sin interacción |

Panel lateral al hacer hover/clic (misma pieza que `RegionDetailPanel`, modo financiamiento):

```
LIMA · SAN MARTÍN DE PORRES                     estado: parcialmente financiada
──────────────────────────────────────────────
Cola de auditoría        500 contratos    S/ 1 500 (US$ 500)
Financiado               320 / 500        ████████░░░░  64 %
Procesado                290 / 500
Señales encontradas      41  (7 críticas)
──────────────────────────────────────────────
Principales aliados      Empresa X · 200   |  Colectivo Y · 100  |  +12 personas
──────────────────────────────────────────────
[ Financiar 10 · S/ 30 ]  [ 50 · S/ 150 ]  [ 180 restantes · S/ 540 ]  [ otro ]
```

Drill-down: departamento → provincias → distritos. El breadcrumb siempre
visible. Búsqueda por nombre de distrito/entidad (una empresa suele querer "mi
distrito").

### 3.3 Página de zona (`/financiar/[ubigeo]`)

1. Cabecera: nombre, jerarquía, estado, barra de progreso doble (financiado / procesado).
2. **Qué hay en la cola** (transparencia hacia el financiador *antes* de pagar):
   número de contratos, monto total contratado, entidades involucradas, tipo
   (obras / bienes / servicios). **No** se lista contrato por contrato: el
   financiador no elige.
3. **Auditoría financiada por** — muro de aliados: logo/nombre, contratos
   financiados, fecha. Anónimos como "una persona de Lima".
4. **Resultados publicados** — las alertas ya procesadas de esa zona (lo que ya
   muestra `/region/[id]`), con la etiqueta "procesado gracias a: Empresa X".
5. CTA de contribución con selector de cantidad de contratos (no de soles: la
   unidad mental es el contrato).

### 3.4 Flujo de contribución

```
Elegir zona → elegir N contratos → identidad (empresa | persona | anónimo)
→ método de pago → confirmación → comprobante de impacto (en vivo)
```

- **Empresa**: razón social + RUC (se valida con decolecta/SUNAT, ya lo tenemos) +
  logo opcional + persona de contacto. Se verifica automáticamente que **no**
  tenga sanción vigente (`osce_sancionados`) ni aparezca como proveedor en
  alertas críticas activas. Si aparece → se acepta el aporte pero **no** hay
  reconocimiento público (ver §6).
- **Persona**: nombre para mostrar (o anónimo) + email. Sin DNI: no lo necesitamos
  y la regla #2 nos prohíbe acumular datos personales sin razón.
- **Cantidad**: N contratos × precio unitario público (§4.3). Mínimo 5 (S/ 15).
- **Pago**: según fase (§7). El aporte queda `pendiente_pago` hasta la confirmación.

### 3.5 Comprobante de impacto (`/impacto/[codigo]`)

Página pública por contribución, con URL corta compartible. Evoluciona con el tiempo:

```
COMPROBANTE DE IMPACTO · VIG-2026-00417                      Empresa X
──────────────────────────────────────────────────────────────────────
Financió la auditoría de 200 contratos en San Martín de Porres (Lima)
Aporte: S/ 600 · 14 sep 2026 · pago confirmado

Estado de procesamiento     ██████████████░░  178 / 200
Señales de riesgo halladas  23   (crítica 3 · alta 8 · media 12)
Monto contratado auditado   S/ 48.2 M

Contratos procesados (178)                          [ver todos ↓]
  OECE-1221286  Mejoramiento de pistas Av. Perú     🔴 3 señales   → dossier
  OECE-1222943  Adquisición de luminarias LED        🟢 sin señales  → dossier
  …
──────────────────────────────────────────────────────────────────────
Este aporte financió capacidad de procesamiento. Los resultados son
producidos por el pipeline de Vigía Perú sin intervención del financiador.
[Descargar PDF]  [Compartir]  [Insignia para tu web]
```

El **badge embebible** (SVG con "Aliado de transparencia · 200 contratos
auditados · Vigía Perú") es la retribución visual que una empresa realmente
usa: en su web, en LinkedIn, en su memoria anual.

### 3.6 Ranking de impacto (`/financiar/ranking`)

- Tabs: **Este mes · Este año · Histórico**. Filtro por región.
- Columna principal: **contratos financiados** (no soles — evita que el ranking
  sea de quién tiene más plata; 1 000 contratos financiados por 300 personas y
  por 1 empresa valen lo mismo).
- Columnas secundarias: zonas apoyadas, señales halladas gracias a su aporte,
  fecha del primer aporte.
- Empresas y personas en el **mismo ranking**, con ícono distinto. Un colectivo
  ciudadano ("Vecinos de SMP") puede registrarse como organización.
- Perfil público del financiador (`/aliado/[slug]`): sus contribuciones, mapa de
  zonas apoyadas, todos sus comprobantes.

### 3.7 Estado de auditoría (para todos)

Página `/financiar/estado`: la cola global en tiempo real — contratos ingresados
hoy, procesados hoy, tiempo medio de procesamiento, costo real por contrato del
mes (medido en Arize, ya lo tenemos), y **cuánto del aporte fue a cómputo**.
Esto es lo que convierte "donar" en "financiar capacidad": el financiador ve la
fábrica funcionando.

---

## 4. Modelo de datos

Migración nueva `backend/db/migrations/09_financiamiento.sql`. Convención: la
**unidad es el contrato** (`convocatorias.ocid`), la **zona es el ubigeo**
(6 dígitos INEI: `15`=Lima, `1501`=Lima provincia, `150135`=SMP).

```sql
-- Zonas: jerarquía territorial. Se carga una vez desde el INEI (1 874 distritos).
CREATE TABLE zonas (
  ubigeo        CHAR(6) PRIMARY KEY,
  nivel         TEXT NOT NULL CHECK (nivel IN ('departamento','provincia','distrito')),
  nombre        TEXT NOT NULL,
  padre_ubigeo  CHAR(6) REFERENCES zonas(ubigeo),
  centroide     GEOGRAPHY(POINT, 4326)
);

-- Financiadores: empresa, persona u organización. Perfil público opcional.
CREATE TABLE financiadores (
  id              BIGSERIAL PRIMARY KEY,
  tipo            TEXT NOT NULL CHECK (tipo IN ('empresa','persona','organizacion')),
  nombre_publico  TEXT,                 -- NULL = anónimo
  slug            TEXT UNIQUE,          -- /aliado/<slug>
  ruc             CHAR(11),             -- solo empresa/organización; validado con SUNAT
  logo_url        TEXT,
  email           TEXT NOT NULL,        -- privado, para el comprobante
  firebase_uid    TEXT UNIQUE,
  visible         BOOLEAN NOT NULL DEFAULT TRUE,   -- FALSE si conflicto de interés (§6)
  motivo_no_visible TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Precio unitario vigente (histórico, para que un comprobante viejo no cambie).
CREATE TABLE tarifas (
  id            SERIAL PRIMARY KEY,
  vigente_desde DATE NOT NULL,
  costo_real_pen NUMERIC(8,2) NOT NULL,   -- medido (Arize): ~1.00
  precio_pen     NUMERIC(8,2) NOT NULL,   -- público: 3.00 (cubre infra fija + reserva)
  precio_usd     NUMERIC(8,2) NOT NULL
);

-- Contribuciones: una por pago. Estado = ciclo de vida del dinero.
CREATE TABLE contribuciones (
  id              BIGSERIAL PRIMARY KEY,
  codigo          TEXT UNIQUE NOT NULL,          -- VIG-2026-00417 (público)
  financiador_id  BIGINT NOT NULL REFERENCES financiadores(id),
  ubigeo          CHAR(6) NOT NULL REFERENCES zonas(ubigeo),
  contratos       INT NOT NULL CHECK (contratos >= 5),
  tarifa_id       INT NOT NULL REFERENCES tarifas(id),
  monto_pen       NUMERIC(10,2) NOT NULL,
  moneda_pago     TEXT NOT NULL DEFAULT 'PEN',
  estado          TEXT NOT NULL DEFAULT 'pendiente_pago'
                  CHECK (estado IN ('pendiente_pago','pagada','en_proceso','procesada','reembolsada','rechazada')),
  pasarela        TEXT,                          -- 'mercadopago' | 'culqi' | 'transferencia' | 'yape'
  pasarela_ref    TEXT,                          -- id de la transacción externa
  comprobante_url TEXT,                          -- foto/PDF si es transferencia manual
  validada_por    TEXT,                          -- admin que validó (manual)
  pagada_at       TIMESTAMPTZ,
  mensaje_publico TEXT,                          -- "Por un SMP sin sobrecostos" (moderado)
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Asignaciones: qué contrato concreto se procesó con cargo a qué contribución.
-- Es la trazabilidad del "comprobante de impacto". FIFO por zona, nunca elegido a mano.
CREATE TABLE asignaciones (
  id               BIGSERIAL PRIMARY KEY,
  contribucion_id  BIGINT NOT NULL REFERENCES contribuciones(id),
  ocid             TEXT NOT NULL REFERENCES convocatorias(ocid),
  asignada_at      TIMESTAMPTZ DEFAULT NOW(),
  procesada_at     TIMESTAMPTZ,
  alerta_id        UUID REFERENCES alertas(id),     -- resultado, cuando existe
  costo_real_pen   NUMERIC(8,4),                    -- lo que costó de verdad (span de Arize)
  UNIQUE (ocid)                                     -- un contrato se financia una sola vez
);

-- Cola de auditoría por zona: contratos ingresados sin análisis ni asignación.
CREATE VIEW cola_auditoria AS
SELECT e.ubigeo, c.ocid, c.valor_referencial, c.fecha_convocatoria
FROM convocatorias c
JOIN entidades e ON e.ruc = c.entidad_ruc
LEFT JOIN alertas a ON a.ocid = c.ocid
LEFT JOIN asignaciones s ON s.ocid = c.ocid
WHERE a.id IS NULL AND s.id IS NULL;

-- Estado por zona (lo que pinta el mapa). Materializada, refresco cada 5 min.
CREATE MATERIALIZED VIEW zona_estado AS
SELECT z.ubigeo, z.nivel, z.nombre, z.padre_ubigeo,
       COUNT(q.ocid)                                        AS pendientes,
       COALESCE(SUM(c.contratos) FILTER (WHERE c.estado IN ('pagada','en_proceso','procesada')), 0) AS financiados,
       COUNT(s.id) FILTER (WHERE s.procesada_at IS NOT NULL) AS procesados,
       COUNT(al.id)                                          AS senales,
       CASE
         WHEN COUNT(q.ocid) = 0 AND COUNT(s.id) = 0 THEN 'sin_datos'
         WHEN COUNT(s.id) FILTER (WHERE s.procesada_at IS NOT NULL) >= COUNT(q.ocid) + COUNT(s.id) THEN 'procesada'
         WHEN COALESCE(SUM(c.contratos) FILTER (WHERE c.estado <> 'pendiente_pago'),0) >= COUNT(q.ocid) + COUNT(s.id) THEN 'financiada'
         WHEN COALESCE(SUM(c.contratos) FILTER (WHERE c.estado <> 'pendiente_pago'),0) > 0 THEN 'parcial'
         ELSE 'pendiente'
       END AS estado
FROM zonas z
LEFT JOIN cola_auditoria q ON q.ubigeo = z.ubigeo
LEFT JOIN contribuciones c ON c.ubigeo = z.ubigeo
LEFT JOIN asignaciones s ON s.contribucion_id = c.id
LEFT JOIN alertas al ON al.id = s.alerta_id
GROUP BY z.ubigeo;

-- Ranking (materializada, refresco cada 5 min). Contratos, no soles.
CREATE MATERIALIZED VIEW ranking_impacto AS
SELECT f.id, f.tipo, COALESCE(f.nombre_publico, 'Anónimo') AS nombre, f.slug, f.logo_url,
       SUM(c.contratos)                                   AS contratos_financiados,
       COUNT(DISTINCT c.ubigeo)                           AS zonas,
       COUNT(s.alerta_id)                                 AS senales_halladas,
       MIN(c.pagada_at)                                   AS desde,
       date_trunc('month', c.pagada_at)                   AS mes
FROM financiadores f
JOIN contribuciones c ON c.financiador_id = f.id AND c.estado IN ('pagada','en_proceso','procesada')
LEFT JOIN asignaciones s ON s.contribucion_id = c.id
WHERE f.visible
GROUP BY f.id, date_trunc('month', c.pagada_at);
```

Índices: `contribuciones(ubigeo, estado)`, `asignaciones(contribucion_id)`,
`entidades(ubigeo)` (ya debería existir). Las vistas materializadas se refrescan
con un `pg_cron` o desde el worker.

### 4.1 Cómo se calcula "contratos pendientes"

`cola_auditoria` = convocatorias ingresadas − ya analizadas − ya asignadas. Hoy la
ingesta es por demanda (el usuario pega un código). Para que el mapa tenga
colas reales hay que correr `backend/scrapers/oece_ocds --region <X>` a diario
(§8, fase 0). Sin eso, el mapa muestra "sin datos" en casi todo el país — lo cual
es honesto, pero vacío.

### 4.2 Asignación (worker)

Cada 5 min: para cada contribución `pagada` con contratos sin asignar, toma de
`cola_auditoria` de esa zona los N más antiguos (FIFO por `fecha_convocatoria`) →
inserta `asignaciones` → contribución pasa a `en_proceso` → encola en el
orquestador con `contribucion_id`. Cuando el análisis persiste su alerta, el
worker completa `procesada_at`, `alerta_id`, `costo_real_pen`. Si la cola de la
zona se vacía antes de agotar la contribución, el sobrante **espera** a que
lleguen contratos nuevos (no se redirige a otra zona sin avisar al financiador).

### 4.3 Precio

Costo real medido: ≈ S/ 1.00 / contrato (Gemini + Document AI + Search).
Costo fijo actual: ≈ S/ 533/mes (Cloud Run + SQL + APIs). Precio público
propuesto: **S/ 3 por contrato (US$ 1)** — el ejemplo del brief (500 contratos =
US$ 500) sale exacto. Desglose que se muestra en `/financiar/estado`: S/ 1
procesamiento · S/ 1 infraestructura y datos · S/ 1 reserva para contratos
pesados (expedientes de 300 páginas cuestan 4×). Tarifa versionada en `tarifas`.

---

## 5. API (Hono) — endpoints nuevos

| Método | Ruta | Auth | Devuelve |
|---|---|---|---|
| GET | `/financiamiento/zonas?nivel=departamento&padre=15` | — | `zona_estado` para el mapa |
| GET | `/financiamiento/zonas/:ubigeo` | — | detalle: cola, financiado, procesado, top aliados, señales |
| GET | `/financiamiento/ranking?periodo=mes\|anio\|todo&region=` | — | `ranking_impacto` |
| GET | `/financiamiento/estado` | — | métricas globales + costo real del mes |
| GET | `/financiamiento/impacto/:codigo` | — | comprobante público (sin email) |
| GET | `/financiamiento/aliados/:slug` | — | perfil público |
| POST | `/contribuciones` | Firebase | crea `pendiente_pago`, devuelve `codigo` + URL de pago |
| POST | `/contribuciones/:codigo/comprobante` | Firebase | sube foto de transferencia (GCS, ya existe `/upload`) |
| POST | `/contribuciones/webhook/:pasarela` | firma HMAC | confirma pago → `pagada` |
| POST | `/admin/contribuciones/:codigo/validar` | admin | validación manual (fase 0) |

El frontend consume todo por `lib/api-client.ts` como hoy. Cache: `zona_estado`
y ranking con `Cache-Control: s-maxage=300`.

---

## 6. Reglas de independencia (se codifican, no se prometen)

1. **Sin selección**: la asignación es FIFO por zona en código. Ninguna API acepta
   un `ocid` del financiador.
2. **Sin edición**: el pipeline no lee `contribuciones`. Solo escribe `contribucion_id`
   en la corrida. Los prompts de los agentes no reciben quién financió.
3. **Conflicto de interés automático**: al registrar una empresa (RUC) se cruza
   con `osce_sancionados`, `postores`, `alertas`. Si aparece como proveedor en
   alertas activas de la zona que quiere financiar, o tiene sanción vigente:
   el aporte se acepta (el dinero procesa contratos igual) pero
   `financiadores.visible = FALSE` con motivo. Nunca sale en ranking ni muro.
   Se le informa por email, sin drama: "para preservar la independencia…".
4. **Publicación incondicional**: si el análisis de un contrato financiado por X
   detecta a X, se publica igual. El comprobante de impacto lo muestra.
5. **Sin exclusividad**: dos financiadores pueden apoyar la misma zona; el
   reconocimiento es aditivo.
6. **Trazabilidad pública**: cada comprobante enlaza a los dossiers y a la traza
   de Arize (`phoenix_trace_id`) de cada contrato procesado.
7. **Devolución**: si una zona no recibe contratos nuevos en 90 días y la
   contribución sigue sin agotar, se ofrece redirigir a otra zona o reembolsar.

---

## 7. Pasarela de pagos — qué conviene sin entidad legal

Restricción real: hoy Vigía es una **persona natural**. Eso cierra Niubiz y la
facturación electrónica de empresa, y abre la pregunta fiscal (§7.4).

### 7.1 Opciones evaluadas

| Opción | Persona natural | Empresas (B2B) | Ciudadanos (Yape/tarjeta) | Comisión aprox. | Webhook | Veredicto |
|---|---|---|---|---|---|---|
| **Transferencia + Yape/Plin QR con validación manual** | ✅ | ✅ (transferencia interbancaria) | ✅ | 0 % | no (admin valida foto) | **Fase 0** — funciona mañana, escala mal |
| **Mercado Pago Perú — Checkout Pro** | ✅ con DNI + cuenta bancaria | tarjeta corporativa, PagoEfectivo | tarjeta, PagoEfectivo (verificar si Yape está habilitado en tu cuenta) | ~3.99 % + IGV | ✅ IPN | **Fase 1** — el más rápido de integrar como persona natural |
| **Culqi** | ✅ (RUC 10 / persona natural con negocio) | tarjeta | tarjeta, Yape, PagoEfectivo | ~3.44 % + S/ 0.30 + IGV | ✅ | Fase 1 alternativa — mejor cobertura Yape; onboarding pide más documentos |
| **Izipay (Link de pago)** | RUC 10 | tarjeta | tarjeta, Yape | ~3.5 % | parcial | similar a Culqi |
| **Niubiz** | ❌ (empresa) | ✅ | ✅ | ~3.5 % | ✅ | cuando exista la asociación |
| **PayPal / Stripe (cuenta extranjera)** | complicado | ✅ empresas extranjeras | tarjeta internacional | ~4.4 % | ✅ | solo para ONGs/fundaciones fuera del Perú |
| **Open Collective / GitHub Sponsors** | ✅ (fiscal host) | ✅ con factura del fiscal host | tarjeta | 10 % + pasarela | ✅ | **Fase 2** — resuelve lo legal para aportes internacionales (open source) |

> Las comisiones y la disponibilidad de Yape en cada pasarela cambian; verificar
> en el onboarding antes de codificar.

### 7.2 Recomendación por fases

**Fase 0 — lanzar sin pasarela (2 semanas).** Contribución → estado
`pendiente_pago` → pantalla con QR de Yape/Plin + datos de transferencia + el
`codigo` como concepto → el financiador sube foto del comprobante → un admin
valida en `/admin` → `pagada`. Todo el resto del sistema (asignación, comprobante,
ranking) funciona igual. Costo: cero. Riesgo: fricción y validación manual.
Suficiente para las primeras 50 contribuciones y para demostrar el concepto.

**Fase 1 — Mercado Pago Checkout Pro (1 semana adicional).** Botón de pago
alojado, webhook a `/contribuciones/webhook/mercadopago` con verificación de
firma, sandbox para tests. Tarjeta + PagoEfectivo para ciudadanos; tarjeta
corporativa para empresas. Se mantiene la transferencia manual para empresas
que necesitan orden de compra.

**Fase 2 — entidad legal + Culqi/Niubiz + Open Collective.** Cuando exista la
asociación civil: comprobantes de donación válidos para deducción, Yape nativo,
y Open Collective para aportes internacionales de fundaciones (Hivos, Luminate,
NED financian exactamente este tipo de proyecto).

### 7.3 Flujo técnico (fase 1)

```
POST /contribuciones {ubigeo, contratos, financiador}   → INSERT pendiente_pago
  → SDK MP: crear preference {external_reference: codigo, notification_url}
  → 302 al checkout de Mercado Pago
Mercado Pago → POST /contribuciones/webhook/mercadopago {id}
  → verificar firma x-signature (HMAC con el secret del webhook)
  → GET /v1/payments/{id} → status = approved?
  → UPDATE contribuciones SET estado='pagada', pasarela_ref=id, pagada_at=now()
  → email con link al comprobante de impacto
Worker (cada 5 min) → asigna FIFO → encola análisis → actualiza asignaciones
```

Idempotencia: el webhook puede llegar varias veces → `UPDATE … WHERE estado='pendiente_pago'`.
Nunca confiar en el `status` que viene en el webhook; siempre consultar el pago.

### 7.4 Lo legal que hay que resolver (no es opcional)

- **Naturaleza del aporte**: para una persona natural, recibir dinero por
  "capacidad de procesamiento" es un **servicio**, no una donación → renta de
  cuarta categoría + recibo por honorarios electrónico (SUNAT) por cada aporte,
  o inscripción en RUS/RER. Una **asociación civil sin fines de lucro** convierte
  esto en donación y habilita recibos de donación. Esto es lo que más apura.
- **Lavado**: aportes > S/ 3 500 (umbral referencial UIF para operaciones
  inusuales) → pedir RUC/DNI y origen declarado. Cruzar con `peps` cuando exista.
- **Datos personales (Ley 29733)**: email y nombre del financiador = datos
  personales → política de privacidad, consentimiento explícito, banner de
  visibilidad ("tu nombre aparecerá en el ranking: sí / no").
- **Publicidad**: el badge y el muro son reconocimiento, no publicidad pagada;
  el copy debe evitar "patrocinado por". Regla #5 del proyecto (no monetizar con
  publicidad) se mantiene porque lo que se financia es cómputo, no visibilidad.

---

## 8. Plan de implementación

| Fase | Entregable | Esfuerzo | Depende de |
|---|---|---|---|
| **0. Cola real** | `oece_ocds` diario para 3 regiones piloto (Lima, Áncash, Cusco) · tabla `zonas` cargada del INEI · geometría distrital en el frontend | 3 días | scrapers (listo) |
| **1. Modelo + API lectura** | `09_financiamiento.sql` · vistas · `/financiamiento/*` · tests de las vistas con datos seed | 3 días | fase 0 |
| **2. Mapa de campaña** | `/financiar` con `PeruChoropleth mode="financiamiento"`, drill-down, panel lateral, página de zona | 5 días | fase 1 |
| **3. Contribución fase 0** | formulario, identidad (empresa/persona/anónimo), validación RUC + conflicto, QR + comprobante manual, `/admin` de validación | 4 días | fase 1 |
| **4. Worker + trazabilidad** | asignación FIFO, `contribucion_id` en el orquestador, cierre de asignaciones al persistir la alerta | 3 días | fase 3 |
| **5. Comprobante + ranking + perfil** | `/impacto/[codigo]`, badge SVG, PDF, `/financiar/ranking`, `/aliado/[slug]`, sección en la landing | 5 días | fase 4 |
| **6. Pasarela** | Mercado Pago Checkout Pro + webhook + sandbox | 4 días | fase 3 + cuenta MP |
| **7. Estado de auditoría** | `/financiar/estado` con costo real desde Arize | 2 días | fase 4 |

≈ 6 semanas de una persona. Fases 0-2 se pueden demostrar con contribuciones
sembradas (marcadas como "demo") mientras no haya pagos reales.

### Lo que NO hacemos en la primera versión

- Suscripciones mensuales (Fase 2: "financia 100 contratos/mes").
- Metas por zona con fecha límite tipo Kickstarter (genera presión por "cerrar"
  zonas; la cola es continua).
- Elegir contratos, entidades o tipos de contrato. Nunca.
- Descuentos por volumen (rompe la igualdad del ranking).

---

## 9. Riesgos y cómo se mitigan

| Riesgo | Mitigación |
|---|---|
| Una empresa financia la zona donde compite y usa las alertas contra rivales | Regla 3 (conflicto automático) + regla 4 (publicación incondicional): las alertas ya son públicas para todos; financiar no da acceso anticipado ni exclusivo |
| Percepción de "mapa de conquista" | Vocabulario (§1), ranking por contratos y no por soles, aliados aditivos, estados que hablan de *auditoría* y no de *propiedad* |
| Cola vacía en la mayoría del país | Fase 0 con 3 regiones piloto; zonas sin datos no son financiables (se muestran como "próximamente, ayúdanos a ingresar contratos") |
| Costo real > precio (expedientes pesados) | Reserva del 33 % en la tarifa + tope de páginas por análisis (ya existe `PARSE_GLOBAL_BUDGET_S`) |
| Obligaciones fiscales como persona natural | Fase 0 con montos chicos + constituir asociación antes de la fase 6 |
