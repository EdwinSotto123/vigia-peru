/**
 * El detalle técnico de cada fuente del mapa de la portada: lo que se captura,
 * el código que la limpia, la tabla donde queda, cuándo corre y lo que todavía
 * no funciona. Va con la misma `clave` que `fuentesFlujo.ts`.
 *
 * Es documentación para quien quiera verificar el mapa, no algo que se pinte:
 * ningún componente cliente importa este módulo, así que no viaja al
 * navegador. Lo que la portada muestra, en palabras llanas, está en
 * `fuentesFlujo.ts`.
 *
 * Todo sale del repo, verificado el 24 de setiembre de 2026:
 *  - campos crudos y código: `backend/scrapers/<fuente>/pipeline.py` y
 *    `backend/scripts/*.py`, con sus números de línea reales. El código está
 *    RECORTADO con "…", nunca reescrito.
 *  - horarios: `backend/cloud_functions/<fuente>/cloudbuild.yaml` (Cloud
 *    Scheduler, America/Lima) e `infrastructure/deploy/batch-nocturno.sh`.
 *  - tablas y usos: migraciones, `backend/agent/tools/*` y docs/design/DATASETS.md.
 *
 * Cuando lo que llega a las revisiones no es lo que baja el job automático
 * (sancionados, JNE), el código de acá es el de la carga que SÍ llega, y el
 * job queda descrito en `nota`.
 *
 * Si cambia un pipeline, esto se actualiza con él: un número de línea que ya
 * no coincide es un dato inventado.
 */

export interface LineaCodigo {
  /** Número de línea en el archivo real. Vacío en las elisiones. */
  n?: number;
  texto: string;
  /** Índice del paso de `pasos` que cubre esta línea. Crece, nunca retrocede. */
  paso: number;
}

export interface FuenteTecnica {
  nombre: string;
  /** La cadencia corta. */
  cadencia: string;
  /** La cadencia completa, con hora y dónde corre. */
  cuando: string;
  /** Lo que no funciona o nadie usa todavía, dicho sin maquillaje. */
  nota?: string;
  captura: { formato: string; origen: string; campos: string[] };
  pasos: string[];
  codigo: { archivo: string; lineas: LineaCodigo[] };
  extrae: { tabla: string; columnas: string[]; vacio?: string };
}

/** Quita la sangría común para que el recorte se lea desde el margen. */
function codigo(archivo: string, filas: [n: number | null, paso: number, texto: string][]): FuenteTecnica["codigo"] {
  const sangria = Math.min(
    ...filas.filter(([, , t]) => t.trim() && t.trim() !== "…").map(([, , t]) => t.length - t.trimStart().length),
  );
  return {
    archivo,
    lineas: filas.map(([n, paso, texto]) => ({
      n: n ?? undefined,
      paso,
      texto: texto.trim() === "…" ? "…" : texto.slice(sangria),
    })),
  };
}

export const FUENTES_TECNICO: Record<string, FuenteTecnica> = {
  seace: {
    nombre: "SEACE / OECE, contrataciones abiertas",
    cadencia: "cada noche",
    cuando: "Cada noche a la 1:30, desde una conexión peruana: el OECE bloquea a los servidores en la nube.",
    captura: {
      formato: "API OCDS · JSON",
      origen: "contratacionesabiertas.oece.gob.pe/api/v1/releasesAfter",
      campos: ["ocid", "date", "parties[].roles", "additionalIdentifiers PE-RUC", "tender.value.amount", "tender.tenderPeriod", "tender.description", "documents[].url"],
    },
    pasos: ["Leer la página", "Normalizar", "Sin duplicados", "Siguiente"],
    codigo: codigo("backend/scrapers/oece_ocds/pipeline.py", [
      [210, 0, "            for rel in rels:"],
      [211, 1, "                row = normalize_release(rel, ix)"],
      [212, 1, "                if not row:"],
      [213, 1, "                    continue"],
      [214, 2, '                prev = self.rows.get(row["ocid"])'],
      [215, 2, '                if prev is None or row["date"] > prev["date"]:'],
      [216, 2, '                    self.rows[row["ocid"]] = row'],
      [217, 3, '            url = (data.get("links") or {}).get("next")'],
    ]),
    extrae: {
      tabla: "convocatorias",
      columnas: ["ocid", "entidad_ruc", "objeto", "cuantia_referencial", "fecha_convocatoria", "ubigeo", "tipo_contratacion", "etapa"],
    },
  },
  rnp: {
    nombre: "Socios y representantes (RNP)",
    cadencia: "a mano",
    cuando: "Se descarga a mano del Registro Nacional de Proveedores: no está en datos abiertos. Es una foto completa del registro.",
    nota: "Es la llave de los cruces: sin ella, una visita o un aporte de campaña no se puede atar a la empresa que se presentó al contrato.",
    captura: {
      formato: "CSV · separado por | · 1,44 millones de filas",
      origen: "Registro Nacional de Proveedores (OECE)",
      campos: ["FECHA_CORTE", "TIPO_DOCUMENTO", "NUMERO_DOCUMENTO", "NOMBRE_RAZONODENOMINACIONSOCIAL", "RUC", "TIPO_CONF_JURIDICA", "FECHA_INICIO_VIGENCIA", "DE_FORMA_SOCIETARIA"],
    },
    pasos: ["Validar el documento", "Validar el RUC", "Normalizar el nombre"],
    codigo: codigo("backend/scripts/rnp_normalize.py", [
      [93, 0, '            numero_documento = numero_documento_raw.strip().replace("\\t", "")'],
      [94, 0, '            if not numero_documento or numero_documento.upper() == "NO ESPECIFICADO":'],
      [null, 0, "…"],
      [97, 0, "            if len(numero_documento) < 5:"],
      [null, 1, "…"],
      [101, 1, "            ruc = ruc_raw.strip()"],
      [102, 1, "            if len(ruc) != 11 or not ruc.isdigit():"],
      [null, 2, "…"],
      [112, 2, "            nombre_original = nombre_raw.strip()"],
      [113, 2, "            nombre = normalize_name(nombre_original)"],
    ]),
    extrae: {
      tabla: "rnp_conformacion_juridica",
      columnas: ["numero_documento", "nombre", "ruc_empresa", "tipo_rol", "fecha_inicio_vigencia", "forma_societaria"],
    },
  },
  sancionados: {
    nombre: "Proveedores sancionados (OECE)",
    cadencia: "a mano",
    cuando:
      "A mano: el XLSX de tres hojas (multa, definitivo, temporal) se exporta del Buscador de Proveedores del Estado (apps.osce.gob.pe/perfilprov-ui, Angular + reCAPTCHA) y se carga con backend/scripts/load_sancionados_osce.py.",
    nota:
      "El job semanal `pnda_sancionados` (domingos 8:00, Cloud Scheduler) baja los CSV de la PNDA a `osce_sancionados`, pero no escribe `estado`; la vista `osce_sancionados_vigentes` (backend/db/schemas/osce_sancionados_schema.sql) exige `estado = 'VIGENTE'`, así que esas filas nunca llegan a la regla C4/C7 (backend/agent/tools/compliance_rules/_rules_provider.py). La regla trabaja sobre la carga manual: al 23-09-2026, 3 888 filas (3 112 vigentes) contra 2 395 del job que quedan fuera. Por eso la portada la describe como carga a mano, sin fecha próxima.",
    captura: {
      formato: "XLSX · 3 hojas (multa, definitivo, temporal)",
      origen: "apps.osce.gob.pe/perfilprov-ui",
      campos: ["TIPO", "Razon Social", "RUC", "Resolución", "Periodo", "Desde", "Hasta", "Estado"],
    },
    pasos: ["Fila con número", "Validar el RUC", "Guardar con su estado"],
    codigo: codigo("backend/scripts/load_sancionados_osce.py", [
      [125, 0, "        has_id = bool(clean(row[0]))"],
      [126, 0, "        if has_id:"],
      [127, 1, "            razon = clean(row[2])"],
      [128, 1, "            ruc = clean(row[3])"],
      [129, 1, "            if not ruc:"],
      [130, 1, "                continue"],
      [null, 2, "…"],
      [138, 2, '                "ruc": ruc,'],
      [139, 2, '                "es_persona_natural": ruc.startswith("10"),'],
      [null, 2, "…"],
      [149, 2, '                "estado": clean(row[11]) or None,'],
    ]),
    extrae: {
      tabla: "osce_sancionados → osce_sancionados_vigentes",
      columnas: ["tipo", "razon_social_norm", "ruc", "es_persona_natural", "resolucion", "fecha_desde", "fecha_hasta", "estado"],
    },
  },
  visitas: {
    nombre: "Registro de visitas",
    cadencia: "a mano",
    cuando:
      "Las exportaciones del botón «Excel» del portal de la PCM se hacen a mano (Turnstile bloquea la automatización) y se cargan con `--xlsx` como fuente='portal_visitas_manual'. El dataset de la PNDA corre solo los días 1 y 15 a las 8:00, hora de Lima, en la nube.",
    nota: "El dataset abierto trae una sola entidad, el Gobierno Regional de Loreto. Las otras 345 salen de exportaciones del portal de la PCM, que se hacen a mano porque el portal bloquea la automatización. Por eso la portada no promete una próxima fecha.",
    captura: {
      formato: "XLSX · uno por mes",
      origen: "datosabiertos.gob.pe",
      campos: ["Fecha de Visita", "Entidad visitada", "Visitante", "Documento del visitante", "Funcionario visitado", "Hora Ingreso", "Hora Salida", "Motivo"],
    },
    pasos: ["¿Cambió el archivo?", "Leer el Excel", "Reemplazar el mes"],
    codigo: codigo("backend/scrapers/pnda_visitas/pipeline.py", [
      [218, 0, "                        if not self.force and sha and ya_cargado(cur, self.name, periodo, sha):"],
      [219, 0, '                            log.info("   %s: ya cargado con el mismo sha256, se salta", periodo)'],
      [220, 0, "                            continue"],
      [221, 1, "                rows, bad = parse_xlsx(p)"],
      [null, 2, "…"],
      [228, 2, "                    # Reemplazo por periodo, solo de esta fuente (las exportaciones manuales del"],
      [229, 2, "                    # portal PCM conviven con otra `fuente` y no se tocan)."],
      [230, 2, '                    cur.execute("DELETE FROM visitas_entidades WHERE periodo = %s AND fuente = %s", (periodo, self.name))'],
    ]),
    extrae: {
      tabla: "visitas_entidades",
      columnas: ["fecha_visita", "entidad_visitada_norm", "visitante_norm", "numero_documento", "funcionario_nombre", "funcionario_cargo", "duracion_min", "periodo"],
    },
  },
  onpe: {
    nombre: "Aportes de campaña (ONPE Claridad)",
    cadencia: "a mano",
    cuando: "La lanza una persona, con un navegador abierto: el portal está detrás de Cloudflare y un captcha. Una vez al mes, y cada semana en campaña.",
    captura: {
      formato: "JSON · desde el navegador",
      origen: "claridad.onpe.gob.pe/claridad-backend/portal",
      campos: ["dni", "razonSocial", "apellidos", "nombres", "fechaAporte", "monto", "tipoAporte", "anioEleccion"],
    },
    pasos: ["Huella del aporte", "Validar el documento", "Normalizar el nombre"],
    codigo: codigo("backend/scrapers/onpe_claridad/pipeline.py", [
      [119, 0, '        clave = hashlib.sha1("|".join(['],
      [120, 0, '            proceso, ruc_org or "", org, docn, nombre_orig, a.get("fechaAporte") or "", f"{monto}", a.get("tipoAporte") or "",'],
      [121, 0, "        ]).encode()).hexdigest()"],
      [122, 1, "        rows.append({"],
      [123, 1, '            "numero_documento": docn if docn.isdigit() and len(docn) in (8, 11) else (docn or None),'],
      [124, 2, '            "nombre": norm(nombre_orig) or (docn or ""),'],
    ]),
    extrae: {
      tabla: "onpe_aportantes",
      columnas: ["numero_documento", "nombre", "partido", "fecha_aporte", "monto", "tipo_aporte", "proceso"],
    },
  },
  jne: {
    nombre: "Candidatos y autoridades electas (JNE Infogob)",
    cadencia: "a mano",
    cuando:
      "A mano, por proceso electoral: Infogob está detrás de Incapsula y un captcha de imagen. Se carga con `python -m backend.scrapers.jne_infogob.pipeline --root dataset/ELECCIONES`, que usa backend/scripts/load_jne_candidaturas.py.",
    nota:
      "Los agentes leen `jne_candidaturas` (backend/agent/tools/personas/electoral.py, red_network.py, patrones.py). El job mensual `jne_infogob` (día 5, 8:00, Cloud Scheduler) escribe `jne_autoridades`, que no lee ningún agente, ruta del API ni el MCP; a los agentes sólo les aporta el DNI que completa en `jne_candidaturas` desde `onpe_candidatos`. Además, al 24-09-2026 su slug `autoridades-vigentes-jne` redirige al buscador de la PNDA (el dataset pasó a `autoridades-vigentes-nivel-nacional-jurado-nacional-de-elecciones`), así que ese job falla.",
    captura: {
      formato: "XLSX · uno por proceso (Candidatos / Autoridades)",
      origen: "infogob.jne.gob.pe · Base de datos",
      campos: ["PRIMER APELLIDO", "SEGUNDO APELLIDO", "PRENOMBRES", "ORGANIZACION POLITICA", "CARGO", "REGION", "PROVINCIA", "DISTRITO"],
    },
    pasos: ["¿Electo o candidato?", "Armar el nombre", "Cargo, partido y lugar"],
    codigo: codigo("backend/scripts/load_jne_candidaturas.py", [
      [52, 0, "def detect_resultado(p: Path) -> str:"],
      [53, 0, "    name = p.stem.lower()"],
      [54, 0, '    if "autoridad" in name or "electo" in name:'],
      [55, 0, '        return "electo"'],
      [null, 1, "…"],
      [136, 1, '        ap1 = g("ap1")'],
      [137, 1, '        ap2 = g("ap2")'],
      [138, 1, '        nombres = g("nombres")'],
      [139, 1, '        full = " ".join(filter(None, [ap1, ap2, nombres])).strip()'],
      [null, 2, "…"],
      [142, 2, '        cargo = g("cargo") or cargo_default'],
      [143, 2, '        partido = g("partido")'],
      [144, 2, '        region = g("region")'],
    ]),
    extrae: {
      tabla: "jne_candidaturas",
      columnas: ["nombre", "partido", "año", "cargo", "resultado", "region", "provincia", "distrito"],
    },
  },
  dji: {
    nombre: "Declaraciones juradas de intereses",
    cadencia: "detenida",
    cuando: "Agendada el día 5 de cada mes a las 8:00, hora de Lima, en la nube.",
    nota:
      "Se cargó completa (1 826 967 declaraciones y 2 726 382 empleos previos), pero ninguna revisión la cruza todavía. Además, al 24-09-2026 los slugs del pipeline redirigen al buscador de la PNDA: los datasets pasaron a `declaraciones-juradas-de-intereses-presentadas-ante-la-contraloría` y `empleos-declarados-en-las-declaraciones-juradas-de-intereses-contraloría`, así que el job mensual falla y la copia no se renueva.",
    captura: {
      formato: "CSV · 268 MB y 442 MB",
      origen: "datosabiertos.gob.pe",
      campos: ["CODIGO_DDJJ", "TIPO_DOCUMENTO_FUNCIONARIO", "APELLIDO_PATERNO", "APELLIDO_MATERNO", "NOMBRES", "ENTIDAD", "CARGO", "RUC_ENTIDAD_LABORO"],
    },
    pasos: ["¿Cambió el archivo?", "Cargar la foto completa", "Sacar el RUC"],
    codigo: codigo("backend/scrapers/pnda_dji/pipeline.py", [
      [121, 0, "                if not self.force and ya_cargado(cur, self.name, part, sha):"],
      [122, 0, '                    log.info("   %s: ya cargado con el mismo sha256, se salta", part)'],
      [123, 0, "                    return"],
      [null, 1, "…"],
      [125, 1, '                cur.execute(f"TRUNCATE {table}")  # los reportes son fotos completas, no deltas'],
      [126, 1, "                cur.copy_expert("],
      [127, 1, "                    f\"COPY {table} ({', '.join(cols)}) FROM STDIN WITH (FORMAT csv, HEADER true, NULL '')\", f"],
      [128, 1, "                )"],
      [null, 2, "…"],
      [131, 2, '                if table == "dji_empleos":'],
      [132, 2, "                    # 'RUC:20100211034' → '20100211034'"],
      [133, 2, "                    cur.execute(r\"UPDATE dji_empleos SET ruc_entidad = substring(ruc_entidad_raw from '\\d{11}') WHERE ruc_entidad IS NULL\")"],
    ]),
    extrae: {
      tabla: "dji_funcionarios · dji_empleos",
      columnas: ["nombre_norm", "entidad", "cargo", "ruc_entidad"],
    },
  },
  mef: {
    nombre: "Presupuesto (MEF)",
    cadencia: "detenida",
    cuando: "Agendada el día 12 de cada mes a las 8:00, hora de Lima, en la nube.",
    nota: "El 23 de setiembre de 2026 la API del MEF respondía 404 a toda consulta, y el 24, 500. Los paneles de presupuesto muestran la última copia guardada.",
    captura: {
      formato: "API · JSON",
      origen: "api.datosabiertos.mef.gob.pe",
      campos: ["DEPARTAMENTO_EJECUTORA_NOMBRE", "PIA_{año}", "PIM_{año}", "DEVENGADO_{año}", "GIRADO_{año}", "SECTOR_NOMBRE", "PLIEGO_NOMBRE", "PROGRAMA_PPTO_NOMBRE"],
    },
    pasos: ["Armar la consulta", "Sumar lo asignado y lo gastado", "Filtrar la región"],
    codigo: codigo("backend/scripts/fetch_mef_budget.py", [
      [55, 0, "def _sql_year_totals(dept: str, year: int) -> str:"],
      [56, 0, "    d = dept.replace(\"'\", \"''\")"],
      [57, 0, "    return ("],
      [58, 1, "        f'SELECT COUNT(*) AS rows, '"],
      [59, 1, "        f'SUM(\"PIA_{year}\"::numeric) AS pia, '"],
      [60, 1, "        f'SUM(\"PIM_{year}\"::numeric) AS pim, '"],
      [61, 1, "        f'SUM(\"DEVENGADO_{year}\"::numeric) AS dev, '"],
      [62, 1, "        f'SUM(\"GIRADO_{year}\"::numeric) AS gir '"],
      [63, 2, "        f'FROM \"{RESOURCE}\" '"],
      [64, 2, "        f\"WHERE \\\"DEPARTAMENTO_EJECUTORA_NOMBRE\\\" = '{d}'\""],
    ]),
    extrae: {
      tabla: "mef_region_budget",
      columnas: ["departamento", "by_year", "top_sectores", "top_pliegos", "top_programas"],
    },
  },
  "datasets-oece": {
    nombre: "Datasets OECE",
    cadencia: "día 1",
    cuando: "El día 1 de cada mes a las 9:00, hora de Lima, en la nube.",
    nota: "Se descarga y se archiva con su huella, pero todavía no se lee: ninguna revisión la usa.",
    captura: {
      formato: "CSV, XLSX y ZIP · 7 conjuntos",
      origen: "datosabiertos.gob.pe",
      campos: ["ofertantes", "proveedores_consorcios", "sican", "pronunciamientos", "cuadernos_obra", "cuadernos_obra_asientos", "valorizaciones"],
    },
    pasos: ["Buscar el conjunto", "Listar archivos", "Guardar el crudo"],
    codigo: codigo("backend/scrapers/pnda_oece/pipeline.py", [
      [69, 0, "            try:"],
      [70, 0, "                ds = pnda.fetch_dataset(slug)"],
      [71, 0, "            except LookupError as e:"],
      [72, 0, '                log.warning("%s", e)'],
      [73, 0, "                continue"],
      [74, 1, "            res = ds.data_resources()"],
      [null, 2, "…"],
      [76, 2, "            for r in res:"],
      [77, 2, '                paths.append(self.store.fetch(r.url, f"{key}__{r.filename}", ds.modified, force=self.force))'],
    ]),
    extrae: {
      tabla: "gs://vigia-peru-batch/raw/pnda_oece/",
      columnas: [],
      vacio: "Ninguna tabla todavía: los archivos quedan en crudo, cada uno con su sha256, hasta que se escriba su lector.",
    },
  },
};
