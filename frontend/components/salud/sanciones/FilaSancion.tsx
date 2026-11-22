import Link from "next/link";
import { Ban, ChevronDown, FileWarning, Gavel, MapPin, Scale } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import type { Tono } from "@/components/gobserva/ui/Insignia";
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

const TONO_GRAVEDAD: Record<string, Tono> = { leve: "neutro", grave: "aviso", muy_grave: "urgente" };

/**
 * Una sanción firme del Registro de Sanciones de SUSALUD, como casilla (2026-11-22, el usuario: «mejora esta mierda»; antes
 * era una fila de texto donde el nombre, el tipo y la infracción pesaban lo mismo). Arriba, una franja con lo que es: el
 * tipo y, si es multa, sus UIT en grande, con la fecha a la derecha; el color dice el peso (multa o cierre en rojo,
 * amonestación en gris). Debajo, a quién (lleva a su establecimiento si el registro lo une a uno), dónde, la gravedad y si
 * está en juicio, y lo que hizo entre comillas. El resto (texto completo, resolución, procedimiento, institución) a un
 * toque. Server-safe.
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
  const multa = s.tipoSancion === "multa";
  const cierre = /cierre|clausura|revoca/i.test(tipo);
  const lugar = [s.distrito, s.departamento].filter(Boolean).map((x) => nombreLugar(x)).join(", ");
  const nombre = sinRepetir(nombrePropio(s.nombre));
  const fecha = partesFecha(s.fechaEmision);
  const institucion = [s.administradaTipo, s.naturaleza?.toLocaleLowerCase("es-PE")].filter(Boolean).join(" ");
  const Icono = cierre ? Ban : multa ? Gavel : FileWarning;
  return (
    <article className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-paper", multa || cierre ? "border-crimson/25" : "border-line")}>
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", multa || cierre ? "bg-crimson-soft/70" : "bg-paperSoft")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper", multa || cierre ? "text-crimsonTexto" : "text-inkSoft")}>
            <Icono size={19} />
          </span>
          <p className="min-w-0">
            <span className={cn("block text-meta font-semibold", multa || cierre ? "text-crimsonTexto" : "text-inkSoft")}>{multa ? "Multa" : cierre ? "Sanción grave" : "Sanción"}</span>
            <span className={cn("block font-bold leading-tight tabular-nums text-ink", multa ? "font-display text-bloque" : "text-cuerpo")}>
              {multa && s.multaUit != null ? `${uit(s.multaUit)} UIT` : tipo}
            </span>
          </p>
        </div>
        {fecha ? (
          <time dateTime={s.fechaEmision ?? undefined} className="shrink-0 text-right text-meta leading-tight text-inkSoft">
            <span className="block font-semibold text-ink">{fecha.dia}</span>
            <span className="block tabular-nums">{fecha.anio}</span>
          </time>
        ) : (
          <span className="shrink-0 text-meta text-mute">Sin fecha</span>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col px-4 pb-3 pt-3">
        <h3 className="text-cuerpo font-bold leading-snug text-ink">
          <span className="sr-only">Registrada como: </span>
          {enlaceIpress ? (
            <Link href={enlaceIpress} prefetch={false} className="line-clamp-2 underline decoration-line underline-offset-4 hover:text-granate hover:decoration-granate">
              {nombre}
            </Link>
          ) : (
            <span className="line-clamp-2">{nombre}</span>
          )}
        </h3>
        {enlaceIpress && s.ipressNombre && !nombre.toLocaleLowerCase("es-PE").includes(nombrePropio(s.ipressNombre).toLocaleLowerCase("es-PE")) && (
          <p className="mt-0.5 truncate text-rotulo text-inkSoft">Establecimiento: {nombrePropio(s.ipressNombre)}</p>
        )}
        {lugar && (
          <p className="mt-1 flex min-w-0 items-center gap-1 text-meta text-inkSoft">
            <MapPin size={13} aria-hidden className="shrink-0 text-mute" />
            <span className="truncate">{lugar}</span>
          </p>
        )}
        {(s.gravedad || s.judicializada) && (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {s.gravedad && <Insignia tono={TONO_GRAVEDAD[s.gravedad] ?? "neutro"}>{`Infracción ${(GRAVEDAD[s.gravedad] ?? s.gravedad).toLocaleLowerCase("es-PE")}`}</Insignia>}
            {s.judicializada && (
              <Insignia tono="aviso" Icono={Scale} title="El registro de SUSALUD indica que la sanción está en un proceso judicial.">
                En proceso judicial
              </Insignia>
            )}
          </p>
        )}

        {que && (
          <p className="mt-2.5 rounded-lg bg-paperSoft px-3 py-2 text-meta leading-relaxed text-ink">
            <span className="line-clamp-3">«{que}»</span>
          </p>
        )}

        <details className="group mt-auto pt-1.5">
          <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-granate [&::-webkit-details-marker]:hidden">
            {s.infraccion ? "Ver la infracción y la resolución" : "Ver la resolución"}
            <ChevronDown size={14} aria-hidden className="transition-transform duration-rapido group-open:rotate-180" />
          </summary>
          <div className="space-y-1.5 rounded-xl bg-paperSoft px-3.5 py-3 text-meta leading-relaxed text-inkSoft">
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
                  <dd className="break-words">{s.resolucion}</dd>
                </>
              )}
              {s.pas && (
                <>
                  <dt className="font-semibold text-ink">Procedimiento</dt>
                  <dd className="break-words">{s.pas}</dd>
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
