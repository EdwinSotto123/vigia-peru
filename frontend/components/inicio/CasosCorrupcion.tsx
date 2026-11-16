"use client";

import Link from "next/link";
import { useState } from "react";
import { Info, ListChecks } from "lucide-react";
import { Ayuda } from "@/components/patrones/Ayuda";
import { AyudaTermino } from "@/components/patrones/AyudaTermino";
import { EnlaceFuente } from "@/components/patrones/Estructura";
import { CeldaFecha, CeldaPrincipal, CodigoFila, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Buscador } from "@/components/listado/BarraFiltros";
import { Dato } from "@/components/ui/Dato";
import { Paginacion } from "@/components/ui/Paginacion";
import { BuscadorControl } from "@/components/control/BuscadorControl";
import { asuntoDe, detalleDeInforme, rucEntidad } from "@/components/control/DetalleInforme";
import { ChipsResponsabilidad } from "@/components/control/piezas";
import { TAM_INFORMES, cuentasDeFicha, paginaCorrupcion, tipoServicioCorto, type Corrupcion, type InformeControl, type InformesControl, type PaginaInformes, type TipoInforme } from "@/lib/corrupcion";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { BUSCADOR_CONTRALORIA } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { BloqueInicio, SinDato, SinRespuesta } from "./BloquesInicio";

/**
 * "Casos de corrupción" del Inicio (región, partido), con los rótulos de docs/CORRUPCION.md y en dos partes que nunca
 * se suman:
 *   · Procuraduría Anticorrupción: lo COMPROBADO (casos con sentencia firme, en ejecución de sentencia) y los casos en
 *     trámite, en cifras; por sede, que es casi siempre un departamento. Con su tabla de sedes si hay más de una.
 *   · Contraloría: sus cifras y TODOS los informes con responsabilidad PRESUNTA en una tabla paginada, filtrable por
 *     tipo. Desde el 2026-11-16 cada fila dice lo que trae su Ficha Resumen (tipo de servicio, observaciones, funcionarios
 *     comprendidos) y abre su panel lateral (components/control/DetalleInforme.tsx): lo que encontró, a quiénes comprende
 *     con su responsabilidad presunta (un apellido tapado) y, al pie, la Ficha Resumen y el informe completo.
 * `ruta` es la de la API (lib/corrupcion.ts, rutaCorrupcion): la tabla pide ahí las páginas siguientes.
 *
 * La ficha de una ENTIDAD ya no usa este bloque (ocupaba ~1,850 px de su Inicio, ~600 de ellos con cifras de la
 * Procuraduría que, como decía su nota, no eran de esa entidad): su Inicio lleva una fila de «Ver más» con sus informes y
 * la tabla entera va en su pestaña «Control» (`InformesContraloria`). Desde el 2026-11-13 la región y el partido también
 * tienen su pestaña «Control» (`sinMarco`); el bloque con su tarjeta queda para el panel de zona del mapa. La
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
  sinMarco = false,
  reintentar = "",
}: {
  datos: Corrupcion | null | undefined;
  ruta: string;
  /** De quién es la sección: cambia los textos y si se muestra la Procuraduría (no hay cifras por partido). */
  ambito: "entidad" | "region" | "partido";
  nombreRegion?: string | null;
  /** Una advertencia bajo el título de la Contraloría (la usa el partido). */
  nota?: string;
  /** Sin su tarjeta ni su título: la pestaña «Control» de la región o del partido ya los pone (`CabeceraPestana`). */
  sinMarco?: boolean;
  /** La URL que vuelve a pedir la página si el servicio no respondió (vacía: la misma). */
  reintentar?: string;
}) {
  // El servicio no respondió ESTA vez: una línea con «Reintentar», no una tarjeta entera con su título y «Sin dato: el
  // servicio no respondió» pintado como si fuera el contenido (auditoría del 2026-11-13, la ficha de un partido).
  if (datos === null) {
    return (
      <SinRespuesta href={reintentar}>
        {ambito === "region" ? "Los informes de control y los casos judiciales no respondieron ahora." : "Los informes de control no respondieron ahora."}
      </SinRespuesta>
    );
  }
  if (sinMarco) {
    return datos === undefined ? (
      <SinDato>Cargando…</SinDato>
    ) : (
      <div className="space-y-8">
        {ambito !== "partido" && ambito !== "entidad" && <Procuraduria datos={datos} ambito={ambito} nombreRegion={nombreRegion} />}
        <Contraloria datos={datos} ruta={ruta} ambito={ambito} nota={nota} />
      </div>
    );
  }
  return (
    <BloqueInicio
      ancho
      titulo="Informes de control y casos judiciales"
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

/**
 * Las columnas de la tabla de informes. Con `conEntidad` (región, partido) la entidad de cada informe va en su columna
 * desde lg y, antes, debajo del asunto: en el celular se perdía de qué entidad era cada informe. El número del informe va
 * al comienzo de la línea de abajo del asunto (`CodigoFila`), en todo ancho: antes era una columna desde lg y, en la
 * región y el partido, el enlace al PDF (ahora los documentos van al pie del panel de cada informe).
 */
function columnasInformes(conEntidad: boolean): Columna[] {
  // El informe se lleva el ancho (su línea de abajo dice el número, el servicio, las observaciones y los comprendidos): a
  // 1440 px entra en un renglón. Las responsabilidades son dos o tres chips.
  return [
    { clave: "fecha", titulo: "Fecha", ancho: "92px", desde: "md", apilar: true },
    { clave: "asunto", titulo: "Informe", ancho: "minmax(0,2.2fr)" },
    ...(conEntidad ? [{ clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)", desde: "lg" as const, apilar: true }] : []),
    { clave: "tipo", titulo: "Responsabilidad presunta", ancho: "minmax(0,1fr)", desde: "md", apilar: true, ayuda: <AyudaTermino clave="responsabilidad-presunta" /> },
  ];
}

/**
 * Una fila por informe: su asunto y, debajo, el número, el tipo de servicio, cuántas observaciones y a cuántos
 * funcionarios comprende (de su Ficha Resumen, si Vigía ya la leyó; si no, el conteo del buscador de la Contraloría). La
 * fila abre su panel lateral, sin salir de la página (pedido del dueño del 2026-11-16): lo que encontró, a quiénes y con
 * qué responsabilidad presunta, y los documentos de la Contraloría. Con la entidad (región, partido), su nombre es un
 * enlace a su ficha dentro de la fila (`enlaces`: la fila es una capa debajo, y el enlace se toca solo).
 */
function filaInforme(i: InformeControl, conEntidad = false): Fila {
  const ruc = rucEntidad(i.entidadRuc);
  const nombreEntidad = i.entidad ? tituloNatural(i.entidad) : null;
  const { observaciones, comprendidos } = cuentasDeFicha(i);
  const servicio = tipoServicioCorto(i.ficha?.tipoServicio);
  return {
    id: i.codigo || i.numero,
    enlaces: conEntidad && !!ruc,
    celdas: {
      fecha: <CeldaFecha fecha={i.fecha} />,
      asunto: (
        <CeldaPrincipal
          titulo={asuntoDe(i.titulo)}
          dosLineas
          metaEnVarias
          // Cada dato entero en su renglón: «3 funcionarios / comprendidos» partido en dos se leía mal.
          meta={[
            <CodigoFila key="n" codigo={i.numero} nombre="Informe N.°" />,
            servicio ? (
              <Dato key="s" tipo="servicio" className="whitespace-nowrap">
                {servicio}
              </Dato>
            ) : null,
            observaciones ? (
              <Dato key="o" icono={ListChecks} nombre="Lo que encontró" className="whitespace-nowrap">
                {plural(observaciones, "observación", "observaciones")}
              </Dato>
            ) : null,
            comprendidos ? (
              <Dato key="f" tipo="personas" nombre="Funcionarios comprendidos" className="whitespace-nowrap">
                {plural(comprendidos, "funcionario comprendido", "funcionarios comprendidos")}
              </Dato>
            ) : null,
          ]}
        />
      ),
      entidad: (
        <Dato tipo="entidad" className="line-clamp-2 text-meta text-inkSoft">
          {nombreEntidad && ruc && conEntidad ? (
            <Link href={`/entidad/${ruc}`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
              {nombreEntidad}
            </Link>
          ) : (
            nombreEntidad ?? "Sin dato"
          )}
        </Dato>
      ),
      tipo: <ChipsResponsabilidad tipos={i.responsabilidades} etiqueta="Tipos de responsabilidad presunta" />,
    },
    detalle: detalleDeInforme(
      {
        codigo: i.codigo || i.numero,
        numero: i.numero,
        titulo: i.titulo,
        fecha: i.fecha,
        entidad: i.entidad,
        entidadRuc: i.entidadRuc,
        responsabilidades: i.responsabilidades,
        funcionarios: i.funcionarios,
        urlPdf: i.urlPdf,
        ficha: i.ficha ?? null,
      },
      { conEntidad },
    ),
  };
}

/** Las cuatro cifras de la Contraloría: cuántos informes, cuántos con responsabilidad penal o civil y a cuántos funcionarios. */
function cifrasInformes(inf: InformesControl, conEntidad: boolean): Indicador[] {
  return [
    { valor: numero(inf.total), etiqueta: "informes de control", contexto: inf.desde ? `de ${inf.desde.slice(0, 4)} a ${inf.hasta?.slice(0, 4)}` : undefined },
    { valor: numero(inf.penal), etiqueta: "con presunta responsabilidad penal", tono: "alta" },
    { valor: numero(inf.civil), etiqueta: "con presunta responsabilidad civil", tono: "media" },
    {
      valor: numero(inf.funcionarios),
      etiqueta: inf.funcionarios === 1 ? "funcionario comprendido" : "funcionarios comprendidos",
      contexto: conEntidad ? `en ${plural(inf.entidades, "entidad", "entidades")}` : undefined,
    },
  ];
}

/**
 * Todos los informes de la Contraloría, con buscador, filtro por tipo de responsabilidad y paginación (las páginas se
 * piden a la API). `conTitulo={false}` cuando ya lo pone la cabecera de la pestaña (la ficha de la entidad). Con
 * `buscarEn` (la ficha de una entidad), arriba de la lista va «Buscar en lo que encontró la Contraloría» en sus informes.
 */
export function InformesContraloria({
  datos,
  ruta,
  ambito,
  nota,
  conTitulo = true,
  buscarEn,
}: {
  datos: Corrupcion | null;
  ruta: string;
  ambito: "entidad" | "region" | "partido";
  nota?: string;
  conTitulo?: boolean;
  buscarEn?: { ruc: string; nombre?: string | null };
}) {
  if (!datos) return <SinRespuesta href="">Los informes de la Contraloría no respondieron ahora.</SinRespuesta>;
  return <Contraloria datos={datos} ruta={ruta} ambito={ambito} nota={nota} conTitulo={conTitulo} buscarEn={buscarEn} />;
}

function Contraloria({
  datos,
  ruta,
  ambito,
  nota,
  conTitulo = true,
  buscarEn,
}: {
  datos: Corrupcion;
  ruta: string;
  ambito: "entidad" | "region" | "partido";
  nota?: string;
  conTitulo?: boolean;
  buscarEn?: { ruc: string; nombre?: string | null };
}) {
  const inf = datos.informes;
  const [tipo, setTipo] = useState<TipoInforme | null>(null);
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState<PaginaInformes>(inf.pagina);
  const [cargando, setCargando] = useState(false);
  const [fallo, setFallo] = useState(false);
  // Mientras se busca en lo que encontró la Contraloría, sus resultados reemplazan a la lista (un solo panel a la vez).
  const [buscandoHallazgos, setBuscandoHallazgos] = useState(false);

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
  const filas: Fila[] = pagina.filas.map((i) => filaInforme(i, conEntidad));
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
          {buscarEn && <BuscadorControl variante="caja" entidad={buscarEn} onActivo={setBuscandoHallazgos} />}
          {!buscandoHallazgos && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Buscador
                  placeholder={
                    buscarEn
                      ? "Filtrar la lista por asunto o número de informe…"
                      : conEntidad
                        ? "Buscar un asunto, un número de informe o una entidad…"
                        : "Buscar un asunto o un número de informe…"
                  }
                  etiqueta={buscarEn ? "Filtrar la lista de informes de la Contraloría" : "Buscar en los informes de la Contraloría"}
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
            </>
          )}
          <p className="text-rotulo leading-relaxed text-mute">
            {conEntidad
              ? "Cada fila abre lo que encontró la Contraloría y a quiénes comprende, y la entidad lleva a su ficha en Vigía. "
              : "Cada fila abre lo que encontró la Contraloría y a quiénes comprende, con la Ficha Resumen y el informe completo. "}
            Todos están también en su <EnlaceFuente href={BUSCADOR_CONTRALORIA}>buscador de informes</EnlaceFuente>, y puedes{" "}
            <Link href="/app/contraloria" prefetch={false} className="font-medium text-granate underline decoration-granate/35 underline-offset-2 hover:decoration-granate">
              buscar en lo que encontró en todo el país
            </Link>
            .
          </p>
        </div>
      )}
    </section>
  );
}
