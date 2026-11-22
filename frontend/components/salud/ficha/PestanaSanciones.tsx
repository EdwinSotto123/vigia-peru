import { Ban, BellRing, CalendarDays, FilePen, FileSearch, FileWarning, Gavel, Hash, Info, Scale, Scroll, ScrollText, TriangleAlert, Wrench, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import { Insignia, type Tono } from "@/components/gobserva/ui/Insignia";
import { EstadoVacio } from "@/components/gobserva/ui/Estados";
import { ListaPaginada } from "@/components/listado/Paginado";
import { Ayuda } from "@/components/patrones/Ayuda";
import { CabeceraPestana } from "@/components/patrones/Pestanas";
import { FuenteFecha, InsigniaHecho } from "@/components/salud/comun";
import { GRAVEDAD, TIPO_SANCION, fechaCorta, numero, type FichaIpress, type Sancion } from "@/lib/gobserva-salud";
import { DISCO_TONO, EnlaceOficial, Tesela } from "./piezas";
import { TextoPlegable } from "./TextoPlegable";

/**
 * La pestaña «Sanciones»: cada sanción FIRME del Registro de Sanciones de SUSALUD con todo lo que trae (fechas, tipo,
 * multa en UIT, gravedad, resolución, procedimiento, la infracción con las palabras del Reglamento, normas, medidas
 * correctivas, proceso judicial y cancelación) y su fuente. Sin sanciones, «no figura… revisado el…». Server-safe.
 */

const TONO_TIPO: Record<Sancion["tipoSancion"], Tono> = {
  amonestacion: "neutro",
  multa: "aviso",
  cierre_temporal: "urgente",
  cierre_definitivo: "urgente",
  revocacion: "urgente",
  otra: "neutro",
};

const uit = (n: number) => `${new Intl.NumberFormat("es-PE", { maximumFractionDigits: 2 }).format(n)} UIT`;

const AYUDA_UIT = (
  <Ayuda titulo="¿Por qué en UIT?" etiqueta="Por qué la multa va en UIT">
    SUSALUD publica las multas en UIT (Unidad Impositiva Tributaria). La UIT cambia cada año y la multa se paga con la del
    año del pago: por eso no la convertimos a soles.
  </Ayuda>
);

function titulo(s: Sancion): string {
  const tipo = TIPO_SANCION[s.tipoSancion] ?? s.tipoSancionTexto ?? "Sanción";
  return s.tipoSancion === "multa" && s.multaUit != null ? `${tipo} de ${uit(s.multaUit)}` : s.tipoSancion === "otra" && s.tipoSancionTexto ? s.tipoSancionTexto : tipo;
}

function Parte({ icono: Icono, t, children }: { icono: typeof Info; t: string; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-line px-4 py-3 sm:px-5">
      <h4 className="flex items-center gap-1.5 text-meta font-semibold text-ink">
        <Icono size={14} aria-hidden className="shrink-0 text-mute" />
        {t}
      </h4>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** Lo que hizo, corto: lo que el Reglamento pone entre comillas o la infracción sin su número («27. No entregar…»). */
function queHizo(s: Sancion): string | null {
  const t = s.infraccion ?? s.infraccionDetalle;
  if (!t) return null;
  const m = t.match(/[“"«]([^”"»]{12,})[”"»]/);
  return (m ? m[1] : t).replace(/^\s*\d+[.)]\s*/, "").replace(/\s*\(…\)\s*/g, " … ").trim().replace(/\.$/, "");
}

function TarjetaSancion({ s, fuenteRegistro }: { s: Sancion; fuenteRegistro: { url: string; al: string | number | null } | null }) {
  const infraccion = s.infraccionDetalle ?? s.infraccion;
  const que = queHizo(s);
  const multa = s.tipoSancion === "multa";
  const grave = multa || /cierre|revocacion/.test(s.tipoSancion);
  const Icono = /cierre|revocacion/.test(s.tipoSancion) ? Ban : multa ? Gavel : FileWarning;
  return (
    <article className={cn("flex h-full min-w-0 flex-col overflow-hidden rounded-2xl border bg-paper", grave ? "border-crimson/25" : "border-line")}>
      <div className={cn("flex items-center justify-between gap-3 px-4 py-3", grave ? "bg-crimson-soft/70" : "bg-paperSoft")}>
        <div className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-paper", grave ? "text-crimsonTexto" : "text-inkSoft")}>
            <Icono size={19} />
          </span>
          <h3 className="min-w-0">
            <span className={cn("block text-meta font-semibold", grave ? "text-crimsonTexto" : "text-inkSoft")}>{multa ? "Multa" : "Sanción firme"}</span>
            <span className={cn("flex items-center gap-1 font-bold leading-tight tabular-nums text-ink", multa ? "font-display text-bloque" : "text-cuerpo")}>
              {multa && s.multaUit != null ? uit(s.multaUit) : titulo(s)}
              {multa && s.multaUit != null && AYUDA_UIT}
            </span>
          </h3>
        </div>
        <span className="shrink-0 text-right text-meta leading-tight text-inkSoft">
          <span className="block">Emitida el</span>
          <span className="block font-semibold text-ink">{fechaCorta(s.fechaEmision)}</span>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-4 pb-1 pt-3">
        {(s.gravedad || s.judicializada || s.cancelacion) && (
          <p className="flex flex-wrap gap-1.5">
            {s.gravedad && <Insignia tono={s.gravedad === "leve" ? "neutro" : s.gravedad === "grave" ? "aviso" : "urgente"}>{`Infracción ${GRAVEDAD[s.gravedad].toLowerCase()}`}</Insignia>}
            {s.judicializada && (
              <Insignia tono="aviso" Icono={Scale}>
                En proceso judicial
              </Insignia>
            )}
            {s.cancelacion && <Insignia tono="neutro">Con cancelación registrada</Insignia>}
          </p>
        )}
        {que && <p className="mt-2.5 line-clamp-3 rounded-lg bg-paperSoft px-3 py-2 text-dato leading-relaxed text-ink">«{que}»</p>}
        {s.enlace === "codigo_otro_nombre" && (
          <p className="mt-2.5 flex items-start gap-2 rounded-xl bg-amber-soft/60 px-3 py-2 text-meta leading-snug text-ink">
            <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
            <span>SUSALUD la registró con el código de este establecimiento, a nombre de «{s.nombre}».</span>
          </p>
        )}
      </div>

      {/* 2026-11-22 (auditoría: «la pestaña mide 6,9 pantallas en el celular»): la resolución, el procedimiento, las normas
          y lo demás, plegados. */}
      <details className="group/det mt-auto border-t border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 px-4 text-meta font-semibold text-granate sm:px-5 [&::-webkit-details-marker]:hidden">
          <ChevronRight size={14} aria-hidden className="transition-transform duration-rapido group-open/det:rotate-90" />
          <span className="group-open/det:hidden">Ver la resolución y el detalle</span>
          <span className="hidden group-open/det:inline">Ocultar el detalle</span>
        </summary>
      {(s.fechaNotificacion || s.fechaInscripcion) && (
        <ul className="flex flex-wrap gap-x-5 gap-y-1 border-t border-line px-4 py-2.5 text-meta text-inkSoft sm:px-5" aria-label="Otras fechas">
          {s.fechaNotificacion && (
            <li className="inline-flex items-center gap-1.5">
              <BellRing size={14} aria-hidden className="shrink-0 text-mute" />
              Notificada el {fechaCorta(s.fechaNotificacion)}
            </li>
          )}
          {s.fechaInscripcion && (
            <li className="inline-flex items-center gap-1.5">
              <FilePen size={14} aria-hidden className="shrink-0 text-mute" />
              Inscrita en el registro el {fechaCorta(s.fechaInscripcion)}
            </li>
          )}
        </ul>
      )}
      <dl className="grid gap-x-6 gap-y-2 border-t border-line px-4 py-3 text-dato sm:grid-cols-2 sm:px-5">
        {s.resolucion && (
          <div className="min-w-0 sm:col-span-2">
            <dt className="flex items-center gap-1.5 text-meta text-mute">
              <ScrollText size={14} aria-hidden /> Resolución
            </dt>
            <dd className="mt-0.5 break-words text-ink">{s.resolucion}</dd>
          </div>
        )}
        {s.pas && (
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-meta text-mute">
              <FileSearch size={14} aria-hidden /> Procedimiento sancionador
            </dt>
            <dd className="mt-0.5 break-words font-mono text-meta text-ink">{s.pas}</dd>
          </div>
        )}
        {s.infraccionCodigo && (
          <div className="min-w-0">
            <dt className="flex items-center gap-1.5 text-meta text-mute">
              <Hash size={14} aria-hidden /> Código de la infracción
            </dt>
            <dd className="mt-0.5 break-words font-mono text-meta text-ink">{s.infraccionCodigo}</dd>
          </div>
        )}
      </dl>

      {infraccion && (
        <Parte icono={TriangleAlert} t={s.infraccionDetalle ? "La infracción, con las palabras del Reglamento" : "La infracción, como la describe el registro"}>
          <TextoPlegable texto={infraccion} />
        </Parte>
      )}
      {s.normas && (
        <Parte icono={Scroll} t="Normas que cita">
          <TextoPlegable texto={s.normas} lineas={2} corte={200} />
        </Parte>
      )}
      {s.medidasCorrectivas && (
        <Parte icono={Wrench} t="Medidas correctivas">
          <TextoPlegable texto={s.medidasCorrectivas} lineas={2} corte={200} />
        </Parte>
      )}
      {s.judicializada && (
        <Parte icono={Scale} t="En un proceso judicial, según el registro">
          {s.judicializacion ? (
            <TextoPlegable texto={s.judicializacion} lineas={2} corte={180} />
          ) : (
            <p className="text-dato text-inkSoft">El registro la marca como judicializada, sin más detalle.</p>
          )}
        </Parte>
      )}
      {s.cancelacion && (
        <Parte icono={FilePen} t="Cancelación">
          <TextoPlegable texto={s.cancelacion} lineas={2} corte={200} />
        </Parte>
      )}

      <footer className="border-t border-line bg-ink/[0.02] px-4 py-2.5 sm:px-5">
        <FuenteFecha nombre="Registro de Sanciones de SUSALUD" url={s.fuenteUrl ?? fuenteRegistro?.url ?? null} al={s.vistoAl ?? fuenteRegistro?.al ?? null} />
      </footer>
      </details>
    </article>
  );
}

export function PestanaSanciones({ f }: { f: FichaIpress }) {
  const lista = f.registroSanciones;
  const fuente = f.fuentes.sanciones;
  const revisado = fuente?.al ? fechaCorta(String(fuente.al)) : null;
  if (!lista.length) {
    return (
      <div>
        <CabeceraPestana>Las sanciones firmes del Registro de Sanciones de SUSALUD.</CabeceraPestana>
        <div className="tarjeta rounded-2xl border border-line bg-paper">
          <EstadoVacio
            Icono={FileSearch}
            titulo={`No figura en el Registro de Sanciones de SUSALUD${revisado ? ` revisado el ${revisado}` : ""}`}
            texto="El registro sólo trae sanciones firmes: SUSALUD las publica al menos un año y después puede retirarlas. Una denuncia o un reclamo no aparecen aquí."
            acciones={fuente?.url ? <EnlaceOficial href={fuente.url}>Ver el Registro de Sanciones</EnlaceOficial> : undefined}
          />
        </div>
      </div>
    );
  }
  const multas = lista.filter((s) => s.tipoSancion === "multa").length;
  return (
    <div className="space-y-5">
      <CabeceraPestana acciones={fuente ? <FuenteFecha nombre="Registro de Sanciones de SUSALUD" url={fuente.url} al={fuente.al} /> : undefined}>
        Cada sanción firme con su resolución, la infracción y su estado judicial, de la más reciente a la más antigua.
      </CabeceraPestana>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-line bg-paper px-4 py-3">
        <p className="flex items-baseline gap-1.5">
          <b className="font-display text-cifra font-bold leading-none tabular-nums text-crimsonTexto">{numero(lista.length)}</b>
          <span className="text-dato font-semibold text-ink">{lista.length === 1 ? "sanción firme" : "sanciones firmes"}</span>
        </p>
        <ul className="flex flex-wrap gap-1.5 text-meta" aria-label="Las sanciones en cifras">
          {multas > 0 && (
            <li className="inline-flex items-center gap-1 rounded-full bg-crimson-soft px-2.5 py-1 font-semibold text-crimsonTexto">
              <Gavel size={13} aria-hidden /> {multas === 1 ? "1 multa" : `${numero(multas)} multas`}
              {f.multasUit != null ? `, ${uit(f.multasUit)}` : ""}
            </li>
          )}
          {lista.length - multas > 0 && (
            <li className="inline-flex items-center gap-1 rounded-full bg-paperSoft px-2.5 py-1 font-semibold text-inkSoft">
              <FileWarning size={13} aria-hidden /> {lista.length - multas === 1 ? "1 sin multa" : `${numero(lista.length - multas)} sin multa`}
            </li>
          )}
          {f.sancionesJudicializadas > 0 && (
            <li className="inline-flex items-center gap-1 rounded-full bg-amber-soft px-2.5 py-1 font-semibold text-amberTexto">
              <Scale size={13} aria-hidden /> {numero(f.sancionesJudicializadas)} en juicio
            </li>
          )}
          <li className="inline-flex items-center gap-1 rounded-full bg-paperSoft px-2.5 py-1 text-inkSoft">
            <CalendarDays size={13} aria-hidden /> de {fechaCorta(lista[lista.length - 1]?.fechaEmision)} a {fechaCorta(lista[0]?.fechaEmision)}
          </li>
        </ul>
        <span className="inline-flex items-center gap-1 text-meta text-inkSoft">
          ¿Qué es una sanción firme?
          <Ayuda titulo="¿Qué es una sanción firme?">
            Ya no se puede apelar en la vía administrativa; puede estar en un proceso judicial (lo decimos cuando el registro lo indica).
            Es de la IPRESS: no es una sanción a sus médicos ni a quien la dirige. Una denuncia no es una sanción y no aparece aquí. Las
            más antiguas pueden haber salido del registro.
          </Ayuda>
        </span>
      </div>

      <ListaPaginada
        nombre="las sanciones"
        tam={6}
        className="grid gap-3 lg:grid-cols-2"
        buscar={{ placeholder: "Resolución o infracción", etiqueta: "Buscar en las sanciones por resolución, procedimiento o infracción" }}
        items={lista.map((s) => ({
          id: s.id,
          buscable: [s.resolucion, s.pas, s.infraccionCodigo, s.infraccion, s.infraccionDetalle, TIPO_SANCION[s.tipoSancion], s.fechaEmision].filter(Boolean).join(" "),
          contenido: <TarjetaSancion s={s} fuenteRegistro={fuente} />,
        }))}
      />
    </div>
  );
}
