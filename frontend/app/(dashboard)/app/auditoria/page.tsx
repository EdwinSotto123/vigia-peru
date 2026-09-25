import { Ayuda, EncabezadoPagina, Pagina, Seccion } from "@/components/patrones";
import { BarraFiltros, Listado, ZonaResultados, type FiltroSecundario, type OpcionFaceta } from "@/components/listado";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { PASOS, TOTAL_AGENTES, TOTAL_PASOS, porCarril } from "@/components/agentes/catalogo";
import { TableroAuditoria } from "@/components/auditoria/TableroAuditoria";
import { HistoricoProcesados, TAM_HISTORICO, type FiltrosAuditoria } from "@/components/auditoria/HistoricoProcesados";
import { PanelProcesamiento } from "@/components/auditoria/PanelProcesamiento";
import { UltimoAnalisis } from "@/components/auditoria/UltimoAnalisis";
import {
  getFinanciadoresProcesamientos,
  getProcesamiento,
  getProcesamientos,
  getProcesamientosPaginado,
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

const carriles = porCarril(PASOS);
const listaY = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

const FECHA_RX = /^\d{4}-\d{2}-\d{2}$/;

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

/**
 * /app/auditoria — la plantilla Tablero (DESIGN_SYSTEM.md §14): encabezado → Indicadores del
 * estado actual → la pieza viva (la cola) → el Listado de lo ya leído (§14.1).
 *
 * Los filtros (zona, fecha de entrada a la cola, quién lo pagó) viven en la URL y acotan a
 * la vez la cola y lo ya leído: los enlaces del mapa y de /app/financiar llegan con
 * `?ubigeo=` para mostrar la cola de esa zona. Por eso hay UNA `BarraFiltros`, dentro del
 * mismo `Listado` que envuelve las dos piezas, y va arriba de ambas: dos barras con los
 * mismos chips serían dos controles para lo mismo, y una barra sólo en lo leído cambiaría
 * en silencio el tablero que queda arriba de ella. Los Indicadores quedan fuera del Listado:
 * hablan de todo el Perú (el resumen no acepta filtros) y lo dicen en su ⓘ.
 *
 * El tablero hace polling en el cliente, pero no guarda filtros: los recibe como props y se
 * vuelve a montar (`key`) cuando la URL cambia, así el sondeo nunca pelea con la URL.
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
  const filtros: FiltrosAuditoria = { ubigeo, desde, hasta, financiador };
  const histQuery = { ...filtros, estado: "procesado" as const };

  const [resumen, zonas, initialCompleto, historicoCompleto, financiadores, ultimo, procesados, nombreSubzona] = await Promise.all([
    getResumenVivo(),
    getZonas("departamento"),
    // El tablero en vivo obedece los mismos filtros que lo ya leído (zona, fecha, quién pagó).
    getProcesamientos({ ...filtros, limit: 300 }),
    getProcesamientosPaginado({ ...histQuery, limit: TAM_HISTORICO, offset: (paginaActual - 1) * TAM_HISTORICO }),
    getFinanciadoresProcesamientos(),
    // El último análisis terminado CON LOS FILTROS PUESTOS: es lo que se muestra cuando no
    // hay nada en análisis, que es el estado normal de esta pantalla. Su detalle (con la
    // bitácora, que permite repetir la corrida) se encadena acá mismo, no en serie después.
    getProcesamientos({ ...histQuery, limit: 1 }).then((ref) => (ref?.[0]?.ocid ? getProcesamiento(ref[0].ocid) : null)),
    // Ritmo real (todo el Perú, como los Indicadores): cuándo terminó cada análisis.
    getProcesamientos({ estado: "procesado", limit: 300 }),
    // Los enlaces del mapa pueden traer una provincia o un distrito: su nombre, para el chip y el título.
    ubigeo && ubigeo.length > 2 ? getZona(ubigeo).then((z) => z?.zona.nombre ?? null) : Promise.resolve(null),
  ]);
  const initial = initialCompleto ? sinFasesInactivas(initialCompleto) : null;
  const historico = historicoCompleto ? { ...historicoCompleto, data: sinFasesInactivas(historicoCompleto.data ?? []) } : null;
  const finalizados = procesados ? procesados.map((p) => p.finalizadoAt).filter((f): f is string => !!f) : null;
  const hayFiltros = !!(ubigeo || desde || hasta || financiador);
  const departamento = ubigeo && ubigeo.length === 2 ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;
  const zonaNombre = ubigeo ? departamento?.nombre ?? nombreSubzona ?? undefined : undefined;

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
      {/* Esta pantalla es un tablero: se entra a MIRAR, no a leer una introducción. Cómo se lee
          un contrato está a un clic, en el ⓘ; el estado queda arriba del pliegue. */}
      <EncabezadoPagina
        titulo="Auditoría en vivo"
        bajada="Cada contrato financiado, de la cola al dictamen, en orden de antigüedad: nadie elige cuál se lee."
        ayuda={
          <Ayuda titulo="¿Cómo se lee un contrato?" ancho="w-[22rem]">
            <span className="block">
              <span className="font-semibold text-ink">{TOTAL_AGENTES} agentes</span> lo leen en{" "}
              <span className="font-semibold text-ink">{TOTAL_PASOS} pasos</span>. Dos ramas corren a la vez y una síntesis
              junta todo al final:
            </span>
            {/* Derivado del catálogo: la lista y el número no pueden contradecirse. */}
            {carriles.map((c) => (
              <span key={c.key} className="mt-1 block text-mute">
                <span className="font-semibold text-ink">{c.label}:</span> {listaY(c.pasos.map((p) => p.titulo.toLowerCase()))}.
              </span>
            ))}
            <span className="mt-2 block border-t border-line pt-2 text-mute">
              <span className="font-semibold text-ink">En espera:</span> asignado a un aporte confirmado, espera sus
              documentos del SEACE o su turno. <span className="font-semibold text-ink">En análisis:</span> unos minutos por
              contrato. <span className="font-semibold text-ink">Con dictamen publicado:</span> cada señal cita su norma y
              su evidencia, y se publica aunque señale a quien lo pagó.
            </span>
          </Ayuda>
        }
        acciones={
          // La única invitación a financiar de la página: una zona entra aquí en cuanto alguien paga su lectura.
          <EnlaceAccion variante="secundario" href="/app/financiar" flecha>
            Financiar una auditoría
          </EnlaceAccion>
        }
      />

      <PanelProcesamiento initial={resumen} pollMs={5000} finalizados={finalizados} />

      <Listado ruta="/app/auditoria" parametros={{ ...filtros, pagina: paginaActual > 1 ? String(paginaActual) : undefined }}>
        <BarraFiltros
          faceta={{ param: "ubigeo", etiqueta: "Zona", todas: "Todo el Perú", conteoTodas, opciones: opcionesZona }}
          filtros={filtrosSecundarios}
        />

        <Seccion
          id="en-vivo"
          titulo={zonaNombre ? `En vivo en ${zonaNombre}` : "En vivo en todo el Perú"}
          ayuda={
            <Ayuda titulo="¿En qué orden entran?">
              <span className="block">
                Por orden de llegada: nadie elige cuál se lee. Una zona aparece aquí en cuanto alguien financia su auditoría.
              </span>
              <span className="mt-2 block text-mute">
                Los filtros de arriba acotan esta cola y lo ya leído, más abajo. Las cifras de arriba siempre son de todo el Perú.
              </span>
            </Ayuda>
          }
        >
          <ZonaResultados>
            <TableroAuditoria
              key={[ubigeo, desde, hasta, financiador].map((v) => v ?? "").join("|")}
              ubigeo={ubigeo}
              desde={desde}
              hasta={hasta}
              financiador={financiador}
              initial={initial}
              autoRefreshMs={5000}
              verMasHref="#historico"
              panelSecundario={<UltimoAnalisis p={ultimo} hayFiltros={hayFiltros} />}
            />
          </ZonaResultados>
        </Seccion>

        <Seccion
          id="historico"
          className="border-t border-line pt-6"
          titulo={zonaNombre ? `Lo ya leído en ${zonaNombre}` : "Todo lo que ya se leyó"}
          ayuda={
            <Ayuda titulo="¿Qué entra aquí?">
              Cada contrato financiado cuyo análisis terminó, con su resultado y quién pagó esa lectura. Incluye los que están
              en revisión: se leyeron enteros, pero su dictamen todavía no se publica. Los filtros de arriba también lo acotan.
            </Ayuda>
          }
        >
          <ZonaResultados>
            <HistoricoProcesados pagina={historico} paginaActual={paginaActual} filtros={filtros} conFinanciador={conPatrocinador} />
          </ZonaResultados>
        </Seccion>
      </Listado>
    </Pagina>
  );
}
