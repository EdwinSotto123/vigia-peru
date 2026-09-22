import { ListOrdered, Scale, ShieldCheck } from "lucide-react";

/**
 * Las tres reglas que hacen que este muro no sea publicidad.
 *
 * Antes eran tres tarjetas idénticas (ícono en cuadrito + título + párrafo)
 * en una grilla de tres columnas: la plantilla que la dirección prohíbe como
 * estructura de página, y que además las igualaba en peso con el CTA que iba
 * al lado. Ahora son tres renglones de una sola superficie, que es lo que
 * son: la letra chica que en este producto no puede ser chica.
 */

const REGLAS = [
  {
    Icono: Scale,
    titulo: "Nadie elige qué se audita",
    texto:
      "Los contratos se asignan por antigüedad en la cola, en una consulta SQL. El pipeline de agentes no recibe ni conoce el nombre de quien financió. Los resultados se publican igual, incluso si señalan a quien pagó.",
  },
  {
    Icono: ListOrdered,
    titulo: "Se cuenta en contratos, nunca en soles",
    texto:
      "Trescientos vecinos que financian 300 contratos pesan exactamente lo mismo que una empresa que financia 300. Por eso en esta página no aparece ningún monto al lado de ningún nombre.",
  },
  {
    Icono: ShieldCheck,
    titulo: "Conflicto de interés, automático",
    texto:
      "Una empresa con sanción vigente, o señalada en alertas de la zona que quiere financiar, puede aportar: su aporte entra a la cola igual. Lo que no hace es aparecer en este muro. El reconocimiento público se pierde; la lectura del contrato, no.",
  },
];

export function ReglasIndependencia() {
  return (
    <section aria-labelledby="reglas-titulo">
      <h2 id="reglas-titulo" className="font-serif text-lg font-bold text-ink">
        Por qué financiar esto no compra nada
      </h2>
      <dl className="mt-3 overflow-hidden rounded-2xl border border-line bg-paper">
        {REGLAS.map(({ Icono, titulo, texto }) => (
          <div key={titulo} className="flex gap-3 border-t border-line px-5 py-4 first:border-t-0 sm:gap-4">
            <Icono size={16} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
            <div className="min-w-0">
              <dt className="text-sm font-semibold text-ink">{titulo}</dt>
              <dd className="mt-1 max-w-[72ch] text-[13px] leading-relaxed text-mute">{texto}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * La prueba de independencia donde de verdad importa: pegada a la lista de
 * contratos de un aliado concreto, no como letra chica al pie de la página.
 * Es la diferencia entre declarar la independencia y mostrarla.
 */
export function PruebaIndependencia({ nombre }: { nombre: string }) {
  return (
    <aside className="flex gap-3 rounded-2xl border border-heroViolet/25 bg-heroViolet-soft/60 px-4 py-3.5 sm:px-5">
      <Scale size={16} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
      <p className="max-w-[72ch] text-[13px] leading-relaxed text-inkSoft">
        <strong className="font-semibold text-ink">{nombre} no eligió estos contratos.</strong> Al pagar se
        elige una región y una cantidad; los contratos concretos salen de la cola por antigüedad, en una
        consulta SQL que corre antes de que arranque el análisis. Los agentes que los leen no reciben el
        nombre de quien financió, y el dictamen se publica igual si termina señalando a {nombre}.
      </p>
    </aside>
  );
}
