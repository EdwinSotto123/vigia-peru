import { Landmark } from "lucide-react";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila, type Parametros } from "@/components/listado";
import { Paginacion } from "@/components/ui/Paginacion";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona, type PaginaPersonas, type PersonaEntidad } from "@/lib/personas";
import { SenalesCelda } from "./SenalesPersona";

/**
 * Personas contratadas por órdenes de servicio en la `Tabla` del kit, una fila por persona y entidad: quién (con un
 * apellido tapado) y qué servicio da, lo que dicen otros registros (señales), órdenes, meses, monto y su última orden.
 * La usan /app/personas, la ficha de una entidad (sin la entidad en cada fila) y la de un partido. Cada fila abre la
 * ficha de la persona. Paginado por URL (`paramPagina`). Server-safe.
 */

const columnas = (deEntidad: boolean): Columna[] => [
  { clave: "persona", titulo: "Persona", ancho: "minmax(0,1.4fr)" },
  {
    clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas señales?">
        Lo que otros registros públicos dicen de esta persona en esta entidad: si fue candidata o aportó al partido que la
        gobernaba, si es autoridad electa, si tiene los apellidos de una autoridad o un funcionario, si recibió órdenes casi
        todos los meses o cobra mucho más que otros por lo mismo. En rojo, las graves. Ninguna prueba un delito ni un
        parentesco.
      </Ayuda>
    ),
  },
  { clave: "ordenes", titulo: "Órdenes", ancho: "76px", alinear: "der", desde: "lg" },
  { clave: "meses", titulo: "Meses", ancho: "68px", alinear: "der", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "104px", alinear: "der" },
  { clave: "ultima", titulo: deEntidad ? "Última orden" : "Última", ancho: "92px", desde: "xl" },
];

export function TablaPersonasSkeleton({ deEntidad = false }: { deEntidad?: boolean }) {
  return <TablaSkeleton columnas={columnas(deEntidad)} filas={10} />;
}

export function TablaPersonas({
  pagina,
  parametros,
  ruta,
  actual,
  paramPagina = "page",
  deEntidad = false,
  filtrada,
}: {
  pagina: PaginaPersonas | null;
  parametros: Parametros;
  ruta: string;
  actual: number;
  paramPagina?: string;
  /** La lista de UNA entidad: sin la entidad en cada fila. */
  deEntidad?: boolean;
  /** ¿Hay filtros puestos? (cambia el texto de la lista vacía). */
  filtrada: boolean;
}) {
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos cargar las personas contratadas" accion={<a href={ruta} className={ACCION}>Reintentar</a>}>
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  if (pagina.total === 0) {
    return filtrada ? (
      <EstadoVacio compacto titulo="Nadie coincide con estos filtros">Quita el filtro más restrictivo.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Sin órdenes de servicio a personas">
        El OECE no registra órdenes de servicio a personas naturales en este alcance desde 2018.
      </EstadoVacio>
    );
  }
  const paginas = Math.max(1, Math.ceil(pagina.total / pagina.size));
  const pag = (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={pagina.total}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina={paramPagina}
      cargando={false}
      nombre="personas"
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-inkSoft">
          {deEntidad ? plural(pagina.total, "persona", "personas") : plural(pagina.total, "contratación (una persona en una entidad)", "contrataciones (una persona en una entidad)")}
          {filtrada ? " con estos filtros" : ""}
        </p>
        {pag}
      </div>
      <Tabla columnas={columnas(deEntidad)} filas={pagina.data.map((p) => filaDe(p, deEntidad))} etiqueta="Personas contratadas por órdenes de servicio" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

function filaDe(p: PersonaEntidad, deEntidad: boolean): Fila {
  const entidad = p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre";
  // El partido que gobernaba la entidad en el último de esos años (las entidades nacionales no tienen).
  const gob = [...(p.gobiernos ?? [])].sort((a, b) => b.anio - a.anio)[0];
  const partido = gob ? (
    <span key="partido" className="inline-flex items-center gap-1" title={`Gobernaba la entidad: ${gob.nombre}`}>
      <Landmark size={12} className="shrink-0" aria-hidden />
      {gob.nombre}
    </span>
  ) : null;
  return {
    id: `${p.codigo}-${p.entidadRuc}`,
    href: rutaPersona(p.codigo),
    celdas: {
      persona: (
        <CeldaPrincipal
          titulo={p.nombre ?? "Persona sin nombre"}
          meta={deEntidad ? [p.servicio, partido] : [p.servicio, entidad, partido]}
        />
      ),
      senales: <SenalesCelda senales={p.senales} />,
      ordenes: <CeldaNumero>{numero(p.ordenes)}</CeldaNumero>,
      meses: <CeldaNumero>{numero(p.meses)}</CeldaNumero>,
      monto: <CeldaNumero sub={p.anios.length > 1 ? `${p.anios[0]} a ${p.anios[p.anios.length - 1]}` : String(p.anios[0] ?? "")}>{solesCompacto(p.monto)}</CeldaNumero>,
      ultima: <CeldaFecha fecha={p.ultima} />,
    },
  };
}

const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
