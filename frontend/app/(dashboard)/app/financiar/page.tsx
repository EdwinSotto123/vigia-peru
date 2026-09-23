import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, Clock, Code2, ShieldCheck } from "lucide-react";
import { ZonaPicker } from "@/components/financiar/ZonaPicker";
import { RecientesFeed } from "@/components/financiar/RecientesFeed";
import { TOTAL_AGENTES } from "@/components/agentes/catalogo";
import {
  alcanceCorto,
  formatPEN,
  frasePartesTarifa,
  getEstadoGlobal,
  getPago,
  getRecientes,
  getZonas,
  partesTarifa,
  type ParteTarifa,
} from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";

const REPO = "https://github.com/EdwinSotto123/vigia-peru";

export async function generateMetadata() {
  const estado = await getEstadoGlobal();
  const precio = estado?.tarifa.precioPen;
  return {
    title: "Financia una auditoría",
    description: `Cada región del Perú tiene contratos públicos que nadie ha leído. Financia la capacidad de auditarlos${precio != null ? `: ${formatPEN(precio)} por contrato` : ""}, con resultados públicos y reconocimiento contado en contratos.`,
  };
}

export const revalidate = 120;

export default async function FinanciarPage({ searchParams }: { searchParams?: { ubigeo?: string } }) {
  // Llegada desde el mapa con la zona ya elegida (/app/financiar?ubigeo=21) → directo al paso de cantidad.
  const u = searchParams?.ubigeo;
  if (u && /^\d{2}(\d{2}(\d{2})?)?$/.test(u)) redirect(`/app/financiar/${u}`);
  const [zonas, estado, recientes, resumenContratos, pago] = await Promise.all([
    getZonas("departamento"),
    getEstadoGlobal(),
    getRecientes(),
    getResumenContratos(),
    getPago(),
  ]);
  const precio = estado?.tarifa.precioPen ?? null;
  const partes = partesTarifa(estado?.tarifa.nota);
  const conCola = (zonas ?? []).filter((z) => z.totalCola > 0).length;
  const pagosAbiertos = !!pago?.configurado;

  return (
    <div className="bg-paper">
      {/* ─── HERO ─── */}
      <section className="relative overflow-hidden border-b border-line bg-gradient-to-br from-heroViolet/[0.06] via-paperDeep to-heroGreen/[0.05]">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-heroViolet/10 blur-3xl" />
        <div className="container-page relative grid gap-10 py-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
          <div>
            <h1 className="font-serif text-3xl font-bold leading-tight tracking-tight text-ink sm:text-4xl">
              El Estado publica todos sus contratos.<br />
              <em className="text-heroGreenTexto not-italic">Nadie tiene capacidad de leerlos.</em>
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-inkSoft">
              Vigía lee contratos públicos con {TOTAL_AGENTES} agentes de IA y publica las señales de riesgo.
              {precio != null && (
                <>
                  {" "}Leer un contrato cuesta <strong className="text-ink">{formatPEN(precio)}</strong>
                  {partes.length > 0 ? <>: {frasePartesTarifa(partes)}.</> : "."}
                </>
              )}{" "}
              Elige una zona y <strong className="text-ink">financia la capacidad de auditar</strong> sus
              contratos pendientes. Los resultados son públicos, siempre.
            </p>
            {!pagosAbiertos && (
              <p className="mt-4 flex max-w-xl items-start gap-2 rounded-xl border border-line bg-paper px-4 py-3 text-sm leading-relaxed text-inkSoft">
                <Clock size={16} className="mt-0.5 shrink-0 text-inkSoft" aria-hidden />
                <span>
                  <strong className="text-ink">Los aportes todavía no están abiertos:</strong> aún no hay un medio de
                  pago conectado. Hoy la lectura la paga Vigía Perú con su propio capital semilla. Puedes elegir una
                  zona para ver su cola, seguirla y mirar cómo avanza.
                </span>
              </p>
            )}
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#zonas" className="inline-flex items-center gap-2 rounded-xl bg-heroViolet px-5 py-3 text-sm font-semibold text-paper shadow-card transition-all hover:-translate-y-0.5 hover:shadow-paper">
                {pagosAbiertos ? "Elegir mi zona" : "Ver las zonas"} <ArrowRight size={16} aria-hidden />
              </a>
              <a href="#independencia" className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper px-5 py-3 text-sm font-semibold text-ink hover:bg-paperDeep">
                <ShieldCheck size={16} aria-hidden /> Cómo se protege la independencia
              </a>
            </div>
          </div>

          {/* El bloque ES la comparación: leídos contra publicados. Ninguna cifra viaja sola. */}
          <BalanceLectura
            leidos={estado?.contratosProcesados ?? 0}
            financiados={estado?.contratosFinanciados ?? 0}
            financiadores={estado?.financiadores ?? 0}
            publicados={resumenContratos?.total ?? 0}
            conSenal={estado?.senalesHalladas ?? 0}
            enCola={estado?.colaGlobal ?? 0}
            regionesConCola={estado?.regionesConCola ?? conCola}
            regionesConAuditoria={estado?.regionesConAuditoria ?? 0}
          />
        </div>
      </section>

      {/* ─── ELIGE TU ZONA (sin mapa: el mapa vive en /app/mapa) ─── */}
      <section id="zonas" className="container-page scroll-mt-20 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="font-serif text-3xl font-bold text-ink">Elige la zona que quieres auditar</h2>
            <p className="mt-1 max-w-2xl text-sm text-inkSoft">
              Busca tu departamento, provincia o distrito. Verás cuántos contratos esperan lectura y cuánto cuesta cubrirlos.
              Si prefieres verlo en el mapa, <Link href="/app/mapa" className="underline transition-colors hover:text-ink">ábrelo aquí</Link>.
            </p>
          </div>
          <div className="text-xs text-mute">Fuente: SEACE/OECE vía OCDS, actualizado a diario</div>
        </div>
        <ZonaPicker zonas={zonas ?? []} precioPen={precio ?? 0} partes={partes} alcance={alcanceCorto(estado?.alcance)} />
      </section>

      {/* ─── ÚLTIMOS APORTES (el orden por aliado vive en /app/aliados) ─── */}
      <section className="container-page py-16">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <h2 className="font-serif text-3xl font-bold text-ink">Últimos aportes</h2>
          <Link href="/app/aliados" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink hover:underline">
            Quién financió la lectura, en el muro de aliados <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
        <div className="mt-4 max-w-3xl">
          <RecientesFeed items={recientes ?? []} />
        </div>
      </section>

      {/* ─── INDEPENDENCIA ─── */}
      <section id="independencia" className="scroll-mt-20 border-t border-line bg-ink py-16 text-paper">
        <div className="container-page grid gap-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <ShieldCheck size={28} className="text-heroGreen" aria-hidden />
            <h2 className="mt-4 font-serif text-3xl font-bold">Financias capacidad, no resultados</h2>
            <p className="mt-3 text-paper/75">
              Esto no es comprar una región ni patrocinar un informe. Es pagar el cómputo para que contratos
              que ya son públicos sean, por fin, leídos. Las reglas están en el código, no en una promesa.
            </p>
            {precio != null && <Desglose precio={precio} partes={partes} />}
            <a href={REPO} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-heroGreen underline-offset-2 hover:underline">
              <Code2 size={15} aria-hidden /> Ver el código en GitHub
            </a>
          </div>
          <ul className="grid gap-4 sm:grid-cols-2">
            <Rule title="Sin selección">La asignación es por antigüedad dentro de la zona, en SQL. Ninguna API acepta un contrato elegido por el financiador.</Rule>
            <Rule title="Sin edición">Los agentes de análisis no reciben quién financió: ese dato no entra en sus instrucciones.</Rule>
            <Rule title="Conflicto automático">Empresa con sanción vigente del OECE o con alertas activas: su aporte procesa contratos igual, pero no recibe reconocimiento público.</Rule>
            <Rule title="Publicación incondicional">Si el análisis que financiaste te detecta a ti, se publica igual. Tu comprobante lo mostrará.</Rule>
            <Rule title="Reconocimiento aditivo">Varios aliados pueden apoyar la misma zona. Nadie la &quot;tiene&quot;.</Rule>
            <Rule title="Trazabilidad">Cada comprobante lista sus contratos y enlaza al análisis de cada uno, fase por fase.</Rule>
          </ul>
        </div>
      </section>
    </div>
  );
}

/** Cuánto cuesta leer un contrato y en qué se va, tal como lo publica la tarifa del API. */
function Desglose({ precio, partes }: { precio: number; partes: ParteTarifa[] }) {
  return (
    <div className="mt-6 rounded-2xl border border-paper/15 bg-paper/[0.06] p-4">
      <p className="text-sm text-paper/80">
        Leer un contrato cuesta <strong className="font-mono text-paper">{formatPEN(precio)}</strong>
        {partes.length > 0 ? ":" : "."}
      </p>
      {partes.length > 0 && (
        <dl className="mt-2 space-y-1 text-[13px]">
          {partes.map((p) => (
            <div key={p.concepto} className="flex items-baseline gap-3">
              <dt className="w-10 shrink-0 font-mono text-heroGreen">{formatPEN(p.monto)}</dt>
              <dd className="text-paper/80">{p.concepto}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * El déficit de lectura, que es la razón de existir del producto.
 *
 * La barra no es decoración: a escala real lo leído es una astilla contra el
 * total publicado, y ver esa astilla explica en un segundo por qué hace falta
 * financiar. Por eso la astilla tiene ancho mínimo: si se dibujara a escala
 * exacta (0,24%) sería medio píxel y no se vería nada.
 *
 * Ninguna cifra viaja sola, y ninguna es un monto: lo financiado se cuenta en
 * contratos, igual que en el muro de aliados.
 */
function BalanceLectura({
  leidos,
  financiados,
  financiadores,
  publicados,
  conSenal,
  enCola,
  regionesConCola,
  regionesConAuditoria,
}: {
  leidos: number;
  financiados: number;
  financiadores: number;
  publicados: number;
  conSenal: number;
  enCola: number;
  regionesConCola: number;
  regionesConAuditoria: number;
}) {
  const n = (v: number) => v.toLocaleString("es-PE");
  const pct = publicados > 0 ? (leidos / publicados) * 100 : 0;
  const anchoLeido = publicados > 0 ? Math.max(0.8, pct) : 0;

  return (
    <div className="rounded-2xl border border-line bg-paper p-5 shadow-card sm:p-6">
      <p className="text-[13px] leading-relaxed text-inkSoft">
        De los <strong className="font-mono font-semibold text-ink">{n(publicados)}</strong> contratos
        publicados que Vigía tiene descargados, se han leído
      </p>

      <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-4xl font-bold leading-none text-heroViolet">{n(leidos)}</span>
        <span className="text-sm text-inkSoft">
          {publicados > 0 && <>{pct.toLocaleString("es-PE", { maximumFractionDigits: 2 })} % del total</>}
        </span>
      </div>

      <div className="mt-3 flex h-2.5 w-full overflow-hidden rounded-full bg-paperDeep" role="img"
        aria-label={`${n(leidos)} contratos leídos de ${n(publicados)} publicados`}>
        <div className="h-full bg-heroViolet" style={{ width: `${anchoLeido}%` }} />
      </div>

      <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-[13px]">
        <Fila termino="Financiados hasta hoy">
          <strong className="font-mono text-ink">{n(financiados)}</strong> contratos
          {financiadores > 0 && <>, de {n(financiadores)} {financiadores === 1 ? "aliado" : "aliados"}</>}
        </Fila>
        <Fila termino="Leídos con señal">
          <strong className="font-mono text-ink">{n(conSenal)}</strong> de los {n(leidos)} leídos
          {regionesConAuditoria > 0 && <>, en {n(regionesConAuditoria)} regiones con auditoría activa</>}
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
      <dt className="text-inkSoft">{termino}</dt>
      <dd className="text-right text-inkSoft">{children}</dd>
    </div>
  );
}

function Rule({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <li className="rounded-2xl border border-paper/15 bg-paper/[0.06] p-4">
      <div className="text-sm font-semibold text-paper">{title}</div>
      <p className="mt-1 text-[13px] leading-relaxed text-paper/75">{children}</p>
    </li>
  );
}
