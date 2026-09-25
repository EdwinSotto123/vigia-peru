import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ChevronRight, Radio, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { Avatar } from "@/components/financiar/RankingTable";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda, EncabezadoPagina, Pagina } from "@/components/patrones";
import { TarjetaConfirmacion } from "@/components/financiar/TarjetaConfirmacion";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { ESTADO_LABEL, ESTADO_PUNTO, alcanceLargo, getPago, getZona } from "@/lib/financiamiento";
import { numero, plural, porcentaje, soles } from "@/lib/formato";
import { estadoVisible, getProcesamientos, type EstadoProc, type Procesamiento } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ubigeo: string } }) {
  const d = await getZona(params.ubigeo);
  return { title: d ? `Financiar auditoría en ${d.zona.nombre}` : "Zona no encontrada" };
}

const NIVEL: Record<string, string> = { departamento: "Región", provincia: "Provincia", distrito: "Distrito" };

/** Porcentaje legible: con un decimal bajo 10 %, entero arriba ("0.3 %", "42 %"). */
const pctTxt = (v: number) => porcentaje(v, { decimales: v > 0 && v < 10 ? 1 : 0 });

/** Filas del "en vivo" visibles en la página; el tablero completo se abre en el panel. */
const FILAS_VIVO = 6;

/** Orden de la vista previa: lo que se mueve primero, luego lo que espera, al final lo ya leído. */
const PRIORIDAD: Record<EstadoProc, number> = {
  procesando: 0,
  encolado: 1,
  esperando_documentos: 2,
  error: 3,
  pendiente_de_procesamiento: 4,
  procesado: 5,
  revision: 5,
};

/** Clase de una cifra dentro de una línea de datos (§10.7). */
const CIFRA = "font-semibold text-ink";

/**
 * Ficha de una zona para financiar su lectura. Una sola pregunta: ¿cuántos contratos de
 * esta zona quieres que se lean? La respuesta (el formulario, o por qué hoy no se puede)
 * va primero en el celular y pegada a la derecha en escritorio; a la izquierda, lo que
 * hace falta para decidir, en líneas de datos (§10.7): cuánto hay en cola, cuánto ya se
 * financió y leyó, qué se está leyendo y quién financió. Las explicaciones, a un clic.
 */
export default async function ZonaPage({ params }: { params: { ubigeo: string } }) {
  const [d, pago] = await Promise.all([getZona(params.ubigeo), getPago()]);
  if (!d) notFound();
  const { zona, breadcrumb, hijas, aliados, cola } = d;
  const enVivo = zona.financiados > 0 ? await getProcesamientos({ ubigeo: zona.ubigeo, limit: 60 }) : null;
  const metodos = pago ? [pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[] : [];
  // Una sola base para "en cola" en toda la página: lo que nadie financió todavía (`pendientes`).
  // `totalCola` = pendientes + financiados; usarlo como "en cola" hacía que la misma zona dijera
  // 604 arriba y 594 en el formulario.
  const enCola = zona.pendientes;
  const pFin = zona.totalCola > 0 ? Math.min(100, (zona.financiados / zona.totalCola) * 100) : 0;
  const pProc = zona.totalCola > 0 ? Math.min(100, (zona.procesados / zona.totalCola) * 100) : 0;
  const padre = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;
  const enRevision = zona.enRevision ?? 0;

  return (
    <Pagina className="space-y-5">
      <nav aria-label="Ubicación" className="flex flex-wrap items-center gap-1 text-sm text-inkSoft">
        <Link href="/app/financiar" className="inline-flex min-h-[24px] items-center underline-offset-2 hover:text-ink hover:underline">Perú</Link>
        {breadcrumb.map((b) => (
          <span key={b.ubigeo} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-mute" aria-hidden />
            {b.ubigeo === zona.ubigeo ? (
              <span className="text-ink" aria-current="page">{b.nombre}</span>
            ) : (
              <Link href={`/app/financiar/${b.ubigeo}`} className="inline-flex min-h-[24px] items-center underline-offset-2 hover:text-ink hover:underline">{b.nombre}</Link>
            )}
          </span>
        ))}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-7">
          {/* Identidad de la zona: nombre, qué es y en qué estado está. Sin kicker encima del título. */}
          <EncabezadoPagina
            titulo={zona.nombre}
            bajada={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span>{NIVEL[zona.nivel] ?? zona.nivel}</span>
                <span className="pill border-line bg-paper text-inkSoft">
                  <span className={cn("h-2 w-2 rounded-full", ESTADO_PUNTO[zona.estado])} aria-hidden />
                  {ESTADO_LABEL[zona.estado]}
                </span>
              </span>
            }
          />

          {/* Progreso en UNA línea de datos, cada cifra con su denominador (§10.2), y la barra. */}
          <section aria-labelledby="progreso-titulo" className="space-y-2">
            <h2 id="progreso-titulo" className="sr-only">Cuánto se financió y se leyó en {zona.nombre}</h2>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] tabular-nums text-inkSoft">
              <li className="inline-flex items-center gap-1">
                <span>
                  <strong className={CIFRA}>{numero(enCola)}</strong> en cola
                </span>
                <Ayuda titulo="¿Qué entra a la cola?">
                  <span className="block">{alcanceLargo(d.alcance)}</span>
                  <span className="mt-2 block text-mute">La zona es la sede de la entidad que contrata.</span>
                </Ayuda>
              </li>
              <li>
                <strong className={CIFRA}>{soles(enCola * zona.precioPen)}</strong> leerlos, a {soles(zona.precioPen)} cada uno
              </li>
              <li>
                <strong className={CIFRA}>{numero(zona.financiados)}</strong> de {numero(zona.totalCola)} financiados
              </li>
              {zona.financiados > 0 ? (
                <li>
                  <strong className={CIFRA}>{numero(zona.procesados)}</strong> de {numero(zona.financiados)} leídos,{" "}
                  {numero(zona.senales)} con señales
                  {enRevision > 0 && <>, {numero(enRevision)} en revisión</>}
                </li>
              ) : (
                <li className="text-mute">Ningún contrato financiado todavía</li>
              )}
            </ul>
            <div
              className="relative h-2 overflow-hidden rounded-full bg-paperDeep"
              role="img"
              aria-label={`${pctTxt(pFin)} financiado y ${pctTxt(pProc)} leído de ${numero(zona.totalCola)} contratos`}
            >
              <div className="absolute inset-y-0 left-0 rounded-full bg-granate-300" style={{ width: `${pFin > 0 ? Math.max(1, pFin) : 0}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full bg-moss" style={{ width: `${pProc > 0 ? Math.max(1, pProc) : 0}%` }} />
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-inkSoft">
              <li className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-granate-300" aria-hidden /> Financiado: <span className="font-mono tabular-nums text-ink">{pctTxt(pFin)}</span>
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-moss" aria-hidden /> Leído: <span className="font-mono tabular-nums text-ink">{pctTxt(pProc)}</span>
              </li>
            </ul>
          </section>

          {/* Qué hay en la cola: una línea de datos; el porqué del orden, a un clic. */}
          <section aria-labelledby="cola-titulo">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <h2 id="cola-titulo" className="font-display text-lg font-bold text-ink">Qué hay en la cola</h2>
                <Ayuda titulo="¿Quién elige qué se lee?">
                  Los contratos son públicos y puedes verlos, pero se leen en orden de llegada: quien financia no elige
                  cuáles.
                </Ayuda>
              </div>
              <Link href={`/app/contratos?ubigeo=${zona.ubigeo}`} className="inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline">
                Ver los contratos <ChevronRight size={13} aria-hidden />
              </Link>
            </div>
            <ul className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[13px] tabular-nums text-inkSoft">
              {/* Todo lo que entró a la cola, financiado o no: "en cola" (§10.1) es sólo lo que
                  espera financiamiento, y ya está arriba. */}
              <li>
                <strong className={CIFRA}>{numero(cola.contratos)}</strong> entraron a la cola
              </li>
              <li className="inline-flex items-center gap-1">
                <span>
                  <strong className={CIFRA}>{soles(cola.montoReferencial)}</strong> valor referencial
                </span>
                <Ayuda titulo="¿Qué es el valor referencial?">Lo que la entidad convocó, no lo que terminó pagando.</Ayuda>
              </li>
              <li>
                <strong className={CIFRA}>{numero(cola.entidades)}</strong> entidades
              </li>
              <li className="inline-flex items-center gap-1">
                <span>
                  <strong className={CIFRA}>{numero(cola.documentosListos)}</strong> documentos listos
                </span>
                <Ayuda titulo="¿Qué son los documentos listos?">
                  Contratos de tipos que todavía no entran a la cola, con sus documentos ya descargados. Entran cuando su
                  análisis se active.
                </Ayuda>
              </li>
            </ul>
          </section>

          {/* En vivo: una vista previa de una línea por contrato; el tablero que se refresca solo, en el panel. */}
          <section aria-labelledby="vivo-titulo">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="vivo-titulo" className="inline-flex items-center gap-2 font-display text-lg font-bold text-ink">
                <Activity size={16} className={zona.financiados > 0 ? "text-moss" : "text-mute"} aria-hidden />
                En vivo en {zona.nombre}
              </h2>
              {/* Un solo disparador: el panel trae el tablero que se refresca solo y, al pie, el
                  enlace al tablero completo de la región. */}
              {zona.financiados > 0 && (
                <Revelar
                  titulo={`En vivo en ${zona.nombre}`}
                  descripcion="Cada contrato financiado, de la cola a la lectura. Se actualiza solo."
                  etiqueta={`Abrir el tablero en vivo de ${zona.nombre}`}
                  ancho="lg"
                  className="inline-flex min-h-[24px] w-auto items-center gap-1 text-[13px] font-medium text-granate hover:underline"
                  detalle={<TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} limit={60} initial={enVivo} compacto />}
                  pie={
                    <Link href={`/app/auditoria?ubigeo=${zona.ubigeo.slice(0, 2)}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-granate hover:underline">
                      Ver el tablero completo <ChevronRight size={13} aria-hidden />
                    </Link>
                  }
                >
                  <Radio size={13} aria-hidden /> Ver en vivo
                </Revelar>
              )}
            </div>
            {zona.financiados > 0 ? (
              <VistaPreviaVivo items={enVivo} />
            ) : (
              <p className="mt-1 text-sm text-inkSoft">Cuando alguien financie esta zona, verás aquí cada contrato pasar a la lectura.</p>
            )}
          </section>

          {/* Zonas hijas */}
          {hijas.length > 0 && (
            <section aria-labelledby="hijas-titulo">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="hijas-titulo" className="font-display text-lg font-bold text-ink">{zona.nivel === "departamento" ? "Provincias" : "Distritos"}</h2>
                <span className="text-[12px] text-mute">financiados / en cola</span>
              </div>
              <ul className="mt-2 grid overflow-hidden rounded-2xl border border-line bg-paper sm:grid-cols-2 [&>li+li]:border-t [&>li]:border-line sm:[&>li:nth-child(2)]:border-t-0 sm:[&>li:nth-child(even)]:border-l">
                {hijas.map((h) => (
                  <li key={h.ubigeo}>
                    <Link href={`/app/financiar/${h.ubigeo}`} className="flex min-h-[44px] items-center justify-between gap-3 px-4 py-2.5 text-sm transition-colors duration-150 hover:bg-paperSoft">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", ESTADO_PUNTO[h.estado])} aria-hidden />
                        <span className="sr-only">{ESTADO_LABEL[h.estado]}:</span>
                        <span className="truncate font-medium text-ink">{h.nombre}</span>
                      </span>
                      {h.totalCola > 0 ? (
                        <span className="shrink-0 font-mono text-[12px] tabular-nums text-inkSoft">
                          {numero(h.financiados)}<span className="text-mute"> / </span>{numero(h.pendientes)}
                          <span className="sr-only"> ({numero(h.financiados)} financiados, {numero(h.pendientes)} en cola)</span>
                        </span>
                      ) : (
                        <span className="shrink-0 text-[12px] text-mute">sin contratos en cola</span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Aliados: reconocimiento en contratos, nunca en soles */}
          <section aria-labelledby="aliados-titulo">
            <h2 id="aliados-titulo" className="font-display text-lg font-bold text-ink">Quién financió la lectura aquí</h2>
            {aliados.length ? (
              <ul className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {aliados.map((a) => (
                  <li key={a.nombre + a.contratos} className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-3 py-2.5">
                    <Avatar tipo={a.tipo} logoUrl={a.logoUrl} nombre={a.nombre} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {a.slug ? <Link href={`/aliado/${a.slug}`} className="underline-offset-2 hover:underline">{a.nombre}</Link> : a.nombre}
                      </p>
                      <p className="text-[12px] text-mute">
                        <span className="font-mono tabular-nums">{numero(a.contratos)}</span> {a.contratos === 1 ? "contrato financiado" : "contratos financiados"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-inkSoft">Nadie ha financiado la lectura de {zona.nombre} todavía.</p>
            )}
          </section>

          {/* La independencia en una línea; el detalle, en el ⓘ y en las reglas de /app/financiar. */}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>Financias capacidad de lectura, no resultados.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              Los contratos se asignan por antigüedad y los resultados se publican aunque señalen a quien financió.
            </Ayuda>
            <Link href="/app/financiar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>
          </p>
        </div>

        {/* En móvil la respuesta va PRIMERO (se llega desde "Financiar esta zona"); en escritorio, columna derecha pegajosa. */}
        <section aria-label={`Financiar la lectura de ${zona.nombre}`} className="order-first lg:order-last lg:sticky lg:top-6 lg:self-start" id="aportar">
          {zona.totalCola > 0 ? (
            <ContribuirForm
              ubigeo={zona.ubigeo}
              zonaNombre={zona.nombre}
              precioPen={zona.precioPen}
              restantes={enCola}
              metodos={metodos}
              pagoConfigurado={!!pago?.configurado}
              padre={padre ? { ubigeo: padre.ubigeo, nombre: padre.nombre } : null}
              financiados={zona.financiados}
            />
          ) : (
            <TarjetaConfirmacion
              titulo={`Todavía no hay contratos de ${zona.nombre} en la cola`}
              acciones={
                padre ? (
                  <EnlaceAccion href={`/app/financiar/${padre.ubigeo}`}>Ver {padre.nombre}</EnlaceAccion>
                ) : (
                  <EnlaceAccion href="/app/financiar#zonas">Elegir otra zona</EnlaceAccion>
                )
              }
            >
              Podrás financiar su lectura cuando el OECE publique contratos de esta zona que entren a la cola.
            </TarjetaConfirmacion>
          )}
        </section>
      </div>
    </Pagina>
  );
}

/**
 * Vista previa del "en vivo": una fila por contrato —estado, objeto en una línea, entidad
 * y valor— para lo que se está moviendo ahora. Antes el tablero entero (hasta 60 tarjetas
 * de cinco renglones) vivía abierto en la página; ahora vive en el panel "Ver en vivo".
 * Server component: `items` ya viene resuelto del servidor.
 */
function VistaPreviaVivo({ items }: { items: Procesamiento[] | null }) {
  if (!items) {
    return <p className="mt-1 text-sm text-mute">No se pudo leer el avance ahora mismo. El tablero en vivo lo reintenta solo.</p>;
  }
  if (items.length === 0) {
    return <p className="mt-1 text-sm text-inkSoft">Todavía no hay contratos asignados en esta zona.</p>;
  }
  // Sin denominador inventado: la consulta trae hasta 60 filas y no dice cuántas hay en total
  // (los leídos y financiados de la zona ya están, contados, en la línea de progreso). Sólo se
  // cuenta lo que en esa muestra es seguro: el API ordena lo que está en análisis primero.
  const enAnalisis = items.filter((p) => p.estado === "procesando").length;
  const visibles = [...items].sort((a, b) => PRIORIDAD[estadoVisible(a)] - PRIORIDAD[estadoVisible(b)]).slice(0, FILAS_VIVO);
  return (
    <div className="mt-2 space-y-2">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] tabular-nums text-inkSoft">
        {enAnalisis > 0 && (
          <span>
            <strong className={CIFRA}>{numero(enAnalisis)}</strong> en análisis ahora
          </span>
        )}
        <span className="text-mute">
          {items.length > visibles.length
            ? `Los ${numero(visibles.length)} que se mueven primero; el resto, en «Ver en vivo».`
            : plural(visibles.length, "contrato asignado", "contratos asignados")}
        </span>
      </p>
      <ul className="overflow-hidden rounded-2xl border border-line bg-paper">
        {visibles.map((p) => {
          const titulo = p.titulo ?? p.ocid;
          return (
            <li key={p.ocid} className="border-b border-line/70 last:border-b-0">
              <Link
                href={`/app/auditoria/${encodeURIComponent(p.ocid)}`}
                className="grid grid-cols-1 gap-x-4 gap-y-1 px-4 py-2.5 transition-colors duration-rapido hover:bg-paperSoft md:grid-cols-[132px_minmax(0,1fr)_112px] md:items-center"
              >
                <span className="flex">
                  <EstadoPill estado={estadoVisible(p)} intentos={p.intentos} />
                </span>
                <span className="min-w-0">
                  <span className="line-clamp-2 text-[13px] font-semibold leading-snug text-ink md:truncate" title={titulo}>
                    {titulo}
                  </span>
                  <span className="block truncate text-[12px] text-mute">{p.entidad ?? "Entidad no identificada"}</span>
                </span>
                <span className="font-mono text-[12px] tabular-nums text-inkSoft md:text-right">
                  {p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : "Sin dato"}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
