/**
 * Vuelca los mocks de `frontend/lib/` a JSON para el seed de Cloud SQL.
 *
 * Uso (desde el folder `frontend/`):
 *   npx tsx scripts/dump-mocks.ts > ../scripts/seed/mocks.json
 *
 * Se ejecuta desde la raíz del frontend porque ahí está el tsconfig con
 * los path aliases (`@/lib/...`).
 */

import { ENTIDADES, TIPO_LABELS } from "../lib/mock-entities";
import {
  ALERTAS_MOCK,
  REPORTES_MOCK,
  CONVERGENCIAS_MOCK,
} from "../lib/mock-data";
import { CHIRA_PIURA_EXPEDIENTE } from "../lib/mock-expedientes";

const out = {
  entidades: ENTIDADES,
  tipo_labels: TIPO_LABELS,
  alertas: ALERTAS_MOCK,
  reportes: REPORTES_MOCK,
  convergencias: CONVERGENCIAS_MOCK,
  expediente_chira_piura: CHIRA_PIURA_EXPEDIENTE,
  generated_at: new Date().toISOString(),
};

process.stdout.write(JSON.stringify(out, null, 2));
