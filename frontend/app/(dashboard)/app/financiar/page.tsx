import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ZonaPicker } from "@/components/financiar/ZonaPicker";
import { RankingTable } from "@/components/financiar/RankingTable";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { getEstadoGlobal, getRanking, getRecientes, getZonas, formatPEN } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";

export const metadata = {
  title: "Financia una auditoría — Vigía Perú",
  description:
    "Cada región del Perú tiene contratos públicos que nadie ha leído. Financia la capacidad de auditarlos: S/ 3 por contrato, resultados públicos, reconocimiento verificable.",
};

export const revalidate = 120;

export default async function FinanciarPage({ searchParams }: { searchParams?: { ubigeo?: string } }) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);
  const [zonas, estado, ranking, recientes, resumenContratos] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getRanking("todo"),
    getRecientes(),
    getResumenContratos(),
  ]);
  const precio = estado?.tarifa.precioPen ?? 3;
  const conCola = (zonas ?? []).filter((z) => z.totalCola > 0).length;

  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-br from-heroViolet/[0.06] via-paperDeep to-heroGreen/[0.05]">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-heroViolet/10 blur-3xl" />
        <div className="container-page relative grid gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            {/* Acá había una píldora mayúscula ("FINANCIAMIENTO DE AUDITORÍA
                INDEPENDIENTE") sobre el h1. Es el kicker que Impeccable prohíbe
                sin excepción: le robaba jerarquía al titular sin agregar nada
                que el titular no dijera mejor. */}
            <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
              El Estado publica todos sus contratos.<br />
              <em className="text-heroGreen not-italic">Nadie tiene capacidad de leerlos.</em>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-mute">
              Vigía lee contratos públicos con un pipeline de 10 agentes y publica las señales de riesgo.
              Cada contrato cuesta <strong className="text-ink">{formatPEN(precio)}</strong> de cómputo e IA.
              Elige una zona y <strong className="text-ink">financia la capacidad de auditar</strong> sus
              contratos pendientes. Los resultados son públicos, siempre.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#zonas" className="inline-flex items-center gap-2 rounded-xl bg-heroViolet px-5 py-3 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">
                Elegir mi zona <ArrowRight size={16} />
              </a>
              <a href="#independencia" className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep">
                <ShieldCheck size={16} /> Cómo se protege la independencia
              </a>
            </div>
          </div>

          {/* Antes: seis cajas de "número grande + label chico" en grilla 2×3.
              Seis cifras del mismo tamaño, sin relación entre ellas, y ninguna
              comparada con nada — así "S/ 135 destinado a auditoría" y "4.162
              contratos en cola" pesaban visualmente igual, y el dato que de
              verdad explica por qué existe este producto (45 leídos de 18.394
              publicados, un 0,24%) no aparecía por ningún lado.
              Ahora el bloque ES esa comparación. */}
          <BalanceLectura
            leidos={estado?.contratosProcesados ?? 0}
            financiados={estado?.contratosFinanciados ?? 0}
            publicados={resumenContratos?.total ?? 0}
            senales={estado?.senalesHalladas ?? 0}
            enCola={estado?.colaGlobal ?? 0}
            regionesConCola={estado?.regionesConCola ?? conCola}
            regionesConAuditoria={estado?.regionesConAuditoria ?? 0}
            montoPen={estado?.montoPen ?? 0}
            precio={precio}
          />
        </div>
      </section>

      {/* ─── ELIGE TU ZONA (sin mapa: el mapa vive en /app/mapa) ─── */}
      <section id="zonas" className="container-page scroll-mt-20 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl font-bold text-ink">Elige la zona que quieres auditar</h2>
            <p className="mt-1 max-w-2xl text-sm text-mute">
              Busca tu departamento, provincia o distrito. Verás cuántos contratos esperan lectura y cuánto cuesta cubrirlos.
              Si prefieres verlo en el mapa, <Link href="/app/mapa" className="underline transition-colors hover:text-ink">ábrelo aquí</Link>.
            </p>
          </div>
          <div className="text-xs text-mute">Fuente: SEACE/OECE vía OCDS, actualizado a diario</div>
        </div>
        <ZonaPicker zonas={zonas ?? []} precioPen={precio} />
      </section>

      {/* ─── RANKING + RECIENTES ─── */}
      <section className="container-page grid gap-10 py-16 lg:grid-cols-[1.2fr_1fr]">
        <div>
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-3xl font-bold text-ink">Ranking de impacto</h2>
            <span className="text-xs text-mute">se cuenta en contratos, no en soles</span>
          </div>
          <div className="mt-4">
            <RankingTable rows={ranking ?? []} />
          </div>
        </div>
        <div>
          <h2 className="font-serif text-3xl font-bold text-ink">Últimos aportes</h2>
          <div className="mt-4">
            <RecientesFeed items={recientes ?? []} />
          </div>
        </div>
      </section>

      {/* ─── INDEPENDENCIA ─── */}
      <section id="independencia" className="scroll-mt-20 border-t border-line bg-ink py-16 text-paper">
        <div className="container-page grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <ShieldCheck size={28} className="text-heroGreen" />
            <h2 className="mt-4 font-serif text-3xl font-bold">Financias capacidad, no resultados</h2>
            <p className="mt-3 text-paper/70">
              Esto no es comprar una región ni patrocinar un informe. Es pagar el cómputo para que contratos
              que ya son públicos sean, por fin, leídos. Las reglas están en el código, no en una promesa.
            </p>
            <Link href="/preguntas#cuentas" className="mt-4 inline-block text-sm text-heroGreenTexto underline-offset-2 hover:underline">
              Ver el balance público y el código →
            </Link>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            <Rule title="Sin selección">La asignación es FIFO por zona, en SQL. Ninguna API acepta un contrato elegido por el financiador.</Rule>
            <Rule title="Sin edición">El pipeline de análisis no lee quién financió. Los prompts no reciben ese dato.</Rule>
            <Rule title="Conflicto automático">Empresa con sanción vigente o con alertas activas en la zona: el aporte procesa contratos igual, pero no aparece en ranking ni muro.</Rule>
            <Rule title="Publicación incondicional">Si el análisis que financiaste te detecta a ti, se publica igual. Tu comprobante lo mostrará.</Rule>
            <Rule title="Reconocimiento aditivo">Varios aliados pueden apoyar la misma zona. Nadie la "tiene".</Rule>
            <Rule title="Trazabilidad">Cada comprobante enlaza a los dossiers y a la traza de observabilidad de cada contrato.</Rule>
          </ul>
        </div>
      </section>

    </div>
  );
}

/**
 * El déficit de lectura, que es la razón de existir del producto.
 *
 * La barra no es decoración: a escala real lo leído es una astilla contra el
 * total publicado, y ver esa astilla explica en un segundo por qué hace falta
 * financiar. Por eso la astilla tiene ancho mínimo — si se dibujara a escala
 * exacta (0,24%) sería medio píxel y no se vería nada, que es mentir por
 * redondeo en la dirección cómoda.
 *
 * Ninguna cifra viaja sola: cada una lleva al lado contra qué se compara.
 */
function BalanceLectura({
  leidos,
  financiados,
  publicados,
  senales,
  enCola,
  regionesConCola,
  regionesConAuditoria,
  montoPen,
  precio,
}: {
  leidos: number;
  financiados: number;
  publicados: number;
  senales: number;
  enCola: number;
  regionesConCola: number;
  regionesConAuditoria: number;
  montoPen: number;
  precio: number;
}) {
  const n = (v: number) => v.toLocaleString("es-PE");
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;
  const anchoLeido = publicados > 0 ? Math.max(0.8, pct) : 0;

  return (
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6">
      <p className="text-[13px] leading-relaxed text-mute">
        De los <strong className="font-mono font-semibold text-ink">{n(publicados)}</strong> contratos
        publicados que Vigía tiene descargados, se han leído
      </p>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-4xl font-bold leading-none text-heroViolet">{n(leidos)}</span>
        <span className="text-sm text-mute">
          {publicados > 0 && <>{pct.toLocaleString("es-PE", { maximumFractionDigits: 2 })} % del total</>}
        </span>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep" role="img"
        aria-label={`${n(leidos)} contratos leídos de ${n(publicados)} publicados`}>
        <div className="h-full bg-heroViolet" style={{ width: `${anchoLeido}%` }} />
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px]">
        <Fila termino="Financiados hasta hoy">
          <strong className="font-mono text-ink">{n(financiados)}</strong> contratos por{" "}
          {formatPEN(montoPen)}, a {formatPEN(precio)} cada uno
        </Fila>
        <Fila termino="Señales encontradas">
          <strong className="font-mono text-ink">{n(senales)}</strong> en los {n(leidos)} leídos
          {regionesConAuditoria > 0 && <>, repartidos en {n(regionesConAuditoria)} regiones con auditoría activa</>}
        </Fila>
        <Fila termino="Esperando lectura">
          <strong className="font-mono text-ink">{n(enCola)}</strong> contratos en cola, en{" "}
          {n(regionesConCola)} regiones
        </Fila>
      </dl>
    </div>
  );
}

function Fila({ termino, children }: { termino: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <dt className="text-mute">{termino}</dt>
      <dd className="text-right text-inkSoft">{children}</dd>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-paper/15 bg-paper/[0.06] p-4">
      <div className="text-sm font-semibold text-paper">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-paper/65">{children}</p>
    </li>
  );
}
