import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, LocateFixed } from "lucide-react";
import { EscribeSolo } from "@/components/gobserva/portada/EscribeSolo";
import { Odometro } from "@/components/gobserva/portada/Odometro";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { BuscadorSalud } from "@/components/salud/portada/BuscadorSalud";
import { AvisoEmergencia } from "@/components/salud/portada/Piezas";
import { VistosRecientes } from "@/components/salud/vistos/Vistos";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getResumenSalud, numero } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";
import { NECESIDADES_RAPIDAS } from "@/lib/salud-necesidades";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Tu inicio",
  description: "Verifica una clínica, a tu médico o un medicamento con fuentes oficiales. Gratis y sin cuenta.",
  alternates: { canonical: urlCanonica("salud", "/") },
  robots: { index: false },
};

/** El ícono de píxeles de cada necesidad (lib/salud-necesidades.ts; components/pixel/sprites.ts). */
const ICONO_NECESIDAD: Record<string, NombreSprite> = {
  emergencia: "iconoEmergencia", dientes: "iconoDientes", parto: "iconoParto", ninos: "iconoNinos", ojos: "iconoOjos", piel: "iconoPiel",
  corazon: "iconoCorazon", huesos: "iconoHuesos", mental: "iconoMental", analisis: "iconoAnalisis", imagenes: "iconoImagenes", operacion: "iconoOperacion",
};

/**
 * El inicio de la APP de Gobserva Salud (2026-11-22, el usuario: «falta landing page… debe haber un botón de entrar»):
 * «/» es la landing para quien llega y esto es adonde lleva «Abrir la app» y el «Inicio» del menú. Corto, de app: el
 * buscador (que escribe ejemplos solo), las cuatro cosas que se verifican como botones grandes con su cifra de hoy, lo
 * que viste hace poco, las necesidades directas y el aviso de emergencia. GET /salud/resumen para las cifras; sin él,
 * los botones van sin número.
 */
export default async function InicioAppSalud() {
  const base = baseProducto("salud");
  const r = await getResumenSalud();
  const ruta = (p: string) => rutaEn(base, p);
  const acciones: { sprite: NombreSprite; titulo: string; cifra: string | null; texto: string; href: string }[] = [
    { sprite: "clinica", titulo: "Una clínica", cifra: r ? `${numero(r.activas)} activas` : null, texto: "Si está registrada, qué servicios declaró y sus sanciones.", href: ruta("/establecimientos") },
    { sprite: "doctora", titulo: "Mi médico", cifra: null, texto: "Con su colegiatura: si está habilitado y su título en SUNEDU.", href: ruta("/medico") },
    { sprite: "frasco", titulo: "Un medicamento", cifra: null, texto: "Si DIGEMID emitió una alerta, su precio y sus genéricos.", href: ruta("/medicamentos") },
    { sprite: "alfiler", titulo: "Cerca de mí", cifra: null, texto: "Lo que atiende cerca, con tu seguro y si abre 24 horas.", href: `${ruta("/cerca")}?ubicar=1` },
  ];
  return (
    <div className="container-page pb-12 pt-5 sm:pt-8">
      <section aria-labelledby="inicio-t" className="sobre-oscuro relative overflow-hidden rounded-3xl bg-ink px-5 py-7 text-paper sm:px-8 sm:py-9">
        <h1 id="inicio-t" className="max-w-[22ch] text-balance font-display text-cifra font-bold leading-[1.08] tracking-[-0.02em] sm:text-titulo">
          ¿Qué quieres verificar hoy?
        </h1>
        <BuscadorSalud accion={ruta("/buscar")} oscuro className="mt-5 max-w-3xl" id="buscar-inicio" />
        <EscribeSolo para="buscar-inicio" ejemplos={["Hospital Loayza", "Clínica Internacional", "Panadol", "Hospital Regional del Cusco", "Amoxicilina"]} />
        <AvisoEmergencia oscuro className="mt-6 border-t border-paper/10 pt-5" />
      </section>

      <ul aria-label="Lo que puedes verificar" className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {acciones.map((a) => (
          <li key={a.href} className="min-w-0">
            <Link
              href={a.href}
              className="gs-mira gs-hunde group flex h-full flex-col rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/40 sm:p-5"
            >
              <span aria-hidden className="grid h-16 w-16 place-items-center rounded-2xl bg-granate-50">
                <Pixel nombre={a.sprite} escala={3} animado={false} acento="accion" className="px-salta max-h-12 w-auto" />
              </span>
              <span className="mt-3 font-display text-bloque font-bold leading-snug text-ink">{a.titulo}</span>
              {a.cifra && (
                <span className="mt-0.5 text-dato font-semibold text-granate">
                  <Odometro texto={a.cifra} />
                </span>
              )}
              <span className="mt-1 text-meta leading-relaxed text-inkSoft max-sm:hidden">{a.texto}</span>
              <span className="mt-auto inline-flex items-center gap-1 pt-3 text-dato font-semibold text-granate">
                Abrir <ArrowRight size={15} aria-hidden className="transition-transform duration-rapido group-hover:translate-x-0.5" />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      <VistosRecientes base={base} fila className="mt-8" />

      <section aria-labelledby="necesidad-t" className="mt-8 rounded-2xl border border-granate/20 bg-granate-50 px-5 py-5 sm:px-7">
        <h2 id="necesidad-t" className="font-display text-bloque font-bold leading-snug text-ink">
          ¿Ya sabes lo que necesitas? Te decimos dónde lo atienden cerca.
        </h2>
        <ul aria-label="Lo que necesitas" className="mt-4 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
          {NECESIDADES_RAPIDAS.map((n) => {
            const icono = ICONO_NECESIDAD[n.clave];
            return (
              <li key={n.clave} className="shrink-0">
                <Link
                  href={`${ruta("/cerca")}?ubicar=1&necesidad=${n.clave}`}
                  prefetch={false}
                  className="group inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full border border-line bg-paper py-1.5 pl-2.5 pr-4 text-dato font-semibold text-ink transition-colors duration-rapido hover:border-granate/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-granate"
                >
                  {icono && <Pixel nombre={icono} escala={2} acento="accion" animado={false} className="px-salta" />}
                  {n.etiqueta}
                </Link>
              </li>
            );
          })}
        </ul>
        <p className="mt-3 flex items-start gap-1.5 text-meta leading-relaxed text-inkSoft">
          <LocateFixed size={14} aria-hidden className="mt-0.5 shrink-0 text-mute" />
          <span>Tu ubicación no se guarda.{r ? ` ${numero(r.activas)} establecimientos activos en RENIPRESS.` : ""}</span>
        </p>
      </section>
    </div>
  );
}
