"use client";

/**
 * Las piezas de una señal que comparten el informe (/app/convocatoria/[id]) y el índice de
 * señales (/app/hallazgos): la evidencia de la fila en texto plano y sin datos personales
 * (`resumenSinDatosPersonales` / `ResumenEvidencia`) y la ficha completa del panel lateral
 * (`DetalleSenal`). La lista en sí es la `Tabla` del kit (components/listado): la arma
 * AuditoriaDeAgentes en el informe y components/alertas/ListaSenales en el índice.
 */

import { ExternalLink, FileText } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, ChipsDetalle, CitaDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";
import { Severidad } from "@/components/ui/Severidad";
import { maskDnis, pareceEmpresa, redactDnis, type NombreConocido } from "@/components/Redact";
import { plural } from "@/lib/formato";
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

/**
 * El panel de una señal del informe, con el formato de todo panel (DESIGN_SYSTEM.md §14.4):
 * chips → quién la encontró, en filas → qué mira la regla, qué se encontró, la norma y las
 * páginas del expediente. La fuente oficial va como fila: el pie del panel lo arma
 * AuditoriaDeAgentes.
 */
export function DetalleSenal({ senal, etiqueta, descripcion }: { senal: SenalAgente; etiqueta: string; descripcion: string | null }) {
  const agente = pasoDeClave(senal.agente);
  const datos: DatoClave[] = [
    {
      etiqueta: "La encontró",
      valor: <strong className="font-semibold">{nombreDeAgente(senal.agenteBruto ?? senal.agente)}</strong>,
      ayuda: agente ? <Ayuda titulo="¿Qué hace este agente?">{agente.que}</Ayuda> : undefined,
    },
    ...(agente ? [{ etiqueta: "Carril", valor: agente.carrilLabel }] : []),
    ...(agente && agente.fuentes.length > 0 ? [{ etiqueta: "Coteja contra", valor: agente.fuentes.join(", ") }] : []),
    ...(!agente && senal.agenteBruto ? [{ etiqueta: "Identificador del agente", valor: senal.agenteBruto, mono: true }] : []),
    ...(senal.fuenteUrl
      ? [
          {
            etiqueta: "Fuente oficial",
            valor: (
              <a href={senal.fuenteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                Ver la fuente oficial <ExternalLink size={12} aria-hidden />
              </a>
            ),
          },
        ]
      : []),
  ];

  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <Severidad bandera={senal.severidad} />
        <SelloVerificada verificada={senal.verificada} />
      </ChipsDetalle>

      <DatosClave items={datos} />

      {descripcion && (
        <BloqueDetalle titulo="Qué mira esta regla">
          <p>{descripcion}</p>
        </BloqueDetalle>
      )}

      <BloqueDetalle titulo="Qué se encontró">
        {senal.evidencia ? <p>{redactDnis(senal.evidencia)}</p> : <p className="text-mute">El análisis no guardó el texto de esta señal.</p>}
        {senal.evidenciaTextual && (
          <div className="mt-2">
            <CitaDetalle fuente="Texto del documento">{redactDnis(senal.evidenciaTextual)}</CitaDetalle>
          </div>
        )}
      </BloqueDetalle>

      <BloqueDetalle titulo="La norma que cita">
        {senal.norma ? <p>{senal.norma}</p> : <p className="text-mute">Esta señal no cita una norma: se sostiene solo en la evidencia de arriba.</p>}
        {senal.opinion?.num && <OpinionOece opinion={senal.opinion} />}
      </BloqueDetalle>

      {senal.citas.length > 0 && (
        <BloqueDetalle
          titulo="Evidencia en el expediente"
          acciones={<span className="shrink-0 text-[12px] tabular-nums text-mute">{plural(senal.citas.length, "página", "páginas")}</span>}
        >
          <ul className="space-y-2">
            {senal.citas.map((c, i) => {
              const fuente = (
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
                  <FileText size={12} aria-hidden />
                  <span className="font-medium text-inkSoft">{c.documentoTitulo ?? "Documento del expediente"}</span>
                  {c.pagina != null && <span className="font-mono tabular-nums text-ink">pág. {c.pagina}</span>}
                  {c.documentoUrl && (
                    <a href={c.documentoUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
                      Abrir el documento <ExternalLink size={11} aria-hidden />
                    </a>
                  )}
                </span>
              );
              // Sin texto de la página no hay cita que mostrar: sólo el documento y su enlace.
              return <li key={i}>{c.cita ? <CitaDetalle fuente={fuente}>{redactDnis(c.cita)}</CitaDetalle> : fuente}</li>;
            })}
          </ul>
        </BloqueDetalle>
      )}

      <BloqueDetalle titulo="Qué no prueba esto">
        <p className="text-inkSoft">
          Es una señal de riesgo, no una acusación: {etiqueta.toLowerCase()} es un indicio que hay que verificar contra la
          fuente oficial antes de publicarlo o denunciarlo.
        </p>
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

/** La opinión del OECE que respalda la norma: el extracto como cita, si se guardó; si no, sólo su número y enlace. */
function OpinionOece({ opinion }: { opinion: NonNullable<SenalAgente["opinion"]> }) {
  const fuente = (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-mute">
      <span>
        Opinión del OECE <span className="font-mono">{opinion.num}</span>
      </span>
      {opinion.url && (
        <a href={opinion.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-granate hover:underline">
          Abrir la opinión <ExternalLink size={11} aria-hidden />
        </a>
      )}
    </span>
  );
  return <div className="mt-2">{opinion.snippet ? <CitaDetalle fuente={fuente}>{opinion.snippet}</CitaDetalle> : fuente}</div>;
}
