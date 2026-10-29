import Link from "next/link";
import { Building2, CalendarDays, ChevronRight } from "lucide-react";
import { BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, PieDetalle } from "@/components/patrones/Detalle";
import { EnlaceFuente } from "@/components/patrones/Estructura";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { IconoBandera } from "@/components/ui/IconoBandera";
import { ICONO_NIVEL, Severidad } from "@/components/ui/Severidad";
import { fecha, numero, soles, solesCompacto } from "@/lib/formato";
import type { EventoHistoria } from "@/lib/historia";
import { cn } from "@/lib/utils";

/** Adónde lleva «Ver…» según qué es el hecho (sin una, «Verlo en Vigía»). */
const VER: Record<string, string> = {
  contrato: "Ver el contrato",
  buena_pro: "Ver el contrato",
  informe: "Ver sus informes de control",
  obra: "Ver la obra en su lista",
  paralizada: "Ver la obra en su lista",
  inicio: "Ver la obra",
  visita_gano: "Ver las visitas de esa empresa",
  visita: "Ver la entidad que visitó",
  sancion: "Ver sus antecedentes",
  multa: "Ver sus antecedentes",
  penalidad: "Ver sus antecedentes",
  aporte: "Ver sus antecedentes",
  campana: "Ver sus antecedentes",
  candidatura: "Ver sus antecedentes",
  autoridad: "Ver sus antecedentes",
  conformacion: "Ver sus socios",
};

// La gravedad de cada bandera con sus tres canales (color, ícono y palabra), como BanderasFicha.
const BANDERA = {
  alta: { clase: "border-crimson/30 bg-crimson-soft text-crimsonTexto", Icono: ICONO_NIVEL.alta, palabra: "Grave" },
  media: { clase: "border-amber/30 bg-amber-soft text-amberTexto", Icono: ICONO_NIVEL.media, palabra: "Media" },
  baja: { clase: "border-mute/20 bg-paperDeep text-inkSoft", Icono: ICONO_NIVEL.baja, palabra: "Leve" },
} as const;

/** Los datos que se leen mejor en letra de código (un número de informe, el código del proceso). */
const MONO = new Set(["Proceso", "Informe", "Código INFOBRAS"]);

/**
 * El detalle de un hecho de la Historia: la línea de tiempo y la lista de todos los hechos lo muestran igual, armado como
 * todo panel de detalle (DESIGN_SYSTEM.md §14.4): qué es en una mirada (gravedad, renglón y cuándo), quién y cuánto,
 * por qué está marcado (cada bandera con su gravedad), lo que se sabe en filas y, al pie, adónde ir en Vigía y dónde
 * verificarlo. Pedido del usuario el 2026-10-28: el de «Buena pro de bienes a Multi Med Peru» decía «1 antecedente grave
 * del ganador» sin decir cuál, en párrafos sueltos y sin nada que guiara la vista.
 *
 * `detalle` (la oración que resume el hecho) va sólo si el hecho no trae sus datos en filas o sus banderas: los mismos
 * datos dos veces era parte de «se repite información». Server-safe.
 */
export function DetalleHecho({ e, renglon, conPie = true }: { e: EventoHistoria; renglon?: string; conPie?: boolean }) {
  // Con el año siempre (la fecha corta lo omite en el año en curso, y una historia cruza muchos años).
  const cuando = e.hasta ? `Del ${fecha(e.fecha)} al ${fecha(e.hasta)}` : fecha(e.fecha);
  const banderas = e.banderas ?? [];
  const datos = e.datos ?? [];
  const graves = banderas.filter((b) => b.severidad === "alta").length;
  return (
    <CuerpoDetalle className="space-y-4">
      <ChipsDetalle>
        {e.severidad && e.carril !== "gobierno" && <Severidad bandera={e.severidad} />}
        {renglon && <span className="pill border-line bg-paperDeep text-inkSoft">{renglon}</span>}
        <span className="inline-flex items-center gap-1 text-meta text-inkSoft">
          <CalendarDays size={14} aria-hidden className="shrink-0" />
          {cuando}
        </span>
      </ChipsDetalle>

      {(e.quien || !!e.monto) && (
        <div className="grid gap-2 sm:grid-cols-2">
          {e.quien && (
            <div className="min-w-0 rounded-xl border border-line bg-paperSoft px-3.5 py-2.5">
              <p className="text-rotulo text-mute">{e.quien.rol}</p>
              {e.quien.href ? (
                <Link
                  href={e.quien.href}
                  prefetch={false}
                  className="group inline-flex max-w-full items-center gap-1.5 text-dato font-semibold text-ink hover:text-granate"
                >
                  <Building2 size={15} aria-hidden className="shrink-0 text-inkSoft group-hover:text-granate" />
                  <span className="min-w-0 break-words underline decoration-line underline-offset-2 group-hover:decoration-granate">{e.quien.nombre}</span>
                  <ChevronRight size={15} aria-hidden className="shrink-0 opacity-70" />
                </Link>
              ) : (
                <p className="text-dato font-semibold text-ink">{e.quien.nombre}</p>
              )}
            </div>
          )}
          {!!e.monto && (
            <div className="rounded-xl border border-line bg-paperSoft px-3.5 py-2.5">
              <p className="text-rotulo text-mute">Monto</p>
              <p className="font-mono text-destacado font-semibold tabular-nums text-ink">{solesCompacto(e.monto)}</p>
              <p className="font-mono text-rotulo tabular-nums text-inkSoft">{soles(e.monto)}</p>
            </div>
          )}
        </div>
      )}

      {banderas.length > 0 && (
        <BloqueDetalle titulo={graves ? `Por qué está marcado: ${graves === 1 ? "un antecedente grave" : `${numero(graves)} antecedentes graves`}` : "Por qué está marcado"}>
          <ul className="space-y-1.5">
            {banderas.map((b) => {
              const s = BANDERA[b.severidad];
              return (
                <li key={b.tipo} className={cn("flex items-start gap-2 rounded-lg border px-3 py-2", s.clase)}>
                  <s.Icono size={15} aria-hidden className="mt-0.5 shrink-0" />
                  <IconoBandera tipo={b.tipo} size={14} className="mt-0.5 opacity-70" />
                  <span className="min-w-0 flex-1 text-meta font-semibold leading-snug">
                    {b.texto}
                    {b.n != null && b.n > 1 && <span className="font-normal">{` (${numero(b.n)} casos)`}</span>}
                  </span>
                  <span className="shrink-0 text-rotulo font-semibold">{s.palabra}</span>
                </li>
              );
            })}
          </ul>
          <p className="mt-2 text-rotulo text-mute">
            Son antecedentes que cruzan los registros oficiales: dicen dónde mirar, no prueban una falta. Cada uno, con su evidencia, está en la ficha del contrato.
          </p>
        </BloqueDetalle>
      )}

      {!banderas.length && !datos.length && e.detalle && <p className="text-dato text-ink">{e.detalle}</p>}

      {datos.length > 0 && <DatosClave items={datos.map((d) => ({ etiqueta: d.etiqueta, valor: d.valor, mono: MONO.has(d.etiqueta) }))} />}

      {conPie && <AccionesHecho e={e} />}
    </CuerpoDetalle>
  );
}

/** El pie del detalle: adónde ir en Vigía (la acción) y la fuente oficial donde verificarlo. */
export function AccionesHecho({ e }: { e: EventoHistoria }) {
  return (
    <PieDetalle
      principal={
        e.href ? (
          <EnlaceAccion href={e.href} prefetch={false} variante="secundario" flecha>
            {VER[e.tipo] ?? "Verlo en Vigía"}
          </EnlaceAccion>
        ) : undefined
      }
      secundarias={
        <span className="text-rotulo text-mute">
          Fuente: {e.enlace ? <EnlaceFuente href={e.enlace}>{e.fuente}</EnlaceFuente> : e.fuente}
        </span>
      }
    />
  );
}
