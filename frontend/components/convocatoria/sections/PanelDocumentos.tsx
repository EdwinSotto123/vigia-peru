"use client";

/** Pestaña "Documentos" del informe, cargada con `next/dynamic` al abrirla (PanelesDossier). */

import { FileText } from "lucide-react";
import { setRedactNames } from "../../Redact";
import type { PanelDossierProps } from "./PanelesDossier";
import { AvisoSeccion } from "./AvisoSeccion";
import { DocumentosSection } from "./DocumentosSection";
import { RedFlagsDocumentalesSection } from "./RedFlagsDocumentalesSection";
import { CronologiaSection } from "./CronologiaSection";
import { CumplimientoNormativoSection } from "./CumplimientoNormativoSection";
import { FirmantesYAdjudicacionSection } from "./FirmantesYAdjudicacionSection";
import { SeccionSegura } from "./SeccionSegura";

export function PanelDocumentos({ result, conv, banderasArr, nombresSunat, nombresPrivados, ocidContrato, nDocs }: PanelDossierProps) {
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
      <SeccionSegura nombre="la línea de tiempo">
        <CronologiaSection convocatoria={conv} banderas={banderasArr} />
      </SeccionSegura>
      {result.normative_compliance && (
        <SeccionSegura nombre="el cumplimiento normativo">
          <CumplimientoNormativoSection nc={result.normative_compliance} sobreprecioMedido={result.market_analysis?.sobreprecio_pct != null} />
        </SeccionSegura>
      )}
    </div>
  );
}
