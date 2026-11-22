import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, Info, Pill, RotateCw, ScanSearch, ShieldCheck, Tag, TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { Paginas } from "@/components/salud/lista/Paginas";
import { FotoCaja } from "@/components/salud/medicamentos/FotoCaja";
import { AlertasRecientes, ComoVerificar, PortadaMedicamentos } from "@/components/salud/medicamentos/Portada";
import { Pestanas } from "@/components/patrones/Pestanas";
import { OrdenYTipo, RielFormas, TarjetaMedicamento } from "@/components/salud/medicamentos/Catalogo";
import { FilaAlerta, FormMedicamento, InsigniaAlerta, nombreMed, textoRevisadas } from "@/components/salud/medicamentos/piezas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { buscarMedicamentos, fechaCorta, getAlertas, mesLargo, numero, rutaMedicamento, type FuenteMedicamentos } from "@/lib/gobserva-salud";
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
  // ?modo=foto abre la pestaña de la foto (desde «El vencimiento»); ?seccion=, la pestaña de abajo.
  const modoFoto = texto(searchParams?.modo) === "foto";
  const seccion = texto(searchParams?.seccion) || undefined;
  const tituloCatalogo = q
    ? d?.aproximado
      ? formaActiva
        ? `${formaActiva.etiqueta} parecidos`
        : "Productos parecidos"
      : `${formaActiva ? formaActiva.etiqueta : "Productos"} para «${q}»`
    : formaActiva
      ? formaActiva.etiqueta
      : d?.orden === "precio"
        ? "Del más barato al más caro, por unidad"
        : d?.orden === "nombre"
          ? "Todo el catálogo, de la A a la Z"
          : "Los más vendidos";
  const paginas = d ? Math.min(1000, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
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
  // Las alertas que nombran lo buscado, todas y aquí mismo, 10 por página (?apag=): antes eran una o tres y «Ver las 31»
  // llevaba a otra página. Se buscan por el registro, el lote o las palabras del nombre (alertasPor), como la API.
  const apag = Math.max(1, Number(texto(searchParams?.apag)) || 1);
  const POR_PAGINA_ALERTAS = 10;
  const textoAlertas = d ? d.registro ?? d.lote ?? d.alertasPor ?? q : "";
  const listaAlertas =
    q && d && (d.alertasTotal ?? 0) > 0 && textoAlertas
      ? await getAlertas(new URLSearchParams({ q: textoAlertas, pagina: String(apag), tamano: String(POR_PAGINA_ALERTAS) }))
      : null;
  const otras = (listaAlertas?.filas ?? d?.alertas ?? []).filter((a) => !yaVistas.has(a.id));
  const otrasTotal = Math.max(0, (listaAlertas?.total ?? d?.alertasTotal ?? 0) - yaVistas.size);
  const paginasAlertas = Math.min(500, Math.max(1, Math.ceil(otrasTotal / POR_PAGINA_ALERTAS)));
  const hrefAlertas = (n: number) => urlCon({ seccion: "alertas", apag: n > 1 ? String(n) : null });

  // El catálogo en su sección (2026-11-22, «¿por qué esto está abajo en el aire?»): el título con lo que suma, el riel
  // de formas y el orden, las tarjetas y, en su pie, la fuente y las páginas. Con búsqueda va debajo de las alertas; sin
  // búsqueda, en la primera pestaña.
  const catalogo = d ? (
    <section aria-labelledby="productos-t" className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5 sm:py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id="productos-t" className="font-display text-bloque font-bold leading-snug text-ink">
          {tituloCatalogo}
        </h2>
        <p className="text-meta text-inkSoft">
          <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "producto" : "productos"}
          {d.aproximado ? ", los más parecidos" : ""}
        </p>
      </div>
      {d.aproximado && (
        <p className="mt-2 flex gap-2 rounded-xl bg-amber-soft/50 px-3 py-2 text-meta leading-relaxed text-ink">
          <Info size={15} aria-hidden className="mt-0.5 shrink-0 text-amberTexto" />
          <span>
            Ningún producto tiene todas las palabras de «{q}». Estos son los que más se parecen: revisa el nombre, la concentración y la forma
            con tu caja.
          </span>
        </p>
      )}
      {d.facetas && d.total > 6 && (
        <div className="mt-4 space-y-3">
          <RielFormas facetas={d.facetas} activa={d.forma ?? null} href={(f) => urlCon({ forma: f })} />
          <OrdenYTipo d={d} conBusqueda={!!q} href={(c) => urlCon(c)} />
        </div>
      )}
      {d.filas.length === 0 ? (
        <div className="mt-4 rounded-xl border border-line">
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
                : forma || tipo
                  ? "Quita un filtro: elige «Todas» las formas o «Todos»."
                  : "Prueba sólo con la marca (Panadol) o con el principio activo (paracetamol). Sólo están los productos con precios reportados a DIGEMID."
            }
          />
        </div>
      ) : (
        <>
          <ul id="resultados" className="mt-4 grid scroll-mt-32 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-label="Medicamentos">
            {d.filas.map((m) => (
              <li key={m.codigo} className="min-w-0">
                <TarjetaMedicamento m={m} base={base} />
              </li>
            ))}
          </ul>
          <div className="mt-5 border-t border-line pt-4">
            <p className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              {fuente && <FuenteFecha nombre="Observatorio de precios de DIGEMID" url={fuente.precios.url} al={fuente.precios.al} />}
              <span className="text-rotulo text-mute">Precio típico por unidad en farmacias y boticas privadas.</span>
            </p>
            {paginas > 1 && (
              <Paginas className="mt-4" pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "medicamento" : "medicamentos"} href={href} />
            )}
          </div>
        </>
      )}
    </section>
  ) : null;

  // El validador de alertas: lo de una caja (registro, lote, foto) va primero y se abre de entrada.
  const validadorPrimero = porCaja || !!loteCaja;
  const pestanaValidador = d
    ? {
        clave: "alertas",
        etiqueta: "Validador de alertas",
        icono: <ShieldCheck size={15} aria-hidden />,
        conteo: coincidencias.length || d.alertasTotal || null,
        contenido: (
          <div className="flex flex-col gap-5 [&>*]:!mt-0">
            {!validadorPrimero && <ValidadorCaja lista={lista} />}
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
              className={cn("mt-6 overflow-hidden rounded-2xl border", rojo ? "border-crimson/30 bg-crimson-soft/40" : "border-amber/40 bg-amber-soft/40")}
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
                    «{d.alertasPor && d.alertasPor !== q.toUpperCase() ? nombreMed(d.alertasPor) : q}»
                  </h2>
                  <p className="mt-1 max-w-[75ch] text-meta leading-relaxed text-inkSoft">
                    {rojo
                      ? `El ${d.como === "lote" ? "lote" : "registro sanitario"} que escribiste aparece en la alerta. Si es el de tu caja, no lo uses y pregunta en la farmacia o llama a DIGEMID.`
                      : "Compara el lote y el registro de tu caja con los de la alerta: muchas son de falsificaciones o de un solo lote, no de todo el producto."}
                  </p>
                </div>
              </div>
              {/* Todas aquí, 10 por página y con su tabla plegada: no hay que ir a otra página. */}
              <ul className={cn("divide-y bg-paper", rojo ? "divide-crimson/15" : "divide-amber/25")}>
                {otras.map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} base={base} resaltar={resaltar} plegada={!porCaja} />
                  </li>
                ))}
              </ul>
              {paginasAlertas > 1 && (
                <div className={cn("border-t bg-paper px-5 py-4", rojo ? "border-crimson/20" : "border-amber/30")}>
                  <Paginas
                    pagina={Math.min(apag, paginasAlertas)}
                    paginas={paginasAlertas}
                    total={otrasTotal}
                    tamano={POR_PAGINA_ALERTAS}
                    nombre={otrasTotal === 1 ? "alerta" : "alertas"}
                    href={hrefAlertas}
                  />
                </div>
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

          </div>
        ),
      }
    : null;

  return (
    <div className="container-page pb-10 pt-5 sm:pb-14 sm:pt-6">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Medicamentos" }]} />
      {q ? (
        <>
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
          <FormMedicamento accion={lista} q={q} className="mt-4" />
          <FotoCaja accion={lista} className="mt-3" />
        </>
      ) : (
        <PortadaMedicamentos lista={lista} fuente={fuente ?? null} modoInicial={modoFoto ? "foto" : "texto"} />
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
      ) : q ? (
        // 2026-11-22 (el usuario: «se ve muy mal poniendo alerta encima de otro; quisiera un orden: buscador de precios y
        // validador de alertas»): dos herramientas en pestañas. Lo de una caja (registro, lote, foto) abre el validador.
        <Pestanas
          className="mt-6"
          etiqueta={`Resultados de «${q}»`}
          activa={seccion}
          pestanas={[
            ...(validadorPrimero && pestanaValidador ? [pestanaValidador] : []),
            {
              clave: "precios",
              etiqueta: "Buscador de precios",
              icono: <Tag size={15} aria-hidden />,
              conteo: d.total,
              contenido: catalogo,
            },
            ...(!validadorPrimero && pestanaValidador ? [pestanaValidador] : []),
          ]}
        />
      ) : (
        // Sin búsqueda, cada cosa en su pestaña (DESIGN_SYSTEM §14.3): el catálogo, las alertas recientes y cómo verificar.
        <Pestanas
          className="mt-8"
          etiqueta="Secciones de Verifica un medicamento"
          activa={seccion}
          pestanas={[
            { clave: "catalogo", etiqueta: "Buscador de precios", icono: <Tag size={15} aria-hidden />, conteo: d.total, contenido: catalogo },
            {
              clave: "alertas",
              etiqueta: "Validador de alertas",
              icono: <ShieldCheck size={15} aria-hidden />,
              contenido: (
                <div className="flex flex-col gap-5">
                  <ValidadorCaja lista={lista} />
                  <AlertasRecientes base={base} alertas={d.alertas} fuente={fuente ?? null} />
                </div>
              ),
            },
            {
              clave: "verificar",
              etiqueta: "Cómo verificar",
              icono: <Info size={15} aria-hidden />,
              contenido: <ComoVerificar base={base} lista={lista} fuente={fuente ?? null} />,
            },
          ]}
        />
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

/**
 * El campo del validador: el registro sanitario o el lote de una caja (una forma GET a esta misma página). Lo que se
 * escribe con forma de registro o de lote da el veredicto de arriba; la foto lee los dos a la vez.
 */
function ValidadorCaja({ lista }: { lista: string }) {
  return (
    <form action={lista} className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <label htmlFor="validar-caja" className="block font-display text-bloque font-bold leading-snug text-ink">
        ¿Tu caja tiene una alerta?
      </label>
      <p className="mt-0.5 text-meta text-inkSoft">Escribe el registro sanitario (R.S., como EE01234) o el lote, tal como están impresos.</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="validar-caja"
          name="q"
          required
          minLength={4}
          autoComplete="off"
          spellCheck={false}
          placeholder="Registro sanitario o lote"
          className="h-12 min-h-12 w-full min-w-0 rounded-xl border border-line bg-paper px-3 font-mono text-destacado text-ink placeholder:font-sans placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/25 sm:flex-1"
        />
        <button
          type="submit"
          className="gs-hunde inline-flex h-12 shrink-0 items-center justify-center gap-2 rounded-xl bg-granate px-5 text-dato font-semibold text-paper hover:bg-granate-deep"
        >
          <ScanSearch size={17} aria-hidden /> Validar
        </button>
      </div>
    </form>
  );
}
