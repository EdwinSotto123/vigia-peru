"use client";

/**
 * Las piezas de una señal que comparten el informe (/app/convocatoria/[id]) y el índice de
 * señales (/app/hallazgos): la evidencia de la fila en texto plano y sin datos personales
 * (`resumenSinDatosPersonales` / `ResumenEvidencia`) y la ficha completa del panel lateral
 * (`DetalleSenal`). La lista en sí es la `Tabla` del kit (components/listado): la arma
 * AuditoriaDeAgentes en el informe y components/alertas/ListaSenales en el índice.
 */

import { ExternalLink, FileText } from "lucide-react";
import { Severidad } from "@/components/ui/Severidad";
import { maskDnis, pareceEmpresa, redactDnis, type NombreConocido } from "@/components/Redact";
import { nombreDeAgente, pasoDeClave } from "./catalogo";
import { SelloVerificada } from "./SelloVerificada";
import type { SenalAgente } from "./senales";

/** Lo que cabe en una línea de la fila: el resto de la evidencia está en el panel. */
const MAX_RESUMEN = 160;

/**
 * La palabra que `PersonName` tapa de cada persona privada: en orden SUNAT el materno (2.ª
 * palabra), con el nombre primero la última. Es la misma en los dos órdenes, salvo con dos
 * palabras, donde cada orden tapa una distinta: van las dos. Las de una o dos letras ("DE",
 * "LA") no se tapan sueltas: taparían media oración.
 */
function apellidosPrivados(nombres: NombreConocido[]): Set<string> {
  const out = new Set<string>();
  for (const n of nombres) {
    const nombre = String((n && typeof n === "object" ? n.nombre : n) || "").normalize("NFC").trim();
    const partes = nombre.split(/\s+/).filter(Boolean);
    if (partes.length < 2 || pareceEmpresa(nombre, n && typeof n === "object" ? n.ruc : null)) continue;
    const sunat = !!n && typeof n === "object" && n.orden === "sunat";
    const tapadas = partes.length === 2 ? partes : [sunat ? partes[1] : partes[partes.length - 1]];
    for (const p of tapadas) if (p.length > 2) out.add(sinTildes(p));
  }
  return out;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * La evidencia de la fila, en texto plano y corta: DNI/RUC 10 enmascarados y el apellido de
 * cada persona privada del dossier tapado donde aparezca (de más, nunca de menos). El texto
 * completo, con el vidrio revelable, está en el panel.
 */
export function resumenSinDatosPersonales(texto: string, nombres: NombreConocido[] = []): string {
  const t = maskDnis(texto.normalize("NFC"));
  const tapar = apellidosPrivados(nombres);
  const limpio = tapar.size ? t.replace(/\p{L}+/gu, (w) => (tapar.has(sinTildes(w)) ? "•".repeat(Math.min(Math.max(w.length, 3), 8)) : w)) : t;
  if (limpio.length <= MAX_RESUMEN) return limpio;
  const corte = limpio.slice(0, MAX_RESUMEN);
  const esp = corte.lastIndexOf(" ");
  return `${esp > MAX_RESUMEN * 0.6 ? corte.slice(0, esp) : corte}…`;
}

/**
 * El mismo resumen como componente: la función vive en este módulo cliente, así que un
 * server component (la tabla de /app/hallazgos) la usa a través de aquí, pasando sólo datos.
 */
export function ResumenEvidencia({ texto, nombres }: { texto: string; nombres?: NombreConocido[] }) {
  return <>{resumenSinDatosPersonales(texto, nombres)}</>;
}

export function DetalleSenal({ senal, etiqueta, descripcion }: { senal: SenalAgente; etiqueta: string; descripcion: string | null }) {
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
          <blockquote className="mt-1 border-l-2 border-granate/40 pl-3 italic text-inkSoft">
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
              className="mt-1 inline-flex items-center gap-1 text-granate hover:underline"
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
                    className="mt-0.5 inline-flex items-center gap-1 text-[12px] text-granate hover:underline"
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
          className="inline-flex items-center gap-1 font-medium text-granate hover:underline"
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
