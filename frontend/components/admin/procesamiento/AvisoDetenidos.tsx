"use client";

import { type Operacion } from "@/lib/admin";
import { cn } from "@/lib/utils";
import { Aviso, Expandable, claseBoton } from "@/components/admin/ui";
import { Ayuda } from "@/components/patrones/Ayuda";
import { type Estado, fmtFechaHora, hace, loteNocturnoParado, plural } from "./tipos";
// ── Por qué algo está detenido ────────────────────────────────────────────

/**
 * Lo que el panel tiene que decir antes que cualquier número: si hay contratos
 * que no avanzan, desde cuándo y cómo se destraba. La causa de los que esperan
 * documentos casi siempre es la misma: la fuente documentos (cada hora, por el
 * relay: el SEACE bloquea a la nube) baja los documentos de los financiados y si
 * no corre, se quedan esperando para siempre.
 *
 * Corto a propósito (rediseño del 2026-10-30): un título, una línea con el dato que
 * importa (cuándo corrió el último lote) y las acciones. El porqué va en el ⓘ y los
 * pasos para destrabarlo, plegados y numerados.
 */
export function AvisoDetenidos({
  op,
  cargandoOp = false,
  esperando,
  errores,
  onReencolarErrores,
  onVer,
}: {
  op: Operacion | null;
  /** /operacion todavía no llegó (tarda segundos): no se afirma nada del lote hasta saberlo. */
  cargandoOp?: boolean;
  esperando: number;
  errores: number;
  onReencolarErrores: () => void;
  onVer: (e: Estado) => void;
}) {
  const fin = op?.lote?.finalizadoAt ?? op?.lote?.iniciadoAt ?? null;
  const loteParado = !cargandoOp && loteNocturnoParado(op) === true;
  const relayCaido = op?.relay?.ok === false;

  if (esperando === 0 && errores === 0) return null;

  return (
    // Con los dos, lado a lado en escritorio: uno debajo del otro empujaban la lista media pantalla.
    <div className={cn("grid gap-3", esperando > 0 && errores > 0 && "lg:grid-cols-2")}>
      {esperando > 0 && (
        <Aviso
          // Sin región viva: la página se sondea cada 15 s y un role="alert" lo volvía a anunciar.
          rol="note"
          tono={loteParado ? "danger" : "warn"}
          titulo={
            <>
              {plural(esperando, "contrato espera", "contratos esperan")} sus documentos{loteParado ? " y no van a avanzar solos" : ""}{" "}
              <Ayuda titulo="¿Por qué esperan?">
                Los documentos los baja cada hora la fuente documentos, por el relay de Lima, porque el SEACE no deja entrar a la nube; los de
                los contratos financiados los baja el lote nocturno (1:30). Si el lote no corre, esperan para siempre.
              </Ayuda>
            </>
          }
        >
          {/* Los datos, en una línea (sin <p>): cuándo corrió el último lote y si el relay responde. */}
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Último lote:{" "}
              {cargandoOp ? (
                <span aria-hidden className="inline-block h-3 w-40 animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%] align-middle" />
              ) : fin ? (
                <>
                  <strong className="text-ink">{hace(fin)}</strong> ({fmtFechaHora(fin)})
                </>
              ) : (
                "no hay registro de ninguno"
              )}
            </span>
            {relayCaido && <span className="font-medium text-crimsonTexto">El servidor de Lima (relay) no responde</span>}
          </span>
          {/* Las acciones van en el cuerpo (no en `acciones`): en el teléfono, a la derecha, apretaban el texto a una columna.
              El botón y «Cómo destrabarlo» comparten fila; abierto, el plegable baja a una fila propia (open:basis-full). */}
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button onClick={() => onVer("esperando_documentos")} className={claseBoton("secundario", "sm")}>
              Ver cuáles son
            </button>
            <Expandable variante="linea" resumen={<span className="font-semibold text-ink">Cómo destrabarlo</span>} className="text-meta open:basis-full">
              <ol className="list-decimal space-y-2 pl-5 text-meta text-inkSoft marker:font-semibold marker:text-ink">
                <li>
                  <strong className="text-ink">Ahora, desde tu computadora</strong> (conexión peruana), en la carpeta del proyecto:
                  <code className="mt-1 block break-all rounded-lg bg-ink px-3 py-2 font-mono text-rotulo text-paper">bash infrastructure/deploy/gcp/batch-nocturno.sh</code>
                  Baja primero los contratos financiados; al terminar, se procesan solos.
                </li>
                <li>
                  <strong className="text-ink">Para que no vuelva a pasar:</strong> reinicia el servidor de Lima (el relay) en su proveedor; corre el lote cada
                  noche a la 1:30.
                </li>
              </ol>
            </Expandable>
          </div>
        </Aviso>
      )}
      {errores > 0 && (
        <Aviso
          rol="note"
          tono="danger"
          titulo={
            <>
              {plural(errores, "contrato", "contratos")} con error después de 3 intentos{" "}
              <Ayuda titulo="¿Qué hago con los errores?">
                El motivo de cada uno está en su fila, en rojo. Cuando esté arreglada la causa, vuelve a encolarlos: todos juntos desde aquí o de a uno
                desde el menú «⋯» de la fila.
              </Ayuda>
            </>
          }
        >
          <span className="mt-1 flex flex-wrap gap-2">
            <button onClick={() => onVer("error")} className={claseBoton("secundario")}>
              Ver cuáles
            </button>
            <button onClick={onReencolarErrores} className={claseBoton("peligro")}>
              Re-encolar todos
            </button>
          </span>
        </Aviso>
      )}
    </div>
  );
}
