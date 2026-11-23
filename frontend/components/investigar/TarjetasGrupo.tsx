"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, UserRound } from "lucide-react";
import { MuestraSerie, colorSerie } from "@/components/charts/BarraSegmentada";
import { BotonFila, ProveedorDetalle } from "@/components/listado/DetalleFilas";
import { Severidad } from "@/components/ui/Severidad";
import { nombreCortoEmpresa } from "@/lib/empresas";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { PatronGrupo } from "@/lib/patrones";
import { esRucEnClaro, esRucPersonaNatural } from "@/lib/privacidad";
import { cn } from "@/lib/utils";
import { detalleGrupo } from "./DetallePatron";

/** En el celular se ven estas primeras; las demás, al tocar «Ver las N más». */
const EN_CELULAR = 4;
/** Integrantes con nombre en la tarjeta; los demás se cuentan («y 3 más») y van en la barra y en el panel. */
const CON_NOMBRE = 3;
/** Colores de serie distintos en la barra; desde el séptimo integrante, «otros» en gris. */
const SERIES = 6;

/** Cómo se unen, en palabras: lo que dice `vinculos[].via`. */
const VIA: Record<string, string> = {
  socio_comun: "un socio en común",
  es_socio: "un integrante socio de otro",
  hermanos_probables: "apellidos en común",
};

/**
 * «Grupos de proveedores por dueño o familia» en la ficha de una entidad, como tarjetas (2026-11-23, el usuario: «no
 * tiene forma ni jerarquía»). La tabla mostraba a los integrantes en un renglón cortado. El patrón dice «cada uno solo
 * parece pequeño; juntos se suman», así que eso se dibuja: el monto del grupo grande, una barra partida por integrante
 * (de qué tamaño es cada uno dentro del grupo), los tres mayores con su monto y lo que hicieron juntos en pastillas
 * (órdenes el mismo día, correlativas, objeto repartido, al borde del tope). Toda la tarjeta abre la evidencia
 * (`detalleGrupo`, el mismo panel de la tabla); los nombres van a su ficha.
 */
export function TarjetasGrupo({ filas }: { filas: PatronGrupo[] }) {
  const [todas, setTodas] = useState(false);
  const detalles = filas.map((p, i) => ({ id: `grupo-${i}`, ...detalleGrupo(p) }));
  const ocultas = todas ? 0 : Math.max(0, filas.length - EN_CELULAR);
  return (
    <ProveedorDetalle detalles={detalles} nombre="Grupos de proveedores">
      <ul aria-label="Grupos de proveedores por dueño o familia en esta entidad" className="space-y-3">
        {filas.map((p, i) => (
          <TarjetaGrupo key={`grupo-${i}`} id={`grupo-${i}`} p={p} className={cn(!todas && i >= EN_CELULAR && "max-sm:hidden")} />
        ))}
      </ul>
      {ocultas > 0 && <VerMas n={ocultas} onClick={() => setTodas(true)} />}
    </ProveedorDetalle>
  );
}

/** «Ver los N más» del celular: muestra las tarjetas que esperaban (sólo bajo sm). */
export function VerMas({ n, onClick, femenino = true }: { n: number; onClick: () => void; femenino?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-3 flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 hover:text-granate sm:hidden"
    >
      {n === 1 ? (femenino ? "Ver la otra" : "Ver el otro") : `Ver ${femenino ? "las" : "los"} ${numero(n)} más`} <ChevronDown size={16} aria-hidden />
    </button>
  );
}

type Miembro = PatronGrupo["miembros"][number];

function nombreMiembro(m: Miembro): string {
  if (!m.nombre) return m.persona ? "Persona natural" : "Empresa sin nombre";
  const corto = m.persona ? null : nombreCortoEmpresa(m.nombre);
  const t = tituloNatural(corto?.corto ?? m.nombre)
    .replace(/\bSociedad An[oó]nima Cerrada\b/gi, "S.A.C.")
    .replace(/\bSociedad Comercial de Responsabilidad Limitada\b/gi, "S.R.L.")
    .replace(/\bEmpresa Individual de Responsabilidad Limitada\b/gi, "E.I.R.L.");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** El nombre de un integrante: la empresa a su ficha, la persona (un apellido tapado) a la suya si la tiene. */
function Integrante({ m }: { m: Miembro }) {
  const texto = nombreMiembro(m);
  const clase =
    "pointer-events-auto relative z-[3] min-w-0 truncate font-semibold text-ink underline decoration-line underline-offset-[3px] transition-colors duration-rapido hover:text-granate hover:decoration-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate";
  const href = !m.persona && esRucEnClaro(m.ruc) && !esRucPersonaNatural(m.ruc) ? `/empresa/${m.ruc}` : m.codigo ? `/app/personas/${m.codigo}` : null;
  return href ? (
    <Link href={href} prefetch={false} className={clase} title={m.nombre ? tituloNatural(m.nombre) : undefined}>
      {texto}
    </Link>
  ) : (
    <span className="min-w-0 truncate font-semibold text-ink">{texto}</span>
  );
}

/** Una pastilla de lo que hicieron juntos: roja si es de lo grave, ámbar si es para mirar. */
function Senal({ tono, children }: { tono: "alta" | "media" | "neutro"; children: ReactNode }) {
  return (
    <li
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-meta font-medium leading-tight",
        tono === "alta" ? "border-crimson/30 bg-crimson/10 text-crimsonTexto" : tono === "media" ? "border-amber/40 bg-amber/10 text-amberTexto" : "border-line bg-paperSoft text-inkSoft",
      )}
    >
      {children}
    </li>
  );
}

function TarjetaGrupo({ p, id, className }: { p: PatronGrupo; id: string; className?: string }) {
  const miembros = [...(p.miembros ?? [])].sort((a, b) => b.monto - a.monto);
  const total = miembros.reduce((s, m) => s + m.monto, 0) || p.monto || 1;
  // En orden fijo (socio, integrante socio, apellidos) y en una frase: «un socio en común y apellidos en común».
  const vias = Object.keys(VIA).filter((k) => (p.vinculos ?? []).some((v) => v.via === k)).map((k) => VIA[k]);
  const unidos = vias.length > 1 ? `${vias.slice(0, -1).join(", ")} y ${vias[vias.length - 1]}` : vias[0];
  const resto = miembros.length - CON_NOMBRE;
  const serie = (i: number) => (i < SERIES ? i : ("otros" as const));
  const senales: { tono: "alta" | "media" | "neutro"; texto: string }[] = [];
  if (p.parientesDeFuncionarios?.length) senales.push({ tono: "alta", texto: `${plural(p.parientesDeFuncionarios.length, "integrante", "integrantes")} pariente de un funcionario` });
  if (p.correlativas) senales.push({ tono: "alta", texto: `${plural(p.correlativas, "par de órdenes correlativas", "pares de órdenes correlativas")}` });
  if (p.repartidos) senales.push({ tono: "alta", texto: `${plural(p.repartidos, "objeto repartido", "objetos repartidos")}, ${solesCompacto(p.montoRepartido)}` });
  if (p.diasJuntos) senales.push({ tono: "media", texto: `${plural(p.diasJuntos, "día", "días")} con órdenes a varios a la vez` });
  if (p.hasta8Uit && p.borde) senales.push({ tono: "media", texto: `${numero(p.borde)} de ${numero(p.hasta8Uit)} órdenes al borde del tope${p.sobreTope ? `, ${numero(p.sobreTope)} encima` : ""}` });
  if (p.parteEntidad != null && p.parteEntidad >= 0.5) senales.push({ tono: "neutro", texto: `${porcentaje(p.parteEntidad * 100)} de lo que le vende al Estado sale de aquí` });

  return (
    <li className={cn("gs-mira group/tarjeta relative overflow-hidden rounded-2xl border border-line bg-paper transition-colors duration-rapido hover:border-granate/40", className)}>
      <BotonFila
        id={id}
        etiqueta={`Ver la evidencia del grupo de ${plural(miembros.length, "integrante", "integrantes")}, ${solesCompacto(p.monto)} en órdenes`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
        claseAbierta="bg-granate-50/60"
      />
      <div className="pointer-events-none relative z-[1] p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0">
            <span className="block font-display text-seccion font-bold leading-none tabular-nums text-ink sm:text-cifra">{solesCompacto(p.monto)}</span>
            <span className="mt-1.5 block text-meta text-inkSoft">
              en {plural(p.ordenes, "orden", "órdenes")} a {plural(miembros.length, "integrante", "integrantes")}
              {unidos ? <span className="block">Unidos por {unidos}</span> : null}
            </span>
          </p>
          <span className="flex shrink-0 items-center gap-2">
            <Severidad bandera={p.severidad} className="max-sm:hidden" />
            <Severidad bandera={p.severidad} formato="punto" className="sm:hidden" />
            <ChevronRight size={20} aria-hidden className="text-mute transition-transform duration-rapido group-hover/tarjeta:translate-x-0.5 group-hover/tarjeta:text-granate" />
          </span>
        </div>

        {/* De qué tamaño es cada uno dentro del grupo: solo, cada uno parece chico. */}
        <div aria-hidden className="mt-4 flex h-2.5 gap-0.5 overflow-hidden rounded-full">
          {miembros.map((m, i) => (
            <span key={m.ruc} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${Math.max(1.5, (100 * m.monto) / total)}%`, background: colorSerie(serie(i)) }} />
          ))}
        </div>
        <ul aria-label="Sus integrantes, de mayor a menor" className="mt-3 space-y-1.5">
          {/* recorte: los tres mayores con nombre; los demás se cuentan en «y N más» y están en la barra y en el panel */}
          {miembros.slice(0, CON_NOMBRE).map((m, i) => (
            <li key={m.ruc} className="flex min-w-0 items-center gap-2 text-dato leading-snug">
              <MuestraSerie i={serie(i)} />
              {m.persona ? <UserRound size={14} aria-hidden className="shrink-0 text-mute" /> : null}
              <Integrante m={m} />
              <span className="ml-auto shrink-0 pl-2 tabular-nums text-inkSoft">{solesCompacto(m.monto)}</span>
            </li>
          ))}
          {resto > 0 ? <li className="pl-[18px] text-meta text-mute">y {plural(resto, "integrante más", "integrantes más")}</li> : null}
        </ul>

        {senales.length > 0 && (
          <ul aria-label="Lo que hicieron juntos" className="mt-4 flex flex-wrap gap-1.5 border-t border-line pt-3">
            {senales.map((s) => (
              <Senal key={s.texto} tono={s.tono}>
                {s.texto}
              </Senal>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

/** «Todos / Sólo los graves» con sus conteos (los que se saben): dos botones con estado, no una casilla perdida. */
export function FiltroGraves({ graves, onCambio, todos, nGraves }: { graves: boolean; onCambio: (graves: boolean) => void; todos: number | null; nGraves: number | null }) {
  return (
    <div role="group" aria-label="Qué casos ver" className="inline-flex shrink-0 rounded-full border border-line bg-paperSoft p-1">
      {[
        { valor: false, texto: "Todos", n: todos },
        { valor: true, texto: "Sólo los graves", n: nGraves },
      ].map((o) => (
        <button
          key={o.texto}
          type="button"
          aria-pressed={graves === o.valor}
          onClick={() => onCambio(o.valor)}
          className={cn(
            "inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-dato font-semibold transition-colors duration-rapido focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate",
            graves === o.valor ? "bg-ink text-paper" : "text-inkSoft hover:text-ink",
          )}
        >
          {o.texto}
          {o.n != null ? <span className={cn("tabular-nums", graves === o.valor ? "text-paper/70" : "text-mute")}>{numero(o.n)}</span> : null}
        </button>
      ))}
    </div>
  );
}
