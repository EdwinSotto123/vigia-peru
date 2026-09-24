"use client";

import {
  Ban,
  Building2,
  CircleAlert,
  CircleCheck,
  DoorOpen,
  EyeOff,
  FilePen,
  HandCoins,
  Landmark,
  PenLine,
  ScrollText,
  TriangleAlert,
  UserRound,
  Users,
  Vote,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ResultadoClave } from "./fuentesFlujo";
import type { CifrasFlujo } from "./ExploradorFuentes";

/** Los gráficos de cada resultado del mapa de fuentes (ExploradorFuentes). */
const nf = (n: number) => n.toLocaleString("es-PE");

/**
 * El gráfico de cada resultado. Donde la portada tiene la cifra real (el
 * mismo API que el resto de la página), barras con esa cifra. Donde no hay un
 * número agregado que mostrar (proveedores, personas, relaciones), un esquema
 * de papeles: dice quién aparece y cómo se conecta, sin un solo nombre ni un
 * solo número inventado.
 */
export function Visual({ clave, cifras }: { clave: ResultadoClave; cifras: CifrasFlujo | null }) {
  if (clave === "contratos" && cifras?.porTipo?.length) {
    // Las barras suman el total del título: los tipos más comunes y, al final,
    // el resto en gris (page.tsx lo calcula contra el total).
    return (
      <Barras
        titulo={cifras.publicados != null ? `${nf(cifras.publicados)} contratos publicados, por tipo` : "Contratos publicados, por tipo"}
        filas={cifras.porTipo.map((t) => ({ etiqueta: t.etiqueta, n: t.n, clase: t.resto ? "bg-paper/40" : undefined }))}
      />
    );
  }
  if (clave === "entidades" && cifras?.regiones?.length) {
    return <Barras titulo="Dónde se contrata más (contratos por región)" filas={cifras.regiones.map((z) => ({ etiqueta: z.nombre, n: z.n }))} />;
  }
  if (clave === "senales" && cifras?.porRiesgo) {
    // Mismo universo que el nodo del informe: todos los contratos leídos,
    // también los que se revisaron y no se publicaron. Así la suma de las
    // barras es el número del título y el del informe.
    const r = cifras.porRiesgo;
    const leidos = r.alto + r.medio + r.bajo + r.enRevision + r.descartado;
    return (
      <Barras
        titulo={`${nf(leidos)} contratos leídos, según lo que se encontró`}
        filas={[
          { etiqueta: "Señal alta", n: r.alto, Icono: TriangleAlert, clase: "bg-rust" },
          { etiqueta: "Señal media", n: r.medio, Icono: CircleAlert, clase: "bg-amber" },
          { etiqueta: "Sin señal relevante", n: r.bajo, Icono: CircleCheck, clase: "bg-moss" },
          ...(r.enRevision > 0 ? [{ etiqueta: "En revisión de una persona", n: r.enRevision, Icono: UserRound, clase: "bg-paper/40" }] : []),
          ...(r.descartado > 0 ? [{ etiqueta: "Revisado y no publicado", n: r.descartado, Icono: EyeOff, clase: "bg-paper/25" }] : []),
        ]}
      />
    );
  }
  if (clave === "informe" && cifras?.leidos != null) {
    return (
      <div className="rounded-lg bg-paper/[0.04] p-3">
        <p className="font-serif text-3xl font-bold leading-none text-paper">{nf(cifras.leidos)}</p>
        <p className="mt-1 text-[12px] text-paper/60">
          contratos ya leídos
          {cifras.publicados != null && <> de {nf(cifras.publicados)} publicados</>}
        </p>
      </div>
    );
  }
  if (clave === "proveedores") {
    return (
      <Esquema
        centro={{ Icono: Building2, t: "Empresa" }}
        brazos={[
          { Icono: Users, t: "Socios" },
          { Icono: PenLine, t: "Representante" },
          { Icono: Ban, t: "¿Sancionada?" },
          { Icono: ScrollText, t: "Otros contratos" },
        ]}
      />
    );
  }
  if (clave === "personas") {
    const papeles: [LucideIcon, string][] = [
      [Users, "Socios"],
      [PenLine, "Representantes"],
      [FilePen, "Firmantes"],
      [Vote, "Autoridades"],
      [HandCoins, "Aportantes"],
      [DoorOpen, "Visitantes"],
    ];
    return (
      <ul className="grid grid-cols-3 gap-2" aria-label="Papeles en los que aparece una persona">
        {papeles.map(([I, t]) => (
          <li key={t} className="flex flex-col items-center gap-1 rounded-lg bg-paper/[0.04] px-1 py-2 text-center">
            <I size={16} className="text-heroGreen" aria-hidden />
            <span className="text-[11px] text-paper/70">{t}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (clave === "relaciones") return <EsquemaRelacion />;
  return null;
}

type Fila = { etiqueta: string; n: number; Icono?: LucideIcon; clase?: string };

/** Barras horizontales sin pista de fondo: la proporción la dice el largo, el número va escrito. */
function Barras({ titulo, filas }: { titulo: string; filas: Fila[] }) {
  const max = Math.max(1, ...filas.map((f) => f.n));
  return (
    <figure className="rounded-lg bg-paper/[0.04] p-3">
      <figcaption className="text-[12px] font-medium text-paper/60">{titulo}</figcaption>
      <ul className="mt-2.5 space-y-2">
        {filas.map(({ etiqueta, n, Icono, clase }) => (
          <li key={etiqueta}>
            <div className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex min-w-0 items-center gap-1.5 truncate text-paper/80">
                {Icono && <Icono size={12} className="shrink-0" aria-hidden />}
                {etiqueta}
              </span>
              <span className="shrink-0 font-mono text-[11.5px] text-paper">{nf(n)}</span>
            </div>
            <div
              aria-hidden
              className={cn("mt-1 h-1.5 origin-left rounded-full motion-safe:animate-llenarBarra", clase ?? "bg-heroGreen")}
              style={{ width: `${Math.max(2, (n / max) * 100)}%`, animationDuration: "700ms" }}
            />
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** Una empresa al centro y lo que Vigía averigua de ella alrededor. */
function Esquema({ centro, brazos }: { centro: { Icono: LucideIcon; t: string }; brazos: { Icono: LucideIcon; t: string }[] }) {
  const C = centro.Icono;
  const caja = ({ Icono: I, t }: { Icono: LucideIcon; t: string }) => (
    <span key={t} className="flex items-center gap-1.5 rounded-md border border-paper/10 px-2 py-1.5 text-[11.5px] text-paper/75">
      <I size={13} className="shrink-0 text-heroGreen" aria-hidden />
      {t}
    </span>
  );
  return (
    <div className="rounded-lg bg-paper/[0.04] p-3" role="img" aria-label={`${centro.t}: ${brazos.map((b) => b.t).join(", ")}`}>
      <div className="grid grid-cols-2 gap-2">{brazos.slice(0, 2).map(caja)}</div>
      <div className="my-2 flex items-center justify-center gap-2">
        <span className="h-px flex-1 bg-paper/15" />
        <span className="flex items-center gap-1.5 rounded-full border border-heroGreen/60 bg-heroGreen/10 px-3 py-1 text-[12px] font-semibold text-paper">
          <C size={14} className="text-heroGreen" aria-hidden />
          {centro.t}
        </span>
        <span className="h-px flex-1 bg-paper/15" />
      </div>
      <div className="grid grid-cols-2 gap-2">{brazos.slice(2).map(caja)}</div>
    </div>
  );
}

/**
 * Cómo se lee una relación: los dos cruces que el código hace de verdad
 * (aporte al partido de la autoridad y visita antes de la convocatoria),
 * dibujados con papeles, no con personas. En HTML y vertical: en un nodo de
 * 17 rem un SVG apaisado dejaba el texto en 8 px.
 */
function EsquemaRelacion() {
  const caja = (I: LucideIcon, t: string) => (
    <span className="inline-flex items-center justify-center gap-1.5 rounded-md border border-paper/20 bg-ink px-2.5 py-1.5 text-[12px] font-medium text-paper">
      <I size={13} className="shrink-0 text-heroGreen" aria-hidden />
      {t}
    </span>
  );
  const enlace = (t: string) => (
    <span className="flex flex-col items-center py-1" aria-hidden>
      <span className="h-3 border-l border-dashed border-heroGreen/60" />
      <span className="text-[11px] italic text-paper/55">{t}</span>
      <span className="h-3 border-l border-dashed border-heroGreen/60" />
    </span>
  );
  return (
    <figure
      className="rounded-lg bg-paper/[0.04] p-3 text-center"
      role="img"
      aria-label="Una empresa que se presentó tiene un socio; ese socio aportó al partido de la autoridad o visitó la entidad que contrata"
    >
      {caja(Building2, "Empresa que se presentó")}
      {enlace("tiene de socio a")}
      {caja(UserRound, "Una persona")}
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col items-center">
          {enlace("aportó al")}
          {caja(Vote, "Partido de la autoridad")}
        </div>
        <div className="flex flex-col items-center">
          {enlace("visitó la")}
          {caja(Landmark, "Entidad que contrata")}
        </div>
      </div>
    </figure>
  );
}

// ── Vigía ─────────────────────────────────────────────────────────────────
