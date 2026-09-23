"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ListFilter } from "lucide-react";
import { getAlertas } from "@/lib/api-client";
import { formatSoles } from "@/lib/formato";
import { nivelDeScore, SEVERIDAD, type NivelSeveridad } from "@/lib/severidad";
import { cn } from "@/lib/utils";
import { alertaHref, departamentoDeAlerta, esSenal, esSenalDeBajoPeso } from "./senales";

export { alertaHref } from "./senales";

/**
 * Caja del puntaje. Sobre `rust` el blanco da 7,3:1; sobre `amber` daba 3,47:1
 * y sobre `clay` 4,20:1, así que la media pasa a fondo suave con su tono de
 * texto (amberTexto sobre amber-soft, 5,1:1). Los cortes son los de
 * `lib/severidad` (70/40), no umbrales escritos acá.
 */
const CAJA: Record<NivelSeveridad, string> = {
  alta: "bg-rust text-paper",
  media: "border border-amber/50 bg-amber-soft text-amberTexto",
  baja: "border border-line bg-paperDeep text-inkSoft",
  sin_analizar: "border border-line bg-paperDeep text-mute",
};

/**
 * Contratos con señal de un departamento. Si el padre ya trajo las alertas
 * (el mapa las usa para los puntos) las reutiliza; `null` es "cargando" y sólo
 * `undefined` hace que las pida.
 *
 * Cuenta y lista sólo contratos con señal (`esSenal`). Los leídos con banderas
 * de bajo peso van aparte y plegados, con su nombre; los leídos sin ninguna
 * bandera no son señales y no aparecen.
 */
export function AlertasDeZona({
  ubigeo,
  nombre,
  alertas,
  limit = 20,
}: {
  /** Ubigeo de departamento (2 dígitos). */
  ubigeo: string;
  nombre: string;
  /** Alertas ya cargadas por el padre. `null` = cargando; `undefined` = pedirlas acá. */
  alertas?: any[] | null;
  limit?: number;
}) {
  const [fetched, setFetched] = useState<any[] | null>(null);
  const needsFetch = alertas === undefined;

  useEffect(() => {
    if (!needsFetch) return;
    let alive = true;
    getAlertas({ limit: 200 })
      .then((d) => alive && setFetched(d as any[]))
      .catch(() => alive && setFetched([]));
    return () => {
      alive = false;
    };
  }, [needsFetch]);

  const source = needsFetch ? fetched : alertas;
  const { rows, total, bajas } = useMemo(() => {
    if (!source) return { rows: null, total: 0, bajas: [] as any[] };
    const deZona = source.filter((a) => departamentoDeAlerta(a) === ubigeo);
    const senales = deZona.filter(esSenal).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const bajas = deZona.filter(esSenalDeBajoPeso).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return { rows: senales.slice(0, limit), total: senales.length, bajas };
  }, [source, ubigeo, limit]);

  if (rows === null) {
    return (
      <ul className="space-y-2" aria-busy>
        {[0, 1, 2].map((i) => (
          <li key={i} className="h-16 animate-pulse rounded-xl bg-paperDeep" />
        ))}
        <li className="sr-only">Cargando las señales de {nombre}</li>
      </ul>
    );
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line bg-paper p-5 text-center">
          <ListFilter size={18} className="mx-auto text-mute" aria-hidden />
          <p className="mt-2 text-sm font-medium text-ink">Todavía no hay contratos con señal en {nombre}</p>
          <p className="mx-auto mt-1 max-w-[42ch] text-[12px] leading-relaxed text-mute">
            Una señal aparece cuando un contrato de la zona termina de leerse y su dictamen trae un riesgo medio o alto,
            con la norma citada.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-mute">
            <strong className="font-semibold text-ink">{total.toLocaleString("es-PE")}</strong>{" "}
            {total === 1 ? "contrato con señal" : "contratos con señal"} en {nombre}
            {total > rows.length ? `; se muestran los ${rows.length} de puntaje más alto` : ""}.
          </p>
          <ul className="space-y-1.5">
            {rows.map((a) => (
              <FilaSenal key={a.id ?? a.codigo} a={a} />
            ))}
          </ul>
        </>
      )}

      {bajas.length > 0 && (
        <details className="rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-mute">
          <summary className="cursor-pointer select-none font-medium text-inkSoft hover:text-ink">
            {bajas.length.toLocaleString("es-PE")} {bajas.length === 1 ? "contrato leído" : "contratos leídos"} con
            señales de bajo peso
          </summary>
          <p className="mt-1.5 leading-relaxed">
            Tienen alguna bandera, pero su puntaje queda por debajo de 40 y no cuentan como contrato con señal.
          </p>
          <ul className="mt-2 space-y-1.5">
            {bajas.slice(0, limit).map((a) => (
              <FilaSenal key={a.id ?? a.codigo} a={a} />
            ))}
          </ul>
        </details>
      )}

      <p className="text-[11px] leading-relaxed text-mute">
        Señales de riesgo, no acusaciones. Cada una cita la norma y enlaza a la fuente oficial.
      </p>
      <Link href="/app/hallazgos" className="block text-center text-[12px] text-inkSoft hover:text-heroViolet hover:underline">
        Ver todas las señales del país
      </Link>
    </div>
  );
}

function FilaSenal({ a }: { a: any }) {
  const score: number = a.score ?? 0;
  const nivel = nivelDeScore(score);
  const sev = SEVERIDAD[nivel];
  const nBanderas = Array.isArray(a.banderas) ? a.banderas.length : 0;
  return (
    <li>
      <Link
        href={alertaHref(a)}
        className="group flex items-start gap-2.5 rounded-xl border border-line bg-paper p-2.5 transition-colors hover:border-heroViolet/60 hover:bg-paperDeep"
      >
        <span
          className={cn("flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg", CAJA[nivel])}
          title={`Puntaje ${score} de 100`}
        >
          <span className="text-sm font-bold leading-none tabular-nums">{score}</span>
          <span className="mt-0.5 text-[10px] leading-none">de 100</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[12px] font-medium leading-snug text-ink">{a.objeto}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-mute">
            <span className={cn("font-medium", sev.texto)}>{nivel === "baja" ? "Bajo peso" : sev.etiqueta}</span>
            {a.region && <span>{a.region}</span>}
            {a.entidad && a.entidad !== "—" && <span className="line-clamp-1 max-w-[180px]">{a.entidad}</span>}
            {a.montoSoles > 0 && <span className="font-mono text-inkSoft">{formatSoles(a.montoSoles)}</span>}
            {nBanderas > 0 && (
              <span className="text-crimsonTexto">
                {nBanderas} bandera{nBanderas === 1 ? "" : "s"}
              </span>
            )}
          </span>
        </span>
        <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
      </Link>
    </li>
  );
}
