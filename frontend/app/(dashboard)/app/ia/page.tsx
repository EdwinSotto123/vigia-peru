import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Banknote, ChevronRight, Eye, FileSearch, FileText, GitCompare, ListChecks, ScanText, ShieldCheck, UserCheck } from "lucide-react";
import { canonica } from "@/lib/seo";
import { Ayuda, CapitulosRelato, EnUnaFrase, EncabezadoPagina, EstadoError, FuenteDato, Migas, Nota, Pagina, type CapituloRelato } from "@/components/patrones";
import { BarraPartes } from "@/components/inicio/BarraPartes";
import { MuestraSerie, colorSerie } from "@/components/charts/BarraSegmentada";
import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { Dato } from "@/components/ui/Dato";
import { CLASE_ACCION_LISTA, EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { ICONO_NIVEL, Severidad as PastillaSeveridad } from "@/components/ui/Severidad";
import { TIPO_CRUCE, chipCruce } from "@/lib/cruces";
import { decimal, fechaConAnio, numero, oracion, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { NOMBRE_CLASE, getResumenIa, type ClaseLeida, type ResumenIa, type Severidad } from "@/lib/ia";
import { P_MEN, rutaMenor } from "@/lib/menores";
import { rutaContrato } from "@/lib/rutas";
import { textoSenal } from "@/lib/senalesMenor";
import { nombreModelo } from "@/lib/modelos";
import { cn } from "@/lib/utils";
import { VistasComoTrabaja } from "@/components/sitio/VistasSeccion";

export const revalidate = 3600;

export const metadata: Metadata = {
  title: "Lo que leyó la IA",
  description:
    "Todo lo que la IA de Vigía leyó en los documentos de las compras públicas, lo que encontró y cómo se controla: dictámenes, actas, bases, consultas y contratos menores.",
  alternates: canonica("/app/ia"),
};

/**
 * /app/ia: todo lo que hizo la IA, contado como una historia (pedido del usuario del 2026-11-05: «¿qué ha predicho la IA,
 * análisis, resúmenes y demás, o solo ha detectado banderas?» y «solo apilamos sin dar orden o contar una historia»).
 * Antes cada cosa vivía suelta en su ficha (el dictamen en la del proceso, la lectura del requerimiento en la del contrato
 * menor) y nadie veía el conjunto.
 *
 * El orden es el de la lectura, de lo que entra a lo que sale y a cómo se vigila (capítulos que se leen de a uno):
 *   EnUnaFrase  qué hizo en una oración, con sus cifras: lee y compara, no predice.
 *   1 Qué lee           los cuatro pasos (documento, lectura, comparación, señal) y cuánto leyó de cada documento.
 *   2 Los dictámenes    el análisis completo de un proceso: por peso del riesgo y los más recientes con puntaje alto.
 *   3 Contratos menores lo que saca del requerimiento y del contrato, qué no cuadró (por tipo) y un ejemplo de cada uno.
 *   4 Actas, bases y consultas  lo mismo para los procesos de selección.
 *   5 Cómo se controla  dos lecturas, la tercera mirada a las marcas, la revisión humana, lo que no hace y lo que cuesta.
 *
 * Datos: GET /ia/resumen (lib/ia.ts), una hora de caché. Los nombres de personas ya vienen tapados y los ejemplos no traen al
 * proveedor (en un contrato menor suele ser una persona natural): se enlaza la entidad y el contrato, nunca un RUC 10.
 */
export default async function IaPage() {
  const r = await getResumenIa();
  return (
    <Pagina className="space-y-6">
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Lo que leyó la IA", href: "/app/ia" }]} />
      <EncabezadoPagina
        titulo="Lo que leyó la IA"
        bajada="Qué documentos leyó, qué encontró en ellos y cómo se controla, en orden."
        ayuda={
          <Ayuda titulo="¿La IA predice algo?">
            No. Lee los documentos que el Estado publica, saca sus hechos (quién ofertó, qué se exigió, qué monto dice el
            contrato) y los compara con lo que el mismo Estado registró. Cuando algo no cuadra, lo señala con su evidencia y
            su enlace al documento.
          </Ayuda>
        }
      />
      <VistasComoTrabaja activa="ia" />
      {r ? <Relato r={r} /> : <EstadoError>Vuelve a intentarlo en unos minutos: las cifras de las lecturas no llegaron.</EstadoError>}
    </Pagina>
  );
}

function Relato({ r }: { r: ResumenIa }) {
  const dictamenes = r.dictamenes.publicados + r.dictamenes.enRevision;
  const conHallazgo = r.procesos.conHallazgo + r.menores.conHallazgo;
  const p = r.procesos;
  // Los capítulos se leen de a uno («divídelo por subsecciones, menos scroll»): la página medía casi 5 000 px.
  const capitulos: CapituloRelato[] = [
    {
      id: "que-lee",
      titulo: "Qué lee",
      bajada: "Del documento a la señal, siempre en los mismos cuatro pasos.",
      contenido: <CapituloQueLee r={r} dictamenes={dictamenes} conHallazgo={conHallazgo} />,
    },
    {
      id: "dictamenes",
      titulo: "Los dictámenes",
      conteo: dictamenes,
      bajada: "El análisis completo de un proceso: varios agentes leen el expediente, cruzan los registros y escriben un informe con su puntaje y sus señales.",
      accion: (
        <Link href="/app/contratos?lectura=publicado&orden=score" prefetch={false} className={CLASE_ACCION_LISTA}>
          Ver los {numero(r.dictamenes.publicados)} publicados
        </Link>
      ),
      contenido: <CapituloDictamenes r={r} />,
    },
    {
      id: "menores",
      titulo: "Contratos menores",
      tituloLargo: "Los contratos menores",
      conteo: r.menores.conHallazgo,
      tono: "media",
      bajada: "Compras de hasta 8 UIT, sin proceso de selección: lee lo que la entidad pidió y lo que firmó, y los compara con lo que registró en el SEACE.",
      accion: (
        <Link href={MENORES_CON_HALLAZGO} prefetch={false} className={CLASE_ACCION_LISTA}>
          Ver los {numero(r.menores.conHallazgo)} con hallazgo
        </Link>
      ),
      contenido: <CapituloMenores r={r} />,
    },
    {
      id: "procesos",
      titulo: "Actas, bases y consultas",
      tituloLargo: "Las actas, las bases y las consultas",
      conteo: p.conHallazgo,
      tono: "media",
      bajada: "En los procesos de selección lee lo que se exigió para competir, lo que reclamaron los participantes y por qué quedó fuera cada postor.",
      accion: p.hallazgos.length ? (
        <Link href={`/app/contratos?cruce=${p.hallazgos.map((h) => h.tipo).join(",")}`} prefetch={false} className={CLASE_ACCION_LISTA}>
          Ver los {numero(p.conHallazgo)} procesos
        </Link>
      ) : undefined,
      contenido: <CapituloProcesos r={r} />,
    },
    {
      id: "control",
      titulo: "Cómo se controla",
      bajada: "Lo que hace falta para que una lectura se convierta en una señal, y lo que la IA no hace.",
      contenido: <CapituloControl r={r} />,
    },
  ];
  return (
    <>
      <EnUnaFrase
        datos={
          <>
            <Dato tipo="documento">{plural(r.totales.lecturas, "lectura", "lecturas")}</Dato>
            <Dato icono={FileSearch} nombre="Con hallazgo">
              {plural(conHallazgo, "contrato", "contratos")} con algo que no cuadra
            </Dato>
            {r.ultimaLectura && <Dato tipo="fecha">Última lectura: {fechaConAnio(r.ultimaLectura)}</Dato>}
          </>
        }
      >
        La IA leyó {numero(r.totales.documentos)} documentos de {numero(r.totales.contratos)} contratos y escribió{" "}
        {plural(dictamenes, "dictamen", "dictámenes")}: no predice nada, lee, compara con lo registrado y señala lo que no
        cuadra. Casi todas sus señales salen sólo si dos lecturas coinciden.
      </EnUnaFrase>

      <CapitulosRelato capitulos={capitulos} etiqueta="Capítulos de lo que hizo la IA" />

      <FuenteDato fuente="Lecturas de Vigía sobre los documentos que las entidades publican en el SEACE" fecha={r.ultimaLectura} />
    </>
  );
}

// ─── 1. Qué lee ──────────────────────────────────────────────────────────────

const PASOS: { icono: typeof FileText; titulo: string; texto: string }[] = [
  { icono: FileText, titulo: "Documento", texto: "El PDF que la entidad publicó en el SEACE: las bases, el acta, el contrato, el requerimiento." },
  { icono: ScanText, titulo: "Lectura", texto: "Saca los hechos con un formulario fijo: quién ofertó, qué se exigió, qué monto dice. No opina." },
  { icono: GitCompare, titulo: "Comparación", texto: "Reglas de Vigía cruzan esos hechos con lo registrado: el monto, el RUC, el valor referencial." },
  { icono: ListChecks, titulo: "Señal", texto: "Si algo no cuadra y otra lectura lo confirma, sale la señal con la cita del documento." },
];

function CapituloQueLee({ r, dictamenes, conHallazgo }: { r: ResumenIa; dictamenes: number; conHallazgo: number }) {
  const confirmar = Math.max(0, r.totales.lecturas - r.totales.documentos);
  return (
    <>
      <div className="space-y-5">
        <ol aria-label="Los cuatro pasos de una lectura" className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {PASOS.map((p, i) => (
            <li key={p.titulo} className="relative flex items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-granate" aria-hidden>
                <p.icono size={16} />
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5 text-dato font-semibold leading-snug text-ink">
                  <span className="font-mono text-mute">{i + 1}</span>
                  {p.titulo}
                </span>
                <span className="mt-0.5 block text-meta leading-snug text-mute">{p.texto}</span>
              </span>
              {i < PASOS.length - 1 && (
                <ChevronRight size={16} className="absolute -right-2.5 top-1/2 hidden -translate-y-1/2 rounded-full bg-paper text-mute xl:block" aria-hidden />
              )}
            </li>
          ))}
        </ol>

        <CifrasEnFila
          items={[
            { valor: numero(r.totales.documentos), etiqueta: "documentos leídos", contexto: `de ${plural(r.totales.contratos, "contrato", "contratos")}` },
            { valor: numero(r.totales.lecturas), etiqueta: "lecturas", contexto: `${numero(confirmar)} para confirmar lo que encontró la primera` },
            { valor: numero(dictamenes), etiqueta: "dictámenes", contexto: `${numero(r.dictamenes.publicados)} publicados`, href: "#dictamenes" },
            { valor: numero(conHallazgo), etiqueta: "contratos con un hallazgo", contexto: "publicado, con su evidencia", tono: "media" },
          ]}
        />

        <div className="rounded-2xl border border-line bg-paper px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h3 className="font-display text-bloque font-bold leading-tight text-ink">Cuánto leyó de cada documento</h3>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-rotulo text-inkSoft" aria-label="Leyenda">
              <li className="inline-flex items-center gap-1.5">
                <span className="inline-block size-2.5 rounded-sm" style={{ background: "rgb(var(--serie-1) / 0.3)" }} aria-hidden />
                Leídos
              </li>
              <li className="inline-flex items-center gap-1.5">
                <MuestraSerie i={0} />
                Con un hallazgo publicado
              </li>
            </ul>
          </div>
          <div className="mt-3 grid gap-x-10 gap-y-5 lg:grid-cols-2">
            <BarrasDocumentos titulo="En los procesos de selección" clases={r.procesos.clases} contratos={r.procesos.contratos} />
            <BarrasDocumentos titulo="En los contratos menores" clases={r.menores.clases} contratos={r.menores.contratos} />
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * Una barra por documento: su largo, los leídos (contra el más leído de los dos lados, así las dos columnas se comparan);
 * la parte llena, los que tienen un hallazgo publicado. El contrato firmado no da señales propias: se dice con palabras.
 */
function BarrasDocumentos({ titulo, clases, contratos }: { titulo: string; clases: ClaseLeida[]; contratos: number }) {
  const max = Math.max(1, ...clases.map((c) => c.documentos));
  return (
    <div>
      <p className="text-meta font-semibold text-inkSoft">
        {titulo}: {plural(contratos, "contrato", "contratos")}
      </p>
      <ul className="mt-2 space-y-3">
        {clases.map((c) => {
          const nombre = NOMBRE_CLASE[c.clase as keyof typeof NOMBRE_CLASE];
          const parte = c.conHallazgo != null && c.documentos > 0 ? c.conHallazgo / c.documentos : null;
          const texto = `${nombre?.nombre ?? c.clase}: ${numero(c.documentos)} leídos${c.conHallazgo != null ? `, ${numero(c.conHallazgo)} con un hallazgo` : ""}`;
          return (
            <li key={c.clase} title={texto}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-dato font-semibold text-ink">{nombre?.nombre ?? c.clase}</span>
                <span className="shrink-0 font-mono text-dato font-semibold tabular-nums text-ink">{numero(c.documentos)}</span>
              </div>
              <div role="img" aria-label={texto} className="mt-1 h-2.5 w-full rounded-full bg-paperDeep">
                <div className="flex h-full overflow-hidden rounded-full" style={{ width: `${Math.max(1, (100 * c.documentos) / max)}%`, background: "rgb(var(--serie-1) / 0.3)" }}>
                  {parte != null && parte > 0 && <span className="h-full min-w-0.5" style={{ width: `${100 * parte}%`, background: colorSerie(0) }} />}
                </div>
              </div>
              <p className="mt-1 text-rotulo leading-snug text-mute">
                {c.conHallazgo == null
                  ? "Sin señales propias: sus datos (plazo, garantía, penalidades) van a la ficha del contrato."
                  : `${numero(c.conHallazgo)} con un hallazgo publicado (${porcentaje(parte != null ? 100 * parte : 0)})`}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── 2. Los dictámenes ───────────────────────────────────────────────────────

function CapituloDictamenes({ r }: { r: ResumenIa }) {
  const d = r.dictamenes;
  return (
    <>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <div className="space-y-3 rounded-2xl border border-line bg-paper px-4 py-4">
          <h3 className="font-display text-bloque font-bold leading-tight text-ink">Publicados, por peso del riesgo</h3>
          <BarraPartes
            etiqueta="Dictámenes publicados por peso del riesgo"
            partes={[
              { clave: "alto", etiqueta: "Riesgo alto (70 o más)", n: d.tramos.alto, clase: "bg-crimson", href: "/app/contratos?riesgo=alto", destacada: true },
              { clave: "medio", etiqueta: "Riesgo medio (40 a 69)", n: d.tramos.medio, clase: "bg-amber", href: "/app/contratos?riesgo=medio" },
              { clave: "bajo", etiqueta: "Riesgo bajo (1 a 39)", n: d.tramos.bajo, clase: "bg-inkSoft/60", href: "/app/contratos?riesgo=bajo" },
              { clave: "sin", etiqueta: "Sin señales", n: d.tramos.sinSenales, clase: "bg-inkSoft/25" },
            ]}
          />
          <Nota icono={<UserCheck size={15} aria-hidden />}>
            {d.enRevision > 0 ? (
              <>
                {d.enRevision === 1 ? "Otro" : "Otros"}{" "}
                <Link href="/app/hallazgos?vista=revision" prefetch={false} className="font-semibold text-granate underline-offset-2 hover:underline">
                  {plural(d.enRevision, "dictamen espera", "dictámenes esperan")}
                </Link>{" "}
                a una persona: no pasaron su autoevaluación y no se publican hasta que alguien los revise.
              </>
            ) : (
              "Ningún dictamen espera revisión humana ahora: los que no pasan su autoevaluación no se publican hasta que una persona los revisa."
            )}
          </Nota>
        </div>

        <div className="min-w-0">
          <p className="mb-2 text-meta font-semibold text-inkSoft">
            Los más recientes con puntaje de 60 o más ({numero(d.fuertes)} en total)
          </p>
          {d.ejemplos.length ? (
            <ul className="grid gap-2.5 md:grid-cols-2">
              {d.ejemplos.map((x, i) => (
                <FilaEjemplo
                  key={x.convocatoria ?? i}
                  href={x.convocatoria ? rutaContrato(x.convocatoria, "dictamen") : null}
                  titulo={oracion(x.objeto ?? "Proceso sin descripción")}
                  cabecera={
                    <span className="inline-flex items-center gap-2">
                      <PastillaSeveridad score={x.score} />
                      <span className="font-mono text-rotulo font-semibold tabular-nums text-ink">Puntaje {numero(x.score)}</span>
                    </span>
                  }
                  datos={[
                    <Entidad key="e" nombre={x.entidad} ruc={x.entidadRuc} />,
                    x.region ? <Dato key="l" tipo="lugar">{x.region}</Dato> : null,
                    x.monto != null ? <Dato key="m" icono={Banknote} nombre="Monto">{solesCompacto(x.monto)}</Dato> : null,
                    x.fecha ? <Dato key="f" tipo="fecha">Escrito el {fechaConAnio(x.fecha)}</Dato> : null,
                  ]}
                  chips={x.principales.map((p) => ({ severidad: p.severidad, texto: p.etiqueta }))}
                  pie={x.senales > x.principales.length ? `y ${plural(x.senales - x.principales.length, "señal más", "señales más")}` : null}
                />
              ))}
            </ul>
          ) : (
            <Nota>Todavía no hay dictámenes publicados con puntaje de 60 o más.</Nota>
          )}
        </div>
      </div>
    </>
  );
}

// ─── 3. Los contratos menores ────────────────────────────────────────────────

const MENORES_CON_HALLAZGO = `/app/contratos?vista=menores&${P_MEN.senal}=documento`;

const SE_PIDIO = ["Qué se pide y para qué", "La experiencia y el perfil que exige", "Las marcas que nombra y si admite «o equivalente»", "Si dice a quién contratar", "El monto que estima"];
const DICE_CONTRATO = ["Si es contrato, orden de compra u orden de servicio", "El monto", "El RUC de con quién se firmó", "Los ítems con su precio unitario", "El plazo y la penalidad"];

function CapituloMenores({ r }: { r: ResumenIa }) {
  const m = r.menores;
  const tdr = m.clases.find((c) => c.clase === "menor_tdr");
  const contrato = m.clases.find((c) => c.clase === "menor_contrato");
  return (
    <>
      <div className="space-y-5">
        <figure className="grid items-stretch gap-2.5 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <Extrae titulo="Lo que se pidió" documento={`El requerimiento: ${plural(tdr?.documentos ?? 0, "leído", "leídos")}`} items={SE_PIDIO} />
          <div className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-paperEdge px-3 py-2 text-center text-meta font-semibold text-inkSoft md:flex-col md:py-3">
            <GitCompare size={16} className="text-granate" aria-hidden />
            <span className="max-w-[9rem] leading-snug">Se compara con lo que registra el SEACE</span>
          </div>
          <Extrae titulo="Lo que dice el contrato" documento={`El contrato u orden: ${plural(contrato?.documentos ?? 0, "leído", "leídos")}`} items={DICE_CONTRATO} />
          <figcaption className="sr-only">Lo que la IA extrae de cada documento de un contrato menor y con qué lo compara.</figcaption>
        </figure>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-3 rounded-2xl border border-line bg-paper px-4 py-4">
            <h3 className="font-display text-bloque font-bold leading-tight text-ink">Lo que no cuadró</h3>
            <Barras
              etiqueta="Contratos menores por lo que no cuadró"
              unidad={["contrato", "contratos"]}
              filas={m.hallazgos.map((h) => ({
                clave: h.tipo,
                nombre: textoSenal({ tipo: h.tipo, severidad: h.severidad, monto: null }).nombre,
                n: h.contratos,
                severidad: h.severidad,
                href: MENORES_CON_HALLAZGO,
              }))}
            />
            <p className="text-rotulo leading-snug text-mute">Un contrato puede tener más de un hallazgo: en total son {plural(m.conHallazgo, "contrato", "contratos")}.</p>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-meta font-semibold text-inkSoft">Un ejemplo de cada uno</p>
            {m.ejemplos.length ? (
              <ul className="grid gap-2.5 md:grid-cols-2">
                {m.ejemplos.map((x) => (
                  <FilaEjemplo
                    key={x.id}
                    href={rutaMenor(x.id)}
                    titulo={oracion(x.descripcion ?? x.codigo ?? "Contrato menor")}
                    datos={[
                      <Entidad key="e" nombre={x.entidad} ruc={x.entidadRuc} />,
                      x.monto != null ? <Dato key="m" icono={Banknote} nombre="Monto">{x.moneda && x.moneda !== "PEN" ? `${x.moneda} ${numero(x.monto)}` : solesCompacto(x.monto)}</Dato> : null,
                      x.fecha ? <Dato key="f" tipo="fecha">{fechaConAnio(x.fecha)}</Dato> : null,
                    ]}
                    chips={(x.tipos.length ? x.tipos : [x.tipo]).map((t) => {
                      const sev = m.hallazgos.find((h) => h.tipo === t)?.severidad ?? x.severidad;
                      return { severidad: sev, texto: textoSenal({ tipo: t, severidad: sev, monto: null }).chip };
                    })}
                  />
                ))}
              </ul>
            ) : (
              <Nota>Todavía no hay contratos menores con un hallazgo de lectura.</Nota>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function Extrae({ titulo, documento, items }: { titulo: string; documento: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-line bg-paper px-3.5 py-3">
      <p className="text-dato font-semibold text-ink">{titulo}</p>
      <p className="text-rotulo text-mute">{documento}</p>
      <ul className="mt-2 space-y-1">
        {items.map((t) => (
          <li key={t} className="flex items-start gap-2 text-meta leading-snug text-inkSoft">
            <Eye size={13} className="mt-0.5 shrink-0 text-mute" aria-hidden />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── 4. Actas, bases y consultas ─────────────────────────────────────────────

function CapituloProcesos({ r }: { r: ResumenIa }) {
  const p = r.procesos;
  const conHallazgos = p.clases.filter((c) => c.clase !== "contrato");
  return (
    <>
      <div className="space-y-5">
        <ol aria-label="Lo que saca de cada documento" className="grid gap-2.5 sm:grid-cols-3">
          {conHallazgos.map((c, i) => (
            <li key={c.clase} className="flex items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3">
              <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-paperDeep font-mono text-meta font-bold text-inkSoft" aria-hidden>
                {i + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-dato font-semibold leading-snug text-ink">{NOMBRE_CLASE[c.clase].nombre}</span>
                <span className="mt-0.5 block text-meta leading-snug text-mute">{NOMBRE_CLASE[c.clase].que}</span>
                <span className="mt-1 block text-rotulo text-inkSoft">
                  {plural(c.documentos, "leída", "leídas")}
                  {c.conHallazgo != null ? `, ${numero(c.conHallazgo)} con un hallazgo` : ""}
                </span>
              </span>
            </li>
          ))}
        </ol>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-3 rounded-2xl border border-line bg-paper px-4 py-4">
            <h3 className="font-display text-bloque font-bold leading-tight text-ink">Lo que encontró</h3>
            <Barras
              etiqueta="Procesos por lo que encontró en sus documentos"
              unidad={["proceso", "procesos"]}
              filas={p.hallazgos.map((h) => ({
                clave: h.tipo,
                nombre: TIPO_CRUCE[h.tipo]?.corto ?? h.etiqueta,
                n: h.procesos,
                severidad: h.severidad,
                // `cruce` y no `cruces`: éste acepta hasta 40 letras y «consultas_observaciones_a_requisitos_rechazadas» tiene 47.
                href: `/app/contratos?cruce=${h.tipo}`,
              }))}
            />
            <p className="text-rotulo leading-snug text-mute">Un proceso puede tener más de un hallazgo: en total son {plural(p.conHallazgo, "proceso", "procesos")}.</p>
          </div>
          <div className="min-w-0">
            <p className="mb-2 text-meta font-semibold text-inkSoft">Los que juntan más hallazgos</p>
            {p.ejemplos.length ? (
              <ul className="grid gap-2.5 md:grid-cols-2">
                {p.ejemplos.map((x) => (
                  <FilaEjemplo
                    key={x.ocid}
                    href={rutaContrato(x.ocid)}
                    titulo={oracion(x.objeto ?? x.codigo ?? "Proceso sin descripción")}
                    datos={[
                      <Entidad key="e" nombre={x.entidad} ruc={x.entidadRuc} />,
                      x.monto != null ? <Dato key="m" icono={Banknote} nombre="Monto">{solesCompacto(x.monto)}</Dato> : null,
                      x.fecha ? <Dato key="f" tipo="fecha">Buena pro el {fechaConAnio(x.fecha)}</Dato> : null,
                    ]}
                    chips={x.hallazgos.map((h) => ({ severidad: h.severidad, texto: chipCruce(h.tipo) }))}
                  />
                ))}
              </ul>
            ) : (
              <Nota>Todavía no hay procesos con un hallazgo publicado en sus documentos.</Nota>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

// ─── 5. Cómo se controla ─────────────────────────────────────────────────────

/** «claude-haiku-5-5» → «Claude Haiku 5.5». */
function CapituloControl({ r }: { r: ResumenIa }) {
  const confirmar = Math.max(0, r.totales.lecturas - r.totales.documentos);
  const modelos = r.modelos.length ? [...new Set(r.modelos.map((m) => nombreModelo(m) ?? m))].join(" y ") : "un modelo de lenguaje";
  const porLectura = r.totales.lecturas > 0 ? r.totales.costoUsd / r.totales.lecturas : null;
  const controles: { icono: typeof ShieldCheck; titulo: string; texto: ReactNode }[] = [
    {
      icono: ShieldCheck,
      titulo: "Dos lecturas que coinciden",
      texto: `Cada documento con una posible señal se vuelve a leer por separado y la señal sale sólo si las dos lecturas la encuentran (en las actas de buena pro, mientras llega la segunda lectura, la señal sale con una): ${plural(confirmar, "lectura fue", "lecturas fueron")} para confirmar.`,
    },
    {
      icono: Eye,
      titulo: "Una tercera mirada a las marcas",
      texto: "Si un requerimiento nombra una marca, otra lectura revisa si es la que se exige o la del equipo que la entidad ya tiene: el tóner de su impresora no cuenta.",
    },
    {
      icono: ListChecks,
      titulo: "Las reglas las pone Vigía",
      texto: "El modelo sólo llena un formulario con lo que dice el documento. Las señales salen de reglas escritas y probadas con documentos revisados a mano.",
    },
    {
      icono: UserCheck,
      titulo: "Una persona revisa los dictámenes",
      texto: `Un dictamen que no pasa su autoevaluación no se publica hasta que alguien lo revisa: hoy ${r.dictamenes.enRevision === 1 ? "espera 1" : `esperan ${numero(r.dictamenes.enRevision)}`}.`,
    },
  ];
  return (
    <>
      <div className="space-y-4">
        <ol className="grid gap-2.5 sm:grid-cols-2">
          {controles.map((c, i) => (
            <li key={c.titulo} className="flex items-start gap-3 rounded-xl border border-line bg-paper px-3.5 py-3">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-granate" aria-hidden>
                <c.icono size={16} />
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-1.5 text-dato font-semibold leading-snug text-ink">
                  <span className="font-mono text-mute">{i + 1}</span>
                  {c.titulo}
                </span>
                <span className="mt-0.5 block text-meta leading-snug text-mute">{c.texto}</span>
              </span>
            </li>
          ))}
        </ol>

        <Nota>
          <strong className="font-semibold text-ink">Lo que no hace:</strong> no predice qué va a pasar, no acusa a nadie ni
          decide si hubo un delito. Una señal es un indicio para volver al documento, que siempre va enlazado. Tampoco guarda
          DNI: lo que lee de una persona se publica con un apellido tapado.
        </Nota>
        <Nota icono={<ScanText size={15} aria-hidden />}>
          Los documentos los lee {modelos}: USD {decimal(r.totales.costoUsd, 2)} por {plural(r.totales.lecturas, "lectura", "lecturas")},{" "}
          {porLectura != null && porLectura < 0.005 ? "menos de medio centavo de dólar cada una" : `USD ${decimal(porLectura, 3)} cada una`}.
        </Nota>

        <div className="flex flex-wrap gap-2">
          <EnlaceAccion href="/app/hallazgos" variante="secundario" flecha prefetch={false}>
            Todas las señales publicadas
          </EnlaceAccion>
          <EnlaceAccion href="/app/auditoria" variante="secundario" flecha prefetch={false}>
            Lo que se lee ahora
          </EnlaceAccion>
        </div>
      </div>
    </>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────────────────

const CHIP_SEV: Record<Severidad, string> = {
  alta: "border-crimson/30 bg-crimson-soft text-crimsonTexto",
  media: "border-amber/30 bg-amber-soft text-amberTexto",
  baja: "border-line bg-paperSoft text-inkSoft",
};
const COLOR_SEV: Record<Severidad, string> = { alta: "text-crimsonTexto", media: "text-amberTexto", baja: "text-mute" };
const PALABRA_SEV: Record<Severidad, string> = { alta: "Señal alta", media: "Señal media", baja: "Señal baja" };

/** La entidad de un ejemplo, enlazada a su ficha (sólo un RUC 20: el de una persona natural nunca se enlaza). */
function Entidad({ nombre, ruc }: { nombre: string | null; ruc: string | null }) {
  if (!nombre) return null;
  return (
    <Dato tipo="entidad">
      {ruc && /^20\d{9}$/.test(ruc) ? (
        <Link href={`/entidad/${ruc}`} prefetch={false} className="text-granate underline-offset-2 hover:underline">
          {nombre}
        </Link>
      ) : (
        nombre
      )}
    </Dato>
  );
}

/** Un ejemplo: su título enlazado (el dictamen, el proceso o el contrato menor), sus datos y lo que se encontró. */
function FilaEjemplo({
  href,
  titulo,
  cabecera,
  datos,
  chips,
  pie,
}: {
  href: string | null;
  titulo: string;
  cabecera?: ReactNode;
  datos: ReactNode[];
  chips: { severidad: Severidad; texto: string }[];
  pie?: string | null;
}) {
  return (
    <li className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-line bg-paper px-3.5 py-3">
      {cabecera}
      {href ? (
        <Link href={href} prefetch={false} className="group line-clamp-3 text-dato font-semibold leading-snug text-granate underline-offset-2 hover:underline">
          {titulo}
          <ArrowRight size={13} className="ml-1 inline-block align-[-1px] opacity-60 transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ) : (
        <p className="line-clamp-3 text-dato font-semibold leading-snug text-ink">{titulo}</p>
      )}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-rotulo text-inkSoft">{datos.filter(Boolean)}</div>
      {chips.length > 0 && (
        <ul className="mt-0.5 flex flex-wrap gap-1.5" aria-label="Lo que se encontró">
          {chips.map((c) => {
            const Icono = ICONO_NIVEL[c.severidad];
            return (
              <li key={c.texto} className={cn("inline-flex min-h-6 items-center gap-1 rounded-full border px-2 text-rotulo font-semibold", CHIP_SEV[c.severidad])}>
                <Icono size={12} className={cn("shrink-0", COLOR_SEV[c.severidad])} aria-hidden />
                <span className="sr-only">{PALABRA_SEV[c.severidad]}: </span>
                {c.texto}
              </li>
            );
          })}
          {pie && <li className="inline-flex min-h-6 items-center text-rotulo text-mute">{pie}</li>}
        </ul>
      )}
    </li>
  );
}

/**
 * Barras horizontales de una sola serie (cuántos contratos por tipo de hallazgo), contra el mayor: el nombre con el ícono
 * de su gravedad (forma y color, nunca sólo color), la cifra a la derecha y cada fila enlazada a su lista.
 */
function Barras({
  filas,
  etiqueta,
  unidad,
}: {
  filas: { clave: string; nombre: string; n: number; severidad: Severidad; href?: string }[];
  etiqueta: string;
  unidad: [string, string];
}) {
  if (!filas.length) return <p className="text-meta text-mute">Ninguno todavía.</p>;
  const max = Math.max(1, ...filas.map((f) => f.n));
  return (
    <ul aria-label={etiqueta} className="space-y-1">
      {filas.map((f) => {
        const Icono = ICONO_NIVEL[f.severidad];
        const texto = `${PALABRA_SEV[f.severidad]}, ${f.nombre}: ${plural(f.n, unidad[0], unidad[1])}`;
        const cuerpo = (
          <>
            <span className="flex items-start justify-between gap-3">
              <span className="flex min-w-0 items-start gap-1.5 text-meta font-semibold leading-snug text-ink">
                <Icono size={13} className={cn("mt-0.5 shrink-0", COLOR_SEV[f.severidad])} aria-hidden />
                <span className="sr-only">{PALABRA_SEV[f.severidad]}: </span>
                <span className={cn(f.href && "underline-offset-2 group-hover:text-granate group-hover:underline")}>{f.nombre}</span>
              </span>
              <span className="shrink-0 font-mono text-meta font-semibold tabular-nums text-ink">{numero(f.n)}</span>
            </span>
            <span aria-hidden className="mt-1 block h-1.5 w-full rounded-full bg-paperDeep">
              <span className="block h-full min-w-0.5 rounded-full" style={{ width: `${(100 * f.n) / max}%`, background: colorSerie(0) }} />
            </span>
          </>
        );
        return (
          <li key={f.clave} title={texto}>
            {f.href ? (
              <Link
                href={f.href}
                prefetch={false}
                aria-label={texto}
                className="group -mx-1.5 block rounded-md px-1.5 py-1 transition-colors duration-rapido hover:bg-granate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
              >
                {cuerpo}
              </Link>
            ) : (
              <span className="block py-1">{cuerpo}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
