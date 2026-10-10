import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Building2, Camera, Flag, Heart, Landmark, MapPin, type LucideIcon } from "lucide-react";
import { BuscarGlobal } from "@/components/BuscarGlobal";
import { Pagina } from "@/components/patrones";
import { getAlertas } from "@/lib/api-client";
import { getResumenContratos } from "@/lib/contratos";
import { getEstadoGlobal } from "@/lib/financiamiento";
import { numero, porcentaje, relativo } from "@/lib/formato";
import { contarLeidos, tituloNatural, type AlertaReal } from "@/lib/landing";

export const metadata: Metadata = { title: "Inicio" };

/**
 * Pantalla principal de la app: lo simple primero. Una pregunta (qué quieres hacer), un campo
 * de búsqueda grande, seis caminos en palabras de persona, las cifras de hoy y lo último que
 * Vigía leyó. Cada destino tiene UNA entrada (sin botones repetidos). El mapa, las señales y el
 * resto siguen siendo las páginas de siempre: esto sólo las pone a un clic y dice para qué sirven.
 *
 * Toda cifra sale de las mismas lecturas que usa el resto de la app. Si una falla, su bloque no
 * se dibuja: nunca se rellena con un número plausible.
 */

const CAMINOS: { href: string; Icono: LucideIcon; titulo: string; texto: string }[] = [
  { href: "/app/mapa", Icono: MapPin, titulo: "Ver qué se contrata en mi región", texto: "Elige tu región en el mapa y mira sus contratos." },
  { href: "/app/hallazgos", Icono: Flag, titulo: "Revisar las señales de alerta", texto: "Contratos con algo que merece una segunda mirada, con la norma y la evidencia." },
  { href: "/app/entidades", Icono: Building2, titulo: "Buscar una empresa o entidad", texto: "Quién contrata, a quién le compra y cuánto." },
  { href: "/app/partidos", Icono: Landmark, titulo: "Ver quién gobierna mi región", texto: "Autoridades electas y cuánto vigilamos en cada lugar." },
  { href: "/app/financiar", Icono: Heart, titulo: "Financiar la lectura de contratos", texto: "Tu aporte paga que Vigía lea más contratos." },
  { href: "/reporte/nuevo", Icono: Camera, titulo: "Denunciar una obra", texto: "Sube una foto y la ubicación de lo que ves." },
];

/** Lo último: contratos con señales, del más reciente al más antiguo. Sin nombres de personas. */
function ultimasSenales(alertas: AlertaReal[], cuantos = 5): AlertaReal[] {
  return alertas
    .filter((a) => !!a.codigo && !!a.codigoconvocatoria && (a.banderas?.length ?? 0) > 0)
    .sort((a, b) => (b.fechaBuenaPro ?? "").localeCompare(a.fechaBuenaPro ?? ""))
    .slice(0, cuantos);
}

export default async function InicioApp() {
  const [resumen, estado, alertas] = await Promise.all([
    getResumenContratos().catch(() => null),
    getEstadoGlobal().catch(() => null),
    getAlertas({ limit: 60 }).catch(() => []),
  ]);

  const publicados = resumen?.total ?? 0;
  const leidos = contarLeidos(resumen?.porRiesgo) ?? 0;
  const conSenalAlta = resumen?.porRiesgo.alto ?? null;
  const enCola = estado?.colaGlobal ?? null;
  const cifras: { valor: string; etiqueta: string; detalle?: string }[] = [];
  if (resumen && publicados > 0) {
    cifras.push({ valor: numero(publicados), etiqueta: "contratos publicados", detalle: "En el SEACE, que Vigía tiene en su base" });
    cifras.push({ valor: numero(leidos), etiqueta: "ya leídos", detalle: `${porcentaje((leidos / publicados) * 100, { decimales: 1 })} del total` });
    if (conSenalAlta != null) cifras.push({ valor: numero(conSenalAlta), etiqueta: "con señal alta", detalle: "Para revisar, no son acusaciones" });
  }
  if (enCola != null) cifras.push({ valor: numero(enCola), etiqueta: "esperando lectura", detalle: "Se leen cuando alguien los financia" });

  const ultimas = ultimasSenales(alertas as unknown as AlertaReal[]);

  return (
    <div className="min-h-screen bg-paperSoft">
      <Pagina className="space-y-8">
        <header className="max-w-3xl">
          <h1 className="font-display text-[30px] font-bold leading-tight tracking-tight text-ink text-balance sm:text-[38px]">
            ¿Qué quieres revisar hoy?
          </h1>
          <p className="mt-2 text-[16px] leading-snug text-inkSoft text-pretty">
            Vigía lee los contratos del Estado y marca los que merecen una segunda mirada. Busca algo concreto o elige un camino.
          </p>
        </header>

        <BuscarGlobal variant="grande" atajo={false} />

        <section aria-labelledby="caminos-titulo">
          <h2 id="caminos-titulo" className="sr-only">Qué puedes hacer</h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {CAMINOS.map(({ href, Icono, titulo, texto }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group flex h-full items-start gap-4 rounded-2xl border border-line bg-paper p-4 transition-colors duration-rapido hover:border-granate/50 hover:bg-granate-50 sm:p-5"
                >
                  <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-granate-soft text-granate transition-colors duration-rapido group-hover:bg-granate group-hover:text-paper">
                    <Icono size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[16px] font-semibold leading-snug text-ink">{titulo}</span>
                    <span className="mt-1 block text-[14px] leading-snug text-mute">{texto}</span>
                  </span>
                  <ArrowUpRight size={16} aria-hidden className="mt-1 shrink-0 text-mute transition-colors duration-rapido group-hover:text-granate" />
                </Link>
              </li>
            ))}
          </ul>
        </section>

        {cifras.length > 0 && (
          <section aria-labelledby="cifras-titulo">
            <h2 id="cifras-titulo" className="etiqueta-mono mb-3">Hoy en Vigía</h2>
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {cifras.map((c) => (
                <div key={c.etiqueta} className="rounded-2xl border border-line bg-paper p-4 sm:p-5">
                  <dd className="font-display text-3xl font-bold leading-none tabular-nums text-ink sm:text-4xl">{c.valor}</dd>
                  <dt className="mt-2 text-[15px] font-semibold text-ink">{c.etiqueta}</dt>
                  {c.detalle && <dd className="mt-0.5 text-[13px] leading-snug text-mute">{c.detalle}</dd>}
                </div>
              ))}
            </dl>
          </section>
        )}

        {ultimas.length > 0 && (
          <section aria-labelledby="ultimo-titulo">
            <h2 id="ultimo-titulo" className="etiqueta-mono mb-3">Lo último que Vigía marcó</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
              {ultimas.map((a) => {
                const n = a.banderas?.length ?? 0;
                return (
                  <li key={a.codigo}>
                    <Link
                      href={`/app/convocatoria/${encodeURIComponent(a.codigoconvocatoria)}`}
                      className="flex items-start justify-between gap-4 px-4 py-3.5 transition-colors duration-rapido hover:bg-granate-50 sm:px-5"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-semibold text-ink">{a.objeto ? tituloNatural(a.objeto) : "Contrato sin título"}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-mute">
                          {[a.entidad && tituloNatural(a.entidad), a.region].filter(Boolean).join(", ")}
                        </span>
                      </span>
                      <span className="shrink-0 text-right text-[13px] leading-snug text-mute">
                        <span className="block font-semibold text-ink">{n} {n === 1 ? "señal" : "señales"}</span>
                        {a.fechaBuenaPro && <span className="block">{relativo(a.fechaBuenaPro)}</span>}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-[13px] text-mute">Una señal es un motivo para revisar un contrato, nunca una acusación.</p>
          </section>
        )}
      </Pagina>
    </div>
  );
}
