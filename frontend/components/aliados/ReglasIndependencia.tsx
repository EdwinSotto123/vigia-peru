import { ListOrdered, Scale, ShieldCheck } from "lucide-react";
import { Popover } from "@/components/ui/Flotante";

/**
 * Las tres reglas que hacen que este muro no sea publicidad, cada una en UNA
 * frase y con el detalle detrás de un popover.
 *
 * Antes cada una traía un párrafo de tres renglones: nueve renglones de letra
 * chica al pie de una página cuyo protagonista debería ser quien financia. El
 * argumento no se puede borrar —es la promesa del producto— pero sí se puede
 * decir en una línea y dejar la letra chica a un clic de distancia.
 */
const REGLAS = [
  {
    Icono: Scale,
    titulo: "Nadie elige qué se audita",
    resumen: "Ni quien paga, ni nosotros.",
    detalle:
      "Los contratos se asignan por antigüedad en la cola, en una consulta SQL. El pipeline de agentes no recibe ni conoce el nombre de quien financió. Los resultados se publican igual, incluso si señalan a quien pagó.",
  },
  {
    Icono: ListOrdered,
    titulo: "Se cuenta en contratos, nunca en soles",
    resumen: "300 vecinos pesan igual que una empresa.",
    detalle:
      "Trescientos vecinos que financian 300 contratos pesan exactamente lo mismo que una empresa que financia 300. Por eso en esta página no aparece ningún monto al lado de ningún nombre.",
  },
  {
    Icono: ShieldCheck,
    titulo: "Conflicto de interés, automático",
    resumen: "Con sanción vigente se puede aportar, pero no aparecer.",
    detalle:
      "Una empresa con sanción vigente, o señalada en alertas de la zona que quiere financiar, puede aportar: su aporte entra a la cola igual. Lo que no hace es aparecer en este muro. El reconocimiento público se pierde; la lectura del contrato, no.",
  },
];

export function ReglasIndependencia() {
  return (
    <section aria-labelledby="reglas-titulo">
      <h2 id="reglas-titulo" className="font-serif text-lg font-bold text-ink">
        Por qué financiar esto no compra nada
      </h2>
      <dl className="mt-3 grid gap-3 sm:grid-cols-3">
        {REGLAS.map(({ Icono, titulo, resumen, detalle }) => (
          <div key={titulo} className="rounded-2xl border border-line bg-paper px-4 py-3.5">
            <dt className="flex items-start gap-2.5">
              <Icono size={16} className="mt-0.5 shrink-0 text-heroViolet" aria-hidden />
              <span className="text-[13px] font-semibold leading-snug text-ink">{titulo}</span>
            </dt>
            <dd className="mt-1.5 text-[13px] leading-snug text-mute">
              {resumen}{" "}
              <Popover
                titulo={titulo}
                anchoClase="w-80"
                className="align-baseline text-[12px] font-medium text-heroViolet underline underline-offset-2 hover:text-heroViolet-deep"
                trigger={<>cómo</>}
              >
                {detalle}
              </Popover>
            </dd>
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
