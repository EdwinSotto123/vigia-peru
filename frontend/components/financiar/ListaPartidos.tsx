import Link from "next/link";
import { Ayuda, EstadoError, EstadoVacio } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Tabla, type Columna, type Fila } from "@/components/listado";
import { PERIODOS_GOBIERNO, type AnioGobierno, type FilaPartido, type RankingPartidos } from "@/lib/partidosApi";
import { alcanceCorto, type AlcanceProcesamiento } from "@/lib/financiamiento";
import { numero, soles } from "@/lib/formato";

/**
 * La vista "Por partido" de /app/financiar: los partidos de un período con contratos en cola, con la
 * misma anatomía que "Por entidad":
 *   partido (nombre y cuántos gobiernos tuvo) · en cola · listos para leerse · leídos · costo · ›
 * Cada fila lleva a /app/financiar/partido/[clave]?anio=, donde se financia.
 *
 * Server-safe: todo llega como datos planos desde page.tsx.
 */

const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

export const hrefVistaPartido = (anio: AnioGobierno, q?: string) => {
  const p = new URLSearchParams({ por: "partido", anio: String(anio) });
  if (q) p.set("q", q);
  return `/app/financiar?${p.toString()}`;
};

/** Los tres períodos como pastillas: el partido se elige DENTRO de un período. */
export function SelectorPeriodo({ anio, q }: { anio: AnioGobierno; q?: string }) {
  return (
    <nav aria-label="Período de gobierno" className="flex flex-wrap items-center gap-2">
      <span className="text-[13px] text-mute">Gobiernos de</span>
      {PERIODOS_GOBIERNO.map((p) => (
        <Link
          key={p.anio}
          href={hrefVistaPartido(p.anio, q)}
          aria-current={p.anio === anio ? "page" : undefined}
          className={
            "inline-flex min-h-[36px] items-center rounded-full border px-3.5 text-[13.5px] font-semibold transition-colors " +
            (p.anio === anio ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink")
          }
        >
          {p.texto}
        </Link>
      ))}
    </nav>
  );
}

function columnas(precioPen: number | null, alcance: AlcanceProcesamiento | null | undefined): Columna[] {
  return [
    { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
    {
      clave: "cola",
      titulo: "En cola",
      ancho: "84px",
      alinear: "der",
      ayuda: (
        <Ayuda titulo="¿Qué es “en cola”?">
          Contratos de las entidades que el partido gobernó en el período, convocados en esos años, que esperan financiamiento
          para leerse. Hoy entran solo {alcanceCorto(alcance)}.
        </Ayuda>
      ),
    },
    {
      clave: "listos",
      titulo: "Listos",
      ancho: "84px",
      alinear: "der",
      desde: "md",
      ayuda: (
        <Ayuda titulo="¿Qué es “listos”?">De los que están en cola, los que ya tienen sus documentos: se leen apenas se financian.</Ayuda>
      ),
    },
    {
      clave: "leidos",
      titulo: "Leídos",
      ancho: "112px",
      alinear: "der",
      desde: "lg",
      ayuda: <Ayuda titulo="¿Qué cuenta “leídos”?">Contratos del partido en ese período que Vigía ya leyó, sobre todos los que tiene.</Ayuda>,
    },
    {
      clave: "costo",
      titulo: "Costo",
      ancho: "104px",
      alinear: "der",
      desde: "xl",
      ayuda: (
        <Ayuda titulo="¿Qué es el costo?">
          Lo que cuesta leer todos sus contratos en cola{precioPen != null ? `, a ${soles(precioPen)} cada uno` : ""}.
        </Ayuda>
      ),
    },
  ];
}

function gobiernosTexto(f: FilaPartido): string {
  const g = f.gobiernos;
  const partes = [
    g.regional > 0 ? `${numero(g.regional)} ${g.regional === 1 ? "región" : "regiones"}` : null,
    g.provincial > 0 ? `${numero(g.provincial)} ${g.provincial === 1 ? "provincia" : "provincias"}` : null,
    g.distrital > 0 ? `${numero(g.distrital)} ${g.distrital === 1 ? "distrito" : "distritos"}` : null,
  ].filter(Boolean);
  return partes.length ? `Gobernó ${partes.join(", ")}` : "";
}

function fila(f: FilaPartido, anio: AnioGobierno, precioPen: number | null): Fila {
  return {
    id: f.clave,
    href: `/app/financiar/partido/${f.clave}?anio=${anio}`,
    celdas: {
      partido: <CeldaPrincipal titulo={f.nombre} textoCompleto={f.nombre} meta={[gobiernosTexto(f) || null]} />,
      cola: <CeldaNumero>{numero(f.enCola)}</CeldaNumero>,
      listos: <CeldaNumero>{numero(f.documentosListos)}</CeldaNumero>,
      leidos: <CeldaNumero sub={`de ${numero(f.contratos)}`}>{numero(f.leidos)}</CeldaNumero>,
      costo: <CeldaNumero>{soles(precioPen != null ? f.enCola * precioPen : null)}</CeldaNumero>,
    },
  };
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Lo que va en la zona de resultados: error, vacío o la tabla. Sin búsqueda, sólo los que tienen cola. */
export function ResultadosPartidos({
  datos,
  anio,
  q,
  precioPen,
  alcance,
}: {
  /** El ranking del API; `null` = no respondió. */
  datos: RankingPartidos | null;
  anio: AnioGobierno;
  q: string;
  precioPen: number | null;
  alcance: AlcanceProcesamiento | null | undefined;
}) {
  if (!datos) {
    return (
      <EstadoError titulo="No pudimos leer los partidos" accion={<Link href={hrefVistaPartido(anio, q)} className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  const t = norm(q);
  const items = datos.data
    .filter((f) => (q ? norm(f.nombre).includes(t) : f.enCola > 0))
    .sort((a, b) => b.enCola - a.enCola || b.contratos - a.contratos);
  if (items.length === 0) {
    return q ? (
      <EstadoVacio compacto titulo={`Ningún partido coincide con “${q}”`} accion={<Link href={hrefVistaPartido(anio)} className={ACCION}>Quitar la búsqueda</Link>}>
        Prueba con otra parte del nombre.
      </EstadoVacio>
    ) : (
      <EstadoVacio titulo="Ningún partido tiene contratos en cola en este período">
        Aparecen aquí cuando entran contratos de sus gobiernos a la cola.
      </EstadoVacio>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-[13px] text-mute" aria-live="polite">
        {q ? `${numero(items.length)} ${items.length === 1 ? "partido coincide" : "partidos coinciden"}.` : `${numero(items.length)} ${items.length === 1 ? "partido con contratos en cola" : "partidos con contratos en cola"}.`}
      </p>
      <Tabla columnas={columnas(precioPen, alcance)} filas={items.map((f) => fila(f, anio, precioPen))} etiqueta="Partidos con contratos en cola" medida="contenedor" />
    </div>
  );
}
