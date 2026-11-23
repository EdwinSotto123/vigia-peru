"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import Link from "next/link";
import { CloudOff, FileStack, Hourglass, ListChecks, ScanSearch, SearchX, UsersRound, X } from "lucide-react";
import { Buscador } from "@/components/listado/BarraFiltros";
import { CeldaFecha, CodigoFila, TablaPaginada, TablaSkeleton, type Columna, type Fila } from "@/components/listado";
import { AyudaTermino, Beneficios } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { VacioEnLinea } from "@/components/ui/VacioEnLinea";
import { N_BUSQUEDA_CONTROL, buscarEnControl, type BusquedaControl, type ResultadoControl } from "@/lib/corrupcion";
import { numero, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { cn } from "@/lib/utils";
import { ConTapados } from "@/components/Redact";
import { detalleDeInforme, recortarTexto, rucEntidad, textoObservacion } from "./DetalleInforme";
import { ChipTema, ChipsResponsabilidad } from "./piezas";

/**
 * «Buscar en lo que encontró la Contraloría» (pedido del dueño del 2026-11-16: un RAG de los informes de control). Busca
 * en las observaciones y los objetivos de las Fichas Resumen, por palabras y por sentido (GET /informes-control/buscar),
 * en todo el país (/app/contraloria) o sólo en los informes de una entidad (su pestaña Control). Cada resultado es UNA
 * observación con su tema, su entidad, su fecha y el número de su informe, y abre el mismo panel que la lista de
 * informes (`detalleDeInforme`).
 *
 * Cada búsqueda cuesta un embedding en la API y la API pone un tope por conexión (20 por minuto), así que aquí:
 *   · no se busca con menos de 3 letras, y se espera a que se deje de escribir (`ESPERA`) o a Enter;
 *   · lo ya buscado en esta pestaña del navegador no se vuelve a pedir (`memoria`), y un pedido nuevo cancela al anterior;
 *   · se piden de una vez los 30 resultados que da la API y se paginan aquí, sin otro pedido por página;
 *   · si la API dice «demasiados pedidos», no se pide nada más hasta que pase el tiempo que dice, y entonces se busca sola.
 */

const MIN = 3;
const ESPERA = 700;
const TAM = 10;
const EJEMPLOS = ["penalidad no aplicada", "obra paralizada", "pago sin conformidad", "adicional de obra", "bienes que no llegaron al almacén"];

/** Lo que se busca: sin espacios de más y con 3 letras o más (si no, nada); como mucho 300, el tope de la API. */
const limpio = (t: string) => (t.trim().length >= MIN ? t.trim().slice(0, 300) : "");

/** Lo ya buscado en esta pestaña, por entidad y texto. */
const memoria = new Map<string, BusquedaControl>();
const TOPE_MEMORIA = 40;
/** Hasta cuándo no se pide nada (la API respondió 429): vale para todos los buscadores de la página. */
let enPausaHasta = 0;

type Estado =
  | { tipo: "quieto" }
  | { tipo: "cargando"; q: string }
  | { tipo: "ok"; q: string; datos: BusquedaControl }
  | { tipo: "pausa"; q: string; hasta: number }
  | { tipo: "error"; q: string; motivo: "no_disponible" | "lenta" | "red" };

const MENSAJE_ERROR: Record<"no_disponible" | "lenta" | "red", string> = {
  no_disponible: "El buscador de informes de control no está disponible ahora.",
  lenta: "La búsqueda tardó demasiado: prueba con palabras más precisas.",
  red: "No pudimos buscar ahora.",
};

export function BuscadorControl({
  entidad = null,
  inicial = "",
  enUrl = false,
  ejemplos = false,
  variante = "pagina",
  onActivo,
  className,
}: {
  /** Sólo los informes de esta entidad (su pestaña Control). Sin ella, todo el país. */
  entidad?: { ruc: string; nombre?: string | null } | null;
  /** Lo que se busca al llegar (`?q=` de la página). */
  inicial?: string;
  /** La búsqueda va a la URL (`?q=`), para compartirla. */
  enUrl?: boolean;
  /** Ejemplos para empezar, debajo del campo. */
  ejemplos?: boolean;
  /** `caja`: en su tarjeta con título (dentro de una pestaña); `pagina`: suelto, la página ya tiene su título. */
  variante?: "pagina" | "caja";
  /** Si hay una búsqueda en curso (la pestaña de la entidad esconde su lista mientras tanto). */
  onActivo?: (activo: boolean) => void;
  className?: string;
}) {
  const ruc = entidad?.ruc ?? null;
  const [q, setQ] = useState(() => limpio(inicial));
  const [estado, setEstado] = useState<Estado>({ tipo: "quieto" });
  const [intento, setIntento] = useState(0);
  const idTitulo = useId();

  const buscar = useCallback((t: string) => setQ(limpio(t)), []);

  useEffect(() => {
    onActivo?.(q.length >= MIN);
  }, [q, onActivo]);

  // La búsqueda a la URL de la página (`?q=`), sin otra navegación.
  useEffect(() => {
    if (!enUrl) return;
    try {
      const u = new URL(window.location.href);
      if (q) u.searchParams.set("q", q);
      else u.searchParams.delete("q");
      if (u.href !== window.location.href) window.history.replaceState(window.history.state, "", u);
    } catch {
      /* sin URL, la búsqueda sigue igual */
    }
  }, [q, enUrl]);

  useEffect(() => {
    if (q.length < MIN) {
      setEstado({ tipo: "quieto" });
      return;
    }
    const clave = `${ruc ?? "*"}|${q.toLocaleLowerCase("es")}`;
    const ya = memoria.get(clave);
    if (ya) {
      setEstado({ tipo: "ok", q, datos: ya });
      return;
    }
    if (enPausaHasta > Date.now()) {
      setEstado({ tipo: "pausa", q, hasta: enPausaHasta });
      return;
    }
    const control = new AbortController();
    setEstado({ tipo: "cargando", q });
    buscarEnControl(q, ruc, control.signal)
      .then((r) => {
        if (control.signal.aborted) return;
        if (r.tipo === "ok") {
          memoria.set(clave, r.datos);
          if (memoria.size > TOPE_MEMORIA) {
            const primera = memoria.keys().next();
            if (!primera.done) memoria.delete(primera.value);
          }
          setEstado({ tipo: "ok", q, datos: r.datos });
        } else if (r.tipo === "tope") {
          enPausaHasta = Date.now() + r.reintentarEn * 1000;
          setEstado({ tipo: "pausa", q, hasta: enPausaHasta });
        } else {
          setEstado({ tipo: "error", q, motivo: r.motivo });
        }
      })
      .catch(() => undefined); // cancelado: lo reemplazó otra búsqueda
    return () => control.abort();
  }, [q, ruc, intento]);

  // En pausa: la cuenta regresiva y, al terminar, la misma búsqueda otra vez (una sola).
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (estado.tipo !== "pausa") return;
    const tic = window.setInterval(() => setAhora(Date.now()), 1000);
    const fin = window.setTimeout(() => setIntento((n) => n + 1), Math.max(0, estado.hasta - Date.now()) + 300);
    return () => {
      window.clearInterval(tic);
      window.clearTimeout(fin);
    };
  }, [estado]);

  const conEntidad = !ruc;
  const columnas = columnasResultados(conEntidad);
  // Las filas, una vez por respuesta (la cuenta regresiva de la pausa vuelve a pintar cada segundo).
  const resultados = estado.tipo === "ok" ? estado.datos.resultados : null;
  const filas = useMemo(() => (resultados ?? []).map((x, i) => filaResultado(x, i, conEntidad)), [resultados, conEntidad]);
  const campo = (
    <Buscador
      placeholder="Ej.: obra paralizada, penalidad…"
      etiqueta={ruc ? "Buscar en lo que encontró la Contraloría en esta entidad" : "Buscar en lo que encontró la Contraloría en todo el país"}
      valor={q}
      min={MIN}
      espera={ESPERA}
      onBuscar={buscar}
      cargando={estado.tipo === "cargando"}
      className={variante === "caja" ? "sm:w-full sm:min-w-0 lg:max-w-none" : "sm:w-full lg:max-w-2xl"}
    />
  );

  let cuerpo: React.ReactNode = null;
  if (estado.tipo === "cargando") {
    cuerpo = <TablaSkeleton columnas={columnas} filas={4} />;
  } else if (estado.tipo === "pausa") {
    const s = Math.max(1, Math.ceil((estado.hasta - ahora) / 1000));
    cuerpo = (
      <VacioEnLinea variante="compacta" icono={<Hourglass size={16} />}>
        Son muchas búsquedas seguidas desde tu conexión. Esta se hará sola en {numero(s)} s.
      </VacioEnLinea>
    );
  } else if (estado.tipo === "error") {
    cuerpo = (
      <VacioEnLinea
        variante="compacta"
        tono="error"
        icono={<CloudOff size={16} />}
        accion={
          <button type="button" onClick={() => setIntento((n) => n + 1)} className="shrink-0 text-dato font-semibold text-granate underline-offset-4 hover:underline">
            Reintentar
          </button>
        }
      >
        {MENSAJE_ERROR[estado.motivo]}
      </VacioEnLinea>
    );
  } else if (estado.tipo === "ok") {
    const res = estado.datos.resultados;
    cuerpo =
      res.length === 0 ? (
        <VacioEnLinea variante="compacta" icono={<SearchX size={16} />}>
          No encontramos observaciones {ruc ? "de esta entidad " : ""}con esas palabras ni con ese sentido. Sólo se busca en los
          informes cuya Ficha Resumen ya leyó Vigía.
        </VacioEnLinea>
      ) : (
        <TablaPaginada
          columnas={columnas}
          filas={filas}
          etiqueta="Lo que encontró la Contraloría"
          nombre="observaciones"
          tam={TAM}
          controles="abajo"
          medida={variante === "caja" ? "contenedor" : "pantalla"}
        />
      );
  } else if (ejemplos) {
    cuerpo = <Inicio />;
  }

  // Qué se está mostrando y cómo volver: en una línea sobre los resultados.
  const resumen =
    estado.tipo === "ok" && estado.datos.resultados.length > 0 ? (
      <>
        <span className="font-semibold text-ink">{plural(estado.datos.resultados.length, "observación", "observaciones")}</span> para «
        {estado.q}»{ruc ? " en sus informes" : ""}
        {estado.datos.resultados.length >= N_BUSQUEDA_CONTROL
          ? `: las ${numero(N_BUSQUEDA_CONTROL)} que más se acercan. Afina las palabras para ver otras.`
          : "."}
        {estado.datos.modo === "texto" ? " Esta vez la búsqueda fue sólo por palabras: la de sentido no respondió." : ""}
      </>
    ) : estado.tipo === "cargando" ? (
      <>Buscando «{estado.q}»…</>
    ) : estado.tipo === "ok" ? (
      <>Sin resultados para «{estado.q}».</>
    ) : estado.tipo === "pausa" ? (
      <>«{estado.q}», en espera.</>
    ) : estado.tipo === "error" ? (
      <>«{estado.q}», sin respuesta.</>
    ) : null;
  const barraResultados = q ? (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <p className="min-w-0 text-meta leading-snug text-inkSoft" aria-live="polite">
        {resumen}
      </p>
      <button
        type="button"
        onClick={() => buscar("")}
        className="ml-auto inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full px-2 text-meta font-semibold text-granate underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
      >
        <X size={14} aria-hidden /> {ruc ? "Volver a todos sus informes" : "Quitar la búsqueda"}
      </button>
    </div>
  ) : null;

  const pistas = ejemplos && (estado.tipo === "quieto" || (estado.tipo === "ok" && estado.datos.resultados.length === 0)) && (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-rotulo font-semibold text-mute">Prueba con</span>
      {EJEMPLOS.map((e) => (
        <button
          key={e}
          type="button"
          onClick={() => buscar(e)}
          className="inline-flex min-h-8 items-center rounded-full border border-line bg-paper px-3 text-meta font-medium text-inkSoft transition-colors duration-rapido hover:border-granate/40 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
        >
          {e}
        </button>
      ))}
    </div>
  );

  if (variante === "caja") {
    return (
      <section aria-labelledby={idTitulo} className={cn("tarjeta space-y-3 rounded-2xl border border-line bg-paper p-4 sm:p-5", className)}>
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,26rem)] lg:items-center">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-granate sm:flex" aria-hidden>
              <ScanSearch size={17} />
            </span>
            <div className="min-w-0">
              <h3 id={idTitulo} className="font-display text-bloque font-bold leading-tight text-ink">
                Buscar en lo que encontró la Contraloría
              </h3>
              <p className="mt-0.5 text-meta leading-snug text-inkSoft">
                En las observaciones de sus informes, por palabras o por sentido. Cada resultado abre su informe.
              </p>
            </div>
          </div>
          {campo}
        </div>
        {pistas}
        {barraResultados}
        {cuerpo}
      </section>
    );
  }
  return (
    <section aria-label="Buscar en lo que encontró la Contraloría" className={cn("space-y-4", className)}>
      {campo}
      {pistas}
      {barraResultados}
      {cuerpo}
    </section>
  );
}

/** Antes de buscar (la página de todo el país): qué trae cada resultado. */
function Inicio() {
  return (
    // Dentro de la tarjeta del buscador (/app/contraloria): un recuadro hundido, sin caja por beneficio (caja dentro de caja).
    <div className="rounded-xl bg-paperSoft px-3.5 py-3">
      <h3 className="text-cuerpo font-semibold text-ink">Qué trae cada resultado</h3>
      <Beneficios
        className="mt-2 [&>li]:border-0 [&>li]:bg-transparent [&>li]:px-0 [&>li]:py-1"
        items={[
          { icono: <ListChecks size={16} aria-hidden />, titulo: "Lo que encontró", texto: "Cada observación del informe, con su tema y el perjuicio que señala." },
          { icono: <UsersRound size={16} aria-hidden />, titulo: "A quiénes comprende", texto: "Los funcionarios, con un apellido tapado y su responsabilidad presunta." },
          { icono: <FileStack size={16} aria-hidden />, titulo: "Sus documentos", texto: "La Ficha Resumen y el informe completo, en la web de la Contraloría." },
        ]}
      />
    </div>
  );
}

/**
 * Las columnas de los resultados. La entidad, sólo en todo el país (en la pestaña de una entidad, sería la misma en cada
 * fila); en el celular, la entidad, la responsabilidad y la fecha bajan bajo la observación.
 */
function columnasResultados(conEntidad: boolean): Columna[] {
  return [
    { clave: "obs", titulo: "Lo que encontró", ancho: "minmax(0,2.2fr)" },
    ...(conEntidad ? [{ clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)", desde: "md" as const, apilar: true }] : []),
    { clave: "tipo", titulo: "Responsabilidad presunta", ancho: "minmax(0,0.9fr)", desde: "lg", apilar: true, ayuda: <AyudaTermino clave="responsabilidad-presunta" /> },
    { clave: "fecha", titulo: "Emitido", ancho: "96px", desde: "md", apilar: true },
  ];
}

/** Un resultado: la observación (tres líneas; entera, en el panel), su tema y el número de su informe. */
function filaResultado(x: ResultadoControl, i: number, conEntidad: boolean): Fila {
  const ruc = rucEntidad(x.entidadRuc);
  const nombre = x.entidad ? tituloNatural(x.entidad) : null;
  const numeroInforme = x.numero ?? x.codigo;
  return {
    id: `${x.codigo}-${i}`,
    enlaces: conEntidad && !!ruc,
    etiqueta: `Ver el informe N.° ${numeroInforme}`,
    celdas: {
      obs: (
        <span className="block w-full min-w-0">
          {/* Recortada antes de pintarla (hay observaciones mal leídas de 60 mil caracteres) y sin `title`: entera, en el panel. */}
          <span className="line-clamp-3 text-dato leading-snug text-ink">
            <ConTapados texto={recortarTexto(textoObservacion(x.observacion), 420)} />
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-mute">
            <ChipTema tema={x.tema} texto={x.temaTexto} />
            <CodigoFila codigo={numeroInforme} nombre="Informe N.°" />
          </span>
        </span>
      ),
      entidad: (
        <Dato tipo="entidad" className="line-clamp-2 text-meta text-inkSoft">
          {nombre && ruc ? (
            <Link href={`/entidad/${ruc}?seccion=control`} prefetch={false} className="font-medium text-granate underline-offset-2 hover:underline">
              {nombre}
            </Link>
          ) : (
            nombre ?? "Sin dato"
          )}
        </Dato>
      ),
      tipo: <ChipsResponsabilidad tipos={x.responsabilidades} />,
      fecha: <CeldaFecha fecha={x.fecha} />,
    },
    detalle: detalleDeInforme(
      {
        codigo: x.codigo,
        numero: x.numero,
        titulo: x.titulo,
        fecha: x.fecha,
        entidad: x.entidad,
        entidadRuc: x.entidadRuc,
        responsabilidades: x.responsabilidades,
        urlPdf: x.urlInforme,
        urlResumen: x.urlFicha,
      },
      { conEntidad, coincide: { texto: x.observacion, objetivo: x.tema === "objetivo" } },
    ),
  };
}
