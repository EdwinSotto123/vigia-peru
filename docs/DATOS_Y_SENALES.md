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
15. Cómo se puntúa (el contrato; la empresa ya no tiene puntaje)
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
antecedentes de corrupción. Cada contrato recibe un **puntaje** ponderado a partir de ellos. La empresa no tiene
puntaje: muestra sus antecedentes como hechos (§15).

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
- **La empresa no tiene puntaje.** El de 0 a 100 lo quitaron las migraciones 112 y 113 porque «parece acusación».
  `empresa_resumen` guarda `cruces` (cada tipo de antecedente con su gravedad más alta y cuántos registros) y los
  conteos `n_alta`, `n_media` y `n_baja` (ver §15).
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

**El modelo lee, el código comprueba (capa de comprobación, 2026-11-18).** Lo que extrae un modelo (agentes o lectores)
no entra a una ficha, un hecho o una bandera sin pasar por una regla determinista contra el registro:

| Qué se comprueba | Dónde | Lo que atrapó |
|---|---|---|
| Dígito verificador del RUC; si falla, el único conocido del proceso a ≤2 cifras con nombre parecido, o null | `backend/lector/rucs.py` (al guardar cada lectura), `agent/tools/documentos/entidades.py` | 6,7 % de los RUC del lector de actas eran inválidos; reparados 1 765 y anulados 1 588 |
| Postores por reporte del SEACE leído SIN modelo (plantilla), unidos aunque cada reporte corte el nombre | `refrescar_proceso_postor()` (migr. 326 y 384) | 1 de cada 4 ítems tenía un postor partido; la bandera del acta del LLM concuerda 95 % con la plantilla |
| Etapa y modalidad del proceso: un release más viejo que el guardado no pisa la clasificación | `siNoEsViejo()` en `scrapers-worker/src/fuentes/oece_ocds.ts` | 1,9 % de los procesos con la etapa de una convocatoria anterior; 8 463 corregidos (99,8 % confirmados por CONOSCE) |
| La cita está en esa página y trae el valor; la aritmética de los ítems | `agent/tools/documentos/evidencia.py`, hechos (migr. 323) | montos de experiencia leídos como cuantía (11-16) |

Al reclasificar o reparar desde lo guardado: el payload del OCDS va recortado (sin `awards`), así que nunca se baja de una
etapa con adjudicación (`reclasificar_desfasadas.py`, guarda y `--revertir`). Toda reparación se mide antes contra una
fuente independiente (CONOSCE, la SUNAT) sobre una muestra.

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
| servir_convocatorias | 4 días (diaria desde el 8-nov) | plazas CAS (SERVIR) |
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
| `empresa_resumen` | 236 k | ficha agregada de cada empresa (cruces con su gravedad, estado SUNAT; sin puntaje) |
| `empresas` | 250 k | datos base de empresas (domicilio, fecha de alta del RUC, estado) |
| `empresa_orden_anual` | 1.9 M | órdenes por empresa y año |
| `rnp_conformacion_juridica` | 1.4 M | socios/representantes/directivos (RNP) con su documento |
| `persona_entidad` | 3.2 M | persona ↔ entidad que la contrató |
| `persona_orden_anual` | 5.4 M | órdenes de cada persona por año |
| `persona_codigo` / `planilla_codigo` | 2.0 M / 640 k | códigos opacos de persona (privacidad) |
| `funcionario_resumen` / `funcionario_codigo` | 1.15 M | una fila por persona con cargo público (migraciones 318 y 319): quien presentó una declaración jurada de intereses o está o estuvo en una planilla; su cargo y entidad más recientes y las palabras VISIBLES de su nombre para buscarla (GIN). Da la ficha de rastro `/app/personas/cargo/<código>` y la búsqueda `GET /personas/buscar` |
| `funcionario_visita_empresa` | 1.09 M | la arista «empresa → funcionario visitado» (migración 335): por la llave del nombre de quien recibió la visita (`nombre_llave`: sus palabras en orden alfabético), la entidad y la empresa cuya gente lo visitó (`empresa_visita`), con cuántas visitas, la primera y la última. 58 859 funcionarios, 178 598 empresas, 430 entidades. La ficha de rastro la muestra como «Visitas que recibió», sólo en las entidades en que la persona declaró un cargo o figuró en planilla, con los procesos que cada empresa le ganó después a esa entidad. Sólo la lee la API; la rehace `refrescar_funcionario_visita_empresa()` (~140 s) tras atribuir las visitas a empresas |
| `hecho_documento` | ~120 k | cada dato leído de un documento (bases, acta, contrato, consultas) como hecho con TIPO de una lista cerrada, su cita y `verificado`: coincide con un registro oficial, lo contradice, la cita trae el valor, dos lecturas coinciden o sin verificar (migración 323). Lo rehace `refrescar_hecho_documento()` desde `documento_lectura`, sin modelo. Las reglas nuevas deben leer de aquí, nunca un monto sin tipo |
| `persona_busqueda` | 2.0 M | una fila por persona natural con órdenes o procesos ganados: las palabras de su nombre (GIN) y sus cifras sumadas, para buscarla por nombre sin recorrer `persona_orden_anual` (migración 320). Sólo preselecciona: la API publica a quien coincide por lo que se ve |
| `persona_ganadora` | 31 k | personas naturales que ganaron procesos de selección (CONOSCE, migración 317): procesos, monto, entidades y fechas; da ficha a quien no tiene órdenes. La API la busca sólo por lo que se VE del nombre |
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
| `visita_previa` | media/baja | órdenes × visitas (DNI) a la misma entidad | visita en `[primera_orden-180, primera_orden]`; media si visitó a quien decide las compras (migr. 195) |
| `tambien_planilla` | alta | órdenes × planilla PTE (nombre, misma entidad) | órdenes en un mes en que también está en planilla |
| `paso_a_planilla` | baja | órdenes × planilla | entró a planilla DESPUÉS de su primera orden |
| `ordenes_tras_informe` | alta/media/baja | `informe_control_persona` (DNI) × órdenes de la MISMA entidad del informe | recibió órdenes de servicio de la entidad después de emitido un informe de control que lo comprende (nombre de CONOSCE y de la Contraloría con 2 palabras o más en común); alta si la responsabilidad es penal y la primera orden llegó a 365 días o menos, media si penal más tarde o civil, baja si sólo administrativa. `refrescar_persona_informe_control()`, migración 308. Responsabilidad PRESUNTA |

---

## 8. Catálogo de señales — Planilla y Plazas

### 8.1 Planilla (PTE) — `backend/db/migrations/108_planilla_autoridad.sql`
| Señal | Sev. | Cruza | Criterio |
|---|---|---|---|
| `tambien_ordenes` | alta | planilla × órdenes (nombre, entidad, mes) | mes en planilla + órdenes de la entidad |
| `candidato_gobierna` | alta | planilla × candidaturas × gobierno | candidato del partido que gobierna |
| `es_autoridad` | baja | planilla × autoridades del gobierno | ES la autoridad electa de la entidad |
| `brecha_cargo` | media | base × `cargo_referencia` (mediana) | `base ≥ 2× mediana` Y `≥ S/ 5,000` Y `personas≥5` Y pocos ganan tanto |
| `pago_extraordinario` | baja | componentes del mes | `extra ≥ S/ 20,000` Y `extra ≥ 3× base`; sin sueldo ese mes, `base` = mediana de sus meses con sueldo (si nunca trajo, de su total por mes), en `sueldo_usual` (migr. 209) |
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
`refrescar_cruces()`: `backend/db/migrations/211_aportes_unicos.sql`.

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

### 9.5 Señales forenses (2026-11, migraciones 276–298)
Todas van al sistema de banderas (`cruces_proveedor` → `casos_cruce`), atadas a un contrato y con su evidencia en `detalle`.
Cuando gana un consorcio (CONOSCE lo registra con un código de 7 dígitos), la bandera va a cada empresa integrante.

| Tipo | Sev. | Cruza | Umbral |
|---|---|---|---|
| `postor_de_relleno` | alta/media | postores del proceso × `postor_acompanante` | una empresa que acompaña siempre al mismo ganador y casi nunca gana |
| `consorcio_rival` | alta/media | `conosce_consorcios` × postores | fueron socias en un consorcio y después compiten por separado en procesos de pocos postores |
| `turno_postores` | alta | adjudicaciones por entidad | las mismas empresas se turnan la buena pro |
| `puerta_giratoria` | alta/media | `planilla_salida` × RNP × adjudicaciones | quien salió de la planilla de la entidad figura en la empresa que le gana después; alta en el primer año (empate por nombre: confirmar) |
| `renovacion_mas_cara` | alta/media | `documento_lectura` (contrato) × contrato anterior del mismo servicio | costo mensual mayor al del contrato anterior en la misma entidad |
| `retencion_sobre_tope` | alta/media | contrato leído × adjudicaciones de dos años | garantía por retención de pagos sobre S/ 480 000 (bienes y servicios) o S/ 5 000 000 (obras) y ganador con más de 1 700 UIT adjudicadas en cada uno de los dos años anteriores (art. 114 del Reglamento) |
| `contrato_sobre_adjudicado` | alta/media | contrato leído × CONOSCE × OCDS | monto del contrato ≥ 25 % sobre lo adjudicado según las dos fuentes; alta desde 50 % |
| `mismo_dueno` | alta/media | socios del RNP × adjudicaciones por entidad | un socio (de 2 a 6 empresas) gana en la misma entidad con otra empresa un objeto parecido (trigramas ≥ 0,45); alta a 90 días o menos, media hasta 12 meses. Grupos en `mismo_dueno_grupo` |
| `socio_de_inhabilitada` | alta/media | `osce_sancionados` × socios del RNP × adjudicaciones | el socio de una empresa inhabilitada gana con otra empresa dentro de la sanción (Ley 32069, art. 30, impedimento 3.E); alta si la sanción es definitiva o la ganadora se fundó / el socio entró desde 180 días antes. La base no tiene el porcentaje del socio ni el rubro: siempre «falta confirmar» |
| `socio_con_informe_control` | alta/media | `informe_control_persona` (302) × socios y representantes del RNP × adjudicaciones | un socio o representante legal del ganador (por DNI, con el nombre de las dos fuentes coincidiendo en dos palabras o más, y en la empresa desde antes de la buena pro) figura en un informe de control emitido antes de la buena pro; alta si el informe le señala responsabilidad penal, media si civil o administrativa; el detalle dice si el informe es de la misma entidad. Responsabilidad PRESUNTA: no es condena ni impedimento |
| `observado_por_contraloria` | alta/media/baja | `informe_control_proceso` (313): las observaciones leídas con IA × nomenclaturas de CONOSCE × `contrato_cui` | una observación de un informe de control nombra ESTE proceso (misma entidad, tipo, número, año y sigla compatible; o la nomenclatura entera) o la obra del contrato (su CUI tiene un solo contrato de obra en la entidad y la observación habla de su ejecución). Alta si el informe señala responsabilidad penal y la observación es de selección, ejecución o pagos; media si penal o civil o cuantifica un perjuicio; baja si sólo administrativa; por CUI o por número único nunca pasa de media. El detalle NO lleva el texto de la observación (puede nombrar a un funcionario): la web lo abre en el panel del informe, que lo publica tapado. La responsabilidad es PRESUNTA y de funcionarios: no sanciona al proveedor |
| `gano_tras_observacion` | alta/media/baja | banderas `observado_por_contraloria` (313) × adjudicaciones de CONOSCE (solo o en consorcio) | la misma entidad le adjudica DESPUÉS de emitido un informe de control que observó otro proceso que ese proveedor había ganado ahí. Alta si aquella bandera es alta y esta buena pro es de los dos años siguientes al informe; media si es más antigua o aquélla es media; baja si aquélla es baja. El detalle trae el proceso observado, el informe, los días transcurridos y cuántos procesos suyos se observaron antes. El informe no sanciona al proveedor: sirve para ver si la entidad corrigió lo observado |

Trampas que ya costaron: `empresas.fecha_alta_ruc` no siempre es la fundación (un RUC reactivado tiene alta posterior a
su primera buena pro: sólo vale si es anterior a la primera adjudicación). Desde la migración 373 (2026-11-18) guarda la
fecha MÁS ANTIGUA entre la inscripción en el RUC y el inicio de actividades (el inicio cambia al reiniciar actividades:
9 998 empresas vendían antes de su «alta»), y «empresa recién creada con órdenes» descarta, como la recién fundada, a la
que ya le vendía al Estado antes de esa fecha (13 122 → 10 514 casos; señal alta 925 → 559). Las tablas temporales de una función pesada
necesitan `ANALYZE` y `statement_timeout` (sin estadísticas, un cruce llenó el disco temporal de producción).
Vistas agrupadas para el investigador: `/patrones/duenos`, `/patrones/inhabilitadas`, `/patrones/consorcios`,
`/patrones/acompanantes` (pestañas de `/app/patrones` y herramienta `patrones` del MCP).

### 9.6 Indicadores en observación (migración 329)
Una señal nueva no entra al puntaje el día que nace. La tabla `senal_en_observacion` lista los tipos que se MUESTRAN con
su evidencia en la ficha del contrato, en su cabecera y en `/app/patrones` (pestaña «En observación»). Esos tipos NO
cuentan para el puntaje ni para «contratos con antecedentes»: no entran a `casos_cruce` hasta medir su precisión con una
muestra revisada. Quitar la fila de un tipo lo hace puntuar en el siguiente refresco. Es el mismo trato que ya tienen
los datos del proveedor (migración 115).

Hoy son siete (conteos en producción del 2026-11-17; los dos últimos, del 2026-11-18):

| Tipo | Sev. | Filas | Cruza | Umbral |
|---|---|---|---|---|
| `reunion_en_evaluacion` | media/baja | 461 | visitas × gente del ganador (socio, representante o directivo, por su documento) | visitó a un funcionario que decide las compras después de presentar su oferta y antes de la buena pro, con un motivo de trato directo (reunión, visita personal, gestión de intereses o por el procedimiento). Media si la empresa no le vendía a la entidad ese año ni el anterior ni había ganado ahí en los dos años previos (158); baja si ya era proveedora (303). Medido: entre postores que no eran proveedores, 1,01 % de los que ganan tuvo esa reunión contra 0,32 % de los que pierden; entre proveedores previos casi no hay diferencia |
| `visita_personal_decisor` | media | 303 | visitas × gente del ganador | la misma persona del ganador visitó al mismo funcionario que decide las compras, declarando «visita personal», en 3 o más días de 2 o más meses distintos, en el año anterior a la buena pro |
| `ofertas_a_la_vez` | media | 11 | `proceso_postor` (reporte de presentación de ofertas del SEACE) × RNP | el ganador y otro postor del mismo ítem comparten un socio, representante o directivo (no cuentan quienes figuran en más de 10 empresas) y registraron sus ofertas con 30 minutos o menos de diferencia |
| `trabajo_en_el_ganador` | media/baja | 1 227 | DJI de datos abiertos (`dji_empleos` × `dji_funcionarios` por `codigo_ddjj`; migraciones 330-333) × adjudicaciones | un funcionario de la entidad declaró un empleo en la empresa que ganó y la buena pro cayó mientras él ocupaba su cargo. Baja si dejó el empleo más de dos años antes o la declaración no trae fechas. No repite los procesos que ya marca `empleo_declarado` |
| `firma_en_plazo_de_apelacion` | media | ver abajo | CONOSCE: adjudicaciones × contratos × postores (migración 334) | en un ítem con dos o más ofertas, el contrato se firmó antes del 5.º día hábil siguiente a la buena pro, cuando los otros postores todavía podían apelarla (D.S. 344-2018-EF arts. 64 y 141; D.S. 009-2025-EF arts. 82, 90 y 304). Fuera: una sola oferta, buena pro con más de una fecha, firma anterior a la buena pro, directas y regímenes especiales |
| `solo_admitido_el_ganador` | alta/media | 194 (57 altas) | `proceso_item` × `proceso_postor` (reporte de evaluación del SEACE, leído sin modelo; migraciones 326, 384 y 390) | en un ítem adjudicado con 4 o más ofertas se admitió una sola, la del ganador. Alta con 6 o más ofertas. Tasa base medida: con 3 ofertas pasa en el 14 % de los ítems, con 4 en el 10 %, con 5 en el 8 % y con 8 o más en el 1-4 %; concuerda 95 % con la bandera del acta leída con modelo (`acta_solo_queda_el_ganador`). Va al ganador si es RUC 20, o a cada integrante RUC 20 del consorcio; las empresas no admitidas van en `detalle.fuera_empresas` (sólo RUC 20). Se rehace con `refrescar_cruce_solo_admitido()` en `tarea:piezas`. Se midió y se descartó «sólo calificó el ganador»: en la adjudicación simplificada la calificación se detiene en el primero que cumple |
| `comite_mismo_ganador` | media/baja | 57 (53 procesos) | comité de selección del acta leído por los agentes (`alertas.analisis_full->document_analysis->comite_evaluacion`, sólo nombres con la cita comprobada) × adjudicaciones (migraciones 396-397) | la misma persona (nombre completo de 3 palabras o más, sin títulos, en la misma entidad) integró el comité en 3 o más procesos que ganó la empresa, la mitad o más de los suyos, y la empresa gana al menos el doble con ella que sin ella. Alta con 5 o más y 10 % o menos sin ella; baja si la entidad no tiene procesos leídos sin esa persona. Del integrante sólo sale su papel y `integrante` (md5 de entidad y nombre, 10 caracteres): ni su nombre ni la cita. Tasa base sobre los 3 152 procesos con comité leído; crece con el análisis masivo. Se rehace en `tarea:piezas` |
| `comite_socio_proveedor` | alta/baja | 27 (10 altas, 4 empresas) | comité del acta leído por los agentes (cita comprobada) × RNP (`rnp_conformacion_juridica`) de las empresas que ganan en ESA entidad, por el nombre completo con las mismas palabras en cualquier orden (migración 407) | una persona del comité de selección de la entidad es socio, gerente o representante de una empresa que le gana a esa entidad (impedimento: el funcionario y sus empresas no contratan con su entidad mientras ejerce y 12 meses después). `identidad`: documento (el DNI del RNP aparece en `persona_entidad` de la entidad), nombre_completo (4+ palabras) o nombre (3). `cuando`: buena pro frente a sus procesos en el comité (a_la_vez, cerca ≤ 1 año, lejos). Alta si el vínculo regía y es a la vez o cerca con identidad firme, o si integró el comité de ESE proceso; baja si lejos o el vínculo no regía. Medido el 2026-11-19 sobre 3 288 procesos con comité: 0 socios de un postor del mismo proceso, 1 en el comité del proceso que ganó en consorcio; la 395 veía 4 de los 8 pares directos por DNI. Sin nombre ni DNI en el cruce: `integrante` es la misma clave que en la 396 |
| `comite_corregido_tribunal` | alta/media | 0 (45 procesos con comité leído y corrección del Tribunal, una persona con 2+) | comite_integrante (408) × procesos corregidos por el Tribunal (`tribunal_corrigio`, 423) (migración 427) | una persona del comité con 3+ procesos en la entidad y 2+ corregidos por el Tribunal (apelación fundada, en parte o nulidad), mucho más que el resto de la entidad sin ella: `binomial_cola` + Benjamini-Hochberg al 10 % sobre todas las personas probadas, como la 415. Alta con p < 0,001. Se marca cada proceso corregido de la persona sobre su ganador, con la resolución. Sin nombre: `integrante` |
| `tribunal_sancionador` | media | 2 (las primeras 21 resoluciones con el lector v2) | apelaciones del Tribunal leídas con GLM (lector/tribunal.py v2): la parte resolutiva ordena abrir un procedimiento sancionador contra la empresa; el nombre comprobado en el texto y unido a su RUC 20 (`tribunal_ruc_de`: postor del proceso, consorcio, integrante o nombre único) (migración 424) | el Tribunal halló indicios de documentación falsa o información inexacta en su oferta (`infraccion`). Es la orden de investigar, no la sanción. En el proceso de la resolución, sobre esa empresa |
| `tribunal_revoco_buena_pro` | baja | 7 | lo mismo, `adjudicatario` × efectos revoca_buena_pro / descalifica_al_adjudicatario con la etiqueta comprobada (`tribunal_corrigio`, 423) (migración 424) | el comité le dio la buena pro y el Tribunal se la quitó. Una vez es un error del comité; varias, en entidades distintas, un patrón (GET /empresas/:ruc/tribunal y ficha_empresa del MCP los cuentan) |
| `gana_con_sancionador_abierto` | media | 0 (CONOSCE aún no trae lo adjudicado después de las órdenes de 2026) | `tribunal_sancionador` × conosce_adjudicaciones (sola o en consorcio) entre la orden y la primera sanción posterior en osce_sancionados, hasta dos años (migración 424) | ganó otro proceso mientras tenía abierto un sancionador por documentos falsos o inexactos: no está prohibido, pero la entidad pudo revisar con más cuidado los documentos de su oferta |
| `comite_competencia_restringida` | alta/media | 26 (4 personas) | comite_integrante (408/411) × banderas de competencia de cruces_proveedor (unico_postor, acta_solo_queda_el_ganador, acta_descalificados_por_formalidad, acta_oferta_mas_baja_descartada, solo_admitido_el_ganador) (migración 415) | una persona del comité con 4+ procesos en la entidad en los que la competencia quedó restringida mucho más que en los demás procesos de la entidad (5+ sin ella). `binomial_cola` con la tasa de la entidad sin la persona y Benjamini-Hochberg al 10 % sobre TODAS las personas probadas en cada refresco (2026-11-19: 147 probadas, 6 con p < 0,01 donde el azar daría 1,5, pasan 4). Alta con p < 0,001. Se marca cada proceso restringido de la persona sobre su ganador. Sin nombre: `integrante` |

**De dónde sale el comité (migración 408, 2026-11-19).** Las dos señales de comité leen `comite_integrante`, una vista que junta los nombres comprobados de dos fuentes: los agentes (`alertas.analisis_full`, evidencia verificada) y el lector del comité (`backend/lector/comite.py`, clase `comite` de `documento_lectura`: GLM 5.3 flash sobre las primeras y últimas páginas del acta; `comprobar_pdfs` exige que todas las palabras del nombre estén en el texto de una misma página). Un nombre leído de un acta escaneada queda sin verificar y no entra. Son nombres de funcionarios para cruzar por dentro: la vista no se otorga a la API ni al MCP, la clase está fuera del índice del chat y de la ficha, y las señales muestran sólo el papel y una clave estable.

**Calibración de las banderas publicadas del acta (migraciones 392 y 393, 2026-11-18).** `acta_solo_queda_el_ganador` (acta leída
con modelo, puntúa) salía siempre «media». Su frecuencia según los postores del acta: 50,6 % de los procesos con 2,
35,0 % con 3, 26,3 % con 4, 22,3 % con 5 y 9,6 % con 6 o más. Con 2 postores pasa a «baja» (2 069 procesos); con 3 o
más sigue «media». Los motivos de los que quedaron fuera son reales (se revisaron los 10 618), no «no se evaluó».
`acta_descalificados_por_formalidad` sube con los postores (15 % con 2, 23 % con 3, 30 % con 4, 40 % con 5 o más) y, con
2, es el mismo hecho que «sólo quedó el ganador» (14 de esos 15 puntos): con 2 postores pasa a «baja» (533 procesos) para
no contar dos veces lo mismo. No se usó «el que sacaron ofrecía menos»: el acta no trae ese monto en 1 876 de 2 504 casos.
`consultas_denuncia_direccionamiento` (migración 394): donde un participante denunció bases dirigidas hubo MÁS competencia
(3,17 ofertas de media contra 2,65; una sola oferta en el 29,7 % contra el 40,4 %). La denuncia marca procesos disputados.
Sigue «media» si después la competencia desapareció (una oferta o una admitida: 577) o no hay reporte para saberlo
(106); pasa a «baja» si en todos los ítems adjudicados se admitieron dos o más (684). El detalle trae `competencia`.

**`socio_en_entidad` por tiempo (migración 395, 2026-11-18).** Marcaba «alta» todo proceso en que un socio o
representante del ganador tuvo órdenes de la misma entidad, en cualquier año (13 165 procesos, 3,1 % de los
adjudicados). Ahora: «alta» si la buena pro cae dentro de sus órdenes ± 6 meses (5 185), «media» a menos de dos años
(3 805), «baja» más lejos (4 208). El detalle trae `primera_orden`, `ultima_orden` y `cuando`; de varias personas de la
misma empresa, la más cercana a la buena pro.

Además, la 329 agrega:

- **Etapa y motivo de cada `visita_previa`** (el cruce del contrato, `refrescar_cruce_visita_previa()`): la etapa del
  procedimiento en que cayó la visita (`etapa`: `antes_de_convocar`, `convocatoria`, `evaluacion`, `dia_buena_pro`) y la
  clase del motivo declarado (`clase_motivo`, función `visita_motivo_clase`: `reunion`, `personal`,
  `gestion_intereses`, `seleccion`, `operativa`, `protocolar`, `otra`).
- **`senal_tasa_base`:** de cada tipo de señal, en cuántos procesos aparece y sobre cuántos se puede medir. La ficha lo
  muestra como «cuán frecuente es». La rehace `refrescar_senal_tasa_base()`.
- **El motivo en texto libre nunca se publica.** Sale la categoría del registro o sólo su clase, porque el texto libre a
  veces nombra a terceros.

Se midió y NO se implementó la contratación directa repetida a la misma empresa: sin la causal, marca sobre todo a
proveedores únicos naturales.

### 9.7 Personas y dueños, en observación (2026-11-18, migraciones 364–368)
Tres piezas que no pasan por `cruces_proveedor`: cada una tiene su tabla, su lista en `/app/patrones`, su alcance en la
herramienta `patrones` del MCP y su bandera «en observación» en la ficha. Ninguna puntúa.

| Señal | Tabla y refresco | Filas (PROD) | Cruza | Regla |
|---|---|---|---|---|
| Trabaja en compras y un familiar recibe órdenes de su entidad | `funcionario_compras_familiar`, `refrescar_funcionario_compras_familiar()` (cadena semanal de órdenes) | 1 002; 77 graves de 65 personas, S/ 3,3 M en el puesto | `dji_empleos` (el puesto con sus palabras) × `funcionario_familiar` (migr. 351) × `conosce_ordenes` y `conosce_adjudicaciones` | el puesto declarado es de compras, logística o contrataciones (`tipo_cargo = compras`) o decide el gasto (`decide`), y un familiar declarado recibió órdenes de esa entidad a su nombre (`via = persona`) o con una empresa en la que figura en el RNP (`via = empresa`). Las ventas se cuentan una por una por su fecha: con la persona en el puesto, antes y después. Sin cese declarado, el puesto llega hasta su última declaración que lo nombra. Grave: compras + familiar cercano + al menos una venta en el puesto |
| La autoridad dejó de figurar en una empresa y ésta le vendió a su entidad | `autoridad_exsocio_venta`, `refrescar_autoridad_exsocio_venta()` | 5; 4 graves, S/ 2,0 M en el plazo | `jne_autoridades` × salidas del RNP (`rnp_exsocio` y `baja_corte`) × `entidad_gobierno_amplia` × órdenes y adjudicaciones | la autoridad electa dejó de figurar en la empresa cuando ya tenía el cargo o hasta 12 meses antes, y la empresa le vendió a su entidad dentro de su periodo. Grave: fue socio y hay ventas hasta 12 meses después de su salida, o figuraba con cualquier papel cuando la empresa vendió |
| Quiénes ya no figuran en una empresa | `rnp_exsocio` (carga única, `cargar_rnp_exsocios.py`) | 33 918 vínculos de 11 196 empresas | 65 versiones mensuales del RNP | no es una señal: es el dato que faltaba. La ficha de la empresa los muestra con el corte en que salieron |
| Ola de personas nuevas al cierre de una gestión (migr. 380, 2026-11-18) | `cierre_gestion_personas`, `refrescar_cierre_gestion_personas(eleccion, cambio)` (a mano: 15-25 min) | cierre de 2022 | órdenes de CONOSCE a RUC 10 de gobiernos locales y regionales: entre la elección y el cambio de mando, frente a las mismas fechas un año antes y un año después | «nueva» = sin órdenes de la entidad desde 2018 antes del periodo. Entra con los 3 meses con datos en el periodo y en el año base, ≥ 20 personas en el año base, ≥ 20 nuevas, ≥ 3 veces las nuevas del año base (piso 5) ≥ 1,5 veces las de un año después y ≥ 2 veces lo que subió su sector (educación, salud, municipalidades u otro, por el nombre: en 2022 volvieron las clases presenciales). Alta: ≥ 5 veces y ≥ 50. Sin la guarda de base salían entidades que no publicaban en 2021; sin la de «después», las UGEL (clases a distancia en 2021). Sólo 2022: en 2026 faltan órdenes en la fuente. Web: pestaña «Cierre de gestión» de /app/patrones y el índice de patrones de la entidad; MCP: `patrones` con alcance `cierre_gestion` |

Lo que se aprendió al medirlas:

- **Comparar años no alcanza.** La primera versión de compras y familia daba «grave» a un puesto de dos meses porque
  las órdenes del familiar iban de 2018 a 2025. Hay que contar cada orden por su fecha frente al puesto.
- **El puesto es texto libre.** «Contratación de servicios de alquiler de maquinaria» no es un cargo de compras: es el
  encargo por el que contrataron a la persona. Cuenta «contrataciones» o «contratación pública». Y se clasifica sin
  tildes: «LOGÍSTICA» y «ADQUISICIÓN» no entraban.
- **El familiar casi nunca cobra a su nombre.** Con su empresa aparecen casos que la versión por persona no veía
  (S/ 1,5 M en órdenes con la persona en el puesto).
- **Salir de la empresa no levanta el impedimento.** Alcanza a la persona jurídica en la que el impedido tenga o haya
  tenido más del 30 % dentro de los 12 meses anteriores a la convocatoria (literal i del 11.1 del artículo 11 de la Ley
  30225; tipo 3.A del 30.1 del artículo 30 de la Ley 32069). El RNP no publica el porcentaje: la señal siempre pide
  confirmar con la partida registral.
- **El corte de noviembre de 2022 del RNP no sirve:** «da de baja» a 219 mil vínculos por un cambio de formato.

Privacidad: el familiar nunca sale con su nombre ni su documento (su parentesco y, si es el caso, la empresa, como en la
pestaña Familia). La autoridad electa va con su nombre, como en el resto del sistema. Las tablas sólo las lee la API.

**Dónde se ve cada caso** (pedido del 2026-11-18: «que aparezcan en las fichas, citadas y ordenadas»):

| Lugar | Qué muestra |
|---|---|
| `/app/patrones` (pestañas «Compras y familia» y «Autoridad que dejó su empresa») | la lista entera; cada fila abre su panel |
| Panel del caso (`DetallePatron.tsx`) | en una frase con la persona, la entidad y la empresa enlazadas; datos sin filas vacías; **la evidencia** (`VentasCompraFamilia.tsx`): barra antes / en el puesto / después, cada orden con su número enlazado a la lista de compras de la entidad y cada proceso a su ficha, la empresa del familiar; qué revisar; fuentes |
| Ficha de la entidad | bandera en observación en la cabecera y, en su Inicio, la sección «En observación» (`EnObservacionFicha.tsx`) con los casos |
| Ficha de la entidad, pestaña «Patrones» | el índice de TODO lo que se repite en ella, por familias, y la ficha de cada patrón (ver 9.8) |
| Ficha de la empresa | bandera en la cabecera, la misma sección en «Su gente» y el renglón en la tarjeta de la autoridad que dejó de figurar |
| Ficha de la persona (`/app/personas/cargo/<código>`) | bandera y caso en «Lo que pide revisión», con «Ver cada orden» |
| La orden concreta (listas de órdenes y de compras) | bandera `compras_familiar` en la fila, su tarjeta en el panel y filtro por esa bandera (`csenal=` / `oant=`) |
| MCP | `patrones` (alcances `compras_familia` y `autoridad_exsocio`), `rastro_persona`, `red_empresa` y la bandera en `ordenes` |

La evidencia de compras y familia sale de `funcionario_compras_familiar_venta` (migración 369): una fila por orden o
proceso con su `momento` frente al puesto. A nombre del familiar sólo van la fecha y el monto (el número de la orden
llevaría a su nombre); con su empresa, el número, la descripción y el OCID. La llena el mismo refresco que las cuentas:
no pueden diferir (0 diferencias en 1 002 casos). Las filas de los dos patrones viven en `filasCasos.tsx` y las comparten
Patrones y las fichas: la misma fila dice lo mismo en los dos lados.

### 9.8 La pestaña «Patrones» de una entidad (2026-11-18)
Pedido del usuario: una lista de órdenes filtrada por una bandera «no dice mucho»; la ficha de la entidad debe decir qué
patrones hay en ella («patrones de concertación y demás») y tener una ficha por cada patrón.

- **API `GET /patrones/entidad/:ruc`:** el índice. Cuántos casos tiene en la entidad cada lista de patrones (le pregunta
  por dentro a cada lista de `routes/patrones.ts` con el RUC, en tandas de cinco: no repite ninguna regla) y los
  antecedentes de quienes ganaron sus contratos por tipo (`casos_cruce`), con seis contratos de ejemplo y los cinco
  proveedores que más lo repiten.
- **Familias** (`frontend/lib/patronesEntidad.ts`): concertación y competencia aparente; compras partidas, repetidas o a
  la medida; familia, política y trato previo; proveedores con sanción, impedimento u observación; lo que leyeron los
  agentes; obras y otros. Un tipo de antecedente nuevo cae en su familia por el catálogo o por su nombre.
- **Web** (`components/entidad/PatronesEntidad.tsx`, pestaña a pedido): las familias con cuántos patrones tienen casos,
  el índice con detalle de los antecedentes de empresa (`IndiceAntecedentes`, con rótulos de familia; el elegido va en
  `?patron=`) y la ficha del patrón. Si el patrón tiene lista, la ficha ES esa lista con el RUC de la entidad
  (`ListaDePatron`: mismas filas y mismo panel por caso); si es un antecedente de sus contratos, sus cifras, quiénes lo
  repiten, los contratos de más peso y el enlace a todos en sus compras (`?cruce=`). Al pie, lo que se buscó y no tiene
  casos.
- **De paso:** una lista de Patrones con filtro de RUC no pasaba de la primera página, y cuatro (mismo dueño, socio de
  inhabilitada, socio en informe de control, observados) no abrían filtradas con `?ruc=`.
- **MCP:** `ficha_entidad` trae `patrones_en_la_entidad` (cada patrón con casos y cada antecedente, con su enlace).

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
- **Identidad del proveedor:** `seace_proveedor_sunat` (5.1 k) desde la Consulta Múltiple de RUC oficial de la SUNAT.
- **Banderas que ya mostramos en el panel del menor** (join por `proveedor_ruc`):

| Bandera | Criterio | Volumen |
|---|---|---|
| proveedor **no activo** en SUNAT | `estado ∈ {BAJA DEFINITIVA, BAJA DE OFICIO, SUSPENSION TEMPORAL}` | 18 |
| proveedor **no habido / no hallado** | `condicion ≠ HABIDO` | 4 |
| **recién creada al ganar** | `fecha_suscripcion - fecha_inicio_actividades < 6 meses` | por calcular por fila |

- **Señales propias de cada menor** (`menor_senal`): la tabla la crea la migración 251 y la llena
  `refrescar_menor_senales()` (migración 252). Cada señal va atada a su contrato, con su evidencia. Por registro:
  `menor_partido_mismo_dia` (alta), `menor_partido_en_el_anio` (media), `menor_sobre_tope` (alta), `menor_borde_tope`
  (baja), `menor_ventana_corta` (media; alta con menos de 1 hora), `menor_invitacion_cerrada` (media),
  `menor_fin_de_semana` (baja) y `menor_precio_alto` (media; alta con 3 veces la mediana y S/ 5 mil de exceso). Leídas en
  el requerimiento y el contrato, sólo si dos lecturas coinciden: `tdr_proveedor_nombrado` (alta),
  `tdr_marca_sin_equivalente` (media), `tdr_monto_distinto` (media), `tdr_experiencia_alta` (baja),
  `contrato_monto_distinto` (media; alta si el documento pasa el tope y el registro no), `contrato_ruc_distinto` (alta)
  y `contrato_documento_ajeno` (media). La migración 253 suma `menor_orden_antes_de_cotizar` (alta): la orden se emitió
  antes de publicarse el pedido de cotizaciones.
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
6. `refrescar_empresas()` — **DELETE+rebuild** de `empresa_resumen` (cruces y conteos por gravedad; sin puntaje).
7. `refrescar_poder()` — `poder_entidad` / `poder_partido`.

> Implicación: `empresa_resumen` y `poder_*` son **derivadas**; no se insertan filas a mano (se borran al refrescar).

---

## 15. Cómo se puntúa

**Contrato** (`casos_cruce.puntaje`, `refrescar_casos_cruce_base()`): 10 por cada tipo de señal alta, 3 por cada media
y 1 por cada baja. Cuenta solo los cruces que SON del contrato: no cuentan los datos del proveedor (migración 115) ni los
indicadores en observación (§9.6). El orden de la lista usa ese puntaje.

**Empresa: sin puntaje.** El puntaje de 0 a 100 de la migración 109 ya no existe: la 112 dejó de calcularlo porque
«parece acusación» y la 113 borró sus columnas (`puntaje`, `nivel`) y sus tablas de reglas. Hoy `empresa_resumen`
muestra los antecedentes como hechos: `cruces` (cada tipo con su gravedad más alta y cuántos registros) y los conteos
`n_alta`, `n_media` y `n_baja`. No hay un número que ordene empresas.

### 15.1 Validación externa: el puntaje frente a la Contraloría (migración 401, 2026-11-19)

Hasta esta fecha ni el puntaje ni las señales se habían medido contra un hecho de afuera. `refrescar_validacion_senales()`
(cada lunes por pg_cron; panel `/admin/senales`, pestaña «Frente a la Contraloría») toma los procesos adjudicados de
2018 al año pasado en las entidades con algún proceso observado por un informe de control, y mide cuántos de los
observados encuentra el puntaje. Primera corrida (166 895 procesos, 539 entidades, 1 129 observados):

| Orden | AUC | Observados en el 1 % de arriba | En el 5 % |
|---|---|---|---|
| Azar | 0,50 | 11 | 56 |
| Puntaje de riesgo (10/3/1) | 0,48 | 9 | 48 |
| Sólo el monto adjudicado | 0,80 | 89 | 334 |

Lo que se midió además (scripts en el scratchpad de la sesión; no publicados como señal):

- **A igual tipo y tamaño, los procesos con más banderas se observan menos** (AUC del puntaje de 0,39 a 0,50 en cada
  estrato). Ninguna bandera tiene más observaciones de las que su tipo y tamaño explican, salvo «recién fundada, menos de
  medio año» (O/E 2,46; 1,05 a 4,86). Varias tienen menos: recurrente (0,57), recurrente frecuente (0,44), único postor
  (0,38), visita previa (0,48), fraccionamiento (0,69).
- **Con un solo postor, la Contraloría observa 14 % menos** de lo esperado por tipo y tamaño (en obras de más de
  S/ 10 M, 32 por mil contra 98-145 con cuatro o cinco postores): sus observaciones de selección siguen, en parte, a que
  haya alguien que reclame.
- **Un orden aprendido de las observaciones no le gana al monto** sin el año (que sólo refleja cuándo terminan las
  auditorías): no se publicó una «prioridad de control» porque sería ordenar por monto con otro nombre.
- **Los screens de colusión sobre los precios no sirven aquí**: en obras la oferta ganadora cae en el 90 % del valor
  referencial (el piso legal), y la dispersión de las ofertas no separa a los postores vinculados (AUC 0,613 con y sin
  screens, 2 760 procesos de un ítem con tres o más ofertas leídas del acta).

**Segunda verdad: el Tribunal de Contrataciones (migraciones 402-404).** Las apelaciones que el Tribunal declara
fundadas y los procedimientos que anula miran justo la etapa de selección. Las resoluciones de gob.pe se bajan y leen
cada hora desde la PC (tarea VigiaTribunal; `bajar_tribunal.py`, `lector/tribunal.py`, `tribunal_cargar.py`), con el
resultado comprobado contra el primer punto resolutivo, y se unen a su contrato (`tribunal_proceso`). Se ven en la ficha
del contrato y en el MCP, y `refrescar_validacion_tribunal()` mide las señales contra ellas cada lunes (universo: procesos
competitivos desde 2024 con dos postores o más). Primera corrida, con las primeras resoluciones: 10 procesos con la
etiqueta en 65 214, sin conclusión todavía.

Cómo se comprueba el resultado (migración 423). Lo lee GLM 5.3 flash y una regla sin modelo lee el primer punto
resolutivo: el ancla es «LA SALA RESUELVE:», «La Sala resuelve:» o «…por unanimidad; 1.», y gana lo que aparece primero
en ese punto. Si no dicen lo mismo, el modelo grande (GLM 5.3) relee la resolución y su lectura reemplaza a la del chico
sólo si pasa la comprobación. Hay dos marcas. `resultado_ok` (el mismo resultado) decide qué publica la ficha.
`corregido_ok` (el Tribunal corrigió el proceso o no) es la etiqueta de la validación y de `tribunal_entidad`. Con 914
resoluciones (2026-11-19), el resultado exacto está comprobado en 895 (antes 782 de 904), con US$ 0,26 de relecturas, y
hay 133 procesos con la etiqueta. Ninguna señal pasa todavía su intervalo. La que más se acerca es
`consultas_denuncia_direccionamiento`, O/E 1,43 (0,86-2,24): un postor denunció en las consultas que las bases apuntaban a
alguien y después el Tribunal corrigió el proceso.

Cómo leerlo: la Contraloría audita sobre todo cumplimiento y obras grandes; lo que marca Vigía (competencia aparente,
vínculos, proveedores cautivos) casi no llega a sus informes. Un O/E bajo no prueba que una bandera falle: dice que mide
algo que el control no está mirando. Sí obliga a no presentar el puntaje como «probabilidad de irregularidad»: ordena por
cantidad de patrones de riesgo, no por lo que una auditoría encontraría.

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
- **`dji_funcionarios`/`dji_empleos` (1.8 M / 2.7 M)**: `apellidos_funcionario` y `funcionario_contratado` leen
  `dji_funcionarios`. `dji_empleos` hoy sólo se usa para deducir el RUC de la entidad del declarante.
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
- **Órdenes de 2026 (CONOSCE):** de 1 933 entidades que publicaron órdenes los doce meses de 2025, 1 092 publicaron en
  setiembre de 2026 y 188 no publican desde diciembre de 2025 (medido el 2026-11-18; la carga baja el año entero en cada
  corrida, así que no es lo registrado tarde). Casi ninguna de ellas aparece en las compras menores del SEACE. Una baja de
  órdenes en 2026 frente a 2025 puede ser falta de datos: `/ordenes/ventana` cuenta los meses con órdenes de cada periodo y
  la web y el MCP avisan; `/estado/datos` lo dice en la nota de la fuente. Los patrones de la historia buscan subidas, así
  que este hueco esconde casos pero no inventa.
- **Medido y descartado como señal por caso (2026-11-18): «obra atrasada sin penalidad».** De 990 obras de INFOBRAS desde
  2019 con 40 puntos o más de atraso físico o paralizadas por incumplimiento, sólo 16 (1,6 %) tienen una penalidad
  registrada por su propia entidad (155 tienen alguna, de cualquier entidad). La falta de penalidad es la norma: como
  bandera marcaría casi todo. Sirve como hallazgo del sistema (las entidades casi no registran las penalidades que el
  contrato obliga a aplicar), no para señalar un contrato.

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
5. La versión vigente de `refrescar_cruces()` es la de `211_aportes_unicos.sql` (las migraciones se redefinen en
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
  **Desde el 18-nov-2026 (migración 374)** cada cambio de estado o condición queda en `empresa_estado_sunat_cambio`
  con la ventana en que pasó (`desde_tras`, `visto`]: lo anota un trigger de `empresas` (padrón semanal, Consulta
  Múltiple o a mano). `estado_sunat_en(ruc, fecha)` dice el estado de ese día, o NULL si no se sabe (antes del padrón
  del 17-nov o dentro de la ventana de un cambio). Cuando haya cambios suficientes (unas 6 semanas): señal «orden
  emitida a una empresa ya de baja / no habida», atada a la orden con fecha de emisión posterior a `visto`.

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
  `objeto`, `cruces` (jsonb), `tipos` (array), `n_alta/n_media/n_baja`, `inhabilitada`,
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
- **Sin API SUNAT en la nube**: la identidad de proveedores de menores vino de la Consulta Múltiple de RUC oficial de la
  SUNAT, bajada desde una PC con navegador real; para nuevos hay que re-correrla.
- **Menores solo 2025–26** (el módulo es nuevo); no hay historia previa.
- **Lista de cotizantes de menores**: no es pública (solo el ganador).
- **Empate por nombre** cuando falta RUC/DNI/ubigeo: ~78% en el grafo del Estado, variable en otros cruces.
- **Precios**: referencia solo para bienes (no servicios ni menores, aún).

---

*Generado 2026-10-25 a partir del código y de la base en producción. Cifras aproximadas (reltuples). Para el detalle
exacto de cada umbral, ver el archivo:línea citado en cada sección.*
