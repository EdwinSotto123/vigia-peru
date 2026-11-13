import type { Metadata } from "next";
import { canonica } from "@/lib/seo";
import type { ReactNode } from "react";
import Link from "next/link";
import { Clock, ExternalLink, FileWarning, Gavel, ShieldAlert } from "lucide-react";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaFiltrable, type Columna, type FilaFiltrable, type Indicador } from "@/components/listado";
import { BotonCsv, ConCsv } from "@/components/listado/Paginado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { BarraPartes } from "@/components/inicio/BarraPartes";
import { ContratosSemana, type Faceta } from "@/components/novedades/ContratosSemana";
import { SemanaASemana, type SemanaNueva } from "@/components/novedades/SemanaASemana";
import { Ayuda, AyudaTermino, CabeceraPestana, EncabezadoPagina, Franja, FuenteDato, Migas, Nota, Pagina, Pestanas, Seccion } from "@/components/patrones";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { API_BASE } from "@/lib/api-client";
import { TIPO_RESPONSABILIDAD } from "@/lib/corrupcion";
import { GRUPOS_CRUCE } from "@/lib/cruces";
import { BUSCADOR_CONTRALORIA } from "@/lib/fuentes";
import { fechaCorta, numero, oracion, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { regionDe } from "@/lib/regiones";
import { rutaContrato } from "@/lib/rutas";
import { diaLargo, diasDesde, rangoSemana } from "@/lib/semanas";

export const metadata: Metadata = {
  title: "Lo nuevo",
  description:
    "Lo último que publicó el Estado, semana a semana: los contratos que ganó alguien con un antecedente grave, los informes de la Contraloría y las sanciones del Tribunal.",
  alternates: canonica("/app/novedades"),
};

/**
 * /app/novedades — lo nuevo, por semana (rehecha el 2026-11-01; el dueño: «súper desordenado, ni siquiera se entiende, no
 * hay gráficas»). GET /novedades/semana. En este orden:
 *
 *   1. Qué tan al día está, en la cabecera: la semana que se ve es la última que el Estado ya publicó completa, y la
 *      fecha de la última buena pro (antes decía «hasta el 16 oct.» sin explicar nada).
 *   2. Semana a semana: la gráfica de las 12 últimas (2/3 del ancho), con las que siguen en curso y las que están en
 *      camino punteadas; cada columna abre su semana. Al lado (1/3), las cifras de la semana elegida: cuántos contratos
 *      graves DE CUÁNTAS buenas pro, cuánto suman, dónde, y los informes.
 *   3. Pestañas: Contratos (barras por antecedente y por región al costado de la lista, que la filtran; un contrato por
 *      proceso: antes se repetía una vez por empresa del consorcio), Informes de control (por tipo de responsabilidad) y
 *      Sanciones.
 *
 * Pedido del usuario del 2026-11-05: la página abría con un encabezado rojo y DEBAJO otra caja («Lo más reciente que
 * publicó…») con tres líneas sueltas y un cuarto vacío a la derecha: ~350 px antes del primer dato. La frescura va ahora
 * en la cabecera como un dato con su calendario, y las cifras al lado de la gráfica.
 *
 * La semana va en `?semana=` (su lunes) y la pestaña en `?ver=`.
 */

interface Ganador {
  ruc: string | null;
  nombre: string | null;
  persona: boolean;
}

interface ContratoNuevo {
  ocid: string;
  codigo: string | null;
  objeto: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  tipo: string | null;
  departamento: string | null;
  fecha: string;
  monto: number | null;
  consorcio: string | null;
  ganadores: Ganador[];
  cruces: { tipo: string; severidad: "alta" | "media" | "baja" }[];
  graves: string[];
}

interface Sancion {
  id: number;
  ruc: string;
  nombre: string | null;
  tipo: string | null;
  resolucion: string | null;
  fecha: string;
  desde: string | null;
  hasta: string | null;
  multa: number | null;
}

interface Informe {
  codigo: string;
  numero: string | null;
  titulo: string | null;
  entidad: string | null;
  entidadRuc: string | null;
  responsabilidades: string[] | null;
  fecha: string;
  url: string | null;
}

interface Semana {
  /** `completa`: false si se eligió una semana que todavía llega a medias (desde el 2026-11-05; antes no venía). */
  semana: { desde: string; hasta: string; completa?: boolean };
  ultimaCompleta: string;
  horizonte: string;
  semanas: SemanaNueva[];
  resumen: {
    buenasPro: number | null;
    conAntecedente: number | null;
    graves: number;
    monto: number;
    entidades: number;
    porTipo: { clave: string; n: number }[];
    porRegion: { clave: string; n: number }[];
    porContratacion: { clave: string; n: number; monto: number }[];
  };
  contratos: ContratoNuevo[];
  sanciones: Sancion[];
  sancionesUltima: string | null;
  informes: Informe[];
  informesUltima: string | null;
  fuentes: { sanciones: string };
}

const CRUCE = new Map(GRUPOS_CRUCE.flatMap((g) => g.tipos.map((t) => [t.tipo, t] as const)));
const nombreCruce = (tipo: string) => CRUCE.get(tipo)?.corto ?? tipo.replace(/_/g, " ");
const CONTRATACION: Record<string, string> = {
  obras: "Obras",
  bienes: "Bienes",
  servicios: "Servicios",
  consultoria: "Consultoría",
  convenio: "Convenio",
  sin_dato: "Sin tipo registrado",
};
const nombreContratacion = (t: string) => CONTRATACION[t] ?? oracion(t.replace(/_/g, " "));
const nombreRegion = (ubigeo: string) => (ubigeo === "sin_dato" ? "Sin región registrada" : regionDe(ubigeo)?.nombre ?? `Región ${ubigeo}`);
// Las mismas insignias que la pestaña «Control» de una entidad (InformesContraloria): penal en rojo, civil en ámbar.
const VARIANTE_RESP: Record<string, "crimson" | "amber"> = { penal: "crimson", civil: "amber" };

const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const PESTANAS = ["contratos", "informes", "sanciones"] as const;

async function getSemana(semana?: string): Promise<Semana | null> {
  const q = semana && /^\d{4}-\d{2}-\d{2}$/.test(semana) ? `?semana=${semana}` : "";
  try {
    const r = await fetch(`${API_BASE}/novedades/semana${q}`, { next: { revalidate: 1800 } } as RequestInit);
    return r.ok ? ((await r.json()) as Semana) : null;
  } catch {
    return null;
  }
}

export default async function NovedadesPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const pedida = uno(searchParams?.semana);
  const verUrl = uno(searchParams?.ver);
  const ver = PESTANAS.find((p) => p === verUrl);
  const d = await getSemana(pedida);
  // Los enlaces de la página conservan la semana y la pestaña que se están viendo. Uno que pide una pestaña la nombra
  // siempre (también «contratos», la primera: así la barra de pestañas cambia a ella) y baja hasta las listas.
  const enlace = (cambios: { semana?: string | null; ver?: string | null }) => {
    const p = new URLSearchParams();
    const semana = cambios.semana !== undefined ? cambios.semana : d && d.semana.desde !== d.ultimaCompleta ? d.semana.desde : null;
    const v = cambios.ver !== undefined ? cambios.ver : ver !== "contratos" ? ver : undefined;
    if (semana) p.set("semana", semana);
    if (v) p.set("ver", v);
    const s = p.toString();
    return `/app/novedades${s ? `?${s}` : ""}${cambios.ver ? "#listas" : ""}`;
  };

  const enCurso = d?.semana.completa === false;

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Lo nuevo", href: "/app/novedades" }]} />
      <EncabezadoPagina
        titulo="Lo nuevo"
        bajada={
          <>
            Lo último que publicó el Estado, semana a semana, y lo que Vigía encontró ahí: contratos que ganó alguien con un
            antecedente grave, informes de la Contraloría y sanciones del Tribunal.
            {d && <Frescura d={d} />}
          </>
        }
        // Si se eligió otra semana en la gráfica, la vuelta a la más reciente va con la cabecera (antes, en una caja aparte).
        acciones={
          d && d.semana.desde !== d.ultimaCompleta ? (
            <Link href={enlace({ semana: null })} scroll={false} className={claseAccion("secundario")}>
              Ver la más reciente
            </Link>
          ) : undefined
        }
      />
      {!d ? (
        <VacioEnLinea variante="compacta" tono="error">No pudimos leer lo nuevo ahora. Vuelve a intentarlo en un momento.</VacioEnLinea>
      ) : (
        <>
          <Seccion
            id="semana-a-semana"
            titulo="Semana a semana"
            descripcion="Cuántas buenas pro de cada semana las ganó alguien con un antecedente grave. Toca una columna para ver esa semana."
            ayuda={
              <Ayuda titulo="¿Cómo se cuenta?">
                Cada columna es una semana, de lunes a domingo (la fecha de abajo es su lunes): en gris, todas sus buenas pro; en
                rojo, las que ganó alguien con un antecedente grave. Un contrato cuenta en la semana de su buena pro, una sola vez
                aunque lo haya ganado un consorcio de varias empresas, y es grave si alguno de sus ganadores tiene un antecedente
                grave. El Estado publica las buenas pro con atraso: una de las últimas semanas sigue «en curso» (más clara y
                punteada) mientras sus contratos graves no lleguen a la mitad de lo habitual, la mediana de las 8 semanas
                anteriores. Las que todavía no traen nada van sólo con su contorno. El promedio cuenta sólo las completas.
              </Ayuda>
            }
          >
            {/* La gráfica en dos tercios y, al lado, las cifras de la semana elegida (en el celular, primero las cifras). */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
              <SemanaASemana semanas={d.semanas} elegida={d.semana.desde} href={(s) => enlace({ semana: s === d.ultimaCompleta ? null : s })} />
              <aside aria-labelledby="semana-elegida-t" className="order-first min-w-0 lg:order-none">
                <h3 id="semana-elegida-t" className="font-display text-bloque font-bold leading-tight text-ink">
                  Semana {rangoSemana(d.semana.desde)}
                  {enCurso && <span className="ml-1.5 text-meta font-semibold text-mute">(en curso)</span>}
                </h3>
                <Indicadores items={cifras(d, enlace)} className="mt-2" />
              </aside>
            </div>
          </Seccion>
          {/* El ancla de las cifras de arriba: abren su pestaña y bajan hasta aquí. */}
          <div id="listas" className="scroll-mt-4" />
          <Pestanas
            fija
            param="ver"
            activa={ver}
            etiqueta="Lo nuevo, por tipo"
            pestanas={[
              {
                clave: "contratos",
                etiqueta: "Contratos",
                conteo: d.resumen.graves,
                icono: <ShieldAlert size={15} aria-hidden />,
                titulo: "Contratos con un antecedente grave del ganador",
                contenido: <Contratos d={d} />,
              },
              {
                clave: "informes",
                etiqueta: "Informes de control",
                conteo: d.informes.length,
                icono: <FileWarning size={15} aria-hidden />,
                titulo: "Informes de control de la Contraloría",
                contenido: <Informes d={d} />,
              },
              {
                clave: "sanciones",
                etiqueta: "Sanciones del Tribunal",
                conteo: d.sanciones.length,
                icono: <Gavel size={15} aria-hidden />,
                titulo: "Sanciones del Tribunal de Contrataciones",
                contenido: <Sanciones d={d} />,
              },
            ]}
          />
          <Nota>
            Un antecedente es un dato oficial que coincide con quien ganó (una sanción, un vínculo, una visita, un sobrecosto): no
            prueba una irregularidad. La fecha de un contrato es la de su buena pro; la de un informe, la de su emisión; la de una
            sanción, la de su resolución.
          </Nota>
          <FuenteDato fuente="OECE (SEACE y CONOSCE), Tribunal de Contrataciones y Contraloría" />
        </>
      )}
    </Pagina>
  );
}

/**
 * Qué tan al día está, como una línea de datos en la cabecera (pedido del usuario del 2026-11-05: antes era otra caja bajo
 * la cabecera, con tres líneas sueltas): la semana que se ve, con su calendario, y la fecha de la última buena pro. Por
 * qué no es la semana de hoy, en su ⓘ. Va dentro de la bajada (un <p>): todo en spans.
 */
function Frescura({ d }: { d: Semana }) {
  const ultima = d.semana.desde === d.ultimaCompleta;
  const enCurso = d.semana.completa === false;
  const dias = diasDesde(d.horizonte);
  return (
    <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-meta text-inkSoft">
      <Dato tipo="fecha" nombre="Semana" className="font-semibold text-ink">
        {ultima
          ? `Lo más reciente completo: la semana ${rangoSemana(d.semana.desde)}`
          : `Estás viendo la semana ${rangoSemana(d.semana.desde)}${enCurso ? ", todavía en curso" : ""}`}
      </Dato>
      <Dato icono={Clock} nombre="Última buena pro">
        La última buena pro cargada es del {diaLargo(d.horizonte).replace(/^el /, "")}
        {dias > 1 ? ` (hace ${numero(dias)} días)` : ""}
      </Dato>
      <Ayuda titulo="¿Por qué no es la semana de hoy?">
        El Estado publica las buenas pro con atraso, y Vigía cruza cada una con los registros públicos apenas llega. Una semana
        cuenta como completa cuando sus contratos graves llegan por lo menos a la mitad de lo habitual (la mediana de las 8
        semanas anteriores). Hasta entonces se ve en la gráfica, punteada y «en curso», con lo que llegó hasta hoy, y las
        semanas siguientes aparecen aquí solas.
      </Ayuda>
    </span>
  );
}

/** Las cuatro cifras de la semana, cada una con su denominador; la de informes lleva a su pestaña. */
function cifras(d: Semana, enlace: (c: { ver?: string | null }) => string): Indicador[] {
  const r = d.resumen;
  const regiones = r.porRegion.filter((x) => x.clave !== "sin_dato").length;
  const parte = r.buenasPro ? (r.graves / r.buenasPro) * 100 : null;
  const obras = r.porContratacion.find((x) => x.clave === "obras");
  // Una semana en curso: sus cifras son lo que llegó hasta hoy, y se dice.
  const hastaHoy = d.semana.completa === false ? " hasta hoy" : "";
  return [
    {
      valor: r.graves ? numero(r.graves) : "Ninguno",
      etiqueta: r.graves === 1 ? "contrato con un antecedente grave" : "contratos con un antecedente grave",
      contexto: r.buenasPro
        ? `de ${numero(r.buenasPro)} buenas pro de la semana${hastaHoy} (${porcentaje(parte)})`
        : `buena pro en la semana${hastaHoy}`,
      tono: r.graves ? "alta" : "neutro",
      href: enlace({ ver: "contratos" }),
    },
    {
      valor: solesCompacto(r.monto),
      etiqueta: "lo que suman esos contratos",
      contexto: obras && r.monto > 0 ? `${porcentaje((obras.monto / r.monto) * 100)} en ${plural(obras.n, "obra", "obras")}` : "el monto adjudicado de esos contratos",
    },
    {
      valor: numero(r.entidades),
      etiqueta: r.entidades === 1 ? "entidad los adjudicó" : "entidades los adjudicaron",
      contexto: regiones ? `en ${plural(regiones, "región", "regiones")}` : undefined,
    },
    {
      valor: d.informes.length ? numero(d.informes.length) : "Ninguno",
      etiqueta: d.informes.length === 1 ? "informe de control" : "informes de control",
      contexto: d.informesUltima ? `de la Contraloría, el último mes publicado (hasta el ${fechaCorta(d.informesUltima)})` : "de la Contraloría",
      href: enlace({ ver: "informes" }),
    },
  ];
}

/** Quién ganó, en pocas palabras: el consorcio, la empresa, «una persona natural» o la primera y cuántas más. */
function quienGano(k: ContratoNuevo): string {
  if (k.consorcio) return tituloNatural(k.consorcio);
  const con = k.ganadores.filter((g) => g.nombre);
  const primero = con[0]?.nombre ? tituloNatural(con[0].nombre) : "Una persona natural";
  return k.ganadores.length > 1 ? `${primero} y ${plural(k.ganadores.length - 1, "otro ganador", "otros ganadores")}` : primero;
}

function Contratos({ d }: { d: Semana }) {
  const columnas: Columna[] = [
    { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1.6fr)" },
    { clave: "antecedentes", titulo: "Antecedentes del ganador", corto: "Antecedentes", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
    { clave: "monto", titulo: "Monto", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const filas: FilaFiltrable[] = d.contratos.map((k) => {
    const region = k.departamento ?? "sin_dato";
    const nombres = k.cruces.map((c) => nombreCruce(c.tipo));
    const gano = quienGano(k);
    return {
      id: k.ocid,
      href: rutaContrato(k.ocid),
      celdas: {
        contrato: (
          <CeldaPrincipal
            // Dos líneas, como en la lista de contratos: «qué se compra» es el dato de la fila.
            titulo={k.objeto ? oracion(k.objeto) : "Contrato sin objeto registrado"}
            dosLineas
            meta={[
              <Dato key="e" tipo="entidad" nombre="Entidad">{k.entidad ? tituloNatural(k.entidad) : "Sin entidad"}</Dato>,
              <Dato key="g" tipo="personas" nombre="Ganó">{gano}</Dato>,
              region !== "sin_dato" ? <Dato key="r" tipo="lugar" nombre="Región">{nombreRegion(region)}</Dato> : null,
              <Dato key="f" tipo="fecha" nombre="Buena pro">{fechaCorta(k.fecha)}</Dato>,
            ]}
          />
        ),
        antecedentes: <CrucesCelda cruces={k.cruces} />,
        monto: <CeldaNumero>{k.monto ? solesCompacto(k.monto) : "Sin monto"}</CeldaNumero>,
      },
      buscable: `${k.objeto ?? ""} ${k.entidad ?? ""} ${gano} ${k.ganadores.map((g) => g.nombre ?? "").join(" ")} ${nombres.join(" ")} ${nombreRegion(region)} ${k.codigo ?? ""}`,
      valores: { grave: k.graves, region, contratacion: k.tipo ?? "sin_dato" },
      claves: { graves: k.graves.length, monto: k.monto ?? 0, fecha: k.fecha },
      csv: {
        buena_pro: k.fecha,
        objeto: k.objeto,
        entidad: k.entidad,
        ruc_entidad: k.entidadRuc,
        region: nombreRegion(region),
        tipo: nombreContratacion(k.tipo ?? "sin_dato"),
        ganador: gano,
        ruc_ganadores: k.ganadores.map((g) => g.ruc).filter(Boolean).join("; "),
        monto: k.monto,
        antecedentes_graves: k.graves.map(nombreCruce).join("; "),
        otros_antecedentes: k.cruces.filter((c) => c.severidad !== "alta").map((c) => nombreCruce(c.tipo)).join("; "),
        ficha: rutaContrato(k.ocid),
      },
    };
  });
  const tipos: Faceta[] = d.resumen.porTipo.map((t) => ({ clave: t.clave, etiqueta: nombreCruce(t.clave), detalle: CRUCE.get(t.clave)?.explica }));
  const regiones: Faceta[] = d.resumen.porRegion.map((r) => ({ clave: r.clave, etiqueta: nombreRegion(r.clave) }));
  const contrataciones = [...new Set(d.contratos.map((k) => k.tipo ?? "sin_dato"))];

  return (
    <div className="space-y-4">
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Qué es un antecedente grave?">
            Un dato oficial sobre quien ganó que pesa: estaba inhabilitado por el Tribunal, un socio suyo trabaja en la entidad
            que le dio el contrato, la obra ya cuesta el doble de lo aprobado, recibió órdenes partidas para no pasar el tope de 8
            UIT, entre otros. Cada contrato abre su ficha con la evidencia de cada antecedente y su fuente.
          </Ayuda>
        }
      >
        Buena pro {rangoSemana(d.semana.desde, d.semana.hasta)}
        {d.semana.completa === false ? ", una semana todavía en curso: la lista crece mientras llegan sus buenas pro y sus cruces" : ""}. Un
        contrato por proceso: si lo ganó un consorcio, va una vez.
      </CabeceraPestana>
      {filas.length === 0 ? (
        <Franja icono={<ShieldAlert size={18} />} titulo={`Ningún contrato con un antecedente grave del ganador en la semana ${rangoSemana(d.semana.desde)}`} />
      ) : (
        <ContratosSemana
          filas={filas}
          columnas={columnas}
          tipos={tipos}
          regiones={regiones}
          archivo={`lo-nuevo-contratos-${d.semana.desde}`}
          filtros={
            contrataciones.length > 1
              ? [{ clave: "contratacion", etiqueta: "Tipo de contratación", corta: "Tipo de contratación", opciones: contrataciones.map((t) => ({ valor: t, etiqueta: nombreContratacion(t) })) }]
              : undefined
          }
        />
      )}
    </div>
  );
}

/** Un enlace a la fuente oficial con la forma de una acción (la de una `Franja`): se abre en otra pestaña. */
function AccionFuente({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={claseAccion("secundario")}>
      {children}
      <ExternalLink size={14} aria-hidden />
      <span className="sr-only"> (se abre en otra pestaña)</span>
    </a>
  );
}

/** La responsabilidad presunta que señala el informe, en insignias; sin ninguna registrada, «Sin dato». */
function Responsabilidades({ tipos }: { tipos: string[] | null }) {
  if (!tipos?.length) return <span className="text-meta text-mute">Sin dato</span>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Tipos de responsabilidad">
      {tipos.map((r) => (
        <li key={r}>
          <Badge variant={VARIANTE_RESP[r] ?? "neutral"}>{TIPO_RESPONSABILIDAD[r] ?? r}</Badge>
        </li>
      ))}
    </ul>
  );
}

function Informes({ d }: { d: Semana }) {
  const columnas: Columna[] = [
    { clave: "informe", titulo: "Informe", ancho: "minmax(0,1.6fr)" },
    { clave: "resp", titulo: "Responsabilidad presunta", corto: "Responsabilidad", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
    { clave: "fecha", titulo: "Emitido", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.informes.map((i) => ({
    id: i.codigo,
    href: i.entidadRuc ? `/entidad/${i.entidadRuc}?seccion=control` : undefined,
    celdas: {
      informe: (
        <CeldaPrincipal
          // En oración: la Contraloría manda casi todos los asuntos en mayúsculas.
          titulo={i.titulo ? oracion(i.titulo) : `Informe ${i.numero ?? i.codigo}`}
          dosLineas
          meta={[
            <Dato key="e" tipo="entidad" nombre="Entidad">{i.entidad ? tituloNatural(i.entidad) : "Sin entidad"}</Dato>,
            i.numero ? <Dato key="n" tipo="codigo" nombre="Informe" mono>{i.numero}</Dato> : null,
          ]}
        />
      ),
      resp: <Responsabilidades tipos={i.responsabilidades} />,
      fecha: <CeldaNumero>{fechaCorta(i.fecha)}</CeldaNumero>,
    },
    buscable: `${i.titulo ?? ""} ${i.entidad ?? ""} ${i.numero ?? ""}`,
    valores: { resp: i.responsabilidades ?? [] },
    claves: { fecha: i.fecha },
    csv: { emitido: i.fecha, informe: i.numero ?? i.codigo, titulo: i.titulo, entidad: i.entidad, ruc_entidad: i.entidadRuc, responsabilidades: (i.responsabilidades ?? []).join("; "), documento: i.url },
  }));
  // Cuántos informes señalan cada responsabilidad (uno puede señalar varias).
  const porResp = new Map<string, number>();
  for (const i of d.informes) for (const r of i.responsabilidades ?? []) porResp.set(r, (porResp.get(r) ?? 0) + 1);
  const sinResp = d.informes.filter((i) => !i.responsabilidades?.length).length;
  const desde = d.informesUltima ? new Date(new Date(`${d.informesUltima}T00:00:00Z`).getTime() - 29 * 86_400_000).toISOString().slice(0, 10) : null;

  return (
    <div className="space-y-4">
      <CabeceraPestana ayuda={<AyudaTermino clave="informe-control" />}>
        {d.informesUltima && desde
          ? `Emitidos ${rangoSemana(desde, d.informesUltima)}, el último mes que publicó la Contraloría. Cada uno abre los informes de su entidad, con su documento oficial.`
          : "Los informes de control del último mes que publicó la Contraloría."}
      </CabeceraPestana>
      {filas.length === 0 ? (
        <Franja
          icono={<FileWarning size={18} />}
          titulo="Ningún informe de control en el último mes publicado"
          accion={<AccionFuente href={BUSCADOR_CONTRALORIA}>Ver el buscador de la Contraloría</AccionFuente>}
        />
      ) : (
        <>
          {porResp.size > 0 && (
            <div className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
              <h3 className="font-display text-bloque font-bold leading-tight text-ink">Qué responsabilidad señalan</h3>
              <p className="mt-0.5 text-meta leading-snug text-mute">
                Presunta, según el informe: la decide después un juez, la entidad o la propia Contraloría. Un informe puede señalar varias.
              </p>
              <BarraPartes
                className="mt-3"
                etiqueta="Informes por tipo de responsabilidad"
                partes={[
                  ...Object.keys(TIPO_RESPONSABILIDAD)
                    .filter((r) => porResp.has(r))
                    .map((r) => ({
                      clave: r,
                      etiqueta: TIPO_RESPONSABILIDAD[r],
                      n: porResp.get(r) ?? 0,
                      clase: r === "penal" ? "bg-rust" : r === "civil" ? "bg-amber" : undefined,
                      destacada: r === "penal",
                    })),
                  ...(sinResp ? [{ clave: "sin", etiqueta: "Sin responsabilidad registrada", n: sinResp, clase: "bg-paperDeep" }] : []),
                ]}
              />
            </div>
          )}
          <ConCsv>
            <div className="space-y-3">
              <div className="flex justify-end">
                <BotonCsv archivo="lo-nuevo-informes" total={filas.length} />
              </div>
              <TablaFiltrable
                columnas={columnas}
                filas={filas}
                etiqueta={`${plural(filas.length, "informe", "informes")} (toca uno para ver los de su entidad)`}
                tam={10}
                nombre="informes"
                buscar={{ placeholder: "Buscar una entidad o un tema…", etiqueta: "Buscar entre los informes" }}
                // Los mismos nombres que las insignias (y que la pestaña «Control» de la entidad).
                filtros={[{ clave: "resp", etiqueta: "Responsabilidad presunta", corta: "Responsabilidad", opciones: Object.entries(TIPO_RESPONSABILIDAD).map(([valor, etiqueta]) => ({ valor, etiqueta })) }]}
              />
            </div>
          </ConCsv>
        </>
      )}
    </div>
  );
}

function Sanciones({ d }: { d: Semana }) {
  const columnas: Columna[] = [
    { clave: "empresa", titulo: "Empresa sancionada", ancho: "minmax(0,1fr)" },
    { clave: "fecha", titulo: "Resolución", ancho: "7rem", alinear: "der" },
  ];
  const filas: FilaFiltrable[] = d.sanciones.map((s) => ({
    id: String(s.id),
    href: `/empresa/${s.ruc}?seccion=antecedentes`,
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={s.nombre ? tituloNatural(s.nombre) : `Empresa con RUC ${s.ruc}`}
          meta={[
            <Dato key="t" tipo="tipo" nombre="Sanción">
              {s.tipo === "multa" ? `Multa${s.multa ? ` de ${solesCompacto(s.multa)}` : ""}` : s.tipo === "definitivo" ? "Inhabilitación definitiva" : "Inhabilitación temporal"}
            </Dato>,
            s.desde ? <Dato key="p" tipo="fecha" nombre="Vigencia">{s.hasta ? `${fechaCorta(s.desde)} a ${fechaCorta(s.hasta)}` : `Desde ${fechaCorta(s.desde)}`}</Dato> : null,
            s.resolucion ? <Dato key="r" tipo="documento" nombre="Resolución">{s.resolucion}</Dato> : null,
          ]}
        />
      ),
      fecha: <CeldaNumero>{fechaCorta(s.fecha)}</CeldaNumero>,
    },
    buscable: `${s.nombre ?? ""} ${s.ruc} ${s.resolucion ?? ""}`,
    valores: { tipo: s.tipo ?? "" },
    claves: { fecha: s.fecha },
    csv: { resolucion_fecha: s.fecha, empresa: s.nombre, ruc: s.ruc, tipo: s.tipo, resolucion: s.resolucion, desde: s.desde, hasta: s.hasta, multa: s.multa },
  }));
  // El registro del OECE no se actualiza hace rato (mayo de 2026): se dice arriba, no se esconde tras un «Ninguna».
  const atraso = d.sancionesUltima ? diasDesde(d.sancionesUltima) : null;
  const vieja = atraso != null && atraso > 45;

  return (
    <div className="space-y-4">
      <CabeceraPestana ayuda={<AyudaTermino clave="tribunal-contrataciones" />}>
        Multas e inhabilitaciones a empresas del último mes que publicó el OECE. Cada una abre los antecedentes de la empresa.
      </CabeceraPestana>
      {d.sancionesUltima && vieja && (
        <Franja
          icono={<Gavel size={18} />}
          titulo={`El registro de sancionados del OECE no trae resoluciones nuevas desde ${diaLargo(d.sancionesUltima)}`}
          accion={<AccionFuente href={d.fuentes.sanciones}>Ver el registro del OECE</AccionFuente>}
        >
          Lo que ves abajo es su último mes publicado. Vigía revisa el registro cada semana: cuando el OECE publique sanciones
          nuevas, aparecen aquí y en los antecedentes de cada empresa.
        </Franja>
      )}
      {filas.length === 0 ? (
        <Franja
          icono={<Gavel size={18} />}
          titulo="Ninguna sanción a empresas en el último mes publicado"
          accion={<AccionFuente href={d.fuentes.sanciones}>Ver el registro del OECE</AccionFuente>}
        >
          Es lo que trae el registro de proveedores sancionados que publica el OECE. Su última actualización está en{" "}
          <Link href="/fuentes" className="font-medium text-ink underline underline-offset-2 hover:text-granate">
            De dónde salen los datos
          </Link>
          .
        </Franja>
      ) : (
        <ConCsv>
          <div className="space-y-3">
            <div className="flex justify-end">
              <BotonCsv archivo="lo-nuevo-sanciones" total={filas.length} />
            </div>
            <TablaFiltrable columnas={columnas} filas={filas} etiqueta="Empresas sancionadas (toca una para ver sus antecedentes)" tam={10} nombre="sanciones" />
            <FuenteDato fuente="Proveedores sancionados (OECE, datos abiertos)" href={d.fuentes.sanciones} />
          </div>
        </ConCsv>
      )}
    </div>
  );
}
