"use client";

/**
 * Lo que va arriba del Tablero (DESIGN_SYSTEM.md §14): las cuatro cifras en `Indicadores`,
 * con la barra del avance en su pie (cada cifra lleva el punto de su tramo), y UNA línea de
 * "ahora". Nada más: los análisis por día y la cola de descarga viven en la pestaña
 * Actividad. La barra antes era una tarjeta aparte en Actividad que repetía estas mismas
 * tres cifras; en el pie se lee junto a ellas y no se repite nada. Sin enlace a ella
 * desde esta línea: la barra de pestañas está dos filas más abajo (un botón por destino).
 *
 * La línea no repite lo que dicen las cifras ("en espera" ya es una) ni la pestaña
 * Actividad (la descarga de documentos): dice lo que se lee ahora y cuándo terminó la
 * última lectura. El punto pulsante sólo aparece cuando hay algo en análisis.
 *
 * Lee el resumen de `ResumenAuditoria` (un solo sondeo para toda la página).
 */

import { WifiOff } from "lucide-react";
import { fechaLima, haceCuanto } from "@/lib/auditoria";
import { Indicadores, IndicadoresSkeleton, type Indicador } from "@/components/listado";
import { Ayuda } from "@/components/patrones";
import { PulseDot } from "@/components/ui/PulseDot";
import { numero, plural, porcentaje } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { composicionEspera, cuentasAuditoria, type CuentasAuditoria } from "./cuentasAuditoria";
import { DIAS_RITMO, useResumenAuditoria } from "./ResumenAuditoria";

export function EstadoAuditoria({
  alcance = "en todo el Perú",
}: {
  /** Alcance de las cifras, dicho en voz alta. El resumen es global. */
  alcance?: string;
}) {
  const { data, fallo, ahora, ritmo, ultimoFin } = useResumenAuditoria();

  if (!data) {
    return fallo ? (
      <p className="inline-flex items-center gap-1.5 rounded-xl bg-crimson-soft/60 px-3 py-2 text-[13px] text-crimsonTexto">
        <WifiOff size={13} aria-hidden /> No pudimos leer el estado de la auditoría; se vuelve a intentar solo.
      </p>
    ) : (
      <IndicadoresSkeleton n={4} />
    );
  }

  const c = cuentasAuditoria(data);
  const hoy = ritmo?.[ritmo.length - 1]?.n ?? data.procesadosHoy ?? 0;
  const totalRitmo = ritmo ? ritmo.reduce((s, d) => s + d.n, 0) : null;

  const items: Indicador[] = [
    {
      valor: numero(c.publicados),
      etiqueta: "con dictamen publicado",
      marca: "bg-moss",
      contexto: `de ${numero(c.financiados)} financiados`,
      ayuda: (
        <Ayuda titulo="¿Cómo se cuenta?">
          <span className="block">
            Todos los contratos financiados {alcance}, aunque filtres por zona. Los días se cuentan en hora de Lima.
          </span>
          <span className="mt-2 block text-mute">
            Un contrato en revisión ya se leyó, pero su dictamen no está publicado: cuenta como leído, no como señal.
          </span>
        </Ayuda>
      ),
    },
    {
      valor: numero(c.enRevision),
      etiqueta: "financiados en revisión",
      marca: "bg-clay",
      contexto: `de ${numero(c.leidos)} leídos`,
      // La lista de esos mismos contratos, con el motivo de cada uno.
      href: "/app/hallazgos?vista=revision",
    },
    { valor: numero(c.enEspera), etiqueta: "financiados en espera", marca: "bg-mute", contexto: composicionEspera(c) },
    {
      valor: numero(hoy),
      etiqueta: hoy === 1 ? "leído hoy" : "leídos hoy",
      contexto: totalRitmo != null ? `${numero(totalRitmo)} en ${DIAS_RITMO} días` : undefined,
    },
  ];

  return (
    <section aria-label="Estado de la auditoría" className="space-y-2.5">
      {c.financiados === 0 ? (
        <p className="text-[13px] text-mute">Todavía no hay ningún contrato financiado {alcance}.</p>
      ) : (
        <Indicadores items={items} pie={<Avance c={c} />} />
      )}

      {/* Ahora: una línea. Lo que ya dicen las cifras no se repite. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl bg-paperSoft px-3 py-2 text-[13px] text-inkSoft">
        <span className="inline-flex items-center gap-1.5 font-semibold text-ink">
          {c.procesando > 0 ? <PulseDot color="amber" size={7} /> : <span className="h-[7px] w-[7px] rounded-full bg-paperEdge" aria-hidden />}
          Ahora
        </span>
        {fallo ? (
          <span className="inline-flex items-center gap-1 text-crimsonTexto">
            <WifiOff size={12} aria-hidden /> Sin conexión con el servicio; reintentando…
          </span>
        ) : (
          <>
            <span className={c.procesando > 0 ? "font-medium text-amberTexto" : undefined}>
              {c.procesando > 0 ? plural(c.procesando, "contrato en análisis", "contratos en análisis") : "ningún contrato en análisis"}
            </span>
            <UltimaLectura ultimoFin={ultimoFin} ahora={ahora} />
          </>
        )}
      </div>
    </section>
  );
}

/**
 * El avance de todo lo financiado, en una barra: los mismos grupos que las cifras de arriba
 * (publicado · en revisión · en análisis · en espera), del más avanzado al que falta, así
 * que lo verde es lo ya terminado. La barra es decorativa para el lector de pantalla: las
 * cifras están arriba y el porcentaje, al lado, en texto.
 */
function Avance({ c }: { c: CuentasAuditoria }) {
  const tramos = [
    { clave: "publicado", n: c.publicados, color: "bg-moss", label: "con dictamen publicado" },
    { clave: "revision", n: c.enRevision, color: "bg-clay", label: "en revisión" },
    { clave: "analisis", n: c.procesando, color: "bg-amber", label: "en análisis" },
    { clave: "espera", n: c.enEspera, color: "bg-mute", label: "en espera" },
  ].filter((t) => t.n > 0);
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      <span className="inline-flex shrink-0 items-center gap-1 text-mute">
        Avance
        <Ayuda titulo="¿Qué es cada etapa?" ancho="w-[22rem]">
          {c.tramos.map((t, i) => (
            <span key={t.clave} className={cn("block", i > 0 && "mt-1.5")}>
              <span className="font-semibold text-ink">{t.label.charAt(0).toUpperCase() + t.label.slice(1)}:</span> {t.titulo}
            </span>
          ))}
        </Ayuda>
      </span>
      <span className="flex h-2.5 min-w-0 flex-1 gap-[2px] overflow-hidden rounded-full bg-paperDeep" aria-hidden>
        {tramos.map((t) => (
          <span
            key={t.clave}
            className={cn(t.color, "h-full transition-[flex-grow] duration-500")}
            style={{ flexGrow: t.n, flexBasis: 0, minWidth: 4 }}
            title={`${numero(t.n)} ${t.label}`}
          />
        ))}
      </span>
      <span className="shrink-0 font-semibold tabular-nums text-mossTexto">
        {porcentaje((c.publicados / Math.max(1, c.financiados)) * 100)} publicado
      </span>
    </div>
  );
}

/** "última lectura hace 21 h" (la fecha exacta, en `title`). Antes de montar, la fecha: sin relativo en el HTML del servidor. */
function UltimaLectura({ ultimoFin, ahora }: { ultimoFin: number | null; ahora: number }) {
  if (ultimoFin == null) return <span>ningún análisis terminado todavía</span>;
  const exacta = fechaLima(ultimoFin, { hora: true });
  return (
    <span title={`${exacta}, hora de Lima`} suppressHydrationWarning>
      última lectura {ahora > 0 ? haceCuanto(ahora - ultimoFin) : `el ${exacta}`}
    </span>
  );
}
