/**
 * Una fila por contrato financiado: la unidad de las listas de "Auditoría en vivo" (el tablero
 * y lo ya leído) y del tablero que también vive en /app/financiar/[ubigeo] e /impacto/[codigo].
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): qué es (el objeto en una línea, entero en `title`),
 * de qué entidad y zona, en qué estado, cuánto y desde cuándo. Antes cada contrato era una
 * tarjeta con la entidad, el objeto en dos líneas, "Lo pagó…", el código del aporte y una frase
 * por estado: ~500 caracteres por contrato, con treinta y tantos en la cola.
 *
 * El detalle (fases, bitácora, dictamen) está en la página del contrato: la fila entera es el
 * enlace. Sin estado propio: `ahora` llega del tablero, que tiene el único reloj de la página.
 *
 * §10.4: una alerta en revisión dice "En revisión" y nada más (ni puntaje ni señales).
 */

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { plural, soles } from "@/lib/formato";
import {
  duracion,
  estadoVisible,
  faseHumana,
  fasesEfectivas,
  fechaLima,
  progresoCarriles,
  progresoFases,
  relojEdad,
  type Procesamiento,
} from "@/lib/auditoria";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { Skeleton } from "@/components/ui/Skeleton";
import { cn } from "@/lib/utils";
import { MiniCarriles } from "./DagCarriles";
import { EstadoPill } from "./EstadoPill";

/**
 * Pistas de la grilla (contrato · estado · valor · tiempo · [lo pagó] · flecha). Desde `lg` y
 * no desde `md`: con la barra lateral (256 px, visible desde `md`) a 768 px quedaban 464 px y
 * el objeto se quedaba sin columna. Literales enteros: Tailwind sólo genera las clases que lee
 * completas en el código.
 */
const PISTAS = "lg:grid lg:grid-cols-[minmax(0,1fr)_160px_100px_112px_16px]";
const PISTAS_FINANCIADOR =
  "lg:grid lg:grid-cols-[minmax(0,1fr)_160px_100px_112px_16px] xl:grid-cols-[minmax(0,1fr)_160px_100px_112px_150px_16px]";

/** Las etiquetas de las columnas, alineadas con las filas. Sólo en escritorio; el lector de pantalla lee cada fila entera. */
export function CabeceraFilas({
  estado = "Estado",
  tiempo = "Tiempo",
  conFinanciador = false,
}: {
  estado?: string;
  tiempo?: string;
  conFinanciador?: boolean;
}) {
  return (
    <div
      className={cn(
        "hidden items-center gap-x-3 border-b border-line bg-paperSoft px-4 py-2 text-[11px] font-semibold text-mute",
        conFinanciador ? PISTAS_FINANCIADOR : PISTAS,
      )}
      aria-hidden
    >
      <span>Contrato</span>
      <span>{estado}</span>
      <span className="text-right">Valor referencial</span>
      <span>{tiempo}</span>
      {conFinanciador && <span className="hidden xl:block">Lo pagó</span>}
      <span />
    </div>
  );
}

export function FilaProcesamiento({
  p,
  ahora,
  recien = false,
  compacto = false,
  conFinanciador = false,
}: {
  p: Procesamiento;
  /** Reloj del tablero; 0 hasta montar (el HTML del servidor no lleva cronómetros). */
  ahora: number;
  /** Cambió de estado en el último sondeo: se marca unos segundos. */
  recien?: boolean;
  /** Contenedor angosto: siempre apilada, sin la grilla de escritorio. */
  compacto?: boolean;
  /** Columna "Lo pagó" (desde `xl`): sólo donde hay más de un financiador posible. */
  conFinanciador?: boolean;
}) {
  const estado = estadoVisible(p);
  const titulo = p.titulo ?? p.ocid;
  const procesando = p.estado === "procesando";
  const fases = procesando ? fasesEfectivas(p) : null;
  const prog = fases ? progresoFases(fases, estado) : null;

  return (
    <Link
      href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
      className={cn(
        "group block px-4 py-2.5 transition-colors duration-rapido hover:bg-paperSoft focus-visible:[outline-offset:-2px]",
        !compacto && "lg:items-center lg:gap-x-3",
        !compacto && (conFinanciador ? PISTAS_FINANCIADOR : PISTAS),
        compacto && "px-3",
        recien ? "bg-granate-soft ring-1 ring-inset ring-granate/40" : procesando && "bg-amber-soft/40",
      )}
    >
      <span className="block min-w-0">
        <span
          className={cn("block text-[14px] font-semibold leading-snug text-ink", compacto ? "line-clamp-2" : "line-clamp-2 lg:truncate")}
          title={titulo}
        >
          {titulo}
        </span>
        <span className="mt-0.5 block truncate text-[12px] text-mute">
          {p.entidad ?? "Entidad no identificada"} · {p.zona}
        </span>
        {fases && prog && (
          <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[11.5px]">
            <span className="min-w-0 truncate text-amberTexto">{faseHumana(p, ahora || undefined, fases)}</span>
            <span className="shrink-0 font-mono tabular-nums text-mute">
              {prog.hechas}/{prog.aplicables} pasos
            </span>
            <span className="block w-20 shrink-0 sm:w-28">
              <MiniCarriles carriles={progresoCarriles(fases, estado)} />
            </span>
          </span>
        )}
      </span>

      {/* En el celular (y en compacto) estado, valor y tiempo van en una línea; desde `lg`
          el envoltorio desaparece (`contents`) y cada celda ocupa su columna. */}
      <span className={cn("mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1", !compacto && "lg:mt-0 lg:contents")}>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <Estado p={p} />
        </span>
        <span className="text-[12.5px] tabular-nums text-inkSoft lg:text-right">
          {p.montoPen != null && p.montoPen > 0 ? <span className="font-mono">{soles(p.montoPen)}</span> : <span className="text-mute">Sin dato</span>}
        </span>
        {/* Vacía (en cola, sin fecha) no deja hueco en la línea del celular; en la grilla
            sigue ocupando su columna para no correr las de al lado. */}
        <span className={cn("text-[12px] tabular-nums text-mute empty:hidden", !compacto && "lg:empty:block")}>
          <Tiempo p={p} ahora={ahora} />
        </span>
        {conFinanciador && !compacto && (
          <span
            className="hidden min-w-0 truncate text-[12px] text-inkSoft xl:block"
            title={`Lo pagó ${p.financiador} · aporte ${p.contribucionCodigo}`}
          >
            {p.financiador}
          </span>
        )}
        {!compacto && <ChevronRight size={16} className="hidden text-mute group-hover:text-granate lg:block" aria-hidden />}
      </span>
    </Link>
  );
}

/**
 * Estado de la fila. Leído y publicado: el peso del riesgo (color + ícono + palabra) y las
 * señales que lo explican; nunca el check verde si hay señales (§10.1). El resto, su píldora.
 */
function Estado({ p }: { p: Procesamiento }) {
  const estado = estadoVisible(p);
  if (estado === "procesado") {
    const n = p.banderas ?? 0;
    return (
      <>
        {/* Sin puntaje todavía (el dictamen se está publicando), el peso diría "Sin leer" de un
            contrato leído: va la píldora de su estado. */}
        {p.score != null ? <PesoRiesgo score={p.score} banderas={n} /> : <EstadoPill estado={estado} />}
        {n > 0 && <span className="text-[12px] tabular-nums text-inkSoft">{plural(n, "señal", "señales")}</span>}
      </>
    );
  }
  return <EstadoPill estado={estado} intentos={p.intentos} />;
}

/**
 * El tiempo que importa según el estado: cuánto lleva en análisis, cuánto lleva esperando
 * sus documentos (un reloj que avanza de verdad), en qué intento va o cuándo se leyó.
 */
function Tiempo({ p, ahora }: { p: Procesamiento; ahora: number }) {
  if (p.estado === "procesando") {
    const t = ahora > 0 && p.iniciadoAt ? ahora - Date.parse(p.iniciadoAt) : NaN;
    return Number.isFinite(t) && t > 0 ? (
      <span className="font-mono" title="Tiempo en análisis" suppressHydrationWarning>
        {duracion(t)}
      </span>
    ) : null;
  }
  if (p.estado === "esperando_documentos") {
    const desde = p.iniciadoAt ? Date.parse(p.iniciadoAt) : NaN;
    if (!Number.isFinite(desde)) return null;
    return (
      <span className="font-mono text-clayTexto" title={`Espera sus documentos desde el ${fechaLima(desde, { larga: true, hora: true })}`} suppressHydrationWarning>
        {ahora > 0 ? relojEdad(ahora - desde) : fechaLima(desde)}
      </span>
    );
  }
  if (p.estado === "error") {
    return (
      <span className="text-crimsonTexto">
        {p.intentos >= 3 ? "3 de 3 intentos" : `intento ${Math.max(1, p.intentos)} de 3`}
      </span>
    );
  }
  if (p.estado === "procesado" && p.finalizadoAt) {
    return (
      <time dateTime={p.finalizadoAt} title={`Leído el ${fechaLima(p.finalizadoAt, { larga: true, hora: true })}`}>
        {fechaLima(p.finalizadoAt)}
      </time>
    );
  }
  return null;
}

/** Misma forma que una fila real, para la primera carga. */
export function FilaSkeleton() {
  return (
    <li className="space-y-2 border-b border-line/70 px-4 py-3 last:border-b-0" aria-hidden>
      <Skeleton className="h-3.5 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
    </li>
  );
}
