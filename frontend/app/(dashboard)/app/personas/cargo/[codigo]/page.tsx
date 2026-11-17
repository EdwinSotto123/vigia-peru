import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Briefcase, Building2, CalendarRange, DoorOpen, Flag, Footprints, Landmark, ScrollText, Wallet } from "lucide-react";
import {
  Ayuda,
  BanderasFicha,
  CabeceraPestana,
  DatosClave,
  EncabezadoPagina,
  EnUnaFrase,
  EstadoVacio,
  FichaNoLeida,
  Migas,
  Nota,
  Pagina,
  Pestanas,
  type BanderaFicha,
} from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Indicadores, Tabla, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { InformeEnPanel } from "@/components/control/InformeEnPanel";
import { Badge } from "@/components/ui/Badge";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";
import {
  getFichaFuncionario,
  rutaFuncionario,
  totalCruces,
  type CargoDeclarado,
  type CrucesDeLaPersona,
  type EmpresaDeLaPersona,
  type FichaFuncionario,
  type InformeDeLaPersona,
  type OrdenesDeLaPersona,
  type PlanillaDeLaPersona,
  type VisitaHecha,
  type VisitaRecibida,
} from "@/lib/funcionarios";
import { tituloNatural } from "@/lib/landing";
import { rutaPersona } from "@/lib/personas";
import { REGIMEN } from "@/lib/planilla";
import { uno } from "@/lib/utils";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaFuncionario(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, persona con cargo público` : "Persona con cargo público", robots: { index: false } };
}

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
  const seccion = uno(searchParams?.seccion) ?? primera;
  const otros = f.ordenes.length + f.informes.length + f.aportes.length + f.expuesta.length + (f.candidaturas?.length ?? 0);
  const banderas = banderasDe(f, ruta);

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
        pestanas={{ primera, activa: seccion, etiquetas: { revision: "Lo que pide revisión", cargos: "Cargos", visitas: "Visitas", recibidas: "Visitas que recibió", empresas: "Empresas", otros: "Otros registros" } }}
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
      <EnUnaFrase tono={nCruces > 0 ? "media" : "neutro"}>{frase(f)}</EnUnaFrase>
      <Indicadores items={indicadores(f, ruta)} />
      {f.sinRespuesta.length > 0 && (
        <Nota>
          No respondieron a tiempo: {f.sinRespuesta.map((x) => x.replace(/_/g, " ")).join(", ")}. Esa parte de la ficha puede estar incompleta: vuelve a
          cargar la página en un momento.
        </Nota>
      )}

      <Pestanas
        fija
        key={seccion}
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
            conteo: f.planilla.length + f.cargos.length,
            contenido: (
              <div className="space-y-6">
                <section className="space-y-3" data-bloque>
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
                  {f.planilla.length > 0 && <Tabla columnas={COLUMNAS_PLANILLA} filas={f.planilla.map(filaPlanilla)} etiqueta="Planillas en que figura o figuró" />}
                </section>
                <section className="space-y-3" data-bloque>
                  <CabeceraPestana
                    titulo="Lo que declaró a la Contraloría"
                    ayuda={
                      <Ayuda titulo="¿Qué es una declaración jurada de intereses?">
                        <span className="block">
                          La que presenta a la Contraloría quien tiene un cargo con poder de decisión: titulares, directivos, quienes contratan,
                          administran fondos o integran comités. Dice en qué entidad y con qué cargo.
                        </span>
                        <span className="mt-2 block">
                          El formulario ofrece pocos cargos: «Colaborador» u «Otro cargo, función o labor» no dicen el puesto real. Si está en
                          planilla, el cargo de arriba es más preciso.
                        </span>
                      </Ayuda>
                    }
                  >
                    {f.cargos.length
                      ? `Declaró ${plural(f.cargos.length, "cargo", "cargos")} en ${plural(p.entidades, "entidad", "entidades")}, en ${plural(p.declaraciones, "declaración jurada de intereses", "declaraciones juradas de intereses")}.`
                      : "No presentó declaraciones juradas de intereses a la Contraloría."}
                  </CabeceraPestana>
                  {f.cargos.length > 0 && (
                    <TablaPaginada columnas={COLUMNAS_CARGOS} filas={f.cargos.map(filaCargo)} etiqueta="Cargos declarados a la Contraloría" nombre="cargos" tam={15} />
                  )}
                </section>
              </div>
            ),
          },
          {
            clave: "visitas",
            icono: <DoorOpen size={15} aria-hidden />,
            etiqueta: "Visitas",
            titulo: "Las visitas que hizo a entidades del Estado",
            conteo: f.visitas.total,
            contenido: (
              <div className="space-y-3">
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
                    tam={20}
                    buscar={{ placeholder: "Buscar por entidad u organización…", etiqueta: "Buscar en las entidades que visitó" }}
                  />
                ) : null}
              </div>
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
              <div className="space-y-3">
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
              </div>
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

function Caso({ titulo, tono, children }: { titulo: string; tono: "alta" | "media"; children: React.ReactNode }) {
  return (
    <li className="rounded-xl border border-line bg-paper px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={tono === "alta" ? "crimson" : "amber"}>{tono === "alta" ? "Señal alta" : "Señal media"}</Badge>
        <h3 className="text-cuerpo font-semibold text-ink">{titulo}</h3>
      </div>
      <p className="mt-1.5 text-dato leading-relaxed text-inkSoft">{children}</p>
    </li>
  );
}

function Cruces({ cruces: c }: { cruces: CrucesDeLaPersona }) {
  const monto = (m: number | null) => (m != null && m > 0 ? ` por ${solesCompacto(m)}` : "");
  return (
    <ul className="space-y-3">
      {c.visitoYSuEmpresaGano.map((x, i) => (
        <Caso key={`v${i}`} titulo="Visitó la entidad y una empresa suya le ganó" tono={x.visito_antes_de_ganar ? "alta" : "media"}>
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
        <Caso key={`s${i}`} titulo="Dejó la entidad y una empresa suya le ganó después" tono="alta">
          Figuró en la planilla de <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
          {x.cargo_que_tenia ? ` como ${cargoTexto(x.cargo_que_tenia)}` : ""}
          {x.salio_de_planilla ? ` hasta ${mes(x.salio_de_planilla)}` : ""}. Después, <EnlaceEmpresa ruc={x.empresa_ruc} nombre={x.empresa} />
          {x.rol_en_la_empresa ? `, donde figura como ${x.rol_en_la_empresa.toLowerCase()},` : ""} le ganó {plural(x.procesos_ganados_despues, "proceso", "procesos")}
          {monto(x.monto_soles)}
          {x.primera_buena_pro_tras_salir ? `; el primero, el ${fechaConAnio(x.primera_buena_pro_tras_salir)}` : ""}.
        </Caso>
      ))}
      {c.empresaInhabilitadaYOtraGano.map((x, i) => (
        <Caso key={`i${i}`} titulo="Una empresa suya está inhabilitada y otra ganó" tono="alta">
          <EnlaceEmpresa ruc={x.empresa_inhabilitada_ruc} nombre={x.empresa_inhabilitada} /> tiene una {x.sancion ?? "inhabilitación"}
          {x.sancion_desde ? ` desde el ${fechaConAnio(x.sancion_desde)}` : ""}
          {x.sancion_hasta ? ` hasta el ${fechaConAnio(x.sancion_hasta)}` : ""}. Dentro de esa sanción, <EnlaceEmpresa ruc={x.empresa_que_gano_ruc} nombre={x.empresa_que_gano} /> ganó{" "}
          {plural(x.procesos_ganados_durante_la_sancion, "proceso", "procesos")}
          {monto(x.monto_soles)}. Falta confirmar su porcentaje en las dos empresas y que sean del mismo rubro.
        </Caso>
      ))}
      {c.variasEmpresasEnUnaEntidad.map((x, i) => (
        <Caso key={`e${i}`} titulo="Gana en una entidad con varias empresas" tono={x.con_90_dias_o_menos_entre_si > 0 ? "alta" : "media"}>
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
      {c.enInformeYDespuesCobro.map((x, i) => (
        <Caso key={`c${i}`} titulo="Figura en un informe de control y la entidad le pagó después" tono="media">
          El informe {x.informe ?? "sin número"} de <EnlaceEntidad ruc={x.entidad_ruc} nombre={x.entidad} />
          {x.fecha_del_informe ? `, del ${fechaConAnio(x.fecha_del_informe)},` : ""} la comprende con responsabilidad presunta. Esa entidad le dio{" "}
          {plural(x.ordenes_de_esa_entidad, "orden de servicio", "órdenes de servicio")}
          {monto(x.monto_soles)}
          {x.ultima_orden ? `; la última, el ${fechaConAnio(x.ultima_orden)}` : ""}. Falta ver cuántas son posteriores al informe.
        </Caso>
      ))}
    </ul>
  );
}

// ─── Cargos ──────────────────────────────────────────────────────────────────────────────────────

const COLUMNAS_PLANILLA: Columna[] = [
  { clave: "cargo", titulo: "Cargo y entidad", ancho: "minmax(0,1.6fr)" },
  { clave: "situacion", titulo: "Situación", ancho: "minmax(9rem,0.8fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "periodo", titulo: "Figura", ancho: "minmax(9rem,0.7fr)", desde: "md", apilar: "con-rotulo" },
  { clave: "regimen", titulo: "Régimen", ancho: "8rem", desde: "lg", apilar: "con-rotulo" },
  { clave: "sueldo", titulo: "Sueldo al mes", ancho: "7rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

function filaPlanilla(x: PlanillaDeLaPersona, i: number): Fila {
  const hoy = x.situacion === "hoy";
  const despues = !hoy && x.ultimoMesEntidad && x.ultimoMes && x.ultimoMesEntidad > x.ultimoMes;
  return {
    id: `planilla-${i}`,
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
        <CeldaTexto sub={despues ? `la planilla de la entidad llega a ${mes(x.ultimoMesEntidad)}` : undefined}>
          {hoy ? "En la planilla de hoy" : "Ya no figura"}
        </CeldaTexto>
      ),
      periodo: (
        <CeldaTexto sub={x.meses ? plural(x.meses, "mes publicado", "meses publicados") : undefined}>
          {x.primerMes && x.ultimoMes ? (x.primerMes === x.ultimoMes ? mes(x.primerMes) : `${mes(x.primerMes)} a ${mes(x.ultimoMes)}`) : "Sin fechas"}
        </CeldaTexto>
      ),
      regimen: <CeldaTexto>{x.regimen != null ? REGIMEN[Number(x.regimen)] ?? `Régimen ${x.regimen}` : "Sin dato"}</CeldaTexto>,
      sueldo: <CeldaNumero>{x.base != null ? solesCompacto(x.base) : <span className="font-sans text-mute">Sin dato</span>}</CeldaNumero>,
    },
  };
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
    buscable: `${x.cargo ?? ""} ${x.entidad ?? ""}`,
    celdas: {
      cargo: <CeldaPrincipal dosLineas titulo={cargoTexto(x.cargo)} meta={[<span key="e"><EnlaceEntidad ruc={x.entidadRuc} nombre={x.entidad} /></span>]} />,
      desde: <CeldaTexto sub={hasta ?? undefined}>{x.inicio ? `Desde el ${fechaConAnio(x.inicio)}` : "Sin fecha de inicio"}</CeldaTexto>,
      declaraciones: <CeldaNumero>{numero(x.declaraciones)}</CeldaNumero>,
      ultima: <span className="text-meta tabular-nums text-inkSoft">{x.ultima ? fechaConAnio(x.ultima) : "Sin fecha"}</span>,
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
          tam={20}
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
        <section className="space-y-2" data-bloque>
          <CabeceraPestana
            titulo="Candidaturas"
            ayuda={
              <Ayuda titulo="¿De dónde salen?">
                <span className="block">
                  Del Jurado Nacional de Elecciones: las listas de candidatos de las elecciones desde 2014. El resultado de 2022 no está completo
                  en esa fuente: «no electo» puede faltar a la verdad en ese año.
                </span>
              </Ayuda>
            }
          >
            Fue candidata {plural(candidaturas.length, "vez", "veces")} desde 2014{electa > 0 ? `; salió electa ${plural(electa, "vez", "veces")}` : ""}.
          </CabeceraPestana>
          <DatosClave
            items={candidaturas.map((c, i) => ({
              etiqueta: `${c.anio ?? "Sin año"}, ${cargoTexto(c.cargo)}${candidaturas.length > 1 ? ` (${i + 1})` : ""}`,
              valor: `${c.partido ? tituloNatural(c.partido) : "Organización sin nombre"}${lugarDe(c) ? `, ${lugarDe(c)}` : ""}${c.resultado ? `; ${c.resultado.toLowerCase()}` : ""}`,
            }))}
          />
        </section>
      )}
      {f.ordenes.length > 0 && (
        <section className="space-y-3" data-bloque>
          <CabeceraPestana titulo="Órdenes de servicio">
            Recibió órdenes de servicio como persona natural de {plural(f.ordenes.length, "entidad", "entidades")}. Cada fila abre su ficha de persona
            contratada.
          </CabeceraPestana>
          <Tabla columnas={COLUMNAS_ORDENES} filas={f.ordenes.map(filaOrden)} etiqueta="Órdenes de servicio como persona natural" />
        </section>
      )}
      {f.informes.length > 0 && (
        <section className="space-y-3" data-bloque>
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
        <section className="space-y-2" data-bloque>
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
        <section className="space-y-2" data-bloque>
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
