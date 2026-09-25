import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Activity, ChevronRight, Radio, ShieldCheck } from "lucide-react";
import { ContribuirForm } from "@/components/financiar/ContribuirForm";
import { Avatar } from "@/components/financiar/RankingTable";
import { ListaZonas } from "@/components/financiar/ListaZonas";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Revelar } from "@/components/ui/Revelar";
import { CabeceraPestana, Ayuda, EncabezadoPagina, EstadoError, Pagina, Pestanas, type Pestana } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, Indicadores, Tabla, type Columna, type Fila, type Indicador } from "@/components/listado";
import { TarjetaConfirmacion } from "@/components/financiar/TarjetaConfirmacion";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { EstadoPill } from "@/components/auditoria/EstadoPill";
import { ESTADO_LABEL, ESTADO_PUNTO, TIPO_FINANCIADOR_LABEL, alcanceLargo, getPago, getZona, type ZonaDetalle } from "@/lib/financiamiento";
import { numero, plural, porcentaje, soles, solesCompacto } from "@/lib/formato";
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

/**
 * Ficha de una zona para financiar su lectura (plantilla de conversión, §14). Una sola
 * pregunta: ¿cuántos contratos de esta zona quieres que se lean?
 *
 *   identidad · Indicadores (en cola y su costo, financiados, leídos, con señales)
 *   [ lo que hace falta para decidir ]   [ el formulario, a la derecha ]
 *     pestañas (§14.3): Qué hay en la cola | En vivo | Provincias | Quién financió
 *
 * Esos cuatro bloques antes se apilaban y el último quedaba a varias pantallas del
 * formulario: ahora se pasa de uno a otro con un clic, sin salir de la zona.
 *
 * El formulario va primero en el celular (se llega desde "Financiar esta zona") y pegado
 * a la derecha desde `xl`: entre 1024 y 1280 px, con la barra lateral, la columna de
 * datos quedaba en ~220 px y las tablas no cabían.
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
  const metodos = pago ? [pago.yape && "yape", pago.plin && "plin", ...pago.cuentas.map((c) => c.banco)].filter(Boolean) as string[] : [];
  // Una sola base para "en cola" en toda la página: lo que nadie financió todavía (`pendientes`).
  // `totalCola` = pendientes + financiados; usarlo como "en cola" hacía que la misma zona dijera
  // 604 arriba y 594 en el formulario.
  const enCola = zona.pendientes;
  const padre = breadcrumb.length > 1 ? breadcrumb[breadcrumb.length - 2] : null;

  return (
    <Pagina className="space-y-6">
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
        <section
          aria-label={`Financiar la lectura de ${zona.nombre}`}
          className="order-first w-full max-w-2xl xl:order-last xl:sticky xl:top-6 xl:max-w-none xl:self-start"
          id="aportar"
        >
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

const ENLACE_PESTANA = "inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline";

/**
 * Lo que hace falta para decidir, en pestañas: la cola (el resumen), el avance en vivo, las
 * zonas hijas y quién ya financió. Cada una con su conteo, salvo la primera (lo que espera ya
 * tiene su cifra arriba, en los Indicadores). Provincias o distritos, sólo si la zona los tiene.
 */
function pestanasZona(d: ZonaDetalle, enVivo: Procesamiento[] | null): Pestana[] {
  const { zona, hijas, aliados, cola } = d;
  const nombreHijas = zona.nivel === "departamento" ? "Provincias" : "Distritos";
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
            Se leen en orden de llegada.
            <Ayuda titulo="¿Quién elige qué se lee?">
              Los contratos son públicos y puedes verlos, pero se leen en orden de llegada: quien financia no elige cuáles.
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
                  descripcion="Cada contrato financiado, de la cola a la lectura. Se actualiza solo."
                  etiqueta={`Abrir el tablero en vivo de ${zona.nombre}`}
                  ancho="lg"
                  className="inline-flex min-h-[24px] w-auto items-center gap-1 text-[13px] font-medium text-granate hover:underline"
                  detalle={<TableroAuditoria ubigeo={zona.ubigeo} autoRefreshMs={8000} limit={60} initial={enVivo} compacto />}
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
              {resumenVivo(enVivo) ?? "Cada contrato financiado, de la cola a la lectura."}
            </CabeceraPestana>
            <VistaPreviaVivo items={enVivo} />
          </>
        ) : (
          <p className="flex items-center gap-1.5 text-sm text-inkSoft">
            <Activity size={15} className="shrink-0 text-mute" aria-hidden />
            Cuando alguien financie esta zona, verás aquí cada contrato pasar a la lectura.
          </p>
        ),
    },
  ];
  // Zonas hijas: la misma tabla que la lista de /app/financiar.
  if (hijas.length > 0) {
    pestanas.push({
      clave: "zonas",
      etiqueta: nombreHijas,
      conteo: hijas.length,
      contenido: <ListaZonas zonas={hijas} precioPen={zona.precioPen} etiqueta={`${nombreHijas} de ${zona.nombre}`} />,
    });
  }
  // Aliados: reconocimiento en contratos, nunca en soles.
  pestanas.push({
    clave: "aliados",
    etiqueta: "Quién financió",
    conteo: aliados.length,
    contenido: aliados.length ? (
      <Tabla columnas={COLUMNAS_ALIADOS} filas={filasAliados(aliados)} etiqueta={`Quién financió la lectura en ${zona.nombre}`} />
    ) : (
      <p className="text-sm text-inkSoft">Nadie ha financiado la lectura de {zona.nombre} todavía.</p>
    ),
  });
  return pestanas;
}

/**
 * Las cifras de la zona (§10.7): antes eran una línea gris con seis números y una barra.
 * "En cola" lleva su costo de contexto; "financiados leídos" y no "leídos" (§10.1: aquí
 * se cuentan sólo los que alguien financió).
 */
function indicadoresZona({ zona, alcance }: ZonaDetalle): Indicador[] {
  const enRevision = zona.enRevision ?? 0;
  const pFin = zona.totalCola > 0 ? Math.min(100, (zona.financiados / zona.totalCola) * 100) : 0;
  return [
    {
      valor: numero(zona.pendientes),
      etiqueta: "en cola",
      contexto: `${soles(zona.pendientes * zona.precioPen)} leerlos, a ${soles(zona.precioPen)} cada uno`,
      ayuda: (
        <Ayuda titulo="¿Qué entra a la cola?">
          <span className="block">{alcanceLargo(alcance)}</span>
          <span className="mt-2 block text-mute">La zona es la sede de la entidad que contrata.</span>
        </Ayuda>
      ),
    },
    {
      valor: numero(zona.financiados),
      etiqueta: "financiados",
      contexto: zona.totalCola > 0 ? `${pctTxt(pFin)} de ${numero(zona.totalCola)}` : "ningún contrato en la cola",
    },
    {
      valor: numero(zona.procesados),
      etiqueta: "financiados leídos",
      contexto: zona.financiados > 0 ? `de ${numero(zona.financiados)} financiados` : "ningún contrato financiado todavía",
    },
    {
      valor: numero(zona.senales),
      etiqueta: "con señales",
      contexto:
        zona.procesados > 0
          ? `de ${numero(zona.procesados)} leídos${enRevision > 0 ? ` · ${numero(enRevision)} en revisión` : ""}`
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
 * Vista previa del "en vivo" con la anatomía de fila de todo listado —estado (chip) ·
 * el contrato y su entidad · el valor · ›—. El tablero completo (hasta 60 contratos que
 * se refrescan solos) vive en el panel "Ver en vivo".
 */
function VistaPreviaVivo({ items }: { items: Procesamiento[] | null }) {
  if (!items) {
    return <EstadoError titulo="No pudimos leer el avance">El tablero en vivo lo reintenta solo: ábrelo con «Ver en vivo».</EstadoError>;
  }
  if (items.length === 0) {
    return <p className="text-sm text-inkSoft">Todavía no hay contratos asignados en esta zona.</p>;
  }
  const visibles = [...items].sort((a, b) => PRIORIDAD[estadoVisible(a)] - PRIORIDAD[estadoVisible(b)]).slice(0, FILAS_VIVO);
  const filas: Fila[] = visibles.map((p) => ({
    id: p.ocid,
    href: `/app/auditoria/${encodeURIComponent(p.ocid)}`,
    celdas: {
      estado: <EstadoPill estado={estadoVisible(p)} intentos={p.intentos} />,
      contrato: <CeldaPrincipal titulo={p.titulo ?? p.ocid} meta={p.entidad ?? "Entidad no identificada"} />,
      monto: <CeldaNumero>{p.montoPen != null && p.montoPen > 0 ? soles(p.montoPen) : "Sin dato"}</CeldaNumero>,
    },
  }));
  return <Tabla columnas={COLUMNAS_VIVO} filas={filas} etiqueta="Contratos que se mueven ahora" />;
}

const COLUMNAS_ALIADOS: Columna[] = [
  { clave: "aliado", titulo: "Aliado", ancho: "minmax(0,1fr)" },
  { clave: "contratos", titulo: "Financiados", ancho: "112px", alinear: "der" },
];

/** Reconocimiento en contratos, nunca en soles. La fila va a su ficha cuando tiene una. */
function filasAliados(aliados: ZonaDetalle["aliados"]): Fila[] {
  return aliados.map((a) => ({
    id: `${a.slug ?? a.nombre}-${a.contratos}`,
    href: a.slug ? `/aliado/${a.slug}` : undefined,
    celdas: {
      aliado: (
        <span className="flex w-full min-w-0 items-center gap-3">
          <Avatar tipo={a.tipo} logoUrl={a.logoUrl} nombre={a.nombre} />
          <CeldaPrincipal titulo={a.nombre} meta={a.slug === "vigia-peru" ? "La propia plataforma" : TIPO_FINANCIADOR_LABEL[a.tipo]} />
        </span>
      ),
      contratos: <CeldaNumero>{numero(a.contratos)}</CeldaNumero>,
    },
  }));
}
