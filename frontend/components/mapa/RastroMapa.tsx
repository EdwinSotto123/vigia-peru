"use client";

import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { PulseDot } from "@/components/ui/PulseDot";
import { Ayuda } from "@/components/patrones/Ayuda";
import { numero } from "@/lib/formato";
import { nombreDepartamento } from "./region-match";
import { fraseEnCurso, type EnCurso } from "./useEnCurso";

/**
 * Debajo de la barra del mapa: dónde estoy y cómo vuelvo (Perú › región › zona),
 * y, sólo si hay algo en curso, dónde se está leyendo AHORA. El punto que late es
 * `moss` (en vivo = positivo), no el acento de marca.
 *
 * "Ahora" es una fila de chips (departamento + cuántos), no una oración por
 * departamento: con cuatro zonas en curso la frase ocupaba dos renglones. El
 * desglose de cada una (leyéndose, en espera) va en su `title` y en su nombre
 * accesible; qué cuenta, en el ⓘ.
 */
export function RastroMapa({
  region,
  zona,
  onPeru,
  onRegion,
  onQuitarZona,
  enCurso,
}: {
  /** Nombre de la región abierta, o null en la vista del país. */
  region: string | null;
  /** Provincia o distrito elegido dentro de la región. */
  zona: string | null;
  onPeru: () => void;
  onRegion: () => void;
  onQuitarZona: () => void;
  enCurso: Record<string, EnCurso>;
}) {
  const deptos = Object.keys(enCurso).sort((a, b) => nombreDepartamento(a).localeCompare(nombreDepartamento(b), "es"));
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 pb-3 sm:px-5">
      <nav aria-label="Dónde estás en el mapa" className="flex min-h-[28px] items-center gap-1.5 text-[12px]">
        <button
          type="button"
          onClick={onPeru}
          disabled={!region}
          className="rounded text-inkSoft transition-colors duration-rapido hover:text-granate disabled:cursor-default disabled:text-ink disabled:hover:text-ink"
        >
          Perú
        </button>
        {region && (
          <>
            <ChevronRight size={12} className="text-mute" aria-hidden />
            <button
              type="button"
              onClick={onRegion}
              disabled={!zona}
              aria-current={zona ? undefined : "location"}
              className="rounded font-semibold text-ink transition-colors duration-rapido hover:text-granate disabled:cursor-default disabled:hover:text-ink"
            >
              {region}
            </button>
          </>
        )}
        {zona && (
          <>
            <ChevronRight size={12} className="text-mute" aria-hidden />
            <span className="font-semibold text-ink" aria-current="location">
              {zona}
            </span>
            <button
              type="button"
              onClick={onQuitarZona}
              aria-label={`Quitar ${zona} y ver toda la región`}
              className="ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-mute transition-colors duration-rapido hover:bg-paperDeep hover:text-ink"
            >
              <X size={12} aria-hidden />
            </button>
          </>
        )}
      </nav>

      {/* Lo que se está leyendo AHORA. Sólo aparece si hay algo en curso. */}
      {deptos.length > 0 && (
        <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] text-inkSoft" role="status">
          <PulseDot color="moss" size={7} />
          <span className="font-semibold text-ink">Ahora</span>
          {deptos.map((ub) => {
            const e = enCurso[ub];
            const frase = `${nombreDepartamento(ub)}, ${fraseEnCurso(e)}`;
            return (
              <Link
                key={ub}
                href={`/app/auditoria?ubigeo=${ub}`}
                title={frase}
                aria-label={`${frase}. Ver en vivo`}
                className="inline-flex min-h-[24px] items-center gap-1 rounded-full border border-line bg-paper px-2 py-0.5 font-medium text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50"
              >
                {nombreDepartamento(ub)}
                <span className="font-semibold tabular-nums text-ink">{numero(e.leyendo + e.enEspera)}</span>
              </Link>
            );
          })}
          <Ayuda titulo="¿Qué se está leyendo ahora?">
            Contratos financiados que se están leyendo, esperan su turno o esperan que bajen sus documentos, por
            departamento. Cada chip abre esa zona en vivo.
          </Ayuda>
        </div>
      )}
    </div>
  );
}
