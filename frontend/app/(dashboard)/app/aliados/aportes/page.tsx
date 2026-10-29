import { SearchX } from "lucide-react";
import { EncabezadoPagina, EstadoError, EstadoVacio, Migas, Pagina } from "@/components/patrones";
import { BarraFiltros, CeldaFecha, CeldaPrincipal, Listado, Tabla, ZonaResultados, type Columna, type Fila } from "@/components/listado";
import { EstadoVacio as VacioEnLinea } from "@/components/ui/EstadoVacio";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";
import { NombreEntidad } from "@/components/financiar/NombreEntidad";
import { LlamadaPodio } from "@/components/aliados/LlamadaPodio";
import { getRecientesPagina, TIPO_FINANCIADOR_LABEL, type ContribucionReciente } from "@/lib/financiamiento";
import { numero } from "@/lib/formato";

export const metadata = {
  title: "Todos los aportes",
  description: "Cada aporte confirmado que sostiene la vigilancia del dinero público, con su recibo. Ninguno elige qué se lee.",
};

export const revalidate = 60;

/** Aportes por página: la lista es larga y crece con cada aporte, así que se pagina de a 25. */
const TAM = 25;

const COLUMNAS: Columna[] = [
  { clave: "fecha", titulo: "Fecha", ancho: "108px" },
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,1fr)" },
  { clave: "que", titulo: "Qué", ancho: "minmax(0,0.8fr)" },
  { clave: "alcance", titulo: "Dónde", ancho: "minmax(0,0.9fr)", desde: "md" },
  { clave: "comprobante", titulo: "Recibo", ancho: "152px", desde: "lg" },
];

/** Qué fue el aporte: un apoyo al fondo común (de cada mes o único) o, del modelo anterior, la lectura de contratos. */
function Que({ c }: { c: ContribucionReciente }) {
  if (c.tipoAporte === "apoyo") {
    return <span className="text-meta font-medium text-ink">{c.periodicidad === "mensual" ? "Apoyo de cada mes" : "Apoyo único"}</span>;
  }
  return (
    <span className="text-meta text-ink">
      Leyó <span className="font-semibold tabular-nums">{numero(c.contratos)}</span> {c.contratos === 1 ? "contrato" : "contratos"}
      {c.semilla && <span className="block text-rotulo text-mute">Semilla de Vigía Perú</span>}
    </span>
  );
}

/** Dónde fue el aporte: los gobiernos de un partido, una entidad o una zona; de un apoyo, lo que lo motiva o el fondo común. */
function Alcance({ c }: { c: ContribucionReciente }) {
  if (c.tipoAporte === "apoyo") {
    if (c.paraRuc && c.paraEntidad) {
      return (
        <span className="text-meta text-ink">
          Lo motiva <NombreEntidad ruc={c.paraRuc} nombre={c.paraEntidad} />
        </span>
      );
    }
    return <span className="text-meta text-ink">{c.paraZona ? `Lo motiva ${c.paraZona}` : "Al fondo común"}</span>;
  }
  if (c.partido) {
    return (
      <span className="text-meta text-ink">
        Gobiernos de <span className="font-medium">{c.partido.nombre}</span>
      </span>
    );
  }
  if (c.entidad) {
    return (
      <span className="text-meta text-ink">
        <NombreEntidad ruc={c.entidad.ruc} nombre={c.entidad.nombre} />
      </span>
    );
  }
  return <span className="text-meta text-ink">{c.zona}</span>;
}

function fila(c: ContribucionReciente): Fila {
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
          <CeldaPrincipal titulo={c.financiador} meta={[<Dato key="t" tipo="tipo">{TIPO_FINANCIADOR_LABEL[c.tipo]}</Dato>]} enLinea />
        </span>
      ),
      que: <Que c={c} />,
      alcance: <Alcance c={c} />,
      comprobante: <span className="font-mono text-meta text-mute">{c.codigo}</span>,
    },
  };
}

/**
 * /app/aliados/aportes — todos los aportes confirmados, de a 25, del más reciente al más antiguo. Cada fila
 * lleva a su recibo público. Nunca se ordenan ni se comparan por soles, y solo aparecen los aliados visibles.
 * Es la página de "Ver todos los aportes" de la cinta de /app/aliados. Aquí sí va la semilla de Vigía Perú:
 * es el registro entero.
 */
export default async function AportesPage({ searchParams }: { searchParams?: { pagina?: string; q?: string } }) {
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const q = typeof searchParams?.q === "string" && searchParams.q.trim().length >= 2 ? searchParams.q.trim().slice(0, 80) : undefined;
  const datos = await getRecientesPagina(TAM, (pagina - 1) * TAM, q).catch(() => null);
  const paginas = datos ? Math.max(1, Math.ceil(datos.total / TAM)) : 1;

  return (
    <Pagina className="space-y-4">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Aliados", href: "/app/aliados" }, { etiqueta: "Todos los aportes" }]} />
      <EncabezadoPagina
        titulo="Todos los aportes"
        bajada="Cada aporte confirmado, del más reciente al más antiguo. Toca uno para ver su recibo."
      />

      <Listado ruta="/app/aliados/aportes" parametros={{ q }}>
        <div className="space-y-3">
          <BarraFiltros busqueda={{ param: "q", placeholder: "Buscar un aliado, una zona, una entidad, un partido o un comprobante…", etiqueta: "Buscar en los aportes", min: 2 }} />
          <ZonaResultados>
            {!datos ? (
              <EstadoError titulo="No pudimos leer los aportes">Es una falla de esta página: los aportes siguen registrados.</EstadoError>
            ) : datos.data.length === 0 && q ? (
              <VacioEnLinea icono={<SearchX size={16} />}>Ningún aporte coincide con “{q}”.</VacioEnLinea>
            ) : datos.data.length === 0 ? (
              <EstadoVacio
                titulo="Todavía no hay aportes confirmados"
                accion={
                  <EnlaceAccion variante="secundario" href="/app/apoyar">
                    Sé el primero
                  </EnlaceAccion>
                }
              >
                Cuando se confirme el primero, aparece acá con su recibo público.
              </EstadoVacio>
            ) : (
              <section aria-label="Aportes" className="space-y-3">
                <div className="rounded-2xl bg-granate-50 px-4 py-2.5 text-meta text-inkSoft">
                  <strong className="font-semibold text-ink">{numero(datos.total)}</strong>{" "}
                  {q ? (datos.total === 1 ? `aporte coincide con “${q}”` : `aportes coinciden con “${q}”`) : datos.total === 1 ? "aporte confirmado" : "aportes confirmados"}.
                  Mostrando {numero((pagina - 1) * TAM + 1)} a {numero((pagina - 1) * TAM + datos.data.length)}.
                </div>
                <Tabla columnas={COLUMNAS} filas={datos.data.map(fila)} etiqueta="Aportes confirmados, del más reciente al más antiguo" densidad="compacta" />
                {paginas > 1 && (
                  <div className="flex justify-end">
                    <Paginacion actual={pagina} paginas={paginas} total={datos.total} tam={TAM} navegacion="url" hrefBase="/app/aliados/aportes" query={{ q }} cargando={false} nombre="aportes" />
                  </div>
                )}
              </section>
            )}
          </ZonaResultados>
        </div>
      </Listado>

      {/* La invitación al pie, con color: una lista corta no deja la pantalla vacía. */}
      <LlamadaPodio />
    </Pagina>
  );
}
