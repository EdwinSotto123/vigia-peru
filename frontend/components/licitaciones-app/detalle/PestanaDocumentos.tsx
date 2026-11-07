import { ArrowUpRight, FileText, FolderOpen } from "lucide-react";
import { limpiar } from "@/lib/licitaciones";
import { fechaCortaLima } from "@/lib/licitaciones-app/formato";
import type { DetalleOportunidad } from "@/lib/licitaciones-app/tipos";
import { Caja } from "@/components/gobserva/app/Caja";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { EstadoVacio } from "../ui/Estados";
import { Insignia } from "../ui/Insignia";

/** Los nombres de los tipos de documento del OCDS, como los dice un proveedor. */
const TIPO_DOC: Record<string, string> = {
  biddingDocuments: "Bases",
  tenderNotice: "Convocatoria",
  technicalSpecifications: "Especificaciones técnicas",
  clarifications: "Absolución de consultas",
  evaluationReports: "Informe de evaluación",
  awardNotice: "Buena pro",
  contractSigned: "Contrato",
  complaints: "Recursos",
  eligibilityCriteria: "Requisitos de calificación",
};

/** Los documentos publicados, cada uno abre el archivo oficial del SEACE. */
export function PestanaDocumentos({ o }: { o: DetalleOportunidad }) {
  return (
    <Caja
      id="docs"
      titulo={`${o.documentos.length} ${o.documentos.length === 1 ? "documento" : "documentos"}`}
      descripcion="Los archivos oficiales que publicó la entidad en el SEACE"
      relleno={false}
    >
      {o.documentos.length === 0 ? (
        <EstadoVacio
          Icono={FolderOpen}
          titulo="Sin documentos en los datos abiertos"
          texto="Puede que la entidad los haya subido sólo al SEACE: búscalos en la ficha oficial del proceso."
          acciones={
            <a href={o.enlaces.seace} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
              Abrir la ficha oficial <ArrowUpRight size={15} aria-hidden />
            </a>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {o.documentos.map((d, i) => (
            <li key={`${d.url}-${i}`}>
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="group flex items-start gap-3 px-4 py-3.5 transition-colors duration-rapido hover:bg-ink/[0.03] sm:px-5">
                <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-ink/[0.06] text-inkSoft">
                  <FileText size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-dato font-semibold text-ink group-hover:text-granate group-hover:underline">{limpiar(d.titulo) || "Documento sin título"}</span>
                  <span className="mt-1 flex flex-wrap items-center gap-2 text-meta text-mute">
                    <Insignia>{TIPO_DOC[d.tipo ?? ""] ?? "Documento"}</Insignia>
                    {d.formato && <span className="uppercase">{d.formato}</span>}
                    {d.fecha && <span>{fechaCortaLima(d.fecha)}</span>}
                  </span>
                </span>
                <ArrowUpRight size={16} aria-hidden className="mt-1 shrink-0 text-mute group-hover:text-granate" />
                <span className="sr-only"> (abre el archivo del SEACE en otra pestaña)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Caja>
  );
}
