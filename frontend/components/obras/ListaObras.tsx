import Link from "next/link";
import type { ReactNode } from "react";
import { ExternalLink, FileText, HardHat, MapPin, Store } from "lucide-react";
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
import { enlaceProveedor } from "@/lib/empresas";
import { fecha as fechaLarga, fechaCorta, numero, oracion, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { rutaContrato } from "@/lib/rutas";
import {
  BANDERAS_OBRA, ESTADOS_OBRA, ESTADO_TEXTO, FUENTE_OBRA, MODALIDADES_OBRA, MONTOS_OBRA, ORDENES_LISTA, P_OBRA, fraseBandera,
  type Obra, type ObrasPagina, type QuienObra,
} from "@/lib/obras";

/**
 * La lista de obras públicas de INFOBRAS (Contraloría): las que registra una entidad (su pestaña «Obras») o las que
 * ejecuta o supervisa una empresa. Cada obra abre su panel con lo que dice INFOBRAS (estado, avance físico frente a lo
 * programado, lo pagado, la paralización, los adicionales, las ampliaciones de plazo), sus banderas dichas en palabras,
 * el contrato de Vigía que la ejecuta o la supervisa y el enlace a su ficha oficial.
 *
 * Fila de todo listado (§14.1): estado (chip) · qué obra, con dónde, quién la construye y su código · banderas · avance ·
 * costo · inicio. Las banderas son indicios para revisar, no acusaciones: la causa de una paralización o de un atraso
 * puede ser de la entidad (falta de pago o de presupuesto) y no del contratista.
 */

const COLUMNAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "112px", desde: "md", apilar: true },
  { clave: "obra", titulo: "Obra", ancho: "minmax(0,1.8fr)" },
  {
    clave: "banderas", titulo: "Banderas", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué banderas se revisan?">
        <span className="block">
          Paralizada (hoy o antes, con los días y la causa), atrasada (el avance físico 20 puntos o más por debajo de lo
          programado), pagada más de lo construido (la ejecución financiera 30 puntos o más sobre el avance físico),
          adicionales de obra (en una obra por contrata, más del 15 % del contrato es el tope sin la Contraloría), plazo
          ampliado, controversias y los informes de la Contraloría.
        </span>
        <span className="mt-2 block">Salen de lo que la entidad registra en INFOBRAS. Son indicios para revisar, no acusaciones.</span>
      </Ayuda>
    ),
  },
  { clave: "avance", titulo: "Avance físico", corto: "Avance", ancho: "112px", alinear: "der", desde: "md", apilar: "con-rotulo", ayuda: <AyudaTermino clave="avance-fisico" /> },
  { clave: "monto", titulo: "Costo", ancho: "116px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "inicio", titulo: "Inicio", ancho: "104px", desde: "md", apilar: "con-rotulo" },
];

/** Mientras llega la página de obras. */
export function ListaObrasCargando() {
  return <ListaCargando texto="Cargando las obras…" columnas={COLUMNAS} />;
}

/** El costo de la obra: el del contrato y, sin contrato (administración directa), el del expediente técnico. */
const costoDe = (o: Obra): { monto: number | null; de: string | null } =>
  o.montos.contrato ? { monto: o.montos.contrato, de: "contrato" } : o.montos.expediente ? { monto: o.montos.expediente, de: "expediente técnico" } : { monto: null, de: null };

/** Quién la construye o la supervisa, en palabras (una persona natural llega con un apellido tapado). */
function nombreQuien(q: QuienObra | null): string | null {
  if (!q) return null;
  if (q.nombre) return tituloNatural(q.nombre);
  return q.tipo === "persona" ? "Una persona natural" : null;
}

/**
 * La barra de las obras, por pregunta: a la vista el estado, las banderas y si tiene contrato en Vigía; en «Filtros»,
 * cómo se ejecuta, cuánto cuesta y cuándo empezó (y, en la ficha de una empresa, si la ejecuta o la supervisa). Cada
 * opción con su conteo (la API cuenta cada filtro con los demás puestos).
 */
export async function BarraObras({ pagina, deEmpresa = false }: { pagina: Promise<ObrasPagina | null>; deEmpresa?: boolean }) {
  const p = await pagina;
  const f = p?.facetas ?? null;
  const anios = Object.keys(f?.anio ?? {}).map(Number).filter(Number.isFinite).sort((a, b) => b - a);
  const filtros: FiltroSecundario[] = [
    ...enSeccion("Cómo", { param: P_OBRA.modalidad, etiqueta: "Cómo se ejecuta", todas: "De cualquier forma", opciones: opcionesDe(MODALIDADES_OBRA, f?.modalidad) }),
    ...(deEmpresa
      ? enSeccion("Quién", {
          param: P_OBRA.rol, etiqueta: "Su papel", todas: "La ejecuta o la supervisa",
          opciones: [
            { valor: "ejecucion", etiqueta: "La ejecuta (sola o en consorcio)", conteo: f?.rol ? f.rol.ejecucion ?? 0 : null },
            { valor: "supervision", etiqueta: "La supervisa", conteo: f?.rol ? f.rol.supervision ?? 0 : null },
          ],
        })
      : []),
    ...enSeccion("Cuánto", { param: P_OBRA.monto, etiqueta: "Costo", todas: "Cualquier costo", opciones: opcionesDe(MONTOS_OBRA, f?.monto) }),
    ...(anios.length
      ? enSeccion("Cuándo", { param: P_OBRA.anio, etiqueta: "Año de inicio", todas: "Todos los años", opciones: anios.map((a) => ({ valor: String(a), etiqueta: String(a), conteo: f?.anio?.[String(a)] ?? 0 })) })
      : []),
  ];
  return (
    <BarraFiltros
      busqueda={{ param: P_OBRA.q, placeholder: "Buscar por nombre de la obra, lugar, CUI, código o empresa…", etiqueta: "Buscar en las obras", min: 3 }}
      visibles={[
        { param: P_OBRA.estado, etiqueta: "Estado", corta: "Estado", todas: "Todo estado", opciones: opcionesDe(ESTADOS_OBRA, f?.estado) },
        { param: P_OBRA.bandera, etiqueta: "Banderas", corta: "Banderas", todas: "Todas", opciones: opcionesDe(BANDERAS_OBRA, f?.bandera) },
        // Una sola opción: el kit la dibuja como chip que se prende y se apaga.
        { param: P_OBRA.contrato, etiqueta: "Con contrato en Vigía", corta: "Contrato", todas: "Todas", opciones: [{ valor: "con", etiqueta: "Con su contrato en Vigía", conteo: f?.contrato ? f.contrato.con ?? 0 : null }] },
      ]}
      filtros={filtros}
      orden={{ param: P_OBRA.orden, porDefecto: "reciente", opciones: ORDENES_LISTA.map((o) => ({ valor: o.valor, etiqueta: o.etiqueta })) }}
    />
  );
}

/** El avance de la obra en dos cifras: lo construido frente a lo programado, y lo pagado. */
export function cifrasObra(o: Obra): Cifra[] {
  const costo = costoDe(o);
  const a = o.avance;
  const adic = costo.monto && o.adicionales.monto > 0 ? (100 * o.adicionales.monto) / costo.monto : null;
  return [
    {
      valor: a.fisicoReal != null ? porcentaje(a.fisicoReal, { decimales: 1 }) : null,
      etiqueta: "avance físico",
      ayuda: <AyudaTermino clave="avance-fisico" />,
      contexto: a.fisicoProgramado != null ? `debía llevar ${porcentaje(a.fisicoProgramado, { decimales: 1 })}` : "sin avance programado registrado",
    },
    {
      valor: a.financiero != null ? porcentaje(a.financiero, { decimales: 1 }) : null,
      etiqueta: "ejecución financiera",
      ayuda: <AyudaTermino clave="avance-financiero" />,
      contexto: a.pagado ? soles(a.pagado) : "lo pagado, sin monto registrado",
    },
    {
      valor: o.adicionales.monto > 0 ? solesCompacto(o.adicionales.monto) : "Ninguno",
      etiqueta: "adicionales",
      ayuda: <AyudaTermino clave="adicional-obra" />,
      contexto: adic != null ? `el ${porcentaje(adic, { decimales: 1 })} del ${costo.de}` : o.adicionales.monto > 0 ? "sin costo con qué comparar" : "según INFOBRAS",
    },
    {
      valor: costo.monto ? solesCompacto(costo.monto) : null,
      etiqueta: costo.de === "expediente técnico" ? "costo del expediente" : "contrato",
      contexto: costo.monto ? soles(costo.monto) : "INFOBRAS no registra el costo",
    },
  ];
}

/** Los datos de la obra en el panel, en el orden en que se lee una obra: qué, dónde, quién, cuánto, cuándo, cómo va. */
export function datosObra(o: Obra, conEntidad: boolean): DatoClave[] {
  const costo = costoDe(o);
  const lugar = [o.lugar.distrito, o.lugar.provincia, o.lugar.departamento].filter(Boolean).map((x) => tituloNatural(x!)).join(", ");
  const enlaceEmpresa = (q: QuienObra | null) => {
    const href = enlaceProveedor(q?.ruc);
    const nombre = nombreQuien(q);
    if (!nombre) return null;
    return href ? (
      <Link href={href} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">{nombre}</Link>
    ) : (
      nombre
    );
  };
  const par = o.paralizacion;
  const items: (DatoClave | null)[] = [
    { etiqueta: "Obra", valor: oracion(o.nombre) },
    o.cui ? { etiqueta: "CUI", valor: o.cui, mono: true, ayuda: <AyudaTermino clave="cui" /> } : null,
    conEntidad && o.entidad.nombre
      ? { etiqueta: "Entidad", valor: o.entidad.ruc && o.entidad.ficha ? <Link href={`/entidad/${o.entidad.ruc}?seccion=obras`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">{tituloNatural(o.entidad.nombre)}</Link> : tituloNatural(o.entidad.nombre) }
      : null,
    lugar ? { etiqueta: "Dónde", valor: lugar } : null,
    o.modalidad ? { etiqueta: "Cómo se ejecuta", valor: o.modalidad, ayuda: o.modalidad === "Administración directa" ? <AyudaTermino clave="administracion-directa" /> : undefined } : null,
    o.ejecutor ? { etiqueta: "Quién la construye", valor: enlaceEmpresa(o.ejecutor) } : null,
    o.supervisor ? { etiqueta: "Quién la supervisa", valor: enlaceEmpresa(o.supervisor), ayuda: <AyudaTermino clave="supervision-obra" /> } : null,
    { etiqueta: costo.de === "expediente técnico" ? "Costo (expediente técnico)" : "Contrato de obra", valor: costo.monto ? soles(costo.monto) : null, mono: true },
    o.montos.supervision ? { etiqueta: "Contrato de supervisión", valor: soles(o.montos.supervision), mono: true } : null,
    o.montos.liquidacion ? { etiqueta: "Costo final (liquidación)", valor: soles(o.montos.liquidacion), mono: true } : null,
    { etiqueta: "Inicio", valor: o.fechas.inicio ? fechaCorta(o.fechas.inicio) : null, mono: true },
    o.plazo.dias ? { etiqueta: "Plazo", valor: plural(o.plazo.dias, "día", "días") } : null,
    o.fechas.finProgramada ? { etiqueta: "Debía terminar", valor: fechaCorta(o.fechas.finProgramada), mono: true } : null,
    o.plazo.ampliacion > 0
      ? { etiqueta: "Ampliaciones de plazo", valor: `${plural(o.plazo.ampliacion, "día", "días")}${o.plazo.modificaciones ? ` en ${plural(o.plazo.modificaciones, "modificación", "modificaciones")}` : ""}${o.fechas.finReprogramada ? `, hasta el ${fechaCorta(o.fechas.finReprogramada)}` : ""}`, ayuda: <AyudaTermino clave="ampliacion-plazo" /> }
      : null,
    o.fechas.finReal ? { etiqueta: "Terminó", valor: fechaCorta(o.fechas.finReal), mono: true } : null,
    par.si
      ? { etiqueta: "Paralización", valor: [par.desde ? `desde el ${fechaCorta(par.desde)}` : null, par.dias ? plural(par.dias, "día", "días") : null, par.causal].filter(Boolean).join(", ") || "Sí", ayuda: <AyudaTermino clave="paralizacion-obra" /> }
      : null,
    o.adicionales.n > 0 || o.adicionales.monto > 0
      ? { etiqueta: "Adicionales de obra", valor: `${o.adicionales.n > 0 ? plural(o.adicionales.n, "adicional", "adicionales") : "Adicionales"} por ${soles(o.adicionales.monto)}` }
      : null,
    o.adicionales.deductivos > 0
      ? { etiqueta: "Deductivos de obra", valor: `${o.adicionales.deductivosN > 0 ? plural(o.adicionales.deductivosN, "deductivo", "deductivos") : "Deductivos"} por ${soles(o.adicionales.deductivos)}`, ayuda: <AyudaTermino clave="deductivo-obra" /> }
      : null,
    o.adicionales.supervision > 0 ? { etiqueta: "Adicionales de supervisión", valor: soles(o.adicionales.supervision), mono: true } : null,
    o.controversias > 0 ? { etiqueta: "Controversias", valor: numero(o.controversias), ayuda: <AyudaTermino clave="controversia-obra" /> } : null,
    o.informesControl > 0 ? { etiqueta: "Informes de control", valor: numero(o.informesControl), ayuda: <AyudaTermino clave="informe-control" /> } : null,
    o.fechas.avance ? { etiqueta: "Último avance registrado", valor: fechaCorta(o.fechas.avance), mono: true } : null,
    o.motivoNo100 && o.estado === "Finalizado" && (o.avance.fisicoReal ?? 100) < 100 ? { etiqueta: "Por qué no llegó al 100 %", valor: o.motivoNo100 } : null,
  ];
  return items.filter(Boolean) as DatoClave[];
}

/** Las banderas en palabras, cada una con su chip: lo que se encontró y con qué números. */
export function BloqueBanderasObra({
  banderas,
  sujeto = "La obra",
  nota = `Fuente: ${FUENTE_OBRA}. Lo registra la propia entidad. Es un indicio para revisar, no una acusación: la causa puede ser de la entidad (falta de pago o de presupuesto) y no de quien construye.`,
}: {
  banderas: Obra["banderas"];
  sujeto?: string;
  nota?: string;
}) {
  if (!banderas.length) return null;
  return (
    <BloqueDetalle titulo="Lo que se encontró">
      <ul className="space-y-2.5">
        {banderas.map((b) => (
          <li key={b.tipo} className="space-y-1">
            <ChipsCruces cruces={[{ tipo: b.tipo, severidad: b.severidad }]} etiquetaLista="Bandera" />
            <p className="text-dato leading-relaxed text-inkSoft">{fraseBandera(b, sujeto)}</p>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-rotulo text-mute">{nota}</p>
    </BloqueDetalle>
  );
}

/** Los contratos de Vigía que ejecutan o supervisan la obra. */
function BloqueContratos({ o }: { o: Obra }) {
  if (!o.contratos.length) return null;
  return (
    <BloqueDetalle
      titulo={o.contratos.length > 1 ? "Sus contratos en Vigía" : "Su contrato en Vigía"}
      ayuda={
        <Ayuda titulo="¿Cómo se reconoce el contrato?">
          Por el CUI del proceso y el RUC de quien INFOBRAS registra como ejecutor o supervisor (que ganó la buena pro); un
          consorcio, por su nombre. Si el proceso no trae el CUI: el mismo ganador, la misma entidad y el mismo monto del contrato.
        </Ayuda>
      }
    >
      <ul className="space-y-1.5">
        {o.contratos.map((k) => (
          <li key={`${k.ocid}-${k.rol}`}>
            <Link href={rutaContrato(k.ocid, "ficha", { seccion: "adjudicacion" })} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
              {k.rol === "supervision" ? "Contrato de supervisión" : "Contrato de ejecución"} {k.codigo ?? k.ocid}
            </Link>
            {k.fecha && <span className="ml-1.5 text-meta text-mute">convocado el {fechaCorta(k.fecha)}</span>}
          </li>
        ))}
      </ul>
    </BloqueDetalle>
  );
}

/** La fila de una obra con su panel. `conEntidad`: la lista no es de una entidad (la de una empresa): se dice cuál. */
function filaObra(o: Obra, { conEntidad, empresaRuc }: { conEntidad: boolean; empresaRuc?: string }): Fila {
  const costo = costoDe(o);
  const estado = <EstadoCompra estado={o.estado ? ESTADO_TEXTO[o.estado] ?? o.estado : null} />;
  const dudoso = o.dudoso.map(motivoDudoso).find((m) => !!m) ?? null;
  const lugar = [o.lugar.distrito, o.lugar.provincia].filter(Boolean).map((x) => tituloNatural(x!)).join(", ");
  const quien = nombreQuien(o.ejecutor);
  const papel = empresaRuc ? (o.supervisor?.ruc === empresaRuc ? "La supervisa" : "La ejecuta") : null;
  const a = o.avance;
  return {
    id: `obra-${o.codigo}`,
    celdas: {
      estado: (
        <span className="flex flex-col items-start gap-1">
          {estado}
          {dudoso && <BanderaDato motivo={dudoso} fuente="infobras" />}
        </span>
      ),
      obra: (
        <CeldaPrincipal
          titulo={oracion(o.nombre)}
          dosLineas
          meta={[
            conEntidad && o.entidad.nombre && <Dato key="ent" tipo="entidad">{tituloNatural(o.entidad.nombre)}</Dato>,
            lugar && <Dato key="lugar" icono={MapPin} nombre="Dónde">{lugar}</Dato>,
            papel ? <Dato key="papel" icono={HardHat} nombre="Su papel">{papel}</Dato> : quien && <Dato key="quien" icono={Store} nombre="Quién la construye">{quien}</Dato>,
            o.modalidad && o.modalidad !== "Contrata" && <Dato key="mod" tipo="tipo" nombre="Cómo se ejecuta">{o.modalidad}</Dato>,
            <Dato key="cod" tipo="codigo" nombre="Código INFOBRAS" mono>{`INFOBRAS ${o.codigo}`}</Dato>,
          ]}
        />
      ),
      banderas: o.banderas.length ? (
        <CrucesCelda cruces={o.banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))} etiquetaLista="Banderas de la obra" />
      ) : (
        <span className="hidden text-meta text-mute lg:inline">Ninguna</span>
      ),
      avance: (
        <CeldaNumero sub={a.fisicoProgramado != null && o.estado !== "Finalizado" ? `de ${porcentaje(a.fisicoProgramado)} programado` : undefined}>
          {a.fisicoReal != null ? porcentaje(a.fisicoReal, { decimales: 1 }) : "Sin dato"}
        </CeldaNumero>
      ),
      monto: <CeldaNumero sub={costo.de === "expediente técnico" ? "expediente" : undefined}>{costo.monto ? solesCompacto(costo.monto) : "Sin dato"}</CeldaNumero>,
      inicio: <CeldaFecha fecha={o.fechas.inicio} />,
    },
    detalle: {
      titulo: `Obra ${o.codigo}`,
      etiqueta: `Ver el detalle de la obra ${o.codigo}`,
      descripcion: oracion(o.nombre),
      contenido: (
        <CuerpoDetalle>
          <ChipsDetalle>
            {estado}
            {o.banderas.length > 0 && <ChipsCruces cruces={o.banderas.map((b) => ({ tipo: b.tipo, severidad: b.severidad }))} etiquetaLista="Banderas de la obra" />}
          </ChipsDetalle>
          {dudoso && (
            <AvisoDato motivo={dudoso} fuente="infobras" suma={false}>
              {`INFOBRAS trae ${a.fisicoReal != null ? `${numero(a.fisicoReal)} % de avance físico` : "este dato"}${a.financiero != null ? ` y ${numero(a.financiero)} % de ejecución financiera` : ""}.`}
            </AvisoDato>
          )}
          <CifrasEnFila items={cifrasObra(o)} chico />
          <DatosClave items={datosObra(o, conEntidad)} />
          <BloqueBanderasObra banderas={o.banderas} />
          <BloqueContratos o={o} />
          <BloqueDetalle titulo="Dónde verlo">
            <div className="flex flex-wrap gap-2">
              <a href={o.url} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                <FileText className="size-4" aria-hidden /> La obra en INFOBRAS
                <ExternalLink className="size-3.5" aria-hidden />
                <span className="sr-only"> (se abre en otra pestaña)</span>
              </a>
              {o.cui && (
                <a href={`https://ofi5.mef.gob.pe/ssi/Ssi/Index?codigo=${o.cui}&tipo=2`} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
                  La inversión en el MEF (CUI {o.cui})
                  <ExternalLink className="size-3.5" aria-hidden />
                  <span className="sr-only"> (se abre en otra pestaña)</span>
                </a>
              )}
            </div>
            <p className="mt-1.5 text-rotulo text-mute">INFOBRAS es de la Contraloría y responde desde el Perú.</p>
          </BloqueDetalle>
        </CuerpoDetalle>
      ),
      pie: <span className="text-rotulo text-mute">Fuente: {FUENTE_OBRA}, obra {o.codigo}{o.alDia ? `, archivo del ${fechaLarga(o.alDia)}` : ""}</span>,
    },
    buscable: `${o.nombre} ${o.codigo} ${o.cui ?? ""}`,
  };
}

const SIN_OBRAS: ReactNode = (
  <EstadoVacio compacto conLlamita={false} titulo="No registra obras en INFOBRAS">
    La Contraloría no tiene obras públicas registradas por esta entidad en INFOBRAS.
  </EstadoVacio>
);

export async function ListaObras({
  pagina: p,
  ruta,
  parametros,
  actual,
  vacia = SIN_OBRAS,
  conEntidad = false,
  empresaRuc,
}: {
  pagina: Promise<ObrasPagina | null>;
  ruta: string;
  parametros: Parametros;
  actual: number;
  vacia?: ReactNode;
  /** La lista no es de una entidad (la de una empresa): cada fila dice de qué entidad es. */
  conEntidad?: boolean;
  /** La ficha de una empresa: cada fila dice si la ejecuta o la supervisa. */
  empresaRuc?: string;
}) {
  const pagina = await p;
  if (!pagina) {
    return (
      <EstadoError titulo="No pudimos cargar las obras" accion={<a href={ruta} className={CLASE_ACCION_LISTA}>Reintentar</a>}>
        Suele ser momentáneo: vuelve a intentarlo en unos segundos.
      </EstadoError>
    );
  }
  if (!pagina.data.length) {
    const filtrada = Object.entries(P_OBRA).some(([k, param]) => k !== "orden" && k !== "page" && !!parametros[param]);
    if (actual > 1) {
      return (
        <EstadoVacio compacto titulo="Esta página de la lista ya no tiene obras" accion={<Link href={ruta} prefetch={false} className={CLASE_ACCION_LISTA}>Ir al principio de la lista</Link>} />
      );
    }
    return filtrada ? <EstadoVacio compacto titulo="Ninguna obra con estos filtros">Cambia la búsqueda o quita un filtro.</EstadoVacio> : <>{vacia}</>;
  }
  const filas = pagina.data.map((o) => filaObra(o, { conEntidad, empresaRuc }));
  const tam = pagina.size || filas.length;
  const total = pagina.total ?? (actual - 1) * tam + filas.length;
  const paginas = Math.max(1, Math.ceil(total / tam));
  const pag = (subir: boolean) => (
    <Paginacion actual={actual} paginas={paginas} total={total} tam={tam} navegacion="url" hrefBase={ruta} query={parametros} paramPagina={P_OBRA.page} cargando={false} nombre="obras" subir={subir} />
  );
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{pag(false)}</div>
      <Tabla columnas={COLUMNAS} filas={filas} etiqueta="Obras públicas de INFOBRAS" />
      <div className="flex justify-end">{pag(true)}</div>
      {pagina.alDia && <p className="text-rotulo text-mute">INFOBRAS (Contraloría), archivo del {fechaLarga(pagina.alDia)}. Lo registra cada entidad: una obra que no se actualiza queda como la dejó.</p>}
    </div>
  );
}

export { SIN_OBRAS };
