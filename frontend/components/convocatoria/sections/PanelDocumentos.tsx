"use client";

/**
 * Pestaña "Documentos" del informe, cargada con `next/dynamic` al abrirla (PanelesDossier): el expediente, quién firmó y
 * por qué ganó cada postor, y las señales que se leyeron en los documentos.
 *
 * Sin repetir (2026-11-23, el usuario: «secciones que aparecen una vez más»): la «Línea de tiempo del proceso» era la de
 * «Qué pasó» en La historia (y la de la ficha), y «Cumplimiento normativo» repetía cada señal de la pestaña Señales; ahora
 * sus opiniones del OECE van plegadas al pie de Señales.
 */

import { FileText } from "lucide-react";
import { setRedactNames } from "../../Redact";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { DocumentosSection } from "./DocumentosSection";
import { RedFlagsDocumentalesSection } from "./RedFlagsDocumentalesSection";
import { FirmantesYAdjudicacionSection } from "./FirmantesYAdjudicacionSection";
import { SeccionSegura } from "./SeccionSegura";

export function PanelDocumentos({ result, nombresSunat, nombresPrivados, ocidContrato, nDocs }: PanelDossierProps) {
  setRedactNames(nombresPrivados);
  const da = result.document_analysis || {};
  const hayFirmas = (da.firmantes || []).length > 0 || (da.motivos_adjudicacion || []).length > 0 || (da.comite_evaluacion || []).length > 0;
  return (
    <div className="space-y-4">
      {nDocs > 0 ? (
        <SeccionSegura nombre="la lista de documentos">
          <DocumentosSection
            documentos={result.documentos || []}
            parserDocs={da.documentos || []}
            fundamento={da.fundamento_legal || []}
            modalidad={da.modalidad}
            ocid={ocidContrato}
          />
        </SeccionSegura>
      ) : (
        <AvisoSeccion titulo="El registro OCDS no publica documentos para este proceso" icono={<FileText size={16} aria-hidden />}>
          Sin bases ni actas publicadas, no hubo expediente que leer.
        </AvisoSeccion>
      )}
      {hayFirmas && (
        <SeccionSegura nombre="los firmantes y motivos de adjudicación">
          <FirmantesYAdjudicacionSection
            firmantes={da.firmantes || []}
            comite={da.comite_evaluacion || []}
            motivos={da.motivos_adjudicacion || []}
            lugarFecha={da.lugar_fecha_acta}
            cruceFirmantes={result.person_network?.cruce_firmantes_ganador || []}
            nombresSunat={nombresSunat}
          />
        </SeccionSegura>
      )}
      {(da.red_flags_documentales || []).length > 0 && (
        <SeccionSegura nombre="las señales en los documentos">
          <RedFlagsDocumentalesSection flags={da.red_flags_documentales} />
        </SeccionSegura>
      )}
    </div>
  );
}
