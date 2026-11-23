import { ExternalLink, FileText, TriangleAlert } from "lucide-react";
import { documentosOece } from "@/lib/documentosOece";
import { procesoOece } from "@/lib/fuentes";
import { fechaConAnio } from "@/lib/formato";

/**
 * Los documentos de un proceso que Vigía todavía no tiene entre sus contratos (sin OCID en su base), leídos del registro
 * del OECE en el servidor: bases, buena pro, contrato, prórrogas, cada uno a su descarga del SEACE. Y lo que eso cuesta,
 * dicho: sin el proceso, Vigía no lo analizó ni le buscó banderas. Pedido del usuario del 2026-11-23 («¿por qué no trae
 * documentos? … perdemos información»): la orden de alquiler de la Municipalidad de Lima venía de una contratación directa
 * con seis PDF publicados y el panel no mostraba ninguno.
 *
 * Componente de servidor (async): el OECE no deja leer su API desde el navegador. Un día en caché (lib/documentosOece).
 */
export async function DocumentosProceso({ codigo, aviso = true }: { codigo: string; aviso?: boolean }) {
  const r = await documentosOece(codigo);
  const docs = r?.documentos ?? [];
  return (
    <div className="space-y-2">
      {aviso && (
        <p className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber-soft px-3 py-2 text-meta leading-snug text-amberTexto">
          <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Vigía todavía no tiene este proceso entre sus contratos: no lo analizó ni le buscó banderas.
            {docs.length > 0 ? " Sus documentos, del registro del OECE:" : ""}
          </span>
        </p>
      )}
      {docs.length > 0 && (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-paper" aria-label={`Los ${docs.length} documentos del proceso`}>
            {docs.map((d) => (
              <li key={d.url}>
                <a href={d.url} target="_blank" rel="noreferrer" className="flex items-start gap-2.5 px-3 py-2 text-meta transition-colors duration-rapido hover:bg-granate-50">
                  <FileText size={15} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink">{d.titulo}</span>
                    <span className="block text-rotulo text-mute">
                      {d.etapa}
                      {d.fecha ? `, ${fechaConAnio(d.fecha)}` : ""}
                    </span>
                  </span>
                  <ExternalLink size={13} className="mt-1 shrink-0 text-mute" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
          <p className="text-rotulo text-mute">Se descargan del SEACE: son los archivos que publicó la entidad.</p>
        </>
      )}
      {/* Su ficha en Contrataciones Abiertas, con el OCID armado del código: abre en el navegador de quien lee, con sus
          documentos. Es lo que queda cuando el servidor no pudo leer el registro (el OECE responde 403 a la IP de
          Cloudflare; la carga diaria pasa por el relay, que no se usa para cada panel). */}
      <a
        href={procesoOece(codigo)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-meta font-semibold text-granate underline-offset-2 hover:underline"
      >
        {docs.length > 0 ? "El proceso en Contrataciones Abiertas (OECE)" : "Sus documentos (bases, buena pro, contrato) en Contrataciones Abiertas (OECE)"}
        <ExternalLink size={12} aria-hidden />
      </a>
    </div>
  );
}
