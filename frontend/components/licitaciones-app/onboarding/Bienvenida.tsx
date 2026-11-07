"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from "lucide-react";
import { MarcaGobserva } from "@/components/gobserva/MarcaGobserva";
import { useMe, useSesion } from "@/components/gobserva/cuenta/comun";
import { rutaEn } from "@/lib/gobserva";
import { ErrorCuenta, cargarLineas, crearAlerta, crearBusqueda, crearLinea } from "@/lib/gobserva-cuenta";
import { PASOS, PERFIL_VACIO, aAlerta, aQueryBandeja, validarPaso, type Paso, type PerfilEmpresa } from "@/lib/licitaciones-app/onboarding";
import { cn } from "@/lib/utils";
import { PasoAvisos, PasoContratos, PasoEmpresa, PasoLugar } from "./Pasos";

const TITULO: Record<Paso, { titulo: string; bajada: string }> = {
  empresa: { titulo: "¿Qué vende tu empresa?", bajada: "Con esto ordenamos lo que se compra hoy, de lo más parecido a lo que vendes a lo menos." },
  lugar: { titulo: "¿Dónde vendes?", bajada: "Las regiones a las que llegas. Puedes cambiarlas cuando quieras." },
  contratos: { titulo: "¿Qué contratos te interesan?", bajada: "El tipo de contratación y el tamaño que puedes atender." },
  avisos: { titulo: "¿Cómo te avisamos?", bajada: "Lo nuevo que calce con tu perfil, sin que tengas que entrar a mirar." },
};

/**
 * El onboarding de la app (2026-11-07, como el de LicitaLAB): cuatro pasos a pantalla completa, con su avance, Atrás y
 * Siguiente, y la validación de cada paso. Al terminar crea la línea de negocio («Para ti»), la alerta y la búsqueda
 * «Mi empresa» de la bandeja, y te lleva a tus oportunidades. Si ya tienes tu perfil, te lo dice y te lleva.
 */
export function Bienvenida({ base }: { base: string }) {
  const router = useRouter();
  const { user } = useSesion();
  const { me } = useMe("licitaciones");
  const lineas = useSWR(["gobserva-lineas"], () => cargarLineas(), { revalidateOnFocus: false });
  const [p, setP] = useState<PerfilEmpresa>(PERFIL_VACIO);
  const [i, setI] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [rehacer, setRehacer] = useState(false);
  const paso = PASOS[i];
  const cambiar = (c: Partial<PerfilEmpresa>) => {
    setP((x) => ({ ...x, ...c }));
    setError(null);
  };
  const conDiaria = !!me?.producto?.limites?.frecuencias.includes("diaria");
  const tiene = (lineas.data?.data.length ?? 0) > 0;

  function siguiente() {
    const e = validarPaso(paso, p);
    if (e) return setError(e);
    setError(null);
    if (i < PASOS.length - 1) {
      setI(i + 1);
      window.scrollTo({ top: 0 });
    } else void terminar();
  }

  async function terminar() {
    setGuardando(true);
    setError(null);
    try {
      await crearLinea({ nombre: p.nombre.trim(), descripcion: p.descripcion.trim(), palabras: p.palabras, regiones: p.regiones, tipos: p.tipos, montoMin: p.min, montoMax: p.max });
    } catch (e) {
      setGuardando(false);
      return setError(e instanceof ErrorCuenta ? e.message : "No pudimos guardar tu perfil. Vuelve a intentarlo.");
    }
    if (p.alerta) {
      try {
        const a = aAlerta(p);
        await crearAlerta({ producto: "licitaciones", nombre: a.nombre, filtros: a.filtros, frecuencia: conDiaria ? p.frecuencia : "semanal" });
      } catch {
        // Sin cupo de alertas (el plan gratis tiene una): el perfil igual queda; la alerta se arma desde Alertas.
      }
    }
    try {
      await crearBusqueda({ producto: "licitaciones", nombre: "Mi empresa", query: aQueryBandeja(p) });
    } catch {
      // Ya había una búsqueda «Mi empresa»: se queda la que estaba.
    }
    void lineas.mutate();
    router.push(rutaEn(base, "/cuenta?tab=para-ti"));
  }

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-lienzo">
      <header className="sticky top-0 z-10 border-b border-line bg-caja/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between gap-4 px-4 sm:px-6">
          <MarcaGobserva producto="licitaciones" tamano="sm" />
          <Link href={rutaEn(base, "/app/bandeja")} className="text-dato font-semibold text-inkSoft underline-offset-4 hover:text-ink hover:underline">
            Saltar por ahora
          </Link>
        </div>
        {!(tiene && !rehacer) && (
          <div className="mx-auto max-w-3xl px-4 pb-3 sm:px-6">
            <ol className="flex gap-1.5" aria-label={`Paso ${i + 1} de ${PASOS.length}`}>
              {PASOS.map((x, k) => (
                <li key={x} className={cn("h-1.5 flex-1 rounded-full transition-colors duration-normal", k <= i ? "bg-granate" : "bg-ink/10")} />
              ))}
            </ol>
          </div>
        )}
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        {lineas.isLoading ? (
          <div className="grid place-items-center py-24">
            <Loader2 size={28} aria-label="Cargando" className="animate-spin text-mute" />
          </div>
        ) : tiene && !rehacer ? (
          <div className="rounded-2xl border border-line bg-caja p-6 text-center shadow-caja sm:p-10">
            <span aria-hidden className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-granate-50 text-granate">
              <Check size={26} />
            </span>
            <h1 className="mt-4 font-display text-seccion font-bold text-ink">Tu perfil ya está listo</h1>
            <p className="mt-2 text-cuerpo text-inkSoft">
              Vendes «{lineas.data!.data[0].nombre}». Tus oportunidades están ordenadas de lo más parecido a lo menos.
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              <Link href={rutaEn(base, "/cuenta?tab=para-ti")} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-granate px-5 text-dato font-semibold text-paper hover:bg-granate-deep">
                Ver mis oportunidades <ArrowRight size={16} aria-hidden />
              </Link>
              <button type="button" onClick={() => setRehacer(true)} className="inline-flex min-h-11 items-center rounded-lg border border-line bg-caja px-5 text-dato font-semibold text-ink hover:border-ink/20">
                Armar otra línea de negocio
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-meta font-semibold text-granate">
              Paso {i + 1} de {PASOS.length}
              {i === 0 && user?.displayName ? `. Hola, ${user.displayName.split(" ")[0]}` : ""}
            </p>
            <h1 className="mt-1 text-balance font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">{TITULO[paso].titulo}</h1>
            <p className="mt-2 max-w-[60ch] text-cuerpo leading-relaxed text-inkSoft">{TITULO[paso].bajada}</p>

            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                siguiente();
              }}
              className="mt-6 rounded-2xl border border-line bg-caja shadow-caja"
            >
              <div className="p-5 sm:p-7">
                {paso === "empresa" && <PasoEmpresa p={p} cambiar={cambiar} />}
                {paso === "lugar" && <PasoLugar p={p} cambiar={cambiar} />}
                {paso === "contratos" && <PasoContratos p={p} cambiar={cambiar} />}
                {paso === "avisos" && <PasoAvisos p={p} cambiar={cambiar} correo={me?.cuenta.email ?? user?.email ?? "tu correo"} conDiaria={conDiaria} />}
                {error && (
                  <p role="alert" className="mt-5 rounded-lg border border-crimson/30 bg-crimson-soft px-3.5 py-2.5 text-dato font-medium text-crimsonTexto">
                    {error}
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between gap-3 rounded-b-2xl border-t border-line bg-ink/[0.025] px-5 py-4 sm:px-7">
                {i > 0 ? (
                  <button type="button" onClick={() => { setI(i - 1); setError(null); }} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-dato font-semibold text-inkSoft hover:bg-ink/[0.06] hover:text-ink">
                    <ArrowLeft size={16} aria-hidden /> Atrás
                  </button>
                ) : (
                  <span />
                )}
                <button type="submit" disabled={guardando} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-granate px-5 text-dato font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-70">
                  {guardando ? <Loader2 size={16} aria-hidden className="animate-spin" /> : i === PASOS.length - 1 ? <Sparkles size={16} aria-hidden /> : null}
                  {i === PASOS.length - 1 ? "Ver mis oportunidades" : "Siguiente"}
                  {i < PASOS.length - 1 && <ArrowRight size={16} aria-hidden />}
                </button>
              </div>
            </form>
          </>
        )}
      </main>
    </div>
  );
}
