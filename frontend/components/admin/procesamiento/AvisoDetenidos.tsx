"use client";

import { type Operacion } from "@/lib/admin";
import { Aviso, Expandable, claseBoton, fmtFechaHora } from "@/components/admin/ui";
import { type Estado, hace, loteNocturnoParado, plural } from "./tipos";
// ── Por qué algo está detenido ────────────────────────────────────────────

/**
 * Lo que el panel tiene que decir antes que cualquier número: si hay contratos
 * que no avanzan, por qué, desde cuándo y cómo se destraba. La causa de los que
 * esperan documentos casi siempre es la misma: el lote nocturno baja los
 * documentos desde una conexión peruana (el SEACE bloquea a la nube) y si no
 * corre, se quedan esperando para siempre.
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
    <div className="mb-5 space-y-3">
      {esperando > 0 && (
        <Aviso
          // Sin región viva: la página se sondea cada 15 s y un role="alert" lo volvía a anunciar.
          rol="note"
          tono={loteParado ? "danger" : "warn"}
          titulo={
            <>
              {esperando} {esperando === 1 ? "contrato espera" : "contratos esperan"} sus documentos
              {loteParado ? " y no van a avanzar solos" : ""}
            </>
          }
        >
          <p>
            Los documentos los baja el lote nocturno desde una conexión peruana, porque el SEACE no deja entrar a la nube.{" "}
            {cargandoOp ? (
              <span aria-hidden className="inline-block h-3 w-48 animate-shimmerSweep rounded bg-gradient-to-r from-paperDeep via-paper to-paperDeep bg-[length:200%_100%] align-middle" />
            ) : fin ? (
              <>
                El último lote corrió <strong className="text-ink">{hace(fin)}</strong> ({fmtFechaHora(fin)}).
              </>
            ) : (
              <>No hay registro de ningún lote.</>
            )}
            {relayCaido && <> El servidor de Lima que lo corre cada noche no responde.</>}
          </p>
          {/* Las acciones van en el cuerpo (no en `acciones`): en el teléfono, a la derecha, apretaban el texto a una columna. */}
          <button onClick={() => onVer("esperando_documentos")} className={claseBoton("secundario", "sm", "mt-2")}>
            Ver cuáles son
          </button>
          <Expandable variante="linea" resumen={<span className="font-semibold text-ink">Cómo destrabarlo</span>} className="mt-2 text-[13px]">
            <ol className="space-y-2 rounded-xl bg-paper/80 p-3 text-[13px] text-inkSoft">
              <li>
                <strong className="text-ink">Ahora, desde tu computadora</strong> (conexión peruana), en la carpeta del proyecto:
                <code className="mt-1 block break-all rounded-lg bg-ink px-3 py-2 font-mono text-[12px] text-paper">bash infrastructure/deploy/batch-nocturno.sh</code>
                Baja primero los contratos financiados; al terminar, se procesan solos.
              </li>
              <li>
                <strong className="text-ink">Para que no vuelva a pasar:</strong> reiniciar el servidor de Lima (el relay) en su proveedor, que corre el lote cada noche a la 1:30.
              </li>
            </ol>
          </Expandable>
        </Aviso>
      )}
      {errores > 0 && (
        <Aviso rol="note" tono="danger" titulo={`${plural(errores, "contrato", "contratos")} con error después de 3 intentos`}>
          <p>Revisa el detalle y, cuando esté arreglada la causa, vuelve a encolarlos.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button onClick={() => onVer("error")} className={claseBoton("secundario")}>
              Ver cuáles
            </button>
            <button onClick={onReencolarErrores} className={claseBoton("peligro")}>
              Re-encolar todos
            </button>
          </div>
        </Aviso>
      )}
    </div>
  );
}
