/**
 * /app/convocatoria/[id] — el informe de un contrato, plantilla Ficha (DESIGN_SYSTEM.md §14.2).
 *
 * Vista compartible del análisis. Soporta código corto (1203694), OCID completo
 * (ocds-...-1203694) o código de alerta (OECE-1203694). El <title> lo pone layout.tsx.
 *
 * Se arma en el SERVIDOR (lib/dossier-servidor.ts): la identidad, las cifras, el veredicto y
 * la pestaña Señales llegan en el HTML. Antes la página era un client component y el móvil
 * esperaba HTML vacío → ~370 KB de JS → ~360 KB de JSON antes de ver la cabecera (LCP 6,7 s).
 * El informe viaja sin la traza de los agentes: la pide "Cómo se hizo" al abrirse. Las demás
 * pestañas son módulos aparte que bajan al abrirlas (components/convocatoria/sections/PanelesDossier).
 *
 * Los estados de la PÁGINA (no encontrado, error) son los patrones con la llamita (§10.5), en
 * `DossierCliente`; `loading.tsx` cubre la espera. Dentro del informe no hay llamita: es evidencia.
 */

import { ResultadoView } from "@/components/convocatoria/ResultadoView";
import { Pagina } from "@/components/patrones";
import { cargarDossier, idLegible } from "@/lib/dossier-servidor";
import { DossierCliente } from "./DossierCliente";

/** Las claves de pestaña que existen (`?tab=`); cualquier otra abre la primera. */
const TABS = new Set(["resumen", "dictamen", "items", "proveedor", "documentos", "prensa", "trace"]);

export default async function ConvocatoriaSharePage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const id = idLegible(params.id);
  const pedida = typeof searchParams?.tab === "string" ? searchParams.tab : null;
  const tab = pedida && TABS.has(pedida) ? pedida : null;

  const carga = await cargarDossier(params.id);

  if (carga.estado === "ok") {
    return (
      <Pagina>
        <ResultadoView result={carga.result} tabInicial={tab} />
      </Pagina>
    );
  }

  // Sólo datos planos hacia el client component: nunca una función.
  return (
    <DossierCliente
      id={id}
      inicial={carga.estado === "error" ? "error" : carga.demo ? "demo" : "not_found"}
      mensaje={carga.estado === "error" ? carga.mensaje : undefined}
      tabInicial={tab}
    />
  );
}
