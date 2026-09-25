import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Clock, Code2, ShieldCheck } from "lucide-react";
import { ZonaPicker } from "@/components/financiar/ZonaPicker";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { EnlaceAccion, claseAccion } from "@/components/ui/EnlaceAccion";
import { Popover } from "@/components/ui/Flotante";
import { Ayuda, EncabezadoPagina, FuenteDato, Pagina, Seccion } from "@/components/patrones";
import { FranjaTextil } from "@/components/marca";
import { numero, porcentaje, soles } from "@/lib/formato";
import {
  alcanceCorto,
  getEstadoGlobal,
  getPago,
  getRecientes,
  getZonas,
  partesTarifa,
  type EstadoGlobal,
  type ParteTarifa,
} from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";

const REPO = "https://github.com/EdwinSotto123/vigia-peru";

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
 * detalle a un clic (DESIGN_SYSTEM.md §10.7). Antes eran seis tarjetas con dos o tres
 * renglones cada una al pie de la página.
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

/**
 * /app/financiar — plantilla de conversión (DESIGN_SYSTEM.md §14): una pregunta por
 * pantalla, "¿qué zona quieres que se lea?". Dato primero (§10.7): el título, una
 * línea de cifras con su denominador (el déficit de lectura, el precio) y enseguida
 * el selector de zona; el porqué y el desglose, a un clic. Al pie, en granate
 * profundo, las reglas que hacen que financiar no compre nada.
 */
export default async function FinanciarPage({ searchParams }: { searchParams?: { ubigeo?: string } }) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);
  const [zonas, estado, recientes, resumenContratos, pago] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getRecientes(),
    getResumenContratos(),
    getPago(),
  ]);
  const precio = estado?.tarifa.precioPen ?? null;
  const partes = partesTarifa(estado?.tarifa.nota);
  const conCola = (zonas ?? []).filter((z) => z.totalCola > 0).length;
  const pagosAbiertos = !!pago?.configurado;

  // "Leídos" es la misma cifra de la portada y de /app/contratos (DESIGN_SYSTEM.md §10.1):
  // todo contrato cuyo análisis terminó, por cualquier vía. Los financiados leídos son un
  // subconjunto y se nombran como tal; antes esta página llamaba "leídos" sólo a esos.
  const r = resumenContratos?.porRiesgo;
  const leidos = r ? (r.alto ?? 0) + (r.medio ?? 0) + (r.bajo ?? 0) + (r.en_revision ?? 0) + (r.descartado ?? 0) : null;

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
        {/* El bloque ES la comparación: leídos contra publicados. Ninguna cifra viaja sola. */}
        <BalanceLectura
          estado={estado}
          publicados={resumenContratos?.total ?? null}
          leidos={leidos}
          conCola={conCola}
          precio={precio}
          partes={partes}
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
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
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
            <Ayuda titulo="¿Cómo se lee esta lista?">
              <span className="block">
                <strong className="text-ink">En cola</strong>: contratos de la zona que esperan financiamiento para
                leerse. Hoy entran solo {alcanceCorto(estado?.alcance)}. La zona es la sede de la entidad que contrata.
              </span>
              {precio != null && (
                <span className="mt-2 block">
                  <strong className="text-ink">Costo</strong>: {soles(precio)} por contrato.
                </span>
              )}
            </Ayuda>
          }
          acciones={<FuenteDato fuente="OECE, API OCDS" />}
        >
          <ZonaPicker zonas={zonas ?? []} precioPen={precio ?? 0} />
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
            <p className="rounded-2xl border border-dashed border-line px-5 py-4 text-sm text-mute">
              No se pudo leer la lista de aportes ahora mismo. Vuelve a intentarlo en un momento.
            </p>
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

/**
 * El déficit de lectura, que es la razón de existir del producto, en UNA línea de datos
 * (§10.7) y una barra.
 *
 * La barra no es decoración: a escala real lo leído es una astilla contra el total
 * publicado, y ver esa astilla explica en un segundo por qué hace falta financiar. Por
 * eso tiene ancho mínimo: a escala exacta (0,24 %) sería medio píxel.
 *
 * Ninguna cifra viaja sola, y lo financiado se cuenta en contratos, igual que en el muro
 * de aliados. Lo que no se pudo leer dice "Sin dato"; nunca un cero que parezca un dato.
 * El precio es un dato más de la línea; su desglose, a un clic.
 */
function BalanceLectura({
  estado,
  publicados,
  leidos,
  conCola,
  precio,
  partes,
}: {
  estado: EstadoGlobal | null;
  /** Contratos publicados en la base (resumen de /contratos). */
  publicados: number | null;
  /** Leídos por cualquier vía (misma cifra que la portada). */
  leidos: number | null;
  /** Respaldo de "regiones con cola" si el estado no lo trae. */
  conCola: number;
  precio: number | null;
  /** Desglose real de la tarifa (`estado.tarifa.nota`). */
  partes: ParteTarifa[];
}) {
  const base = publicados != null && publicados > 0 && leidos != null ? { publicados, leidos } : null;
  const pct = base ? (base.leidos / base.publicados) * 100 : 0;
  const anchoLeido = base ? Math.max(0.8, pct) : 0;
  const cifra = "font-semibold text-ink";

  return (
    <section aria-label="Cuánto se ha leído de lo publicado" className="space-y-2">
      {/* Una cifra por elemento (como `Cifras`): se escanean de a una, no se leen como un párrafo. */}
      <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] tabular-nums text-inkSoft">
        <li>
          {leidos != null ? <strong className={cifra}>{numero(leidos)}</strong> : <span className="text-mute">Sin dato</span>} de{" "}
          {numero(publicados)} publicados leídos
          {base && <span className="text-mute"> ({porcentaje(pct, { decimales: pct < 1 ? 2 : 1 })})</span>}
        </li>
        {estado && (
          <>
            <li>
              <strong className={cifra}>{numero(estado.contratosFinanciados)}</strong> financiados
              {estado.regionesConAuditoria > 0 && (
                <> en {estado.regionesConAuditoria === 1 ? "1 región" : `${numero(estado.regionesConAuditoria)} regiones`}</>
              )}
              {estado.financiadores > 0 && <>, de {estado.financiadores === 1 ? "1 aliado" : `${numero(estado.financiadores)} aliados`}</>}
            </li>
            <li>
              <strong className={cifra}>{numero(estado.contratosProcesados)}</strong> de {numero(estado.contratosFinanciados)} financiados leídos
            </li>
            <li>
              <strong className={cifra}>{numero(estado.senalesHalladas)}</strong> de {numero(estado.contratosProcesados)} con señales
            </li>
            <li>
              <strong className={cifra}>{numero(estado.colaGlobal)}</strong> en cola, en {numero(estado.regionesConCola ?? conCola)} regiones
            </li>
          </>
        )}
        {precio != null && (
          <li className="inline-flex items-center gap-1">
            <span>
              <strong className={cifra}>{soles(precio)}</strong> por contrato
            </span>
            {partes.length > 0 && (
              <Ayuda titulo="¿En qué se va cada contrato?">
                {partes.map((p) => (
                  <span key={p.concepto} className="flex items-baseline gap-2">
                    <span className="w-10 shrink-0 font-mono tabular-nums text-ink">{soles(p.monto)}</span>
                    <span>{p.concepto}</span>
                  </span>
                ))}
              </Ayuda>
            )}
          </li>
        )}
      </ul>

      {base && (
        <div
          className="flex h-1.5 w-full overflow-hidden rounded-full bg-paperDeep"
          role="img"
          aria-label={`${numero(base.leidos)} contratos leídos de ${numero(base.publicados)} publicados`}
        >
          <div className="h-full rounded-full bg-moss" style={{ width: `${anchoLeido}%` }} />
        </div>
      )}

      {!estado && (
        <p className="text-[13px] text-mute">No se pudo leer el estado del financiamiento. Vuelve a intentarlo en un momento.</p>
      )}
    </section>
  );
}
