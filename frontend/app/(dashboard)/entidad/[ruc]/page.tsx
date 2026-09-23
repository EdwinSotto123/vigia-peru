import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";
import { ArrowLeft, Building2, Coins, Activity, AlertTriangle, ChevronRight, Flag, FileText, MapPin, WifiOff } from "lucide-react";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import { formatSoles } from "@/lib/formato";
import { esAlertaReal } from "@/lib/semillas";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { EjecucionPresupuestal } from "@/components/EjecucionPresupuestal";
import { getEntidad } from "@/lib/api-client";
import { SeguirEntidadBoton } from "@/components/mapa/SeguirEntidadBoton";
import { NumberTicker } from "@/components/magicui/NumberTicker";

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

/** DATE/TIMESTAMP a medianoche UTC → se fija al mediodía de Lima para no caer en el día anterior. */
function fechaLima(v: string | null | undefined): string | null {
  const ymd = String(v ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString("es-PE", {
    timeZone: "America/Lima",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
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
  const truncada = crudas.length >= 20; // el backend corta en 20
  const demo = crudas.filter((a) => !esAlertaReal({ codigo: a.codigo }) && (a.estado ?? "activa") === "activa");
  const nAlertas = truncada ? Math.max(0, Number(e.alertas || 0) - demo.length) : publicadas.length;
  const monto = truncada
    ? Math.max(0, Number(e.monto || 0) - demo.reduce((s, a) => s + Number(a.monto_adjudicado || 0), 0))
    : publicadas.reduce((s, a) => s + Number(a.monto_adjudicado || 0), 0);
  const puntaje = publicadas.length
    ? Math.round(publicadas.reduce((s, a) => s + (Number(a.score) || 0), 0) / publicadas.length)
    : 0;
  const financiable = enCola > 0 && ubigeoCoincide(ubigeo, region);

  return (
    <div className="container-page space-y-8 py-10">
      <Link href="/app/entidades" className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Volver al ranking
      </Link>

      <header className="surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">{nombre}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-mute">
              <span className="flex items-center gap-1">
                <Building2 size={11} aria-hidden /> {etiquetaTipoEntidad(e.tipo ?? null, nombre)}
              </span>
              <span className="font-mono">RUC {e.ruc}</span>
              <SeguirEntidadBoton ruc={e.ruc} nombre={nombre} />
              {region && (
                <span className="flex items-center gap-1">
                  <MapPin size={11} aria-hidden /> {[region, e.provincia, e.distrito].filter(Boolean).join(", ")}
                </span>
              )}
            </div>
          </div>
          <Link
            href={`/reporte/nuevo?modo=entidad&ruc=${e.ruc}`}
            className="inline-flex items-center gap-2 rounded-full bg-rust px-4 py-2.5 text-sm font-medium text-paper shadow-card hover:bg-rust/90"
          >
            <Flag size={15} aria-hidden /> Denunciar a esta entidad
          </Link>
        </div>
      </header>

      <DisclaimerBanner />

      <section className="grid gap-3 sm:grid-cols-3">
        <KPI
          icon={<AlertTriangle size={16} />}
          label={nAlertas === 1 ? "Contrato con señales" : "Contratos con señales"}
          value={<NumberTicker value={nAlertas} format="entero" />}
          hint="publicados por Vigía"
          tone={nAlertas > 0 ? "amber" : "ink"}
        />
        <KPI
          icon={<FileText size={16} />}
          label="Contratos registrados"
          value={<NumberTicker value={contratos} format="entero" />}
          hint="convocatorias suyas que Vigía tiene del OECE"
          tone="ink"
        />
        <KPI
          icon={<Coins size={16} />}
          label="Monto con señales"
          value={<NumberTicker value={monto} format="pen_compacto" />}
          hint="suma de los contratos con señales"
          tone="heroViolet"
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <div className="surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-serif text-lg font-bold text-ink">Contratos de esta entidad sin leer</h2>
              <p className="text-xs text-mute">Convocatorias de los últimos 90 días (OECE) que Vigía todavía no analizó.</p>
            </div>
            <Activity size={18} className="text-heroViolet" aria-hidden />
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div>
              <div className="font-mono text-5xl font-bold text-ink">
                <NumberTicker value={enCola} format="entero" />
              </div>
              <div className="text-xs text-mute">en cola de auditoría, de {contratos.toLocaleString("es-PE")} registradas</div>
            </div>
            {financiable && ubigeo ? (
              <Link
                href={`/app/financiar/${ubigeo}`}
                className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper transition-transform hover:scale-[1.02]"
              >
                Financiar la auditoría de {zonaNombre ?? DEPARTAMENTO[ubigeo.slice(0, 2)]}
                <ChevronRight size={15} aria-hidden />
              </Link>
            ) : (
              <p className="text-sm text-mute">
                {enCola === 0
                  ? "Sin contratos pendientes de esta entidad en la cola."
                  : "Todavía no sabemos a qué zona pertenece esta entidad, así que no se puede financiar su auditoría desde aquí."}
              </p>
            )}
          </div>
          <p className="mt-3 text-[11px] text-mute">Los contratos se asignan por antigüedad dentro de la zona; no se puede elegir una entidad concreta.</p>
        </div>
        <div className="surface p-5">
          <h2 className="font-serif text-lg font-bold text-ink">Puntaje de riesgo</h2>
          <p className="text-xs text-mute">
            Promedio, de 0 a 100, del puntaje de sus contratos con señales. Cada contrato suma el peso de sus señales según
            su severidad. No es una probabilidad de delito.
          </p>
          {publicadas.length ? (
            <>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-mono text-6xl font-bold text-ink">
                  <NumberTicker value={puntaje} format="entero" />
                </span>
                <span className="text-mute">de 100</span>
              </div>
              <ScoreBar value={puntaje} />
            </>
          ) : (
            <p className="mt-4 text-sm text-mute">Sin contratos con señales publicadas: no hay puntaje que promediar.</p>
          )}
        </div>
      </section>

      {/* Ejecución presupuestal MEF (real): colapsada, es la sección más densa y no
          lo primero que busca quien vino a ver los contratos con señales. */}
      <details className="group">
        <summary className="surface flex cursor-pointer items-center gap-2.5 px-5 py-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-paper">
          <Coins size={15} className="shrink-0 text-heroViolet" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-ink">Ejecución presupuestal (MEF)</div>
            <div className="text-[11px] text-mute">Gasto real frente al presupuesto asignado de {nombre}</div>
          </div>
          <ChevronRight size={15} className="shrink-0 text-mute transition-transform duration-200 group-open:rotate-90" aria-hidden />
        </summary>
        <div className="mt-3">
          <Suspense fallback={<div className="surface flex h-40 items-center justify-center text-sm text-mute">Consultando los datos abiertos del MEF…</div>}>
            <EjecucionPresupuestal
              query={mefSearchKeywordFor(nombre)}
              ruc={e.ruc}
              title="Ejecución presupuestal"
              subtitle={`${nombre}, datos del MEF`}
            />
          </Suspense>
        </div>
      </details>

      <section className="surface overflow-hidden p-0">
        <div className="border-b border-line bg-paperDeep px-6 py-4">
          <h2 className="font-serif text-xl font-bold text-ink">
            Contratos con señales ({publicadas.length}
            {truncada ? ` de ${nAlertas}` : ""})
          </h2>
          <p className="text-sm text-mute">
            Contratos de esta entidad que Vigía leyó y en los que encontró señales de riesgo. Para que lea otros, se
            financia la auditoría de su zona.
          </p>
        </div>
        {publicadas.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-2xl bg-paperDeep text-mute" aria-hidden>
              <FileText size={18} />
            </span>
            <p className="max-w-sm text-sm text-mute">
              Todavía no hay contratos de esta entidad con señales publicadas. Aparecen aquí cuando Vigía lee uno y
              encuentra algo.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {publicadas.map((a) => {
              const codigo = String(a.codigo_convocatoria ?? a.codigo ?? "").replace(/^OECE-/, "");
              const fecha = fechaLima(a.fecha_buena_pro);
              return (
                <li key={a.id}>
                  <Link href={`/app/convocatoria/${encodeURIComponent(codigo)}`} className="group flex items-center gap-4 px-6 py-4 transition-colors hover:bg-paperDeep">
                    <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-ink text-paper">
                      <span className="text-xl font-bold leading-none">{Number(a.score) || 0}</span>
                      <span className="text-[9px] uppercase tracking-wider text-paper/80">puntaje</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 text-xs text-mute">
                        <span className="font-mono">{codigo}</span>
                        {fecha && <span>buena pro: {fecha}</span>}
                      </div>
                      <div className="line-clamp-2 text-sm font-semibold text-ink md:truncate">{a.objeto || "Contrato sin objeto registrado"}</div>
                    </div>
                    {a.monto_adjudicado != null && (
                      <div className="hidden text-right md:block">
                        <div className="font-mono text-sm font-semibold text-ink">{formatSoles(Number(a.monto_adjudicado) || 0)}</div>
                        <div className="text-xs text-mute">adjudicado</div>
                      </div>
                    )}
                    <ChevronRight size={16} className="shrink-0 text-mute transition-colors group-hover:text-heroViolet" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function NoSePudoLeer({ ruc }: { ruc: string }) {
  return (
    <div className="container-page space-y-6 py-10">
      <Link href="/app/entidades" className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink">
        <ArrowLeft size={16} aria-hidden /> Volver al ranking
      </Link>
      <div className="rounded-2xl border border-dashed border-line bg-paperSoft/60 px-6 py-10 text-center">
        <span className="inline-flex text-mute" aria-hidden>
          <WifiOff size={18} />
        </span>
        <h1 className="mt-2 font-serif text-lg font-bold text-ink">No pudimos leer la ficha de esta entidad</h1>
        <p className="mx-auto mt-1 max-w-[60ch] text-[13.5px] leading-relaxed text-mute">
          El servidor de Vigía no respondió. No mostramos nada en su lugar: vuelve a intentarlo en un momento.
        </p>
        <div className="mt-4 text-sm">
          <Link href={`/entidad/${encodeURIComponent(ruc)}`} className="font-medium text-heroViolet hover:underline">
            Reintentar
          </Link>
        </div>
      </div>
    </div>
  );
}

function KPI({
  icon,
  label,
  value,
  hint,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  hint: string;
  tone: "amber" | "ink" | "heroViolet";
}) {
  const styles = {
    amber: "bg-amber-soft text-amberTexto",
    ink: "bg-paperDeep text-ink",
    heroViolet: "bg-heroViolet-soft text-heroViolet",
  }[tone];
  return (
    <div className="surface p-5">
      <span className={`inline-flex h-9 w-9 items-center justify-center rounded-xl ${styles}`} aria-hidden>
        {icon}
      </span>
      <div className="mt-3 font-mono text-2xl font-bold text-ink">{value}</div>
      <div className="text-sm font-medium text-ink">{label}</div>
      <div className="text-xs text-mute">{hint}</div>
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

function ScoreBar({ value }: { value: number }) {
  // Mismos tokens que el resto de la ficha: rust/amber/clay para los tres
  // niveles, moss para un puntaje bajo.
  const tono = value >= 80 ? "bg-rust" : value >= 60 ? "bg-amber" : value >= 30 ? "bg-clay" : "bg-moss";
  return (
    <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-paperDeep" role="img" aria-label={`Puntaje ${value} de 100`}>
      <div className={`h-full transition-[width] duration-700 ease-out ${tono}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
