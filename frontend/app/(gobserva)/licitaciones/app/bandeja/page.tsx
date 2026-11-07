import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { AlertTriangle, Building2, Clock, Coins, Inbox, RotateCcw } from "lucide-react";
import { CabeceraPagina, Caja, Pagina } from "@/components/gobserva/app/Caja";
import { Buscador } from "@/components/licitaciones-app/bandeja/Buscador";
import { Chips } from "@/components/licitaciones-app/bandeja/Chips";
import { Filtros } from "@/components/licitaciones-app/bandeja/Filtros";
import { Herramientas } from "@/components/licitaciones-app/bandeja/Herramientas";
import { Perfiles } from "@/components/licitaciones-app/bandeja/Perfiles";
import { ResultadosVivos } from "@/components/licitaciones-app/bandeja/Resultados";
import { TablaBandeja } from "@/components/licitaciones-app/bandeja/TablaBandeja";
import { AvisoDemo } from "@/components/licitaciones-app/ui/AvisoDemo";
import { AvisoPerfil } from "@/components/licitaciones-app/bandeja/AvisoPerfil";
import { EstadoError, EstadoVacio } from "@/components/licitaciones-app/ui/Estados";
import { Paginacion } from "@/components/licitaciones-app/ui/Paginacion";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { FILTROS_POR_DEFECTO, aParams, cambiar, filtrosActivos, leerFiltros, type FiltrosBandeja } from "@/lib/licitaciones-app/filtros";
import { getFuente } from "@/lib/licitaciones-app/fuente";
import type { ResultadoBandeja } from "@/lib/licitaciones-app/tipos";
import { ProveedorLista } from "@/lib/licitaciones-app/useListaUrl";
import { numero, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = { title: "Bandeja", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

/**
 * La bandeja de oportunidades (docs/PLAN.md): buscar, filtrar, ordenar y paginar sobre la fuente de datos, con todo en
 * la URL (el botón Atrás deshace cada paso y un enlace se comparte tal cual), las búsquedas guardadas y la señal de
 * riesgo en cada fila.
 */
export default async function Bandeja({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const base = baseProducto("licitaciones");
  const fuente = getFuente();
  const leidos = leerFiltros(searchParams ?? {});
  // Un filtro que la fuente no sabe aplicar no se finge: se quita (en vivo, «con señales» de todo el resultado).
  const f = fuente.capacidades.senal ? leidos : { ...leidos, senal: false };
  const ahora = Date.now();
  let r: ResultadoBandeja | null = null;
  try {
    r = await fuente.buscar(f);
  } catch {
    r = null;
  }
  const url = (x: FiltrosBandeja) => {
    const qs = aParams(x).toString();
    return rutaEn(base, `/app/bandeja${qs ? `?${qs}` : ""}`);
  };

  return (
    <Pagina>
      <CabeceraPagina titulo="Bandeja" bajada="Las convocatorias abiertas del SEACE. Busca lo que vendes, filtra, sigue lo que te sirve y guarda tus búsquedas." />
      <AvisoDemo tomada={fuente.tomada} total={fuente.registros ?? undefined} />
      <AvisoPerfil base={base} />

      <Suspense>
        <ProveedorLista>
          {/* Una columna que nunca crece más que la pantalla: la tabla se desliza dentro de su caja. */}
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:gap-6">
            <Caja as="div" relleno={false}>
              <div className="space-y-3 p-4 sm:p-5">
                <Buscador />
                <Filtros facetas={r?.facetas ?? { tipo: [], region: [], proc: [] }} conSenal={fuente.capacidades.senal} />
                <Chips />
              </div>
              <div className="rounded-b-2xl border-t border-line bg-ink/[0.02] px-4 py-2.5 sm:px-5">
                <Perfiles />
              </div>
            </Caja>

            <ResultadosVivos>
              {!r ? (
                <Caja>
                  <EstadoError
                    titulo="No pudimos leer las oportunidades"
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
                  titulo={`${numero(r.total)} ${r.total === 1 ? "oportunidad" : "oportunidades"}`}
                  accion={<Herramientas />}
                  relleno={false}
                  pie={r.total > 0 ? <Paginacion pagina={r.pagina} paginas={r.paginas} total={r.total} tamano={r.tamano} href={(n) => url({ ...f, pag: n })} nombre="oportunidades" /> : undefined}
                >
                  {r.total > 0 && (
                    <div className="border-b border-line px-4 py-2.5 text-meta text-inkSoft sm:px-5">
                      <Resumen r={r} url={(c) => url(cambiar(f, c))} />
                    </div>
                  )}
                  {r.total === 0 ? (
                    <EstadoVacio
                      Icono={Inbox}
                      titulo="Ninguna oportunidad con esos filtros"
                      texto={
                        filtrosActivos(f) > 0
                          ? "Prueba con menos filtros, otra palabra o un rango de valor más amplio."
                          : "No hay convocatorias abiertas publicadas en ese periodo."
                      }
                      acciones={
                        filtrosActivos(f) > 0 ? (
                          <Link href={url({ ...FILTROS_POR_DEFECTO, orden: f.orden, tam: f.tam })} className={claseAccion("secundario")}>
                            Quitar los filtros
                          </Link>
                        ) : undefined
                      }
                    />
                  ) : (
                    <TablaBandeja filas={r.data} filtros={{ ...f, pag: r.pagina }} base={base} ahora={ahora} />
                  )}
                </Caja>
              )}
            </ResultadosVivos>
          </div>
        </ProveedorLista>
      </Suspense>
    </Pagina>
  );
}

/** Lo que suma la búsqueda, en cifras con ícono; las de señales y vencimiento llevan a su filtro. */
function Resumen({ r, url }: { r: ResultadoBandeja; url: (c: Partial<FiltrosBandeja>) => string }) {
  const e = r.resumen;
  return (
    <span className="flex flex-wrap gap-x-5 gap-y-1">
      <span className="inline-flex items-center gap-1.5">
        <Coins size={14} aria-hidden className="text-mute" />
        {solesCompacto(e.valorTotal)} en juego ({numero(e.conValor)} con valor)
      </span>
      <span className="inline-flex items-center gap-1.5">
        <Building2 size={14} aria-hidden className="text-mute" />
        {numero(e.entidades)} {e.entidades === 1 ? "entidad" : "entidades"}
      </span>
      {e.vencenSemana > 0 && (
        <Link href={url({ cons: "7d" })} className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-ink hover:underline">
          <Clock size={14} aria-hidden className="text-amberTexto" />
          {numero(e.vencenSemana)} con consultas que vencen en 7 días
        </Link>
      )}
      {e.conSenales != null && e.conSenales > 0 && (
        <Link href={url({ senal: true })} className="inline-flex items-center gap-1.5 underline-offset-4 hover:text-ink hover:underline">
          <AlertTriangle size={14} aria-hidden className="text-crimsonTexto" />
          {numero(e.conSenales)} con señales de riesgo
        </Link>
      )}
    </span>
  );
}
