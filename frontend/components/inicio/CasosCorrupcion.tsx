"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Info } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { EnlaceFuente } from "@/components/patrones/Estructura";
import { CeldaFecha, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Buscador } from "@/components/listado/BarraFiltros";
import { Badge } from "@/components/ui/Badge";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { TAM_INFORMES, TIPO_RESPONSABILIDAD, paginaCorrupcion, type Corrupcion, type InformeControl, type InformesControl, type PaginaInformes, type TipoInforme } from "@/lib/corrupcion";
import { fechaCorta, numero, solesCompacto } from "@/lib/formato";
import { BUSCADOR_CONTRALORIA } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { limpiarObjeto } from "@/components/contratos/recortar";
import { BloqueInicio, SinDato } from "./BloquesInicio";

/**
 * "Casos de corrupción" del Inicio (región, partido), con los rótulos de docs/CORRUPCION.md y en dos partes que nunca
 * se suman:
 *   · Procuraduría Anticorrupción: lo COMPROBADO (casos con sentencia firme, en ejecución de sentencia) y los casos en
 *     trámite, en cifras; por sede, que es casi siempre un departamento. Con su tabla de sedes si hay más de una.
 *   · Contraloría: sus cifras y TODOS los informes con responsabilidad PRESUNTA en una tabla paginada, filtrable por
 *     tipo; cada fila abre el informe oficial (el PDF nombra a los funcionarios: se enlaza, no se copia).
 * `ruta` es la de la API (lib/corrupcion.ts, rutaCorrupcion): la tabla pide ahí las páginas siguientes.
 *
 * La ficha de una ENTIDAD ya no usa este bloque (ocupaba ~1,850 px de su Inicio, ~600 de ellos con cifras de la
 * Procuraduría que, como decía su nota, no eran de esa entidad): su Inicio lleva `ResumenContraloria` (cuatro cifras y
 * los tres informes más recientes) y la tabla entera va en su pestaña «Control» (`InformesContraloria`). La
 * Procuraduría publica por sede (distrito fiscal), no por entidad agraviada: la entidad enlaza a la ficha de su región,
 * que es donde esas cifras significan algo (el usuario leyó las de Lima en la ficha de la UNI como si fueran de la UNI,
 * 2026-10-22).
 */
export function CasosCorrupcion({
  datos,
  ruta,
  ambito,
  nombreRegion,
  nota,
}: {
  datos: Corrupcion | null | undefined;
  ruta: string;
  /** De quién es la sección: cambia los textos y si se muestra la Procuraduría (no hay cifras por partido). */
  ambito: "entidad" | "region" | "partido";
  nombreRegion?: string | null;
  /** Una advertencia bajo el título de la Contraloría (la usa el partido). */
  nota?: string;
}) {
  return (
    <BloqueInicio
      ancho
      titulo="Casos de corrupción"
      ayuda={
        <Ayuda titulo="¿De dónde salen y qué significan?">
          <span className="block">
            <strong>Procuraduría Anticorrupción</strong> (Procuraduría General del Estado): los casos penales por
            corrupción en los que el Estado es la parte agraviada. «Con sentencia firme» son los que están en ejecución de
            sentencia: ya hay una decisión firme y se cobra la reparación. Publica sus cifras por sede, casi siempre un
            departamento.
          </span>
          <span className="mt-2 block">
            <strong>Contraloría</strong>: informes de control que señalan una responsabilidad presunta (penal, civil o
            administrativa) de funcionarios y la derivan a quien corresponde. No es una condena.
          </span>
          <span className="mt-2 block">Las dos fuentes van por separado y nunca se suman.</span>
        </Ayuda>
      }
    >
      {datos === undefined ? (
        <SinDato>Cargando…</SinDato>
      ) : datos === null ? (
        <SinDato>Sin dato: el servicio no respondió.</SinDato>
      ) : (
        <div className="space-y-6">
          {ambito === "entidad" ? (
            <>
              <Contraloria datos={datos} ruta={ruta} ambito={ambito} nota={nota} />
              <Procuraduria datos={datos} ambito={ambito} nombreRegion={nombreRegion} />
            </>
          ) : (
            <>
              {ambito !== "partido" && <Procuraduria datos={datos} ambito={ambito} nombreRegion={nombreRegion} />}
              <Contraloria datos={datos} ruta={ruta} ambito={ambito} nota={nota} />
            </>
          )}
        </div>
      )}
    </BloqueInicio>
  );
}

function Subtitulo({ titulo, bajada }: { titulo: string; bajada: string }) {
  return (
    <div className="mb-3">
      <h4 className="text-dato font-semibold text-ink">{titulo}</h4>
      <p className="text-meta text-mute">{bajada}</p>
    </div>
  );
}

function Procuraduria({ datos, ambito, nombreRegion }: { datos: Corrupcion; ambito: "entidad" | "region"; nombreRegion?: string | null }) {
  const pp = datos.procuraduria;
  const deEntidad = ambito === "entidad";
  const donde = nombreRegion ?? "su departamento";
  return (
    <section>
      <Subtitulo
        titulo={deEntidad ? `Procuraduría Anticorrupción en todo ${donde}` : "Procuraduría Anticorrupción"}
        bajada={deEntidad ? `De todas las entidades públicas de ${donde} juntas, no sólo de esta.` : "Lo comprobado: casos con sentencia firme."}
      />
      {deEntidad && (
        <p role="note" className="mb-3 flex max-w-3xl gap-2 rounded-xl border border-line bg-paperSoft px-3.5 py-2.5 text-meta leading-snug text-inkSoft">
          <Info size={15} className="mt-0.5 shrink-0 text-mute" aria-hidden />
          <span>
            Estas cifras no son de esta entidad: son de todas las entidades públicas de {donde} (ministerios, municipalidades,
            universidades, hospitales…). La Procuraduría publica sus casos por sede y no por entidad agraviada, así que no se
            puede saber cuántos son de esta entidad. Lo que sí es de esta entidad son los informes de la Contraloría, arriba.
          </span>
        </p>
      )}
      {!pp ? (
        <SinDato>La Procuraduría no publica una sede para este departamento en su último boletín.</SinDato>
      ) : (
        <div className="space-y-3">
          <Indicadores
            items={[
              { valor: numero(pp.en_ejecucion), etiqueta: deEntidad ? `con sentencia firme en ${donde}` : "con sentencia firme", contexto: "en ejecución de sentencia", tono: "alta" },
              { valor: numero(pp.en_tramite), etiqueta: deEntidad ? `casos en trámite en ${donde}` : "casos en trámite", contexto: "incluye los de sentencia firme" },
              { valor: pp.sentencias != null ? numero(pp.sentencias) : null, etiqueta: "sentencias en el año", contexto: "condenas o decisiones firmes nuevas" },
              { valor: pp.reparacion_civil != null ? solesCompacto(pp.reparacion_civil) : null, etiqueta: "reparación cobrada", contexto: "en el año" },
            ]}
          />
          {pp.sedes.length > 1 && (
            <Tabla
              etiqueta="Casos de la Procuraduría por sede"
              densidad="compacta"
              medida="contenedor"
              columnas={COLUMNAS_SEDES}
              filas={pp.sedes.map((s) => ({
                id: s.sede,
                celdas: {
                  sede: <CeldaPrincipal titulo={s.sede} enLinea />,
                  firme: <span className="font-mono text-meta tabular-nums text-ink">{numero(s.en_ejecucion)}</span>,
                  tramite: <span className="font-mono text-meta tabular-nums text-inkSoft">{numero(s.en_tramite)}</span>,
                },
              }))}
            />
          )}
          <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 text-meta">
            <div className="flex gap-1.5">
              <dt className="text-mute">Corte</dt>
              <dd className="text-ink">{fechaCorta(pp.corte)}</dd>
            </div>
            {pp.sedes.length > 1 && (
              <div className="flex gap-1.5">
                <dt className="text-mute">Sedes</dt>
                <dd className="text-ink">{numero(pp.sedes.length)}</dd>
              </div>
            )}
            {pp.url_fuente && (
              <EnlaceFuente href={pp.url_fuente} className="min-h-8">
                Boletín oficial (PDF)
              </EnlaceFuente>
            )}
          </dl>
        </div>
      )}
    </section>
  );
}

// En el celular las cifras van bajo el nombre de la sede, con su rótulo: con las tres columnas a la vista, la sede
// quedaba en 34 px y se leía «1,909 / 7,592» sin saber de qué sede.
const COLUMNAS_SEDES: Columna[] = [
  { clave: "sede", titulo: "Sede", ancho: "minmax(0,1fr)" },
  { clave: "firme", titulo: "Con sentencia firme", corto: "Sentencia firme", ancho: "150px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "tramite", titulo: "En trámite", ancho: "110px", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

const VARIANTE: Record<string, "crimson" | "amber" | "neutral"> = { penal: "crimson", civil: "amber" };

/**
 * Las columnas de la tabla de informes. Con `conEntidad` (región, partido) la entidad de cada informe va en su columna
 * desde lg y, antes, debajo del asunto: en el celular se perdía de qué entidad era cada informe.
 */
function columnasInformes(conEntidad: boolean): Columna[] {
  return [
    { clave: "fecha", titulo: "Fecha", ancho: "92px", desde: "md", apilar: true },
    { clave: "numero", titulo: "Informe", ancho: "148px", desde: "lg" },
    { clave: "asunto", titulo: "Asunto", ancho: "minmax(0,1.5fr)" },
    ...(conEntidad ? [{ clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)", desde: "lg" as const, apilar: true }] : []),
    { clave: "tipo", titulo: "Responsabilidad presunta", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
  ];
}

/** Una fila por informe: abre el informe oficial (el PDF nombra a los funcionarios: se enlaza, no se copia). */
function filaInforme(i: InformeControl): Fila {
  return {
    id: i.numero,
    href: i.urlPdf ?? undefined,
    externo: true,
    celdas: {
      fecha: <CeldaFecha fecha={i.fecha} />,
      numero: <span className="font-mono text-meta text-inkSoft">{i.numero}</span>,
      asunto: (
        <CeldaPrincipal
          titulo={i.titulo ? tituloNatural(limpiarObjeto(i.titulo)) : "Sin asunto registrado"}
          dosLineas
          meta={[i.funcionarios ? <Dato key="f" tipo="personas" nombre="Funcionarios comprendidos">{numero(i.funcionarios)} funcionarios comprendidos</Dato> : null]}
        />
      ),
      entidad: (
        <Dato tipo="entidad" className="line-clamp-2 text-meta text-inkSoft">
          {i.entidad ? tituloNatural(i.entidad) : "Sin dato"}
        </Dato>
      ),
      tipo: (
        <ul className="flex flex-wrap gap-1" aria-label="Tipos de responsabilidad">
          {i.responsabilidades.map((r) => (
            <li key={r}><Badge variant={VARIANTE[r] ?? "neutral"}>{TIPO_RESPONSABILIDAD[r] ?? r}</Badge></li>
          ))}
        </ul>
      ),
    },
  };
}

/** Las cuatro cifras de la Contraloría: cuántos informes, cuántos con responsabilidad penal o civil y a cuántos funcionarios. */
function cifrasInformes(inf: InformesControl, conEntidad: boolean): Indicador[] {
  return [
    { valor: numero(inf.total), etiqueta: "informes de control", contexto: inf.desde ? `de ${inf.desde.slice(0, 4)} a ${inf.hasta?.slice(0, 4)}` : undefined },
    { valor: numero(inf.penal), etiqueta: "con presunta responsabilidad penal", tono: "alta" },
    { valor: numero(inf.civil), etiqueta: "con presunta responsabilidad civil", tono: "media" },
    { valor: numero(inf.funcionarios), etiqueta: "funcionarios comprendidos", contexto: conEntidad ? `en ${numero(inf.entidades)} entidades` : undefined },
  ];
}

/**
 * Lo de la Contraloría en el Inicio de una entidad: las cuatro cifras, los tres informes más recientes y el enlace a
 * la pestaña con todos. `href` es esa pestaña (`?seccion=control`).
 */
export function ResumenContraloria({ informes, href }: { informes: InformesControl; href: string }) {
  // Los tres más recientes (la API los ordena por fecha); todos, con buscador y filtros, en la pestaña.
  const recientes = informes.pagina.filas.slice(0, 3);
  return (
    <div className="space-y-4">
      <Indicadores items={cifrasInformes(informes, false)} apilado />
      <Tabla columnas={columnasInformes(false)} filas={recientes.map(filaInforme)} etiqueta="Los informes más recientes de la Contraloría" medida="contenedor" />
      {informes.total > recientes.length && (
        <Link href={href} prefetch={false} className="inline-flex min-h-9 items-center gap-0.5 text-meta font-semibold text-granate underline-offset-4 hover:underline">
          Ver los {numero(informes.total)} informes <ChevronRight size={14} aria-hidden />
        </Link>
      )}
    </div>
  );
}

/**
 * Todos los informes de la Contraloría, con buscador, filtro por tipo de responsabilidad y paginación (las páginas se
 * piden a la API). `conTitulo={false}` cuando ya lo pone la cabecera de la pestaña (la ficha de la entidad).
 */
export function InformesContraloria({ datos, ruta, ambito, nota, conTitulo = true }: { datos: Corrupcion | null; ruta: string; ambito: "entidad" | "region" | "partido"; nota?: string; conTitulo?: boolean }) {
  if (!datos) return <SinDato>Sin dato: el servicio de la Contraloría no respondió.</SinDato>;
  return <Contraloria datos={datos} ruta={ruta} ambito={ambito} nota={nota} conTitulo={conTitulo} />;
}

function Contraloria({ datos, ruta, ambito, nota, conTitulo = true }: { datos: Corrupcion; ruta: string; ambito: "entidad" | "region" | "partido"; nota?: string; conTitulo?: boolean }) {
  const inf = datos.informes;
  const [tipo, setTipo] = useState<TipoInforme | null>(null);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState<PaginaInformes>(inf.pagina);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);

  const pedir = async (page: number, t: TipoInforme | null, q: string) => {
    setCargando(true);
    setFallo(false);
    const r = await paginaCorrupcion(ruta, page, t, q || null);
    if (r) setPagina(r);
    else setFallo(true);
    setCargando(false);
  };
  const filtrar = (t: TipoInforme | null) => {
    setTipo(t);
    void pedir(1, t, busca);
  };
  const buscar = (q: string) => {
    setBusca(q);
    void pedir(1, tipo, q);
  };

  const conEntidad = ambito !== "entidad";
  const columnas = columnasInformes(conEntidad);
  const filas: Fila[] = pagina.filas.map(filaInforme);
  const opciones: { t: TipoInforme | null; etiqueta: string; n: number }[] = [
    { t: null, etiqueta: "Todos", n: inf.total },
    { t: "penal", etiqueta: "Penal", n: inf.penal },
    { t: "civil", etiqueta: "Civil", n: inf.civil },
    { t: "administrativa", etiqueta: "Administrativa", n: inf.administrativa },
  ];
  const paginas = Math.max(1, Math.ceil(pagina.total / TAM_INFORMES));

  return (
    <section>
      {conTitulo && (
        <Subtitulo
          titulo={ambito === "entidad" ? "Contraloría: informes sobre esta entidad" : "Contraloría"}
          bajada={ambito === "entidad" ? "Presunta responsabilidad de sus funcionarios: no es una condena." : "Presunta responsabilidad de funcionarios: no es una condena."}
        />
      )}
      {nota && <p className="-mt-1 mb-3 max-w-3xl text-meta text-mute">{nota}</p>}
      {inf.total === 0 ? (
        <SinDato>
          {ambito === "entidad"
            ? "La Contraloría no tiene informes con responsabilidad sobre esta entidad en su buscador."
            : "La Contraloría no tiene informes con responsabilidad en su buscador para este alcance."}
        </SinDato>
      ) : (
        <div className="space-y-4">
          <Indicadores items={cifrasInformes(inf, conEntidad)} />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Buscador
              placeholder="Buscar un asunto, un número de informe o una entidad…"
              etiqueta="Buscar en los informes de la Contraloría"
              valor={busca}
              min={2}
              onBuscar={buscar}
            />
            <div role="group" aria-label="Filtrar por tipo de responsabilidad" className="inline-flex flex-wrap gap-1.5">
              {opciones.map((o) => (
                <button
                  key={o.etiqueta}
                  type="button"
                  aria-pressed={tipo === o.t}
                  onClick={() => filtrar(o.t)}
                  className={
                    "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3.5 text-meta font-semibold transition-colors " +
                    (tipo === o.t ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink")
                  }
                >
                  {o.etiqueta}
                  <span className={"font-mono text-rotulo tabular-nums " + (tipo === o.t ? "text-paper/80" : "text-mute")}>{numero(o.n)}</span>
                </button>
              ))}
            </div>
            <Paginacion
              actual={pagina.page}
              paginas={paginas}
              total={pagina.total}
              tam={TAM_INFORMES}
              navegacion="interna"
              onChange={(n) => void pedir(n, tipo, busca)}
              cargando={cargando}
              nombre="informes"
            />
          </div>
          {fallo ? (
            <SinDato>No pudimos traer esa página. Vuelve a intentarlo.</SinDato>
          ) : busca && pagina.total === 0 ? (
            <SinDato>Ningún informe coincide con “{busca}”.</SinDato>
          ) : (
            <div className={cargando ? "opacity-60 transition-opacity" : undefined} aria-busy={cargando}>
              <Tabla columnas={columnas} filas={filas} etiqueta="Informes de control de la Contraloría" medida="contenedor" />
            </div>
          )}
          <p className="text-rotulo text-mute">
            Cada fila abre el informe oficial en la Contraloría. Todos están también en su{" "}
            <EnlaceFuente href={BUSCADOR_CONTRALORIA}>buscador de informes</EnlaceFuente>.
          </p>
        </div>
      )}
    </section>
  );
}
