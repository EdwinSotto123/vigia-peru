"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { ErrorCuenta, borrarCuenta, guardarPerfil, type Me } from "@/lib/gobserva-cuenta";
import { Aviso, CAMPO, ETIQUETA } from "./comun";

export function PanelPerfil({ producto: _producto, base, me, onCambio }: { producto: Producto; base: string; me: Me; onCambio: () => void }) {
  const router = useRouter();
  const c = me.cuenta;
  const [f, setF] = useState({
    nombre: c.nombre ?? "",
    empresa: c.empresa ?? "",
    ruc: c.ruc ?? "",
    razonSocial: c.razonSocial ?? "",
    direccionFiscal: c.direccionFiscal ?? "",
    telefono: c.telefono ?? "",
    whatsapp: c.whatsapp,
    boletin: c.boletin,
  });
  const [guardando, setGuardando] = useState(false);
  const [nota, setNota] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [claveNota, setClaveNota] = useState<string | null>(null);
  const [borrar, setBorrar] = useState("");
  const [borrando, setBorrando] = useState(false);

  const campo = (k: keyof typeof f) => ({
    value: f[k] as string,
    onChange: (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value })),
  });

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setNota(null);
    if (f.ruc && !/^(10|15|17|20)\d{9}$/.test(f.ruc.trim())) return setNota({ tono: "error", texto: "El RUC tiene 11 dígitos y empieza con 10, 15, 17 o 20." });
    setGuardando(true);
    try {
      await guardarPerfil(f);
      setNota({ tono: "ok", texto: "Guardado." });
      onCambio();
    } catch (err) {
      setNota({ tono: "error", texto: err instanceof ErrorCuenta ? err.message : "No pudimos guardar tu perfil." });
    } finally {
      setGuardando(false);
    }
  }

  async function cambiarClave() {
    setClaveNota(null);
    try {
      const { recuperarClave } = await import("@/lib/gobserva-auth");
      await recuperarClave(c.email, window.location.href);
      setClaveNota(`Te enviamos un enlace a ${c.email} para elegir una contraseña nueva.`);
    } catch {
      setClaveNota("No pudimos enviarlo. Si entras con Google, tu contraseña es la de Google.");
    }
  }

  async function salirDe() {
    const { salir } = await import("@/lib/gobserva-auth");
    await salir();
    router.replace(rutaEn(base, "/"));
  }

  async function borrarTodo() {
    setBorrando(true);
    try {
      await borrarCuenta();
      const { auth } = await import("@/lib/firebase");
      // Borrar el usuario de Firebase pide un ingreso reciente; si no lo es, sólo se sale (la cuenta ya quedó borrada).
      await auth.currentUser?.delete().catch(() => auth.signOut());
      router.replace(rutaEn(base, "/"));
    } catch (e) {
      setNota({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos borrar tu cuenta. Escríbenos a hello@gobserva.cloud." });
      setBorrando(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <form onSubmit={guardar} noValidate className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
        <h2 className="font-display text-seccion font-bold leading-tight text-ink">Tus datos</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-nombre" className={ETIQUETA}>Nombre</label>
            <input id="p-nombre" {...campo("nombre")} maxLength={120} autoComplete="name" className={CAMPO} />
          </div>
          <div>
            <label htmlFor="p-empresa" className={ETIQUETA}>Empresa o institución</label>
            <input id="p-empresa" {...campo("empresa")} maxLength={160} autoComplete="organization" className={CAMPO} />
          </div>
          <div>
            <label htmlFor="p-tel" className={ETIQUETA}>Celular (WhatsApp)</label>
            <input id="p-tel" {...campo("telefono")} inputMode="tel" autoComplete="tel" placeholder="+51 999 999 999" className={CAMPO} />
          </div>
          <div className="flex items-end">
            <label className="flex items-start gap-2.5 text-dato text-ink">
              <input type="checkbox" checked={f.whatsapp} onChange={(e) => setF((x) => ({ ...x, whatsapp: e.target.checked }))} className="mt-1 h-4 w-4 accent-[rgb(var(--granate))]" />
              Quiero mis alertas también por WhatsApp cuando estén listas
            </label>
          </div>
        </div>

        <h3 className="mt-7 font-display text-bloque font-bold text-ink">Para tu comprobante</h3>
        <p className="mt-1 text-meta text-mute">Si pagas como empresa o con tu RUC, sale en tus recibos.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-ruc" className={ETIQUETA}>RUC</label>
            <input id="p-ruc" {...campo("ruc")} inputMode="numeric" maxLength={11} className={CAMPO} />
          </div>
          <div>
            <label htmlFor="p-rs" className={ETIQUETA}>Razón social</label>
            <input id="p-rs" {...campo("razonSocial")} maxLength={200} className={CAMPO} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="p-dir" className={ETIQUETA}>Dirección fiscal</label>
            <input id="p-dir" {...campo("direccionFiscal")} maxLength={240} autoComplete="street-address" className={CAMPO} />
          </div>
        </div>
        <label className="mt-5 flex items-start gap-2.5 text-dato text-ink">
          <input type="checkbox" checked={f.boletin} onChange={(e) => setF((x) => ({ ...x, boletin: e.target.checked }))} className="mt-1 h-4 w-4 accent-[rgb(var(--granate))]" />
          Quiero novedades de Gobserva (una vez al mes como mucho)
        </label>
        {nota && <Aviso tono={nota.tono} className="mt-4">{nota.texto}</Aviso>}
        <button type="submit" disabled={guardando} className={claseAccion("primario", "mt-5")}>
          {guardando && <Loader2 size={15} aria-hidden className="animate-spin" />} Guardar
        </button>
      </form>

      <aside className="space-y-4">
        <div className="rounded-3xl border border-line bg-paper p-5">
          <p className="font-display text-bloque font-bold text-ink">Tu acceso</p>
          <p className="mt-1 break-all text-dato text-inkSoft">{c.email}</p>
          <div className="mt-4 flex flex-col gap-2">
            <button type="button" onClick={() => void cambiarClave()} className={claseAccion("secundario")}>
              <KeyRound size={15} aria-hidden /> Cambiar mi contraseña
            </button>
            <button type="button" onClick={() => void salirDe()} className={claseAccion("fantasma")}>
              <LogOut size={15} aria-hidden /> Salir
            </button>
          </div>
          {claveNota && <p className="mt-3 text-meta text-inkSoft">{claveNota}</p>}
        </div>
        <div className="rounded-3xl border border-crimson/30 bg-crimson-soft/50 p-5">
          <p className="flex items-center gap-2 font-display text-bloque font-bold text-crimsonTexto">
            <ShieldAlert size={18} aria-hidden /> Borrar mi cuenta
          </p>
          <p className="mt-1 text-meta leading-relaxed text-crimsonTexto">
            Cancela tus cobros y borra tus alertas, guardados y datos de contacto. Tus recibos se conservan por ley. Escribe BORRAR para confirmar.
          </p>
          <label htmlFor="p-borrar" className="sr-only">Escribe BORRAR</label>
          <input id="p-borrar" value={borrar} onChange={(e) => setBorrar(e.target.value)} className={`${CAMPO} mt-3`} autoComplete="off" />
          <button type="button" onClick={() => void borrarTodo()} disabled={borrar.trim().toUpperCase() !== "BORRAR" || borrando} className={claseAccion("secundario", "mt-3 w-full text-crimsonTexto")}>
            {borrando && <Loader2 size={15} aria-hidden className="animate-spin" />} Borrar mi cuenta para siempre
          </button>
        </div>
      </aside>
    </div>
  );
}
