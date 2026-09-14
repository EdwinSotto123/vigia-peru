# Mapa del Dataset SEACE / OECE — Contexto Global para el Agente Anti-Corrupción

> Fuente: **Portal de Datos Abiertos del OECE** (Organismo Especializado para las
> Contrataciones Públicas Eficientes).
> URL del portal: <https://bi.seace.gob.pe/pentaho/api/repos/:public:portal:datosabiertos.html/>
> Periodo actual del dataset: **enero – abril 2026**.
> Diccionario maestro: `dataset/Diccionario.xlsx` (20 hojas, una por tabla).
>
> Artefactos generados por `map_dataset.py`:
> - `catalog.json` — catálogo completo (columnas, dtypes, muestras, conteo de filas, hoja de diccionario asociada).
> - `catalog_summary.txt` — vista plana legible.

---

## 1. Vista de pájaro: ¿qué representa cada carpeta?

El dataset modela el **ciclo de vida completo de una contratación pública peruana**.
Cada tabla cubre una fase del proceso, y todas se cosen entre sí mediante un puñado
de llaves de unión.

```
PLANIFICACIÓN         CONVOCATORIA          OFERTA               ADJUDICACIÓN        EJECUCIÓN              POSTCONTROL
─────────────         ────────────          ──────               ─────────────       ──────────              ──────────
plan_anual_         → datos_de_la_       →  listdo_de_       →  datos_de_         → contratos             → arbitraje
contratacion          convocatoria           ofertantes           adjudicacion        ordenes_compra_
                      miembros_comite        proveedores_y_       contratacion_       y_servicio
                      nulos                  consorcios           directa
                      procesos_desiertos
                                            ┌──── DATOS COMPLEMENTARIOS (referencias maestras) ────┐
                                            │  entidades_contratantes   sanciones   sican_certificados │
                                            │  rnp_proveedores          pronunciamientos   opiniones_normativas │
                                            └─────────────────────────────────────────────────────────┘
```

---

## 2. Tabla por tabla (con campos clave para detectar irregularidades)

### 2.1. `plan_anual_contratacion/CONOSCE_PAC2026_0.xlsx` (~66 289 filas)
> *Nota oficial:* "Contiene información de lo que cada entidad ha programado en su Plan
> Anual de Contrataciones (PAC)."

**Para qué sirve al agente.** Saber **qué pensaba comprar** la entidad y por cuánto.
Es la línea base contra la que se contrastan la convocatoria y la adjudicación.

| Campo clave | Descripción | Uso analítico |
|---|---|---|
| `codigoentidad`, `ruc_entidad`, `entidad` | Identifica a la entidad contratante | Join con `entidades_contratantes` |
| `n_referencia` | Correlativo del proceso dentro del PAC | Trazabilidad |
| `descripcion_proceso`, `objetocontractual`, `descripcion_item` | Qué se piensa comprar | Coincidencia semántica con la convocatoria |
| `cantidad`, `unidad_medida` | Volumen previsto | Comparación con lo finalmente adjudicado |
| `mes_previsto`, `fecha_publicacion` | Cuándo se planificó | Bandera si la convocatoria ocurre fuera del mes previsto sin justificación |

---

### 2.2. `datos_de_la_convocatoria/CONOSCE_CONVOCATORIAS2026_0.xlsx` (~14 688 filas)
> *Nota oficial:* "Contiene la información de la convocatoria o invitación, correspondiente a los procedimientos adjudicados."

**Para qué sirve al agente.** Es el documento de **"lo que el Estado pide"**: bases,
monto referencial, tipo de proceso, fechas, requisitos geográficos. Punto de entrada
natural para el análisis.

| Campo clave | Descripción |
|---|---|
| `codigoconvocatoria` | **Llave maestra** del proceso. Atraviesa casi todas las tablas. |
| `tipoprocesoseleccion`, `proceso`, `tipocompra` | Licitación pública, concurso, AMC, etc. |
| `montoreferencial`, `monto_referencial_item` | Tope del valor del bien/servicio |
| `objetocontractual` | Bien / Servicio / Obra / Consultoría |
| `fecha_convocatoria`, `fechaintegracionbases`, `fechapresentacionpropuesta` | Plazos legales — los plazos muy cortos son un indicio clásico de direccionamiento |

---

### 2.3. `miembros_comite/CONOSCE_MIEMBROCOMITE2026_0.xlsx` (~14 064 filas)
> *Nota oficial:* "Datos de Miembros del Comité."

**Para qué sirve al agente.** Saber **quién decidió** en cada convocatoria. Solo dos
campos: `codigoconvocatoria` y `miembrocomite` (texto con el nombre). Útil para:

- Detectar miembros recurrentes en convocatorias del mismo proveedor ganador.
- Cruzar nombres (vía búsqueda externa) con SICAN para validar que tengan certificación vigente.
- Buscar coincidencias con `inhabilitaciones_judiciales` o socios del proveedor.

---

### 2.4. `nulos/CONOSCE_NULOS2026_0.xlsx` (~1 141 filas) y `procesos_desiertos/CONOSCE_DESIERTOS2026_0.xlsx` (~2 802 filas)
> Procesos declarados nulos o desiertos. Mismas columnas que la convocatoria.

**Para qué sirve al agente.** Una entidad con tasa anormalmente alta de nulidades o
desiertos sobre un mismo objeto puede estar **reciclando bases para favorecer a un postor**.

---

### 2.5. `listdo_de_ofertantes/CONOSCE_POSTOR2026_0.xlsx` (~42 987 filas)
> *Nota oficial:* "Listado de personas naturales y jurídicas que presentaron ofertas desde el año 2018."

**Para qué sirve al agente.** **Quiénes participaron**. Compararlo con la adjudicación
permite ver si hubo un único postor, postores recurrentes, o postores que son socios entre sí.

| Campo | Descripción |
|---|---|
| `codigo_convocatoria` | Join con convocatoria/adjudicación |
| `ruc_codigo_postor`, `postor` | Quién ofertó |
| `n_item`, `fecha_presentacion_propuesta` | Detalle por ítem |

---

### 2.6. `datos_de_adjudicacion/CONOSCE_ADJUDICACIONES2026_0.xlsx` (~14 722 filas)
> *Nota oficial:* "Resultados del proceso: datos del proveedor adjudicado, valor adjudicado, cantidad, entre otros."

**Para qué sirve al agente.** El **resultado**: quién ganó, por cuánto y cuánto pidió la entidad.
Cruzar `monto_referencial_item_soles` vs `monto_adjudicado_item_soles` da el porcentaje
de oferta — adjudicaciones que rozan el 100 % del valor referencial sin competencia
son una señal clásica de direccionamiento.

| Campo | Descripción |
|---|---|
| `codigoconvocatoria` | Llave de proceso |
| `ruc_proveedor`, `proveedor`, `tipo_proveedor` | Quién ganó (persona natural / jurídica / consorcio) |
| `monto_referencial_item_soles`, `monto_adjudicado_item_soles` | **Ratio adjudicado/referencial** = indicador de competencia |
| `fecha_buenapro`, `fecha_consentimiento_bp` | Plazos hasta la firma |

---

### 2.7. `contratacion_directa/CONOSCE_ADJUDICACIONES_CD2026_0.xlsx` (~1 339 filas)
> Igual estructura que adjudicación, **pero por contratación directa** (sin licitación). Trae
> el campo extra `causal`. Toda contratación directa requiere justificación legal (emergencia,
> exclusividad, etc.) — el agente debe verificar que la causal exista y sea coherente con el objeto.

---

### 2.8. `proveedores_y_consorcios/`
Dos archivos relacionados:

- `CONOSCE_PROVEEDORES2026_0.xlsx` (~14 921 filas): `RUC PROVEEDOR`, `proveedor`, ubicación, fechas de vigencia.
- `CONOSCE_CONSORCIO2026_0.xlsx` (~5 081 filas): para cada `ruc_consorcio`, lista a sus `ruc_miembro`.

**Para qué sirve al agente.** Cuando el ganador es un consorcio, expandir a sus miembros y
cruzar **cada uno** contra sanciones / socios / inhabilitaciones. Es habitual que un sancionado
se "esconda" como miembro de un consorcio.

---

### 2.9. `contratos/CONOSCE_CONTRATOS2026_0.xlsx` (~9 628 filas)
> *Nota oficial:* "Información de los contratos registrados por las entidades..."

**Para qué sirve al agente.** El contrato es la **materialización** legal del proceso.
Aquí aparecen las **adendas** (`monto_adicional`, `monto_reduccion`, `monto_prorroga`,
`monto_complementario`). Una adenda que infla el contrato más allá del 25 % del valor
original es un *red flag* clásico (incumple art. 34 del TUO de la Ley 30225).

| Campo | Descripción |
|---|---|
| `codigoconvocatoria`, `n_cod_contrato`, `codigo_contrato` | Trazabilidad |
| `ruc_contratista`, `ruc_destinatario_pago` | ¡Si difieren, revisar! |
| `monto_contratado_total`, `monto_contratado_item`, `monto_adicional`, `monto_reduccion`, `monto_prorroga`, `monto_complementario` | Math anti-corrupción |
| `fecha_suscripcion_contrato`, `fecha_vigencia_inicial`, `fecha_vigencia_final`, `fecha_vigencia_fin_actualizada` | Detectar prórrogas sucesivas |
| `urlcontrato` | PDF del contrato (extraer texto para análisis legal) |

---

### 2.10. `ordenes_compra_y_servicio/` (4 archivos mensuales, ~1.2 M filas combinadas)
> Órdenes de compra y servicios bajo el régimen simplificado (montos menores).

**Para qué sirve al agente.** Detectar **fraccionamiento**: una entidad parte una compra
grande en muchas órdenes pequeñas para esquivar el umbral de licitación. Patrón típico:
mismo `ruc_entidad` + mismo `ruc_contratista` + mismo `objetocontractual` + varias órdenes
en pocos días cuya suma supera el umbral del proceso de selección que correspondería.

---

### 2.11. `arbitraje/CONOSCE_ARBITRAJE2026_0 (1).xlsx`
> Procesos de arbitraje sobre contratos ya firmados.

**Para qué sirve al agente.** Un proveedor con historial de arbitrajes (especialmente
si los pierde sistemáticamente) o un árbitro que aparece repetido para el mismo contratista
señalan **conflicto de interés** o conducta dolosa.

Campos clave: `rucarbitroentidad`, `rucarbitrocontratista`, `nombrepresidente`, `fecha_emision_laudo`.

---

### 2.12. Datos complementarios (referencias maestras)

| Archivo | Contenido | Para qué sirve al agente |
|---|---|---|
| `entidades_contratantes/entidades_contratantes.csv` (~3 359) | Catálogo oficial de entidades públicas: RUC, departamento, SIAF, estado | Enriquecer cualquier `codigoentidad` o `ruc_entidad` con su ubicación / estado |
| `rnp_proveedores/conformacion_juridica.csv` (~1.44 M) | **Socios, representantes legales y miembros de órganos de administración** de cada proveedor RNP | El núcleo de la red de personas: cruzar accionistas con sanciones, con miembros de comité, con árbitros |
| `sanciones/sancionados.csv` (~9 354) | Proveedores con **inhabilitación vigente** dictada por el Tribunal de Contrataciones (motivo, periodo) | El RUC en `ruc_proveedor` / `ruc_contratista` / `ruc_miembro` **no debe** aparecer aquí. Si aparece → ilegal. |
| `sanciones/penalidades.csv` (~13 001) | Contratos con **penalidades** aplicadas, monto y motivo | Historial de mal desempeño |
| `sanciones/inhabilitaciones_judiciales.csv` (~12) | Inhabilitaciones por mandato judicial | Idem, vía Poder Judicial |
| `sican_dertificados/CONOSCE_SICANVIGENTE_0.xlsx` (~18 200) | Personas con certificación SICAN vigente | Validar miembros de comité y funcionarios |
| `PRONUNCIAMIENTOS/CONOSCE_PRONUNCIAMIENTOS2026_0.xlsx` (~290) | Pronunciamientos del OECE sobre procesos específicos (responden observaciones a bases) | Si una `codigoconvocatoria` tiene pronunciamiento → hubo controversia legal documentada |
| `opiniones_normativas/CONOSCE_INTERPRETACIONNORMATIVA_1.xlsx` (721) | Opiniones del OECE sobre la normativa de contrataciones | Base normativa de referencia para el motor legal |
| `opiniones_normativas/opiniones_normativas_clean.csv` (721) | **Copia normalizada** del xlsx anterior, generada por `map_dataset.py` | Versión recomendada para ingesta — header correcto y UTF-8 |

#### 2.12.1. Detalle ampliado: `opiniones_normativas` (¡el corpus legal del agente!)

Este archivo **no contiene contrataciones**, contiene **pronunciamientos doctrinales
del propio OECE (Dirección Técnica Normativa, DTN)** que interpretan la ley y el
reglamento de contrataciones. Es la **jurisprudencia administrativa** que define
cómo se aplica cada artículo. Para un agente que verifica legalidad, es el
**material de referencia más valioso del dataset**.

**Composición real (721 opiniones):**

- **Por régimen normativo:**
  - `Ley 30225 - DL 1444` → 613 opiniones (TUO antiguo + sus modificatorias DL 1444)
  - `Ley 30225` → 44 (TUO original sin DL 1444)
  - `Ley 32069` → 34 (**nueva** Ley de Contrataciones, vigente desde 2025)
  - `DL 1017` → 30 (régimen aún más antiguo)
- **Por año de emisión:** 2022 (154) · 2023 (296) · 2024 (144) · 2025 (127).

**Qué contiene cada fila:**

| Campo | Significado |
|---|---|
| `AÑO_OPINION` | Año en que el OECE emitió la opinión |
| `NORMA` | Régimen al que aplica (importante: la opinión sobre `Ley 30225` puede estar **superada** por una nueva sobre `Ley 32069`) |
| `NUM_OPINION` | Identificador, p.ej. `D37-2025`, `D08-2025` |
| `Artículos de la Ley` / `Numeral` / `Literal` | Artículo, numeral y literal de **la Ley** al que interpreta (puede estar vacío si la opinión es sobre el Reglamento) |
| `Artículos del Reglamento` | Artículo del Reglamento al que interpreta |
| `INTERPRETACIÓN` | **Texto completo del criterio** del OECE (varios párrafos por celda) |
| `LINK_DOCUMENTO` | URL a la ficha oficial en `gob.pe` con el **PDF firmado**, antecedentes y consultas que originaron la opinión |

Ejemplo real (`D37-2025`, sobre el art. 64 del Reglamento de la Ley 30225):
> *"En el marco de lo dispuesto por la normativa de contrataciones públicas
> [...], si bien se ha previsto normativamente que el inicio de la verificación
> posterior respecto del contenido de la oferta ganadora es a partir del
> consentimiento de la buena pro, a fin de velar por la eficiencia e integridad
> de las contrataciones que lleve a cabo, la Entidad, en una decisión de
> gestión, podría antes de producido dicho consentimiento iniciar las actividades
> que considere que permite asegurar la verificación correspondiente."*
> URL: <https://www.gob.pe/institucion/oece/informes-publicaciones/7217387-opinion-n-d000037-2025-oece-dtn>

**Para qué le sirve al agente — 5 usos concretos:**

1. **Fundamentar cada bandera roja con doctrina oficial.**
   Cuando el motor de reglas detecta, p.ej., una adenda > 25 %, el agente puede
   buscar `Artículos del Reglamento == "34"` (o el que corresponda) y **citar
   la opinión específica** del OECE en el dictamen. Pasa de *"presunta irregularidad"*
   a *"contradice la opinión D008-2025 del OECE sobre el art. 34, ver PDF"*.

2. **Corpus de RAG / búsqueda semántica.**
   Vectorizar el campo `INTERPRETACIÓN` y consultarlo con la pregunta legal
   del caso. Devuelve las 3-5 opiniones más relevantes con su URL.

3. **Índice por artículo (legal_index).**
   Pre-construir un dict `{(norma, articulo): [opiniones]}` para responder
   en O(1) *"¿qué dice el OECE sobre el art. X de Y?"*.

4. **Control de vigencia normativa.**
   Como en 2025 Perú migró a la **Ley 32069**, una opinión que cita la
   Ley 30225 puede ya no ser aplicable. El agente debe filtrar por `NORMA`
   y, ante conflicto, **preferir la opinión más reciente sobre la norma vigente**
   en la fecha del contrato analizado.

5. **Enriquecimiento por scraping del PDF.**
   El campo `LINK_DOCUMENTO` apunta a la ficha en `gob.pe`. El PDF contiene
   además los **antecedentes** (la consulta original de la entidad pública o
   empresa) y la **base legal completa** — útil cuando la fila comprime mucho
   contenido. Implementación: un tool `fetch_opinion_pdf(num_opinion)` que
   resuelva la URL, descargue el PDF y devuelva texto extraído (cachear local).

**Patrón de uso en el flujo de la sección 4:**
- Fase 2 (verificación legal) consulta el índice por artículo para anclar cada regla a doctrina OECE.
- Fase 5 (razonamiento legal) recibe, además del expediente, las 3-5 opiniones más relevantes recuperadas vía RAG.

> ✅ **Caveat de parsing resuelto.** El xlsx original viene con la fila 0 vacía y
> los nombres de columna en la fila 1. El script `map_dataset.py` lo lee con
> `header=1` y escribe junto a él `opiniones_normativas_clean.csv` listo para usar.

---

## 3. Llaves de unión (el mapa relacional)

Estas son las uniones que el agente debe explotar:

| Llave | Tablas conectadas | Uso |
|---|---|---|
| `codigoconvocatoria` | Convocatoria, Adjudicación, Contratación Directa, Contratos, Postores, Miembros de Comité, Nulos, Desiertos, Pronunciamientos, Arbitraje | Reconstruir el **ciclo completo** de un proceso |
| `codigoentidad` / `ruc_entidad` | PAC, Convocatoria, Adjudicación, Contratos, Órdenes, Nulos, Desiertos, Pronunciamientos ↔ `entidades_contratantes` | Quién compra |
| `ruc_proveedor` / `ruc_contratista` / `ruc_postor` / `ruc_consorcio` / `ruc_miembro` | Adjudicación, Contratos, Postores, Consorcios, Órdenes, Penalidades, Sancionados, Conformación Jurídica | Quién vende y su perfil |
| `numero_documento` / `RUC_DNI` (DNI o RUC) | Conformación Jurídica, Inhabilitaciones Judiciales, SICAN, miembros de comité | **Personas naturales** — accionistas, representantes, funcionarios |
| `n_item` + `codigoconvocatoria` | Cualquier tabla con detalle de ítems | Agregación a nivel ítem |

> Tip: el join socio↔sanción se hace por `conformacion_juridica.NUMERO_DOCUMENTO` vs
> `sancionados.RUC` (cuando el socio es persona jurídica) o vs `sancionados.RUC` con
> normalización de DNI.

---

## 4. Flujo del Agente Anti-Corrupción (propuesta)

El objetivo es: **dada una `codigoconvocatoria` (o un universo de ellas), producir un
informe con bandera de riesgo, fundamentos legales y enlaces a la evidencia.**

### Fase 0 — Ingesta y normalización
1. Ejecutar `map_dataset.py` (ya hecho) para tener `catalog.json`.
2. Cargar cada tabla en un esquema relacional (SQLite/DuckDB recomendado para volumen).
3. Normalizar RUC (11 dígitos), DNI (8 dígitos), y nombres (mayúsculas, sin tildes).
4. Indexar `codigoconvocatoria` y todas las columnas RUC.

### Fase 1 — Reconstrucción del expediente
Para cada `codigoconvocatoria`:
1. **¿Qué se pidió?** → `datos_de_la_convocatoria` (+ `plan_anual_contratacion` por
   coincidencia de `ruc_entidad` + descripción).
2. **¿Quiénes decidieron?** → `miembros_comite`.
3. **¿Quién ofertó?** → `listdo_de_ofertantes`.
4. **¿Quién ganó?** → `datos_de_adjudicacion` (o `contratacion_directa` con su `causal`).
5. **¿Cómo se ejecutó?** → `contratos` (montos, adendas) + `ordenes_compra_y_servicio` cuando aplique.
6. **¿Hubo controversia?** → `nulos`, `procesos_desiertos`, `pronunciamientos`, `arbitraje`.

### Fase 2 — Verificación legal automática
Reglas duras que generan banderas rojas inmediatas:

| Regla | Tablas | Norma asociada |
|---|---|---|
| El ganador (RUC) **está sancionado** a la fecha de buena pro | `adjudicacion` × `sanciones/sancionados` | Art. 50 TUO Ley 30225 |
| El ganador tiene **inhabilitación judicial vigente** | `adjudicacion` × `inhabilitaciones_judiciales` | Idem |
| **Adenda > 25 %** del monto original (`monto_adicional / monto_contratado_item`) | `contratos` | Art. 34 TUO Ley 30225 |
| **Plazo entre convocatoria y presentación** menor al mínimo legal según `tipoprocesoseleccion` | `datos_de_la_convocatoria` | Reglamento Ley 30225 |
| **Contratación directa sin causal válida** o causal no listada | `contratacion_directa.causal` | Art. 27 TUO Ley 30225 |
| El **único postor** ganó al ≥ 95 % del valor referencial | `listdo_de_ofertantes` + `datos_de_adjudicacion` | Heurística de competencia |
| Miembro de comité **sin certificación SICAN vigente** | `miembros_comite` × `sican_dertificados` | Art. 8 Reglamento |
| **Fraccionamiento**: sumatoria de órdenes mismo proveedor/entidad/objeto en ≤30 días excede umbral | `ordenes_compra_y_servicio` | Art. 20 Reglamento |

### Fase 3 — Análisis de red (conflicto de interés)
1. Para el `ruc_proveedor` adjudicado, expandir:
   - Socios y representantes (`conformacion_juridica`).
   - Si es consorcio, miembros (`CONOSCE_CONSORCIO`).
2. Para cada **persona natural** obtenida (DNI), cruzar contra:
   - `miembros_comite` (¿es el mismo que evaluó?).
   - `inhabilitaciones_judiciales`.
   - `sancionados` (vía empresas donde figure como socio).
   - Árbitros (`rucarbitroentidad/contratista`).
3. Para el `ruc_proveedor`, listar **historial**:
   - Penalidades pasadas.
   - Arbitrajes ganados/perdidos.
   - Otros contratos con la **misma entidad** (concentración cliente).

### Fase 4 — Enriquecimiento externo (web)
Para cada socio/representante/miembro identificado, lanzar búsquedas web:
- ¿Tiene mención en SUNAT / OSCE / Procuraduría con sanción previa?
- ¿Aparece en reportajes de medios (Ojo Público, IDL-Reporteros, Convoca)?
- ¿Es servidor público activo en otra entidad? (Portal de Transparencia / Servir).
- ¿Está mencionado en sentencias de Poder Judicial?

> **Implementación sugerida:** un *tool* `search_person(nombre, dni)` y otro
> `search_company(razon_social, ruc)` consumidos por el agente con
> `WebSearch` + `WebFetch`, con dedupe por entidad y un *prompt* que pida fuentes con cita.

### Fase 5 — Razonamiento legal (LLM)
Con el expediente reconstruido + banderas duras + hallazgos web, un LLM produce el dictamen:
- Resumen ejecutivo.
- Lista de incumplimientos legales con artículo citado.
- Indicios de corrupción (con grado de confianza).
- Recomendación de acción (denuncia ante Contraloría, OECE, Fiscalía).

Sugerencia técnica: usar **ADK** (Google Agent Development Kit, ya tienes la skill suite
instalada) con sub-agentes especializados: `compliance_agent`, `network_agent`,
`web_research_agent`, `report_agent`, orquestados por un `coordinator`.

---

## 5. Reglas duras codificables hoy (ejemplos SQL)

```sql
-- Ganadores con sanción vigente a la fecha de buena pro
SELECT a.codigoconvocatoria, a.proveedor, a.ruc_proveedor, s.de_motivo_infraccion,
       s.fecha_inicio, s.fecha_fin
FROM   adjudicaciones a
JOIN   sancionados   s ON a.ruc_proveedor = s.ruc
WHERE  a.fecha_buenapro BETWEEN s.fecha_inicio AND s.fecha_fin;

-- Adendas que inflan el contrato >25%
SELECT codigoconvocatoria, ruc_contratista,
       monto_contratado_item, monto_adicional,
       1.0 * monto_adicional / NULLIF(monto_contratado_item, 0) AS ratio
FROM   contratos
WHERE  monto_adicional > 0
   AND 1.0 * monto_adicional / NULLIF(monto_contratado_item, 0) > 0.25;

-- Un solo postor que ganó cerca del valor referencial
WITH conteo AS (
    SELECT codigo_convocatoria, COUNT(DISTINCT ruc_codigo_postor) AS n_postores
    FROM postores GROUP BY 1
)
SELECT a.codigoconvocatoria, a.proveedor,
       a.monto_adjudicado_item_soles / NULLIF(a.monto_referencial_item_soles, 0) AS oferta_pct
FROM adjudicaciones a
JOIN conteo c ON a.codigoconvocatoria = c.codigo_convocatoria
WHERE c.n_postores = 1
  AND a.monto_adjudicado_item_soles / NULLIF(a.monto_referencial_item_soles, 0) >= 0.95;

-- Posible fraccionamiento (órdenes pequeñas repetidas)
SELECT ruc_entidad, ruc_contratista, objetocontractual,
       MIN(fecha_de_emision) AS desde, MAX(fecha_de_emision) AS hasta,
       COUNT(*) AS n_ordenes, SUM(monto_total_orden_original) AS total
FROM ordenes_compra
GROUP BY 1,2,3
HAVING n_ordenes >= 3
   AND julianday(hasta) - julianday(desde) <= 30
   AND total > 33000;  -- umbral aprox. de subasta inversa
```

---

## 6. Próximos pasos sugeridos

1. **Cargar `catalog.json`** como contexto base del agente (ya está listo).
2. **Ingestar todas las tablas a DuckDB** (recomendado) o SQLite — DuckDB lee xlsx/csv nativamente y maneja bien los ~1.4 M filas del RNP.
3. **Implementar las reglas duras** de la sección 4 / 5 como funciones puras (tests con casos sintéticos).
4. **Construir los tools del agente** (ADK):
   - `get_proceso(codigoconvocatoria)` → expediente JSON.
   - `check_compliance(codigoconvocatoria)` → lista de banderas.
   - `expand_network(ruc)` → socios + representantes + miembros consorcio.
   - `search_person_web(nombre, doc)` / `search_company_web(razon_social, ruc)`.
   - `generate_report(expediente, banderas, hallazgos)`.
5. **Definir un dataset de evaluación** con casos conocidos (procesos públicos donde Contraloría ya dictaminó) para medir precisión del agente.

---

## 7. Anexo — Estado del catálogo

Generado automáticamente por `map_dataset.py`:

- **20 hojas** de diccionario procesadas (≈ 282 variables documentadas).
- **18 carpetas-dataset** detectadas, con **26 archivos** (xlsx + csv, incluye el
  CSV limpio de opiniones normativas que genera el propio script).
- **Volumen aproximado de filas**: ~2.5 M (de las cuales 1.44 M son `conformacion_juridica`).
- Caveats: `arbitraje` tiene archivo muy pequeño. `interpretacionnormativa` ya
  está resuelto vía `header=1` y un CSV normalizado paralelo.

> Para regenerar todo: `python map_dataset.py`.
