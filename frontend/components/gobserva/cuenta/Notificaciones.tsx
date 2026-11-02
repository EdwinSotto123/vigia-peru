"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { BellOff, BellRing, CheckCircle2, Loader2, Send, Share, Smartphone, SquarePlus } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, type Producto } from "@/lib/gobserva";
import { ErrorCuenta, activarPush, cargarPush, desactivarPush, probarPush } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso } from "./comun";

type Estado = "cargando" | "sin_soporte" | "iphone_sin_instalar" | "bloqueado" | "apagado" | "activo";

/** La llave pública (base64url) como la pide pushManager.subscribe. */
function aBytes(b64: string): Uint8Array {
  const base = b64.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(base + "=".repeat((4 - (base.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** «Chrome en Android», «Safari en iPhone»: para reconocer cada dispositivo en la lista. */
function nombreDispositivo(): string {
  const ua = navigator.userAgent;
  const so = /iphone|ipad|ipod/i.test(ua) ? "iPhone" : /android/i.test(ua) ? "Android" : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "otro equipo";
  const nav = /edg\//i.test(ua) ? "Edge" : /firefox|fxios/i.test(ua) ? "Firefox" : /opr\//i.test(ua) ? "Opera" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Navegador";
  return `${nav} en ${so}`;
}

/**
 * «Avisos en este dispositivo» (2026-11-01): las notificaciones del navegador, además del correo. Con un toque registra
 * el service worker (/gobserva-sw.js), pide permiso y deja la suscripción en la cuenta (migración 233). En el iPhone sólo
 * funcionan con Gobserva instalada en la pantalla de inicio, y lo explica paso a paso.
 */
export function Notificaciones({ producto, className }: { producto: Producto; className?: string }) {
  const [estado, setEstado] = useState<Estado>("cargando");
  const [ocupado, setOcupado] = useState<"" | "activar" | "probar" | "quitar">("");
  const [mensaje, setMensaje] = useState<{ tono: "ok" | "error" | "nota"; texto: string } | null>(null);
  const { data, mutate } = useSWR(["gobserva-push", producto], () => cargarPush(producto), { revalidateOnFocus: false });

  useEffect(() => {
    (async () => {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
      const instalada = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
        setEstado(ios && !instalada ? "iphone_sin_instalar" : "sin_soporte");
        return;
      }
      if (Notification.permission === "denied") {
        setEstado("bloqueado");
        return;
      }
      const reg = await navigator.serviceWorker.getRegistration("/");
      setEstado((await reg?.pushManager.getSubscription()) ? "activo" : "apagado");
    })().catch(() => setEstado("sin_soporte"));
  }, []);

  async function activar() {
    setOcupado("activar");
    setMensaje(null);
    try {
      if (!data?.clave) throw new ErrorCuenta(503, "push_cerrado", "Las notificaciones todavía no están disponibles.");
      const reg = await navigator.serviceWorker.register("/gobserva-sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "apagado");
        return;
      }
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: aBytes(data.clave) as BufferSource }));
      await activarPush(producto, sub.toJSON(), nombreDispositivo());
      setEstado("activo");
      setMensaje({ tono: "ok", texto: "Listo: te avisaremos en este dispositivo. Toca «Enviar una prueba» para verlo." });
      await mutate();
    } catch (e) {
      setMensaje({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos activar las notificaciones en este navegador." });
    } finally {
      setOcupado("");
    }
  }

  async function probar() {
    setOcupado("probar");
    setMensaje(null);
    try {
      const r = await probarPush(producto);
      setMensaje(
        r.enviados
          ? { tono: "ok", texto: `Te mandamos una notificación de prueba${r.enviados > 1 ? ` a ${r.enviados} dispositivos` : ""}. Si no la ves, revisa que el sistema no tenga las notificaciones en silencio.` }
          : { tono: "nota", texto: "No llegó a ningún dispositivo. Desactiva y vuelve a activar las notificaciones aquí." },
      );
      await mutate();
    } catch (e) {
      setMensaje({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos mandar la prueba." });
    } finally {
      setOcupado("");
    }
  }

  async function desactivar() {
    setOcupado("quitar");
    setMensaje(null);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await desactivarPush({ endpoint: sub.endpoint });
        await sub.unsubscribe();
      }
      setEstado("apagado");
      setMensaje({ tono: "nota", texto: "Desactivamos las notificaciones en este dispositivo. Tus alertas siguen llegando a tu correo y a tu cuenta." });
      await mutate();
    } catch {
      setMensaje({ tono: "error", texto: "No pudimos desactivarlas. Vuelve a intentarlo." });
    } finally {
      setOcupado("");
    }
  }

  const otros = data?.dispositivos ?? [];
  const nombreApp = PRODUCTOS[producto].titulo;

  return (
    <section id="notificaciones" aria-labelledby="notif-t" className={cn("scroll-mt-24 rounded-3xl border border-line bg-paper p-5 sm:p-6", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-granate-50 text-granate">
            <BellRing size={20} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 id="notif-t" className="font-display text-bloque font-bold leading-tight text-ink">Avisos en este dispositivo</h2>
            <p className="mt-1 text-dato leading-relaxed text-inkSoft">
              Una notificación en tu celular o tu computadora apenas una alerta traiga algo nuevo, o dos días antes de que cierre algo que guardaste.
            </p>
          </div>
        </div>
        {estado === "activo" && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-granate-50 px-3 py-1 text-meta font-semibold text-granate">
            <CheckCircle2 size={14} aria-hidden /> Activas aquí
          </span>
        )}
      </div>

      <div className="mt-4">
        {estado === "cargando" && <div aria-hidden className="h-11 w-56 animate-pulse rounded-full bg-paperDeep" />}
        {estado === "apagado" && (
          <button type="button" onClick={() => void activar()} disabled={!!ocupado || !data} className={claseAccion("primario")}>
            {ocupado === "activar" ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <BellRing size={16} aria-hidden />} Activar notificaciones
          </button>
        )}
        {estado === "activo" && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void probar()} disabled={!!ocupado} className={claseAccion("secundario")}>
              {ocupado === "probar" ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <Send size={16} aria-hidden />} Enviar una prueba
            </button>
            <button type="button" onClick={() => void desactivar()} disabled={!!ocupado} className={claseAccion("fantasma")}>
              {ocupado === "quitar" ? <Loader2 size={16} aria-hidden className="animate-spin" /> : <BellOff size={16} aria-hidden />} Desactivar aquí
            </button>
          </div>
        )}
        {estado === "bloqueado" && (
          <Aviso>
            Bloqueaste las notificaciones de este sitio. Para activarlas, toca el candado junto a la dirección, permite las notificaciones y vuelve a
            cargar la página.
          </Aviso>
        )}
        {estado === "sin_soporte" && <Aviso>Este navegador no recibe notificaciones. Prueba con Chrome, Edge, Firefox o Safari actualizados.</Aviso>}
        {estado === "iphone_sin_instalar" && (
          <ol className="space-y-3 rounded-2xl border border-line bg-paperSoft p-4 text-dato text-ink">
            <li className="flex gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-meta font-bold text-paper">1</span>
              <span className="min-w-0">
                En Safari, toca <Share size={15} aria-label="Compartir" className="inline align-text-bottom text-granate" /> Compartir.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-meta font-bold text-paper">2</span>
              <span className="min-w-0">
                Elige <SquarePlus size={15} aria-hidden className="inline align-text-bottom text-granate" /> «Agregar a inicio»: queda {nombreApp} como app.
              </span>
            </li>
            <li className="flex gap-3">
              <span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-granate font-mono text-meta font-bold text-paper">3</span>
              <span className="min-w-0">Ábrela desde ese ícono, entra a tu cuenta y vuelve aquí para activar las notificaciones.</span>
            </li>
          </ol>
        )}
      </div>

      {mensaje && <Aviso tono={mensaje.tono} className="mt-3">{mensaje.texto}</Aviso>}

      {otros.length > 0 && (
        <ul className="mt-4 space-y-1.5 border-t border-line pt-3" aria-label="Dispositivos con notificaciones">
          {otros.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 text-meta text-inkSoft">
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <Smartphone size={14} aria-hidden className="shrink-0 text-mute" />
                <span className="truncate">{d.dispositivo ?? "Un dispositivo"}, desde el {d.creado}</span>
              </span>
              <button
                type="button"
                onClick={() => void desactivarPush({ id: d.id }).then(() => mutate())}
                className="font-semibold text-granate underline-offset-2 hover:underline"
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
