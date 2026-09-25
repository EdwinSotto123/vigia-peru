"use client";

/**
 * Configuración de la cuenta (con sesión):
 *   · perfil público de aliado: nombre y logo si quiero aparecer en el muro; visibilidad anónimo/visible
 *   · correo opcional + preferencias de notificación (solo se guardan; el envío queda para después)
 *   · exportar mis datos (JSON) · borrar cuenta (con confirmación; los aportes se conservan anónimos)
 * Diseño: docs/design/CUENTAS.md
 *
 * Pase de sistema de diseño (sept 2026): CTA de guardar en bg-ink → bg-granate (prominencia real),
 * checkbox con accent-clay decorativo → accent-granate (clay/amber quedan solo para advertencia
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
 * oculto detrás de una tarjeta cerrada. Y micro-feedback con animate-fadeIn/slideUp en
 * estados que ya eran condicionales (conflicto de visibilidad, error, confirmar borrado, botón
 * guardar) -- nada de eso existía antes, así que la página se sentía estática incluso al cambiar
 * de estado.
 *
 * Identidad (2026-09-25, DESIGN_SYSTEM.md): tarjetas en reposo sin sombra (§5), opciones elegidas
 * en granate y no en tinta, títulos de tarjeta en Montserrat en vez de rótulos en mayúsculas,
 * estados de carga/vacío/error con los patrones del sistema, y el "Guardado" en moss.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Download, Trash2, Loader2, Check, Upload, LogIn, ShieldAlert, RefreshCw, ChevronRight } from "lucide-react";
import { Ayuda, Cargando, EncabezadoPagina, EstadoError, EstadoVacio, Pagina } from "@/components/patrones";
import { fechaCorta } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/AuthProvider";
import { actualizarPerfil, borrarCuentaApi, exportarDatos, idToken, useCuenta, type Perfil } from "@/lib/cuentas";
import { reautenticar, signOut } from "@/lib/auth";
import { deleteUser } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { AvatarAliado } from "@/components/aliados/TarjetaAliado";

/** Campo de texto del sistema (§5: inputs `rounded-xl`, hundidos en paperDeep). */
const CAMPO = "mt-1 w-full rounded-xl border border-line bg-paperDeep px-3 py-2 text-sm text-ink placeholder:text-mute focus:border-granate";
/** Opción de un grupo de radio: la elegida en granate (selección), no en tinta. */
const opcion = (activa: boolean) =>
  cn(
    "inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-sm transition-colors duration-rapido",
    activa ? "border-granate bg-granate-soft font-semibold text-granate" : "border-line bg-paper text-ink hover:border-granate/40 hover:bg-granate-50",
  );
/** Subtítulo dentro de una tarjeta: frase corta en caja normal, no un rótulo en mayúsculas. */
const SUBTITULO = "text-xs font-semibold text-mute";

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
    <Pagina>
      <EncabezadoPagina
        titulo="Configuración"
        bajada="Cómo apareces en el muro de aliados, qué avisos quieres y qué guardamos de ti."
        ayuda={
          <Ayuda titulo="¿Necesito una cuenta?">
            No. Todo es opcional: sin cuenta el sitio funciona igual. Puedes financiar como invitado y denunciar sin tu
            nombre.
          </Ayuda>
        }
      />
      {loading || (user && cargando && !perfil) ? (
        <Cargando texto="Cargando tu cuenta…" />
      ) : !user ? (
        <EstadoVacio
          titulo="Necesitas una cuenta"
          accion={
            <Link href="/login?next=/app/configuracion" className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-granate px-5 py-2.5 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
              <LogIn size={16} aria-hidden /> Entrar
            </Link>
          }
        >
          Aquí se guardan tu perfil de aliado y tus avisos. Sin cuenta puedes financiar como invitado y denunciar sin tu
          nombre.
        </EstadoVacio>
      ) : perfil ? (
        <Formulario perfil={perfil} />
      ) : (
        <EstadoError
          titulo="No pudimos cargar tu cuenta"
          accion={
            <button type="button" onClick={reintentar} disabled={reintentando} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-60">
              <RefreshCw size={14} className={reintentando ? "animate-spin" : ""} aria-hidden /> {reintentando ? "Reintentando…" : "Reintentar"}
            </button>
          }
        >
          Puede ser una falla momentánea de red o de sesión. Reintenta en unos segundos.
        </EstadoError>
      )}
    </Pagina>
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
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errorBorrar, setErrorBorrar] = useState<string | null>(null);
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
      // /api/upload exige sesión para subir logos: se manda el token de Firebase.
      const token = await idToken();
      const r = await fetch("/api/upload", { method: "POST", body: fd, headers: token ? { Authorization: `Bearer ${token}` } : undefined });
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
    if (!confirmPassword) { setErrorBorrar("Escribe tu contraseña para confirmar."); return; }
    setBorrando(true); setErrorBorrar(null);
    // 1. Primero la contraseña. Firebase sólo deja borrar el acceso con un inicio de
    //    sesión reciente; antes se borraba el perfil en el backend y DESPUÉS fallaba
    //    deleteUser en sesiones viejas, dejando un login vivo sin cuenta detrás.
    //    Si la contraseña no coincide, no se borró nada.
    try {
      await reautenticar(confirmPassword);
    } catch (err) {
      setErrorBorrar((err as Error).message);
      setBorrando(false);
      return;
    }
    // 2. El perfil en el backend (anonimiza el aliado; los aportes se conservan).
    try {
      await borrarCuentaApi();
    } catch (err) {
      setErrorBorrar((err as Error).message || "No pudimos borrar tu cuenta. No se borró nada; inténtalo de nuevo.");
      setBorrando(false);
      return;
    }
    // 3. El acceso. Con la sesión recién confirmada no debería fallar; si falla (red),
    //    se cierra la sesión igual y la página de entrada lo explica.
    let accesoBorrado = true;
    try { if (auth.currentUser) await deleteUser(auth.currentUser); } catch { accesoBorrado = false; await signOut(); }
    // La confirmación se muestra en /login (?cuenta=borrada).
    router.push(accesoBorrado ? "/login?cuenta=borrada" : "/login?cuenta=borrada&acceso=pendiente");
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
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-inkSoft">
              <span>
                Cómo figuras en el <Link href="/app/aliados" className="font-medium text-granate underline underline-offset-2">muro de aliados</Link>.
              </span>
              <Ayuda titulo="¿Para qué sirve el perfil público?">
                Sólo importa si quieres aparecer en el muro de aliados y en los comprobantes de tus aportes. Si no, tus
                aportes figuran como “Anónimo”.
              </Ayuda>
            </p>

            <div className="mt-4 flex gap-2" role="radiogroup" aria-label="Visibilidad">
              <button type="button" role="radio" aria-checked={!visible} onClick={() => setVisible(false)} className={cn(opcion(!visible), "flex-1")}>
                <EyeOff size={14} aria-hidden /> Anónimo
              </button>
              <button type="button" role="radio" aria-checked={visible} onClick={() => setVisible(true)} className={cn(opcion(visible), "flex-1")}>
                <Eye size={14} aria-hidden /> Visible en el muro
              </button>
            </div>
            {conflicto && (
              <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-soft px-3 py-2 text-[13px] text-ink" role="status">
                <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
                <span>Tu perfil no puede ser visible: hay un conflicto de interés declarado ({perfil.motivoNoVisible === "sancion_vigente_osce" ? "sanción vigente OSCE" : "proveedor con alertas activas"}). Tus aportes procesan contratos igual.</span>
              </p>
            )}

            <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-3">
                <label className="block text-sm">
                  <span className="font-semibold text-inkSoft">Nombre público {visible ? "(obligatorio para el muro)" : "(opcional)"}</span>
                  <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} autoComplete="organization" className={CAMPO} placeholder="Ej. María Q., o Empresa X S.A.C." />
                </label>
                <div>
                  <span className="text-sm font-semibold text-inkSoft">Tipo</span>
                  <div className="mt-1 flex gap-2" role="radiogroup" aria-label="Tipo de aliado">
                    {(["persona", "empresa", "organizacion"] as const).map((t) => (
                      <button type="button" key={t} role="radio" aria-checked={tipo === t} onClick={() => setTipo(t)} className={opcion(tipo === t)}>{t === "organizacion" ? "Organización" : t === "empresa" ? "Empresa" : "Persona"}</button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-center">
                <span className="text-sm font-semibold text-inkSoft">Logo</span>
                <button
                  type="button"
                  onClick={() => logoInput.current?.click()}
                  disabled={subiendoLogo}
                  aria-label={logoUrl ? "Cambiar logo" : "Subir logo"}
                  className="relative mt-1 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-paperSoft transition-colors hover:border-granate/50 disabled:cursor-wait"
                >
                  {logoUrl ? (
                    <Image src={logoUrl} alt="Logo" width={80} height={80} className="h-full w-full object-contain" unoptimized />
                  ) : (
                    <Upload size={18} className="text-mute" aria-hidden />
                  )}
                  {subiendoLogo && (
                    <span className="absolute inset-0 flex items-center justify-center bg-paper/80">
                      <Loader2 size={16} className="animate-spin text-granate" aria-hidden />
                    </span>
                  )}
                </button>
                <input ref={logoInput} type="file" accept="image/*" className="sr-only" onChange={(e) => subirLogo(e.target.files?.[0] ?? null)} aria-label="Subir logo" />
                <div className="mt-1 flex justify-center gap-2 text-[11px]">
                  <button type="button" onClick={() => logoInput.current?.click()} disabled={subiendoLogo} className="inline-flex items-center gap-1 text-ink underline transition-colors hover:text-granate disabled:opacity-60">
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
                <div className="text-xs text-mute">Así se verá en el muro de aliados</div>
              </div>
              {visible ? (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-granate/20 bg-granate-soft px-2.5 py-1 text-[11px] font-semibold text-granate">
                  <Eye size={11} aria-hidden /> Visible
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-paperDeep px-2.5 py-1 text-[11px] font-medium text-mute">
                  <EyeOff size={11} aria-hidden /> Oculto
                </span>
              )}
            </div>

            {perfil.slug && perfil.aliadoVisible && (
              <p className="mt-3 text-[13px] text-inkSoft">Tu página de aliado: <Link href={`/aliado/${perfil.slug}`} className="font-mono text-granate underline underline-offset-2">/aliado/{perfil.slug}</Link></p>
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
            hint={<span className="shrink-0 text-xs font-medium tabular-nums text-mute">{notifsActivos} de {NOTIFS.length} activos</span>}
          >
            <p className="flex flex-wrap items-center gap-x-1 text-sm text-inkSoft">
              <strong className="font-semibold text-ink">Todavía no enviamos correos:</strong> sólo guardamos tu preferencia.
              <Ayuda titulo="¿Para qué es el correo?">
                Tu cuenta no necesita correo. Si dejas uno, es privado y solo sirve para los avisos que actives.
              </Ayuda>
            </p>
            <label className="mt-3 block text-sm">
              <span className="font-semibold text-inkSoft">Correo (opcional)</span>
              <input type="email" inputMode="email" value={correo} onChange={(e) => setCorreo(e.target.value)} autoComplete="email" className={CAMPO} placeholder="tu@correo.pe" />
            </label>
            <ul className="mt-3 space-y-2">
              {NOTIFS.map((n) => {
                const activo = !!notifs[n.k];
                return (
                  <li key={n.k}>
                    <label className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-sm transition-colors duration-rapido ${activo ? "border-granate/30 bg-granate-50" : "border-line hover:bg-paperSoft"}`}>
                      <input type="checkbox" checked={activo} onChange={(e) => setNotifs((x) => ({ ...x, [n.k]: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-line accent-granate" />
                      <span><span className="block text-ink">{n.label}</span><span className="block text-xs text-mute">{n.hint}</span></span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Colapsable>
        </div>

        {error && <p className="text-sm text-crimsonTexto" role="alert">{error}</p>}
        {/* Guardado = positivo: moss (antes maíz con texto blanco, ≈ 1.9:1, ilegible). */}
        <button
          type="submit"
          disabled={guardando}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold text-paper transition-colors duration-rapido disabled:opacity-60 ${ok ? "bg-moss" : "bg-granate hover:bg-granate-deep"}`}
        >
          {/* key cambia entre idle/guardando/ok -> React remonta el span y el fade-in de 200ms
              vuelve a correr cada vez, así el "Guardado" se siente como una confirmación y no
              como un cambio de texto/color instantáneo. */}
          <span key={guardando ? "guardando" : ok ? "ok" : "idle"} className="inline-flex items-center gap-2 animate-fadeIn" aria-live="polite">
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
                <h3 className={SUBTITULO}>Tu cuenta</h3>
                <dl className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <dt className="text-xs text-mute">Usuario</dt>
                    <dd className="truncate font-mono text-sm font-semibold text-ink" title={perfil.userId ?? perfil.uid}>{perfil.userId ?? perfil.uid.slice(0, 8)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-mute">Miembro desde</dt>
                    <dd className="text-sm font-semibold text-ink">{fechaCorta(perfil.createdAt)}</dd>
                  </div>
                </dl>
              </div>

              <div className="border-t border-line pt-4">
                <h3 className={SUBTITULO}>Qué guardamos</h3>
                <ul className="mt-2 list-outside list-disc space-y-1 rounded-xl bg-paperSoft p-3 pl-7 text-[12px] text-ink">
                  <li>Tu nombre de usuario (sin correo, salvo que lo dejes arriba).</li>
                  <li>Perfil de aliado: nombre, tipo, logo, visibilidad.</li>
                  <li>Zonas y entidades que sigues; preferencias de aviso.</li>
                  <li>Tus aportes y las denuncias enviadas con sesión.</li>
                </ul>
                <p className="mt-2 text-xs text-mute">Los aportes y los contratos leídos con ellos son públicos por diseño (comprobante de impacto). Detalle en <Link href="/preguntas#cuentas" className="font-medium text-granate underline underline-offset-2">Cuánto cuesta y quién paga</Link>.</p>
                <button type="button" onClick={exportar} className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-full border border-line bg-paper px-3 py-2 text-sm font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50">
                  <Download size={14} aria-hidden /> Exportar mis datos (JSON)
                </button>
              </div>

              <div className="rounded-xl border border-crimson/25 bg-crimson-soft/40 p-4">
                <h3 className="text-sm font-semibold text-crimsonTexto">Borrar cuenta</h3>
                <p className="mt-1 text-[13px] text-ink">Se elimina tu usuario y se anonimiza tu perfil de aliado. <strong>Tus aportes se conservan</strong> (son públicos y ya financiaron análisis) y aparecerán como “Anónimo”; tus denuncias quedan sin autor.</p>
                {!confirmar ? (
                  <button type="button" onClick={() => setConfirmar(true)} className="mt-3 inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-full border border-crimson/40 bg-paper px-3 py-2 text-sm font-semibold text-crimsonTexto transition-colors duration-rapido hover:bg-crimson-soft">
                    <Trash2 size={14} aria-hidden /> Quiero borrar mi cuenta
                  </button>
                ) : (
                  <div className="mt-3 space-y-2">
                    <label className="block text-[12px] text-ink">Escribe <span className="font-mono font-semibold">BORRAR</span> para confirmar
                      <input value={confirmTexto} onChange={(e) => setConfirmTexto(e.target.value)} className={cn(CAMPO, "bg-paper font-mono")} autoComplete="off" />
                    </label>
                    {/* Por seguridad se pide la contraseña: sin ella Firebase no deja borrar el acceso. */}
                    <label className="block text-[12px] text-ink">Tu contraseña
                      <input
                        type="password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        autoComplete="current-password"
                        aria-invalid={errorBorrar ? true : undefined}
                        aria-describedby={errorBorrar ? "borrar-error" : undefined}
                        className={cn(CAMPO, "bg-paper")}
                      />
                    </label>
                    {errorBorrar && <p id="borrar-error" role="alert" className="text-[13px] text-crimsonTexto">{errorBorrar}</p>}
                    <div className="flex gap-2">
                      <button type="button" onClick={borrar} disabled={borrando || confirmTexto.trim().toUpperCase() !== "BORRAR" || !confirmPassword} className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1.5 rounded-full bg-crimsonTexto px-3 py-2 text-sm font-semibold text-paper transition-colors duration-rapido hover:bg-crimsonTexto/90 disabled:opacity-50">
                        {borrando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />} Borrar definitivamente
                      </button>
                      <button type="button" onClick={() => { setConfirmar(false); setConfirmTexto(""); setConfirmPassword(""); setErrorBorrar(null); }} className="min-h-[40px] rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-ink transition-colors duration-rapido hover:bg-paperDeep">Cancelar</button>
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
      className="overflow-hidden rounded-2xl border border-line bg-paper"
      open={open}
      onToggle={(e) => {
        const v = (e.target as HTMLDetailsElement).open;
        setOpenInterno(v);
        onOpenChange?.(v);
      }}
    >
      <summary className="flex min-h-[56px] cursor-pointer list-none items-center gap-3 p-5 transition-colors duration-rapido hover:bg-paperSoft sm:p-6 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[17px] font-bold text-ink">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-[13px] text-mute">{subtitulo}</p>}
        </div>
        {hint}
        <ChevronRight size={16} className={`shrink-0 text-mute transition-transform duration-normal ${open ? "rotate-90" : ""}`} aria-hidden />
      </summary>
      <div className="border-t border-line p-5 pt-4 sm:p-6 sm:pt-4">
        {children}
      </div>
    </details>
  );
}
