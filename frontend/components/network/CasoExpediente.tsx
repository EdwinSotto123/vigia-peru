import {
  Building2,
  Calendar,
  Coins,
  FileText,
  Download,
  Package,
  Users,
  AlertTriangle,
  TrendingUp,
  CheckCircle2,
  ScanText,
  Scale,
  Award,
  Sparkles,
} from "lucide-react";
import type {
  CasoExpediente,
  ExpedientePostor,
  ExpedienteItem,
  ExpedienteDocumento,
  MarketVerdict,
} from "@/lib/mock-expedientes";
import { cn } from "@/lib/utils";

const PEN = (n: number) =>
  `S/ ${n.toLocaleString("es-PE", { maximumFractionDigits: 2 })}`;

const VERDICT_TONE: Record<
  MarketVerdict,
  { bg: string; text: string; icon: React.ReactNode; label: string }
> = {
  alineado: {
    bg: "bg-moss/10 border-moss/30",
    text: "text-moss",
    icon: <CheckCircle2 size={11} />,
    label: "Alineado",
  },
  elevado: {
    bg: "bg-amber-soft border-amber/40",
    text: "text-amber",
    icon: <TrendingUp size={11} />,
    label: "Elevado",
  },
  muy_elevado: {
    bg: "bg-crimson-soft border-rust/30",
    text: "text-rust",
    icon: <AlertTriangle size={11} />,
    label: "Muy elevado",
  },
};

export function CasoExpediente({ data }: { data: CasoExpediente }) {
  return (
    <div className="space-y-8">
      {/* ─── HEADER DEL EXPEDIENTE ─── */}
      <section>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-clay">
              Expediente del proceso
            </div>
            <h3 className="font-serif text-xl font-bold text-ink">
              {data.codigoProceso}
            </h3>
          </div>
          <span className="rounded-full border border-rust/30 bg-crimson-soft px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest text-rust">
            {data.tipoProceso}
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-mute">{data.objeto}</p>

        <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Fact
            icon={<Building2 size={12} />}
            label="Entidad"
            value={data.entidad.nombre}
            sub={`RUC ${data.entidad.ruc}`}
          />
          <Fact
            icon={<Coins size={12} />}
            label="Cuantía total"
            value={PEN(data.cuantiaTotal)}
            sub={data.fuenteFinanciamiento}
            mono
          />
          <Fact
            icon={<Calendar size={12} />}
            label="Buena Pro"
            value={data.fechaBuenaPro}
            sub={`Modalidad ${data.modalidadPago}`}
            mono
          />
          <Fact
            icon={<Scale size={12} />}
            label="Fundamento legal"
            value={data.fundamentoLegal[0]}
            sub={`+ ${data.fundamentoLegal.length - 1} normas`}
          />
        </dl>
      </section>

      {/* ─── ITEMS REQUERIDOS + market validation ─── */}
      <section>
        <SectionHeader
          eyebrow="Qué pidió la entidad"
          title={`${data.items.length} ítems requeridos`}
          subtitle="Cada ítem analizado por el market_price_agent contra precios de mercado Q1 2026."
          icon={<Package size={11} />}
          agent="market_price_agent"
        />

        <div className="mt-4 space-y-3">
          {data.items.map((it) => (
            <ItemCard key={it.numero} item={it} />
          ))}
        </div>

        {/* RESUMEN MARKET ANALYSIS */}
        <div
          className={cn(
            "mt-4 rounded-2xl border p-5",
            VERDICT_TONE[data.marketAnalysis.veredicto].bg,
          )}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles
                size={14}
                className={VERDICT_TONE[data.marketAnalysis.veredicto].text}
              />
              <span className="text-[10px] font-bold uppercase tracking-widest text-ink">
                Veredicto del market_price_agent
              </span>
            </div>
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest",
                data.marketAnalysis.veredicto === "alineado"
                  ? "bg-moss text-paper"
                  : data.marketAnalysis.veredicto === "elevado"
                    ? "bg-amber text-paper"
                    : "bg-rust text-paper",
              )}
            >
              {VERDICT_TONE[data.marketAnalysis.veredicto].label}
            </span>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <MetricBlock
              label="Total ofertado"
              value={PEN(data.marketAnalysis.totalOfertado)}
              tone="ink"
            />
            <MetricBlock
              label="Estimado de mercado"
              value={PEN(data.marketAnalysis.totalEstimadoMercado)}
              tone="ink"
            />
            <MetricBlock
              label="Sobreprecio detectado"
              value={`+${PEN(data.marketAnalysis.sobreprecio)}`}
              sub={`${data.marketAnalysis.sobreprecioPct.toFixed(1)}% sobre mercado`}
              tone="rust"
            />
          </div>
          <ul className="mt-3 space-y-1.5 text-xs text-ink">
            {data.marketAnalysis.notas.map((n, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-clay" />
                <span className="leading-relaxed">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ─── POSTORES ─── */}
      <section>
        <SectionHeader
          eyebrow="Quién ofertó"
          title={`${data.postores.length} postores presentaron oferta`}
          subtitle="Cada ítem fue ofertado por un solo postor. Todas las ofertas exactamente al 100% del valor referencial — patrón de no-competencia."
          icon={<Users size={11} />}
          agent="compliance_agent"
        />

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {data.postores.map((p) => (
            <PostorCard key={p.ruc} postor={p} items={data.items} />
          ))}
        </div>
      </section>

      {/* ─── BUENA PRO ─── */}
      <section>
        <SectionHeader
          eyebrow="Quién ganó"
          title="Otorgamiento de Buena Pro"
          subtitle={`Acta del ${data.fechaBuenaPro}. Tres ítems, dos ganadores.`}
          icon={<Award size={11} />}
          agent="document_parser_agent"
        />

        <div className="mt-4 overflow-hidden rounded-2xl border border-line">
          <table className="w-full text-xs">
            <thead className="bg-paperDeep text-[10px] uppercase tracking-wider text-mute">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Ítem</th>
                <th className="px-3 py-2 text-left font-semibold">Ganador</th>
                <th className="px-3 py-2 text-right font-semibold">Monto</th>
                <th className="px-3 py-2 text-right font-semibold">% Ref.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line bg-paperSoft">
              {data.ganadores.map((g) => {
                const item = data.items.find((i) => i.numero === g.itemNumero)!;
                const pctRef = (g.monto / item.cuantiaReferencial) * 100;
                return (
                  <tr key={g.itemNumero}>
                    <td className="px-3 py-2.5">
                      <div className="font-mono text-[10px] text-mute">
                        ítem {g.itemNumero}
                      </div>
                      <div className="font-medium text-ink">
                        {item.descripcionCorta}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-semibold text-ink">
                        {g.postorNombre}
                      </div>
                      <div className="font-mono text-[10px] text-mute">
                        RUC {g.postorRuc}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono font-semibold text-ink">
                      {PEN(g.monto)}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 font-mono text-[10px] font-bold",
                          pctRef >= 100
                            ? "bg-rust text-paper"
                            : "bg-moss text-paper",
                        )}
                      >
                        {pctRef.toFixed(2)}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="bg-paperDeep">
              <tr>
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-mute" colSpan={2}>
                  Total adjudicado
                </td>
                <td className="px-3 py-2 text-right font-mono text-sm font-bold text-ink">
                  {PEN(
                    data.ganadores.reduce((s, g) => s + g.monto, 0),
                  )}
                </td>
                <td className="px-3 py-2 text-right text-[10px] text-mute">
                  100.00% techo
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* ─── DOCUMENTOS ─── */}
      <section>
        <SectionHeader
          eyebrow="Documentos del expediente"
          title={`${data.documentos.length} archivos publicados`}
          subtitle="Cada documento fue procesado por el document_parser_agent y su resumen quedó indexado para la consulta."
          icon={<FileText size={11} />}
          agent="document_parser_agent"
        />

        <ul className="mt-4 space-y-2">
          {data.documentos.map((d) => (
            <DocumentRow key={d.nombre} doc={d} />
          ))}
        </ul>
      </section>

      {/* ─── FUNDAMENTO LEGAL ─── */}
      <section className="rounded-2xl border border-line bg-paperSoft p-4">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-clay">
          <Scale size={11} /> Fundamento legal de la contratación
        </div>
        <ul className="mt-2 space-y-1 text-xs text-ink">
          {data.fundamentoLegal.map((n, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-clay" />
              <span className="leading-relaxed">{n}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function SectionHeader({
  eyebrow,
  title,
  subtitle,
  icon,
  agent,
}: {
  eyebrow: string;
  title: string;
  subtitle?: string;
  icon: React.ReactNode;
  agent?: string;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-2">
      <div>
        <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-clay">
          {icon}
          {eyebrow}
        </div>
        <h3 className="mt-0.5 font-serif text-lg font-bold text-ink">{title}</h3>
        {subtitle && (
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-mute">
            {subtitle}
          </p>
        )}
      </div>
      {agent && (
        <span className="inline-flex items-center gap-1 rounded-full border border-line bg-paperSoft px-2 py-0.5 font-mono text-[10px] text-ink">
          <Sparkles size={9} className="text-clay" />
          {agent}
        </span>
      )}
    </div>
  );
}

function Fact({
  icon,
  label,
  value,
  sub,
  mono,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-2.5">
      <div className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-mute">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 text-sm font-semibold leading-tight text-ink",
          mono && "font-mono",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-mute">{sub}</div>}
    </div>
  );
}

function MetricBlock({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "ink" | "rust" | "moss";
}) {
  const accent =
    tone === "rust" ? "text-rust" : tone === "moss" ? "text-moss" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper p-3">
      <div className="text-[9px] font-bold uppercase tracking-wider text-mute">
        {label}
      </div>
      <div className={cn("mt-0.5 font-mono text-base font-bold leading-tight", accent)}>
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[10px] text-mute">{sub}</div>}
    </div>
  );
}

function ItemCard({ item }: { item: ExpedienteItem }) {
  const ref = item.marketRef;
  const verdictTone = ref ? VERDICT_TONE[ref.veredicto] : null;

  return (
    <div className="surface overflow-hidden p-0">
      {/* Top row: descripcion + cantidad + cuantia */}
      <div className="grid items-start gap-3 px-4 py-3 sm:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-paperDeep px-2 py-0.5 font-mono text-[10px] font-bold text-ink">
              ítem {item.numero}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-mute">
              {item.cantidad} {item.unidad}
            </span>
          </div>
          <div className="mt-1 font-serif text-base font-bold leading-tight text-ink">
            {item.descripcionCorta}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-mute">
            {item.descripcion}
          </p>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-wider text-mute">
            Cuantía referencial
          </div>
          <div className="font-mono text-base font-bold text-ink">
            {PEN(item.cuantiaReferencial)}
          </div>
          <div className="font-mono text-[10px] text-mute">
            unit. {PEN(item.precioUnitarioReferencial)}
          </div>
        </div>
      </div>

      {/* Bottom: market_price_agent */}
      {ref && verdictTone && (
        <div className={cn("border-t border-line px-4 py-3", verdictTone.bg)}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest">
              <Sparkles size={10} className={verdictTone.text} />
              <span className={verdictTone.text}>
                market_price_agent · {verdictTone.label}
              </span>
            </div>
            <div className="font-mono text-[10px] text-mute">
              vs mediana {ref.diferenciaPct > 0 ? "+" : ""}
              {ref.diferenciaPct.toFixed(1)}%
            </div>
          </div>
          <div className="mt-1.5 grid gap-1.5 text-[11px] sm:grid-cols-3">
            <div>
              <span className="text-mute">Mediana mercado:</span>{" "}
              <span className="font-mono font-semibold text-ink">
                {PEN(ref.promedio)}
              </span>
            </div>
            <div>
              <span className="text-mute">Rango:</span>{" "}
              <span className="font-mono text-ink">
                {PEN(ref.rangoMin)} – {PEN(ref.rangoMax)}
              </span>
            </div>
            <div className="text-mute">Fuente: {ref.fuente}</div>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-inkSoft">
            {ref.nota}
          </p>
          {item.especsRedFlag && (
            <div className="mt-2 flex items-start gap-1.5 rounded-lg border border-rust/30 bg-paper px-2 py-1.5 text-[11px] text-rust">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>
                <strong>Spec restrictiva:</strong> {item.especsRedFlag}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PostorCard({
  postor,
  items,
}: {
  postor: ExpedientePostor;
  items: ExpedienteItem[];
}) {
  const totalOfertado = postor.ofertas.reduce(
    (s, o) => s + o.montoOfertado,
    0,
  );
  return (
    <div className="surface overflow-hidden p-0">
      <div className="flex items-start gap-3 border-b border-line bg-paperDeep px-4 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink text-paper">
          <Building2 size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-ink">{postor.razonSocial}</div>
          <div className="flex flex-wrap items-center gap-2 text-[10px] text-mute">
            <span className="font-mono">RUC {postor.ruc}</span>
            <span>·</span>
            <span>{postor.tipo.replace("_", " ")}</span>
            {postor.rnpVigente && (
              <span className="rounded-full bg-moss/15 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-moss">
                RNP vigente
              </span>
            )}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[9px] font-bold uppercase tracking-wider text-mute">
            Total ofertado
          </div>
          <div className="font-mono text-sm font-bold text-clay">
            {PEN(totalOfertado)}
          </div>
        </div>
      </div>

      {/* Ofertas por item */}
      <ul className="divide-y divide-line">
        {postor.ofertas.map((o) => {
          const item = items.find((i) => i.numero === o.itemNumero)!;
          return (
            <li key={o.itemNumero} className="flex items-center gap-3 px-4 py-2">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-paperDeep font-mono text-[10px] font-bold text-ink">
                {o.itemNumero}
              </div>
              <div className="min-w-0 flex-1 text-xs">
                <div className="font-medium text-ink">
                  {item.descripcionCorta}
                </div>
                <div className="font-mono text-[10px] text-mute">
                  {PEN(o.montoOfertado)} · {o.porcentajeReferencial.toFixed(2)}% referencial
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {o.admitida && (
                  <span className="rounded-full bg-moss/15 px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-moss">
                    Admitida
                  </span>
                )}
                {o.ganador && (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-clay px-1.5 py-0 text-[9px] font-bold uppercase tracking-wider text-paper">
                    <Award size={9} /> Ganador
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {/* Banderas */}
      {postor.banderas.length > 0 && (
        <div className="border-t border-line bg-crimson-soft/50 px-4 py-2.5">
          <div className="mb-1 flex items-center gap-1 text-[9px] font-bold uppercase tracking-widest text-rust">
            <AlertTriangle size={10} /> Banderas
          </div>
          <ul className="space-y-0.5 text-[11px] text-ink">
            {postor.banderas.map((b, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-rust" />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DocumentRow({ doc }: { doc: ExpedienteDocumento }) {
  return (
    <li>
      <div className="surface flex items-start gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-paperDeep text-clay">
          <FileText size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="font-semibold text-ink">{doc.nombre}</span>
            <span className="font-mono text-[10px] text-mute">{doc.fecha}</span>
            {doc.paginas && (
              <span className="font-mono text-[10px] text-mute">
                · {doc.paginas} págs
              </span>
            )}
            {doc.tamano && (
              <span className="font-mono text-[10px] text-mute">· {doc.tamano}</span>
            )}
          </div>
          {doc.resumenAgente && (
            <p className="mt-1 text-[11px] leading-relaxed text-inkSoft">
              <span className="inline-flex items-center gap-1 font-mono text-[10px] text-clay">
                <ScanText size={9} />
                {doc.agente}:
              </span>{" "}
              {doc.resumenAgente}
            </p>
          )}
        </div>
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paperSoft px-2.5 py-1 text-[11px] font-medium text-clay hover:bg-paperDeep"
        >
          <Download size={11} /> Descargar
        </a>
      </div>
    </li>
  );
}
