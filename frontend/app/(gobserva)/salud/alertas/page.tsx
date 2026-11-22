import type { Metadata } from "next";
import Link from "next/link";
import { Pill, RotateCw, TriangleAlert } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha } from "@/components/salud/comun";
import { BarraFiltros, ProveedorFiltros, Resultados } from "@/components/salud/filtros/BarraFiltros";
import { Paginas } from "@/components/salud/lista/Paginas";
import { FilaAlerta, InsigniaAlerta, nombreMed } from "@/components/salud/medicamentos/piezas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { fechaCorta, getAlertas, getProductosAlerta, numero, rutaMedicamento, TIPOS_ALERTA, type TipoAlerta } from "@/lib/gobserva-salud";
import { cn } from "@/lib/utils";
import { baseProducto } from "@/lib/gobserva-servidor";
import { Pixel } from "@/components/pixel/Pixel";
import { formaDe, grupoDeTexto } from "@/lib/salud-formas";

export const dynamic = "force-dynamic";

const POR_PAGINA = 10;
const ORDEN: TipoAlerta[] = ["falsificado", "calidad", "seguridad", "modificacion", "internacional", "otra"];

type Props = { searchParams?: Record<string, string | string[] | undefined> };
const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v.trim().slice(0, 80) : "");
const tipoDe = (v: string | string[] | undefined): TipoAlerta | undefined => (ORDEN.includes(texto(v) as TipoAlerta) ? (texto(v) as TipoAlerta) : undefined);

export function generateMetadata({ searchParams }: Props): Metadata {
  const tipo = tipoDe(searchParams?.tipo);
  const q = texto(searchParams?.q);
  return {
    title: tipo ? `Alertas DIGEMID: ${TIPOS_ALERTA[tipo].nombre.toLowerCase().replace(/^alertas /, "")}` : "Alertas DIGEMID de medicamentos y dispositivos",
    description: "Las alertas de DIGEMID sobre productos falsificados, lotes retirados por control de calidad, seguridad y modificaciones, cada una con su PDF oficial.",
    alternates: { canonical: urlCanonica("salud", "/alertas") },
    robots: tipo || q ? { index: false, follow: true } : undefined,
  };
}

/**
 * /alertas de Gobserva Salud: las alertas DIGEMID, de la más nueva a la más vieja, 10 por página. 2026-11-22: la franja con
 * cuántas hay, la barra con el tipo (falsificados primero, con cuántas de cada uno) y la búsqueda por producto o lote, que
 * se aplican sin recargar. GET /salud/alertas (10 min en caché).
 */
export default async function Alertas({ searchParams }: Props) {
  const base = baseProducto("salud");
  const tipo = tipoDe(searchParams?.tipo);
  const q = texto(searchParams?.q);
  const pagina = Math.max(1, Number(texto(searchParams?.pagina)) || 1);
  // Dos vistas (2026-11-22): las alertas, o lo que dicen sus tablas (productos y lotes, migración 443).
  const vista = texto(searchParams?.vista) === "productos" ? "productos" : "alertas";
  const pedido = new URLSearchParams({ ...(tipo ? { tipo } : {}), ...(q ? { q } : {}), pagina: String(pagina), tamano: String(POR_PAGINA) });
  const [d, prod] = await Promise.all([
    getAlertas(vista === "alertas" ? pedido : new URLSearchParams({ ...(tipo ? { tipo } : {}), ...(q ? { q } : {}), tamano: "5" })),
    vista === "productos" ? getProductosAlerta(pedido) : Promise.resolve(null),
  ]);
  const lista = rutaEn(base, "/alertas");
  const qs = (c: { pagina?: number }) => {
    const p = new URLSearchParams();
    if (vista === "productos") p.set("vista", "productos");
    if (tipo) p.set("tipo", tipo);
    if (q) p.set("q", q);
    if (c.pagina && c.pagina > 1) p.set("pagina", String(c.pagina));
    const s = p.toString();
    return s ? `${lista}?${s}` : lista;
  };
  const paginas = d ? Math.min(500, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;
  const paginasProd = prod ? Math.min(500, Math.max(1, Math.ceil(prod.n / POR_PAGINA))) : 1;
  const params: Record<string, string> = { ...(vista === "productos" ? { vista } : {}), ...(tipo ? { tipo } : {}), ...(q ? { q } : {}) };
  const enVista = (v: "alertas" | "productos") => {
    const u = new URLSearchParams({ ...(v === "productos" ? { vista: v } : {}), ...(tipo ? { tipo } : {}), ...(q ? { q } : {}) });
    const s = u.toString();
    return s ? `${lista}?${s}` : lista;
  };

  return (
    <div className="container-page pb-10 pt-4 sm:pb-14 sm:pt-5">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Medicamentos", href: rutaEn(base, "/medicamentos") }, { etiqueta: "Alertas de DIGEMID" }]} />
      <ProveedorFiltros ruta={lista} params={params}>
        <CabeceraLista
          className="mt-2"
          titulo={tipo ? `Alertas de DIGEMID: ${TIPOS_ALERTA[tipo].nombre.toLowerCase().replace(/^alertas /, "")}` : "Alertas de DIGEMID"}
          resumen={
            d && (
              <>
                <span>
                  <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "alerta" : "alertas"}, la más nueva primero
                </span>
                <Ayuda titulo="¿Qué es una alerta de DIGEMID?" etiqueta="Qué es una alerta de DIGEMID">
                  <span className="block">Un aviso oficial sobre un medicamento, un dispositivo o un producto sanitario: falsificados, lotes retirados, riesgos o cambios.</span>
                  <span className="mt-1 block">El lote y el registro sanitario están en el PDF de cada alerta: compáralos con tu caja. Una alerta de un lote no dice que todo el producto esté observado.</span>
                </Ayuda>
              </>
            )
          }
          acciones={
            <Link href={rutaEn(base, "/medicamentos")} className="gs-hunde inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-paper px-4 text-dato font-semibold text-ink hover:border-granate/60 hover:text-granate sm:min-h-10">
              <Pill size={16} aria-hidden className="text-granate" />
              <span className="sm:hidden">Verificar</span>
              <span className="hidden sm:inline">Verificar un medicamento</span>
            </Link>
          }
        />

        <BarraFiltros
          className="mt-4"
          busqueda={{ clave: "q", valor: q, ejemplo: "Producto o lote" }}
          filtros={[
            {
              tipo: "uno",
              clave: "tipo",
              etiqueta: "Tipo de alerta",
              valor: tipo,
              opciones: ORDEN.filter((t) => d?.tipos[t]).map((t) => ({ valor: t, nombre: TIPOS_ALERTA[t].nombre, detalle: TIPOS_ALERTA[t].explica, n: d?.tipos[t] ?? null })),
            },
          ]}
        />

        <nav aria-label="Qué ver" className="mt-4 inline-flex rounded-full border border-line bg-paper p-1">
          {(["alertas", "productos"] as const).map((v) => (
            <Link
              key={v}
              href={enVista(v)}
              aria-current={vista === v ? "page" : undefined}
              className={cn(
                "gs-hunde inline-flex min-h-10 items-center gap-1.5 rounded-full px-4 text-meta font-semibold",
                vista === v ? "bg-granate text-paper" : "text-inkSoft hover:text-ink",
              )}
            >
              {v === "alertas" ? "Alertas" : "Productos y lotes"}
            </Link>
          ))}
        </nav>

        {vista === "productos" ? (
          <Resultados clave={`productos-${tipo ?? ""}-${q}-${pagina}`} className="mt-4">
            {!prod ? (
              <div className="rounded-2xl border border-line bg-paper">
                <EstadoError texto="No pudimos leer los productos ahora. Vuelve a intentarlo en unos segundos." />
              </div>
            ) : prod.filas.length === 0 ? (
              <div className="rounded-2xl border border-line bg-paper">
                <EstadoVacio
                  Icono={TriangleAlert}
                  titulo="Ningún producto observado con estos filtros"
                  texto="Los productos y lotes salen de la tabla de cada alerta a medida que leemos sus PDF. Prueba con otro nombre o mira la lista de alertas."
                />
              </div>
            ) : (
              <>
                <p className="mb-2 text-meta text-inkSoft">
                  <b className="font-semibold tabular-nums text-ink">{numero(prod.n)}</b> {prod.n === 1 ? "producto observado" : "productos observados"} en{" "}
                  <b className="font-semibold tabular-nums text-ink">{numero(prod.alertas)}</b> {prod.alertas === 1 ? "alerta" : "alertas"},{" "}
                  {numero(prod.conLote)} con su lote. Salen de la tabla del PDF de cada alerta; lo que no dice el PDF queda vacío.
                </p>
                {/* En el celular, una tarjeta por producto; desde sm, la tabla. */}
                <ul className="grid gap-2 sm:hidden" aria-label="Productos y lotes observados">
                  {prod.filas.map((x, i) => (
                    <li key={`${x.alertaId}-${i}`} className="rounded-2xl border border-line bg-paper px-4 py-3">
                      <div className="flex gap-3">
                        <DibujoProducto texto={`${x.producto} ${x.presentacion ?? ""}`} />
                        <div className="min-w-0">
                          <p className="text-dato font-semibold leading-snug text-ink">{x.producto}</p>
                          {x.presentacion && <p className="text-meta text-inkSoft">{x.presentacion}</p>}
                        </div>
                      </div>
                      {!x.lote && !x.registro && !x.titular ? (
                        <p className="mt-2 text-meta text-mute">El PDF no trae su lote, su registro sanitario ni su titular.</p>
                      ) : (
                      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-meta">
                        <div className="min-w-0">
                          <dt className="text-rotulo text-mute">Lote</dt>
                          <dd className="font-mono text-ink [overflow-wrap:anywhere]">{x.lote ?? <span className="font-sans text-mute">No lo dice</span>}</dd>
                          {x.vencimiento && <dd className="text-mute">Vence {x.vencimiento}</dd>}
                        </div>
                        <div className="min-w-0">
                          <dt className="text-rotulo text-mute">Registro sanitario</dt>
                          <dd className="font-mono text-ink">
                            {x.registro ? (
                              x.medicamento ? (
                                <Link href={rutaEn(base, rutaMedicamento(x.medicamento))} className="underline decoration-line underline-offset-2">
                                  {x.registro}
                                </Link>
                              ) : (
                                x.registro
                              )
                            ) : (
                              <span className="font-sans text-mute">No lo dice</span>
                            )}
                          </dd>
                        </div>
                        {x.titular && (
                          <div className="col-span-2 min-w-0">
                            <dt className="text-rotulo text-mute">Titular</dt>
                            <dd className="text-inkSoft">{nombreMed(x.titular)}</dd>
                          </div>
                        )}
                      </dl>
                      )}
                      {x.detalle && <p className="mt-1.5 text-meta text-inkSoft">{x.detalle}</p>}
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-meta text-mute">
                        <InsigniaAlerta tipo={x.tipo} />
                        {x.pdfUrl ? (
                          <a href={x.pdfUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold text-granate underline-offset-4 hover:underline">
                            {x.numero ? `Alerta N.° ${x.numero}` : "La alerta en PDF"}
                            <span className="sr-only"> (PDF, se abre en otra pestaña)</span>
                          </a>
                        ) : (
                          x.numero && `Alerta N.° ${x.numero}`
                        )}
                        <span>{fechaCorta(x.fecha)}</span>
                      </p>
                    </li>
                  ))}
                </ul>
                <div className="hidden overflow-x-auto rounded-2xl border border-line bg-paper sm:block">
                  <table className="w-full min-w-[46rem] text-left text-meta">
                    <caption className="sr-only">Productos y lotes observados en las alertas de DIGEMID</caption>
                    <thead className="bg-paperSoft text-rotulo text-mute">
                      <tr>
                        <th scope="col" className="px-3 py-2 font-semibold">Producto</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Lote</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Registro sanitario</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Titular</th>
                        <th scope="col" className="px-3 py-2 font-semibold">Alerta</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {prod.filas.map((x, i) => (
                        <tr key={`${x.alertaId}-${i}`} className="align-top">
                          <td className="px-3 py-2.5">
                            <div className="flex gap-3">
                              <DibujoProducto texto={`${x.producto} ${x.presentacion ?? ""}`} />
                              <div className="min-w-0">
                                <p className="font-semibold text-ink">{x.producto}</p>
                                {x.presentacion && <p className="text-inkSoft">{x.presentacion}</p>}
                                {x.detalle && <p className="mt-0.5 text-mute">{x.detalle}</p>}
                              </div>
                            </div>
                          </td>
                          {!x.lote && !x.registro && !x.titular ? (
                            <td colSpan={3} className="px-3 py-2.5 text-mute">
                              El PDF no trae su lote, su registro sanitario ni su titular.
                            </td>
                          ) : (
                          <>
                          <td className="px-3 py-2.5">
                            {x.lote ? <span className="rounded-md bg-ink/[0.05] px-1.5 py-0.5 font-mono tabular-nums text-ink">{x.lote}</span> : <span className="text-mute">No lo dice</span>}
                            {x.vencimiento && <p className="mt-0.5 text-mute">Vence {x.vencimiento}</p>}
                          </td>
                          <td className="px-3 py-2.5 font-mono">
                            {x.registro ? (
                              x.medicamento ? (
                                <Link href={rutaEn(base, rutaMedicamento(x.medicamento))} className="text-ink underline decoration-line underline-offset-2 hover:decoration-granate">
                                  {x.registro}
                                </Link>
                              ) : (
                                <span className="text-ink">{x.registro}</span>
                              )
                            ) : (
                              <span className="font-sans text-mute">No lo dice</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-inkSoft">{x.titular ? nombreMed(x.titular) : <span className="text-mute">No lo dice</span>}</td>
                          </>
                          )}
                          <td className="px-3 py-2.5">
                            <InsigniaAlerta tipo={x.tipo} />
                            <p className="mt-1 whitespace-nowrap text-mute">
                              {x.pdfUrl ? (
                                <a href={x.pdfUrl} target="_blank" rel="noopener noreferrer" className="font-semibold text-granate underline-offset-4 hover:underline">
                                  {x.numero ? `N.° ${x.numero}` : "PDF"}
                                  <span className="sr-only"> (la alerta en PDF, se abre en otra pestaña)</span>
                                </a>
                              ) : (
                                x.numero && `N.° ${x.numero}`
                              )}
                              , {fechaCorta(x.fecha)}
                            </p>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-3">
                  <FuenteFecha nombre="Alertas DIGEMID (la tabla de cada PDF)" url={prod.fuente.avisos.url} al={prod.fuente.avisos.al} />
                </p>
                {paginasProd > 1 && (
                  <Paginas className="mt-5" pagina={Math.min(pagina, paginasProd)} paginas={paginasProd} total={prod.n} tamano={POR_PAGINA} nombre={prod.n === 1 ? "producto" : "productos"} href={(n) => qs({ pagina: n })} />
                )}
              </>
            )}
          </Resultados>
        ) : (
        <Resultados clave={`${tipo ?? ""}-${q}-${pagina}`} className="mt-4">
          {!d ? (
            <div className="rounded-2xl border border-line bg-paper">
              <EstadoError
                texto="No pudimos leer las alertas ahora. Suele ser momentáneo: vuelve a intentarlo en unos segundos."
                acciones={
                  <a href={qs({ pagina })} className={claseAccion("secundario", "min-h-11")}>
                    <RotateCw size={15} aria-hidden /> Volver a intentar
                  </a>
                }
              />
            </div>
          ) : d.filas.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper">
              {d.total > 0 ? (
                // Pasada la última página (un enlace viejo): no es que no haya alertas.
                <EstadoVacio
                  Icono={TriangleAlert}
                  titulo="Esta página no tiene alertas"
                  texto={`Hay ${numero(d.total)} ${d.total === 1 ? "alerta" : "alertas"} en ${numero(paginas)} ${paginas === 1 ? "página" : "páginas"}.`}
                  acciones={
                    <a href={qs({ pagina: 1 })} className={claseAccion("secundario", "min-h-11")}>
                      Ir a la primera página
                    </a>
                  }
                />
              ) : (
                <EstadoVacio Icono={TriangleAlert} titulo="Ninguna alerta con estos filtros" texto="Prueba con menos palabras o con el principio activo. El lote se busca dentro del PDF de cada alerta." />
              )}
            </div>
          ) : (
            <>
              <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper" aria-label="Alertas de DIGEMID">
                {d.filas.map((a) => (
                  <li key={a.id}>
                    <FilaAlerta a={a} base={base} resaltar={q || null} conDibujo plegada={!q} />
                  </li>
                ))}
              </ul>
              <p className="mt-3">
                <FuenteFecha nombre="Alertas DIGEMID" url={d.fuente.avisos.url} al={d.fuente.avisos.al} />
              </p>
              {paginas > 1 && (
                <Paginas className="mt-5" pagina={Math.min(pagina, paginas)} paginas={paginas} total={d.total} tamano={POR_PAGINA} nombre={d.total === 1 ? "alerta" : "alertas"} href={(n) => qs({ pagina: n })} />
              )}
            </>
          )}
        </Resultados>
        )}
      </ProveedorFiltros>
    </div>
  );
}

/** El dibujo de lo que nombra la tabla de una alerta (por su texto: «tabletas», «solución inyectable»…). Decorativo. */
function DibujoProducto({ texto }: { texto: string }) {
  return (
    <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-granate-50">
      <Pixel nombre={formaDe(grupoDeTexto(texto)).sprite} escala={2} animado={false} acento="accion" />
    </span>
  );
}
