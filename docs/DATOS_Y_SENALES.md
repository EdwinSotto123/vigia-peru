# Vigía Perú — Inventario de datos, banderas y cruces

> **Para qué es este documento.** Es el mapa completo de QUÉ datos tiene Vigía, CÓMO se relacionan (cruces) y QUÉ
> señales/banderas produce. Está pensado para dárselo a otra IA (claude.ai) y pedirle ideas de **más valor**: cruces que
> aún no hacemos, datos subutilizados, señales nuevas. Todo lo numérico aquí sale del código y de la base en producción
> (2026-10-25); cada señal lleva su umbral real y el archivo donde vive.
>
> **Principio rector (no negociable):** Vigía NUNCA acusa. Cada señal es un **indicio para revisión humana**, construido
> cruzando datos públicos. Puede haber explicaciones legítimas. La UI lo repite y nunca muestra color sin palabra+ícono.
>
> **Privacidad:** de personas naturales no se expone DNI ni RUC; se tapa un apellido; los RUC-10 salen como referencias.
> El DNI se usa SOLO internamente para cruzar (`cruces_proveedor.persona_doc` nunca sale por la API).

Índice:
1. Resumen ejecutivo
2. Principios de severidad y puntaje
3. Arquitectura y frescura de datos
4. Catálogo de datos (las 115 tablas por dominio)
5. Las llaves de cruce (el pegamento)
6. Catálogo de señales — Dato dudoso
7. Catálogo de señales — Personas contratadas
8. Catálogo de señales — Planilla y Plazas
9. Catálogo de cruces — Empresa / Contrato
10. Catálogo de cruces — Registro SUNAT
11. Catálogo de cruces — Contratos menores (nuevo)
12. Mapa de poder / captura
13. Antecedentes (Contraloría / Procuraduría)
14. El pipeline de refresco (orden real)
15. Cómo se puntúa (contrato y empresa)
16. Privacidad y encuadre
17. Huecos y oportunidades (para analizar)
18. Discrepancias y notas técnicas
19. Glosario

---

## 1. Resumen ejecutivo

Vigía cruza **registros públicos del Estado peruano** para marcar, con transparencia, patrones que vale la pena revisar
en la contratación pública: a quién le compra el Estado, quién gana, qué vínculos políticos/familiares/societarios
existen, y dónde hay indicios de sobreprecio, fraccionamiento, captura o conflicto de interés.

Cifras de la base (prod, 2026-10-25): **~40 GB en PostgreSQL (AWS RDS), 115 tablas/vistas materializadas**, más
**~154 GB en Cloudflare R2** (PDFs de expedientes + crudos de scrapers). Lo más pesado:

- `conosce_ordenes` — **28.9 M** órdenes de compra/servicio (el libro mayor del pago directo).
- `persona_entidad` (3.2 M) y `persona_orden_anual` (5.4 M) — personas que contrata el Estado.
- `convocatorias` (827 k) — los procesos de selección (con concurso), OCDS del OECE.
- `planilla_pte` (12 M) — la planilla mensual de las entidades.
- `casos_cruce` (259 k) y `cruces_proveedor` (255 k) — el resultado de TODOS los cruces.

El sistema produce **~60 tipos de señal/cruce** agrupados en: dato dudoso, personas contratadas, planilla/plazas,
política, proceso de selección, historial del proveedor, patrón de compras, registro SUNAT, captura/poder y
antecedentes de corrupción. Cada contrato y cada empresa recibe un **puntaje** ponderado a partir de ellos.

Lo más reciente (octubre 2026): la subsección **Contratos Menores (≤8 UIT)** (fuentes prod4+prod6 del SEACE, con el
requerimiento/TDR descargable) y la **identidad SUNAT de sus proveedores** (`seace_proveedor_sunat`), con banderas de
proveedor dado de baja / no habido / recién creado.

---

## 2. Principios de severidad y puntaje

Toda señal tiene una de tres severidades, con tres canales (color + ícono + palabra), nunca color solo:

| Severidad | Etiqueta pública | Peso en el orden |
|---|---|---|
| `alta` | Grave | 10 |
| `media` | Para revisar | 3 |
| `baja` | Dato | 1 |

- **Puntaje de orden de un contrato** (`casos_cruce.puntaje`): `10×n_alta + 3×n_media + 1×n_baja`
  (`backend/db/migrations/115_atribucion_cruces.sql:339`).
- **Puntaje de una empresa** (`empresa_resumen.puntaje`, 0–100): reglas con tope por grupo (ver §15).
- **Regla de atribución (clave):** los "datos del proveedor" (que es candidato, aportó, es autoridad, le vendió a una
  campaña) **se muestran pero NO suben el riesgo del contrato** — son contexto de la empresa, no culpa del contrato
  puntual (`115_atribucion_cruces.sql:362-364`).

---

## 3. Arquitectura y frescura de datos

- **Base:** PostgreSQL en **AWS RDS** (us-east-2, privada; acceso por túnel SSM). Roles: `vigia_api` (lectura pública),
  `vigia_api_admin` (panel), `vigia_jobs` (scrapers, escritura), `vigia_agentes` (agentes IA, lectura), `vigia_ab`
  (lectura). Lo público se sirve por **Cloudflare Workers** (Hono) sobre **Hyperdrive**; el frontend es Next.js en
  Cloudflare (OpenNext). Archivos en **R2** (`vigia-peru-batch` 142 GB, `vigia-peru-crudos` 11.5 GB).
- **Scrapers:** Worker `vigia-scrapers` (Cloudflare Workflows, cron). Cada corrida es durable y troceada; idempotencia por
  sha256 en `datasets_cargas`; bitácora en `corridas_fuente`. Un relay en **Zúrich** (`vigia-relay`) pasa el WAF del
  SEACE que bloquea el egress de datacenter.

**Frescura por fuente (prod, 2026-10-25):**

| Fuente | Última | Qué carga |
|---|---|---|
| oece_ocds | hoy | convocatorias/procesos (OCDS del OECE) |
| documentos | hoy | PDFs de expedientes → R2 |
| seace_menores | hoy | contratos menores ≤8 UIT |
| conosce / conosce_ordenes | 1 día | adjudicaciones, postores, contratos, órdenes (CONOSCE) |
| pte_personal | 3 días | planilla mensual |
| onpe_gastos / onpe_claridad | 4 días | gastos y aportes de campaña |
| contraloria_informes | 4 días | informes de control (responsabilidad presunta) |
| servir_convocatorias | 4 días | plazas CAS (SERVIR) |
| mef_presupuesto | 6 días | ejecución de gasto (MEF, 20.5 M filas) |
| jne_infogob, pnda_sancionados, pnda_dji, pnda_visitas | re-corridos hoy | autoridades, inhabilitados, DJI, visitas |

---

## 4. Catálogo de datos (115 tablas por dominio)

Agrupadas por lo que representan. Filas aproximadas (reltuples) y tamaño en prod.

### 4.1 Contratación — procesos (con concurso)
| Tabla | Filas | Qué es |
|---|---|---|
| `convocatorias` | 827 k | procesos de selección (OCDS del OECE), desde 2015; `ocds_payload` jsonb completo |
| `convocatoria_busqueda` | 828 k | índice de búsqueda de convocatorias |
| `conosce_adjudicaciones` | 547 k | quién ganó cada proceso (buena pro), monto adjudicado |
| `conosce_postores` | 1.7 M | quién se presentó a competir |
| `conosce_contratos` | 712 k | el contrato firmado y sus adicionales |
| `conosce_consorcios` | 210 k | integrantes de cada consorcio ganador |
| `procesos_historicos` | 185 k | procesos antiguos (relleno histórico) |
| `contrato_estado` | 806 k | estado derivado por convocatoria (riesgo, score, lectura) |
| `contrato_dudoso` | 20 | contratos con dato imposible (referencial≤1, adj 20×) |
| `convocatoria_items` / `ofertas` / `postores` | 441 / 4.5 k / 3.3 k | ítems y ofertas (muestras) |

### 4.2 Contratación — pago directo (órdenes)
| Tabla | Filas | Qué es |
|---|---|---|
| `conosce_ordenes` | **28.9 M** | órdenes de compra y servicio (CONOSCE), 2018+; monto, proveedor, entidad, fecha |
| `ordenes_fraccionadas` | 128 k | grupos de órdenes que parecen un contrato partido (fraccionamiento) |

### 4.3 Contratación — menores ≤8 UIT (nuevo)
| Tabla | Filas | Qué es |
|---|---|---|
| `seace_menores` | 10.6 k | contratos menores (prod4 contrato + prod6 requerimiento), 2025–26 |
| `seace_proveedor_sunat` | 5.1 k | identidad SUNAT de sus proveedores (estado, giro, antigüedad) |

### 4.4 Empresas y personas que venden/contratan
| Tabla | Filas | Qué es |
|---|---|---|
| `empresa_resumen` | 236 k | ficha agregada de cada empresa (puntaje, cruces, estado SUNAT) |
| `empresas` | 250 k | datos base de empresas (domicilio, fecha de alta del RUC, estado) |
| `empresa_orden_anual` | 1.9 M | órdenes por empresa y año |
| `rnp_conformacion_juridica` | 1.4 M | socios/representantes/directivos (RNP) con su documento |
| `persona_entidad` | 3.2 M | persona ↔ entidad que la contrató |
| `persona_orden_anual` | 5.4 M | órdenes de cada persona por año |
| `persona_codigo` / `planilla_codigo` | 2.0 M / 640 k | códigos opacos de persona (privacidad) |
| `persona_senal` | 300 k | señales calculadas por persona |
| `persona_resumen` / `persona_flags` | 3.5 k / 9.2 k | resumen y banderas por persona |
| `empresa_visita` / `empresa_personas` | 19 k / 0 | visitas y personas de empresa |

### 4.5 Planilla y plazas (empleo público)
| Tabla | Filas | Qué es |
|---|---|---|
| `planilla_pte` | 12 M | planilla mensual por persona (Portal de Transparencia) |
| `planilla_persona` | 640 k | persona de planilla (consolidado) |
| `planilla_resumen` | 853 | resumen por entidad |
| `cargo_referencia` | 88 k | mediana de sueldo por cargo/entidad/mes (para `brecha_cargo`) |
| `servicio_referencia` | 339 k | mediana de pago por servicio/entidad (para `pago_alto`) |
| `servir_convocatoria` | 4.1 k | plazas CAS (SERVIR / Talento Perú) |
| `pte_directorio` / `pte_entidad` | 2.3 k / 3.1 k | directorio de entidades en el PTE |

### 4.6 Política y elecciones
| Tabla | Filas | Qué es |
|---|---|---|
| `jne_candidaturas` | 319 k | candidaturas (JNE / InfoGob) |
| `jne_autoridades` | 13 k | autoridades electas con mandato |
| `onpe_candidatos` | 40 k | candidatos (ONPE) |
| `onpe_aportantes` | 75 k | aportantes a campañas (ONPE Claridad) |
| `onpe_gastos_proveedores` | 181 k | a quién le compró cada campaña (gastos) |
| `gobierno_periodo` | 5.6 k | quién gobierna cada región/provincia/distrito por período |
| `entidad_gobierno_amplia` | 2.5 k | entidad → nivel de gobierno/ubigeo |
| `peps` | 38 k | personas expuestas políticamente (PEP) |

### 4.7 Poder / captura / grafo del Estado
| Tabla | Filas | Qué es |
|---|---|---|
| `poder_entidad` | 2.4 k | captura por entidad (partido que gobierna × contratos con cruce) |
| `poder_partido` | 103 | captura por partido |
| `grafo_nodos` / `grafo_aristas` | 4.8 k / 7.3 k | grafo institucional (quién designa/firma), snapshot |
| `partido_proceso` | 382 k | procesos ligados a cada partido gobernante |
| `partido_resumen_*` | varios | resúmenes de contratación por partido (gobierno/mes/objeto/historia) |
| `contrato_partido_tabla` / `_idx` | 495 k | contrato ↔ partido que gobernaba la entidad |

### 4.8 Presupuesto (MEF)
| Tabla | Filas | Qué es |
|---|---|---|
| `mef_ejecutora_gasto` | 548 k | gasto por unidad ejecutora (partida/función/proyecto) |
| `mef_ejecutora_anual` | 5.8 k | gasto anual por ejecutora |
| `mef_entity_budget` / `mef_region_budget` | 2 k / 25 | presupuesto por entidad / región |
| `mef_departamento_desglose` | 7.9 k | desglose por departamento |

### 4.9 Integridad / corrupción / sanciones
| Tabla | Filas | Qué es |
|---|---|---|
| `osce_sancionados` | 20 k | inhabilitados/sancionados del Tribunal de Contrataciones |
| `penalidades` | 12 k | penalidades aplicadas a contratistas |
| `informes_control` | 14 k | informes de control de la Contraloría (responsabilidad PRESUNTA) |
| `procuraduria_casos_sede` | — | boletín de la Procuraduría (sentencias, reparación civil) |
| `dji_funcionarios` / `dji_empleos` | 1.8 M / 2.7 M | declaraciones juradas de intereses (patrimonio/empleos) |
| `visitas_entidades` | 82 k | visitas a entidades (registro de visitas) |
| `opiniones_oece` / `opiniones_oece_estructurado` | 0 / 721 | opiniones del OECE |

### 4.10 Precios (sobreprecio)
| Tabla | Filas | Qué es |
|---|---|---|
| `precio_item` | 953 k | precio unitario por ítem (bienes), OCDS × CONOSCE |
| `precio_referencia` | 27 k | mediana/p25/p75 de precio por CUBSO+unidad+año |
| `servicio_referencia` | 339 k | (ver 4.5) mediana por servicio |

### 4.11 Cruces y alertas (resultado)
| Tabla | Filas | Qué es |
|---|---|---|
| `cruces_proveedor` | 255 k | una fila por cada cruce detectado (tipo, severidad, evidencia) |
| `casos_cruce` | 259 k | por (ocid, ruc): tipos, severidad, puntaje, texto |
| `casos_cruce_totales` | 1 | conteo global |
| `alertas` / `banderas` / `banderas_reclasificadas` | 386 / 896 / 128 | alertas de IA por contrato + banderas revisadas |
| `bandera_revision` / `contrato_dudoso` | 0 / 20 | cola de revisión + datos imposibles |

### 4.12 Documentos e ingesta
| Tabla | Filas | Qué es |
|---|---|---|
| `documentos` / `documentos_gcs` | 2.1 k / 23 k | metadatos de documentos de expedientes |
| `documentos_texto` | 1.8 k | texto OCR por documento (una vez por sha256) |
| `datasets_cargas` / `corridas_fuente` | 13.6 k / 254 | bitácora de cargas y corridas |
| `lotes_ingesta` / `lotes_items` / `procesamientos` | 158 / 41 k / 320 | colas de procesamiento |

### 4.13 Zonas, financiamiento y plataforma
| Tabla | Filas | Qué es |
|---|---|---|
| `zonas` / `zona_estado` | 2.1 k / 2.1 k | geografía (ubigeo) y estado por zona |
| `entidades` / `entidad_stats` | 3.2 k / 3.2 k | catálogo de entidades + stats |
| `contratos_agregado` / `adjudicado_vigente` | 281 k / 111 | agregados de contratos |
| `financiadores` / `contribuciones` / `asignaciones` / `pedidos_descarga` | pocas | modelo de financiamiento (la gente paga lecturas) |
| `usuarios` / `equipo` / `admin_log` / `audit_log` / `ajustes` / `tarifas` | pocas | plataforma y administración |
| `ranking_impacto` / `derivados_*` / `reportes_indexados` | pocas | vistas derivadas y refresco |

---

## 5. Las llaves de cruce (el pegamento)

Todo el sistema se sostiene en unas pocas llaves. Entenderlas es clave para pensar cruces nuevos.

| Llave | Une | Notas / fragilidad |
|---|---|---|
| **RUC** (`^(10\|20)\d{9}$`) | empresas, proveedores, órdenes, adjudicaciones, SUNAT | RUC-20 = jurídica; RUC-10 = persona natural (dígitos 3–10 = su DNI) |
| **DNI** | personas, socios (RNP), candidatos, aportantes, autoridades, visitas, DJI | Interno; nunca sale por API. Para RUC-10 se deriva del RUC |
| **OCID / código de convocatoria** | convocatorias ↔ adjudicaciones ↔ postores ↔ contratos ↔ cruces | Llave fuerte del "mundo con concurso" |
| **entidad_ruc + ubigeo** | entidades ↔ gobierno (JNE) ↔ MEF ↔ órdenes | Gobierno por nivel: distrital=ubigeo 6, provincial=4, regional=2 |
| **nombre normalizado** (`mef_norm`) | entidad↔grafo (~78 %), partido↔partido, apellidos↔autoridad | **Empate por nombre = la mayor fuente de error**; se usa cuando no hay RUC/DNI |
| **código CM** (`CM-…`) | prod4 (contrato) ↔ prod6 (requerimiento) en menores | Exacto entre las dos fuentes del SEACE |
| **fecha** (buena pro, emisión, mandato) | casi todas las señales temporales | "antes/durante/después" define si es antecedente |

Un patrón recurrente: cuando falta llave dura, Vigía usa **apellidos poco comunes** (frecuencia ≤ 20 personas) como
cruce débil (severidad media/baja), nunca como prueba.

---

## 6. Catálogo de señales — Dato dudoso (`frontend/lib/datoDudoso.ts`)

Datos que el Estado publicó pero son imposibles o inverosímiles. **Se guardan y se muestran tal cual, pero se separan de
las sumas** (una bandera, no un acusación). Fuente que lo subió se nombra ("CONOSCE del OECE", "la entidad en su PTE").

| Clave | Qué marca | Criterio exacto |
|---|---|---|
| `igual_ruc` | el monto es el RUC | `monto = ruc_contratista::numeric` y >1M |
| `igual_numero` | el monto es el nº de orden | `monto = nro_orden::numeric` y >1M |
| `mayor_100m` | más de S/ 100 M | `monto > 100,000,000` |
| `tope_uit` | 20× su tope | orden "hasta N UIT" con `monto > 20 × N × UIT_año` |
| `persona_sin_proceso` | S/ 1 M a una persona | RUC-10, sin proceso, `monto > 1,000,000` |
| `negativo` | montos negativos (planilla) | |
| `total_no_cuadra` | total ≠ suma de partes (planilla) | |
| `mes_1m` | >S/ 1 M en un mes a una persona | |
| `sueldo_100k` | sueldo ≥ S/ 100 mil/mes | (el real máximo del Estado < S/ 40 mil) |
| `referencial_simbolico` | valor referencial ≤ S/ 1 | (en empresas: `ref≤1 AND adj>100k`) |
| `adjudicado_20x` | adjudicado ≥ 20× el referencial | (`ref>1 AND adj≥20×ref AND adj>1M`) |

---

## 7. Catálogo de señales — Personas contratadas (locadores, RUC-10)

Definición: `backend/db/migrations/91_personas_contratadas.sql`; se calculan en `refrescar_personas_senales()` y se
muestran en `frontend/components/personas/SenalesFicha.tsx`.

| Señal | Sev. | Cruza | Criterio exacto |
|---|---|---|---|
| `candidato_gobierna` | alta | órdenes × candidaturas (JNE/ONPE) × gobierno | candidato del partido que gobernaba, elección `anio-4..anio+1`; por DNI o nombre+departamento |
| `candidato` | baja | órdenes × candidaturas | candidato de OTRO partido, `anio-8..anio+1` |
| `autoridad_contratada` | alta/media/baja | órdenes × autoridades electas | es autoridad con mandato vigente durante sus órdenes; alta si mismo gobierno |
| `aporte_gobierna` | media | órdenes × aportes ONPE (DNI) × gobierno | aportó al partido que gobernaba |
| `aporte` | baja | órdenes × aportes ONPE | aportó a otro partido |
| `apellidos_autoridad` | media/baja | apellidos × autoridades del gobierno | 2 apellidos de autoridad en mandato (no ella); media si `frec≤20` |
| `apellidos_funcionario` | media | apellidos × declarantes DJI de la entidad | 2 apellidos poco comunes (`frec≤20`) de otro declarante DJI |
| `funcionario_contratado` | media | órdenes × DJI (nombre+entidad) | declaró trabajar ahí el año de las órdenes, cargo vigente |
| `inhabilitado` | alta | órdenes × sancionados Tribunal | recibió órdenes dentro de `[fecha_desde, fecha_hasta]` de una inhabilitación |
| `meses_seguidos` | media | persona_orden_anual | órdenes en **≥10 meses** de un mismo año |
| `pago_alto` | media | monto/mes × `servicio_referencia` | `monto/meses ≥ 2.5× mediana` Y `≥ S/ 6,000` Y `meses≥2` Y `personas≥10` |
| `visita_previa` | baja | órdenes × visitas (DNI) a la misma entidad | visita en `[primera_orden-180, primera_orden]` |
| `tambien_planilla` | alta | órdenes × planilla PTE (nombre, misma entidad) | órdenes en un mes en que también está en planilla |
| `paso_a_planilla` | baja | órdenes × planilla | entró a planilla DESPUÉS de su primera orden |

---

## 8. Catálogo de señales — Planilla y Plazas

### 8.1 Planilla (PTE) — `backend/db/migrations/108_planilla_autoridad.sql`
| Señal | Sev. | Cruza | Criterio |
|---|---|---|---|
| `tambien_ordenes` | alta | planilla × órdenes (nombre, entidad, mes) | mes en planilla + órdenes de la entidad |
| `candidato_gobierna` | alta | planilla × candidaturas × gobierno | candidato del partido que gobierna |
| `es_autoridad` | baja | planilla × autoridades del gobierno | ES la autoridad electa de la entidad |
| `brecha_cargo` | media | base × `cargo_referencia` (mediana) | `base ≥ 2× mediana` Y `≥ S/ 5,000` Y `personas≥5` Y pocos ganan tanto |
| `pago_extraordinario` | baja | componentes del mes | `extra ≥ S/ 20,000` Y `extra ≥ 3× base` |
| `apellidos_autoridad` | media/baja | apellidos × autoridades | 2 apellidos de autoridad del gobierno (no ella); media si `frec≤20` |
| `apellidos_directivo` | media | apellidos × directivos de la planilla | 2 apellidos poco comunes de un directivo |
| `antes_locador` | baja | planilla × persona_orden_anual | recibió órdenes ANTES de su primer mes de planilla |

Régimen: 1 CAS · 2 R.276 (nombrado) · 3 R.728 (privado) · 4 PAC · 5 FAG · 6 PNUD · 7 Alto funcionario · 9 Ley Servir.

### 8.2 Plazas CAS (SERVIR) — `backend/db/migrations/95_plazas_experiencia.sql`
| Señal | Sev. | Cruza | Criterio |
|---|---|---|---|
| `pide_experiencia_propia` | media | requisitos × nombre de la entidad | pide experiencia "en la misma entidad/institución convocante" |
| `pide_poco` | media | remuneración × formación/experiencia | `remun ≥ S/ 6,000` Y sin título Y (exp<1año o formación básica) |
| `plazo_corto` | media | fechas de publicación | ventana `≤ 3 días` |
| `ya_hay_locadores` | baja | plaza × persona_orden_anual (mismo servicio, 12 m) | la entidad ya pagaba ese servicio por órdenes a 1–3 personas |
| `sueldo_alto` | media | remuneración × mediana nacional | **DESHABILITADO en migr 95** (servicio demasiado amplio); vuelve con planilla cargo-a-cargo |

---

## 9. Catálogo de cruces — Empresa / Contrato

Resultado en `cruces_proveedor` (evidencia por cruce) y `casos_cruce` (agregado por ocid+ruc). Versión vigente de
`refrescar_cruces()`: `backend/db/migrations/121_segmentar_cruces.sql`.

### 9.1 Política
| Tipo | Sev. | Cruza | Umbral |
|---|---|---|---|
| `aporte` | media/baja | personas de la empresa × aportes ONPE (DNI) | media si `sum≥1000` |
| `aporte_empresa` | media | RUC-20 × aportes ONPE | |
| `candidato` | media | personas de la empresa × candidatos (DNI) | |
| `autoridad` | alta | personas de la empresa × autoridades (DNI) | |
| `proveedor_campana` | media/baja | ganador/personas × gastos de campaña | media si `sum≥5000` |
| `partido_gobernante` | alta | `aporte(_empresa)` × gobierno de la entidad | el aporte debe PRECEDER a la buena pro |
| `vendio_gobernante` | media/baja | `proveedor_campana` × gobierno | le vendió a la campaña del partido que gobierna |

### 9.2 En el proceso (competencia aparente)
| Tipo | Sev. | Cruza | Umbral |
|---|---|---|---|
| `socio_comun` | alta | postores del mismo proceso × RNP | comparten un socio (DNI) |
| `unico_postor` | alta/media | convocatoria (1 solo postor) × adjudicación | alta si `adj≥ref×0.98` o `≥S/1M`; solo `adj≥44000` |
| `socio_en_entidad` | alta | RNP × persona_entidad × adjudicación | socio de la empresa es contratado por la misma entidad (conflicto directo) |
| `domicilio_compartido` | alta/media | domicilio fiscal compartido × postores del proceso | alta si exactamente 2 empresas en la dirección; media 3–5 |
| `otro_postor` | alta/media/baja | convocatoria (varias buenas pro) × adjudicación | la buena pro pasó a otro; alta si quedó ≥10% más caro |
| `sancion_vigente` | alta | ganador × sancionados por fecha | ganó estando inhabilitado (`buena_pro ∈ [desde,hasta]`) |
| `sobreprecio_extremo/alto/sobreprecio` | alta/media/baja | `precio_item` × mediana de otras entidades | ≥3× / 2–3× / 1.5–2×; `exceso≥5000`, `razon≤20` |

### 9.3 Historial del proveedor
| Tipo | Sev. | Cruza | Umbral |
|---|---|---|---|
| `sancion_definitiva/temporal/multa` | alta/media/baja | ganador × `osce_sancionados` | por tipo de sanción |
| `penalidad` | media | ganador × `penalidades` | |
| `adicional_sobre_tope/alto/adicional` | alta/media/baja | ganador × `conosce_contratos` | adicional >25% / 15–25% / <15% (topes: 25% bienes/serv., 15% obras) |

### 9.4 Patrón de compras
| Tipo | Sev. | Cruza | Umbral |
|---|---|---|---|
| `fraccionamiento` | alta/media | ganador × `ordenes_fraccionadas` | 2–10 órdenes "hasta N UIT" el mismo día que suman > N UIT; alta si ≥3 o misma descripción |
| `recurrente_dominante/frecuente/recurrente` | alta/media/baja | ganador × adjudicaciones de la entidad (antes) | ≥50% del gasto / ≥10 procesos o ≥25% / 3–9 procesos |
| `proveedor_cautivo` | media/baja | adjudicaciones por empresa | su entidad dominante concentra ≥90% (media) / 75–90% (baja); piso `≥200k` y `≥3 procesos` |

---

## 10. Catálogo de cruces — Registro SUNAT (a nivel empresa)

`refrescar_senales_sunat()` (`118_cruce_recien_fundada.sql:59-102`) añade a `empresa_resumen`:

| Tipo | Sev. | Criterio |
|---|---|---|
| `recien_fundada_medio_ano` | alta | ganó un proceso `≥44000` a **<180 días** de dar de alta el RUC |
| `recien_fundada_un_ano` | media (alta si ≥S/1M) | 181–365 días |
| `recien_fundada_dos_anos` | baja | 366–729 días |
| `dada_de_baja` | media | `estado_sunat ILIKE 'BAJA%'` |
| `suspendida` | baja | `estado_sunat ILIKE 'SUSPENSION%'` |
| `no_habida` | media | `condicion ILIKE 'NO HABIDO%'` |

---

## 11. Catálogo de cruces — Contratos menores (nuevo, 2026-10)

Las ≤8 UIT no pasan por proceso de selección, así que no entran a `cruces_proveedor`. Su enriquecimiento es propio:

- **Fuente:** prod4 (contrato: entidad+RUC, proveedor+RUC, monto, PDF) + prod6 (requerimiento/TDR, ventana de
  cotización), unidos por código CM. Tabla `seace_menores` (10.6 k, 2025–26).
- **Identidad del proveedor:** `seace_proveedor_sunat` (5.1 k) desde la consulta SUNAT (API Perú).
- **Banderas que ya mostramos en el panel del menor** (join por `proveedor_ruc`):

| Bandera | Criterio | Volumen |
|---|---|---|
| proveedor **no activo** en SUNAT | `estado ∈ {BAJA DEFINITIVA, BAJA DE OFICIO, SUSPENSION TEMPORAL}` | 18 |
| proveedor **no habido / no hallado** | `condicion ≠ HABIDO` | 4 |
| **recién creada al ganar** | `fecha_suscripcion - fecha_inicio_actividades < 6 meses` | por calcular por fila |

- **Giro (CIIU)** y **tipo de contribuyente** del proveedor se muestran como contexto.
- **Lo que NO se puede (aún):** unir un menor con su orden de pago en `conosce_ordenes` — no comparten llave; solo
  cruce difuso (RUC+monto+entidad+fecha). Y la lista de cotizantes no es pública (solo el ganador).

---

## 12. Mapa de poder / captura — `125_mapa_poder.sql`, `126_grafo_estado.sql`

- `refrescar_poder()` arma `poder_entidad` (una fila por entidad gobernada: partido, autoridad, y la captura:
  `n_financiaron` = contratos con `partido_gobernante`, `n_vendieron` = `vendio_gobernante`, `n_socio` =
  `socio_en_entidad`, más `monto_captura` y `n_empresas`) y `poder_partido` (agregado por partido).
- **Quién gobierna** = `entidad_gobierno_amplia` × `jne_autoridades` por cargo+ubigeo con mandato vigente hoy.
- **Grafo del Estado** (`grafo_nodos`/`grafo_aristas`): snapshot institucional (pliegos→entidades→cargos→personas,
  aristas "designa/firma"), empatado a `entidades` por **nombre normalizado (~78 %)**. Confianza A/B en ~99 % de aristas.
- **Cruce central:** JNE (quién gobierna) ↔ entidad ↔ `casos_cruce` (contratos con cruce de captura).

---

## 13. Antecedentes de corrupción (Contraloría / Procuraduría) — `90_corrupcion.sql`

Distinto de los "antecedentes" de cruce de empresa: aquí es corrupción ya investigada, mostrada en la ficha de
entidad/región (nunca nombres):

- `informes_control` (14 k): informes de control con responsabilidad **PRESUNTA** (penal/civil/administrativa); solo
  cuántos funcionarios, nunca quiénes. Cruce entidad por nombre/ubigeo (7 niveles; ambiguos quedan sin RUC).
- `procuraduria_casos_sede`: boletín de la Procuraduría por sede (en trámite, sentencia firme, reparación civil cobrada).

---

## 14. El pipeline de refresco (orden real)

1. `refrescar_cruces()` — rehace `cruces_proveedor` (política, sanciones, penalidades, recurrencia, adicionales,
   fraccionamiento, proveedor_campana, partido/vendio_gobernante).
2. Funciones que insertan tipos propios: `refrescar_cruce_otro_postor`, `_recien_fundada`, `_unico_postor`,
   `_socio_en_entidad`, `_domicilio_compartido`, `_proveedor_cautivo`, `refrescar_precio_referencia` (sobreprecio).
3. `dedup_cruces_proveedor()` — quita duplicados (limpió ~179 mil en prod).
4. `refrescar_casos_cruce_base()` — agrega a `casos_cruce` por (ocid, ruc), excluye datos-del-proveedor del riesgo.
5. `refrescar_senales_sunat()` — estados SUNAT a `empresa_resumen`.
6. `refrescar_empresas()` — **DELETE+rebuild** de `empresa_resumen` (puntaje y nivel por empresa).
7. `refrescar_poder()` — `poder_entidad` / `poder_partido`.

> Implicación: `empresa_resumen` y `poder_*` son **derivadas**; no se insertan filas a mano (se borran al refrescar).

---

## 15. Cómo se puntúa

**Contrato** (`casos_cruce.puntaje`): `10×alta + 3×media + 1×baja`, contando solo los cruces que SON del contrato
(los datos del proveedor no cuentan). El orden de la lista usa ese puntaje.

**Empresa** (`empresa_resumen.puntaje`, 0–100, `109_empresas.sql`): reglas con tope por grupo —
inhabilitación (40), gobernante (30; aporte-al-gobernante alta=15, venta-al-gobernante alta=10), competencia (25),
sanciones (24), autoridades (20), visitas (16), fraccionamiento (15), sobreprecio (15), penalidades (12), campañas (8),
adicionales (8), recurrencia (4). Nivel: ≥50 alto · ≥20 medio · >0 bajo · 0 sin.

---

## 16. Privacidad y encuadre

- **DNI**: nunca sale por la API (`cruces_proveedor.persona_doc` es interno). Se usa solo para cruzar.
- **Personas naturales**: se tapa un apellido; RUC-10 → referencia opaca; no se buscan por nombre.
- **"Indicio, no acusación"** aparece en ~142 lugares del producto; cada señal lleva por qué y la fuente.
- **Datos imposibles**: se muestran tal cual con «Posible error de CONOSCE/de la entidad/del SEACE», aparte de las sumas.

---

## 17. Huecos y oportunidades (para que otra IA proponga más valor)

### 17.1 Datos que YA tenemos pero usamos poco
- **`peps` (38 k personas expuestas políticamente)**: no se cruza sistemáticamente con proveedores/socios/autoridades.
  Oportunidad: bandera "proveedor/socio es PEP" o "familiar de PEP" (por apellidos).
- **`dji_funcionarios`/`dji_empleos` (1.8 M / 2.7 M)**: se usan solo para `apellidos_funcionario`/`funcionario_contratado`.
  Oportunidad fuerte: **enriquecimiento patrimonial inexplicable** — patrimonio declarado vs. contratos/sueldos.
- **`penalidades`, `opiniones_oece`, `procuraduria_casos_sede`**: subexplotadas en señales.
- **`mef_ejecutora_gasto` (548 k)**: cruzar lo **adjudicado/pagado vs. lo presupuestado** (ejecución anómala, gasto de
  fin de año, partidas infladas).
- **`precio_referencia`**: hoy solo bienes; extender sobreprecio a **servicios** y a **menores**.

### 17.2 Cruces que NO hacemos aún
- **Menores ↔ todo lo demás**: los ~10.6 k menores no entran a `cruces_proveedor`. Oportunidades: **fraccionamiento de
  menores** (varias CM el mismo día a un proveedor para esquivar el concurso), **recurrencia** (proveedor que gana casi
  todas las menores de una entidad), **domicilio/socio compartido** entre ganadores de menores, **recién creada** con la
  fecha del menor, **proveedor de campaña ganando menores** del partido que gobierna.
- **Menor ↔ orden de pago** (`conosce_ordenes`): hoy no se unen; un cruce difuso (RUC+monto+entidad+fecha) permitiría ver
  la compra completa (expediente + pago).
- **Red de parentesco**: los apellidos ya se usan puntualmente; falta un **grafo de familia** (autoridad → familiares →
  empresas/contratos).
- **Rotación / puerta giratoria** más allá de `socio_en_entidad`: funcionario que sale y su empresa empieza a ganar.
- **Consorcios como vehículo**: patrones de consorcios que se arman/desarman para repartirse procesos.
- **Geografía del gasto**: proveedores que ganan lejos de su domicilio fiscal (foráneo que desplaza al local).

### 17.3 Cobertura / calidad
- **Empate por nombre** (entidad↔grafo ~78 %, partido, apellidos): la mayor fuente de falsos. Mejorar con RUC/ubigeo.
- **44 proveedores jurídicos solo-menores** sin ficha de empresa (no están en `empresa_resumen`).
- **Menores**: solo 2025–26 (el módulo es nuevo); el requerimiento se espeja a R2 por el relay (backfill en curso).
- **Scrapers mensuales** (JNE, PNDA/DJI, visitas, sancionados): vigilar que el cron corra (se atrasaron ~39 días en oct).

### 17.4 Preguntas abiertas para la otra IA
1. ¿Qué señal de **alto valor** se puede construir cruzando `dji` (patrimonio) con contratos/sueldos, respetando
   privacidad (solo agregados, nunca montos personales)?
2. ¿Cómo detectar **colusión** (reparto de mercado) con `conosce_postores` + `conosce_adjudicaciones` (rotación de
   ganadores, postores que siempre pierden ante el mismo)?
3. ¿Vale un **índice de competencia** por entidad (nº de postores promedio, % único postor, % menores)?
4. ¿Cómo priorizar qué contratos leer (la cola de lectura la paga la gente) usando el puntaje + impacto (monto, zona)?
5. ¿Qué cruces de **menores** dan más señal con el dato que ya tenemos (SUNAT + agregados por proveedor)?

---

## 18. Discrepancias y notas técnicas
1. `sueldo_alto` (plaza) está deshabilitado desde migr 95 (servicio demasiado amplio); datos previos pueden traerlo.
2. `recien_fundada` genérico sigue en el frontend; el SQL vigente solo emite las tres bandas (migr 119).
3. Severidad de `aporte`/`proveedor_campana`/`vendio_gobernante` pasó a bandas por monto (migr 115/121).
4. `sancion` genérico se segmentó en `sancion_definitiva/temporal/multa` (migr 121).
5. La versión vigente de `refrescar_cruces()` es la de `121_segmentar_cruces.sql` (las migraciones se redefinen en
   cascada; gana la última).

---

## 19. Glosario rápido
- **OCDS / OCID**: estándar y código de datos abiertos de contratación (del OECE).
- **CUBSO**: catálogo de bienes/servicios/obras (para comparar precios).
- **UIT**: unidad impositiva tributaria (2026 = S/ 5,350); 8 UIT ≈ S/ 42,800 es el tope de "compra menor".
- **RNP**: Registro Nacional de Proveedores (socios/representantes).
- **PTE**: Portal de Transparencia Estándar (de ahí sale la planilla).
- **DJI**: Declaración Jurada de Intereses (patrimonio/empleos de funcionarios).
- **PEP**: persona expuesta políticamente.
- **Buena pro**: la adjudicación (declarar ganador).
- **mef_norm**: función de normalización de texto (minúsculas, sin tildes) para empatar por nombre.

---

## 20. Lectura de cada señal — ejemplo, falso positivo típico y qué la reforzaría

Para que otra IA evalúe el valor y la debilidad de cada señal: un caso concreto, por qué podría ser inocente (falso
positivo), y qué dato adicional la volvería más fuerte. Mantener siempre el encuadre "indicio, no acusación".

### 20.1 Personas contratadas
- **`inhabilitado` (alta).** Ej.: una persona recibe órdenes de servicio mientras el Tribunal la tenía inhabilitada.
  *Falso positivo:* homonimia si el cruce fuera por nombre — pero aquí es por RUC-10/fecha, así que es sólido.
  *Reforzaría:* citar el número de resolución de la sanción y el monto exacto de cada orden en la ventana (ya se hace).
- **`candidato_gobierna` (alta).** Ej.: quien fue candidato del partido que hoy gobierna la entidad cobra órdenes de esa
  entidad. *Falso positivo:* candidato que perdió y no tiene vínculo real; o cruce por nombre+departamento (homónimo).
  *Reforzaría:* confirmar por DNI (no solo nombre), y mostrar la elección y el cargo al que postuló.
- **`tambien_planilla` (alta).** Ej.: mismo mes en planilla y además recibe órdenes de servicio de la entidad (doble
  vínculo/cobro). *Falso positivo:* homónimos en entidades grandes (el cruce es por nombre). *Reforzaría:* un
  identificador común persona↔planilla (hoy no hay DNI en planilla).
- **`pago_alto` (media).** Ej.: cobra 2.5× la mediana de su servicio en esa entidad. *Falso positivo:* servicio
  especializado legítimamente caro; mediana poco representativa. *Reforzaría:* comparar contra mediana NACIONAL del
  mismo CUBSO de servicio, no solo de la entidad.
- **`meses_seguidos` (media).** Ej.: órdenes en ≥10 meses del año (relación laboral encubierta). *Falso positivo:*
  servicio continuo legítimo. *Reforzaría:* cruzar con si hay plaza CAS equivalente sin convocar.
- **`funcionario_contratado` / `apellidos_funcionario` (media).** Conflicto por ser/estar emparentado con un declarante
  DJI de la misma entidad. *Falso positivo:* apellidos comunes (mitigado con `frec≤20`). *Reforzaría:* parentesco
  declarado en la propia DJI.

### 20.2 Planilla / plazas
- **`tambien_ordenes` (alta).** En planilla y además con órdenes el mismo mes. *Falso positivo:* homonimia.
  *Reforzaría:* DNI en planilla.
- **`brecha_cargo` (media).** Sueldo ≥2× la mediana del mismo cargo en la entidad y pocos ganan tanto. *Falso positivo:*
  cargo mal nombrado (el mismo título para funciones distintas). *Reforzaría:* normalizar cargos y comparar nacional.
- **`pide_experiencia_propia` (media).** La plaza CAS exige experiencia "en la misma entidad" (hecha a medida).
  *Falso positivo:* requisito técnico legítimo. *Reforzaría:* ver si un locador previo calza exacto con el perfil.
- **`ya_hay_locadores` (baja).** La entidad ya pagaba ese servicio por órdenes a 1–3 personas antes de convocar la plaza.
  *Reforzaría:* ver si alguno de esos locadores termina ganando la plaza.

### 20.3 Empresa / contrato
- **`socio_comun` (alta).** Dos postores del mismo proceso comparten un socio → competencia aparente. *Falso positivo:*
  socio minoritario sin control; dato RNP desactualizado. *Reforzaría:* % de participación del socio y si hay control.
- **`unico_postor` (alta/media).** Un solo postor y adjudicación al tope. *Falso positivo:* mercado genuinamente chico.
  *Reforzaría:* historial de cuántos postores suele haber para ese CUBSO.
- **`socio_en_entidad` (alta).** Un socio de la empresa es contratado por la MISMA entidad que le adjudica. *Falso
  positivo:* homonimia del DNI derivado. *Reforzaría:* fecha del vínculo vs. fecha de la adjudicación.
- **`domicilio_compartido` (alta/media).** 2–5 empresas en la misma dirección compiten en el mismo proceso. *Falso
  positivo:* centro empresarial/coworking con muchas empresas (mitigado con tope ≤5 y dirección >12 chars).
  *Reforzaría:* cruzar también teléfono/representante compartido.
- **`sobreprecio_*` (alta/media/baja).** Precio unitario ≥1.5× la mediana de otras entidades. *Falso positivo:* ítems
  heterogéneos bajo un mismo CUBSO; flete/zona remota. *Reforzaría:* normalizar por unidad y excluir outliers de zona.
- **`fraccionamiento` (alta/media).** 2–10 órdenes "hasta N UIT" el mismo día que suman más del tope. *Falso positivo:*
  compras urgentes legítimas el mismo día. *Reforzaría:* misma descripción/CUBSO en todas (ya pondera eso).
- **`recurrente_dominante` (alta).** Un proveedor concentra ≥50% del gasto de la entidad. *Falso positivo:* único
  proveedor posible (monopolio técnico). *Reforzaría:* comparar con cuántos proveedores hay en el mercado.
- **`partido_gobernante` / `vendio_gobernante`.** Quien financió/vendió a la campaña del partido que hoy gobierna la
  entidad, gana sus contratos. *Falso positivo:* empate de nombre de partido; aporte posterior (ya se exige que PRECEDA).
  *Reforzaría:* vincular por RUC/DNI del aportante, no por nombre de partido.

### 20.4 SUNAT / registro
- **`recien_fundada_*`.** Ganó un proceso grande al poco de crear el RUC. *Falso positivo:* empresario con trayectoria
  que abre una nueva razón social. *Reforzaría:* ver socios con historial previo en otras empresas.
- **`dada_de_baja` / `no_habida`.** Ganó/contrató estando de baja o no habida en SUNAT. *Falso positivo:* baja posterior
  al contrato (importa la fecha). *Reforzaría:* guardar el estado SUNAT a la FECHA del contrato, no solo el actual.

### 20.5 Menores (nuevo)
- **proveedor no activo / no habido.** El Estado compró (menor) a un proveedor dado de baja o que SUNAT no ubica. *Falso
  positivo:* baja posterior. *Reforzaría:* estado a la fecha de la firma.
- **recién creada al ganar (menor).** Empezó actividades <6 meses antes del menor. *Falso positivo:* negocio nuevo
  legítimo. *Reforzaría:* cruzar con fraccionamiento/recurrencia de menores del mismo proveedor.

---

## 21. Campos clave de las tablas grandes (para diseñar cruces)

Solo las columnas que sirven para cruzar o filtrar; no el esquema completo.

- **`conosce_ordenes`** (28.9 M): `entidad`, `entidad_ruc`, `departamento`, `tipo_orden` (compra/servicio), `nro_orden`,
  `orden` (texto), `descripcion`, `objeto` (BIENES/SERVICIOS/OBRAS), `estado`, `tipo_contratacion` ("hasta 8 UIT" /
  "Deviene de Procesos de Selección"), `monto`, `moneda`, `ruc_contratista`, `contratista`, `anio`, `mes`,
  `fecha_emision`, `fecha_compromiso`, `fecha_notificacion`, `monto_dudoso`, `dudoso_motivo`.
- **`convocatorias`** (827 k): `ocid`, `codigo`, `entidad_ruc`, `objeto`, `modalidad`, `cuantia_referencial`,
  `fecha_convocatoria`, `ocds_payload` (jsonb con awards/suppliers/tenderers/items — la fuente de postores y ganadores).
- **`conosce_adjudicaciones`** (547 k): `codigo_convocatoria`, `tipo_proceso`, `nomenclatura`, `monto_adjudicado`,
  `ruc_proveedor`, `fecha_buenapro`, `entidad_ruc`, `objeto`.
- **`empresas`** (250 k): `ruc`, `nombre`, `fecha_alta_ruc` (clave de `recien_fundada`), `domicilio_fiscal`
  (clave de `domicilio_compartido`), `estado_sunat`, `condicion` (en metadata).
- **`empresa_resumen`** (236 k): `ruc`, `nombre`, `estado_sunat`, `fecha_alta`, `domicilio`, `actividad`, `departamento`,
  `objeto`, `puntaje`, `nivel`, `cruces` (jsonb), `tipos` (array), `n_alta/n_media/n_baja`, `inhabilitada`,
  `inhabilitada_hasta`, `adj_monto`, `cons_monto`, `visitas`, `socios`, `representantes`, `directivos`.
- **`rnp_conformacion_juridica`** (1.4 M): `ruc`, `tipo_documento`, `numero_documento` (DNI de socios), `nombre`, `rol`
  (socio/representante/directivo), `participacion`.
- **`persona_orden_anual`** (5.4 M): persona (código opaco), `entidad_ruc`, `anio`, `meses`, `monto`, `servicio`.
- **`planilla_pte`** (12 M): persona, `entidad_ruc`, `anio`, `mes`, `regimen`, `cargo`, componentes (remuneraciones,
  honorarios, otros, gratificación, incentivo), `total`.
- **`jne_autoridades`** (13 k): `documento` (DNI), `nombre`, `cargo`, `ubigeo`, `partido`, `periodo_inicio`,
  `periodo_fin` (mandato).
- **`onpe_gastos_proveedores`** (181 k): `proceso`, `organizacion` (partido), `documento` (RUC/DNI del proveedor),
  `proveedor`, `monto`.
- **`osce_sancionados`** (20 k): `ruc`/documento, `tipo` (temporal/definitiva/multa), `fecha_desde`, `fecha_hasta`.
- **`cruces_proveedor`** (255 k): `tipo`, `ruc_empresa`, `ocid`, `severidad`, `fecha`, `monto`, `persona_doc` (interno),
  `persona_nombre`, `persona_rol`, `detalle` (jsonb), `fuente`, `fuente_url`.
- **`casos_cruce`** (259 k): `(ocid, ruc)`, `tipos[]`, `cruces` (jsonb), `n_alta/media/baja`, `severidad`, `puntaje`,
  `texto`.
- **`seace_menores`** (10.6 k): `id_contrato`, `codigo` (CM), `objeto`, `descripcion`, `entidad`, `entidad_ruc`,
  `proveedor`, `proveedor_ruc`, `monto`, `estado`, `fecha_suscripcion`, `id_documento_contrato`, `id_requerimiento`,
  `req_r2`, `fec_ini/fin_cotizacion`.
- **`seace_proveedor_sunat`** (5.1 k): `ruc`, `razon_social`, `tipo_persona`, `tipo_contribuyente`, `estado`,
  `condicion`, `fecha_inscripcion`, `fecha_inicio_actividades`, `departamento/provincia/distrito`, `actividad_ciiu`,
  `nombre_comercial`, `nro_trabajadores`.
- **`dji_funcionarios` / `dji_empleos`** (1.8 M / 2.7 M): declarante (nombre/doc), `entidad`, `cargo`, `anio`, empleos e
  ingresos declarados (patrimonio) — HOY subusados.
- **`peps`** (38 k): persona expuesta políticamente (nombre/doc, cargo) — HOY sin cruzar con proveedores.
- **`mef_ejecutora_gasto`** (548 k): `entidad_ruc`, unidad ejecutora, partida/genérica/función/proyecto, `pim`,
  `devengado`, `girado`, `anio` — para cruzar presupuesto vs. adjudicado.

---

## 22. Qué NO tenemos (límites de datos)
- **Sin registro de parentesco** oficial: la familia se infiere por apellidos (débil).
- **Sin datos bancarios/SUNAT tributarios** (solo el padrón público de RUC).
- **Sin API SUNAT en la nube**: la identidad de proveedores de menores vino de un scrape externo (API Perú); para nuevos
  hay que re-correrlo.
- **Menores solo 2025–26** (el módulo es nuevo); no hay historia previa.
- **Lista de cotizantes de menores**: no es pública (solo el ganador).
- **Empate por nombre** cuando falta RUC/DNI/ubigeo: ~78% en el grafo del Estado, variable en otros cruces.
- **Precios**: referencia solo para bienes (no servicios ni menores, aún).

---

*Generado 2026-10-25 a partir del código y de la base en producción. Cifras aproximadas (reltuples). Para el detalle
exacto de cada umbral, ver el archivo:línea citado en cada sección.*
