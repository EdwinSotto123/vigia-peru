import { BarChart3, BookOpen, CheckCircle2, Hourglass, Radio } from "lucide-react";
import { canonica } from "@/lib/seo";
import { Ayuda, CabeceraPestana, EncabezadoPagina, Migas, Pagina, PestanaAPedido, Pestanas } from "@/components/patrones";
import { BarraFiltros, Listado, TablaSkeleton, ZonaResultados, type FiltroSecundario } from "@/components/listado";
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
import { LecturasAnteriores } from "@/components/auditoria/LecturasAnteriores";
import { SeccionEnUrl } from "@/components/auditoria/SeccionEnUrl";
import { cuentasAuditoria } from "@/components/auditoria/cuentasAuditoria";
import { OcultaEnPestanas } from "@/components/auditoria/OcultaEnPestanas";
import { LoQueFaltaLeer } from "@/components/financiar/LoQueFaltaLeer";
import { PARAM_BUSCAR, PARAM_PAG } from "@/components/financiar/rutaFalta";
import {
  DIAS_RITMO,
  getFinanciadoresProcesamientos,
  getProcesamiento,
  getProcesamientos,
  getProcesamientosPaginado,
  getRitmoProcesamientos,
  type Procesamiento,
} from "@/lib/auditoria";
import { getLecturaTotal } from "@/lib/auditoria";
import { LecturaTotalPanel } from "@/components/auditoria/LecturaTotalPanel";
import { getResumenVivo } from "@/lib/contratos";
import { getZona, getZonas } from "@/lib/financiamiento";
import { fechaCorta, hoyLima } from "@/lib/formato";
import { VistasComoTrabaja } from "@/components/sitio/VistasSeccion";

export const metadata = {
  title: "Auditoría en vivo",
  // El recuento sale del catálogo, nunca de una cadena escrita a mano: el producto llegó a
  // afirmar cinco números distintos de agentes en páginas que el mismo usuario visita seguidas.
  description:
    `Mira en tiempo real cómo cada contrato público financiado pasa de la cola al análisis de ${TOTAL_AGENTES} agentes en ${TOTAL_PASOS} pasos, y al dictamen con señales de riesgo.`,
  alternates: canonica("/app/auditoria"),
};

export const revalidate = 10;

const FECHA_RX = /^\d{4}-\d{2}-\d{2}$/;

/** Filas del tablero en vivo por consulta (el máximo del API). */
const LIMITE_VIVO = 300;

/** Las pestañas del Tablero (§14.3). La primera no va a la URL. `falta` es «Lo que falta leer» (antes /app/financiar). */
const SECCIONES = ["curso", "leidos", "actividad", "como-funciona", "falta"] as const;
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

/** El esqueleto de «Lo que falta leer» mientras se pide: la tabla de zonas (zona y en cola). */
const COLUMNAS_ESPERA = [
  { clave: "zona", titulo: "Zona", ancho: "minmax(0,2fr)" },
  { clave: "cola", titulo: "En cola", ancho: "96px", alinear: "der" as const },
];

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
 *
 * «Lo que falta leer» (`?seccion=falta`) era la página /app/financiar, con su propia entrada del menú (auditoría visual
 * del 2026-11-13: «Financiar dentro de Auditoría en vivo»; /app/financiar redirige aquí). Es la cola vista por región,
 * entidad o partido, con sus propios filtros (`por`, `buscar`, `pag`, `anio`, `region`, `orden`): se arma sólo cuando se
 * abre (`PestanaAPedido`) y la barra de filtros de la auditoría se esconde mientras está abierta (`OcultaEnPestanas`).
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
  const pedida = leer("seccion");
  // Un enlace viejo a /app/financiar llega con su búsqueda y su página en `q` y `pagina` (next.config.js): en la
  // pestaña de lo que falta leer son las suyas, no las de la auditoría.
  const falta = pedida === "falta";
  const legadoFalta = falta && !leer(PARAM_BUSCAR) && !leer(PARAM_PAG);
  const qTexto = legadoFalta ? undefined : leer("q")?.trim();
  const q = qTexto && qTexto.length >= 2 ? qTexto.slice(0, 80) : undefined;
  const paginaActual = Math.max(1, Number.parseInt((legadoFalta ? undefined : leer("pagina")) ?? "1", 10) || 1);
  const filtros: FiltrosAuditoria = { ubigeo, desde, hasta, financiador, q };
  const histQuery = { ...filtros, estado: "procesado" as const };

  const [resumen, zonas, initialCompleto, historicoCompleto, financiadores, ultimo, ritmo, nombreSubzona, lectura] = await Promise.all([
    getResumenVivo(),
    getZonas("departamento"),
    // El tablero en vivo obedece los mismos filtros que lo ya leído (zona, fecha, quién pagó), y sólo
    // trae lo que no terminó: lo leído vive en su pestaña (antes viajaban ~380 KB de filas sin dibujar).
    getProcesamientos({ ...filtros, estado: "activos", limit: LIMITE_VIVO }),
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
    // Todo lo leído (financiados y análisis masivo) y lo que costó: antes la página sólo contaba los financiados.
    getLecturaTotal(),
  ]);
  const initial = initialCompleto ? sinFasesInactivas(initialCompleto) : null;
  const historico = historicoCompleto ? { ...historicoCompleto, data: sinFasesInactivas(historicoCompleto.data ?? []) } : null;
  const hayFiltros = !!(ubigeo || desde || hasta || financiador || q);
  const departamento = ubigeo && ubigeo.length === 2 ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;
  const zonaNombre = ubigeo ? departamento?.nombre ?? nombreSubzona ?? undefined : undefined;

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

  // ── La pestaña con que abre: la pedida; un enlace viejo con `?pagina=` (antes lo leído iba abajo, sin pestañas), Ya
  // leídos; y sin nada pedido, la primera con contenido: con «En curso 0» (lo normal: una corrida dura minutos y entre
  // corridas pasan horas) abría en una pestaña vacía. Sólo al llegar sin filtros: con filtros se queda en En curso, así
  // filtrar no cambia de pestaña a quien ya está mirando una.
  const seccion: SeccionAuditoria = esSeccion(pedida)
    ? pedida
    : paginaActual > 1 || (!hayFiltros && conteoEnCurso === 0 && (historico?.total ?? 0) > 0)
      ? "leidos"
      : "curso";

  // ── La región, a la vista (un desplegable, como en los demás listados; antes chips con el nombre «Zona»). Sólo las
  // que tienen financiados (las demás llevan a cero); el conteo es de financiados, cola + leídos, y sólo vale sin los
  // otros filtros puestos.
  const sinOtros = !desde && !hasta && !financiador && !q;
  // En un desplegable se busca por nombre: de la A a la Z.
  const conFinanciados = (zonas ?? []).filter((z) => z.financiados > 0).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  const opcionesZona: FiltroSecundario["opciones"] = conFinanciados.map((z) => ({
    valor: z.ubigeo,
    etiqueta: z.nombre,
    conteo: sinOtros ? z.financiados : undefined,
  }));
  if (ubigeo && !opcionesZona.some((o) => o.valor === ubigeo)) {
    opcionesZona.push({ valor: ubigeo, etiqueta: zonaNombre ?? `Ubigeo ${ubigeo}`, conteo: sinOtros && departamento ? departamento.financiados : undefined });
  }

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
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Auditoría en vivo", href: "/app/auditoria" }]} />
      {/* Esta pantalla es un tablero: se entra a MIRAR, no a leer una introducción. El método
          está en su pestaña; el ⓘ lo resume en dos oraciones. */}
      <EncabezadoPagina
        titulo="Auditoría en vivo"
        bajada="Cuánto leyó Vigía, cuánto costó leerlo y, uno por uno, los contratos financiados por aportes: de la cola al dictamen, en orden de antigüedad."
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
          // La única invitación a aportar de la página: la lectura se paga con el fondo común.
          <EnlaceAccion variante="secundario" href="/app/apoyar" flecha>
            Ayúdanos a seguir vigilando
          </EnlaceAccion>
        }
      />
      <VistasComoTrabaja activa="auditoria" />

      {lectura && !hayFiltros && <LecturaTotalPanel datos={lectura} />}

      <ResumenAuditoria initial={resumen} ritmoInicial={ritmo} pollMs={5000}>
        <div className="space-y-6">
          {/* El título y sus cifras en una tarjeta (2026-11-23, el usuario: «secciones que son solo texto sin fondo o forma»):
              antes el h2 flotaba solo sobre el fondo de la página. */}
          <section aria-labelledby="financiados-t" className="tarjeta space-y-4 rounded-2xl border border-line bg-paper p-4 sm:p-5">
            <h2 id="financiados-t" className="font-display text-seccion font-bold leading-tight text-ink">
              Financiados por aportes, uno por uno
            </h2>
            <EstadoAuditoria />
          </section>

          <Listado
            ruta="/app/auditoria"
            parametros={{ ...filtros, seccion: seccion === "curso" ? undefined : seccion, pagina: paginaActual > 1 ? String(paginaActual) : undefined }}
          >
            <div className="space-y-4">
              <OcultaEnPestanas inicial={seccion} ocultarEn={["falta"]}>
                <BarraFiltros
                  busqueda={{ param: "q", placeholder: "Buscar qué se contrata, una entidad o un código…", etiqueta: "Buscar en la auditoría", min: 2 }}
                  visibles={[{ param: "ubigeo", etiqueta: "Región", corta: "Región", todas: "Todo el Perú", opciones: opcionesZona }]}
                  filtros={filtrosSecundarios}
                />
              </OcultaEnPestanas>

              {!esSeccion(pedida) && seccion !== "curso" && <SeccionEnUrl clave={seccion} />}
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
                        {/* El h2 lo pone CabeceraPestana (antes había otro oculto); la ⓘ dice lo que la bajada no dice. */}
                        <CabeceraPestana
                          ayuda={
                            <Ayuda titulo="¿Cuándo entra un contrato aquí?">
                              Cuando le toca su lectura: lo más grave va primero. Antes de su turno espera sus documentos del SEACE.
                            </Ayuda>
                          }
                        >
                          Lo que se lee ahora y lo que espera su turno.
                        </CabeceraPestana>
                        {/* Cada pestaña se ve sola: el vacío de esta lleva su llamita (§2.4, una por pantalla). */}
                        <ZonaResultados>
                          <TableroAuditoria
                            key={[ubigeo, desde, hasta, financiador, q].map((v) => v ?? "").join("|")}
                            ubigeo={ubigeo}
                            desde={desde}
                            hasta={hasta}
                            financiador={financiador}
                            q={q}
                            initial={initial}
                            initialVersion={resumen?.version ?? null}
                            autoRefreshMs={5000}
                            enPestanas
                            soloActivos
                            hayLeidos={(historico?.total ?? 0) > 0}
                            conLlamita
                            panelSecundario={
                              <div className="space-y-4">
                                <UltimoAnalisis p={ultimo} hayFiltros={hayFiltros} />
                                <LecturasAnteriores
                                  items={(historico?.data ?? []).filter((x) => x.ocid !== ultimo?.ocid).slice(0, 5)}
                                  total={historico?.total ?? null}
                                />
                              </div>
                            }
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
                        <ZonaResultados>
                          <HistoricoProcesados
                            pagina={historico}
                            paginaActual={paginaActual}
                            filtros={filtros}
                            conFinanciador={conPatrocinador}
                            seccion="leidos"
                            cabecera={{
                              texto: "Cada contrato financiado cuyo análisis terminó.",
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
                      <ActividadAuditoria />
                    ),
                  },
                  {
                    clave: "como-funciona",
                    etiqueta: "Cómo funciona",
                    icono: <BookOpen size={15} aria-hidden />,
                    contenido: (
                      <ComoFunciona />
                    ),
                  },
                  {
                    clave: "falta",
                    etiqueta: "Lo que falta leer",
                    icono: <Hourglass size={15} aria-hidden />,
                    // Pesada (zonas, entidades o partidos, con sus cifras): sólo se arma abierta. Si no, al abrirla se pide la
                    // página con `?seccion=falta` y mientras tanto se ve su esqueleto.
                    contenido: falta ? (
                      <LoQueFaltaLeer
                        filtros={{
                          por: leer("por"),
                          buscar: leer(PARAM_BUSCAR) ?? (legadoFalta ? leer("q") : undefined),
                          pag: leer(PARAM_PAG) ?? (legadoFalta ? leer("pagina") : undefined),
                          anio: leer("anio"),
                          region: leer("region"),
                          orden: leer("orden"),
                        }}
                      />
                    ) : (
                      <PestanaAPedido clave="falta">
                        <TablaSkeleton columnas={COLUMNAS_ESPERA} />
                      </PestanaAPedido>
                    ),
                  },
                  // Cada pestaña en su tarjeta, con su título adentro: antes su h2 y su lista iban sueltos sobre el fondo.
                ].map((p) => ({ ...p, contenido: <div className="tarjeta rounded-2xl border border-line bg-paper p-4 sm:p-5">{p.contenido}</div> }))}
              />
            </div>
          </Listado>
        </div>
      </ResumenAuditoria>
    </Pagina>
  );
}
