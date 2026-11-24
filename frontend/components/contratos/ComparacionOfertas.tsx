/**
 * «Postores y ofertas» a la vista, antes de la tabla (pedido del usuario del 2026-11-17: «mejor presentación, ahora hay
 * texto plano»):
 *   · `AvisoMasBaja`: si la oferta más baja no ganó, un aviso destacado y neutro con las cifras (la bonificación a la micro
 *     y pequeña empresa es legal: explica el resultado, no lo vuelve irregular);
 *   · `ComparacionOfertas`: cada oferta en una barra por su monto (la ganadora resaltada, la más baja marcada) y su
 *     puntaje partido en precio, demás factores y bonificación, para ver qué tramo decidió;
 *   · `detallePostor`: el panel lateral de cada fila de la tabla (toda lista lleva el suyo).
 *
 * Server-safe. Una persona natural sale tapada (`PersonName`) y nunca en el título del panel.
 */
import type { ReactNode } from "react";
import { Award, ArrowDownWideNarrow, Scale } from "lucide-react";
import { PersonName } from "@/components/Redact";
import { DatosClave, EnUnaFrase, type DatoClave } from "@/components/patrones";
import { colorSerie, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { enlaceProveedor } from "@/lib/empresas";
import { decimal, fecha, numero, oracion, porcentaje, soles } from "@/lib/formato";
import { esPersonaNatural, type ContratoDetalle as Detalle, type PostorContrato } from "@/lib/contratos";
import { CitaPagina } from "./CitaPagina";

/** Un puntaje como lo escribe el acta, con hasta dos decimales: 100,02 frente a 100 decide una buena pro. */
const pts = (n: number) => decimal(n, 2);

/** Lo que sumaron los demás factores: lo leído o, si falta, el total menos el precio. */
const otrosDe = (p: PostorContrato) =>
  p.puntajeOtros ?? (p.puntajeTotal != null && p.puntajePrecio != null ? Math.round((p.puntajeTotal - p.puntajePrecio) * 100) / 100 : null);

function Nombre({ p }: { p: { ruc: string | null; razonSocial?: string | null; nombre?: string | null } }) {
  const n = p.razonSocial ?? p.nombre ?? null;
  if (!n) return <>Un postor</>;
  return esPersonaNatural(p.ruc) ? <PersonName name={n} /> : <>{n}</>;
}

// ─── El aviso ────────────────────────────────────────────────────────────────────────────────────

export function AvisoMasBaja({ c }: { c: Detalle }) {
  const m = c.evaluacion?.masBajaPerdio;
  if (!m) return null;
  return (
    <section aria-labelledby="aviso-mas-baja" className="rounded-2xl border border-line bg-paperSoft px-4 py-3.5 sm:px-5 [.tarjeta_&]:rounded-xl [.tarjeta_&]:border-0">
      <div className="flex items-start gap-3">
        <Scale size={20} className="mt-0.5 shrink-0 text-inkSoft" aria-hidden />
        <div className="min-w-0 space-y-1.5">
          <h3 id="aviso-mas-baja" className="text-cuerpo font-semibold text-ink">La oferta más baja no ganó</h3>
          <p className="text-dato leading-relaxed text-inkSoft">
            <b className="text-ink"><Nombre p={m.masBaja} /></b> ofertó <b className="tabular-nums text-ink">{soles(m.masBaja.monto ?? 0)}</b>
            {m.masBaja.puntajeFinal != null && <> y sumó <b className="tabular-nums text-ink">{pts(m.masBaja.puntajeFinal)}</b> puntos</>}. La buena pro fue a{" "}
            <b className="text-ink"><Nombre p={m.ganador} /></b>, con <b className="tabular-nums text-ink">{soles(m.ganador.monto ?? 0)}</b>:{" "}
            <b className="tabular-nums text-ink">{porcentaje(m.diferenciaPct, { decimales: 1 })} más</b> ({soles(m.diferenciaSoles)})
            {m.ganador.puntajeFinal != null && <>, y <b className="tabular-nums text-ink">{pts(m.ganador.puntajeFinal)}</b> puntos</>}
            {m.ganador.bonificacion != null && <>, de los que <b className="tabular-nums text-ink">{pts(m.ganador.bonificacion)}</b> fueron bonificación</>}.
          </p>
          <p className="text-rotulo leading-relaxed text-mute">
            La bonificación (por ejemplo, la de 5 % a la micro y pequeña empresa) es legal y la dan las bases: explica el resultado, no lo vuelve
            irregular. Lo que vale revisar es si los demás factores se puntuaron según las bases.
          </p>
        </div>
      </div>
    </section>
  );
}

// ─── La comparación ──────────────────────────────────────────────────────────────────────────────

const SEG = { precio: 0, otros: 2, bonificacion: 4 } as const;

/**
 * Un monto de oferta que no puede ser (mal leído del acta): más de tres veces el valor referencial de todo el proceso, o
 * igual a la cantidad de un ítem. 2026-2543-197: S/ 455,949,264 en un proceso de S/ 51 M, y «S/ 5,377,000», que es la
 * cantidad de unidades del ítem 9. Se muestra marcado y no entra en ninguna comparación.
 */
export function montoOfertaDudoso(monto: number, c: Pick<Detalle, "montoPen" | "items">): boolean {
  if (c.montoPen && monto > 3 * c.montoPen) return true;
  return c.items.some((it) => it.cantidad != null && it.cantidad >= 1000 && Math.abs(it.cantidad - monto) < 0.5);
}

export function ComparacionOfertas({ c }: { c: Detalle }) {
  const todas = (c.postoresDetalle ?? []).filter((p) => p.montoOferta != null && p.montoOferta > 0);
  const dudosa = (p: PostorContrato) => montoOfertaDudoso(p.montoOferta!, c);
  const ofertas = todas.filter((p) => !dudosa(p));
  if (ofertas.length < 2) return null;
  // Las dudosas van al final, marcadas, fuera de la escala y de los porcentajes.
  const orden = [...[...ofertas].sort((a, b) => a.montoOferta! - b.montoOferta!), ...todas.filter(dudosa)];
  const minimo = Math.min(...ofertas.map((p) => p.montoOferta!));
  const maximo = Math.max(...ofertas.map((p) => p.montoOferta!));
  const conPuntaje = orden.some((p) => p.puntajeFinal != null || p.puntajeTotal != null);
  const escala = Math.max(100, ...orden.map((p) => p.puntajeFinal ?? p.puntajeTotal ?? 0));
  const conBonif = orden.some((p) => (p.bonificacion ?? 0) > 0);
  // Con varios ítems cada oferta compite en el suyo: se compara con la más baja de SU ítem, y si las ofertas no dicen su
  // ítem, no se comparan (2026-2543-194, 8 ítems: «+5,508 %» contra la oferta más baja de otro ítem).
  const variosItems = c.items.length > 1 || new Set(ofertas.filter((p) => p.esGanador).map((p) => p.ruc ?? p.razonSocial)).size > 1;
  const conItem = ofertas.every((p) => !!p.item);
  const minimoDe = (p: PostorContrato): number | null => {
    if (!variosItems) return minimo;
    if (!conItem) return null;
    const del = ofertas.filter((x) => x.item === p.item).map((x) => x.montoOferta!);
    return del.length > 1 ? Math.min(...del) : null;
  };
  const esMasBaja = (p: PostorContrato, i: number) =>
    variosItems ? minimoDe(p) != null && p.montoOferta === minimoDe(p) && ofertas.filter((x) => x.item === p.item).length > 1 : i === 0;
  return (
    <section aria-labelledby="comparacion-ofertas" className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:bg-transparent [.tarjeta_&]:px-0 [.tarjeta_&]:pb-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id="comparacion-ofertas" className="font-display text-bloque font-bold text-ink">
          Las {numero(todas.length)} ofertas, de la más baja a la más alta{variosItems && !conItem ? ", de distintos ítems" : ""}
        </h3>
        <span className="text-rotulo text-mute">la barra es el monto ofertado{conPuntaje ? "; a la derecha, el puntaje" : ""}</span>
      </div>
      {todas.length > ofertas.length && (
        <p className="mt-1 text-rotulo text-mute">
          {todas.length - ofertas.length === 1 ? "Una, al final, con un monto dudoso" : `${numero(todas.length - ofertas.length)}, al final, con un monto dudoso`}: más de tres veces el
          valor referencial del proceso o igual a la cantidad de un ítem, probablemente mal leído del acta. No entran en la comparación.
        </p>
      )}
      {variosItems && (
        <p className="mt-1 text-rotulo text-mute">
          {conItem
            ? "Cada oferta compite en su ítem: el porcentaje es sobre la más baja de ese mismo ítem."
            : "Cada oferta compite en su ítem y el registro no dice en cuál: no se comparan entre sí. El ítem de cada una está en la tabla, si el acta lo trae."}
        </p>
      )}
      <ol className="mt-4 space-y-3.5">
        {orden.map((p, i) => {
          const final = p.puntajeFinal ?? p.puntajeTotal;
          const otros = otrosDe(p);
          const dudoso = dudosa(p);
          const masBaja = !dudoso && esMasBaja(p, i);
          const base = dudoso ? null : minimoDe(p);
          const segs = [
            { k: "precio", v: p.puntajePrecio, i: SEG.precio },
            { k: "otros", v: otros, i: SEG.otros },
            { k: "bonificacion", v: p.bonificacion, i: SEG.bonificacion },
          ].filter((s) => s.v != null && s.v > 0);
          return (
            <li key={`o-${i}`} className={`rounded-xl px-2.5 py-2 ${p.esGanador ? "bg-granate-50" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="min-w-0 truncate text-dato font-semibold text-ink"><Nombre p={p} /></span>
                {p.esGanador && (
                  <span className="pill border-granate/30 bg-paper font-semibold text-granate"><Award size={12} aria-hidden /> Ganó</span>
                )}
                {masBaja && (
                  <span className="pill border-line bg-paperSoft text-inkSoft">
                    <ArrowDownWideNarrow size={12} aria-hidden /> {variosItems ? `La más baja del ítem ${p.item}` : "La más baja"}
                  </span>
                )}
                {dudoso && (
                  <span className="pill border-amber/30 bg-amber-soft text-amberTexto" title="Más de tres veces el valor referencial del proceso, o igual a la cantidad de un ítem: probablemente mal leído del acta">
                    Monto dudoso
                  </span>
                )}
                {p.admitida === false && <span className="pill border-line bg-paperSoft text-inkSoft">No admitida</span>}
                {p.admitida !== false && p.calificada === false && <span className="pill border-line bg-paperSoft text-inkSoft">No calificó</span>}
              </div>
              <div className={`mt-1.5 grid items-center gap-x-4 gap-y-1.5 ${conPuntaje ? "md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]" : ""}`}>
                {/* El monto: una barra desde cero, del mismo largo para todos en la misma escala. */}
                <div className="flex items-center gap-2.5">
                  <span className="block h-3 flex-1 overflow-hidden rounded-full bg-paperEdge" aria-hidden>
                    <span
                      className="block h-full rounded-full"
                      style={{ width: `${Math.min(100, (100 * p.montoOferta!) / maximo)}%`, background: dudoso ? "rgb(var(--mute) / 0.35)" : p.esGanador ? "rgb(var(--granate))" : "rgb(var(--mute))" }}
                    />
                  </span>
                  <span className="w-36 shrink-0 text-right tabular-nums">
                    <b className="text-dato text-ink">{soles(p.montoOferta!)}</b>
                    {!masBaja && base != null && base > 0 && p.montoOferta! > base && (
                      <span className="ml-1.5 text-rotulo text-mute">+{porcentaje(((p.montoOferta! - base) / base) * 100, { decimales: 1 })}</span>
                    )}
                  </span>
                </div>
                {/* El puntaje partido: precio, demás factores y bonificación, en la escala del mayor. */}
                {conPuntaje && (
                  <div className="flex items-center gap-2.5">
                    <span
                      className="flex h-3 flex-1 gap-[2px] overflow-hidden rounded-full bg-paperEdge"
                      role="img"
                      aria-label={`Puntaje ${final != null ? pts(final) : "sin dato"}: ${segs.map((s) => `${s.k === "precio" ? "precio" : s.k === "otros" ? "demás factores" : "bonificación"} ${pts(s.v!)}`).join(", ")}`}
                    >
                      {segs.map((s) => (
                        <span key={s.k} className="block h-full" style={{ width: `${(100 * s.v!) / escala}%`, background: colorSerie(s.i) }} />
                      ))}
                    </span>
                    <b className="w-14 shrink-0 text-right text-dato tabular-nums text-ink">{final != null ? pts(final) : "Sin dato"}</b>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {conPuntaje && (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-rotulo text-mute">
          <span className="inline-flex items-center gap-1.5"><MuestraSerie i={SEG.precio} /> Puntaje por precio</span>
          <span className="inline-flex items-center gap-1.5"><MuestraSerie i={SEG.otros} /> Demás factores</span>
          {conBonif && <span className="inline-flex items-center gap-1.5"><MuestraSerie i={SEG.bonificacion} /> Bonificación</span>}
        </p>
      )}
    </section>
  );
}

// ─── El panel de cada postor ─────────────────────────────────────────────────────────────────────

export function detallePostor(p: PostorContrato, c: Detalle, extra: { estado: string | null; motivo: ReactNode | null; dif: number | null }) {
  const natural = esPersonaNatural(p.ruc);
  const final = p.puntajeFinal ?? p.puntajeTotal;
  const ficha = enlaceProveedor(p.ruc);
  const datos: DatoClave[] = [
    { etiqueta: "Oferta", valor: p.montoOferta != null ? soles(p.montoOferta) : null, mono: true },
    { etiqueta: "Frente a la referencia", valor: extra.dif != null ? `${extra.dif > 0 ? "+" : ""}${porcentaje(extra.dif, { decimales: 1 })}` : null, mono: true },
    { etiqueta: "Puntaje por precio", valor: p.puntajePrecio != null ? pts(p.puntajePrecio) : null, mono: true },
    { etiqueta: "Demás factores", valor: otrosDe(p) != null ? pts(otrosDe(p)!) : null, mono: true },
    { etiqueta: "Bonificación", valor: p.bonificacion != null ? pts(p.bonificacion) : null, mono: true },
    { etiqueta: "Puntaje final", valor: final != null ? pts(final) : null, mono: true },
    { etiqueta: "Orden de prelación", valor: p.ordenPrelacion != null ? `Puesto ${p.ordenPrelacion}` : null },
    { etiqueta: "¿Se admitió?", valor: p.admitida == null ? null : p.admitida ? "Sí" : "No" },
    { etiqueta: "¿Calificó?", valor: p.calificada == null ? null : p.calificada ? "Sí" : "No" },
    { etiqueta: "Presentó su oferta", valor: p.horaOferta ? `${p.fechaOferta ? `${fecha(p.fechaOferta)}, ` : ""}${p.horaOferta}` : null },
  ];
  const citas = [p.citaEvaluacion, ...p.citas].filter((x): x is NonNullable<typeof x> => !!x && (x.pagina != null || !!x.documentoUrl)).slice(0, 3);
  return {
    // Nunca el nombre de una persona natural en el título del panel.
    titulo: natural ? "Postor persona natural" : p.razonSocial ?? "Postor",
    etiqueta: "Ver el detalle de este postor",
    descripcion: <span className="line-clamp-2">{extra.estado ?? "Postor"}{p.montoOferta != null ? `, ${soles(p.montoOferta)}` : ""}</span>,
    contenido: (
      <div className="space-y-5">
        <EnUnaFrase>
          <Nombre p={p} /> {p.montoOferta != null ? <>ofertó <b>{soles(p.montoOferta)}</b></> : "se registró sin oferta leída"}
          {final != null && <> y sumó <b>{pts(final)}</b> puntos</>}
          {p.esGanador ? ". Ganó la buena pro." : extra.estado ? `. Quedó como «${oracion(extra.estado.toLowerCase())}».` : "."}
        </EnUnaFrase>
        <DatosClave items={datos.filter((d) => d.valor != null)} />
        {extra.motivo && (
          <section className="space-y-1.5">
            <h3 className="font-display text-bloque font-bold text-ink">Por qué quedó fuera</h3>
            <p className="text-dato leading-relaxed text-inkSoft">{extra.motivo}</p>
          </section>
        )}
        {citas.length > 0 && (
          <section className="space-y-1.5">
            <h3 className="font-display text-bloque font-bold text-ink">Dónde dice</h3>
            <div className="flex flex-wrap gap-2">{citas.map((x, i) => <CitaPagina key={i} ocid={c.ocid} cita={x} />)}</div>
          </section>
        )}
      </div>
    ),
    pie: ficha && !natural ? (
      <EnlaceAccion href={ficha} prefetch={false} flecha>Ficha de la empresa</EnlaceAccion>
    ) : undefined,
  };
}
