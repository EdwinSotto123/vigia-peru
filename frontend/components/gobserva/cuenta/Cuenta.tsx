"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Bell, Bookmark, CreditCard, LayoutDashboard, Loader2, LogOut, Sparkles, UserRound } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { ParaTi } from "@/components/licitaciones/ParaTi";
import { PRODUCTOS, rutaEn, type Producto } from "@/lib/gobserva";
import type { Me } from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso, Esqueleto, useMe, useSesion } from "./comun";
import { PanelResumen } from "./PanelResumen";
import { PanelAlertas } from "./PanelAlertas";
import { PanelGuardados } from "./PanelGuardados";
import { PanelPagos } from "./PanelPagos";
import { PanelPerfil } from "./PanelPerfil";
import { VerificarCorreo } from "./Verificacion";

export type Seccion = "resumen" | "para-ti" | "alertas" | "guardados" | "pagos" | "perfil";

interface InfoSeccion {
  clave: Seccion;
  etiqueta: string;
  Icono: typeof Bell;
  bajada: string;
  /** Sólo en este producto: «Para ti» es de Licitaciones. */
  solo?: Producto;
}

const SECCIONES: InfoSeccion[] = [
  { clave: "resumen", etiqueta: "Resumen", Icono: LayoutDashboard, bajada: "Lo que te falta para empezar, tu plan y lo último que te avisamos." },
  { clave: "para-ti", etiqueta: "Para ti", Icono: Sparkles, solo: "licitaciones", bajada: "Las oportunidades abiertas, de lo más parecido a lo que vende tu empresa a lo menos." },
  { clave: "alertas", etiqueta: "Alertas", Icono: Bell, bajada: "Te avisamos de lo nuevo que calza con tus búsquedas." },
  { clave: "guardados", etiqueta: "Guardados", Icono: Bookmark, bajada: "Lo que sigues, con su estado y su fecha de cierre." },
  { clave: "pagos", etiqueta: "Plan y pagos", Icono: CreditCard, bajada: "Tu plan, tus pagos y tus comprobantes." },
  { clave: "perfil", etiqueta: "Perfil", Icono: UserRound, bajada: "Tus datos, los de tu empresa para el comprobante y tu cuenta." },
];

/**
 * La cuenta de Gobserva en un producto (rediseño 2026-11-07): una barra lateral con quién eres, tu plan y las secciones
 * (en el celular, la misma lista en una fila que se desliza, nada escondido en un menú), y a la derecha la sección
 * abierta con su título. Las secciones van en ?tab= (se pueden enlazar, como en los correos: ?tab=alertas).
 */
export function Cuenta({ producto, base }: { producto: Producto; base: string }) {
  const { user, loading, conCuenta, esVigia } = useSesion();
  const { me, error, isLoading, mutate } = useMe(producto);
  const sp = useSearchParams();
  const router = useRouter();
  const ruta = usePathname();
  const secciones = SECCIONES.filter((s) => !s.solo || s.solo === producto);
  const pedida = sp.get("tab");
  const tab: Seccion = secciones.some((s) => s.clave === pedida) ? (pedida as Seccion) : "resumen";

  const ir = (t: Seccion) => {
    const q = new URLSearchParams(sp.toString());
    if (t === "resumen") q.delete("tab");
    else q.set("tab", t);
    router.replace(`${ruta}${q.size ? `?${q}` : ""}`, { scroll: false });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading || (conCuenta && isLoading && !me)) {
    return (
      <div className="container-page grid gap-8 py-8 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:py-10">
        <Esqueleto className="hidden h-[26rem] lg:block" />
        <div className="space-y-4">
          <Esqueleto className="h-16" />
          <Esqueleto className="h-48" />
          <Esqueleto className="h-40" />
        </div>
      </div>
    );
  }

  if (!conCuenta || !user) return <SinSesion producto={producto} base={base} esVigia={esVigia} />;

  if (error || !me) {
    return (
      <div className="container-page max-w-xl py-14">
        <Aviso tono="error">{(error as Error | undefined)?.message ?? "No pudimos cargar tu cuenta. Vuelve a intentarlo."}</Aviso>
        <button type="button" onClick={() => void mutate()} className={claseAccion("secundario", "mt-4")}>Reintentar</button>
      </div>
    );
  }

  const nombre = me.cuenta.nombre || user.displayName || me.cuenta.email.split("@")[0];
  const info = secciones.find((s) => s.clave === tab) ?? secciones[0];
  const titulo = tab === "resumen" ? `Hola, ${nombre}` : info.etiqueta;

  return (
    <div className="container-page grid gap-6 py-6 sm:py-8 lg:grid-cols-[15.5rem_minmax(0,1fr)] lg:gap-10 lg:py-10">
      <Lateral producto={producto} base={base} me={me} nombre={nombre} secciones={secciones} tab={tab} ir={ir} />

      <div className="min-w-0">
        <header>
          <h1 className="text-balance font-display text-titulo font-bold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">{titulo}</h1>
          <p className="mt-1.5 max-w-[65ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">{info.bajada}</p>
        </header>

        {/* En el resumen, verificar el correo es el primer paso de «Para empezar»; en las demás secciones, una franja. */}
        {!me.cuenta.emailVerificado && tab !== "resumen" && <VerificarCorreo email={me.cuenta.email} onListo={() => void mutate()} />}

        <div className="mt-6 sm:mt-8">
          {tab === "resumen" && <PanelResumen producto={producto} base={base} me={me} onCambio={() => void mutate()} irA={ir} />}
          {tab === "para-ti" && <ParaTi base={base} />}
          {tab === "alertas" && <PanelAlertas producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
          {tab === "guardados" && <PanelGuardados producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
          {tab === "pagos" && <PanelPagos producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
          {tab === "perfil" && <PanelPerfil producto={producto} base={base} me={me} onCambio={() => void mutate()} />}
        </div>
      </div>
    </div>
  );
}

/**
 * La barra lateral: quién eres y tu plan, las secciones (con lo que usas de cada una) y salir. Desde lg queda fija al
 * costado mientras bajas; en el celular, arriba, con las secciones en una fila que se desliza.
 */
function Lateral({
  producto, base, me, nombre, secciones, tab, ir,
}: {
  producto: Producto;
  base: string;
  me: Me;
  nombre: string;
  secciones: InfoSeccion[];
  tab: Seccion;
  ir: (t: Seccion) => void;
}) {
  const [saliendo, setSaliendo] = useState(false);
  const lim = me.producto?.limites;
  const usados = me.producto?.usados ?? { alertas: 0, guardados: 0 };
  const pagado = !!me.producto?.plan;
  const plan = me.producto?.nombrePlan ?? "Gratis";
  const inicial = nombre.trim().charAt(0).toUpperCase() || "?";
  const cuenta: Partial<Record<Seccion, string>> = lim
    ? { alertas: `${usados.alertas}/${lim.alertas}`, guardados: `${usados.guardados}/${lim.guardados}` }
    : {};

  async function salir() {
    setSaliendo(true);
    const { salir: cerrar } = await import("@/lib/gobserva-auth");
    await cerrar().finally(() => setSaliendo(false));
  }

  return (
    <aside aria-label="Tu cuenta" className="min-w-0 lg:sticky lg:top-24 lg:self-start">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-granate font-display text-destacado font-bold text-paper">
          {inicial}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-destacado font-bold leading-tight text-ink">{nombre}</p>
          <p className="truncate text-meta text-mute">{me.cuenta.email}</p>
        </div>
        {/* En el celular, el plan va al lado del nombre; desde lg, en su propia línea debajo. */}
        <PlanChip base={base} pagado={pagado} plan={plan} className="lg:hidden" onPagos={() => ir("pagos")} />
      </div>
      <PlanChip base={base} pagado={pagado} plan={plan} className="mt-3 hidden lg:inline-flex" onPagos={() => ir("pagos")} />

      <nav aria-label="Secciones de tu cuenta" className="mt-5 lg:mt-6">
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden">
          {secciones.map(({ clave, etiqueta, Icono }) => {
            const activa = tab === clave;
            return (
              <li key={clave} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => ir(clave)}
                  aria-current={activa ? "page" : undefined}
                  className={cn(
                    "flex min-h-11 w-full items-center gap-2.5 whitespace-nowrap rounded-full border px-4 text-dato font-semibold transition-colors duration-rapido",
                    "lg:rounded-xl lg:border-transparent lg:px-3",
                    activa
                      ? "border-granate bg-granate text-paper lg:border-transparent lg:bg-granate-50 lg:text-ink"
                      : "border-line bg-paper text-inkSoft hover:text-ink lg:bg-transparent lg:hover:bg-paperSoft",
                  )}
                >
                  <Icono size={17} aria-hidden className={cn("shrink-0", activa && "lg:text-granate")} />
                  <span>{etiqueta}</span>
                  {cuenta[clave] && (
                    <span className={cn("ml-auto hidden text-meta font-medium tabular-nums lg:inline", activa ? "text-inkSoft" : "text-mute")}>
                      <span className="sr-only">, usas </span>
                      {cuenta[clave]}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 hidden space-y-4 border-t border-line pt-5 lg:block">
        {!pagado && (
          <div className="rounded-2xl bg-paperSoft p-4">
            <p className="text-dato font-bold text-ink">Que te avisen cada mañana</p>
            <p className="mt-1 text-meta leading-relaxed text-inkSoft">
              Con un plan de pago, tus alertas llegan a diario, guardas más y descargas en Excel.
            </p>
            <Link href={rutaEn(base, "/planes")} className={claseAccion("primario", "mt-3 w-full")}>Ver los planes</Link>
          </div>
        )}
        <button
          type="button"
          onClick={() => void salir()}
          disabled={saliendo}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-dato font-semibold text-inkSoft transition-colors duration-rapido hover:bg-paperSoft hover:text-ink"
        >
          {saliendo ? <Loader2 size={17} aria-hidden className="animate-spin" /> : <LogOut size={17} aria-hidden />} Salir
        </button>
        <p className="px-3 text-meta leading-relaxed text-mute">La misma cuenta sirve en {otrosProductos(producto)}.</p>
      </div>
    </aside>
  );
}

function otrosProductos(producto: Producto): string {
  const otros = (Object.keys(PRODUCTOS) as Producto[]).filter((p) => p !== producto).map((p) => PRODUCTOS[p].titulo);
  return otros.join(" y ");
}

/** El plan como chip: el de pago lleva a sus pagos; el gratis, a los planes. */
function PlanChip({ base, pagado, plan, className, onPagos }: { base: string; pagado: boolean; plan: string; className?: string; onPagos: () => void }) {
  const clase = cn(
    "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-meta font-semibold",
    pagado ? "bg-granate-50 text-ink" : "border border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
    className,
  );
  if (pagado) {
    return (
      <button type="button" onClick={onPagos} className={clase}>
        <Sparkles size={14} aria-hidden className="text-granate" /> Plan {plan}
      </button>
    );
  }
  return (
    <Link href={rutaEn(base, "/planes")} className={clase}>
      Plan Gratis <span className="text-granate">Mejorar</span>
    </Link>
  );
}

/** Sin sesión: qué tiene la cuenta y los dos caminos (entrar o crearla). */
function SinSesion({ producto, base, esVigia }: { producto: Producto; base: string; esVigia: boolean }) {
  return (
    <div className="container-page max-w-xl py-14">
      <div className="rounded-3xl border border-line bg-paper p-6 text-center sm:p-10">
        <span aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-granate-50 text-granate">
          <UserRound size={26} />
        </span>
        <h1 className="mt-4 font-display text-seccion font-bold text-ink">{esVigia ? "Tu sesión es de Vigía" : "Entra a tu cuenta"}</h1>
        <p className="mt-2 text-cuerpo leading-relaxed text-inkSoft">
          {esVigia
            ? "Para Gobserva entra con tu correo o con Google: ahí llegan tus alertas y tus recibos."
            : `Tus alertas, tus guardados y tu plan de ${PRODUCTOS[producto].titulo} están en tu cuenta.`}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link href={rutaEn(base, "/entrar?next=/cuenta")} className={claseAccion("primario", "", "md")}>Entrar</Link>
          <Link href={rutaEn(base, "/entrar?crear=1&next=/cuenta")} className={claseAccion("secundario", "", "md")}>Crear una cuenta gratis</Link>
        </div>
      </div>
    </div>
  );
}
