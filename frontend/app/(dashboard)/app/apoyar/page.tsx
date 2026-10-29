import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Building2, CalendarCheck, CalendarClock, Database, EyeOff, ListOrdered, ScanSearch, Server, ShieldAlert, Users } from "lucide-react";
import { Beneficios, Franja, FuenteDato, Migas, Pagina, Seccion, type Beneficio } from "@/components/patrones";
import { FranjaTextil } from "@/components/marca";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { AporteVigilancia, type ParaAporte } from "@/components/financiar/AporteVigilancia";
import { DeCadaCien } from "@/components/financiar/DeCadaCien";
import { MetaDelMes } from "@/components/financiar/MetaDelMes";
import { numero } from "@/lib/formato";
import { dolares, getPago, getVigilancia, type ResumenVigilancia } from "@/lib/financiamiento";
import { CONTRALORIA_CORRUPCION, PUESTO_POR_EL_EQUIPO_PEN } from "@/lib/costoCorrupcion";

export const metadata: Metadata = {
  title: "Ayúdanos a seguir vigilando",
  description:
    "La corrupción se lleva carreteras, colegios y camas de hospital. Vigía cruza todos los días lo que compra el Estado y lee a fondo lo más grave. Hasta hoy lo sostuvimos nosotros: ayúdanos a seguir.",
};

export const revalidate = 300;

const CONTRALORIA = CONTRALORIA_CORRUPCION;
const PUESTO_POR_EL_EQUIPO = PUESTO_POR_EL_EQUIPO_PEN;

/**
 * Lo que el aporte no compra: las reglas de independencia de siempre, cada una con su ícono. Antes llevaban un ✓ verde,
 * que se leía como «sí incluye» al lado de cosas que justamente no se compran.
 */
const NO_COMPRA: Beneficio[] = [
  { icono: <ListOrdered size={16} />, titulo: "Qué se lee", texto: "Lo más grave va primero, aporte quien aporte. Ningún aporte decide qué entidad, empresa o contrato se revisa." },
  { icono: <EyeOff size={16} />, titulo: "Lo que se encuentra", texto: "El análisis no sabe quién aportó, y si te señala a ti, se publica igual." },
  { icono: <CalendarCheck size={16} />, titulo: "Un lugar por plata", texto: "El podio de aliados cuenta los meses que sostienes la vigilancia, nunca los soles." },
  { icono: <ShieldAlert size={16} />, titulo: "Reconocimiento con conflicto", texto: "Una empresa con sanción vigente o con alertas puede aportar, pero no recibe reconocimiento público." },
];

/** En qué se fue lo que pusimos: antes, una enumeración dentro de un párrafo. */
const PUSIMOS_EN = [
  { icono: Server, texto: "Servidores" },
  { icono: Database, texto: "La base de datos" },
  { icono: CalendarClock, texto: "Bajar cada día lo que publica el Estado" },
  { icono: ScanSearch, texto: "Leer con IA los contratos más graves" },
];

/**
 * /app/apoyar — «Ayúdanos a seguir vigilando» (migración 206). Rehecha el 2026-10-29 porque «se ve feo»: el usuario
 * pidió que conmueva («la corrupción cuesta infraestructura pública, carreteras, a muchas familias la vida por esperar
 * en hospitales») y que diga lo que el equipo ya puso. Con la crítica de Impeccable (modo Persuade, dentro del mundo
 * visual de Vigía: granate, maíz y la franja textil), sin el kit de tarjetas iguales que tenía. Y el mismo día, «texto y
 * ya, nada de jerarquía»: las cifras dejaron los párrafos (la de la Contraloría es una figura, DeCadaCien) y cada bloque
 * tiene su forma:
 *
 *   1. Por qué: lo que cuesta la corrupción, en cien cuadros, con las dos cifras de la Contraloría y su fuente.
 *   2. Quiénes somos: lo que pusimos hasta hoy, en qué se fue (con íconos) y, como un comprobante, lo que ya vigila.
 *   3. La meta del mes, con sus dos tramos en orden (lo que antes repetía «En qué se usa tu aporte»), y lo que el aporte
 *      no compra.
 *   4. El formulario, fijo a la derecha en escritorio; en el celular, justo después del por qué.
 *
 * `?para=<RUC o ubigeo>&nombre=` dice qué te trajo: sólo informa, no dirige lecturas. Financiar la lectura de una
 * zona, entidad o partido sigue en /app/financiar (para organizaciones).
 */
export default async function ApoyarPage({ searchParams }: { searchParams?: { para?: string; nombre?: string } }) {
  const [v, pago] = await Promise.all([getVigilancia(), getPago()]);
  const p = searchParams?.para ?? "";
  const nombre = (searchParams?.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const para: ParaAporte | null =
    nombre && /^\d{11}$/.test(p) ? { ruc: p, nombre } : nombre && /^\d{2}(\d{2}(\d{2})?)?$/.test(p) ? { ubigeo: p, nombre } : null;
  const piso = v?.meta.pisoPen ?? null;

  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Ayúdanos a seguir vigilando", href: "/app/apoyar" }]} />

      <PorQue piso={piso} />

      {/* En el celular: el formulario justo después del por qué; desde lg, fijo a la derecha de todo lo demás. */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_26rem] lg:items-start">
        <aside id="aporte" className="min-w-0 scroll-mt-24 lg:sticky lg:top-24 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:self-start">
          {pago ? (
            <AporteVigilancia pago={pago} para={para} />
          ) : (
            <p className="rounded-2xl border border-line bg-paper p-5 text-dato text-inkSoft">No pudimos leer los medios de pago ahora. Vuelve a intentarlo en un momento.</p>
          )}
        </aside>

        <LoQuePusimos v={v} />

        {v && (
          <div className="min-w-0 lg:col-start-1">
            <MetaDelMes v={v} />
          </div>
        )}

        <div className="min-w-0 space-y-10 lg:col-start-1">
          <Seccion titulo="Lo que tu aporte no compra" descripcion="Aportes de cualquier tamaño, con las mismas reglas.">
            <Beneficios items={NO_COMPRA} columnas={2} />
          </Seccion>

          {v && (v.aliados.nombres.length > 0 || v.aliados.anonimos > 0) && (
            <Seccion titulo="Quiénes la sostienen" descripcion="Quienes aportaron en los dos últimos meses y eligieron aparecer.">
              <ul className="flex flex-wrap gap-2">
                {v.aliados.nombres.map((a) => (
                  <li key={`${a.nombre}-${a.slug}`} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-meta text-ink">
                    <Users size={13} aria-hidden className="text-inkSoft" />
                    {a.slug ? <Link href={`/aliado/${a.slug}`} prefetch={false} className="hover:underline">{a.nombre}</Link> : a.nombre}
                    {a.periodicidad === "mensual" && <span className="text-rotulo text-mute">cada mes</span>}
                  </li>
                ))}
                {v.aliados.anonimos > 0 && (
                  <li className="inline-flex items-center rounded-full border border-dashed border-line px-3 py-1 text-meta text-inkSoft">
                    y {numero(v.aliados.anonimos)} {v.aliados.anonimos === 1 ? "persona anónima" : "personas anónimas"}
                  </li>
                )}
              </ul>
              <Link href="/app/aliados" prefetch={false} className="mt-3 inline-flex min-h-[32px] items-center gap-1 text-meta font-semibold text-granate hover:underline">
                Ver el podio de aliados <ArrowUpRight size={14} aria-hidden />
              </Link>
            </Seccion>
          )}

          <Franja
            icono={<Building2 size={18} />}
            titulo="¿Eres una organización?"
            accion={
              <EnlaceAccion href="/app/financiar" variante="secundario">
                Financiar lecturas
              </EnlaceAccion>
            }
          >
            Puedes financiar la lectura de los contratos de una región, una entidad o un partido.
          </Franja>

          <FuenteDato
            fuente="Contraloría General de la República (estimación de 2023), factura de AWS, tarifa de Cloudflare, costo medido en cada lectura y tipo de cambio del BCRP"
            href={CONTRALORIA.url}
          />
        </div>
      </div>
    </Pagina>
  );
}

/**
 * El por qué, en una banda granate con la franja textil: lo que la corrupción se lleva, dicho en cosas, y a la derecha
 * (debajo en el celular, después de los botones) la cifra de la Contraloría dibujada en cien cuadros, con su fuente. La
 * única pieza grande de la página.
 */
function PorQue({ piso }: { piso: number | null }) {
  return (
    <section aria-labelledby="por-que" className="sobre-oscuro relative overflow-hidden rounded-3xl bg-granate-deep text-paper">
      <div className="grid gap-10 px-5 pb-10 pt-9 sm:px-10 sm:pb-12 sm:pt-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,19rem)] lg:items-center lg:gap-14 lg:px-14">
        <div className="min-w-0">
          <h1 id="por-que" className="max-w-[20ch] text-balance font-display text-cifra font-extrabold leading-[1.05] sm:text-titulo lg:text-portada">
            La corrupción no es una cifra.
          </h1>
          <p className="mt-4 max-w-[34ch] text-balance font-display text-seccion font-semibold leading-snug text-paper/85 sm:text-cifra">
            Es la pista que no se terminó, el colegio sin techo y la cama de hospital que no llegó a tiempo.
          </p>
          <p className="mt-6 max-w-[52ch] text-pretty text-cuerpo leading-relaxed text-paper/80 sm:text-bloque">
            Vigía lee lo que el Estado compra para que eso se vea a tiempo.
            {piso != null ? ` Mantenerla encendida cuesta S/\u00a0${numero(piso)} al mes, y la sostenemos entre todos.` : " La sostenemos entre todos."}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <EnlaceAccion href="#aporte" variante="oscuro" tamano="lg">
              Ayúdanos a seguir vigilando
            </EnlaceAccion>
            <EnlaceAccion href="/app/cuanto-cuesta" variante="contornoOscuro" tamano="lg" flecha={false}>
              Cuánto cuesta Vigía
            </EnlaceAccion>
          </div>
        </div>
        <DeCadaCien className="border-t border-paper/15 pt-8 lg:border-l lg:border-t-0 lg:pl-12 lg:pt-0" />
      </div>
      <FranjaTextil alto={12} />
    </section>
  );
}

/**
 * Lo que pusimos hasta hoy (dicho por el equipo), en qué se fue (cuatro rubros con su ícono; antes, una enumeración dentro
 * de un párrafo), por qué, y debajo lo que ya vigila con eso, como un comprobante: el mismo papel que recibe quien
 * aporta. Las cifras del comprobante son las de GET /financiamiento/vigilancia. Apilado: al lado del formulario, la
 * columna no da para el comprobante y el texto juntos.
 */
function LoQuePusimos({ v }: { v: ResumenVigilancia | null }) {
  return (
    <section aria-labelledby="lo-que-pusimos" className="min-w-0 space-y-6 lg:col-start-1">
      <h2 id="lo-que-pusimos" className="max-w-[26ch] text-balance font-display text-cifra font-bold leading-tight text-ink sm:text-titulo">
        Hasta hoy pusimos casi S/{"\u00a0"}{numero(PUESTO_POR_EL_EQUIPO)} para que Vigía exista.
      </h2>
      <ul aria-label="En qué se fue" className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {PUSIMOS_EN.map(({ icono: Icono, texto }) => (
          <li key={texto} className="flex items-center gap-3">
            <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-granate">
              <Icono size={18} />
            </span>
            <span className="min-w-0 text-dato font-semibold leading-snug text-ink">{texto}</span>
          </li>
        ))}
      </ul>
      <div className="max-w-[58ch] space-y-2">
        <p className="text-balance font-display text-bloque font-semibold leading-snug text-ink">
          Lo pusimos nosotros porque alguien tenía que empezar a leer lo que nadie lee.
        </p>
        <p className="text-pretty text-cuerpo leading-relaxed text-inkSoft">
          Detrás de cada orden hay una obra, una medicina o un sueldo que pagamos todos. Con tu aporte, vigilarlos no depende de
          unos pocos.
        </p>
      </div>
      {v && <Comprobante v={v} />}
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
    <figure className="min-w-0 max-w-md rounded-2xl border border-line bg-paper shadow-[0_10px_30px_-18px_rgb(var(--ink)/0.35)]">
      <figcaption className="border-b border-dashed border-line px-4 pb-3 pt-4">
        <span className="block font-display text-bloque font-bold text-ink">Lo que ya vigila</span>
        <span className="block text-meta text-mute">En {v.vigilamos.anio}, todo y no una muestra</span>
      </figcaption>
      <dl className="space-y-2.5 px-4 py-3.5">
        {filas.map((f) => (
          <div key={f.texto} className="flex items-end gap-2 text-meta">
            <dt className="min-w-0 text-inkSoft">{f.texto}</dt>
            <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-line" />
            <dd className="shrink-0 font-mono font-semibold tabular-nums text-ink">{f.valor}</dd>
          </div>
        ))}
      </dl>
      <div className="flex items-end gap-2 border-t border-dashed border-line px-4 pb-4 pt-3 text-meta">
        <span className="min-w-0 font-semibold text-ink">Leer uno a fondo con IA</span>
        <span aria-hidden className="mb-1 min-w-4 flex-1 border-b border-dotted border-line" />
        <span className="shrink-0 font-mono font-semibold tabular-nums text-granate">
          {v.ia.costoMedioUsd != null ? dolares(v.ia.costoMedioUsd) : "Sin dato"}
        </span>
      </div>
    </figure>
  );
}
