import { BuscarGlobal } from "@/components/BuscarGlobal";
import { numero, porcentaje } from "@/lib/formato";
import { AnilloProgreso } from "./AnilloProgreso";

/**
 * Cabecera de /app: la pregunta, el buscador grande y las cifras de hoy como tarjetas con su anillo.
 * Cada anillo dice "qué parte de qué": leídos de publicados, señales altas de leídos, esperando lectura de publicados.
 * Si una lectura falló, su tarjeta no se dibuja (nada se estima).
 */
export interface CifrasInicio {
  publicados: number;
  leidos: number;
  conSenalAlta: number | null;
  enCola: number | null;
}

export function HeroInicio({ c }: { c: CifrasInicio | null }) {
  const tarjetas: { valor: string; etiqueta: string; detalle: string; pct?: number }[] = [];
  if (c && c.publicados > 0) {
    tarjetas.push({ valor: numero(c.publicados), etiqueta: "contratos publicados", detalle: "En el SEACE, que Vigía tiene en su base" });
    tarjetas.push({
      valor: numero(c.leidos), etiqueta: "ya leídos",
      detalle: `${porcentaje((c.leidos / c.publicados) * 100, { decimales: 1 })} de los publicados`,
      pct: (c.leidos / c.publicados) * 100,
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
        pct: (c.enCola / c.publicados) * 100,
      });
    }
  }
  return (
    <header className="space-y-5">
      <div className="max-w-3xl">
        <h1 className="font-display text-[30px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[40px]">
          ¿Qué quieres revisar hoy?
        </h1>
        <p className="mt-2 text-[16px] leading-snug text-inkSoft text-pretty">
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
                <dt className="mt-1.5 text-[14px] font-semibold leading-tight text-ink sm:text-[15px]">{t.etiqueta}</dt>
                <dd className="mt-0.5 text-[13px] leading-snug text-mute">{t.detalle}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}
    </header>
  );
}
