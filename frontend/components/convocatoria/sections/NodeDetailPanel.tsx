"use client";

import Link from "next/link";
import { ExternalLink, Search, X } from "lucide-react";
import { CLARIDAD_ONPE, fichaRnp, proveedorOece } from "@/lib/fuentes";
import { cn } from "@/lib/utils";
import { montoDossier } from "../dossier";
import { PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import type { GraphNode } from "../types";
import { Evidencia } from "./Evidencia";
import { BloqueDetalle, ChipsDetalle, CitaDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";

/** Qué es cada nodo de la red, en palabras. */
export const ETIQUETA_NODO: Record<GraphNode["kind"], string> = {
  person: "Persona",
  pareja: "Pareja o familia",
  company_main: "Empresa que ganó el contrato",
  company_titular: "Empresa con el mismo titular",
  company_domicilio: "Empresa con el mismo domicilio",
  party: "Partido político",
  contract: "Otro contrato",
  cargo_pasado: "Cargo público pasado",
  autoridad: "Autoridad pública vinculada",
  firmante_conflicto: "Firmante con conflicto",
  entidad: "Entidad contratante",
  alcalde: "Alcalde o autoridad electa",
  funcionario_designado: "Funcionario designado",
  municipio_familiar: "Municipio donde trabaja un familiar",
  partido_compartido: "Partido político del municipio",
  postor_rival: "Postor que no ganó",
  socio_postor: "Socio de un postor que no ganó",
  socio_postor_conflicto: "Socio de un postor rival que es funcionario público",
  entidad_secundaria: "Visita relevante al proceso",
};

/**
 * El chip del tipo de nodo, por token (día y noche): el proveedor en el verde de la marca, lo que ES un conflicto en el
 * rojo de severidad, la política en ámbar, la familia en añil y lo demás en tinta neutra. Antes era la paleta textil en
 * hex fijo, pensada para el modo noche (blanco sobre coral en el día).
 */
const CHIP_TIPO: Partial<Record<GraphNode["kind"], string>> = {
  company_main: "border-granate/40 bg-granate-50 text-granate",
  firmante_conflicto: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
  socio_postor_conflicto: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
  company_domicilio: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
  party: "border-amber/30 bg-amber-soft text-amberTexto",
  partido_compartido: "border-amber/30 bg-amber-soft text-amberTexto",
  pareja: "border-anil/30 bg-anil/10 text-anilTexto",
  municipio_familiar: "border-anil/30 bg-anil/10 text-anilTexto",
};
const CHIP_NEUTRO = "border-line bg-paperDeep text-inkSoft";

const esRuc20 = (v?: string | null) => !!v && /^20\d{9}$/.test(String(v).trim());
const ES_ENTIDAD = new Set<GraphNode["kind"]>(["entidad", "entidad_secundaria"]);

/** El nombre del nodo como texto (el título del panel): la etiqueta del grafo ya llega con el apellido tapado. */
export function tituloNodo(node: GraphNode): string {
  const m = node.meta || {};
  // Una persona natural con negocio (RUC 10): su razón social es su nombre; va la etiqueta, que ya lo tapa.
  if (m.razon_social && !esPersonaNatural(m.ruc)) return String(m.razon_social);
  return String(m.partido || m.institucion || m.entidad || node.label || "Sin nombre");
}

/** Un vínculo del nodo en esta red: con quién y por qué (la relación de la arista). */
export interface VinculoNodo {
  relacion: string;
  con: string;
  /** Clase del punto de color de la relación (su grupo en la leyenda). */
  punto?: string;
}

/** Lo que se sabe del nodo: su tipo, sus datos, la observación del análisis y sus vínculos en la red. */
export function CuerpoNodo({ node, vinculos = [] }: { node: GraphNode; vinculos?: VinculoNodo[] }) {
  const m = node.meta || {};
  // Los datos del nodo en filas (§14.4), sólo los que trae. Sin DNI: nunca se muestra (docs/PRIVACIDAD.md).
  const datos: DatoClave[] = [
    ...(m.ruc ? [{ etiqueta: "RUC", valor: <Ruc value={m.ruc} />, mono: true }] : []),
    ...(m.cargo ? [{ etiqueta: "Cargo", valor: m.cargo }] : []),
    ...(m.periodo ? [{ etiqueta: "Período", valor: m.periodo, mono: true }] : []),
    ...(m.año != null ? [{ etiqueta: "Año", valor: String(m.año), mono: true }] : []),
    ...(m.monto != null && m.monto > 0 ? [{ etiqueta: "Monto", valor: montoDossier(m.monto), mono: true }] : []),
    ...(m.direccion ? [{ etiqueta: "Dirección", valor: m.direccion }] : []),
    ...(m.objeto ? [{ etiqueta: "Objeto del contrato", valor: m.objeto }] : []),
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <span className={cn("pill font-semibold", CHIP_TIPO[node.kind] ?? CHIP_NEUTRO)}>{ETIQUETA_NODO[node.kind]}</span>
        {m.rol && <span className={cn("pill", CHIP_NEUTRO)}>{String(m.rol).replace(/_/g, " ")}</span>}
      </ChipsDetalle>

      {m.razon_social && esPersonaNatural(m.ruc) && (
        <p className="text-dato text-ink">
          <PersonName name={m.razon_social} orden="sunat" />
        </p>
      )}

      {datos.length > 0 && <DatosClave items={datos} />}

      {m.observacion && (
        <CitaDetalle fuente="Observación del análisis">
          {/* La observación a veces llega como lista de citas: nunca se pinta el objeto crudo. */}
          {typeof m.observacion === "string" ? redactDnis(m.observacion) : <Evidencia value={m.observacion} />}
        </CitaDetalle>
      )}

      {vinculos.length > 0 && (
        <BloqueDetalle titulo={`Sus vínculos en esta red (${vinculos.length})`}>
          <ul className="space-y-1.5">
            {vinculos.map((v, i) => (
              <li key={i} className="flex items-start gap-2 text-dato leading-snug">
                <span className={cn("mt-2 h-1 w-3 shrink-0 rounded-full", v.punto ?? "bg-mute")} aria-hidden />
                <span className="min-w-0">
                  <span className="text-ink">{redactDnis(v.con)}</span>
                  <span className="text-mute">, por {v.relacion}</span>
                </span>
              </li>
            ))}
          </ul>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

/**
 * Adónde ir desde el nodo: su ficha en Vigía y las fuentes oficiales. Sólo con un RUC 20 (empresa o entidad): el de una
 * persona natural lleva su DNI adentro y nunca se enlaza ni se busca.
 */
export function PieNodo({ node, onVigiaSearch }: { node: GraphNode; onVigiaSearch?: (ruc: string) => void }) {
  const m = node.meta || {};
  const ruc = esRuc20(m.ruc) ? String(m.ruc).trim() : null;
  const ficha = ruc ? (ES_ENTIDAD.has(node.kind) ? `/entidad/${ruc}` : `/empresa/${ruc}`) : null;
  const externos: { label: string; href: string }[] = [];
  if (ruc && !ES_ENTIDAD.has(node.kind)) {
    externos.push({ label: "Consulta RUC (SUNAT)", href: `https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc=${ruc}` });
    externos.push({ label: "Sus procesos en Contrataciones Abiertas", href: proveedorOece(ruc) });
    externos.push({ label: "Su ficha en el RNP", href: fichaRnp(ruc) });
  }
  // Sólo URLs públicas: el backend a veces deja "file://…xlsx" o un nombre interno, que como enlace no llevan a nada.
  if (m.fuente_url && /^https?:\/\//i.test(m.fuente_url)) externos.push({ label: "Fuente del dato", href: m.fuente_url });
  if (m.partido) externos.push({ label: "ONPE (financiamiento político)", href: CLARIDAD_ONPE });
  if (!ficha && !externos.length && !(ruc && onVigiaSearch)) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {ficha && (
        <Link
          href={ficha}
          prefetch={false}
          className="inline-flex min-h-8 items-center gap-1 rounded-full bg-granate px-3 py-1.5 text-rotulo font-semibold text-paper hover:bg-granate-deep"
        >
          {ES_ENTIDAD.has(node.kind) ? "Ficha de la entidad" : "Ficha de la empresa"}
        </Link>
      )}
      {ruc && onVigiaSearch && !ES_ENTIDAD.has(node.kind) && (
        <button
          type="button"
          onClick={() => onVigiaSearch(ruc)}
          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-paper px-3 py-1.5 text-rotulo font-semibold text-ink hover:bg-paperDeep"
          title="Buscar este RUC en los contratos de Vigía"
        >
          <Search size={12} aria-hidden /> Sus contratos en Vigía
        </button>
      )}
      {externos.map((l, i) => (
        <a
          key={i}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-paper px-3 py-1.5 text-rotulo font-semibold text-ink hover:bg-paperDeep"
        >
          <ExternalLink size={11} aria-hidden /> {l.label}
        </a>
      ))}
    </div>
  );
}

/**
 * El detalle del nodo como tarjeta en línea (compatibilidad). La red lo abre en el panel lateral (`ui/Panel`) con
 * `CuerpoNodo` y `PieNodo`.
 */
export function NodeDetailPanel({
  node,
  onClose,
  onVigiaSearch,
  vinculos,
}: { node: GraphNode; onClose: () => void; onVigiaSearch: (ruc: string) => void; vinculos?: VinculoNodo[] }) {
  const pie = <PieNodo node={node} onVigiaSearch={onVigiaSearch} />;
  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper shadow-md">
      <div className="flex items-start justify-between gap-2 border-b border-line bg-paperSoft px-4 py-3">
        <h4 className="min-w-0 font-display text-bloque font-bold leading-tight text-ink">{tituloNodo(node)}</h4>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mute hover:bg-paperDeep hover:text-ink"
          aria-label="Cerrar el detalle"
        >
          <X size={16} aria-hidden />
        </button>
      </div>
      <div className="p-4">
        <CuerpoNodo node={node} vinculos={vinculos} />
      </div>
      <div className="border-t border-line bg-paperSoft px-4 py-3">{pie}</div>
    </div>
  );
}
