"use client";

/**
 * Pestaña «Por qué se bloqueó» de la ficha (rediseño 2026-10-30): lo que dijo la autoevaluación en UNA tarjeta de
 * filas, para leerlo de un vistazo sin abrir nada. Antes eran 12 párrafos y 7 cajas dentro de cajas.
 *  · Arriba, el motivo del bloqueo en una línea con su cifra («Sólo 1 de 3 señales quedó respaldada…, mínimo 60 %»);
 *    qué quiere decir, en el ⓘ.
 *  · Cada señal en una fila: nombre, severidad y si quedó respaldada. Su evidencia y el juicio del evaluador se abren
 *    a pedido, tocando la fila.
 *  · Las otras cuatro comprobaciones (cita, precio, tono, coherencia): una fila cada una con ✓/✗ y su resultado; el
 *    porqué del evaluador, plegado en la misma fila.
 *  · El juicio de precio por ítem, igual: una fila por ítem (las primeras 5; el resto, a pedido).
 * Las reglas se nombran con el mismo catálogo que usa el informe público, nunca con su id. Los bloques se separan
 * con filetes, sin cajas adentro.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, CircleHelp, XCircle } from "lucide-react";
import { Badge, type Tone } from "@/components/admin/ui";
import { Ayuda } from "@/components/patrones/Ayuda";
import { etiquetaDeRegla, useReglasPerfil } from "@/components/agentes/useReglasPerfil";
import { redactDnis } from "@/components/Redact";
import type { BanderaRevision, RevisionDetalle } from "@/lib/admin";
import { cn } from "@/lib/utils";
import { EsqueletoFilas } from "./Esqueleto";
import { motivosLlanos } from "./motivos";

type Juicio = { regla?: string; reason?: string; respaldada?: boolean };
type Fila = { key: string; regla: string; severidad: BanderaRevision["severidad"] | null; evidencia: string | null; juicio: Juicio | null };

export const SEVERIDAD_UI: Record<string, { label: string; tono: Tone }> = {
  alta: { label: "Severidad alta", tono: "danger" },
  media: { label: "Severidad media", tono: "warn" },
  baja: { label: "Severidad baja", tono: "muted" },
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const motivoDe = (r?: string | null) => (typeof r === "string" && r.trim() ? r.trim() : null);

/** Ítems de precio a la vista; los demás se abren con «Ver N ítems más» (hay contratos con decenas de ítems). */
const PRECIOS_A_LA_VISTA = 5;

/** Cada bandera con su juicio. Dos banderas de la misma regla se emparejan en orden; un juicio sin bandera va al final. */
function emparejar(banderas: BanderaRevision[], juicios: Juicio[]): Fila[] {
  const cola = new Map<string, Juicio[]>();
  for (const j of juicios) {
    const k = String(j.regla ?? "");
    cola.set(k, [...(cola.get(k) ?? []), j]);
  }
  const filas: Fila[] = banderas.map((b) => ({
    key: b.id, regla: b.regla, severidad: b.severidad, evidencia: b.evidencia, juicio: cola.get(b.regla)?.shift() ?? null,
  }));
  let i = 0;
  cola.forEach((resto, regla) => {
    for (const j of resto) filas.push({ key: `j-${i++}`, regla: regla || "sin_regla", severidad: null, evidencia: null, juicio: j });
  });
  return filas;
}

/**
 * `listo`: si ya están los nombres a tapar (los arma el informe). El resumen son cifras y se ve enseguida; las filas,
 * que traen la evidencia y el juicio del evaluador (pueden nombrar a personas privadas), esperan con su esqueleto.
 */
export function PorQueBloqueo({ d, listo = true }: { d: RevisionDetalle; listo?: boolean }) {
  const { reglas } = useReglasPerfil(d.perfil);
  const ae = d.autoevaluacion;
  const motivos = useMemo(() => motivosLlanos(d), [d]);
  const filas = useMemo(() => emparejar(d.banderas, ae?.perBandera ?? []), [d.banderas, ae?.perBandera]);
  const juzgadas = filas.filter((f) => f.juicio);
  const respaldadas = juzgadas.filter((f) => f.juicio?.respaldada).length;
  const precios = ae?.perPrecio ?? [];
  const razonables = precios.filter((p) => p.plausible === true).length;
  const [todosLosPrecios, setTodosLosPrecios] = useState(false);
  const preciosVisibles = todosLosPrecios ? precios : precios.slice(0, PRECIOS_A_LA_VISTA);

  return (
    <section aria-labelledby="porque-titulo" className="divide-y divide-line rounded-2xl border border-line bg-paperSoft">
      {/* El motivo del bloqueo, en una línea por motivo con su cifra; lo que quiere decir, en el ⓘ. */}
      <div className="px-4 py-3 sm:px-5">
        <h2 id="porque-titulo" className="sr-only">
          {d.estado === "revision" ? "Por qué no se publicó sola" : "Por qué la autoevaluación la había frenado"}
        </h2>
        <ul className="space-y-1.5">
          {motivos.map((m, i) => (
            <li key={`${m.clave}-${i}`} className="flex items-start gap-2">
              <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
              <span className="min-w-0 text-dato font-semibold leading-5 text-ink">{m.texto}</span>
              {m.ayuda && <Ayuda titulo="¿Qué quiere decir?" className="-my-0.5">{m.ayuda}</Ayuda>}
            </li>
          ))}
        </ul>
      </div>

      {!listo ? (
        <EsqueletoFilas />
      ) : !ae ? (
        <div className="px-4 py-3 text-meta text-mute sm:px-5">Este análisis no guardó su autoevaluación.</div>
      ) : (
        <>
          <Bloque
            titulo="Señales"
            meta={`${juzgadas.length ? `${respaldadas} de ${juzgadas.length} ${juzgadas.length === 1 ? "respaldada" : "respaldadas"}` : "Sin señales juzgadas"}, mínimo ${pct(d.umbrales.min_respaldo)}`}
            ayuda={
              <Ayuda titulo="¿Quién juzga cada señal?">
                Un evaluador automático releyó cada señal contra el expediente y el registro oficial. Úsalo como guía: la decisión
                es tuya. Toca una señal para ver su evidencia y lo que dijo el evaluador.
              </Ayuda>
            }
          >
            {filas.map((f) => {
              const sev = f.severidad ? SEVERIDAD_UI[f.severidad] ?? { label: f.severidad, tono: SEVERIDAD_UI.baja.tono } : null;
              const motivo = motivoDe(f.juicio?.reason);
              return (
                <FilaPlegable
                  key={f.key}
                  icono={<Veredicto ok={f.juicio ? !!f.juicio.respaldada : null} />}
                  titulo={etiquetaDeRegla(f.regla, reglas)}
                  lado={
                    <>
                      {sev && <Badge tono={sev.tono}>{sev.label}</Badge>}
                      <Badge tono={f.juicio ? (f.juicio.respaldada ? "ok" : "danger") : "muted"}>
                        {f.juicio ? (f.juicio.respaldada ? "Respaldada" : "No respaldada") : "Sin juicio"}
                      </Badge>
                    </>
                  }
                >
                  {f.evidencia && <p className="break-words text-rotulo leading-relaxed text-mute">{redactDnis(f.evidencia)}</p>}
                  <p className={cn("break-words text-meta leading-relaxed text-ink", f.evidencia && "mt-1.5")}>
                    {!f.juicio
                      ? <span className="text-mute">El evaluador no juzgó esta señal.</span>
                      : motivo
                        ? <><span className="font-medium">El evaluador: </span>{redactDnis(motivo)}</>
                        : <span className="text-mute">El evaluador no dejó el motivo.</span>}
                  </p>
                </FilaPlegable>
              );
            })}
            {!filas.length && <li className="py-2 text-meta text-mute">No quedaron señales guardadas: la verificación las descartó todas.</li>}
          </Bloque>

          <Bloque
            titulo="Otras comprobaciones"
            ayuda={
              <Ayuda titulo="¿Qué se comprueba?">
                Que cada señal cite su norma y su fuente, que los precios comparados sean comparables con el mercado, que el
                dictamen no acuse y que los ítems correspondan al objeto del contrato. Las que no llegan a su mínimo (y el tono o
                la coherencia, si los umbrales lo piden) frenan la publicación.
              </Ayuda>
            }
          >
            <Comprobacion titulo="Norma y fuente citadas" conteo={ae.cita} umbral={d.umbrales.min_cita} nombre={["señal con cita", "señales con cita"]} />
            <Comprobacion titulo="Precios comparables con el mercado" conteo={ae.precio} umbral={d.umbrales.min_precio} nombre={["comparación razonable", "comparaciones razonables"]} />
            <Comprobacion
              titulo="Tono del dictamen"
              ok={ae.tono ? ae.tono.toLowerCase() !== "acusatorio" : null}
              valor={ae.tono ? (ae.tono.toLowerCase() === "acusatorio" ? "Acusatorio" : "Sin tono acusatorio") : null}
              motivo={ae.tonoReason}
            />
            <Comprobacion
              titulo="Ítems y objeto del contrato"
              ok={ae.coherencia ? ae.coherencia.toLowerCase() !== "incoherente" : null}
              valor={ae.coherencia ? (ae.coherencia.toLowerCase() === "incoherente" ? "No coinciden" : "Coinciden") : null}
              motivo={ae.coherenciaReason}
            />
          </Bloque>

          {precios.length > 0 && (
            <Bloque
              titulo="Precio por ítem"
              meta={`${razonables} de ${precios.length} ${precios.length === 1 ? "razonable" : "razonables"}`}
              pie={
                precios.length > PRECIOS_A_LA_VISTA && (
                  <button
                    type="button"
                    onClick={() => setTodosLosPrecios((v) => !v)}
                    aria-expanded={todosLosPrecios}
                    className="inline-flex min-h-8 items-center gap-1 rounded-lg text-rotulo font-medium text-inkSoft hover:text-ink"
                  >
                    {todosLosPrecios ? "Ver menos" : `Ver ${precios.length - PRECIOS_A_LA_VISTA} ítems más`}
                    <ChevronDown size={13} className={cn("transition-transform duration-rapido", todosLosPrecios && "rotate-180")} aria-hidden />
                  </button>
                )
              }
            >
              {preciosVisibles.map((p, i) => {
                const nombre = p.item?.trim() || "Ítem sin nombre";
                const plausible = typeof p.plausible === "boolean" ? p.plausible : null;
                const motivo = motivoDe(p.reason);
                return (
                  <FilaPlegable
                    key={i}
                    icono={<Veredicto ok={plausible} />}
                    titulo={nombre}
                    recortar
                    lado={
                      <span className={cn(plausible === false && "font-medium text-crimsonTexto")}>
                        {plausible === false ? "Dudosa" : plausible ? "Razonable" : "Sin juicio"}
                      </span>
                    }
                  >
                    {motivo && <p className="break-words text-meta leading-relaxed text-inkSoft">{redactDnis(motivo)}</p>}
                  </FilaPlegable>
                );
              })}
            </Bloque>
          )}
        </>
      )}
    </section>
  );
}

/** Un bloque de la tarjeta: su título (con el ⓘ si hace falta), una cifra corta a la derecha y sus filas con filetes. */
function Bloque({ titulo, meta, ayuda, pie, children }: { titulo: string; meta?: string; ayuda?: React.ReactNode; pie?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="px-4 pb-1.5 pt-3 sm:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
        <h3 className="flex items-center gap-1 text-dato font-semibold leading-5 text-ink">
          {titulo}
          {ayuda}
        </h3>
        {meta && <span className="text-rotulo text-mute">{meta}</span>}
      </div>
      <ul className="mt-1 divide-y divide-line">{children}</ul>
      {pie && <div className="pb-1.5">{pie}</div>}
    </div>
  );
}

/**
 * Una fila de la tarjeta: ícono, nombre y, a la derecha (debajo en el celular), sus etiquetas o su resultado. Si trae
 * algo más (`children`: la evidencia, el porqué del evaluador), la fila entera lo abre y lo cierra (<details>, sin JS);
 * si no, reserva el lugar de la flecha para que los resultados queden alineados.
 */
function FilaPlegable({
  icono, titulo, lado, recortar, children,
}: {
  icono: React.ReactNode;
  titulo: React.ReactNode;
  lado?: React.ReactNode;
  /** Nombres largos (ítems): dos renglones como mucho; el nombre entero, al pasar el mouse. */
  recortar?: boolean;
  children?: React.ReactNode;
}) {
  const cabeza = (
    <>
      {icono}
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn("min-w-0 flex-1 basis-40 text-dato font-medium leading-5 text-ink", recortar ? "line-clamp-2 break-words" : "break-words")}
          title={recortar && typeof titulo === "string" ? titulo : undefined}
        >
          {titulo}
        </span>
        {lado && <span className="flex flex-wrap items-center gap-1.5 text-meta leading-5 text-inkSoft">{lado}</span>}
      </span>
    </>
  );
  if (!children)
    return (
      <li>
        <div className="flex items-start gap-2.5 py-2 pr-6">{cabeza}</div>
      </li>
    );
  return (
    <li>
      <details>
        <summary className="-mx-2 flex cursor-pointer list-none items-start gap-2.5 rounded-lg px-2 py-2 transition-colors duration-rapido hover:bg-paperDeep/50 [&::-webkit-details-marker]:hidden">
          {cabeza}
          <ChevronDown size={15} className="mt-0.5 shrink-0 text-mute transition-transform duration-rapido [details[open]>summary_&]:rotate-180" aria-hidden />
        </summary>
        <div className="pb-2.5 pl-[1.625rem] pr-6">{children}</div>
      </details>
    </li>
  );
}

/** ✓, ✗ o «?». Decorativo si la fila ya lo dice en palabras (una etiqueta, «Dudosa»); si no, con su nombre. */
function Veredicto({ ok, etiqueta }: { ok: boolean | null; etiqueta?: string }) {
  const a11y = etiqueta ? { role: "img", "aria-label": etiqueta } : { "aria-hidden": true as const };
  if (ok === true) return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-moss" {...a11y} />;
  if (ok === false) return <XCircle size={16} className="mt-0.5 shrink-0 text-rust" {...a11y} />;
  return <CircleHelp size={16} className="mt-0.5 shrink-0 text-mute" {...a11y} />;
}

/** Una comprobación: por conteo (n juzgadas, ok aprobadas, contra el umbral) o por etiqueta (tono, coherencia). */
function Comprobacion({
  titulo, conteo, umbral, nombre, ok, valor, motivo,
}: {
  titulo: string;
  conteo?: { n?: number; ok?: number } | null;
  umbral?: number;
  /** Singular y plural: "1 de 1 comparación razonable", "2 de 4 señales con cita". */
  nombre?: [string, string];
  ok?: boolean | null;
  valor?: string | null;
  motivo?: string | null;
}) {
  let estado: boolean | null = ok ?? null;
  let texto = valor ?? "Sin dato";
  if (conteo !== undefined) {
    const n = Number(conteo?.n ?? 0), aprobadas = Number(conteo?.ok ?? 0);
    estado = n ? aprobadas / n >= (umbral ?? 0) : null;
    texto = n ? `${aprobadas} de ${n} ${nombre?.[n === 1 ? 0 : 1] ?? ""}`.trim() : "Nada que juzgar";
  }
  const porque = motivoDe(motivo);
  return (
    <FilaPlegable
      icono={<Veredicto ok={estado} etiqueta={estado === null ? "Sin juicio" : estado ? "Cumple" : "No cumple"} />}
      titulo={titulo}
      lado={
        <span className={cn(estado === false && "font-medium text-crimsonTexto")}>
          {texto}
          {umbral != null && <span className="font-normal text-mute">, mínimo {pct(umbral)}</span>}
        </span>
      }
    >
      {porque && <p className="break-words text-meta leading-relaxed text-inkSoft">{redactDnis(porque)}</p>}
    </FilaPlegable>
  );
}
