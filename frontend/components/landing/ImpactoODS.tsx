import { Scale } from "lucide-react";

const IMG = "?w=560&q=70&auto=format&fit=crop";

/**
 * "Por qué importa" — el corazón emocional. La corrupción no es una cifra: es
 * una posta que no abrió, un colegio en carpas, un niño que no recuperó el peso.
 * Sección oscura (gravedad) que sigue al scrollytelling. Atacar la corrupción
 * (ODS 16) es el medio; cerrar las brechas (ODS 1·2·3·4·6) es el fin.
 */
const STAKES = [
  { img: "https://images.unsplash.com/photo-1542422783-e318aca8ff85", ods: 2, odsLabel: "Hambre cero", color: "#DDA63A", harm: "Un niño con desnutrición crónica que ya no recuperará el desarrollo perdido." },
  { img: "https://images.unsplash.com/photo-1773140278162-fd7df1043f0c", ods: 3, odsLabel: "Salud y bienestar", color: "#4C9F38", harm: "La posta de salud que se firmó en papel, pero que nunca abrió sus puertas." },
  { img: "https://images.unsplash.com/photo-1593460915132-fcb729cc4597", ods: 4, odsLabel: "Educación de calidad", color: "#C5192D", harm: "El colegio que sigue «en construcción» mientras los chicos estudian en carpas." },
  { img: "https://images.unsplash.com/photo-1543811303-5f6310068938", ods: 9, odsLabel: "Obras e infraestructura", color: "#FD6925", harm: "La obra pública paralizada hace años: pagada, firmada y nunca terminada." },
];

export function ImpactoODS() {
  return (
    <section id="impacto" className="relative isolate overflow-hidden border-y border-line bg-ink py-20 text-paper sm:py-24">
      {/* glows de gravedad */}
      <div aria-hidden className="pointer-events-none absolute -left-40 top-0 h-[420px] w-[420px] rounded-full bg-rust/15 blur-[120px]" />
      <div aria-hidden className="pointer-events-none absolute -right-40 bottom-0 h-[380px] w-[380px] rounded-full bg-amber/10 blur-[120px]" />

      <div className="container-page relative">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-amber/30 bg-amber/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber">
            Por qué importa
          </div>
          <h2 className="font-serif text-3xl font-bold leading-[1.05] sm:text-5xl">
            La corrupción no roba plata. <span className="text-rust">Roba futuro.</span>
          </h2>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-paper/80">
            <strong className="text-paper">S/. 57 mil millones</strong> en cuatro años. Detrás de esa
            cifra hay una posta que nunca abrió, un colegio que sigue «en construcción», un niño que no
            recuperó el peso que perdió.{" "}
            <strong className="text-paper">Cada sol desviado es una vida que esperaba.</strong>
          </p>
        </div>

        {/* lo que está en juego — consecuencias humanas */}
        <div className="mx-auto mt-12 grid max-w-5xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STAKES.map((s) => (
            <div key={s.ods} className="flex flex-col overflow-hidden rounded-2xl border border-paper/10 bg-paper/[0.03] transition-colors hover:bg-paper/[0.06]">
              <div className="relative h-32 w-full overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`${s.img}${IMG}`} alt="" loading="lazy" className="h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/45 to-transparent" />
                <span className="absolute bottom-2 left-3 flex h-9 w-9 flex-col items-center justify-center rounded text-paper shadow" style={{ background: s.color }}>
                  <span className="text-[6px] font-bold uppercase leading-none">ODS</span>
                  <span className="text-sm font-black leading-none">{s.ods}</span>
                </span>
              </div>
              <div className="flex flex-1 flex-col p-5">
                <p className="flex-1 text-sm leading-relaxed text-paper/75">{s.harm}</p>
                <div className="mt-3 text-[10px] uppercase tracking-wider text-paper/55">{s.odsLabel}</div>
              </div>
            </div>
          ))}
        </div>

        {/* el marco: ODS 16 es el medio */}
        <div className="mx-auto mt-12 flex max-w-3xl flex-col items-center gap-4 rounded-2xl border border-amber/25 bg-amber/[0.06] p-6 text-center sm:flex-row sm:text-left">
          <span className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl text-paper" style={{ background: "#00689D" }}>
            <Scale size={18} />
            <span className="mt-0.5 text-[7px] font-bold uppercase leading-none">ODS 16</span>
          </span>
          <p className="text-sm leading-relaxed text-paper/85">
            Vigía ataca la <strong className="text-paper">corrupción (ODS 16: instituciones sólidas)</strong> no
            como un fin, sino como el <strong className="text-amber">medio</strong> para proteger el presupuesto
            que sostiene todo lo demás. Cuidar cada sol es cuidar una meta de desarrollo que sí se cumple.
          </p>
        </div>
      </div>
    </section>
  );
}
