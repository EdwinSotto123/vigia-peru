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
    "Con tu ubicación: los establecimientos registrados más cercanos, si están activos en RENIPRESS, su categoría y si tienen sanciones firmes de SUSALUD. Si ya estás adentro de una clínica, para verificarla; si buscas dónde atenderte de algo, los cercanos que lo declararon. Tu ubicación no se guarda.",
  alternates: { canonical: urlCanonica("salud", "/cerca") },
};

/**
 * «Cerca de ti» (Gobserva Salud, 2026-11-20): para quien ya está adentro y quiere verificar el lugar sin saber su nombre
 * exacto, y para quien busca dónde atenderse de algo (?necesidad=dientes, desde «¿Te pueden atender aquí?» de una ficha).
 * El botón de la portada llega con ?ubicar=1 y la ubicación se pide al abrir; sin eso, con el botón. Al lado (debajo en
 * el celular), qué revisar ya adentro: la ficha, la colegiatura de quien atiende y qué hacer si algo no cuadra.
 */
export default async function CercaDeTi({ searchParams }: { searchParams: { ubicar?: string; necesidad?: string } }) {
  const base = baseProducto("salud");
  const r = await getResumenSalud();
  return (
    <div className="container-page pb-10 pt-5 sm:pt-8">
      <Migas items={[{ etiqueta: "Inicio", href: rutaEn(base, "/") }, { etiqueta: "Cerca de ti" }]} />

      <div className="mt-4 grid gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="min-w-0">
          <h1 className="text-balance font-display text-cifra font-bold leading-tight tracking-tight text-ink sm:text-titulo">Cerca de ti</h1>
          <p className="mt-2 max-w-[62ch] text-pretty text-cuerpo leading-relaxed text-inkSoft">
            ¿Ya estás adentro de una clínica y no sabes su nombre exacto? ¿Buscas dónde atenderte de algo? Con tu ubicación te mostramos los
            establecimientos registrados más cercanos, si están activos, si tienen sanciones firmes y, si eliges qué necesitas, cuáles lo declararon.
          </p>
          <div className="mt-6">
            <CercaDeMi
              base={base}
              auto={searchParams.ubicar === "1"}
              necesidadInicial={typeof searchParams.necesidad === "string" ? searchParams.necesidad : null}
              conUbicacion={r?.conUbicacion ?? null}
              total={r?.ipress ?? null}
            />
          </div>
        </div>

        <aside aria-labelledby="adentro-t" className="min-w-0 rounded-2xl border border-line bg-paper p-5 sm:p-6">
          <h2 id="adentro-t" className="font-display text-bloque font-bold leading-snug text-ink">
            Ya adentro, antes de atenderte
          </h2>
          <ol className="mt-5 space-y-6">
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
        </aside>
      </div>
    </div>
  );
}
