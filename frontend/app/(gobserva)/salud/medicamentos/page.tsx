import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, PackageSearch, Pill, RotateCw, ScanLine, ShoppingBag, TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { Paginas } from "@/components/salud/lista/Paginas";
import { FilaAlerta, FilaMedicamento, FormMedicamento, textoRevisadas } from "@/components/salud/medicamentos/piezas";
import { Encabezado, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { buscarMedicamentos, mesLargo, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const POR_PAGINA = 10;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

export function generateMetadata({ searchParams }: Props): Metadata {
  const q = texto(searchParams?.q);
  return {
    title: q ? `«${q}»: alertas DIGEMID y precio de referencia` : "Verifica un medicamento: alertas DIGEMID y precio de referencia",
    description:
      "Escribe el nombre, el principio activo, el registro sanitario o el lote de un medicamento: te decimos si DIGEMID emitió una alerta (falsificado, lote retirado) y cuánto cuesta en farmacias y boticas, con genéricos equivalentes.",
    alternates: { canonical: urlCanonica("salud", "/medicamentos") },
    robots: q ? { index: false, follow: true } : undefined,
  };
}

/** Los tres pasos con la caja en la mano (sin búsqueda). */
const PASOS = [
  { Icono: ScanLine, titulo: "Busca el registro sanitario", texto: "Está impreso en la caja: dos letras y cinco números, como EE01234 o N-12345." },
  { Icono: PackageSearch, titulo: "Mira el lote y el vencimiento", texto: "Si DIGEMID retiró un lote, la alerta dice cuál. Escríbelo aquí tal como sale en la caja." },
  { Icono: ShoppingBag, titulo: "Compra en una farmacia o botica", texto: "No en redes sociales, ferias ni ambulantes: ahí aparecen la mayoría de los falsificados." },
];

/**
 * /medicamentos de Gobserva Salud (2026-11-21, el usuario: «verificación de medicamentos»): un solo buscador por nombre,
 * principio activo, registro sanitario o lote. Primero lo que importa para la salud (si DIGEMID emitió una alerta que lo
 * nombra), después los productos con su precio de referencia, 10 por página. Sin búsqueda: cómo verificar la caja y las
 * alertas más recientes. GET /salud/medicamentos (10 min en caché).
 */
export default async function Medicamentos({ searchParams }: Props) {
  const base = baseProducto("salud");
  const q = texto(searchParams?.q);
  const pagina = Math.max(1, Number(texto(searchParams?.pagina)) || 1);
  const params = new URLSearchParams({ ...(q ? { q } : {}), pagina: String(pagina), tamano: String(POR_PAGINA) });
  const d = await buscarMedicamentos(params);
  const lista = rutaEn(base, "/medicamentos");
  const href = (n: number) => `${lista}?${new URLSearchParams({ q, pagina: String(n) })}`;
  const paginas = d ? Math.min(200, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const fuente = d?.fuente;
  // Una alerta que nombra el registro o el lote que la persona escribió (lo de su caja) pesa más que una que nombra la marca.
  const porCaja = d?.como === "registro" || d?.como === "lote";

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Medicamentos" }]} />
      <Encabezado
        figura="frasco"
        className="mt-2"
        titulo="Verifica un medicamento"
        bajada="Con su nombre, su registro sanitario o el lote de la caja: si DIGEMID emitió una alerta y cuánto cuesta en farmacias."
      >
        <FormMedicamento accion={lista} q={q} grande />
        {!q && (
          <ul className="mt-3 flex flex-wrap items-center gap-2" aria-label="Búsquedas de ejemplo">
            {[
              { t: "Paracetamol", q: "paracetamol", que: "principio activo" },
              { t: "Panadol", q: "panadol", que: "marca" },
              { t: "EE08059", q: "EE08059", que: "registro sanitario" },
            ].map((x) => (
              <li key={x.q}>
                <Link
                  href={`${lista}?${new URLSearchParams({ q: x.q })}`}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-medium text-ink transition-colors duration-rapido hover:border-granate/50 sm:min-h-9"
                >
                  {x.t} <span className="text-mute max-sm:sr-only">{x.que}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {fuente && (
          <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-inkSoft">
            {numero(fuente.productos)} medicamentos con precio y {numero(fuente.alertas)} alertas de DIGEMID.
            <Ayuda titulo="¿De dónde sale esto?" etiqueta="De dónde salen los medicamentos">
              <span className="block">
                <b className="font-semibold">Las alertas</b> son las que DIGEMID publica en su web (falsificados, lotes retirados por control de
                calidad, seguridad), con su PDF.
              </span>
              <span className="mt-1 block">
                <b className="font-semibold">Los precios</b> son del Observatorio de DIGEMID: lo que reportan las farmacias y boticas privadas, por
                unidad, en {mesLargo(fuente.precios.al)}. No son los del día ni los de una farmacia en particular.
              </span>
              <span className="mt-1 block">No es el registro sanitario completo: sólo los productos con precios reportados.</span>
            </Ayuda>
          </p>
        )}
      </Encabezado>

      {!d ? (
        <div className="mt-6 rounded-2xl border border-line bg-paper">
          <EstadoError
            texto="No pudimos buscar ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
            acciones={
              <a href={q ? href(pagina) : lista} className={claseAccion("secundario", "min-h-11")}>
                <RotateCw size={15} aria-hidden /> Volver a intentar
              </a>
            }
          />
        </div>
      ) : !q ? (
        <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start">
          <section aria-labelledby="pasos-t" className="tarjeta rounded-2xl border border-line bg-paper px-5 py-5">
            <h2 id="pasos-t" className="font-display text-bloque font-bold text-ink">Con la caja en la mano</h2>
            <ol className="mt-3 space-y-4">
              {PASOS.map(({ Icono, titulo, texto: t }) => (
                <li key={titulo} className="flex gap-3">
                  <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50 text-granate">
                    <Icono size={19} />
                  </span>
                  <span>
                    <span className="block text-dato font-semibold text-ink">{titulo}</span>
                    <span className="mt-0.5 block text-meta leading-relaxed text-inkSoft">{t}</span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section aria-labelledby="recientes-t" className="tarjeta rounded-2xl border border-line bg-paper">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line px-5 py-4">
              <h2 id="recientes-t" className="font-display text-bloque font-bold text-ink">Las alertas más recientes</h2>
              <Link href={rutaEn(base, "/alertas")} className="inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
                Ver todas
              </Link>
            </div>
            <ul className="divide-y divide-line">
              {d.alertas.slice(0, 3).map((a) => (
                <li key={a.id}>
                  <FilaAlerta a={a} />
                </li>
              ))}
            </ul>
            {fuente && <FuenteFecha nombre="Alertas DIGEMID" url={fuente.avisos.url} al={fuente.avisos.al} className="border-t border-line px-5 py-3" />}
          </section>
        </div>
      ) : (
        <>
          {/* Primero la salud: si alguna alerta lo nombra. */}
          {d.alertasTotal ? (
            <section
              aria-labelledby="alertas-t"
              className={cn("mt-6 rounded-2xl border", porCaja ? "border-crimson/30 bg-crimson-soft/40" : "border-amber/40 bg-amber-soft/40")}
            >
              <div className={cn("flex gap-3 border-b px-5 py-4", porCaja ? "border-crimson/20" : "border-amber/30")}>
                <TriangleAlert size={22} aria-hidden className={cn("mt-0.5 shrink-0", porCaja ? "text-crimsonTexto" : "text-amberTexto")} />
                <div>
                  <h2 id="alertas-t" className="font-display text-bloque font-bold leading-snug text-ink">
                    {d.alertasTotal === 1 ? "Una alerta de DIGEMID nombra" : `${numero(d.alertasTotal)} alertas de DIGEMID nombran`} «{q}»
                  </h2>
                  <p className="mt-1 max-w-[75ch] text-meta leading-relaxed text-inkSoft">
                    {porCaja
                      ? `El ${d.como === "lote" ? "lote" : "registro sanitario"} que escribiste aparece en la alerta. Si es el de tu caja, no lo uses y pregunta en la farmacia o llama a DIGEMID.`
                      : "Compara el lote y el registro de tu caja con los de la alerta: muchas son de falsificaciones o de un solo lote, no de todo el producto."}
                  </p>
                </div>
              </div>
              {/* Tres: el resto en /alertas (la página no se alarga). */}
              <ul className={cn("divide-y", porCaja ? "divide-crimson/15" : "divide-amber/25")}>
                {d.alertas.slice(0, 3).map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} />
                  </li>
                ))}
              </ul>
              {d.alertasTotal > 3 && (
                <p className={cn("border-t px-5 py-3", porCaja ? "border-crimson/20" : "border-amber/30")}>
                  <Link href={`${rutaEn(base, "/alertas")}?${new URLSearchParams({ q })}`} className="inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
                    Ver las {numero(d.alertasTotal)} alertas
                  </Link>
                </p>
              )}
            </section>
          ) : (
            <p className="mt-6 flex gap-3 rounded-2xl border border-line bg-paper px-5 py-4 text-dato leading-relaxed text-inkSoft">
              <CircleCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
              <span>
                <b className="font-semibold text-ink">Ninguna alerta de DIGEMID nombra «{q}».</b> {fuente ? textoRevisadas(fuente.alertas, fuente.ultimaAlerta) : ""}{" "}
                Eso no garantiza un producto: cómpralo en una farmacia o botica y revisa que la caja tenga su registro sanitario.
              </span>
            </p>
          )}

          {d.filas.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-line bg-paper">
              <EstadoVacio
                Icono={Pill}
                titulo={d.como === "lote" ? "Un lote no tiene precio: no hay productos que mostrar" : "Ningún medicamento con precio se llama así"}
                texto={
                  d.como === "lote"
                    ? "Arriba está lo que dicen las alertas sobre ese lote. Para ver el producto, busca su nombre o su registro sanitario."
                    : "Prueba con el principio activo (paracetamol, amoxicilina) o con menos palabras. Sólo están los productos con precios reportados a DIGEMID."
                }
              />
            </div>
          ) : (
            <section aria-labelledby="productos-t" className="mt-6">
              <h2 id="productos-t" className="sr-only">
                Medicamentos
              </h2>
              <div id="resultados" className="scroll-mt-32">
                <Paginas pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "medicamento" : "medicamentos"} href={href} />
              </div>
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper" aria-label="Medicamentos">
                {d.filas.map((m) => (
                  <li key={m.codigo}>
                    <FilaMedicamento m={m} base={base} />
                  </li>
                ))}
              </ul>
              <p className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                {fuente && <FuenteFecha nombre="Observatorio de precios de DIGEMID" url={fuente.precios.url} al={fuente.precios.al} />}
                <span className="text-rotulo text-mute">Precio típico por unidad en farmacias y boticas privadas.</span>
              </p>
              {paginas > 1 && (
                <Paginas className="mt-5" pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "medicamento" : "medicamentos"} href={href} />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
