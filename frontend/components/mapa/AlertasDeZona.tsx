"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { getAlertas } from "@/lib/api-client";
import { formatSoles, plural } from "@/lib/formato";
import { nivelDeScore, type NivelSeveridad } from "@/lib/severidad";
import { Ayuda, EstadoVacio } from "@/components/patrones";
import { Skeleton } from "@/components/ui/Skeleton";
import { PesoRiesgo } from "@/components/contratos/PesoRiesgo";
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
 * Contratos de riesgo medio o alto de un departamento. Si el padre ya trajo las
 * alertas completas las reutiliza; `null` es "cargando" y sólo `undefined` hace
 * que las pida (el mapa ya no las baja al entrar: pinta con `/alertas/puntos`).
 *
 * Las filas salen de `/alertas?limit=200`, que viene ordenada por puntaje: alcanza
 * para mostrar las de mayor peso, NO para contarlas. Por eso los totales llegan en
 * `conteos`, calculados por el mapa sobre TODAS las alertas publicadas; sin ellos
 * (COMPAT-API-VIEJA) se cuenta sobre las filas, como antes.
 *
 * Lista primero los de peso del riesgo medio o alto (`esSenal`, ≥ 40). Los que
 * tienen señales de riesgo bajo van aparte y plegados, con su nombre; los leídos
 * sin ninguna señal no aparecen. Cada fila dice su peso con color + ícono +
 * palabra y cuántas señales lo explican (DESIGN_SYSTEM.md §10.4).
 */
export function AlertasDeZona({
  ubigeo,
  nombre,
  alertas,
  conteos,
  limit = 20,
}: {
  /** Ubigeo de departamento (2 dígitos). */
  ubigeo: string;
  nombre: string;
  /** Alertas ya cargadas por el padre. `null` = cargando; `undefined` = pedirlas acá. */
  alertas?: any[] | null;
  /** Cuántas hay en la zona, contadas sobre todas las publicadas (de riesgo medio o alto, y de bajo peso). */
  conteos?: { senales: number; bajas: number } | null;
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
    // El conteo sale del ubigeo del contrato y las filas del nombre de su provincia: si alguna
    // vez difieren, nunca se dice un total menor que las filas que se ven.
    return { rows: senales.slice(0, limit), total: Math.max(conteos?.senales ?? 0, senales.length), bajas };
  }, [source, ubigeo, limit, conteos]);
  // Las de bajo peso: el conteo total si se conoce; si no, las filas que llegaron.
  const nBajas = Math.max(conteos?.bajas ?? 0, bajas.length);

  if (rows === null) {
    return (
      <div className="space-y-2" role="status" aria-busy>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
        <span className="sr-only">Cargando las señales de {nombre}…</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rows.length === 0 && total === 0 ? (
        <EstadoVacio compacto titulo={`Todavía no hay contratos de riesgo medio o alto en ${nombre}`}>
          Aparecen cuando un contrato de la zona termina de leerse y sus señales suman ese peso.
        </EstadoVacio>
      ) : rows.length === 0 ? (
        // Las hay, pero ninguna entre las de mayor puntaje del país que trae la lista: se dice el número, no un vacío.
        <p className="text-[12px] tabular-nums text-inkSoft">
          <strong className="font-semibold text-ink">{plural(total, "contrato", "contratos")}</strong> de riesgo medio o
          alto; su detalle está en el índice de señales.
        </p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-x-1 text-[12px] tabular-nums text-inkSoft">
            <span>
              <strong className="font-semibold text-ink">{plural(total, "contrato", "contratos")}</strong> de riesgo medio
              o alto{total > rows.length ? `; los ${rows.length} de mayor peso` : ""}
            </span>
            {/* Lo que antes era una nota al pie abierta, a un clic (§10.7). */}
            <Ayuda titulo="¿Qué es una señal de riesgo?">
              Un indicio, no una acusación. Cada una cita la norma y enlaza a la fuente oficial.
            </Ayuda>
          </p>
          <ul className="space-y-1.5">
            {rows.map((a) => (
              <FilaSenal key={a.id ?? a.codigo} a={a} />
            ))}
          </ul>
        </>
      )}

      {nBajas > 0 && (
        <details className="rounded-xl border border-line bg-paper px-3 py-2 text-[12px] text-mute">
          <summary className="min-h-[24px] cursor-pointer select-none font-medium text-inkSoft hover:text-ink">
            {plural(nBajas, "contrato", "contratos")} con señales de riesgo bajo
          </summary>
          <p className="mt-1.5 leading-relaxed">
            Tienen señales publicadas, pero su peso del riesgo suma menos de 40.
          </p>
          {bajas.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {bajas.slice(0, limit).map((a) => (
                <FilaSenal key={a.id ?? a.codigo} a={a} />
              ))}
            </ul>
          )}
        </details>
      )}

      <Link href="/app/hallazgos" className="inline-flex min-h-[24px] items-center text-[12px] font-medium text-granate underline-offset-2 hover:underline">
        Ver todas las señales del país
      </Link>
    </div>
  );
}

function FilaSenal({ a }: { a: any }) {
  const score: number = a.score ?? 0;
  const nivel = nivelDeScore(score);
  const nBanderas = Array.isArray(a.banderas) ? a.banderas.length : 0;
  return (
    <li>
      <Link
        href={alertaHref(a)}
        className="group flex items-start gap-2.5 rounded-xl border border-line bg-paper p-2.5 transition-colors duration-rapido hover:border-granate/40 hover:bg-paperSoft"
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
            <PesoRiesgo score={score} banderas={nBanderas} className="text-[11px]" />
            {nBanderas > 0 && <span className="tabular-nums text-inkSoft">{plural(nBanderas, "señal", "señales")}</span>}
            {a.region && <span>{a.region}</span>}
            {a.entidad && a.entidad !== "—" && <span className="line-clamp-1 max-w-[180px]">{a.entidad}</span>}
            {a.montoSoles > 0 && <span className="font-mono tabular-nums text-inkSoft">{formatSoles(a.montoSoles)}</span>}
          </span>
        </span>
        <ArrowUpRight size={13} className="mt-1 shrink-0 text-mute transition-colors duration-rapido group-hover:text-granate" aria-hidden />
      </Link>
    </li>
  );
}
