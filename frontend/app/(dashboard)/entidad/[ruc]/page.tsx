import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Building2, ChevronRight, Coins, Flag, MapPin } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import { fechaCorta, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { esAlertaReal } from "@/lib/semillas";
import { severidadDeScore, ETIQUETA_PESO } from "@/lib/severidad";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { EjecucionPresupuestal } from "@/components/EjecucionPresupuestal";
import { getEntidad } from "@/lib/api-client";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { Cifra, EncabezadoPagina, EstadoError } from "@/components/patrones";
import { Severidad } from "@/components/ui/Severidad";
import { Skeleton } from "@/components/ui/Skeleton";

/** Lo que devuelve `GET /entidades/:ruc` en `alertas[]` (snake_case, máximo 20, por score). */
interface AlertaEntidad {
  id: string;
  codigo?: string | null;
  codigo_convocatoria?: string | null;
  score?: number | string | null;
  fecha_buena_pro?: string | null;
  monto_adjudicado?: number | string | null;
  estado?: string | null;
  objeto?: string | null;
}

/** Departamentos por los dos primeros dígitos del ubigeo INEI. */
const DEPARTAMENTO: Record<string, string> = {
  "01": "Amazonas", "02": "Áncash", "03": "Apurímac", "04": "Arequipa", "05": "Ayacucho",
  "06": "Cajamarca", "07": "Callao", "08": "Cusco", "09": "Huancavelica", "10": "Huánuco",
  "11": "Ica", "12": "Junín", "13": "La Libertad", "14": "Lambayeque", "15": "Lima",
  "16": "Loreto", "17": "Madre de Dios", "18": "Moquegua", "19": "Pasco", "20": "Piura",
  "21": "Puno", "22": "San Martín", "23": "Tacna", "24": "Tumbes", "25": "Ucayali",
};

const normal = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/**
 * ¿El ubigeo que trae la entidad cae en su misma región? El ubigeo de la ficha
 * sale de un cruce automático y a veces apunta a otro departamento; ofrecer
 * "Financiar la auditoría de X" sobre una zona equivocada manda el aporte de un
 * vecino a otro lugar. Sin región declarada no hay contra qué comparar.
 */
function ubigeoCoincide(ubigeo: string | null, region: string | null): boolean {
  if (!ubigeo) return false;
  const dep = DEPARTAMENTO[ubigeo.slice(0, 2)];
  if (!dep) return false;
  if (!region) return true;
  const r = normal(region);
  const d = normal(dep);
  return r === d || r.startsWith(d) || d.startsWith(r);
}

/** DATE/TIMESTAMP a medianoche UTC → sólo el día (AAAA-MM-DD), que `fechaCorta` toma como día de Lima. */
const diaDe = (v: string | null | undefined): string | null => {
  const ymd = String(v ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : null;
};

/** Enlace con forma de botón (píldora, §5). Primario = granate; secundario = borde. */
const BOTON_PRIMARIO =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-granate-deep";
const BOTON_SECUNDARIO =
  "inline-flex min-h-[40px] items-center justify-center gap-2 rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors duration-150 hover:border-granate/40 hover:bg-granate-50";

/** Los tramos del peso del riesgo, con un score de muestra para pintarlos con el mismo componente que las filas. */
const TRAMOS = [
  { clave: "alta", muestra: 85 },
  { clave: "media", muestra: 55 },
  { clave: "baja", muestra: 10 },
  { clave: "sin", muestra: 0 },
] as const;

function tramoDe(score: number): (typeof TRAMOS)[number]["clave"] {
  const n = severidadDeScore(score);
  if (score === 0) return "sin";
  return n.nivel === "alta" ? "alta" : n.nivel === "media" ? "media" : "baja";
}

export async function generateMetadata({ params }: { params: { ruc: string } }): Promise<Metadata> {
  const r = await getEntidad(params.ruc).catch(() => null);
  const nombre = r?.entidad?.nombre as string | undefined;
  return { title: nombre ?? `Entidad ${params.ruc}` };
}

export default async function EntidadProfile({ params }: { params: { ruc: string } }) {
  // Antes, si el API fallaba o no conocía el RUC, la ficha se armaba con
  // lib/mock-entities y ALERTAS_MOCK: una entidad inventada con alertas
  // inventadas. Ahora: sin respuesta, se dice; RUC desconocido, 404.
  let apiResp: Awaited<ReturnType<typeof getEntidad>> = null;
  let fallo = false;
  try {
    apiResp = await getEntidad(params.ruc);
  } catch (e) {
    console.error("[entidad] el API no respondió:", (e as Error).message);
    fallo = true;
  }
  if (fallo) return <NoSePudoLeer ruc={params.ruc} />;
  if (!apiResp?.entidad) notFound();

  const e = apiResp.entidad;
  const nombre: string = e.nombre;
  const region: string | null = e.region || null;
  const ubigeo: string | null = e.ubigeo || null;
  const zonaNombre: string | null = e.zonaNombre || null;
  const enCola = Number(e.contratosEnCola || 0);
  const contratos = Number(e.contratos || 0);

  // Sólo las alertas PUBLICADAS y reales: el endpoint también devuelve las que
  // quedaron en revisión humana (no publicadas) y las de demo `ALT-…`.
  const crudas = (apiResp.alertas ?? []) as AlertaEntidad[];
  const publicadas = crudas.filter((a) => esAlertaReal({ codigo: a.codigo }) && (a.estado ?? "activa") === "activa");
  const truncada = crudas.length >= 20; // el backend corta en 20, ordenadas por score de mayor a menor
  const demo = crudas.filter((a) => !esAlertaReal({ codigo: a.codigo }) && (a.estado ?? "activa") === "activa");
  const nAlertas = truncada ? Math.max(0, Number(e.alertas || 0) - demo.length) : publicadas.length;
  const monto = truncada
    ? Math.max(0, Number(e.monto || 0) - demo.reduce((s, a) => s + Number(a.monto_adjudicado || 0), 0))
    : publicadas.reduce((s, a) => s + Number(a.monto_adjudicado || 0), 0);
  const financiable = enCola > 0 && ubigeoCoincide(ubigeo, region);
  const zonaFinanciar = ubigeo ? zonaNombre ?? DEPARTAMENTO[ubigeo.slice(0, 2)] : null;

  // "Con señales" = contratos con al menos una señal publicada (DESIGN_SYSTEM.md §10.1).
  // El score es la suma de los pesos de las señales (todo peso ≥ 5), así que score > 0 ⇔ hay señales.
  // Con la lista cortada en 20 (por score, de mayor a menor): si la última listada ya tiene
  // score 0, las que no vinieron tampoco tienen señales y el conteo es exacto; si no, es un piso.
  const scores = publicadas.map((a) => Number(a.score) || 0);
  const conSenales = scores.filter((x) => x > 0).length;
  const conSenalesEsPiso = truncada && scores.length > 0 && scores[scores.length - 1] > 0;
  const porTramo = scores.reduce<Record<string, number>>((acc, x) => {
    const k = tramoDe(x);
    acc[k] = (acc[k] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-8">
        <Link href="/app/entidades" className="inline-flex min-h-[24px] items-center gap-1.5 text-sm text-mute hover:text-ink">
          <ArrowLeft size={15} aria-hidden /> Volver a entidades
        </Link>

        <EncabezadoPagina
          titulo={nombre}
          bajada={
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-mute">
              <span className="inline-flex items-center gap-1">
                <Building2 size={13} aria-hidden /> {etiquetaTipoEntidad(e.tipo ?? null, nombre)}
              </span>
              <span className="font-mono" translate="no">
                RUC {e.ruc}
              </span>
              {region && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} aria-hidden /> {[region, e.provincia, e.distrito].filter(Boolean).join(", ")}
                </span>
              )}
            </span>
          }
          acciones={
            <>
              <SeguirEntidadBoton ruc={e.ruc} nombre={nombre} />
              <Link href={`/reporte/nuevo?modo=entidad&ruc=${e.ruc}`} className={BOTON_SECUNDARIO}>
                <Flag size={14} aria-hidden /> Denunciar a esta entidad
              </Link>
            </>
          }
        />

        <DisclaimerBanner />

        {/* Lo leído de esta entidad: cada cifra con su denominador. */}
        <section aria-label="Contratos leídos de esta entidad" className="grid gap-5 rounded-2xl border border-line bg-paper p-5 sm:grid-cols-3">
          <Cifra
            valor={numero(nAlertas)}
            etiqueta="Con dictamen publicado"
            contexto={`de ${plural(contratos, "contrato registrado", "contratos registrados")} de esta entidad en el SEACE`}
          />
          <Cifra
            valor={nAlertas === 0 ? "Sin dato" : `${conSenalesEsPiso ? "Al menos " : ""}${numero(conSenales)}`}
            etiqueta="Con señales"
            contexto={
              nAlertas === 0
                ? "Todavía no hay contratos leídos y publicados"
                : `de ${numero(nAlertas)} con dictamen publicado tienen al menos una señal`
            }
          />
          <Cifra
            valor={nAlertas === 0 ? "Sin dato" : solesCompacto(monto)}
            etiqueta="Adjudicado en esos contratos"
            contexto="Suma de lo adjudicado en los contratos con dictamen publicado"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-line bg-paper p-5 lg:col-span-2">
            <h2 className="font-display text-lg font-bold text-ink">Contratos que esperan su lectura</h2>
            <p className="mt-1 text-[13px] text-mute">Convocatorias de esta entidad que Vigía todavía no leyó.</p>
            <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-4">
              <Cifra
                valor={numero(enCola)}
                etiqueta="En cola"
                contexto={`de ${plural(contratos, "contrato registrado", "contratos registrados")} esperan financiamiento para leerse`}
              />
              {financiable && ubigeo ? (
                <Link href={`/app/financiar/${ubigeo}`} className={BOTON_PRIMARIO}>
                  Financiar la lectura de {zonaFinanciar}
                  <ChevronRight size={15} aria-hidden />
                </Link>
              ) : (
                <p className="max-w-[44ch] text-sm text-mute">
                  {enCola === 0
                    ? "No hay contratos de esta entidad esperando en la cola."
                    : "Todavía no sabemos a qué zona pertenece esta entidad, así que no se puede financiar su lectura desde aquí."}
                </p>
              )}
            </div>
            <p className="mt-4 text-[12px] text-mute">
              Los contratos se leen por antigüedad dentro de la zona; no se puede elegir una entidad concreta.
            </p>
          </div>

          <div className="rounded-2xl border border-line bg-paper p-5">
            <h2 className="font-display text-lg font-bold text-ink">{ETIQUETA_PESO}</h2>
            <p className="mt-1 text-[13px] text-mute">
              Cómo pesan las señales de sus contratos con dictamen publicado. El peso sale del puntaje de cada contrato; no
              es una probabilidad de delito.
            </p>
            {publicadas.length ? (
              <>
                <ul className="mt-4 space-y-2">
                  {TRAMOS.map((t) => (
                    <li key={t.clave} className="flex items-center justify-between gap-3">
                      <Severidad score={t.muestra} formato="pastilla" />
                      <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                        {numero(porTramo[t.clave] ?? 0)}
                      </span>
                    </li>
                  ))}
                </ul>
                {truncada && (
                  <p className="mt-3 text-[12px] text-mute">
                    Cuenta los {numero(publicadas.length)} contratos de mayor puntaje, de {numero(nAlertas)} con dictamen.
                  </p>
                )}
              </>
            ) : (
              <p className="mt-4 text-sm text-mute">Sin contratos con dictamen publicado: todavía no hay nada que pesar.</p>
            )}
          </div>
        </section>

        {/* Ejecución presupuestal MEF (real): plegada, es la sección más densa y no
            lo primero que busca quien vino a ver los contratos leídos. */}
        <details className="group rounded-2xl border border-line bg-paper">
          <summary className="flex min-h-[48px] cursor-pointer items-center gap-2.5 rounded-2xl px-5 py-3.5 transition-colors duration-150 hover:bg-paperSoft">
            <Coins size={15} className="shrink-0 text-granate" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-ink">Ejecución presupuestal (MEF)</span>
              <span className="block text-[12px] text-mute">Gasto real frente al presupuesto asignado</span>
            </span>
            <ChevronRight size={15} className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-90" aria-hidden />
          </summary>
          <div className="border-t border-line p-3 sm:p-4">
            <Suspense fallback={<CargandoMef />}>
              <EjecucionPresupuestal
                query={mefSearchKeywordFor(nombre)}
                ruc={e.ruc}
                title="Ejecución presupuestal"
                subtitle={`${nombre}, según el MEF`}
              />
            </Suspense>
          </div>
        </details>

        <section aria-labelledby="contratos-leidos-titulo" className="overflow-hidden rounded-2xl border border-line bg-paper">
          <div className="border-b border-line bg-paperSoft px-5 py-4">
            <h2 id="contratos-leidos-titulo" className="font-display text-xl font-bold text-ink">
              Contratos con dictamen publicado
            </h2>
            <p className="mt-1 text-[13px] text-mute">
              {publicadas.length === 0
                ? "Contratos de esta entidad que Vigía leyó y publicó, con o sin señales."
                : truncada
                  ? `Los ${numero(publicadas.length)} de mayor puntaje, de ${numero(nAlertas)} con dictamen publicado. Cada uno abre su dictamen con las señales y la norma que las respalda.`
                  : `${plural(publicadas.length, "contrato leído y publicado", "contratos leídos y publicados")}. Cada uno abre su dictamen con las señales y la norma que las respalda.`}
            </p>
          </div>
          {publicadas.length === 0 ? (
            // Sin llamita: esta sección habla de una entidad, y la llamita no acompaña a nadie señalado.
            <p className="px-5 py-10 text-center text-sm text-mute">
              Todavía no hay contratos de esta entidad con dictamen publicado. Aparecen aquí cuando Vigía lee uno.
            </p>
          ) : (
            <table className="w-full table-fixed border-collapse text-left text-[13px]">
              <caption className="sr-only">Contratos de {nombre} con dictamen publicado, por peso del riesgo</caption>
              <thead className="border-b border-line text-[12px] text-mute">
                <tr>
                  <th scope="col" className="w-[9.5rem] px-4 py-2.5 font-semibold sm:w-44 sm:px-5">
                    {ETIQUETA_PESO}
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">
                    Contrato
                  </th>
                  <th scope="col" className="hidden w-36 px-5 py-2.5 text-right font-semibold md:table-cell">
                    Adjudicado
                  </th>
                </tr>
              </thead>
              <tbody>
                {publicadas.map((a) => {
                  const codigo = String(a.codigo_convocatoria ?? a.codigo ?? "").replace(/^OECE-/, "");
                  const dia = diaDe(a.fecha_buena_pro);
                  return (
                    <tr key={a.id} className="border-b border-line align-top transition-colors duration-150 last:border-b-0 hover:bg-paperSoft">
                      <td className="px-4 py-3 sm:px-5">
                        <Severidad score={Number(a.score) || 0} formato="pastilla" />
                      </td>
                      <td className="min-w-0 px-3 py-3">
                        <Link
                          href={`/app/convocatoria/${encodeURIComponent(codigo)}`}
                          className="line-clamp-2 font-semibold leading-snug text-ink underline-offset-2 hover:text-granate hover:underline"
                        >
                          {a.objeto || "Contrato sin objeto registrado"}
                        </Link>
                        <div className="mt-1 flex flex-wrap gap-x-3 text-[12px] text-mute">
                          <span className="font-mono" translate="no">
                            {codigo}
                          </span>
                          {dia && <span>Buena pro: {fechaCorta(dia)}</span>}
                          <span className="md:hidden">
                            {a.monto_adjudicado != null ? soles(Number(a.monto_adjudicado)) : "Sin monto adjudicado"}
                          </span>
                        </div>
                      </td>
                      <td className="hidden px-5 py-3 text-right font-mono tabular-nums text-ink md:table-cell">
                        {a.monto_adjudicado != null ? (
                          soles(Number(a.monto_adjudicado))
                        ) : (
                          <span className="font-sans text-[12px] text-mute">Sin dato</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <div className="px-4 py-8 sm:px-6 lg:px-10">
      <div className="mx-auto max-w-6xl space-y-6">
        <Link href="/app/entidades" className="inline-flex min-h-[24px] items-center gap-1.5 text-sm text-mute hover:text-ink">
          <ArrowLeft size={15} aria-hidden /> Volver a entidades
        </Link>
        <EncabezadoPagina titulo={`Entidad con RUC ${ruc}`} />
        <EstadoError
          titulo="No pudimos leer la ficha de esta entidad"
          accion={
            <Link href={`/entidad/${encodeURIComponent(ruc)}`} className={BOTON_PRIMARIO}>
              Reintentar
            </Link>
          }
        >
          El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
        </EstadoError>
      </div>
    </div>
  );
}

/**
 * Mientras responde el MEF: esqueleto con la forma de la tabla. Sin la llamita a
 * propósito: esta sección es la ficha de una entidad, y la llamita no acompaña a
 * nadie señalado (DESIGN_SYSTEM.md §2.3).
 */
function CargandoMef() {
  return (
    <div role="status" aria-live="polite" className="space-y-3 p-2">
      <p className="text-sm text-mute">Consultando los datos abiertos del MEF…</p>
      <div className="grid gap-2 sm:grid-cols-4" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-3.5 w-full" />
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

/** Convierte el nombre de la entidad en un keyword que MEF entiende. */
function mefSearchKeywordFor(nombre: string): string {
  if (!nombre) return "";
  const n = nombre.toUpperCase();
  // Gobiernos regionales: "Gob. Reg. de Cusco" → "REGIONAL DEL DEPARTAMENTO DE CUSCO"
  if (n.includes("GOBIERNO REGIONAL") || n.includes("GOB. REG")) {
    const m = nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ ]+)$/);
    if (m) return `REGIONAL DEL DEPARTAMENTO DE ${m[1].trim().toUpperCase()}`;
  }
  // Municipalidades distritales/provinciales: usar el distrito/provincia clave
  if (n.includes("MUNICIPALIDAD") || n.includes("MUN.")) {
    const m = nombre.match(/de ([A-Za-záéíóúñÁÉÍÓÚÑ]+)\s*$/);
    if (m)
      return `MUNICIPALIDAD ${n.includes("DISTRITAL") || n.includes("DIST") ? "DISTRITAL" : n.includes("PROVINCIAL") || n.includes("PROV") ? "PROVINCIAL" : ""} DE ${m[1].trim().toUpperCase()}`
        .replace(/\s+/g, " ")
        .trim();
  }
  // Ministerios: dejar tal cual en mayúsculas
  return n;
}
