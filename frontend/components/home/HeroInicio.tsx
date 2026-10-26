import Link from "next/link";
import { ArrowRight, Camera, Flag, MapPin, type LucideIcon } from "lucide-react";
import { BuscarGlobal } from "@/components/BuscarGlobal";
import { Indicadores, type Indicador } from "@/components/listado";
import { Ayuda } from "@/components/patrones/Ayuda";
import { numero } from "@/lib/formato";
import { pctDe, type CifrasAnio } from "@/lib/cifras";

/**
 * Cabecera de /app: la pregunta, el buscador grande, tres caminos del ciudadano y las cifras de hoy.
 *
 * Las cifras son `Indicadores` del kit (qué es arriba, el número, el contexto abajo), como en el resto de la app. Antes
 * eran tarjetas propias con el número arriba y la etiqueta abajo, y un anillo por tarjeta medido contra tres bases
 * distintas que en el celular desaparecía. «Publicados», «leídos» y «con riesgo alto» salen del MISMO resumen del año
 * (`lib/cifras`): son los números del mapa, de financiar y de la portada. «En cola» es la cola de financiamiento.
 *
 * Si una lectura falló, su cifra dice «Sin dato»; si fallaron todas, la fila no se dibuja (nada se estima).
 */
export interface CifrasInicio {
  /** Publicados, leídos y riesgo alto del año en curso; `null` si el resumen no respondió. */
  anio: CifrasAnio | null;
  /** Contratos en cola de financiamiento; `null` si el estado no respondió. */
  enCola: number | null;
}

/** Los tres caminos del ciudadano: su región, lo que Vigía marcó y lo que él ve en la calle. Buscar ya está arriba. */
const CAMINOS: { href: string; Icono: LucideIcon; texto: string }[] = [
  { href: "/app/mapa", Icono: MapPin, texto: "Ver qué se contrata en mi región" },
  { href: "/app/hallazgos", Icono: Flag, texto: "Revisar las señales" },
  { href: "/reporte/nuevo", Icono: Camera, texto: "Denunciar una obra" },
];

function cifras(c: CifrasInicio): Indicador[] {
  const a = c.anio;
  const items: Indicador[] = [
    {
      valor: a ? numero(a.publicados) : null,
      etiqueta: "contratos publicados",
      contexto: a ? `en ${a.anio}, en el SEACE` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué contratos se cuentan?">
          Las convocatorias que las entidades publicaron este año en el SEACE: las que Vigía lee y se pueden financiar. La
          base trae además las de años anteriores, desde 2015, en Contratos.
        </Ayuda>
      ),
    },
    {
      valor: a ? numero(a.leidos) : null,
      etiqueta: "contratos leídos",
      contexto: a ? `${pctDe(a.leidos, a.publicados) ?? "Sin dato"} de los publicados en ${a.anio}` : undefined,
      ayuda: (
        <Ayuda titulo="¿Qué cuenta como leído?">
          Todo contrato cuyo análisis terminó, por cualquier vía, financiado o no. Es la misma cifra del mapa, de financiar
          y de la portada.
        </Ayuda>
      ),
    },
    {
      valor: a ? numero(a.riesgoAlto) : null,
      etiqueta: "con riesgo alto",
      contexto: a ? `de ${numero(a.leidos)} leídos, para revisar` : undefined,
      // La cifra abre la lista que cuenta: los contratos del año con peso del riesgo alto.
      href: a ? `/app/contratos?riesgo=alto&mes=${a.anio}` : undefined,
    },
    {
      valor: c.enCola != null ? numero(c.enCola) : null,
      etiqueta: "en cola",
      contexto: c.enCola != null ? "esperan que alguien financie su lectura" : undefined,
      href: c.enCola != null ? "/app/financiar" : undefined,
    },
  ];
  return items;
}

export function HeroInicio({ c }: { c: CifrasInicio }) {
  const hayCifras = c.anio != null || c.enCola != null;
  return (
    <header className="space-y-5">
      <div className="max-w-3xl">
        <h1 className="font-display text-titulo font-bold leading-tight tracking-tight text-ink text-balance sm:text-portada">
          ¿Qué quieres revisar hoy?
        </h1>
        <p className="mt-2 text-destacado leading-snug text-inkSoft text-pretty">
          Vigía lee los contratos del Estado y marca los que merecen una segunda mirada. Busca algo concreto o mira lo que pasa ahora.
        </p>
      </div>
      <BuscarGlobal variant="grande" atajo={false} />
      {/* Tres caminos en una fila de enlaces: antes eran ocho tarjetas iguales que repetían el menú. */}
      <nav aria-label="Por dónde empezar" className="flex flex-wrap items-center gap-x-6 gap-y-1">
        {CAMINOS.map(({ href, Icono, texto }) => (
          <Link
            key={href}
            href={href}
            className="group inline-flex min-h-10 items-center gap-2 text-dato font-semibold text-granate underline-offset-4 hover:underline"
          >
            <Icono size={16} className="shrink-0" aria-hidden />
            {texto}
            <ArrowRight size={14} className="shrink-0 transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
          </Link>
        ))}
      </nav>
      {hayCifras && <Indicadores items={cifras(c)} />}
    </header>
  );
}
