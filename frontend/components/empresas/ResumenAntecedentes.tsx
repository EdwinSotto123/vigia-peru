import Link from "next/link";
import { ChevronRight, Info } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { Severidad } from "@/components/ui/Severidad";
import { TIPO_CRUCE } from "@/lib/cruces";
import { numero, plural } from "@/lib/formato";
import { CORTO_EMPRESA, rutaEmpresa, type AntecedentePorTipo } from "@/lib/empresas";
import { P_ANTECEDENTES } from "./secciones/antecedentes";

/** Cuántos tipos se ven en el Inicio; los demás, en la pestaña Antecedentes. */
const VISIBLES = 5;

/**
 * Lo que dicen de la empresa otros registros públicos, en el Inicio de su ficha: una fila por tipo de antecedente, de la
 * señal más alta a la más baja (como llegan de la API), con su severidad, cuántos registros y qué quiere decir en su ⓘ;
 * cada fila abre sus casos con la fuente. Los cinco primeros y «Ver los N». Antes eran 12 tarjetas con la explicación
 * abierta (~800 px en escritorio, ~1,450 en el celular) y la severidad en un adjetivo sin ícono («Grave»).
 * Sin puntaje ni ranking (el usuario lo sacó el 2026-10-22: «tiene mucho sesgo y parece acusación»): son hechos, cada
 * uno verificable. Server-safe.
 */
export function ResumenAntecedentes({ antecedentes, ruc }: { antecedentes: AntecedentePorTipo[]; ruc: string }) {
  if (!antecedentes.length) {
    return (
      <p className="tarjeta flex items-start gap-2 rounded-2xl border border-line bg-paper p-4 text-dato text-inkSoft sm:p-5">
        <Info size={16} className="mt-0.5 shrink-0 text-mute" aria-hidden />
        <span className="min-w-0">
          Ningún otro registro la nombra: no figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de
          campaña, las autoridades y candidatos, ni en los demás cruces de Vigía.
        </span>
      </p>
    );
  }
  const resto = antecedentes.length - VISIBLES;
  return (
    <div className="tarjeta overflow-hidden rounded-2xl border border-line bg-paper">
      <ul className="divide-y divide-line/70" aria-label="Tipos de antecedente, de la señal más alta a la más baja">
        {/* recorte: los cinco de señal más alta; el resto, en «Ver los N tipos» (abajo) y en la pestaña Antecedentes. */}
        {antecedentes.slice(0, VISIBLES).map((a) => (
          <FilaAntecedente key={a.tipo} a={a} href={rutaEmpresa(ruc, "antecedentes", { [P_ANTECEDENTES.tipo]: a.tipo })} />
        ))}
      </ul>
      <Link
        href={rutaEmpresa(ruc, "antecedentes")}
        className="flex min-h-11 items-center justify-between gap-3 border-t border-line/70 px-4 py-2.5 text-meta font-semibold text-granate transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5"
      >
        {resto > 0 ? `Ver los ${numero(antecedentes.length)} tipos, cada caso con su fuente` : "Ver cada caso con su fuente"}
        <ChevronRight size={16} className="shrink-0" aria-hidden />
      </Link>
    </div>
  );
}

/**
 * Una fila: severidad, el tipo (con su ⓘ) y cuántos registros. El enlace se estira sobre toda la fila y el ⓘ queda
 * encima, para poder tocarlo sin abrir la fila (un botón dentro de un enlace sería un control dentro de otro). En el
 * celular la severidad y el conteo bajan a una segunda línea: el nombre del tipo no se recorta.
 */
function FilaAntecedente({ a, href }: { a: AntecedentePorTipo; href: string }) {
  const titulo = CORTO_EMPRESA[a.tipo] ?? TIPO_CRUCE[a.tipo]?.corto ?? a.etiqueta;
  const explica = TIPO_CRUCE[a.tipo]?.explica;
  const registros = plural(a.n, "registro", "registros");
  return (
    <li className="relative flex items-center gap-3 px-4 py-2.5 transition-colors duration-rapido hover:bg-paperSoft sm:px-5">
      <span className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        <span className="flex shrink-0 items-center gap-2 max-sm:order-2 sm:w-[7.5rem]">
          <Severidad bandera={a.severidad} />
          <span className="text-meta tabular-nums text-inkSoft sm:hidden">{registros}</span>
        </span>
        <span className="flex min-w-0 items-center gap-1 sm:flex-1">
          <Link
            href={href}
            className="min-w-0 text-dato font-medium leading-snug text-ink line-clamp-2 after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-granate sm:line-clamp-1"
            title={titulo}
          >
            {titulo}
          </Link>
          {explica && (
            <Ayuda titulo={titulo} etiqueta={`Qué quiere decir «${titulo}»`} className="z-[1]">
              {explica}
            </Ayuda>
          )}
        </span>
        <span className="hidden shrink-0 text-meta tabular-nums text-inkSoft sm:inline">{registros}</span>
      </span>
      <ChevronRight size={16} className="shrink-0 text-mute" aria-hidden />
    </li>
  );
}
