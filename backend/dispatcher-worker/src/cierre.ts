/**
 * Qué resultado queda cuando el stream terminó: la segunda mitad de `procesar()` en main.py (desde
 * `if resultado == OK and not alerta_persistida(ocid)` hasta el `except`), con la misma estructura
 * try/except para que cada camino dé lo mismo que en Python. Las consultas llegan inyectadas: en el
 * Workflow son pasos (`alertaPersistida`, y la espera de gracia en varios pasos), en las pruebas,
 * funciones falsas.
 */

import { ABORT, FAIL, OK } from "./sql.ts";
import type { Resultado } from "./sql.ts";
import type { Checkpoint } from "./stream.ts";
import { cortar } from "./py.ts";

export interface Dependencias {
  /** `alerta_persistida(ocid)` (sin `desde`). */
  alertaPersistida(): Promise<boolean>;
  /** `esperar_alerta(ocid, t0_utc)`: la espera de gracia completa. */
  esperarAlerta(): Promise<boolean>;
}

export interface Cierre {
  resultado: Resultado;
  err: string | null;
  /** Para el registro: el stream cortó pero la alerta quedó persistida. */
  aviso: string | null;
}

/** Excepción que viene del stream (el `except Exception as e` de main.py la toma igual). */
class ErrorDelStream extends Error {}

export async function decidirCierre(cp: Checkpoint, ocid: string, deps: Dependencias): Promise<Cierre> {
  let resultado = cp.resultado;
  let err: string | null = cp.err;
  let aviso: string | null = null;
  try {
    if (cp.etapa === "excepcion") throw new ErrorDelStream(cp.excepcion ?? "stream cortado");
    if (resultado === OK && !(await deps.alertaPersistida())) {
      // "final" sin alerta en DB = el pipeline no llegó a persistir → cuenta como fallo (reintenta).
      resultado = FAIL;
      err = "el orquestador terminó sin persistir la alerta";
    } else if (resultado === FAIL) {
      if (cp.state.error) {
        err = cp.state.error;
      } else if (await deps.esperarAlerta()) {
        // El stream cortó (proxy/NAT/idle) pero el análisis SÍ quedó en DB.
        resultado = OK;
        aviso = `stream sin 'final' para ${ocid}, pero la alerta quedó persistida → procesado`;
      } else {
        err = "stream terminó sin evento final y sin alerta persistida";
      }
    } else if (resultado === ABORT) {
      err = cp.state.error ?? null;
    }
  } catch (e) {
    // Cualquier fallo re-encola (hasta 3 intentos), salvo que la alerta haya quedado en DB.
    err = cortar(String((e as Error)?.message ?? e), 500);
    try {
      if (await deps.esperarAlerta()) {
        resultado = OK;
        err = null;
        aviso = `el stream de ${ocid} falló, pero la alerta quedó persistida → procesado`;
      }
    } catch {
      // se cierra con el error del stream
    }
  }
  return { resultado, err, aviso };
}
