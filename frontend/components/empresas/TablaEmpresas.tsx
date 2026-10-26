import { Ayuda, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { urlDesde, conDesde } from "@/lib/desde";
import { Dato } from "@/components/ui/Dato";
import { Badge } from "@/components/ui/Badge";
import { Severidad } from "@/components/ui/Severidad";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila, type Parametros } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Paginacion } from "@/components/ui/Paginacion";
import { fecha, fechaCorta, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { TIPO_CRUCE } from "@/lib/cruces";
import { CORTO_EMPRESA, OBJETO_TEXTO, rutaEmpresa, type EmpresaFila, type PaginaEmpresas } from "@/lib/empresas";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * Empresas en la `Tabla` del kit, una fila por empresa: quién es (RUC, dónde vende, qué vende), sus antecedentes en
 * otros registros (banderas en UNA línea, los graves primero: `CrucesCelda`), lo que ganó en contratos y lo que le
 * compraron por órdenes. Cada fila abre su VISTA PREVIA en el panel lateral (`detalle.ficha`), armada sólo con lo que
 * la fila ya trae, y «Abrir la ficha» al pie. Paginado por URL. Server-safe.
 *
 * El nombre va como lo publica la SUNAT (en mayúsculas): `tituloNatural` daña siglas de razones sociales («S.A.A.» →
 * «S.a.a.», «IBM» → «Ibm», «J.R.» → «J.r.»), y un nombre propio mal escrito es peor que uno en mayúsculas.
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
    // Reintentar vuelve a ESTA vista, con sus filtros y su página (antes llevaba a la lista pelada).
    const aqui = urlDesde(ruta, { ...parametros, page: actual > 1 ? String(actual) : undefined });
    return (
      <EstadoError titulo="No pudimos cargar las empresas" accion={<a href={aqui} className={ACCION}>Reintentar</a>}>
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
  const paginas = Math.max(1, Math.ceil(pagina.total / pagina.size));
  const pag = (subir: boolean) => (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={pagina.total}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina="page"
      cargando={false}
      nombre="empresas"
      subir={subir}
    />
  );
  // De dónde vino (esta lista con sus filtros), para las migas de la ficha y para que "volver" la restaure.
  const desde = urlDesde(ruta, parametros);
  // Sin la línea suelta «N empresas»: el total ya lo dicen la cifra de arriba, el chip «Todas» y el paginador.
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={pagina.data.map((e) => filaDe(e, desde))} etiqueta="Empresas que le venden al Estado" />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
    </div>
  );
}

const inhabilitadaTexto = (e: EmpresaFila) =>
  e.inhabilitada === "definitiva" ? "Inhabilitada" : e.inhabilitadaHasta ? `Inhabilitada hasta el ${fechaCorta(e.inhabilitadaHasta)}` : "Inhabilitada";

export function filaDe(e: EmpresaFila, desde?: string): Fila {
  const lugar = e.departamento ? tituloNatural(e.departamento) : null;
  const vende = e.objeto ? OBJETO_TEXTO[e.objeto] ?? e.objeto : null;
  return {
    id: e.ruc,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={e.nombre}
          dosLineas
          meta={[
            <Dato key="ruc" tipo="ruc" mono>{e.ruc}</Dato>,
            lugar && <Dato key="lugar" tipo="lugar" nombre="Donde más vende">{lugar}</Dato>,
            vende && <Dato key="tipo" tipo="tipo" nombre="Lo que más vende">{vende}</Dato>,
            e.inhabilitada && (
              <Badge key="inh" variant="crimson">
                {inhabilitadaTexto(e)}
              </Badge>
            ),
          ]}
        />
      ),
      antecedentes: <CrucesCelda cruces={e.cruces} etiquetas={CORTO_EMPRESA} />,
      // Lo que ganó sola; lo de consorcio es de todo el consorcio y sólo se cuenta. Cada dato en su renglón: partido a
      // la mitad («12 procesos, 3 en» / «consorcio») estiraba la fila.
      contratos: (
        <CeldaNumero
          sub={
            e.adjProcesos || e.consProcesos ? (
              <>
                {e.adjProcesos > 0 && <span className="block">{plural(e.adjProcesos, "proceso", "procesos")}</span>}
                {e.consProcesos > 0 && <span className="block">{numero(e.consProcesos)} en consorcio</span>}
              </>
            ) : undefined
          }
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
    detalle: {
      titulo: e.nombre,
      etiqueta: `Vista previa de ${e.nombre}`,
      descripcion: <span className="font-mono tabular-nums">RUC {e.ruc}</span>,
      ficha: conDesde(rutaEmpresa(e.ruc), desde),
      contenido: <VistaPrevia e={e} lugar={lugar} vende={vende} />,
    },
    buscable: `${e.nombre} ${e.ruc}`,
  };
}

const RANGO = { alta: 0, media: 1, baja: 2 } as const;

/** El panel de una fila (§14.4): lo que le vendió al Estado y sus antecedentes, sólo con lo que trae la fila. */
function VistaPrevia({ e, lugar, vende }: { e: EmpresaFila; lugar: string | null; vende: string | null }) {
  const cruces = [...(e.cruces ?? [])].sort((a, b) => RANGO[a.severidad] - RANGO[b.severidad]);
  const dudosos = e.adjDudosos + e.ordDudosas;
  const datos: DatoClave[] = [
    { etiqueta: "Ganó sola", valor: e.adjProcesos ? `${solesCompacto(e.adjMonto)} en ${plural(e.adjProcesos, "proceso", "procesos")}` : "Ningún proceso" },
    ...(e.consProcesos
      ? [{ etiqueta: "En consorcio", valor: `${plural(e.consProcesos, "proceso", "procesos")}, ${solesCompacto(e.consMonto)} de todo el consorcio` }]
      : []),
    { etiqueta: "Órdenes de compra y servicio", valor: e.ordN ? `${solesCompacto(e.ordMonto)} en ${plural(e.ordN, "orden", "órdenes")}` : "Ninguna" },
    { etiqueta: "Entidades que le compraron", valor: numero(e.entidades), mono: true },
    { etiqueta: "Postulaciones", valor: e.postulaciones ? `${numero(e.postulaciones)}, ganó ${numero(e.ganadas)}` : "Ninguna" },
    { etiqueta: "Donde más vende", valor: lugar },
    { etiqueta: "Lo que más vende", valor: vende },
    { etiqueta: "Primera y última venta", valor: e.primera && e.ultima ? `${fecha(e.primera)} a ${fecha(e.ultima)}` : e.ultima ? fecha(e.ultima) : null },
    ...(e.visitas ? [{ etiqueta: "Visitas de su gente a entidades", valor: numero(e.visitas), mono: true }] : []),
    { etiqueta: "Estado en la SUNAT", valor: e.estadoSunat ? e.estadoSunat.charAt(0) + e.estadoSunat.slice(1).toLowerCase() : null },
  ];
  return (
    <CuerpoDetalle>
      {(e.inhabilitada || cruces.length > 0) && (
        <ChipsDetalle>
          {e.inhabilitada && <Badge variant="crimson">{inhabilitadaTexto(e)}</Badge>}
          {cruces[0] && <Severidad bandera={cruces[0].severidad} />}
          {cruces.length > 0 && <span className="text-meta text-inkSoft">{plural(cruces.length, "tipo de antecedente", "tipos de antecedente")}</span>}
        </ChipsDetalle>
      )}
      <DatosClave items={datos} />
      {dudosos > 0 && (
        <p className="text-meta leading-snug text-inkSoft">
          {plural(dudosos, "registro trae", "registros traen")} un monto con posible error de carga: se muestran en la ficha tal como los publicó el
          Estado y no se suman.
        </p>
      )}
      <BloqueDetalle titulo="Antecedentes">
        {cruces.length ? (
          <ul className="space-y-3">
            {cruces.map((c) => (
              <li key={c.tipo} className="flex gap-2">
                <Severidad bandera={c.severidad} formato="punto" className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-dato font-semibold leading-snug text-ink">
                    {CORTO_EMPRESA[c.tipo] ?? TIPO_CRUCE[c.tipo]?.corto ?? c.tipo}
                    {c.n > 1 && <span className="ml-1.5 font-normal tabular-nums text-mute">{plural(c.n, "registro", "registros")}</span>}
                  </span>
                  {TIPO_CRUCE[c.tipo]?.explica && <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{TIPO_CRUCE[c.tipo].explica}</span>}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dato text-inkSoft">Ningún otro registro público la nombra.</p>
        )}
      </BloqueDetalle>
    </CuerpoDetalle>
  );
}

const ACCION = CLASE_ACCION_LISTA;
