"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Award, Building2, CalendarDays, FileWarning, Gavel, Landmark, ShieldCheck, Tag, Users, type LucideIcon } from "lucide-react";
import { Medidor } from "@/components/charts/BarraSegmentada";
import { listaY, numero, oracion } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { fechaDossier, montoDossier } from "../dossier";
import type { ApiResult } from "../types";
import { mismoNombre } from "./historia";
import { nombreLegibleEmpresa } from "@/lib/nombreEmpresa";

const esRucEmpresa = (ruc: unknown) => /^20\d{9}$/.test(String(ruc ?? ""));

/**
 * Un proveedor por su nombre: la empresa (RUC 20) enlaza a su ficha; la persona natural va en vidrio y NUNCA se enlaza
 * (su RUC 10 lleva su DNI); un consorcio sin RUC, tal cual.
 */
export function NombreProveedor({ nombre, ruc, className }: { nombre: string; ruc?: string | null; className?: string }) {
  if (esPersonaNatural(ruc)) return <PersonName name={nombre} orden="sunat" />;
  // Como en la cabecera de la ficha («Laboratorios AC Farma S.A.», no «LABORATORIOS AC FARMA S.A.»).
  const { texto, completo } = nombreLegibleEmpresa(nombre);
  if (esRucEmpresa(ruc)) {
    return (
      <Link href={`/empresa/${ruc}`} prefetch={false} title={completo} className={cn("font-semibold text-granate hover:underline", className)}>
        {texto}
      </Link>
    );
  }
  return <span className={className} title={completo}>{texto}</span>;
}

/** Lo que ganó cada uno según la ficha (`ganadores_ficha`: las adjudicaciones vigentes y el CONOSCE), por RUC. */
type GanadoFicha = { ruc: string; monto: number; items: number[] };

/** «ítem 7», «ítems 2 y 6». */
const losItems = (xs: number[]) => {
  const ys = [...new Set(xs)].sort((a, b) => a - b);
  return ys.length === 0 ? "" : ys.length === 1 ? `ítem ${ys[0]}` : `ítems ${listaY(ys.map(String))}`;
};

interface Hecho {
  icono: LucideIcon;
  texto: ReactNode;
  tono?: "alta" | "media";
}
const TONO_HECHO = { alta: "text-crimsonTexto", media: "text-amberTexto" } as const;

/**
 * «Quién ganó y con quién compite», corto: el ganador (con su ficha), lo que dicen de él los registros públicos (SUNAT,
 * CONOSCE, sanciones y penalidades del OECE) y quiénes más se presentaron, con su oferta si el acta se leyó. La red de
 * personas, las vinculaciones políticas y la investigación web quedan en «Proveedor y red».
 */
export function QuienGano({ result, ganador, ganadores, nPostores }: { result: ApiResult; ganador: any; ganadores: any[]; nPostores: number | null }) {
  const exp = (result as any).expediente_proveedor ?? null;
  const acta = (result as any).lecturas_documentos?.acta?.salida ?? null;
  const hechos = hechosDelProveedor(exp);
  // Cuánto de lo que ganó en el Estado salió de esta entidad: la dependencia de un cliente se ve mejor en una barra.
  const totalBp = Number(exp?.historial?.procesos);
  const deEsta = Number(exp?.historial?.con_esta_entidad?.procesos);
  const parte = totalBp > 0 && deEsta > 0 && deEsta <= totalBp ? deEsta / totalBp : null;
  const otrosGanadores = ganadores.filter((g) => g !== ganador);

  // Quiénes se presentaron: TODOS los del registro OCDS, con la oferta y el puntaje de los que nombra el acta leída (el
  // acta a veces trae sólo a los ganadores: listarla sola dejaba «19 postores» con tres nombres debajo).
  const delActa: any[] = Array.isArray(acta?.postores) ? acta.postores.filter((p: any) => p?.nombre) : [];
  const delRegistro: any[] = ((result.postores || []) as any[]).filter((p) => p?.nombre);
  const postores = unirPostores(delRegistro, delActa);
  const fichaGanadores: GanadoFicha[] = Array.isArray((result as any).ganadores_ficha) ? (result as any).ganadores_ficha : [];
  const oficiales = new Map(fichaGanadores.filter((g) => g?.ruc).map((g) => [g.ruc, g]));
  const suParte = ganador?.ruc && otrosGanadores.length > 0 ? oficiales.get(ganador.ruc) : undefined;
  const referencial = Number((result as any).convocatoria?.cuantia_total) || null;

  return (
    <div className="space-y-3">
      {/* Dentro del capítulo (`.tarjeta`), sin marco: un fondo apenas hundido. */}
      <div className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5 [.tarjeta_&]:rounded-xl [.tarjeta_&]:border-0 [.tarjeta_&]:bg-paperSoft">
        {ganador?.nombre ? (
          <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-dato text-inkSoft">
            <span>
              {esPersonaNatural(ganador.ruc) ? "Ganó una persona natural:" : "Ganó"}{" "}
              <NombreProveedor nombre={ganador.nombre} ruc={ganador.ruc} className="text-destacado" />
            </span>
            {ganador.ruc && (
              <span className="font-mono text-meta text-mute">
                RUC <Ruc value={ganador.ruc} />
              </span>
            )}
            {/* Con varios ganadores, qué parte es la suya: el resto del capítulo es su análisis. */}
            {suParte && suParte.monto > 0 && (
              <span className="text-meta text-inkSoft">
                {losItems(suParte.items) ? `${losItems(suParte.items)}, ` : ""}por {montoDossier(suParte.monto)}
              </span>
            )}
          </p>
        ) : (
          <p className="text-dato text-mute">Sin adjudicación publicada: el registro todavía no dice quién ganó.</p>
        )}
        {otrosGanadores.length > 0 && (
          <p className="mt-1 text-meta text-inkSoft">
            También ganaron otros ítems:{" "}
            {otrosGanadores.map((g, i) => (
              <span key={g.ruc ?? i}>
                {i > 0 && (i === otrosGanadores.length - 1 ? " y " : ", ")}
                <NombreProveedor nombre={g.nombre} ruc={g.ruc} />
              </span>
            ))}
            {/* «… S.A.C.» ya cierra con punto. */}
            {/[.…]$/.test(String(otrosGanadores[otrosGanadores.length - 1]?.nombre ?? "").trim()) ? "" : "."}
          </p>
        )}
        {parte != null && totalBp >= 3 && (
          <div className="mt-3 max-w-md">
            <p className="text-meta text-inkSoft">
              Esta entidad le dio <strong className="font-semibold text-ink">{numero(deEsta)} de sus {numero(totalBp)}</strong> buenas pro con el
              Estado (<strong className="font-semibold text-ink">{numero(Math.round(parte * 100))} %</strong>)
            </p>
            <Medidor parte={parte} etiqueta={`${deEsta} de ${totalBp} buenas pro con esta entidad`} className="mt-1.5" />
          </div>
        )}
        {hechos.length > 0 ? (
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2" aria-label="Lo que dicen los registros del proveedor">
            {hechos.map((h, i) => (
              <li key={i} className="flex min-w-0 items-start gap-2 text-meta leading-snug text-inkSoft">
                <h.icono size={15} className={cn("mt-0.5 shrink-0", h.tono ? TONO_HECHO[h.tono] : "text-mute")} aria-hidden />
                <span className="min-w-0 break-words">{h.texto}</span>
              </li>
            ))}
          </ul>
        ) : (
          ganador?.nombre && (
            <p className="mt-2 text-rotulo text-mute">
              Este análisis no trae la ficha del proveedor en los registros públicos: lo que se encontró de él está en «Proveedor y red».
            </p>
          )
        )}
      </div>

      <Competidores postores={postores} conActa={delActa.length > 0} nPostores={nPostores} oficiales={oficiales} referencial={referencial} />
    </div>
  );
}

/** Lo que dicen los registros del proveedor, en hechos con ícono (no en tabla): SUNAT, antigüedad, giro, historial y sanciones. */
function hechosDelProveedor(exp: any): Hecho[] {
  if (!exp) return [];
  // Un consorcio: quiénes lo forman (cada uno con su ficha en «Proveedor y red»).
  if (exp.consorcio && Array.isArray(exp.integrantes)) {
    const integrantes = exp.integrantes.filter((e: any) => e?.nombre || e?.sunat?.razon_social);
    return [
      {
        icono: Users,
        texto: (
          <>
            Consorcio de <strong className="font-semibold text-ink">{numero(integrantes.length)}</strong>{" "}
            {integrantes.length === 1 ? "integrante" : "integrantes"}
            {integrantes.length > 0 && ": "}
            {integrantes.map((e: any, i: number) => (
              <span key={e.ruc ?? i}>
                {i > 0 && (i === integrantes.length - 1 ? " y " : ", ")}
                <NombreProveedor nombre={e.nombre || e.sunat?.razon_social} ruc={e.ruc} />
              </span>
            ))}
          </>
        ),
      },
    ];
  }
  const out: Hecho[] = [];
  const s = exp.sunat ?? null;
  const h = exp.historial ?? {};
  const misma = h.con_esta_entidad ?? null;
  const sanc: any[] = Array.isArray(exp.sanciones) ? exp.sanciones : [];
  const pen = exp.penalidades ?? null;
  const fuerte = "font-semibold text-ink";
  if (!s && (exp.persona_natural || esPersonaNatural(exp.ruc))) {
    out.push({ icono: Building2, texto: "Persona natural con negocio: no está en el padrón de empresas" });
  }
  if (s) {
    const estado = [s.estado, s.condicion].filter(Boolean).join(", ");
    if (estado) out.push({ icono: Building2, texto: <>En la SUNAT: <strong className={fuerte}>{oracion(String(estado))}</strong></> });
    if (s.fecha_inicio_actividades) {
      const anios = typeof s.edad_dias_al_contratar === "number" ? Math.floor(s.edad_dias_al_contratar / 365) : null;
      out.push({
        icono: CalendarDays,
        texto: (
          <>
            En actividad desde el <strong className={fuerte}>{fechaDossier(s.fecha_inicio_actividades, true)}</strong>
            {anios != null && (anios >= 1 ? ` (${anios} ${anios === 1 ? "año" : "años"} al contratar)` : ` (${s.edad_dias_al_contratar} días al contratar)`)}
          </>
        ),
      });
    }
    if (s.actividad) out.push({ icono: Tag, texto: <>Giro declarado: <strong className={fuerte}>{String(s.actividad).trim().replace(/\.$/, "")}</strong></> });
    if (s.inhabilitada) {
      out.push({
        icono: Gavel,
        tono: "alta",
        texto: <>Inhabilitada: {String(s.inhabilitada)}{s.inhabilitada_hasta ? ` hasta el ${fechaDossier(s.inhabilitada_hasta, true)}` : ""}</>,
      });
    }
  }
  if (h.procesos != null) {
    out.push({
      icono: Award,
      texto: (
        <>
          <strong className={fuerte}>{numero(h.procesos)}</strong> {h.procesos === 1 ? "buena pro" : "buenas pro"} con el Estado
          {h.primera && ` desde el ${fechaDossier(h.primera, true)}`}
          {h.monto != null && (
            <>
              , por <strong className={fuerte}>{montoDossier(h.monto)}</strong>
            </>
          )}
        </>
      ),
    });
  }
  if (misma?.procesos != null) {
    out.push({
      icono: Landmark,
      // Cinco o más con la misma entidad: el mismo tono que en la ficha del proveedor.
      tono: misma.procesos >= 5 ? "media" : undefined,
      texto: misma.procesos ? (
        <>
          <strong className={fuerte}>{numero(misma.procesos)}</strong> con esta entidad
          {h.entidades === 1 ? ", su único cliente público" : misma.monto != null ? `, por ${montoDossier(misma.monto)}` : ""}
        </>
      ) : (
        "Ninguna buena pro antes con esta entidad"
      ),
    });
  }
  if (sanc.length > 0) {
    out.push({ icono: Gavel, tono: "alta", texto: <><strong className={fuerte}>{numero(sanc.length)}</strong> {sanc.length === 1 ? "sanción" : "sanciones"} del OECE</> });
  } else if (Array.isArray(exp.sanciones)) {
    out.push({ icono: ShieldCheck, texto: "Sin sanciones del OECE registradas" });
  }
  if (Number(pen?.n) > 0) {
    out.push({
      icono: FileWarning,
      tono: "media",
      texto: <><strong className={fuerte}>{numero(pen.n)}</strong> {Number(pen.n) === 1 ? "penalidad" : "penalidades"} en contratos anteriores</>,
    });
  }
  return out;
}

/**
 * Los participantes del registro con lo que el acta dice de cada uno (por RUC o, si el RUC viene tapado distinto, por
 * nombre), más los que sólo nombra el acta. Los ganadores primero; el resto, en el orden del registro.
 */
function unirPostores(registro: any[], acta: any[]): any[] {
  if (registro.length === 0) return acta;
  const usados = new Set<any>();
  const unidos = registro.map((r) => {
    const a = acta.find((x) => !usados.has(x) && ((r.ruc && x.ruc === r.ruc) || mismoNombre(x.nombre, r.nombre)));
    if (!a) return r;
    usados.add(a);
    return { ...a, ...r, monto_ofertado: a.monto_ofertado, puntaje: a.puntaje, admitida: a.admitida, motivo_fuera: a.motivo_fuera, ganador: r.es_ganador === true || a.ganador === true };
  });
  const gano = (p: any) => p.ganador === true || p.es_ganador === true;
  return [...unidos, ...acta.filter((x) => !usados.has(x))].sort((x, y) => Number(gano(y)) - Number(gano(x)));
}

/**
 * Con quién compitió: todos los que se presentaron (sin recorte: suelen ser pocos, y si no, son la evidencia), el ganador
 * marcado, y su oferta, puntaje y por qué quedó fuera si el acta se leyó. Con uno solo, una línea que lo dice.
 */
function Competidores({
  postores,
  conActa,
  nPostores,
  oficiales,
  referencial,
}: {
  postores: any[];
  conActa: boolean;
  nPostores: number | null;
  oficiales: Map<string, GanadoFicha>;
  referencial: number | null;
}) {
  const n = Math.max(postores.length, nPostores ?? 0);
  if (n <= 1) {
    return (
      <p className="flex items-start gap-2 text-meta text-inkSoft">
        <Users size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
        {n === 1 ? "Nadie más se presentó: fue el único postor." : "El registro no publica quiénes se presentaron."}
      </p>
    );
  }
  return (
    <section aria-labelledby="relato-competidores" className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:bg-transparent [.tarjeta_&]:px-0 [.tarjeta_&]:pb-0">
      <h4 id="relato-competidores" className="flex flex-wrap items-baseline gap-x-2 font-display text-bloque font-bold text-ink">
        Con quién compitió
        <span className="font-sans text-rotulo font-normal text-mute">
          {numero(n)} participantes en el registro del OECE{conActa ? "; la oferta y los puntos de la evaluación, del acta de buena pro" : ""}
        </span>
      </h4>
      <ul className="mt-2 divide-y divide-line/70">
        {postores.map((p, i) => {
          const gano = p.ganador === true || p.es_ganador === true;
          // Quien ganó, con lo que ganó según la ficha (sus ítems y su monto): el acta leída puede traer su oferta de OTRO
          // ítem (Jobal «ofertó S/ 1,168,500» en el ítem 1, que perdió, y ganó el 7 por S/ 1,293,011; 2026-2543-197).
          const suyo = gano && p.ruc ? oficiales.get(p.ruc) : undefined;
          const oferta = Number(p.monto_ofertado);
          // Una oferta de más de tres veces el valor referencial del proceso está mal leída del acta (S/ 509 M en uno de S/ 51 M).
          const dudosa = referencial != null && oferta > 3 * referencial;
          const datos = [
            suyo && suyo.monto > 0
              ? `${losItems(suyo.items) ? `${losItems(suyo.items)}, ` : ""}por ${montoDossier(suyo.monto)}`
              : oferta > 0
                ? dudosa
                  ? "su oferta no se lee bien en el acta"
                  : `ofertó ${montoDossier(oferta)}`
                : null,
            // Los puntos de la evaluación del comité (acta), no el puntaje de riesgo de Vigía (0 a 100). Si la línea dice lo
            // que ganó según la ficha, los puntos del acta pueden ser de otro ítem: no van.
            !suyo && p.puntaje != null && Number.isFinite(Number(p.puntaje)) ? `${numero(Number(p.puntaje))} puntos en la evaluación` : null,
            p.admitida === false ? "oferta no admitida" : null,
            p.motivo_fuera ? `quedó fuera: ${String(p.motivo_fuera)}` : null,
          ].filter((x): x is string => Boolean(x));
          return (
            <li key={`${p.ruc ?? p.nombre}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-2 text-meta">
              <span className="min-w-0 break-words text-ink">
                <NombreProveedor nombre={String(p.nombre)} ruc={p.ruc} />
                {gano && <span className="ml-2 pill border-moss/30 bg-moss/10 text-mossTexto">Ganó</span>}
              </span>
              {datos.length > 0 && <span className="text-rotulo tabular-nums text-inkSoft">{listaY(datos)}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
