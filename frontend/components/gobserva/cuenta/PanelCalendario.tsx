"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, APP_EN_CONSTRUCCION } from "@/lib/gobserva";
import { cargarSeguimiento, claveSeguimiento, type ClavePlazo, type ProductoSeguido } from "@/lib/gobserva-cuenta";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";
import type { Seccion } from "./Cuenta";
import { Aviso, Esqueleto } from "./comun";
import { ABIERTOS, cuando, diaLima, eventos, fechaHora, rutaItem, type Evento } from "./plazos";
import { CLASE_ENLACE_PIE, Caja, VacioCaja } from "../app/Caja";

/** Cómo se marca cada plazo: el cierre de una cotización es lo más urgente; la buena pro, un resultado. */
const TONO: Record<ClavePlazo, string> = {
  cierre: "bg-crimson-soft text-crimsonTexto",
  consultas: "bg-amber-soft text-amberTexto",
  buena_pro: "bg-moss/15 text-mossTexto",
  convocatoria: "bg-paperDeep text-inkSoft",
  abre: "bg-paperDeep text-inkSoft",
  postulacion: "bg-crimson-soft text-crimsonTexto",
};
const PUNTO: Record<ClavePlazo, string> = { cierre: "bg-crimson", consultas: "bg-amber", buena_pro: "bg-moss", convocatoria: "bg-mute", abre: "bg-mute", postulacion: "bg-crimson" };
const CORTO: Record<ClavePlazo, string> = { cierre: "Cierra", consultas: "Consultas", buena_pro: "Buena pro", convocatoria: "Convocatoria", abre: "Abre", postulacion: "Cierra" };
const DIAS = ["lun", "mar", "mié", "jue", "vie", "sáb", "dom"];

/**
 * Calendario (2026-11-07, el de LicitaLAB y Govly): los plazos de lo que sigues en un mes (el fin de consultas, el
 * cierre de una cotización, la buena pro), el día elegido con su lista y los próximos 30 días; todo se descarga como
 * .ics para Google Calendar, Outlook o el calendario del celular, con un aviso un día antes.
 */
export function PanelCalendario({ base, irA, producto = "licitaciones" }: { base: string; irA: (t: Seccion) => void; producto?: ProductoSeguido }) {
  const { data, error, isLoading } = useSWR(claveSeguimiento(producto), () => cargarSeguimiento(producto));
  const empleo = producto === "empleo";
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
      <Caja id="mes" titulo="Tus plazos">
        <VacioCaja
          Icono={CalendarDays}
          titulo="Todavía no hay plazos"
          texto={empleo ? "Guarda una plaza y aquí verás el día en que cierra su postulación." : "Guarda una licitación o un contrato menor y aquí verás su fin de consultas, su cierre y su buena pro."}
          accion={
            empleo && APP_EN_CONSTRUCCION
              ? <Link href={rutaEn(base, "/plazas")} className={claseAccion("primario")}>Buscar plazas</Link>
              : <Link href={rutaEn(base, empleo ? "/app/para-ti" : "/cuenta?tab=para-ti")} className={claseAccion("primario")}>Ver «Para ti»</Link>
          }
        />
      </Caja>
    );
  }

  const celdas = celdasDelMes(mes);
  const delDia = porDia.get(dia) ?? [];
  const tituloMes = mayuscula(new Intl.DateTimeFormat("es-PE", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${mes}-01T12:00:00Z`)));

  return (
    <div className="grid gap-4 sm:gap-6">
      <div className="grid items-start gap-4 sm:gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Caja
          id="mes"
          titulo={<span aria-live="polite">{tituloMes}</span>}
          accion={
            <>
              <div className="flex items-center rounded-lg border border-line">
                <button type="button" onClick={() => setMes(sumarMes(mes, -1))} aria-label="Mes anterior" className="grid h-9 w-9 place-items-center rounded-l-lg text-inkSoft hover:bg-ink/[0.06] hover:text-ink">
                  <ChevronLeft size={17} aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMes(hoy.slice(0, 7));
                    setDia(hoy);
                  }}
                  className="h-9 border-x border-line px-3 text-meta font-semibold text-ink hover:bg-ink/[0.06]"
                >
                  Hoy
                </button>
                <button type="button" onClick={() => setMes(sumarMes(mes, 1))} aria-label="Mes siguiente" className="grid h-9 w-9 place-items-center rounded-r-lg text-inkSoft hover:bg-ink/[0.06] hover:text-ink">
                  <ChevronRight size={17} aria-hidden />
                </button>
              </div>
              <button type="button" onClick={() => descargarIcs(todos, base, producto)} disabled={!todos.length} className={claseAccion("secundario", "min-h-9 px-4")}>
                <CalendarPlus size={15} aria-hidden /> Añadir a mi calendario
              </button>
            </>
          }
          relleno={false}
          pie={
            <ul className="flex flex-wrap gap-x-4 gap-y-1 py-1 text-meta text-inkSoft" aria-label="Leyenda">
              {(["cierre", "consultas", "buena_pro"] as const).map((k) => (
                <li key={k} className="flex items-center gap-1.5">
                  <span aria-hidden className={cn("h-2 w-2 rounded-full", PUNTO[k])} /> {k === "cierre" ? "Cierre de cotización" : k === "consultas" ? "Fin de consultas" : "Buena pro"}
                </li>
              ))}
            </ul>
          }
        >
          <div className="grid grid-cols-7 border-b border-line">
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
                  aria-label={`${diaLargo(c.dia)}${evs.length ? `, ${evs.length} ${evs.length === 1 ? "plazo" : "plazos"}` : ""}`}
                  className={cn(
                    "flex min-h-16 flex-col items-stretch gap-1 border-b border-r border-line p-1 text-left sm:p-1.5 transition-colors duration-rapido [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0 sm:min-h-24",
                    !c.delMes && "bg-ink/[0.025] text-mute",
                    elegido ? "bg-granate-50" : "hover:bg-ink/[0.04]",
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
                          <span
                            key={`${e.item.ref}-${e.plazo.clave}`}
                            title={`${e.plazo.etiqueta}: ${e.item.titulo ?? ""}`}
                            className={cn("truncate rounded-md px-1 py-0.5 text-rotulo font-semibold", TONO[e.plazo.clave])}
                          >
                            {CORTO[e.plazo.clave]}
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
        </Caja>

        <Caja id="dia" titulo={diaLargo(dia)} descripcion={delDia.length ? `${delDia.length} ${delDia.length === 1 ? "plazo" : "plazos"}` : undefined} relleno={false}>
          {delDia.length === 0 ? (
            <p className="px-4 py-6 text-center text-dato text-inkSoft sm:px-5">Ningún plazo este día.</p>
          ) : (
            <ListaEventos evs={delDia} base={base} />
          )}
        </Caja>
      </div>

      <Caja
        id="prox"
        titulo="Próximos 30 días"
        accion={
          <button type="button" onClick={() => irA("seguimiento")} className={CLASE_ENLACE_PIE}>
            Ver el tablero
          </button>
        }
        relleno={false}
        pie={
          <p className="py-1 text-meta leading-relaxed text-mute">
            La presentación de ofertas no viene en los datos abiertos del OECE: está en el cronograma del SEACE, enlazado en cada ficha. «Añadir a mi
            calendario» baja un archivo .ics con un aviso un día antes de cada plazo.
          </p>
        }
      >
        {proximos.length === 0 ? (
          <p className="px-4 py-6 text-center text-dato text-inkSoft sm:px-5">Lo que sigues no tiene plazos en los próximos 30 días.</p>
        ) : (
          <ListaEventos evs={proximos} base={base} conDia />
        )}
      </Caja>
    </div>
  );
}

function ListaEventos({ evs, base, conDia = false }: { evs: Evento[]; base: string; conDia?: boolean }) {
  return (
    <ol className="divide-y divide-line">
      {evs.map(({ item, plazo }) => {
        const c = cuando(plazo.fecha);
        return (
          <li key={`${item.tipo}-${item.ref}-${plazo.clave}`}>
            <Link href={rutaEn(base, rutaItem(item))} className="flex gap-3 px-4 py-3 transition-colors duration-rapido hover:bg-ink/[0.035] sm:px-5">
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

const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** «Sábado 7 de noviembre» (un día YYYY-MM-DD, sin hora). */
function diaLargo(dia: string): string {
  return mayuscula(new Intl.DateTimeFormat("es-PE", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dia}T12:00:00Z`)));
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
function descargarIcs(evs: Evento[], base: string, producto: ProductoSeguido) {
  const marca = producto === "empleo" ? "Empleo" : "Licitaciones";
  const utc = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/[;,]/g, (x) => `\\${x}`).replace(/\r?\n/g, "\\n");
  const ahora = utc(new Date().toISOString());
  const futuros = evs.filter((e) => new Date(e.plazo.fecha).getTime() > Date.now() - 86_400_000);
  const lineas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Gobserva//${marca}//ES`,
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:Gobserva ${marca}`,
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
        `SUMMARY:${esc(`${CORTO[plazo.clave]}: ${item.titulo ?? (item.tipo === "plaza" ? "Plaza guardada" : "Proceso guardado")}`)}`,
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
