import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { urlDesde, conDesde } from "@/lib/desde";
import { Ayuda, BloqueDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { Paginacion } from "@/components/ui/Paginacion";
import { Severidad } from "@/components/ui/Severidad";
import { etiquetaTipoVisible } from "@/lib/entidad-tipo";
import type { ApiEntidad, EntidadesPagina } from "@/lib/api-client";
import { numero, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA } from "@/components/ui/EnlaceAccion";

/**
 * Las entidades sobre la plantilla Listado (§14.1): la `Tabla` compartida y cada fila abre su VISTA PREVIA en el panel
 * lateral (`detalle.ficha`), con «Abrir la ficha» al pie: se miran varias seguidas sin ir y volver a la ficha, que es
 * pesada.
 *
 * QUÉ MUESTRA (2026-10-27): lo que TODA entidad tiene. Antes las columnas eran «con dictamen», lo adjudicado en esos
 * contratos y su puntaje: sólo ~180 de 3,162 tienen un dictamen publicado, y cada fila decía «0 de 426, Sin dato, Sin
 * dato» (la lista se leía vacía). Ahora: sus banderas (las señales que cuentan los filtros, en una línea con
 * `CrucesCelda`), sus contratos desde 2015, cuántos con un ganador con antecedentes (y graves), su presupuesto del MEF
 * del año y sus informes de la Contraloría. El dictamen sigue en el panel y en su orden («Más contratos con dictamen»,
 * el único con puesto: el puesto de un ranking).
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

const AYUDA_BANDERAS = (
  <Ayuda titulo="¿Qué son estas banderas?">
    <span className="block">
      Lo que otros registros públicos dicen de la entidad y de quienes contrata: contratos ganados por empresas ligadas a quien
      la gobierna, informes de la Contraloría con presunta responsabilidad penal, un pariente de un funcionario entre sus
      locadores, personas de su planilla con una señal alta y plazas CAS hechas a la medida.
    </span>
    <span className="mt-2 block">Son indicios para revisar, no acusaciones: el panel de cada fila dice cuántos y lleva a la evidencia.</span>
  </Ayuda>
);

const COL_ENTIDAD: Columna = { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.6fr)" };
const COL_BANDERAS = (desde: Columna["desde"]): Columna => ({
  clave: "banderas", titulo: "Banderas", ancho: "minmax(0,1fr)", desde, apilar: true, ayuda: AYUDA_BANDERAS,
});
const COL_CONTRATOS = (desde?: Columna["desde"]): Columna => ({
  clave: "contratos", titulo: "Contratos", ancho: "88px", alinear: "der", desde,
  ayuda: <Ayuda titulo="¿Qué contratos cuenta?">Sus convocatorias en el SEACE desde 2015, las mismas de la pestaña Contratos de su ficha.</Ayuda>,
});
const COL_ANTECEDENTES = (desde: Columna["desde"]): Columna => ({
  clave: "antecedentes", titulo: "Con antecedentes", corto: "Con antecedentes", ancho: "120px", alinear: "der", desde, apilar: "con-rotulo",
  ayuda: (
    <Ayuda titulo="¿Qué son los antecedentes del ganador?">
      Sus contratos cuyo ganador (o sus socios y representantes) aparece en otros registros: sanciones, penalidades, aportes al
      partido que la gobierna, visitas antes de la buena pro, socios comunes con otros postores. Debajo, cuántos tienen alguno
      grave. No prueban por sí solos una irregularidad.
    </Ayuda>
  ),
});
const COL_PRESUPUESTO: Columna = {
  clave: "presupuesto", titulo: "Presupuesto", ancho: "112px", alinear: "der", desde: "xl",
  ayuda: (
    <Ayuda titulo="¿Qué presupuesto es?">
      Su presupuesto institucional modificado (PIM) del último año en el MEF (Consulta Amigable). «Sin dato»: Vigía no encontró
      su unidad ejecutora en el MEF.
    </Ayuda>
  ),
};
const COL_INFORMES: Columna = {
  clave: "informes", titulo: "Informes", ancho: "80px", alinear: "der", desde: "xl",
  ayuda: <Ayuda titulo="¿Qué informes cuenta?">Los informes de control de la Contraloría sobre ella, con responsabilidad presunta de sus funcionarios.</Ayuda>,
};

/** Las columnas de siempre: banderas, contratos, antecedentes, presupuesto e informes. */
const COLUMNAS: Columna[] = [COL_ENTIDAD, COL_BANDERAS("md"), COL_CONTRATOS(), COL_ANTECEDENTES("lg"), COL_PRESUPUESTO, COL_INFORMES];
/** Ordenada por dictamen: el puesto y los contratos con dictamen, y lo demás donde entra. */
const COLUMNAS_DICTAMEN: Columna[] = [
  { clave: "puesto", titulo: "Puesto", ancho: "56px", desde: "md" },
  COL_ENTIDAD,
  COL_BANDERAS("lg"),
  {
    clave: "dictamen", titulo: "Con dictamen", ancho: "104px", alinear: "der",
    ayuda: <Ayuda titulo="¿Qué cuenta?">Sus contratos que Vigía leyó y cuyo dictamen está publicado, tengan o no señales, sobre todos los suyos.</Ayuda>,
  },
  COL_CONTRATOS("md"),
  COL_ANTECEDENTES("xl"),
];

const ACCION = CLASE_ACCION_LISTA;
const ACCION_PRIMARIA =
  "inline-flex min-h-[40px] items-center rounded-full bg-granate px-4 py-1.5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep";

interface Props {
  /** La página ya traída por page.tsx; null = el API no respondió. */
  pagina: EntidadesPagina | null;
  /** Número de página pedido en la URL. */
  actual: number;
  /** Parámetros de la URL sin la página, para armar los enlaces de la paginación. */
  parametros: Record<string, string | undefined>;
  /** Búsqueda activa (por nombre o por el comienzo del RUC). */
  q?: string;
  /** Enlace a esta misma vista, para reintentar. */
  aqui: string;
  /** El orden elegido; sin él, el de más contratos. Sólo el de dictamen lleva puesto. */
  orden?: string;
}

/** Cómo dice la tabla, a quien no la ve, en qué orden van las filas. */
const ETIQUETA_ORDEN: Record<string, string> = {
  contratos: "Entidades ordenadas por sus contratos desde 2015",
  dictamen: "Entidades ordenadas por contratos con dictamen publicado",
  nombre: "Entidades en orden alfabético",
};

export function EntidadesPanel({ pagina, actual, parametros, q, aqui, orden = "contratos" }: Props) {
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos leer las entidades" accion={<Link href={aqui} className={ACCION}>Reintentar</Link>}>
        El servidor de Vigía no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }

  const { total, size: tam } = pagina;
  const paginas = Math.max(1, Math.ceil(total / tam));

  if (pagina.data.length === 0) {
    const qRuc = q && /^\d{11}$/.test(q) ? q : null;
    if (total > 0) {
      return (
        <EstadoVacio titulo="Esta página no tiene entidades" compacto accion={<Link href={hrefEntidades(parametros)} className={ACCION}>Ir a la página 1</Link>}>
          La lista llega hasta la página {numero(paginas)}.
        </EstadoVacio>
      );
    }
    const sinBusqueda = hrefEntidades({ ...parametros, q: undefined });
    // Sin búsqueda pero con filtros: lo que no da resultados es la combinación (se quitan en la barra, uno a uno).
    const conFiltros = Object.entries(parametros).some(([k, v]) => k !== "q" && k !== "orden" && !!v);
    if (!q && conFiltros) {
      return (
        <EstadoVacio compacto titulo="Ninguna entidad coincide con estos filtros">
          Quita el filtro más restrictivo.
        </EstadoVacio>
      );
    }
    return (
      <EstadoVacio
        compacto
        titulo={qRuc ? `Ninguna entidad de la lista tiene el RUC ${qRuc}` : q ? `Ninguna entidad coincide con «${q}»` : "No hay entidades para mostrar"}
        accion={
          q ? (
            <span className="flex flex-wrap items-center justify-center gap-2">
              {qRuc && (
                <Link href={`/entidad/${qRuc}`} className={ACCION_PRIMARIA}>
                  Abrir la ficha del RUC {qRuc}
                </Link>
              )}
              <Link href={sinBusqueda} className={ACCION}>
                Borrar la búsqueda
              </Link>
            </span>
          ) : undefined
        }
      >
        {qRuc ? "Puede tener ficha aunque no tenga contratos en la lista: ábrela con su RUC." : "Prueba con otra palabra del nombre oficial, o pega el RUC (11 dígitos o su comienzo)."}
      </EstadoVacio>
    );
  }

  // Puesto en el ranking por contratos con dictamen (el orden del servidor), contando las páginas anteriores. Con otro
  // orden no hay ranking: sin puesto.
  const porDictamen = orden === "dictamen";

  // De dónde vino (esta lista con sus filtros), para las migas de la ficha y para que "volver" la restaure.
  const desde = urlDesde("/app/entidades", parametros);
  const filas: Fila[] = pagina.data.map((e, k) => filaEntidad(e, porDictamen ? (actual - 1) * tam + k + 1 : null, desde));

  const pag = (subir: boolean) => (
    <Paginacion
      actual={actual}
      paginas={paginas}
      total={total}
      tam={tam}
      navegacion="url"
      hrefBase="/app/entidades"
      query={parametros}
      cargando={false}
      nombre="entidades"
      subir={subir}
    />
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={porDictamen ? COLUMNAS_DICTAMEN : COLUMNAS} filas={filas} etiqueta={ETIQUETA_ORDEN[orden] ?? ETIQUETA_ORDEN.contratos} densidad="compacta" />
      {paginas > 1 && <div className="flex justify-end">{pag(true)}</div>}
    </div>
  );
}

// ─── Banderas de una entidad ─────────────────────────────────────────────────

type Sev = "alta" | "media" | "baja";

/** Una bandera de la entidad: su chip, qué significa, cuántos y dónde está la evidencia en su ficha. */
interface Bandera {
  tipo: string;
  severidad: Sev;
  chip: string;
  titulo: string;
  explica: string;
  href: string;
}

const NEPOTISMO = "Un pariente que un funcionario declaró en su DJI figura entre sus locadores (indicio, no acusación)";
const TIPOS_CAPTURA = "partido_gobernante,vendio_gobernante,socio_en_entidad";

/**
 * Las banderas de la fila, de lo que ya cuentan los filtros de la lista (captura, informes penales, nepotismo, planilla
 * con señal alta, plazas a la medida), cada una con su cuenta y el enlace a la evidencia en la ficha (los mismos filtros
 * que usa su Inicio). `null`: la API vieja no las trae (la celda dice «Sin dato», no «Ninguna»).
 */
function banderasDe(e: ApiEntidad): Bandera[] | null {
  const s = e.senales;
  const inf = e.informes;
  if (!s || !inf) return e.conNepotismo ? [banderaNepotismo(e.ruc)] : null;
  const ficha = `/entidad/${e.ruc}`;
  const partido = s.capturaPartido ? tituloNatural(s.capturaPartido) : null;
  const periodo = new URLSearchParams({ seccion: "contratos", vista: "contratos", cruce: TIPOS_CAPTURA, ...(s.capturaDesde ? { desde: s.capturaDesde } : {}), ...(s.capturaHasta ? { hasta: s.capturaHasta } : {}) });
  const out: Bandera[] = [];
  if (s.captura > 0) {
    out.push({
      tipo: "captura", severidad: "alta", chip: "Captura política",
      titulo: s.captura === 1 ? "1 contrato lo ganó una empresa ligada a la gestión" : `${numero(s.captura)} contratos los ganaron empresas ligadas a la gestión`,
      explica: `La empresa ganadora, o alguien detrás de ella, financió${partido ? ` a ${partido}, que la gobierna,` : " al partido que la gobierna"} o le vendió a su campaña, o un socio suyo trabaja en la entidad (ONPE, JNE, RNP). Contratos de su gobierno actual.`,
      href: `${ficha}?${periodo}`,
    });
  }
  if (s.planillaAlta > 0) {
    out.push({
      tipo: "planilla", severidad: "alta", chip: "Planilla: señal alta",
      titulo: `${plural(s.planillaAlta, "persona de su planilla tiene", "personas de su planilla tienen")} una señal alta`,
      explica: "En su planilla del Portal de Transparencia: por ejemplo, cobran también por órdenes de servicio o fueron candidatos del partido que la gobierna.",
      href: `${ficha}?seccion=planilla&lsev=alta`,
    });
  }
  if (inf.penal > 0) {
    out.push({
      tipo: "penal", severidad: "media", chip: "Resp. penal presunta",
      titulo: `${plural(inf.penal, "informe de la Contraloría señala", "informes de la Contraloría señalan")} presunta responsabilidad penal`,
      explica: "De sus funcionarios, según los informes de control de la Contraloría. Es una presunción: no es una condena.",
      href: `${ficha}?seccion=control`,
    });
  }
  if (e.conNepotismo) out.push(banderaNepotismo(e.ruc));
  if (s.plazasSenales > 0) {
    out.push({
      tipo: "plazas", severidad: "media", chip: "Plazas a la medida",
      titulo: `${plural(s.plazasSenales, "plaza CAS tiene", "plazas CAS tienen")} señales de plaza a la medida`,
      explica: "Convocatorias de SERVIR Talento Perú con rasgos de una plaza hecha a la medida de alguien: piden experiencia en la propia entidad, pagan mucho y piden poco o estuvieron publicadas muy poco tiempo. No prueban un direccionamiento.",
      href: `${ficha}?seccion=plazas&zsev=con`,
    });
  }
  return out;
}

function banderaNepotismo(ruc: string): Bandera {
  return {
    tipo: "nepotismo", severidad: "media", chip: "Posible nepotismo", titulo: "Posible nepotismo", explica: `${NEPOTISMO}.`,
    href: `/entidad/${ruc}?seccion=personas&psenal=nepotismo`,
  };
}

/** Las banderas en UNA línea (`CrucesCelda`): las graves primero, hasta dos y «+n»; sin ninguna, «Ninguna». */
function CeldaBanderas({ banderas }: { banderas: Bandera[] | null }) {
  if (!banderas) return <span className="text-meta text-mute">Sin dato</span>;
  if (!banderas.length) return <span className="text-meta text-mute">Ninguna</span>;
  return (
    <CrucesCelda
      cruces={banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))}
      etiquetas={Object.fromEntries(banderas.map((b) => [b.tipo, b.chip]))}
      explicaciones={Object.fromEntries(banderas.map((b) => [b.tipo, b.titulo]))}
      etiquetaLista="Banderas de la entidad"
    />
  );
}

// ─── Fila ────────────────────────────────────────────────────────────────────

/** Su presupuesto en la celda: el PIM compacto y el año (y si es el de todo el gobierno regional). */
function CeldaPresupuesto({ p }: { p: ApiEntidad["presupuesto"] }) {
  if (!p) return <CeldaNumero><span className="font-sans text-mute">Sin dato</span></CeldaNumero>;
  return <CeldaNumero sub={p.deTodoElGobierno ? `${p.anio}, todo el GORE` : `PIM ${p.anio}`}>{solesCompacto(p.pim)}</CeldaNumero>;
}

function CeldaAntecedentes({ a }: { a: ApiEntidad["antecedentes"] }) {
  if (a === undefined || a === null) return <CeldaNumero><span className="font-sans text-mute">Sin dato</span></CeldaNumero>;
  return <CeldaNumero sub={a.alta > 0 ? plural(a.alta, "grave", "graves") : undefined}>{numero(a.con)}</CeldaNumero>;
}

function filaEntidad(e: ApiEntidad, puesto: number | null, desde?: string): Fila {
  // El tipo no es un nivel de riesgo: se infiere del nombre oficial y, si no se puede, no se dice.
  const tipo = etiquetaTipoVisible(e.tipo, e.nombre, "corto");
  const tipoLargo = etiquetaTipoVisible(e.tipo, e.nombre, "largo");
  const nombre = tituloNatural(e.nombre);
  const banderas = banderasDe(e);
  return {
    id: e.ruc,
    celdas: {
      puesto: puesto != null ? <span className="font-mono text-rotulo tabular-nums text-mute">{numero(puesto)}</span> : null,
      entidad: (
        <CeldaPrincipal
          // Con su nombre propio, como en su ficha: no en las mayúsculas del SEACE.
          titulo={nombre}
          meta={[
            tipo && <Dato key="tipo" tipo="tipo" nombre="Tipo de entidad">{tipo}</Dato>,
            e.region && <Dato key="region" tipo="lugar">{e.region}</Dato>,
            <Dato key="ruc" tipo="ruc">
              RUC <span className="font-mono tabular-nums" translate="no">{e.ruc}</span>
            </Dato>,
          ]}
        />
      ),
      banderas: <CeldaBanderas banderas={banderas} />,
      contratos: <CeldaNumero>{e.contratos != null ? numero(e.contratos) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      antecedentes: <CeldaAntecedentes a={e.antecedentes} />,
      presupuesto: <CeldaPresupuesto p={e.presupuesto} />,
      informes: <CeldaNumero>{e.informes ? numero(e.informes.total) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      dictamen: <CeldaNumero sub={e.contratos != null ? `de ${numero(e.contratos)}` : undefined}>{numero(e.alertas)}</CeldaNumero>,
    },
    detalle: {
      titulo: nombre,
      etiqueta: `Vista previa de ${nombre}`,
      descripcion: (
        <span className="flex flex-wrap items-baseline gap-x-3">
          {tipoLargo && <span>{tipoLargo}</span>}
          <span className="font-mono tabular-nums">RUC {e.ruc}</span>
        </span>
      ),
      ficha: conDesde(`/entidad/${e.ruc}`, desde),
      contenido: <VistaPrevia e={e} tipo={tipoLargo} puesto={puesto} banderas={banderas} />,
    },
  };
}

/** El panel de una fila (§14.4), sólo con lo que trae la fila: sus banderas con su evidencia y lo que tiene. */
function VistaPrevia({ e, tipo, puesto, banderas }: { e: ApiEntidad; tipo: string | null; puesto: number | null; banderas: Bandera[] | null }) {
  const leida = e.alertas > 0;
  const lugar = [e.distrito, e.provincia, e.region].filter((x, i, xs) => x && xs.indexOf(x) === i).map((x) => tituloNatural(x!)).join(", ");
  const a = e.antecedentes;
  const p = e.presupuesto;
  const ficha = `/entidad/${e.ruc}`;
  const datos: DatoClave[] = [
    ...(tipo ? [{ etiqueta: "Tipo", valor: tipo }] : []),
    { etiqueta: "Dónde", valor: lugar || null },
    ...(e.pliegoNombreMef ? [{ etiqueta: "Pliego en el MEF", valor: tituloNatural(e.pliegoNombreMef) }] : []),
    { etiqueta: "Contratos desde 2015", valor: e.contratos != null ? numero(e.contratos) : null, mono: true },
    {
      etiqueta: "Con antecedentes del ganador",
      // Las mismas palabras que la cifra de su ficha («50 con antecedentes graves»).
      valor: a ? (a.con > 0 ? `${numero(a.con)}, ${a.alta > 0 ? plural(a.alta, "con un antecedente grave", "con antecedentes graves") : "ninguno grave"}` : "Ninguno") : null,
    },
    {
      etiqueta: p ? `Presupuesto ${p.anio}${p.deTodoElGobierno ? " (todo el gobierno regional)" : ""}` : "Presupuesto",
      valor: p ? `${soles(p.pim)}, ${porcentaje((p.devengado / p.pim) * 100, { decimales: 0 })} ya gastado` : null,
      ayuda: (
        <Ayuda titulo="¿De dónde sale?">
          El presupuesto institucional modificado (PIM) y lo devengado de su unidad ejecutora en el MEF (Consulta Amigable). «Sin
          dato»: Vigía no encontró su unidad ejecutora en el MEF.
        </Ayuda>
      ),
    },
    {
      etiqueta: "Informes de la Contraloría",
      valor: e.informes ? (e.informes.total > 0 ? `${numero(e.informes.total)}${e.informes.penal > 0 ? `, ${numero(e.informes.penal)} con presunta responsabilidad penal` : ""}` : "Ninguno") : null,
    },
    {
      etiqueta: "Con dictamen publicado",
      valor: leida ? `${numero(e.alertas)} de ${numero(e.contratos ?? e.alertas)}, puntaje promedio ${numero(e.scorePromedio)} de 100` : "Ninguno todavía",
      ayuda: (
        <Ayuda titulo="¿Qué es el dictamen?">
          La lectura de Vigía de un contrato: sus señales con la norma y la página del expediente. El puntaje promedio va de 0 a
          100 y un contrato sin señales puntúa 0; no es una probabilidad de delito.
        </Ayuda>
      ),
    },
    ...(puesto != null ? [{ etiqueta: "Puesto por dictámenes", valor: numero(puesto), mono: true }] : []),
  ];
  return (
    <CuerpoDetalle>
      <BloqueDetalle titulo="Qué se encontró" ayuda={AYUDA_BANDERAS}>
        {banderas && banderas.length > 0 ? (
          <ul className="space-y-3">
            {banderas.map((b) => (
              <li key={b.tipo} className="flex gap-2">
                <Severidad bandera={b.severidad} formato="punto" className="mt-0.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block text-dato font-semibold leading-snug text-ink">{b.titulo}</span>
                  <span className="mt-0.5 block text-meta leading-snug text-inkSoft">{b.explica}</span>
                  <Link href={b.href} className="mt-1 inline-flex min-h-6 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-2 hover:underline">
                    Ver la evidencia en su ficha <ChevronRight size={13} aria-hidden />
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-dato text-inkSoft">{banderas ? "Ninguna de estas banderas: los registros que cruza Vigía no la señalan." : "Sin dato: no pudimos leer sus banderas."}</p>
        )}
      </BloqueDetalle>
      <DatosClave items={datos} />
      {a && a.con > 0 && (
        <Link href={`${ficha}?seccion=contratos&cruces=${a.alta > 0 ? "alta" : "con"}`} className="inline-flex min-h-6 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-2 hover:underline">
          Ver sus contratos con antecedentes{a.alta > 0 ? " graves" : ""} <ChevronRight size={13} aria-hidden />
        </Link>
      )}
    </CuerpoDetalle>
  );
}

/** `/app/entidades` con estos parámetros (sin página: vuelve a la 1). */
export function hrefEntidades(parametros: Record<string, string | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(parametros)) if (v) q.set(k, v);
  const qs = q.toString();
  return qs ? `/app/entidades?${qs}` : "/app/entidades";
}
