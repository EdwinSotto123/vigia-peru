import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, Copy, ExternalLink } from "lucide-react";
import { Pixel } from "@/components/pixel/Pixel";
import type { NombreSprite } from "@/components/pixel/sprites";
import { CONSULTAS } from "@/components/car/consultas";
import { FormPlaca } from "@/components/car/Placa";
import { rutaEn } from "@/lib/gobserva";
import { baseProducto } from "@/lib/gobserva-servidor";
import { numero } from "@/lib/gobserva-salud";
import datos from "@/data/car/citv.json";
import licencia from "@/data/car/licencia.json";
import gas from "@/data/car/gas.json";

export const metadata: Metadata = {
  title: { absolute: "Gobserva Car: verifica un auto antes de comprarlo o de subirte" },
  alternates: { canonical: "https://car.gobserva.cloud/" },
};

/**
 * La portada de Gobserva Car (car.gobserva.cloud, 2026-11-22): la placa para escribir, arriba y grande; cuatro puertas con
 * lo que hay detrás (las consultas oficiales de una placa, los centros de revisión técnica, la licencia de conducir y el
 * auto a gas) y el recorrido de una placa en tres pasos. Las consultas por placa piden captcha: no las leemos, las
 * enlazamos con la placa lista.
 */
export default function PortadaCar() {
  const base = baseProducto("car");
  const centros = (datos as { centros: { diasSinTransmitir: number | null; sancion: string | null }[] }).centros;
  const conAviso = centros.filter((c) => (c.diasSinTransmitir ?? 0) > 0 || c.sancion).length;
  const puertas: { ruta: string; titulo: string; cifra: string; texto: string; sprite: NombreSprite }[] = [
    {
      ruta: "/placa",
      titulo: "Verificar una placa",
      cifra: `${CONSULTAS.length} consultas oficiales`,
      texto: "SUNARP, SOAT, revisión técnica, papeletas en Lima y Callao, SUTRAN y ATU, con la placa lista para copiar.",
      sprite: "documento",
    },
    {
      ruta: "/revision-tecnica",
      titulo: "Revisión técnica",
      cifra: `${numero(centros.length)} centros autorizados`,
      texto: `Dónde pasarla en tu región, con su horario y sus líneas. ${numero(conAviso)} tienen un aviso del MTC.`,
      sprite: "chequeo",
    },
    {
      ruta: "/licencia",
      titulo: "Licencia de conducir",
      cifra: `${numero(licencia.medicos.length + licencia.evaluacion.length + licencia.escuelas.length)} locales autorizados`,
      texto: "Los pasos de la primera A-I y dónde pasar el examen médico, rendir los exámenes y llevar el curso.",
      sprite: "volante",
    },
    {
      ruta: "/gas",
      titulo: "Auto a gas",
      cifra: `${numero(gas.talleres.length)} talleres de GNV y GLP`,
      texto: "Quién puede convertir tu auto, quién lo inspecciona cada año y quién revisa el cilindro.",
      sprite: "surtidor",
    },
  ];
  const pasos = [
    { Icono: ClipboardCheck, titulo: "Escribe la placa", texto: "La de un auto que vas a comprar o la del taxi o bus al que te vas a subir." },
    { Icono: Copy, titulo: "Cópiala y abre cada consulta", texto: "Te decimos qué responde cada una. Todas son gratis y oficiales; piden un captcha." },
    { Icono: ExternalLink, titulo: "Antes de pagar, lo que sólo da SUNARP", texto: "Los embargos y los dueños anteriores salen en su Boleta Informativa, pagando." },
  ];

  return (
    <div className="container-page pb-12 pt-6 sm:pt-10">
      <section aria-labelledby="car-t" className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-center">
        <div className="min-w-0">
          <h1 id="car-t" className="text-balance font-display text-cifra font-bold leading-[1.05] tracking-[-0.02em] text-ink sm:text-titulo">
            Verifica un auto antes de comprarlo o de subirte
          </h1>
          <p className="mt-3 max-w-[60ch] text-cuerpo leading-relaxed text-inkSoft">
            Dónde ver, en las fuentes oficiales, de quién es, si tiene SOAT y revisión técnica, y si debe papeletas. Gratis y sin cuenta.
          </p>
          <FormPlaca accion={rutaEn(base, "/placa")} grande className="mt-6 max-w-xl" />
        </div>
        <span aria-hidden className="hidden h-56 items-center justify-center rounded-3xl bg-granate-50 p-6 lg:flex">
          <Pixel nombre="auto" escala={10} className="max-h-full max-w-full" />
        </span>
      </section>

      <section aria-label="Qué puedes hacer" className="mt-10 grid gap-3 md:grid-cols-2">
        {puertas.map((p) => (
          <Link
            key={p.ruta}
            href={rutaEn(base, p.ruta)}
            className="gs-hunde group flex min-w-0 items-center gap-4 rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50 sm:p-5"
          >
            <span aria-hidden className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-granate-50 p-2">
              <Pixel nombre={p.sprite} escala={4} animado={false} acento="accion" className="max-h-full max-w-full" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-bloque font-bold leading-snug text-ink group-hover:text-granate">{p.titulo}</span>
              <span className="mt-0.5 block text-dato font-semibold text-granate">{p.cifra}</span>
              <span className="mt-1 block text-meta leading-relaxed text-inkSoft">{p.texto}</span>
            </span>
            <ArrowRight size={18} aria-hidden className="shrink-0 text-mute transition-transform duration-rapido group-hover:translate-x-0.5" />
          </Link>
        ))}
      </section>

      <section aria-labelledby="pasos-t" className="mt-10">
        <h2 id="pasos-t" className="font-display text-seccion font-bold leading-tight text-ink">
          Verificar una placa, en tres pasos
        </h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-3">
          {pasos.map((p, i) => (
            <li key={p.titulo} className="flex gap-3.5 rounded-2xl border border-line bg-paper p-4">
              <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-granate font-display text-bloque font-bold text-paper">
                {i + 1}
              </span>
              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-cuerpo font-bold leading-snug text-ink">
                  <p.Icono size={16} aria-hidden className="shrink-0 text-granate" /> {p.titulo}
                </h3>
                <p className="mt-1 text-meta leading-relaxed text-inkSoft">{p.texto}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
