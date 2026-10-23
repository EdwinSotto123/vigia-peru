import { BuscarGlobal } from "@/components/BuscarGlobal";
import { numero, porcentaje } from "@/lib/formato";
import { AnilloProgreso } from "./AnilloProgreso";

/**
 * Cabecera de /app: la pregunta, el buscador grande y las cifras de hoy como tarjetas con su anillo.
 * Cada anillo dice "qué parte de qué": leídos y esperando lectura de los publicados de este año (lo que Vigía lee;
 * la base trae además la historia desde 2015), señales altas de los leídos.
 * Si una lectura falló, su tarjeta no se dibuja (nada se estima).
 */
export interface CifrasInicio {
  publicados: number;
  /** Los publicados del año en curso: la medida de los anillos. Sin él, se mide contra todos. */
  delAnio?: { anio: number; publicados: number } | null;
  leidos: number;
  conSenalAlta: number | null;
  enCola: number | null;
}

export function HeroInicio({ c }: { c: CifrasInicio | null }) {
  const tarjetas: { valor: string; etiqueta: string; detalle: string; pct?: number }[] = [];
  if (c && c.publicados > 0) {
    const base = c.delAnio && c.delAnio.publicados > 0 ? c.delAnio.publicados : c.publicados;
    const deQue = c.delAnio && c.delAnio.publicados > 0 ? `de los ${numero(c.delAnio.publicados)} de ${c.delAnio.anio}` : "de los publicados";
    tarjetas.push({
      valor: numero(c.publicados), etiqueta: "contratos publicados",
      detalle: c.delAnio ? `En el SEACE desde 2015; ${numero(c.delAnio.publicados)} de ${c.delAnio.anio}` : "En el SEACE, que Vigía tiene en su base",
    });
    tarjetas.push({
      valor: numero(c.leidos), etiqueta: "ya leídos",
      detalle: `${porcentaje((c.leidos / base) * 100, { decimales: 1 })} ${deQue}`,
      pct: (c.leidos / base) * 100,
    });
    if (c.conSenalAlta != null && c.leidos > 0) {
      tarjetas.push({
        // "Riesgo alto", como en Contratos y en la ficha de cada entidad (antes aquí decía "señal alta").
        valor: numero(c.conSenalAlta), etiqueta: "con riesgo alto",
        detalle: `${porcentaje((c.conSenalAlta / c.leidos) * 100)} de los leídos, para revisar`,
        pct: (c.conSenalAlta / c.leidos) * 100,
      });
    }
    if (c.enCola != null) {
      tarjetas.push({
        valor: numero(c.enCola), etiqueta: "esperando lectura",
        detalle: "Se leen cuando alguien los financia",
        pct: (c.enCola / base) * 100,
      });
    }
  }
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
      {tarjetas.length > 0 && (
        <dl className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
          {tarjetas.map((t) => (
            <div key={t.etiqueta} className="flex items-center gap-4 rounded-2xl border border-line bg-paper p-3.5 sm:p-5">
              {t.pct != null ? <AnilloProgreso pct={t.pct} className="hidden sm:block" /> : null}
              <div className="min-w-0">
                <dd className="font-display text-2xl font-bold leading-none tabular-nums text-ink sm:text-4xl">{t.valor}</dd>
                <dt className="mt-1.5 text-dato font-semibold leading-tight text-ink sm:text-cuerpo">{t.etiqueta}</dt>
                <dd className="mt-0.5 text-meta leading-snug text-mute">{t.detalle}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
