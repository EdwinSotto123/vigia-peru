"use client";

/**
 * Mi impacto (con sesión): mis aportes con progreso en vivo, señales halladas y comprobante;
 * mis denuncias con estado de moderación; zonas y entidades que sigo.
 * Sin sesión → invitación a entrar (todo lo demás del sitio sigue funcionando sin cuenta).
 * `?aporte=VIG-…` (viene del comprobante) → formulario para asociar un aporte hecho como invitado.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Heart, MapPin, Camera, ArrowRight, Loader2, Eye, Building2, Bell, Link2, LogIn, ExternalLink, CheckCircle2, Clock, XCircle, GitMerge, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { EstadoAporte, indicePaso } from "@/components/financiar/EstadoAporte";
import { PulseDot } from "@/components/ui/PulseDot";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuth } from "@/components/auth/AuthProvider";
import { dejarDeSeguir, getImpacto, reclamarAporte, type Impacto } from "@/lib/cuentas";
import { ESTADO_FILL, ESTADO_LABEL, formatPEN, pct, type ZonaEstado } from "@/lib/financiamiento";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { UBIGEO_REGION } from "@/components/mapa/region-match";

export default function MiImpactoPage() {
  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader title="Mi impacto" subtitle="Tus aportes con su progreso en vivo, tus denuncias y las zonas que sigues. Todo lo que financias es público; esta página solo lo reúne para ti." />
      <Suspense fallback={<Cargando />}>
        <Contenido />
      </Suspense>
    </div>
  );
}

function Contenido() {
  const { user, loading } = useAuth();
  const search = useSearchParams();
  const aporteParam = search.get("aporte");
  const [data, setData] = useState<Impacto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = () => {
    setCargando(true);
    getImpacto().then(setData).catch((e) => setError((e as Error).message)).finally(() => setCargando(false));
  };
  useEffect(() => {
    if (loading) return;
    if (!user) { setCargando(false); return; }
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  if (loading || (user && cargando && !data)) return <Cargando />;
  if (!user) return <SinSesion />;
  if (error && !data) return <p className="rounded-2xl border border-line bg-paper p-6 text-sm text-rust shadow-card">No pudimos cargar tu cuenta: {error}</p>;
  if (!data) return null;

  const { aportes, denuncias, zonasSeguidas, entidadesSeguidas, resumen } = data;
  const yaTiene = aporteParam ? aportes.some((a) => a.codigo === aporteParam.toUpperCase()) : false;

  // Datos como tarjetas, no como prosa: un resumen de cifras al tope, solo con lo que el
  // usuario realmente tiene (nada de ceros decorativos).
  const resumenTiles: { k: string; v: number; hint?: string }[] = [];
  if (aportes.length > 0) {
    resumenTiles.push(
      { k: "Aportes", v: aportes.length },
      { k: "Contratos financiados", v: resumen.contratosFinanciados },
      { k: "Procesados", v: resumen.procesados },
      { k: "Señales halladas", v: resumen.senales, hint: "alertas publicadas gracias a tus aportes" },
    );
  } else if (denuncias.length > 0) {
    // Sin aportes, el resumen se quedaba sin ninguna tarjeta aunque el usuario sí tenga
    // actividad real (denuncias) — es su única cifra de impacto, vale mostrarla arriba.
    // Con aportes, esta cuenta ya queda cubierta por el encabezado de "Mis denuncias".
    resumenTiles.push({ k: "Denuncias enviadas", v: denuncias.length });
  }

  return (
    <div className="space-y-8">
      {aporteParam && !yaTiene && <Reclamar codigo={aporteParam.toUpperCase()} onOk={cargar} />}

      {resumenTiles.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {resumenTiles.map((t, i) => <Cifra key={t.k} i={i} k={t.k} v={t.v} hint={t.hint} />)}
        </dl>
      )}

      {/* Aportes */}
      <section aria-labelledby="mis-aportes">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="mis-aportes" className="font-semibold text-ink">Mis aportes <span className="font-normal text-mute">({aportes.length})</span></h2>
          <Link href="/app/financiar" className="text-xs text-mute hover:text-ink hover:underline">Financiar otra zona →</Link>
        </div>
        {aportes.length === 0 ? (
          <EstadoVacio icon={Heart}>
            <p>Todavía no tienes aportes con esta cuenta. Si financiaste como invitado, abre tu comprobante <span className="font-mono text-ink">/impacto/VIG-…</span> y asócialo desde ahí.</p>
            <Link href="/app/mapa" className="mt-3 inline-flex items-center gap-1 font-semibold text-heroViolet hover:underline">Elegir una zona en el mapa <ArrowRight size={14} aria-hidden /></Link>
          </EstadoVacio>
        ) : (
          <ul className="mt-2 space-y-3">
            {aportes.map((a, i) => {
              const paso = indicePaso(a.estado, a.procesados, a.contratos);
              const p = pct(a.procesados, a.contratos);
              return (
                // Cada aporte entra en cascada (tope ~840ms para que una cuenta con
                // muchos aportes no se sienta lenta): son unidades independientes, no
                // pasos de un flujo — el mismo criterio que ya usa ConfianzaSection.
                <li className="rounded-2xl border border-line bg-paper p-4 shadow-card transition-shadow duration-200 hover:shadow-paper">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={`/impacto/${a.codigo}`} className="font-mono text-lg font-bold text-ink hover:underline">{a.codigo}</Link>
                        <span className="text-sm text-mute">{a.contratos} contratos · {formatPEN(a.montoPen)}</span>
                      </div>
                      <div className="mt-0.5 inline-flex items-center gap-1 text-sm text-ink">
                        <MapPin size={13} className="text-mute" aria-hidden />
                        <Link href={`/app/financiar/${a.ubigeo}`} className="hover:underline">{a.zona}</Link>
                        <span className="text-[11px] text-mute">· {a.nivel}</span>
                      </div>
                    </div>
                    <div className="text-right text-[11px] text-mute">
                      registrado el {new Date(a.createdAt).toLocaleDateString("es-PE")}
                      {a.pagadaAt && <><br />validado el {new Date(a.pagadaAt).toLocaleDateString("es-PE")}</>}
                    </div>
                  </div>
                  <div className="mt-3"><EstadoAporte estado={a.estado} procesados={a.procesados} contratos={a.contratos} compacto /></div>
                  {paso >= 1 && (
                    <div className="mt-3">
                      <div className="flex justify-between text-[11px] text-mute">
                        <span className="inline-flex items-center gap-1.5">
                          {paso === 2 && <PulseDot color="moss" size={6} />}
                          {a.procesados} de {a.contratos} procesados{a.enRevision > 0 ? ` · ${a.enRevision} en revisión humana` : ""}
                        </span>
                        <span>{a.senales} señal{a.senales === 1 ? "" : "es"} hallada{a.senales === 1 ? "" : "s"}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100}>
                        <div className="h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                    <Link href={`/impacto/${a.codigo}`} className="inline-flex items-center gap-1 font-semibold text-ink hover:underline">Comprobante público <ArrowRight size={12} aria-hidden /></Link>
                    {a.primerOcid && <Link href={`/app/auditoria/${encodeURIComponent(a.primerOcid)}`} className="text-mute hover:text-ink hover:underline">Primer contrato procesado</Link>}
                    {a.estado === "pendiente_pago" && !a.tieneComprobante && (
                      <Link href={`/app/financiar/${a.ubigeo}`} className="text-clay hover:underline">Enviar comprobante de pago</Link>
                    )}
                    {a.comprobanteUrl && <a href={a.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-mute hover:text-ink hover:underline">Mi comprobante de pago <ExternalLink size={11} aria-hidden /></a>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Denuncias */}
      <section aria-labelledby="mis-denuncias">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="mis-denuncias" className="font-semibold text-ink">Mis denuncias <span className="font-normal text-mute">({denuncias.length})</span></h2>
          <Link href="/reporte/nuevo" className="text-xs text-mute hover:text-ink hover:underline">Denunciar →</Link>
        </div>
        {denuncias.length === 0 ? (
          <EstadoVacio icon={Camera}>
            <p>No hay denuncias asociadas a tu cuenta. Las que envías con sesión aparecen aquí con su estado de moderación (las anónimas siguen siendo anónimas en público).</p>
            <Link href="/reporte/nuevo" className="mt-3 inline-flex items-center gap-1 font-semibold text-heroViolet hover:underline">Enviar tu primera denuncia <ArrowRight size={14} aria-hidden /></Link>
          </EstadoVacio>
        ) : (
          <ul className="mt-2 space-y-2">
            {denuncias.map((d) => {
              const meta = CATEGORIA_META[d.categoria as CategoriaDenuncia];
              const Icon = meta?.icon ?? Camera;
              return (
                <li key={d.id}>
                  <Link href={`/app/denuncias/${d.id}`} className="flex items-start gap-3 rounded-xl border border-line bg-paper p-3 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-paper">
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${meta?.tone ?? "border-line bg-paperDeep text-mute"}`} aria-hidden>
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{d.descripcion}</p>
                      <div className="truncate text-[11px] text-mute">
                        {meta?.label ?? d.categoria} · {[d.distrito, d.provincia, d.region].filter(Boolean).join(", ") || "sin zona"} · {new Date(d.createdAt).toLocaleDateString("es-PE")}
                      </div>
                    </div>
                    <ModeracionPill estado={d.moderacionEstado} confirmado={d.confirmado} convergencia={!!d.convergenciaId} />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Zonas y entidades seguidas — cada una en su propia <section> con su propio
          aria-labelledby (antes compartían uno solo, que nombraba "zonas" y dejaba la
          lista de entidades sin etiqueta propia para lectores de pantalla). */}
      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="mis-zonas">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="mis-zonas" className="font-semibold text-ink">Zonas que sigo <span className="font-normal text-mute">({zonasSeguidas.length})</span></h2>
            <Link href="/app/mapa" className="text-xs text-mute hover:text-ink hover:underline">Seguir otra desde el mapa →</Link>
          </div>
          {zonasSeguidas.length === 0 ? (
            <EstadoVacio icon={MapPin}>
              <p>Sigue una zona desde el panel del mapa para verla aquí y resaltarla con el chip “Mis zonas”.</p>
              <Link href="/app/mapa" className="mt-3 inline-flex items-center gap-1 font-semibold text-heroViolet hover:underline">Abrir el mapa <ArrowRight size={14} aria-hidden /></Link>
            </EstadoVacio>
          ) : (
            <ul className="mt-2 space-y-2">
              {zonasSeguidas.map((z) => {
                const regionId = UBIGEO_REGION[z.ubigeo.slice(0, 2)];
                return (
                  <li key={z.ubigeo} className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-paper">
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ESTADO_FILL[z.estado as ZonaEstado] ?? "#ccc" }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link href={regionId ? `/app/mapa?region=${regionId}` : `/app/financiar/${z.ubigeo}`} className="block truncate text-sm font-medium text-ink hover:underline">{z.nombre}</Link>
                      <div className="truncate text-[11px] text-mute">{z.nivel} · {ESTADO_LABEL[z.estado as ZonaEstado] ?? z.estado} · {z.totalCola.toLocaleString("es-PE")} en cola · {z.procesados} procesados · {z.senales} señales</div>
                    </div>
                    <button type="button" onClick={() => dejarDeSeguir("zona", z.ubigeo).then(cargar)} className="shrink-0 text-[11px] text-mute hover:text-rust hover:underline">Dejar de seguir</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="mis-entidades">
          <h2 id="mis-entidades" className="font-semibold text-ink">Entidades que sigo <span className="font-normal text-mute">({entidadesSeguidas.length})</span></h2>
          {entidadesSeguidas.length === 0 ? (
            <EstadoVacio icon={Building2}>
              <p>Puedes seguir una entidad desde su ficha para verla aquí.</p>
              <Link href="/app/entidades" className="mt-3 inline-flex items-center gap-1 font-semibold text-heroViolet hover:underline">Ver entidades <ArrowRight size={14} aria-hidden /></Link>
            </EstadoVacio>
          ) : (
            <ul className="mt-2 space-y-2">
              {entidadesSeguidas.map((e) => (
                <li key={e.ruc} className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-paper">
                  <Building2 size={14} className="shrink-0 text-mute" aria-hidden />
                  <Link href={`/entidad/${e.ruc}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink hover:underline">{e.nombre}</Link>
                  <button type="button" onClick={() => dejarDeSeguir("entidad", e.ruc).then(cargar)} className="shrink-0 text-[11px] text-mute hover:text-rust hover:underline">Dejar de seguir</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-paperDeep p-4 text-[12px] text-mute">
        <Bell size={14} className="mt-0.5 shrink-0 text-clay" aria-hidden />
        <span>Los avisos por correo (cuando se procese un contrato que financiaste o haya señales en tu zona) se configuran en <Link href="/app/configuracion" className="underline hover:text-ink">Configuración</Link>. Por ahora solo guardamos tu preferencia; el envío se activará más adelante.</span>
      </p>
    </div>
  );
}

// ─── piezas ──────────────────────────────────────────────────────────────────

function Reclamar({ codigo, onOk }: { codigo: string; onOk: () => void }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEstado("enviando"); setMsg(null);
    try { await reclamarAporte(codigo, email.trim()); setEstado("ok"); onOk(); }
    catch (err) { setEstado("error"); setMsg((err as Error).message); }
  };
  if (estado === "ok") return null;
  return (
    <form onSubmit={enviar} className="animate-slideUp rounded-2xl border border-clay/40 bg-paperSoft p-5 shadow-card">
      <div className="inline-flex items-center gap-2 text-sm font-semibold text-ink"><Link2 size={14} className="text-clay" aria-hidden /> Asociar el aporte <span className="font-mono">{codigo}</span> a tu cuenta</div>
      <p className="mt-1 text-[12px] text-mute">Escribe el correo que usaste al aportar (es la prueba de que es tuyo; el código es público).</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.pe" className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2 text-sm focus:border-heroViolet focus:outline-none" aria-label="Correo usado en el aporte" />
        <button type="submit" disabled={estado === "enviando"} className="inline-flex items-center gap-1.5 rounded-lg bg-heroViolet px-3 py-2 text-sm font-semibold text-paper transition-transform hover:scale-[1.01] disabled:opacity-60">
          {estado === "enviando" && <Loader2 size={13} className="animate-spin" aria-hidden />} Asociar
        </button>
      </div>
      {msg && <p className="mt-2 text-[12px] text-rust" role="alert">{msg === "email_mismatch" ? "El correo no coincide con el usado en el aporte." : msg}</p>}
    </form>
  );
}

function ModeracionPill({ estado, confirmado, convergencia }: { estado: string; confirmado: boolean; convergencia: boolean }) {
  const verificadaOPublicada = confirmado || estado === "aprobado" || estado === "publicado";
  const label = convergencia ? "Caso convergente" : confirmado ? "Verificada" : estado === "aprobado" || estado === "publicado" ? "Publicada" : estado === "rechazado" ? "No publicada" : "En validación";
  // "Convergente" no es un error del denunciante (rust queda solo para riesgo/peligro real) —
  // DenunciasGrid ya pinta ese mismo estado en ink + ícono ámbar; acá se iguala ese vocabulario
  // en vez de inventar un segundo tratamiento de color para el mismo caso.
  const cls = convergencia ? "bg-ink text-paper" : verificadaOPublicada ? "bg-moss/10 text-moss" : estado === "rechazado" ? "bg-paperDeep text-mute" : "bg-amber-soft text-amber";
  const Icon = convergencia ? GitMerge : verificadaOPublicada ? CheckCircle2 : estado === "rechazado" ? XCircle : Clock;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      <Icon size={10} className={convergencia ? "text-amber" : ""} aria-hidden /> {label}
    </span>
  );
}

/** Estado vacío con icono + mensaje + siguiente acción real — nunca un hueco en blanco. */
function EstadoVacio({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="mt-2 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-paperSoft p-6 text-center sm:p-8">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-mute" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="max-w-sm text-sm text-mute">{children}</div>
    </div>
  );
}

// Raíz propia (no un <div> envolviendo a otro) para no romper el modelo de
// contenido de <dl>: cada tarjeta sigue siendo el único div entre <dl> y su dt/dd.
// El número cuenta desde 0 en vez de aparecer estático: es la cifra protagonista de
// cada tarjeta de resumen, el primer dato "vivo" que ve el usuario en la página.
function Cifra({ k, v, hint, i }: { k: string; v: number; hint?: string; i: number }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-card transition-shadow hover:shadow-paper">
      <dt className="text-[11px] uppercase tracking-wide text-mute">{k}</dt>
      <dd className="font-mono text-2xl font-semibold text-ink"><NumberTicker value={v} format="entero" /></dd>
      {hint && <dd className="text-[10px] text-mute">{hint}</dd>}
    </div>
  );
}

function SinSesion() {
  return (
    <div className="rounded-2xl border border-line bg-paper p-8 text-center shadow-card">
      <Eye size={28} className="mx-auto text-heroViolet" aria-hidden />
      <h2 className="mt-3 font-serif text-2xl font-bold text-ink">Mi impacto necesita una cuenta</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-mute">
        Sin cuenta puedes ver todo, financiar como invitado (con tu código VIG-… ves el comprobante) y denunciar de forma anónima.
        Con cuenta, además, reúnes aquí tus aportes, denuncias y zonas seguidas.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link href="/login?next=/app/mi-impacto" className="inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper"><LogIn size={14} aria-hidden /> Entrar</Link>
        <Link href="/signup?next=/app/mi-impacto" className="inline-flex items-center gap-1.5 rounded-full border border-line px-4 py-2 text-sm font-semibold text-ink hover:bg-paperDeep">Crear cuenta</Link>
      </div>
    </div>
  );
}

function Cargando() {
  return (
    <div className="space-y-6" aria-busy aria-label="Cargando tu cuenta">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-line bg-paper p-4 shadow-card">
            <Skeleton className="h-2.5 w-16" />
            <Skeleton className="mt-2.5 h-6 w-10" />
          </div>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div key={i} className="rounded-2xl border border-line bg-paper p-4 shadow-card">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-3 h-4 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/3" />
        </div>
      ))}
    </div>
  );
}
