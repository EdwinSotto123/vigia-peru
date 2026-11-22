import Link from "next/link";
import { ChevronDown, Scale } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { rutaEn } from "@/lib/gobserva";
import { GRAVEDAD, TIPO_SANCION, nombrePropio, rutaFicha, type FilaSancion as Fila } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { uit } from "./filtros";

/** De «… Numeral 5) “No cumplir con las disposiciones sobre la historia clínica”» saca lo que está entre comillas. */
function entreComillas(t: string | null): string | null {
  if (!t) return null;
  const m = t.match(/[“"«]([^”"»]{12,})[”"»]/);
  return m ? m[1].trim().replace(/\.$/, "") : null;
}

/** «Soleil S.A.C. / Soleil S.A.C.» → «Soleil S.A.C.»: SUSALUD repite el nombre cuando la razón social es la misma. */
function sinRepetir(nombre: string): string {
  const partes = nombre.split(/\s+\/\s+/).map((p) => p.trim()).filter(Boolean);
  const vistas = new Set<string>();
  const unicas = partes.filter((p) => {
    const k = p.toLocaleLowerCase("es-PE").replace(/[^a-z0-9ñ]/g, "");
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
  return unicas.join(" / ");
}

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];

/** «2026-11-09» → { dia: "9 nov.", anio: "2026" }. */
function partesFecha(iso: string | null): { dia: string; anio: string } | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return { dia: `${Number(m[3])} ${MESES[Number(m[2]) - 1]}`, anio: m[1] };
}

/**
 * Una sanción firme del Registro de Sanciones de SUSALUD, como FILA de una placa (la placa la pone la lista).
 *
 * 2026-11-21 (el usuario: «atosigante, sin jerarquías»): antes cada sanción era una tarjeta con cuatro insignias (una de
 * ellas, «Sanción firme», igual en todas), el nombre repetido («X / X»), una línea de datos y un recuadro para la
 * infracción. Ahora: la fecha a la izquierda, como en un registro; el tipo en negrita (la multa con sus UIT, en rojo) y la
 * gravedad en texto; el nombre (lleva a su establecimiento si el registro lo une a uno); lo que dice la infracción entre
 * comillas; y el resto (texto completo, resolución, procedimiento, lugar, institución) a un toque. Sólo queda una
 * insignia: «En proceso judicial», que cambia cómo se lee la sanción. Server-safe.
 */
export function FilaSancion({ s, base }: { s: Fila; base: string }) {
  const codigoValido = !!s.ipressCodigo && /^\d{1,8}$/.test(s.ipressCodigo);
  const enlaceIpress = codigoValido
    ? rutaEn(base, rutaFicha(s.ipressCodigo as string))
    : s.ipressNombre
      ? `${rutaEn(base, "/buscar")}?q=${encodeURIComponent(s.ipressNombre)}`
      : null;
  const que = entreComillas(s.infraccion);
  const tipo = TIPO_SANCION[s.tipoSancion] ?? "Sanción";
  const pesada = s.tipoSancion === "multa" || /cierre|clausura/i.test(tipo);
  const lugar = [s.distrito, s.departamento].filter(Boolean).map((x) => nombreLugar(x)).join(", ");
  const nombre = sinRepetir(nombrePropio(s.nombre));
  const fecha = partesFecha(s.fechaEmision);
  const institucion = [s.administradaTipo, s.naturaleza?.toLocaleLowerCase("es-PE")].filter(Boolean).join(" ");
  return (
    <article className="grid min-w-0 gap-x-5 gap-y-1 px-4 py-4 sm:grid-cols-[5.5rem_minmax(0,1fr)] sm:px-5">
      {fecha ? (
        <p className="text-meta text-inkSoft sm:pt-0.5">
          <time dateTime={s.fechaEmision ?? undefined} className="flex gap-1.5 sm:flex-col sm:gap-0">
            <span className="font-semibold text-ink">{fecha.dia}</span>
            <span className="tabular-nums">{fecha.anio}</span>
          </time>
        </p>
      ) : (
        <p className="text-meta text-mute">Sin fecha</p>
      )}

      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-dato">
          <span className={cn("font-semibold", pesada ? "text-crimsonTexto" : "text-ink")}>
            {tipo}
            {s.multaUit != null && s.tipoSancion === "multa" ? ` de ${uit(s.multaUit)} UIT` : ""}
          </span>
          {s.gravedad && <span className="text-meta text-inkSoft">infracción {GRAVEDAD[s.gravedad]?.toLocaleLowerCase("es-PE") ?? s.gravedad}</span>}
          {lugar && <span className="text-meta text-mute">{lugar}</span>}
          {s.judicializada && (
            <Insignia tono="aviso" Icono={Scale} title="El registro de SUSALUD indica que la sanción está en un proceso judicial.">
              En proceso judicial
            </Insignia>
          )}
        </p>

        <h3 className="mt-1 text-cuerpo font-semibold leading-snug text-ink">
          <span className="sr-only">Registrada como: </span>
          {enlaceIpress ? (
            <Link href={enlaceIpress} prefetch={false} className="underline decoration-line underline-offset-4 hover:text-granate hover:decoration-granate">
              {nombre}
            </Link>
          ) : (
            nombre
          )}
        </h3>
        {enlaceIpress && s.ipressNombre && !nombre.toLocaleLowerCase("es-PE").includes(nombrePropio(s.ipressNombre).toLocaleLowerCase("es-PE")) && (
          <p className="text-meta text-inkSoft">Establecimiento: {nombrePropio(s.ipressNombre)}</p>
        )}

        {que && <p className="mt-1.5 max-w-[80ch] text-pretty text-dato leading-relaxed text-inkSoft">«{que}»</p>}

        <details className="group mt-1">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-granate sm:min-h-8 [&::-webkit-details-marker]:hidden">
            {/* Un solo texto para lo mismo (2026-11-22, auditoría: dos rótulos distintos según la fila). */}
            {s.infraccion ? "Ver la infracción y la resolución" : "Ver la resolución"}
            <ChevronDown size={14} aria-hidden className="transition-transform duration-rapido group-open:rotate-180" />
          </summary>
          <div className="mt-1 space-y-1.5 rounded-xl bg-paperSoft px-3.5 py-3 text-meta leading-relaxed text-inkSoft">
            {s.infraccion && (
              <p>
                {s.infraccionCodigo && <span className="mr-1.5 font-mono text-rotulo text-mute">{s.infraccionCodigo}</span>}
                {s.infraccion}
                {s.infraccion.length >= 400 ? "…" : ""}
              </p>
            )}
            <dl className="grid gap-x-4 gap-y-0.5 sm:grid-cols-[auto_minmax(0,1fr)]">
              {s.resolucion && (
                <>
                  <dt className="font-semibold text-ink">Resolución</dt>
                  <dd>{s.resolucion}</dd>
                </>
              )}
              {s.pas && (
                <>
                  <dt className="font-semibold text-ink">Procedimiento</dt>
                  <dd>{s.pas}</dd>
                </>
              )}
              {lugar && (
                <>
                  <dt className="font-semibold text-ink">Lugar</dt>
                  <dd>{lugar}</dd>
                </>
              )}
              {institucion && (
                <>
                  <dt className="font-semibold text-ink">Institución</dt>
                  <dd>{institucion}</dd>
                </>
              )}
            </dl>
          </div>
        </details>
      </div>
    </article>
  );
}
