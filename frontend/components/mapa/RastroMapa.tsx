"use client";

import Link from "next/link";
import { ChevronRight, X } from "lucide-react";
import { PulseDot } from "@/components/ui/PulseDot";
import { nombreDepartamento } from "./region-match";
import { fraseEnCurso, type EnCurso } from "./useEnCurso";

/**
 * Debajo de la barra del mapa: dónde estoy y cómo vuelvo (Perú › región › zona),
 * y, sólo si hay algo en curso, dónde se está leyendo AHORA. El punto que late es
 * `moss` (en vivo = positivo), no el acento de marca.
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
        <p className="flex min-w-0 items-start gap-1.5 text-[12px] leading-snug text-inkSoft" role="status">
          <PulseDot color="moss" size={7} className="mt-1" />
          <span>
            <span className="font-semibold text-ink">Ahora: </span>
            {deptos.map((ub, i) => (
              <span key={ub}>
                {i > 0 ? "; " : ""}
                <Link href={`/app/auditoria?ubigeo=${ub}`} className="font-medium text-granate underline-offset-2 hover:underline">
                  {nombreDepartamento(ub)}
                </Link>
                , {fraseEnCurso(enCurso[ub]).replace(/^[^:]+: /, "")}
              </span>
            ))}
          </span>
        </p>
      )}
    </div>
  );
}
