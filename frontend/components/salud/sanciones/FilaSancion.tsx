import Link from "next/link";
import { ArrowRight, ChevronDown, Landmark, Scale, TriangleAlert } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { InsigniaHecho } from "@/components/salud/comun";
import { nombreLugar } from "@/components/salud/lista/filtros";
import { Dato } from "@/components/ui/Dato";
import { rutaEn } from "@/lib/gobserva";
import { GRAVEDAD, TIPO_SANCION, fechaCorta, nombrePropio, rutaFicha, type FilaSancion as Fila } from "@/lib/gobserva-salud";
import { uit } from "./filtros";

/** De «… Numeral 5) “No cumplir con las disposiciones sobre la historia clínica”» saca lo que está entre comillas. */
function entreComillas(t: string | null): string | null {
  if (!t) return null;
  const m = t.match(/[“"«]([^”"»]{12,})[”"»]/);
  return m ? m[1].trim().replace(/\.$/, "") : null;
}

/**
 * Una sanción firme del Registro de Sanciones de SUSALUD: el rótulo de la clase de hecho y el tipo (con la multa en UIT,
 * como la publica SUSALUD), la gravedad y si está en un proceso judicial; el nombre tal como lo registró SUSALUD; el
 * establecimiento al que corresponde (si el registro lo une a uno); fecha, procedimiento, resolución y lugar; y la
 * infracción: lo que dice entre comillas a la vista y el texto completo a un toque. Server-safe.
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
  const lugar = [s.distrito, s.departamento].filter(Boolean).map((x) => nombreLugar(x)).join(", ");
  return (
    <article className="min-w-0 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <InsigniaHecho tipo="sancion_firme" />
        <Insignia tono="neutro" className="text-ink">
          {tipo}
          {s.multaUit != null && s.tipoSancion === "multa" ? ` de ${uit(s.multaUit)} UIT` : ""}
        </Insignia>
        {s.gravedad && (
          <Insignia tono="neutro" Icono={TriangleAlert}>
            Infracción {GRAVEDAD[s.gravedad]?.toLocaleLowerCase("es-PE") ?? s.gravedad}
          </Insignia>
        )}
        {s.judicializada && (
          <Insignia tono="aviso" Icono={Scale} title="El registro de SUSALUD indica que la sanción está en un proceso judicial.">
            En proceso judicial
          </Insignia>
        )}
      </div>

      <h3 className="mt-2.5 text-cuerpo font-semibold leading-snug text-ink">
        <span className="sr-only">Registrada como: </span>
        {nombrePropio(s.nombre)}
      </h3>
      {enlaceIpress && s.ipressNombre && (
        <p className="mt-1 text-meta">
          <Link href={enlaceIpress} prefetch={false} className="group inline-flex min-h-11 flex-wrap items-center gap-x-1 font-semibold text-granate underline-offset-2 sm:min-h-0">
            <span className="font-normal text-inkSoft">Establecimiento:</span>
            <span className="group-hover:underline">{nombrePropio(s.ipressNombre)}</span>
            <ArrowRight size={13} aria-hidden />
          </Link>
        </p>
      )}

      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
        <Dato tipo="fecha">Emitida el {fechaCorta(s.fechaEmision)}</Dato>
        {s.pas && (
          <Dato tipo="documento" nombre="Procedimiento">
            {s.pas}
          </Dato>
        )}
        {lugar && <Dato tipo="lugar">{lugar}</Dato>}
        {(s.administradaTipo || s.naturaleza) && (
          <Dato icono={Landmark} nombre="Institución">
            {[s.administradaTipo, s.naturaleza?.toLocaleLowerCase("es-PE")].filter(Boolean).join(" ")}
          </Dato>
        )}
      </p>

      {(que || s.infraccion) && (
        <div className="mt-3 rounded-xl bg-paperSoft px-3.5 py-3">
          {que && (
            <p className="text-dato leading-relaxed text-ink">
              {s.infraccionCodigo && <span className="mr-1.5 font-mono text-rotulo text-mute">{s.infraccionCodigo}</span>}«{que}»
            </p>
          )}
          {s.infraccion && (
            <details className="group">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 text-meta font-semibold text-granate sm:min-h-8 [&::-webkit-details-marker]:hidden">
                {que ? "La infracción como la registró SUSALUD" : "Ver la infracción"}
                <ChevronDown size={14} aria-hidden className="transition-transform duration-rapido group-open:rotate-180" />
              </summary>
              <p className="mt-1 text-meta leading-relaxed text-inkSoft">
                {!que && s.infraccionCodigo && <span className="mr-1.5 font-mono text-rotulo text-mute">{s.infraccionCodigo}</span>}
                {s.infraccion}
                {s.infraccion.length >= 400 ? "…" : ""}
              </p>
              {s.resolucion && <p className="mt-1.5 text-rotulo text-mute">{s.resolucion}</p>}
            </details>
          )}
        </div>
      )}
    </article>
  );
}
