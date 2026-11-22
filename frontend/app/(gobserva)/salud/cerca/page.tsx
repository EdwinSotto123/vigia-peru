import type { Metadata } from "next";
import { Building2, MessageSquareWarning, Stethoscope } from "lucide-react";
import { Migas } from "@/components/patrones/Migas";
import { CercaDeMi } from "@/components/salud/cerca/CercaDeMi";
import { URL_DENUNCIA_SUSALUD } from "@/components/salud/fuentes/urls";
import { AvisoEmergencia, PasoNumerado } from "@/components/salud/portada/Piezas";
import { rutaEn, urlCanonica } from "@/lib/gobserva";
import { getResumenSalud } from "@/lib/gobserva-salud";
import { baseProducto } from "@/lib/gobserva-servidor";

export const metadata: Metadata = {
  title: "Establecimientos de salud cerca de ti",
  description:
    "Con tu ubicación: los establecimientos registrados más cercanos, si están activos en RENIPRESS, su categoría y si tienen sanciones firmes de SUSALUD. Si buscas dónde atenderte, los cercanos que declararon lo que necesitas, con tu seguro (SIS, EsSalud, privado) y abiertos las 24 horas. Tu ubicación no se guarda.",
  alternates: { canonical: urlCanonica("salud", "/cerca") },
};

/**
 * «Cerca de ti» (Gobserva Salud, 2026-11-20): para quien ya está adentro y quiere verificar el lugar sin saber su nombre
 * exacto, y para quien busca dónde atenderse de algo (?necesidad=dientes, desde «¿Te pueden atender aquí?» de una ficha).
 * El botón de la portada llega con ?ubicar=1 y la ubicación se pide al abrir; sin eso, con el botón. Al lado (debajo en
 * el celular), qué revisar ya adentro: la ficha, la colegiatura de quien atiende y qué hacer si algo no cuadra.
 */
export default async function CercaDeTi({ searchParams }: { searchParams: { ubicar?: string; necesidad?: string; seguro?: string; h24?: string } }) {
  const base = baseProducto("salud");
  const r = await getResumenSalud();
  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Cerca de mí" }]} />

      <div className="mt-4">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-seccion font-bold leading-tight tracking-[-0.015em] text-ink">Cerca de mí</h1>
          <p className="mt-1 max-w-[70ch] text-pretty text-dato leading-relaxed text-inkSoft">
            Los establecimientos registrados más cercanos, con sus sanciones firmes y, si eliges qué necesitas y tu seguro, los que lo declararon.
          </p>
          <div className="mt-5">
            <CercaDeMi
              base={base}
              auto={searchParams.ubicar === "1"}
              necesidadInicial={typeof searchParams.necesidad === "string" ? searchParams.necesidad : null}
              seguroInicial={typeof searchParams.seguro === "string" ? searchParams.seguro : null}
              h24Inicial={searchParams.h24 === "1"}
              conUbicacion={r?.conUbicacion ?? null}
              total={r?.ipress ?? null}
            />
          </div>
        </div>

        {/* «Ya adentro»: una franja de tres pasos a lo ancho (antes, una columna larga al costado). */}
        <section aria-labelledby="adentro-t" className="mt-10 min-w-0 rounded-2xl border border-line bg-paper p-5 sm:p-6">
          <h2 id="adentro-t" className="font-display text-bloque font-bold leading-snug text-ink">
            Ya adentro, antes de atenderte
          </h2>
          <ol className="mt-5 grid gap-6 md:grid-cols-3">
            <PasoNumerado n={1} Icono={Building2} titulo="Abre su ficha">
              Mira si figura activo en RENIPRESS, su categoría y si tiene sanciones firmes. Si te van a operar, si declaró un centro quirúrgico.
            </PasoNumerado>
            <PasoNumerado n={2} Icono={Stethoscope} titulo="Pide la colegiatura" accion={{ href: rutaEn(base, "/medico"), etiqueta: "Verificar a un médico" }}>
              El número de colegiatura de quien te va a atender. Con él ves en el Colegio Médico si está hábil y su especialidad.
            </PasoNumerado>
            <PasoNumerado
              n={3}
              Icono={MessageSquareWarning}
              titulo="Si algo no cuadra, pregunta"
              accion={{ href: URL_DENUNCIA_SUSALUD, etiqueta: "Presentar una denuncia en SUSALUD", externo: true }}
            >
              Antes de firmar o pagar. Si tienes un problema con la atención, puedes presentar una denuncia ante SUSALUD.
            </PasoNumerado>
          </ol>
          <AvisoEmergencia className="mt-6 border-t border-line pt-5" />
        </section>
      </div>
    </div>
  );
}
