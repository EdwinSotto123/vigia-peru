"use client";

import { ExternalLink, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dni, redactDnis } from "../../Redact";
import type { GraphNode } from "../types";

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
    alcalde: "Alcalde / autoridad electa",
    funcionario_designado: "Funcionario designado",
    municipio_familiar: "Municipio donde trabaja un familiar",
    partido_compartido: "Partido político del municipio",
    postor_rival: "Postor rival (no ganador)",
    socio_postor_conflicto: "⚠ Socio de postor rival = Funcionario público",
    entidad_secundaria: "Entidad secundaria (doble vinculación)",
  };
  const kindColor: Record<GraphNode["kind"], string> = {
    person: "bg-clay text-paper",
    pareja: "bg-[#7c3aed] text-paper",
    company_main: "bg-rust text-paper",
    company_titular: "bg-amber text-paper",
    company_domicilio: "bg-rust text-paper",
    party: "bg-rust text-paper",
    contract: "bg-clay text-paper",
    cargo_pasado: "bg-ink text-paper",
    autoridad: "bg-amber text-paper",
    firmante_conflicto: "bg-rust text-paper",
    entidad: "bg-[#1e3a8a] text-paper",
    alcalde: "bg-[#1e3a8a] text-paper",
    funcionario_designado: "bg-[#3b82f6] text-paper",
    municipio_familiar: "bg-[#6b21a8] text-paper",
    partido_compartido: "bg-rust text-paper",
    postor_rival: "bg-[#9a3412] text-paper",
    socio_postor_conflicto: "bg-rust text-paper",
    entidad_secundaria: "bg-[#0e7490] text-paper",
  };

  const links: Array<{ label: string; href: string; icon?: string }> = [];
  if (m.ruc) {
    links.push({ label: "SUNAT (consulta RUC)", href: `https://e-consultaruc.sunat.gob.pe/cl-ti-itmrconsruc/jcrS00Alias?accion=consPorRuc&nroRuc=${m.ruc}` });
    links.push({ label: "DatosPerú (perfil)", href: `https://www.datosperu.org/ruc-${m.ruc}.php` });
    links.push({ label: "OECE (búsqueda proveedor)", href: `https://contratacionesabiertas.oece.gob.pe/perfilProveedor/#!/transactions/${m.ruc}` });
  }
  if (m.dni) {
    links.push({ label: "RENIEC (PerúConsulta)", href: `https://eldni.com/pe/buscar-por-dni?dni=${m.dni}` });
  }
  if (m.fuente_url) {
    links.push({ label: "Fuente del dato", href: m.fuente_url });
  }
  if (m.partido) {
    links.push({ label: "ONPE (financiamiento político)", href: `https://www.onpe.gob.pe/modAportantes/aportantes/` });
  }

  return (
    <div className="mt-3 overflow-hidden rounded-lg border-2 border-clay bg-paper shadow-md">
      <div className="flex items-center justify-between gap-2 border-b border-line bg-paperDeep px-4 py-2">
        <div className="flex items-center gap-2">
          <span className={cn("rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest", kindColor[node.kind])}>
            {kindLabel[node.kind]}
          </span>
          {m.rol && (
            <span className="text-[10px] font-semibold text-mute">{m.rol}</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-0.5 text-xs text-mute hover:bg-paperDeep hover:text-ink"
          title="Cerrar"
        >
          ✕
        </button>
      </div>

      <div className="p-4">
        <h4 className="font-serif text-lg font-bold leading-tight text-ink">
          {m.razon_social || m.partido || m.institucion || m.entidad || node.label}
        </h4>

        {/* Detalles según tipo */}
        <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
          {m.ruc && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">RUC</dt>
              <dd className="font-mono font-bold text-ink">{m.ruc}</dd>
            </div>
          )}
          {m.dni && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">DNI</dt>
              <dd className="font-mono font-bold text-ink"><Dni value={m.dni} /></dd>
            </div>
          )}
          {m.cargo && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Cargo</dt>
              <dd className="text-ink">{m.cargo}</dd>
            </div>
          )}
          {m.periodo && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Período</dt>
              <dd className="font-mono text-ink">{m.periodo}</dd>
            </div>
          )}
          {m.año != null && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Año</dt>
              <dd className="font-mono text-ink">{m.año}</dd>
            </div>
          )}
          {m.monto != null && m.monto > 0 && (
            <div className="rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Monto</dt>
              <dd className="font-mono font-bold text-clay">S/. {m.monto.toLocaleString("es-PE")}</dd>
            </div>
          )}
          {m.direccion && (
            <div className="col-span-full rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">📍 Dirección</dt>
              <dd className="text-ink">{m.direccion}</dd>
            </div>
          )}
          {m.observacion && (
            <div className="col-span-full rounded-md bg-crimson-soft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-rust">Observación</dt>
              <dd className="italic text-rust">{redactDnis(m.observacion)}</dd>
            </div>
          )}
          {m.objeto && (
            <div className="col-span-full rounded-md bg-paperSoft px-2 py-1.5">
              <dt className="text-[9px] uppercase tracking-widest text-mute">Objeto del contrato</dt>
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
              className="inline-flex items-center gap-1 rounded-lg bg-rust px-3 py-1.5 text-[11px] font-bold text-paper shadow-sm hover:bg-rust/90"
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
