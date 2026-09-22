import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { NumberTicker } from "@/components/magicui/NumberTicker";
import { Marquee } from "@/components/magicui/Marquee";
import { PulseDot } from "@/components/ui/PulseDot";
import { formatSoles } from "@/lib/mock-data";

/**
 * La cifra que este producto existe para cambiar, dicha en grande y una sola vez.
 *
 * Estaba en la base desde el principio y en ninguna parte de la portada: de los
 * ~18 000 contratos que el Estado publicó, se leyeron unas decenas. Esa
 * proporción ES el producto —todo lo demás (los agentes, las fuentes, el
 * financiamiento) existe para moverla— y estaba repartida en tarjetitas de
 * "4.162 contratos en cola" que no dicen nada sin su denominador.
 *
 * La barra está a ESCALA REAL. Con 98 de 18 394, lo leído mide siete píxeles en
 * una barra de mil cuatrocientos. Cualquier mínimo cosmético que la hiciera
 * "legible" estaría mintiendo sobre el tamaño del trabajo hecho, así que en vez
 * de agrandarla se la hace encontrable: late, y una línea guía la señala. Es la
 * misma regla que ya gobierna las barras de /app/aliados.
 *
 * Fondo tinta a sangre completa: es el único corte oscuro de la primera mitad de
 * la página, y sirve para que esta cifra no compita con nada.
 *
 * Si el API no responde, la sección NO se dibuja. Una portada que inventa el
 * número de contratos sin leer es exactamente la clase de dato que este producto
 * le reprocha al Estado.
 */
export function LaBrecha({
  publicados,
  leidos,
  senalAlta,
  precioPen,
  alertas,
}: {
  /**
   * Las tres cifras salen del MISMO objeto (`getResumenContratos`) y por lo
   * tanto del mismo universo. `getEstadoGlobal` tiene un `contratosProcesados`
   * que parece servir y no sirve: cuenta sólo lo financiado por aliados (33 de
   * los 98 leídos). Mezclarlo con `publicados`, que sí es global, daba una
   * portada que se contradecía con /app/contratos dos clics más allá — el mismo
   * problema de recuentos múltiples que el catálogo de agentes vino a cerrar.
   */
  publicados: number;
  leidos: number;
  senalAlta: number;
  /** Tarifa por contrato. Si el API de financiamiento no responde, se omite la frase. */
  precioPen: number | null;
  /** Señales reales para el ticker. Si viene vacío, el ticker no se dibuja. */
  alertas: { id?: string | number; codigo?: string; codigoconvocatoria: string; score: number; region: string; objeto: string; montoSoles?: number | null }[];
}) {
  const sinLeer = Math.max(0, publicados - leidos);
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;
  const pctTxt = pct >= 1 ? pct.toFixed(1) : pct.toFixed(2);
  const n = (v: number) => v.toLocaleString("es-PE");

  return (
    <section aria-labelledby="brecha-titulo" className="relative overflow-hidden bg-ink text-paper">
      {/* Dos halos muy tenues: le dan profundidad al negro sin convertirse en
          decoración con protagonismo propio. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 opacity-60">
        <div className="absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-heroViolet/25 blur-[120px]" />
        <div className="absolute -right-32 bottom-0 h-[24rem] w-[24rem] rounded-full bg-heroGreen/15 blur-[120px]" />
      </div>

      <div className="container-page relative max-w-[1600px] pt-16 sm:pt-20">
        <h2
          id="brecha-titulo"
          className="max-w-[20ch] font-serif text-4xl font-bold leading-[1.05] sm:text-6xl lg:text-7xl"
        >
          El Estado publicó{" "}
          <NumberTicker value={publicados} className="text-heroGreen" duration={1800} /> contratos.
          <span className="mt-2 block text-paper/55">
            Alguien leyó <NumberTicker value={leidos} className="text-paper" duration={1400} />.
          </span>
        </h2>

        {/* ── La barra, a escala real ── */}
        <div className="mt-10">
          <div className="relative h-7 w-full overflow-hidden rounded-full border border-paper/10 bg-paper/[0.06]">
            <div
              className="animate-astillaViva h-full min-w-[6px] rounded-full bg-heroGreen"
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* La guía que hace encontrable la astilla: sube desde la barra hasta
              su etiqueta, en vez de dejar al lector buscando siete píxeles. */}
          <div className="relative mt-2 flex items-start justify-between gap-6">
            <span className="flex items-start gap-2 text-[13px]">
              <span aria-hidden className="mt-[-8px] block h-4 w-px shrink-0 bg-heroGreen/70" />
              <span>
                <span className="block font-mono font-semibold text-heroGreen">{n(leidos)} leídos</span>
                <span className="block text-paper/45">{pctTxt} % del total</span>
              </span>
            </span>
            <span className="text-right text-[13px]">
              <span className="block font-mono font-semibold text-paper/85">{n(publicados)} publicados</span>
              <span className="block text-paper/45">descargados del SEACE, uno por uno</span>
            </span>
          </div>
        </div>

        <div className="mt-9 grid gap-x-12 gap-y-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <p className="max-w-[62ch] text-[15px] leading-relaxed text-paper/75 sm:text-base">
            La barra está a escala real: eso verde es todo lo que se leyó. Y de esos{" "}
            <strong className="font-semibold text-paper">{n(leidos)}</strong>,{" "}
            {/* crimson-soft, no rust: toda la escala de severidad está calibrada
                para fondo CLARO. Sobre tinta, rust (#A81E12) da 1.5:1 y
                desaparece; el extremo claro de la misma familia da ~15:1 y
                sigue leyéndose como alarma. */}
            <strong className="font-semibold text-crimson-soft">{n(senalAlta)}</strong> salieron con señal de riesgo
            alto. Los otros <strong className="font-semibold text-paper">{n(sinLeer)}</strong> siguen sin que
            nadie los abra{precioPen != null && <> — y leer uno cuesta <strong className="font-semibold text-paper">S/ {n(precioPen)}</strong></>}.
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/app/financiar"
              className="group inline-flex items-center gap-2 rounded-full bg-heroGreen px-6 py-3.5 text-[15px] font-semibold text-ink shadow-card transition-transform duration-rapido hover:-translate-y-0.5"
            >
              Financiar la lectura de un contrato
              <ArrowRight size={17} className="transition-transform duration-rapido group-hover:translate-x-0.5" aria-hidden />
            </Link>
            <Link
              href="/app/contratos"
              className="inline-flex items-center gap-2 rounded-full border border-paper/25 px-6 py-3.5 text-[15px] font-medium text-paper transition-colors duration-rapido hover:bg-paper/10"
            >
              Ver los {n(publicados)} contratos
            </Link>
          </div>
        </div>
      </div>

      {/* ── Lo que sí se encontró, en vivo ──
          El ticker vivía suelto en una franja clara entre dos secciones, donde
          era un adorno. Acá es la prueba del párrafo de arriba: esto es lo que
          apareció en la astilla verde. */}
      {alertas.length > 0 && (
        <div className="relative mt-14 border-t border-paper/10">
          <div className="relative overflow-hidden py-2.5">
            <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-40 bg-gradient-to-r from-ink to-transparent" />
            <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-40 bg-gradient-to-l from-ink to-transparent" />
            <div className="pointer-events-none absolute left-4 top-1/2 z-20 inline-flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-rust px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-paper">
              <PulseDot color="paper" size={6} />
              señales halladas
            </div>
            <Marquee className="[--duration:80s] [--gap:3rem] pl-48" pauseOnHover>
              {alertas.map((a) => (
                <Link
                  key={a.id ?? a.codigo ?? a.codigoconvocatoria}
                  href={`/app/convocatoria/${encodeURIComponent(a.codigoconvocatoria)}`}
                  prefetch={false}
                  className="flex items-center gap-3.5 whitespace-nowrap text-xs transition-opacity duration-rapido hover:opacity-70"
                >
                  <span className="rounded bg-rust/25 px-1.5 py-0.5 font-mono text-[10px] font-bold text-paper">
                    score {a.score}
                  </span>
                  <span className="text-paper/60">{a.region}</span>
                  <span className="max-w-[400px] truncate text-paper/90">{a.objeto}</span>
                  <span className="font-mono text-paper/90">{formatSoles(a.montoSoles ?? 0)}</span>
                </Link>
              ))}
            </Marquee>
          </div>
        </div>
      )}
    </section>
  );
}
