/**
 * Las celdas de un contrato financiado sobre la `Tabla` del kit (DESIGN_SYSTEM.md §14.1):
 * lo que comparten el tablero en vivo (cliente, con sondeo) y lo ya leído (servidor).
 * Reemplaza a FilaProcesamiento, que tenía su propia rejilla, su propia cabecera y su
 * propia altura de fila.
 *
 * Anatomía, igual que en todo listado:
 *   estado (chip) · el contrato (objeto en 1 línea + entidad · zona) · valor (derecha) · tiempo · ›
 *
 * Sin hooks ni estado: lo que avanza con el reloj (duración, antigüedad, paso en curso) son
 * piezas cliente de `RelojVivo`, que escuchan el único reloj de la página sin volver a
 * renderizar la tabla entera cada segundo.
 * §10.4: una alerta en revisión dice "En revisión" y nada más (ni puntaje ni señales).
 */

import { CeldaNumero, CeldaPrincipal, type Columna } from "@/components/listado";
import { Ayuda } from "@/components/patrones/Ayuda";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
import { soles } from "@/lib/formato";
import {
  estadoVisible,
  fasesEfectivas,
  fechaLima,
  progresoCarriles,
  progresoFases,
  type Procesamiento,
} from "@/lib/auditoria";
import { MiniCarriles } from "./DagCarriles";
import { EstadoPill } from "./EstadoPill";
import { EdadEspera, FaseEnCurso, TiempoEnAnalisis } from "./RelojVivo";

/** Qué mide la columna "Tiempo": depende del estado de cada fila. */
const AYUDA_TIEMPO = (
  <Ayuda titulo="¿Qué tiempo es?">
    <span className="block">
      <span className="font-semibold text-ink">En análisis:</span> cuánto lleva la lectura.
    </span>
    <span className="mt-1 block">
      <span className="font-semibold text-ink">Esperando documentos:</span> cuánto lleva esperando, con un reloj que avanza.
    </span>
    <span className="mt-1 block">
      <span className="font-semibold text-ink">Con error:</span> en qué intento va, de tres. <span className="font-semibold text-ink">Leído:</span> el
      día en que terminó, hora de Lima.
    </span>
  </Ayuda>
);

/**
 * Ancho del estado en el tablero: "Esperando documentos" pide ~172 px en una línea. Fluido
 * (todas las filas comparten el viewport, así que la rejilla sigue alineada): en escritorio
 * cabe entero; en un celular de 390 px baja a 132 px, la píldora parte en dos líneas y el
 * objeto conserva ~146 px en vez de ~114.
 */
const ANCHO_ESTADO_VIVO = "clamp(132px, 22vw, 176px)";

/** El tablero en vivo. En el celular: estado + contrato; el valor y el tiempo entran por ancho. */
export const COLUMNAS_VIVO: Columna[] = [
  { clave: "estado", desde: "md", apilar: true, titulo: "Estado", ancho: ANCHO_ESTADO_VIVO },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "valor", titulo: "Valor referencial", ancho: "124px", alinear: "der", desde: "lg" },
  { clave: "tiempo", titulo: "Tiempo", ancho: "128px", desde: "md", ayuda: AYUDA_TIEMPO },
];

/**
 * El tablero dentro de un panel lateral (/app/financiar/[ubigeo]): los breakpoints son del
 * viewport, no del panel, así que en escritorio el panel angosto recibiría las cuatro
 * columnas. Sin valor: el objeto necesita ese ancho.
 */
export const COLUMNAS_VIVO_COMPACTO: Columna[] = [
  { clave: "estado", desde: "md", apilar: true, titulo: "Estado", ancho: ANCHO_ESTADO_VIVO },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "tiempo", titulo: "Tiempo", ancho: "120px", desde: "md", ayuda: AYUDA_TIEMPO },
];

/** Qué dice la columna "Resultado" de lo ya leído (§10.1 y §10.4). */
const AYUDA_RESULTADO = (
  <Ayuda titulo="¿Qué dice el resultado?">
    <span className="block">
      El peso del riesgo del contrato (alto, medio o bajo) cuando el dictamen trae señales; &ldquo;Sin señales&rdquo; cuando
      no trae ninguna.
    </span>
    <span className="mt-1.5 block text-mute">
      &ldquo;En revisión&rdquo;: se leyó entero, pero la autoevaluación frenó su publicación. Hasta que una persona lo revise
      no se muestran su puntaje ni sus señales.
    </span>
  </Ayuda>
);

/** Lo ya leído: el resultado, cuántas señales, cuánto, [quién lo pagó] y cuándo. */
export function columnasHistorico(conFinanciador: boolean): Columna[] {
  return [
    { clave: "estado", desde: "md", apilar: true, titulo: "Resultado", ancho: "124px", ayuda: AYUDA_RESULTADO },
    { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
    { clave: "senales", titulo: "Señales", ancho: "76px", alinear: "der", desde: "md" },
    { clave: "valor", titulo: "Valor referencial", ancho: "124px", alinear: "der", desde: "lg" },
    ...(conFinanciador ? [{ clave: "pago", titulo: "Lo pagó", ancho: "150px", desde: "xl" as const }] : []),
    { clave: "leido", titulo: "Leído", ancho: "88px", desde: "md" },
  ];
}

/**
 * El chip de estado. Leído y publicado: el peso del riesgo (color + ícono + palabra), nunca
 * el check verde si hay señales (§10.1). Sin puntaje todavía (el dictamen se está
 * publicando), el peso diría "Sin leer" de un contrato leído: va la píldora de su estado.
 */
export function EstadoProcesamiento({ p }: { p: Procesamiento }) {
  const estado = estadoVisible(p);
  if (estado === "procesado" && p.score != null) return <PesoRiesgo score={p.score} banderas={p.banderas} formato="pastilla" />;
  return <EstadoPill estado={estado} intentos={p.intentos} />;
}

/**
 * Qué es: el objeto (1 línea, entero en `title`) y entidad y zona. Si lo están leyendo, una
 * línea más con el paso en curso, los pasos hechos y el avance por carril.
 * `data-fila` le permite al tablero encontrar la fila para animar su cambio de grupo.
 */
export function CeldaContrato({ p }: { p: Procesamiento }) {
  const titulo = p.titulo ?? "Contrato sin título en el registro";
  const meta = [p.entidad ?? "Entidad no identificada", p.zona];
  if (p.estado !== "procesando") {
    return (
      <span data-fila={p.ocid} className="block w-full min-w-0">
        <CeldaPrincipal titulo={titulo} meta={meta} />
      </span>
    );
  }
  const estado = estadoVisible(p);
  const fases = fasesEfectivas(p);
  const prog = progresoFases(fases, estado);
  return (
    <span data-fila={p.ocid} className="block w-full min-w-0">
      <CeldaPrincipal titulo={titulo} meta={meta} />
      <span className="mt-1.5 flex min-w-0 items-center gap-2 text-[11.5px]">
        <FaseEnCurso p={p} fases={fases} className="min-w-0 truncate text-amberTexto" />
        <span className="shrink-0 font-mono tabular-nums text-mute">
          {prog.hechas}/{prog.aplicables} pasos
        </span>
        <span className="block w-20 shrink-0 sm:w-28">
          <MiniCarriles carriles={progresoCarriles(fases, estado)} />
        </span>
      </span>
    </span>
  );
}

/** El valor referencial: 0 o nulo es "Sin dato" (el OCDS publica 0 cuando no hay valor). */
export function CeldaValor({ p }: { p: Procesamiento }) {
  return <CeldaNumero>{p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : "Sin dato"}</CeldaNumero>;
}

/**
 * El tiempo que importa según el estado: cuánto lleva en análisis, cuánto lleva esperando
 * sus documentos (un reloj que avanza de verdad), en qué intento va o cuándo se leyó. En
 * cola no hay fecha: la celda va vacía, no con un "Sin dato" que parecería una falta.
 * Fechas con `fechaLima` (meses escritos a mano): esta celda se hidrata en el cliente.
 */
export function CeldaTiempo({ p }: { p: Procesamiento }) {
  const clase = "text-[12.5px] tabular-nums";
  if (p.estado === "procesando") {
    return p.iniciadoAt ? <TiempoEnAnalisis desde={p.iniciadoAt} className={`${clase} font-mono text-amberTexto`} /> : <></>;
  }
  if (p.estado === "esperando_documentos") {
    const desde = p.iniciadoAt ? Date.parse(p.iniciadoAt) : NaN;
    if (!Number.isFinite(desde)) return <></>;
    return (
      <EdadEspera
        desde={desde}
        className={`${clase} font-mono text-clayTexto`}
        title={`Espera sus documentos desde el ${fechaLima(desde, { larga: true, hora: true })}`}
      />
    );
  }
  if (p.estado === "error") {
    return <span className={`${clase} text-crimsonTexto`}>{p.intentos >= 3 ? "3 de 3 intentos" : `intento ${Math.max(1, p.intentos)} de 3`}</span>;
  }
  if (p.estado === "procesado" && p.finalizadoAt) {
    return (
      <time
        dateTime={p.finalizadoAt}
        className={`${clase} text-mute`}
        title={`Leído el ${fechaLima(p.finalizadoAt, { larga: true, hora: true })}`}
      >
        {fechaLima(p.finalizadoAt)}
      </time>
    );
  }
  return <></>;
}

/** La página del contrato en vivo: la única acción de cada fila. */
export const hrefProcesamiento = (ocid: string) => `/app/auditoria/${encodeURIComponent(ocid)}`;
