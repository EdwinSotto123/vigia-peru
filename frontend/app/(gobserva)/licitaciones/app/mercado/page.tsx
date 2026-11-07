import type { Metadata } from "next";
import Link from "next/link";
import { BellPlus, Building2, ChartNoAxesColumn, Coins, Search, Trophy, Users, UserX } from "lucide-react";
import { CabeceraPagina, CLASE_ENLACE_PIE, Caja, Pagina } from "@/components/gobserva/app/Caja";
import { BarrasLista, BarrasMes } from "@/components/licitaciones-app/mercado/Graficos";
import { EstadoError, EstadoVacio } from "@/components/licitaciones-app/ui/Estados";
import { TablaDatos } from "@/components/licitaciones-app/ui/TablaDatos";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { getMercado, limpiar, type Proveedor } from "@/lib/licitaciones";
import { tituloNatural } from "@/lib/landing";
import { fechaCortaLima, pct } from "@/lib/licitaciones-app/formato";
import { numero, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Mercado", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const EJEMPLOS = ["tóner", "cemento", "uniformes", "limpieza", "combustible", "computadoras"];

/**
 * Mercado: lo que el Estado compró de un rubro en 12 meses (CONOSCE): cuánto, cuándo, quién compra, quién gana, cuántos
 * compiten y dónde. Para decidir si entrar y a qué precio. Los ganadores sólo con nombre si son empresas (RUC 20).
 */
export default async function Mercado({ searchParams }: { searchParams?: { q?: string } }) {
  const base = baseProducto("licitaciones");
  const q = (searchParams?.q ?? "").trim().slice(0, 80);
  const valido = q.length >= 3;
  const m = valido ? await getMercado(q) : null;
  const enlace = (x: string) => rutaEn(base, `/app/mercado?q=${encodeURIComponent(x)}`);

  return (
    <Pagina>
      <CabeceraPagina
        titulo="Mercado"
        bajada="Lo que el Estado compró de lo que vendes en los últimos 12 meses: cuánto, quién compra, quién gana y cuántos compiten."
      />

      <Caja as="div" className="mb-4 sm:mb-6">
        <form role="search" action={rutaEn(base, "/app/mercado")} className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="mercado-q" className="sr-only">Qué vendes</label>
          <div className="relative min-w-0 flex-1">
            <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
            <input
              id="mercado-q"
              name="q"
              defaultValue={q}
              minLength={3}
              maxLength={80}
              placeholder="Qué vendes: tóner, cemento, uniformes…"
              className="h-11 w-full rounded-lg border border-line bg-caja pl-11 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 sm:text-dato"
            />
          </div>
          <button type="submit" className={claseAccion("primario", "min-h-11")}>
            Ver el mercado
          </button>
        </form>
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-meta text-mute">
          Prueba con
          {EJEMPLOS.map((e) => (
            <Link key={e} href={enlace(e)} className="rounded-full border border-line px-2.5 py-0.5 font-medium text-inkSoft hover:border-granate/40 hover:text-ink">
              {e}
            </Link>
          ))}
        </p>
      </Caja>

      {!q ? (
        <Caja>
          <EstadoVacio
            Icono={ChartNoAxesColumn}
            titulo="Escribe lo que vendes"
            texto="Te mostramos cuánto compró el Estado, quién compra más, quién gana, con cuántos competidores y en qué regiones."
          />
        </Caja>
      ) : !valido ? (
        <Caja>
          <EstadoVacio Icono={Search} titulo="Escribe al menos 3 letras" texto="Una palabra de lo que vendes: «tóner», «cemento», «uniformes»." />
        </Caja>
      ) : !m ? (
        <Caja>
          <EstadoError
            titulo="No pudimos leer el mercado ahora"
            texto="Suele ser momentáneo."
            acciones={
              <Link href={enlace(q)} className={claseAccion("secundario")}>
                Volver a intentar
              </Link>
            }
          />
        </Caja>
      ) : m.procesos === 0 ? (
        <Caja>
          <EstadoVacio Icono={Search} titulo={`Sin adjudicaciones de «${q}» en 12 meses`} texto="Prueba con otra palabra, más general o como la escribiría una entidad." />
        </Caja>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja lg:grid-cols-4">
            <Dato Icono={Coins} etiqueta="Adjudicado en 12 meses" valor={solesCompacto(m.monto)} detalle={`${numero(m.procesos)} procesos, ${numero(m.items)} ítems`} />
            <Dato Icono={Building2} etiqueta="Entidades que compran" valor={numero(m.entidades)} detalle={m.adjSobreRef != null ? `Adjudican al ${pct(m.adjSobreRef)} del referencial` : "Sin referencial comparable"} />
            <Dato Icono={Users} etiqueta="Postores por proceso" valor={m.postoresPromedio != null ? m.postoresPromedio.toLocaleString("es-PE", { maximumFractionDigits: 1 }) : "Sin dato"} detalle={`${numero(m.ganadores)} ganadores distintos`} />
            <Dato Icono={UserX} etiqueta="Con un solo postor" valor={m.conPostores ? pct(m.unSoloPostor / m.conPostores) : "Sin dato"} detalle={m.conPostores ? `${numero(m.unSoloPostor)} de ${numero(m.conPostores)} procesos` : ""} />
          </dl>

          <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Caja id="meses" titulo={`«${m.q}» mes a mes`} descripcion="Adjudicaciones con buena pro (CONOSCE)">
              <BarrasMes serie={m.serie} />
            </Caja>
            <Caja id="regiones" titulo="Dónde se compra" descripcion="Las regiones con más procesos">
              <BarrasLista filas={m.regiones.slice(0, 8).map((r) => ({ nombre: r.nombre, valor: r.procesos, detalle: `${numero(r.procesos)}, ${solesCompacto(r.monto)}` }))} />
            </Caja>
          </div>

          <div className="grid gap-4 sm:gap-6 xl:grid-cols-2">
            <Caja id="compradores" titulo="Quién compra" descripcion="Las entidades que más compraron" relleno={false}>
              <TablaProveedores filas={m.compradores} total={m.monto} nombre="Entidad" />
            </Caja>
            <Caja id="ganadores" titulo="Quién gana" descripcion="Las empresas que más se adjudicaron (las personas naturales no se nombran)" relleno={false}>
              <TablaProveedores filas={m.ganadoresTop} total={m.montoEmpresas || m.monto} nombre="Empresa" conRuc />
            </Caja>
          </div>

          <Caja
            id="recientes"
            titulo="Las últimas adjudicaciones"
            relleno={false}
            pie={
              <Link href={rutaEn(base, `/app/bandeja?q=${encodeURIComponent(m.q)}`)} className={CLASE_ENLACE_PIE}>
                <BellPlus size={15} aria-hidden /> Ver lo abierto de «{m.q}» en la bandeja y crear su alerta
              </Link>
            }
          >
            <TablaDatos
              titulo="Últimas adjudicaciones"
              filas={m.recientes}
              claveFila={(r) => `${r.codigo}-${r.fecha}`}
              columnas={[
                { clave: "fecha", titulo: "Buena pro", className: "w-28", celda: (r) => <span className="whitespace-nowrap text-meta text-inkSoft">{fechaCortaLima(r.fecha)}</span> },
                {
                  clave: "item",
                  titulo: "Qué se compró",
                  celda: (r) => (
                    <div className="min-w-0 max-w-[36rem]">
                      <p className="line-clamp-2 text-dato text-ink">{limpiar(r.item) || "Sin descripción"}</p>
                      <p className="mt-0.5 line-clamp-1 text-meta text-mute">{r.entidad ? tituloNatural(r.entidad) : "Entidad sin nombre"}</p>
                    </div>
                  ),
                },
                { clave: "monto", titulo: "Adjudicado", alinear: "derecha", className: "w-32", celda: (r) => <span className="font-semibold tabular-nums text-ink">{solesCompacto(r.monto)}</span> },
                { clave: "ganador", titulo: "Ganó", desde: "lg", className: "w-56", celda: (r) => <span className="line-clamp-2 text-meta text-inkSoft">{r.ganador ? tituloNatural(r.ganador) : "Consorcio o persona natural"}</span> },
              ]}
              tarjeta={(r) => (
                <div className="px-4 py-3.5">
                  <p className="line-clamp-2 text-dato text-ink">{limpiar(r.item) || "Sin descripción"}</p>
                  <p className="mt-1 text-meta text-inkSoft">
                    <b className="font-semibold text-ink">{solesCompacto(r.monto)}</b> el {fechaCortaLima(r.fecha)}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-meta text-mute">{r.ganador ? tituloNatural(r.ganador) : "Consorcio o persona natural"}</p>
                </div>
              )}
            />
          </Caja>
        </div>
      )}
    </Pagina>
  );
}

function Dato({ Icono, etiqueta, valor, detalle }: { Icono: typeof Coins; etiqueta: string; valor: string; detalle: string }) {
  return (
    <div className="min-w-0 bg-caja p-4 sm:p-5">
      <dt className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
        <Icono size={15} aria-hidden className="text-granate" />
        {etiqueta}
      </dt>
      <dd className="mt-2 font-display text-seccion font-bold leading-none tabular-nums text-ink sm:text-cifra">{valor}</dd>
      <dd className="mt-1.5 text-meta text-mute">{detalle}</dd>
    </div>
  );
}

function TablaProveedores({ filas, total, nombre, conRuc = false }: { filas: Proveedor[]; total: number; nombre: string; conRuc?: boolean }) {
  if (!filas.length) return <EstadoVacio Icono={Trophy} titulo="Sin nombres que mostrar" className="py-6 sm:py-8" />;
  return (
    <TablaDatos<Proveedor>
      titulo={nombre === "Entidad" ? "Entidades que más compraron" : "Empresas que más ganaron"}
      filas={filas}
      claveFila={(p) => p.ruc}
      columnas={[
        {
          clave: "nombre",
          titulo: nombre,
          celda: (p) => (
            <div className="min-w-0">
              <p className="line-clamp-2 text-dato font-semibold text-ink">{p.nombre ? tituloNatural(p.nombre) : "Sin nombre"}</p>
              {conRuc && <p className="mt-0.5 font-mono text-meta text-mute">RUC {p.ruc}</p>}
            </div>
          ),
        },
        { clave: "procesos", titulo: "Procesos", alinear: "derecha", className: "w-24", celda: (p) => <span className="tabular-nums">{numero(p.procesos)}</span> },
        { clave: "monto", titulo: "Monto", alinear: "derecha", className: "w-28", celda: (p) => <span className="font-semibold tabular-nums text-ink">{solesCompacto(p.monto)}</span> },
        { clave: "parte", titulo: "Parte", alinear: "derecha", desde: "lg", className: "w-20", celda: (p) => <span className="tabular-nums text-inkSoft">{total > 0 && p.monto != null ? (p.monto / total < 0.005 ? "menos de 1 %" : pct(p.monto / total)) : "Sin dato"}</span> },
      ]}
      tarjeta={(p) => (
        <div className="px-4 py-3">
          <p className="text-dato font-semibold text-ink">{p.nombre ? tituloNatural(p.nombre) : "Sin nombre"}</p>
          <p className="mt-0.5 text-meta text-inkSoft">
            {numero(p.procesos)} {p.procesos === 1 ? "proceso" : "procesos"}, {solesCompacto(p.monto)}
          </p>
        </div>
      )}
    />
  );
}
