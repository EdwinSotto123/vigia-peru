"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Revelar } from "@/components/ui/Revelar";
import { cn } from "@/lib/utils";
import { ICONO_SEVERIDAD, type FilaPrecio } from "./mercado";

/**
 * Range plot (dumbbell) de ofertado contra mercado, un renglón por ítem.
 *
 * Es el gráfico que le faltaba al producto: el dato más cuantitativo que
 * existe —precio ofertado, mediana de mercado, rango observado, cantidad—
 * se servía como tabla de números, y la pregunta real ("¿cuánto se pagó de
 * más y en qué ítems?") obligaba a recorrerla fila por fila.
 *
 * La gramática, que es toda la carga del componente:
 *
 *  · **banda** → rango observado en el mercado (mín a máx), × cantidad.
 *  · **marca fina (2 px)** → mediana de mercado.
 *  · **marca gruesa (8 px)** → lo que la entidad puso sobre la mesa.
 *  · **segmento rust** → SOLO cuando el ofertado supera el techo del rango.
 *    Por encima de la mediana pero dentro del rango no es señal.
 *  · **textura** → el ítem no está medido (estimación del modelo, o el
 *    backend lo marcó no verificable). Nunca se distingue por color: una
 *    estimación no es una medición y no puede parecerlo.
 *
 * Escala lineal compartida por todas las filas y anclada en 0, en soles de
 * línea (unitario × cantidad): así el largo del segmento rust ES la plata de
 * más, comparable entre renglones. Una escala por fila se vería mejor y
 * mentiría sobre la magnitud.
 *
 * El ancho se mide (ResizeObserver) y el SVG se dibuja en píxeles reales:
 * con `preserveAspectRatio="none"` el hachurado se inclina y el texto se
 * estira. Antes de la primera medición el renglón ya ocupa su alto, así que
 * no hay salto de layout.
 */

const ALTO = 26;
const PAD = 5; // deja entrar la marca gruesa (8 px) en los extremos
const ETIQUETAS_DIRECTAS = 4;
const VISIBLES = 12;

function usarAnchoDe(): [React.RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const nodo = ref.current;
    if (!nodo) return;
    const medir = () => setAncho(Math.round(nodo.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(medir);
    ro.observe(nodo);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho];
}

/** Las tres columnas del renglón. En móvil el gráfico baja a su propia línea. */
const REJILLA =
  "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_10rem] sm:gap-y-0";

function PastillaVeredicto({ fila }: { fila: FilaPrecio }) {
  const Icono = ICONO_SEVERIDAD[fila.veredicto.ui.icono];
  return (
    <span
      className={cn(
        "pill justify-self-end whitespace-nowrap px-2 py-0 text-[10px]",
        fila.veredicto.ui.fondo,
        fila.veredicto.ui.texto,
        fila.veredicto.ui.borde,
      )}
    >
      <Icono size={10} aria-hidden />
      {fila.veredicto.etiqueta}
    </span>
  );
}

function Trazo({
  fila,
  ancho,
  maximo,
  hachuraId,
}: {
  fila: FilaPrecio;
  ancho: number;
  maximo: number;
  hachuraId: string;
}) {
  const util = Math.max(ancho - PAD * 2, 1);
  const x = (v: number) => PAD + (v / maximo) * util;
  const medio = ALTO / 2;

  const { rangoMin: min, rangoMax: max, referencia: ref, ofertado: of } = fila;
  const hayBanda = min !== null && max !== null && max > min;
  // Sin rango medido, la distancia entre la referencia y lo ofertado se pinta
  // como territorio hachurado: hay un hueco, pero nadie lo midió.
  const hueco = !fila.medido && !hayBanda && ref !== null && of !== null && Math.abs(of - ref) > 0;

  // `width="100%"` sobre el viewBox medido: si el ancho real cambió entre la
  // medición y el pintado (aparece la barra de scroll al expandir, por
  // ejemplo) el trazo se encoge un 2 % en vez de desbordar sobre la columna
  // vecina. Con el ancho correcto la escala es exactamente 1:1.
  return (
    <svg
      width="100%"
      height={ALTO}
      viewBox={`0 0 ${ancho} ${ALTO}`}
      preserveAspectRatio="none"
      aria-hidden
      focusable="false"
    >
      <defs>
        <pattern id={hachuraId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" className="stroke-mute" strokeWidth="1.5" opacity="0.45" />
        </pattern>
      </defs>

      {/* Riel y marca de media escala: el 0 y el techo caen en el mismo sitio en
          todas las filas. En un ítem sin medición el riel va punteado de lado a
          lado, porque con poca plata en juego la banda hachurada queda de tres
          píxeles y la textura se perdería justo donde más importa no confundir
          una estimación con una medición. */}
      <line
        x1={PAD}
        y1={medio}
        x2={ancho - PAD}
        y2={medio}
        strokeWidth={fila.medido ? 1 : 1.5}
        strokeDasharray={fila.medido ? undefined : "3 3"}
        className={fila.medido ? "stroke-line" : "stroke-paperEdge"}
      />
      <line
        x1={x(maximo / 2)}
        y1={4}
        x2={x(maximo / 2)}
        y2={ALTO - 4}
        className="stroke-paperEdge"
        strokeWidth="1"
      />

      {/* Banda del rango observado. Hachurada cuando el ítem no está medido. */}
      {hayBanda && min !== null && max !== null && (
        <rect
          x={x(min)}
          y={medio - 6}
          width={Math.max(x(max) - x(min), 1)}
          height={12}
          fill={fila.medido ? undefined : `url(#${hachuraId})`}
          className={cn("stroke-line", fila.medido && "fill-paperDeep")}
          strokeWidth="1"
        />
      )}

      {/* Hueco sin medir: mismo hachurado, para que la falta de medición se VEA. */}
      {hueco && ref !== null && of !== null && (
        <rect
          x={Math.min(x(ref), x(of))}
          y={medio - 5}
          width={Math.max(Math.abs(x(of) - x(ref)), 1)}
          height={10}
          fill={`url(#${hachuraId})`}
          className="stroke-line"
          strokeWidth="1"
          strokeDasharray="2 2"
        />
      )}

      {/* Segmento mediana → ofertado. Rust solo si el ofertado supera el techo del rango. */}
      {!hueco && ref !== null && of !== null && (
        <line
          x1={x(ref)}
          y1={medio}
          x2={x(of)}
          y2={medio}
          strokeWidth="3"
          strokeDasharray={fila.medido ? undefined : "3 2"}
          className={fila.sobreElRango ? "stroke-rust" : "stroke-mute"}
        />
      )}

      {/* Mediana de mercado (2 px) — punteada cuando es estimación del modelo. */}
      {ref !== null && (
        <line
          x1={x(ref)}
          y1={medio - 8}
          x2={x(ref)}
          y2={medio + 8}
          strokeWidth="2"
          strokeDasharray={fila.medido ? undefined : "2 2"}
          className="stroke-inkSoft"
        />
      )}

      {/* Lo ofertado (8 px). Es un hecho del expediente: va en tinta, no en color de severidad. */}
      {of !== null && <rect x={x(of) - 4} y={medio - 7} width="8" height="14" rx="1" className="fill-ink" />}
    </svg>
  );
}

function Renglon({
  fila,
  ancho,
  maximo,
  etiquetaDirecta,
  fmtMoney,
  detalle,
}: {
  fila: FilaPrecio;
  ancho: number;
  maximo: number;
  etiquetaDirecta: boolean;
  fmtMoney: (n: any) => string;
  detalle?: React.ReactNode;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hachuraId = `hachura-${uid}`;

  const diff = fila.diffMonto;
  const etiqueta =
    diff === null
      ? fila.medido
        ? null
        : "estimado"
      : Math.abs(diff) < 1
        ? "igual a la mediana"
        : `${diff < 0 ? "−" : "+"}${fmtMoney(Math.abs(diff))}`;

  // Posición de la etiqueta: a la derecha de la marca del ofertado mientras
  // entre; si no entra, se ancla a la IZQUIERDA de la marca más a la izquierda
  // del par. Voltearla pegada al ofertado la hacía caer justo encima del
  // segmento rust — tapaba el dato que la etiqueta está nombrando.
  const util = Math.max(ancho - PAD * 2, 1);
  const escala = (v: number) => PAD + (v / maximo) * util;
  const xOf = fila.ofertado !== null ? escala(fila.ofertado) : null;
  const xRef = fila.referencia !== null ? escala(fila.referencia) : null;
  const anchoEtiqueta = etiqueta ? 14 + etiqueta.length * 5.4 + (fila.diffMonto !== null ? 54 : 0) : 0;
  const cabeDerecha = xOf !== null && xOf + 7 + anchoEtiqueta <= ancho;
  const anclaIzquierda = Math.min(
    xOf ?? ancho,
    xRef ?? ancho,
    fila.rangoMin !== null ? escala(fila.rangoMin) : ancho,
  );

  const cuerpo = (
    <div className={cn(REJILLA, "rounded-lg px-2 py-1.5 transition-colors duration-rapido group-hover:bg-paperSoft")}>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="shrink-0 font-mono text-[10px] font-bold text-heroViolet">{fila.numero}</span>
          <span className="truncate text-[12px] font-medium leading-tight text-ink">{fila.descripcion}</span>
        </div>
        <div className="truncate text-[10px] text-mute">
          {fila.cantidad !== null ? `${fila.cantidad.toLocaleString("es-PE")} ${fila.unidad}` : "sin cantidad"}
          {fila.ofertadoUnit !== null && ` · ${fmtMoney(fila.ofertadoUnit)} c/u`}
          {fila.referenciaUnit !== null &&
            ` · mercado ${fila.tipoReferencia === "mediana" ? "" : "≈ "}${fmtMoney(fila.referenciaUnit)} c/u`}
        </div>
      </div>

      <div className="relative order-last col-span-2 h-[26px] sm:order-none sm:col-span-1">
        {ancho > 0 && <Trazo fila={fila} ancho={ancho} maximo={maximo} hachuraId={hachuraId} />}
        {etiqueta && xOf !== null && ancho > 0 && (
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-paper/90 px-1 text-[10px] font-semibold",
              fila.sobreElRango ? "text-rust" : "text-inkSoft",
              !etiquetaDirecta &&
                "opacity-0 transition-opacity duration-rapido group-hover:opacity-100 group-focus-visible:opacity-100",
            )}
            style={
              cabeDerecha
                ? { left: xOf + 7 }
                : { right: Math.max(ancho - anclaIzquierda + 7, 2) }
            }
          >
            {etiqueta}
            {diff !== null && Math.abs(diff) >= 1 && (
              <span className="hidden font-normal text-mute sm:inline"> vs mediana</span>
            )}
          </span>
        )}
      </div>

      <PastillaVeredicto fila={fila} />
    </div>
  );

  const lectura = [
    `Ítem ${fila.numero}: ${fila.descripcion}`,
    fila.ofertado !== null ? `ofertado ${fmtMoney(fila.ofertado)}` : "sin precio ofertado",
    fila.referencia !== null
      ? `${fila.tipoReferencia === "mediana" ? "mediana de mercado" : "estimación del modelo"} ${fmtMoney(fila.referencia)}`
      : "sin referencia de mercado",
    fila.rangoMin !== null && fila.rangoMax !== null
      ? `rango observado ${fmtMoney(fila.rangoMin)} a ${fmtMoney(fila.rangoMax)}`
      : null,
    fila.diffPct !== null ? `diferencia ${fila.diffPct > 0 ? "+" : ""}${fila.diffPct.toFixed(1)} por ciento` : null,
    fila.veredicto.etiqueta,
  ]
    .filter(Boolean)
    .join(", ");

  if (!detalle) return <div className="group">{cuerpo}</div>;
  return (
    <Revelar
      titulo={`Ítem ${fila.numero} · ${fila.descripcion.slice(0, 60)}`}
      descripcion={`${fila.veredicto.etiqueta}${
        fila.diffPct !== null ? ` · ${fila.diffPct > 0 ? "+" : ""}${fila.diffPct.toFixed(1)} % vs mediana` : ""
      }`}
      detalle={detalle}
      ancho="xl"
      etiqueta={`${lectura}. Ver la evidencia de precio de este ítem.`}
      className="rounded-lg"
    >
      {cuerpo}
    </Revelar>
  );
}

export function RangoPrecios({
  filas,
  maximo,
  fmtMoney,
  detalles,
  titulo,
}: {
  /** Ya ordenadas: mayor diferencia en soles primero. */
  filas: FilaPrecio[];
  /** Techo de la escala compartida, en soles de línea. */
  maximo: number;
  fmtMoney: (n: any) => string;
  /** Detalle por `key` de fila: se abre en panel lateral, sin salir de la página. */
  detalles?: Record<string, React.ReactNode>;
  /** Equivalente textual del gráfico para lector de pantalla. */
  titulo: string;
}) {
  const [ref, ancho] = usarAnchoDe();
  const [todas, setTodas] = useState(false);
  const hachuraLeyenda = `hachura-leyenda-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  if (filas.length === 0 || maximo <= 0) return null;

  const ocultas = Math.max(filas.length - VISIBLES, 0);
  const visibles = todas ? filas : filas.slice(0, VISIBLES);

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{titulo}</figcaption>

      {/* Eje. Este bloque además mide el ancho del área de dibujo de todos los renglones. */}
      <div className={cn(REJILLA, "px-2 pb-1")}>
        <div className="text-[10px] uppercase tracking-wider text-mute">Ítem</div>
        <div ref={ref} className="order-last col-span-2 sm:order-none sm:col-span-1">
          {/* El padding replica el del trazo, para que las marcas del eje caigan
              exactamente sobre el 0 y el techo que dibuja cada renglón. */}
          <div className="px-[5px]">
            <div className="grid grid-cols-3 font-mono text-[10px] text-mute">
              <span className="text-left">S/. 0</span>
              <span className="text-center">{fmtMoney(maximo / 2)}</span>
              <span className="text-right">{fmtMoney(maximo)}</span>
            </div>
            <div className="mt-0.5 flex h-1.5 justify-between border-t border-line">
              <span className="w-px bg-line" />
              <span className="w-px bg-line" />
              <span className="w-px bg-line" />
            </div>
          </div>
          <div className="mt-0.5 text-center text-[9px] text-mute">soles de la línea (precio unitario × cantidad)</div>
        </div>
        <div className="justify-self-end text-[10px] uppercase tracking-wider text-mute">Veredicto</div>
      </div>

      <div
        className={cn(
          "divide-y divide-line/60 border-y border-line",
          todas && ocultas > 0 && "scrollbar-warm max-h-[26rem] overflow-y-auto",
        )}
      >
        {visibles.map((fila, i) => (
          <Renglon
            key={fila.key}
            fila={fila}
            ancho={ancho}
            maximo={maximo}
            etiquetaDirecta={i < ETIQUETAS_DIRECTAS}
            fmtMoney={fmtMoney}
            detalle={detalles?.[fila.key]}
          />
        ))}
      </div>

      {ocultas > 0 && (
        <button
          type="button"
          onClick={() => setTodas((v) => !v)}
          className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-line bg-paper px-2.5 py-1 text-[11px] font-semibold text-ink transition-colors duration-rapido hover:bg-paperSoft focus-visible:bg-paperSoft"
        >
          <ChevronDown size={12} className={cn("transition-transform duration-rapido", todas && "rotate-180")} />
          {todas
            ? `Ver solo los ${VISIBLES} de mayor diferencia`
            : `Ver los ${ocultas} ítems restantes (${filas.length} en total)`}
        </button>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-mute">
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="10" aria-hidden className="shrink-0">
            <rect x="0" y="1" width="26" height="8" className="fill-paperDeep stroke-line" strokeWidth="1" />
          </svg>
          rango observado en el mercado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="12" aria-hidden className="shrink-0">
            <rect x="4" y="0" width="2" height="12" className="fill-inkSoft" />
          </svg>
          mediana
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="12" height="12" aria-hidden className="shrink-0">
            <rect x="2" y="0" width="8" height="12" rx="1" className="fill-ink" />
          </svg>
          ofertado
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="10" aria-hidden className="shrink-0">
            <line x1="0" y1="5" x2="26" y2="5" className="stroke-rust" strokeWidth="3" />
          </svg>
          por encima del rango
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="26" height="10" aria-hidden className="shrink-0">
            <defs>
              <pattern id={hachuraLeyenda} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" className="stroke-mute" strokeWidth="1.5" opacity="0.45" />
              </pattern>
            </defs>
            <rect
              x="0"
              y="1"
              width="26"
              height="8"
              fill={`url(#${hachuraLeyenda})`}
              className="stroke-line"
              strokeWidth="1"
              strokeDasharray="2 2"
            />
          </svg>
          sin medición: estimado por el modelo o no verificable
        </span>
      </p>
    </figure>
  );
}
