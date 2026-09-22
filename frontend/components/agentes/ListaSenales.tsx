"use client";

/**
 * Las señales, en filas densas: severidad (color + ícono + palabra, vía <Severidad>), la regla,
 * el AGENTE que la produjo y el sello de cotejo. El detalle completo —evidencia, texto citado
 * del documento, norma, opinión OECE, páginas del expediente y fuente oficial— abre en un panel
 * al costado con <Revelar>, sin navegar: la lista filtrada de atrás es parte de la prueba.
 *
 * El sello y la fila no pueden ser el mismo botón (un botón dentro de otro botón no es HTML
 * válido ni es alcanzable con teclado), así que el sello va al costado, como hermano.
 */

import { ExternalLink, FileText } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Severidad } from "@/components/ui/Severidad";
import { severidadDeBandera } from "@/lib/severidad";
import { maskDnis, redactDnis } from "@/components/Redact";
import type { ReglasPerfil } from "@/lib/auditoria";
import { cn } from "@/lib/utils";
import { nombreDeAgente, pasoDeClave } from "./catalogo";
import { SelloVerificada } from "./SelloVerificada";
import type { SenalAgente } from "./senales";
import { descripcionDeRegla, etiquetaDeRegla } from "./useReglasPerfil";

export function ListaSenales({
  senales,
  reglas,
  mostrarSello = true,
}: {
  senales: SenalAgente[];
  reglas: ReglasPerfil | null;
  mostrarSello?: boolean;
}) {
  return (
    <ul className="divide-y divide-line">
      {senales.map((s, i) => {
        const sev = severidadDeBandera(s.severidad);
        const etiqueta = etiquetaDeRegla(s.regla, reglas);
        return (
          <li key={`${s.regla}-${i}`} className="flex items-start gap-2 px-3 py-2.5 sm:px-5">
            <span aria-hidden className={cn("mt-0.5 w-1 shrink-0 self-stretch rounded-full", sev.punto)} />
            <Revelar
              className="min-w-0 flex-1 rounded-lg px-1 py-0.5 transition-colors duration-rapido hover:bg-paperSoft"
              titulo={etiqueta}
              descripcion={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Severidad bandera={s.severidad} formato="linea" />
                  <span>
                    la encontró <strong className="font-semibold text-ink">{nombreDeAgente(s.agenteBruto ?? s.agente)}</strong>
                  </span>
                </span>
              }
              detalle={<DetalleSenal senal={s} etiqueta={etiqueta} descripcion={descripcionDeRegla(s.regla, reglas)} />}
              etiqueta={`Ver la evidencia de ${etiqueta}`}
            >
              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Severidad bandera={s.severidad} formato="punto" />
                <span className="text-[13px] font-medium leading-snug text-ink">{etiqueta}</span>
                <span className="text-[11px] text-mute">· {nombreDeAgente(s.agenteBruto ?? s.agente)}</span>
                {s.item && <span className="font-mono text-[10px] text-mute">ítem {s.item}</span>}
              </span>
              {/* En el resumen el DNI va enmascarado y no revelable: dentro de un botón, un clic
                  cerca del dato personal sería ambiguo. Se revela en el panel, deliberadamente. */}
              {s.evidencia && (
                <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-inkSoft">{maskDnis(s.evidencia)}</span>
              )}
            </Revelar>
            {mostrarSello && <SelloVerificada verificada={s.verificada} className="mt-0.5" />}
          </li>
        );
      })}
    </ul>
  );
}

function DetalleSenal({ senal, etiqueta, descripcion }: { senal: SenalAgente; etiqueta: string; descripcion: string | null }) {
  const agente = pasoDeClave(senal.agente);
  return (
    <div className="space-y-4 text-[13px] leading-relaxed text-ink">
      <div className="flex flex-wrap items-center gap-2">
        <Severidad bandera={senal.severidad} />
        <SelloVerificada verificada={senal.verificada} />
      </div>

      {descripcion && <p className="text-mute">{descripcion}</p>}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">Qué se encontró</h3>
        <p className="mt-1">{senal.evidencia ? redactDnis(senal.evidencia) : "El análisis no guardó el texto de esta señal."}</p>
      </section>

      {senal.evidenciaTextual && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">Texto del documento</h3>
          <blockquote className="mt-1 border-l-2 border-heroViolet/40 pl-3 italic text-inkSoft">
            {redactDnis(senal.evidenciaTextual)}
          </blockquote>
        </section>
      )}

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">Quién la produjo</h3>
        <p className="mt-1">
          <strong className="font-semibold">{nombreDeAgente(senal.agenteBruto ?? senal.agente)}</strong>
          {agente ? <span className="text-mute"> en el carril {agente.carrilLabel}</span> : null}
        </p>
        {agente && <p className="mt-0.5 text-mute">{agente.que}</p>}
        {agente && agente.fuentes.length > 0 && (
          <p className="mt-0.5 text-mute">Coteja contra: {agente.fuentes.join(", ")}.</p>
        )}
        {!agente && senal.agenteBruto && <p className="mt-0.5 font-mono text-[11px] text-mute">{senal.agenteBruto}</p>}
      </section>

      <section>
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">Norma citada</h3>
        <p className="mt-1">{senal.norma || "Esta señal no cita una norma: se sostiene solo en la evidencia de arriba."}</p>
      </section>

      {senal.opinion?.num && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">Opinión OECE</h3>
          <p className="mt-1 font-mono text-[12px]">{senal.opinion.num}</p>
          {senal.opinion.snippet && <p className="mt-1 italic text-inkSoft">{senal.opinion.snippet}</p>}
          {senal.opinion.url && (
            <a
              href={senal.opinion.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 inline-flex items-center gap-1 text-heroViolet hover:underline"
            >
              Abrir la opinión <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </section>
      )}

      {senal.citas.length > 0 && (
        <section>
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-mute">
            Páginas del expediente que la respaldan ({senal.citas.length})
          </h3>
          <ul className="mt-1 space-y-1.5">
            {senal.citas.map((c, i) => (
              <li key={i} className="border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-baseline gap-x-2 text-[12px] text-mute">
                  <FileText size={12} aria-hidden />
                  <span className="text-ink">{c.documentoTitulo ?? "Documento del expediente"}</span>
                  {c.pagina != null && <span className="font-mono">pág. {c.pagina}</span>}
                </p>
                {c.cita && <p className="mt-0.5 italic text-inkSoft">{redactDnis(c.cita)}</p>}
                {c.documentoUrl && (
                  <a
                    href={c.documentoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-heroViolet hover:underline"
                  >
                    Abrir el documento <ExternalLink size={11} aria-hidden />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {senal.fuenteUrl && (
        <a
          href={senal.fuenteUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-heroViolet hover:underline"
        >
          Ver la fuente oficial <ExternalLink size={12} aria-hidden />
        </a>
      )}

      <p className="border-t border-line pt-3 text-[12px] text-mute">
        Señal de riesgo, no acusación: {etiqueta.toLowerCase()} es un indicio que hay que verificar
        contra la fuente oficial antes de publicarlo o denunciarlo.
      </p>
    </div>
  );
}
