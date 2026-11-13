import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Clock, Inbox, RotateCcw, Sparkle, Timer } from "lucide-react";
import { CabeceraPagina, Caja, Pagina } from "@/components/gobserva/app/Caja";
import { BarraMenores, HerramientasMenores, ResultadosMenores } from "@/components/licitaciones-app/menores/Barra";
import { TablaMenores } from "@/components/licitaciones-app/menores/TablaMenores";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { Paginacion } from "@/components/gobserva/ui/Paginacion";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { getMenores } from "@/lib/licitaciones";
import { FILTROS_MENORES, aApiMenores, aParamsMenores, activosMenores, leerMenores, type FiltrosMenores } from "@/lib/licitaciones-app/filtrosMenores";
import { fechaHoraLima } from "@/lib/licitaciones-app/formato";
import { ProveedorMenores } from "@/lib/licitaciones-app/useListaUrl";
import { numero } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Contratos menores", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * Los contratos menores abiertos (≤8 UIT, el SEACE nuevo) dentro de la app: lo que todavía se puede cotizar, con buscar,
 * tipo, región y cuándo cierran (todo en la URL), cuánto falta para que cierre cada uno y seguirlos al tablero.
 */
export default async function Menores({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const base = baseProducto("licitaciones");
  const f = leerMenores(searchParams ?? {});
  const r = await getMenores(aApiMenores(f));
  const ahora = Date.now();
  const url = (x: FiltrosMenores) => {
    const qs = aParamsMenores(x).toString();
    return rutaEn(base, `/app/menores${qs ? `?${qs}` : ""}`);
  };
  const paginas = r ? Math.max(1, Math.min(100, Math.ceil(r.total / f.tam))) : 1;

  return (
    <Pagina>
      <CabeceraPagina
        titulo="Contratos menores"
        bajada="Las compras de hasta 8 UIT que todavía se pueden cotizar. Cierran en días u horas: mira primero lo que cierra antes."
      />

      {r && (
        <dl className="mb-4 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-line bg-line shadow-caja sm:mb-6">
          <Cifra Icono={Timer} etiqueta="Abiertos" valor={numero(r.cabecera.abiertas)} href={url(FILTROS_MENORES)} />
          <Cifra Icono={Clock} etiqueta="Cierran hoy" valor={numero(r.cabecera.cierranHoy)} href={url({ ...FILTROS_MENORES, cuando: "hoy" })} urgente={r.cabecera.cierranHoy > 0} />
          <Cifra Icono={Sparkle} etiqueta="Nuevos en 24 h" valor={numero(r.cabecera.nuevas24h)} href={url({ ...FILTROS_MENORES, cuando: "nuevas", orden: "reciente" })} />
        </dl>
      )}

      <Suspense>
        <ProveedorMenores>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6">
            <Caja as="div" relleno={false}>
              <BarraMenores porTipo={r?.porTipo ?? []} porRegion={r?.porRegion ?? []} />
            </Caja>
            <ResultadosMenores>
              {!r ? (
                <Caja>
                  <EstadoError
                    titulo="No pudimos leer los contratos menores"
                    texto="Suele ser momentáneo. Vuelve a intentarlo; tus filtros se quedan como están."
                    acciones={
                      <Link href={url(f)} className={claseAccion("secundario")}>
                        <RotateCcw size={15} aria-hidden /> Volver a intentar
                      </Link>
                    }
                  />
                </Caja>
              ) : (
                <Caja
                  id="resultados"
                  titulo={`${numero(r.total)} ${r.total === 1 ? "contrato abierto" : "contratos abiertos"}`}
                  descripcion={`De ${numero(r.resumen.entidades)} ${r.resumen.entidades === 1 ? "entidad" : "entidades"}${r.cabecera.actualizado ? `. Actualizado el ${fechaHoraLima(r.cabecera.actualizado)}` : ""}`}
                  accion={<HerramientasMenores />}
                  relleno={false}
                  pie={r.total > 0 ? <Paginacion pagina={Math.min(f.pag, paginas)} paginas={paginas} total={r.total} tamano={f.tam} href={(n) => url({ ...f, pag: n })} nombre="contratos" /> : undefined}
                >
                  {r.data.length === 0 ? (
                    <EstadoVacio
                      Icono={Inbox}
                      titulo="Ningún contrato menor abierto con esos filtros"
                      texto={activosMenores(f) > 0 ? "Prueba con menos filtros u otra palabra: salen nuevos cada hora." : "Ahora no hay contratos menores abiertos. Salen nuevos cada hora."}
                      acciones={
                        activosMenores(f) > 0 ? (
                          <Link href={url({ ...FILTROS_MENORES, orden: f.orden, tam: f.tam })} className={claseAccion("secundario")}>
                            Quitar los filtros
                          </Link>
                        ) : undefined
                      }
                    />
                  ) : (
                    <TablaMenores filas={r.data} base={base} ahora={ahora} volver={aParamsMenores(f).toString()} />
                  )}
                </Caja>
              )}
            </ResultadosMenores>
          </div>
        </ProveedorMenores>
      </Suspense>
    </Pagina>
  );
}

function Cifra({ Icono, etiqueta, valor, href, urgente = false }: { Icono: typeof Timer; etiqueta: string; valor: string; href: string; urgente?: boolean }) {
  return (
    <Link href={href} scroll={false} className="group block min-w-0 bg-caja p-4 transition-colors duration-rapido hover:bg-granate-50 sm:p-5">
      <dt className="flex items-center gap-2 text-meta font-semibold text-inkSoft">
        <Icono size={15} aria-hidden className={urgente ? "text-crimsonTexto" : "text-granate"} />
        {etiqueta}
      </dt>
      <dd className={`mt-2 font-display text-seccion font-bold leading-none tabular-nums sm:text-cifra ${urgente ? "text-crimsonTexto" : "text-ink"}`}>{valor}</dd>
    </Link>
  );
}
