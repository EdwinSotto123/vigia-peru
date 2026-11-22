import { BellRing, CalendarDays, FilePen, FileSearch, Gavel, Hash, Info, Scale, Scroll, ScrollText, TriangleAlert, Wrench, ChevronRight } from "lucide-react";
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

function TarjetaSancion({ s, fuenteRegistro }: { s: Sancion; fuenteRegistro: { url: string; al: string | number | null } | null }) {
  const infraccion = s.infraccionDetalle ?? s.infraccion;
  return (
    <article className="tarjeta min-w-0 overflow-hidden rounded-2xl border border-line bg-paper">
      <header className="px-4 pb-3 pt-4 sm:px-5">
        <div className="flex flex-wrap items-center gap-1.5">
          <InsigniaHecho tipo="sancion_firme" />
          {s.gravedad && <Insignia tono={s.gravedad === "leve" ? "neutro" : "aviso"} Icono={TriangleAlert}>{`Infracción ${GRAVEDAD[s.gravedad].toLowerCase()}`}</Insignia>}
          {s.judicializada && (
            <Insignia tono="aviso" Icono={Scale}>
              En proceso judicial
            </Insignia>
          )}
          {s.cancelacion && <Insignia tono="neutro">Con cancelación registrada</Insignia>}
        </div>
        <h3 className="mt-2.5 flex items-center gap-2 font-display text-bloque font-bold leading-snug text-ink">
          <span aria-hidden className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${DISCO_TONO[TONO_TIPO[s.tipoSancion]]}`}>
            <Gavel size={16} />
          </span>
          <span className="min-w-0">{titulo(s)}</span>
          {s.tipoSancion === "multa" && s.multaUit != null && AYUDA_UIT}
        </h3>
        <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-meta text-inkSoft" aria-label="Fechas de la sanción">
          <li className="inline-flex items-center gap-1.5">
            <CalendarDays size={14} aria-hidden className="shrink-0 text-mute" />
            Emitida el {fechaCorta(s.fechaEmision)}
          </li>
        </ul>
        {infraccion && <p className="mt-2 line-clamp-2 text-dato leading-snug text-ink">{infraccion}</p>}
        {s.enlace === "codigo_otro_nombre" && (
          <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-soft/60 px-3 py-2 text-meta leading-snug text-ink">
            <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
            <span>
              SUSALUD la registró con el código de este establecimiento, a nombre de «{s.nombre}».
            </span>
          </p>
        )}
      </header>

      {/* 2026-11-22 (auditoría: «la pestaña mide 6,9 pantallas en el celular»): la resolución, el procedimiento, las normas
          y lo demás, plegados. */}
      <details className="group/det border-t border-line">
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
            texto="El registro sólo trae sanciones firmes y SUSALUD retira las antiguas después de un año. Una denuncia o un reclamo no aparecen aquí."
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

      <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Las sanciones en cifras">
        <li className="min-w-0">
          <Tesela icono={Gavel} tono="urgente" valor={numero(lista.length)} etiqueta={lista.length === 1 ? "sanción firme" : "sanciones firmes"} contexto={`la última, del ${fechaCorta(lista[0]?.fechaEmision)}`} />
        </li>
        <li className="min-w-0">
          <Tesela icono={Scroll} valor={f.multasUit != null ? uit(f.multasUit) : null} etiqueta={`en ${multas === 1 ? "una multa" : `${numero(multas)} multas`}`} contexto="sin convertir a soles" />
        </li>
        <li className="min-w-0">
          <Tesela icono={Scale} tono={f.sancionesJudicializadas ? "aviso" : "neutro"} valor={numero(f.sancionesJudicializadas)} etiqueta="en un proceso judicial" contexto="según el registro" />
        </li>
        <li className="min-w-0">
          <Tesela icono={CalendarDays} valor={fechaCorta(lista[lista.length - 1]?.fechaEmision)} etiqueta="la más antigua del registro" contexto="SUSALUD retira las antiguas después de un año" />
        </li>
      </ul>

      <div className="flex items-start gap-2.5 rounded-2xl border border-line bg-paperSoft px-4 py-3 text-meta leading-relaxed text-inkSoft">
        <Info size={16} aria-hidden className="mt-0.5 shrink-0 text-mute" />
        <p>
          Una sanción firme ya no se puede apelar en la vía administrativa; puede estar en un proceso judicial (lo decimos cuando el
          registro lo indica). La sanción es de la IPRESS: no es una sanción a sus médicos ni a quien la dirige. Una denuncia no
          es una sanción y no aparece aquí.
        </p>
      </div>

      <ListaPaginada
        nombre="las sanciones"
        tam={6}
        className="space-y-4"
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
