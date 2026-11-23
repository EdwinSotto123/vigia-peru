import { Crosshair, Gauge, History, ListChecks, Scale, Target } from "lucide-react";
import { ColumnasSerie } from "@/components/charts/ColumnasSerie";
import { Medidor } from "@/components/charts/BarraSegmentada";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, Tabla, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Nota } from "@/components/patrones";
import { decimal, fechaConAnio, numero, plural, porcentaje } from "@/lib/formato";
import { diaCorto, diaDe, dolares, type Corrida, type LegalMedido, type RedMedida, type Transparencia } from "@/lib/transparencia";
import { Caja, fechaHora, NoMedido, PieDato } from "./piezas";

const FUENTE_ORO = "Pruebas de oro (tablas golden_conjunto y golden_corrida), subidas después de cada corrida.";

const f1 = (v: number | null) => (v == null ? "Sin dato" : decimal(v, 3));
const pct = (v: number | null) => (v == null ? "Sin dato" : porcentaje(v, { decimales: 1 }));

/** Una red: su F1 de hoy, precisión y exhaustividad con barra, y la historia del F1 corrida por corrida. */
function TarjetaRed({ red }: { red: RedMedida }) {
  const u = red.ultima;
  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-paper p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-display text-cuerpo font-bold text-ink">{red.nombre}</h3>
        <span className="shrink-0 rounded-full bg-paperDeep px-2 py-0.5 text-rotulo font-medium tabular-nums text-inkSoft">
          {plural(u.contratos, "contrato", "contratos")}
        </span>
      </div>
      <p className="flex items-baseline gap-2">
        <span className="font-display text-cifra font-bold tabular-nums leading-none text-ink">{f1(u.f1)}</span>
        <span className="text-meta text-inkSoft">F1, de 0 a 1</span>
      </p>
      <dl className="space-y-2">
        <div>
          <div className="flex items-baseline justify-between gap-2 text-meta">
            <dt className="text-inkSoft">Precisión</dt>
            <dd className="font-mono tabular-nums text-ink">{pct(u.precision)}</dd>
          </div>
          {u.precision != null && <Medidor parte={u.precision / 100} etiqueta={`Precisión de ${red.nombre}: ${pct(u.precision)}`} className="mt-1" />}
        </div>
        <div>
          <div className="flex items-baseline justify-between gap-2 text-meta">
            <dt className="text-inkSoft">Exhaustividad</dt>
            <dd className="font-mono tabular-nums text-ink">{pct(u.exhaustividad)}</dd>
          </div>
          {u.exhaustividad != null && <Medidor parte={u.exhaustividad / 100} etiqueta={`Exhaustividad de ${red.nombre}: ${pct(u.exhaustividad)}`} className="mt-1" />}
        </div>
      </dl>
      <div>
        <p className="text-rotulo font-medium text-mute">F1 en cada corrida ({numero(red.corridas)})</p>
        <ColumnasSerie
          alto="bajo"
          tope={1}
          etiqueta={`F1 de ${red.nombre} en cada corrida de validación`}
          puntos={red.serie.map((c, i) => ({
            clave: `${c.fecha}-${i}`,
            rotulo: diaCorto(diaDe(c.fecha) ?? c.fecha),
            valor: c.f1,
            texto: f1(c.f1),
            detalle: `${fechaHora(c.fecha)}, versión ${c.version ?? "sin registrar"}: F1 ${f1(c.f1)}, precisión ${pct(c.precision)}, exhaustividad ${pct(c.exhaustividad)}`,
          }))}
        />
      </div>
      <dl className="mt-auto space-y-0.5 border-t border-line pt-2 text-rotulo text-mute">
        <div className="flex justify-between gap-2">
          <dt>Versión medida</dt>
          <dd className="font-mono text-inkSoft">{u.version ?? "Sin registrar"}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Fecha</dt>
          <dd className="tabular-nums text-inkSoft">{fechaHora(u.fecha)}</dd>
        </div>
      </dl>
    </li>
  );
}

const COLUMNAS_CORRIDAS: Columna[] = [
  { clave: "red", titulo: "Red y fecha", ancho: "minmax(170px,1.3fr)" },
  { clave: "f1", titulo: "F1", ancho: "64px", alinear: "der" },
  { clave: "precision", titulo: "Precisión", ancho: "84px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "exhaustividad", titulo: "Exhaustividad", ancho: "104px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "contratos", titulo: "Contratos", ancho: "84px", alinear: "der", desde: "md" },
  { clave: "costo", titulo: "Costo medio", ancho: "100px", alinear: "der", desde: "lg" },
  { clave: "tiempo", titulo: "Tiempo medio", ancho: "100px", alinear: "der", desde: "lg" },
  { clave: "version", titulo: "Versión", ancho: "120px", desde: "md" },
  { clave: "nota", titulo: "Qué cambió", ancho: "minmax(0,1.6fr)", desde: "xl" },
];

function filaCorrida(red: { clave: string; nombre: string }, c: Corrida, i: number): FilaFiltrable {
  return {
    id: `${red.clave}-${i}`,
    buscable: `${red.nombre} ${c.version ?? ""} ${c.nota ?? ""} ${c.fecha}`,
    valores: { red: red.clave },
    claves: { fecha: c.fecha, f1: c.f1 },
    celdas: {
      red: <CeldaPrincipal titulo={red.nombre} meta={fechaHora(c.fecha)} />,
      f1: <CeldaNumero>{f1(c.f1)}</CeldaNumero>,
      precision: <CeldaNumero>{pct(c.precision)}</CeldaNumero>,
      exhaustividad: <CeldaNumero>{pct(c.exhaustividad)}</CeldaNumero>,
      contratos: <CeldaNumero sub={c.errores ? `${numero(c.errores)} con error` : undefined}>{numero(c.contratos)}</CeldaNumero>,
      costo: <CeldaNumero>{c.usdMedio == null ? "Sin dato" : dolares(c.usdMedio, 3)}</CeldaNumero>,
      tiempo: <CeldaNumero>{c.segundosMedio == null ? "Sin dato" : `${numero(c.segundosMedio)} s`}</CeldaNumero>,
      version: <span className="font-mono text-rotulo text-inkSoft">{c.version ?? "Sin registrar"}</span>,
      nota: <CeldaTexto>{c.nota ?? "Sin nota"}</CeldaTexto>,
    },
  };
}

const COLUMNAS_LEGAL: Columna[] = [
  { clave: "red", titulo: "Red", ancho: "minmax(96px,1.4fr)" },
  { clave: "f1", titulo: "F1", ancho: "56px", alinear: "der" },
  { clave: "precision", titulo: "Precisión", ancho: "84px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "exhaustividad", titulo: "Exhaustividad", ancho: "104px", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "citas", titulo: "Citas válidas", ancho: "96px", alinear: "der" },
  { clave: "fecha", titulo: "Fecha", ancho: "150px", desde: "xl" },
];

function TablaLegal({ legal }: { legal: LegalMedido[] }) {
  return (
    <Tabla
      etiqueta="El analista legal en cada red, última corrida"
      densidad="compacta"
      columnas={COLUMNAS_LEGAL}
      filas={legal.map((l) => ({
        id: l.clave,
        celdas: {
          red: <CeldaPrincipal titulo={l.nombre} meta={`${plural(l.ultima.contratos, "contrato", "contratos")}, ${plural(l.corridas, "corrida", "corridas")}`} />,
          f1: <CeldaNumero>{f1(l.ultima.f1)}</CeldaNumero>,
          precision: <CeldaNumero>{pct(l.ultima.precision)}</CeldaNumero>,
          exhaustividad: <CeldaNumero>{pct(l.ultima.exhaustividad)}</CeldaNumero>,
          citas: l.ultima.citas ? (
            <CeldaNumero sub={`${numero(l.ultima.citas.ok)} de ${numero(l.ultima.citas.total)}`}>{porcentaje((100 * l.ultima.citas.ok) / l.ultima.citas.total, { decimales: 1 })}</CeldaNumero>
          ) : (
            <CeldaNumero>Sin dato</CeldaNumero>
          ),
          fecha: <span className="text-meta tabular-nums text-mute">{fechaHora(l.ultima.fecha)}</span>,
        },
      }))}
    />
  );
}

const MEDIDAS: { icono: typeof Target; titulo: string; texto: string }[] = [
  { icono: Crosshair, titulo: "Precisión", texto: "De cada 100 señales que el agente levantó, cuántas eran correctas según la lectura humana. Lo que falta para 100 son falsas alarmas." },
  { icono: ListChecks, titulo: "Exhaustividad", texto: "De cada 100 señales que el agente debía levantar, cuántas levantó. Lo que falta para 100 son señales que se le pasaron." },
  { icono: Gauge, titulo: "F1", texto: "Un solo número de 0 a 1 que junta las dos: sólo es alto si la precisión y la exhaustividad son altas a la vez." },
];

/**
 * Pestaña «Los agentes»: cada red de agentes contra su prueba de oro (contratos que una persona leyó entera y anotó qué
 * señales deben salir y cuáles no). Arriba las cinco redes con su historia; al lado qué significa cada medida; debajo el
 * analista legal (se mide aparte) y todas las corridas con buscador.
 */
export function Agentes({ agentes }: { agentes: Transparencia["agentes"] }) {
  if (!agentes || !agentes.redes.length) {
    return <NoMedido titulo="Precisión de los agentes">Todavía no hay corridas de las pruebas de oro subidas a la base.</NoMedido>;
  }
  const casos = agentes.redes.reduce((t, r) => t + r.casos, 0);
  const filas = agentes.redes.flatMap((r) => r.serie.map((c, i) => filaCorrida(r, c, i))).sort((a, b) => String(b.claves?.fecha).localeCompare(String(a.claves?.fecha)));
  return (
    <div className="space-y-5">
      <Nota icono={<Target size={15} aria-hidden />}>
        Una prueba de oro es un grupo de contratos que una persona leyó completos y anotó qué señales deben salir y cuáles no. Cada versión
        nueva de los agentes se corre contra esos {numero(casos)} contratos antes de publicarse. Las corridas se guardan desde el {fechaConAnio(diaDe(agentes.desde))}.
      </Nota>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {agentes.redes.map((r) => (
          <TarjetaRed key={r.clave} red={r} />
        ))}
        {/* La sexta celda de la rejilla: cómo se lee lo que dicen las otras cinco. */}
        <li className="min-w-0">
          <Caja titulo="Cómo leer cada medida" icono={<Gauge size={16} aria-hidden />} className="h-full">
            <dl className="space-y-3">
              {MEDIDAS.map(({ icono: Icono, titulo, texto }) => (
                <div key={titulo} className="flex gap-2.5">
                  <Icono size={15} className="mt-0.5 shrink-0 text-granate" aria-hidden />
                  <div className="min-w-0">
                    <dt className="text-dato font-semibold text-ink">{titulo}</dt>
                    <dd className="text-meta leading-relaxed text-inkSoft">{texto}</dd>
                  </div>
                </div>
              ))}
            </dl>
            <p className="rounded-xl bg-paperSoft px-3 py-2 text-meta leading-relaxed text-inkSoft">
              <strong className="font-semibold text-ink">Lo que no dice:</strong> son pocos contratos elegidos a mano, no una muestra de todo el Estado. Un
              F1 alto aquí no garantiza el mismo acierto en un contrato distinto.
            </p>
          </Caja>
        </li>
      </ul>
      {/* El pie de la rejilla en su recuadro: era un renglón gris suelto entre dos bloques (2026-11-23). */}
      <PieDato fecha={agentes.fecha} fuente={FUENTE_ORO} className="rounded-xl border border-line bg-paperSoft/70 px-3.5 py-2.5" />

      {agentes.legal.length > 0 && (
        <Caja
          titulo="El analista legal, medido aparte"
          icono={<Scale size={16} aria-hidden />}
          bajada="Es el agente que dice qué norma se habría incumplido. Se mide sobre los mismos contratos: si levantó la señal documental que debía y si las normas que cita existen y regían en la fecha del proceso."
          fecha={agentes.legal.map((l) => l.ultima.fecha).sort().pop()}
          fuente="Conjunto «legal» de las pruebas de oro (golden_corrida, sus métricas de citas)."
        >
          <TablaLegal legal={agentes.legal} />
        </Caja>
      )}

      {/* En su caja, con el título adentro: antes el título, el buscador y la tabla iban sueltos sobre el fondo. */}
      <Caja titulo="Todas las corridas de validación" icono={<History size={16} aria-hidden />} fecha={agentes.fecha} fuente={FUENTE_ORO} className="tarjeta">
        <TablaFiltrable
          etiqueta="Corridas de las pruebas de oro, de la más reciente a la más antigua"
          nombre="corridas"
          tam={10}
          densidad="compacta"
          columnas={COLUMNAS_CORRIDAS}
          filas={filas}
          buscar={{ placeholder: "Buscar por red, versión o qué cambió…", etiqueta: "Buscar en las corridas" }}
          filtros={[{ clave: "red", etiqueta: "Red de agentes", corta: "Red", opciones: agentes.redes.map((r) => ({ valor: r.clave, etiqueta: r.nombre })) }]}
        />
      </Caja>
    </div>
  );
}
