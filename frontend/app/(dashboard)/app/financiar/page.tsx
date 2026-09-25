import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Clock, Code2, ShieldCheck } from "lucide-react";
import { ListaZonas, type ZonaListada } from "@/components/financiar/ListaZonas";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { Popover } from "@/components/ui/Flotante";
import { Paginacion } from "@/components/ui/Paginacion";
import { Ayuda, EncabezadoPagina, EstadoError, EstadoVacio, FuenteDato, Pagina, Seccion } from "@/components/patrones";
import { BarraFiltros, Indicadores, Listado, ZonaResultados, type Indicador } from "@/components/listado";
import { FranjaTextil } from "@/components/marca";
import { numero, plural, porcentaje, soles } from "@/lib/formato";
import {
  alcanceCorto,
  getEstadoGlobal,
  getPago,
  getRecientes,
  getZonas,
  partesTarifa,
  type EstadoGlobal,
  type Zona,
} from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";

const REPO = "https://github.com/EdwinSotto123/vigia-peru";

/** Zonas por página: las 25 regiones caben en una; una búsqueda amplia ("san") pagina. */
const TAM = 25;

export async function generateMetadata() {
  const estado = await getEstadoGlobal();
  const precio = estado?.tarifa.precioPen;
  return {
    title: "Financia una auditoría",
    description: `Cada región del Perú tiene contratos públicos que nadie ha leído. Financia la capacidad de auditarlos${precio != null ? `: ${soles(precio)} por contrato` : ""}, con resultados públicos y reconocimiento contado en contratos.`,
  };
}

export const revalidate = 120;

/**
 * Las reglas que hacen que financiar no compre nada: una frase visible por regla y el
 * detalle a un clic (DESIGN_SYSTEM.md §10.7).
 */
const REGLAS: { titulo: string; resumen: string; detalle: string }[] = [
  {
    titulo: "Sin selección",
    resumen: "Los contratos salen de la cola por antigüedad.",
    detalle: "La asignación es por antigüedad dentro de la zona, en SQL. Ninguna API acepta un contrato elegido por quien financia.",
  },
  {
    titulo: "Sin edición",
    resumen: "Quien lee no sabe quién financió.",
    detalle: "Quien lee los contratos no recibe el nombre de quien financió: ese dato no entra en sus instrucciones.",
  },
  {
    titulo: "Conflicto automático",
    resumen: "Con sanción vigente, sin reconocimiento.",
    detalle:
      "Empresa con sanción vigente del OECE o con alertas activas: su aporte hace leer contratos igual, pero no recibe reconocimiento público.",
  },
  {
    titulo: "Publicación incondicional",
    resumen: "Se publica aunque te señale.",
    detalle: "Si la lectura que financiaste termina señalándote, se publica igual. Tu comprobante lo mostrará.",
  },
  {
    titulo: "Reconocimiento aditivo",
    resumen: "Nadie es dueño de una zona.",
    detalle: "Varios aliados pueden apoyar la misma zona. Nadie la “tiene”.",
  },
  {
    titulo: "Trazabilidad",
    resumen: "Cada comprobante lista sus contratos.",
    detalle: "Cada comprobante lista sus contratos y enlaza a la lectura de cada uno, paso por paso.",
  },
];

/** Comparación sin tildes ni mayúsculas: "cañete" encuentra "Cañete", "apurimac" encuentra "Apurímac". */
const norm = (s: string) => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const porCola = (a: Pick<Zona, "pendientes" | "nombre">, b: Pick<Zona, "pendientes" | "nombre">) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es");

/** La acción de un estado vacío o de error: la misma píldora secundaria de todos los listados. */
const ACCION =
  "inline-flex min-h-[40px] items-center rounded-full border border-line bg-paper px-4 py-1.5 text-[14px] font-semibold text-granate transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50";

/**
 * /app/financiar — plantilla de conversión (DESIGN_SYSTEM.md §14): una pregunta por
 * pantalla, "¿qué contratos de tu zona quieres que se lean?". Encabezado → Indicadores
 * (el déficit de lectura y el precio, cada cifra con su contexto) → la lista de zonas
 * con la anatomía de todo listado (§14.1) y, al costado, los últimos aportes. La
 * búsqueda vive en la URL (`?q=`): se comparte y el botón atrás la deshace.
 */
export default async function FinanciarPage({
  searchParams,
}: {
  searchParams?: { ubigeo?: string; q?: string; pagina?: string };
}) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);

  const q = (searchParams?.q ?? "").trim().slice(0, 60);
  // Con dos letras o más la búsqueda también mira las provincias (una sola lista, cacheada).
  const buscaProvincias = q.length >= 2;
  const [zonas, estado, recientes, resumenContratos, pago, provincias] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getRecientes(),
    getResumenContratos(),
    getPago(),
    buscaProvincias ? getZonas("provincia") : Promise.resolve(null),
  ]);
  const precio = estado?.tarifa.precioPen ?? null;
  const pagosAbiertos = !!pago?.configurado;

  // "Leídos" es la misma cifra de la portada y de /app/contratos (DESIGN_SYSTEM.md §10.1):
  // todo contrato cuyo análisis terminó, por cualquier vía.
  const r = resumenContratos?.porRiesgo;
  const leidos = r ? (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0) : null;
  const publicados = resumenContratos?.total ?? null;

  // ─── La lista: regiones con cola, o lo que coincide con la búsqueda ───
  const deptos = (zonas ?? []).filter((z) => z.totalCola > 0);
  const nombreRegion = new Map((zonas ?? []).map((z) => [z.ubigeo, z.nombre]));
  let lista: ZonaListada[];
  if (q) {
    const t = norm(q);
    const pool: ZonaListada[] = [
      ...deptos.map((z) => ({ ...z, lugar: "Región" })),
      ...(provincias ?? [])
        .filter((p) => p.totalCola > 0)
        .map((p) => ({ ...p, lugar: `Provincia en ${nombreRegion.get(p.padreUbigeo ?? "") ?? "el Perú"}` })),
    ];
    lista = pool.filter((z) => norm(z.nombre).includes(t)).sort(porCola);
  } else {
    lista = [...deptos].sort(porCola);
  }
  const paginas = Math.max(1, Math.ceil(lista.length / TAM));
  const pagina = Math.min(paginas, Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1));
  const fallaronProvincias = buscaProvincias && provincias === null;

  return (
    <Pagina className="space-y-8">
      <div className="space-y-4">
        {/* La pregunta de la pantalla va de título (plantilla de conversión, §14); el porqué, en el ⓘ. */}
        <EncabezadoPagina
          titulo="¿Qué contratos de tu zona quieres que se lean?"
          bajada="Elige una zona y financia la lectura de sus contratos en cola. Los resultados son públicos, siempre."
          ayuda={
            <Ayuda titulo="¿Qué financias?">
              <span className="block">
                El Estado publica todos sus contratos, pero nadie tiene capacidad de leerlos. Vigía lee cada uno completo,
                lo cruza con registros públicos y publica sus señales con la norma que las respalda.
              </span>
              <span className="mt-2 block text-mute">Financias esa lectura: no compras una región ni un resultado.</span>
            </Ayuda>
          }
          acciones={
            <EnlaceAccion variante="fantasma" href="#independencia">
              <ShieldCheck size={16} className="text-granate" aria-hidden /> Reglas de independencia
            </EnlaceAccion>
          }
        />
        <CifrasFinanciar
          leidos={leidos}
          publicados={publicados}
          estado={estado}
          regionesConCola={estado?.regionesConCola ?? deptos.length}
          precio={precio}
          nota={estado?.tarifa.nota ?? null}
        />
        {!pagosAbiertos && (
          <p className="inline-flex flex-wrap items-center gap-1.5 text-[13px] text-inkSoft" role="note">
            <Clock size={14} className="shrink-0 text-granate" aria-hidden />
            <strong className="font-semibold text-ink">Los aportes todavía no están abiertos.</strong>
            <Ayuda titulo="¿Por qué no se puede aportar?">
              Aún no hay un medio de pago conectado. Hoy la lectura la paga Vigía Perú con su propio capital semilla.
              Puedes elegir una zona para ver su cola, seguirla y mirar cómo avanza.
            </Ayuda>
          </p>
        )}
      </div>

      {/* La lista de zonas y los últimos aportes, lado a lado: la vista usa el ancho (§10.7). */}
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        {/* ─── ELIGE TU ZONA (sin mapa: el mapa vive en /app/mapa) ─── */}
        <Seccion
          id="zonas"
          titulo="Elige la zona"
          descripcion={
            <>
              Contratos en cola y lo que cuesta leerlos.{" "}
              <Link href="/app/mapa" className="font-medium text-granate underline underline-offset-2">Verlo en el mapa</Link>
            </>
          }
          ayuda={
            <Ayuda titulo="¿Qué zonas aparecen?">
              Las que tienen contratos en cola. Hoy entran solo {alcanceCorto(estado?.alcance)}. El punto de color es el
              estado de la zona, dicho también en palabras debajo de su nombre.
            </Ayuda>
          }
          acciones={<FuenteDato fuente="OECE, API OCDS" />}
        >
          <Listado ruta="/app/financiar" parametros={{ q: q || undefined }}>
            <div className="space-y-3">
              <BarraFiltros
                busqueda={{ param: "q", placeholder: "Ej. Huamanga, Cañete, Cusco", etiqueta: "Buscar una región o provincia" }}
              />
              <ZonaResultados>
                <ResultadosZonas
                  hayZonas={!!zonas}
                  lista={lista}
                  q={q}
                  pagina={pagina}
                  paginas={paginas}
                  fallaronProvincias={fallaronProvincias}
                  precio={precio}
                />
              </ZonaResultados>
            </div>
          </Listado>
        </Seccion>

        {/* ─── ÚLTIMOS APORTES (el orden por aliado vive en /app/aliados) ─── */}
        <Seccion
          titulo="Últimos aportes"
          descripcion="Contados en contratos, no en soles, con su comprobante público."
          acciones={
            <Link href="/app/aliados" className="inline-flex min-h-[24px] items-center gap-1.5 text-sm font-semibold text-granate underline-offset-2 hover:underline">
              Muro de aliados <ArrowRight size={14} aria-hidden />
            </Link>
          }
        >
          {recientes ? (
            <RecientesFeed items={recientes} />
          ) : (
            <EstadoError titulo="No pudimos leer los últimos aportes">Vuelve a intentarlo en un momento.</EstadoError>
          )}
        </Seccion>
      </div>

      {/* ─── INDEPENDENCIA: el cierre de marca, en granate profundo ─── */}
      <section
        id="independencia"
        aria-labelledby="independencia-titulo"
        className="sobre-oscuro scroll-mt-20 overflow-hidden rounded-2xl bg-granate-deep text-paper"
      >
        <FranjaTextil alto={8} />
        <div className="space-y-5 px-5 py-6 sm:px-7">
          <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-0">
              <h2 id="independencia-titulo" className="inline-flex items-center gap-2 font-display text-xl font-bold leading-tight text-balance">
                <ShieldCheck size={20} className="shrink-0 text-maiz" aria-hidden />
                Financias capacidad, no resultados
              </h2>
              <p className="mt-1 text-sm text-paper/80">
                Pagas la lectura de contratos que ya son públicos. Las reglas están en el código, no en una promesa.
              </p>
            </div>
            <a href={REPO} target="_blank" rel="noopener noreferrer" className={claseAccion("oscuro", "shrink-0")}>
              <Code2 size={15} aria-hidden /> Ver el código en GitHub
            </a>
          </div>
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            {REGLAS.map((regla) => (
              <li key={regla.titulo} className="min-w-0 border-t border-paper/15 pt-3 text-[13px] leading-snug">
                <span className="block font-semibold text-paper">{regla.titulo}</span>
                <span className="text-paper/75">{regla.resumen}</span>{" "}
                <Popover
                  titulo={regla.titulo}
                  anchoClase="w-80"
                  className="min-h-[24px] align-baseline text-[12px] font-medium text-maiz underline underline-offset-2 hover:text-paper"
                  trigger={<>cómo</>}
                >
                  {regla.detalle}
                </Popover>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </Pagina>
  );
}

/** Lo que va en la zona de resultados: los cinco estados de §10.5, y la tabla. */
function ResultadosZonas({
  hayZonas,
  lista,
  q,
  pagina,
  paginas,
  fallaronProvincias,
  precio,
}: {
  /** El API de zonas respondió. */
  hayZonas: boolean;
  lista: ZonaListada[];
  q: string;
  pagina: number;
  paginas: number;
  /** Se buscó en las provincias y esa lista no respondió. */
  fallaronProvincias: boolean;
  precio: number | null;
}) {
  if (!hayZonas) {
    return (
      <EstadoError titulo="No pudimos leer las zonas" accion={<Link href="/app/financiar" className={ACCION}>Reintentar</Link>}>
        El servidor no respondió. No mostramos nada en su lugar.
      </EstadoError>
    );
  }
  if (lista.length === 0 && !q) {
    return (
      <EstadoVacio titulo="Ninguna zona tiene contratos en cola">
        Aparecen aquí cuando el OECE publica contratos que entran a la cola.
      </EstadoVacio>
    );
  }
  if (lista.length === 0 && fallaronProvincias) {
    return (
      <EstadoError titulo="No pudimos buscar en las provincias" accion={<Link href="/app/financiar" className={ACCION}>Ver todas las regiones</Link>}>
        Prueba con el nombre de la región.
      </EstadoError>
    );
  }
  if (lista.length === 0) {
    return (
      <EstadoVacio
        compacto
        titulo={`Ninguna zona con contratos en cola coincide con “${q}”`}
        accion={<Link href="/app/financiar" className={ACCION}>Quitar la búsqueda</Link>}
      >
        Prueba con el nombre de la región o de la provincia.
      </EstadoVacio>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Parcial (§10.5): se dice qué falta. */}
        {fallaronProvincias ? (
          <p className="text-[12.5px] text-mute" role="note">No pudimos buscar en las provincias: sólo se muestran regiones.</p>
        ) : (
          <span />
        )}
        <PaginacionZonas pagina={pagina} paginas={paginas} total={lista.length} q={q} />
      </div>
      <ListaZonas
        zonas={lista.slice((pagina - 1) * TAM, pagina * TAM)}
        precioPen={precio}
        etiqueta={q ? `Zonas que coinciden con “${q}”` : "Regiones con contratos en cola"}
      />
      {paginas > 1 && (
        <div className="flex justify-end">
          <PaginacionZonas pagina={pagina} paginas={paginas} total={lista.length} q={q} />
        </div>
      )}
    </div>
  );
}

function PaginacionZonas({ pagina, paginas, total, q }: { pagina: number; paginas: number; total: number; q: string }) {
  return (
    <Paginacion
      actual={pagina}
      paginas={paginas}
      total={total}
      tam={TAM}
      navegacion="url"
      hrefBase="/app/financiar"
      query={{ q: q || undefined }}
      cargando={false}
      nombre="zonas"
    />
  );
}

/**
 * El déficit de lectura, que es la razón de existir del producto, y el precio, como
 * `Indicadores` (§10.7): cada número grande con lo que es y su contexto. Antes iban
 * seis cifras dentro de una línea gris ("118 de 18,393 publicados leídos (0.64 %) ·
 * 100 financiados en 6 regiones…"): se perdía cuál número decía qué.
 *
 * Lo que no se pudo leer dice "Sin dato"; nunca un cero que parezca un dato.
 */
function CifrasFinanciar({
  leidos,
  publicados,
  estado,
  regionesConCola,
  precio,
  nota,
}: {
  leidos: number | null;
  publicados: number | null;
  estado: EstadoGlobal | null;
  /** Regiones con cola, con respaldo en la lista de zonas si el estado no lo trae. */
  regionesConCola: number;
  precio: number | null;
  /** Desglose de la tarifa (`estado.tarifa.nota`). */
  nota: string | null;
}) {
  const pct = publicados && leidos != null ? (leidos / publicados) * 100 : null;
  const partes = partesTarifa(nota);
  const items: Indicador[] = [
    {
      valor: leidos != null ? numero(leidos) : null,
      etiqueta: "contratos leídos",
      contexto:
        publicados != null
          ? `de ${numero(publicados)} publicados${pct != null ? ` (${porcentaje(pct, { decimales: pct < 1 ? 2 : 1 })})` : ""}`
          : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta como leído?">
          Todo contrato cuyo análisis terminó, por cualquier vía, financiado o no. Es la misma cifra de la portada y de
          Contratos.
        </Ayuda>
      ),
    },
  ];
  if (estado) {
    items.push(
      {
        valor: numero(estado.colaGlobal),
        etiqueta: "en cola",
        contexto: `en ${plural(regionesConCola, "región", "regiones")}`,
        ayuda: (
          <Ayuda titulo="¿Qué entra a la cola?">
            Contratos que esperan financiamiento para leerse. Hoy entran solo {alcanceCorto(estado.alcance)}.
          </Ayuda>
        ),
      },
      {
        valor: numero(estado.contratosFinanciados),
        etiqueta: "contratos financiados",
        contexto: `${numero(estado.contratosProcesados)} ya leídos, ${numero(estado.senalesHalladas)} con señales`,
        href: "/app/auditoria",
      },
    );
  }
  if (precio != null) {
    items.push({
      valor: soles(precio),
      etiqueta: "por contrato",
      contexto: "lectura completa y publicada",
      ayuda:
        partes.length > 0 ? (
          <Ayuda titulo="¿En qué se va cada contrato?">
            {partes.map((p) => (
              <span key={p.concepto} className="flex items-baseline gap-2">
                <span className="w-10 shrink-0 font-mono tabular-nums text-ink">{soles(p.monto)}</span>
                <span>{p.concepto}</span>
              </span>
            ))}
          </Ayuda>
        ) : undefined,
    });
  }
  if (!estado) {
    return <p className="text-[13px] text-mute" role="note">No se pudo leer el estado del financiamiento. Vuelve a intentarlo en un momento.</p>;
  }
  return <Indicadores items={items} />;
}
