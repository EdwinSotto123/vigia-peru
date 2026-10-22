import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Badge } from "@/components/ui/Badge";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila, type Parametros } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Paginacion } from "@/components/ui/Paginacion";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { CORTO_EMPRESA, OBJETO_TEXTO, rutaEmpresa, type EmpresaFila, type PaginaEmpresas } from "@/lib/empresas";

/**
 * Empresas en la `Tabla` del kit, una fila por empresa: quién es (RUC, dónde vende, qué vende), sus antecedentes en
 * otros registros (banderas, los graves primero), lo que ganó en contratos y lo que le compraron por órdenes.
 * Cada fila abre la ficha de la empresa. Paginado por URL. Server-safe.
 */

const COLUMNAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1.5fr)" },
  {
    clave: "antecedentes", titulo: "Antecedentes", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son los antecedentes?">
        Lo que otros registros públicos dicen de la empresa: sanciones del Tribunal, penalidades, aportes y ventas a campañas,
        socios que son autoridades, postores con el mismo socio, visitas antes de la buena pro. Son datos con su fuente, no
        acusaciones: en la ficha, cada uno con su registro.
      </Ayuda>
    ),
  },
  { clave: "contratos", titulo: "Contratos", ancho: "112px", alinear: "der", desde: "lg" },
  { clave: "ordenes", titulo: "Órdenes", ancho: "112px", alinear: "der" },
  { clave: "ultima", titulo: "Última", ancho: "92px", desde: "xl" },
];

export function TablaEmpresasSkeleton() {
  return <TablaSkeleton columnas={COLUMNAS} filas={10} />;
}

export function TablaEmpresas({
  pagina,
  parametros,
  ruta,
  actual,
  filtrada,
}: {
  pagina: PaginaEmpresas | null;
  parametros: Parametros;
  ruta: string;
  actual: number;
  filtrada: boolean;
}) {
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos cargar las empresas" accion={<a href={ruta} className={ACCION}>Reintentar</a>}>
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  if (pagina.total === 0) {
    return filtrada ? (
      <EstadoVacio compacto titulo="Ninguna empresa coincide">Revisa el nombre o el RUC, o quita el filtro más restrictivo.</EstadoVacio>
    ) : (
      <EstadoVacio compacto titulo="Sin empresas">Todavía no hay empresas cargadas.</EstadoVacio>
    );
  }
  const pag = (
    <Paginacion
      actual={actual}
      paginas={Math.max(1, Math.ceil(pagina.total / pagina.size))}
      total={pagina.total}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina="page"
      cargando={false}
      nombre="empresas"
    />
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-inkSoft">{plural(pagina.total, "empresa", "empresas")}{filtrada ? " con estos filtros" : ""}</p>
        {pag}
      </div>
      <Tabla columnas={COLUMNAS} filas={pagina.data.map(filaDe)} etiqueta="Empresas que le venden al Estado" />
      <div className="flex justify-end">{pag}</div>
    </div>
  );
}

export function filaDe(e: EmpresaFila): Fila {
  const contratos = e.adjProcesos + e.consProcesos;
  return {
    id: e.ruc,
    href: rutaEmpresa(e.ruc),
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={e.nombre}
          dosLineas
          meta={[
            <Dato key="ruc" tipo="ruc" mono>{e.ruc}</Dato>,
            e.departamento && <Dato key="lugar" tipo="lugar" nombre="Donde más vende">{tituloNatural(e.departamento)}</Dato>,
            e.objeto && <Dato key="tipo" tipo="tipo" nombre="Lo que más vende">{OBJETO_TEXTO[e.objeto] ?? e.objeto}</Dato>,
            e.inhabilitada && (
              <Badge key="inh" variant="crimson">
                {e.inhabilitada === "definitiva" ? "Inhabilitada" : e.inhabilitadaHasta ? `Inhabilitada hasta el ${fechaCorta(e.inhabilitadaHasta)}` : "Inhabilitada"}
              </Badge>
            ),
          ]}
        />
      ),
      antecedentes: <CrucesCelda cruces={e.cruces} etiquetas={CORTO_EMPRESA} />,
      // Lo que ganó sola; lo de consorcio es de todo el consorcio y sólo se cuenta.
      contratos: (
        <CeldaNumero
          sub={contratos ? [e.adjProcesos ? plural(e.adjProcesos, "proceso", "procesos") : null, e.consProcesos ? `${numero(e.consProcesos)} en consorcio` : null].filter(Boolean).join(", ") : undefined}
        >
          {e.adjProcesos ? solesCompacto(e.adjMonto) : e.consProcesos ? <span className="font-sans text-inkSoft">En consorcio</span> : <span className="font-sans text-mute">Ninguno</span>}
        </CeldaNumero>
      ),
      ordenes: (
        <CeldaNumero sub={e.ordN ? plural(e.ordN, "orden", "órdenes") : undefined}>
          {e.ordN ? solesCompacto(e.ordMonto) : <span className="font-sans text-mute">Ninguna</span>}
        </CeldaNumero>
      ),
      ultima: <CeldaFecha fecha={e.ultima} />,
    },
    buscable: `${e.nombre} ${e.ruc}`,
  };
}

const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";
