import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Ayuda, DatosClave, EstadoError, EstadoVacio } from "@/components/patrones";
import {
  BarraFiltros,
  CeldaFecha,
  CeldaNumero,
  CeldaPrincipal,
  Tabla,
  TablaPaginada,
  type Columna,
  type FiltroSecundario,
  type Fila,
  type Parametros,
} from "@/components/listado";
import { Badge } from "@/components/ui/Badge";
import { AvisoDato, BanderaDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { TIPO_CRUCE } from "@/lib/cruces";
import { motivoDudoso } from "@/lib/datoDudoso";
import { fecha, fechaCorta, numero, oracion, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { tipoContratacion } from "@/lib/personas";
import { rutaContrato } from "@/lib/rutas";
import {
  NIVEL,
  OBJETO_TEXTO,
  rutaEmpresa,
  type AntecedenteEmpresa,
  type ClienteEmpresa,
  type ContratoEmpresa,
  type OrdenEmpresa,
  type Pagina,
  type PostulacionEmpresa,
  type SociosEmpresa,
  type VisitaEmpresa,
} from "@/lib/empresas";

/**
 * Las pestañas de la ficha de una empresa (/empresa/<RUC>), una función por pestaña. Las que pueden ser muy largas
 * (contratos, órdenes, postulaciones) se paginan en el servidor con sus filtros en la URL; las demás llegan enteras y se
 * paginan y se buscan en la página. Los nombres de personas llegan de la API con un apellido tapado y nunca se buscan.
 * Server components.
 */

const VARIANTE = { alta: "crimson", media: "amber", baja: "neutral" } as const;
const SEV = { alta: "Grave", media: "Para revisar", baja: "Leve" } as const;
const entidadTexto = (e: string | null | undefined, ruc?: string | null) => (e ? tituloNatural(e) : ruc ?? "Entidad sin nombre");

function Paginas({ total, size, actual, ruta, parametros, param, nombre }: { total: number; size: number; actual: number; ruta: string; parametros: Parametros; param: string; nombre: string }) {
  if (total <= size) return null;
  return (
    <div className="flex justify-end">
      <Paginacion
        actual={actual}
        paginas={Math.max(1, Math.ceil(total / size))}
        total={total}
        tam={size}
        navegacion="url"
        hrefBase={ruta}
        query={parametros}
        paramPagina={param}
        cargando={false}
        nombre={nombre}
      />
    </div>
  );
}

const NoCargo = ({ que }: { que: string }) => (
  <EstadoError titulo={`No pudimos cargar ${que}`}>Suele ser momentáneo: vuelve a intentarlo en unos segundos.</EstadoError>
);

const anios = (desde: string | null, hasta: string | null): FiltroSecundario["opciones"] => {
  const a = Number(desde?.slice(0, 4)) || 2018;
  const b = Number(hasta?.slice(0, 4)) || new Date().getFullYear();
  const out: FiltroSecundario["opciones"] = [];
  for (let x = b; x >= Math.max(2015, a); x--) out.push({ valor: String(x), etiqueta: String(x) });
  return out;
};

// ─── Contratos ────────────────────────────────────────────────────────────────

export const P_CONTRATOS = { q: "cq", anio: "canio", como: "ccomo", page: "cpag" } as const;

const COLUMNAS_CONTRATOS: Columna[] = [
  { clave: "fecha", titulo: "Buena pro", ancho: "92px", desde: "md", apilar: true },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.8fr)" },
  {
    clave: "banderas", titulo: "Banderas", ancho: "minmax(0,0.8fr)", desde: "lg", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué son estas banderas?">
        Las sanciones del Tribunal frente a la fecha de la buena pro: «Inhabilitada al ganar» (no podía contratar), «Sancionada
        antes» (ya no estaban vigentes al ganar) o «Sancionada después». Luego, los demás antecedentes que pesan sobre ese proceso
        (visitas, postores con el mismo socio, el partido que gobierna…) y un monto con posible error de carga, que no se suma.
      </Ayuda>
    ),
  },
  { clave: "monto", titulo: "Adjudicado", ancho: "120px", alinear: "der" },
];

export function BarraContratos({ desde, hasta }: { desde: string | null; hasta: string | null }) {
  return (
    <BarraFiltros
      busqueda={{ param: P_CONTRATOS.q, placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en sus contratos", min: 3 }}
      visibles={[
        { param: P_CONTRATOS.anio, etiqueta: "Año de la buena pro", corta: "Año", todas: "Todos los años", opciones: anios(desde, hasta) },
        {
          param: P_CONTRATOS.como, etiqueta: "Cómo la ganó", corta: "Cómo", todas: "Sola y en consorcio",
          opciones: [{ valor: "sola", etiqueta: "Sola" }, { valor: "consorcio", etiqueta: "En consorcio" }],
        },
      ]}
    />
  );
}

export async function ContratosEmpresa({ pagina: p, ruta, parametros, actual }: { pagina: Promise<Pagina<ContratoEmpresa> | null>; ruta: string; parametros: Parametros; actual: number }) {
  const pagina = await p;
  if (!pagina) return <NoCargo que="sus contratos" />;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ningún contrato con estos filtros">Quita el filtro de año o la búsqueda.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((c) => {
    const entidad = entidadTexto(c.entidad, c.entidadRuc);
    const titulo = c.descripcion ? oracion(c.descripcion) : c.nomenclatura ?? "Proceso sin descripción";
    return {
      id: `${c.codigo}-${c.entidadRuc}`,
      href: rutaContrato(c.ocid ?? c.codigo),
      celdas: {
        fecha: <CeldaFecha fecha={c.fecha} />,
        proceso: (
          <CeldaPrincipal
            titulo={titulo}
            dosLineas
            meta={[
              <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              c.objeto && <Dato key="tipo" tipo="tipo">{OBJETO_TEXTO[c.objeto] ?? c.objeto}</Dato>,
              c.nomenclatura && <Dato key="codigo" tipo="codigo" mono>{c.nomenclatura}</Dato>,
              c.consorcio && <Dato key="consorcio" tipo="personas" nombre="Ganó en consorcio">{`En ${tituloNatural(c.consorcio)}`}</Dato>,
            ]}
          />
        ),
        banderas: (
          <span className="flex flex-wrap gap-1">
            {c.sancion && <SancionAlGanar s={c.sancion} />}
            {c.dudoso && <BanderaDato motivo={motivoDudoso(c.dudoso) ?? "adjudicado_20x"} fuente="conosce_ordenes" />}
            {c.antecedentes.length > 0 && <CrucesCelda cruces={c.antecedentes} />}
            {!c.sancion && !c.dudoso && !c.antecedentes.length && <span className="text-[12.5px] text-mute">—</span>}
          </span>
        ),
        monto: (
          <CeldaNumero sub={c.consorcio ? "de todo el consorcio" : c.dudoso ? "posible error de carga" : plural(c.items, "ítem", "ítems")}>
            {c.monto != null ? soles(c.monto) : c.montoOtraMoneda != null ? `${numero(c.montoOtraMoneda)} ${c.otraMoneda ?? ""}`.trim() : "Sin dato"}
          </CeldaNumero>
        ),
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-inkSoft">{plural(pagina.total, "proceso ganado", "procesos ganados")}</p>
        <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_CONTRATOS.page} nombre="contratos" />
      </div>
      <Tabla columnas={COLUMNAS_CONTRATOS} filas={filas} etiqueta="Contratos que ganó" />
      <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_CONTRATOS.page} nombre="contratos" />
    </div>
  );
}

/**
 * Las sanciones del Tribunal frente a la fecha de la buena pro de un contrato, con la fecha que importa escrita al lado
 * (no sólo en el `title`: en el celular no hay cursor). Pedido del usuario (2026-10-22): «Sancionado» no decía si lo
 * estaba cuando contrató o antes.
 */
function SancionAlGanar({ s }: { s: NonNullable<ContratoEmpresa["sancion"]> }) {
  const cual = (t: string) => (t === "definitivo" ? "definitiva" : t === "temporal" ? "temporal" : "");
  return (
    <span className="flex w-full flex-col gap-1">
      {s.alGanar ? (
        <span
          className="flex flex-wrap items-center gap-1"
          title={`Ganó con una inhabilitación ${cual(s.alGanar.tipo)} vigente${s.alGanar.desde ? ` desde el ${fechaCorta(s.alGanar.desde)}` : ""}${s.alGanar.hasta ? ` hasta el ${fechaCorta(s.alGanar.hasta)}` : ""}${s.alGanar.resolucion ? ` (Res. ${s.alGanar.resolucion})` : ""}: no podía contratar con el Estado.`}
        >
          <Badge variant="crimson">Inhabilitada al ganar</Badge>
          <span className="text-[12px] text-crimsonTexto">
            {s.alGanar.hasta ? `hasta el ${fechaCorta(s.alGanar.hasta)}` : `inhabilitación ${cual(s.alGanar.tipo)}`}
          </span>
        </span>
      ) : s.antes > 0 ? (
        <span
          className="flex flex-wrap items-center gap-1"
          title={`${plural(s.antes, "sanción anterior", "sanciones anteriores")} a la buena pro; ninguna inhabilitación vigente al ganar${s.antesHasta ? `: la última terminó el ${fechaCorta(s.antesHasta)}` : ""}.`}
        >
          <Badge variant="amber">Sancionada antes</Badge>
          <span className="text-[12px] text-inkSoft">{s.antesHasta ? `ya cumplida el ${fechaCorta(s.antesHasta)}` : "sin vigencia al ganar"}</span>
        </span>
      ) : null}
      {s.despues > 0 && (
        <span className="flex flex-wrap items-center gap-1" title={`${plural(s.despues, "sanción", "sanciones")} posteriores a la buena pro${s.despuesDesde ? `, desde el ${fechaCorta(s.despuesDesde)}` : ""}: al ganar no las tenía.`}>
          <Badge variant="neutral">Sancionada después</Badge>
          {s.despuesDesde && <span className="text-[12px] text-mute">{`desde el ${fechaCorta(s.despuesDesde)}`}</span>}
        </span>
      )}
    </span>
  );
}

// ─── Órdenes ──────────────────────────────────────────────────────────────────

export const P_ORDENES = { q: "oq", anio: "oanio", tipo: "otipo", dudosa: "odud", page: "opag" } as const;

const COLUMNAS_ORDENES: Columna[] = [
  { clave: "fecha", titulo: "Emitida", ancho: "92px", desde: "md", apilar: true },
  { clave: "orden", titulo: "Orden", ancho: "minmax(0,1.8fr)" },
  { clave: "estado", titulo: "Estado y banderas", ancho: "minmax(0,0.7fr)", desde: "lg", apilar: true },
  { clave: "monto", titulo: "Monto", ancho: "116px", alinear: "der" },
];

export function BarraOrdenes({ desde, hasta, dudosas }: { desde: string | null; hasta: string | null; dudosas: number }) {
  return (
    <BarraFiltros
      busqueda={{ param: P_ORDENES.q, placeholder: "Buscar en la descripción, la entidad o el número…", etiqueta: "Buscar en sus órdenes", min: 3 }}
      visibles={[
        { param: P_ORDENES.anio, etiqueta: "Año", corta: "Año", todas: "Todos los años", opciones: anios(desde, hasta) },
        {
          param: P_ORDENES.tipo, etiqueta: "Tipo de orden", corta: "Tipo", todas: "Compra y servicio",
          opciones: [{ valor: "compra", etiqueta: "Órdenes de compra" }, { valor: "servicio", etiqueta: "Órdenes de servicio" }],
        },
      ]}
      filtros={dudosas ? [{ param: P_ORDENES.dudosa, etiqueta: "Posible error de carga", todas: "Todas", opciones: [{ valor: "si", etiqueta: "Sólo con posible error", conteo: dudosas }] }] : []}
    />
  );
}

export async function OrdenesEmpresa({ pagina: p, ruta, parametros, actual }: { pagina: Promise<Pagina<OrdenEmpresa> | null>; ruta: string; parametros: Parametros; actual: number }) {
  const pagina = await p;
  if (!pagina) return <NoCargo que="sus órdenes" />;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ninguna orden con estos filtros">Quita el filtro de año, de tipo o la búsqueda.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((o, i) => {
    const motivo = o.montoDudoso != null ? motivoDudoso(o.dudosoMotivo) ?? "mayor_100m" : null;
    const tipo = tipoContratacion(o.tipoContratacion);
    const entidad = o.entidad ? tituloNatural(o.entidad) : null;
    const descripcion = o.descripcion ? oracion(o.descripcion) : "Sin descripción";
    const clase = o.tipoOrden && /compra/i.test(o.tipoOrden) ? "Orden de compra" : "Orden de servicio";
    return {
      id: `${o.orden ?? i}-${o.fecha}-${o.entidadRuc}`,
      celdas: {
        fecha: <CeldaFecha fecha={o.fecha} />,
        orden: (
          <CeldaPrincipal
            titulo={descripcion}
            dosLineas
            meta={[
              entidad && <Dato key="entidad" tipo="entidad">{entidad}</Dato>,
              <Dato key="tipo" tipo="tipo">{clase}</Dato>,
              o.numero && <Dato key="numero" tipo="codigo" nombre="Número de orden" mono>{`N.° ${o.numero}`}</Dato>,
            ]}
          />
        ),
        estado: (
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] text-inkSoft">{o.estado ?? "Sin estado"}</span>
            {motivo && <BanderaDato motivo={motivo} fuente="conosce_ordenes" />}
          </span>
        ),
        monto: <CeldaNumero sub={motivo ? "posible error de CONOSCE" : tipo?.corto}>{o.monto != null ? soles(o.monto) : "Sin dato"}</CeldaNumero>,
      },
      detalle: {
        titulo: o.numero ? `${clase} N.° ${o.numero}` : clase,
        etiqueta: `Ver el detalle de la orden ${o.numero ?? ""}`.trim(),
        descripcion: entidad ?? undefined,
        contenido: (
          <div className="space-y-4">
            {motivo && <AvisoDato motivo={motivo} fuente="conosce_ordenes">{`La orden trae ${soles(o.monto)} en el archivo oficial de CONOSCE.`}</AvisoDato>}
            <DatosClave
              items={[
                { etiqueta: "Qué se compró", valor: descripcion },
                { etiqueta: "Entidad", valor: entidad },
                { etiqueta: "Emitida", valor: o.fecha ? fechaCorta(o.fecha) : null, mono: true },
                { etiqueta: "Estado", valor: o.estado },
                { etiqueta: "Monto", valor: o.monto != null ? (motivo ? `${soles(o.monto)}, tal como lo publicó CONOSCE` : soles(o.monto)) : null, mono: true },
                { etiqueta: "Cómo se contrató", valor: tipo?.corto ?? null },
                { etiqueta: "¿Tuvo convocatoria?", valor: tipo?.convocatoria || null },
              ]}
            />
          </div>
        ),
        pie: <span className="text-[12px] text-mute">Fuente: OECE, CONOSCE, órdenes de compra y de servicio{o.orden ? ` (${o.orden})` : ""}</span>,
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-inkSoft">{plural(pagina.total, "orden", "órdenes")}</p>
        <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_ORDENES.page} nombre="órdenes" />
      </div>
      <Tabla columnas={COLUMNAS_ORDENES} filas={filas} etiqueta="Órdenes de compra y de servicio" />
      <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_ORDENES.page} nombre="órdenes" />
    </div>
  );
}

// ─── Clientes ─────────────────────────────────────────────────────────────────

const COLUMNAS_CLIENTES: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.6fr)" },
  { clave: "contratos", titulo: "Contratos", ancho: "124px", alinear: "der" },
  { clave: "ordenes", titulo: "Órdenes", ancho: "124px", alinear: "der", desde: "md" },
  { clave: "visitas", titulo: "Visitas", ancho: "76px", alinear: "der", desde: "lg" },
  { clave: "ultima", titulo: "Última", ancho: "92px", desde: "xl" },
];

export function filasClientes(data: ClienteEmpresa[]): Fila[] {
  return data.map((c) => {
    const entidad = entidadTexto(c.entidad, c.entidadRuc);
    return {
      id: c.entidadRuc,
      href: `/entidad/${c.entidadRuc}`,
      buscable: `${entidad} ${c.entidadRuc} ${c.departamento ?? ""}`,
      celdas: {
        entidad: (
          <CeldaPrincipal
            titulo={entidad}
            meta={[
              c.departamento && <Dato key="lugar" tipo="lugar">{tituloNatural(c.departamento)}</Dato>,
              c.primera && (
                <Dato key="fecha" tipo="fecha" nombre="Desde">
                  {c.primera.slice(0, 4) === c.ultima?.slice(0, 4) ? c.primera.slice(0, 4) : `${c.primera.slice(0, 4)} a ${c.ultima?.slice(0, 4) ?? ""}`}
                </Dato>
              ),
              c.dudosas > 0 && <Badge key="dud" variant="amber">{plural(c.dudosas, "orden con posible error de carga", "órdenes con posible error de carga")}</Badge>,
            ]}
          />
        ),
        contratos: (
          <CeldaNumero sub={c.contratos ? plural(c.contratos, "proceso", "procesos") : undefined}>
            {c.contratos ? solesCompacto(c.adjudicado) : <span className="font-sans text-mute">Ninguno</span>}
          </CeldaNumero>
        ),
        ordenes: (
          <CeldaNumero sub={c.ordenes ? plural(c.ordenes, "orden", "órdenes") : undefined}>
            {c.ordenes ? solesCompacto(c.ordenado) : <span className="font-sans text-mute">Ninguna</span>}
          </CeldaNumero>
        ),
        visitas: <CeldaNumero>{c.visitas ? numero(c.visitas) : <span className="font-sans text-mute">—</span>}</CeldaNumero>,
        ultima: <CeldaFecha fecha={c.ultima} />,
      },
    };
  });
}

export async function ClientesEmpresa({ datos }: { datos: Promise<{ total: number; data: ClienteEmpresa[] } | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus clientes" />;
  if (!d.total) return <EstadoVacio compacto titulo="Ninguna entidad le adjudicó ni le compró">Sólo figura como postor.</EstadoVacio>;
  return (
    <TablaPaginada
      columnas={COLUMNAS_CLIENTES}
      filas={filasClientes(d.data)}
      etiqueta="Entidades que le adjudicaron o le compraron"
      tam={20}
      nombre="entidades"
      buscar={{ placeholder: "Buscar entidad o región…", etiqueta: "Buscar en sus clientes" }}
    />
  );
}

// ─── Postulaciones ────────────────────────────────────────────────────────────

export const P_POSTULACIONES = { q: "pq", resultado: "pres", page: "ppag" } as const;

const COLUMNAS_POSTULACIONES: Columna[] = [
  { clave: "fecha", titulo: "Propuesta", ancho: "92px", desde: "md", apilar: true },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1.6fr)" },
  { clave: "resultado", titulo: "Resultado", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Adjudicado", ancho: "116px", alinear: "der", desde: "lg" },
];

export function BarraPostulaciones() {
  return (
    <BarraFiltros
      busqueda={{ param: P_POSTULACIONES.q, placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en sus postulaciones", min: 3 }}
      visibles={[
        {
          param: P_POSTULACIONES.resultado, etiqueta: "Resultado", corta: "Resultado", todas: "Ganadas y perdidas",
          opciones: [{ valor: "gano", etiqueta: "Las que ganó" }, { valor: "perdio", etiqueta: "Las que no ganó" }],
        },
      ]}
    />
  );
}

export async function PostulacionesEmpresa({ pagina: p, ruta, parametros, actual, ruc }: { pagina: Promise<(Pagina<PostulacionEmpresa> & { ganadas: number }) | null>; ruta: string; parametros: Parametros; actual: number; ruc: string }) {
  const pagina = await p;
  if (!pagina) return <NoCargo que="sus postulaciones" />;
  if (!pagina.total) return <EstadoVacio compacto titulo="Ninguna postulación con estos filtros">CONOSCE publica los postores desde 2018.</EstadoVacio>;
  const filas: Fila[] = pagina.data.map((x) => {
    const otros = x.ganadores.filter((g) => g.ruc !== ruc);
    const titulo = x.descripcion ? oracion(x.descripcion) : `Proceso ${x.codigo}`;
    // Una fila es una acción (DESIGN_SYSTEM.md): el panel lleva al proceso y a la ficha de quien ganó.
    return {
      id: x.codigo,
      detalle: {
        titulo,
        etiqueta: `Ver el proceso ${x.codigo}`,
        descripcion: x.entidad ? tituloNatural(x.entidad) : undefined,
        contenido: (
          <div className="space-y-3">
            <DatosClave
              items={[
                { etiqueta: "Entidad", valor: x.entidad ? tituloNatural(x.entidad) : null },
                { etiqueta: "Propuesta", valor: x.fecha ? fecha(x.fecha) : null },
                { etiqueta: "Postuló", valor: x.consorcio ? `En ${tituloNatural(x.consorcio)}` : "Sola" },
                { etiqueta: "Resultado", valor: x.gano ? "Ganó" : otros.length ? "Ganó otro postor" : "Sin adjudicación publicada" },
                { etiqueta: "Adjudicado", valor: x.monto != null ? soles(x.monto) : null, mono: true },
              ]}
            />
            {otros.length > 0 && (
              <div className="space-y-1">
                <p className="text-[13px] font-semibold text-ink">{otros.length === 1 ? "Quién ganó" : "Quiénes ganaron"}</p>
                <ul className="space-y-1 text-[13px]">
                  {otros.map((g, i) => (
                    <li key={`${g.ruc ?? g.nombre}-${i}`}>
                      {g.ruc ? <Link href={rutaEmpresa(g.ruc)} className="font-semibold text-granate underline-offset-2 hover:underline">{g.nombre ?? g.ruc}</Link> : <b>{g.nombre}</b>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link href={rutaContrato(x.codigo)} className="inline-block text-[13px] font-semibold text-granate underline-offset-2 hover:underline">Abrir la ficha del proceso</Link>
          </div>
        ),
        pie: <span className="text-[12px] text-mute">Fuente: OECE, CONOSCE, postores y adjudicaciones</span>,
      },
      celdas: {
        fecha: <CeldaFecha fecha={x.fecha} />,
        proceso: (
          <CeldaPrincipal
            titulo={titulo}
            dosLineas
            meta={[
              x.entidad && <Dato key="entidad" tipo="entidad">{tituloNatural(x.entidad)}</Dato>,
              x.objeto && <Dato key="tipo" tipo="tipo">{OBJETO_TEXTO[x.objeto] ?? x.objeto}</Dato>,
              x.consorcio && <Dato key="consorcio" tipo="personas" nombre="Postuló en consorcio">{`En ${tituloNatural(x.consorcio)}`}</Dato>,
            ]}
          />
        ),
        resultado: x.gano ? (
          <Badge variant="marca">Ganó</Badge>
        ) : otros.length ? (
          <span className="text-[13px] text-inkSoft">
            Ganó <b className="font-semibold text-ink">{otros[0].nombre ?? otros[0].ruc}</b>
            {otros.length > 1 ? ` y ${otros.length - 1} más` : ""}
          </span>
        ) : (
          <span className="text-[13px] text-mute">Sin adjudicación publicada</span>
        ),
        monto: <CeldaNumero>{x.monto != null ? solesCompacto(x.monto) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      },
    };
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-inkSoft">{`${plural(pagina.total, "postulación", "postulaciones")}, ${numero(pagina.ganadas)} ganadas`}</p>
        <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_POSTULACIONES.page} nombre="postulaciones" />
      </div>
      <Tabla columnas={COLUMNAS_POSTULACIONES} filas={filas} etiqueta="Procesos en que fue postor" />
      <Paginas total={pagina.total} size={pagina.size} actual={actual} ruta={ruta} parametros={parametros} param={P_POSTULACIONES.page} nombre="postulaciones" />
    </div>
  );
}

// ─── Antecedentes ─────────────────────────────────────────────────────────────

const FUENTE: Record<string, string> = {
  onpe_aportantes: "Claridad de la ONPE",
  onpe_candidatos: "Claridad de la ONPE",
  jne_autoridades: "Autoridades electas del JNE",
  penalidades: "Penalidades del OECE",
  osce_sancionados: "Sancionados del Tribunal de Contrataciones",
  visitas_entidades: "Registro de visitas",
  rnp_conformacion_juridica: "Conformación jurídica del RNP",
  onpe_gastos_proveedores: "Gastos de campaña de la ONPE",
  conosce_adjudicaciones: "Adjudicaciones de CONOSCE",
  conosce_contratos: "Contratos de CONOSCE",
  conosce_ordenes: "Órdenes de compra y de servicio de CONOSCE",
  precio_item: "Ítems del OCDS (OECE) y CONOSCE",
};

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Si una sanción sigue hoy: por su fecha de fin y, sin ella, por el estado que publica el Tribunal. */
function hoySancion(tipo: string | null, hasta: string | null, estado: string | null): string | null {
  const hoy = new Date().toISOString().slice(0, 10);
  if (hasta) return hasta >= hoy ? "Vigente" : `Ya terminó (el ${fechaCorta(hasta)})`;
  if (estado) return estado.toUpperCase() === "VIGENTE" ? "Vigente" : "No vigente, según el Tribunal";
  return tipo === "definitivo" ? "Definitiva, sin fecha de fin" : null;
}

/** Lo que dice cada antecedente en pares rótulo/valor, según su tipo (los campos de `detalle` de cruces_proveedor). */
function datosDe(a: AntecedenteEmpresa): { etiqueta: string; valor: string | null; mono?: boolean }[] {
  const d = a.detalle;
  const f = (v: unknown) => (txt(v) && /^\d{4}-\d{2}-\d{2}/.test(txt(v)!) ? fechaCorta(txt(v)!) : txt(v));
  const persona = a.socios[0];
  const visita = a.visitas[0] as Record<string, unknown> | undefined;
  const items: { etiqueta: string; valor: string | null; mono?: boolean }[] = [];
  if (persona) items.push({ etiqueta: "Quién", valor: `${persona.nombre}${persona.rol ? ` (${persona.rol})` : ""}` });
  if (visita) {
    items.push(
      { etiqueta: "Visitante", valor: txt(visita.visitante) },
      { etiqueta: "Entidad visitada", valor: txt(visita.entidad) ? tituloNatural(txt(visita.entidad)!) : null },
      { etiqueta: "A quién visitó", valor: [txt(visita.funcionario), txt(visita.cargoFuncionario)].filter(Boolean).join(", ") || null },
      { etiqueta: "Motivo", valor: txt(visita.motivo) },
    );
  }
  if (a.tipo === "sancion" || a.tipo === "sancion_vigente") {
    items.push(
      { etiqueta: "Sanción", valor: txt(d.tipo) ? oracion(txt(d.tipo)!) : null },
      { etiqueta: "Vigencia", valor: [f(d.desde), f(d.hasta)].filter(Boolean).join(" a ") || null },
      { etiqueta: "Hoy", valor: hoySancion(txt(d.tipo), txt(d.hasta), txt(d.estado)) },
      { etiqueta: "Infracción", valor: txt(d.infraccion)?.replace(/^[-\s]*[a-z]\)\s*/i, "") ?? null },
      { etiqueta: "Resolución", valor: txt(d.resolucion), mono: true },
    );
  } else if (a.tipo === "fraccionamiento") {
    items.push(
      { etiqueta: "Días", valor: [f(d.desde), f(d.hasta)].filter((v, i, xs) => v && xs.indexOf(v) === i).join(" a ") || null },
      { etiqueta: "Órdenes", valor: txt(d.ordenes) },
      { etiqueta: "Juntas suman", valor: typeof d.total === "number" ? soles(d.total) : null, mono: true },
    );
  } else if (a.tipo === "recurrente") {
    items.push(
      { etiqueta: "Procesos ganados en la entidad", valor: txt(d.procesos) },
      { etiqueta: "Entre", valor: [f(d.desde), f(d.hasta)].filter(Boolean).join(" y ") || null },
    );
  } else if (a.tipo === "sobreprecio") {
    const peor = (d.peor ?? {}) as Record<string, unknown>;
    items.push(
      { etiqueta: "Ítem", valor: txt(peor.descripcion) ? oracion(txt(peor.descripcion)!) : null },
      { etiqueta: "Precio unitario", valor: typeof peor.unitario === "number" ? soles(peor.unitario) : null, mono: true },
      { etiqueta: "Mediana de otras entidades", valor: typeof peor.mediana === "number" ? `${soles(peor.mediana)} (${numero(Number(peor.entidades ?? 0))} entidades)` : null },
      { etiqueta: "Pagó de más en total", valor: typeof d.exceso === "number" ? soles(d.exceso) : null, mono: true },
    );
  } else {
    const org = txt(d.organizacion) ?? txt(d.partido);
    if (org) items.push({ etiqueta: "Organización política", valor: org });
    if (txt(d.cargo)) items.push({ etiqueta: "Cargo", valor: tituloNatural(txt(d.cargo)!) });
    if (txt(d.proceso)) items.push({ etiqueta: "Proceso electoral", valor: txt(d.proceso) });
    if (txt(d.entidad_contratante)) items.push({ etiqueta: "Entidad", valor: tituloNatural(txt(d.entidad_contratante)!) });
  }
  if (a.montoSoles != null && !items.some((i) => i.etiqueta.startsWith("Juntas") || i.etiqueta.startsWith("Pagó"))) {
    items.push({ etiqueta: "Monto", valor: soles(a.montoSoles), mono: true });
  }
  if (a.fecha && !items.some((i) => i.etiqueta === "Vigencia" || i.etiqueta === "Días" || i.etiqueta === "Entre")) {
    items.push({ etiqueta: "Fecha", valor: fechaCorta(a.fecha), mono: true });
  }
  return items.filter((i) => i.valor);
}

const COLUMNAS_CASOS: Columna[] = [
  { clave: "detalle", titulo: "Qué dice el registro", ancho: "minmax(0,1.6fr)" },
  { clave: "proceso", titulo: "Proceso", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  { clave: "gravedad", titulo: "Gravedad", ancho: "112px" },
];

/**
 * Cada tipo de antecedente una vez, numerado (1, 2, 3…), de lo más grave a lo más leve: cuántas veces aparece y con qué
 * gravedad, qué quiere decir y, debajo, cada caso en una tabla paginada (lo que dice el registro, el proceso en que pesa
 * con su evidencia, la fuente). Antes iba un caso por tarjeta: 160 tarjetas casi iguales.
 */
export async function AntecedentesEmpresa({ datos }: { datos: Promise<{ total: number; data: AntecedenteEmpresa[] } | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus antecedentes" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Ningún otro registro la nombra">
        No figura en las sanciones del Tribunal, las penalidades, los aportes y gastos de campaña, las autoridades y candidatos,
        ni en los demás cruces de Vigía.
      </EstadoVacio>
    );
  }
  const RANGO = { alta: 0, media: 1, baja: 2 } as const;
  const grupos = new Map<string, AntecedenteEmpresa[]>();
  for (const a of d.data) grupos.set(a.tipo, [...(grupos.get(a.tipo) ?? []), a]);
  const tipos = [...grupos.entries()].sort(
    ([, a], [, b]) => Math.min(...a.map((x) => RANGO[x.severidad])) - Math.min(...b.map((x) => RANGO[x.severidad])) || b.length - a.length,
  );
  return (
    <ol className="space-y-3">
      {tipos.map(([tipo, casos], i) => {
        const porSev = (["alta", "media", "baja"] as const).map((sv) => ({ sv, n: casos.filter((c) => c.severidad === sv).length })).filter((x) => x.n);
        const fuente = casos[0]?.fuente;
        const filas: Fila[] = casos.map((a, k) => {
          const datos = datosDe(a);
          return {
            id: `${tipo}-${k}`,
            href: a.ocid ? rutaContrato(a.ocid) : undefined,
            // Sin nombres de personas (socio, visitante, funcionario): no se buscan (docs/PRIVACIDAD.md).
            buscable: `${datos.filter((x) => !["Quién", "Visitante", "A quién visitó"].includes(x.etiqueta)).map((x) => x.valor).join(" ")} ${a.entidad ?? ""} ${a.codigo ?? ""}`,
            celdas: {
              detalle: (
                <ul className="space-y-0.5 text-[13px]">
                  {datos.slice(0, 4).map((x) => (
                    <li key={x.etiqueta} className="min-w-0 break-words">
                      <span className="text-mute">{x.etiqueta}: </span>
                      <span className={x.mono ? "font-mono tabular-nums text-ink" : "text-ink"}>{x.valor}</span>
                    </li>
                  ))}
                  {!datos.length && <li className="text-mute">Sin más detalle en el registro</li>}
                </ul>
              ),
              proceso: a.ocid ? (
                <span className="text-[13px] text-ink">
                  {`Proceso ${a.codigo ?? a.ocid}`}
                  {a.entidad && <span className="block text-inkSoft">{tituloNatural(a.entidad)}</span>}
                </span>
              ) : (
                <span className="text-[13px] text-mute">De la empresa, no de un proceso</span>
              ),
              gravedad: <Badge variant={VARIANTE[a.severidad]}>{SEV[a.severidad]}</Badge>,
            },
          };
        });
        return (
          <li key={tipo} className="flex gap-3 rounded-xl border border-line/80 bg-paperSoft p-3.5">
            <span className="mt-0.5 inline-flex h-6 min-w-6 shrink-0 items-center justify-center rounded-full bg-paperDeep px-1.5 font-mono text-[12px] font-semibold tabular-nums text-ink" aria-hidden>
              {i + 1}
            </span>
            <div className="min-w-0 flex-1 space-y-2.5">
              <div className="space-y-1.5">
                <h4 className="text-[15px] font-semibold text-ink">{casos[0].etiqueta}</h4>
                <ul className="flex flex-wrap gap-1.5">
                  {porSev.map((x) => (
                    <li key={x.sv}><Badge variant={VARIANTE[x.sv]}>{`${plural(x.n, "vez", "veces")}, ${SEV[x.sv].toLowerCase()}`}</Badge></li>
                  ))}
                </ul>
                {TIPO_CRUCE[tipo]?.explica && <p className="max-w-prose text-[13px] leading-relaxed text-inkSoft">{TIPO_CRUCE[tipo].explica}</p>}
              </div>
              <TablaPaginada
                columnas={COLUMNAS_CASOS}
                filas={filas}
                etiqueta={casos[0].etiqueta}
                tam={5}
                nombre="casos"
                densidad="compacta"
                medida="contenedor"
                buscar={{ placeholder: "Buscar por entidad, código o dato…", etiqueta: `Buscar en ${casos[0].etiqueta.toLowerCase()}` }}
              />
              <p className="flex flex-wrap items-center gap-1 text-[12px] text-mute">
                Fuente: {fuente ? FUENTE[fuente] ?? fuente : "Cruces de Vigía"}
                {casos[0].fuenteUrl && (
                  <a href={casos[0].fuenteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-granate underline-offset-2 hover:underline">
                    abrir <ArrowUpRight size={12} aria-hidden />
                  </a>
                )}
                {casos.some((c) => c.ocid) && <span>. Cada proceso abre su ficha con la evidencia.</span>}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Socios y empresas vinculadas ─────────────────────────────────────────────

const COLUMNAS_SOCIOS: Columna[] = [
  { clave: "persona", titulo: "Persona", ancho: "minmax(0,1.4fr)" },
  { clave: "papel", titulo: "Papel", ancho: "minmax(0,1fr)" },
  { clave: "desde", titulo: "Desde", ancho: "100px", desde: "md" },
  { clave: "otras", titulo: "Otras empresas", ancho: "112px", alinear: "der", desde: "lg" },
];

const COLUMNAS_VINCULADAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1.4fr)" },
  { clave: "comun", titulo: "En común", ancho: "minmax(0,1.2fr)", desde: "md", apilar: true },
  { clave: "puntaje", titulo: "Puntaje", ancho: "104px" },
  { clave: "monto", titulo: "Recibió", ancho: "104px", alinear: "der", desde: "lg" },
];

const papeles = (r: string[]) => r.map((x, i) => (i === 0 ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join(", ");

export async function SociosEmpresa({ datos }: { datos: Promise<SociosEmpresa | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus socios" />;
  const sinNada = !d.socios.length && !d.empresasSocias.length && !d.vinculadas.length && !d.sociaDe.length;
  if (sinNada) {
    return (
      <EstadoVacio compacto titulo="Sin socios ni representantes en el RNP">
        El Registro Nacional de Proveedores no publica su conformación: puede no estar inscrita como proveedora vigente.
      </EstadoVacio>
    );
  }
  const filasSocios: Fila[] = d.socios.map((s, i) => ({
    id: `p-${i}`,
    celdas: {
      persona: <CeldaPrincipal titulo={s.nombre} />,
      papel: <span className="text-[13px] text-ink">{papeles(s.roles)}</span>,
      desde: <CeldaFecha fecha={s.desde} />,
      otras: <CeldaNumero>{s.otrasEmpresas ? numero(s.otrasEmpresas) : <span className="font-sans text-mute">Ninguna</span>}</CeldaNumero>,
    },
  }));
  const filasEmpresas: Fila[] = [
    ...d.empresasSocias.map((s, i) => ({
      id: `e-${i}`,
      href: s.ruc ? rutaEmpresa(s.ruc) : undefined,
      celdas: {
        persona: <CeldaPrincipal titulo={s.nombre} meta={s.ruc ? [<Dato key="ruc" tipo="ruc" mono>{s.ruc}</Dato>] : undefined} />,
        papel: <span className="text-[13px] text-ink">{papeles(s.roles)}</span>,
        desde: <CeldaFecha fecha={s.desde} />,
        otras: <CeldaNumero><span className="font-sans text-mute">—</span></CeldaNumero>,
      },
    })),
  ];
  const filasVinculadas: Fila[] = d.vinculadas.map((v) => ({
    id: v.ruc,
    href: rutaEmpresa(v.ruc),
    buscable: `${v.nombre ?? ""} ${v.ruc}`,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={v.nombre ?? `RUC ${v.ruc}`}
          meta={[
            <Dato key="ruc" tipo="ruc" mono>{v.ruc}</Dato>,
            v.inhabilitada && <Badge key="inh" variant="crimson">Inhabilitada</Badge>,
          ]}
        />
      ),
      comun: (
        <ul className="space-y-0.5 text-[13px] text-ink">
          {v.socios.slice(0, 3).map((s, i) => (
            <li key={i}>
              <b className="font-semibold">{s.nombre}</b>
              <span className="text-inkSoft">
                {s.roles.join(", ") === s.rolesAlla.join(", ")
                  ? ` (${s.roles.join(", ")} en las dos)`
                  : ` (${s.roles.join(", ")} aquí; ${s.rolesAlla.join(", ")} allá)`}
              </span>
            </li>
          ))}
          {v.socios.length > 3 && <li className="text-mute">{`y ${v.socios.length - 3} más`}</li>}
        </ul>
      ),
      puntaje: v.puntaje != null && v.nivel ? (
        <span className="text-[13px]"><b className="font-mono tabular-nums">{v.puntaje}</b> <span className="text-mute">{NIVEL[v.nivel].corto.toLowerCase()}</span></span>
      ) : (
        <span className="text-[13px] text-mute">No le vende al Estado</span>
      ),
      monto: <CeldaNumero sub={v.contratos ? plural(v.contratos, "contrato", "contratos") : undefined}>{v.monto ? solesCompacto(v.monto) : <span className="font-sans text-mute">Nada</span>}</CeldaNumero>,
    },
  }));
  return (
    <div className="space-y-6">
      {(filasSocios.length > 0 || filasEmpresas.length > 0) && (
        <section className="space-y-2">
          <h3 className="font-display text-[15px] font-bold text-ink">Su gente en el RNP</h3>
          <p className="max-w-prose text-[13px] text-inkSoft">
            Socios, representantes legales y directivos que la empresa declaró al Registro Nacional de Proveedores
            {d.corte ? ` (corte del ${fechaCorta(d.corte)})` : ""}. Por privacidad, sin documento y con un apellido tapado.
          </p>
          {filasSocios.length > 0 && <TablaPaginada columnas={COLUMNAS_SOCIOS} filas={filasSocios} etiqueta="Socios, representantes y directivos" tam={15} nombre="personas" />}
          {filasEmpresas.length > 0 && <Tabla columnas={COLUMNAS_SOCIOS} filas={filasEmpresas} etiqueta="Empresas socias" />}
        </section>
      )}
      {d.sociaDe.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-[15px] font-bold text-ink">Es socia de</h3>
          <ul className="flex flex-wrap gap-2">
            {d.sociaDe.map((s) => (
              <li key={s.ruc}>
                <Link href={rutaEmpresa(s.ruc)} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-[13px] text-ink hover:border-granate/40">
                  {s.nombre ?? `RUC ${s.ruc}`} <span className="text-mute">{`(${papeles(s.roles).toLowerCase()})`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {filasVinculadas.length > 0 && (
        <section className="space-y-2">
          <h3 className="font-display text-[15px] font-bold text-ink">Empresas vinculadas</h3>
          <p className="max-w-prose text-[13px] text-inkSoft">
            Otras empresas con un mismo socio, representante o directivo. Si compitieron en un mismo proceso, eso figura en sus
            antecedentes («comparte socio con otro postor»).
          </p>
          <TablaPaginada
            columnas={COLUMNAS_VINCULADAS}
            filas={filasVinculadas}
            etiqueta="Empresas vinculadas"
            tam={15}
            nombre="empresas"
            buscar={{ placeholder: "Buscar empresa por nombre o RUC…", etiqueta: "Buscar en las empresas vinculadas" }}
          />
        </section>
      )}
    </div>
  );
}

// ─── Visitas ──────────────────────────────────────────────────────────────────

const COLUMNAS_VISITAS: Columna[] = [
  { clave: "fecha", titulo: "Fecha", ancho: "92px", desde: "md", apilar: true },
  { clave: "entidad", titulo: "Entidad visitada", ancho: "minmax(0,1.4fr)" },
  { clave: "quien", titulo: "Quién fue", ancho: "minmax(0,1fr)", desde: "lg" },
  {
    clave: "despues", titulo: "Después", ancho: "minmax(0,0.9fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué dice «Después»?">
        Si esa entidad le adjudicó un contrato o le dio una orden a la empresa después de la visita: lo primero que le dio y
        cuántos días después. Una visita no prueba nada: dice qué revisar.
      </Ayuda>
    ),
  },
];

export async function VisitasEmpresa({ datos }: { datos: Promise<{ total: number; visitas: VisitaEmpresa[] } | null> }) {
  const d = await datos;
  if (!d) return <NoCargo que="sus visitas" />;
  if (!d.total) {
    return (
      <EstadoVacio compacto titulo="Sin visitas registradas">
        Ningún socio, representante ni directivo de la empresa figura en los registros de visitas cargados, ni alguien que dijera
        venir de ella.
      </EstadoVacio>
    );
  }
  const filas: Fila[] = d.visitas.map((v, i) => {
    const entidad = entidadTexto(v.entidad);
    const despues = v.despues ? (
      <span className="text-[13px] text-ink">
        {v.despuesTipo === "contrato" ? "Le adjudicó" : "Le dio una orden"}{" "}
        <span className="font-semibold">{v.diasDespues === 0 ? "ese mismo día" : `${plural(v.diasDespues ?? 0, "día", "días")} después`}</span>
      </span>
    ) : v.entidadRuc ? (
      <span className="text-[13px] text-mute">Le vendió antes, no después</span>
    ) : (
      <span className="text-[13px] text-mute">No le vende</span>
    );
    return {
      id: `${v.fecha}-${i}`,
      buscable: `${entidad} ${v.cargoFuncionario ?? ""} ${v.area ?? ""} ${v.motivo ?? ""} ${v.via}`,
      celdas: {
        fecha: <CeldaFecha fecha={v.fecha} />,
        entidad: (
          <CeldaPrincipal
            titulo={entidad}
            meta={[
              v.cargoFuncionario && <Dato key="cargo" tipo="cargo" nombre="Cargo de quien recibió">{tituloNatural(v.cargoFuncionario)}</Dato>,
              v.motivo && <span key="motivo" className="text-inkSoft">{oracion(v.motivo).slice(0, 90)}</span>,
            ]}
          />
        ),
        quien: (
          <span className="text-[13px] text-ink">
            {v.visitante ?? "Sin nombre"} <span className="text-inkSoft">{`(${v.via})`}</span>
          </span>
        ),
        despues,
      },
      detalle: {
        titulo: `Visita a ${entidad}`,
        etiqueta: `Ver el detalle de la visita del ${v.fecha ? fechaCorta(v.fecha) : ""}`.trim(),
        descripcion: v.fecha ? fechaCorta(v.fecha) : undefined,
        contenido: (
          <DatosClave
            items={[
              { etiqueta: "Quién fue", valor: v.visitante },
              { etiqueta: "Qué es de la empresa", valor: v.via },
              { etiqueta: "Dijo venir de", valor: v.entidadDeclarada },
              { etiqueta: "Entidad visitada", valor: entidad },
              { etiqueta: "A quién visitó", valor: [v.funcionario, v.cargoFuncionario ? tituloNatural(v.cargoFuncionario) : null].filter(Boolean).join(", ") || null },
              { etiqueta: "Área", valor: v.area ? tituloNatural(v.area) : null },
              { etiqueta: "Motivo", valor: v.motivo ? oracion(v.motivo) : null },
              { etiqueta: "Lugar", valor: v.lugar },
              {
                etiqueta: "Después de la visita",
                valor: v.despues
                  ? `${v.despuesTipo === "contrato" ? "Le adjudicó un contrato" : "Le dio una orden"} el ${fechaCorta(v.despues)}${v.diasDespues ? `, ${plural(v.diasDespues, "día", "días")} después` : ""}`
                  : v.entidadRuc ? "Nada después de esa fecha" : "Esa entidad no le adjudicó ni le compró",
              },
            ]}
          />
        ),
        pie: <span className="text-[12px] text-mute">Fuente: registro de visitas de la entidad{v.fuente ? ` (${v.fuente})` : ""}</span>,
      },
    };
  });
  const aClientes = d.visitas.filter((v) => v.entidadRuc).length;
  const despues = d.visitas.filter((v) => v.despues).length;
  return (
    <div className="space-y-3">
      <p className="max-w-prose text-[13px] text-inkSoft">
        {`${plural(d.total, "visita", "visitas")} de socios, representantes o directivos de la empresa (o de alguien que dijo venir de ella)`}
        {aClientes ? `; ${numero(aClientes)} a entidades que le adjudicaron o le compraron` : ""}
        {despues ? `, y tras ${plural(despues, "visita", "visitas")} esa entidad le dio algo después.` : "."}
      </p>
      <TablaPaginada
        columnas={COLUMNAS_VISITAS}
        filas={filas}
        etiqueta="Visitas registradas de su gente"
        tam={20}
        nombre="visitas"
        buscar={{ placeholder: "Buscar entidad, cargo o motivo…", etiqueta: "Buscar en sus visitas" }}
      />
    </div>
  );
}
