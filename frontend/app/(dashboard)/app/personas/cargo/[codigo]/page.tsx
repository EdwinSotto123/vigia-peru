import { Children, type ReactElement } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, Building2, CalendarRange, DoorOpen, Flag, Footprints, HeartHandshake, Landmark, Network, Receipt, ScrollText, Wallet } from "lucide-react";
import { Ayuda, BanderasFicha, CabeceraPestana, DatosClave, EncabezadoPagina, EnUnaFrase, EstadoVacio, FichaNoLeida, Migas, Nota, Pagina, Pestanas, type BanderaFicha, FuenteDato } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, CuentaGrupo, Indicadores, Tabla, TablaPaginada, type Columna, type Fila, type GrupoFilas, type Indicador } from "@/components/listado";
import { InformeEnPanel } from "@/components/control/InformeEnPanel";
import { Badge } from "@/components/ui/Badge";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";
import { VentasCompraFamilia } from "@/components/investigar/VentasCompraFamilia";
import { BUSCADOR_CONTRALORIA, CONOSCE_BUSCADOR, DATASET_AUTORIDADES_JNE, DATASET_DJI, DATASET_SANCIONADOS, DATASET_SOCIOS_RNP, PORTAL_TRANSPARENCIA, VISITAS_EN_LINEA } from "@/lib/fuentes";
import { REGLA_AUTORIDAD_EXSOCIO, loQueVendio, ventasFrenteALaSalida } from "@/lib/autoridadExsocio";
import { loQueRecibio, ordenesEnElPuesto, ordenesFueraDelPuesto, papelEnLaEmpresa, periodoDelPuesto, reglaCompraFamilia, tituloCompraFamilia } from "@/lib/comprasFamilia";
import {
  getFichaFuncionario,
  rutaFuncionario,
  totalCruces,
  type CargoDeclarado,
  type CargoEnPlanilla,
  type CobradoEnPlanilla,
  type CrucesDeLaPersona,
  type EmpleoDeclarado,
  type EmpresaDeLaPersona,
  type FichaFuncionario,
  type InformeDeLaPersona,
  type OrdenesDeLaPersona,
  type PlanillaDeLaPersona,
  type VisitaHecha,
  type VisitaRecibida,
} from "@/lib/funcionarios";
import { tituloNatural } from "@/lib/landing";
import { banderasPersona, filtrosOrdenesDeUrl, getFichaPersona, getOrdenesPersona, hayFiltrosOrdenes, rutaPersona, senalesDistintas, type FichaPersona } from "@/lib/personas";
import { REGIMEN, getFichaPlanilla, rutaPlanilla } from "@/lib/planilla";
import { uno } from "@/lib/utils";
import { TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { pestanasContratada } from "@/components/personas/ficha/contratada";
import { PestanaSueldo, SenalesDePlanilla, prepararPlanilla, type PlanillaPreparada } from "@/components/personas/ficha/planilla";
import { PestanaFamilia } from "@/components/personas/ficha/familia";
import { RedPersona } from "@/components/personas/ficha/RedPersona";
import { SuperficiePestana } from "@/components/fichas/SuperficiePestana";
import { redDePersona } from "@/lib/redPersona";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaFuncionario(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, persona con cargo público` : "Persona con cargo público", robots: { index: false } };
}

/**
 * Cada bloque de una pestaña en su tarjeta, con el título adentro (2026-11-23, «secciones que son solo texto sin fondo o
 * forma»): antes «En la planilla del Estado» o «Lo que declaró a la Contraloría» eran un h2 y una línea sueltos sobre el
 * fondo. Es `.tarjeta`: la tabla y los datos clave de adentro van sin su marco.
 */
const BLOQUE = "tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5";

const MESES = ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "set.", "oct.", "nov.", "dic."];
/** «2026-06» → «jun. 2026». */
const mes = (m: string | null | undefined) => (m && /^\d{4}-\d{2}/.test(m) ? `${MESES[Number(m.slice(5, 7)) - 1] ?? ""} ${m.slice(0, 4)}` : null);
const entidadTexto = (n: string | null | undefined) => (n ? tituloNatural(n) : "Entidad sin nombre");
const cargoTexto = (c: string | null | undefined) => (c ? tituloNatural(c) : "Cargo sin detalle");
const esRuc20 = (r: string | null | undefined): r is string => !!r && /^20\d{9}$/.test(r);

function EnlaceEntidad({ ruc, nombre }: { ruc: string | null | undefined; nombre: string | null | undefined }) {
  const texto = entidadTexto(nombre);
  return esRuc20(ruc) ? (
    <Link href={`/entidad/${ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {texto}
    </Link>
  ) : (
    <>{texto}</>
  );
}

/**
 * /app/personas/cargo/[codigo] — el rastro de una persona con cargo público (migraciones 318 y 319): quien presentó una
 * declaración jurada de intereses o está o estuvo en una planilla del Estado. Pedido del dueño del 2026-11-16: «¿por qué
 * no aparece en la BBDD? … no aparece nada de su rastro»; la persona estaba en tres registros y la web no tenía por dónde
 * llegar. Pestañas (?seccion=):
 *   · Lo que pide revisión (sólo si hay): los cruces entre sus registros que la API ya trae hechos.
 *   · Cargos: su planilla (hoy y antes) y cada cargo que declaró a la Contraloría.
 *   · Visitas: a qué entidades fue, cuántas veces y en nombre de quién; cada fila abre su panel.
 *   · Visitas que recibió (migración 335): qué empresas lo visitaron en las entidades en que trabajó y cuáles le ganaron
 *     después a esa entidad; sin quién visitó.
 *   · Empresas: en cuáles es socia o representante (RNP).
 *   · Otros registros: candidaturas (JNE), órdenes como persona natural, informes de control (responsabilidad presunta),
 *     aportes de campaña y cargos de persona expuesta políticamente.
 * El nombre va una sola vez, con el apellido materno tapado. El empate entre registros es por nombre completo y la página
 * lo dice. No se indexa en buscadores.
 *
 * Es la FICHA ÚNICA de la persona (pedido del dueño del 2026-11-17: «para la misma persona se encuentra en diversas
 * fuentes, unifícalo»). Si la API reconoce su ficha de planilla y su ficha de persona contratada (`mismaPersona`,
 * lib/identidadPersona.ts de la API), aquí van también sus pestañas: Sueldo (planilla, `?pl=` elige la entidad), Señales
 * (de su planilla y de sus órdenes), Órdenes, Lo que cobró, Entidades, Procesos y Recorrido (persona contratada). Y la
 * pestaña Familia: lo que obtuvo del Estado cada familiar que declaró (migración 351). Las otras dos direcciones
 * (/app/personas/<código> y /app/personas/planilla/<código>) redirigen aquí.
 */
export default async function FuncionarioPage({ params, searchParams }: { params: { codigo: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const f = await getFichaFuncionario(params.codigo);
  if (!f) {
    if (!/^[0-9a-f]{12}$/.test(params.codigo)) notFound();
    return (
      <FichaNoLeida
        migas={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Personas", href: "/app/personas" }]}
        titulo="Persona con cargo público"
        error="No pudimos leer esta ficha"
        reintentar={{ href: rutaFuncionario(params.codigo) }}
      >
        Puede que el código no exista o que el servidor no respondiera. No mostramos nada en su lugar.
      </FichaNoLeida>
    );
  }
  const ruta = rutaFuncionario(params.codigo);
  const p = f.persona;
  const nCruces = totalCruces(f.cruces);
  const primera = nCruces > 0 ? "revision" : "cargos";
  // Sus otras fichas: la de persona contratada (sus órdenes) y la de planilla (su sueldo). `?pl=` elige la planilla.
  const mp = f.mismaPersona ?? null;
  const codContratada = mp?.fichaContratada?.codigo ?? null;
  const plPedida = uno(searchParams?.pl);
  const fichaPl = mp?.fichasPlanilla.find((x) => x.ficha === plPedida)?.ficha ?? mp?.fichasPlanilla[0]?.ficha ?? null;
  const filtrosOrdenes = filtrosOrdenesDeUrl(searchParams);
  const [contratada, planilla] = await Promise.all([
    codContratada ? getFichaPersona(codContratada) : Promise.resolve(null),
    fichaPl ? getFichaPlanilla(fichaPl) : Promise.resolve(null),
  ]);
  const dPl = planilla ? await prepararPlanilla(planilla, ruta) : null;
  const ordenesP = contratada && codContratada ? getOrdenesPersona(codContratada, { ...filtrosOrdenes, size: TAM_ORDENES }) : null;
  const sentUrl = uno(searchParams?.sent);
  const sent = sentUrl && contratada?.entidades.some((e) => e.entidadRuc === sentUrl) ? sentUrl : undefined;
  const deContratada = contratada && codContratada && ordenesP
    ? pestanasContratada({ f: contratada, codigo: codContratada, ruta, nombre: p.nombre, sent, filtrosOrdenes, ordenesP })
    : [];
  const senalesContratada = deContratada.find((x) => x.clave === "senales");
  const pagosContratada = deContratada.find((x) => x.clave === "pagos");
  const cobrado = f.cobradoPlanilla ?? [];
  const cuentaSenales = contratada ? senalesDistintas(contratada.entidades) : null;
  const nSenales = (cuentaSenales?.total ?? 0) + (dPl?.nSenales ?? 0);
  const seccion = uno(searchParams?.seccion) ?? (contratada && hayFiltrosOrdenes(filtrosOrdenes) ? "ordenes" : primera);
  const otros = f.ordenes.length + f.informes.length + f.aportes.length + f.expuesta.length + (f.candidaturas?.length ?? 0);
  const fam = f.familia ?? null;
  // Su red (lo mismo que las pestañas, en un dibujo): sólo si une algo más que una entidad.
  const red = redDePersona(f, { formato: { nombre: tituloNatural, soles: solesCompacto, mes: (m) => mes(m) ?? m, fecha: fechaConAnio } });
  const conRed = red.nodos.length >= 3;
  // Las banderas de las tres fuentes, una vez cada una: los cruces de su rastro, su familia, sus órdenes y su planilla.
  const vistas = new Set<string>();
  const banderas = [
    ...banderasDe(f, ruta),
    ...(fam && fam.enSuEntidad > 0
      ? [{
          tipo: "nepotismo", severidad: (fam.cercanosEnSuEntidad ?? 0) > 0 ? ("alta" as const) : ("media" as const),
          nombre: "Familiares declarados que obtuvieron algo de su entidad", n: fam.enSuEntidad, href: `${ruta}?seccion=familia`,
          explica: "Un familiar que declaró en su declaración jurada recibió órdenes de su entidad, o es socio o representante de una empresa que le vende",
        }]
      : []),
    ...(cuentaSenales ? banderasPersona(cuentaSenales.lista, `${ruta}?seccion=senales`) : []),
    ...(dPl?.banderas ?? []),
  ].filter((b) => (vistas.has(b.tipo) ? false : (vistas.add(b.tipo), true)));

  const ayuda = (
    <Ayuda titulo="¿Por qué está esta persona aquí?">
      <span className="block">
        Porque tiene o tuvo un cargo público: presentó una declaración jurada de intereses a la Contraloría, o figura en la planilla
        que su entidad publica en el Portal de Transparencia. Vigía no muestra su documento y tapa su apellido materno.
      </span>
      <span className="mt-2 block">
        Los registros no comparten un documento: lo que ves de visitas, empresas y órdenes se juntó por su nombre completo. Un homónimo
        exacto saldría aquí también.{" "}
        <Link href="/privacidad" className="text-granate underline-offset-2 hover:underline">¿Eres tú? Pide una corrección</Link>
      </span>
    </Ayuda>
  );

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Personas", href: "/app/personas" },
          { etiqueta: p.nombre, href: ruta },
        ]}
        pestanas={{ primera, activa: seccion, etiquetas: { revision: "Lo que pide revisión", red: "Red", cargos: "Cargos", sueldo: "Cobros por planilla", senales: "Señales", familia: "Familia", ordenes: "Órdenes", pagos: "Cobros por órdenes", entidades: "Entidades", procesos: "Procesos", recorrido: "Recorrido", visitas: "Visitas", recibidas: "Visitas que recibió", empresas: "Empresas", otros: "Otros registros" } }}
      />
      <EncabezadoPagina
        titulo={p.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Briefcase size={14} className="shrink-0 text-mute" aria-hidden />
              {p.cargo ? cargoTexto(p.cargo) : "Con cargo público"}
            </span>
            {p.entidad && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 size={14} className="shrink-0 text-mute" aria-hidden />
                <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden />
              {deDonde(f)}
              {ayuda}
            </span>
          </span>
        }
        banderas={banderas.length ? <BanderasFicha etiqueta="Lo que pide revisión de esta persona" banderas={banderas} /> : undefined}
      />
      <EnUnaFrase tono={nCruces > 0 ? "media" : "neutro"}>
        {frase(f)}
        {contratada ? (
          <>
            {" "}Recibió <b>{plural(contratada.persona.ordenes, "orden de servicio", "órdenes de servicio")}</b> a su nombre por{" "}
            <b>{solesCompacto(contratada.persona.monto)}</b>.
          </>
        ) : null}
        {fam && fam.enSuEntidad > 0 ? (
          <>
            {" "}<b>{fam.enSuEntidad === 1 ? "Un familiar que declaró obtuvo" : `${numero(fam.enSuEntidad)} familiares que declaró obtuvieron`}</b> órdenes o contratos de
            su propia entidad.
          </>
        ) : null}
      </EnUnaFrase>
      <Indicadores items={cuatroCifras(indicadores(f, ruta), indicadoresDeMas(ruta, contratada, dPl, fam, cobrado), !!dPl || cobrado.length > 0)} />
      {f.sinRespuesta.length > 0 && (
        <Nota>
          No respondieron a tiempo: {f.sinRespuesta.map((x) => x.replace(/_/g, " ")).join(", ")}. Esa parte de la ficha puede estar incompleta: vuelve a
          cargar la página en un momento.
        </Nota>
      )}

      <Pestanas
        fija
        key={`${seccion}|${sent ?? ""}|${fichaPl ?? ""}`}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={[
          ...(nCruces > 0
            ? [
                {
                  clave: "revision",
                  icono: <Flag size={15} aria-hidden />,
                  etiqueta: "Lo que pide revisión",
                  conteo: nCruces,
                  contenido: (
                    <div className="space-y-4">
                      <CabeceraPestana>
                        Coincidencias entre sus registros que conviene mirar. Cada una se armó por su nombre completo: confirma que es la misma persona
                        antes de afirmar nada.
                      </CabeceraPestana>
                      <Cruces cruces={f.cruces} />
                    </div>
                  ),
                },
              ]
            : []),
          {
            clave: "cargos",
            icono: <Landmark size={15} aria-hidden />,
            etiqueta: "Cargos",
            titulo: "Los cargos que tuvo en el Estado",
            conteo: f.planilla.reduce((s, x) => s + Math.max(1, x.cargos?.length ?? 0), 0) + f.cargos.length,
            contenido: (
              <div className="space-y-6">
                <section className={BLOQUE} data-bloque>
                  <CabeceraPestana
                    titulo="En la planilla del Estado"
                    ayuda={
                      <Ayuda titulo="¿De dónde sale la planilla?">
                        <span className="block">
                          Del Portal de Transparencia Estándar: cada entidad publica cada mes a quién le paga, con su cargo y su régimen.
                        </span>
                        <span className="mt-2 block">
                          «Ya no figura» quiere decir que el último archivo de la entidad no trae a la persona. Puede ser que dejó el cargo o que la
                          entidad publicó ese mes incompleto: mira hasta qué mes llega la planilla de la entidad.
                        </span>
                      </Ayuda>
                    }
                  >
                    {f.sinRespuesta.includes("planilla")
                      ? p.planillaHoy
                        ? `Figura hoy en la planilla de ${p.entidad ?? "una entidad"}. El detalle no respondió a tiempo: vuelve a cargar la página en un momento.`
                        : "La planilla no respondió a tiempo: vuelve a cargar la página en un momento."
                      : f.planilla.length
                        ? `En planilla: ${plural(f.planilla.length, "entidad", "entidades")}${p.planillaHoy ? "" : "; hoy no figura en ninguna"}.`
                        : "No figura en ninguna planilla publicada en el Portal de Transparencia."}
                  </CabeceraPestana>
                  {f.planilla.length > 0 && <Tabla columnas={COLUMNAS_PLANILLA} filas={f.planilla.flatMap(filasPlanilla)} etiqueta="Planillas en que figura o figuró" />}
                </section>
                <section className={BLOQUE} data-bloque>
                  <CabeceraPestana
                    titulo="Lo que declaró a la Contraloría"
                    ayuda={
                      <Ayuda titulo="¿Qué es una declaración jurada de intereses?">
                        <span className="block">
                          La que presenta a la Contraloría quien tiene un cargo con poder de decisión: titulares, directivos, quienes contratan,
                          administran fondos o integran comités. Dice en qué entidad y con qué cargo.
                        </span>
                        <span className="mt-2 block">
                          El formulario ofrece pocas categorías: «Colaborador» u «Otro cargo, función o labor» no dicen el puesto. Cuando la
                          misma declaración lo escribe en su sección de empleos, aquí sale ese puesto y debajo la categoría.
                        </span>
                      </Ayuda>
                    }
                  >
                    {f.cargos.length
                      ? `Declaró ${plural(f.cargos.length, "cargo", "cargos")} en ${plural(p.entidades, "entidad", "entidades")}, en ${plural(p.declaraciones, "declaración jurada de intereses", "declaraciones juradas de intereses")}.`
                      : "No presentó declaraciones juradas de intereses a la Contraloría."}
                  </CabeceraPestana>
                  {f.cargos.length > 0 && (
                    <TablaPaginada columnas={COLUMNAS_CARGOS} filas={f.cargos.map(filaCargo)} etiqueta="Cargos declarados a la Contraloría" nombre="cargos" tam={10} />
                  )}
                </section>
                {(f.empleos ?? []).length > 0 && (
                  <section className={BLOQUE} data-bloque>
                    <CabeceraPestana
                      titulo="Los trabajos que declaró"
                      ayuda={
                        <Ayuda titulo="¿De dónde salen estos trabajos?">
                          <span className="block">
                            De la sección de empleos de sus declaraciones juradas de intereses: ahí la persona escribe, con sus palabras, dónde
                            trabaja o trabajó y con qué puesto, en el Estado y fuera de él.
                          </span>
                          <span className="mt-2 block">
                            Un mismo trabajo escrito de varias formas entre una declaración y otra sale una sola vez. Sólo figuran empleadores
                            con RUC de empresa o entidad.
                          </span>
                        </Ayuda>
                      }
                    >
                      {resumenEmpleos(f.empleos ?? [])}
                    </CabeceraPestana>
                    <TablaPaginada columnas={COLUMNAS_EMPLEOS} filas={(f.empleos ?? []).map(filaEmpleo)} etiqueta="Trabajos que declaró" nombre="empleos" tam={10} />
                  </section>
                )}
              </div>
            ),
          },
          ...(conRed
            ? [
                {
                  clave: "red",
                  icono: <Network size={15} aria-hidden />,
                  etiqueta: "Red",
                  titulo: "Con quién y con qué está unida",
                  conteo: red.nodos.length - 1,
                  contenido: (
                    <div className="space-y-4">
                      <CabeceraPestana
                        ayuda={
                          <Ayuda titulo="¿Cómo se arma esta red?">
                            <span className="block">
                              Con lo mismo que las demás pestañas: su planilla y sus declaraciones juradas (dónde trabajó), el registro de visitas,
                              el Registro Nacional de Proveedores (sus empresas y las de su familia), los procesos y órdenes de CONOSCE y los
                              familiares que declaró a la Contraloría, de los que sólo se muestra el parentesco.
                            </span>
                            <span className="mt-2 block">
                              Los registros no comparten un documento: se unieron por su nombre completo. Una línea no prueba nada; dice dónde mirar.
                            </span>
                          </Ayuda>
                        }
                      >
                        Las entidades en que trabajó o que visitó, sus empresas y a quién le vendieron, y lo que su familia declarada obtuvo del
                        Estado. Lo marcado en rojo o ámbar es lo que pide revisión.
                      </CabeceraPestana>
                      <RedPersona red={red} />
                    </div>
                  ),
                },
              ]
            : []),
          // Lo que cobró del Estado, cada vía en su pestaña (usuario, 2026-11-17): por planilla, como trabajador de la entidad;
          // y por órdenes de servicio, como proveedor persona natural. La de planilla sale aunque ya no figure en ninguna.
          ...((planilla && dPl) || cobrado.length > 0
            ? [
                {
                  clave: "sueldo",
                  icono: <Wallet size={15} aria-hidden />,
                  etiqueta: "Cobros por planilla",
                  titulo: "Lo que cobró en planilla",
                  contenido: (
                    <div className="space-y-6">
                      <CobradoPlanilla filas={cobrado} ruta={ruta} />
                      {planilla && dPl ? (
                        <section className={BLOQUE} data-bloque>
                          <CabeceraPestana titulo="Mes a mes en su planilla de hoy">
                            El detalle de cada mes publicado en {dPl.entidad}.
                          </CabeceraPestana>
                      {mp && mp.fichasPlanilla.length > 1 ? (
                        <nav aria-label="Sus planillas" className="flex flex-wrap items-center gap-2 text-dato">
                          <span className="text-inkSoft">Está en {plural(mp.fichasPlanilla.length, "planilla", "planillas")}:</span>
                          {mp.fichasPlanilla.map((x) => (
                            <Link
                              key={x.ficha}
                              href={`${ruta}?seccion=sueldo&pl=${x.ficha}`}
                              prefetch={false}
                              aria-current={x.ficha === fichaPl ? "true" : undefined}
                              className={x.ficha === fichaPl ? "pill border-granate/30 bg-granate-soft text-granate" : "pill border-line bg-paperSoft text-ink hover:border-granate/40"}
                            >
                              {entidadTexto(x.entidad)}
                            </Link>
                          ))}
                        </nav>
                      ) : null}
                      <PestanaSueldo f={planilla} entidad={dPl.entidad} mesesOrden={dPl.mesesOrden} montoOrden={dPl.montoOrden} />
                      {(f.cruces.doblePercepcion ?? []).length > 0 ? (
                        <Nota>
                          Además de su sueldo:{" "}
                          {(f.cruces.doblePercepcion ?? []).map((x, i) => (
                            <span key={i}>
                              {i > 0 ? "; " : ""}
                              {plural(x.ordenes, "orden de servicio", "órdenes de servicio")} de {entidadTexto(x.otra)} por {solesCompacto(x.monto_soles)} en{" "}
                              {plural(x.meses, "mes", "meses")} en que estaba en la planilla de {entidadTexto(x.entidad)}
                            </span>
                          ))}
                          . La ley no permite dos ingresos del Estado, salvo la docencia y las dietas; el empate es por nombre completo.
                        </Nota>
                      ) : null}
                        </section>
                      ) : null}
                    </div>
                  ),
                },
              ]
            : []),
          ...(pagosContratada ? [pagosContratada] : []),
          ...(senalesContratada || dPl
            ? [
                {
                  clave: "senales",
                  icono: <Flag size={15} aria-hidden />,
                  etiqueta: "Señales",
                  titulo: senalesContratada ? "Las señales de sus órdenes" : "Las señales de su planilla",
                  conteo: nSenales,
                  contenido: (
                    <div className="space-y-6">
                      {senalesContratada ? <section data-bloque>{senalesContratada.contenido}</section> : null}
                      {dPl ? (
                        <section className={BLOQUE} data-bloque>
                          <CabeceraPestana titulo={senalesContratada ? `En su planilla de ${dPl.entidad}` : undefined}>
                            {dPl.nSenales
                              ? `${plural(dPl.nSenales, "señal", "señales")} en ${dPl.entidad}, de la más grave a la más leve.`
                              : `En ${dPl.entidad}, qué dicen de esta persona otros registros públicos.`}
                          </CabeceraPestana>
                          <SenalesDePlanilla d={dPl} />
                        </section>
                      ) : null}
                    </div>
                  ),
                },
              ]
            : []),
          {
            clave: "familia",
            icono: <HeartHandshake size={15} aria-hidden />,
            etiqueta: "Familia",
            titulo: "Su familia declarada y el Estado",
            conteo: fam ? fam.parientes.length + fam.masParientes : null,
            contenido: <PestanaFamilia familia={fam} />,
          },
          // Lo de su ficha de persona contratada: sus órdenes, lo que cobró, sus entidades, sus procesos y su recorrido.
          ...deContratada.filter((x) => x.clave === "ordenes"),
          ...["entidades", "procesos", "recorrido"].flatMap((k) => deContratada.filter((x) => x.clave === k)),
          {
            clave: "visitas",
            icono: <DoorOpen size={15} aria-hidden />,
            etiqueta: "Visitas",
            titulo: "Las visitas que hizo a entidades del Estado",
            conteo: f.visitas.total,
            contenido: (
              <SuperficiePestana className="space-y-3">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde salen las visitas?">
                      <span className="block">
                        Del registro de visitas que cada entidad publica: quién entró, cuándo, a qué oficina y en nombre de quién. Sólo están las
                        entidades que usan la plataforma de transparencia.
                      </span>
                      <span className="mt-2 block">
                        Cuenta las visitas anotadas con sus dos apellidos y su primer nombre. Una visita no prueba nada: es un dato para leer junto
                        a lo demás.
                      </span>
                    </Ayuda>
                  }
                >
                  {f.visitas.total
                    ? `${plural(f.visitas.total, "visita", "visitas")} a ${plural(f.visitas.entidades, "entidad", "entidades")}${periodo(f.visitas.primera, f.visitas.ultima)}. Cada fila abre su detalle.`
                    : "No figura como visitante en el registro de visitas de ninguna entidad."}
                </CabeceraPestana>
                {f.visitas.filas.length > 0 ? (
                  <TablaPaginada
                    columnas={COLUMNAS_VISITAS}
                    filas={f.visitas.filas.map(filaVisita)}
                    etiqueta="Entidades que visitó"
                    nombre="entidades"
                    tam={10}
                    buscar={{ placeholder: "Buscar por entidad u organización…", etiqueta: "Buscar en las entidades que visitó" }}
                  />
                ) : null}
              </SuperficiePestana>
            ),
          },
          {
            clave: "recibidas",
            icono: <Footprints size={15} aria-hidden />,
            etiqueta: "Visitas que recibió",
            titulo: "Las empresas cuya gente la visitó",
            conteo: f.recibidas?.empresas ?? 0,
            contenido: <VisitasRecibidas r={f.recibidas} />,
          },
          {
            clave: "empresas",
            icono: <Briefcase size={15} aria-hidden />,
            etiqueta: "Empresas",
            titulo: "Las empresas en que es socia o representante",
            conteo: f.empresas.length,
            contenido: (
              <SuperficiePestana className="space-y-3">
                <CabeceraPestana
                  ayuda={
                    <Ayuda titulo="¿De dónde salen?">
                      <span className="block">
                        Del Registro Nacional de Proveedores: los socios, representantes y directivos de las empresas que le venden al Estado. Una
                        empresa que nunca se inscribió para venderle al Estado no aparece.
                      </span>
                    </Ayuda>
                  }
                >
                  {f.empresas.length
                    ? `Figura en ${plural(f.empresas.length, "empresa", "empresas")} del Registro Nacional de Proveedores.`
                    : "No figura como socia, representante ni directiva de ninguna empresa del Registro Nacional de Proveedores."}
                </CabeceraPestana>
                {f.empresas.length > 0 && <Tabla columnas={COLUMNAS_EMPRESAS} filas={f.empresas.map(filaEmpresa)} etiqueta="Empresas de la persona" />}
              </SuperficiePestana>
            ),
          },
          {
            clave: "otros",
            icono: <ScrollText size={15} aria-hidden />,
            etiqueta: "Otros registros",
            titulo: "Política, órdenes e informes de control",
            conteo: otros,
            contenido: <OtrosRegistros f={f} />,
          },
        ]}
      />

      <Nota>
        {f.parecidos > 0
          ? `Hay ${plural(f.parecidos, "persona más", "personas más")} con cargo público que se ${f.parecidos === 1 ? "ve" : "ven"} igual (el mismo apellido paterno y los mismos nombres): ${f.parecidos === 1 ? "es otra ficha" : "son otras fichas"}. `
          : ""}
        Los registros no comparten un documento: las visitas, las empresas, las órdenes y los informes se juntaron por nombre completo. Antes de
        afirmar algo, confirma que es la misma persona.
        {mp?.fichaContratada?.via === "planilla" ? " Sus órdenes se unieron a esta ficha porque la planilla de su entidad trae el mismo nombre completo que quien las recibe." : ""}
        {mp?.fichaContratada?.via === "nombre" ? " Sus órdenes se unieron a esta ficha porque una sola persona de todo el registro de órdenes lleva su nombre completo." : ""}
        {mp && !mp.fichaContratada && mp.homonimos > 1 ? ` Hay ${numero(mp.homonimos)} personas con órdenes y este mismo nombre completo: no se unió ninguna (están en Otros registros).` : ""}
        {/* Las fichas de antes, dentro de la nota (antes una línea gris suelta al pie de la página). */}
        {contratada || planilla ? (
          <span className="mt-1.5 block">
            Esta ficha reúne lo que antes estaba en fichas separadas.{" "}
            {codContratada ? <Link href={`${rutaPersona(codContratada)}?directo=1`} prefetch={false} className="font-medium text-granate underline underline-offset-2">Ver sólo su ficha de persona contratada</Link> : null}
            {codContratada && fichaPl ? ", " : ""}
            {fichaPl ? <Link href={`${rutaPlanilla(fichaPl)}?directo=1`} prefetch={false} className="font-medium text-granate underline underline-offset-2">ver sólo su ficha de planilla</Link> : null}
            .
          </span>
        ) : null}
      </Nota>
    </Pagina>
  );
}

// ─── Cabecera ────────────────────────────────────────────────────────────────────────────────────

const periodo = (a: string | null, b: string | null) => {
  if (!a || !b) return "";
  return a === b ? `, el ${fechaConAnio(a)}` : `, del ${fechaConAnio(a)} al ${fechaConAnio(b)}`;
};

/** De qué registros sale la persona, en una línea. */
function deDonde(f: FichaFuncionario): string {
  const p = f.persona;
  const partes = [
    p.planillaEntidades > 0 ? (p.planillaHoy ? "En planilla hoy" : `En planilla hasta ${mes(p.planillaHasta) ?? "una fecha sin dato"}`) : null,
    p.declaraciones > 0 ? plural(p.declaraciones, "declaración jurada", "declaraciones juradas") : null,
  ].filter(Boolean) as string[];
  return partes.join(", ") || "Con cargo público";
}

function frase(f: FichaFuncionario) {
  const p = f.persona;
  const enPlanilla = f.planilla[0];
  return (
    <>
      {enPlanilla ? (
        <>
          {enPlanilla.situacion === "hoy" ? "Figura" : "Figuró"} en la planilla de <b>{entidadTexto(enPlanilla.entidad)}</b>
          {enPlanilla.cargo ? <> como <b>{cargoTexto(enPlanilla.cargo)}</b></> : ""}
          {enPlanilla.situacion === "antes" && enPlanilla.ultimoMes ? ` hasta ${mes(enPlanilla.ultimoMes)}` : ""}.{" "}
        </>
      ) : null}
      {p.declaraciones > 0 ? (
        <>
          Presentó <b>{plural(p.declaraciones, "declaración jurada de intereses", "declaraciones juradas de intereses")}</b> en {plural(p.entidades, "entidad", "entidades")}.{" "}
        </>
      ) : null}
      {f.visitas.total > 0 ? (
        <>
          Hizo <b>{plural(f.visitas.total, "visita", "visitas")}</b> a {plural(f.visitas.entidades, "entidad", "entidades")}.{" "}
        </>
      ) : (
        "No figura como visitante de ninguna entidad. "
      )}
      {f.empresas.length > 0 ? (
        <>
          Figura en <b>{plural(f.empresas.length, "empresa", "empresas")}</b> que le {f.empresas.length === 1 ? "vende" : "venden"} al Estado.
        </>
      ) : (
        "No figura en empresas que le vendan al Estado."
      )}
    </>
  );
}

function indicadores(f: FichaFuncionario, ruta: string): Indicador[] {
  const p = f.persona;
  return [
    {
      valor: numero(f.planilla.length),
      etiqueta: f.planilla.length === 1 ? "planilla" : "planillas",
      contexto: p.planillaHoy ? "figura hoy en una" : p.planillaHasta ? `la última, hasta ${mes(p.planillaHasta)}` : "no figura en ninguna",
      icono: <Wallet size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=cargos`,
    },
    {
      valor: numero(p.declaraciones),
      etiqueta: "declaraciones juradas",
      contexto: p.declaraciones ? `en ${plural(p.entidades, "entidad", "entidades")}` : "no presentó ninguna",
      icono: <Landmark size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=cargos`,
    },
    {
      valor: numero(f.visitas.total),
      etiqueta: "visitas que hizo",
      contexto: f.visitas.total ? `a ${plural(f.visitas.entidades, "entidad", "entidades")}` : "no figura como visitante",
      icono: <DoorOpen size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=visitas`,
    },
    {
      valor: numero(f.empresas.length),
      etiqueta: f.empresas.length === 1 ? "empresa" : "empresas",
      contexto: "como socia o representante (RNP)",
      icono: <Briefcase size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=empresas`,
    },
  ];
}

/** Lo que suman sus otras fichas a las cifras de la cabecera: lo que cobró por órdenes, su sueldo y su familia. */
function indicadoresDeMas(
  ruta: string,
  contratada: FichaPersona | null,
  dPl: PlanillaPreparada | null,
  fam: FichaFuncionario["familia"],
  cobrado: CobradoEnPlanilla[],
): Indicador[] {
  const items: Indicador[] = [];
  // Lo que cobró en planilla en los meses publicados: la cifra que faltaba junto a lo cobrado por órdenes.
  const enPlanilla = cobrado.reduce((t, x) => t + x.total, 0);
  if (enPlanilla > 0) {
    const meses = cobrado.reduce((t, x) => t + x.meses, 0);
    items.push({
      valor: solesCompacto(enPlanilla),
      etiqueta: "cobrados en planilla",
      contexto: `en ${plural(meses, "mes publicado", "meses publicados")}`,
      icono: <Wallet size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=sueldo`,
    });
  }
  if (dPl && dPl.p.base != null) {
    items.push({
      valor: solesCompacto(dPl.p.base),
      etiqueta: "sueldo del último mes",
      contexto: `en ${dPl.entidad}`,
      icono: <Wallet size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=sueldo`,
    });
  }
  if (contratada) {
    items.push({
      valor: solesCompacto(contratada.persona.monto),
      etiqueta: "cobrados por órdenes a su nombre",
      contexto: `${plural(contratada.persona.ordenes, "orden", "órdenes")} de ${plural(contratada.persona.entidades, "entidad", "entidades")}`,
      icono: <Receipt size={15} strokeWidth={1.9} aria-hidden />,
      href: `${ruta}?seccion=ordenes`,
    });
  }
  if (fam) {
    items.push({
      valor: numero(fam.declarados),
      etiqueta: fam.declarados === 1 ? "familiar declarado" : "familiares declarados",
      contexto: fam.enSuEntidad ? `${fam.enSuEntidad === 1 ? "uno obtuvo" : `${numero(fam.enSuEntidad)} obtuvieron`} algo de su entidad` : "ninguno con órdenes de su entidad",
      icono: <HeartHandshake size={15} strokeWidth={1.9} aria-hidden />,
      tono: (fam.cercanosEnSuEntidad ?? 0) > 0 ? "alta" : fam.enSuEntidad ? "media" : "neutro",
      href: `${ruta}?seccion=familia`,
    });
  }
  return items;
}

/**
 * La cabecera lleva cuatro cifras (DESIGN_SYSTEM §14.1): las de sus otras fichas primero (su sueldo, lo que cobró por
 * órdenes, su familia) y después las de su rastro que dicen algo; las que valen cero, sólo si queda sitio. Con sueldo, la
 * cuenta de planillas sobra.
 */
function cuatroCifras(base: Indicador[], mas: Indicador[], conSueldo: boolean): Indicador[] {
  const propias = conSueldo ? base.slice(1) : base;
  const todas = [...mas, ...propias];
  const dice = (x: Indicador) => x.valor != null && x.valor !== "0";
  return [...todas.filter(dice), ...todas.filter((x) => !dice(x))].slice(0, 4);
}

/** Los cruces como banderas fijas bajo el nombre: cada una lleva a «Lo que pide revisión». */
function banderasDe(f: FichaFuncionario, ruta: string): BanderaFicha[] {
  const c = f.cruces;
  const href = `${ruta}?seccion=revision`;
  const b: BanderaFicha[] = [];
  if (c.visitoYSuEmpresaGano.length) {
    b.push({ tipo: "visito_y_gano", severidad: c.visitoYSuEmpresaGano.some((x) => x.visito_antes_de_ganar) ? "alta" : "media", nombre: "Visitó una entidad y una empresa suya le ganó", n: c.visitoYSuEmpresaGano.length, href });
  }
  if (c.salioYSuEmpresaGano.length) b.push({ tipo: "puerta_giratoria", severidad: "alta", nombre: "Dejó una entidad y una empresa suya le ganó después", n: c.salioYSuEmpresaGano.length, href });
  if (c.empresaInhabilitadaYOtraGano.length) b.push({ tipo: "inhabilitada", severidad: "alta", nombre: "Una empresa suya está inhabilitada y otra ganó", n: c.empresaInhabilitadaYOtraGano.length, href });
  if (c.variasEmpresasEnUnaEntidad.length) b.push({ tipo: "varias_empresas", severidad: "media", nombre: "Gana en una entidad con varias empresas", n: c.variasEmpresasEnUnaEntidad.length, href });
  if (c.enInformeYDespuesCobro.length) b.push({ tipo: "informe_y_cobro", severidad: "media", nombre: "Figura en un informe de control y la entidad le pagó después", n: c.enInformeYDespuesCobro.length, href });
  const dobles = (c.doblePercepcion ?? []).filter((x) => x.severidad === "media");
  if (dobles.length) {
    b.push({
      tipo: "doble_percepcion", severidad: "media", nombre: "Cobra del Estado por dos lados", n: dobles.length, href,
      explica: "Está en la planilla de una entidad y, esos mismos meses, otra entidad le emitió órdenes de servicio",
    });
  }
  // Migración 364: en observación. Su puesto declarado es de compras (o decide el gasto) y un familiar cobra de su entidad.
  const compras = (c.comprasFamiliar ?? []).filter((x) => x.severidad !== "baja");
  if (compras.length) {
    b.push({
      tipo: "compras_familiar", severidad: compras.some((x) => x.severidad === "alta") ? "alta" : "media", observacion: true, n: compras.length, href,
      // El caso más grave da el nombre (vienen ordenados): a nombre del familiar o con su empresa.
      nombre: tituloCompraFamilia(compras[0]),
      explica: "Su puesto y el familiar salen de su propia declaración jurada; las órdenes, del registro de la entidad; la empresa del familiar, del Registro Nacional de Proveedores",
    });
  }
  // Migración 367: en observación. Es una autoridad electa que dejó de figurar en una empresa que le vendió a su entidad.
  const exAutoridad = c.exAutoridad ?? [];
  if (exAutoridad.length) {
    b.push({
      tipo: "autoridad_exsocio", severidad: exAutoridad.some((x) => x.severidad === "alta") ? "alta" : "media", observacion: true, n: exAutoridad.length, href,
      nombre: "En observación: dejó de figurar en una empresa que le vendió a su entidad",
      explica: "Su cargo electo sale del Jurado Nacional de Elecciones; su salida de la empresa, del Registro Nacional de Proveedores; las ventas, del registro de la entidad",
    });
  }
  // Migración 335: en observación, porque el empate del funcionario visitado es por nombre y todavía no se mide.
  if (f.recibidas?.ganaronDespues) {
    b.push({
      tipo: "visitado_y_gano", severidad: "media", observacion: true, n: f.recibidas.ganaronDespues, href: `${ruta}?seccion=recibidas`,
      nombre: "En observación: recibió visitas de empresas que después le ganaron a su entidad",
    });
  }
  return b;
}

// ─── Lo que pide revisión ────────────────────────────────────────────────────────────────────────

function EnlaceEmpresa({ ruc, nombre }: { ruc: string | null | undefined; nombre: string | null | undefined }) {
  const texto = nombre ? tituloNatural(nombre) : "Empresa sin nombre";
  return esRuc20(ruc) ? (
    <Link href={`/empresa/${ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {texto}
    </Link>
  ) : (
    <>{texto}</>
  );
}

type TonoCaso = "alta" | "media" | "baja";
interface FuenteCaso {
  fuente: string;
  href: string;
  enlaces: { texto: string; href: string }[];
}
const EN_RNP = { texto: "Conformación jurídica de proveedores (RNP, datos abiertos)", href: DATASET_SOCIOS_RNP };
const EN_CONOSCE = { texto: "Órdenes y procesos en CONOSCE (OECE)", href: CONOSCE_BUSCADOR };
/** De dónde sale cada conclusión de «Lo que pide revisión»: ninguna va sin su fuente (pedido del 2026-11-18). */
const FUENTE_CASO: Record<"visitas" | "planilla" | "inhabilitada" | "dueno" | "doble" | "compras" | "autoridad" | "control", FuenteCaso> = {
  visitas: { fuente: "Registro de visitas en línea, Registro Nacional de Proveedores y procesos de CONOSCE (OECE)", href: VISITAS_EN_LINEA, enlaces: [EN_RNP, EN_CONOSCE] },
  planilla: { fuente: "Portal de Transparencia Estándar (planilla), Registro Nacional de Proveedores y procesos de CONOSCE (OECE)", href: PORTAL_TRANSPARENCIA, enlaces: [EN_RNP, EN_CONOSCE] },
  inhabilitada: { fuente: "Tribunal de Contrataciones (proveedores sancionados), Registro Nacional de Proveedores y procesos de CONOSCE (OECE)", href: DATASET_SANCIONADOS, enlaces: [EN_RNP, EN_CONOSCE] },
  dueno: { fuente: "Registro Nacional de Proveedores y procesos de CONOSCE (OECE)", href: DATASET_SOCIOS_RNP, enlaces: [EN_CONOSCE] },
  doble: { fuente: "Portal de Transparencia Estándar (planilla) y órdenes de servicio de CONOSCE (OECE)", href: PORTAL_TRANSPARENCIA, enlaces: [EN_CONOSCE] },
  compras: { fuente: "Contraloría (declaraciones juradas de intereses), Registro Nacional de Proveedores y órdenes de CONOSCE (OECE)", href: DATASET_DJI, enlaces: [EN_RNP, EN_CONOSCE] },
  autoridad: { fuente: "Jurado Nacional de Elecciones (autoridades electas), Registro Nacional de Proveedores y órdenes de CONOSCE (OECE)", href: DATASET_AUTORIDADES_JNE, enlaces: [EN_RNP, EN_CONOSCE] },
  control: { fuente: "Contraloría (informes de control) y órdenes de servicio de CONOSCE (OECE)", href: BUSCADOR_CONTRALORIA, enlaces: [EN_CONOSCE] },
};

/**
 * Un caso de «Lo que pide revisión»: qué se encontró, con sus enlaces; `detalle`, la evidencia que se abre debajo (va
 * fuera del párrafo: trae listas y tablas); y, al pie, la fuente de la que sale.
 */
function Caso({ titulo, tono, fuente, detalle, children }: { titulo: string; tono: TonoCaso; fuente?: FuenteCaso; detalle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tono === "alta" ? "crimson" : tono === "media" ? "amber" : "neutral"}>{tono === "alta" ? "Señal alta" : tono === "media" ? "Señal media" : "Para tener en cuenta"}</Badge>
        <h3 className="text-cuerpo font-semibold text-ink">{titulo}</h3>
      </div>
      <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">{children}</p>
      {detalle ? <div className="mt-3">{detalle}</div> : null}
      {fuente ? <FuenteDato className="mt-2.5" fuente={fuente.fuente} href={fuente.href} enlaces={fuente.enlaces} /> : null}
    </li>
  );
}

function Cruces({ cruces: c }: { cruces: CrucesDeLaPersona }) {
  const monto = (m: number | null) => (m != null && m > 0 ? ` por ${solesCompacto(m)}` : "");
  // Todos los casos, y después ordenados: lo grave primero (dentro de cada gravedad, en el orden en que se arman).
  const casos = (
    <>
      {c.visitoYSuEmpresaGano.map((x, i) => (
        <Caso key={`v${i}`} titulo="Visitó la entidad y una empresa suya le ganó" tono={x.visito_antes_de_ganar ? "alta" : "media"} fuente={FUENTE_CASO.visitas}>
          Hizo {plural(x.visitas, "visita", "visitas")} a <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
          {x.primera_visita ? `, la primera el ${fechaConAnio(x.primera_visita)}` : ""}. <EnlaceEmpresa ruc={x.empresa_ruc} nombre={x.empresa} />
          {x.rol_en_la_empresa ? `, donde figura como ${x.rol_en_la_empresa.toLowerCase()},` : ""} le ganó a esa entidad{" "}
          {plural(x.procesos_ganados, "proceso", "procesos")}
          {monto(x.monto_soles)}
          {x.primera_buena_pro && x.ultima_buena_pro ? ` entre el ${fechaConAnio(x.primera_buena_pro)} y el ${fechaConAnio(x.ultima_buena_pro)}` : ""}.
          {x.visito_antes_de_ganar ? " Alguna visita es anterior a una buena pro." : ""}
        </Caso>
      ))}
      {c.salioYSuEmpresaGano.map((x, i) => (
        <Caso key={`s${i}`} titulo="Dejó la entidad y una empresa suya le ganó después" tono="alta" fuente={FUENTE_CASO.planilla}>
          Figuró en la planilla de <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
          {x.cargo_que_tenia ? ` como ${cargoTexto(x.cargo_que_tenia)}` : ""}
          {x.salio_de_planilla ? ` hasta ${mes(x.salio_de_planilla)}` : ""}. Después, <EnlaceEmpresa ruc={x.empresa_ruc} nombre={x.empresa} />
          {x.rol_en_la_empresa ? `, donde figura como ${x.rol_en_la_empresa.toLowerCase()},` : ""} le ganó {plural(x.procesos_ganados_despues, "proceso", "procesos")}
          {monto(x.monto_soles)}
          {x.primera_buena_pro_tras_salir ? `; el primero, el ${fechaConAnio(x.primera_buena_pro_tras_salir)}` : ""}.
        </Caso>
      ))}
      {c.empresaInhabilitadaYOtraGano.map((x, i) => (
        <Caso key={`i${i}`} titulo="Una empresa suya está inhabilitada y otra ganó" tono="alta" fuente={FUENTE_CASO.inhabilitada}>
          <EnlaceEmpresa ruc={x.empresa_inhabilitada_ruc} nombre={x.empresa_inhabilitada} /> tiene una {x.sancion ?? "inhabilitación"}
          {x.sancion_desde ? ` desde el ${fechaConAnio(x.sancion_desde)}` : ""}
          {x.sancion_hasta ? ` hasta el ${fechaConAnio(x.sancion_hasta)}` : ""}. Dentro de esa sanción, <EnlaceEmpresa ruc={x.empresa_que_gano_ruc} nombre={x.empresa_que_gano} /> ganó{" "}
          {plural(x.procesos_ganados_durante_la_sancion, "proceso", "procesos")}
          {monto(x.monto_soles)}. Falta confirmar su porcentaje en las dos empresas y que sean del mismo rubro.
        </Caso>
      ))}
      {c.variasEmpresasEnUnaEntidad.map((x, i) => (
        <Caso key={`e${i}`} titulo="Gana en una entidad con varias empresas" tono={x.con_90_dias_o_menos_entre_si > 0 ? "alta" : "media"} fuente={FUENTE_CASO.dueno}>
          En <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />, {plural((x.empresas ?? []).length, "empresa suya ganó", "empresas suyas ganaron")}{" "}
          {plural(x.contratos_con_objeto_parecido, "contrato", "contratos")} de objeto parecido
          {x.con_90_dias_o_menos_entre_si > 0 ? `, ${numero(x.con_90_dias_o_menos_entre_si)} de ellos a 90 días o menos de otro` : ""}
          {monto(x.monto_soles)}:{" "}
          {(x.empresas ?? []).map((e, k) => (
            <span key={e.ruc}>
              {k > 0 ? ", " : ""}
              <EnlaceEmpresa ruc={e.ruc} nombre={e.nombre} />
            </span>
          ))}
          .
        </Caso>
      ))}
      {(c.doblePercepcion ?? []).map((x, i) => (
        <Caso key={`d${i}`} titulo="Cobra del Estado por dos lados" tono={x.severidad === "media" ? "media" : "baja"} fuente={FUENTE_CASO.doble}>
          Figura en la planilla de <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
          {x.cargo ? ` como ${cargoTexto(x.cargo)}` : ""}
          {x.sueldo ? `, con un sueldo de ${solesCompacto(x.sueldo)} al mes` : ""}. En {plural(x.meses, "mes", "meses")} de esos
          {x.desde && x.hasta ? ` (entre ${mes(x.desde)} y ${mes(x.hasta)})` : ""}, <EnlaceEntidad ruc={x.otra_ruc} nombre={x.otra} /> le emitió{" "}
          {plural(x.ordenes, "orden de servicio", "órdenes de servicio")} por {solesCompacto(x.monto_soles)}.{" "}
          {x.docente
            ? "La docencia es la excepción que la ley permite: por eso no cuenta como señal."
            : "La ley no permite percibir dos ingresos del Estado, salvo la docencia y las dietas (artículo 40 de la Constitución; artículo 3 de la Ley 28175). El empate es por nombre completo: confírmalo."}
        </Caso>
      ))}
      {(c.comprasFamiliar ?? []).map((x, i) => (
        <Caso
          key={`cf${i}`}
          titulo={tituloCompraFamilia(x)}
          tono={x.severidad === "alta" ? "alta" : x.severidad === "media" ? "media" : "baja"}
          fuente={FUENTE_CASO.compras}
          // La evidencia, orden por orden, se pide al abrirla.
          detalle={x.clave ? <VentasCompraFamilia clave={x.clave} entidadRuc={x.entidadRuc} aPedido /> : undefined}
        >
          Declara el puesto de <b>{cargoTexto(x.cargo).toLowerCase()}</b> en <EnlaceEntidad ruc={x.entidadRuc} nombre={x.entidad} />
          {periodoDelPuesto(x) ? `, ${periodoDelPuesto(x)}` : ""}. Un familiar que declaró ({x.parentesco.toLowerCase()}){" "}
          {x.via === "empresa" ? (
            <>
              figura como {papelEnLaEmpresa(x)} de <EnlaceEmpresa ruc={x.empresaRuc} nombre={x.empresa} />
              {x.parienteDesde ? ` desde el ${fechaConAnio(x.parienteDesde)}` : ""}, que {loQueRecibio(x)}.
            </>
          ) : (
            `${loQueRecibio(x)}.`
          )}{" "}
          <b>{ordenesEnElPuesto(x)}</b> {ordenesFueraDelPuesto(x) ? `${ordenesFueraDelPuesto(x)} ` : ""}
          {reglaCompraFamilia(x)} Esto no dice que intervino: hay que ver quién pidió y quién aprobó cada orden.
        </Caso>
      ))}
      {(c.exAutoridad ?? []).map((x, i) => (
        <Caso key={`ea${i}`} titulo="En observación: dejó de figurar en una empresa que le vendió a su entidad" tono={x.severidad === "alta" ? "alta" : "media"} fuente={FUENTE_CASO.autoridad}>
          Figuraba como <b>{x.roles.join(", ")}</b> de <EnlaceEmpresa ruc={x.empresaRuc} nombre={x.empresa} />
          {x.desde ? ` desde el ${fechaConAnio(x.desde)}` : ""} y dejó de figurar en el corte del Registro Nacional de Proveedores del {fechaConAnio(x.bajaCorte)}. Durante
          su periodo como {cargoTexto(x.cargo).toLowerCase()}, <EnlaceEntidad ruc={x.entidadRuc} nombre={x.entidad} /> le compró a esa empresa{" "}
          <b>{loQueVendio(x)}</b>. {ventasFrenteALaSalida(x)} {REGLA_AUTORIDAD_EXSOCIO}{" "}
          <Link href={`/entidad/${x.entidadRuc}?seccion=contratos&ccon=${x.empresaRuc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
            Ver lo que la entidad le compró a esa empresa
          </Link>
        </Caso>
      ))}
      {c.enInformeYDespuesCobro.map((x, i) => (
        <Caso key={`c${i}`} titulo="Figura en un informe de control y la entidad le pagó después" tono="media" fuente={FUENTE_CASO.control}>
          El informe {x.informe ?? "sin número"} de <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
          {x.fecha_del_informe ? `, del ${fechaConAnio(x.fecha_del_informe)},` : ""} la comprende con responsabilidad presunta. Esa entidad le dio{" "}
          {plural(x.ordenes_de_esa_entidad, "orden de servicio", "órdenes de servicio")}
          {monto(x.monto_soles)}
          {x.ultima_orden ? `; la última, el ${fechaConAnio(x.ultima_orden)}` : ""}. Falta ver cuántas son posteriores al informe.
        </Caso>
      ))}
    </>
  );
  const PESO: Record<TonoCaso, number> = { alta: 0, media: 1, baja: 2 };
  const ordenados = (Children.toArray(casos.props.children) as ReactElement<{ tono: TonoCaso }>[])
    .map((nodo, i) => ({ nodo, i }))
    .sort((x, y) => PESO[x.nodo.props.tono] - PESO[y.nodo.props.tono] || x.i - y.i)
    .map((x) => x.nodo);
  return <ul className="space-y-3">{ordenados}</ul>;
}

// ─── Cargos ──────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_PLANILLA: Columna[] = [
  { clave: "cargo", titulo: "Cargo y entidad", ancho: "minmax(0,1.6fr)" },
  { clave: "situacion", titulo: "Situación", ancho: "minmax(9rem,0.8fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "periodo", titulo: "Figura", ancho: "minmax(9rem,0.7fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "regimen", titulo: "Régimen", ancho: "8rem", desde: "lg", apilar: "con-rotulo" },
  { clave: "sueldo", titulo: "Sueldo al mes", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/** Una planilla es una fila; si en esa entidad tuvo más de un cargo, una fila por cargo (el último primero). */
function filasPlanilla(x: PlanillaDeLaPersona, i: number): Fila[] {
  const cargos = x.cargos ?? [];
  if (cargos.length < 2) return [filaPlanilla(x, `${i}`)];
  return cargos.map((k, j) => filaPlanilla({ ...x, ...k }, `${i}-${j}`, { anterior: j > 0, total: k.total }));
}

function filaPlanilla(x: PlanillaDeLaPersona, clave: string, cargo?: { anterior: boolean; total: CargoEnPlanilla["total"] }): Fila {
  const hoy = x.situacion === "hoy";
  const despues = !hoy && x.ultimoMesEntidad && x.ultimoMes && x.ultimoMesEntidad > x.ultimoMes;
  // Lo que cobró en un mes habitual con todo (gratificación, otros conceptos), cuando es bastante más que su remuneración:
  // el mes de la salida suele traer la liquidación.
  const conTodo = cargo?.total != null && cargo.total > (x.base ?? 0) * 1.15 ? cargo.total : null;
  return {
    id: `planilla-${clave}`,
    // La planilla de hoy tiene su propia ficha, con lo que cobró cada mes.
    href: hoy && x.ficha ? `/app/personas/planilla/${x.ficha}` : undefined,
    enlaces: true,
    etiqueta: "Abrir su ficha de planilla en esta entidad",
    celdas: {
      cargo: (
        <CeldaPrincipal
          dosLineas
          titulo={cargoTexto(x.cargo)}
          meta={[
            <span key="e"><EnlaceEntidad ruc={x.entidadRuc} nombre={x.entidad} /></span>,
            x.dependencia ? <span key="d">{tituloNatural(x.dependencia)}</span> : null,
          ]}
        />
      ),
      situacion: (
        cargo?.anterior ? (
          <CeldaTexto sub="después figura con otro cargo">Cargo anterior</CeldaTexto>
        ) : (
          <CeldaTexto sub={despues ? `la planilla de la entidad llega a ${mes(x.ultimoMesEntidad)}` : undefined}>
            {hoy ? "En la planilla de hoy" : "Ya no figura"}
          </CeldaTexto>
        )
      ),
      periodo: (
        <CeldaTexto sub={x.meses ? plural(x.meses, "mes publicado", "meses publicados") : undefined}>
          {x.primerMes && x.ultimoMes ? (x.primerMes === x.ultimoMes ? mes(x.primerMes) : `${mes(x.primerMes)} a ${mes(x.ultimoMes)}`) : "Sin fechas"}
        </CeldaTexto>
      ),
      regimen: <CeldaTexto>{x.regimen != null ? REGIMEN[Number(x.regimen)] ?? `Régimen ${x.regimen}` : "Sin dato"}</CeldaTexto>,
      sueldo: (
        <CeldaNumero sub={conTodo != null && x.base != null ? `${solesCompacto(conTodo)} con otros pagos` : undefined}>
          {x.base != null ? solesCompacto(x.base) : conTodo != null ? solesCompacto(conTodo) : <span className="font-sans text-mute">Sin dato</span>}
        </CeldaNumero>
      ),
    },
  };
}

// ─── Lo que cobró en planilla ────────────────────────────────────────────────────────────────────

/** El resultado de una candidatura, en palabras (antes salía el valor crudo: «no_electo»). Sin resultado: aún no publicado. */
function resultadoCandidatura(r: string | null | undefined): string {
  const v = (r ?? "").toLowerCase();
  return v === "electo" ? "salió electa" : v === "no_electo" ? "no salió electa" : "resultado pendiente";
}

const COLUMNAS_COBRADO: Columna[] = [
  { clave: "anio", titulo: "Año", ancho: "56px", desde: "md", apilar: "con-rotulo" },
  { clave: "cargo", titulo: "Cargo", ancho: "minmax(0,1.4fr)" },
  { clave: "regimen", titulo: "Régimen", ancho: "8.5rem", desde: "lg", apilar: "con-rotulo" },
  { clave: "meses", titulo: "Meses publicados", corto: "Meses", ancho: "minmax(9rem,0.8fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "pormes", titulo: "Por mes", ancho: "104px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "total", titulo: "En el año", ancho: "minmax(8.5rem,0.7fr)", alinear: "der" },
];

/** Los conceptos de la planilla que la entidad publica, con el nombre con que se leen. */
const CONCEPTOS_PLANILLA: { clave: "remuneraciones" | "honorarios" | "gratificacion" | "incentivo" | "otros"; nombre: string }[] = [
  { clave: "remuneraciones", nombre: "remuneraciones" },
  { clave: "honorarios", nombre: "honorarios" },
  { clave: "gratificacion", nombre: "gratificaciones" },
  { clave: "incentivo", nombre: "incentivos" },
  { clave: "otros", nombre: "otros conceptos" },
];

/** «S/ 100 mil de remuneraciones y S/ 22 mil de otros conceptos»: de qué se compone lo cobrado. */
function conceptosDe(filas: CobradoEnPlanilla[]): string | null {
  const partes = CONCEPTOS_PLANILLA.map((c) => ({ nombre: c.nombre, monto: filas.reduce((t, x) => t + (x[c.clave] ?? 0), 0) })).filter((c) => c.monto > 0);
  if (!partes.length) return null;
  const textos = partes.map((c) => `${solesCompacto(c.monto)} de ${c.nombre}`);
  return textos.length === 1 ? textos[0]! : `${textos.slice(0, -1).join(", ")} y ${textos[textos.length - 1]}`;
}

function filaCobrado(x: CobradoEnPlanilla): Fila {
  const periodo = x.primerMes && x.ultimoMes ? (x.primerMes === x.ultimoMes ? mes(x.primerMes) : `${mes(x.primerMes)} a ${mes(x.ultimoMes)}`) : null;
  const buenos = x.meses - x.mesesDudosos;
  return {
    id: `cobrado-${x.entidadRuc}-${x.anio}`,
    celdas: {
      anio: <span className="font-mono text-meta tabular-nums text-ink">{x.anio}</span>,
      cargo: (
        <CeldaPrincipal
          dosLineas
          titulo={x.cargos.length ? x.cargos.map((c) => cargoTexto(c)).join(", ") : "Cargo sin detalle"}
          meta={x.mesesDudosos > 0 ? [<span key="d">{plural(x.mesesDudosos, "mes con un monto dudoso que no se suma", "meses con un monto dudoso que no se suman")}</span>] : undefined}
        />
      ),
      regimen: <CeldaTexto>{x.regimen != null ? REGIMEN[Number(x.regimen)] ?? `Régimen ${x.regimen}` : "Sin dato"}</CeldaTexto>,
      meses: <CeldaTexto sub={periodo ?? undefined}>{plural(x.meses, "mes", "meses")}</CeldaTexto>,
      pormes: <CeldaNumero>{buenos > 0 ? solesCompacto(x.total / buenos) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
      total: (
        // En el celular el desglose le quita el ancho a las demás celdas: ahí queda el del bloque «Cómo cobró».
        <CeldaNumero sub={buenos > 0 && conceptosDe([x]) ? <span className="hidden md:inline">{conceptosDe([x])}</span> : undefined}>
          {buenos > 0 ? solesCompacto(x.total) : <span className="font-sans text-mute">Sin dato</span>}
        </CeldaNumero>
      ),
    },
  };
}

/** Lo que cobró en planilla: un grupo por entidad (la que más le pagó primero) y una fila por año. */
function CobradoPlanilla({ filas, ruta }: { filas: CobradoEnPlanilla[]; ruta: string }) {
  const regimenes = [...new Set(filas.map((x) => x.regimen).filter((r): r is number => r != null))].map((r) => REGIMEN[Number(r)] ?? `Régimen ${r}`);
  const conceptos = conceptosDe(filas);
  const porHonorarios = filas.some((x) => (x.honorarios ?? 0) > 0);
  const total = filas.reduce((s, x) => s + x.total, 0);
  const meses = filas.reduce((s, x) => s + x.meses, 0);
  const porEntidad = new Map<string, CobradoEnPlanilla[]>();
  for (const x of filas) porEntidad.set(x.entidadRuc, [...(porEntidad.get(x.entidadRuc) ?? []), x]);
  const desde = filas.map((x) => x.primerMes).filter(Boolean).sort()[0] ?? null;
  const hasta = filas.map((x) => x.ultimoMes).filter(Boolean).sort().pop() ?? null;
  const grupos: GrupoFilas[] = [...porEntidad.entries()]
    .map(([ruc, anios]) => ({ ruc, anios, monto: anios.reduce((t, a) => t + a.total, 0), meses: anios.reduce((t, a) => t + a.meses, 0) }))
    .sort((a, b) => b.monto - a.monto)
    .map((g) => ({
      clave: g.ruc,
      titulo: (
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <Link href={`/entidad/${g.ruc}`} prefetch={false} className="min-w-0 text-granate underline-offset-2 hover:underline">
            {entidadTexto(g.anios[0]?.entidad)}
          </Link>
          <span className="inline-flex shrink-0 items-center gap-1.5 text-meta font-normal text-mute">
            <CuentaGrupo>{solesCompacto(g.monto)}</CuentaGrupo>
            {`en ${plural(g.meses, "mes publicado", "meses publicados")}`}
          </span>
        </span>
      ),
      filas: [...g.anios].sort((a, b) => b.anio - a.anio).map(filaCobrado),
    }));
  return (
    <section className={BLOQUE} data-bloque>
      <CabeceraPestana
        titulo="Por entidad y año"
        ayuda={
          <Ayuda titulo="¿Qué se suma aquí?">
            <span className="block">
              Lo que cada entidad publicó que le pagó cada mes en su planilla (Portal de Transparencia Estándar): sueldo,
              gratificaciones y otros conceptos. «Por mes» es lo del año entre sus meses publicados.
            </span>
            <span className="mt-2 block">
              Sólo entran los meses que la entidad publicó y que Vigía tiene cargados. Un mes que la entidad no publicó, o un año
              anterior a lo cargado, no está en la suma: la persona pudo cobrar más que esto.
            </span>
          </Ayuda>
        }
      >
        {filas.length
          ? `En planilla cobró ${solesCompacto(total)} en ${plural(meses, "mes publicado", "meses publicados")}${desde && hasta ? `, de ${mes(desde)} a ${mes(hasta)}` : ""}. Es lo que sus entidades publicaron en el Portal de Transparencia: un mes que no publicaron, o uno anterior que aún no se cargó, no está en la suma.`
          : "No hay meses de planilla cargados para esta persona."}
      </CabeceraPestana>
      {filas.length > 0 && (
        <section aria-labelledby="como-cobro-planilla" className="tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5 [.tarjeta_&]:rounded-none [.tarjeta_&]:border-x-0 [.tarjeta_&]:border-b-0 [.tarjeta_&]:px-0 [.tarjeta_&]:pb-0">
          <h3 id="como-cobro-planilla" className="font-display text-bloque font-bold text-ink">Cómo cobró</h3>
          <DatosClave
            items={[
              {
                etiqueta: "Cobró como",
                valor: "Trabajador en la planilla de la entidad",
                ayuda: (
                  <Ayuda titulo="¿Qué quiere decir en planilla?">
                    La entidad le paga cada mes como a su personal, no como a un proveedor: no hay orden de servicio ni recibo con RUC. El
                    Portal de Transparencia publica su nombre, su cargo y su régimen, sin su documento.
                  </Ayuda>
                ),
              },
              { etiqueta: regimenes.length === 1 ? "Régimen laboral" : "Regímenes laborales", valor: regimenes.length ? regimenes.join(", ") : null },
              { etiqueta: "De qué se compone", valor: conceptos },
              ...(porHonorarios
                ? [{ etiqueta: "Honorarios en planilla", valor: "La entidad lo publica con honorarios: es personal contratado por servicios que la entidad lista junto a su planilla" }]
                : []),
            ]}
          />
        </section>
      )}
      {grupos.length > 0 && <Tabla columnas={COLUMNAS_COBRADO} grupos={grupos} etiqueta="Lo que cobró en planilla por entidad y año" />}
      {filas.length > 0 && (
        <p className="text-meta text-mute">
          El cargo y el sueldo de cada mes están en{" "}
          <Link href={`${ruta}?seccion=cargos`} prefetch={false} className="text-granate underline underline-offset-2">
            Cargos
          </Link>
          .
        </p>
      )}
    </section>
  );
}

const COLUMNAS_CARGOS: Columna[] = [
  { clave: "cargo", titulo: "Cargo declarado y entidad", ancho: "minmax(0,1.7fr)" },
  { clave: "desde", titulo: "En el cargo", ancho: "minmax(10rem,0.9fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "declaraciones", titulo: "Declaraciones", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "ultima", titulo: "Última presentada", ancho: "8rem", desde: "lg", apilar: "con-rotulo" },
];

function filaCargo(x: CargoDeclarado, i: number): Fila {
  const hasta = x.cese ? `hasta el ${fechaConAnio(x.cese)}` : x.sinCese ? "sin fecha de cese" : null;
  return {
    id: `cargo-${i}`,
    buscable: `${x.cargoReal ?? ""} ${x.cargo ?? ""} ${x.entidad ?? ""}`,
    celdas: {
      cargo: (
        <CeldaPrincipal
          dosLineas
          metaEnVarias
          titulo={cargoTexto(x.cargoReal ?? x.cargo)}
          meta={[
            <span key="e"><EnlaceEntidad ruc={x.entidadRuc} nombre={x.entidad} /></span>,
            x.cargoReal && x.cargo ? <span key="c">En el formulario: {cargoTexto(x.cargo).toLowerCase()}</span> : null,
          ]}
        />
      ),
      desde: <CeldaTexto sub={hasta ?? undefined}>{x.inicio ? `Desde el ${fechaConAnio(x.inicio)}` : "Sin fecha de inicio"}</CeldaTexto>,
      declaraciones: <CeldaNumero>{numero(x.declaraciones)}</CeldaNumero>,
      ultima: <span className="text-meta tabular-nums text-inkSoft">{x.ultima ? fechaConAnio(x.ultima) : "Sin fecha"}</span>,
    },
  };
}

const COLUMNAS_EMPLEOS: Columna[] = [
  { clave: "puesto", titulo: "Puesto y empleador", ancho: "minmax(0,1.7fr)" },
  { clave: "desde", titulo: "En el puesto", ancho: "minmax(10rem,0.9fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "tipo", titulo: "Empleador", ancho: "8rem", desde: "lg", apilar: "con-rotulo" },
  { clave: "declaraciones", titulo: "Declaraciones", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/** «Escribió 3 trabajos: 2 en entidades públicas y 1 en una empresa u otra organización.» */
function resumenEmpleos(empleos: EmpleoDeclarado[]): string {
  const publicos = empleos.filter((e) => e.publica).length;
  const otros = empleos.length - publicos;
  const partes = [
    publicos ? `${numero(publicos)} en ${publicos === 1 ? "una entidad pública" : "entidades públicas"}` : null,
    otros ? `${numero(otros)} en ${otros === 1 ? "una empresa u otra organización" : "empresas u otras organizaciones"}` : null,
  ].filter(Boolean);
  return `En sus declaraciones escribió ${plural(empleos.length, "trabajo", "trabajos")}: ${partes.join(" y ")}.`;
}

function filaEmpleo(x: EmpleoDeclarado, i: number): Fila {
  const hasta = x.cese ? `hasta el ${fechaConAnio(x.cese)}` : x.sinCese ? "sin fecha de cese" : null;
  const empleador = x.entidad ? tituloNatural(x.entidad) : "Empleador sin nombre";
  return {
    id: `empleo-${i}`,
    buscable: `${x.cargo} ${x.entidad ?? ""}`,
    enlaces: true,
    celdas: {
      puesto: (
        <CeldaPrincipal
          dosLineas
          titulo={cargoTexto(x.cargo)}
          meta={[
            <span key="e">
              {x.publica ? (
                <EnlaceEntidad ruc={x.ruc} nombre={x.entidad} />
              ) : (
                <Link href={`/empresa/${x.ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                  {empleador}
                </Link>
              )}
            </span>,
          ]}
        />
      ),
      desde: <CeldaTexto sub={hasta ?? undefined}>{x.inicio ? `Desde el ${fechaConAnio(x.inicio)}` : "Sin fecha de inicio"}</CeldaTexto>,
      tipo: <CeldaTexto>{x.publica ? "Entidad pública" : "Empresa u otra"}</CeldaTexto>,
      declaraciones: <CeldaNumero>{numero(x.declaraciones)}</CeldaNumero>,
    },
  };
}

// ─── Visitas ─────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_VISITAS: Columna[] = [
  { clave: "entidad", titulo: "Entidad que visitó", ancho: "minmax(0,1.5fr)" },
  { clave: "visitas", titulo: "Visitas", ancho: "5.5rem", alinear: "der" },
  { clave: "periodo", titulo: "Entre", ancho: "minmax(10rem,0.9fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "organizacion", titulo: "En nombre de", ancho: "minmax(0,1fr)", desde: "lg", apilar: "con-rotulo" },
];

function filaVisita(v: VisitaHecha, i: number): Fila {
  const entidad = entidadTexto(v.entidad);
  const orgs = v.en_nombre_de ?? [];
  const aQuien = (v.a_quien ?? []).filter(Boolean);
  const entre = v.primera && v.ultima ? (v.primera === v.ultima ? fechaConAnio(v.primera) : `${fechaConAnio(v.primera)} a ${fechaConAnio(v.ultima)}`) : "Sin fechas";
  return {
    id: `visita-${i}`,
    buscable: `${v.entidad} ${orgs.join(" ")}`,
    enlaces: true,
    etiqueta: "Ver el detalle de las visitas a esta entidad",
    magnitudes: { visitas: v.visitas },
    detalle: {
      titulo: entidad,
      etiqueta: "Ver el detalle de las visitas a esta entidad",
      descripcion: <span className="line-clamp-2">{plural(v.visitas, "visita registrada", "visitas registradas")}</span>,
      contenido: (
        <div className="space-y-5">
          <EnUnaFrase>
            Fue <b>{plural(v.visitas, "vez", "veces")}</b> a <b>{entidad}</b>
            {v.primera && v.ultima && v.primera !== v.ultima ? `, entre el ${fechaConAnio(v.primera)} y el ${fechaConAnio(v.ultima)}` : v.primera ? `, el ${fechaConAnio(v.primera)}` : ""}.
          </EnUnaFrase>
          <DatosClave
            items={[
              { etiqueta: "Visitas", valor: numero(v.visitas), mono: true },
              { etiqueta: "Primera", valor: v.primera ? fechaConAnio(v.primera) : null },
              { etiqueta: "Última", valor: v.ultima ? fechaConAnio(v.ultima) : null },
            ]}
          />
          <section className="space-y-2" data-bloque>
            <h3 className="text-cuerpo font-semibold text-ink">En nombre de quién fue</h3>
            {orgs.length ? (
              <ul className="space-y-1 text-dato text-inkSoft">
                {orgs.map((o) => (
                  <li key={o}>{tituloNatural(o)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-dato text-inkSoft">El registro no dice una organización: fue a título personal o la entidad no lo anotó.</p>
            )}
          </section>
          <section className="space-y-2" data-bloque>
            <h3 className="text-cuerpo font-semibold text-ink">A qué cargo u oficina visitó</h3>
            {aQuien.length ? (
              <ul className="space-y-1 text-dato text-inkSoft">
                {aQuien.map((o) => (
                  <li key={o}>{tituloNatural(o)}</li>
                ))}
              </ul>
            ) : (
              <p className="text-dato text-inkSoft">El registro no dice a quién visitó.</p>
            )}
          </section>
          <p className="text-rotulo leading-relaxed text-mute">Una visita no prueba un vínculo ni un favor: es un dato para leer junto a los contratos de la entidad.</p>
        </div>
      ),
      pie: esRuc20(v.entidad_ruc) ? (
        <div className="flex flex-wrap gap-2">
          <EnlaceAccion href={`/entidad/${v.entidad_ruc}?seccion=visitas`} prefetch={false} flecha>
            Las visitas de esta entidad
          </EnlaceAccion>
          <EnlaceAccion href={`/entidad/${v.entidad_ruc}`} prefetch={false} variante="secundario" flecha>
            Ficha de la entidad
          </EnlaceAccion>
        </div>
      ) : undefined,
    },
    celdas: {
      entidad: <CeldaPrincipal dosLineas titulo={<EnlaceEntidad ruc={v.entidad_ruc} nombre={v.entidad} />} />,
      visitas: <CeldaNumero>{numero(v.visitas)}</CeldaNumero>,
      periodo: <CeldaTexto>{entre}</CeldaTexto>,
      organizacion: <CeldaTexto sub={orgs.length > 1 ? `y ${orgs.length - 1} más` : undefined}>{orgs[0] ? tituloNatural(orgs[0]) : "No lo dice"}</CeldaTexto>,
    },
  };
}

// ─── Visitas que recibió ─────────────────────────────────────────────────────────────────────────

const COLUMNAS_RECIBIDAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa y entidad", ancho: "minmax(0,1.6fr)" },
  { clave: "visitas", titulo: "Visitas", ancho: "5.5rem", alinear: "der" },
  { clave: "periodo", titulo: "Entre", ancho: "minmax(10rem,0.9fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "despues", titulo: "Ganó después", ancho: "minmax(9rem,0.9fr)", desde: "md", apilar: "con-rotulo" },
];

function VisitasRecibidas({ r }: { r: FichaFuncionario["recibidas"] }) {
  const ayuda = (
    <Ayuda titulo="¿Cómo se sabe que la visitaron a ella?">
      <span className="block">
        El registro de visitas de cada entidad anota el nombre de quien recibió la visita. Se junta con esta persona cuando ese nombre
        tiene las mismas palabras que el suyo y la visita fue en una entidad en que declaró un cargo o figuró en planilla.
      </span>
      <span className="mt-2 block">
        La empresa es la de quien visitó: un socio, representante o directivo del Registro Nacional de Proveedores, o alguien que dijo
        venir de ella. Vigía no muestra quién visitó. Una visita no prueba un favor: es un dato para leer junto a los contratos.
      </span>
    </Ayuda>
  );
  if (r == null) {
    return (
      <CabeceraPestana ayuda={ayuda}>
        Las visitas que recibió no respondieron a tiempo. Vuelve a abrir la ficha en un momento.
      </CabeceraPestana>
    );
  }
  return (
    <div className="space-y-3">
      <CabeceraPestana ayuda={ayuda}>
        {r.empresas
          ? `Gente de ${plural(r.empresas, "empresa", "empresas")} la visitó ${plural(r.visitas, "vez", "veces")} en las entidades en que trabajó${
              r.ganaronDespues ? `; ${plural(r.ganaronDespues, "de ellas le ganó", "de ellas le ganaron")} después algún proceso a esa entidad` : ""
            }. Cada fila abre su detalle.`
          : "En el registro de visitas no figura gente de empresas que la haya visitado en las entidades en que trabajó."}
      </CabeceraPestana>
      {r.filas.length > 0 ? (
        <TablaPaginada
          columnas={COLUMNAS_RECIBIDAS}
          filas={r.filas.map(filaRecibida)}
          etiqueta="Empresas cuya gente la visitó"
          nombre="empresas"
          tam={10}
          buscar={{ placeholder: "Buscar por empresa o entidad…", etiqueta: "Buscar en las empresas que la visitaron" }}
        />
      ) : null}
    </div>
  );
}

function filaRecibida(v: VisitaRecibida, i: number): Fila {
  const empresa = v.empresa ? tituloNatural(v.empresa) : "Empresa sin nombre";
  const entidad = entidadTexto(v.entidad);
  const entre = v.primera && v.ultima ? (v.primera === v.ultima ? fechaConAnio(v.primera) : `${fechaConAnio(v.primera)} a ${fechaConAnio(v.ultima)}`) : "Sin fechas";
  const gano = v.ganoDespues > 0 ? `${plural(v.ganoDespues, "proceso", "procesos")}${v.montoDespues ? ` por ${solesCompacto(v.montoDespues)}` : ""}` : "Ninguno";
  return {
    id: `recibida-${i}`,
    buscable: `${v.empresa ?? ""} ${v.entidad ?? ""}`,
    enlaces: true,
    etiqueta: "Ver el detalle de las visitas de esta empresa",
    magnitudes: { visitas: v.visitas },
    detalle: {
      titulo: empresa,
      etiqueta: "Ver el detalle de las visitas de esta empresa",
      descripcion: <span className="line-clamp-2">{`${plural(v.visitas, "visita", "visitas")} en ${entidad}`}</span>,
      contenido: (
        <div className="space-y-5">
          <EnUnaFrase>
            Gente de <b>{empresa}</b> la visitó <b>{plural(v.visitas, "vez", "veces")}</b> en <b>{entidad}</b>
            {v.primera && v.ultima && v.primera !== v.ultima ? `, entre el ${fechaConAnio(v.primera)} y el ${fechaConAnio(v.ultima)}` : v.primera ? `, el ${fechaConAnio(v.primera)}` : ""}.
            {v.ganoDespues > 0
              ? <> Desde su primera visita, la empresa le ganó <b>{gano}</b> a esa entidad{v.primeraBuenaPro ? `, la primera buena pro el ${fechaConAnio(v.primeraBuenaPro)}` : ""}.</>
              : " Desde su primera visita, la empresa no le ganó ningún proceso a esa entidad por su cuenta."}
          </EnUnaFrase>
          <DatosClave
            items={[
              { etiqueta: "Visitas", valor: numero(v.visitas), mono: true },
              { etiqueta: "Primera", valor: v.primera ? fechaConAnio(v.primera) : null },
              { etiqueta: "Última", valor: v.ultima ? fechaConAnio(v.ultima) : null },
              { etiqueta: "Procesos ganados después", valor: numero(v.ganoDespues), mono: true },
              { etiqueta: "Monto adjudicado después", valor: v.montoDespues ? solesCompacto(v.montoDespues) : null },
            ]}
          />
          <p className="text-rotulo leading-relaxed text-mute">
            Se juntó por el nombre de quien recibió la visita. Revisa en el contrato si esta persona intervino en esa compra: comité,
            área usuaria o logística.
          </p>
        </div>
      ),
      pie: (
        <div className="flex flex-wrap gap-2">
          {esRuc20(v.ruc) && (
            <EnlaceAccion href={`/empresa/${v.ruc}?seccion=visitas`} prefetch={false} flecha>
              Las visitas de la empresa
            </EnlaceAccion>
          )}
          {esRuc20(v.entidadRuc) && (
            <EnlaceAccion href={`/entidad/${v.entidadRuc}`} prefetch={false} variante="secundario" flecha>
              Ficha de la entidad
            </EnlaceAccion>
          )}
        </div>
      ),
    },
    celdas: {
      empresa: (
        <CeldaPrincipal
          dosLineas
          titulo={<EnlaceEmpresa ruc={v.ruc} nombre={v.empresa} />}
          meta={[<span key="e">{entidad}</span>]}
        />
      ),
      visitas: <CeldaNumero>{numero(v.visitas)}</CeldaNumero>,
      periodo: <CeldaTexto>{entre}</CeldaTexto>,
      despues: <CeldaTexto>{gano}</CeldaTexto>,
    },
  };
}

// ─── Empresas ────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_EMPRESAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1.6fr)" },
  { clave: "rol", titulo: "Figura como", ancho: "minmax(8rem,0.8fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "desde", titulo: "Desde", ancho: "8rem", desde: "md", apilar: "con-rotulo" },
];

function filaEmpresa(e: EmpresaDeLaPersona, i: number): Fila {
  return {
    id: `empresa-${i}`,
    href: esRuc20(e.ruc) ? `/empresa/${e.ruc}` : undefined,
    celdas: {
      empresa: <CeldaPrincipal dosLineas titulo={e.empresa ? tituloNatural(e.empresa) : "Empresa sin nombre"} />,
      rol: <CeldaTexto>{e.rol ? tituloNatural(e.rol) : "Sin dato"}</CeldaTexto>,
      desde: <span className="text-meta tabular-nums text-inkSoft">{e.desde ? fechaConAnio(e.desde) : "Sin fecha"}</span>,
    },
  };
}

// ─── Otros registros ─────────────────────────────────────────────────────────────────────────────

const COLUMNAS_ORDENES: Columna[] = [
  { clave: "entidad", titulo: "Entidad y servicio", ancho: "minmax(0,1.6fr)" },
  { clave: "ordenes", titulo: "Órdenes", ancho: "6rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "periodo", titulo: "Entre", ancho: "minmax(10rem,0.9fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "monto", titulo: "Monto", ancho: "7rem", alinear: "der" },
];

function filaOrden(o: OrdenesDeLaPersona, i: number): Fila {
  return {
    id: `orden-${i}`,
    href: o.codigo ? rutaPersona(o.codigo, "ordenes") : undefined,
    celdas: {
      entidad: <CeldaPrincipal dosLineas titulo={entidadTexto(o.entidad)} meta={o.servicio ? [<span key="s">{tituloNatural(o.servicio)}</span>] : undefined} />,
      ordenes: <CeldaNumero>{numero(o.ordenes)}</CeldaNumero>,
      periodo: <CeldaTexto>{o.primera && o.ultima ? `${fechaConAnio(o.primera)} a ${fechaConAnio(o.ultima)}` : "Sin fechas"}</CeldaTexto>,
      monto: <CeldaNumero>{o.monto != null ? solesCompacto(o.monto) : "Sin dato"}</CeldaNumero>,
    },
  };
}

const RESPONSABILIDAD: Record<string, string> = {
  penal: "penal", civil: "civil", administrativa_entidad: "administrativa", administrativa_pas: "administrativa", administrativa: "administrativa",
};

function Informe({ x }: { x: InformeDeLaPersona }) {
  const resp = [...new Set((x.responsabilidades ?? []).map((r) => RESPONSABILIDAD[r] ?? r))];
  return (
    <li className="rounded-xl border border-line bg-paper px-4 py-3">
      <p className="text-dato font-semibold text-ink">
        <InformeEnPanel
          informe={{ codigo: x.codigo, numero: x.numero, titulo: x.titulo, fecha: x.fecha, entidad: x.entidad, entidadRuc: x.entidad_ruc, responsabilidades: x.responsabilidades ?? [], urlResumen: x.ficha }}
        />
      </p>
      {x.titulo && <p className="mt-1 text-dato leading-snug text-inkSoft">{tituloNatural(x.titulo)}</p>}
      <p className="mt-1 text-rotulo text-mute">
        <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
        {x.fecha ? `, ${fechaConAnio(x.fecha)}` : ""}; responsabilidad presunta {resp.length ? resp.join(" y ") : "sin detalle"}
      </p>
    </li>
  );
}

const lugarDe = (c: { region: string | null; provincia: string | null; distrito: string | null }) =>
  [c.distrito, c.provincia, c.region].filter((x): x is string => !!x).map((x) => tituloNatural(x)).join(", ");

function OtrosRegistros({ f }: { f: FichaFuncionario }) {
  const candidaturas = f.candidaturas ?? [];
  const nada = candidaturas.length + f.ordenes.length + f.informes.length + f.aportes.length + f.expuesta.length === 0;
  if (nada) {
    return (
      <EstadoVacio titulo="No figura en estos registros" compacto conLlamita={false}>
        No fue candidata desde 2014, no recibió órdenes de servicio como persona natural, ningún informe de control la comprende, no aportó a una
        campaña y no está en la lista de personas expuestas políticamente.
      </EstadoVacio>
    );
  }
  const electa = candidaturas.filter((c) => (c.resultado ?? "").toLowerCase() === "electo").length;
  return (
    <div className="space-y-6">
      {candidaturas.length > 0 && (
        <section className={BLOQUE} data-bloque>
          <CabeceraPestana
            titulo="Candidaturas"
            ayuda={
              <Ayuda titulo="¿De dónde salen?">
                <span className="block">
                  Del Jurado Nacional de Elecciones: las listas de candidatos de las elecciones desde 2014. El resultado de 2022 no está completo
                  en esa fuente: «no salió electa» puede faltar a la verdad en ese año.
                </span>
                <span className="mt-2 block">
                  De las elecciones regionales y municipales de octubre de 2026 el JNE todavía no publica los electos: esas candidaturas
                  dicen «resultado pendiente».
                </span>
              </Ayuda>
            }
          >
            Fue candidata {plural(candidaturas.length, "vez", "veces")} desde 2014{electa > 0 ? `; salió electa ${plural(electa, "vez", "veces")}` : ""}.
          </CabeceraPestana>
          <DatosClave
            items={candidaturas.map((c, i) => ({
              etiqueta: `${c.anio ?? "Sin año"}, ${cargoTexto(c.cargo)}${candidaturas.length > 1 ? ` (${i + 1})` : ""}`,
              valor: `${c.partido ? tituloNatural(c.partido) : "Organización sin nombre"}${lugarDe(c) ? `, ${lugarDe(c)}` : ""}; ${resultadoCandidatura(c.resultado)}`,
            }))}
          />
        </section>
      )}
      {f.ordenes.length > 0 && (
        <section className={BLOQUE} data-bloque>
          <CabeceraPestana titulo="Órdenes de servicio">
            Recibió órdenes de servicio como persona natural de {plural(f.ordenes.length, "entidad", "entidades")}. Cada fila abre su ficha de persona
            contratada.
          </CabeceraPestana>
          <Tabla columnas={COLUMNAS_ORDENES} filas={f.ordenes.map(filaOrden)} etiqueta="Órdenes de servicio como persona natural" />
        </section>
      )}
      {f.informes.length > 0 && (
        <section className={BLOQUE} data-bloque>
          <CabeceraPestana
            titulo="Informes de control"
            ayuda={
              <Ayuda titulo="¿Qué quiere decir que un informe la comprende?">
                <span className="block">
                  Que los auditores de la Contraloría la nombran entre los funcionarios con presunta responsabilidad. Es presunta: la Contraloría
                  la señala y la deriva; no es una condena ni una sanción.
                </span>
              </Ayuda>
            }
          >
            {plural(f.informes.length, "informe de control la comprende", "informes de control la comprenden")}, con responsabilidad presunta. El número abre lo
            que encontró el informe.
          </CabeceraPestana>
          <ul className="space-y-2.5">
            {f.informes.map((x) => (
              <Informe key={x.codigo} x={x} />
            ))}
          </ul>
        </section>
      )}
      {f.aportes.length > 0 && (
        <section className={BLOQUE} data-bloque>
          <CabeceraPestana titulo="Aportes de campaña">Lo que aportó a organizaciones políticas, según la ONPE.</CabeceraPestana>
          <DatosClave
            items={f.aportes.map((a, i) => ({
              etiqueta: `${a.partido ? tituloNatural(a.partido) : "Organización sin nombre"}${a.anio ? `, ${a.anio}` : ""}${f.aportes.length > 1 ? ` (${i + 1})` : ""}`,
              valor: `${a.monto != null ? solesCompacto(a.monto) : "Sin monto"} en ${plural(a.aportes, "aporte", "aportes")}`,
            }))}
          />
        </section>
      )}
      {f.expuesta.length > 0 && (
        <section className={BLOQUE} data-bloque>
          <CabeceraPestana titulo="Persona expuesta políticamente">Los cargos por los que figura en esa lista.</CabeceraPestana>
          <DatosClave
            items={f.expuesta.map((x, i) => ({
              etiqueta: `${cargoTexto(x.cargo)}${f.expuesta.length > 1 ? ` (${i + 1})` : ""}`,
              valor: `${entidadTexto(x.entidad)}${x.desde ? `, ${x.desde}${x.hasta && x.hasta !== x.desde ? ` a ${x.hasta}` : ""}` : ""}`,
            }))}
          />
        </section>
      )}
    </div>
  );
}
