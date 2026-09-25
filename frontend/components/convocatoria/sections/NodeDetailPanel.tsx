"use client";

import { montoDossier } from "../dossier";
import { ExternalLink, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dni, PersonName, Ruc, esPersonaNatural, redactDnis } from "../../Redact";
import type { GraphNode } from "../types";
import { Evidencia } from "./Evidencia";

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

  return (
    <div className="mt-3 overflow-hidden rounded-lg border-2 border-granate bg-paper shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-paperDeep px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", kindColor[node.kind])}>
            {kindLabel[node.kind]}
          </span>
          {m.rol && (
            <span className="text-[10px] font-semibold text-mute">{String(m.rol).replace(/_/g, " ")}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-mute hover:bg-paperDeep hover:text-ink"
          aria-label="Cerrar el detalle"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      <div className="p-4">
        <h4 className="font-display text-lg font-bold leading-tight text-ink">
          {/* Persona natural con negocio (RUC 10): la "razón social" es su nombre
              en orden SUNAT; va con el apellido materno en vidrio. */}
          {m.razon_social && esPersonaNatural(m.ruc)
            ? <PersonName name={m.razon_social} orden="sunat" />
            : m.razon_social || m.partido || m.institucion || m.entidad || node.label}
        </h4>

        {/* Detalles según tipo */}
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          {m.ruc && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">RUC</dt>
              <dd className="font-mono font-bold text-ink"><Ruc value={m.ruc} /></dd>
            </div>
          )}
          {m.dni && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">DNI</dt>
              <dd className="font-mono font-bold text-ink"><Dni value={m.dni} /></dd>
            </div>
          )}
          {m.cargo && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">Cargo</dt>
              <dd className="text-ink">{m.cargo}</dd>
            </div>
          )}
          {m.periodo && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">Período</dt>
              <dd className="font-mono text-ink">{m.periodo}</dd>
            </div>
          )}
          {m.año != null && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">Año</dt>
              <dd className="font-mono text-ink">{m.año}</dd>
            </div>
          )}
          {m.monto != null && m.monto > 0 && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">Monto</dt>
              <dd className="font-mono font-semibold tabular-nums text-ink">{montoDossier(m.monto)}</dd>
            </div>
          )}
          {m.direccion && (
            <div className="col-span-full rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">Dirección</dt>
              <dd className="text-ink">{m.direccion}</dd>
            </div>
          )}
          {m.observacion && (
            <div className="col-span-full rounded-md bg-crimson-soft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-crimsonTexto">Observación</dt>
              <dd className="italic text-crimsonTexto">
                {/* La observación a veces llega como lista de citas: nunca se pinta el objeto crudo. */}
                {typeof m.observacion === "string" ? redactDnis(m.observacion) : <Evidencia value={m.observacion} />}
              </dd>
            </div>
          )}
          {m.objeto && (
            <div className="col-span-full rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[11px] text-mute">Objeto del contrato</dt>
              <dd className="text-ink">{m.objeto}</dd>
            </div>
          )}
        </dl>

        {/* Acciones */}
        <div className="mt-3 flex flex-wrap gap-1.5">
          {m.ruc && (
            <button
              type="button"
              onClick={() => onVigiaSearch(m.ruc!)}
              className="inline-flex items-center gap-1 rounded-lg bg-granate px-3 py-1.5 text-[11px] font-bold text-paper shadow-sm hover:bg-granate/90"
              title="Buscar este RUC en otros análisis de Vigía"
            >
              <Search size={11} /> Buscar en Vigía
            </button>
          )}
          {links.map((l, i) => (
            <a
              key={i}
              href={l.href}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper px-3 py-1.5 text-[11px] font-semibold text-ink hover:bg-paperDeep"
            >
              <ExternalLink size={10} /> {l.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
