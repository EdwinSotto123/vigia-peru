"use client";

import { useMemo, useState } from "react";
import { BookOpen, ExternalLink, Search } from "lucide-react";
import { Aviso, Badge, DataTable, EmptyState, Expandable, FilterChips, PageSection, Panel, SinDato, SkeletonPanel, StatCard, StatGrid, claseBoton, pct, plural, type Columna } from "@/components/admin/ui";
import { Ayuda } from "@/components/patrones";
import { coincide, paraBuscar } from "@/lib/formato";
import { useAdmin } from "@/lib/useAdmin";
import { ErrorGolden } from "./comunes";
import { COMO_SE_VERIFICA, MATERIA, VERIFICACION, fmtEjecutada, nombreRegimen, type AplicaNorma, type DocumentoNorma, type NormasPorTipo, type ReglaNorma, type RespuestaBuscarNormas, type RespuestaNormas, type ResultadoNorma } from "./tipos";

/**
 * Pestaña «Normas»: el RAG normativo. El corpus por tipo y régimen, la lista de documentos con su vigencia y su enlace
 * oficial, y un probador que hace la misma búsqueda que el agente legal: con una pregunta y la fecha de la convocatoria
 * devuelve la norma aplicable, los criterios del mismo régimen y los de la ley anterior (sólo por analogía).
 */

type Vista = "corpus" | "documentos" | "reglas" | "probador";

export function NormasGolden() {
  const [vista, setVista] = useState<Vista>("corpus");
  const { data, error, isLoading, mutate } = useAdmin<RespuestaNormas>("/normas");
  const porTipo = data?.porTipo ?? [];
  const suma = (k: "documentos" | "fragmentos" | "conVector") => porTipo.reduce((s, t) => s + (Number(t[k]) || 0), 0);
  return (
    <div className="space-y-4">
      <FilterChips<Vista>
        etiqueta="Qué ver de las normas"
        valor={vista}
        onCambiar={setVista}
        opciones={[
          { valor: "corpus", etiqueta: "Corpus" },
          { valor: "documentos", etiqueta: "Documentos", cuenta: data ? data.documentos?.length ?? 0 : null },
          { valor: "reglas", etiqueta: "Reglas" },
          { valor: "probador", etiqueta: "Probador" },
        ]}
      />
      {vista === "probador" ? (
        <Probador />
      ) : vista === "reglas" ? (
        <Reglas />
      ) : (
        <>
          <ErrorGolden error={error} titulo="No se pudo leer el corpus de normas" onReintentar={() => mutate()} />
          {!error && !data && (isLoading ? <SkeletonPanel lineas={6} /> : null)}
          {data && vista === "corpus" && (
            <div className="space-y-4">
              <StatGrid columnas={3}>
                <StatCard etiqueta="Documentos" valor={suma("documentos")} pista="leyes, reglamentos, directivas y criterios" />
                <StatCard etiqueta="Fragmentos" valor={suma("fragmentos")} pista="los pedazos que se buscan" />
                <StatCard
                  etiqueta="Fragmentos con vector"
                  valor={suma("conVector")}
                  pista={suma("fragmentos") ? `${pct(suma("conVector"), suma("fragmentos"))} % del corpus; el resto sólo se encuentra por palabras` : undefined}
                  tono={suma("conVector") < suma("fragmentos") ? "warn" : "ok"}
                />
              </StatGrid>
              <Corpus porTipo={porTipo} />
            </div>
          )}
          {data && vista === "documentos" && <Documentos documentos={data.documentos ?? []} />}
        </>
      )}
    </div>
  );
}

// ─── Corpus ──────────────────────────────────────────────────────────────────────

const rango = (desde: string | null, hasta: string | null) => {
  const a = fmtEjecutada(desde);
  const b = fmtEjecutada(hasta);
  return a && b ? (a === b ? a : `${a} a ${b}`) : a ?? b;
};

function Corpus({ porTipo }: { porTipo: NormasPorTipo[] }) {
  const columnas: Columna<NormasPorTipo>[] = [
    {
      clave: "tipo",
      titulo: "Tipo",
      principal: true,
      celda: (t) => (
        <span className="block min-w-0">
          <span className="block text-dato font-medium text-ink">{t.tipo}</span>
          <span className="block text-rotulo text-mute">{[nombreRegimen(t.regimen) ?? "Sin régimen", t.jerarquia != null && t.jerarquia !== "" ? `jerarquía ${t.jerarquia}` : null].filter(Boolean).join(", ")}</span>
        </span>
      ),
    },
    { clave: "documentos", titulo: "Documentos", alinear: "derecha", celda: (t) => t.documentos.toLocaleString("es-PE") },
    { clave: "fragmentos", titulo: "Fragmentos", alinear: "derecha", celda: (t) => t.fragmentos.toLocaleString("es-PE") },
    {
      clave: "conVector",
      titulo: "Con vector",
      alinear: "derecha",
      celda: (t) => (
        <span title={`${pct(t.conVector, t.fragmentos)} % de sus fragmentos`}>
          {t.conVector.toLocaleString("es-PE")} <span className="text-mute">({pct(t.conVector, t.fragmentos)} %)</span>
        </span>
      ),
    },
    { clave: "conArticulo", titulo: "Con artículo", alinear: "derecha", celda: (t) => t.conArticulo.toLocaleString("es-PE") },
    { clave: "fechas", titulo: "Fechas de emisión", className: "whitespace-nowrap", anchoCompletoMovil: true, celda: (t) => rango(t.desde, t.hasta) ?? <SinDato texto="Sin fecha" /> },
  ];
  return (
    <PageSection
      titulo="Corpus por tipo y régimen"
      meta={plural(porTipo.length, "grupo", "grupos")}
      ayuda={
        <Ayuda titulo="¿Qué es cada columna?">
          <span className="block">
            Cada documento se parte en <b>fragmentos</b>. Los que tienen <b>vector</b> se encuentran por significado; los demás,
            sólo por palabras. <b>Con artículo</b>: fragmentos que se sabe a qué artículo pertenecen.
          </span>
        </Ayuda>
      }
    >
      <DataTable
        columnas={columnas}
        filas={porTipo}
        claveFila={(t) => `${t.tipo}|${t.regimen ?? ""}|${t.jerarquia ?? ""}`}
        etiqueta="Corpus de normas por tipo y régimen"
        vacio={<EmptyState compacto icono={<BookOpen size={16} />} titulo="El corpus está vacío" descripcion="Todavía no se cargó ninguna norma en este ambiente." />}
      />
    </PageSection>
  );
}

function Documentos({ documentos }: { documentos: DocumentoNorma[] }) {
  const [q, setQ] = useState("");
  const indice = useMemo(
    () => documentos.map((d) => paraBuscar([d.documento, d.numero, d.tipo, nombreRegimen(d.regimen), d.slug, d.materia ? MATERIA[d.materia] ?? d.materia : null].filter(Boolean).join(" "))),
    [documentos],
  );
  const consulta = paraBuscar(q);
  const filas = useMemo(() => (consulta ? documentos.filter((_, i) => coincide(indice[i], consulta)) : documentos), [documentos, indice, consulta]);
  const columnas: Columna<DocumentoNorma>[] = [
    {
      clave: "documento",
      titulo: "Documento",
      principal: true,
      celda: (d) => (
        <span className="block min-w-0">
          <span className="block text-dato font-medium leading-snug text-ink text-pretty">{d.documento ?? d.slug}</span>
          {d.numero && <span className="block break-words text-rotulo text-mute">{d.numero}</span>}
          {(d.versionDe || (d.verificacion && d.verificacion !== "C")) && (
            <span className="mt-1 flex flex-wrap gap-1.5">
              {d.versionDe && (
                <Badge tono="brand" title="Esta norma tiene otro texto según la fecha del proceso: la búsqueda sirve el que regía ese día">
                  Versión por fecha
                </Badge>
              )}
              {d.verificacion && d.verificacion !== "C" && (
                <Badge tono="warn" title={VERIFICACION[d.verificacion]?.pista}>
                  {VERIFICACION[d.verificacion]?.nombre ?? d.verificacion}
                </Badge>
              )}
            </span>
          )}
        </span>
      ),
    },
    { clave: "tipo", titulo: "Tipo", celda: (d) => d.tipo ?? <SinDato /> },
    { clave: "materia", titulo: "Materia", celda: (d) => (d.materia ? MATERIA[d.materia] ?? d.materia : <SinDato />) },
    { clave: "regimen", titulo: "Régimen", className: "whitespace-nowrap", celda: (d) => nombreRegimen(d.regimen) ?? <SinDato /> },
    { clave: "emision", titulo: "Emisión", className: "whitespace-nowrap", celda: (d) => fmtEjecutada(d.fechaEmision) ?? <SinDato texto="Sin fecha" /> },
    {
      clave: "vigencia",
      titulo: "Vigencia",
      className: "whitespace-nowrap",
      celda: (d) =>
        d.vigenciaDesde || d.vigenciaHasta ? (
          <span>
            {fmtEjecutada(d.vigenciaDesde) ?? "sin inicio"} <span className="text-mute">a</span> {fmtEjecutada(d.vigenciaHasta) ?? "hoy"}
          </span>
        ) : (
          <SinDato texto="Sin vigencia" />
        ),
    },
    { clave: "fragmentos", titulo: "Fragmentos", alinear: "derecha", celda: (d) => d.fragmentos.toLocaleString("es-PE") },
    {
      clave: "enlace",
      titulo: "Fuente oficial",
      acciones: true,
      celda: (d) =>
        d.urlOficial ? (
          <a href={d.urlOficial} target="_blank" rel="noopener noreferrer" className={claseBoton("secundario", "xs")}>
            Abrir <ExternalLink size={12} aria-hidden />
            <span className="sr-only">la fuente oficial de {d.documento ?? d.slug} (se abre en otra pestaña)</span>
          </a>
        ) : (
          <span className="text-rotulo text-mute">Sin enlace</span>
        ),
    },
  ];
  return (
    <div className="space-y-3">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative max-w-xl">
        <label htmlFor="buscar-normas" className="sr-only">
          Buscar un documento
        </label>
        <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
        <input
          id="buscar-normas"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, número, tipo, materia o régimen"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-line bg-paperSoft pl-10 pr-3 text-destacado placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </form>
      <DataTable
        columnas={columnas}
        filas={filas}
        claveFila={(d) => d.slug}
        etiqueta="Documentos del corpus de normas"
        porPagina={25}
        reinicio={consulta}
        apilarHasta="lg"
        vacio={<EmptyState compacto icono={<BookOpen size={16} />} titulo={consulta ? "Ningún documento coincide con la búsqueda" : "Todavía no hay documentos en el corpus"} />}
      />
    </div>
  );
}

// ─── Reglas ──────────────────────────────────────────────────────────────────────

const CATEGORIA: Record<string, string> = {
  transversal: "Transversal",
  contratos_menores: "Contratos menores",
  contrataciones_mayores: "Procedimientos de selección",
  ejecucion: "Ejecución contractual",
  obras: "Obras",
  cas: "CAS",
  planillas: "Planillas",
};

function Reglas() {
  const { data, error, isLoading, mutate } = useAdmin<{ data: ReglaNorma[] }>("/normas/reglas");
  const [categoria, setCategoria] = useState<string>("todas");
  const reglas = data?.data ?? [];
  const categorias = useMemo(() => [...new Set(reglas.map((r) => r.categoria))], [reglas]);
  const filas = categoria === "todas" ? reglas : reglas.filter((r) => r.categoria === categoria);
  const porVerificar = reglas.filter((r) => r.verificacion && r.verificacion !== "C").length;
  const cubiertas = reglas.filter((r) => r.reglaVigia).length;
  const columnas: Columna<ReglaNorma>[] = [
    {
      clave: "regla",
      titulo: "Regla",
      principal: true,
      celda: (r) => (
        <span className="block min-w-0">
          <span className="block text-dato font-medium leading-snug text-ink text-pretty">{r.descripcion}</span>
          <span className="block text-rotulo text-mute">
            {r.id}, {CATEGORIA[r.categoria] ?? r.categoria}
          </span>
        </span>
      ),
    },
    { clave: "fundamento", titulo: "Fundamento", celda: (r) => r.fundamento ?? <SinDato texto="Sin fundamento" /> },
    { clave: "como", titulo: "Cómo se verifica", celda: (r) => (r.tipoVerificacion ? COMO_SE_VERIFICA[r.tipoVerificacion] ?? r.tipoVerificacion : <SinDato />) },
    { clave: "valor", titulo: "Valor de referencia", celda: (r) => r.valorReferencia ?? <SinDato texto="No aplica" /> },
    {
      clave: "vigia",
      titulo: "En Vigía",
      anchoCompletoMovil: true,
      celda: (r) =>
        r.reglaVigia ? (
          <span className="block min-w-0">
            <span className="flex flex-wrap gap-1.5">
              {r.reglaVigia.split(",").map((k) => (
                <Badge key={k} tono="ok">
                  {k.trim()}
                </Badge>
              ))}
            </span>
            {r.nota && <span className="mt-1 block text-rotulo leading-snug text-mute text-pretty">{r.nota}</span>}
          </span>
        ) : (
          <span className="block min-w-0">
            <Badge tono="muted" title="Ninguna regla del agente ni cruce de la base la verifica todavía">
              Sin cubrir
            </Badge>
            {r.nota && <span className="mt-1 block text-rotulo leading-snug text-mute text-pretty">{r.nota}</span>}
          </span>
        ),
    },
    {
      clave: "verificacion",
      titulo: "Estado del dato",
      celda: (r) =>
        r.verificacion ? (
          <Badge tono={r.verificacion === "C" ? "ok" : "warn"} title={VERIFICACION[r.verificacion]?.pista}>
            {VERIFICACION[r.verificacion]?.nombre ?? r.verificacion}
          </Badge>
        ) : (
          <SinDato />
        ),
    },
  ];
  return (
    <div className="space-y-4">
      <ErrorGolden error={error} titulo="No se pudieron leer las reglas" onReintentar={() => mutate()} />
      {!error && !data && isLoading && <SkeletonPanel lineas={6} />}
      {data && (
        <>
          <StatGrid columnas={4}>
            <StatCard etiqueta="Reglas de cumplimiento" valor={reglas.length} pista="lo que se verifica en un contrato, un CAS o una planilla" />
            <StatCard etiqueta="Ya las verifica Vigía" valor={cubiertas} pista={`${reglas.length - cubiertas} todavía sin una regla o un cruce que las revise`} tono={cubiertas ? "ok" : "warn"} />
            <StatCard etiqueta="Con fundamento confirmado" valor={reglas.length - porVerificar} pista="el artículo se comprobó en la fuente oficial" tono="ok" />
            <StatCard etiqueta="Por confirmar" valor={porVerificar} pista="el artículo o el valor sale de una fuente secundaria" tono={porVerificar ? "warn" : "ok"} />
          </StatGrid>
          <FilterChips<string>
            etiqueta="Categoría de la regla"
            valor={categoria}
            onCambiar={setCategoria}
            opciones={[{ valor: "todas", etiqueta: "Todas", cuenta: reglas.length }, ...categorias.map((k) => ({ valor: k, etiqueta: CATEGORIA[k] ?? k, cuenta: reglas.filter((r) => r.categoria === k).length }))]}
          />
          <DataTable
            columnas={columnas}
            filas={filas}
            claveFila={(r) => r.id}
            etiqueta="Reglas de cumplimiento normativo"
            porPagina={25}
            reinicio={categoria}
            apilarHasta="lg"
            vacio={<EmptyState compacto icono={<BookOpen size={16} />} titulo="Todavía no hay reglas cargadas" />}
          />
        </>
      )}
    </div>
  );
}

// ─── Probador ────────────────────────────────────────────────────────────────────

const BLOQUES: { aplica: AplicaNorma; titulo: string; nota: string }[] = [
  { aplica: "norma", titulo: "Norma aplicable", nota: "La ley, el reglamento y las directivas que rigen para esa fecha." },
  { aplica: "criterio", titulo: "Criterio del mismo régimen", nota: "Opiniones y resoluciones emitidas bajo la misma ley." },
  { aplica: "criterio_anterior", titulo: "Criterio de la ley anterior (sólo por analogía)", nota: "No rige para esa fecha: el agente sólo puede usarlo por analogía." },
];

const CAMPO =
  "h-11 w-full rounded-xl border border-line bg-paperSoft px-3 text-dato text-ink placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20";

function Probador() {
  const [pregunta, setPregunta] = useState("");
  const [fecha, setFecha] = useState("");
  const [pedido, setPedido] = useState<{ q: string; fecha: string } | null>(null);
  const ruta = pedido ? `/normas/buscar?q=${encodeURIComponent(pedido.q)}${pedido.fecha ? `&fecha=${encodeURIComponent(pedido.fecha)}` : ""}` : null;
  const { data, error, isLoading, isValidating, mutate } = useAdmin<RespuestaBuscarNormas>(ruta, { keepPreviousData: false, revalidateOnFocus: false });
  const listo = pregunta.trim().length >= 3;
  return (
    <div className="space-y-4">
      <Panel
        titulo="Probar una búsqueda"
        descripcion="Devuelve exactamente lo que recibe el agente legal para esa pregunta y esa fecha."
        ayuda={
          <Ayuda titulo="¿Por qué pide la fecha?">
            <span className="block">
              La fecha de la convocatoria decide qué ley rige el proceso (Ley 30225 o Ley 32069). La búsqueda separa la norma que
              aplica de los criterios de la ley anterior, que sólo valen por analogía.
            </span>
          </Ayuda>
        }
      >
        <form
          className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_12rem_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (!listo) return;
            const nuevo = { q: pregunta.trim(), fecha };
            // La misma pregunta otra vez: se vuelve a pedir.
            if (pedido && pedido.q === nuevo.q && pedido.fecha === nuevo.fecha) void mutate();
            else setPedido(nuevo);
          }}
        >
          <label className="min-w-0">
            <span className="text-rotulo font-medium text-inkSoft">Pregunta</span>
            <input
              type="text"
              value={pregunta}
              onChange={(e) => setPregunta(e.target.value)}
              placeholder="¿Cuándo procede una contratación directa por emergencia?"
              autoComplete="off"
              className={`mt-1 ${CAMPO}`}
            />
          </label>
          <label className="min-w-0">
            <span className="text-rotulo font-medium text-inkSoft">Fecha de convocatoria</span>
            <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={`mt-1 ${CAMPO}`} />
          </label>
          <button type="submit" disabled={!listo || isValidating} className={claseBoton("primario", "md")}>
            <Search size={15} aria-hidden /> {isValidating ? "Buscando…" : "Probar"}
          </button>
        </form>
      </Panel>

      <ErrorGolden error={error} titulo="La búsqueda no respondió" onReintentar={() => mutate()} />
      {!error && pedido && !data && isLoading && <SkeletonPanel lineas={6} />}
      {!error && data && <ResultadosBusqueda r={data} />}
    </div>
  );
}

function ResultadosBusqueda({ r }: { r: RespuestaBuscarNormas }) {
  const resultados = r.data ?? [];
  return (
    <div className="space-y-4">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1.5 text-meta text-inkSoft">
        <span>Para {r.fecha ? `una convocatoria del ${fmtEjecutada(r.fecha)}` : "la fecha de hoy"} rige</span>
        <Badge tono="brand">{nombreRegimen(r.regimen) ?? "un régimen sin identificar"}</Badge>
        {r.busqueda === "hibrida" ? (
          <Badge tono="ok" title="Se buscó por palabras y por significado (vectores)">
            Búsqueda híbrida
          </Badge>
        ) : (
          <Badge tono="warn" title="No se pudo buscar por significado: sólo coincidencias de palabras">
            Sólo por palabras
          </Badge>
        )}
        <span>{plural(resultados.length, "resultado", "resultados")}</span>
      </p>
      {r.busqueda !== "hibrida" && (
        <Aviso tono="warn" titulo="Esta búsqueda no usó vectores">
          Los resultados salen sólo por coincidencia de palabras: el agente recibe menos de lo normal.
        </Aviso>
      )}
      {resultados.length === 0 ? (
        <EmptyState titulo="La búsqueda no devolvió nada" descripcion="Prueba con otras palabras o revisa que el corpus tenga normas de ese régimen." />
      ) : (
        BLOQUES.map((b) => {
          const suyos = resultados.filter((x) => x.aplica === b.aplica);
          return (
            <PageSection key={b.aplica} titulo={b.titulo} meta={plural(suyos.length, "resultado", "resultados")} descripcion={b.nota}>
              {suyos.length === 0 ? (
                <EmptyState compacto className="rounded-2xl border border-line bg-paperSoft" titulo="Ninguno en este bloque" />
              ) : (
                <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paperSoft">
                  {suyos.map((x, i) => (
                    <li key={`${x.slug}-${x.articulo ?? ""}-${i}`} className="min-w-0 px-4 py-3 sm:px-5">
                      <ResultadoDeNorma x={x} />
                    </li>
                  ))}
                </ol>
              )}
            </PageSection>
          );
        })
      )}
    </div>
  );
}

const LARGO_TEXTO = 480;

function ResultadoDeNorma({ x }: { x: ResultadoNorma }) {
  const texto = (x.texto ?? "").trim();
  const largo = texto.length > LARGO_TEXTO;
  return (
    <article className="min-w-0 space-y-1.5">
      <h3 className="text-cuerpo font-semibold leading-snug text-ink text-pretty">
        {x.documento ?? x.slug}
        {x.numero && <span className="font-normal text-inkSoft"> {x.numero}</span>}
      </h3>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-rotulo text-mute">
        {x.articulo && <span className="font-medium text-inkSoft">{/^art/i.test(x.articulo) ? x.articulo : `Artículo ${x.articulo}`}</span>}
        {x.tipo && <span>{x.tipo}</span>}
        {nombreRegimen(x.regimen) && <span>{nombreRegimen(x.regimen)}</span>}
        <span>{x.fechaEmision ? `emitida el ${fmtEjecutada(x.fechaEmision)}` : "sin fecha de emisión"}</span>
      </p>
      {x.version && (
        <p>
          <Badge tono="brand" title="El artículo se modificó después: para esa fecha rige este texto">
            {x.version}
          </Badge>
        </p>
      )}
      {x.epigrafe && <p className="text-dato font-medium leading-snug text-ink text-pretty">{x.epigrafe}</p>}
      {texto ? (
        <>
          <p className="whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">{largo ? `${texto.slice(0, LARGO_TEXTO).trimEnd()}…` : texto}</p>
          {largo && (
            <Expandable variante="linea" resumen="Ver el texto completo">
              <p className="whitespace-pre-wrap break-words text-meta leading-relaxed text-inkSoft">{texto}</p>
            </Expandable>
          )}
        </>
      ) : (
        <p className="text-meta italic text-mute">Sin texto</p>
      )}
      <p className="flex flex-wrap items-center gap-1.5">
        <Badge tono={x.rangoPalabras != null ? "neutral" : "muted"} title="El puesto en que salió en la búsqueda por palabras">
          {x.rangoPalabras != null ? `Palabras: puesto ${x.rangoPalabras}` : "No salió por palabras"}
        </Badge>
        <Badge tono={x.rangoVector != null ? "neutral" : "muted"} title="El puesto en que salió en la búsqueda por significado">
          {x.rangoVector != null ? `Vector: puesto ${x.rangoVector}` : "No salió por vector"}
        </Badge>
        {x.puntaje != null && <span className="font-mono text-rotulo tabular-nums text-mute">puntaje {x.puntaje.toLocaleString("es-PE", { maximumFractionDigits: 4 })}</span>}
        {x.urlOficial && (
          <a href={x.urlOficial} target="_blank" rel="noopener noreferrer" className={claseBoton("fantasma", "xs", "ml-auto")}>
            Fuente oficial <ExternalLink size={12} aria-hidden />
            <span className="sr-only">(se abre en otra pestaña)</span>
          </a>
        )}
      </p>
    </article>
  );
}
