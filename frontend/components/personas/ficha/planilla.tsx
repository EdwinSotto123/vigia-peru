import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Building2, CircleCheck, Flag, LayoutDashboard, Wallet } from "lucide-react";
import { Ayuda, AyudaTermino, BanderasFicha, CabeceraPestana, DatosClave, EncabezadoPagina, EstadoVacio, FichaNoLeida, FuenteDato, SinSenalesEstado, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, CuentaGrupo, Indicadores, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { SenalesPlanillaBreves, SenalesPlanillaLista } from "@/components/personas/SenalesPlanilla";
import { PestanaOrdenes, TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { IrAPestana } from "@/components/personas/IrAPestana";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { PORTAL_TRANSPARENCIA, personalPte } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { filtrosOrdenesDeUrl, getFichaPersona, getOrdenesPersona, hayFiltrosOrdenes, type FichaPersona } from "@/lib/personas";
import { REGIMEN, SENAL_PLANILLA, getFichaPlanilla, mes, parientesProveedores, periodoMeses, rutaPlanilla, type FichaPlanilla, type ParienteProveedor } from "@/lib/planilla";
import { uno } from "@/lib/utils";
import type { Pestana } from "@/components/patrones";

/**
 * Las pestañas de una persona de planilla (Portal de Transparencia): resumen, sueldo, señales, órdenes y otras planillas.
 * Las usa su ficha (/app/personas/planilla/[codigo]) y la ficha única de la persona (/app/personas/cargo/[codigo]), que
 * toma de aquí el sueldo y las señales (pedido del 2026-11-17: una sola ficha por persona). `ruta` es la de la página
 * que las muestra.
 */

/** Lo que se calcula de una ficha de planilla antes de dibujarla: su ficha de locador, sus parientes proveedores y sus señales. */
export async function prepararPlanilla(f: FichaPlanilla, ruta: string) {
  const p = f.persona;
  const entidad = p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre";
  // La persona entera: si también es locador, su ficha de persona contratada (lo que cobró por órdenes, de qué
  // entidades); y la de cada pariente que le vende a su entidad (las órdenes concretas, como evidencia).
  const [locador, fichasParientes] = await Promise.all([
    p.codigo ? getFichaPersona(p.codigo) : Promise.resolve(null),
    Promise.all(f.nepotismo.map((x) => (!x.reservado && x.proveedorCodigo ? getFichaPersona(x.proveedorCodigo) : Promise.resolve(null)))),
  ]);
  const parientes = parientesProveedores(f, fichasParientes);
  // El pariente locador también llega como señal (migración 179); con la evidencia rica de arriba (sus órdenes y su ficha),
  // la señal simple sobra: se muestra una vez.
  const senalesPlanilla = parientes.length ? p.senales.filter((s) => s.tipo !== "pariente_locador") : p.senales;
  const nSenales = senalesPlanilla.length + (parientes.length ? 1 : 0);
  const altas = senalesPlanilla.filter((s) => s.severidad === "alta").length + (parientes.length ? 1 : 0);
  // Sus banderas, fijas bajo el nombre en todas las pestañas: el nepotismo (parientes que declaró en su DJI y que le
  // venden a su entidad) primero, después sus señales de la planilla, lo grave antes; todas hacia la pestaña Señales.
  const aSenales = `${ruta}?seccion=senales`;
  const banderas = [
    ...(parientes.length
      ? [{ tipo: "nepotismo", severidad: "alta" as const, nombre: "Posible nepotismo", n: parientes.length > 1 ? parientes.length : null, explica: "Declaró en su DJI a un pariente que es locador de su misma entidad", href: aSenales }]
      : []),
    ...senalesPlanilla.map((x) => ({ tipo: x.tipo, severidad: x.severidad, nombre: SENAL_PLANILLA[x.tipo]?.corto ?? x.tipo, explica: SENAL_PLANILLA[x.tipo]?.titulo, href: aSenales })),
  ];
  // Meses en que además cobró por órdenes de servicio (señal tambien_ordenes), para marcarlos en el cuadro mes a mes.
  const detOrden = p.senales.find((s) => s.tipo === "tambien_ordenes")?.detalle;
  const mesesOrden = Array.isArray(detOrden?.meses) ? (detOrden!.meses as unknown[]).map(String) : [];
  const montoOrden = typeof detOrden?.monto === "number" ? (detOrden!.monto as number) : null;
  return { p, entidad, locador, parientes, senalesPlanilla, nSenales, altas, banderas, mesesOrden, montoOrden };
}
export type PlanillaPreparada = Awaited<ReturnType<typeof prepararPlanilla>>;

/** Las señales de su planilla, con su evidencia: el bloque de la pestaña Señales (también en la ficha única). */
export function SenalesDePlanilla({ d }: { d: PlanillaPreparada }) {
  const { p, entidad, parientes, senalesPlanilla, nSenales } = d;
  return nSenales ? (
    <section aria-label="Sus señales" className="tarjeta rounded-2xl border border-line bg-paper px-4 pb-1 pt-1 sm:px-5">
      <SenalesPlanillaLista senales={senalesPlanilla} nepotismo={parientes} entidad={entidad} entidadRuc={p.entidadRuc} idPte={p.idPte} />
    </section>
  ) : (
    <SinSenalesEstado titulo="Sin señales: ningún otro registro coincide">
      No cobra también por órdenes de la entidad, no fue candidato del partido que la gobierna, no comparte apellidos
      con sus autoridades ni sus directivos y su sueldo no se aparta del de su mismo cargo.
    </SinSenalesEstado>
  );
}

export interface DatosPlanilla {
  f: FichaPlanilla;
  d: PlanillaPreparada;
  ruta: string;
  filtrosOrdenes: ReturnType<typeof filtrosOrdenesDeUrl>;
  ordenesP: ReturnType<typeof getOrdenesPersona> | null;
}

export function pestanasPlanilla({ f, d, ruta, filtrosOrdenes, ordenesP }: DatosPlanilla): Pestana[] {
  const { p, entidad, locador, parientes, senalesPlanilla, nSenales, mesesOrden, montoOrden } = d;
  return [
          {
            clave: "resumen",
            icono: <LayoutDashboard size={15} aria-hidden />,
            etiqueta: "Resumen",
            contenido: (
              <Resumen
                f={f}
                entidad={entidad}
                parientes={parientes}
                nSenales={nSenales}
                locador={locador}
                mesesOrden={mesesOrden}
                montoOrden={montoOrden}
              />
            ),
          },
          {
            clave: "sueldo",
            icono: <Wallet size={15} aria-hidden />,
            etiqueta: "Sueldo",
            contenido: <PestanaSueldo f={f} entidad={entidad} mesesOrden={mesesOrden} montoOrden={montoOrden} />,
          },
          {
            clave: "senales",
            icono: <Flag size={15} aria-hidden />,
            etiqueta: "Señales",
            conteo: nSenales,
            contenido: (
              <div>
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿Qué es una señal?">
                      Dice qué otro registro público coincide con esta persona en su entidad: una candidatura, sus apellidos, lo que
                      cobra frente a su mismo cargo, órdenes de servicio a su nombre, un pariente declarado que le vende. Es un
                      indicio para revisar, no una acusación ni la prueba de un parentesco.
                    </Ayuda>
                  }
                >
                  {nSenales ? `${plural(nSenales, "señal", "señales")} en ${entidad}, de la más grave a la más leve.` : `En ${entidad}, qué dicen de esta persona otros registros públicos.`}
                </CabeceraPestana>
                {nSenales ? (
                  <section aria-label="Sus señales" className="tarjeta rounded-2xl border border-line bg-paper px-4 pb-1 pt-1 sm:px-5">
                    <SenalesPlanillaLista senales={senalesPlanilla} nepotismo={parientes} entidad={entidad} entidadRuc={p.entidadRuc} idPte={p.idPte} />
                  </section>
                ) : (
                  <SinSenalesEstado titulo="Sin señales: ningún otro registro coincide">
                    No cobra también por órdenes de la entidad, no fue candidato del partido que la gobierna, no comparte apellidos
                    con sus autoridades ni sus directivos y su sueldo no se aparta del de su mismo cargo.
                  </SinSenalesEstado>
                )}
              </div>
            ),
          },
          ...(p.codigo && ordenesP
            ? [
                {
                  clave: "ordenes",
                  etiqueta: "Órdenes",
                  conteo: locador?.persona.ordenes ?? null,
                  contenido: (
                    <PestanaOrdenes
                      ruta={ruta}
                      pagina={ordenesP}
                      filtros={filtrosOrdenes}
                      ficha={locador}
                      descripcion="Las órdenes de servicio que recibe a su nombre, de esta y de otras entidades: toca una para su detalle."
                      ayuda={
                        <Ayuda titulo="¿Cómo se sabe que es la misma persona?">
                          Su nombre completo coincide con el de quien recibe órdenes de servicio de esta misma entidad (la planilla no
                          trae DNI ni RUC). Su ficha de persona contratada tiene todas sus órdenes y sus señales como locador.
                        </Ayuda>
                      }
                    />
                  ),
                },
              ]
            : []),
          ...(f.otras.length > 0
            ? [
                {
                  clave: "otras",
                  icono: <Building2 size={15} aria-hidden />,
                  etiqueta: "Otras planillas",
                  conteo: f.otras.length,
                  contenido: <PestanaOtras f={f} />,
                },
              ]
            : []),
  ];
}

/**
 * Su último mes con sueldo. Un mes en que la entidad puso todo fuera del sueldo (en «otros beneficios»: una liquidación, o el
 * pago anotado en otra columna) no trae sueldo: su total no se llama sueldo (la ficha del MIDIS decía «sueldo del último mes
 * S/ 21,544» y, debajo, «Sueldo de set. 2026: Sin dato»).
 */
function ultimoSueldo(f: FichaPlanilla): { mes: string; base: number } | null {
  for (let i = f.historia.length - 1; i >= 0; i--) {
    const h = f.historia[i];
    if (h.base != null && h.base > 0) return { mes: h.mes, base: h.base };
  }
  return null;
}

const SIN_SUELDO_ESE_MES = "No figura: ese mes todo vino fuera del sueldo";

export function indicadores(f: FichaPlanilla, s: { nSenales: number; altas: number; locador: FichaPersona | null }, ruta: string): Indicador[] {
  const p = f.persona;
  const ultimo = mes(p.ultimoMes);
  const sueldo = p.base == null ? ultimoSueldo(f) : null;
  const items: Indicador[] = [
    p.base != null
      ? {
          valor: soles(p.base),
          etiqueta: "sueldo del último mes",
          contexto: [ultimo, p.total != null && p.total > p.base ? `${soles(p.total)} con todo` : null].filter(Boolean).join(", ") || undefined,
        }
      : sueldo
        ? { valor: soles(sueldo.base), etiqueta: "su último sueldo", contexto: `${mes(sueldo.mes) ?? sueldo.mes}; en ${ultimo ?? "su último mes"} no figura sueldo` }
        : { valor: p.total != null ? soles(p.total) : null, etiqueta: "cobró el último mes", contexto: ultimo ?? undefined },
    { valor: numero(p.meses), etiqueta: p.meses === 1 ? "mes en planilla" : "meses en planilla", contexto: periodoMeses(p.primerMes, p.ultimoMes) ?? undefined },
    {
      valor: numero(s.nSenales),
      etiqueta: s.nSenales === 1 ? "señal" : "señales",
      contexto: s.altas > 0 ? plural(s.altas, "alta", "altas") : s.nSenales ? "ninguna alta" : "ningún otro registro coincide",
      tono: s.altas > 0 ? "alta" : "neutro",
      href: `${ruta}?seccion=senales`,
    },
  ];
  // Si también es locador: lo que cobró por órdenes (no un «Sí» del tamaño de un número), y la pestaña con cada una.
  if (p.codigo) {
    const l = s.locador?.persona;
    items.push({
      valor: l ? solesCompacto(l.monto) : null,
      etiqueta: "cobrados por órdenes de servicio",
      contexto: l ? `en ${plural(l.ordenes, "orden", "órdenes")} de ${plural(l.entidades, "entidad", "entidades")}` : "no pudimos leer sus órdenes ahora",
      href: `${ruta}?seccion=ordenes`,
    });
  }
  return items;
}

// ─── Resumen ──────────────────────────────────────────────────────────────────────────────────────

/**
 * Tres tarjetas con título en vez de «Sus datos», 12 filas planas que repetían el encabezado, las cifras y la pestaña
 * Sueldo (revisión de diseño del 2026-10-29). Sin cabecera de pestaña: como en el Inicio de una entidad, las tarjetas son
 * sus secciones (h2). Escritorio: señales y dónde trabaja a la izquierda; lo que cobró (la más alta, por su gráfico) a la
 * derecha, a lo alto de las dos, para que las columnas terminen parejas. La segunda fila es `1fr` para que esa tarjeta no
 * estire la primera (abriría un hueco entre las señales y dónde trabaja). Celular: señales, lo que cobró, dónde trabaja.
 */
function Resumen({
  f,
  entidad,
  parientes,
  nSenales,
  locador,
  mesesOrden,
  montoOrden,
}: {
  f: FichaPlanilla;
  entidad: string;
  parientes: ParienteProveedor[];
  nSenales: number;
  locador: FichaPersona | null;
  mesesOrden: string[];
  montoOrden: number | null;
}) {
  const p = f.persona;
  const periodo = periodoMeses(p.primerMes, p.ultimoMes);
  const sueldo = p.base == null ? ultimoSueldo(f) : null;
  const l = locador?.persona;
  // Como arriba: con la evidencia rica de los parientes, la señal simple «pariente_locador» no se repite.
  const senalesPlanilla = parientes.length ? p.senales.filter((s) => s.tipo !== "pariente_locador") : p.senales;
  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:grid-rows-[auto_1fr] lg:items-start">
      <TarjetaResumen
        id="sus-senales"
        titulo="Sus señales"
        cuenta={nSenales}
        accion={nSenales > 0 ? <IrAPestana clave="senales">Ver cada una con su evidencia</IrAPestana> : undefined}
        className="lg:col-start-1 lg:row-start-1"
      >
        {nSenales ? (
          <SenalesPlanillaBreves senales={senalesPlanilla} nepotismo={parientes} />
        ) : (
          // Un resultado, no un vacío: el check y el verde de «sin señales» (SinSenalesEstado), sin su caja.
          <p className="flex items-start gap-2 text-dato text-inkSoft">
            <CircleCheck size={16} className="mt-0.5 shrink-0 text-mossTexto" aria-hidden />
            <span>Ningún otro registro público coincide con esta persona en {entidad}.</span>
          </p>
        )}
      </TarjetaResumen>
      {/* Lo esencial del dinero y su línea mes a mes: la misma de la pestaña Sueldo, que además trae el total del mes y
          la explicación del gráfico. */}
      <TarjetaResumen
        id="lo-que-cobro"
        titulo="Lo que cobró"
        accion={<IrAPestana clave="sueldo">Ver su sueldo en detalle</IrAPestana>}
        className="lg:col-start-2 lg:row-start-1 lg:row-end-3"
      >
        <DatosClave
          items={[
            { etiqueta: `Sueldo de ${mes(p.ultimoMes) ?? "su último mes"}`, valor: p.base != null ? soles(p.base) : SIN_SUELDO_ESE_MES, mono: p.base != null },
            // Junto al sueldo de ese mes: un mes en que todo vino fuera del sueldo se entiende de una vez.
            ...(p.extra ? [{ etiqueta: "Fuera del sueldo ese mes", valor: `${soles(p.extra)} (otros beneficios, gratificación, incentivo)` }] : []),
            ...(sueldo ? [{ etiqueta: "Su último sueldo", valor: `${soles(sueldo.base)} (${mes(sueldo.mes) ?? sueldo.mes})` }] : []),
            {
              etiqueta: "Órdenes de servicio",
              valor: p.codigo ? (
                <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span>{l ? `${soles(l.monto)} en ${plural(l.ordenes, "orden", "órdenes")}` : "También recibe órdenes"}</span>
                  <IrAPestana clave="ordenes">Ver sus órdenes</IrAPestana>
                </span>
              ) : (
                "No figura con órdenes de esta entidad a su nombre"
              ),
              ayuda: <AyudaTermino clave="orden-servicio" />,
            },
          ]}
        />
        {/* Con un solo mes no hay línea: las filas de arriba ya lo dicen. */}
        {f.historia.length > 1 && (
          <div className="border-t border-line/70 pt-3">
            <LineaSueldo f={f} mesesOrden={mesesOrden} montoOrden={montoOrden} />
          </div>
        )}
      </TarjetaResumen>
      {/* Sin la entidad ni el cargo: ya están bajo su nombre, en el encabezado. */}
      <TarjetaResumen id="donde-trabaja" titulo="Dónde trabaja" className="lg:col-start-1 lg:row-start-2">
        <DatosClave
          items={[
            { etiqueta: "Oficina", valor: p.dependencia ? tituloNatural(p.dependencia) : null },
            { etiqueta: "Región", valor: p.depNombre },
            { etiqueta: "Régimen", valor: p.regimen != null ? REGIMEN[p.regimen] ?? `Régimen ${p.regimen}` : null, ayuda: <AyudaTermino clave="regimen" /> },
            { etiqueta: "En la planilla", valor: `${plural(p.meses, "mes", "meses")}${periodo ? `, ${periodo}` : ""}` },
            ...(f.otras.length > 0
              ? [
                  {
                    etiqueta: "Otras planillas",
                    valor: (
                      <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span>
                          {f.otras[0].entidad ? tituloNatural(f.otras[0].entidad) : f.otras[0].entidadRuc}
                          {f.otras.length > 1 ? ` y ${plural(f.otras.length - 1, "entidad más", "entidades más")}` : ""}
                        </span>
                        <IrAPestana clave="otras">Ver</IrAPestana>
                      </span>
                    ),
                  },
                ]
              : []),
          ]}
        />
        {/* La página de personal de su entidad en el portal, por su id (sin él, la portada del portal). */}
        <FuenteDato fuente="Portal de Transparencia Estándar de la entidad, rubro Personal" href={personalPte(p.idPte)} className="pt-1" />
      </TarjetaResumen>
    </div>
  );
}

/** Una tarjeta del Resumen: su título (h2) con su conteo y, a la derecha, el atajo a la pestaña con el detalle. */
function TarjetaResumen({
  id,
  titulo,
  cuenta,
  accion,
  className,
  children,
}: {
  id: string;
  titulo: string;
  cuenta?: number;
  accion?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`tarjeta min-w-0 space-y-2 rounded-2xl border border-line bg-paper p-4 sm:p-5${className ? ` ${className}` : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="inline-flex items-center gap-2 font-display text-bloque font-bold text-ink">
          {titulo}
          {cuenta ? <CuentaGrupo>{numero(cuenta)}</CuentaGrupo> : null}
        </h2>
        {accion}
      </div>
      {children}
    </section>
  );
}

/** Su sueldo mes a mes, con un rombo en los meses en que además cobró por órdenes: el mismo en el Resumen y en Sueldo. */
function LineaSueldo({ f, mesesOrden, montoOrden }: { f: FichaPlanilla; mesesOrden: string[]; montoOrden: number | null }) {
  return (
    <LineaMeses
      puntos={f.historia.map((h) => ({ mes: h.mes, base: h.base, extra: h.extra, dudoso: h.dudoso }))}
      etiqueta={`Sueldo mes a mes de ${f.persona.nombre}`}
      ordenes={mesesOrden.length ? { meses: mesesOrden, monto: montoOrden } : undefined}
    />
  );
}

// ─── Sueldo ───────────────────────────────────────────────────────────────────────────────────────

/** Lo que cobró de la planilla cada mes publicado: la línea (con los meses en que además cobró por órdenes) y su tabla. */
export function PestanaSueldo({ f, entidad, mesesOrden, montoOrden }: { f: FichaPlanilla; entidad: string; mesesOrden: string[]; montoOrden: number | null }) {
  const p = f.persona;
  const sueldo = p.base == null ? ultimoSueldo(f) : null;
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué muestra el sueldo mes a mes?">
            Lo que cobró de la planilla cada mes que la entidad la publicó: el sueldo, y aparte lo de fuera del sueldo
            (gratificación, otros beneficios, incentivo). Un mes que se dispara frente a los demás suele ser un pago acumulado o
            un error de carga.{mesesOrden.length ? " El rombo marca los meses en que además cobró por órdenes de servicio." : ""}
          </Ayuda>
        }
      >
        Lo que cobró de la planilla de {entidad} cada mes que la entidad la publicó.
      </CabeceraPestana>
      <section aria-label={`Sueldo de ${mes(p.ultimoMes) ?? "su último mes"}`} className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
        <DatosClave
          items={[
            { etiqueta: `Sueldo de ${mes(p.ultimoMes) ?? "su último mes"}`, valor: p.base != null ? soles(p.base) : SIN_SUELDO_ESE_MES, mono: p.base != null },
            ...(sueldo ? [{ etiqueta: "Su último sueldo", valor: `${soles(sueldo.base)} (${mes(sueldo.mes) ?? sueldo.mes})` }] : []),
            { etiqueta: "Total cobrado ese mes", valor: p.total != null ? soles(p.total) : null, mono: true },
            ...(p.extra ? [{ etiqueta: "Fuera del sueldo", valor: `${soles(p.extra)} (otros beneficios, gratificación, incentivo)` }] : []),
            { etiqueta: "Meses en la planilla", valor: `${plural(p.meses, "mes", "meses")}${periodoMeses(p.primerMes, p.ultimoMes) ? `, ${periodoMeses(p.primerMes, p.ultimoMes)}` : ""}` },
          ]}
        />
      </section>
      <section aria-label={`Sueldo mes a mes de ${p.nombre}`} className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">
        {f.historia.length > 1 ? (
          <LineaSueldo f={f} mesesOrden={mesesOrden} montoOrden={montoOrden} />
        ) : (
          <p className="text-dato text-inkSoft">
            {f.historia[0]
              ? `Un solo mes cargado: en ${mes(f.historia[0].mes) ?? f.historia[0].mes} cobró ${soles(f.historia[0].total)}. Con más meses publicados se verá su línea de tiempo.`
              : "Todavía no hay meses cargados de su planilla."}
          </p>
        )}
      </section>
      <FuenteDato fuente="Portal de Transparencia Estándar de la entidad, rubro Personal" href={personalPte(p.idPte)} />
    </div>
  );
}

// ─── Otras planillas ──────────────────────────────────────────────────────────────────────────────

/** La misma persona (mismo nombre completo) en la planilla de otras entidades. */
function PestanaOtras({ f }: { f: FichaPlanilla }) {
  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Es la misma persona?">
            Con los dos apellidos y los nombres iguales casi siempre es la misma persona, pero la planilla no trae DNI: puede ser
            alguien con el mismo nombre completo.
          </Ayuda>
        }
      >
        {f.otras.length === 1
          ? "Figura también, con el mismo nombre completo, en la planilla de otra entidad."
          : `Figura también, con el mismo nombre completo, en la planilla de ${numero(f.otras.length)} entidades más.`}
      </CabeceraPestana>
      <TablaPaginada
        columnas={COLUMNAS_OTRAS}
        filas={filasOtras(f)}
        etiqueta="La misma persona en otras planillas"
        nombre="planillas"
        buscar={{ placeholder: "Buscar por entidad o cargo…", etiqueta: "Buscar en sus otras planillas" }}
      />
      {/* Cada ficha lleva a la página de personal de su entidad; aquí, el portal. */}
      <FuenteDato fuente="Portal de Transparencia Estándar, personal de cada entidad" href={PORTAL_TRANSPARENCIA} />
    </div>
  );
}

const COLUMNAS_OTRAS: Columna[] = [
  { clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1.4fr)" },
  { clave: "regimen", titulo: "Régimen", ancho: "130px", desde: "lg" },
  { clave: "sueldo", titulo: "Sueldo", ancho: "110px", alinear: "der" },
];

function filasOtras(f: FichaPlanilla): Fila[] {
  return f.otras.map((o, i) => ({
    id: `${o.entidadRuc}-${i}`,
    href: o.ficha ? rutaPlanilla(o.ficha) : `/entidad/${o.entidadRuc}?seccion=planilla`,
    buscable: [o.entidad, o.cargo].filter(Boolean).join(" "),
    celdas: {
      entidad: (
        <CeldaPrincipal
          titulo={o.entidad ? tituloNatural(o.entidad) : o.entidadRuc}
          meta={[
            o.cargo && <Dato key="cargo" tipo="cargo">{tituloNatural(o.cargo)}</Dato>,
            o.ultimoMes && <Dato key="mes" tipo="fecha" nombre="Último mes">{mes(o.ultimoMes) ?? o.ultimoMes}</Dato>,
          ]}
        />
      ),
      regimen: <span className="text-meta text-inkSoft">{o.regimen != null ? REGIMEN[o.regimen] ?? `Régimen ${o.regimen}` : "Sin dato"}</span>,
      // Sueldo 0 es un mes sin ningún pago (el total también es 0): «S/ 0» se leía como que trabaja gratis.
      sueldo: <CeldaNumero>{o.base == null ? "Sin dato" : o.base === 0 ? "Sin pago ese mes" : soles(o.base)}</CeldaNumero>,
    },
  }));
}

export function NoSePudoLeer({ codigo }: { codigo: string }) {
  return (
    <FichaNoLeida
      migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas contratadas", href: "/app/personas" }, { etiqueta: "Planilla", href: "/app/personas?seccion=planilla" }]}
      titulo="Persona en planilla"
      error="No pudimos leer esta ficha"
      reintentar={{ href: rutaPlanilla(codigo) }}
    >
      Puede que el código no exista o que el servidor no respondiera. No mostramos nada en su lugar.
    </FichaNoLeida>
  );
}
