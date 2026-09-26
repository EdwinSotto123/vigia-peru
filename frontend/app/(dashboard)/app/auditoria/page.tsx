import { BarChart3, BookOpen, CheckCircle2, Radio } from "lucide-react";
import { Ayuda, CabeceraPestana, EncabezadoPagina, Pagina, Pestanas } from "@/components/patrones";
import { BarraFiltros, Listado, ZonaResultados, type FiltroSecundario, type OpcionFaceta } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { PulseDot } from "@/components/ui/PulseDot";
import { TOTAL_AGENTES, TOTAL_PASOS } from "@/components/agentes/catalogo";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { HistoricoProcesados, TAM_HISTORICO, type FiltrosAuditoria } from "@/components/auditoria/HistoricoProcesados";
import { ResumenAuditoria } from "@/components/auditoria/ResumenAuditoria";
import { EstadoAuditoria } from "@/components/auditoria/EstadoAuditoria";
import { ActividadAuditoria } from "@/components/auditoria/ActividadAuditoria";
import { ComoFunciona } from "@/components/auditoria/ComoFunciona";
import { UltimoAnalisis } from "@/components/auditoria/UltimoAnalisis";
import { cuentasAuditoria } from "@/components/auditoria/cuentasAuditoria";
import {
  DIAS_RITMO,
  getFinanciadoresProcesamientos,
  getProcesamiento,
  getProcesamientos,
  getProcesamientosPaginado,
  getRitmoProcesamientos,
  type Procesamiento,
} from "@/lib/auditoria";
import { getResumenVivo } from "@/lib/contratos";
import { getZona, getZonas } from "@/lib/financiamiento";
import { fechaCorta, hoyLima } from "@/lib/formato";

export const metadata = {
  title: "Auditoría en vivo",
  // El recuento sale del catálogo, nunca de una cadena escrita a mano: el producto llegó a
  // afirmar cinco números distintos de agentes en páginas que el mismo usuario visita seguidas.
  description:
    `Mira en tiempo real cómo cada contrato público financiado pasa de la cola al análisis de ${TOTAL_AGENTES} agentes en ${TOTAL_PASOS} pasos, y al dictamen con señales de riesgo.`,
};

export const revalidate = 10;

const FECHA_RX = /^\d{4}-\d{2}-\d{2}$/;

/** Filas del tablero en vivo por consulta (el máximo del API). */
const LIMITE_VIVO = 300;

/** Las pestañas del Tablero (§14.3). La primera no va a la URL. */
const SECCIONES = ["curso", "leidos", "actividad", "como-funciona"] as const;
type SeccionAuditoria = (typeof SECCIONES)[number];
const esSeccion = (s: string | undefined): s is SeccionAuditoria => !!s && (SECCIONES as readonly string[]).includes(s);

/** Los rangos que la gente pide de verdad, sobre la fecha de entrada a la cola. */
const RANGOS: [number, string][] = [
  [7, "Últimos 7 días"],
  [30, "Últimos 30 días"],
  [90, "Últimos 3 meses"],
  [365, "Último año"],
];

/** "2026-09-25" menos `dias` días, sin zona que desfasar (mediodía UTC). */
function restarDias(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12) - dias * 86_400_000).toISOString().slice(0, 10);
}

/**
 * `fases` (el estado por agente, ~1 KB por fila) sólo se dibuja en las filas que están
 * "procesando". En las demás cruzaba al navegador sin usarse: 110 de los 177 KB del tablero.
 * Se quita antes de pasarlas al client component; el primer sondeo trae las filas completas.
 */
function sinFasesInactivas(ps: Procesamiento[]): Procesamiento[] {
  return ps.map((p) => (p.estado === "procesando" || p.fases == null ? p : { ...p, fases: null }));
}

/** Lo que todavía no terminó: en análisis + en espera (el `revision` crudo no existe, pero se cubre). */
const enCurso = (p: Procesamiento) => p.estado !== "procesado" && p.estado !== "revision";

/**
 * /app/auditoria — la plantilla Tablero (DESIGN_SYSTEM.md §14) en pestañas (§14.3). Antes todo
 * iba apilado: cifras, barra del ciclo, barras por día, "ahora mismo", la cola y lo ya leído,
 * una sección debajo de otra. Ahora:
 *
 *   encabezado · Indicadores · una línea de "ahora"          (todo el Perú)
 *   BarraFiltros (zona)                                        ← acota las pestañas
 *   Pestanas  En curso | Ya leídos | Actividad | Cómo funciona
 *
 * Las cifras quedan arriba y FUERA del `Listado`: hablan de todo el Perú (el resumen no
 * acepta filtros) y lo dicen en su ⓘ. La barra de filtros va justo encima de las pestañas y
 * acota En curso y Ya leídos; Actividad es nacional y lo dice en su primera línea.
 *
 * Un solo sondeo del resumen para la página (`ResumenAuditoria`): lo leen las cifras de
 * arriba y la pestaña Actividad. El tablero en vivo hace su propio sondeo, pero no guarda
 * filtros: los recibe como props y se vuelve a montar (`key`) cuando la URL cambia.
 *
 * `?seccion=` abre una pestaña; la paginación de Ya leídos la conserva en cada enlace.
 */
export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  const leer = (k: string) => {
    const v = searchParams?.[k];
    return (Array.isArray(v) ? v[0] : v) || undefined;
  };
  const ubigeo = leer("ubigeo") && /^\d{2,6}$/.test(leer("ubigeo")!) ? leer("ubigeo") : undefined;
  const desde = leer("desde") && FECHA_RX.test(leer("desde")!) ? leer("desde") : undefined;
  const hasta = leer("hasta") && FECHA_RX.test(leer("hasta")!) ? leer("hasta") : undefined;
  const financiador = leer("financiador")?.trim().slice(0, 120) || undefined;
  const paginaActual = Math.max(1, Number.parseInt(leer("pagina") ?? "1", 10) || 1);
  const pedida = leer("seccion");
  // Un enlace viejo con `?pagina=` (antes lo leído iba abajo, sin pestañas) abre en Ya leídos.
  const seccion: SeccionAuditoria = esSeccion(pedida) ? pedida : paginaActual > 1 ? "leidos" : "curso";
  const filtros: FiltrosAuditoria = { ubigeo, desde, hasta, financiador };
  const histQuery = { ...filtros, estado: "procesado" as const };

  const [resumen, zonas, initialCompleto, historicoCompleto, financiadores, ultimo, ritmo, nombreSubzona] = await Promise.all([
    getResumenVivo(),
    getZonas("departamento"),
    // El tablero en vivo obedece los mismos filtros que lo ya leído (zona, fecha, quién pagó).
    getProcesamientos({ ...filtros, limit: LIMITE_VIVO }),
    getProcesamientosPaginado({ ...histQuery, limit: TAM_HISTORICO, offset: (paginaActual - 1) * TAM_HISTORICO }),
    getFinanciadoresProcesamientos(),
    // El último análisis terminado CON LOS FILTROS PUESTOS: es lo que se muestra cuando no
    // hay nada en análisis, que es el estado normal de esta pantalla. Su detalle (con la
    // bitácora, que permite repetir la corrida) se encadena acá mismo, no en serie después.
    getProcesamientos({ ...histQuery, limit: 1 }).then((ref) => (ref?.[0]?.ocid ? getProcesamiento(ref[0].ocid) : null)),
    // Ritmo real (todo el Perú, como los Indicadores): análisis terminados por día, contados en
    // SQL (`/ritmo`; con la API vieja, sobre la lista con tope y marcado parcial).
    getRitmoProcesamientos(DIAS_RITMO),
    // Los enlaces del mapa pueden traer una provincia o un distrito: su nombre, para el chip y el título.
    ubigeo && ubigeo.length > 2 ? getZona(ubigeo).then((z) => z?.zona.nombre ?? null) : Promise.resolve(null),
  ]);
  const initial = initialCompleto ? sinFasesInactivas(initialCompleto) : null;
  const historico = historicoCompleto ? { ...historicoCompleto, data: sinFasesInactivas(historicoCompleto.data ?? []) } : null;
  const hayFiltros = !!(ubigeo || desde || hasta || financiador);
  const departamento = ubigeo && ubigeo.length === 2 ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;
  const zonaNombre = ubigeo ? departamento?.nombre ?? nombreSubzona ?? undefined : undefined;
  const donde = zonaNombre ? `en ${zonaNombre}` : "en todo el Perú";

  // ── Conteo de la pestaña En curso. Si la consulta del tablero vino entera, se cuenta sobre
  // ella (respeta los filtros); si vino cortada, sólo el resumen sabe el total, y sólo sin
  // filtros. Si no, sin número: mejor nada que un conteo corto.
  const cuentas = resumen ? cuentasAuditoria(resumen) : null;
  const conteoEnCurso =
    initialCompleto == null
      ? null
      : initialCompleto.length < LIMITE_VIVO
        ? initialCompleto.filter(enCurso).length
        : !hayFiltros && cuentas
          ? cuentas.procesando + cuentas.enEspera
          : null;
  // El punto pulsante sólo cuando hay algo en análisis de verdad (§ honestidad del "en vivo").
  const hayAnalisis = (initialCompleto ?? []).some((p) => p.estado === "procesando");

  // ── Faceta principal: la zona. Sólo las que tienen financiados (las demás llevan a cero);
  // el conteo es de financiados, cola + leídos, y sólo vale sin los otros filtros puestos.
  const sinOtros = !desde && !hasta && !financiador;
  const conFinanciados = (zonas ?? [])
    .filter((z) => z.financiados > 0)
    .sort((a, b) => b.financiados - a.financiados || a.nombre.localeCompare(b.nombre, "es"));
  const opcionesZona: OpcionFaceta[] = conFinanciados.map((z) => ({
    valor: z.ubigeo,
    etiqueta: z.nombre,
    conteo: sinOtros ? z.financiados : undefined,
  }));
  if (ubigeo && !opcionesZona.some((o) => o.valor === ubigeo)) {
    opcionesZona.push({ valor: ubigeo, etiqueta: zonaNombre ?? `Ubigeo ${ubigeo}`, conteo: sinOtros && departamento ? departamento.financiados : undefined });
  }
  const conteoTodas = sinOtros && zonas ? conFinanciados.reduce((s, z) => s + z.financiados, 0) : undefined;

  // ── Filtros secundarios. La fecha: los cuatro rangos, calculados sobre el día de Lima; un
  // `desde` que no es ninguno (un enlace de otro día) se nombra, no queda como fecha cruda.
  const hoy = hoyLima();
  const opcionesFecha = RANGOS.map(([dias, etiqueta]) => ({ valor: restarDias(hoy, dias), etiqueta }));
  if (desde && !opcionesFecha.some((o) => o.valor === desde)) opcionesFecha.push({ valor: desde, etiqueta: `Desde el ${fechaCorta(desde)}` });
  // Un selector con una sola opción no filtra nada: quién pagó, sólo si hay a quién elegir (o si ya hay uno puesto).
  const conPatrocinador = financiadores.length > 1 || !!financiador;
  const filtrosSecundarios: FiltroSecundario[] = [
    { param: "desde", etiqueta: "Entró a la cola", todas: "Cualquier fecha", opciones: opcionesFecha },
    // `hasta` ya no se elige acá (el rango a medida salió), pero un enlace puede traerlo: se ve y se quita.
    ...(hasta ? [{ param: "hasta", etiqueta: "Hasta", todas: "Sin fecha límite", opciones: [{ valor: hasta, etiqueta: fechaCorta(hasta) }] }] : []),
    ...(conPatrocinador
      ? [
          {
            param: "financiador",
            etiqueta: "Lo pagó",
            todas: "Cualquiera",
            opciones: financiadores.map((f) => ({ valor: f.nombre, etiqueta: f.nombre, conteo: !ubigeo && !desde && !hasta ? f.n : undefined })),
          },
        ]
      : []),
  ];

  return (
    <Pagina>
      {/* Esta pantalla es un tablero: se entra a MIRAR, no a leer una introducción. El método
          está en su pestaña; el ⓘ lo resume en dos oraciones. */}
      <EncabezadoPagina
        titulo="Auditoría en vivo"
        bajada="Cada contrato financiado, de la cola al dictamen, en orden de antigüedad: nadie elige cuál se lee."
        ayuda={
          <Ayuda titulo="¿Cómo se lee un contrato?">
            <span className="block">
              {TOTAL_AGENTES} agentes lo leen en {TOTAL_PASOS} pasos y cada señal cita su norma y su evidencia. Se publica aunque
              señale a quien pagó la lectura.
            </span>
            <span className="mt-2 block text-mute">Paso por paso, en la pestaña Cómo funciona.</span>
          </Ayuda>
        }
        acciones={
          // La única invitación a financiar de la página: una zona entra aquí en cuanto alguien paga su lectura.
          <EnlaceAccion variante="secundario" href="/app/financiar" flecha>
            Financiar una auditoría
          </EnlaceAccion>
        }
      />

      <ResumenAuditoria initial={resumen} ritmoInicial={ritmo} pollMs={5000}>
        <div className="space-y-6">
          <EstadoAuditoria />

          <Listado
            ruta="/app/auditoria"
            parametros={{ ...filtros, seccion: seccion === "curso" ? undefined : seccion, pagina: paginaActual > 1 ? String(paginaActual) : undefined }}
          >
            <div className="space-y-4">
              <BarraFiltros
                faceta={{ param: "ubigeo", etiqueta: "Zona", todas: "Todo el Perú", conteoTodas, opciones: opcionesZona }}
                filtros={filtrosSecundarios}
              />

              <Pestanas
                etiqueta="Secciones de la auditoría en vivo"
                activa={seccion}
                pestanas={[
                  {
                    clave: "curso",
                    etiqueta: "En curso",
                    conteo: conteoEnCurso,
                    icono: hayAnalisis ? <PulseDot color="amber" size={7} /> : <Radio size={15} aria-hidden />,
                    contenido: (
                      <>
                        <h2 className="sr-only">En curso {donde}</h2>
                        <CabeceraPestana
                          ayuda={
                            <Ayuda titulo="¿Cuándo entra un contrato aquí?">
                              En cuanto se confirma el aporte que financia su zona. Espera sus documentos del SEACE y luego su turno,
                              por antigüedad: nadie elige cuál va primero.
                            </Ayuda>
                          }
                        >
                          Lo que se lee ahora y lo que espera turno, {donde}.
                        </CabeceraPestana>
                        {/* Cada pestaña se ve sola: el vacío de esta lleva su llamita (§2.4, una por pantalla). */}
                        <ZonaResultados>
                          <TableroAuditoria
                            key={[ubigeo, desde, hasta, financiador].map((v) => v ?? "").join("|")}
                            ubigeo={ubigeo}
                            desde={desde}
                            hasta={hasta}
                            financiador={financiador}
                            initial={initial}
                            initialVersion={resumen?.version ?? null}
                            autoRefreshMs={5000}
                            enPestanas
                            conLlamita
                            panelSecundario={<UltimoAnalisis p={ultimo} hayFiltros={hayFiltros} />}
                          />
                        </ZonaResultados>
                      </>
                    ),
                  },
                  {
                    clave: "leidos",
                    etiqueta: "Ya leídos",
                    conteo: historico?.total ?? null,
                    icono: <CheckCircle2 size={15} aria-hidden />,
                    contenido: (
                      <>
                        <h2 className="sr-only">Ya leídos {donde}</h2>
                        <ZonaResultados>
                          <HistoricoProcesados
                            pagina={historico}
                            paginaActual={paginaActual}
                            filtros={filtros}
                            conFinanciador={conPatrocinador}
                            seccion="leidos"
                            cabecera={{
                              texto: `Cada contrato financiado cuyo análisis terminó, ${donde}.`,
                              ayuda: (
                                <Ayuda titulo="¿Qué entra aquí?">
                                  Con su resultado y quién pagó esa lectura. Incluye los que están en revisión: se leyeron enteros, pero su
                                  dictamen todavía no se publica.
                                </Ayuda>
                              ),
                            }}
                          />
                        </ZonaResultados>
                      </>
                    ),
                  },
                  {
                    clave: "actividad",
                    etiqueta: "Actividad",
                    icono: <BarChart3 size={15} aria-hidden />,
                    contenido: (
                      <>
                        <h2 className="sr-only">Actividad de la auditoría en todo el Perú</h2>
                        <ActividadAuditoria />
                      </>
                    ),
                  },
                  {
                    clave: "como-funciona",
                    etiqueta: "Cómo funciona",
                    icono: <BookOpen size={15} aria-hidden />,
                    contenido: (
                      <>
                        <h2 className="sr-only">Cómo se lee un contrato</h2>
                        <ComoFunciona />
                      </>
                    ),
                  },
                ]}
              />
            </div>
          </Listado>
        </div>
      </ResumenAuditoria>
    </Pagina>
  );
}
