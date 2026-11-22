import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays, History, RotateCw } from "lucide-react";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { FuenteFecha, InsigniaCategoria } from "@/components/salud/comun";
import { URL_RENIPRESS_CONSULTA } from "@/components/salud/fuentes/urls";
import { lugarIpress } from "@/components/salud/lista/filtros";
import { Paginas } from "@/components/salud/lista/Paginas";
import { CabeceraLista, Ruta } from "@/components/salud/portada/Piezas";
import { BarraFiltros, ProveedorFiltros, Resultados } from "@/components/salud/filtros/BarraFiltros";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { fechaCorta, getCambios, nombrePropio, numero, rutaFicha, type Cambio } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

export const dynamic = "force-dynamic";

const POR_PAGINA = 50;

type Props = { searchParams?: Record<string, string | string[] | undefined> };

/** Los campos que registra el historial (GET /salud/cambios?campo=), con su nombre. */
const CAMPOS: { clave: string; nombre: string; detalle: string }[] = [
  { clave: "alta", nombre: "Altas", detalle: "Apareció en el archivo de RENIPRESS" },
  { clave: "baja_registro", nombre: "Salieron del registro", detalle: "Ya no figura en el archivo de RENIPRESS" },
  { clave: "estado", nombre: "Estado", detalle: "Cambió su estado en RENIPRESS" },
  { clave: "categoria", nombre: "Categoría", detalle: "Cambió su categoría" },
  { clave: "categoria_detalle", nombre: "Categoría en su ficha", detalle: "Cambió la categoría que registra su ficha" },
  { clave: "situacion", nombre: "Situación", detalle: "Cambió su situación en su ficha" },
  { clave: "nombre", nombre: "Nombre", detalle: "Cambió su nombre" },
  { clave: "direccion", nombre: "Dirección", detalle: "Cambió su dirección" },
];

const leer = (p: Props["searchParams"], k: string) => {
  const v = p?.[k];
  return (Array.isArray(v) ? v[0] : v)?.trim();
};

export function generateMetadata({ searchParams }: Props): Metadata {
  const campo = leer(searchParams, "campo");
  return {
    title: "Historial de actualizaciones de RENIPRESS",
    description: "Lo que cambió en el registro de establecimientos de salud de SUSALUD semana a semana: altas, bajas y cambios de estado, categoría, nombre o dirección.",
    alternates: { canonical: urlCanonica("salud", "/cambios") },
    robots: campo || leer(searchParams, "pagina") ? { index: false, follow: true } : undefined,
  };
}

/** «Activo» → «Activo»; null → «sin dato». */
const valor = (v: string | null) => (v == null || v === "" ? "sin dato" : v.length > 3 && v === v.toUpperCase() ? nombrePropio(v) : v);

/**
 * /cambios de Gobserva Salud (2026-11-20): el historial de actualizaciones de RENIPRESS. Cada vez que se carga el archivo
 * nuevo se compara con el anterior y queda lo que cambió (altas, bajas, estado, categoría, nombre, dirección…). Filtro por
 * clase de cambio (chips), línea de tiempo agrupada por fecha, 50 por página. GET /salud/cambios.
 */
export default async function Cambios({ searchParams }: Props) {
  const base = baseProducto("salud");
  const campoUrl = leer(searchParams, "campo");
  const campo = CAMPOS.some((c) => c.clave === campoUrl) ? campoUrl : undefined;
  const paginaUrl = Number(leer(searchParams, "pagina"));
  const pedida = Number.isInteger(paginaUrl) && paginaUrl > 1 ? Math.min(paginaUrl, 200) : 1;
  const qs = new URLSearchParams({ pagina: String(pedida) });
  if (campo) qs.set("campo", campo);
  const d = await getCambios(qs);
  const lista = rutaEn(base, "/cambios");
  const href = (c: { campo?: string; pagina?: number }) => {
    const u = new URLSearchParams();
    if (c.campo) u.set("campo", c.campo);
    if (c.pagina && c.pagina > 1) u.set("pagina", String(c.pagina));
    const s = u.toString();
    return `${lista}${s ? `?${s}` : ""}`;
  };
  const paginas = d ? Math.min(200, Math.max(1, Math.ceil(d.total / POR_PAGINA))) : 1;

  // La línea de tiempo: los cambios agrupados por la fecha en que se detectaron.
  const grupos: { fecha: string; filas: Cambio[] }[] = [];
  for (const c of d?.filas ?? []) {
    const g = grupos[grupos.length - 1];
    if (g && g.fecha === c.fecha) g.filas.push(c);
    else grupos.push({ fecha: c.fecha, filas: [c] });
  }

  return (
    <div className="container-page pb-10 pt-4 sm:pb-14 sm:pt-5">
      <Ruta items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Fuentes", href: rutaEn(base, "/fuentes") }, { etiqueta: "Cambios en RENIPRESS" }]} />
      <ProveedorFiltros ruta={lista} params={campo ? { campo } : {}}>
      <CabeceraLista
        className="mt-2"
        titulo="Cambios en RENIPRESS"
        resumen={
          <>
            <span>
              {d && d.total > 0 ? (
                <>
                  <b className="font-semibold tabular-nums text-ink">{numero(d.total)}</b> {d.total === 1 ? "cambio" : "cambios"} detectados, lo más
                  reciente primero.
                </>
              ) : (
                "Lo que cambia en el registro de establecimientos: altas, bajas, estado y categoría."
              )}
            </span>
            <FuenteFecha nombre="RENIPRESS (SUSALUD)" url={URL_RENIPRESS_CONSULTA} />
          </>
        }
      />
      {/* Sin cambios todavía, el filtro no filtra nada: sólo aparece cuando hay qué filtrar (o ya se eligió uno). */}
      {(campo || (d && d.total > 0)) && (
        <BarraFiltros
          className="mt-4"
          filtros={[{ tipo: "uno", clave: "campo", etiqueta: "Qué cambió", valor: campo, opciones: CAMPOS.map((c) => ({ valor: c.clave, nombre: c.nombre, detalle: c.detalle })) }]}
        />
      )}

      <Resultados clave={`${campo ?? ""}-${pedida}`} className="mt-4">
      {!d ? (
        <div className="rounded-2xl border border-line bg-paper">
          <EstadoError
            texto="No pudimos leer el historial ahora. Vuelve a intentarlo en unos segundos."
            acciones={
              <a href={href({ campo, pagina: pedida })} className={claseAccion("secundario", "min-h-11")}>
                <RotateCw size={15} aria-hidden /> Volver a intentar
              </a>
            }
          />
        </div>
      ) : d.filas.length === 0 ? (
        <div className="rounded-2xl border border-line bg-paper">
          <EstadoVacio
            Icono={History}
            titulo={campo ? "Ningún cambio de esta clase todavía" : "Todavía no hay cambios registrados"}
            texto="El historial se arma comparando cada archivo nuevo de RENIPRESS con el anterior: aparece aquí lo que cambie desde la próxima carga. Mientras tanto, cada ficha muestra su estado actual con su fecha."
            acciones={
              <>
                {campo && (
                  <Link href={lista} className={claseAccion("secundario", "min-h-11")}>
                    Ver todos los cambios
                  </Link>
                )}
                <Link href={rutaEn(base, "/fuentes")} className={claseAccion("secundario", "min-h-11")}>
                  Ver las fuentes y sus cargas
                </Link>
              </>
            }
          />
        </div>
      ) : (
        <>
          <ol className="space-y-8" aria-label="Cambios por fecha">
            {grupos.map((g) => (
              <li key={g.fecha}>
                <h2 className="flex items-center gap-2 font-display text-bloque font-bold text-ink">
                  <CalendarDays size={18} aria-hidden className="text-granate" />
                  <span>Detectados el {fechaCorta(g.fecha)}</span>
                  <span className="text-meta font-medium text-mute">{numero(g.filas.length)}</span>
                </h2>
                <ol className="mt-3 border-l border-line pl-4 sm:pl-6">
                  {g.filas.map((c, i) => (
                    <FilaCambio key={`${c.codigo}-${c.campo}-${i}`} c={c} base={base} />
                  ))}
                </ol>
              </li>
            ))}
          </ol>
          <Paginas
            className="mt-8"
            pagina={Math.min(d.pagina, paginas)}
            paginas={paginas}
            total={d.total}
            tamano={POR_PAGINA}
            nombre={d.total === 1 ? "cambio" : "cambios"}
            href={(n) => href({ campo, pagina: n })}
          />
        </>
      )}
      </Resultados>
      </ProveedorFiltros>
    </div>
  );
}

function FilaCambio({ c, base }: { c: Cambio; base: string }) {
  const info = CAMPOS.find((x) => x.clave === c.campo);
  const conValores = c.campo !== "alta" && c.campo !== "baja_registro";
  return (
    <li className="relative py-3 before:absolute before:-left-[21px] before:top-[22px] before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-paper before:bg-granate before:content-[''] sm:before:-left-[29px]">
      <p className="text-rotulo font-semibold text-inkSoft">{info?.detalle ?? c.campo}</p>
      <Link href={rutaEn(base, rutaFicha(c.codigo))} prefetch={false} className="mt-0.5 inline-flex min-h-11 items-center gap-1 text-dato font-semibold text-ink hover:text-granate sm:min-h-0">
        {nombrePropio(c.nombre) || `IPRESS ${c.codigo}`} <ArrowRight size={14} aria-hidden className="text-mute" />
      </Link>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
        <InsigniaCategoria categoria={c.categoria} />
        <Dato tipo="lugar">{lugarIpress(c)}</Dato>
        <Dato tipo="codigo" nombre="Código IPRESS" mono>
          {c.codigo}
        </Dato>
      </p>
      {conValores && (
        <dl className="mt-2 grid max-w-3xl gap-2 text-meta sm:grid-cols-2">
          <div className="min-w-0 rounded-lg bg-paperSoft px-3 py-2">
            <dt className="text-rotulo font-medium text-mute">Antes</dt>
            <dd className="break-words text-inkSoft line-through decoration-mute/60">{valor(c.antes)}</dd>
          </div>
          <div className="min-w-0 rounded-lg border border-line bg-paper px-3 py-2">
            <dt className="text-rotulo font-medium text-mute">Ahora</dt>
            <dd className="break-words font-semibold text-ink">{valor(c.despues)}</dd>
          </div>
        </dl>
      )}
    </li>
  );
}
