# Datasets peruanos — guía de carga

Tres datasets oficiales que el `person_network_agent` puede consultar vía Cloud SQL. Las tools (`query_onpe_aportantes`, `query_jne_candidaturas`, `query_pep`) ya están deployadas y son **schema-aware**: si la tabla no existe aún, devuelven `dataset_no_disponible: true` sin romper el pipeline. Apenas cargás la tabla, la tool empieza a aportar valor.

## 1. ONPE Aportantes (financiamiento político)

**Fuente**: https://www.datosabiertos.gob.pe/dataset/aportantes-onpe
**Schema**: `backend/db/schemas/onpe_aportantes_schema.sql`
**Cargar**:

```bash
# 1. Crear tabla
gcloud sql connect vigia-db --user=postgres --database=vigia < backend/db/schemas/onpe_aportantes_schema.sql

# 2. Descargar dataset (CSV anual desde datos abiertos)
curl -L "https://www.datosabiertos.gob.pe/sites/default/files/Aportantes-2022-2026.csv" \
  -o /tmp/onpe.csv

# 3. Normalizar + upload a GCS + import a Cloud SQL
python backend/scripts/onpe_aportantes_load.py --csv /tmp/onpe.csv
```

## 2. JNE Candidaturas

**Fuente**: PNDA via CKAN o https://plataformaelectoral.jne.gob.pe/
**Schema**: `backend/db/schemas/jne_candidaturas_schema.sql`

Hay dataset abierto en CKAN-PNDA: `https://www.datosabiertos.gob.pe/dataset/candidatos-elecciones`.

```bash
gcloud sql connect vigia-db --user=postgres --database=vigia < backend/db/schemas/jne_candidaturas_schema.sql
python backend/scripts/jne_candidaturas_load.py --csv /tmp/jne_candidatos.csv
```

## 3. PEPs (Personas Expuestas Políticamente)

**Fuente**: SBS UIF — lista oficial PEPs Perú.
**Schema**: `backend/db/schemas/peps_schema.sql`

No hay dataset abierto directo. Opciones:
- Compilar manualmente desde resoluciones SBS (~10K registros).
- Usar el listado de **Servidores Públicos** del SERVIR (más amplio, ~500K).

```bash
gcloud sql connect vigia-db --user=postgres --database=vigia < backend/db/schemas/peps_schema.sql
python backend/scripts/peps_load.py --csv /tmp/peps.csv
```

## Verificar después de cargar

```bash
curl "https://agent-orchestrator-adk-36169102688.us-central1.run.app/?action=load&ocid=<algún_ocid>"
# Reprocesá una convocatoria nueva — el person_network_agent va a llamar las
# 3 tools automáticamente (ver PASO 7.5.c.bis en el prompt del orquestador).
```

## Notas

- Las tools normalizan el query: si pasás "Pérez Mendoza", busca también "PEREZ MENDOZA" (sin tildes).
- Si pasás un DNI (8 dígitos numéricos), match exacto por `numero_documento`.
- Cualquier persona faltante en los datasets no detiene el flujo — el agente igual hace su Google Search OSINT.
