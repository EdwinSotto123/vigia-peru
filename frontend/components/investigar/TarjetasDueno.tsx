"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, ChevronDown, ChevronRight, UserRound } from "lucide-react";
import { BotonFila, ProveedorDetalle } from "@/components/listado/DetalleFilas";
import { nombreCortoEmpresa } from "@/lib/empresas";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { PatronDueno } from "@/lib/patrones";
import { esRucEnClaro, esRucPersonaNatural } from "@/lib/privacidad";
import { cn } from "@/lib/utils";
import { detalleDueno } from "./DetallePatron";

/** En el celular se ven estos primeros; los demás, al tocar «Ver los N más» (nueve tarjetas eran cuatro pantallas). */
const EN_CELULAR = 4;

/**
 * «Un mismo dueño gana con varias empresas» en la ficha de una entidad, como tarjetas (2026-11-23, el usuario: «no tiene
 * forma ni jerarquía»). La tabla ponía las empresas en un renglón cortado con «…» y al socio en letra chica debajo: no se
 * veía que el patrón ES una persona con varias empresas. Ahora cada caso dibuja eso: el socio arriba y sus empresas
 * colgando de él; a la derecha el monto grande y cuántos de sus contratos salieron a 90 días o menos de otro (la forma
 * grave) con su barra. Toda la tarjeta abre el panel con la evidencia (`detalleDueno`, el mismo de la tabla); el nombre
 * de cada empresa va a su ficha.
 */
export function TarjetasDueno({ filas }: { filas: PatronDueno[] }) {
  const [todas, setTodas] = useState(false);
  const detalles = filas.map((p, i) => ({ id: `dueno-${i}`, ...detalleDueno(p) }));
  const ocultas = todas ? 0 : Math.max(0, filas.length - EN_CELULAR);
  return (
    <ProveedorDetalle detalles={detalles} nombre="Socios que ganan con varias empresas">
      <ul aria-label="Socios que ganan en esta entidad con varias empresas" className="space-y-3">
        {filas.map((p, i) => (
          <TarjetaDueno key={`dueno-${i}`} id={`dueno-${i}`} p={p} className={cn(!todas && i >= EN_CELULAR && "max-sm:hidden")} />
        ))}
      </ul>
      {ocultas > 0 && (
        <button
          type="button"
          onClick={() => setTodas(true)}
          className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-line text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 hover:text-granate sm:hidden"
        >
          Ver {ocultas === 1 ? "el otro" : `los ${numero(ocultas)} más`} <ChevronDown size={16} aria-hidden />
        </button>
      )}
    </ProveedorDetalle>
  );
}

/** Las formas societarias escritas enteras, en su sigla: «Sociedad Anónima Cerrada» ocupaba media tarjeta. */
const FORMAS: [RegExp, string][] = [
  [/\bsociedad an[oó]nima cerrada\b/gi, "S.A.C."],
  [/\bsociedad an[oó]nima abierta\b/gi, "S.A.A."],
  [/\bsociedad comercial de responsabilidad limitada\b/gi, "S.R.L."],
  [/\bempresa individual de responsabilidad limitada\b/gi, "E.I.R.L."],
  [/\bsociedad an[oó]nima\b/gi, "S.A."],
];
const conSiglas = (t: string) => FORMAS.reduce((s, [re, sigla]) => s.replace(re, sigla), t).replace(/\s{2,}/g, " ").trim();

/**
 * El nombre de una empresa como se lee: el nombre corto si la razón social lo trae («… - GRUPO SANTA FE S.A.C.»), la forma
 * societaria en sigla y sin MAYÚSCULAS. Si las dos mitades dicen lo mismo con la sigla, una sola. El nombre entero, al pasar.
 */
function nombreEmpresa(nombre: string | null): { texto: string; completo?: string } {
  if (!nombre) return { texto: "Empresa sin nombre" };
  const corto = nombreCortoEmpresa(nombre);
  let base = corto?.corto ?? nombre;
  if (!corto) {
    const i = nombre.lastIndexOf(" - ");
    if (i > 0 && conSiglas(nombre.slice(0, i)).toLowerCase() === conSiglas(nombre.slice(i + 3)).toLowerCase()) base = nombre.slice(i + 3);
  }
  const t = tituloNatural(conSiglas(base));
  const texto = t.charAt(0).toUpperCase() + t.slice(1);
  const entero = tituloNatural(nombre);
  return { texto, completo: entero.toLowerCase() !== texto.toLowerCase() ? entero : undefined };
}

function Empresa({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  const { texto, completo } = nombreEmpresa(nombre);
  if (!esRucEnClaro(ruc) || esRucPersonaNatural(ruc)) return <span title={completo}>{texto}</span>;
  return (
    <Link
      href={`/empresa/${ruc}`}
      prefetch={false}
      title={completo}
      className="pointer-events-auto relative z-[3] break-words font-semibold text-ink underline decoration-line underline-offset-[3px] transition-colors duration-rapido hover:text-granate hover:decoration-granate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
    >
      {texto}
    </Link>
  );
}

function periodo(desde: string | null, hasta: string | null): string | null {
  const a = desde?.slice(0, 4);
  const b = hasta?.slice(0, 4);
  if (!a && !b) return null;
  return a && b && a !== b ? `${a} a ${b}` : (a ?? b)!;
}

function TarjetaDueno({ p, id, className }: { p: PatronDueno; id: string; className?: string }) {
  const socio = p.socios?.[0]?.nombre;
  const otros = Math.max(0, (p.socios?.length ?? 0) - 1);
  const empresas = p.empresas ?? [];
  const grave = p.seguidos > 0;
  const parte = p.contratos > 0 ? Math.min(1, p.seguidos / p.contratos) : 0;
  const anios = periodo(p.desde, p.hasta);
  return (
    <li className={cn("gs-mira group/tarjeta relative overflow-hidden rounded-2xl border border-line bg-paper transition-colors duration-rapido hover:border-granate/40", className)}>
      {/* La tarjeta entera abre la evidencia: el botón va debajo de todo y lo de encima deja pasar el toque, salvo los enlaces. */}
      <BotonFila
        id={id}
        etiqueta={`Ver la evidencia: ${socio ? tituloNatural(socio) : "un socio"}, con ${plural(empresas.length, "empresa", "empresas")}`}
        className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate"
        claseAbierta="bg-granate-50/60"
      />
      <div className="pointer-events-none relative z-[1] grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_minmax(9rem,auto)_auto] sm:items-center sm:gap-5 sm:p-5">
        <div className="min-w-0">
          <p className="flex items-center gap-3">
            <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-granate-50 text-granate ring-1 ring-granate/25">
              <UserRound size={19} strokeWidth={2} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block break-words font-display text-bloque font-bold leading-snug text-ink">{socio ? tituloNatural(socio) : "Socio sin nombre publicado"}</span>
              <span className="block text-meta text-inkSoft">
                Socio de {empresas.length === 2 ? "las dos" : `las ${numero(empresas.length)}`}
                {otros ? `, con ${plural(otros, "socio más", "socios más")}` : ""}
                {anios ? <span className="tabular-nums">, {anios}</span> : null}
              </span>
            </span>
            <ChevronRight size={18} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-hover/tarjeta:translate-x-0.5 sm:hidden" />
          </p>
          {/* Sus empresas, colgando de él: la raya baja del círculo y cada una sale con su rama. */}
          <ul aria-label="Sus empresas" className="ml-5">
            {empresas.map((e, k) => (
              <li
                key={e.ruc}
                className={cn(
                  "relative flex items-start gap-2 pl-5 pt-2 text-dato leading-snug",
                  "before:absolute before:left-0 before:top-[1.2rem] before:h-px before:w-3.5 before:bg-ink/25",
                  "after:absolute after:left-0 after:top-0 after:w-px after:bg-ink/25 first:after:-top-3",
                  // La última corta la raya en su rama: no sigue colgando hacia abajo.
                  k === empresas.length - 1 ? "after:h-[1.2rem] first:after:h-[1.95rem]" : "after:bottom-0",
                )}
              >
                <Building2 size={15} aria-hidden className="mt-0.5 shrink-0 text-mute" />
                <Empresa ruc={e.ruc} nombre={e.nombre} />
              </li>
            ))}
          </ul>
        </div>
        {/* Las cifras: en el celular una franja bajo las empresas; desde sm, una columna a la derecha. */}
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-line pt-3 sm:block sm:border-0 sm:pt-0 sm:text-right">
          <p>
            <span className="block font-display text-seccion font-bold leading-none tabular-nums text-ink sm:text-cifra">{p.monto != null ? solesCompacto(p.monto) : "Sin monto"}</span>
            <span className="mt-1 block text-meta text-inkSoft">en {plural(p.contratos, "contrato parecido", "contratos parecidos")}</span>
          </p>
          {grave ? (
            <p className="flex items-center gap-2 sm:mt-2.5 sm:justify-end">
              <span aria-hidden className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-crimson/15 sm:w-14">
                <span className="gs-barra-crece block h-full rounded-full bg-crimson" style={{ width: `${Math.max(10, Math.round(parte * 100))}%` }} />
              </span>
              <span className="text-meta leading-tight text-crimsonTexto sm:text-left">
                <b className="font-semibold tabular-nums">
                  {numero(p.seguidos)} de {numero(p.contratos)}
                </b>
{" "}
                <span className="sm:block">a 90 días o menos</span>
              </span>
            </p>
          ) : (
            <p className="text-meta leading-tight text-mute sm:mt-2.5">Ninguno a 90 días o menos</p>
          )}
        </div>
        <ChevronRight size={20} aria-hidden className="hidden text-mute transition-transform duration-rapido group-hover/tarjeta:translate-x-0.5 group-hover/tarjeta:text-granate sm:block" />
      </div>
    </li>
  );
}
