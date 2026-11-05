import { CifrasEnFila } from "@/components/ui/CifrasEnFila";
import { numero, plural, solesCompacto } from "@/lib/formato";
import { PARAMS_EN_FICHA, SENAL, type ParamsPersonas, type ResumenPersonas } from "@/lib/personas";
import { ListaConteos, RepartoInicio, SinDato, type FilaConteo, type ParteReparto } from "./BloquesInicio";

/**
 * Lo de adentro del bloque de las personas contratadas (la ficha de una entidad, de un partido y de una región en el
 * servidor; el panel de zona del mapa en el navegador): cuántas personas y cuánto se les pagó, en una franja; el todo
 * partido por su señal más grave (grave, media, leve, sin señales) en una barra con su leyenda; y las señales más
 * frecuentes, cada una con su barra contra el total y su %, y su enlace a la lista filtrada.
 *
 * Antes: «Personas 727,634 personas / Se les pagó S/ 40.9 mil M…» en dos renglones de rótulo y valor a todo el ancho, y
 * «Con alguna señal 33,829» con la barra llena porque se medía contra la fila mayor y no contra el total (auditoría del
 * 2026-11-05).
 *
 * QUÉ CUENTA CADA CIFRA (como ListaPersonas): las señales cuentan CONTRATACIONES (una persona en una entidad), no personas
 * distintas; por eso el total de las barras es `filas`, nunca `personas` (en una región, una persona que trabajó para dos
 * entidades cuenta dos veces). En una entidad las dos unidades son la misma y se dice «personas».
 *
 * `extra`: filas que van antes de las señales frecuentes (el nepotismo de la entidad); su tipo no se repite abajo.
 * `conCifras={false}` cuando la ficha ya dice cuántas personas y cuánto se les pagó (la entidad, en «Sus contratos»).
 */
export function ContenidoPersonas({
  r,
  href,
  P = PARAMS_EN_FICHA,
  extra = [],
  conCifras = true,
  senales = 5,
}: {
  r: ResumenPersonas | null;
  href: (filtro: Record<string, string>) => string;
  P?: ParamsPersonas;
  extra?: FilaConteo[];
  conCifras?: boolean;
  /** Cuántas de las señales más frecuentes; todas, en la lista filtrable («Ver a las personas»). */
  senales?: number;
}) {
  if (!r) return <SinDato>Sin dato: el servicio de personas no respondió.</SinDato>;
  if (!r.filas) return <SinDato>Sin órdenes de servicio a personas registradas.</SinDato>;
  const porPersona = r.filas === r.personas;
  const unidad: [string, string] = porPersona ? ["persona", "personas"] : ["contratación", "contrataciones"];

  // Por su señal más grave. Si el resumen guardado no trae media y leve (uno viejo), con una grave, con otra y sin ninguna.
  const desglose = r.media != null && r.baja != null;
  const sinSenal = Math.max(0, r.filas - (desglose ? r.alta + r.media + r.baja : r.conSenales));
  // Los nombres van bajo el título «Su señal más grave»: «Grave 1,204», no «Con una señal grave» cuatro veces.
  const partes: ParteReparto[] = [
    { clave: "alta", etiqueta: "Grave", n: r.alta, tono: "grave", href: href({ [P.severidad]: "alta" }) },
    ...(desglose
      ? [
          { clave: "media", etiqueta: "Media", n: r.media, tono: "media" as const, href: href({ [P.severidad]: "media" }) },
          { clave: "baja", etiqueta: "Leve", n: r.baja, tono: "neutra" as const, href: href({ [P.severidad]: "baja" }) },
        ]
      : [{ clave: "otra", etiqueta: "Otra", n: Math.max(0, r.conSenales - r.alta), tono: "neutra" as const }]),
    { clave: "sin", etiqueta: "Sin señales", n: sinSenal, tono: "ninguna", href: href({ [P.severidad]: "sin" }) },
  ];

  const yaEnExtra = new Set(extra.map((f) => f.tipo).filter(Boolean));
  const filas: FilaConteo[] = [
    ...extra.map((f) => (f.de ? f : { ...f, de: r.filas })),
    // recorte: las señales más frecuentes; todas, en la lista filtrable de la pestaña («Ver a las personas»)
    ...r.porSenal
      .filter((s) => s.n > 0 && !yaEnExtra.has(s.tipo))
      .slice(0, senales)
      .map((s) => ({ etiqueta: SENAL[s.tipo]?.titulo ?? s.tipo, n: s.n, href: href({ [P.senal]: s.tipo }), grupo: "Las señales más frecuentes", tipo: s.tipo, de: r.filas })),
  ];

  return (
    <div className="space-y-4">
      {conCifras && (
        <CifrasEnFila
          items={[
            {
              valor: numero(r.personas),
              etiqueta: r.personas === 1 ? "persona" : "personas",
              // Cuando no son lo mismo, la unidad de las señales se explica aquí, una vez.
              contexto: porPersona ? undefined : `en ${plural(r.filas, "contratación", "contrataciones")}: una persona en una entidad`,
            },
            { valor: solesCompacto(r.monto), etiqueta: "pagados", contexto: `en ${plural(r.ordenes, "orden de servicio", "órdenes de servicio")}` },
          ]}
        />
      )}
      <RepartoInicio className="px-3.5" titulo="Su señal más grave" de={`de ${plural(r.filas, unidad[0], unidad[1])}`} partes={partes} />
      {filas.length > 0 && <ListaConteos filas={filas} />}
    </div>
  );
}
