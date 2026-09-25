"use client";

import { montoDossier } from "../dossier";
import { ExternalLink, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dni, PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import type { GraphNode } from "../types";
import { Evidencia } from "./Evidencia";
import { ChipsDetalle, CitaDetalle, CuerpoDetalle, DatosClave, type DatoClave } from "@/components/patrones/Detalle";

export function NodeDetailPanel({
  node,
  onClose,
  onVigiaSearch,
}: { node: GraphNode; onClose: () => void; onVigiaSearch: (ruc: string) => void }) {
  const m = node.meta || {};
  const kindLabel: Record<GraphNode["kind"], string> = {
    person: "Persona",
    pareja: "Pareja o familia",
    company_main: "Empresa adjudicada",
    company_titular: "Empresa con mismo titular",
    company_domicilio: "Empresa con mismo domicilio",
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
    postor_rival: "Postor rival (no ganador)",
    socio_postor_conflicto: "Socio de postor rival que es funcionario público",
    entidad_secundaria: "Entidad secundaria (doble vinculación)",
  };
  // Mismos tonos que el grafo (paleta textil para el tipo de nodo, DESIGN_SYSTEM.md §3.4); el
  // rojo de severidad queda sólo para los nodos que SON un conflicto detectado.
  const kindColor: Record<GraphNode["kind"], string> = {
    person: "bg-textil-ladrillo text-paper",
    pareja: "bg-granate-500 text-paper",
    company_main: "bg-ink text-paper",
    company_titular: "bg-amber-soft text-amberTexto",
    company_domicilio: "bg-rust text-paper",
    party: "bg-crimsonTexto text-paper",
    contract: "bg-textil-tierra text-paper",
    cargo_pasado: "bg-inkSoft text-paper",
    autoridad: "bg-maiz-soft text-ink",
    firmante_conflicto: "bg-rust text-paper",
    entidad: "bg-textil-anil text-paper",
    alcalde: "bg-textil-anil text-paper",
    funcionario_designado: "bg-textil-anil text-paper",
    municipio_familiar: "bg-granate text-paper",
    partido_compartido: "bg-rust text-paper",
    postor_rival: "bg-textil-ladrillo text-paper",
    socio_postor_conflicto: "bg-rust text-paper",
    entidad_secundaria: "bg-textil-verde text-paper",
  };

  const links: Array<{ label: string; href: string; icon?: string }> = [];
  if (m.ruc) {
    links.push({ label: "SUNAT (consulta RUC)", href: `https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc=${m.ruc}` });
    links.push({ label: "DatosPerú (perfil)", href: `https://www.datosperu.org/ruc-${m.ruc}.php` });
    links.push({ label: "OECE (búsqueda proveedor)", href: `https://contratacionesabiertas.oece.gob.pe/perfilProveedor/#!/transactions/${m.ruc}` });
  }
  if (m.dni) {
    links.push({ label: "Buscar el DNI (eldni.com)", href: `https://eldni.com/pe/buscar-por-dni?dni=${m.dni}` });
  }
  // Solo URLs públicas: el backend a veces deja "file://ERM2022…xlsx" o el
  // nombre interno "person_network_context", que como enlace no llevan a nada.
  if (m.fuente_url && /^https?:\/\//i.test(m.fuente_url)) {
    links.push({ label: "Fuente del dato", href: m.fuente_url });
  }
  if (m.partido) {
    links.push({ label: "ONPE (financiamiento político)", href: `https://www.onpe.gob.pe/modAportantes/aportantes/` });
  }

  // Los datos del nodo en filas (§14.4). Sólo los que el nodo trae: una fila vacía no informa.
  const datos: DatoClave[] = [
    ...(m.ruc ? [{ etiqueta: "RUC", valor: <Ruc value={m.ruc} />, mono: true }] : []),
    ...(m.dni ? [{ etiqueta: "DNI", valor: <Dni value={m.dni} />, mono: true }] : []),
    ...(m.cargo ? [{ etiqueta: "Cargo", valor: m.cargo }] : []),
    ...(m.periodo ? [{ etiqueta: "Período", valor: m.periodo, mono: true }] : []),
    ...(m.año != null ? [{ etiqueta: "Año", valor: m.año, mono: true }] : []),
    ...(m.monto != null && m.monto > 0 ? [{ etiqueta: "Monto", valor: montoDossier(m.monto), mono: true }] : []),
    ...(m.direccion ? [{ etiqueta: "Dirección", valor: m.direccion }] : []),
    ...(m.objeto ? [{ etiqueta: "Objeto del contrato", valor: m.objeto }] : []),
  ];

  return (
    <div className="mt-3 overflow-hidden rounded-2xl border border-granate/40 bg-paper shadow-md">
      <div className="flex items-start justify-between gap-2 border-b border-line bg-paperSoft px-4 py-3">
        <h4 className="min-w-0 font-display text-lg font-bold leading-tight text-ink">
          {/* Persona natural con negocio (RUC 10): la "razón social" es su nombre
              en orden SUNAT; va con el apellido materno en vidrio. */}
          {m.razon_social && esPersonaNatural(m.ruc)
            ? <PersonName name={m.razon_social} orden="sunat" />
            : m.razon_social || m.partido || m.institucion || m.entidad || node.label}
        </h4>
        <button
          type="button"
          onClick={onClose}
          className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-mute hover:bg-paperDeep hover:text-ink"
          aria-label="Cerrar el detalle"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <CuerpoDetalle className="p-4">
        <ChipsDetalle>
          <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", kindColor[node.kind])}>{kindLabel[node.kind]}</span>
          {m.rol && <span className="pill border-line bg-paperSoft text-inkSoft">{String(m.rol).replace(/_/g, " ")}</span>}
        </ChipsDetalle>

        {datos.length > 0 && <DatosClave items={datos} />}

        {m.observacion && (
          <CitaDetalle fuente="Observación del análisis">
            {/* La observación a veces llega como lista de citas: nunca se pinta el objeto crudo. */}
            {typeof m.observacion === "string" ? redactDnis(m.observacion) : <Evidencia value={m.observacion} />}
          </CitaDetalle>
        )}
      </CuerpoDetalle>

      {/* Pie de acciones, como el de un panel: buscar en Vigía y las fuentes oficiales. */}
      <div className="flex flex-wrap gap-1.5 border-t border-line bg-paperSoft px-4 py-3">
        {m.ruc && (
          <button
            type="button"
            onClick={() => onVigiaSearch(m.ruc!)}
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full bg-granate px-3 py-1.5 text-[12px] font-semibold text-paper hover:bg-granate-deep"
            title="Buscar este RUC en otros análisis de Vigía"
          >
            <Search size={12} aria-hidden /> Buscar en Vigía
          </button>
        )}
        {links.map((l, i) => (
          <a
            key={i}
            href={l.href}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-[32px] items-center gap-1 rounded-full border border-line bg-paper px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-paperDeep"
          >
            <ExternalLink size={11} aria-hidden /> {l.label}
          </a>
        ))}
      </div>
    </div>
  );
}
