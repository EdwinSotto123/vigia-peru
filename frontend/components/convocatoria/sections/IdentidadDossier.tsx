"use client";

import { useContext, useState, type ReactNode } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, MapPin, Share2 } from "lucide-react";
import type { Indicador } from "@/components/listado";
import { Volver } from "@/components/patrones";
import { cn } from "@/lib/utils";
import { listaY, numero, porcentaje, solesCompacto } from "@/lib/formato";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { fechaDossier, montoDossier, type ConteoSeveridad, type EstadoCorrida } from "../dossier";
import { oeceProcesoUrl } from "../utils";
import { NivelTituloDossier } from "./nivelTitulo";

/**
 * La identidad del contrato en la Ficha (DESIGN_SYSTEM.md §14.2): volver, QUÉ se contrató
 * (el título, único h1 de la página), su código, quién compra y quién ganó en dos líneas, y
 * los chips de estado. Cuánto, cuántas señales y cuándo van en `Indicadores` justo debajo
 * (`indicadoresDossier`): antes eran cuatro celdas de formulario ("Quién compra / Quién ganó /
 * Cuánto / Cuándo") que mezclaban nombres y cifras sin jerarquía.
 *
 * El texto que se comparte no lleva conteos de severidad: el enlace es el informe, y el
 * informe los dice con su evidencia.
 */
export function IdentidadDossier({
  conv,
  ganador,
  nGanadores = ganador ? 1 : 0,
  chips,
  volver = true,
  compartible = true,
}: {
  conv: any;
  ganador: any;
  /** Cuántos postores ganaron algo (lotes/ítems adjudicados a distintos proveedores). */
  nGanadores?: number;
  /** Chips de estado ya armados (peso del riesgo, "En revisión", tipo de proceso). */
  chips?: ReactNode;
  /** false en la vista previa del panel: no hay listado al que volver. */
  volver?: boolean;
  /** false: sin "Compartir" (una alerta en revisión todavía no tiene enlace público). */
  compartible?: boolean;
}) {
  // <h1> en la página pública; <h2> dentro de la vista previa del panel (ver ./nivelTitulo).
  const Titulo = useContext(NivelTituloDossier);
  const codigo: string = conv.codigo || conv.ocid || "";
  const natural = esPersonaNatural(ganador?.ruc);
  const accion =
    "inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-[12px] font-semibold text-ink transition-colors duration-rapido hover:bg-paperDeep";

  return (
    <header className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {volver ? <Volver href="/app/convocatoria">Análisis publicados</Volver> : <span />}
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <a href={oeceProcesoUrl(conv.ocid || codigo)} target="_blank" rel="noreferrer" className={accion}>
            <ExternalLink size={13} aria-hidden /> Ver en el OECE
          </a>
          {compartible && <Compartir codigo={codigo} objeto={conv.objeto} />}
        </div>
      </div>

      <div>
        <Titulo className="max-w-4xl break-words font-display text-[24px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[30px]">
          {objetoCompleto(conv.objeto) || "Contrato sin objeto registrado"}
        </Titulo>
        {/* Quién compra, en una línea con el código. */}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[14px] text-inkSoft">
          <span>
            Convocatoria <span className="font-mono font-semibold text-ink">{codigo}</span>
          </span>
          {conv.entidad && conv.buyer_ruc ? (
            <Link href={`/entidad/${encodeURIComponent(conv.buyer_ruc)}`} className="font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-granate">
              {conv.entidad}
            </Link>
          ) : (
            <span className={conv.entidad ? "font-medium text-ink" : "text-mute"}>{conv.entidad || "Entidad sin dato"}</span>
          )}
          {conv.region && (
            <span className="inline-flex items-center gap-1 text-mute">
              <MapPin size={12} aria-hidden /> {conv.region}
            </span>
          )}
        </p>
        {/* Quién ganó: la persona natural va en vidrio (su apellido y su RUC 10). */}
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[14px] text-inkSoft">
          {ganador?.nombre ? (
            <>
              <span>
                {natural ? "Ganó (persona natural)" : "Ganó"}{" "}
                <strong className="font-semibold text-ink">{natural ? <PersonName name={ganador.nombre} orden="sunat" /> : ganador.nombre}</strong>
              </span>
              {ganador.ruc && (
                <span className="font-mono text-[12.5px] text-mute">
                  RUC <Ruc value={ganador.ruc} />
                </span>
              )}
              {nGanadores > 1 && (
                <span className="text-[12.5px] text-mute">
                  y {numero(nGanadores - 1)} {nGanadores - 1 === 1 ? "ganador más" : "ganadores más"} en otros ítems
                </span>
              )}
            </>
          ) : (
            <span className="text-mute">Sin adjudicación publicada</span>
          )}
        </p>
      </div>

      {chips && <div className="flex flex-wrap items-center gap-2">{chips}</div>}
    </header>
  );
}

/**
 * Las cifras del contrato (§14.2 "Indicadores"): cuánto se presupuestó, cuánto se adjudicó,
 * cuántas señales y cuándo. Sin `conteo` (alerta en revisión, §10.4) no se cuentan señales.
 * La diferencia entre adjudicado y referencial va en palabras y en tinta neutra: pasarse del
 * referencial no es por sí solo una señal.
 */
export function indicadoresDossier({
  conv,
  ganador,
  conteo,
  corrida,
}: {
  conv: any;
  ganador: any;
  conteo?: ConteoSeveridad;
  corrida?: EstadoCorrida;
}): Indicador[] {
  const referencial = Number(conv.cuantia_total) > 0 ? Number(conv.cuantia_total) : null;
  const adjudicado =
    Number(conv.monto_adjudicado) > 0 ? Number(conv.monto_adjudicado) : Number(ganador?.monto_ganado) > 0 ? Number(ganador.monto_ganado) : null;
  const variacion = adjudicado !== null && referencial !== null ? ((adjudicado - referencial) / referencial) * 100 : null;
  const cuando: { etiqueta: string; valor: string | null } = conv.fecha_buena_pro
    ? { etiqueta: "buena pro", valor: conv.fecha_buena_pro }
    : conv.fecha_contrato
      ? { etiqueta: "firma del contrato", valor: conv.fecha_contrato }
      : { etiqueta: "convocatoria publicada", valor: conv.fecha_publicacion ?? null };

  // Cifra de cabecera = monto compacto (§10.3, "tarjeta"): el completo no entra en un cuarto de
  // ancho a 26 px. El monto exacto queda en el `title` y en las tablas de ítems y postores.
  const monto = (n: number) => <span title={montoDossier(n)}>{solesCompacto(n)}</span>;
  const items: Indicador[] = [
    { valor: referencial !== null ? monto(referencial) : null, etiqueta: "valor referencial", contexto: "presupuesto de la entidad" },
    {
      valor: adjudicado !== null ? monto(adjudicado) : null,
      etiqueta: "adjudicado",
      contexto:
        variacion === null
          ? adjudicado === null
            ? "sin buena pro publicada"
            : "sin referencial para comparar"
          : Math.abs(variacion) < 0.1
            ? "igual al referencial"
            : `${porcentaje(Math.abs(variacion), { decimales: 1 })} ${variacion > 0 ? "sobre" : "bajo"} el referencial`,
    },
  ];

  if (conteo) {
    const partes = [
      conteo.alta > 0 && `${numero(conteo.alta)} ${conteo.alta === 1 ? "alta" : "altas"}`,
      conteo.media > 0 && `${numero(conteo.media)} ${conteo.media === 1 ? "media" : "medias"}`,
      conteo.baja > 0 && `${numero(conteo.baja)} ${conteo.baja === 1 ? "baja" : "bajas"}`,
    ].filter((x): x is string => Boolean(x));
    const completa = corrida?.completa ?? true;
    items.push({
      valor: numero(conteo.total),
      etiqueta: conteo.total === 1 ? "señal" : "señales",
      tono: conteo.alta > 0 ? "alta" : conteo.media > 0 ? "media" : conteo.total === 0 && completa ? "positivo" : "neutro",
      contexto: conteo.total > 0 ? listaY(partes) : completa ? "ninguna regla disparó" : "análisis incompleto",
    });
  }

  items.push({
    valor: cuando.valor ? fechaDossier(cuando.valor, true) : null,
    etiqueta: cuando.etiqueta,
    contexto: "según el registro del OECE",
  });
  return items;
}

/** Compartir el informe: hoja nativa del celular o, en escritorio, copiar el enlace. */
function Compartir({ codigo, objeto }: { codigo: string; objeto?: string | null }) {
  const [copiado, setCopiado] = useState(false);
  const compartir = async () => {
    try {
      const url = `${window.location.origin}/app/convocatoria/${codigo}`;
      if (navigator.share) {
        await navigator.share({
          title: `Vigía Perú: ${objeto?.slice(0, 80) || "análisis de un contrato"}`,
          text: `Análisis del contrato ${codigo}, con cada señal, su norma y su evidencia. Revísalo tú:`,
          url,
        });
      } else {
        await navigator.clipboard.writeText(url);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 2000);
      }
    } catch {
      // la persona cerró el diálogo de compartir
    }
  };
  return (
    <button
      type="button"
      onClick={compartir}
      aria-live="polite"
      className={cn(
        "inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-semibold text-paper transition-colors duration-rapido",
        copiado ? "bg-mossTexto" : "bg-granate hover:bg-granate-deep",
      )}
    >
      {copiado ? <CheckCircle2 size={13} aria-hidden /> : <Share2 size={13} aria-hidden />}
      {copiado ? "Enlace copiado" : "Compartir"}
    </button>
  );
}

/**
 * El objeto llega de SEACE cortado a 300 caracteres, a veces a mitad de un paréntesis
 * ("…EMP. CU-989 ("). Si viene al tope y no cierra en puntuación, se marca como cortado.
 */
function objetoCompleto(objeto?: string | null): string {
  const t = (objeto ?? "").trim();
  if (t.length < 295 || /[.…)"»]$/.test(t)) return t;
  return `${t.replace(/[\s(,;:-]+$/, "")}…`;
}
