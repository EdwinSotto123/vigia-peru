"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeCheck, Bell, Bookmark, CreditCard, LayoutDashboard, Loader2, MailWarning, UserRound } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import { cn } from "@/lib/utils";
import { Aviso, Esqueleto, useMe, useSesion } from "./comun";
import { PanelResumen } from "./PanelResumen";
import { PanelAlertas } from "./PanelAlertas";
import { PanelGuardados } from "./PanelGuardados";
import { PanelPagos } from "./PanelPagos";
import { PanelPerfil } from "./PanelPerfil";

const PESTANAS = [
  { clave: "resumen", etiqueta: "Resumen", Icono: LayoutDashboard },
  { clave: "alertas", etiqueta: "Alertas", Icono: Bell },
  { clave: "guardados", etiqueta: "Guardados", Icono: Bookmark },
  { clave: "pagos", etiqueta: "Pagos", Icono: CreditCard },
  { clave: "perfil", etiqueta: "Perfil", Icono: UserRound },
] as const;
type Pestana = (typeof PESTANAS)[number]["clave"];

/**
 * La cuenta de Gobserva en un producto: el plan y lo que se usa de él, las alertas (y lo que avisaron), lo guardado, los
 * pagos con sus recibos y el perfil. Las pestañas van en ?tab= (se pueden enlazar, como los correos: ?tab=alertas).
 */
export function Cuenta({ producto, base }: { producto: Producto; base: string }) {
  const { user, loading, conCuenta, esVigia } = useSesion();
  const { me, error, isLoading, mutate } = useMe(producto);
  const sp = useSearchParams();
  const router = useRouter();
  const ruta = usePathname();
  const pedida = sp.get("tab");
  const tab: Pestana = PESTANAS.some((p) => p.clave === pedida) ? (pedida as Pestana) : "resumen";

  const ir = (t: Pestana) => {
    const q = new URLSearchParams(sp.toString());
    if (t === "resumen") q.delete("tab");
    else q.set("tab", t);
    router.replace(`${ruta}${q.size ? `?${q}` : ""}`, { scroll: false });
  };

  if (loading || (conCuenta && isLoading && !me)) {
    return (
      <div className="container-page space-y-4 py-10">
        <Esqueleto className="h-24" />
        <Esqueleto className="h-12" />
        <Esqueleto className="h-72" />
      </div>
    );
  }

  if (!conCuenta || !user) {
    return (
      <div className="container-page max-w-xl py-14">
        <div className="rounded-3xl border border-line bg-paper p-6 text-center sm:p-10">
          <UserRound size={36} aria-hidden className="mx-auto text-granate" />
          <h1 className="mt-3 font-display text-seccion font-bold text-ink">{esVigia ? "Tu sesión es de Vigía" : "Entra a tu cuenta"}</h1>
          <p className="mt-2 text-cuerpo leading-relaxed text-inkSoft">
            {esVigia
              ? "Para Gobserva entra con tu correo o con Google: ahí llegan tus alertas y tus recibos."
              : `Tus alertas, tus guardados y tu plan de ${PRODUCTOS[producto].titulo} están en tu cuenta.`}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Link href={rutaEn(base, "/entrar?next=/cuenta")} className={claseAccion("primario")}>Entrar</Link>
            <Link href={rutaEn(base, "/entrar?crear=1&next=/cuenta")} className={claseAccion("secundario")}>Crear una cuenta gratis</Link>
          </div>
        </div>
      </div>
    );
  }

  if (error || !me) {
    return (
      <div className="container-page max-w-xl py-14">
        <Aviso tono="error">{(error as Error | undefined)?.message ?? "No pudimos cargar tu cuenta. Vuelve a intentarlo."}</Aviso>
        <button type="button" onClick={() => void mutate()} className={claseAccion("secundario", "mt-4")}>Reintentar</button>
      </div>
    );
  }

  const nombre = me.cuenta.nombre || user.displayName || me.cuenta.email.split("@")[0];
  const plan = me.producto?.nombrePlan ?? "Gratis";
  const pagado = !!me.producto?.plan;
  return (
    <div className="container-page py-8 sm:py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-meta text-mute">{PRODUCTOS[producto].titulo}</p>
          <h1 className="mt-1 truncate font-display text-titulo font-bold leading-tight text-ink">Hola, {nombre}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-dato text-inkSoft">
            <span className="truncate">{me.cuenta.email}</span>
            {me.cuenta.emailVerificado && (
              <span className="inline-flex items-center gap-1 text-meta font-semibold text-mossTexto"><BadgeCheck size={15} aria-hidden /> Verificado</span>
            )}
          </p>
        </div>
        <Link
          href={rutaEn(base, pagado ? "/cuenta?tab=pagos" : "/planes")}
          className={cn(
            "inline-flex items-center gap-2 rounded-full px-4 py-2 text-dato font-semibold",
            pagado ? "bg-granate text-paper" : "border border-line bg-paper text-ink hover:border-granate/40",
          )}
        >
          Plan {plan}
          {!pagado && <span className="text-meta font-medium text-granate">Mejorar</span>}
        </Link>
      </header>

      {!me.cuenta.emailVerificado && <VerificarCorreo email={me.cuenta.email} onListo={() => void mutate()} />}

      {/* En el celular, las cinco a la vista (el ícono sobre el nombre, nada escondido al costado); desde sm, en fila. */}
      <nav aria-label="Secciones de tu cuenta" className="mt-6">
        <ul className="grid grid-cols-5 border-b border-line sm:flex sm:gap-1.5">
          {PESTANAS.map(({ clave, etiqueta, Icono }) => (
            <li key={clave} className="min-w-0">
              <button
                type="button"
                onClick={() => ir(clave)}
                aria-current={tab === clave ? "page" : undefined}
                className={cn(
                  "-mb-px flex min-h-14 w-full flex-col items-center justify-center gap-1 border-b-2 px-0.5 text-micro font-semibold transition-colors duration-rapido min-[380px]:text-rotulo",
                  "sm:min-h-11 sm:w-auto sm:flex-row sm:gap-2 sm:px-3.5 sm:text-dato",
                  tab === clave ? "border-granate text-ink" : "border-transparent text-inkSoft hover:text-ink",
                )}
              >
                <Icono size={16} aria-hidden className="shrink-0" />
                <span className="max-w-full truncate">{etiqueta}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6">
        {tab === "resumen" && <PanelResumen producto={producto} base={base} me={me} onCambio={() => void mutate()} irA={ir} />}
        {tab === "alertas" && <PanelAlertas producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
        {tab === "guardados" && <PanelGuardados producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
        {tab === "pagos" && <PanelPagos producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
        {tab === "perfil" && <PanelPerfil producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
      </div>
    </div>
  );
}

/** Sin el correo verificado no salen correos: el aviso para verificarlo (y el botón para cuando ya lo hizo). */
function VerificarCorreo({ email, onListo }: { email: string; onListo: () => void }) {
  const [estado, setEstado] = useState<"" | "enviando" | "enviado" | "revisando" | "error">("");
  async function reenviar() {
    setEstado("enviando");
    try {
      const { reenviarVerificacion } = await import("@/lib/gobserva-auth");
      await reenviarVerificacion(window.location.href);
      setEstado("enviado");
    } catch {
      setEstado("error");
    }
  }
  async function yaVerifique() {
    setEstado("revisando");
    try {
      const { refrescarUsuario } = await import("@/lib/gobserva-auth");
      await refrescarUsuario();
      onListo();
    } finally {
      setEstado("");
    }
  }
  return (
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/40 bg-amber-soft px-4 py-3">
      <p className="flex min-w-0 items-start gap-2.5 text-dato text-amberTexto">
        <MailWarning size={18} aria-hidden className="mt-0.5 shrink-0" />
        <span>
          Verifica tu correo para recibir alertas y recibos en <b>{email}</b>.
          {estado === "enviado" && " Te lo volvimos a enviar: revisa también el spam."}
          {estado === "error" && " No pudimos enviarlo ahora; intenta en unos minutos."}
        </span>
      </p>
      <div className="flex shrink-0 gap-2">
        <button type="button" onClick={reenviar} disabled={estado === "enviando"} className={claseAccion("secundario")}>
          {estado === "enviando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Reenviar el correo
        </button>
        <button type="button" onClick={yaVerifique} disabled={estado === "revisando"} className={claseAccion("fantasma")}>
          {estado === "revisando" && <Loader2 size={15} aria-hidden className="animate-spin" />} Ya lo verifiqué
        </button>
      </div>
    </div>
  );
}
