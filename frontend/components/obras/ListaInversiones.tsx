import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, HardHat, Landmark, MapPin } from "lucide-react";
import { Ayuda, AyudaTermino, BloqueDetalle, ChipsDetalle, CuerpoDetalle, DatosClave, EstadoError, EstadoVacio, type DatoClave } from "@/components/patrones";
import { BarraFiltros, CeldaFecha, CeldaNumero, CeldaPrincipal, Tabla, type Columna, type FiltroSecundario, type Fila, type Parametros } from "@/components/listado";
import { enSeccion } from "@/components/contratos/filtros";
import { ChipsCruces, CrucesCelda } from "@/components/contratos/CrucesCelda";
import { EstadoCompra, ListaCargando, opcionesDe } from "@/components/ordenes/ListaOrdenes";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { CifrasEnFila, type Cifra } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, claseAccion } from "@/components/ui/EnlaceAccion";
import { Paginacion } from "@/components/ui/Paginacion";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha as fechaLarga, fechaCorta, numero, oracion, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import { BANDERAS_INVERSION, ESTADOS_INVERSION, FUENTE_INVERSION, MONTOS_INVERSION, ORDENES_LISTA, P_INV, P_OBRA, type Inversion, type InversionesPagina } from "@/lib/obras";
import { BloqueBanderasObra } from "./ListaObras";

/** La nota al pie de las banderas de una inversión. */
export const NOTA_INVERSION = `Fuente: ${FUENTE_INVERSION}. Un costo que sube puede tener explicación (un expediente técnico más completo, precios nuevos): es un indicio para revisar, no una acusación.`;

/**
 * La lista de inversiones de una entidad en Invierte.pe (MEF): cada proyecto con su CUI, el monto con que se declaró
 * viable, lo que cuesta hoy y lo gastado; el panel dice cuánto se encareció, sus contratos en Vigía (por el CUI del
 * proceso) y cuántas obras de INFOBRAS tiene, con el enlace al seguimiento de la inversión en el MEF.
 */

const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "104px", desde: "md", apilar: true },
  { clave: "inversion", titulo: "Inversión", ancho: "minmax(0,1.8fr)" },
  {
    clave: "banderas", titulo: "Banderas", ancho: "minmax(0,0.8fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué banderas se revisan?">
        <span className="block">
          Cuánto se encareció: el costo actualizado frente al monto con que se declaró viable (1.5 veces o más, con S/ 100
          mil de diferencia o más) y si registra laudos arbitrales.
        </span>
        <span className="mt-2 block">Salen de Invierte.pe (MEF). Son indicios para revisar, no acusaciones.</span>
      </Ayuda>
    ),
  },
  { clave: "viable", titulo: "Monto viable", corto: "Viable", ancho: "112px", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="monto-viable" /> },
  { clave: "actualizado", titulo: "Costo hoy", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="costo-actualizado" /> },
  { clave: "viabilidad", titulo: "Viable desde", corto: "Viable desde", ancho: "104px", desde: "lg", apilar: "con-rotulo" },
];

export function ListaInversionesCargando() {
  return <ListaCargando texto="Cargando las inversiones…" columnas={COLUMNAS} />;
}

export async function BarraInversiones({ pagina }: { pagina: Promise<InversionesPagina | null> }) {
  const p = await pagina;
  const f = p?.facetas ?? null;
  const funciones = Object.entries(f?.funcion ?? {}).sort((a, b) => b[1] - a[1]);
  const filtros: FiltroSecundario[] = [
    ...(funciones.length
      ? enSeccion("Qué", { param: P_INV.funcion, etiqueta: "Función del Estado", todas: "Todas las funciones", opciones: funciones.map(([k, n]) => ({ valor: k, etiqueta: tituloNatural(k), conteo: n })) })
      : []),
    ...enSeccion("Cuánto", { param: P_INV.monto, etiqueta: "Costo hoy", todas: "Cualquier costo", opciones: opcionesDe(MONTOS_INVERSION, f?.monto) }),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: P_INV.q, placeholder: "Buscar por nombre de la inversión, CUI o lugar…", etiqueta: "Buscar en las inversiones", min: 3 }}
      visibles={[
        { param: P_INV.estado, etiqueta: "Estado", corta: "Estado", todas: "Activas y cerradas", opciones: opcionesDe(ESTADOS_INVERSION, f?.estado) },
        { param: P_INV.bandera, etiqueta: "Banderas", corta: "Banderas", todas: "Todas", opciones: opcionesDe(BANDERAS_INVERSION, f?.bandera) },
        { param: P_INV.contrato, etiqueta: "Con contrato en Vigía", corta: "Contrato", todas: "Todas", opciones: [{ valor: "con", etiqueta: "Con un contrato en Vigía", conteo: f?.contrato ? f.contrato.con ?? 0 : null }] },
      ]}
      filtros={filtros}
      orden={{ param: P_INV.orden, porDefecto: "reciente", opciones: ORDENES_LISTA.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

/** La lista de obras de la entidad con el CUI de la inversión en la búsqueda. */
export const obrasDeLaInversion = (v: Inversion) => `/entidad/${v.entidad.ruc}?${new URLSearchParams({ seccion: "obras", [P_OBRA.q]: v.cui })}`;

export function cifrasInversion(v: Inversion): Cifra[] {
  const m = v.montos;
  return [
    { valor: m.viable ? solesCompacto(m.viable) : null, etiqueta: "monto viable", ayuda: <AyudaTermino clave="monto-viable" />, contexto: v.fechas.viabilidad ? `declarada viable el ${fechaCorta(v.fechas.viabilidad)}` : "lo que se aprobó" },
    {
      valor: m.actualizado ? solesCompacto(m.actualizado) : null,
      etiqueta: "costo actualizado",
      ayuda: <AyudaTermino clave="costo-actualizado" />,
      contexto: v.veces != null ? `${v.veces.toLocaleString("es-PE", { maximumFractionDigits: 2 })} veces lo viable` : "lo que cuesta hoy",
      tono: v.banderas.some((b) => b.tipo === "inversion_sobrecosto_extremo") ? "alta" : v.banderas.some((b) => b.tipo === "inversion_sobrecosto") ? "media" : undefined,
    },
    { valor: m.devengado != null ? solesCompacto(m.devengado) : null, etiqueta: "gastado", ayuda: <AyudaTermino clave="devengado" />, contexto: m.actualizado && m.devengado != null ? `el ${porcentaje((100 * m.devengado) / m.actualizado)} del costo` : "devengado acumulado" },
    { valor: v.avanceFisico != null ? porcentaje(v.avanceFisico, { decimales: 1 }) : null, etiqueta: "avance físico", ayuda: <AyudaTermino clave="avance-fisico" />, contexto: v.estado === "cerrada" ? "inversión cerrada" : "lo que informa la entidad" },
  ];
}

export function datosInversion(v: Inversion): DatoClave[] {
  const m = v.montos;
  const lugar = [v.lugar.distrito, v.lugar.provincia, v.lugar.departamento].filter(Boolean).map((x) => tituloNatural(x!)).join(", ");
  const items: (DatoClave | null)[] = [
    { etiqueta: "Inversión", valor: v.nombre ? oracion(v.nombre) : null },
    { etiqueta: "CUI", valor: v.cui, mono: true, ayuda: <AyudaTermino clave="cui" /> },
    { etiqueta: "Estado", valor: [v.estado === "cerrada" ? "Cerrada" : "Activa", v.situacion ? oracion(v.situacion) : null].filter(Boolean).join(", ") },
    v.funcion ? { etiqueta: "Función", valor: tituloNatural(v.funcion) } : null,
    v.tipo ? { etiqueta: "Tipo", valor: oracion(v.tipo) } : null,
    v.modalidad ? { etiqueta: "Cómo se ejecuta", valor: oracion(v.modalidad) } : null,
    v.unidadEjecutora ? { etiqueta: "Unidad que la ejecuta", valor: tituloNatural(v.unidadEjecutora) } : null,
    lugar ? { etiqueta: "Dónde", valor: lugar } : null,
    m.expediente ? { etiqueta: "Expediente técnico", valor: soles(m.expediente), mono: true, ayuda: <AyudaTermino clave="expediente-tecnico" /> } : null,
    m.pimAnio != null && m.pimAnio > 0 ? { etiqueta: "Para gastar este año (PIM)", valor: soles(m.pimAnio), mono: true, ayuda: <AyudaTermino clave="pim" /> } : null,
    m.devengadoAnio != null && m.devengadoAnio > 0 ? { etiqueta: "Gastado este año", valor: soles(m.devengadoAnio), mono: true } : null,
    m.liquidacion ? { etiqueta: "Costo final (liquidación)", valor: soles(m.liquidacion), mono: true } : null,
    m.controlConcurrente ? { etiqueta: "Control concurrente", valor: `${soles(m.controlConcurrente)} (la Contraloría la revisa mientras se ejecuta)`, ayuda: <AyudaTermino clave="control-concurrente" /> } : null,
    m.laudo ? { etiqueta: "Laudos arbitrales", valor: soles(m.laudo), mono: true, ayuda: <AyudaTermino clave="controversia-obra" /> } : null,
    v.fechas.inicio ? { etiqueta: "Ejecución", valor: `${fechaCorta(v.fechas.inicio)}${v.fechas.fin ? ` a ${fechaCorta(v.fechas.fin)}` : ""}`, mono: true } : null,
    v.fechas.cierre ? { etiqueta: "Cerrada el", valor: fechaCorta(v.fechas.cierre), mono: true } : null,
    v.beneficiarios ? { etiqueta: "Beneficiarios", valor: plural(v.beneficiarios, "persona", "personas") } : null,
    v.obras ? { etiqueta: "Obras en INFOBRAS", valor: plural(v.obras, "obra", "obras") } : null,
  ];
  return items.filter(Boolean) as DatoClave[];
}

function filaInversion(v: Inversion): Fila {
  const estado = <EstadoCompra estado={v.estado === "cerrada" ? "Cerrada" : "Activa"} explica={v.situacion ?? undefined} />;
  const dudoso = v.dudoso.map(motivoDudoso).find((m) => !!m) ?? null;
  const lugar = [v.lugar.distrito, v.lugar.provincia].filter(Boolean).map((x) => tituloNatural(x!)).join(", ");
  return {
    id: `inv-${v.cui}`,
    celdas: {
      estado: (
        <span className="flex flex-col items-start gap-1">
          {estado}
          {dudoso && <BanderaDato motivo={dudoso} fuente="invierte_pe" />}
        </span>
      ),
      inversion: (
        <CeldaPrincipal
          titulo={v.nombre ? oracion(v.nombre) : `Inversión ${v.cui}`}
          dosLineas
          meta={[
            lugar && <Dato key="lugar" icono={MapPin} nombre="Dónde">{lugar}</Dato>,
            v.funcion && <Dato key="fun" icono={Landmark} nombre="Función">{tituloNatural(v.funcion)}</Dato>,
            v.obras > 0 && <Dato key="obras" icono={HardHat} nombre="Obras en INFOBRAS">{plural(v.obras, "obra", "obras")}</Dato>,
            <Dato key="cui" tipo="codigo" nombre="CUI" mono>{`CUI ${v.cui}`}</Dato>,
          ]}
        />
      ),
      banderas: v.banderas.length ? (
        <CrucesCelda cruces={v.banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))} etiquetaLista="Banderas de la inversión" />
      ) : (
        <span className="hidden text-meta text-mute lg:inline">Ninguna</span>
      ),
      viable: <CeldaNumero>{v.montos.viable ? solesCompacto(v.montos.viable) : "Sin dato"}</CeldaNumero>,
      actualizado: (
        <CeldaNumero sub={v.veces != null && v.veces >= 1.05 ? `${v.veces.toLocaleString("es-PE", { maximumFractionDigits: 1 })} veces` : undefined}>
          {v.montos.actualizado ? solesCompacto(v.montos.actualizado) : "Sin dato"}
        </CeldaNumero>
      ),
      viabilidad: <CeldaFecha fecha={v.fechas.viabilidad} />,
    },
    detalle: {
      titulo: `Inversión ${v.cui}`,
      etiqueta: `Ver el detalle de la inversión ${v.cui}`,
      descripcion: v.nombre ? oracion(v.nombre) : undefined,
      contenido: (
        <CuerpoDetalle>
          <ChipsDetalle>
            {estado}
            {v.banderas.length > 0 && <ChipsCruces cruces={v.banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))} etiquetaLista="Banderas de la inversión" />}
          </ChipsDetalle>
          {dudoso && <AvisoDato motivo={dudoso} fuente="invierte_pe" suma={false} />}
          <CifrasEnFila items={cifrasInversion(v)} chico />
          <DatosClave items={datosInversion(v)} />
          <BloqueBanderasObra banderas={v.banderas} sujeto="La inversión" nota={NOTA_INVERSION} />
          {v.contratos.length > 0 && (
            <BloqueDetalle
              titulo={v.contratos.length > 1 ? "Sus contratos en Vigía" : "Su contrato en Vigía"}
              ayuda={<Ayuda titulo="¿Cómo se reconoce?">El proceso trae el CUI de la inversión (en el registro OCDS o en su descripción) y la inversión es de la misma entidad que contrata.</Ayuda>}
            >
              <ul className="space-y-1.5">
                {v.contratos.map((k) => (
                  <li key={k.ocid}>
                    <Link href={rutaContrato(k.ocid, "ficha", { seccion: "adjudicacion" })} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
                      Contrato {k.codigo ?? k.ocid}
                    </Link>
                    <span className="ml-1.5 text-meta text-mute">{[k.tipo ? tituloNatural(k.tipo) : null, k.fecha ? `convocado el ${fechaCorta(k.fecha)}` : null].filter(Boolean).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </BloqueDetalle>
          )}
          <BloqueDetalle titulo="Dónde verlo">
            <div className="flex flex-wrap gap-2">
              <a href={v.url} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                Seguimiento de la inversión en el MEF
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
              {/* Sus obras en INFOBRAS: la lista de obras de la entidad, buscando el CUI. */}
              {v.obras > 0 && v.entidad.ruc && v.entidad.ficha && (
                <Link href={obrasDeLaInversion(v)} prefetch={false} className={claseAccion("secundario")}>
                  {v.obras === 1 ? "Su obra en INFOBRAS" : `Sus ${numero(v.obras)} obras en INFOBRAS`}
                </Link>
              )}
            </div>
          </BloqueDetalle>
        </CuerpoDetalle>
      ),
      pie: <span className="text-rotulo text-mute">Fuente: {FUENTE_INVERSION}, CUI {v.cui}{v.alDia ? `, archivo del ${fechaLarga(v.alDia)}` : ""}</span>,
    },
  };
}

const SIN_INVERSIONES: ReactNode = (
  <EstadoVacio compacto conLlamita={false} titulo="No registra inversiones en Invierte.pe">
    El Banco de Inversiones del MEF no tiene inversiones activas ni cerradas de su unidad ejecutora.
  </EstadoVacio>
);

export async function ListaInversiones({
  pagina: p,
  ruta,
  parametros,
  actual,
  vacia = SIN_INVERSIONES,
}: {
  pagina: Promise<InversionesPagina | null>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  vacia?: ReactNode;
}) {
  const pagina = await p;
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos cargar las inversiones" accion={<a href={ruta} className={CLASE_ACCION_LISTA}>Reintentar</a>}>
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  if (!pagina.data.length) {
    const filtrada = Object.entries(P_INV).some(([k, param]) => k !== "orden" && k !== "page" && !!parametros[param]);
    if (actual > 1) {
      return <EstadoVacio compacto titulo="Esta página de la lista ya no tiene inversiones" accion={<Link href={ruta} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>} />;
    }
    return filtrada ? <EstadoVacio compacto titulo="Ninguna inversión con estos filtros">Cambia la búsqueda o quita un filtro.</EstadoVacio> : <>{vacia}</>;
  }
  const filas = pagina.data.map(filaInversion);
  const tam = pagina.size || filas.length;
  const total = pagina.total ?? (actual - 1) * tam + filas.length;
  const paginas = Math.max(1, Math.ceil(total / tam));
  const pag = (subir: boolean) => (
    <Paginacion actual={actual} paginas={paginas} total={total} tam={tam} navegacion="url" hrefBase={ruta} query={parametros} paramPagina={P_INV.page} cargando={false} nombre="inversiones" subir={subir} />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Inversiones de Invierte.pe" />
      <div className="flex justify-end">{pag(true)}</div>
      <p className="text-rotulo text-mute">Invierte.pe (MEF), Banco de Inversiones: inversiones activas y cerradas de su unidad ejecutora. {numero(total)} en total.</p>
    </div>
  );
}
