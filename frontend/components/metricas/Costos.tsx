import { Banknote, BookOpenCheck, Cpu, Database, FileStack, GraduationCap, HardDrive, ReceiptText, Rocket, Target } from "lucide-react";
import { BarraSegmentada, MuestraSerie } from "@/components/charts/BarraSegmentada";
import { ColumnasSerie } from "@/components/charts/ColumnasSerie";
import { CeldaBarra, CeldaNumero, CeldaPrincipal, CeldaTexto, Indicadores, Tabla, TablaPaginada, type Columna } from "@/components/listado";
import { Nota } from "@/components/patrones";
import { fechaConAnio, numero, plural, porcentaje } from "@/lib/formato";
import { diaCorto, dolares, mesLargo, tamano, type Transparencia } from "@/lib/transparencia";
import { Caja, NoMedido, NoRespondio, RenglonMedidor } from "./piezas";

type Costos = Transparencia["costos"];

const FUENTE_ANALISIS = "Costo que mide cada análisis al terminar (llm_metrics), resumido en la tabla transparencia_analisis.";

/** Análisis guardados y su costo, día por día y por red. */
function Analisis({ analisis }: { analisis: NonNullable<Costos["analisis"]> }) {
  const hasta = analisis.porDia[analisis.porDia.length - 1]?.dia ?? null;
  const redes = analisis.porRed.filter((r) => r.n > 0);
  // recorte: la barra tiene seis colores; la tabla de abajo lista todas las redes.
  const partesRed = redes.slice(0, 6).map((r) => ({ clave: r.red, nombre: r.nombre, valor: r.n, texto: plural(r.n, "contrato", "contratos") }));
  return (
    <>
      <Caja
        titulo="Contratos analizados por día"
        icono={<BookOpenCheck size={16} aria-hidden />}
        bajada="Cada columna es un día (hora de Lima). Cada contrato guarda sólo su análisis más reciente: si se volvió a analizar, cuenta en el día del último."
        fecha={hasta}
        fuente={FUENTE_ANALISIS}
      >
        <ColumnasSerie
          etiqueta="Contratos analizados por día"
          puntos={analisis.porDia.map((d) => ({
            clave: d.dia,
            rotulo: diaCorto(d.dia),
            valor: d.n,
            texto: numero(d.n),
            detalle: `${fechaConAnio(d.dia)}: ${plural(d.n, "contrato analizado", "contratos analizados")}, ${dolares(d.usd)}`,
          }))}
        />
        <ul className="space-y-1">
          {analisis.porMes.map((m) => (
            <li key={m.mes} className="flex items-baseline justify-between gap-3 text-meta">
              <span className="text-ink">{mesLargo(m.mes)}</span>
              <span className="font-mono tabular-nums text-inkSoft">{plural(m.n, "contrato", "contratos")}, {dolares(m.usd)}</span>
            </li>
          ))}
        </ul>
      </Caja>

      <Caja
        titulo="Por red de agentes"
        icono={<Cpu size={16} aria-hidden />}
        bajada="Cuántos contratos analizó cada red, cuánto costó en total y cuánto en promedio por contrato."
        fecha={hasta}
        fuente={FUENTE_ANALISIS}
      >
        <BarraSegmentada etiqueta="Contratos analizados por red" partes={partesRed} />
        <table className="w-full text-left text-meta">
          <caption className="sr-only">Contratos analizados y costo por red</caption>
          <thead className="text-rotulo text-mute">
            <tr>
              <th scope="col" className="py-1 font-medium">Red</th>
              <th scope="col" className="py-1 text-right font-medium">Contratos</th>
              <th scope="col" className="py-1 text-right font-medium">Costo</th>
              <th scope="col" className="py-1 text-right font-medium">Por contrato</th>
            </tr>
          </thead>
          <tbody>
            {redes.map((r, i) => (
              <tr key={r.red} className="border-t border-line">
                <th scope="row" className="py-1.5 font-normal text-ink">
                  <span className="flex items-center gap-2">
                    <MuestraSerie i={i < 6 ? i : "otros"} />
                    {r.nombre}
                  </span>
                </th>
                <td className="py-1.5 text-right font-mono tabular-nums text-ink">{numero(r.n)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-ink">{dolares(r.usd)}</td>
                <td className="py-1.5 text-right font-mono tabular-nums text-inkSoft">{r.medioUsd == null ? "Sin dato" : dolares(r.medioUsd, 3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {analisis.porModelo.length > 0 && (
          <div>
            <p className="text-rotulo font-medium text-mute">Con qué modelo</p>
            <ul className="mt-1 space-y-1">
              {analisis.porModelo.map((m) => (
                <li key={m.modelo ?? "sin"} className="flex items-baseline justify-between gap-3 text-meta">
                  <span className="min-w-0 truncate font-mono text-rotulo text-ink">{m.modelo ?? "Sin modelo registrado"}</span>
                  <span className="shrink-0 font-mono tabular-nums text-inkSoft">{numero(m.n)} análisis, {dolares(m.usd)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Caja>
    </>
  );
}

/** Los lectores de documentos: qué leyeron, cuántas páginas y cuánto costó. */
function Lectores({ lectores }: { lectores: NonNullable<Costos["lectores"]> }) {
  const mayor = Math.max(1, ...lectores.porClase.map((c) => c.n));
  return (
    <Caja
      titulo="Lectura de documentos con IA"
      icono={<FileStack size={16} aria-hidden />}
      bajada={`${plural(lectores.documentos.n, "lectura", "lecturas")} de actas, bases, consultas y contratos, en ${numero(lectores.documentos.paginas)} páginas: ${dolares(lectores.documentos.usd)}.`}
      fecha={lectores.documentos.hasta}
      fuente="Tablas documento_lectura y menor_lectura: cada lectura guarda sus páginas y su costo."
    >
      <ul className="space-y-2.5">
        {lectores.porClase.map((c) => (
          <RenglonMedidor
            key={c.clase}
            nombre={c.nombre}
            parte={c.n / mayor}
            texto={`${numero(c.n)}, ${dolares(c.usd)}`}
            sub={`${numero(c.ok)} leídas bien${c.paginas ? `, ${numero(c.paginas)} páginas` : ""}`}
          />
        ))}
      </ul>
      {lectores.menores && (
        <dl className="rounded-xl bg-paperSoft px-3 py-2 text-meta">
          <dt className="font-semibold text-ink">Aparte, contratos menores (hasta 8 UIT)</dt>
          <dd className="text-inkSoft">
            {plural(lectores.menores.n, "lectura", "lecturas")} de términos de referencia y contratos: {dolares(lectores.menores.usd)}. Última el{" "}
            {fechaConAnio(lectores.menores.hasta?.slice(0, 10))}.
          </dd>
        </dl>
      )}
      {lectores.porModelo.length > 0 && (
        <div>
          <p className="text-rotulo font-medium text-mute">Con qué modelo</p>
          <ul className="mt-1 space-y-1">
            {lectores.porModelo.map((m) => (
              <li key={m.modelo ?? "sin"} className="flex items-baseline justify-between gap-3 text-meta">
                <span className="min-w-0 truncate font-mono text-rotulo text-ink">{m.modelo ?? "Sin modelo registrado"}</span>
                <span className="shrink-0 font-mono tabular-nums text-inkSoft">{numero(m.n)} lecturas, {dolares(m.usd)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Caja>
  );
}

/** El análisis masivo: lo gastado contra su tope, cómo terminó cada intento y el ritmo por día. */
function Masivo({ masivo }: { masivo: NonNullable<Costos["masivo"]> }) {
  const tope = masivo.tandas?.topeUsd ?? null;
  return (
    <Caja
      titulo="Análisis masivo de contratos"
      icono={<Rocket size={16} aria-hidden />}
      bajada="El proceso que analiza por tandas los contratos con información suficiente. Lleva su propio libro de gasto, con cada intento."
      fecha={masivo.tandas?.ultima ?? masivo.hasta}
      fuente="Libro del masivo (tablas agente_masivo y agente_masivo_tanda)."
    >
      {tope != null && tope > 0 && (
        <ul>
          <RenglonMedidor
            nombre="Gastado contra el tope fijado"
            parte={Math.min(1, masivo.usd / tope)}
            texto={`${dolares(masivo.usd)} de ${dolares(tope, 0)}`}
            sub={masivo.tandas ? `${plural(masivo.tandas.n, "tanda", "tandas")} desde el ${fechaConAnio(masivo.tandas.desde)}${masivo.tandas.enCurso ? `, ${numero(masivo.tandas.enCurso)} en curso` : ""}` : undefined}
          />
        </ul>
      )}
      <table className="w-full text-left text-meta">
        <caption className="sr-only">Intentos del análisis masivo según cómo terminaron</caption>
        <thead className="text-rotulo text-mute">
          <tr>
            <th scope="col" className="py-1 font-medium">Cómo terminó</th>
            <th scope="col" className="py-1 text-right font-medium">Intentos</th>
            <th scope="col" className="py-1 text-right font-medium">Costo</th>
          </tr>
        </thead>
        <tbody>
          {masivo.porEstado.map((e) => (
            <tr key={e.estado} className="border-t border-line">
              <th scope="row" className="py-1.5 font-normal text-ink">{e.nombre}</th>
              <td className="py-1.5 text-right font-mono tabular-nums text-ink">{numero(e.n)}</td>
              <td className="py-1.5 text-right font-mono tabular-nums text-ink">{dolares(e.usd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {masivo.porDia.length > 1 && (
        <div>
          <p className="text-rotulo font-medium text-mute">Gasto por día</p>
          <ColumnasSerie
            alto="bajo"
            serie={2}
            etiqueta="Gasto del análisis masivo por día, en dólares"
            puntos={masivo.porDia.map((d) => ({
              clave: d.dia,
              rotulo: diaCorto(d.dia),
              valor: d.usd,
              texto: dolares(d.usd, 0),
              detalle: `${fechaConAnio(d.dia)}: ${dolares(d.usd)}, ${numero(d.ok)} terminados, ${numero(d.errores)} con error`,
            }))}
          />
        </div>
      )}
    </Caja>
  );
}

const COLUMNAS_TABLAS: Columna[] = [
  { clave: "tabla", titulo: "Qué guarda", ancho: "minmax(0,2fr)" },
  { clave: "filas", titulo: "Filas", ancho: "96px", alinear: "der" },
  { clave: "peso", titulo: "Tamaño", ancho: "76px", alinear: "der" },
  { clave: "barra", titulo: "Parte de la base", ancho: "72px", desde: "xl" },
];

function Almacenamiento({ alm, generado }: { alm: NonNullable<Costos["almacenamiento"]>; generado: string }) {
  return (
    <Caja
      titulo="Almacenamiento"
      icono={<HardDrive size={16} aria-hidden />}
      fecha={generado}
      fuente="Tamaño que informa la propia base (pg_database_size y el tamaño de cada tabla; las filas son la estimación de la base). Los documentos, de la tabla documentos_gcs."
    >
      <dl className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-paperSoft px-3 py-2">
          <dt className="flex items-center gap-1.5 text-rotulo text-mute"><Database size={13} aria-hidden />La base de datos</dt>
          <dd className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{tamano(alm.baseBytes)}</dd>
        </div>
        <div className="rounded-xl bg-paperSoft px-3 py-2">
          <dt className="flex items-center gap-1.5 text-rotulo text-mute"><FileStack size={13} aria-hidden />Documentos del SEACE guardados</dt>
          <dd className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{alm.documentos ? tamano(alm.documentos.bytes) : "Sin dato"}</dd>
          {alm.documentos && <dd className="text-rotulo tabular-nums text-mute">{plural(alm.documentos.n, "archivo", "archivos")}, hasta el {fechaConAnio(alm.documentos.hasta)}</dd>}
        </div>
      </dl>
      {alm.tablas.length > 0 && (
        <TablaPaginada
          etiqueta="Las tablas más grandes de la base"
          nombre="tablas"
          tam={6}
          densidad="compacta"
          controles="abajo"
          columnas={COLUMNAS_TABLAS}
          filas={alm.tablas.map((t) => ({
            id: t.nombre,
            buscable: t.nombre,
            celdas: {
              tabla: <span className="block text-meta leading-snug text-ink">{t.nombre}</span>,
              filas: <CeldaNumero>{numero(t.filas)}</CeldaNumero>,
              peso: <CeldaNumero>{tamano(t.bytes)}</CeldaNumero>,
              barra: <CeldaBarra parte={alm.baseBytes ? t.bytes / alm.baseBytes : 0} resumen={`${t.nombre}: ${alm.baseBytes ? porcentaje((100 * t.bytes) / alm.baseBytes, { decimales: 1 }) : "sin dato"} de la base`} tono="neutro" />,
            },
          }))}
        />
      )}
    </Caja>
  );
}

const COLUMNAS_FACTURAS: Columna[] = [
  { clave: "que", titulo: "Mes y concepto", ancho: "minmax(0,1.4fr)" },
  { clave: "monto", titulo: "Monto", ancho: "120px", alinear: "der" },
  { clave: "fuente", titulo: "De dónde sale", ancho: "minmax(0,1fr)", desde: "md", apilar: true },
];

const CATEGORIA: Record<string, string> = {
  infraestructura: "Infraestructura", ia: "Inteligencia artificial", validacion: "Validación", almacenamiento: "Almacenamiento", personas: "Personas", otros: "Otros",
};

/** Lo que no se mide en la base: facturas de la nube (las carga un script cada mes) y lo que el equipo declara a mano. */
/** El mes de hoy en Lima, «AAAA-MM». */
const mesDeHoy = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit" }).format(new Date()).slice(0, 7);

function Facturas({ facturas, declarados }: { facturas: Costos["facturas"]; declarados: Costos["declarados"] }) {
  // El mes siguiente lo deja proyectado costos_mes.py (para la meta de aportes): aquí va como proyección y al final, no
  // como un mes «sin cerrar» que todavía no empezó (2026-11-25: «dic. 2026» salía primero en noviembre).
  const hoy = mesDeHoy();
  const proyectado = (mes: string) => mes.slice(0, 7) > hoy;
  const ordenadas = [...(facturas?.filas ?? [])].sort((a, b) => Number(proyectado(a.mes)) - Number(proyectado(b.mes)));
  const filasFactura = ordenadas.map((f, i) => ({
    id: `f-${i}`,
    buscable: `${mesLargo(f.mes)} ${f.titulo} ${f.proveedor ?? ""}${proyectado(f.mes) ? " proyección" : ""}`,
    celdas: {
      que: <CeldaPrincipal titulo={f.titulo} meta={`${mesLargo(f.mes)}${proyectado(f.mes) ? " (proyección)" : ""}${f.proveedor ? `, ${f.proveedor}` : ""}`} />,
      monto: <CeldaNumero sub={proyectado(f.mes) ? "proyección" : f.parcial ? "mes en curso" : undefined}>{dolares(f.montoUsd)}</CeldaNumero>,
      fuente: (
        <CeldaTexto>
          {proyectado(f.mes)
            ? "Proyección con el gasto de los últimos días, hasta que llegue su factura"
            : f.fuente === "factura"
              ? `Factura del proveedor${f.al ? `, al ${fechaConAnio(f.al)}` : ""}`
              : "Estimado, sin factura todavía"}
        </CeldaTexto>
      ),
    },
  }));
  const filasDeclaradas = (declarados ?? []).map((d, i) => ({
    id: `d-${i}`,
    buscable: `${mesLargo(d.mes)} ${d.concepto} ${CATEGORIA[d.categoria] ?? ""}`,
    celdas: {
      que: <CeldaPrincipal titulo={d.concepto} meta={`${mesLargo(d.mes)}, ${CATEGORIA[d.categoria] ?? "Otros"}`} />,
      monto: <CeldaNumero>{d.moneda === "PEN" ? `S/ ${numero(d.monto)}` : dolares(d.monto)}</CeldaNumero>,
      fuente: <CeldaTexto sub={d.nota ?? undefined}>{d.fuente}</CeldaTexto>,
    },
  }));
  const ultimaFactura = facturas?.filas.map((f) => f.al).filter(Boolean).sort().pop() ?? null;
  return (
    <Caja
      titulo="Lo que se paga fuera de la base"
      icono={<ReceiptText size={16} aria-hidden />}
      bajada="Servidores, base de datos y red. Estas cifras no las puede medir Vigía sola: salen de las facturas del proveedor o de lo que el equipo declara, y cada renglón dice cuál."
      fecha={ultimaFactura ?? (declarados?.[0]?.registrado ?? null)}
      fuente="Tabla costos_mes (uso facturado por AWS y la tarifa de Cloudflare, cargados cada mes) y tabla transparencia_costo (declarado a mano por el equipo)."
      className="lg:col-span-2"
    >
      {filasFactura.length + filasDeclaradas.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-paperSoft px-3 py-2 text-meta text-inkSoft">
          No medido: todavía no hay facturas cargadas ni costos declarados.
        </p>
      ) : (
        <TablaPaginada
          etiqueta="Costos de infraestructura por mes"
          nombre="renglones"
          tam={8}
          densidad="compacta"
          controles="abajo"
          columnas={COLUMNAS_FACTURAS}
          filas={[...filasDeclaradas, ...filasFactura]}
          buscar={{ placeholder: "Buscar por mes o concepto…", etiqueta: "Buscar en los costos de infraestructura" }}
        />
      )}
      {facturas?.tipoCambio && (
        <p className="text-rotulo text-mute">
          Tipo de cambio de referencia: S/ {facturas.tipoCambio.penPorUsd.toFixed(4)} por dólar ({mesLargo(facturas.tipoCambio.mes)}). {facturas.tipoCambio.fuente}
        </p>
      )}
    </Caja>
  );
}

/**
 * Pestaña «Costos y volumen»: cuánto se analizó y cuánto costó, medido en la base. Arriba las cuatro cifras; después
 * cada gasto en su caja (análisis, validación, lectura de documentos, masivo, almacenamiento) y, al final, lo que no se
 * puede medir desde aquí (las facturas).
 */
export function CostosVolumen({ costos, generado, sinRespuesta = [] }: { costos: Costos; generado: string; sinRespuesta?: string[] }) {
  const { analizados, analisis, validacion, lectores, masivo, almacenamiento } = costos;
  /** Este bloque se mide pero no respondió esta vez (no es «no medido»). */
  const cayo = (nombre: string) => sinRespuesta.includes(nombre);
  const total = analizados?.total ?? analisis?.n ?? null;
  return (
    <div className="space-y-5">
      <Indicadores
        items={[
          { valor: total == null ? null : numero(total), etiqueta: "contratos analizados", contexto: analizados?.porMes.length ? `desde ${mesLargo(analizados.porMes[0].mes)}` : undefined },
          { valor: analisis ? dolares(analisis.usd) : null, etiqueta: "costo de esos análisis", contexto: analisis ? `medido en ${numero(analisis.conCosto)} de ${numero(analisis.n)}` : cayo("costoAnalisis") ? "no respondió, recarga" : "no medido todavía", icono: <Banknote size={15} aria-hidden />, parte: null },
          { valor: analisis?.medioUsd != null ? dolares(analisis.medioUsd, 3) : null, etiqueta: "costo medio por contrato", contexto: "sólo la IA del análisis", icono: <Banknote size={15} aria-hidden /> },
          { valor: validacion ? dolares(validacion.usd) : null, etiqueta: "gastado en validar", contexto: validacion ? `${plural(validacion.corridas, "corrida", "corridas")} de las pruebas de oro` : cayo("validacion") ? "no respondió, recarga" : "sin corridas registradas", icono: <Target size={15} aria-hidden /> },
        ]}
      />

      <Nota icono={<GraduationCap size={15} aria-hidden />}>
        Vigía no entrena modelos: usa modelos ya entrenados y les da las reglas, las normas y los documentos de cada contrato. Por eso no hay un gasto
        de entrenamiento que mostrar. Lo que sí se gasta para saber si aciertan es la validación: correr cada versión contra las pruebas de oro.
      </Nota>

      <div className="grid gap-4 lg:grid-cols-2">
        {analisis ? (
          <Analisis analisis={analisis} />
        ) : cayo("costoAnalisis") ? (
          <NoRespondio titulo="Costo de los análisis por mes y por red" />
        ) : (
          <NoMedido titulo="Costo de los análisis por mes y por red">
            Cada análisis guarda su costo, pero el resumen que lo suma (tabla transparencia_analisis, migración 300) todavía no está en la base.
            {analizados ? ` Lo que sí se sabe: ${analizados.porMes.map((m) => `${mesLargo(m.mes)}, ${plural(m.n, "contrato", "contratos")}`).join("; ")}.` : ""}
          </NoMedido>
        )}

        {validacion ? (
          <Caja
            titulo="Validación: las pruebas de oro"
            icono={<Target size={16} aria-hidden />}
            fecha={validacion.hasta}
            fuente="Costo y tiempo de cada contrato de cada corrida (tabla golden_resultado), desde que las corridas se guardan en la base."
          >
            <dl className="grid grid-cols-2 gap-3">
              <div className="rounded-xl bg-paperSoft px-3 py-2">
                <dt className="text-rotulo text-mute">Gastado en validar</dt>
                <dd className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{dolares(validacion.usd)}</dd>
              </div>
              <div className="rounded-xl bg-paperSoft px-3 py-2">
                <dt className="text-rotulo text-mute">Análisis de prueba corridos</dt>
                <dd className="font-display text-cifra font-bold tabular-nums leading-tight text-ink">{numero(validacion.contratos)}</dd>
              </div>
              <div className="rounded-xl bg-paperSoft px-3 py-2">
                <dt className="text-rotulo text-mute">Corridas</dt>
                <dd className="font-mono text-dato tabular-nums text-ink">{numero(validacion.corridas)}, desde el {fechaConAnio(validacion.desde)}</dd>
              </div>
              <div className="rounded-xl bg-paperSoft px-3 py-2">
                <dt className="text-rotulo text-mute">Tiempo de máquina</dt>
                <dd className="font-mono text-dato tabular-nums text-ink">{numero(validacion.segundos / 3600)} horas</dd>
              </div>
            </dl>
            <p className="text-meta leading-relaxed text-inkSoft">
              Las corridas anteriores al {fechaConAnio(validacion.desde)} no se guardaron en la base y no están en esta suma.
            </p>
          </Caja>
        ) : cayo("validacion") ? (
          <NoRespondio titulo="Gasto en validación" />
        ) : (
          <NoMedido titulo="Gasto en validación">Todavía no hay corridas de las pruebas de oro con su costo en la base.</NoMedido>
        )}

        {lectores ? <Lectores lectores={lectores} /> : cayo("lectores") ? <NoRespondio titulo="Lectura de documentos" /> : <NoMedido titulo="Lectura de documentos">La tabla de lecturas no está en la base.</NoMedido>}
        {masivo ? <Masivo masivo={masivo} /> : cayo("masivo") ? <NoRespondio titulo="Análisis masivo" /> : <NoMedido titulo="Análisis masivo">El libro del masivo no está en la base.</NoMedido>}
        {almacenamiento ? <Almacenamiento alm={almacenamiento} generado={generado} /> : cayo("almacenamiento") ? <NoRespondio titulo="Almacenamiento" /> : <NoMedido titulo="Almacenamiento">La base no informó su tamaño.</NoMedido>}
        {cayo("facturas") && !costos.facturas ? <NoRespondio titulo="Lo que se paga fuera de la base" /> : <Facturas facturas={costos.facturas} declarados={costos.declarados} />}
      </div>
    </div>
  );
}
