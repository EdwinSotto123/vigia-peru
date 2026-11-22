import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Info, PackageSearch, Pill, RotateCw, ScanLine, ShoppingBag, TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { Paginas } from "@/components/salud/lista/Paginas";
import { FotoCaja } from "@/components/salud/medicamentos/FotoCaja";
import { OrdenYTipo, RielFormas, TarjetaMedicamento } from "@/components/salud/medicamentos/Catalogo";
import { FilaAlerta, FormMedicamento, InsigniaAlerta, nombreMed, textoRevisadas } from "@/components/salud/medicamentos/piezas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { buscarMedicamentos, fechaCorta, mesLargo, numero, rutaMedicamento, type FuenteMedicamentos } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { FORMAS, formaDe, type FormaGrupo } from "@/lib/salud-formas";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

// 12 por página: una grilla de 2, 3 o 4 columnas sin huecos (2026-11-22, el catálogo).
const POR_PAGINA = 12;

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
  { Icono: ScanLine, titulo: "Busca el registro sanitario", texto: "Está impreso en la caja: letras y números, como EE01234 o N-12345. O tómale una foto a la caja y lo leemos por ti." },
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
  // El lote de la caja, aparte (la foto lee el registro y el lote: q=EE08059&lote=2405123).
  const loteParam = texto(searchParams?.lote);
  const conLote: Record<string, string> = loteParam ? { lote: loteParam } : {};
  const lista = rutaEn(base, "/medicamentos");
  // El catálogo (2026-11-22): la forma, genérico o de marca, y el orden; lo que no se entiende se descarta.
  const formaParam = texto(searchParams?.forma);
  const forma = FORMAS.some((f) => f.clave === formaParam) ? (formaParam as FormaGrupo) : null;
  const tipoParam = texto(searchParams?.tipo);
  const tipo = tipoParam === "generico" || tipoParam === "marca" ? tipoParam : null;
  const ordenParam = texto(searchParams?.orden);
  const orden = ["relevancia", "populares", "precio", "nombre"].includes(ordenParam) ? ordenParam : null;
  const actual: Record<string, string | null> = { q: q || null, ...conLote, forma, tipo, orden };
  const urlCon = (cambio: Record<string, string | null | undefined>, n?: number) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...actual, ...cambio })) if (v) u.set(k, v);
    if (n && n > 1) u.set("pagina", String(n));
    const t = u.toString();
    return t ? `${lista}?${t}` : lista;
  };
  const params = new URLSearchParams({
    ...(q ? { q } : {}), ...conLote, ...(forma ? { forma } : {}), ...(tipo ? { tipo } : {}), ...(orden ? { orden } : {}),
    pagina: String(pagina), tamano: String(POR_PAGINA),
  });
  const d = await buscarMedicamentos(params);
  const href = (n: number) => urlCon({}, n);
  const formaActiva = d?.forma ? formaDe(d.forma) : null;
  const tituloCatalogo = q
    ? `${formaActiva ? formaActiva.etiqueta : "Productos"} para «${q}»`
    : formaActiva
      ? formaActiva.etiqueta
      : d?.orden === "precio"
        ? "Del más barato al más caro, por unidad"
        : d?.orden === "nombre"
          ? "Todo el catálogo, de la A a la Z"
          : "Los más vendidos";
  const paginas = d ? Math.min(200, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const fuente = d?.fuente;
  // Una alerta que nombra el registro o el lote que la persona escribió (lo de su caja) pesa más que una que nombra la marca.
  const porCaja = d?.como === "registro" || d?.como === "lote";
  // Con el lote de la caja aparte, arriba van sólo las filas de ese lote; las del registro, en la lista de alertas.
  const loteCaja = d?.loteCaja ?? null;
  const coincidencias = loteCaja ? (d?.coincidencias ?? []).filter((c) => c.coincideLote) : d?.coincidencias ?? [];
  // Se sabe que el lote de la caja no está en ninguna alerta: las del registro son de otros lotes (ámbar, no rojo).
  const loteLimpio = !!loteCaja && !d?.loteEnAlertas;
  const rojo = porCaja && !loteLimpio;
  const resaltar = loteCaja ?? (porCaja ? q : null);
  // Las alertas que ya salen arriba, con su producto y su lote, no se repiten en la caja de abajo.
  const yaVistas = new Set(coincidencias.map((c) => c.alertaId));
  const otras = (d?.alertas ?? []).filter((a) => !yaVistas.has(a.id));
  const otrasTotal = Math.max(0, (d?.alertasTotal ?? 0) - yaVistas.size);

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Medicamentos" }]} />
      <CabeceraLista
        className="mt-2"
        titulo="Verifica un medicamento"
        resumen={
          fuente && (
            <>
              <span>
                <b className="font-semibold tabular-nums text-ink">{numero(fuente.productos)}</b> medicamentos con precio y{" "}
                <b className="font-semibold tabular-nums text-ink">{numero(fuente.alertas)}</b> alertas de DIGEMID
              </span>
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
            </>
          )
        }
        acciones={
          <Link href={rutaEn(base, "/alertas")} className="gs-hunde inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/60 hover:text-granate sm:min-h-10">
            <TriangleAlert size={16} aria-hidden className="text-amberTexto" />
            <span className="sm:hidden">Alertas</span>
            <span className="hidden sm:inline">Todas las alertas</span>
          </Link>
        }
      />
      <FormMedicamento accion={lista} q={q} grande={!q} className="mt-4" />
      <FotoCaja accion={lista} className="mt-3" />
      {!q && (
        <ul className="mt-3 flex flex-wrap items-center gap-2 max-sm:hidden" aria-label="Búsquedas de ejemplo">
          <li className="text-meta text-mute">Prueba con</li>
          {[
            { t: "Paracetamol", q: "paracetamol", que: "principio activo" },
            { t: "Panadol", q: "panadol", que: "marca" },
            { t: "EE08059", q: "EE08059", que: "registro sanitario" },
          ].map((x) => (
            <li key={x.q}>
              <Link
                href={`${lista}?${new URLSearchParams({ q: x.q })}`}
                className="gs-hunde inline-flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-meta font-medium text-ink hover:border-granate/60 hover:bg-granate-50/60 sm:min-h-9"
              >
                {x.t} <span className="text-mute max-sm:sr-only">{x.que}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

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
      ) : (
        <>
          {/* El catálogo (2026-11-22, «QUE SEA TIPO MARKETPLACE»): el riel de formas, genérico o de marca, y el orden. */}
          {d.facetas && (
            <div className="mt-5 space-y-3">
              <RielFormas facetas={d.facetas} activa={d.forma ?? null} href={(f) => urlCon({ forma: f })} />
              <OrdenYTipo d={d} conBusqueda={!!q} href={(c) => urlCon(c)} />
            </div>
          )}

          {q && (
            <>
          {/* El veredicto de la caja (registro y lote juntos, de la foto): cuando el lote no está en una tabla leída. */}
          {loteCaja && coincidencias.length === 0 && (
            <VeredictoCaja lote={loteCaja} enAlertas={d.loteEnAlertas ?? 0} registro={d.registro ?? null} alertasRegistro={otrasTotal} fuente={fuente ?? null} />
          )}

          {/* Lo más fuerte primero: el lote o el registro escrito está, tal cual, en la tabla de una alerta. */}
          {coincidencias.length > 0 && (
            <section aria-labelledby="coincide-t" className="mt-6 rounded-2xl border-2 border-crimson/50 bg-crimson-soft/60 px-5 py-4">
              <h2 id="coincide-t" className="flex items-start gap-2 font-display text-bloque font-bold leading-snug text-crimsonTexto">
                <TriangleAlert size={20} aria-hidden className="mt-0.5 shrink-0" />
                {loteCaja ? `Tu lote ${loteCaja}` : d.como === "lote" ? "Ese lote" : "Ese registro sanitario"} está en{" "}
                {coincidencias.length === 1 ? "una alerta" : `${coincidencias.length} alertas`} de DIGEMID
              </h2>
              <ul className="mt-3 grid gap-2">
                {coincidencias.map((c, i) => (
                  <li key={`${c.alertaId}-${i}`} className="rounded-xl border border-crimson/25 bg-paper px-3.5 py-2.5">
                    <p className="text-dato font-semibold text-ink">
                      {c.producto}
                      {c.presentacion && <span className="font-normal text-inkSoft">, {c.presentacion}</span>}
                    </p>
                    <p className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-meta text-inkSoft">
                      {c.lote && <span>Lote <b className="font-mono font-semibold text-ink">{c.lote}</b></span>}
                      {c.vencimiento && <span>Vence {c.vencimiento}</span>}
                      {c.registro && (
                        <span>
                          R.S.{" "}
                          {c.medicamento ? (
                            <Link href={rutaEn(base, rutaMedicamento(c.medicamento))} className="font-mono text-ink underline decoration-line underline-offset-2 hover:decoration-granate">
                              {c.registro}
                            </Link>
                          ) : (
                            <span className="font-mono text-ink">{c.registro}</span>
                          )}
                        </span>
                      )}
                      {c.titular && <span>{nombreMed(c.titular)}</span>}
                    </p>
                    {c.detalle && <p className="mt-0.5 text-meta text-inkSoft">{c.detalle}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-meta">
                      <InsigniaAlerta tipo={c.tipo} />
                      <span className="text-mute">{c.numero ? `Alerta N.° ${c.numero}` : "Alerta"}, {fechaCorta(c.fecha)}</span>
                      {c.pdfUrl && (
                        <a href={c.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
                          La alerta en PDF<span className="sr-only"> (se abre en otra pestaña)</span>
                        </a>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-dato leading-relaxed text-ink">
                Si es el de tu caja: no lo uses, guárdalo y pregunta en la farmacia o establecimiento donde lo compraste.
              </p>
            </section>
          )}

          {/* Primero la salud: si alguna alerta lo nombra (sin repetir las de arriba). */}
          {otrasTotal > 0 && otras.length > 0 ? (
            <section
              aria-labelledby="alertas-t"
              className={cn("mt-6 rounded-2xl border", rojo ? "border-crimson/30 bg-crimson-soft/40" : "border-amber/40 bg-amber-soft/40")}
            >
              <div className={cn("flex gap-3 border-b px-5 py-4", rojo ? "border-crimson/20" : "border-amber/30")}>
                <TriangleAlert size={22} aria-hidden className={cn("mt-0.5 shrink-0", rojo ? "text-crimsonTexto" : "text-amberTexto")} />
                <div>
                  <h2 id="alertas-t" className="font-display text-bloque font-bold leading-snug text-ink">
                    {yaVistas.size > 0
                      ? otrasTotal === 1
                        ? "Otra alerta nombra"
                        : `Otras ${numero(otrasTotal)} alertas nombran`
                      : otrasTotal === 1
                        ? "Una alerta de DIGEMID nombra"
                        : `${numero(otrasTotal)} alertas de DIGEMID nombran`}{" "}
                    «{q}»
                  </h2>
                  <p className="mt-1 max-w-[75ch] text-meta leading-relaxed text-inkSoft">
                    {rojo
                      ? `El ${d.como === "lote" ? "lote" : "registro sanitario"} que escribiste aparece en la alerta. Si es el de tu caja, no lo uses y pregunta en la farmacia o llama a DIGEMID.`
                      : "Compara el lote y el registro de tu caja con los de la alerta: muchas son de falsificaciones o de un solo lote, no de todo el producto."}
                  </p>
                </div>
              </div>
              {/* Tres: el resto en /alertas (la página no se alarga). */}
              <ul className={cn("divide-y", rojo ? "divide-crimson/15" : "divide-amber/25")}>
                {otras.slice(0, porCaja ? 3 : 1).map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} base={base} resaltar={resaltar} />
                  </li>
                ))}
              </ul>
              {otrasTotal > (porCaja ? 3 : 1) && (
                <p className={cn("border-t px-5 py-3", rojo ? "border-crimson/20" : "border-amber/30")}>
                  <Link href={`${rutaEn(base, "/alertas")}?${new URLSearchParams({ q })}`} className="inline-flex min-h-11 items-center text-meta font-semibold text-granate underline-offset-4 hover:underline sm:min-h-8">
                    Ver las {numero(d.alertasTotal)} alertas
                  </Link>
                </p>
              )}
            </section>
          ) : yaVistas.size > 0 || loteCaja ? null : (
            <p className="mt-6 flex gap-3 rounded-2xl border border-line bg-paper px-5 py-4 text-dato leading-relaxed text-inkSoft">
              <CircleCheck size={20} aria-hidden className="mt-0.5 shrink-0 text-mossTexto" />
              <span>
                <b className="font-semibold text-ink">Ninguna alerta de DIGEMID nombra «{q}».</b> {fuente ? textoRevisadas(fuente.alertas, fuente.ultimaAlerta) : ""}{" "}
                Eso no garantiza un producto: cómpralo en una farmacia o botica y revisa que la caja tenga su registro sanitario.
              </span>
            </p>
          )}

            </>
          )}

          {d.filas.length === 0 ? (
            <div className="mt-5 rounded-2xl border border-line bg-paper">
              <EstadoVacio
                Icono={Pill}
                titulo={
                  d.como === "lote"
                    ? "Un lote no tiene precio: no hay productos que mostrar"
                    : forma || tipo
                      ? "Ningún medicamento con estos filtros"
                      : "Ningún medicamento con precio se llama así"
                }
                texto={
                  d.como === "lote"
                    ? "Arriba está lo que dicen las alertas sobre ese lote. Para ver el producto, busca su nombre o su registro sanitario."
                    : "Prueba con el principio activo (paracetamol, amoxicilina) o con menos palabras. Sólo están los productos con precios reportados a DIGEMID."
                }
              />
            </div>
          ) : (
            <section aria-labelledby="productos-t" className="mt-6">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <h2 id="productos-t" className="font-display text-bloque font-bold leading-snug text-ink">
                  {tituloCatalogo}
                </h2>
                <p className="text-meta text-inkSoft">
                  <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "producto" : "productos"}
                </p>
              </div>
              <ul id="resultados" className="mt-3 grid scroll-mt-32 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Medicamentos">
                {d.filas.map((m) => (
                  <li key={m.codigo} className="min-w-0">
                    <TarjetaMedicamento m={m} base={base} />
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

          {/* Sin búsqueda, debajo del catálogo: cómo verificar la caja y las alertas más recientes. */}
          {!q && (
        <div className="mt-10 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start">
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
                  <FilaAlerta a={a} base={base} resaltar={resaltar} sinTabla conDibujo />
                </li>
              ))}
            </ul>
            {fuente && <FuenteFecha nombre="Alertas DIGEMID" url={fuente.avisos.url} al={fuente.avisos.al} className="border-t border-line px-5 py-3" />}
          </section>
        </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * El veredicto de una caja (2026-11-22, la foto de la caja: registro y lote juntos), cuando el lote no está en la tabla
 * leída de ninguna alerta: si aparece en el texto de un PDF (rojo, revisar), si hay alertas del registro pero de otros
 * lotes (ámbar) o si ni el registro ni el lote figuran (verde, con la fecha de lo revisado). Nunca «es seguro».
 */
function VeredictoCaja({
  lote,
  enAlertas,
  registro,
  alertasRegistro,
  fuente,
}: {
  lote: string;
  enAlertas: number;
  registro: string | null;
  alertasRegistro: number;
  fuente: FuenteMedicamentos | null;
}) {
  const tono = enAlertas > 0 ? "rojo" : alertasRegistro > 0 && registro ? "ambar" : "verde";
  const Icono = tono === "verde" ? CircleCheck : tono === "rojo" ? TriangleAlert : Info;
  return (
    <section
      aria-labelledby="veredicto-t"
      className={cn(
        "mt-6 rounded-2xl border-2 px-5 py-4",
        tono === "rojo" ? "border-crimson/50 bg-crimson-soft/60" : tono === "ambar" ? "border-amber/50 bg-amber-soft/50" : "border-moss/40 bg-moss/[0.07]",
      )}
    >
      <h2
        id="veredicto-t"
        className={cn(
          "flex items-start gap-2 font-display text-bloque font-bold leading-snug",
          tono === "rojo" ? "text-crimsonTexto" : tono === "ambar" ? "text-amberTexto" : "text-mossTexto",
        )}
      >
        <Icono size={20} aria-hidden className="mt-0.5 shrink-0" />
        {tono === "rojo"
          ? `Tu lote ${lote} aparece en ${enAlertas === 1 ? "una alerta" : `${numero(enAlertas)} alertas`} de DIGEMID`
          : tono === "ambar"
            ? `Tu lote ${lote} no figura en las alertas de DIGEMID`
            : registro
              ? `Ni el registro ${registro} ni el lote ${lote} figuran en las alertas de DIGEMID`
              : `El lote ${lote} no figura en las alertas de DIGEMID`}
      </h2>
      <p className="mt-1.5 max-w-[75ch] text-dato leading-relaxed text-ink">
        {tono === "rojo"
          ? "Está en el texto de la alerta, abajo: revisa si es tu producto. Si lo es, no lo uses, guárdalo y pregunta en la farmacia o botica donde lo compraste."
          : tono === "ambar"
            ? `Hay ${alertasRegistro === 1 ? "una alerta" : `${numero(alertasRegistro)} alertas`} sobre el registro ${registro}, de otros lotes o de productos falsificados con ese registro. Compara tu caja con cada una, abajo.`
            : `${fuente ? textoRevisadas(fuente.alertas, fuente.ultimaAlerta) : ""} Eso no garantiza el producto: cómpralo en una farmacia o botica y revisa que la caja esté sellada y sin enmendaduras.`}
      </p>
    </section>
  );
}
