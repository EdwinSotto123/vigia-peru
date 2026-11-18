import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { Building2, CalendarRange, Flag, Gavel, ListOrdered, Receipt, Route, Wallet } from "lucide-react";
import {
  Ayuda,
  BloqueDetalle,
  CabeceraPestana,
  ChipsDetalle,
  CuerpoDetalle,
  DatosClave,
  BanderasFicha,
  Cargando,
  EncabezadoPagina,
  EstadoVacio,
  SinSenalesEstado,
  FichaNoLeida,
  Migas,
  Pagina,
  Pestanas,
  PieDetalle,
} from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, CuentaGrupo, Indicadores, Tabla, TablaPaginada, type Columna, type Fila, type GrupoFilas, type Indicador } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { SenalesBrevesEntidad, SenalesPorEntidad, senalesDeEntidad } from "@/components/personas/SenalesFicha";
import { PestanaOrdenes, TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { PerfilPersonaSeccion } from "@/components/personas/PerfilPersona";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { BanderaAparte } from "@/components/ui/BanderaAparte";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { motivoDudoso } from "@/lib/datoDudoso";
import { decimal, fechaConAnio, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  SENAL,
  TIPOS_SENAL,
  aniosTexto,
  filtrosOrdenesDeUrl,
  getFichaPersona,
  getOrdenesPersona,
  hayFiltrosOrdenes,
  banderasPersona,
  senalesDistintas,
  type AnioDePersona,
  type EntidadDePersona,
  type FichaPersona,
  type ProcesoGanado,
} from "@/lib/personas";
import { rutaContrato } from "@/lib/rutas";
import { nombrePartido } from "@/lib/planilla";
import { peorSeveridad } from "@/lib/severidad";
import { uno } from "@/lib/utils";
import type { Pestana } from "@/components/patrones";

/**
 * Las pestañas de una persona contratada (quien recibe órdenes con su RUC 10): señales, procesos, recorrido, lo que cobró,
 * órdenes y entidades. Las usa su ficha (/app/personas/[codigo]) y la ficha única de la persona
 * (/app/personas/cargo/[codigo]), que las monta junto a las de su cargo y su planilla (pedido del 2026-11-17: una sola
 * ficha por persona). `ruta` es la de la página que las muestra: los enlaces entre pestañas salen de ahí.
 */
/** La etiqueta corta de cada señal para la celda de una fila (`CrucesCelda`, una línea con su ícono de severidad). */
const CORTO_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [t, SENAL[t].corto]));

export interface DatosContratada {
  f: FichaPersona;
  /** El código de la persona contratada (no el de la página que la muestra). */
  codigo: string;
  ruta: string;
  nombre: string;
  /** La entidad elegida en Señales (`?sent=`). */
  sent?: string;
  filtrosOrdenes: ReturnType<typeof filtrosOrdenesDeUrl>;
  ordenesP: ReturnType<typeof getOrdenesPersona>;
}

export function pestanasContratada({ f, codigo, ruta, nombre, sent, filtrosOrdenes, ordenesP }: DatosContratada): Pestana[] {
  const p = f.persona;
  const cuenta = senalesDistintas(f.entidades);
  const procesos = f.procesos ?? [];
  return [
          {
            clave: "senales",
            icono: <Flag size={15} aria-hidden />,
            etiqueta: "Señales",
            conteo: cuenta.total,
            contenido: (
              <div>
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Cómo se cuentan las señales?">
                      <span className="block">
                        Cada señal dice qué otro registro público coincide con esta persona en una entidad que la contrató: una
                        candidatura, un aporte, un cargo, sus apellidos, lo que cobra. No prueba un delito ni un parentesco.
                      </span>
                      <span className="mt-2 block">
                        Lo que es de la persona y no de una entidad (un aporte, una candidatura) vale en cada entidad que la
                        contrató: se cuenta una vez, y por eso las señales de cada entidad suman más que el total.
                      </span>
                    </Ayuda>
                  }
                >
                  {cuenta.total ? lineaSenales(cuenta, f.entidades) : "Qué dicen de esta persona otros registros públicos, en cada entidad que la contrató."}
                </CabeceraPestana>
                {cuenta.total ? (
                  <SenalesPorEntidad entidades={f.entidades} codigo={codigo} elegida={sent} />
                ) : (
                  <SinSenalesEstado titulo="Sin señales: ningún otro registro coincide">
                    No figura como candidato, aportante, autoridad ni inhabilitado, no comparte apellidos con autoridades de sus
                    entidades, y lo que cobra no se aparta de lo que pagan por lo mismo.
                  </SinSenalesEstado>
                )}
              </div>
            ),
          },
          ...(procesos.length
            ? [
                {
                  clave: "procesos",
                  icono: <Gavel size={15} aria-hidden />,
                  etiqueta: "Procesos",
                  titulo: "Los procesos de selección que ganó",
                  conteo: procesos.length,
                  contenido: (
                    <div>
                      <CabeceraPestana
                        ayuda={
                          <Ayuda titulo="¿De dónde salen?">
                            <span className="block">
                              Del registro de adjudicaciones del OECE (CONOSCE): los procesos de selección en que esta persona obtuvo la
                              buena pro con su propio RUC, que no se muestra. Son distintos de sus órdenes de servicio, que van en su
                              pestaña.
                            </span>
                            <span className="mt-2 block">
                              Cada fila abre el contrato en Vigía, con sus antecedentes y, si se analizó, su dictamen. Un antecedente es
                              un motivo para revisar, no una acusación.
                            </span>
                          </Ayuda>
                        }
                      >
                        {plural(procesos.length, "proceso ganado", "procesos ganados")} como persona natural por {solesCompacto(p.montoProcesos ?? 0)}
                        {p.primeraBuenaPro && p.ultimaBuenaPro && p.primeraBuenaPro !== p.ultimaBuenaPro
                          ? `, del ${fechaConAnio(p.primeraBuenaPro)} al ${fechaConAnio(p.ultimaBuenaPro)}.`
                          : "."}
                      </CabeceraPestana>
                      <TablaPaginada
                        columnas={COLUMNAS_PROCESOS}
                        filas={procesos.map(filaProceso)}
                        etiqueta="Procesos de selección que ganó"
                        nombre="procesos"
                        tam={20}
                        buscar={{ placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en los procesos que ganó" }}
                      />
                    </div>
                  ),
                },
              ]
            : []),
          {
            clave: "recorrido",
            icono: <Route size={15} aria-hidden />,
            etiqueta: "Recorrido",
            titulo: "Su recorrido en otros registros",
            contenido: (
              <div>
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde sale su recorrido?">
                      <span className="block">
                        De otros registros públicos que traen su número de documento: el de proveedores del OECE (sus empresas),
                        el JNE (candidaturas y cargos), la ONPE (aportes), las declaraciones juradas de la Contraloría y los
                        registros de visitas y de planilla de cada entidad.
                      </span>
                      <span className="mt-2 block">
                        Vigía los une por ese documento, que nunca muestra. Coincidir en un registro no es una falta: es contexto.
                      </span>
                    </Ayuda>
                  }
                >
                  Lo que esta persona es fuera de sus órdenes: sus empresas, su política, su familia en el Estado, su planilla y sus visitas.
                </CabeceraPestana>
                <Suspense fallback={<Cargando texto="Leyendo su recorrido…" />}>
                  <PerfilPersonaSeccion codigo={codigo} />
                </Suspense>
              </div>
            ),
          },
          {
            clave: "pagos",
            icono: <Wallet size={15} aria-hidden />,
            etiqueta: "Cobros por órdenes",
            titulo: "Lo que cobró por órdenes de servicio",
            contenido: <Pagos ficha={f} nombre={nombre} ruta={ruta} />,
          },
          {
            clave: "ordenes",
            icono: <Receipt size={15} aria-hidden />,
            etiqueta: "Órdenes",
            conteo: p.ordenes,
            contenido: <PestanaOrdenes ruta={ruta} pagina={ordenesP} filtros={filtrosOrdenes} ficha={f} />,
          },
          {
            clave: "entidades",
            icono: <Building2 size={15} aria-hidden />,
            etiqueta: "Entidades",
            conteo: p.entidades,
            contenido: (
              <div>
                <CabeceraPestana>Las entidades que le dieron órdenes: toca una para ver lo que le pagó cada año y sus señales ahí.</CabeceraPestana>
                <TablaPaginada
                  columnas={COLUMNAS_ENTIDADES}
                  filas={filasEntidades(f, cuenta, ruta)}
                  etiqueta="Entidades que lo contrataron"
                  nombre="entidades"
                  tam={20}
                  buscar={{ placeholder: "Buscar por entidad, servicio o región…", etiqueta: "Buscar en sus entidades" }}
                />
              </div>
            ),
          },
  ];
}

// ─── Los procesos que ganó ───────────────────────────────────────────────────────────────────────

const COLUMNAS_PROCESOS: Columna[] = [
  { clave: "proceso", titulo: "Proceso y entidad", ancho: "minmax(0,1.7fr)" },
  { clave: "fecha", titulo: "Buena pro", ancho: "6.5rem", desde: "md", apilar: "con-rotulo" },
  { clave: "antecedentes", titulo: "Antecedentes del contrato", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  { clave: "monto", titulo: "Adjudicado", ancho: "7rem", alinear: "der" },
];

function filaProceso(g: ProcesoGanado): Fila {
  const objeto = g.objeto ? tituloNatural(g.objeto) : "Proceso sin objeto registrado";
  const entidad = g.entidad ? tituloNatural(g.entidad) : "Entidad sin nombre";
  return {
    id: `proceso-${g.codigo}`,
    href: rutaContrato(g.ocid ?? g.codigo, "ficha", { seccion: "antecedentes" }),
    textos: { proceso: `${objeto} ${entidad} ${g.nomenclatura ?? ""} ${g.codigo}`, fecha: g.fecha ?? "" },
    celdas: {
      proceso: (
        <CeldaPrincipal
          dosLineas
          titulo={objeto}
          meta={[
            <span key="e">{entidad}</span>,
            g.nomenclatura ? <Dato key="n" tipo="codigo" mono>{g.nomenclatura}</Dato> : null,
          ]}
        />
      ),
      fecha: <span className="text-meta tabular-nums text-inkSoft">{g.fecha ? fechaConAnio(g.fecha) : "Sin fecha"}</span>,
      antecedentes: <CrucesCelda cruces={g.cruces} etiquetaLista="Antecedentes de este contrato" />,
      monto: <CeldaNumero>{g.monto != null ? solesCompacto(g.monto) : "Sin dato"}</CeldaNumero>,
    },
  };
}

type Cuenta = ReturnType<typeof senalesDistintas>;

/**
 * "8 señales en 5 entidades; 3 valen en varias de ellas." — el mismo total de la cifra, la pestaña y el índice. Con las
 * señales en una sola entidad no va (null): «7 señales en 1 entidad» repetía el número de la pestaña, y esa entidad, con
 * sus señales, está justo debajo.
 */
function lineaSenales(c: Cuenta, entidades: EntidadDePersona[]): string | null {
  const con = entidades.filter((e) => e.senalesDetalle.length > 0).length;
  if (con <= 1) return null;
  const base = `${plural(c.total, "señal", "señales")} en ${plural(con, "entidad", "entidades")}`;
  if (!c.enVarias) return `${base}.`;
  return `${base}; ${c.enVarias === 1 ? "1 vale" : `${numero(c.enVarias)} valen`} en varias de ellas.`;
}

export function indicadores(f: FichaPersona, c: Cuenta, ruta: string): Indicador[] {
  const p = f.persona;
  const contextoSenales = [
    c.altas > 0 ? plural(c.altas, "alta", "altas") : c.total ? "ninguna alta" : null,
    c.enVarias > 0 ? `${numero(c.enVarias)} en varias entidades` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return [
    {
      valor: solesCompacto(p.monto),
      etiqueta: "cobrados por órdenes",
      // Lo que CONOSCE publicó con posible error va aparte como bandera chica (BanderaAparte, como en la lista de
      // personas), no como la cola de la frase: hacía de la tarjeta un párrafo.
      contexto: p.dudosas?.ordenes ? (
        <>
          {`en ${plural(p.ordenes, "orden", "órdenes")}`}
          <BanderaAparte monto={solesCompacto(p.dudosas.monto ?? 0)} titulo="Posible error de CONOSCE" className="mt-1.5">
            {`${plural(p.dudosas.ordenes, "orden", "órdenes")} ${p.dudosas.ordenes === 1 ? "trae" : "traen"} ${soles(p.dudosas.monto ?? 0)}${p.dudosas.ordenes === 1 ? "" : " en total"}. Puede ser un error de CONOSCE al subir el dato: Vigía no lo borra, pero lo deja fuera de este total para que no infle la cifra.`}
          </BanderaAparte>
        </>
      ) : (
        `en ${plural(p.ordenes, "orden", "órdenes")}`
      ),
      href: `${ruta}?seccion=ordenes`,
    },
    // Los procesos de selección que ganó (migración 317): antes la ficha sólo contaba sus órdenes.
    ...((p.procesos ?? 0) > 0
      ? [{
          valor: solesCompacto(p.montoProcesos ?? 0),
          etiqueta: "adjudicados en procesos",
          contexto: `${plural(p.procesos ?? 0, "proceso ganado", "procesos ganados")} en ${plural(p.entidadesProcesos ?? 1, "entidad", "entidades")}`,
          href: `${ruta}?seccion=procesos`,
        } satisfies Indicador]
      : []),
    { valor: numero(p.meses), etiqueta: "meses con órdenes", contexto: "sumados por año y entidad", href: `${ruta}?seccion=pagos` },
    { valor: numero(p.entidades), etiqueta: p.entidades === 1 ? "entidad" : "entidades", contexto: "que lo contrataron", href: `${ruta}?seccion=entidades` },
    {
      valor: numero(c.total),
      etiqueta: c.total === 1 ? "señal" : "señales",
      contexto: contextoSenales || "ningún otro registro coincide",
      tono: c.altas > 0 ? "alta" : "neutro",
      href: `${ruta}?seccion=senales`,
    },
  ];
}

// ─── Lo que cobró ─────────────────────────────────────────────────────────────────────────────────

// La primera columna que se ve en el celular es el servicio: el año, la mediana y la diferencia se apilan bajo él con
// su rótulo (antes en el celular sólo quedaba «Por mes», sin con qué compararlo).
const COLUMNAS_PAGOS: Columna[] = [
  { clave: "anio", titulo: "Año", ancho: "56px", desde: "md", apilar: "con-rotulo" },
  { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1.3fr)" },
  { clave: "meses", titulo: "Meses", ancho: "64px", alinear: "der", desde: "lg" },
  { clave: "pormes", titulo: "Por mes", ancho: "104px", alinear: "der" },
  {
    clave: "entidadMed",
    titulo: "Mediana entidad",
    corto: "Mediana",
    ancho: "136px",
    alinear: "der",
    desde: "md",
    apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Qué es la mediana?">
        De todas las personas a las que esa entidad pagó ese año el mismo tipo de servicio, lo que cobra por mes la del medio:
        la mitad cobra menos y la otra mitad más. «Por mes» es lo cobrado en el año dividido entre los meses con órdenes.
      </Ayuda>
    ),
  },
  { clave: "paisMed", titulo: "Mediana país", ancho: "128px", alinear: "der", desde: "xl" },
  { clave: "veces", titulo: "Diferencia", ancho: "104px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

function filaPago(a: AnioDePersona, ruta: string): Fila {
  const med = a.enLaEntidad?.mediana ?? null;
  const veces = a.personal && a.porMes != null && med ? a.porMes / med : null;
  return {
    id: `${a.anio}-${a.entidadRuc}`,
    // Desde el agregado del año se baja a las órdenes de ESA entidad y año, donde cada una dice qué se pagó (su motivo).
    href: `${ruta}?seccion=ordenes&oent=${a.entidadRuc}&oanio=${a.anio}`,
    celdas: {
      anio: <span className="font-mono text-meta tabular-nums text-ink">{a.anio}</span>,
      servicio: (
        <CeldaPrincipal
          titulo={a.servicio ?? "Servicio sin clasificar"}
          meta={[<Dato key="ordenes" tipo="documento" nombre="Órdenes">{`${plural(a.ordenes, "orden", "órdenes")} en ${plural(a.meses, "mes", "meses")}`}</Dato>]}
        />
      ),
      meses: <CeldaNumero>{numero(a.meses)}</CeldaNumero>,
      pormes: <CeldaNumero sub={`${soles(a.monto)} en el año`}>{a.porMes != null ? soles(a.porMes) : "Sin dato"}</CeldaNumero>,
      entidadMed: (
        <CeldaNumero sub={a.enLaEntidad ? plural(a.enLaEntidad.personas, "persona", "personas") : undefined}>
          {a.personal && med != null ? soles(med) : <span className="font-sans text-mute">No aplica</span>}
        </CeldaNumero>
      ),
      paisMed: (
        <CeldaNumero sub={a.enElPais ? plural(a.enElPais.personas, "persona", "personas") : undefined}>
          {a.personal && a.enElPais?.mediana != null ? soles(a.enElPais.mediana) : <span className="font-sans text-mute">No aplica</span>}
        </CeldaNumero>
      ),
      veces: (
        <CeldaNumero>
          {veces == null ? (
            <span className="font-sans text-mute">Sin comparar</span>
          ) : (
            // Punto decimal, como el resto del sitio: «2,5 veces» junto a «S/ 1,234» se leía como veinticinco.
            <span className={veces >= 2.5 ? "font-semibold text-crimsonTexto" : undefined}>{`${decimal(veces)} veces`}</span>
          )}
        </CeldaNumero>
      ),
    },
  };
}

/** Un cambio de gobierno en la entidad que más le pagó, para su línea mes a mes: la gestión local nueva o el Presidente. */
function textoCambio(c: { nivel: string; quien: string | null }): string {
  if (c.nivel === "nacional") {
    if (!c.quien) return "Asumió un nuevo Presidente";
    return /^Elegido/i.test(c.quien) ? `Asumió el Presidente ${c.quien.charAt(0).toLowerCase()}${c.quien.slice(1)}` : `Asumió ${c.quien}`;
  }
  const gestion = c.nivel === "regional" ? "la nueva gestión regional" : "la nueva gestión municipal";
  const partido = nombrePartido(c.quien);
  return partido ? `Asumió ${gestion}, de ${partido}` : `Asumió ${gestion}`;
}

/** «Entró con la gestión 2023-2026» o «Ya estaba antes de la gestión 2023-2026»: su primera orden frente a la gestión actual. */
function cuandoEntro(e: EntidadDePersona): string | null {
  const g = e.gestion;
  if (!g || !e.primera) return null;
  const cual = g.nivel === "nacional" ? `el gobierno que asumió el ${fechaConAnio(g.desde)}` : `la ${(g.quien ?? "gestión actual").replace(/^Gestión/, "gestión")}`;
  if (e.primera >= g.desde) return `Entró con ${cual}`;
  return e.ultima && e.ultima >= g.desde ? `Ya estaba antes de ${cual} y siguió` : `Antes de ${cual}`;
}

const DOCUMENTO_COBRO: Record<NonNullable<FichaPersona["comoCobro"]>["documento"], string> = {
  ruc10: "Proveedor persona natural, con RUC 10",
  ruc_otro_documento: "Proveedor persona natural, con un RUC de otro documento (15 o 17)",
  ruc20: "Proveedor con RUC de empresa",
};

/**
 * Cómo cobró por órdenes: con qué documento (una persona natural factura con su RUC 10, no como trabajador) y por qué tipo
 * de orden. El número del RUC nunca sale: lleva su DNI.
 */
function ComoCobroOrdenes({ como }: { como: NonNullable<FichaPersona["comoCobro"]> }) {
  const suma = (filtro: (x: (typeof como.porTipo)[number]) => boolean) => {
    const l = como.porTipo.filter(filtro);
    return { ordenes: l.reduce((t, x) => t + x.ordenes, 0), monto: l.reduce((t, x) => t + x.monto, 0) };
  };
  const cuanto = (x: { ordenes: number; monto: number }) => (x.ordenes ? `${plural(x.ordenes, "orden", "órdenes")} por ${solesCompacto(x.monto)}` : null);
  const servicio = suma((x) => /servicio/i.test(x.tipo ?? ""));
  const compra = suma((x) => /compra/i.test(x.tipo ?? ""));
  const directas = suma((x) => x.clase === "directa");
  const deProceso = suma((x) => x.clase === "pago");
  const catalogo = suma((x) => x.clase === "catalogo");
  return (
    <section aria-labelledby="como-cobro-ordenes" className="tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5" data-bloque>
      <h3 id="como-cobro-ordenes" className="font-display text-bloque font-bold text-ink">Cómo cobró</h3>
      <DatosClave
        items={[
          {
            etiqueta: "Cobró como",
            valor: DOCUMENTO_COBRO[como.documento],
            ayuda:
              como.documento === "ruc10" ? (
                <Ayuda titulo="¿Qué es un RUC 10?">
                  El RUC que la SUNAT le da a una persona natural: empieza en 10 y lleva su DNI, por eso Vigía no lo muestra. Con él la
                  persona emite recibos por honorarios o facturas: la entidad le paga como a un proveedor, no como a un trabajador de su
                  planilla.
                </Ayuda>
              ) : undefined,
          },
          { etiqueta: "Órdenes de servicio", valor: cuanto(servicio) ?? "Ninguna" },
          ...(compra.ordenes ? [{ etiqueta: "Órdenes de compra", valor: cuanto(compra) }] : []),
          { etiqueta: "Sin proceso de selección", valor: cuanto(directas) ?? "Ninguna", ayuda: <Ayuda titulo="¿Sin proceso de selección?">Órdenes que la entidad emite directamente, sin concurso: las compras de hasta 8 UIT y otras contrataciones sin proceso.</Ayuda> },
          ...(deProceso.ordenes ? [{ etiqueta: "De un proceso de selección", valor: cuanto(deProceso) }] : []),
          ...(catalogo.ordenes ? [{ etiqueta: "Por catálogo electrónico", valor: cuanto(catalogo) }] : []),
        ]}
      />
    </section>
  );
}

function Pagos({ ficha: f, nombre, ruta }: { ficha: FichaPersona; nombre: string; ruta: string }) {
  const mensual = f.mensual ?? [];
  // La entidad que más le pagó: la de los cambios de gobierno que se marcan en su línea mes a mes.
  const principal = [...f.entidades].sort((a, b) => b.monto - a.monto)[0]?.entidad ?? null;
  // Un grupo por entidad (la que más le pagó primero), con su total en el rótulo; dentro, del año más reciente al más viejo.
  const porEntidad = new Map<string, AnioDePersona[]>();
  for (const a of f.anual) porEntidad.set(a.entidadRuc, [...(porEntidad.get(a.entidadRuc) ?? []), a]);
  const grupos: GrupoFilas[] = [...porEntidad.entries()]
    .map(([ruc, anios]) => ({ ruc, anios, monto: anios.reduce((t, a) => t + a.monto, 0), ordenes: anios.reduce((t, a) => t + a.ordenes, 0) }))
    .sort((a, b) => b.monto - a.monto)
    .map((g) => {
      const nombreEnt = g.anios[0]?.entidad ? tituloNatural(g.anios[0].entidad) : g.ruc;
      return {
        clave: g.ruc,
        titulo: (
          <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            {/* La entidad, a su ficha: el rótulo del grupo no es parte de una fila (cada año lleva a sus órdenes). */}
            <Link href={`/entidad/${g.ruc}`} prefetch={false} className="min-w-0 text-granate underline-offset-2 hover:underline">
              {nombreEnt}
            </Link>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-meta font-normal text-mute">
              <CuentaGrupo>{soles(g.monto)}</CuentaGrupo>
              {`en ${plural(g.ordenes, "orden", "órdenes")}`}
            </span>
          </span>
        ),
        filas: [...g.anios].sort((a, b) => b.anio - a.anio).map((a) => filaPago(a, ruta)),
      };
    });
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Cómo se compara lo que cobró?">
            <span className="block">
              «Por mes» es lo que cobró en el año dividido entre los meses con órdenes. Se compara con la mediana de lo que la
              misma entidad, y todo el país, pagan por mes a quienes hacen el mismo tipo de servicio.
            </span>
            <span className="mt-2 block">
              El tipo de servicio sale de las palabras de la descripción de sus órdenes. No se compara lo que no es el trabajo
              de una persona (alquileres, comida, impresiones, transporte): ahí dice «No aplica».
            </span>
          </Ayuda>
        }
      >
        Lo que cobró por mes en cada entidad y año, frente a lo que esa entidad y el país pagan por el mismo servicio. Toca un
        año para ver sus órdenes.
      </CabeceraPestana>
      {f.comoCobro && f.comoCobro.porTipo.length > 0 && <ComoCobroOrdenes como={f.comoCobro} />}
      {mensual.length > 1 && (
        <section aria-labelledby="mes-a-mes" className="tarjeta space-y-2 rounded-2xl border border-line bg-paper p-4 sm:p-5">
          <h3 id="mes-a-mes" className="font-display text-bloque font-bold text-ink">Mes a mes</h3>
          <LineaMeses
            puntos={mensual.map((m) => ({ mes: m.mes, base: m.monto, aparte: m.dudoso || null }))}
            nombres={{ base: "Cobrado por órdenes" }}
            huecos="cero"
            quienCarga="de CONOSCE"
            etiqueta={`Lo que cobró por órdenes mes a mes, ${nombre}`}
            cambios={(f.cambios ?? []).map((c) => ({ mes: c.mes, texto: textoCambio(c) }))}
            etiquetaCambios={principal ? `Cambio de gobierno en ${tituloNatural(principal)}` : undefined}
          />
        </section>
      )}
      {grupos.length ? (
        <Tabla columnas={COLUMNAS_PAGOS} grupos={grupos} etiqueta="Lo que cobró por entidad y año" />
      ) : (
        <EstadoVacio compacto titulo="Sin lo cobrado por año">Todavía no hay órdenes sumadas por año para esta persona.</EstadoVacio>
      )}
    </div>
  );
}

// ─── Entidades ────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_ENTIDADES: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.4fr)" },
  { clave: "senales", titulo: "Señales", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  { clave: "ordenes", titulo: "Órdenes", ancho: "76px", alinear: "der", desde: "lg" },
  { clave: "monto", titulo: "Monto", ancho: "108px", alinear: "der" },
];

const COLUMNAS_ANIOS: Columna[] = [
  { clave: "anio", titulo: "Año", ancho: "3.5rem" },
  { clave: "servicio", titulo: "Servicio", ancho: "minmax(0,1fr)", desde: "md" },
  { clave: "monto", titulo: "Cobró", ancho: "7rem", alinear: "der" },
];

/**
 * Cada entidad abre su panel (no saca de la persona): lo que le pagó, cada año (que lleva a esas órdenes), quién la
 * gobernaba y sus señales en una línea; al pie, la ficha de la entidad y sus órdenes.
 */
function filasEntidades(f: FichaPersona, cuenta: Cuenta, ruta: string): Fila[] {
  return f.entidades.map((e) => {
    const nombre = e.entidad ? tituloNatural(e.entidad) : `Entidad ${e.entidadRuc}`;
    const anios = aniosTexto(e.anios);
    const peor = peorSeveridad(e.senalesDetalle);
    // Lo mismo que cuenta el índice de la pestaña Señales para esta entidad.
    const nSenales = senalesDeEntidad(e, cuenta.porClave).length;
    const filasAnio: Fila[] = f.anual
      .filter((a) => a.entidadRuc === e.entidadRuc)
      .sort((a, b) => b.anio - a.anio)
      .map((a) => ({
        id: String(a.anio),
        href: `${ruta}?seccion=ordenes&oent=${e.entidadRuc}&oanio=${a.anio}`,
        celdas: {
          anio: <span className="font-mono text-meta tabular-nums text-ink">{a.anio}</span>,
          servicio: <span className="truncate text-meta text-inkSoft">{a.servicio ?? "Sin clasificar"}</span>,
          monto: <CeldaNumero sub={plural(a.ordenes, "orden", "órdenes")}>{soles(a.monto)}</CeldaNumero>,
        },
      }));
    return {
      id: e.entidadRuc,
      buscable: [nombre, e.servicio, e.depNombre].filter(Boolean).join(" "),
      celdas: {
        entidad: (
          <CeldaPrincipal
            titulo={nombre}
            meta={[
              e.servicio && <Dato key="servicio" tipo="servicio">{e.servicio}</Dato>,
              e.depNombre && <Dato key="lugar" tipo="lugar">{e.depNombre}</Dato>,
              anios && <Dato key="anios" tipo="fecha" nombre="Años">{anios}</Dato>,
            ]}
          />
        ),
        senales: e.senales?.length ? <CrucesCelda cruces={e.senales} etiquetas={CORTO_SENAL} /> : <span className="text-meta text-mute">Sin señales</span>,
        ordenes: <CeldaNumero>{numero(e.ordenes)}</CeldaNumero>,
        monto: <CeldaNumero>{solesCompacto(e.monto)}</CeldaNumero>,
      },
      detalle: {
        titulo: nombre,
        etiqueta: `Ver lo que le pagó ${nombre} y sus señales ahí`,
        descripcion: (
          <span className="flex flex-wrap gap-x-3 gap-y-0.5">
            {e.depNombre && <Dato tipo="lugar">{e.depNombre}</Dato>}
            {anios && <Dato tipo="fecha" nombre="Años">{anios}</Dato>}
          </span>
        ),
        contenido: (
          <CuerpoDetalle>
            {peor && (
              <ChipsDetalle>
                <Severidad bandera={peor} />
                <span className="text-meta text-inkSoft">{`${plural(nSenales, "señal", "señales")} en esta entidad`}</span>
              </ChipsDetalle>
            )}
            <DatosClave
              items={[
                { etiqueta: "Le pagó", valor: soles(e.monto), mono: true },
                { etiqueta: "Órdenes", valor: numero(e.ordenes), mono: true },
                { etiqueta: "Meses con órdenes", valor: numero(e.meses), mono: true },
                { etiqueta: "Años", valor: anios, mono: true },
                { etiqueta: "Tipo de servicio", valor: e.servicio },
                { etiqueta: "Región", valor: e.depNombre },
                { etiqueta: "Cuándo entró", valor: cuandoEntro(e) },
                {
                  etiqueta: "Partido que gobernaba",
                  valor: e.gobiernos?.length
                    ? [...e.gobiernos].sort((a, b) => b.anio - a.anio).map((g) => (
                        <Link key={`${g.clave}-${g.anio}`} href={`/app/partidos/${g.clave}?anio=${g.anio}`} className="mr-3 inline-block text-granate underline-offset-2 hover:underline">
                          {g.nombre}
                        </Link>
                      ))
                    : null,
                },
              ]}
            />
            {filasAnio.length > 0 && (
              <BloqueDetalle titulo="Lo que cobró cada año">
                <Tabla columnas={COLUMNAS_ANIOS} filas={filasAnio} etiqueta={`Lo que le pagó ${nombre} cada año (toca uno para ver sus órdenes)`} medida="contenedor" densidad="compacta" />
              </BloqueDetalle>
            )}
            <BloqueDetalle
              titulo="Sus señales aquí"
              acciones={
                e.senalesDetalle.length ? (
                  <Link href={`${ruta}?seccion=senales&sent=${e.entidadRuc}`} className="shrink-0 text-meta font-medium text-granate underline-offset-2 hover:underline">
                    Ver su evidencia
                  </Link>
                ) : undefined
              }
            >
              <SenalesBrevesEntidad entidad={e} entidades={f.entidades} />
            </BloqueDetalle>
          </CuerpoDetalle>
        ),
        pie: (
          <PieDetalle
            principal={
              <EnlaceAccion href={`/entidad/${e.entidadRuc}`} flecha>
                <Building2 size={14} aria-hidden /> Abrir la ficha de la entidad
              </EnlaceAccion>
            }
            secundarias={
              <EnlaceAccion href={`${ruta}?seccion=ordenes&oent=${e.entidadRuc}`} variante="secundario">
                <ListOrdered size={14} aria-hidden /> {e.ordenes === 1 ? "Ver su orden" : `Ver sus ${numero(e.ordenes)} órdenes`}
              </EnlaceAccion>
            }
          />
        ),
      },
    };
  });
}

export function NoSePudoLeer({ codigo }: { codigo: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: "/app/personas" }]}
      titulo="Persona contratada"
      error="No pudimos leer esta ficha"
      reintentar={{ href: `/app/personas/${codigo}` }}
    >
      Puede que el código no exista o que el servidor no respondiera. No mostramos nada en su lugar.
    </FichaNoLeida>
  );
}
