"use client";

/**
 * UNA FILA de la tabla de contratos, y el panel que abre.
 *
 * Por qué fila de tabla y no tarjeta: en producción la tarjeta medía ~135 px, así
 * que en una pantalla de 900 px entraban tres contratos — y las tres visibles
 * podían llamarse igual ("CONTRATACIÓN DE TERCERO"), con lo cual ni se
 * distinguían entre sí. Lo que distingue a dos convocatorias con el mismo objeto
 * es la entidad, la zona, el monto y la fecha: puestos en columnas alineadas se
 * comparan de un vistazo, apilados dentro de una tarjeta no.
 *
 * Por qué la fila abre un panel y no navega: navegar al dossier destruye la lista
 * filtrada (filtros en la URL + página + scroll). El panel enseña lo que ya se
 * sabe del contrato sin soltar el contexto, y deja el enlace al dossier completo
 * en su pie, para quien sí quiere entrar. Ese es el patrón <Revelar> del sistema.
 *
 * El enlace directo al dossier queda como una celda aparte al final de la fila,
 * FUERA del botón de <Revelar>: un <a> dentro de un <button> es HTML inválido y
 * rompe el teclado.
 */

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { Severidad } from "@/components/ui/Severidad";
import { PersonName, Ruc } from "@/components/Redact";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import { severidadDeScore } from "@/lib/severidad";
import {
  esPersonaNatural,
  etapaLabel,
  formatFecha,
  formatMonto,
  tipoLabel,
  type ContratoResumen,
} from "@/lib/contratos";
import { EstadoLecturaCelda, PuntoLectura, estadoLecturaDe } from "./estadoLectura";
import { cn } from "@/lib/utils";

// ─── Rejilla compartida ──────────────────────────────────────────────────────
// Un solo string para cabecera, fila y skeleton: si las tres no usan literalmente
// la misma plantilla, las columnas dejan de estar alineadas y la lista "salta" al
// cargar. Las celdas se ocultan por breakpoint EN EL MISMO ORDEN en que la
// plantilla pierde columnas.
//
//        base (móvil)          md                               xl
//   1 ·  señal                 señal                            señal
//   2 ·  objeto (2 líneas)     objeto                           objeto
//   3 ·  —                     entidad                          entidad
//   4 ·  —                     —                                tipo · etapa
//   5 ·  —                     estado de lectura                estado de lectura
//   6 ·  monto                 monto                            monto
//   7 ·  —                     convocada                        convocada
export const REJILLA = cn(
  "grid items-center gap-x-2 md:gap-x-3",
  "grid-cols-[16px_minmax(0,1fr)_76px]",
  "md:grid-cols-[40px_minmax(0,1.45fr)_minmax(0,1fr)_116px_92px_56px]",
  "xl:grid-cols-[40px_minmax(0,1.45fr)_minmax(0,1fr)_128px_116px_92px_56px]",
);
/** Alto fijo de fila: el skeleton usa el mismo, así la lista no salta al cargar. */
export const ALTO_FILA = "min-h-[52px] md:min-h-[40px]";
export const PAD_FILA = "px-2.5 py-1.5 md:px-3";
/** Ancho de la celda final (enlace al dossier). La cabecera reserva el mismo hueco. */
export const ANCHO_IR = "w-9";

export const CELDA_MD = "hidden md:block";
export const CELDA_XL = "hidden xl:block";

// ─── Fila ────────────────────────────────────────────────────────────────────

export function FilaContrato({
  c,
  selected,
  onHover,
}: {
  c: ContratoResumen;
  selected: boolean;
  onHover?: (c: ContratoResumen | null) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const lectura = estadoLecturaDe(c);
  const titulo = c.titulo ?? "(sin objeto registrado)";
  const entidad = c.entidad ?? "Entidad no identificada";
  const monto = formatMonto(c.montoPen, c.moneda);
  const href = `/app/contratos/${encodeURIComponent(c.ocid)}`;
  const tipo = tipoLabel(c.tipo);
  const etapa = etapaLabel(c.etapa);
  const tipoEtapa = [tipo, etapa].filter(Boolean).join(", ") || "Sin clasificar";

  // Semántica de tabla: la fila es role="row" y cada columna un role="cell", así un
  // lector de pantalla recorre por columna y anuncia su encabezado. Antes la fila
  // entera era un <button>, y los hijos de un botón son presentacionales: ninguna
  // celda existía. Ahora el botón (Revelar) vive DENTRO de la celda del objeto y se
  // estira con un ::after sobre toda la fila, que sigue siendo clickeable completa.
  return (
    <div
      ref={ref}
      role="row"
      className={cn(
        "relative border-b border-line transition-colors duration-rapido last:border-b-0 hover:bg-paperSoft",
        // Violeta = "sincronizado con el mapa", no advertencia. Barra a la
        // izquierda en vez de fondo pleno: en una tabla densa el fondo pleno
        // pelea con la lectura de las columnas.
        selected && "bg-heroViolet/5 shadow-[inset_3px_0_0_0_#4F3D96]",
      )}
      onMouseEnter={() => onHover?.(c)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex items-stretch">
        <div className={cn(REJILLA, ALTO_FILA, PAD_FILA, "min-w-0 flex-1")}>
          {/* 1 · señal */}
          <div role="cell" className="min-w-0">
            <Severidad score={c.score} formato="punto" />
          </div>

          {/* 2 · objeto (+ segunda línea solo en móvil) */}
          <div role="cell" className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-1.5">
              <Revelar
                titulo={titulo}
                descripcion={
                  <span className="flex flex-wrap items-baseline gap-x-3 font-mono text-[12px]">
                    <span>{c.codigo}</span>
                    <span>{formatFecha(c.fecha)}</span>
                    {c.zona ? <span className="font-sans">{c.zona}</span> : null}
                  </span>
                }
                ancho="lg"
                etiqueta={[
                  `Ver resumen de ${titulo}`,
                  entidad,
                  c.montoPen ? monto : "sin valor referencial publicado",
                  `estado: ${lectura.label}`,
                  c.score != null ? `${severidadDeScore(c.score).etiqueta}, score ${c.score} de 100` : null,
                ].filter(Boolean).join(". ")}
                className={cn(
                  "min-w-0 truncate text-[13px] font-medium leading-tight text-ink",
                  // El ::after cubre la fila completa (la fila es `relative`): toda la fila
                  // sigue abriendo el panel, y el foco dibuja su anillo sobre la fila entera.
                  "after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-heroViolet",
                )}
                detalle={<DetalleContrato c={c} />}
                pie={
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-mute">Fuente: SEACE/OECE, vía la API OCDS</span>
                    <Link
                      href={href}
                      className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3 py-1.5 text-[12px] font-semibold text-paper transition-colors duration-rapido hover:bg-inkSoft"
                    >
                      Ver dossier completo <ArrowRight size={14} aria-hidden />
                    </Link>
                  </div>
                }
              >
                {titulo}
              </Revelar>
              {c.banderas > 0 && (
                <span className="shrink-0 text-[11px] text-mute">
                  {c.banderas} señal{c.banderas === 1 ? "" : "es"}
                </span>
              )}
            </div>
            {/* Segunda línea, sólo en móvil. El estado va con su palabra, no como
                punto suelto: un color sin texto no es un canal, es un acertijo. */}
            <div className="mt-0.5 flex min-w-0 items-center gap-2.5 text-[11px] leading-tight text-mute md:hidden">
              <EstadoLecturaCelda info={lectura} className="shrink-0 text-[11px]" />
              <span className="truncate">{entidad}</span>
            </div>
          </div>

          {/* 3 · entidad */}
          <div role="cell" className={cn(CELDA_MD, "min-w-0")}>
            <div className="truncate text-[12px] leading-tight text-inkSoft" title={entidad}>
              {entidad}
            </div>
            {c.zona && <div className="truncate text-[11px] leading-tight text-mute">{c.zona}</div>}
          </div>

          {/* 4 · tipo y etapa. Dos datos, dos elementos: el tipo manda y la
              etapa lo matiza, así que se distinguen por peso de color y no
              por una raya de texto plano entre medio. */}
          {/* `xl:flex`, no `flex` a secas: CELDA_XL es "hidden xl:block" y el
              `xl:block` le gana a un `flex` sin variante, así que el tipo y la
              etapa quedaban pegados ("ConvenioConvocada"). */}
          <div role="cell" className={cn(CELDA_XL, "min-w-0 text-[12px] xl:flex xl:items-baseline xl:gap-x-2")} title={tipoEtapa}>
            <span className="truncate text-inkSoft">{tipo || "Sin clasificar"}</span>
            {etapa && <span className="shrink-0 text-mute">{etapa}</span>}
          </div>

          {/* 5 · estado de lectura */}
          <div role="cell" className={cn(CELDA_MD, "min-w-0")}>
            <EstadoLecturaCelda info={lectura} />
          </div>

          {/* 6 · monto */}
          <div role="cell" className="truncate text-right font-mono text-[12.5px] font-semibold text-ink">{monto}</div>

          {/* 7 · convocada */}
          <div role="cell" className={cn(CELDA_MD, "text-right font-mono text-[11.5px] text-mute")}>{formatFecha(c.fecha)}</div>
        </div>

        {/* 8 · enlace al dossier. `relative z-10`: queda por encima del ::after del botón. */}
        <div role="cell" className={cn(ANCHO_IR, "relative z-10 flex shrink-0 border-l border-line")}>
          <Link
            href={href}
            aria-label={`Abrir el dossier completo de ${c.codigo}`}
            className="flex w-full items-center justify-center text-mute transition-colors duration-rapido hover:bg-paperSoft hover:text-ink"
          >
            <ArrowUpRight size={14} aria-hidden />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ─── Panel: lo que ya se sabe del contrato ───────────────────────────────────

function DetalleContrato({ c }: { c: ContratoResumen }) {
  const lectura = estadoLecturaDe(c);
  const natural = esPersonaNatural(c.proveedorRuc);
  const leido = c.score != null;

  return (
    <div className="space-y-5">
      <section>
        <Rotulo>Estado de lectura</Rotulo>
        <div className="mt-1.5 flex items-center gap-2 text-[13px] font-medium text-ink">
          <PuntoLectura estado={lectura.estado} />
          {lectura.label}
        </div>
        <p className="mt-1 text-[12.5px] leading-relaxed text-mute">{lectura.detalle}</p>
      </section>

      <section>
        <Rotulo>{leido ? "Señales encontradas" : "Señales"}</Rotulo>
        {leido ? (
          <div className="mt-1.5 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <Severidad score={c.score} formato="pastilla" />
              <span className="font-mono text-[12px] text-inkSoft">score {c.score} sobre 100</span>
            </div>
            <p className="text-[12.5px] leading-relaxed text-mute">
              {c.banderas > 0
                ? `Los agentes registraron ${c.banderas} señal${c.banderas === 1 ? "" : "es"} en este expediente. Cada una lleva su norma citada y la página del documento donde se apoya: eso vive en el dossier.`
                : "El análisis no registró señales. Que no haya señales no certifica que el contrato esté limpio: el dossier dice qué se revisó."}
            </p>
          </div>
        ) : (
          // Estado vacío que enseña el mecanismo, no un guion. Ninguna cifra
          // inventada: de un contrato sin leer no se sabe nada todavía.
          <div className="mt-1.5 rounded-xl border border-dashed border-line bg-paperSoft px-3 py-2.5">
            {/* El número de agentes sale del catálogo (el DAG real del backend), no se escribe a
                mano: esta frase decía "once agentes… catorce portales… unos diez minutos" mientras
                otras páginas decían otra cosa. Lo que no tiene fuente, no se dice. */}
            <p className="text-[12.5px] leading-relaxed text-mute">
              Todavía no hay dictamen: nadie ha leído este expediente. Cuando su lectura se financia, {TOTAL_AGENTES}{" "}
              agentes leen el expediente, lo cruzan con registros públicos del Estado y publican las señales que
              encuentren con su norma citada. El resultado es público, lo señale a quien lo señale.
            </p>
            <Link
              href={c.ubigeo ? `/app/financiar/${c.ubigeo}` : "/app/financiar"}
              className="mt-2 inline-flex items-center gap-1.5 text-[12px] font-semibold text-ink underline-offset-2 hover:underline"
            >
              Financiar la lectura de {c.zona ?? "esta zona"} <ArrowRight size={12} aria-hidden />
            </Link>
          </div>
        )}
      </section>

      <section>
        <Rotulo>Lo que dice el expediente público</Rotulo>
        <dl className="mt-1.5 grid grid-cols-[104px_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px] sm:grid-cols-[128px_minmax(0,1fr)]">
          <Dato k="Objeto">{c.titulo ?? <Vacio>Sin objeto registrado en el OCDS</Vacio>}</Dato>
          <Dato k="Entidad">
            {c.entidadRuc ? (
              <Link href={`/entidad/${c.entidadRuc}`} className="text-ink underline-offset-2 hover:underline">
                {c.entidad ?? c.entidadRuc}
              </Link>
            ) : (
              c.entidad ?? <Vacio>No identificada</Vacio>
            )}
          </Dato>
          <Dato k="Zona">{c.zona ?? <Vacio>Sin ubigeo asignado</Vacio>}</Dato>
          <Dato k="Tipo">{tipoLabel(c.tipo) ?? <Vacio>Sin clasificar</Vacio>}</Dato>
          <Dato k="Etapa">{etapaLabel(c.etapa) ?? <Vacio>Sin clasificar</Vacio>}</Dato>
          {c.modalidad && <Dato k="Modalidad">{c.modalidad}</Dato>}
          <Dato k="Convocada" mono>
            {formatFecha(c.fecha)}
          </Dato>
          <Dato k="Valor referencial" mono>
            {c.montoPen != null && c.montoPen > 0 ? (
              formatMonto(c.montoPen, c.moneda)
            ) : (
              <Vacio>Sin valor referencial publicado</Vacio>
            )}
          </Dato>
          <Dato k="Proveedor">
            {c.proveedor ? (
              <>
                {/* Orden SUNAT (apellidos primero): se tapa el apellido materno, no el nombre de pila. */}
                {natural ? <PersonName name={c.proveedor} orden="sunat" /> : c.proveedor}
                {c.proveedorRuc && (
                  <span className="ml-2 font-mono text-[11px] text-mute">
                    RUC <Ruc value={c.proveedorRuc} />
                  </span>
                )}
              </>
            ) : (
              <Vacio>Sin adjudicar todavía</Vacio>
            )}
          </Dato>
          <Dato k="Código SEACE" mono>
            {c.codigo}
          </Dato>
          <Dato k="OCID" mono>
            <span className="break-all">{c.ocid}</span>
          </Dato>
        </dl>
      </section>
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[11px] font-semibold text-mute">{children}</h3>;
}

function Dato({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-mute">{k}</dt>
      <dd className={cn("min-w-0 text-ink", mono && "font-mono text-[12px]")}>{children}</dd>
    </>
  );
}

function Vacio({ children }: { children: React.ReactNode }) {
  return <span className="text-mute">{children}</span>;
}
