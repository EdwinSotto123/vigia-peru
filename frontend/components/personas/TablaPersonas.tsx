import { Ayuda, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, TablaSkeleton, type Columna, type Fila, type Parametros } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Paginacion } from "@/components/ui/Paginacion";
import { fecha, listaY, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { urlDesde } from "@/lib/desde";
import { SENAL, TIPOS_SENAL, aniosTexto, rutaPersona, type PaginaPersonas, type PersonaEntidad } from "@/lib/personas";
import { peorSeveridad } from "@/lib/severidad";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * Personas contratadas por órdenes de servicio en la `Tabla` del kit, una fila por persona y entidad (una
 * «contratación»): quién (con un apellido tapado), en qué entidad y qué servicio da, lo que dicen otros registros
 * (señales, en una línea), órdenes, meses, monto y su última orden. La usan /app/personas, la ficha de una entidad (sin
 * la entidad en cada fila) y la de un partido. Paginado por URL (`paramPagina`). Server-safe.
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
 * ajena. La etiqueta corta sale de `SENAL`.
 */
const clave = (t: string) => `persona:${t}`;
const CORTO_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [clave(t), SENAL[t].corto]));
// Y su explicación, la de la señal de PERSONA (CrucesCelda `explicaciones`): sin ella el title quedaba en «Etiqueta: ».
const EXPLICA_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [clave(t), SENAL[t].explica]));

const columnas = (deEntidad: boolean): Columna[] => [
  {
    clave: "persona",
    titulo: "Persona",
    ancho: "minmax(0,1.4fr)",
    // La unidad de la lista: cada fila es una persona EN una entidad (en una sola entidad, una persona).
    ayuda: deEntidad ? undefined : (
      <Ayuda titulo="¿Qué es cada fila?">
        Una contratación: una persona en una entidad. Quien recibió órdenes de dos entidades aparece en dos filas, cada una con
        lo que le pagó esa entidad y sus señales ahí.
      </Ayuda>
    ),
  },
  {
    clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas señales?">
        Lo que otros registros públicos dicen de esta persona en esta entidad: si fue candidata o aportó al partido que la
        gobernaba, si es autoridad electa, si tiene los apellidos de una autoridad o un funcionario, si recibió órdenes casi
        todos los meses o cobra mucho más que otros por lo mismo. Ninguna prueba un delito ni un parentesco.
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
      <Tabla columnas={columnas(deEntidad)} filas={pagina.data.map((p) => filaDe(p, deEntidad))} etiqueta="Personas contratadas por órdenes de servicio" />
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
    celdas: {
      persona: (
        <CeldaPrincipal
          // Un nodo y no el texto: así el nombre no va al `title` de la celda (privacidad).
          titulo={<>{nombre}</>}
          // La entidad primero: en el celular la línea se recorta al final y la entidad era lo que se perdía.
          meta={deEntidad ? [servicio, partido] : [<Dato key="entidad" tipo="entidad">{entidad}</Dato>, servicio, partido]}
        />
      ),
      senales: p.senales?.length ? (
        <CrucesCelda
          cruces={p.senales.map((s) => ({ tipo: clave(s.tipo), severidad: s.severidad }))}
          etiquetas={CORTO_SENAL}
          explicaciones={EXPLICA_SENAL}
          etiquetaLista="Señales de la persona"
        />
      ) : (
        <span className="text-meta text-mute">Sin señales</span>
      ),
      ordenes: <CeldaNumero>{numero(p.ordenes)}</CeldaNumero>,
      meses: <CeldaNumero>{numero(p.meses)}</CeldaNumero>,
      monto: <CeldaNumero sub={anios ?? undefined}>{solesCompacto(p.monto)}</CeldaNumero>,
      ultima: <CeldaFecha fecha={p.ultima} />,
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
