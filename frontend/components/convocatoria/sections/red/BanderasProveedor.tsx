"use client";

/**
 * «Sus banderas en otros procesos (Vigía)», en la ficha del proveedor del dictamen (pedido del usuario del 2026-11-16).
 * Antes era una fila de chips sueltos, sin orden, y cada uno navegaba a la ficha de la empresa. Ahora:
 *
 *   · van agrupadas por familia (la competencia, el precio, los vínculos, la ejecución…), cada familia y cada bandera de
 *     la más grave a la más leve;
 *   · tocar una abre el panel lateral con la lista de esos procesos (entidad, código, fecha, monto) y un buscador, sin
 *     salir del dictamen. La lista sale de `GET /empresas/:ruc/antecedentes`, la misma de la pestaña Antecedentes de la
 *     ficha de la empresa: se pide una vez, al abrir la primera.
 *
 * Sólo empresas (RUC 20): de una persona natural no hay ficha ni lista, y las banderas se ven sin enlace.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronRight, Search } from "lucide-react";
import { BloqueDetalle, CuerpoDetalle, Nota } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { Panel } from "@/components/ui/Panel";
import { ICONO_NIVEL, Severidad } from "@/components/ui/Severidad";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { TIPO_CRUCE, chipCruce } from "@/lib/cruces";
import { rutaEmpresa, type AntecedenteEmpresa } from "@/lib/empresas";
import { coincide, fechaConAnio, numero, paraBuscar, plural, soles } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { cn } from "@/lib/utils";

type Sev = "alta" | "media" | "baja";
const RANGO: Record<string, number> = { alta: 0, media: 1, baja: 2 };

type Familia = "competencia" | "precio" | "vinculos" | "compras" | "ejecucion" | "sanciones" | "registro" | "politica" | "otras";
const FAMILIA: Record<Familia, { titulo: string; explica: string }> = {
  competencia: { titulo: "La competencia", explica: "Quién más se presentó y qué pasó con las otras ofertas." },
  precio: { titulo: "El precio", explica: "Precios por unidad muy por encima de lo que pagan otras entidades." },
  vinculos: { titulo: "Vínculos", explica: "Socios, domicilios o personas en común con otros postores o con la entidad." },
  compras: { titulo: "Patrón de compras", explica: "Compras repetidas o partidas con una misma entidad." },
  ejecucion: { titulo: "La ejecución", explica: "Penalidades, adicionales y lo que pasó después de firmar." },
  sanciones: { titulo: "Sanciones", explica: "Inhabilitaciones y multas del Tribunal de Contrataciones." },
  registro: { titulo: "Registro SUNAT", explica: "Su antigüedad y su estado en el padrón." },
  politica: { titulo: "Política", explica: "Aportes, candidaturas y autoridades." },
  otras: { titulo: "Otras", explica: "Banderas de otro tipo." },
};

const DE_TIPO: Record<string, Familia> = {
  unico_postor: "competencia", postor_de_relleno: "competencia", consorcio_rival: "competencia", turno_postores: "competencia", otro_postor: "competencia",
  renovacion_mas_cara: "precio", contrato_sobre_adjudicado: "precio",
  socio_comun: "vinculos", mismo_dueno: "vinculos", socio_en_entidad: "vinculos", interes_declarado: "vinculos", pariente_funcionario: "vinculos",
  puerta_giratoria: "vinculos", socio_de_inhabilitada: "vinculos", socio_con_informe_control: "vinculos", empleo_declarado: "vinculos", domicilio_compartido: "vinculos", empresa_espejo: "vinculos",
  fraccionamiento: "compras", proveedor_cautivo: "compras",
  penalidad: "ejecucion", retencion_sobre_tope: "ejecucion", observado_por_contraloria: "ejecucion", gano_tras_observacion: "ejecucion",
  dada_de_baja: "registro", suspendida: "registro", no_habida: "registro",
  partido_gobernante: "politica", vendio_gobernante: "politica", aporte: "politica", aporte_empresa: "politica", proveedor_campana: "politica",
  candidato: "politica", autoridad: "politica",
};
const DE_PREFIJO: [string, Familia][] = [
  ["acta_", "competencia"], ["consultas_", "competencia"], ["bases_", "competencia"],
  ["sobreprecio", "precio"], ["visita", "vinculos"], ["recurrente", "compras"],
  ["adicional", "ejecucion"], ["obra_", "ejecucion"], ["inversion_", "ejecucion"],
  ["sancion", "sanciones"], ["recien_fundada", "registro"],
];
const familiaDe = (tipo: string): Familia => DE_TIPO[tipo] ?? DE_PREFIJO.find(([p]) => tipo.startsWith(p))?.[1] ?? "otras";

interface BanderaExpediente {
  tipo: string;
  severidad: string;
  n?: number;
  procesos?: number;
  ultima?: string | null;
}

interface Chip {
  tipo: string;
  nombre: string;
  /** La gravedad más alta con que aparece. */
  peor: Sev;
  n: number;
  procesos: number;
  ultima: string | null;
}

/** Los antecedentes de una empresa, pedidos una sola vez por RUC (los comparten todas las banderas del panel). */
const CACHE = new Map<string, Promise<AntecedenteEmpresa[] | null>>();
function pedirAntecedentes(ruc: string): Promise<AntecedenteEmpresa[] | null> {
  const ya = CACHE.get(ruc);
  if (ya) return ya;
  const p = fetch(`${PUBLIC_API_BASE}/empresas/${ruc}/antecedentes`)
    .then(async (r) => (r.ok ? (((await r.json()) as { data?: AntecedenteEmpresa[] }).data ?? []) : null))
    .catch(() => null);
  CACHE.set(ruc, p);
  // Un fallo no queda guardado: al volver a abrir se intenta otra vez.
  void p.then((v) => {
    if (v === null) CACHE.delete(ruc);
  });
  return p;
}

const CHIP_TONO: Record<Sev, string> = {
  alta: "border-crimson/40 bg-crimson-soft text-crimsonTexto",
  media: "border-amber/40 bg-amber-soft text-amberTexto",
  baja: "border-line bg-paperSoft text-inkSoft",
};

export function BanderasProveedor({ banderas, ruc }: { banderas: BanderaExpediente[]; ruc: string }) {
  const esEmpresa = /^20\d{9}$/.test(ruc);
  const grupos = useMemo(() => {
    // Una bandera por tipo, con su gravedad más alta (el expediente trae una fila por tipo y gravedad).
    const porTipo = new Map<string, Chip>();
    for (const b of banderas) {
      if (!b?.tipo) continue;
      const sev: Sev = b.severidad === "alta" || b.severidad === "media" ? b.severidad : "baja";
      const c = porTipo.get(b.tipo) ?? { tipo: b.tipo, nombre: chipCruce(b.tipo).replace(/_/g, " "), peor: sev, n: 0, procesos: 0, ultima: null };
      c.n += Number(b.n ?? 0);
      c.procesos += Number(b.procesos ?? 0);
      if (RANGO[sev] < RANGO[c.peor]) c.peor = sev;
      if (b.ultima && (!c.ultima || b.ultima > c.ultima)) c.ultima = b.ultima;
      porTipo.set(b.tipo, c);
    }
    const porFamilia = new Map<Familia, Chip[]>();
    for (const c of porTipo.values()) {
      const f = familiaDe(c.tipo);
      porFamilia.set(f, [...(porFamilia.get(f) ?? []), c]);
    }
    const orden = (a: Chip, b: Chip) => RANGO[a.peor] - RANGO[b.peor] || b.n - a.n;
    return [...porFamilia.entries()]
      .map(([familia, chips]) => ({ familia, chips: chips.sort(orden) }))
      .sort((a, b) => orden(a.chips[0], b.chips[0]) || b.chips.length - a.chips.length);
  }, [banderas]);

  const [abierta, setAbierta] = useState<Chip | null>(null);
  // La última abierta queda en el panel mientras se cierra (su animación).
  const ultima = useRef<Chip | null>(null);
  if (abierta) ultima.current = abierta;
  const enPanel = ultima.current;

  if (grupos.length === 0) return <p className="text-meta text-mute">Vigía no registra banderas de este proveedor en otros procesos.</p>;

  return (
    <>
      <ul className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 [.tarjeta_&]:border-0">
        {grupos.map(({ familia, chips }) => {
          const peor = chips[0].peor;
          const Icono = ICONO_NIVEL[peor];
          return (
            <li key={familia} className="bg-paper px-3.5 py-3">
              <p className="flex flex-wrap items-baseline gap-x-2 text-meta font-semibold text-ink">
                <Icono size={13} className={cn("shrink-0 self-center", peor === "alta" ? "text-crimsonTexto" : peor === "media" ? "text-amberTexto" : "text-mute")} aria-hidden />
                {FAMILIA[familia].titulo}
                <span className="font-mono text-rotulo font-normal tabular-nums text-mute">{numero(chips.reduce((s, c) => s + c.n, 0))}</span>
              </p>
              <p className="mt-0.5 text-rotulo leading-snug text-mute">{FAMILIA[familia].explica}</p>
              <ul className="mt-2 flex flex-wrap gap-1.5">
                {chips.map((c) => {
                  const cuerpo = (
                    <>
                      <IconoBandera tipo={c.tipo} size={13} />
                      <span className="min-w-0 break-words text-left">{c.nombre}</span>
                      <span className="shrink-0 font-mono tabular-nums opacity-80">{numero(c.n)}</span>
                      {esEmpresa && <ChevronRight size={12} className="shrink-0 opacity-70" aria-hidden />}
                    </>
                  );
                  const clase = cn("inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-rotulo font-semibold", CHIP_TONO[c.peor]);
                  return (
                    <li key={c.tipo} className="min-w-0 max-w-full">
                      {esEmpresa ? (
                        <button
                          type="button"
                          onClick={() => setAbierta(c)}
                          aria-haspopup="dialog"
                          aria-label={`${c.nombre}: ${plural(c.n, "vez", "veces")}. Ver en qué procesos`}
                          className={cn(clase, "transition-colors duration-rapido hover:border-granate/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate")}
                        >
                          {cuerpo}
                        </button>
                      ) : (
                        <span className={clase}>{cuerpo}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>

      {enPanel && esEmpresa && (
        <Panel
          abierto={!!abierta}
          onCerrar={() => setAbierta(null)}
          titulo={enPanel.nombre}
          descripcion={
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Severidad bandera={enPanel.peor} formato="linea" />
              <span>{plural(enPanel.n, "vez", "veces")} en otros procesos de este proveedor</span>
            </span>
          }
          ancho="lg"
          pie={
            <Link href={rutaEmpresa(ruc, "antecedentes", { atipo: enPanel.tipo })} prefetch={false} className="inline-flex min-h-9 items-center gap-1 text-meta font-semibold text-granate hover:underline">
              Verlas con su evidencia en la ficha de la empresa <ArrowUpRight size={14} aria-hidden />
            </Link>
          }
        >
          <ProcesosDeBandera key={enPanel.tipo} ruc={ruc} chip={enPanel} />
        </Panel>
      )}
    </>
  );
}

/** El contenido del panel: qué es la bandera y la lista de sus procesos, con buscador. */
function ProcesosDeBandera({ ruc, chip }: { ruc: string; chip: Chip }) {
  const [datos, setDatos] = useState<AntecedenteEmpresa[] | null | undefined>(undefined);
  const [q, setQ] = useState("");
  useEffect(() => {
    let vivo = true;
    void pedirAntecedentes(ruc).then((d) => {
      if (vivo) setDatos(d);
    });
    return () => {
      vivo = false;
    };
  }, [ruc]);

  const suyos = useMemo(() => {
    const lista = (datos ?? []).filter((a) => a.tipo === chip.tipo);
    return lista.sort((a, b) => (RANGO[a.severidad] ?? 3) - (RANGO[b.severidad] ?? 3) || String(b.fecha ?? "").localeCompare(String(a.fecha ?? "")));
  }, [datos, chip.tipo]);
  const consulta = paraBuscar(q);
  // Se busca por la entidad, el código del proceso y lo que dice la bandera: nunca por nombres de personas.
  const vistos = consulta ? suyos.filter((a) => coincide(paraBuscar(`${a.entidad ?? ""} ${a.codigo ?? ""} ${a.ocid ?? ""} ${a.etiqueta ?? ""}`), consulta)) : suyos;
  const explica = TIPO_CRUCE[chip.tipo]?.explica;

  return (
    <CuerpoDetalle>
      {explica && (
        <BloqueDetalle titulo="Qué quiere decir">
          <p>{explica}</p>
        </BloqueDetalle>
      )}
      <BloqueDetalle
        titulo="En qué procesos"
        acciones={datos ? <span className="shrink-0 font-mono text-rotulo tabular-nums text-mute">{consulta ? `${numero(vistos.length)} de ${numero(suyos.length)}` : numero(suyos.length)}</span> : undefined}
      >
        {datos === undefined ? (
          <p role="status" className="text-mute">
            Cargando los procesos…
          </p>
        ) : datos === null ? (
          <Nota>No se pudo traer la lista ahora. Está también en la ficha de la empresa, en Antecedentes.</Nota>
        ) : suyos.length === 0 ? (
          <Nota>
            La lista de la ficha de la empresa no trae hoy procesos con esta bandera: el dictamen la contó el día del análisis y la base pudo cambiar desde
            entonces.
          </Nota>
        ) : (
          <>
            {suyos.length >= 6 && (
              <label className="mb-2.5 flex h-10 items-center gap-2 rounded-xl border border-line bg-paper px-3 focus-within:border-granate">
                <Search size={14} className="shrink-0 text-mute" aria-hidden />
                <span className="sr-only">Buscar por entidad o código del proceso</span>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar por entidad o código"
                  className="min-w-0 flex-1 bg-transparent text-dato text-ink placeholder:text-mute focus:outline-none"
                />
              </label>
            )}
            {vistos.length === 0 ? (
              <p className="text-mute">Ningún proceso coincide con «{q}».</p>
            ) : (
              <ul className="divide-y divide-line/70 rounded-xl border border-line">
                {vistos.map((a, i) => {
                  const id = a.ocid ?? a.codigo;
                  return (
                    <li key={`${id ?? "sin"}-${i}`} className="px-3.5 py-2.5">
                      <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        {a.entidad ? (
                          a.entidadRuc ? (
                            <Link href={`/entidad/${a.entidadRuc}`} prefetch={false} className="min-w-0 text-dato font-semibold text-granate hover:underline">
                              {tituloNatural(a.entidad)}
                            </Link>
                          ) : (
                            <span className="min-w-0 text-dato font-semibold text-ink">{tituloNatural(a.entidad)}</span>
                          )
                        ) : (
                          <span className="text-dato text-mute">Sin entidad en el registro</span>
                        )}
                        <Severidad bandera={a.severidad} formato="punto" />
                      </p>
                      <p className="mt-0.5 text-meta leading-snug text-inkSoft">{a.etiqueta}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-rotulo text-mute">
                        {id && (
                          <Link href={rutaContrato(String(id))} prefetch={false} className="font-mono text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
                            Proceso {a.codigo ?? a.ocid}
                          </Link>
                        )}
                        {a.fecha && <Dato tipo="fecha">{fechaConAnio(a.fecha)}</Dato>}
                        {a.montoSoles != null && a.montoSoles > 0 && <span className="font-mono tabular-nums text-inkSoft">{soles(a.montoSoles)}</span>}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}
