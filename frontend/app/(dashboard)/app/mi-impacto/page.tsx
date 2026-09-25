"use client";

/**
 * Mi impacto (con sesión): mis aportes con progreso en vivo, contratos con señales y comprobante;
 * mis denuncias con su estado; zonas y entidades que sigo.
 * Sin sesión → invitación a entrar (todo lo demás del sitio sigue funcionando sin cuenta).
 * `?aporte=VIG-…` (viene del comprobante) → formulario para asociar un aporte hecho como invitado.
 *
 * Palabras (DESIGN_SYSTEM.md §10.1): "leídos" = contratos cuyo análisis terminó; "con señales" =
 * contratos con al menos una señal publicada (así cuenta el API: `EXISTS banderas`), no señales
 * sueltas. Antes decía "procesados" y "señales halladas", que en otras páginas contaban otra cosa.
 */

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MapPin, Camera, ArrowRight, Loader2, Building2, Bell, Link2, LogIn, ExternalLink, CheckCircle2, Clock, XCircle, GitMerge, Lock, type LucideIcon } from "lucide-react";
import { Cargando, Cifra, EncabezadoPagina, EstadoError, EstadoVacio } from "@/components/patrones";
import { EstadoAporte, indicePaso } from "@/components/financiar/EstadoAporte";
import { SubirComprobante } from "@/components/financiar/SubirComprobante";
import { PulseDot } from "@/components/ui/PulseDot";
import { useAuth } from "@/components/auth/AuthProvider";
import { dejarDeSeguir, getImpacto, reclamarAporte, type DenunciaMia, type Impacto } from "@/lib/cuentas";
import { ESTADO_FILL, ESTADO_LABEL, pct, type ZonaEstado } from "@/lib/financiamiento";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { fechaCorta, numero, plural, soles } from "@/lib/formato";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { cn } from "@/lib/utils";

/** Enlace de acción secundaria junto al título de una sección. */
const ENLACE_SECCION = "inline-flex min-h-[24px] items-center gap-1 text-[13px] font-medium text-granate underline-offset-2 hover:underline";
/** Tarjeta de una fila de lista: borde, sin sombra en reposo; al pasar, el borde toma la marca. */
const FILA = "rounded-xl border border-line bg-paper transition-colors duration-rapido hover:border-granate/30";
/** "Dejar de seguir": objetivo táctil de 24 px, neutro (no es un error ni un riesgo). */
const DEJAR = "min-h-[24px] shrink-0 rounded-full px-2 text-xs text-inkSoft underline-offset-2 transition-colors duration-rapido hover:bg-paperDeep hover:text-ink hover:underline";

/** Categorías de las denuncias a una ENTIDAD: nunca se publican (backend/api/src/lib/publicacion.ts, regla 3). */
const CATEGORIAS_ENTIDAD = new Set(["malversacion", "conflicto_interes", "favoritismo", "obstruccion", "patron_corrupcion", "otra_entidad"]);
const esDeEntidad = (d: Pick<DenunciaMia, "id" | "categoria">) => d.id.startsWith("RPT-ENT-") || CATEGORIAS_ENTIDAD.has(d.categoria);

export default function MiImpactoPage() {
  return (
    <div className="space-y-6 px-4 py-8 sm:px-6 lg:px-10">
      <EncabezadoPagina
        titulo="Mi impacto"
        bajada="Tus aportes con su progreso en vivo, tus denuncias y las zonas que sigues. Todo lo que financias es público; esta página sólo lo reúne para ti."
      />
      <Suspense fallback={<Cargando texto="Cargando tu cuenta…" />}>
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

  if (loading || (user && cargando && !data)) return <Cargando texto="Cargando tu cuenta…" lineas={4} />;
  if (!user) return <SinSesion />;
  if (error && !data) {
    return (
      <EstadoError
        titulo="No pudimos cargar tu cuenta"
        detalle={error}
        accion={
          <button type="button" onClick={cargar} className="inline-flex min-h-[44px] items-center rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
            Reintentar
          </button>
        }
      />
    );
  }
  if (!data) return null;

  const { aportes, denuncias, zonasSeguidas, entidadesSeguidas, resumen } = data;
  const yaTiene = aporteParam ? aportes.some((a) => a.codigo === aporteParam.toUpperCase()) : false;
  const nada = !aportes.length && !denuncias.length && !zonasSeguidas.length && !entidadesSeguidas.length;

  // Todavía nada con esta cuenta: un solo vacío (con la llamita) en vez de cuatro secciones vacías.
  if (nada) {
    return (
      <div className="space-y-6">
        {aporteParam && !yaTiene && <Reclamar codigo={aporteParam.toUpperCase()} onOk={cargar} />}
        <EstadoVacio
          titulo="Todavía no hay nada con esta cuenta"
          accion={
            <div className="flex flex-wrap justify-center gap-2">
              <Link href="/app/financiar" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
                Financiar la lectura de una zona <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/reporte/nuevo" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-paper px-5 py-2 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50">
                Denunciar una obra
              </Link>
            </div>
          }
        >
          Aquí se juntan tus aportes, tus denuncias enviadas con sesión y las zonas y entidades que sigues. Si
          financiaste como invitado, abre tu comprobante <span className="font-mono text-ink">/impacto/VIG-…</span> y
          asócialo desde ahí.
        </EstadoVacio>
      </div>
    );
  }

  // Cifras con su contexto (§10.2), sólo con lo que el usuario realmente tiene: nada de ceros decorativos.
  const resumenTiles: { k: string; v: number; contexto: string }[] = [];
  if (aportes.length > 0) {
    resumenTiles.push(
      { k: "Aportes", v: aportes.length, contexto: "hechos con esta cuenta" },
      { k: "Contratos financiados", v: resumen.contratosFinanciados, contexto: "en aportes ya validados" },
      { k: "Leídos", v: resumen.procesados, contexto: `de ${numero(resumen.contratosFinanciados)} financiados` },
      { k: "Con señales", v: resumen.senales, contexto: `de ${numero(resumen.procesados)} leídos; al menos una señal publicada` },
    );
  } else if (denuncias.length > 0) {
    // Sin aportes, las denuncias son su única cifra de impacto: vale mostrarla arriba.
    resumenTiles.push({ k: "Denuncias enviadas", v: denuncias.length, contexto: "con esta cuenta" });
  }

  return (
    <div className="space-y-8">
      {aporteParam && !yaTiene && <Reclamar codigo={aporteParam.toUpperCase()} onOk={cargar} />}

      {resumenTiles.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {resumenTiles.map((t) => (
            <div key={t.k} className="rounded-2xl border border-line bg-paper p-4">
              <Cifra valor={numero(t.v)} etiqueta={t.k} contexto={t.contexto} />
            </div>
          ))}
        </div>
      )}

      {/* Aportes */}
      <section aria-labelledby="mis-aportes">
        <CabeceraSeccion id="mis-aportes" titulo="Mis aportes" n={aportes.length}>
          <Link href="/app/financiar" className={ENLACE_SECCION}>Financiar otra zona <ArrowRight size={13} aria-hidden /></Link>
        </CabeceraSeccion>
        {aportes.length === 0 ? (
          <VacioSeccion icon={Building2}>
            <p>Todavía no tienes aportes con esta cuenta. Si financiaste como invitado, abre tu comprobante <span className="font-mono text-ink">/impacto/VIG-…</span> y asócialo desde ahí.</p>
            <Link href="/app/mapa" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Elegir una zona en el mapa <ArrowRight size={14} aria-hidden /></Link>
          </VacioSeccion>
        ) : (
          <ul className="mt-3 space-y-3">
            {aportes.map((a) => {
              const paso = indicePaso(a.estado, a.procesados, a.contratos);
              const p = pct(a.procesados, a.contratos);
              return (
                <li key={a.codigo} className="rounded-2xl border border-line bg-paper p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link href={`/impacto/${a.codigo}`} className="font-mono text-lg font-bold text-ink underline-offset-2 hover:underline" translate="no">{a.codigo}</Link>
                        <span className="text-sm tabular-nums text-inkSoft">{plural(a.contratos, "contrato", "contratos")} por {soles(a.montoPen)}</span>
                      </div>
                      <div className="mt-0.5 inline-flex items-center gap-1 text-sm text-ink">
                        <MapPin size={14} className="text-mute" aria-hidden />
                        <Link href={`/app/financiar/${a.ubigeo}`} className="underline-offset-2 hover:underline">{a.zona}</Link>
                        <span className="ml-1.5 text-xs text-mute">{a.nivel}</span>
                      </div>
                    </div>
                    <div className="text-right text-xs tabular-nums text-mute">
                      Registrado el {fechaCorta(a.createdAt)}
                      {a.pagadaAt && <><br />validado el {fechaCorta(a.pagadaAt)}</>}
                    </div>
                  </div>
                  <div className="mt-3"><EstadoAporte estado={a.estado} procesados={a.procesados} contratos={a.contratos} compacto /></div>
                  {paso >= 1 && (
                    <div className="mt-3">
                      <div className="flex flex-wrap justify-between gap-x-3 text-xs tabular-nums text-inkSoft">
                        <span className="inline-flex items-center gap-1.5">
                          {paso === 2 && <PulseDot color="moss" size={6} />}
                          {numero(a.procesados)} de {plural(a.contratos, "leído", "leídos")}
                          {a.enRevision > 0 ? `, ${numero(a.enRevision)} en revisión` : ""}
                        </span>
                        <span>{plural(a.senales, "contrato con señales", "contratos con señales")}</span>
                      </div>
                      <div className="mt-1 h-2 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={p} aria-valuemin={0} aria-valuemax={100} aria-label={`Contratos leídos del aporte ${a.codigo}`}>
                        <div className="h-full rounded-full bg-moss" style={{ width: `${p}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                    <Link href={`/impacto/${a.codigo}`} className="inline-flex min-h-[24px] items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline">Comprobante público <ArrowRight size={13} aria-hidden /></Link>
                    {a.primerOcid && <Link href={`/app/auditoria/${encodeURIComponent(a.primerOcid)}`} className="min-h-[24px] text-inkSoft underline-offset-2 hover:text-ink hover:underline">Primer contrato leído</Link>}
                    {a.comprobanteUrl && <a href={a.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[24px] items-center gap-1 text-inkSoft underline-offset-2 hover:text-ink hover:underline">Mi comprobante de pago <ExternalLink size={12} aria-hidden /></a>}
                  </div>
                  {/* Pendiente y sin comprobante: se sube acá mismo (antes el enlace llevaba a un formulario nuevo, en blanco). */}
                  {a.estado === "pendiente_pago" && !a.tieneComprobante && (
                    <div className="mt-3 border-t border-line pt-3">
                      <p className="mb-2 text-[13px] text-inkSoft">Envía la captura o constancia de tu pago para que podamos validarlo.</p>
                      <SubirComprobante codigo={a.codigo} onSubido={cargar} compacto />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Denuncias */}
      <section aria-labelledby="mis-denuncias">
        <CabeceraSeccion id="mis-denuncias" titulo="Mis denuncias" n={denuncias.length}>
          <Link href="/reporte/nuevo" className={ENLACE_SECCION}>Denunciar <ArrowRight size={13} aria-hidden /></Link>
        </CabeceraSeccion>
        {denuncias.length === 0 ? (
          <VacioSeccion icon={Camera}>
            <p>No hay denuncias asociadas a tu cuenta. Las que envías con sesión aparecen aquí con su estado; en público se siguen mostrando sin tu nombre.</p>
            <Link href="/reporte/nuevo" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Enviar tu primera denuncia <ArrowRight size={14} aria-hidden /></Link>
          </VacioSeccion>
        ) : (
          <ul className="mt-3 space-y-2">
            {denuncias.map((d) => {
              const meta = CATEGORIA_META[d.categoria as CategoriaDenuncia];
              const Icon = meta?.icon ?? Camera;
              const reservada = esDeEntidad(d);
              const cuerpo = (
                <>
                  <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${meta?.tone ?? "border-line bg-paperDeep text-mute"}`} aria-hidden>
                    <Icon size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{d.descripcion}</p>
                    <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs text-mute">
                      <span>{meta?.label ?? d.categoria}</span>
                      <span className="truncate">{[d.distrito, d.provincia, d.region].filter(Boolean).join(", ") || "Sin zona"}</span>
                      <span className="shrink-0 tabular-nums">{fechaCorta(d.createdAt)}</span>
                    </div>
                  </div>
                  <EstadoDenuncia estado={d.moderacionEstado} confirmado={d.confirmado} convergencia={!!d.convergenciaId} reservada={reservada} />
                </>
              );
              return (
                <li key={d.id}>
                  {/* Una denuncia a una entidad no tiene ficha pública: no se enlaza a una página que no existe. */}
                  {reservada ? (
                    <div className={cn(FILA, "flex items-start gap-3 p-3 hover:border-line")}>{cuerpo}</div>
                  ) : (
                    <Link href={`/app/denuncias/${d.id}`} className={cn(FILA, "flex items-start gap-3 p-3")}>{cuerpo}</Link>
                  )}
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
          <CabeceraSeccion id="mis-zonas" titulo="Zonas que sigo" n={zonasSeguidas.length}>
            <Link href="/app/mapa" className={ENLACE_SECCION}>Seguir otra desde el mapa <ArrowRight size={13} aria-hidden /></Link>
          </CabeceraSeccion>
          {zonasSeguidas.length === 0 ? (
            <VacioSeccion icon={MapPin}>
              <p>Sigue una zona desde el panel del mapa para verla aquí y resaltarla con el chip «Mis zonas».</p>
              <Link href="/app/mapa" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Abrir el mapa <ArrowRight size={14} aria-hidden /></Link>
            </VacioSeccion>
          ) : (
            <ul className="mt-3 space-y-2">
              {zonasSeguidas.map((z) => {
                const regionId = UBIGEO_REGION[z.ubigeo.slice(0, 2)];
                return (
                  <li key={z.ubigeo} className={cn(FILA, "flex items-center gap-3 px-3 py-2.5")}>
                    <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: ESTADO_FILL[z.estado as ZonaEstado] ?? ESTADO_FILL.sin_datos }} aria-hidden />
                    <div className="min-w-0 flex-1">
                      <Link href={regionId ? `/app/mapa?region=${regionId}` : `/app/financiar/${z.ubigeo}`} className="block truncate text-sm font-medium text-ink underline-offset-2 hover:underline">{z.nombre}</Link>
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-xs tabular-nums text-mute">
                        <span>{z.nivel}</span>
                        <span>{ESTADO_LABEL[z.estado as ZonaEstado] ?? z.estado}</span>
                        <span>{numero(z.totalCola)} en cola</span>
                        <span>{plural(z.procesados, "leído", "leídos")}</span>
                        <span>{numero(z.senales)} con señales</span>
                      </div>
                    </div>
                    <button type="button" onClick={() => dejarDeSeguir("zona", z.ubigeo).then(cargar)} className={DEJAR}>Dejar de seguir</button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="mis-entidades">
          <CabeceraSeccion id="mis-entidades" titulo="Entidades que sigo" n={entidadesSeguidas.length} />
          {entidadesSeguidas.length === 0 ? (
            <VacioSeccion icon={Building2}>
              <p>Puedes seguir una entidad desde su ficha para verla aquí.</p>
              <Link href="/app/entidades" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Ver entidades <ArrowRight size={14} aria-hidden /></Link>
            </VacioSeccion>
          ) : (
            <ul className="mt-3 space-y-2">
              {entidadesSeguidas.map((e) => (
                <li key={e.ruc} className={cn(FILA, "flex items-center gap-3 px-3 py-2.5")}>
                  <Building2 size={14} className="shrink-0 text-mute" aria-hidden />
                  <Link href={`/entidad/${e.ruc}`} className="min-w-0 flex-1 truncate text-sm font-medium text-ink underline-offset-2 hover:underline">{e.nombre}</Link>
                  <button type="button" onClick={() => dejarDeSeguir("entidad", e.ruc).then(cargar)} className={DEJAR}>Dejar de seguir</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p className="flex items-start gap-2 rounded-xl border border-line bg-paperSoft p-4 text-[13px] text-inkSoft">
        <Bell size={16} className="mt-0.5 shrink-0 text-mute" aria-hidden />
        <span>Los avisos por correo (cuando se lea un contrato que financiaste o haya señales en tu zona) se configuran en <Link href="/app/configuracion" className="font-medium text-granate underline underline-offset-2">Configuración</Link>. Por ahora sólo guardamos tu preferencia: todavía no enviamos correos.</span>
      </p>
    </div>
  );
}

// ─── piezas ──────────────────────────────────────────────────────────────────

/** Título de sección (h2) con su conteo y una acción opcional a la derecha. */
function CabeceraSeccion({ id, titulo, n, children }: { id: string; titulo: string; n: number; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 id={id} className="font-display text-lg font-bold text-ink">
        {titulo} <span className="font-sans text-sm font-normal tabular-nums text-mute">({numero(n)})</span>
      </h2>
      {children}
    </div>
  );
}

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
    <form onSubmit={enviar} className="rounded-2xl border border-granate/30 bg-granate-50 p-5">
      <h2 className="inline-flex flex-wrap items-center gap-2 font-display text-[15px] font-bold text-ink">
        <Link2 size={16} className="text-granate" aria-hidden /> Asociar el aporte <span className="font-mono" translate="no">{codigo}</span> a tu cuenta
      </h2>
      <p className="mt-1 text-[13px] text-inkSoft">Escribe el correo que usaste al aportar (es la prueba de que es tuyo; el código es público).</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.pe" className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink placeholder:text-mute focus:border-granate" aria-label="Correo usado en el aporte" />
        <button type="submit" disabled={estado === "enviando"} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-60">
          {estado === "enviando" && <Loader2 size={14} className="animate-spin" aria-hidden />} Asociar
        </button>
      </div>
      {msg && <p className="mt-2 text-[13px] text-crimsonTexto" role="alert">{msg === "email_mismatch" ? "El correo no coincide con el usado en el aporte." : msg}</p>}
    </form>
  );
}

/**
 * Estado de una denuncia propia, con las palabras de /app/denuncias: una denuncia de obra
 * se publica al llegar (salvo que se rechace) y "confirmada" es la que respaldan dos o más
 * reportes. Antes decía "En validación" de algo que ya era público, y "Verificada" donde la
 * página pública dice "confirmada".
 */
function EstadoDenuncia({ estado, confirmado, convergencia, reservada }: { estado: string; confirmado: boolean; convergencia: boolean; reservada: boolean }) {
  const rechazada = estado === "rechazado";
  const [label, cls, Icon]: [string, string, LucideIcon] = reservada
    ? ["En reserva, no se publica", "border-line bg-paperDeep text-inkSoft", Lock]
    : convergencia
      ? ["Coincide con un contrato", "border-ink bg-ink text-paper", GitMerge]
      : confirmado
        ? ["Confirmada", "border-moss/30 bg-moss/10 text-mossTexto", CheckCircle2]
        : rechazada
          ? ["No publicada", "border-line bg-paperDeep text-inkSoft", XCircle]
          : ["Publicada, sin confirmar", "border-line bg-paper text-inkSoft", Clock];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
      <Icon size={12} className={convergencia && !reservada ? "text-maiz" : ""} aria-hidden /> {label}
    </span>
  );
}

/**
 * Vacío de UNA sección, sin llamita: en esta página pueden convivir varios y la llamita
 * va una sola vez por pantalla (DESIGN_SYSTEM.md §2.4). Cuando la cuenta no tiene nada,
 * se muestra un único `EstadoVacio` con la llamita en su lugar.
 */
function VacioSeccion({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="mt-3 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-paperSoft p-6 text-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-mute" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="max-w-sm text-sm text-inkSoft">{children}</div>
    </div>
  );
}

function SinSesion() {
  return (
    <EstadoVacio
      titulo="Mi impacto necesita una cuenta"
      accion={
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/login?next=/app/mi-impacto" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"><LogIn size={16} aria-hidden /> Entrar</Link>
          <Link href="/signup?next=/app/mi-impacto" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-paper px-5 py-2 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50">Crear cuenta</Link>
        </div>
      }
    >
      Sin cuenta puedes ver todo, financiar como invitado (con tu código VIG-… ves el comprobante) y denunciar sin tu
      nombre. Con cuenta, además, reúnes aquí tus aportes, denuncias y zonas seguidas.
    </EstadoVacio>
  );
}
