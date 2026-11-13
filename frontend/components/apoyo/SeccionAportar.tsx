import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { ArrowRight, CalendarCheck, CalendarClock, Database, EyeOff, ListOrdered, Radio, ScanSearch, Server, ShieldAlert } from "lucide-react";
import { Beneficios, Franja, FuenteDato, Seccion, type Beneficio } from "@/components/patrones";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AporteVigilancia, type ParaAporte } from "@/components/financiar/AporteVigilancia";
import { DeCadaCien } from "@/components/financiar/DeCadaCien";
import { MetaDelMes } from "@/components/financiar/MetaDelMes";
import { HREF_APOYO } from "@/components/sitio/VistasSeccion";
import { numero } from "@/lib/formato";
import { conAcentos, dolares, getMotivoAporte, getPago, getVigilancia, type ResumenVigilancia } from "@/lib/financiamiento";
import { tituloNatural } from "@/lib/landing";
import { CONTRALORIA_CORRUPCION, PUESTO_POR_EL_EQUIPO_PEN } from "@/lib/costoCorrupcion";

/**
 * La pestaña «Aportar» de /app/apoyar (antes, toda la página /app/apoyar; migración 206). Rehecha el 2026-11-13 con el
 * estándar de cajas: el por qué dejó la banda granate de 430 px con un título de portada y es una caja con la cifra de
 * la Contraloría dibujada (DeCadaCien en su versión clara); lo que pusimos y lo que ya vigila van lado a lado en otra; la
 * meta del mes, una vez (antes en tres páginas); las reglas de independencia, en su rejilla. El formulario, fijo a la
 * derecha en escritorio; en el celular, justo después del por qué. Quiénes la sostienen está en su pestaña, el podio.
 *
 * `para` (RUC o ubigeo) es el destino sugerido del aporte: sale en la constancia y no decide qué se lee. El nombre sale
 * de la base (GET /financiamiento/motivo); un `&nombre=` en el enlace se ignora (auditoría de pagos del 2026-10-30, H14).
 */

/** Lo que el aporte no compra: las reglas de independencia, cada una con su ícono. `#independencia` lleva aquí. */
const NO_COMPRA: Beneficio[] = [
  { icono: <ListOrdered size={16} />, titulo: "Qué se lee", texto: "Lo más grave va primero, aporte quien aporte. Ningún aporte decide qué entidad, empresa o contrato se revisa." },
  { icono: <EyeOff size={16} />, titulo: "Lo que se encuentra", texto: "El análisis no sabe quién aportó, y si te señala a ti, se publica igual." },
  { icono: <CalendarCheck size={16} />, titulo: "Un lugar por plata", texto: "El podio de aliados cuenta los meses que sostienes la vigilancia, nunca los soles." },
  { icono: <ShieldAlert size={16} />, titulo: "Reconocimiento con conflicto", texto: "Una empresa con sanción vigente o con alertas puede aportar, pero no recibe reconocimiento público." },
];

/** En qué se fue lo que pusimos. */
const PUSIMOS_EN = [
  { icono: Server, texto: "Servidores" },
  { icono: Database, texto: "La base de datos" },
  { icono: CalendarClock, texto: "Bajar cada día lo que publica el Estado" },
  { icono: ScanSearch, texto: "Leer con IA los contratos más graves" },
];

export async function SeccionAportar({ para: paraPedido }: { para?: string }) {
  const [v, pago, motivo] = await Promise.all([getVigilancia(), getPago(), paraPedido ? getMotivoAporte(paraPedido) : null]);
  // Una lectura que falló no se guarda en caché como la página (lo de /app/cuanto-cuesta del 2026-11-13).
  if (!v || !pago) noStore();
  const para: ParaAporte | null = motivo?.ruc
    ? { ruc: motivo.ruc, nombre: tituloNatural(motivo.nombre) }
    : motivo?.ubigeo
      ? { ubigeo: motivo.ubigeo, nombre: conAcentos(motivo.nombre) }
      : null;
  const piso = v?.meta.pisoPen ?? null;

  return (
    // En el celular: el por qué, el formulario y lo demás. Desde lg, el formulario fijo a la derecha de todo, con su
    // propio desplazamiento: si mide más que la pantalla, el botón para seguir no queda escondido (auditoría 2026-10-30).
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_25rem] lg:items-start">
      <PorQue piso={piso} />

      <aside
        id="aporte"
        aria-label="Tu aporte"
        className="min-w-0 scroll-mt-24 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
      >
        {pago ? (
          <AporteVigilancia pago={pago} para={para} />
        ) : (
          <p className="rounded-2xl border border-line bg-paper p-5 text-dato text-inkSoft">No pudimos leer los medios de pago ahora. Vuelve a intentarlo en un momento.</p>
        )}
      </aside>

      {v && (
        <div className="min-w-0 lg:col-start-1">
          <MetaDelMes v={v} />
        </div>
      )}

      <LoQuePusimos v={v} />

      <div className="min-w-0 space-y-5 lg:col-start-1">
        <Seccion id="independencia" titulo="Lo que tu aporte no compra" descripcion="Aportes de cualquier tamaño, con las mismas reglas.">
          <Beneficios items={NO_COMPRA} columnas={2} />
        </Seccion>

        <Franja
          icono={<Radio size={18} />}
          titulo="¿Qué se lee con el fondo común?"
          accion={
            <EnlaceAccion href="/app/auditoria?seccion=falta" variante="secundario">
              Lo que falta leer
            </EnlaceAccion>
          }
        >
          Cuántos contratos de cada región, entidad o partido esperan su lectura, en Auditoría en vivo. Desde la ficha de
          uno puedes aportar con él como destino sugerido: tu aporte va igual al fondo común.
        </Franja>

        <FuenteDato
          fuente="Contraloría General de la República (estimación de 2023), lo que el equipo calcula que cuesta mantenerla, factura de AWS, tarifa de Cloudflare, costo medido en cada lectura y tipo de cambio del BCRP"
          href={CONTRALORIA_CORRUPCION.url}
        />
      </div>
    </div>
  );
}

/**
 * El por qué, en una caja: lo que la corrupción se lleva, dicho en cosas, y debajo la cifra de la Contraloría dibujada
 * en cien cuadros con sus dos montos al lado (DeCadaCien `horizontal`), con su fuente. Apilado y no en dos columnas: al
 * lado del formulario la columna mide ~680 px y partida en dos dejaba el texto en seis renglones.
 */
function PorQue({ piso }: { piso: number | null }) {
  return (
    <section aria-labelledby="por-que" className="min-w-0 rounded-2xl border border-line bg-paper lg:col-start-1 lg:row-start-1">
      <div className="space-y-5 p-4 sm:p-5">
        <div className="min-w-0">
          <h2 id="por-que" className="font-display text-seccion font-bold leading-tight text-ink text-balance">
            La corrupción no es una cifra.
          </h2>
          <p className="mt-2 max-w-[62ch] text-cuerpo leading-snug text-inkSoft text-pretty">
            Es la pista que no se terminó, el colegio sin techo y la cama de hospital que no llegó a tiempo. Vigía lee lo que el
            Estado compra para que eso se vea a tiempo.
            {piso != null ? ` Mantenerla encendida cuesta cerca de S/ ${numero(piso)} al mes, y la sostenemos entre todos.` : " La sostenemos entre todos."}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <EnlaceAccion href="#aporte">Aportar ahora</EnlaceAccion>
            <Link href={HREF_APOYO.costos} prefetch={false} className="inline-flex min-h-[40px] items-center gap-1 text-dato font-semibold text-granate underline-offset-4 hover:underline">
              Cuánto cuesta Vigía <ArrowRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
        <DeCadaCien claro horizontal className="border-t border-line pt-5" />
      </div>
    </section>
  );
}

/**
 * Lo que pusimos hasta hoy (dicho por el equipo) y en qué se fue, y al lado lo que ya vigila con eso, como un
 * comprobante (las cifras de GET /financiamiento/vigilancia). Una caja: el título arriba y, desde xl, los cuatro rubros
 * en lista a la izquierda del comprobante.
 */
function LoQuePusimos({ v }: { v: ResumenVigilancia | null }) {
  return (
    <section aria-labelledby="lo-que-pusimos" className="min-w-0 rounded-2xl border border-line bg-paper lg:col-start-1">
      <div className="space-y-4 p-4 sm:p-5">
        <div>
            <h2 id="lo-que-pusimos" className="font-display text-bloque font-bold leading-tight text-ink text-balance">
              Hasta hoy pusimos casi S/{" "}{numero(PUESTO_POR_EL_EQUIPO_PEN)} para que Vigía exista
            </h2>
            <p className="mt-1 text-meta leading-snug text-inkSoft text-pretty">
              Alguien tenía que empezar a leer lo que nadie lee. Detrás de cada orden hay una obra, una medicina o un sueldo que
              pagamos todos: con tu aporte, vigilarlos no depende de unos pocos.
            </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2 xl:items-start">
          <ul aria-label="En qué se fue" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
            {PUSIMOS_EN.map(({ icono: Icono, texto }) => (
              <li key={texto} className="flex items-center gap-3 rounded-xl border border-line px-3 py-2">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-paperDeep text-granate">
                  <Icono size={16} />
                </span>
                <span className="min-w-0 text-meta font-semibold leading-snug text-ink">{texto}</span>
              </li>
            ))}
          </ul>
          {v && <Comprobante v={v} />}
        </div>
      </div>
    </section>
  );
}

function Comprobante({ v }: { v: ResumenVigilancia }) {
  const filas: { texto: string; valor: string }[] = [
    { texto: "Órdenes de compra y servicio cruzadas con sanciones, fechas y topes", valor: numero(v.vigilamos.ordenes) },
    { texto: "Procesos con su ganador y sus postores", valor: numero(v.vigilamos.procesos) },
    { texto: "Contratos con banderas", valor: numero(v.vigilamos.contratosConBanderas) },
    { texto: "Con algún antecedente grave", valor: numero(v.vigilamos.graves) },
  ];
  return (
    <figure className="min-w-0 rounded-xl border border-line bg-paperSoft">
      <figcaption className="border-b border-dashed border-line px-4 pb-2.5 pt-3">
        <span className="block text-dato font-bold text-ink">Lo que ya vigila</span>
        <span className="block text-rotulo text-mute">En {v.vigilamos.anio}, todo y no una muestra</span>
      </figcaption>
      <dl className="space-y-2 px-4 py-3">
        {filas.map((f) => (
          <div key={f.texto} className="flex items-end gap-2 text-meta">
            <dt className="min-w-0 text-inkSoft">{f.texto}</dt>
            <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-line" />
            <dd className="shrink-0 font-mono font-semibold tabular-nums text-ink">{f.valor}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-end gap-2 border-t border-dashed border-line px-4 pb-3 pt-2.5 text-meta">
        <span className="min-w-0 font-semibold text-ink">Leer uno a fondo con IA</span>
        <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-line" />
        <span className="shrink-0 font-mono font-semibold tabular-nums text-granate">{v.ia.costoMedioUsd != null ? dolares(v.ia.costoMedioUsd) : "Sin dato"}</span>
      </div>
    </figure>
  );
}
