/**
 * Lo que dicen otros registros públicos de quien ganó: aportes a partidos y candidaturas (ONPE), autoridades
 * electas (JNE), visitas a entidades, penalidades y sanciones del Tribunal (OSCE), y socios compartidos con
 * otro postor (RNP). Cruces automáticos por DNI y RUC (migración 48); los nombres llegan tapados de la API.
 * Son datos de registros oficiales, no conclusiones: cada uno dice de dónde sale.
 */

import type { ReactNode } from "react";
import { Ayuda } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import type { CruceProveedor } from "@/lib/contratos";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEVERIDAD = { alta: "Alta", media: "Media", baja: "Baja" } as const;
const ORDEN = { alta: 0, media: 1, baja: 2 } as const;
const FUENTE: Record<string, string> = {
  onpe_aportantes: "ONPE · Claridad",
  onpe_candidatos: "ONPE · Claridad",
  jne_autoridades: "JNE · autoridades electas",
  penalidades: "OECE · penalidades",
  osce_sancionados: "Tribunal de Contrataciones · sancionados",
  visitas_entidades: "Registro de visitas",
  rnp_conformacion_juridica: "RNP · conformación jurídica",
};
/** Cuántas filas de un mismo tipo se ven antes de "ver más". */
const VISIBLES = 3;

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const n = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" && v ? Number(v) : null);
const rango = (a: unknown, b: unknown) => {
  const x = txt(String(a ?? "")), y = txt(String(b ?? ""));
  if (!x && !y) return null;
  const f = (s: string | null) => (s && /^\d{4}-\d{2}-\d{2}/.test(s) ? fechaCorta(s) : s);
  return x === y || !y ? f(x) : `${f(x) ?? "?"} – ${f(y)}`;
};
function quien(c: CruceProveedor): ReactNode {
  const s = c.socios[0];
  if (!s) return null;
  return (
    <>
      <span className="font-semibold">{s.nombre}</span>
      {s.rol && s.rol !== "titular" && <span className="text-inkSoft"> ({s.rol})</span>}
    </>
  );
}

/** Una línea de texto por cruce, con los datos del registro. */
function Texto({ c }: { c: CruceProveedor }) {
  const d = c.detalle;
  switch (c.tipo) {
    case "aporte":
    case "aporte_empresa": {
      const veces = n(d.aportes);
      return (
        <>
          {c.tipo === "aporte" ? quien(c) : "La empresa"} aportó <b>{solesCompacto(c.montoSoles)}</b> a {txt(d.partido) ?? "una organización política"}
          {veces && veces > 1 ? ` en ${numero(veces)} aportes` : ""}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}.
        </>
      );
    }
    case "candidato":
      return (
        <>
          {quien(c)} postuló por {txt(d.organizacion) ?? "una organización política"}
          {txt(d.proceso) ? ` en ${d.proceso}` : ""}
          {txt(d.departamento) ? ` (${d.departamento})` : ""}.
        </>
      );
    case "autoridad":
      return (
        <>
          {quien(c)} es {txt(d.cargo)?.toLowerCase() ?? "autoridad"} {[d.distrito, d.provincia, d.departamento].map(txt).filter(Boolean)[0] ? `de ${[d.distrito, d.provincia, d.departamento].map(txt).filter(Boolean)[0]}` : ""}
          {txt(d.organizacion) ? ` por ${d.organizacion}` : ""}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}.
        </>
      );
    case "penalidad":
      return (
        <>
          {numero(n(d.penalidades) ?? 0)} penalidades por <b>{solesCompacto(c.montoSoles)}</b> en {numero(n(d.entidades) ?? 0)}{" "}
          {n(d.entidades) === 1 ? "entidad" : "entidades"}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}.
        </>
      );
    case "sancion":
    case "sancion_vigente": {
      const tipo = txt(d.tipo);
      const que = tipo === "multa" ? "Multa" : tipo === "definitivo" ? "Inhabilitación definitiva" : "Inhabilitación temporal";
      return (
        <>
          {c.tipo === "sancion_vigente" && <>La buena pro ({fechaCorta(c.fecha)}) cayó dentro de esta sanción. </>}
          {que}
          {rango(d.desde, d.hasta) ? ` (${rango(d.desde, d.hasta)})` : ""}
          {tipo === "multa" && c.montoSoles ? ` de ${solesCompacto(c.montoSoles)}` : ""}
          {txt(d.infraccion) ? `: ${txt(d.infraccion)!.replace(/^[-\s]*/, "").slice(0, 160)}` : ""}
          {txt(d.resolucion) ? ` · Res. ${d.resolucion}` : ""}.
        </>
      );
    }
    case "visita_previa": {
      const v = c.visitas[0];
      return (
        <>
          <span className="font-semibold">{v?.visitante ?? "Un socio"}</span> visitó {v?.entidad ?? "una entidad"}
          {d.misma_entidad === true && <b> (la entidad que contrató)</b>} el {fechaCorta(v?.fecha ?? c.fecha)}, {numero(n(d.dias_antes) ?? 0)} días antes de la buena pro
          {v?.funcionario ? <>, y lo recibió {v.funcionario}{v.cargoFuncionario ? ` (${v.cargoFuncionario})` : ""}</> : ""}
          {v?.motivo ? `. Motivo: ${v.motivo.slice(0, 120)}` : ""}.
        </>
      );
    }
    case "socio_comun": {
      const otros = Array.isArray(d.otros_postores) ? (d.otros_postores as string[]) : [];
      return (
        <>
          {quien(c)} también figura en {otros.length === 1 ? "otra empresa" : `${otros.length} empresas`} que se presentó a este mismo proceso
          {otros.length ? <> (RUC <span className="font-mono">{otros.join(", ")}</span>)</> : ""}.
        </>
      );
    }
    default:
      return <>{c.etiqueta}.</>;
  }
}

function Fila({ c }: { c: CruceProveedor }) {
  return (
    <li className="text-[13px] leading-relaxed text-ink">
      <Texto c={c} />{" "}
      <span className="text-[12px] text-mute">
        Fuente:{" "}
        {c.fuenteUrl ? (
          <a href={c.fuenteUrl} target="_blank" rel="noopener noreferrer" className="underline decoration-line underline-offset-2 hover:text-ink">
            {FUENTE[c.fuente] ?? c.fuente}
          </a>
        ) : (
          FUENTE[c.fuente] ?? c.fuente
        )}
      </span>
    </li>
  );
}

export function CrucesProveedor({ cruces, varios }: { cruces: CruceProveedor[]; varios?: boolean }) {
  if (!cruces.length) return null;
  // Un grupo por tipo, en orden de severidad (la más alta del grupo) y luego por cuántas filas tiene.
  const grupos = new Map<string, CruceProveedor[]>();
  for (const c of cruces) grupos.set(c.tipo, [...(grupos.get(c.tipo) ?? []), c]);
  const orden = [...grupos.values()].sort((a, b) =>
    Math.min(...a.map((x) => ORDEN[x.severidad])) - Math.min(...b.map((x) => ORDEN[x.severidad])) || b.length - a.length);

  return (
    <section aria-labelledby="cruces-proveedor" className="rounded-2xl border border-line bg-paper">
      <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
        <h2 id="cruces-proveedor" className="text-[15px] font-semibold text-ink">
          {varios ? "Quienes ganaron, en otros registros públicos" : "Quien ganó, en otros registros públicos"}
        </h2>
        <Ayuda titulo="¿De dónde salen estos cruces?">
          Cruces automáticos por DNI y RUC entre el ganador (y sus socios y representantes del RNP) y los registros de la ONPE, el JNE,
          las visitas a entidades, las penalidades y las sanciones del Tribunal. Son datos oficiales verificables en cada fuente: no prueban
          por sí solos una irregularidad.
        </Ayuda>
      </div>
      <ul className="divide-y divide-line px-4 pb-1">
        {orden.map((grupo) => {
          const sev = grupo.reduce((m, x) => (ORDEN[x.severidad] < ORDEN[m] ? x.severidad : m), grupo[0].severidad);
          const filas = [...grupo].sort((a, b) => ORDEN[a.severidad] - ORDEN[b.severidad] || (b.fecha ?? "").localeCompare(a.fecha ?? ""));
          return (
            <li key={grupo[0].tipo} className="py-3">
              <div className="mb-1.5 flex flex-wrap items-center gap-2">
                <Badge variant={VARIANTE[sev]}>{SEVERIDAD[sev]}</Badge>
                <h3 className="text-[14px] font-semibold text-ink">
                  {grupo[0].etiqueta}
                  {grupo.length > 1 && <span className="font-normal text-mute"> · {grupo.length}</span>}
                </h3>
              </div>
              <ul className="list-disc space-y-1.5 pl-5">
                {filas.slice(0, VISIBLES).map((c, i) => <Fila key={i} c={c} />)}
              </ul>
              {filas.length > VISIBLES && (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[13px] text-inkSoft hover:text-ink">Ver {filas.length - VISIBLES} más</summary>
                  <ul className="mt-1.5 list-disc space-y-1.5 pl-5">
                    {filas.slice(VISIBLES).map((c, i) => <Fila key={i} c={c} />)}
                  </ul>
                </details>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
