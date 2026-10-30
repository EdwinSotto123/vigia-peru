import { rutaContrato } from "@/lib/rutas";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ChevronRight, Radio, ShieldCheck } from "lucide-react";
import { ApoyarAlcance } from "@/components/financiar/ApoyarAlcance";
import { ListaZonas } from "@/components/financiar/ListaZonas";
import { TablaAliados } from "@/components/financiar/TablaAliados";
import { Revelar } from "@/components/ui/Revelar";
import { Ayuda, CabeceraPestana, EncabezadoPagina, EstadoError, Migas, Pagina, type Pestana, Pestanas } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { ESTADO_LABEL, ESTADO_PUNTO, alcanceLargo, getPago, getZona, mediosAbiertos, type ZonaDetalle } from "@/lib/financiamiento";
import { numero, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
import { estadoVisible, getProcesamientos, type EstadoProc, type Procesamiento } from "@/lib/auditoria";
import { cn } from "@/lib/utils";

export const revalidate = 60;

export async function generateMetadata({ params }: { params: { ubigeo: string } }) {
  const d = await getZona(params.ubigeo);
  return { title: d ? `Lo que falta leer en ${d.zona.nombre}` : "Zona no encontrada" };
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

/**
 * Lo que falta leer en una zona.
 *
 *   identidad · Indicadores (esperan lectura a fondo, asignados, leídos, con señales)
 *   [ lo que hace falta para entenderla ]   [ el aporte, a la derecha ]
 *     pestañas (§14.3): Qué hay en la cola | En vivo | Provincias | Quién financió
 *
 * Desde el 2026-10-30 no se paga la lectura de sus contratos («S/ X por contrato» era una venta): a la derecha va el
 * aporte al fondo común con la zona como destino sugerido (ApoyarAlcance). «Quién financió» es lo que se pagó con el
 * modelo anterior.
 *
 * El aporte va primero en el celular (se llega desde «Ayuda a vigilar») y pegado a la derecha desde `xl`: entre 1024 y
 * 1280 px, con la barra lateral, la columna de datos quedaba en ~220 px y las tablas no cabían.
 */
export default async function ZonaPage({
  params,
  searchParams,
}: {
  params: { ubigeo: string };
  /** `?seccion=` abre esa pestaña: vivo, zonas o aliados. */
  searchParams?: { seccion?: string | string[] };
}) {
  const [d, pago] = await Promise.all([getZona(params.ubigeo), getPago()]);
  if (!d) notFound();
  const { zona, breadcrumb } = d;
  const enVivo = zona.financiados > 0 ? await getProcesamientos({ ubigeo: zona.ubigeo, limit: 60 }) : null;
  // Una sola base para "en cola" en toda la página: lo que nadie financió todavía (`pendientes`).
  // `totalCola` = pendientes + financiados; usarlo como "en cola" hacía que la misma zona dijera
  // 604 arriba y 594 en el formulario.
  const enCola = zona.pendientes;
  const padre = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;

  return (
    <Pagina className="space-y-6">
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Lo que falta leer", href: "/app/financiar" },
          ...breadcrumb.map((b) => ({ etiqueta: b.nombre, href: `/app/financiar/${b.ubigeo}` })),
        ]}
      />

      <div className="space-y-4">
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
        <Indicadores items={indicadoresZona(d)} />
      </div>

      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_minmax(0,440px)] 2xl:grid-cols-[minmax(0,1fr)_minmax(0,500px)]">
        <div className="min-w-0 space-y-6">
          <Pestanas
            etiqueta={`Secciones de ${zona.nombre}`}
            activa={typeof searchParams?.seccion === "string" ? searchParams.seccion : undefined}
            pestanas={pestanasZona(d, enVivo)}
          />

          {/* La independencia en una línea; el detalle, en el ⓘ y en las reglas de /app/financiar. */}
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-inkSoft">
            <ShieldCheck size={15} className="shrink-0 text-granate" aria-hidden />
            <span>Tu aporte va al fondo común: no decide qué se lee.</span>
            <Ayuda titulo="¿Qué garantiza la independencia?">
              La zona queda como destino sugerido de tu aporte, nada más: lo más grave se lee primero, sea de donde sea, y los
              resultados se publican aunque señalen a quien aportó.
            </Ayuda>
            <Link href="/app/financiar#independencia" className="font-medium text-granate underline underline-offset-2">Reglas de independencia</Link>
          </p>

          {/* Las zonas hijas, a la vista y no en una pestaña: llenan la columna junto al formulario y son
              la forma de bajar de una región a su provincia o distrito. */}
          {d.hijas.length > 0 && (
            <section aria-labelledby="hijas-titulo" className="space-y-2">
              <h2 id="hijas-titulo" className="font-display text-bloque font-bold text-ink">
                {zona.nivel === "departamento" ? "Provincias" : "Distritos"} de {zona.nombre}
                <span className="ml-2 font-mono text-meta font-normal text-mute">{numero(d.hijas.length)}</span>
              </h2>
              <ListaZonas
                zonas={d.hijas}
                etiqueta={`${zona.nivel === "departamento" ? "Provincias" : "Distritos"} de ${zona.nombre}`}
                buscar={zona.nivel === "departamento" ? "Buscar una provincia…" : "Buscar un distrito…"}
              />
            </section>
          )}
        </div>

        {/* En móvil el aporte va PRIMERO (se llega desde «Ayuda a vigilar»); en escritorio, columna derecha pegajosa. */}
        <section
          aria-label={`Ayuda a vigilar ${zona.nombre}`}
          className="order-first w-full max-w-2xl xl:order-last xl:sticky xl:top-6 xl:max-w-none xl:self-start"
          id="aportar"
        >
          <ApoyarAlcance
            alcance={{ tipo: "zona", ubigeo: zona.ubigeo, nombre: zona.nombre }}
            medios={mediosAbiertos(pago)}
            lote={{ precioPen: zona.precioPen, restantes: enCola, padre: padre ? { ubigeo: padre.ubigeo, nombre: padre.nombre } : null }}
          />
        </section>
      </div>
    </Pagina>
  );
}

const ENLACE_PESTANA = "inline-flex min-h-[24px] items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline";

/**
 * Lo que hace falta para decidir, en pestañas: la cola (el resumen), el avance en vivo, las
 * zonas hijas y quién ya financió. Cada una con su conteo, salvo la primera (lo que espera ya
 * tiene su cifra arriba, en los Indicadores). Provincias o distritos, sólo si la zona los tiene.
 */
function pestanasZona(d: ZonaDetalle, enVivo: Procesamiento[] | null): Pestana[] {
  const { zona, aliados, cola } = d;
  // "En vivo" cuenta lo que se está leyendo ahora; sin avance que leer, no hay número que mostrar.
  const enAnalisis = zona.financiados > 0 && enVivo ? enVivo.filter((p) => p.estado === "procesando").length : null;
  const pestanas: Pestana[] = [
    {
      clave: "cola",
      etiqueta: "Qué hay en la cola",
      contenido: (
        <>
          <CabeceraPestana
            acciones={
              <Link href={`/app/contratos?ubigeo=${zona.ubigeo}`} className={ENLACE_PESTANA}>
                Ver los contratos <ChevronRight size={13} aria-hidden />
              </Link>
            }
          >
            Se leen de lo más grave a lo menos grave.
            <Ayuda titulo="¿Quién elige qué se lee?">
              Los contratos son públicos y puedes verlos, pero nadie elige cuáles se leen: van primero los más graves, aporte
              quien aporte.
            </Ayuda>
          </CabeceraPestana>
          {/* Todo lo que entró a la cola, financiado o no: "en cola" (§10.1) es sólo lo que
              espera financiamiento, y ya está arriba. */}
          <Indicadores
            items={[
              {
                valor: solesCompacto(cola.montoReferencial),
                etiqueta: "valor referencial",
                contexto: `de ${plural(cola.contratos, "contrato", "contratos")} que entraron a la cola`,
                ayuda: <Ayuda titulo="¿Qué es el valor referencial?">Lo que la entidad convocó, no lo que terminó pagando.</Ayuda>,
              },
              { valor: numero(cola.entidades), etiqueta: "entidades", contexto: "convocaron esos contratos" },
              {
                valor: cola.documentosListos != null ? numero(cola.documentosListos) : null,
                etiqueta: "documentos listos",
                contexto: "todavía fuera de la cola",
                ayuda: (
                  <Ayuda titulo="¿Qué son los documentos listos?">
                    Contratos de tipos que todavía no entran a la cola, con sus documentos ya descargados. Entran cuando su
                    análisis se active.
                  </Ayuda>
                ),
              },
            ]}
          />
        </>
      ),
    },
    {
      // Una vista previa de una fila por contrato; el tablero que se refresca solo, en el panel.
      clave: "vivo",
      etiqueta: "En vivo",
      conteo: enAnalisis,
      contenido:
        zona.financiados > 0 ? (
          <>
            <CabeceraPestana
              acciones={
                // Un solo disparador: el panel trae el tablero que se refresca solo y, al pie, el
                // enlace al tablero completo de la región.
                <Revelar
                  titulo={`En vivo en ${zona.nombre}`}
                  descripcion="Cada contrato de la zona, de la cola a la lectura. Se actualiza solo."
                  etiqueta={`Abrir el tablero en vivo de ${zona.nombre}`}
                  ancho="lg"
                  className="inline-flex min-h-[24px] w-auto items-center gap-1 text-meta font-medium text-granate hover:underline"
                  detalle={<TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} limit={60} initial={enVivo} pedirAlMontar compacto />}
                  pie={
                    <Link href={`/app/auditoria?ubigeo=${zona.ubigeo.slice(0, 2)}`} className={ENLACE_PESTANA}>
                      Ver el tablero completo <ChevronRight size={13} aria-hidden />
                    </Link>
                  }
                >
                  <Radio size={13} aria-hidden /> Ver en vivo
                </Revelar>
              }
            >
              <Activity size={15} className="shrink-0 text-moss" aria-hidden />
              {resumenVivo(enVivo) ?? "Cada contrato de la zona, de la cola a la lectura."}
            </CabeceraPestana>
            <VistaPreviaVivo items={enVivo} />
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-dato leading-5 text-inkSoft">
            <Activity size={15} className="shrink-0 text-mute" aria-hidden />
            Cuando un contrato de esta zona pase a lectura, verás aquí cómo avanza.
          </p>
        ),
    },
  ];
  // Aliados: reconocimiento en contratos, nunca en soles.
  pestanas.push({
    clave: "aliados",
    etiqueta: "Quién financió",
    conteo: aliados.length,
    contenido: aliados.length ? (
      <TablaAliados aliados={aliados} etiqueta={`Quién financió la lectura en ${zona.nombre}`} />
    ) : (
      <p className="text-dato leading-5 text-inkSoft">Nadie ha financiado la lectura de {zona.nombre} todavía.</p>
    ),
  });
  return pestanas;
}

/**
 * Las cifras de la zona (§10.7): antes eran una línea gris con seis números y una barra. «Asignados» son los que ya
 * pasaron a lectura (con el modelo anterior, los que alguien financió); «ya leídos» cuenta sólo esos (§10.1).
 */
function indicadoresZona({ zona, alcance }: ZonaDetalle): Indicador[] {
  const enRevision = zona.enRevision ?? 0;
  const pFin = zona.totalCola > 0 ? Math.min(100, (zona.financiados / zona.totalCola) * 100) : 0;
  return [
    {
      valor: numero(zona.pendientes),
      etiqueta: zona.pendientes === 1 ? "espera lectura a fondo" : "esperan lectura a fondo",
      contexto: zona.pendientes === 0 ? "ninguno en la cola" : "con el fondo común, lo más grave primero",
      ayuda: (
        <Ayuda titulo="¿Qué entra a la cola?">
          <span className="block">{alcanceLargo(alcance)}</span>
          <span className="mt-2 block text-mute">La zona es la sede de la entidad que contrata.</span>
        </Ayuda>
      ),
    },
    {
      valor: numero(zona.financiados),
      etiqueta: "asignados a lectura",
      contexto: zona.totalCola > 0 ? `${pctTxt(pFin)} de ${numero(zona.totalCola)}` : "ningún contrato en la cola",
    },
    {
      valor: numero(zona.procesados),
      etiqueta: "ya leídos",
      contexto: zona.financiados > 0 ? `de ${numero(zona.financiados)} asignados` : "ningún contrato asignado todavía",
    },
    {
      valor: numero(zona.senales),
      etiqueta: "con señales",
      contexto:
        zona.procesados > 0
          ? `de ${numero(zona.procesados)} leídos${enRevision > 0 ? `, ${numero(enRevision)} en revisión` : ""}`
          : "ningún contrato leído todavía",
      ayuda: (
        <Ayuda titulo="¿Qué cuenta “con señales”?">
          Contratos leídos con al menos una señal publicada. Los que están en revisión no cuentan hasta que una persona
          decida.
        </Ayuda>
      ),
    },
  ];
}

/** Una línea (la descripción de la sección): lo que se mueve ahora. Sin denominador inventado. */
function resumenVivo(items: Procesamiento[] | null): string | undefined {
  if (!items || items.length === 0) return undefined;
  // La consulta trae hasta 60 filas y no dice cuántas hay en total; sólo se cuenta lo que en
  // esa muestra es seguro.
  const enAnalisis = items.filter((p) => p.estado === "procesando").length;
  const resto = items.length > FILAS_VIVO ? "el resto, en «Ver en vivo»" : null;
  if (enAnalisis > 0) return `${plural(enAnalisis, "contrato en análisis", "contratos en análisis")} ahora${resto ? `; ${resto}` : ""}.`;
  return resto ? `Los que se mueven primero; ${resto}.` : undefined;
}

const COLUMNAS_VIVO: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "164px" },
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Valor referencial", ancho: "124px", alinear: "der", desde: "md" },
];

/**
 * El "en vivo" con la anatomía de fila de todo listado: estado (chip), el contrato y su entidad, el
 * valor y la flecha. Lo que se mueve primero; de a FILAS_VIVO, con buscador, sobre lo que trajo la
 * consulta (hasta 60). El tablero que se refresca solo vive en el panel "Ver en vivo".
 */
function VistaPreviaVivo({ items }: { items: Procesamiento[] | null }) {
  if (!items) {
    return <EstadoError titulo="No pudimos leer el avance">El tablero en vivo lo reintenta solo: ábrelo con «Ver en vivo».</EstadoError>;
  }
  if (items.length === 0) {
    return <p className="text-dato leading-5 text-inkSoft">Todavía no hay contratos asignados en esta zona.</p>;
  }
  const ordenados = [...items].sort((a, b) => PRIORIDAD[estadoVisible(a)] - PRIORIDAD[estadoVisible(b)]);
  const filas: Fila[] = ordenados.map((p) => ({
    id: p.ocid,
    href: rutaContrato(p.ocid, "vivo"),
    buscable: [p.titulo, p.entidad, p.ocid].filter(Boolean).join(" "),
    celdas: {
      estado: <EstadoPill estado={estadoVisible(p)} intentos={p.intentos} />,
      contrato: <CeldaPrincipal titulo={p.titulo ?? p.ocid} meta={[<Dato key="e" tipo="entidad">{p.entidad ?? "Entidad no identificada"}</Dato>]} />,
      monto: <CeldaNumero>{p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : "Sin dato"}</CeldaNumero>,
    },
  }));
  return (
    <TablaPaginada
      columnas={COLUMNAS_VIVO}
      filas={filas}
      tam={FILAS_VIVO}
      nombre="contratos"
      etiqueta="Contratos que se mueven ahora"
      buscar={{ placeholder: "Buscar un contrato o una entidad…", etiqueta: "Buscar en lo que se mueve ahora" }}
    />
  );
}
