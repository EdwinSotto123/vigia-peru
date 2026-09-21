"use client";

/**
 * Lista completa y paginada de /app/alertas. A diferencia de TopAlertasList (teaser
 * client-side: ordena y recorta un lote fijo ya traído), esta recibe exactamente la
 * página que el server component ya pidió al API (filtrada + paginada server-side) y
 * solo la pinta — mismo patrón que ContratosLista.
 *
 * "use client" es necesario: arma `href` acá mismo (a partir de `query`, datos planos)
 * porque un Server Component no puede pasarle una función como prop a <Paginacion>
 * (Client Component) — solo datos serializables cruzan ese límite. Pasarle `href` ya
 * armado desde page.tsx rompía el build (`next build` fallaba prerenderizando /app/alertas).
 *
 * Cada alerta es su propia tarjeta (rounded-2xl + shadow-card, eleva a shadow-paper en
 * hover) en vez de una fila dentro de una sola superficie dividida — mismo lenguaje de
 * tarjeta que TarjetaAliado/financiar. El objeto usa line-clamp-2 en vez de truncate:
 * a una sola línea quedaba ilegible (mismo problema, y misma corrección, que ya se hizo
 * en ContratosLista.tsx). El círculo de score se colorea según el propio score (reusa
 * severidadColor con los mismos cortes que riesgoDe() en lib/contratos.ts: ≥70/40/<40)
 * en vez de un bg-ink plano — antes el número más importante de la fila no daba ninguna
 * señal de qué tan grave era. Colorea el NÚMERO que muestra, no la peor bandera de la
 * alerta: así el color del círculo nunca contradice el número que trae (dos alertas con
 * "100" en el círculo nunca se ven en colores distintos). El estado (activa/confirmada/
 * descartada/en_revision) ahora se ve como píldora: existía como filtro pero ninguna fila
 * lo mostraba. Cada tarjeta entra con BlurFade (cascada, techo en 840ms) en vez de
 * aparecer toda la lista de golpe — ver el comentario junto al .map() más abajo.
 */

import Link from "next/link";
import { ChevronRight, Inbox, WifiOff } from "lucide-react";
import { formatSoles, severidadColor } from "@/lib/mock-data";
import { BlurFade } from "@/components/magicui/BlurFade";
import { PrefetchLink } from "@/components/PrefetchLink";
import { Paginacion } from "@/components/ui/Paginacion";
import { alertasQueryString, ESTADOS_ALERTA, type AlertasQuery } from "@/lib/alertas-query";
import type { ApiAlerta } from "@/lib/api-client";

interface Props {
  data: ApiAlerta[];
  total: number;
  pagina: number;
  tam: number;
  query: AlertasQuery;
  /** true si el API falló (para distinguir "no se pudo cargar" de "0 resultados con estos filtros"). */
  fallo: boolean;
  pathname?: string;
}

/** Mismos cortes que riesgoDe() en lib/contratos.ts (≥70 alta, 40–69 media, <40 baja) — el
 *  score de una alerta es el mismo concepto 0–100 que el de un contrato, así que reusa el
 *  mismo corte en vez de inventar uno nuevo solo para esta lista. */
function severidadDeScore(score: number): "alta" | "media" | "baja" {
  if (score >= 70) return "alta";
  if (score >= 40) return "media";
  return "baja";
}

/** 'YYYY-MM-DD' → 'd/m/aa' (mismo formato que formatFecha en lib/contratos.ts) — antes
 *  se imprimía la fecha del API tal cual, sin localizar. */
function formatFecha(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y.slice(2)}` : iso;
}

export function AlertasLista({ data, total, pagina, tam, query, fallo, pathname = "/app/alertas" }: Props) {
  const paginas = Math.max(1, Math.ceil(total / tam));
  const hayFiltros = !!(query.region || query.estado || query.scoreMin != null);
  const href = (n: number) => {
    const qs = alertasQueryString({ ...query, pagina: n });
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const pag = (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={total}
      tam={tam}
      navegacion="url"
      href={href}
      onChange={() => {}}
      cargando={false}
      nombre="alertas"
    />
  );

  return (
    <div className="space-y-2">
      {pag}
      {fallo && data.length === 0 ? (
        <Aviso
          icon={<WifiOff size={16} />}
          text="No se pudo cargar la lista de alertas."
          action={
            <a href={href(pagina)} className="font-medium text-heroViolet hover:underline">
              Reintentar
            </a>
          }
        />
      ) : data.length === 0 ? (
        hayFiltros ? (
          <Aviso
            icon={<Inbox size={16} />}
            text="Ninguna alerta coincide con estos filtros."
            action={
              <Link href={pathname} className="font-medium text-heroViolet hover:underline">
                Quitar filtros
              </Link>
            }
          />
        ) : (
          <Aviso icon={<Inbox size={16} />} text="El motor aún no ha detectado alertas. Vuelve pronto." />
        )
      ) : (
        <ul className="space-y-2">
          {data.map((a, i) => {
            const severidad = severidadDeScore(a.score);
            const estado = a.estado ? ESTADOS_ALERTA[a.estado] : null;
            return (
              // 24 tarjetas independientes por página son justo el caso que BlurFade existe
              // para resolver (mismo patrón que los pasos de ComoFuncionaCompacto.tsx):
              // entran en cascada al hacer scroll en vez de aparecer todas de golpe. Stagger
              // acotado: 70ms por fila con techo en 840ms (~fila 12) — sin techo, 70ms × 23
              // tardaría ~1.6s en la última fila y se sentiría lento, no "vivo".
              <BlurFade key={a.id} as="li" delayMs={Math.min(i * 70, 840)}>
                <PrefetchLink
                  href={`/app/convocatoria/${a.codigoconvocatoria}`}
                  ocid={String(a.codigoconvocatoria)}
                  className="group flex items-start gap-3 rounded-2xl border border-line bg-paper p-4 shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper sm:items-center sm:gap-4"
                >
                  <div className={"flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl border font-mono " + severidadColor(severidad)}>
                    <span className="text-xl font-bold leading-none">{a.score}</span>
                    <span className="text-[9px] uppercase tracking-wider opacity-70">score</span>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[10.5px] tabular-nums text-mute">
                      <span>{a.region}</span>
                      <span aria-hidden>·</span>
                      <span>{a.codigoconvocatoria}</span>
                    </div>
                    <h3 className="mt-1 line-clamp-2 text-[14.5px] font-semibold leading-snug text-ink">
                      {a.objeto}
                    </h3>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {estado && <span className={"pill " + estado.cls}>{estado.label}</span>}
                      {a.banderas.slice(0, 3).map((b, i) => (
                        <span
                          key={`${b.regla}-${i}`}
                          className={"pill border " + severidadColor(b.severidad)}
                        >
                          {b.regla.replaceAll("_", " ")}
                        </span>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-3 text-[12px] text-mute sm:hidden">
                      <span className="font-mono font-semibold text-ink">{formatSoles(a.montoSoles)}</span>
                      <span>{formatFecha(a.fechaBuenaPro)}</span>
                    </div>
                  </div>

                  <div className="hidden shrink-0 flex-col items-end gap-1 text-right sm:flex">
                    <span className="font-mono text-[15px] font-semibold tabular-nums text-ink">
                      {formatSoles(a.montoSoles)}
                    </span>
                    <span className="text-[11px] text-mute">{formatFecha(a.fechaBuenaPro)}</span>
                  </div>
                  <ChevronRight
                    size={18}
                    className="hidden shrink-0 self-center text-mute transition-transform duration-200 group-hover:translate-x-0.5 sm:block"
                  />
                </PrefetchLink>
              </BlurFade>
            );
          })}
        </ul>
      )}
      {data.length > 10 && pag}
    </div>
  );
}

function Aviso({ icon, text, action }: { icon: React.ReactNode; text: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-line bg-paperSoft/60 px-6 py-12 text-center text-sm text-mute">
      <span className="text-mute" aria-hidden>{icon}</span>
      <p>{text}</p>
      {action}
    </div>
  );
}
