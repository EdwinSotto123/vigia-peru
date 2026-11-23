import { Ayuda, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila, type Parametros } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Paginacion } from "@/components/ui/Paginacion";
import { fecha, listaY, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { urlDesde } from "@/lib/desde";
import { CHIP_SENAL, SENAL, TIPOS_SENAL, aniosTexto, rutaPersona, type PaginaPersonas, type PersonaEntidad } from "@/lib/personas";
import { peorSeveridad } from "@/lib/severidad";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * Personas contratadas por órdenes de servicio en la `Tabla` del kit, una fila por persona y entidad (una
 * «contratación»): quién (con un apellido tapado), su señal más grave (una línea, «+n»), cuántas órdenes, en cuántos
 * meses, cuánto y en qué años. La usan /app/personas, la ficha de una entidad (sin la entidad en cada fila) y la de un
 * partido. Paginado por URL (`paramPagina`). Server-safe.
 *
 * Filas de 42 px (`densidad="compacta"`; el pedido del dueño del 2026-11-18 era ≤ 48): el nombre y su contexto en una
 * línea, la bandera en una línea, el monto sin línea debajo. Antes medían 64 px: los años iban bajo el monto, que además
 * se repetían en «Última orden» («2018 a 2020» y «6 ago. 2020»), y la bandera larga partía en dos renglones. Ahora los años
 * tienen su columna (xl) y la primera y la última orden van en el panel. En el celular: persona, señal y monto.
 *
 * Cada fila abre una VISTA PREVIA en el panel lateral (`detalle.ficha`), armada sólo con lo que la fila ya trae, y
 * «Abrir la ficha» al pie: se miran varias seguidas sin ir y volver a una ficha pesada.
 *
 * Privacidad (docs/PRIVACIDAD.md): el nombre llega tapado y se ve en la fila y en el panel, pero nunca va a un `title` ni
 * a un `aria-label` (por eso el título de la celda es un nodo y el del panel, «Persona contratada»).
 */

/**
 * La celda de señales es `CrucesCelda` (una línea, la más grave primero, con su ícono). Busca la explicación de cada tipo
 * en el catálogo de cruces de EMPRESAS, donde tres tipos de persona se llaman igual con otro sentido (`aporte`,
 * `candidato`, `visita_previa`: «un socio… antes de la buena pro»): con la clave prefijada no hereda una explicación
 * ajena. La etiqueta de la celda es la de `CHIP_SENAL` (cabe en una línea); el nombre entero, en el panel.
 */
const clave = (t: string) => `persona:${t}`;
const CORTO_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [clave(t), CHIP_SENAL[t]]));
// La bandera en una línea con «…» (`truncar` de CrucesCelda): el nombre corto casi siempre entra; el entero y su
// explicación, en el `title` y en el panel.
const UNA_LINEA = "block min-w-0 max-w-full";
// Y su explicación, la de la señal de PERSONA (CrucesCelda `explicaciones`): sin ella el title quedaba en «Etiqueta: ».
const EXPLICA_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [clave(t), SENAL[t].explica]));
// A igual severidad, el orden del catálogo (el nepotismo primero): la celda muestra una bandera entera y es la que más pesa.
const ORDEN_SENAL = new Map<string, number>(TIPOS_SENAL.map((t, i): [string, number] => [t, i]));
const porCatalogo = (a: { tipo: string }, b: { tipo: string }) => (ORDEN_SENAL.get(a.tipo) ?? 99) - (ORDEN_SENAL.get(b.tipo) ?? 99);

/**
 * Quién | señal más grave | órdenes y en cuántos meses | cuánto | en qué años. Los cortes, medidos con la barra lateral
 * de la app (~256 px): desde lg la señal tiene su columna (antes, desde md, le quedaban ~110 px y la píldora partía); en
 * md va apilada bajo el nombre, como en el celular. Órdenes y años, desde xl. «Órdenes» dice también en cuántos meses
 * («28 en 28 meses»): eran dos columnas casi siempre con el mismo número.
 */
const columnas = (deEntidad: boolean): Columna[] => [
  {
    clave: "persona",
    titulo: "Persona",
    ancho: "minmax(0,1.5fr)",
    // La unidad de la lista: cada fila es una persona EN una entidad (en una sola entidad, una persona).
    ayuda: deEntidad ? undefined : (
      <Ayuda titulo="¿Qué es cada fila?">
        Una contratación: una persona en una entidad. Quien recibió órdenes de dos entidades aparece en dos filas, cada una con
        lo que le pagó esa entidad y sus señales ahí.
      </Ayuda>
    ),
  },
  {
    // Un piso de 12 rem: dentro de la tarjeta de la pestaña la columna quedaba en 7 rem y la señal se cortaba («Posible nepotis…»).
    clave: "senales", titulo: "Señal más grave", ancho: "minmax(12rem,1fr)", desde: "lg", apilar: true,
    igual: { frases: { "Sin señales": "Ninguna tiene señales" } },
    ayuda: (
      <Ayuda titulo="¿Qué son estas señales?">
        Lo que otros registros públicos dicen de esta persona en esta entidad: si fue candidata o aportó al partido que la
        gobernaba, si es autoridad electa, si tiene los apellidos de una autoridad o un funcionario, si recibió órdenes casi
        todos los meses o cobra mucho más que otros por lo mismo. Va la más grave y, con «+n», cuántas más; todas, al abrir
        la fila. Ninguna prueba un delito ni un parentesco.
      </Ayuda>
    ),
  },
  {
    clave: "ordenes", titulo: "Órdenes", ancho: "128px", alinear: "der", desde: "xl",
    ayuda: (
      <Ayuda titulo="¿Qué cuenta?">
        Cuántas órdenes de servicio le dio la entidad y en cuántos meses distintos (sumados año por año). Una orden casi
        todos los meses es un puesto pagado como locación; muchas órdenes en pocos meses, otra cosa: la ficha muestra cada una.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Monto", ancho: "112px", alinear: "der" },
  { clave: "anios", titulo: "Años", ancho: "92px", desde: "xl", igual: { texto: "Años de todas: {}" } },
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
    // Reintentar vuelve a ESTA vista (con sus filtros y su página), no a la lista pelada.
    const aqui = urlDesde(ruta, { ...parametros, [paramPagina]: actual > 1 ? String(actual) : undefined });
    return (
      <EstadoError titulo="No pudimos cargar las personas contratadas" accion={<a href={aqui} className={ACCION}>Reintentar</a>}>
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
  const pag = (subir: boolean) => (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={pagina.total}
      aproximado={pagina.totalExacto === false}
      tam={pagina.size}
      navegacion="url"
      hrefBase={ruta}
      query={parametros}
      paramPagina={paramPagina}
      cargando={false}
      nombre={deEntidad ? "personas" : "contrataciones"}
      subir={subir}
    />
  );
  // Sin la línea suelta «N contrataciones»: el total ya lo dicen el chip «Todas» y el paginador; la unidad, la ⓘ de la
  // columna Persona y las cifras de arriba.
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla
        columnas={columnas(deEntidad)}
        filas={pagina.data.map((p) => filaDe(p, deEntidad))}
        etiqueta="Personas contratadas por órdenes de servicio"
        densidad="compacta"
      />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
    </div>
  );
}

function filaDe(p: PersonaEntidad, deEntidad: boolean): Fila {
  const entidad = p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre";
  const nombre = p.nombre ?? "Persona sin nombre";
  // Los partidos que gobernaban la entidad en esos años, el más reciente primero (las entidades nacionales no tienen).
  const gobiernos = [...(p.gobiernos ?? [])].sort((a, b) => b.anio - a.anio);
  const gob = gobiernos[0];
  const partido = gob ? (
    <Dato key="partido" tipo="partido" nombre="Gobernaba la entidad">
      {gob.nombre}
    </Dato>
  ) : null;
  const servicio = p.servicio ? <Dato key="servicio" tipo="servicio">{p.servicio}</Dato> : null;
  const anios = aniosTexto(p.anios);
  return {
    id: `${p.codigo}-${p.entidadRuc}`,
    // Una sola barra, la del monto: con otra bajo las órdenes la fila tenía dos barras casi iguales.
    magnitudes: { monto: p.monto },
    // Lo que dicen en texto las celdas que pueden repetirse en toda la página (`colapsarIguales`): «Sin señales» con el
    // filtro «Sin señales», el mismo año con el filtro de un año. Las banderas no tienen texto: su columna se queda.
    textos: { senales: p.senales?.length ? undefined : "Sin señales", anios },
    celdas: {
      persona: (
        <CeldaPrincipal
          // Un nodo y no el texto: así el nombre no va al `title` de la celda (privacidad).
          titulo={<>{nombre}</>}
          // El nombre y su contexto en una línea desde sm (la fila de 42 px); en el celular, uno bajo el otro.
          enLinea
          // La entidad primero: en el celular la línea se recorta al final y la entidad era lo que se perdía.
          meta={deEntidad ? [servicio, partido] : [<Dato key="entidad" tipo="entidad">{entidad}</Dato>, servicio, partido]}
        />
      ),
      senales: p.senales?.length ? (
        <span className={UNA_LINEA}>
          <CrucesCelda
            cruces={[...p.senales].sort(porCatalogo).map((s) => ({ tipo: clave(s.tipo), severidad: s.severidad }))}
            etiquetas={CORTO_SENAL}
            explicaciones={EXPLICA_SENAL}
            etiquetaLista="Señales de la persona"
            truncar
          />
        </span>
      ) : (
        // Sólo en su columna: apilado bajo el nombre (md y el celular), «Sin señales» en cada fila era una línea más de ruido.
        <span data-solo-columna className="text-meta text-mute">
          Sin señales
        </span>
      ),
      ordenes: (
        <span className="block whitespace-nowrap text-right text-meta tabular-nums">
          <span className="font-mono text-ink">{numero(p.ordenes)}</span> <span className="text-mute">en {plural(p.meses, "mes", "meses")}</span>
        </span>
      ),
      monto: <CeldaNumero>{solesCompacto(p.monto)}</CeldaNumero>,
      anios: anios ? <span className="text-meta tabular-nums text-inkSoft">{anios}</span> : null,
    },
    detalle: {
      // Ni el título ni la etiqueta llevan el nombre: van a `title` y `aria-label` (docs/PRIVACIDAD.md).
      titulo: "Persona contratada",
      etiqueta: `Vista previa de una persona contratada por ${entidad}${p.servicio ? `, ${p.servicio}` : ""}, ${solesCompacto(p.monto)}`,
      descripcion: <span className="font-medium text-inkSoft">{nombre}</span>,
      ficha: rutaPersona(p.codigo),
      contenido: <VistaPrevia p={p} entidad={entidad} anios={anios} gobiernos={gobiernos.map((g) => g.nombre)} deEntidad={deEntidad} />,
    },
  };
}

/** El panel de una fila: sus señales en esta entidad y lo que le pagó, sólo con lo que trae la fila (§14.4). */
function VistaPrevia({ p, entidad, anios, gobiernos, deEntidad }: { p: PersonaEntidad; entidad: string; anios: string | null; gobiernos: string[]; deEntidad: boolean }) {
  const peor = peorSeveridad(p.senales);
  const datos: DatoClave[] = [
    ...(deEntidad ? [] : [{ etiqueta: "Entidad", valor: entidad }]),
    { etiqueta: "Tipo de servicio", valor: p.servicio },
    { etiqueta: "Le pagó", valor: soles(p.monto), mono: true },
    { etiqueta: "Órdenes", valor: numero(p.ordenes), mono: true },
    { etiqueta: "Meses con órdenes", valor: numero(p.meses), mono: true },
    { etiqueta: "Años", valor: anios, mono: true },
    // La primera y la última ya no van en la fila (los años lo dicen en corto): aquí, con su día.
    { etiqueta: "Primera orden", valor: p.primera ? fecha(p.primera) : null },
    { etiqueta: "Última orden", valor: p.ultima ? fecha(p.ultima) : null },
    // Sin `null` en el valor cuando la entidad no tiene partido: las nacionales no se eligen.
    ...(gobiernos.length ? [{ etiqueta: gobiernos.length === 1 ? "Partido que gobernaba" : "Partidos que gobernaban", valor: listaY([...new Set(gobiernos)]) }] : []),
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        {peor ? (
          <>
            <Severidad bandera={peor} />
            <span className="text-meta text-inkSoft">{plural(p.senales.length, "señal", "señales")} en esta entidad</span>
          </>
        ) : (
          <span className="text-meta text-inkSoft">Ningún otro registro coincide en esta entidad</span>
        )}
      </ChipsDetalle>
      <DatosClave items={datos} />
      {p.senales.length > 0 && (
        <BloqueDetalle titulo="Lo que dicen otros registros">
          <ul className="space-y-3">
            {p.senales.map((s) => (
              <li key={s.tipo} className="flex gap-2">
                <Severidad bandera={s.severidad} formato="punto" className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-dato font-semibold leading-snug text-ink">{SENAL[s.tipo]?.titulo ?? s.tipo}</span>
                  {SENAL[s.tipo]?.explica && <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{SENAL[s.tipo].explica}</span>}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-rotulo leading-relaxed text-mute">Una señal no es una acusación: la evidencia y su fuente, en la ficha.</p>
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

const ACCION = CLASE_ACCION_LISTA;
