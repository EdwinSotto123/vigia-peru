import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Building2, Camera, Flag, GitCompareArrows, Heart, Landmark, MapPin, type LucideIcon, Users } from "lucide-react";
import { Pagina } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Partes } from "@/components/ui/Partes";
import { EnVivoInicio } from "@/components/home/EnVivoInicio";
import { HeroInicio, type CifrasInicio } from "@/components/home/HeroInicio";
import { RankingsInicio, type PestanaRank } from "@/components/home/RankingsInicio";
import { aFilaLeida, aFilaVivo, type FotoVivo } from "@/components/home/vivo";
import { clasificar, hrefPerfil } from "@/components/aliados/ranking";
import { API_BASE } from "@/lib/api-client";
import { esAnalisisPublicado, hrefAnalisis, type AnalisisPublicado } from "@/components/convocatoria/analisisPublicados";
import { getProcesamientos } from "@/lib/auditoria";
import { anioLectura, desdeLectura, getContratosGeo, getResumenContratos, getResumenVivo } from "@/lib/contratos";
import { getEntidadesFinanciables, getEstadoGlobal, getRankingPaginado } from "@/lib/financiamiento";
import { numero, plural, relativo } from "@/lib/formato";
import { contarLeidos, tituloNatural } from "@/lib/landing";
import { ANIO_GOBIERNO_VIGENTE, getRankingPartidos, periodoTexto } from "@/lib/partidosApi";

export const metadata: Metadata = { title: "Inicio" };

/**
 * Pantalla principal de la app: lo simple primero y lo vivo a la vista.
 *
 *  1. La pregunta, el buscador y las cifras de hoy, cada una con su anillo (qué parte de qué).
 *  2. Rankings con pestañas (entidades, partidos, aliados, regiones) y, al lado, "se están analizando ahora".
 *  3. Ocho caminos en palabras de persona y lo último que Vigía marcó.
 *
 * Toda cifra sale de las mismas lecturas que usa el resto de la app. Si una falla, su bloque (o su pestaña)
 * no se dibuja: nunca se rellena con un número plausible. Cada destino tiene UNA entrada.
 */

const CAMINOS: { href: string; Icono: LucideIcon; titulo: string; texto: string }[] = [
  { href: "/app/mapa", Icono: MapPin, titulo: "Ver qué se contrata en mi región", texto: "Elige tu región en el mapa." },
  { href: "/app/hallazgos", Icono: Flag, titulo: "Revisar las señales de alerta", texto: "Con la norma y la evidencia." },
  { href: "/app/contratos?cruces=alta", Icono: GitCompareArrows, titulo: "Ver ganadores con antecedentes", texto: "Aportes, sanciones, visitas, socios." },
  { href: "/app/entidades", Icono: Building2, titulo: "Buscar una empresa o entidad", texto: "Quién contrata y cuánto." },
  { href: "/app/partidos", Icono: Landmark, titulo: "Ver quién gobierna mi región", texto: "Y cuánto vigilamos en cada lugar." },
  { href: "/app/personas?severidad=alta", Icono: Users, titulo: "Ver a quién contrata el Estado", texto: "Locadores, planilla y plazas CAS." },
  { href: "/app/financiar", Icono: Heart, titulo: "Financiar la lectura de contratos", texto: "Tu aporte paga que Vigía lea más." },
  { href: "/reporte/nuevo", Icono: Camera, titulo: "Denunciar una obra", texto: "Con una foto y la ubicación." },
];

const TOPE = 5;

/**
 * Lo último que Vigía marcó: los análisis publicados más recientes con señales, de `GET /alertas/analizadas` (~3 KB:
 * objeto, entidad, región, conteo de señales y fechas). Antes se bajaban 60 alertas completas (~190 KB, con cada señal
 * y su evidencia) para mostrar cuatro. Sin nombres de personas.
 */
async function ultimasSenales(cuantos = 4): Promise<AnalisisPublicado[]> {
  try {
    const res = await fetch(`${API_BASE}/alertas/analizadas?limit=${cuantos * 3}&orden=reciente`, { next: { revalidate: 120 } } as RequestInit);
    if (!res.ok) return [];
    const j = (await res.json()) as { items?: unknown[] };
    return (j.items ?? []).filter(esAnalisisPublicado).filter((a) => (a.n_banderas ?? 0) > 0).slice(0, cuantos);
  } catch {
    return [];
  }
}

export default async function InicioApp() {
  // La base trae la historia del OECE desde 2015; lo que Vigía lee es lo del año en curso: los anillos se miden
  // contra los contratos de este año (si no, "leídos" quedaba en 0,0 % de casi un millón).
  const anio = anioLectura();
  const [resumen, resumenAnio, estado, ultimas, entidades, partidos, ranking, regiones, vivo] = await Promise.all([
    getResumenContratos().catch(() => null),
    getResumenContratos({ desde: desdeLectura() }).catch(() => null),
    getEstadoGlobal().catch(() => null),
    ultimasSenales(),
    getEntidadesFinanciables({ limit: TOPE }).catch(() => null),
    getRankingPartidos(ANIO_GOBIERNO_VIGENTE).catch(() => null),
    getRankingPaginado({ periodo: "todo", limit: 12 }).catch(() => null),
    getContratosGeo({ nivel: "departamento" }).catch(() => null),
    getResumenVivo().catch(() => null),
  ]);

  // ── Cifras de hoy ──
  const publicados = resumen?.total ?? 0;
  const cifras: CifrasInicio | null =
    resumen && publicados > 0
      ? {
          publicados,
          delAnio: resumenAnio ? { anio, publicados: resumenAnio.total } : null,
          leidos: contarLeidos(resumen.porRiesgo) ?? 0,
          conSenalAlta: resumen.porRiesgo.alto ?? null,
          enCola: estado?.colaGlobal ?? null,
        }
      : null;

  // ── Rankings: cada pestaña sólo existe si su lectura respondió con algo ──
  const pestanas: PestanaRank[] = [];
  if (entidades && entidades.items.length > 0) {
    pestanas.push({
      id: "entidades",
      etiqueta: "Entidades",
      metrica: "Entidades con más contratos esperando que alguien financie su lectura.",
      filas: entidades.items.slice(0, TOPE).map((e) => ({
        id: e.ruc,
        nombre: tituloNatural(e.nombre),
        sub: `${e.conDocumentos} con documentos listos${e.region ? `, ${e.region}` : ""}`,
        valor: e.enCola,
        texto: `${numero(e.enCola)} esperando`,
        href: `/app/financiar/entidad/${e.ruc}`,
      })),
      verTodos: { href: "/app/entidades", texto: "Ver todas las entidades" },
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
        sub: `${numero(p.leidos)} leídos, ${numero(p.enCola)} esperando lectura`,
        valor: p.contratos,
        texto: plural(p.contratos, "contrato", "contratos"),
        parte: p.contratos > 0 ? p.leidos / p.contratos : 0,
        href: `/app/partidos/${encodeURIComponent(p.clave)}?anio=${ANIO_GOBIERNO_VIGENTE}`,
      })),
      verTodos: { href: "/app/partidos", texto: "Ver todos los partidos" },
      nota: "Se asocia al partido que ganó la elección de ese período. Una señal es para revisar, nunca una acusación contra un partido.",
    });
  }
  const aliados = clasificar(ranking?.data ?? []).slice(0, TOPE);
  if (aliados.length > 0) {
    pestanas.push({
      id: "aliados",
      etiqueta: "Aliados",
      metrica: "Quienes más contratos hicieron leer. Se cuenta en contratos, nunca en soles.",
      filas: aliados.map((a) => ({
        id: String(a.id),
        nombre: a.nombre,
        sub: `${numero(a.contratosProcesados)} leídos, ${numero(a.senalesHalladas)} con señales`,
        valor: a.contratosFinanciados,
        texto: plural(a.contratosFinanciados, "contrato", "contratos"),
        parte: a.contratosFinanciados > 0 ? a.contratosProcesados / a.contratosFinanciados : 0,
        href: hrefPerfil(a.slug),
      })),
      verTodos: { href: "/app/aliados", texto: "Ver el ranking de aliados" },
    });
  }
  const filasRegiones = [...(regiones ?? [])].filter((z) => z.enCola > 0).sort((a, b) => b.enCola - a.enCola).slice(0, TOPE);
  if (filasRegiones.length > 0) {
    pestanas.push({
      id: "regiones",
      etiqueta: "Regiones",
      metrica: "Regiones con más contratos esperando lectura. La región es la sede de la entidad que contrata.",
      filas: filasRegiones.map((z) => ({
        id: z.ubigeo,
        nombre: z.nombre,
        sub: `${numero(z.procesados)} leídos de ${numero(z.total)}`,
        valor: z.enCola,
        texto: `${numero(z.enCola)} esperando`,
        href: `/app/financiar/${z.ubigeo}`,
      })),
      verTodos: { href: "/app/mapa", texto: "Ver el mapa" },
    });
  }

  // ── En vivo: lo que se analiza ahora; si nada, lo último que se leyó (el panel lo dice) ──
  let foto: FotoVivo | null = null;
  if (vivo) {
    const activos = (vivo.activos ?? []).map((a) => aFilaVivo(a as unknown as Record<string, unknown>));
    const leidos = activos.length === 0 ? await getProcesamientos({ estado: "procesado", limit: 8 }).catch(() => null) : null;
    foto = {
      enAnalisis: activos.slice(0, 6),
      totalEnAnalisis: vivo.porEstado?.procesando || activos.length,
      ultimosLeidos: (leidos ?? []).map(aFilaLeida),
    };
  }

  return (
    <div className="min-h-screen bg-paperSoft">
      <Pagina className="space-y-8">
        <HeroInicio c={cifras} />

        {(pestanas.length > 0 || foto) && (
          <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            {pestanas.length > 0 && <RankingsInicio pestanas={pestanas} />}
            {foto && <EnVivoInicio inicial={foto} />}
          </div>
        )}

        <section aria-labelledby="caminos-titulo">
          <h2 id="caminos-titulo" className="font-display text-seccion font-bold text-ink mb-3">Qué puedes hacer</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {CAMINOS.map(({ href, Icono, titulo, texto }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex h-full items-center gap-3.5 rounded-2xl border border-line bg-paper p-3.5 transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-granate"
                >
                  <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-granate-soft text-granate transition-colors duration-rapido group-hover:bg-granate group-hover:text-paper">
                    <Icono size={19} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-cuerpo font-semibold leading-snug text-ink">{titulo}</span>
                    <span className="block text-meta leading-snug text-mute">{texto}</span>
                  </span>
                  <ArrowUpRight size={15} aria-hidden className="shrink-0 text-mute transition-colors duration-rapido group-hover:text-granate" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {ultimas.length > 0 && (
          <section aria-labelledby="ultimo-titulo">
            <h2 id="ultimo-titulo" className="font-display text-seccion font-bold text-ink mb-3">Lo último que Vigía marcó</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {ultimas.map((a) => {
                const n = a.n_banderas ?? 0;
                return (
                  <li key={a.ocid}>
                    <Link
                      href={hrefAnalisis(a)}
                      className="flex items-start justify-between gap-4 px-4 py-3 transition-colors duration-rapido hover:bg-granate-50 sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-cuerpo font-semibold text-ink">{a.objeto ? tituloNatural(a.objeto) : "Contrato sin título"}</span>
                        <span className="block truncate text-meta text-mute">
                          <Partes
                            partes={[
                              a.entidad && <Dato key="entidad" tipo="entidad">{tituloNatural(a.entidad)}</Dato>,
                              a.region && <Dato key="region" tipo="lugar">{a.region}</Dato>,
                            ]}
                          />
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-meta leading-snug text-mute">
                        <span className="block font-semibold text-ink">{n} {n === 1 ? "señal" : "señales"}</span>
                        <span className="block">{relativo(a.analizado_en)}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-meta text-mute">Una señal es un motivo para revisar un contrato, nunca una acusación.</p>
          </section>
        )}
      </Pagina>
    </div>
  );
}
