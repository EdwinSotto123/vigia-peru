import Link from "next/link";
import { BarraSegmentada, MuestraSerie, type ParteBarra } from "@/components/charts/BarraSegmentada";
import { numero, plural, solesCompacto } from "@/lib/formato";
import type { ObservadoControl, TemaObservado } from "@/lib/corrupcion";
import { cn } from "@/lib/utils";
import { temaDe } from "./piezas";

/**
 * Lo que la Contraloría observó, por tema (migración 314): una barra que reparte el perjuicio que cuantifican las
 * observaciones (o, si ninguna lo cuantifica, cuántas son) y la lista con las dos cifras de cada tema. La usan la pestaña
 * Control de una entidad, una región o un partido y el mapa nacional de /app/contraloria, donde cada tema es además un
 * filtro del ranking (`enlaceTema`). El tema lo puso una lectura automática de la Ficha Resumen. Server-safe.
 */
export function LoObservado({
  datos,
  titulo = "Qué observó, por tema",
  enlaceTema,
  activo = null,
  className,
}: {
  datos: ObservadoControl;
  titulo?: string;
  /** La URL que deja el ranking en un tema (null: todos). Sin ella, la lista no es un filtro. */
  enlaceTema?: (tema: string | null) => string;
  activo?: string | null;
  className?: string;
}) {
  const conPerjuicio = datos.perjuicioPen > 0;
  const medida = (t: TemaObservado) => (conPerjuicio ? t.perjuicioPen : t.observaciones);
  const leyenda = (t: TemaObservado) => (conPerjuicio ? `${solesCompacto(t.perjuicioPen)} en ${plural(t.observaciones, "observación", "observaciones")}` : plural(t.observaciones, "observación", "observaciones"));
  // «Otros» va al final y en gris; los demás, de mayor a menor (el color es el del puesto).
  const temas = [...datos.porTema].filter((t) => t.tema !== "otros").sort((a, b) => medida(b) - medida(a) || b.observaciones - a.observaciones);
  const otros = datos.porTema.find((t) => t.tema === "otros") ?? null;
  const parte = (t: TemaObservado): ParteBarra => ({ clave: t.tema, nombre: t.temaTexto, valor: medida(t), texto: leyenda(t) });
  const filas = [...temas.map((t, i) => ({ t, i: i as number | "otros" })), ...(otros ? [{ t: otros, i: "otros" as const }] : [])];
  if (!filas.length) return null;
  return (
    <div className={cn("rounded-xl border border-line bg-paper p-4", className)} data-bloque>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 className="text-dato font-semibold text-ink">{titulo}</h4>
        <p className="text-rotulo text-mute">
          {conPerjuicio ? "La barra reparte el perjuicio que cuantifican las observaciones" : "La barra reparte las observaciones leídas"}
        </p>
      </div>
      <BarraSegmentada
        className="mt-3"
        etiqueta={conPerjuicio ? "Perjuicio que cuantifican las observaciones, por tema" : "Observaciones por tema"}
        partes={temas.filter((t) => medida(t) > 0).map(parte)}
        otros={otros && medida(otros) > 0 ? parte(otros) : null}
      />
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {filas.map(({ t, i }) => {
          const icono = temaDe(t.tema, t.temaTexto);
          const Icono = icono?.icono;
          const contenido = (
            <>
              <span className="flex min-w-0 items-center gap-2">
                <MuestraSerie i={i} />
                {Icono && <Icono size={14} strokeWidth={1.9} className="hidden shrink-0 text-mute sm:block" aria-hidden />}
                <span className="min-w-0 text-meta font-medium leading-snug text-ink">{t.temaTexto}</span>
              </span>
              <span className="shrink-0 text-right">
                {t.perjuicioPen > 0 && <span className="block font-mono text-meta tabular-nums text-ink">{solesCompacto(t.perjuicioPen)}</span>}
                <span className="block text-rotulo tabular-nums text-mute">{plural(t.observaciones, "observación", "observaciones")}</span>
              </span>
            </>
          );
          const clase = "flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 py-1";
          return (
            <li key={t.tema}>
              {enlaceTema ? (
                <Link
                  href={enlaceTema(activo === t.tema ? null : t.tema)}
                  prefetch={false}
                  scroll={false}
                  aria-current={activo === t.tema ? "true" : undefined}
                  title={activo === t.tema ? "Quitar el filtro" : `Ver las entidades con más perjuicio señalado en ${t.temaTexto.toLocaleLowerCase("es")}`}
                  className={cn(clase, "transition-colors hover:bg-paperSoft", activo === t.tema && "bg-paperSoft ring-1 ring-granate/40")}
                >
                  {contenido}
                </Link>
              ) : (
                <span className={clase}>{contenido}</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-rotulo leading-relaxed text-mute">
        {numero(datos.observaciones)} {datos.observaciones === 1 ? "observación leída" : "observaciones leídas"}
        {datos.contratos > 0 ? `; ${plural(datos.contratos, "contrato de Vigía nombrado", "contratos de Vigía nombrados")} en ellas` : ""}. El tema y el perjuicio los
        sacó una lectura automática (IA) de la Ficha Resumen: es un orden de magnitud, no una liquidación.
      </p>
    </div>
  );
}
