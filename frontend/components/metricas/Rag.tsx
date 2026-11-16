import { BookOpenText, Library, ListOrdered, ScanSearch, SearchCheck } from "lucide-react";
import Link from "next/link";
import { BarraSegmentada, MuestraSerie, type ParteBarra } from "@/components/charts/BarraSegmentada";
import { ColumnasSerie } from "@/components/charts/ColumnasSerie";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, Indicadores, Tabla, type Columna } from "@/components/listado";
import { decimal, numero, plural, porcentaje } from "@/lib/formato";
import { diaCorto, diaDe, SISTEMA_RAG, TIPO_NORMA, type Corpus, type CorpusContraloria, type EvaluacionRag, type Transparencia } from "@/lib/transparencia";
import { Caja, fechaHora, MideNoMide, NoMedido, PieDato, RenglonMedidor } from "./piezas";

const tasa = (v: number | null) => (v == null ? "Sin dato" : porcentaje(v * 100, { decimales: 1 }));
const sistema = (s: string | null) => (s ? SISTEMA_RAG[s] ?? s : "Sin registrar");

/** De qué está hecho el corpus: los seis tipos con más documentos y el resto en «Otros». */
function Composicion({ corpus }: { corpus: Corpus }) {
  const orden = [...corpus.porTipo].sort((a, b) => b.documentos - a.documentos);
  const parte = (x: Corpus["porTipo"][number]): ParteBarra => ({ clave: x.tipo, nombre: TIPO_NORMA[x.tipo] ?? x.tipo, valor: x.documentos, texto: plural(x.documentos, "documento", "documentos") });
  // recorte: la barra tiene seis colores; lo demás va sumado en «Otros tipos».
  const cabeza = orden.slice(0, 6);
  const resto = orden.slice(6);
  const otros: ParteBarra | null = resto.length
    ? { clave: "otros", nombre: "Otros tipos", valor: resto.reduce((t, x) => t + x.documentos, 0), texto: plural(resto.reduce((t, x) => t + x.documentos, 0), "documento", "documentos") }
    : null;
  return (
    <Caja
      titulo="De qué está hecho el corpus"
      icono={<Library size={16} aria-hidden />}
      bajada="Las normas de contratación pública que el analista legal puede citar, partidas en fragmentos por artículo o por conclusión."
      fecha={corpus.actualizado}
      fuente="Tablas norma y norma_fragmento (la fecha es la de la última carga)."
    >
      <BarraSegmentada partes={cabeza.map(parte)} otros={otros} etiqueta="Documentos del corpus por tipo" />
      <ul className="space-y-1.5">
        {cabeza.map((x, i) => (
          <li key={x.tipo} className="flex items-center gap-2 text-meta">
            <MuestraSerie i={i} />
            <span className="min-w-0 flex-1 truncate text-ink">{TIPO_NORMA[x.tipo] ?? x.tipo}</span>
            <span className="font-mono tabular-nums text-ink">{numero(x.documentos)}</span>
            <span className="w-32 whitespace-nowrap text-right font-mono text-rotulo tabular-nums text-mute max-sm:hidden">{plural(x.fragmentos, "fragmento", "fragmentos")}</span>
          </li>
        ))}
        {otros && (
          <li className="flex items-center gap-2 text-meta">
            <MuestraSerie i="otros" />
            <span className="min-w-0 flex-1 truncate text-ink">Otros tipos</span>
            <span className="font-mono tabular-nums text-ink">{numero(otros.valor)}</span>
            <span className="w-32 whitespace-nowrap text-right font-mono text-rotulo tabular-nums text-mute max-sm:hidden">{plural(resto.reduce((t, x) => t + x.fragmentos, 0), "fragmento", "fragmentos")}</span>
          </li>
        )}
      </ul>
    </Caja>
  );
}

/** La última medición del buscador de Vigía, con cada tasa en su barra, y el acierto de cada corrida. */
function UltimaMedicion({ ultima, serie }: { ultima: EvaluacionRag; serie: EvaluacionRag[] }) {
  const equivocado = ultima.regimenEquivocado;
  return (
    <Caja
      titulo="La última medición del buscador"
      icono={<SearchCheck size={16} aria-hidden />}
      bajada={`${plural(ultima.preguntas, "pregunta", "preguntas")} con la norma que el buscador debe traer según la fecha de la convocatoria.`}
      fecha={ultima.fecha}
      fuente="Conjunto «rag_normas» de las pruebas de oro (golden_corrida), que sube el evaluador del buscador de normas."
    >
      <ul className="space-y-2.5">
        {ultima.acierto10 != null && (
          <RenglonMedidor nombre="La norma esperada llega al agente (10 primeros)" parte={ultima.acierto10} texto={tasa(ultima.acierto10)} />
        )}
        <RenglonMedidor nombre="La norma esperada está entre los 8 primeros" parte={ultima.acierto8} texto={tasa(ultima.acierto8)} />
        <RenglonMedidor nombre="Lo primero que devuelve es una norma, no una opinión" parte={ultima.normaPrimero} texto={tasa(ultima.normaPrimero)} />
        {equivocado && (
          <RenglonMedidor
            nombre="Resultados de la ley que no regía en esa fecha"
            parte={equivocado.n / equivocado.de}
            texto={porcentaje((100 * equivocado.n) / equivocado.de, { decimales: 1 })}
            sub={`${numero(equivocado.n)} de ${numero(equivocado.de)} resultados. Aquí lo bueno es cero.`}
          />
        )}
        <li className="flex items-baseline justify-between gap-3 text-meta">
          <span className="text-ink">MRR (qué tan arriba sale la norma esperada, de 0 a 1)</span>
          <span className="font-mono tabular-nums text-ink">{ultima.mrr == null ? "Sin dato" : decimal(ultima.mrr, 3)}</span>
        </li>
      </ul>
      {serie.length > 1 && (
        <div>
          <p className="text-rotulo font-medium text-mute">Acierto entre los 8 primeros, en cada corrida del buscador de Vigía</p>
          <ColumnasSerie
            alto="bajo"
            tope={1}
            serie={3}
            etiqueta="Acierto entre los 8 primeros en cada evaluación del buscador de normas"
            puntos={serie.map((e, i) => ({
              clave: `${e.fecha}-${i}`,
              rotulo: `${diaCorto(diaDe(e.fecha) ?? e.fecha)} ${e.fecha.slice(11, 16)}`,
              valor: e.acierto8,
              texto: tasa(e.acierto8),
              detalle: `${fechaHora(e.fecha)}: ${tasa(e.acierto8)} entre los 8 primeros, en ${plural(e.preguntas, "pregunta", "preguntas")}`,
            }))}
          />
        </div>
      )}
    </Caja>
  );
}

const COLUMNAS: Columna[] = [
  { clave: "cuando", titulo: "Fecha y buscador", ancho: "minmax(0,1.2fr)" },
  { clave: "a8", titulo: "Entre los 8", ancho: "92px", alinear: "der" },
  { clave: "a10", titulo: "Entre los 10", ancho: "96px", alinear: "der", desde: "md" },
  { clave: "mrr", titulo: "MRR", ancho: "64px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "primero", titulo: "Norma primero", ancho: "112px", alinear: "der", desde: "lg" },
  { clave: "regimen", titulo: "Ley equivocada", ancho: "120px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "nota", titulo: "Qué cambió", ancho: "minmax(0,1.6fr)", desde: "xl" },
];

/**
 * Pestaña «RAG normativo»: el buscador de normas que alimenta al analista legal. Cuánto tiene (normas, fragmentos,
 * opiniones), cómo rinde en la última medición y la historia de mediciones, incluida la del buscador anterior con la que
 * se comparó.
 */
/** El segundo corpus: las Fichas Resumen de los informes de control de la Contraloría, leídas y buscables. */
function Contraloria({ c }: { c: CorpusContraloria }) {
  return (
    <Caja
      titulo="Lo que encontró la Contraloría, buscable"
      icono={<ScanSearch size={16} aria-hidden />}
      bajada={
        <>
          Las observaciones de sus informes de control, leídas de la Ficha Resumen de cada uno. Se buscan por palabras o por sentido en{" "}
          <Link href="/app/contraloria" className="font-medium text-granate underline decoration-granate/40 underline-offset-2 hover:decoration-granate">
            Contraloría
          </Link>{" "}
          y sirven de precedente al informe para control de cada contrato.
        </>
      }
      fecha={c.actualizado}
      fuente="Tablas informes_control, informe_control_ficha e informe_control_fragmento (la fecha es la de la última ficha bajada)."
    >
      <Indicadores
        items={[
          { valor: numero(c.fichas), etiqueta: "fichas leídas", contexto: `de ${numero(c.informes)} informes con responsabilidad presunta`, parte: c.informes ? c.fichas / c.informes : null },
          { valor: numero(c.observaciones), etiqueta: "observaciones", contexto: `${numero(c.fragmentos)} trozos buscables, ${numero(c.conVector)} con vector`, parte: null },
          {
            valor: numero(c.leidasIa),
            etiqueta: "fichas con tema y perjuicio",
            contexto: c.costoIaUsd ? `leídos por un modelo abierto: costó US$ ${c.costoIaUsd.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "leídos por un modelo abierto; el resto, en curso",
            parte: c.conObservaciones ? c.leidasIa / c.conObservaciones : null,
          },
          ...(c.contratosAtados
            ? [{ valor: numero(c.contratosAtados), etiqueta: "contratos atados a una observación", contexto: "el informe nombra su proceso o su obra: llevan la bandera en su ficha", parte: null }]
            : []),
          { valor: c.comprendidos == null ? null : numero(c.comprendidos), etiqueta: "funcionarios comprendidos", contexto: "responsabilidad presunta: no es una condena", parte: null },
        ]}
      />
      <MideNoMide
        mide="Cuánto de lo que publicó la Contraloría está leído y se puede buscar."
        noMide="Si el informe completo dice algo más: es un escaneo sin texto y no se lee; sólo su Ficha Resumen."
      />
    </Caja>
  );
}

export function Rag({ rag }: { rag: Transparencia["rag"] }) {
  if (!rag || (!rag.corpus && !rag.contraloria && !rag.serie.length)) {
    return <NoMedido titulo="RAG normativo">Todavía no hay normas cargadas ni evaluaciones del buscador en la base.</NoMedido>;
  }
  const { corpus, serie } = rag;
  const propias = serie.filter((e) => e.sistema !== "chroma");
  const ultima = propias[propias.length - 1] ?? serie[serie.length - 1] ?? null;
  return (
    <div className="space-y-5">
      {corpus && (
        <Indicadores
          items={[
            { valor: numero(corpus.normas), etiqueta: "normas y documentos", contexto: "leyes, reglamentos, directivas, opiniones", icono: <BookOpenText size={15} aria-hidden /> },
            { valor: numero(corpus.fragmentos), etiqueta: "fragmentos buscables", contexto: `${numero(corpus.conVector)} con vector para buscar por significado`, icono: <ListOrdered size={15} aria-hidden />, parte: corpus.fragmentos ? corpus.conVector / corpus.fragmentos : null },
            { valor: numero(corpus.opiniones), etiqueta: "opiniones del OECE", contexto: "una por conclusión", icono: <Library size={15} aria-hidden /> },
            { valor: corpus.reglas == null ? null : numero(corpus.reglas), etiqueta: "reglas de cumplimiento", contexto: "con su fundamento legal", icono: <SearchCheck size={15} aria-hidden /> },
          ]}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {corpus && <Composicion corpus={corpus} />}
        {ultima && <UltimaMedicion ultima={ultima} serie={propias} />}
      </div>

      {rag.contraloria && <Contraloria c={rag.contraloria} />}

      <Caja titulo="Cómo leer estas medidas" icono={<SearchCheck size={16} aria-hidden />}>
        <MideNoMide
          mide="Si el buscador trae la norma correcta, y de la ley que regía en la fecha del proceso, cuando se le hace una pregunta cuya respuesta ya se conoce."
          noMide="Si el analista legal después la usa bien al redactar. Eso se mide en «Los agentes» (el analista legal) y en «Verificación» (las citas)."
        />
      </Caja>

      {serie.length > 0 && (
        <section className="space-y-3">
          <h3 className="font-display text-cuerpo font-bold text-ink">Todas las mediciones del buscador</h3>
          <Tabla
            etiqueta="Evaluaciones del buscador de normas, de la más reciente a la más antigua"
            densidad="compacta"
            columnas={COLUMNAS}
            filas={[...serie].reverse().map((e, i) => ({
              id: `${e.fecha}-${i}`,
              celdas: {
                cuando: <CeldaPrincipal titulo={fechaHora(e.fecha)} meta={`${sistema(e.sistema)}, ${plural(e.preguntas, "pregunta", "preguntas")}`} />,
                a8: <CeldaNumero>{tasa(e.acierto8)}</CeldaNumero>,
                a10: <CeldaNumero>{e.acierto10 == null ? "No medido" : tasa(e.acierto10)}</CeldaNumero>,
                mrr: <CeldaNumero>{e.mrr == null ? "Sin dato" : decimal(e.mrr, 3)}</CeldaNumero>,
                primero: <CeldaNumero>{tasa(e.normaPrimero)}</CeldaNumero>,
                regimen: e.regimenEquivocado ? (
                  <CeldaNumero sub={`${numero(e.regimenEquivocado.n)} de ${numero(e.regimenEquivocado.de)}`}>
                    {porcentaje((100 * e.regimenEquivocado.n) / e.regimenEquivocado.de, { decimales: 1 })}
                  </CeldaNumero>
                ) : (
                  <CeldaNumero>Sin dato</CeldaNumero>
                ),
                nota: <CeldaTexto>{e.nota ?? "Sin nota"}</CeldaTexto>,
              },
            }))}
          />
          <PieDato fecha={rag.fecha} fuente="Conjunto «rag_normas» de las pruebas de oro (golden_corrida)." />
        </section>
      )}
    </div>
  );
}
