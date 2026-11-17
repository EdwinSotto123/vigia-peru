"use client";

import useSWR from "swr";
import { ExternalLink, FlaskConical, Landmark, ShoppingCart, TrendingUp } from "lucide-react";
import { PUBLIC_API_BASE } from "@/lib/auditoria";
import { Revelar } from "@/components/ui/Revelar";
import { Dato } from "@/components/ui/Dato";
import { Ayuda } from "@/components/patrones/Ayuda";
import { BloqueDetalle, CuerpoDetalle } from "@/components/patrones/Detalle";
import { decimal, numero, plural, soles } from "@/lib/formato";
import { cn } from "@/lib/utils";

/**
 * El laboratorio de precios, renglón por renglón (GET /contratos/:ocid/precios-mercado; backend/api/src/lib/laboratorioPrecios.ts).
 *
 * Pedido del usuario (2026-11-17): «extraer los ítems e intentar extraer los precios, sea mediante CUBSO, compras,
 * internet». Cada renglón leído de las bases y del contrato se investiga en tiendas de internet (Workflow con GLM) y se le
 * dan las referencias del Estado: mismo CUBSO, o las mismas palabras en procesos adjudicados, compras menores, el catálogo
 * de Perú Compras y otros contratos leídos. Aquí se dibuja, por renglón, lo pagado contra el rango de las tiendas y la
 * mediana del Estado; el detalle (las ofertas con su enlace, las referencias, la nota del laboratorio) abre en el panel.
 *
 * El total sólo suma los renglones comparables (tres ofertas válidas o más, sin sospecha de caja, con su cantidad), y lo
 * pagado de más sólo donde se pagó por encima del mercado.
 */

interface Referencia {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  p25: number | null;
  mediana: number;
  p75: number | null;
}
interface Oferta {
  tienda: string;
  producto: string;
  marca: string | null;
  precioUnitario: number;
  url: string;
  fuente: string;
}
interface Renglon {
  item: number;
  producto: string;
  estado: string;
  cantidad: number | null;
  unidad: string | null;
  unidadComparada: string | null;
  pagado: number | null;
  mediana: number | null;
  p25: number | null;
  p75: number | null;
  validas: number;
  razon: number | null;
  veredicto: string | null;
  nota: string | null;
  caja: number | null;
  cuenta: boolean;
  referencias: Referencia[];
  ofertas: Oferta[];
  investigado: string | null;
}
interface Datos {
  renglones: Renglon[];
  total: { renglones: number; comparados: number; encima: number; pagado: number; mercado: number; exceso: number };
}

const FUENTE_ESTADO: Record<string, string> = {
  procesos: "Procesos del Estado",
  compras_menores: "Compras menores",
  perucompras: "Catálogo de Perú Compras",
  contratos_leidos: "Otros contratos leídos",
};

const leer = (u: string) => fetch(u).then((r) => (r.ok ? (r.json() as Promise<Datos>) : null));

/** El tono del veredicto: rojo si se pagó 1,5 veces o más la mediana, ámbar si 1,15, neutro si no. */
function tono(r: Renglon): "alto" | "medio" | "neutro" {
  if (!r.cuenta || r.razon == null) return "neutro";
  return r.razon >= 1.5 ? "alto" : r.razon >= 1.15 ? "medio" : "neutro";
}

/** «ACEITE DE MOTOR 15W40 : MOBIL» → «Aceite de motor 15W40: Mobil»: sin gritar, sin tocar los códigos con números. */
function oracion(s0: string): string {
  const s = s0.replace(/\s+([,:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (s !== s.toUpperCase()) return s;
  const bajo = s.toLowerCase().replace(/\b([a-z]*\d[a-z\d-]*)\b/g, (m) => m.toUpperCase());
  return bajo.charAt(0).toUpperCase() + bajo.slice(1);
}

/** La mediana del Estado con más compras detrás (la que se dibuja). */
const estadoPrincipal = (r: Renglon) => (r.referencias.length ? r.referencias.reduce((m, x) => (x.n > m.n ? x : m), r.referencias[0]) : null);

export function LaboratorioPrecios({ ocid }: { ocid: string | null }) {
  const { data } = useSWR(ocid ? `${PUBLIC_API_BASE}/contratos/${encodeURIComponent(ocid)}/precios-mercado` : null, leer, {
    revalidateOnFocus: false,
  });
  if (!data || !data.renglones.length) return null;
  const { renglones, total } = data;
  const enCurso = renglones.filter((r) => r.estado !== "listo" && r.estado !== "error").length;
  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-paper" aria-labelledby="lab-precios-titulo">
      <div className="border-b border-line bg-paperSoft px-5 py-3">
        <h2 id="lab-precios-titulo" className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
          <FlaskConical size={18} className="shrink-0 text-mute" aria-hidden />
          Precios de mercado por renglón
          <Ayuda titulo="¿De dónde salen estos precios?">
            El laboratorio de precios busca cada renglón del contrato en tiendas de internet y lee la página de cada oferta para
            sacar su precio por unidad. Junto a eso, lo que pagó el Estado por lo mismo: el mismo código CUBSO o las mismas
            palabras en procesos adjudicados, compras menores, el catálogo de Perú Compras y otros contratos leídos. Un precio
            de tienda puede no incluir el flete ni la entrega en provincia: es una referencia para preguntar, no una prueba.
          </Ayuda>
        </h2>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-rotulo text-mute">
          <Dato icono={ShoppingCart} nombre="Renglones investigados">
            {plural(total.renglones, "renglón investigado", "renglones investigados")}
            {enCurso > 0 && `, ${numero(enCurso)} en curso`}
          </Dato>
          <Dato icono={TrendingUp} nombre="Comparables">
            {numero(total.comparados)} con tres ofertas o más
          </Dato>
          {total.encima > 0 && (
            <Dato icono={Landmark} nombre="Pagado de más">
              <strong className="font-semibold text-ink">{soles(total.exceso)}</strong> pagados de más en{" "}
              {plural(total.encima, "renglón", "renglones")}
            </Dato>
          )}
        </div>
      </div>
      <Leyenda />
      <ul className="divide-y divide-line/70">
        {renglones.map((r) => (
          <li key={r.item}>
            <FilaRenglon r={r} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Leyenda() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line/70 px-5 py-2 text-rotulo text-mute">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-5 rounded-sm" style={{ background: "rgb(var(--serie-2) / 0.35)" }} aria-hidden />
        Tiendas: la mitad de las ofertas cae aquí
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-3 w-0.5" style={{ background: "rgb(var(--serie-2))" }} aria-hidden />
        Mediana de las tiendas
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rotate-45" style={{ background: "rgb(var(--serie-4))" }} aria-hidden />
        Mediana del Estado
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-full border-2 border-ink bg-granate" aria-hidden />
        Lo que se pagó en este contrato
      </span>
    </div>
  );
}

function FilaRenglon({ r }: { r: Renglon }) {
  const ref = estadoPrincipal(r);
  const t = tono(r);
  const listo = r.estado === "listo";
  const valores = [r.pagado, r.p75, r.mediana, ref?.mediana].filter((v): v is number => typeof v === "number" && v > 0);
  const tope = valores.length ? Math.max(...valores) * 1.12 : 0;
  const x = (v: number | null | undefined) => (v != null && tope > 0 ? `${Math.min(100, (v / tope) * 100)}%` : null);
  const producto = oracion(r.producto);
  const titulo = `${r.item}. ${producto}`;
  // Sin precio de tiendas ni del Estado no hay escala que dibujar: sólo el punto de lo pagado no dice nada.
  const conEscala = tope > 0 && ((listo && r.mediana != null) || !!ref);
  return (
    <Revelar
      titulo={titulo}
      descripcion={r.veredicto ?? (listo ? "Sin veredicto" : "Investigación en curso")}
      detalle={<DetalleRenglon r={r} />}
      ancho="lg"
      className="block w-full text-left"
      etiqueta={`Ver las ofertas y referencias del renglón ${r.item}`}
    >
      <div className="grid gap-2 px-5 py-3 transition-colors duration-rapido group-hover:bg-paperSoft sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)_auto] sm:items-center sm:gap-4">
        <div className="min-w-0">
          <p className="line-clamp-2 text-dato font-semibold leading-snug text-ink">
            <span className="mr-1.5 font-mono text-rotulo text-mute">{r.item}</span>
            {producto}
          </p>
          <p className="mt-0.5 text-rotulo text-mute">
            {r.cantidad != null ? `${numero(r.cantidad)} ${(r.unidad ?? "").toLowerCase()}`.trim() : "sin cantidad"}
            {r.pagado != null && <> a {soles(r.pagado)} cada uno</>}
          </p>
        </div>
        {conEscala ? (
        <div className="relative h-7" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-line" />
          {listo && r.p25 != null && r.p75 != null && tope > 0 && (
            <div
              className="absolute top-1/2 h-3 -translate-y-1/2 rounded-sm"
              style={{ left: x(r.p25)!, width: `calc(${x(r.p75)} - ${x(r.p25)})`, background: "rgb(var(--serie-2) / 0.35)" }}
            />
          )}
          {listo && r.mediana != null && (
            <div className="absolute top-1/2 h-4 w-0.5 -translate-y-1/2" style={{ left: x(r.mediana)!, background: "rgb(var(--serie-2))" }} />
          )}
          {ref && (
            <div
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45"
              style={{ left: x(ref.mediana)!, background: "rgb(var(--serie-4))" }}
            />
          )}
          {r.pagado != null && (
            <div
              className="absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink bg-granate"
              style={{ left: x(r.pagado)! }}
            />
          )}
        </div>
        ) : (
          <p className="text-rotulo text-mute">{listo || r.estado === "error" ? "Sin precios para comparar" : "Buscando precios…"}</p>
        )}
        <div className="flex items-center gap-2 sm:justify-end">
          {r.razon != null && r.cuenta && (
            <span
              className={cn(
                "font-mono text-dato font-semibold tabular-nums",
                t === "alto" ? "text-crimsonTexto" : t === "medio" ? "text-amberTexto" : "text-ink",
              )}
            >
              {decimal(r.razon, 2)}×
            </span>
          )}
          <span
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-rotulo font-semibold",
              t === "alto" ? "border-crimson/40 bg-crimson-soft text-crimsonTexto"
                : t === "medio" ? "border-amber/40 bg-amber-soft text-amberTexto"
                  : "border-line bg-paperSoft text-inkSoft",
            )}
          >
            {listo ? r.veredicto ?? "Sin veredicto" : r.estado === "error" ? "No se pudo investigar" : "Investigando"}
          </span>
        </div>
      </div>
    </Revelar>
  );
}

function DetalleRenglon({ r }: { r: Renglon }) {
  return (
    <CuerpoDetalle>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Cifra etiqueta="Se pagó" valor={r.pagado != null ? soles(r.pagado) : "Sin dato"} />
        <Cifra etiqueta="Mediana de tiendas" valor={r.mediana != null ? soles(r.mediana) : "Sin dato"} />
        <Cifra etiqueta="Ofertas válidas" valor={numero(r.validas)} />
        <Cifra etiqueta="Veces la mediana" valor={r.razon != null ? `${decimal(r.razon, 2)}×` : "Sin dato"} />
      </div>
      {r.nota && <p className="rounded-xl border border-line bg-paperSoft px-3.5 py-2.5 text-meta leading-relaxed text-inkSoft">{r.nota}</p>}
      <BloqueDetalle
        titulo="Lo que pagó el Estado por lo mismo"
        ayuda={
          <Ayuda titulo="¿Cómo se buscan?">
            Por el código CUBSO del ítem, si lo trae, y por las palabras que nombran el bien. Cada fuente da el cuartil 1, la
            mediana y el cuartil 3 en una sola unidad. Una unidad distinta («caja», «balde») no se compara con la del contrato.
          </Ayuda>
        }
      >
        {r.referencias.length ? (
          <ul className="divide-y divide-line/60 rounded-xl border border-line">
            {r.referencias.map((x, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <p className="text-meta font-semibold text-ink">{FUENTE_ESTADO[x.fuente] ?? x.fuente}</p>
                  <p className="text-rotulo text-mute">{x.detalle}</p>
                </div>
                <p className="shrink-0 text-right font-mono text-meta tabular-nums text-ink">
                  {soles(x.mediana)}
                  {x.p25 != null && x.p75 != null && (
                    <span className="block text-rotulo text-mute">
                      {soles(x.p25)} a {soles(x.p75)}
                    </span>
                  )}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-mute">No se hallaron compras del Estado con el mismo código ni con las mismas palabras.</p>
        )}
      </BloqueDetalle>
      <BloqueDetalle titulo={`Ofertas de tiendas (${numero(r.ofertas.length)})`}>
        {r.ofertas.length ? (
          <ul className="divide-y divide-line/60 rounded-xl border border-line">
            {r.ofertas.map((o, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3.5 py-2.5">
                <div className="min-w-0">
                  <a
                    href={o.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="inline-flex items-center gap-1 text-meta font-semibold text-ink underline-offset-2 hover:underline"
                  >
                    {o.tienda}
                    <ExternalLink size={12} aria-hidden />
                  </a>
                  <p className="text-rotulo text-mute">
                    {o.producto}
                    {o.marca && !o.producto.toUpperCase().includes(o.marca.toUpperCase()) ? `, ${o.marca}` : ""}
                  </p>
                </div>
                <p className="shrink-0 font-mono text-meta tabular-nums text-ink">{soles(o.precioUnitario)}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-meta text-mute">Ninguna oferta de tienda calzó con el producto y su unidad.</p>
        )}
      </BloqueDetalle>
      {r.investigado && <p className="text-rotulo text-mute">Investigado el {r.investigado.slice(0, 10)}.</p>}
    </CuerpoDetalle>
  );
}

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3 py-2">
      <p className="text-rotulo text-mute">{etiqueta}</p>
      <p className="mt-0.5 font-mono text-dato font-semibold tabular-nums text-ink">{valor}</p>
    </div>
  );
}
