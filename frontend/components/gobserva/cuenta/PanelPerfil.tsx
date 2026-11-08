"use client";

import { Caja, ESPACIO_CAJAS } from "@/components/gobserva/app/Caja";
import { cn } from "@/lib/utils";
import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import { ErrorCuenta, borrarCuenta, guardarPerfil, type Me } from "@/lib/gobserva-cuenta";
import { CAMPO, ETIQUETA } from "./comun";

export function PanelPerfil({ producto, base, me, onCambio }: { producto: Producto; base: string; me: Me; onCambio: () => void }) {
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
  const [claveNota, setClaveNota] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [claves, setClaves] = useState({ actual: "", nueva: "" });
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

  /** Cambia la contraseña de esta app (pide la de ahora; la otra app tiene la suya). */
  async function cambiarClave(e: FormEvent) {
    e.preventDefault();
    setClaveNota(null);
    if (claves.nueva.length < 8) return setClaveNota({ tono: "error", texto: "La contraseña nueva debe tener al menos 8 caracteres." });
    const { cambiarClave: cambiar, mensajeAuth } = await import("@/lib/gobserva-auth");
    try {
      await cambiar(claves.actual, claves.nueva);
      setClaves({ actual: "", nueva: "" });
      setCambiando(false);
      setClaveNota({ tono: "ok", texto: "Listo: ya entras con tu contraseña nueva." });
    } catch (err) {
      setClaveNota({ tono: "error", texto: mensajeAuth(err).replace("El correo o la contraseña no coinciden.", "Tu contraseña de ahora no es esa.") });
    }
  }

  async function salirDe() {
    const { salir } = await import("@/lib/gobserva-auth");
    await salir();
    window.location.assign(rutaEn(base, "/"));
  }

  async function borrarTodo() {
    setBorrando(true);
    try {
      await borrarCuenta();
      // Después de sus datos, la cuenta misma (en el Cognito de esta app; la otra app no se toca).
      const { borrarUsuario } = await import("@/lib/gobserva-auth");
      await borrarUsuario();
      window.location.assign(rutaEn(base, "/"));
    } catch (e) {
      setNota({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos borrar tu cuenta. Escríbenos a hello@gobserva.cloud." });
      setBorrando(false);
    }
  }

  return (
    <div className={cn("grid grid-cols-[minmax(0,1fr)] items-start lg:grid-cols-[minmax(0,1fr)_20rem]", ESPACIO_CAJAS)}>
      <Caja
        id="datos"
        titulo="Tus datos"
        descripcion="Cómo te llamamos y, si pagas como empresa, lo que sale en tus recibos."
        pie={
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" form="perfil-form" disabled={guardando} className={claseAccion("primario", "min-h-10")}>
              {guardando && <Loader2 size={15} aria-hidden className="animate-spin" />} Guardar
            </button>
            {nota && <span role="status" className={cn("text-meta font-medium", nota.tono === "error" ? "text-crimsonTexto" : "text-mossTexto")}>{nota.texto}</span>}
          </div>
        }
      >
      <form id="perfil-form" onSubmit={guardar} noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="p-nombre" className={ETIQUETA}>Nombre</label>
            <input id="p-nombre" {...campo("nombre")} maxLength={120} autoComplete="name" className={CAMPO} />
          </div>
          <div>
            <label htmlFor="p-empresa" className={ETIQUETA}>Empresa o institución</label>
            <input id="p-empresa" {...campo("empresa")} maxLength={160} autoComplete="organization" className={CAMPO} />
          </div>
          <div>
            <label htmlFor="p-tel" className={ETIQUETA}>Celular</label>
            <input id="p-tel" {...campo("telefono")} inputMode="tel" autoComplete="tel" placeholder="+51 999 999 999" className={CAMPO} />
          </div>
        </div>

        <h3 className="mt-6 border-t border-line pt-5 font-display text-destacado font-bold text-ink">Para tu comprobante</h3>
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
      </form>
      </Caja>

      <aside className={cn("grid grid-cols-[minmax(0,1fr)]", ESPACIO_CAJAS)}>
        <Caja id="acceso" titulo="Tu acceso" descripcion={<span className="break-all">{c.email}</span>}>
          <div className="flex flex-col gap-2">
            {cambiando ? (
              <form onSubmit={(e) => void cambiarClave(e)} className="space-y-3">
                <div>
                  <label htmlFor="p-clave-actual" className={ETIQUETA}>Tu contraseña de ahora</label>
                  <input id="p-clave-actual" type="password" autoComplete="current-password" value={claves.actual} onChange={(e) => setClaves((x) => ({ ...x, actual: e.target.value }))} className={CAMPO} />
                </div>
                <div>
                  <label htmlFor="p-clave-nueva" className={ETIQUETA}>La nueva (8 o más caracteres)</label>
                  <input id="p-clave-nueva" type="password" autoComplete="new-password" value={claves.nueva} onChange={(e) => setClaves((x) => ({ ...x, nueva: e.target.value }))} className={CAMPO} />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className={claseAccion("primario", "flex-1")}>Guardar</button>
                  <button type="button" onClick={() => { setCambiando(false); setClaveNota(null); }} className={claseAccion("fantasma")}>Cancelar</button>
                </div>
              </form>
            ) : (
              <button type="button" onClick={() => setCambiando(true)} className={claseAccion("secundario")}>
                <KeyRound size={15} aria-hidden /> Cambiar mi contraseña
              </button>
            )}
            <button type="button" onClick={() => void salirDe()} className={claseAccion("fantasma")}>
              <LogOut size={15} aria-hidden /> Salir
            </button>
          </div>
          {claveNota && <p role={claveNota.tono === "error" ? "alert" : "status"} className={cn("mt-3 text-meta", claveNota.tono === "error" ? "font-medium text-crimsonTexto" : "text-mossTexto")}>{claveNota.texto}</p>}
        </Caja>
        <Caja
          id="borrar"
          titulo={
            <span className="inline-flex items-center gap-2 text-crimsonTexto">
              <ShieldAlert size={18} aria-hidden /> Borrar esta cuenta
            </span>
          }
          className="border-crimson/30"
        >
          <p className="text-meta leading-relaxed text-inkSoft">
            Borra tu cuenta de {producto === "empleo" ? "Gobserva Empleo" : "Gobserva Licitaciones"}: cancela sus cobros y borra sus alertas, guardados,
            seguimiento y datos de contacto. {producto === "empleo" ? "Tu cuenta de Licitaciones" : "Tu cuenta de Empleo"}, si la tienes, no se toca. Tus
            recibos se conservan por ley. Escribe BORRAR para confirmar.
          </p>
          <label htmlFor="p-borrar" className="sr-only">Escribe BORRAR</label>
          <input id="p-borrar" value={borrar} onChange={(e) => setBorrar(e.target.value)} className={`${CAMPO} mt-3`} autoComplete="off" />
          <button type="button" onClick={() => void borrarTodo()} disabled={borrar.trim().toUpperCase() !== "BORRAR" || borrando} className={claseAccion("secundario", "mt-3 w-full text-crimsonTexto")}>
            {borrando && <Loader2 size={15} aria-hidden className="animate-spin" />} Borrar mi cuenta para siempre
          </button>
        </Caja>
      </aside>
    </div>
  );
}
