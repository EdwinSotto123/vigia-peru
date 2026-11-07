"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn } from "@/lib/gobserva";
import { cargarSeguimiento, type ClavePlazo } from "@/lib/gobserva-cuenta";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";
import type { Seccion } from "./Cuenta";
import { Aviso, Esqueleto } from "./comun";
import { ABIERTOS, cuando, diaLima, eventos, fechaHora, rutaItem, type Evento } from "./plazos";

/** Cómo se marca cada plazo: el cierre de una cotización es lo más urgente; la buena pro, un resultado. */
const TONO: Record<ClavePlazo, string> = {
  cierre: "bg-crimson-soft text-crimsonTexto",
  consultas: "bg-amber-soft text-amberTexto",
  buena_pro: "bg-moss/15 text-mossTexto",
  convocatoria: "bg-paperDeep text-inkSoft",
};
const PUNTO: Record<ClavePlazo, string> = { cierre: "bg-crimson", consultas: "bg-amber", buena_pro: "bg-moss", convocatoria: "bg-mute" };
const CORTO: Record<ClavePlazo, string> = { cierre: "Cierra", consultas: "Consultas", buena_pro: "Buena pro", convocatoria: "Convocatoria" };
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/**
 * Calendario (2026-11-07, el de LicitaLAB y Govly): los plazos de lo que sigues en un mes (el fin de consultas, el
 * cierre de una cotización, la buena pro), el día elegido con su lista y los próximos 30 días; todo se descarga como
 * .ics para Google Calendar, Outlook o el calendario del celular, con un aviso un día antes.
 */
export function PanelCalendario({ base, irA }: { base: string; irA: (t: Seccion) => void }) {
  const { data, error, isLoading } = useSWR(["gobserva-seguimiento"], () => cargarSeguimiento());
  const hoy = diaLima(new Date());
  const [mes, setMes] = useState(() => hoy.slice(0, 7));
  const [dia, setDia] = useState<string>(hoy);

  const todos = useMemo(() => eventos((data?.data ?? []).filter((i) => ABIERTOS.has(i.estado) || i.estado === "presentada")), [data]);
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>();
    for (const e of todos) {
      const d = diaLima(e.plazo.fecha);
      m.set(d, [...(m.get(d) ?? []), e]);
    }
    return m;
  }, [todos]);
  const proximos = todos.filter((e) => {
    const c = cuando(e.plazo.fecha);
    return !c.paso && new Date(e.plazo.fecha).getTime() - Date.now() <= 30 * 86_400_000;
  });

  if (isLoading) return <Esqueleto className="h-[32rem]" />;
  if (error) return <Aviso tono="error">No pudimos cargar tus plazos. Vuelve a intentarlo en un momento.</Aviso>;
  if (!data?.data.length) {
    return (
      <div className="flex flex-col items-start gap-4 rounded-2xl border border-dashed border-line p-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex max-w-[60ch] items-start gap-3 text-dato leading-relaxed text-inkSoft">
          <CalendarDays size={22} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          Aquí verás los plazos de lo que sigues: el fin de consultas, el cierre de cada cotización y la buena pro. Empieza guardando una licitación o un
          contrato menor.
        </p>
        <Link href={rutaEn(base, "/cuenta?tab=para-ti")} className={claseAccion("primario", "shrink-0")}>Ver «Para ti»</Link>
      </div>
    );
  }

  const celdas = celdasDelMes(mes);
  const delDia = porDia.get(dia) ?? [];
  const tituloMes = new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-01T12:00:00Z`));

  return (
    <div className="space-y-8">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="mes-t" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setMes(sumarMes(mes, -1))} aria-label="Mes anterior" className="grid h-10 w-10 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-ink">
                <ChevronLeft size={18} aria-hidden />
              </button>
              <h2 id="mes-t" aria-live="polite" className="min-w-[10rem] text-center font-display text-bloque font-bold capitalize text-ink">{tituloMes}</h2>
              <button type="button" onClick={() => setMes(sumarMes(mes, 1))} aria-label="Mes siguiente" className="grid h-10 w-10 place-items-center rounded-full text-inkSoft hover:bg-paperSoft hover:text-ink">
                <ChevronRight size={18} aria-hidden />
              </button>
              {mes !== hoy.slice(0, 7) && (
                <button type="button" onClick={() => { setMes(hoy.slice(0, 7)); setDia(hoy); }} className={claseAccion("fantasma", "min-h-10 px-3")}>Hoy</button>
              )}
            </div>
            <button type="button" onClick={() => descargarIcs(todos, base)} disabled={!todos.length} className={claseAccion("secundario")}>
              <CalendarPlus size={16} aria-hidden /> Añadir a mi calendario
            </button>
          </div>

          <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-paper">
            <div className="grid grid-cols-7 border-b border-line bg-paperSoft">
              {DIAS.map((d) => <p key={d} className="py-2 text-center text-rotulo font-semibold capitalize text-mute">{d}</p>)}
            </div>
            <div className="grid grid-cols-7">
              {celdas.map((c) => {
                const evs = porDia.get(c.dia) ?? [];
                const elegido = c.dia === dia;
                return (
                  <button
                    key={c.dia}
                    type="button"
                    onClick={() => setDia(c.dia)}
                    aria-pressed={elegido}
                    aria-label={`${fechaHora(`${c.dia}T12:00:00-05:00`)}${evs.length ? `, ${evs.length} ${evs.length === 1 ? "plazo" : "plazos"}` : ""}`}
                    className={cn(
                      "flex min-h-16 flex-col items-stretch gap-1 border-b border-r border-line p-1.5 text-left transition-colors duration-rapido [&:nth-child(7n)]:border-r-0 sm:min-h-24",
                      !c.delMes && "bg-paperSoft/60 text-mute",
                      elegido ? "bg-granate-50" : "hover:bg-paperSoft",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-7 w-7 place-items-center rounded-full text-meta font-semibold tabular-nums",
                        c.dia === hoy ? "bg-granate text-paper" : c.delMes ? "text-ink" : "text-mute",
                      )}
                    >
                      {Number(c.dia.slice(8))}
                    </span>
                    {/* En el celular, puntos; desde sm, los plazos con su nombre corto. */}
                    {evs.length > 0 && (
                      <>
                        <span className="flex flex-wrap gap-1 px-1 sm:hidden">
                          {evs.slice(0, 3).map((e) => <span key={`${e.item.ref}-${e.plazo.clave}`} className={cn("h-1.5 w-1.5 rounded-full", PUNTO[e.plazo.clave])} />)}
                        </span>
                        <span className="hidden flex-col gap-1 sm:flex">
                          {/* recorte: dos por día; el resto se cuenta («+N») y se ve al elegir el día. */}
                          {evs.slice(0, 2).map((e) => (
                            <span key={`${e.item.ref}-${e.plazo.clave}`} className={cn("truncate rounded-md px-1.5 py-0.5 text-rotulo font-semibold", TONO[e.plazo.clave])}>
                              {CORTO[e.plazo.clave]}: {e.item.titulo}
                            </span>
                          ))}
                          {evs.length > 2 && <span className="px-1.5 text-rotulo font-semibold text-inkSoft">+{evs.length - 2} más</span>}
                        </span>
                      </>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft" aria-label="Leyenda">
            {(["cierre", "consultas", "buena_pro"] as const).map((k) => (
              <li key={k} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("h-2 w-2 rounded-full", PUNTO[k])} /> {k === "cierre" ? "Cierre de cotización" : k === "consultas" ? "Fin de consultas" : "Buena pro"}
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="dia-t" className="min-w-0">
          <h2 id="dia-t" className="font-display text-bloque font-bold capitalize leading-tight text-ink">{fechaHora(`${dia}T12:00:00-05:00`)}</h2>
          {delDia.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-dashed border-line p-4 text-dato text-inkSoft">Ningún plazo este día.</p>
          ) : (
            <ListaEventos evs={delDia} base={base} />
          )}
        </section>
      </div>

      <section aria-labelledby="prox-t">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h2 id="prox-t" className="font-display text-bloque font-bold leading-tight text-ink">Próximos 30 días</h2>
          <button type="button" onClick={() => irA("seguimiento")} className="inline-flex min-h-11 items-center text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Ver el tablero
          </button>
        </div>
        {proximos.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-dashed border-line p-4 text-dato text-inkSoft">Lo que sigues no tiene plazos en los próximos 30 días.</p>
        ) : (
          <ListaEventos evs={proximos} base={base} conDia />
        )}
        <p className="mt-3 text-meta leading-relaxed text-mute">
          La presentación de ofertas no viene en los datos abiertos del OECE: está en el cronograma del SEACE, enlazado en cada ficha. «Añadir a mi
          calendario» baja un archivo .ics con un aviso un día antes de cada plazo.
        </p>
      </section>
    </div>
  );
}

function ListaEventos({ evs, base, conDia = false }: { evs: Evento[]; base: string; conDia?: boolean }) {
  return (
    <ol className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
      {evs.map(({ item, plazo }) => {
        const c = cuando(plazo.fecha);
        return (
          <li key={`${item.tipo}-${item.ref}-${plazo.clave}`}>
            <Link href={rutaEn(base, rutaItem(item))} className="flex gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-paperSoft">
              <span aria-hidden className={cn("mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full", PUNTO[plazo.clave])} />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-meta font-semibold text-inkSoft">
                    {plazo.etiqueta}
                    {conDia ? `, ${fechaHora(plazo.fecha)}` : fechaHora(plazo.fecha).includes(",") ? `, ${fechaHora(plazo.fecha).split(", ")[1]}` : ""}
                  </span>
                  <span className={cn("text-meta font-bold", c.urgente ? "text-crimsonTexto" : c.paso ? "text-mute" : "text-ink")}>{c.texto}</span>
                </span>
                <span className="mt-0.5 line-clamp-2 block text-dato font-semibold leading-snug text-ink">{item.titulo || "Sin descripción registrada"}</span>
                {item.entidad && <span className="mt-0.5 block truncate text-meta text-inkSoft">{tituloNatural(item.entidad)}</span>}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

/** Las celdas del mes (YYYY-MM): de lunes a domingo, con los días del mes anterior y el siguiente para completar. */
function celdasDelMes(mes: string): { dia: string; delMes: boolean }[] {
  const primero = new Date(`${mes}-01T12:00:00Z`);
  const desplazamiento = (primero.getUTCDay() + 6) % 7;
  const inicio = new Date(primero.getTime() - desplazamiento * 86_400_000);
  const ultimo = new Date(Date.UTC(primero.getUTCFullYear(), primero.getUTCMonth() + 1, 0, 12));
  const total = Math.ceil((desplazamiento + ultimo.getUTCDate()) / 7) * 7;
  return Array.from({ length: total }, (_, k) => {
    const d = new Date(inicio.getTime() + k * 86_400_000).toISOString().slice(0, 10);
    return { dia: d, delMes: d.startsWith(mes) };
  });
}

function sumarMes(mes: string, n: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** El .ics de los plazos que vienen (con un aviso un día antes), para Google Calendar, Outlook o el celular. */
function descargarIcs(evs: Evento[], base: string) {
  const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/[;,]/g, (x) => `\\${x}`).replace(/\r?\n/g, "\\n");
  const ahora = utc(new Date().toISOString());
  const futuros = evs.filter((e) => new Date(e.plazo.fecha).getTime() > Date.now() - 86_400_000);
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Gobserva//Licitaciones//ES",
    "CALSCALE:GREGORIAN",
    "X-WR-CALNAME:Gobserva Licitaciones",
    ...futuros.flatMap(({ item, plazo }) => {
      const url = `${window.location.origin}${rutaEn(base, rutaItem(item))}`;
      const inicio = utc(plazo.fecha);
      const fin = utc(new Date(new Date(plazo.fecha).getTime() + 30 * 60_000).toISOString());
      return [
        "BEGIN:VEVENT",
        `UID:${item.tipo}-${item.ref}-${plazo.clave}@gobserva.cloud`.replace(/[^\w@.-]/g, "-"),
        `DTSTAMP:${ahora}`,
        `DTSTART:${inicio}`,
        `DTEND:${fin}`,
        `SUMMARY:${esc(`${CORTO[plazo.clave]}: ${item.titulo ?? "Proceso guardado"}`)}`,
        `DESCRIPTION:${esc(`${plazo.etiqueta}. ${item.entidad ? `${tituloNatural(item.entidad)}. ` : ""}${url}`)}`,
        `URL:${url}`,
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-P1D",
        `DESCRIPTION:${esc(`Mañana: ${plazo.etiqueta.toLowerCase()}`)}`,
        "END:VALARM",
        "END:VEVENT",
      ];
    }),
    "END:VCALENDAR",
  ];
  const blob = new Blob([lineas.join("\r\n")], { type: "text/calendar;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "gobserva-plazos.ics";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
