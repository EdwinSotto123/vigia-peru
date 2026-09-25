"use client";

/**
 * Despachar los agentes sobre un contrato (corrida pagada, sólo equipo). Salió de
 * ConvocatoriaSearch para que lo usen igual el panel /admin/analisis y la acción
 * "Sortear nueva del SEACE" de la cabecera de /app/convocatoria.
 *
 * Las rutas /api/agent/analyze*, /upload-doc y /random exigen la cookie de admin
 * verificada contra el API (401 si no): esconder el botón no es la única barrera.
 * Al terminar navega al informe compartible.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { resolveOcid, fetchOcdsFromBrowserDetailed, fetchAllDocsFromOcds } from "@/lib/oece-bridge";
import { STEPS } from "./constants";
import { codigoCorto, oeceProcesoUrl, humanizeError } from "./utils";

/** El API respondió 401: la sesión de equipo no está o venció. */
class SesionVencida extends Error {}

const MSG_SESION = "Tu sesión de equipo venció o no está activa. Vuelve a entrar desde /admin/login y reintenta.";

export interface Despacho {
  /** Código que se está leyendo (o el último que se intentó). */
  codigo: string;
  cargando: boolean;
  stepIdx: number;
  elapsed: number;
  liveEvents: any[];
  error: string | null;
  despachar: (codigo: string) => Promise<void>;
  limpiarError: () => void;
}

export function useDespacho(): Despacho {
  const router = useRouter();
  const [codigo, setCodigo] = useState("");
  const [cargando, setCargando] = useState(false);
  const [stepIdx, setStepIdx] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [liveEvents, setLiveEvents] = useState<any[]>([]);
  const inicio = useRef(0);

  // Reloj y pasos estimados mientras corre (el stream real los corrige si llega antes).
  useEffect(() => {
    if (!cargando) return;
    const reloj = setInterval(() => setElapsed(Math.floor((Date.now() - inicio.current) / 1000)), 500);
    let acc = 0;
    const timers = STEPS.map((s, i) => {
      acc += s.eta_s;
      return setTimeout(() => setStepIdx(i + 1), acc * 1000);
    });
    return () => {
      clearInterval(reloj);
      timers.forEach(clearTimeout);
    };
  }, [cargando]);

  const despachar = useCallback(
    async (rawCode: string) => {
      // Tres formatos: código numérico ("1212841"), OCID completo ("ocds-dgv273-seacev3-1212841")
      // o cualquier código con guiones.
      const trimmed = rawCode.trim();
      const clean = trimmed.toLowerCase().startsWith("ocds-") ? trimmed : trimmed.replace(/[^0-9a-zA-Z-]/g, "");
      if (!clean) return;
      setCodigo(clean);
      setCargando(true);
      setError(null);
      setStepIdx(0);
      setElapsed(0);
      setLiveEvents([]);
      inicio.current = Date.now();
      try {
        // 1) OCDS desde el browser vía el relay. Si OECE bloquea (403), seguimos con
        //    ocds=null: el orquestador lo trae por el downloader local.
        const ocid = resolveOcid(clean);
        const ocdsRes = await fetchOcdsFromBrowserDetailed(ocid);
        const ocds: any = ocdsRes.cr;
        if (!ocds && ocdsRes.reason !== "blocked") {
          const url = oeceProcesoUrl(ocid);
          setError(
            ocdsRes.reason === "not_found"
              ? `La convocatoria ${ocid} no existe o ya no es accesible en el portal del OECE. Verifícala en ${url}`
              : `No se pudo obtener la convocatoria ${ocid} desde el OECE (error de red). Revisa tu conexión y reintenta. Enlace oficial: ${url}`,
          );
          return;
        }

        // 2) Documentos del expediente desde el browser, subidos a GCS uno por uno (< 32 MB cada request).
        const { docs: fetchedDocs } = await fetchAllDocsFromOcds(ocds);
        const doc_urls: Record<string, string> = {};
        const docs_b64: Record<string, string> = {};
        const subidas = await Promise.allSettled(
          fetchedDocs.map(async (d) => {
            const r = await fetch("/api/agent/upload-doc", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ocid, url: d.url, base64: d.base64, filename: d.filename, contentType: d.contentType }),
            });
            if (r.status === 401) throw new SesionVencida(MSG_SESION);
            const text = await r.text();
            let data: any = null;
            try {
              data = JSON.parse(text);
            } catch {
              throw new Error(`upload ${d.filename}: respuesta no-JSON (${r.status}) ${text.slice(0, 150)}`);
            }
            if (!r.ok || !data?.ok) throw new Error(`upload ${d.filename}: ${data?.error || r.status} ${data?.detail || ""}`);
            return { ...d, gcs_url: data.gcs_url };
          }),
        );
        if (subidas.some((res) => res.status === "rejected" && res.reason instanceof SesionVencida)) throw new SesionVencida(MSG_SESION);
        const fallidos: string[] = [];
        subidas.forEach((res, i) => {
          if (res.status === "fulfilled") doc_urls[res.value.url] = res.value.gcs_url;
          else fallidos.push(`${fetchedDocs[i].filename}: ${(res.reason as Error).message}`);
        });
        console.log(
          `[Vigía] OCID ${ocid}: ${fetchedDocs.length - fallidos.length}/${fetchedDocs.length} documentos subidos` +
            (fallidos.length > 0 ? `, ${fallidos.length} fallos: ${fallidos.join("; ")}` : ""),
        );

        // 3) Stream NDJSON del orquestador.
        const r = await fetch("/api/agent/analyze/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ input: clean, ocds, docs_b64, doc_urls }),
        });
        if (r.status === 401) throw new SesionVencida(MSG_SESION);
        if (!r.ok || !r.body) {
          const txt = await r.text().catch(() => "");
          throw new Error(txt.slice(0, 300) || `stream_failed (${r.status})`);
        }
        const reader = r.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalEvent: any = null;
        let lastErrorEvent: any = null; // para un mejor mensaje si el stream colapsa
        const procesarLinea = (line: string) => {
          try {
            const ev = JSON.parse(line);
            if (ev.kind === "final") finalEvent = ev;
            else {
              if (ev.kind === "error") lastErrorEvent = ev;
              setLiveEvents((prev) => [...prev, ev]);
            }
          } catch {
            /* línea malformada: se ignora */
          }
        };
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            buf += decoder.decode();
            const tail = buf.trim();
            if (tail) procesarLinea(tail);
            break;
          }
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (line) procesarLinea(line);
          }
        }
        if (!finalEvent) {
          throw new Error(
            humanizeError(
              lastErrorEvent ? `${lastErrorEvent.error_kind || "runner_exception"}: ${lastErrorEvent.detail || ""}` : "stream_interrupted",
            ),
          );
        }
        // `runner_error` en el evento final: el runner explotó pero se persistió un análisis parcial.
        if (finalEvent.runner_error) {
          const re = finalEvent.runner_error;
          throw new Error(humanizeError(`${re.kind || "runner_exception"}: ${re.msg || ""}`, re.class));
        }

        // 4) Análisis persistido: al informe compartible.
        router.push(`/app/convocatoria/${encodeURIComponent(codigoCorto(clean))}`);
      } catch (err) {
        if (err instanceof SesionVencida) {
          setError(err.message);
        } else {
          const msg = (err as Error).message || "";
          // Si ya pasó por humanizeError no se re-formatea.
          const yaHumano = /^(No se pudo procesar|El análisis|El OCID|El servicio)/.test(msg);
          setError(yaHumano ? msg : humanizeError(msg));
        }
      } finally {
        setCargando(false);
      }
    },
    [router],
  );

  const limpiarError = useCallback(() => setError(null), []);

  return { codigo, cargando, stepIdx, elapsed, liveEvents, error, despachar, limpiarError };
}
