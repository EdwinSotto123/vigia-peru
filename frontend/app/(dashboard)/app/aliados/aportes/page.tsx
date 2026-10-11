import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EncabezadoPagina, EstadoError, EstadoVacio, Pagina } from "@/components/patrones";
import { CeldaBarra, CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";
import { NombreEntidad } from "@/components/financiar/NombreEntidad";
import { LlamadaPodio } from "@/components/aliados/LlamadaPodio";
import { frasePartesTarifa, getEstadoGlobal, getRecientesPagina, partesTarifa, TIPO_FINANCIADOR_LABEL, type ContribucionReciente } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

export const metadata = {
  title: "Todos los aportes",
  description: "Cada aporte confirmado que paga la lectura de contratos públicos, con su comprobante. Se cuenta en contratos, nunca en soles.",
};

export const revalidate = 60;

/** Aportes por página: la lista es larga y crece con cada aporte, así que se pagina de a 25. */
const TAM = 25;

const COLUMNAS: Columna[] = [
  { clave: "fecha", titulo: "Fecha", ancho: "108px" },
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,0.9fr)" },
  { clave: "alcance", titulo: "Dónde", ancho: "minmax(0,0.8fr)", desde: "md" },
  { clave: "barra", titulo: "Tamaño", ancho: "minmax(120px,1.3fr)", desde: "lg" },
  { clave: "contratos", titulo: "Contratos", ancho: "92px", alinear: "der" },
  { clave: "comprobante", titulo: "Comprobante", ancho: "152px", desde: "lg" },
];

/** Dónde fue el aporte: los gobiernos de un partido, una entidad o una zona. */
function Alcance({ c }: { c: ContribucionReciente }) {
  if (c.partido) {
    return (
      <span className="text-[13px] text-ink">
        Gobiernos de <span className="font-medium">{c.partido.nombre}</span>
      </span>
    );
  }
  if (c.entidad) {
    return (
      <span className="text-[13px] text-ink">
        <NombreEntidad ruc={c.entidad.ruc} nombre={c.entidad.nombre} />
      </span>
    );
  }
  return <span className="text-[13px] text-ink">{c.zona}</span>;
}

function fila(c: ContribucionReciente, mayor: number): Fila {
  return {
    id: c.codigo,
    href: `/impacto/${c.codigo}`,
    celdas: {
      fecha: <CeldaFecha fecha={c.pagadaAt} />,
      aliado: (
        <span className="flex w-full min-w-0 items-center gap-3">
          <span aria-hidden className="hidden shrink-0 sm:inline-flex">
            <AvatarAliado tipo={c.tipo} logoUrl={c.logoUrl} nombre={c.financiador} size="sm" />
          </span>
          <CeldaPrincipal titulo={c.financiador} meta={TIPO_FINANCIADOR_LABEL[c.tipo]} enLinea />
        </span>
      ),
      contratos: (
        <CeldaNumero>
          <span className="font-display text-[15px] font-bold text-ink">{numero(c.contratos)}</span>
        </CeldaNumero>
      ),
      alcance: <Alcance c={c} />,
      barra: <CeldaBarra parte={c.contratos / mayor} resumen={`${numero(c.contratos)} contratos, de ${numero(mayor)} en el aporte más grande de esta página`} />,
      comprobante: <span className="font-mono text-[12.5px] text-mute">{c.codigo}</span>,
    },
  };
}

/**
 * /app/aliados/aportes — todos los aportes confirmados, de a 25, del más reciente al más antiguo. Cada fila
 * lleva a su comprobante público. Se cuenta en contratos, nunca en soles, y solo aparecen los aliados visibles.
 * Es la página de "Ver todos los aportes" de la cinta de /app/aliados.
 */
export default async function AportesPage({ searchParams }: { searchParams?: { pagina?: string } }) {
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const [datos, estado] = await Promise.all([getRecientesPagina(TAM, (pagina - 1) * TAM).catch(() => null), getEstadoGlobal()]);
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / TAM)) : 1;

  return (
    <Pagina className="space-y-4">
      <Link href="/app/aliados" className="inline-flex min-h-[44px] items-center gap-1.5 text-[13.5px] font-medium text-inkSoft hover:text-ink">
        <ArrowLeft size={14} aria-hidden /> Ranking de aliados
      </Link>
      <EncabezadoPagina
        titulo="Todos los aportes"
        bajada="Cada aporte confirmado paga la lectura de contratos públicos. Toca uno para ver su comprobante."
      />

      {!datos ? (
        <EstadoError titulo="No pudimos leer los aportes">Es una falla de esta página: los aportes siguen registrados.</EstadoError>
      ) : datos.data.length === 0 ? (
        <EstadoVacio
          titulo="Todavía no hay aportes confirmados"
          accion={
            <EnlaceAccion variante="secundario" href="/app/financiar">
              Ser el primero
            </EnlaceAccion>
          }
        >
          Cuando se confirme el primero, aparece acá con su comprobante público.
        </EstadoVacio>
      ) : (
        <section aria-label="Aportes" className="space-y-3">
          <div className="rounded-2xl bg-granate-50 px-4 py-2.5 text-[13px] text-inkSoft">
            <strong className="font-semibold text-ink">{numero(datos.total)}</strong> {datos.total === 1 ? "aporte confirmado" : "aportes confirmados"}.
            Mostrando {numero((pagina - 1) * TAM + 1)} a {numero((pagina - 1) * TAM + datos.data.length)}.
          </div>
          <Tabla columnas={COLUMNAS} filas={datos.data.map((c) => fila(c, Math.max(1, ...datos.data.map((x) => x.contratos))))} etiqueta="Aportes confirmados, del más reciente al más antiguo" densidad="compacta" />
          {paginas > 1 && (
            <div className="flex justify-end">
              <Paginacion actual={pagina} paginas={paginas} total={datos.total} tam={TAM} navegacion="url" hrefBase="/app/aliados/aportes" query={{}} cargando={false} nombre="aportes" />
            </div>
          )}
        </section>
      )}

      {/* La invitación al pie, con color: una lista corta no deja la pantalla vacía. */}
      <LlamadaPodio precio={estado?.tarifa?.precioPen ?? null} desglose={frasePartesTarifa(partesTarifa(estado?.tarifa?.nota))} />
    </Pagina>
  );
}
