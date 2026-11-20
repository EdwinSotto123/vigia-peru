import { CalendarCheck, FileCheck2, FileText, FileX2, Hash, Info, Landmark, Paperclip, ScrollText, UserRound } from "lucide-react";
import Link from "next/link";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha, InsigniaHecho } from "@/components/salud/comun";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, nombrePropio, numero, rutaMedico, type FichaIpress } from "@/lib/gobserva-salud";
import { Bloque, DetallePendiente, FilaDato, detalleLeido, enOracion } from "./piezas";

/**
 * La pestaña «Documentos»: lo que la IPRESS declaró en RENIPRESS (la resolución de su categoría, la de creación, la
 * fecha de registro, el responsable y cada documento con su número, fecha y si lo adjuntó). Todo con la advertencia de
 * que es declaración jurada: SUSALUD lo publica y la IPRESS responde por su veracidad. Server-safe.
 */
export function PestanaDocumentos({ f, base }: { f: FichaIpress; base: string }) {
  const renipress = f.fuentes.renipress?.url ?? "";
  const aviso = (
    <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-paperSoft px-4 py-3 text-meta leading-relaxed text-inkSoft">
      <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
      <p>
        <InsigniaHecho tipo="registro_administrativo" className="mr-1.5 align-[1px]" />
        Lo que dice RENIPRESS es declaración jurada de cada IPRESS (art. 7 de la R.S. N.° 004-2021-SUSALUD/S): SUSALUD lo publica, la
        IPRESS responde por su veracidad. «Adjunto» quiere decir que la IPRESS subió el archivo a RENIPRESS.
      </p>
    </div>
  );
  if (!detalleLeido(f)) {
    return (
      <div className="space-y-4">
        <CabeceraPestana>Lo que la IPRESS declaró en RENIPRESS: resoluciones, licencia y otros documentos.</CabeceraPestana>
        <DetallePendiente url={renipress} />
        {aviso}
      </div>
    );
  }
  const d = f.detalle;
  // La API manda el colegio ya escrito («Colegio Médico del Perú»); el tipo DetalleIpress todavía no lo declara.
  const colegio = (d as typeof d & { colegio?: string | null }).colegio ?? (nombrePropio(d.responsableColegio) || "Sin dato");
  return (
    <div className="space-y-5">
      <CabeceraPestana acciones={<FuenteFecha nombre="Detalle de RENIPRESS (SUSALUD)" url={f.fuentes.detalle?.url ?? renipress} al={d.leidoAl} />}>
        Lo que la IPRESS declaró en RENIPRESS: resoluciones, licencia y otros documentos.
      </CabeceraPestana>
      {aviso}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Bloque titulo="Registro y categoría" icono={ScrollText}>
          <dl>
            <FilaDato icono={ScrollText} t="Resolución de categoría">
              {d.categoriaDocumento ? (
                <>
                  {d.categoriaDocumento}
                  {d.categoriaFecha && <span className="text-inkSoft">, del {fechaCorta(d.categoriaFecha)}</span>}
                  {d.categoria && <span className="ml-2 inline-block"><Insignia tono="acento" className="font-mono">{d.categoria}</Insignia></span>}
                </>
              ) : (
                <span className="text-mute">No figura en RENIPRESS</span>
              )}
            </FilaDato>
            <FilaDato icono={Landmark} t="Resolución de creación">
              {d.resolucionCreacion ?? <span className="text-mute">No figura en RENIPRESS</span>}
            </FilaDato>
            <FilaDato icono={CalendarCheck} t="Registrada en RENIPRESS">
              {d.fechaRegistro ? `el ${fechaCorta(d.fechaRegistro)}` : <span className="text-mute">Sin fecha en RENIPRESS</span>}
            </FilaDato>
            {(d.situacionEstado || d.situacionCondicion) && (
              <FilaDato icono={Info} t="Situación declarada">
                {[d.situacionEstado, d.situacionCondicion && d.situacionCondicion !== d.situacionEstado ? d.situacionCondicion : null]
                  .filter(Boolean)
                  .map((x) => enOracion(x))
                  .join(", ")}
              </FilaDato>
            )}
            {d.ruc && (
              <FilaDato icono={Hash} t="RUC del propietario" mono>
                {d.ruc}
                {d.razonSocial && <span className="ml-2 font-sans text-inkSoft">{nombrePropio(d.razonSocial)}</span>}
              </FilaDato>
            )}
            {d.ambientes != null && <FilaDato icono={FileText} t="Ambientes declarados">{numero(d.ambientes)}</FilaDato>}
            {d.camas != null && <FilaDato icono={FileText} t="Camas declaradas">{numero(d.camas)}</FilaDato>}
          </dl>
        </Bloque>

        <Bloque titulo="Responsable de la atención" icono={UserRound} descripcion="Sólo su colegio y sus números: no mostramos nombres.">
          {d.responsableColegiatura ? (
            <>
            <dl>
              <FilaDato t="Colegio">{colegio}</FilaDato>
              <FilaDato t="Colegiatura" mono>{d.responsableColegiatura}</FilaDato>
              <FilaDato t="Registro de especialista (RNE)" mono>
                {d.responsableRne ?? <span className="font-sans text-mute">No figura en RENIPRESS</span>}
              </FilaDato>
            </dl>
              <div className="pt-3">
                <Link
                  href={rutaEn(base, rutaMedico(d.responsableColegiatura))}
                  prefetch={false}
                  className="inline-flex min-h-11 items-center text-dato font-semibold text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate"
                >
                  Cómo verificar esta colegiatura
                </Link>
                <p className="mt-1 text-meta leading-snug text-mute">
                  Su habilitación la confirma su colegio. Una sanción de la IPRESS no es una sanción a su responsable.
                </p>
              </div>
            </>
          ) : (
            <p className="text-dato text-inkSoft">RENIPRESS no trae el número de colegiatura del responsable.</p>
          )}
        </Bloque>
      </div>

      <Bloque
        titulo="Documentos declarados"
        icono={FileText}
        cuenta={numero(d.documentos.length)}
        descripcion="Cada documento que la IPRESS registró, con su número, su fecha y si subió el archivo a RENIPRESS."
      >
        {d.documentos.length ? (
          <ul className="divide-y divide-line">
            {d.documentos.map((doc, i) => (
              <li key={doc.id ?? `${doc.tipo}-${i}`} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="text-dato font-semibold text-ink">{enOracion(doc.tipo) || "Documento sin tipo"}</p>
                  <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
                    <span className="inline-flex items-center gap-1.5">
                      <Hash size={13} aria-hidden className="text-mute" />
                      {doc.numero ? <span className="font-mono">{doc.numero}</span> : <span className="text-mute">Sin número</span>}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <CalendarCheck size={13} aria-hidden className="text-mute" />
                      {doc.fecha ? fechaCorta(doc.fecha) : <span className="text-mute">Sin fecha</span>}
                    </span>
                  </p>
                </div>
                {doc.adjunto ? (
                  <Insignia tono="exito" Icono={Paperclip}>
                    Adjunto en RENIPRESS
                  </Insignia>
                ) : (
                  <Insignia tono="neutro" Icono={FileX2}>
                    Sin adjunto en RENIPRESS
                  </Insignia>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-start gap-2 text-dato text-inkSoft">
            <FileCheck2 size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
            No figura ningún documento declarado en RENIPRESS (consultado el {fechaCorta(d.leidoAl)}). La licencia municipal la da la municipalidad del distrito: pídela en el establecimiento.
          </p>
        )}
      </Bloque>
    </div>
  );
}
