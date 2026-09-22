"use client";

/**
 * Configuración de la cuenta (con sesión):
 *   · perfil público de aliado: nombre y logo si quiero aparecer en el muro; visibilidad anónimo/visible
 *   · correo opcional + preferencias de notificación (solo se guardan; el envío queda para después)
 *   · exportar mis datos (JSON) · borrar cuenta (con confirmación; los aportes se conservan anónimos)
 * Diseño: docs/design/CUENTAS.md
 *
 * Pase de sistema de diseño (sept 2026): tarjetas planas sin sombra → shadow-card (el resto del
 * sitio ya lo usa en toda bg-paper), CTA de guardar en bg-ink → bg-heroViolet (prominencia real),
 * checkbox con accent-clay decorativo → accent-heroViolet (clay/amber quedan solo para advertencia
 * real, ver EstadoPill/Bitacora), toggles sin transición → transition-colors, estado de error sin
 * acción → botón Reintentar, y una vista previa en vivo de "cómo apareces en el muro" (antes el
 * nombre/tipo/logo/visibilidad se configuraban a ciegas, sin ningún feedback del resultado).
 *
 * Iteración movimiento/densidad (sept 2026): la página era un formulario de una sola columna con
 * 5 tarjetas siempre abiertas -- mucho scroll en móvil, que es justo donde importa porque el grid
 * de 2 columnas de escritorio solo aplica desde lg:. Ahora son 3 tarjetas colapsables por tema --
 * perfil público / correo y avisos / privacidad y datos -- las dos primeras abiertas por defecto
 * (son el motivo real de la página) y "privacidad y datos" (identificador de cuenta, qué
 * guardamos, exportar, borrar cuenta) cerrada por defecto por ser lo menos usado. "Perfil público"
 * se reabre sola si falla el guardado, para que el error de validación del nombre nunca quede
 * oculto detrás de una tarjeta cerrada. (Las superficies de producto no llevan
 * components/landing/ComoFuncionaCompacto.tsx) y micro-feedback con animate-fadeIn/slideUp en
 * estados que ya eran condicionales (conflicto de visibilidad, error, confirmar borrado, botón
 * guardar) -- nada de eso existía antes, así que la página se sentía estática incluso al cambiar
 * de estado.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Settings, Eye, EyeOff, Download, Trash2, Loader2, Check, Upload, LogIn, ShieldAlert, RefreshCw, ChevronRight } from "lucide-react";
import { PageHeader } from "@/components/dashboard/PageHeader";
import { useAuth } from "@/components/auth/AuthProvider";
import { actualizarPerfil, borrarCuentaApi, exportarDatos, useCuenta, type Perfil } from "@/lib/cuentas";
import { signOut } from "@/lib/auth";
import { deleteUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";
const NOTIFS: { k: string; label: string; hint: string }[] = [
  { k: "contrato_financiado_procesado", label: "Cuando se procese un contrato que financié", hint: "Un aviso por contrato con el resultado del análisis." },
  { k: "senales_en_mi_zona", label: "Cuando haya señales de riesgo en una zona que sigo", hint: "Resumen cuando se publiquen nuevas alertas en tus zonas." },
];

export default function ConfiguracionPage() {
  const { user, loading } = useAuth();
  const { perfil, cargando, recargar } = useCuenta();
  const [reintentando, setReintentando] = useState(false);

  const reintentar = async () => {
    setReintentando(true);
    try { await recargar(); } finally { setReintentando(false); }
  };

  return (
    <div className="px-6 py-8 lg:px-10 space-y-6">
      <PageHeader title="Configuración" subtitle="Cómo apareces en el muro de aliados, qué avisos quieres y qué guardamos de ti. Todo es opcional: sin cuenta el sitio funciona igual." />
      {loading || (user && cargando && !perfil) ? (
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-paper p-6 text-sm text-mute shadow-card" aria-busy><Loader2 size={14} className="animate-spin" aria-hidden /> Cargando…</div>
      ) : !user ? (
        <div className="rounded-2xl border border-line bg-paper p-8 text-center shadow-card">
          <h2 className="font-serif text-2xl font-bold text-ink">Necesitas una cuenta</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-mute">La configuración guarda tu perfil de aliado, visibilidad y preferencias. Sin cuenta no hay nada que configurar: puedes financiar como invitado y denunciar de forma anónima.</p>
          <Link href="/login?next=/app/configuracion" className="mt-4 inline-flex items-center gap-2 rounded-full bg-heroViolet px-5 py-2.5 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">
            <LogIn size={14} aria-hidden /> Entrar
          </Link>
        </div>
      ) : perfil ? (
        <Formulario perfil={perfil} />
      ) : (
        <div className="rounded-2xl border border-line bg-paper p-8 text-center shadow-card">
          <h2 className="font-serif text-xl font-bold text-ink">No pudimos cargar tu cuenta</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-mute">Puede ser una falla temporal de red o de sesión. Reintenta en unos segundos.</p>
          <button type="button" onClick={reintentar} disabled={reintentando} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-heroViolet px-4 py-2 text-sm font-semibold text-paper shadow-card transition-all hover:scale-[1.02] disabled:opacity-60 disabled:hover:scale-100">
            <RefreshCw size={13} className={reintentando ? "animate-spin" : ""} aria-hidden /> {reintentando ? "Reintentando…" : "Reintentar"}
          </button>
        </div>
      )}
    </div>
  );
}

function Formulario({ perfil }: { perfil: Perfil }) {
  const router = useRouter();
  const [nombre, setNombre] = useState(perfil.nombrePublico ?? "");
  const [tipo, setTipo] = useState<"persona" | "empresa" | "organizacion">(perfil.tipo ?? "persona");
  const [visible, setVisible] = useState(perfil.visible);
  const [logoUrl, setLogoUrl] = useState<string | null>(perfil.logoUrl);
  const [correo, setCorreo] = useState(perfil.correo ?? "");
  const [notifs, setNotifs] = useState<Record<string, boolean>>(perfil.notificaciones ?? {});
  const [guardando, setGuardando] = useState(false);
  const [ok, setOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subiendoLogo, setSubiendoLogo] = useState(false);
  const [confirmar, setConfirmar] = useState(false);
  const [confirmTexto, setConfirmTexto] = useState("");
  const [borrando, setBorrando] = useState(false);
  // Controlado (no defaultOpen): así `guardar()` puede reabrir esta tarjeta si el guardado
  // falla -- el único error de validación del formulario (nombre público vacío) vive adentro,
  // y no tendría sentido mostrar el mensaje de error si la tarjeta que lo explica está cerrada.
  const [perfilOpen, setPerfilOpen] = useState(true);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setNombre(perfil.nombrePublico ?? ""); setTipo(perfil.tipo ?? "persona"); setVisible(perfil.visible);
    setLogoUrl(perfil.logoUrl); setCorreo(perfil.correo ?? ""); setNotifs(perfil.notificaciones ?? {});
  }, [perfil]);

  const guardar = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardando(true); setError(null); setOk(false);
    try {
      if (visible && nombre.trim().length < 2) throw new Error("Para aparecer en el muro necesitas un nombre público (mínimo 2 caracteres).");
      await actualizarPerfil({ nombrePublico: nombre.trim() || null, tipo, visible, logoUrl, correo: correo.trim() || null, notificaciones: notifs });
      setOk(true); setTimeout(() => setOk(false), 2500);
    } catch (err) { setError((err as Error).message); setPerfilOpen(true); } finally { setGuardando(false); }
  };

  const subirLogo = async (f: File | null) => {
    if (!f) return;
    setSubiendoLogo(true); setError(null);
    try {
      const fd = new FormData(); fd.append("file", f); fd.append("kind", "logo");
      const r = await fetch("/api/upload", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error ?? "No se pudo subir el logo");
      setLogoUrl(j.url);
    } catch (err) { setError((err as Error).message); } finally { setSubiendoLogo(false); }
  };

  const exportar = async () => {
    setError(null);
    try {
      const data = await exportarDatos();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `vigia-peru-mis-datos-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) { setError((err as Error).message); }
  };

  const borrar = async () => {
    if (confirmTexto.trim().toUpperCase() !== "BORRAR") return;
    setBorrando(true); setError(null);
    try {
      await borrarCuentaApi();
      // Credencial de acceso: se elimina en el cliente (puede pedir re-login si la sesión es vieja).
      try { if (auth.currentUser) await deleteUser(auth.currentUser); } catch { await signOut(); }
      router.push("/app/mapa?cuenta=borrada");
    } catch (err) { setError((err as Error).message); setBorrando(false); }
  };

  const conflicto = perfil.aliadoVisible === false && perfil.motivoNoVisible && perfil.motivoNoVisible !== "cuenta_borrada";
  const notifsActivos = NOTIFS.filter((n) => !!notifs[n.k]).length;

  return (
    <form onSubmit={guardar} className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-6">
        {/* Perfil público: abierta por defecto -- es el motivo real de esta página -- y se
            reabre sola desde `guardar()` si falla el guardado. */}
        <div>
          <Colapsable
            titulo="Perfil público de aliado"
            subtitulo="Nombre, logo y visibilidad en el muro de aliados"
            open={perfilOpen}
            onOpenChange={setPerfilOpen}
            hint={
              <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium text-mute">
                {visible ? <Eye size={12} aria-hidden /> : <EyeOff size={12} aria-hidden />}
                {visible ? "Visible" : "Anónimo"}
              </span>
            }
          >
            <p className="text-sm text-mute">Solo importa si quieres aparecer en el <Link href="/app/aliados" className="underline transition-colors hover:text-heroViolet">muro de aliados</Link> y en los comprobantes de tus aportes. Si no, tus aportes figuran como “Anónimo”.</p>

            <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Visibilidad">
              <button type="button" role="radio" aria-checked={!visible} onClick={() => setVisible(false)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${!visible ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
                <EyeOff size={14} aria-hidden /> Anónimo
              </button>
              <button type="button" role="radio" aria-checked={visible} onClick={() => setVisible(true)} className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${visible ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
                <Eye size={14} aria-hidden /> Visible en el muro
              </button>
            </div>
            {conflicto && (
              <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-soft px-3 py-2 text-[12px] text-ink animate-fadeIn">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
                <span>Tu perfil no puede ser visible: hay un conflicto de interés declarado ({perfil.motivoNoVisible === "sancion_vigente_osce" ? "sanción vigente OSCE" : "proveedor con alertas activas"}). Tus aportes procesan contratos igual.</span>
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="text-mute">Nombre público {visible ? "(obligatorio para el muro)" : "(opcional)"}</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="Ej. María Q. · Empresa X S.A.C." />
                </label>
                <div>
                  <span className="text-sm text-mute">Tipo</span>
                  <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Tipo de aliado">
                    {(["persona", "empresa", "organizacion"] as const).map((t) => (
                      <button type="button" key={t} role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={`rounded-lg border px-3 py-1.5 text-sm capitalize transition-colors ${tipo === t ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>{t === "organizacion" ? "Organización" : t}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-center">
                <span className="text-sm text-mute">Logo</span>
                <button
                  type="button"
                  onClick={() => logoInput.current?.click()}
                  disabled={subiendoLogo}
                  aria-label={logoUrl ? "Cambiar logo" : "Subir logo"}
                  className="relative mt-1 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-paperSoft transition-colors hover:border-heroViolet/50 disabled:cursor-wait"
                >
                  {logoUrl ? (
                    <Image src={logoUrl} alt="Logo" width={80} height={80} className="h-full w-full object-contain" unoptimized />
                  ) : (
                    <Upload size={18} className="text-mute" aria-hidden />
                  )}
                  {subiendoLogo && (
                    <span className="absolute inset-0 flex items-center justify-center bg-paper/80">
                      <Loader2 size={16} className="animate-spin text-heroViolet" aria-hidden />
                    </span>
                  )}
                </button>
                <input ref={logoInput} type="file" accept="image/*" className="sr-only" onChange={(e) => subirLogo(e.target.files?.[0] ?? null)} aria-label="Subir logo" />
                <div className="mt-1 flex justify-center gap-2 text-[11px]">
                  <button type="button" onClick={() => logoInput.current?.click()} disabled={subiendoLogo} className="inline-flex items-center gap-1 text-ink underline transition-colors hover:text-heroViolet disabled:opacity-60">
                    {subiendoLogo ? <Loader2 size={11} className="animate-spin" aria-hidden /> : <Upload size={11} aria-hidden />} {logoUrl ? "Cambiar" : "Subir"}
                  </button>
                  {logoUrl && <button type="button" onClick={() => setLogoUrl(null)} className="text-mute underline transition-colors hover:text-ink">Quitar</button>}
                </div>
              </div>
            </div>

            {/* Vista previa: antes nombre/tipo/logo/visibilidad se configuraban a ciegas, sin
                ninguna prueba de cómo se ve el resultado. Reusa AvatarAliado (mismo componente
                que renderiza la fila real en /app/aliados) para que la vista previa sea honesta,
                no una maqueta aparte que se desincroniza. */}
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-dashed border-line bg-paperSoft p-3">
              <AvatarAliado tipo={tipo} logoUrl={logoUrl} nombre={nombre || "Tu nombre"} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-ink">{visible ? (nombre.trim() || "Aún sin nombre") : "Anónimo"}</div>
                <div className="text-[11px] text-mute">Así se verá en el muro de aliados</div>
              </div>
              {visible ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-heroGreen/30 bg-heroGreen/10 px-2.5 py-1 text-[11px] font-semibold text-heroGreenTexto">
                  <Eye size={11} aria-hidden /> Visible
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paperDeep px-2.5 py-1 text-[11px] font-medium text-mute">
                  <EyeOff size={11} aria-hidden /> Oculto
                </span>
              )}
            </div>

            {perfil.slug && perfil.aliadoVisible && (
              <p className="mt-3 text-[12px] text-mute">Tu página de aliado: <Link href={`/aliado/${perfil.slug}`} className="font-mono underline transition-colors hover:text-heroViolet">/aliado/{perfil.slug}</Link></p>
            )}
          </Colapsable>
        </div>

        {/* Correo y avisos: también abierta por defecto -- es liviana (un input, dos
            checkboxes) y de uso frecuente, no hay motivo real para esconderla. */}
        <div>
          <Colapsable
            titulo="Correo y avisos"
            subtitulo="Correo opcional y qué avisos quieres recibir"
            defaultOpen
            hint={<span className="shrink-0 text-[11px] font-medium text-mute">{notifsActivos}/{NOTIFS.length} activos</span>}
          >
            <p className="text-sm text-mute">Tu cuenta no necesita correo. Si dejas uno, es privado y solo sirve para los avisos que actives. <strong className="text-ink">Por ahora solo guardamos la preferencia</strong>: el envío de correos se activará más adelante.</p>
            <label className="mt-3 block text-sm">
              <span className="text-mute">Correo (opcional)</span>
              <input type="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="email" className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="tu@correo.pe" />
            </label>
            <ul className="mt-3 space-y-2">
              {NOTIFS.map((n) => {
                const activo = !!notifs[n.k];
                return (
                  <li key={n.k}>
                    <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors ${activo ? "border-heroViolet/30 bg-heroViolet-soft" : "border-line hover:bg-paperSoft"}`}>
                      <input type="checkbox" checked={activo} onChange={(e) => setNotifs((x) => ({ ...x, [n.k]: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-line accent-heroViolet" />
                      <span><span className="block text-ink">{n.label}</span><span className="block text-[11px] text-mute">{n.hint}</span></span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Colapsable>
        </div>

        {error && <p className="text-sm text-rust animate-fadeIn" role="alert">{error}</p>}
        <button
          type="submit"
          disabled={guardando}
          className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-sm font-semibold text-paper shadow-card transition-all hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100 ${ok ? "bg-heroGreen" : "bg-heroViolet hover:bg-heroViolet-deep"}`}
        >
          {/* key cambia entre idle/guardando/ok -> React remonta el span y el fade-in de 200ms
              vuelve a correr cada vez, así el "Guardado" se siente como una confirmación y no
              como un cambio de texto/color instantáneo. */}
          <span key={guardando ? "guardando" : ok ? "ok" : "idle"} className="inline-flex items-center gap-2 animate-fadeIn">
            {guardando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : ok ? <Check size={14} aria-hidden /> : null} {ok ? "Guardado" : "Guardar cambios"}
          </span>
        </button>
      </div>

      {/* Privacidad y datos: identificador de cuenta + qué guardamos/exportar + borrar cuenta.
          Es la sección menos usada de la página (la mayoría entra a cambiar su perfil o sus
          avisos, no a exportar ni a borrarse), así que arranca colapsada -- en móvil, donde el
          formulario cae en una sola columna, esto sola ya ahorraba tres tarjetas apiladas de
          scroll a quien nunca las toca. */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div>
          <Colapsable titulo="Privacidad y datos" subtitulo="Tu identificador, qué guardamos, exportar o borrar tu cuenta">
            <div className="space-y-4">
              <div>
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">Tu cuenta</h3>
                <dl className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-mute">Usuario</dt>
                    <dd className="truncate font-mono text-sm font-semibold text-ink" title={perfil.userId ?? perfil.uid}>{perfil.userId ?? perfil.uid.slice(0, 8)}</dd>
                  </div>
                  <div>
                    <dt className="text-[10px] uppercase tracking-wide text-mute">Miembro desde</dt>
                    <dd className="text-sm font-semibold text-ink">{new Date(perfil.createdAt).toLocaleDateString("es-PE", { month: "short", year: "numeric" })}</dd>
                  </div>
                </dl>
              </div>

              <div className="border-t border-line pt-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-mute">Qué guardamos</h3>
                <ul className="mt-2 space-y-1 rounded-xl bg-paperSoft p-3 text-[12px] text-ink">
                  <li>· Tu user-id (sin correo, salvo que lo dejes arriba).</li>
                  <li>· Perfil de aliado: nombre, tipo, logo, visibilidad.</li>
                  <li>· Zonas y entidades que sigues; preferencias de aviso.</li>
                  <li>· Tus aportes y las denuncias enviadas con sesión.</li>
                </ul>
                <p className="mt-2 text-[11px] text-mute">Los aportes y los contratos analizados con ellos son públicos por diseño (comprobante de impacto). Detalle en <Link href="/preguntas#cuentas" className="underline transition-colors hover:text-heroViolet">Preguntas</Link>.</p>
                <button type="button" onClick={exportar} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-line bg-paper px-3 py-2 text-sm font-medium text-ink transition-colors hover:bg-paperDeep">
                  <Download size={14} aria-hidden /> Exportar mis datos (JSON)
                </button>
              </div>

              <div className="rounded-xl border border-rust/30 bg-crimson-soft/40 p-4">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-rust">Borrar cuenta</h3>
                <p className="mt-1 text-[12px] text-ink">Se elimina tu usuario y se anonimiza tu perfil de aliado. <strong>Tus aportes se conservan</strong> (son públicos y ya financiaron análisis) y aparecerán como “Anónimo”; tus denuncias quedan sin autor.</p>
                {!confirmar ? (
                  <button type="button" onClick={() => setConfirmar(true)} className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-rust/40 bg-paper px-3 py-2 text-sm font-medium text-rust transition-colors hover:bg-crimson-soft">
                    <Trash2 size={14} aria-hidden /> Quiero borrar mi cuenta
                  </button>
                ) : (
                  <div className="mt-3 space-y-2 animate-slideUp">
                    <label className="block text-[12px] text-ink">Escribe <span className="font-mono font-semibold">BORRAR</span> para confirmar
                      <input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-paper px-3 py-2 font-mono text-sm" autoComplete="off" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" onClick={borrar} disabled={borrando || confirmTexto.trim().toUpperCase() !== "BORRAR"} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-rust px-3 py-2 text-sm font-semibold text-paper transition-colors hover:bg-rust/90 disabled:opacity-50 disabled:hover:bg-rust">
                        {borrando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />} Borrar definitivamente
                      </button>
                      <button type="button" onClick={() => { setConfirmar(false); setConfirmTexto(""); }} className="rounded-xl border border-line bg-paper px-3 py-2 text-sm text-ink transition-colors hover:bg-paperDeep">Cancelar</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Colapsable>
        </div>
      </aside>
    </form>
  );
}

/**
 * Tarjeta colapsable por tema. Antes esta página apilaba 5 `<section>` siempre abiertas --
 * en móvil (donde el grid de 2 columnas de arriba no aplica, cae en una sola columna) eso
 * era media pantalla de scroll antes de llegar al botón "Guardar". `<details>/<summary>`
 * nativo en vez de un div+onClick a mano: foco de teclado y anuncio de lector de pantalla
 * funcionan gratis (mismo patrón que ya usa components/convocatoria/sections/CollapsibleSection.tsx
 * en otra parte del sitio). `open`/`onOpenChange` son opcionales -- sin ellos la tarjeta
 * maneja su propio estado con `defaultOpen`; con ellos, el padre puede forzarla abierta (ver
 * `perfilOpen` en Formulario, para que un error de validación nunca quede oculto detrás de
 * una tarjeta cerrada). Sin animación en el abrir/cerrar a propósito -- funcional es
 * suficiente aquí, y evita el glitch de intentar animar `display:none↔block` de un
 * `<details>` nativo; lo que sí anima es el chevron (`transition-transform`).
 */
function Colapsable({
  titulo,
  subtitulo,
  hint,
  defaultOpen = false,
  open: openControlado,
  onOpenChange,
  children,
}: {
  titulo: string;
  subtitulo?: string;
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}) {
  const [openInterno, setOpenInterno] = useState(defaultOpen);
  const open = openControlado ?? openInterno;
  return (
    <details
      className="rounded-2xl border border-line bg-paper shadow-card overflow-hidden"
      open={open}
      onToggle={(e) => {
        const v = (e.target as HTMLDetailsElement).open;
        setOpenInterno(v);
        onOpenChange?.(v);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 p-5 transition-colors hover:bg-paperDeep sm:p-6 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-mute">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-[12px] text-mute">{subtitulo}</p>}
        </div>
        {hint}
        <ChevronRight size={16} className={`shrink-0 text-mute transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden />
      </summary>
      <div className="border-t border-line p-5 pt-4 sm:p-6 sm:pt-4">
        {children}
      </div>
    </details>
  );
}
