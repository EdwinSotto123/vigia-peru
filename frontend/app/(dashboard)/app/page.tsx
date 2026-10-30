import type { Metadata } from "next";
import { Suspense } from "react";
import { Pagina } from "@/components/patrones";
import { EnVivoInicio } from "@/components/home/EnVivoInicio";
import { HeroInicio, type CifrasInicio } from "@/components/home/HeroInicio";
import { NovedadesInicio } from "@/components/home/NovedadesInicio";
import { RankingsInicio, type PestanaRank } from "@/components/home/RankingsInicio";
import { aFilaVivo, deAnalisis, deProcesamiento, esAnalisisReal, unirLecturas, type FilaLectura, type FotoVivo } from "@/components/home/vivo";
import { clasificar, hrefPerfil } from "@/components/aliados/ranking";
import { API_BASE } from "@/lib/api-client";
import { getProcesamientos } from "@/lib/auditoria";
import { getCifrasAnio } from "@/lib/cifras";
import { anioLectura, desdeLectura, getContratosGeo, getResumenVivo } from "@/lib/contratos";
import { getEntidadesFinanciables, getEstadoGlobal, getRankingPaginado, getZonas } from "@/lib/financiamiento";
import { numero, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { ANIO_GOBIERNO_VIGENTE, getRankingPartidos, periodoTexto } from "@/lib/partidosApi";
import { rutaRegion } from "@/lib/regiones";

export const metadata: Metadata = { title: "Inicio" };

/**
 * Pantalla principal de la app: lo simple primero y lo vivo a la vista.
 *
 *  1. La pregunta, el buscador, tres caminos del ciudadano y las cifras del año (`lib/cifras`: los mismos números que
 *     el mapa, financiar y la portada).
 *  2. «Lo nuevo esta semana» (fase 6): contratos con antecedentes graves, sanciones e informes nuevos, y los tres
 *     contratos con más antecedentes; el resto en /app/novedades.
 *  3. Rankings con pestañas (entidades, partidos, aliados, regiones): cada fila abre su ficha. Al lado, «Últimas
 *     lecturas»: lo que se analiza ahora y lo último que se leyó, en un solo bloque.
 *
 * Toda cifra sale de las mismas lecturas que usa el resto de la app. Si una falla, su bloque (o su pestaña)
 * no se dibuja: nunca se rellena con un número plausible. Cada destino tiene UNA entrada.
 */

const TOPE = 5;
const LECTURAS = 6;

/**
 * Las últimas lecturas publicadas, por cualquier vía (`GET /alertas/analizadas`, ~3 KB: objeto, entidad, región,
 * señales por severidad y fecha). Sin nombres de personas. `null` si no respondió.
 */
async function ultimosPublicados(): Promise<FilaLectura[] | null> {
  try {
    const res = await fetch(`${API_BASE}/alertas/analizadas?limit=8&orden=reciente`, { next: { revalidate: 120 } } as RequestInit);
    if (!res.ok) return null;
    const j = (await res.json()) as { items?: unknown[] };
    return (j.items ?? []).filter(esAnalisisReal).map(deAnalisis);
  } catch {
    return null;
  }
}

export default async function InicioApp() {
  const [cifrasAnio, estado, publicados, cola, entidades, partidos, ranking, regiones, zonas, vivo] = await Promise.all([
    getCifrasAnio(),
    getEstadoGlobal().catch(() => null),
    ultimosPublicados(),
    getProcesamientos({ estado: "procesado", limit: 8 }).catch(() => null),
    getEntidadesFinanciables({ limit: TOPE }).catch(() => null),
    getRankingPartidos(ANIO_GOBIERNO_VIGENTE).catch(() => null),
    getRankingPaginado({ periodo: "todo", limit: 12 }).catch(() => null),
    // Las regiones del año, como el mapa: «leídos de publicados» del mismo universo que las cifras de arriba.
    getContratosGeo({ nivel: "departamento", desde: desdeLectura() }).catch(() => null),
    // La cola de cada región: el «en cola» de financiar, con la misma palabra y el mismo número.
    getZonas("departamento").catch(() => null),
    getResumenVivo().catch(() => null),
  ]);

  // ── Cifras del año: un solo universo (lib/cifras) ──
  const cifras: CifrasInicio = { anio: cifrasAnio, enCola: estado?.colaGlobal ?? null };

  // ── Rankings: cada pestaña sólo existe si su lectura respondió con algo; cada fila abre su ficha ──
  const pestanas: PestanaRank[] = [];
  if (entidades && entidades.items.length > 0) {
    pestanas.push({
      id: "entidades",
      etiqueta: "Entidades",
      metrica: "Entidades con más contratos en la cola de lectura.",
      filas: entidades.items.slice(0, TOPE).map((e) => ({
        id: e.ruc,
        nombre: tituloNatural(e.nombre),
        sub: `${numero(e.conDocumentos)} con documentos listos${e.region ? `, ${e.region}` : ""}`,
        valor: e.enCola,
        texto: `${numero(e.enCola)} en cola`,
        href: `/entidad/${e.ruc}`,
      })),
      verTodos: { href: "/app/entidades", texto: "Ver todas las entidades" },
      accion: { href: "/app/financiar?por=entidad", texto: "Financiar por entidad" },
    });
  }
  const filasPartidos = (partidos?.data ?? []).filter((p) => p.contratos > 0).slice(0, TOPE);
  if (partidos && filasPartidos.length > 0) {
    pestanas.push({
      id: "partidos",
      etiqueta: "Partidos",
      metrica: `Contratos de las entidades que cada partido gobernó en el período ${periodoTexto(ANIO_GOBIERNO_VIGENTE)}, y cuántos ya se leyeron.`,
      filas: filasPartidos.map((p) => ({
        id: p.clave,
        nombre: p.nombre,
        sub: `${numero(p.leidos)} leídos, ${numero(p.enCola)} en cola`,
        valor: p.contratos,
        texto: plural(p.contratos, "contrato", "contratos"),
        parte: p.contratos > 0 ? p.leidos / p.contratos : 0,
        href: `/app/partidos/${encodeURIComponent(p.clave)}?anio=${ANIO_GOBIERNO_VIGENTE}`,
      })),
      verTodos: { href: "/app/partidos", texto: "Ver todos los partidos" },
      accion: { href: "/app/financiar?por=partido", texto: "Financiar por partido" },
      nota: "Se asocia al partido que ganó la elección de ese período. Una señal es para revisar, nunca una acusación contra un partido.",
    });
  }
  const aliados = clasificar(ranking?.data ?? []).slice(0, TOPE);
  if (aliados.length > 0) {
    pestanas.push({
      id: "aliados",
      etiqueta: "Aliados",
      metrica: "Quienes más meses sostienen la vigilancia. Se cuentan los meses, nunca los soles.",
      filas: aliados.map((a) => ({
        id: String(a.id),
        nombre: a.nombre,
        sub: a.mensual ? `Aporta cada mes, ${plural(a.aportes ?? 0, "aporte", "aportes")}` : plural(a.aportes ?? 0, "aporte", "aportes"),
        valor: a.meses ?? 0,
        texto: plural(a.meses ?? 0, "mes", "meses"),
        parte: aliados[0]?.meses ? (a.meses ?? 0) / aliados[0].meses : 0,
        href: hrefPerfil(a.slug),
      })),
      verTodos: { href: "/app/aliados", texto: "Ver el podio de aliados" },
    });
  }
  const geoPorUbigeo = new Map((regiones ?? []).map((z) => [z.ubigeo, z]));
  const filasRegiones = [...(zonas ?? [])].filter((z) => z.pendientes > 0).sort((a, b) => b.pendientes - a.pendientes).slice(0, TOPE);
  if (filasRegiones.length > 0) {
    pestanas.push({
      id: "regiones",
      etiqueta: "Regiones",
      metrica: "Regiones con más contratos en cola, esperando su lectura: los más graves van primero. La región es la sede de la entidad que contrata.",
      filas: filasRegiones.map((z) => {
        const g = geoPorUbigeo.get(z.ubigeo);
        return {
          id: z.ubigeo,
          nombre: z.nombre,
          sub: g ? `${numero(g.procesados)} leídos de ${numero(g.total)} publicados en ${anioLectura()}` : undefined,
          valor: z.pendientes,
          texto: `${numero(z.pendientes)} en cola`,
          href: rutaRegion(z.ubigeo),
        };
      }),
      verTodos: { href: "/app/mapa", texto: "Ver el mapa" },
      accion: { href: "/app/financiar", texto: "Financiar por zona" },
    });
  }

  // ── Últimas lecturas: lo que se analiza ahora y lo último que se leyó, juntos y sin repetir contratos ──
  const activos = (vivo?.activos ?? []).map((a) => aFilaVivo(a as unknown as Record<string, unknown>));
  const lecturas = unirLecturas([publicados ?? [], (cola ?? []).map(deProcesamiento)], LECTURAS);
  const foto: FotoVivo | null =
    activos.length > 0 || lecturas.length > 0
      ? {
          enAnalisis: activos.slice(0, LECTURAS),
          totalEnAnalisis: vivo?.porEstado?.procesando || activos.length,
          vivoConocido: vivo != null,
          lecturas,
        }
      : null;

  return (
    <div className="min-h-screen bg-paperSoft">
      <Pagina className="space-y-8">
        <HeroInicio c={cifras} />

        {/* Lo nuevo esta semana: su propia lectura (en caché), sin frenar el resto de la página. */}
        <Suspense fallback={null}>
          <NovedadesInicio />
        </Suspense>

        {(pestanas.length > 0 || foto) && (
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {pestanas.length > 0 && <RankingsInicio pestanas={pestanas} />}
            {foto && <EnVivoInicio inicial={foto} />}
          </div>
        )}
      </Pagina>
    </div>
  );
}
