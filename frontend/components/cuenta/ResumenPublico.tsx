"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Check, Minus } from "lucide-react";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { clasificar, type FilaRanking } from "@/components/aliados/ranking";
import { getEstadoGlobal, getRankingPaginado, getRecientes, type ContribucionReciente, type EstadoGlobal } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

/**
 * Lo público que se ve SIN cuenta, con datos reales de la API: sirve para que las pantallas que piden
 * sesión (Mi impacto, Configuración) no queden vacías y para que quien aún no entra vea qué hicieron los demás.
 * Cada bloque se calla si su lectura falla: nada se rellena con datos de ejemplo.
 */

function useLectura<T>(leer: () => Promise<T | null>): T | null {
  const [valor, setValor] = useState<T | null>(null);
  useEffect(() => {
    let vivo = true;
    void leer().then((v) => vivo && setValor(v));
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return valor;
}

/** Cuatro cifras del país, en una franja: lo que ya se financió y se leyó entre todos. */
export function CifrasDelPais({ titulo = "Lo que ya se hizo entre todos" }: { titulo?: string }) {
  const e = useLectura<EstadoGlobal>(getEstadoGlobal);
  if (!e) return null;
  return (
    <section aria-label={titulo} className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
      <h2 className="font-display text-bloque font-bold text-ink">{titulo}</h2>
      <CifrasEnFila
        className="mt-2.5"
        items={[
          { valor: numero(e.contratosFinanciados), etiqueta: "contratos financiados", contexto: `por ${numero(e.financiadores)} ${e.financiadores === 1 ? "aliado" : "aliados"}` },
          { valor: numero(e.contratosProcesados), etiqueta: "ya leídos", contexto: "con su dictamen" },
          { valor: numero(e.senalesHalladas), etiqueta: "señales halladas", contexto: "para revisar" },
          { valor: numero(e.regionesConAuditoria), etiqueta: "regiones", contexto: "con lectura" },
        ]}
      />
    </section>
  );
}

/** Los últimos aportes confirmados, contados en contratos y con su comprobante público. */
export function RecientesDelPais({ cuantos = 6, titulo = "Lo que ya financiaron los aliados" }: { cuantos?: number; titulo?: string }) {
  const r = useLectura<ContribucionReciente[]>(getRecientes);
  if (!r || r.length === 0) return null;
  return (
    <section aria-label={titulo} className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="font-display text-bloque font-bold text-ink">{titulo}</h2>
        {/* Los más recientes; la lista entera, con buscador, en /app/aliados/aportes. */}
        <Link href="/app/aliados/aportes" className="text-meta font-semibold text-granate underline-offset-4 hover:underline">
          Ver todos los aportes
        </Link>
      </div>
      <RecientesFeed items={r.slice(0, cuantos)} />
    </section>
  );
}

/** El ranking de aliados, en cinco filas: cómo se ve quien aparece con nombre. */
export function AliadosDelPais({ cuantos = 5 }: { cuantos?: number }) {
  const filas = useLectura<FilaRanking[]>(() => getRankingPaginado({ periodo: "todo", limit: 12 }).then((p) => (p ? clasificar(p.data ?? []).slice(0, cuantos) : null)));
  if (!filas || filas.length === 0) return null;
  const max = Math.max(1, ...filas.map((f) => f.meses ?? 0));
  return (
    <section aria-labelledby="aliados-pais" className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 id="aliados-pais" className="font-display text-bloque font-bold text-ink">Así aparecen los aliados</h2>
        <Link href="/app/aliados" className="text-meta font-semibold text-granate underline-offset-4 hover:underline">Ver el podio</Link>
      </div>
      <ol className="mt-2 space-y-2">
        {filas.map((f) => (
          <li key={f.id} className="flex items-center gap-2.5">
            <span aria-hidden className="w-5 shrink-0 text-center font-mono text-meta font-bold tabular-nums text-mute">{f.puesto}</span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-dato font-semibold text-ink">{f.nombre}</span>
                <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-ink">
                  {numero(f.meses ?? 0)} {f.meses === 1 ? "mes" : "meses"}
                </span>
              </span>
              <span aria-hidden className="mt-1 block h-1.5 overflow-hidden rounded-full bg-paperDeep">
                <span className="block h-full rounded-full bg-granate" style={{ width: `${Math.max(3, ((f.meses ?? 0) / max) * 100)}%` }} />
              </span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2.5 text-meta leading-snug text-mute">Se cuentan los meses que sostienen la vigilancia, nunca los soles. Con cuenta eliges cómo apareces.</p>
    </section>
  );
}

const FILAS_CUENTA: { que: string; sin: string | null; con: string }[] = [
  { que: "Ver el mapa, los contratos y las señales", sin: "Sí", con: "Sí" },
  { que: "Apoyar la vigilancia", sin: "Como invitado, con tu código VIG", con: "Con tus aportes reunidos y su progreso" },
  { que: "Denunciar una obra", sin: "Sin tu nombre", con: "Sin tu nombre, y ves el estado de las tuyas" },
  { que: "Seguir zonas y entidades", sin: null, con: "Con avisos de lo nuevo" },
  { que: "Aparecer en el ranking de aliados", sin: null, con: "Con tu perfil público, o como anónimo" },
];

/** Qué cambia con una cuenta, fila por fila, en las palabras de la propia plataforma. */
export function SinCuentaConCuenta() {
  return (
    <section aria-labelledby="sin-con-cuenta" className="rounded-2xl border border-line bg-paper px-4 py-3.5 sm:px-5">
      <h2 id="sin-con-cuenta" className="font-display text-bloque font-bold text-ink">Qué cambia con una cuenta</h2>
      <ul className="mt-2 divide-y divide-line sm:hidden">
        {FILAS_CUENTA.map((f) => (
          <li key={f.que} className="py-2 text-dato leading-snug">
            <p className="font-medium text-ink">{f.que}</p>
            <p className="mt-0.5 text-inkSoft"><span className="font-semibold text-mute">Sin cuenta:</span> {f.sin ?? "no"}</p>
            <p className="text-ink"><span className="font-semibold text-mossTexto">Con cuenta:</span> {f.con}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-dato">
          <thead>
            <tr className="text-rotulo uppercase tracking-wide text-mute">
              <th scope="col" className="py-1.5 pr-3 font-semibold">Qué haces</th>
              <th scope="col" className="px-3 py-1.5 font-semibold">Sin cuenta</th>
              <th scope="col" className="py-1.5 pl-3 font-semibold">Con cuenta</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {FILAS_CUENTA.map((f) => (
              <tr key={f.que}>
                <th scope="row" className="py-2 pr-3 align-top font-medium text-ink">{f.que}</th>
                <td className="px-3 py-2 align-top text-inkSoft">
                  {f.sin ? f.sin : <span className="inline-flex items-center gap-1 text-mute"><Minus size={13} aria-hidden /> No</span>}
                </td>
                <td className="py-2 pl-3 align-top text-ink">
                  <span className="inline-flex items-start gap-1.5"><Check size={14} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />{f.con}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
