import Link from "next/link";
import {
  ArrowLeft,
  Heart,
  Shield,
  Sparkles,
  Server,
  Database,
  Code2,
  CheckCircle2,
  AlertTriangle,
  KeyRound,
  Search,
  Activity,
  Workflow,
  Share2,
} from "lucide-react";

export const metadata = {
  title: "Donar · Vigía Perú",
  description:
    "Vigía Perú es una organización sin fines de lucro. Tu donación mantiene la vigilancia anticorrupción libre de conflictos de interés.",
};

export default function DonarPage() {
  return (
    <div className="bg-paper">
      {/* HERO */}
      <section className="relative isolate overflow-hidden border-b border-line">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-paperSoft via-paper to-paperDeep" />
        <div className="absolute right-[-100px] top-[-80px] -z-10 h-[360px] w-[360px] animate-floatY rounded-full bg-amber/20 blur-3xl" />

        <div className="container-page py-16 sm:py-20">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
          >
            <ArrowLeft size={14} /> Volver al inicio
          </Link>

          <div className="mt-8 grid items-center gap-12 lg:grid-cols-[1.3fr,1fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber/40 bg-amber/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-clay">
                <Heart size={11} className="fill-rust text-rust" />
                Organización sin fines de lucro
              </div>
              <h1 className="mt-5 font-serif text-5xl font-bold leading-[1.02] tracking-tight text-ink sm:text-6xl">
                Tu aporte mantiene
                <br />
                <span className="text-rust italic">la vigilancia libre</span>.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-relaxed text-mute">
                Vigía Perú no recibe dinero del Estado peruano, ni de empresas
                que contratan con él, ni de partidos políticos. Es la única
                forma de garantizar que el sistema publique{" "}
                <strong className="text-ink">lo que detecta</strong>, no lo que
                conviene.
              </p>
            </div>

            <div className="rounded-3xl border border-line bg-paper p-7 shadow-card">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-clay">
                Total mensual
              </div>
              <div className="mt-1 font-mono text-5xl font-bold text-ink">
                S/. 845
              </div>
              <p className="mt-3 text-sm text-mute">
                Es lo que cuesta mantener el sistema vigilando 25 regiones del
                Perú cada mes. Con menos de lo que vale una pizza al mes ayudas
                a sostenerlo.
              </p>
              <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                <MiniTier monto="S/. 20" label="Vigilante" />
                <MiniTier monto="S/. 50" label="Aliado" highlight />
                <MiniTier monto="S/. 200" label="Patrocinador" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* COSTOS DESGLOSADOS */}
      <section className="border-b border-line bg-paperSoft py-14">
        <div className="container-page">
          <div className="mx-auto max-w-2xl text-center">
            <div className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-clay">
              <Server size={11} /> Cuentas claras
            </div>
            <h2 className="mt-4 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
              Cuánto cuesta <em className="text-rust">verlo todo</em>
            </h2>
            <p className="mt-3 text-mute">
              Sin esconder nada. Esto es lo que cuesta vigilar las contrataciones del Estado —
              y por qué hoy alcanzamos solo una fracción de lo que se firma.
            </p>
          </div>

          {/* layout 2 columnas · izq la historia · der los datos */}
          <div className="mx-auto mt-8 grid max-w-5xl items-start gap-5 lg:grid-cols-2">
            {/* ── IZQUIERDA · la brecha + quién paga ── */}
            <div className="space-y-5">
              <div className="rounded-3xl border border-line bg-paper p-6 shadow-card sm:p-7">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-mute">Hoy vigilamos</div>
                <div className="mt-1 flex items-baseline gap-3">
                  <span className="font-mono text-5xl font-bold leading-none text-rust sm:text-6xl">100</span>
                  <span className="text-sm leading-tight text-mute">de 7,000<br /><strong className="text-rust">apenas el 1,4 %</strong></span>
                </div>
                <div className="mt-5 h-3 w-full overflow-hidden rounded-full bg-paperDeep">
                  <div className="h-full rounded-full bg-rust" style={{ width: "1.4%" }} />
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] uppercase tracking-wider text-mute">
                  <span>Hoy</span><span>Meta · 7,000 (100 %)</span>
                </div>
                <p className="mt-4 text-sm leading-relaxed text-ink">
                  Los otros <strong>6,900 pasan</strong> sin que nadie los cruce a tiempo. Cada{" "}
                  <strong className="text-clay">S/. 1 que donás = un contrato más</strong>.
                </p>
              </div>
              <div className="rounded-3xl border border-l-4 border-line border-l-amber bg-amber-soft/40 p-6">
                <h3 className="font-serif text-lg font-bold text-ink">Hoy lo pagamos nosotros.</h3>
                <p className="mt-2 text-sm leading-relaxed text-inkSoft">
                  ~S/. 533/mes salen de <strong className="text-ink">nuestro bolsillo</strong>, y construimos Vigía{" "}
                  <strong className="text-ink">sin cobrar un sol</strong> (ad honorem). Tu donación{" "}
                  <strong className="text-ink">no nos paga</strong> — destraba más vigilancia: de 100 a 7,000.
                </p>
              </div>
            </div>

            {/* ── DERECHA · qué se firma + el stack ── */}
            <div className="space-y-5">
              <div className="rounded-3xl border border-line bg-paperSoft p-6 shadow-card sm:p-7">
                <div className="flex items-baseline justify-between">
                  <div className="text-[10px] font-semibold uppercase tracking-widest text-mute">Qué se firma · cada mes</div>
                  <div className="font-mono text-xl font-bold text-ink">7,000</div>
                </div>
                <div className="mt-5 space-y-3.5">
                  <CompRow label="Bienes" n="~3,500" pct="50 %" w="50%" color="bg-amber" />
                  <CompRow label="Servicios" n="~2,310" pct="33 %" w="33%" color="bg-clay" />
                  <CompRow label="Obras" n="~1,190" pct="17 %" w="17%" color="bg-rust" />
                </div>
              </div>
              <div className="rounded-3xl border border-line bg-paper p-6 shadow-card sm:p-7">
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-mute">
                  <Server size={12} /> El stack · todo en Google Cloud
                </div>
                <div className="mt-3 space-y-3">
                  <StackGroup titulo="Cómputo · fijo" rows={[["Cloud Run", "S/. 195"], ["Cloud SQL · 6.4M filas", "S/. 90"], ["Secret Manager", "incluido"]]} />
                  <StackGroup titulo="IA + datos · por contrato" rows={[["Gemini 2.5 · Vertex AI", "~S/. 1 c/u"], ["Vertex AI Search · RAG OECE", "incluido"], ["APIs · SUNAT + Google", "S/. 148"]]} />
                  <StackGroup titulo="Confianza · open source" accent="moss" rows={[["Arize Phoenix · trazas + evals", "S/. 0"], ["Google ADK · 11 agentes", "S/. 0"], ["Vigía MCP · datos abiertos", "S/. 0"]]} />
                </div>
                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3 text-xs">
                  <span className="text-mute">Hoy <strong className="font-mono text-ink">~S/. 533</strong></span>
                  <span className="text-paperEdge">→ 100 %</span>
                  <span className="text-mute"><strong className="font-mono text-ink">~S/. 7,000</strong>/mes</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─── ELIGE TU NIVEL · qué logras y qué recibes ─── */}
      <section id="niveles" className="container-page scroll-mt-20 py-14">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-amber/40 bg-amber/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-clay">
            <Heart size={11} className="fill-rust text-rust" /> Elige tu nivel
          </div>
          <h2 className="mt-4 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Qué <em className="text-rust">logra</em> tu aporte
          </h2>
          <p className="mt-3 text-mute">
            Cada nivel financia algo concreto — y tú recibes lo que pasa con tu dinero. No hay perks que
            compren influencia: tu donación <strong className="text-ink">protege</strong> el presupuesto
            público, no lo dirige.
          </p>
        </div>

        <div className="mx-auto mt-10 grid max-w-5xl items-start gap-5 md:grid-cols-3">
          <TierCard
            label="Vigilante"
            monto="S/. 20"
            tagline="Una mirada más sobre el Estado."
            impacto="El análisis profundo de ~6 contratos públicos, cada mes."
            beneficios={[
              "Reporte mensual por correo con lo que Vigía detectó.",
              "Tu nombre en «Cuentas claras» (opcional / anónimo por defecto).",
              "Cancelas la donación recurrente cuando quieras.",
            ]}
          />
          <TierCard
            label="Aliado"
            monto="S/. 50"
            tagline="Sostienes una región entera."
            impacto="La vigilancia de una región del Perú por un mes (unos 15 contratos analizados a fondo)."
            hereda="Todo lo de Vigilante, y además:"
            beneficios={[
              "Reporte de impacto mensual: casos rojos y montos en riesgo detectados.",
              "Acceso al panel de transparencia con el detalle diario del gasto.",
              "Voto en la encuesta trimestral de prioridades de cobertura.",
            ]}
            highlight
          />
          <TierCard
            label="Patrocinador"
            monto="S/. 200"
            tagline="Empujas todo el proyecto."
            impacto="Una semana entera del sistema vigilando las 25 regiones del Perú."
            hereda="Todo lo de Aliado, y además:"
            beneficios={[
              "Briefing trimestral con el equipo: hallazgos y hacia dónde va Vigía.",
              "Mención destacada como patrocinador del proyecto (opcional).",
              "Acceso anticipado a nuevas regiones y funciones.",
            ]}
          />
        </div>

        <p className="mx-auto mt-8 max-w-2xl text-center text-xs leading-relaxed text-mute">
          Ninguna donación decide qué casos se analizan ni cómo se redactan los dictámenes — las reglas
          son públicas y deterministas. <strong className="text-ink">Donar sostiene la vigilancia; no la compra.</strong>
        </p>
      </section>

      {/* COMPROMISOS */}
      <section className="container-page py-14">
        <div className="mx-auto max-w-2xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-moss/30 bg-moss/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-moss">
            <Shield size={11} /> Nuestro compromiso
          </div>
          <h2 className="mt-4 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
            Lo que <strong className="text-moss">SÍ</strong> hacemos con tu plata
          </h2>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl gap-3 sm:grid-cols-2">
          <CompromisoBox
            title="Publicamos cada donación"
            body="Monto, fecha y categoría (persona / institución). Los nombres son anónimos por defecto salvo que el donante autorice lo contrario."
          />
          <CompromisoBox
            title="Auditoría pública anual"
            body="Cada año publicamos un balance: ingresos, gastos por categoría, decisiones técnicas. Cualquiera puede verificar."
          />
          <CompromisoBox
            title="Sin compra de influencia"
            body="Las donaciones no compran cobertura, no determinan qué casos se analizan ni cómo se redactan los dictámenes. Las reglas son públicas y deterministas."
          />
          <CompromisoBox
            title="Código bajo licencia MIT"
            body="Todo lo que construimos vive en GitHub. Cualquiera puede auditar, mejorar o forkear el proyecto sin pedirnos permiso."
          />
        </div>

        {/* NO HACEMOS */}
        <div className="mx-auto mt-12 max-w-4xl rounded-2xl border-2 border-rust/30 bg-crimson-soft/30 p-7">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-rust text-paper">
              <AlertTriangle size={16} />
            </span>
            <div>
              <h3 className="font-serif text-xl font-bold text-ink">
                Lo que NO aceptamos
              </h3>
              <ul className="mt-3 grid gap-2 text-sm leading-relaxed text-ink/85 sm:grid-cols-2">
                <li>· Dinero del Estado peruano o gobiernos extranjeros</li>
                <li>· Empresas con contratos vigentes con el Estado</li>
                <li>· Partidos políticos o candidatos en campaña</li>
                <li>· Funcionarios públicos en ejercicio</li>
                <li>· Empresas con sanciones OSCE vigentes</li>
                <li>· Cualquier conflicto de interés declarado</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CTA DONACIÓN */}
      <section className="container-page pb-24">
        <div className="relative isolate overflow-hidden rounded-3xl bg-ink p-10 text-paper sm:p-14">
          <div className="absolute right-[-80px] top-[-80px] h-[300px] w-[300px] rounded-full bg-amber/15 blur-3xl" />

          <div className="relative grid items-center gap-10 lg:grid-cols-[1fr,auto]">
            <div>
              <h2 className="font-serif text-3xl font-bold leading-tight sm:text-4xl">
                Listo para apoyar a Vigía Perú
              </h2>
              <p className="mt-3 max-w-xl text-paper/75">
                Elige un monto. Recibirás un correo de confirmación con el
                comprobante. Puedes cancelar la donación recurrente cuando
                quieras desde el mismo enlace.
              </p>
            </div>
            <div className="flex flex-col gap-3">
              <a
                href="https://example.com/donar-mensual"
                target="_blank"
                rel="noreferrer"
                className="rounded-full bg-amber px-7 py-4 text-center text-base font-semibold text-coal transition-transform hover:scale-[1.03]"
              >
                Donar mensualmente →
              </a>
              <a
                href="https://example.com/donar-unico"
                target="_blank"
                rel="noreferrer"
                className="rounded-full border border-paper/30 px-7 py-4 text-center text-base font-medium text-paper hover:bg-paper/10"
              >
                Donación única
              </a>
              <a
                href="mailto:hola@vigiaperu.org?subject=Donación%20institucional"
                className="text-center text-xs text-paper/60 underline-offset-2 hover:underline"
              >
                Donación institucional o de gran cuantía →
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

function MiniTier({
  monto,
  label,
  highlight,
}: {
  monto: string;
  label: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "rounded-xl border p-2.5 " +
        (highlight
          ? "border-amber bg-amber/10 ring-1 ring-amber"
          : "border-line bg-paperSoft")
      }
    >
      <div className="font-mono text-base font-bold text-ink">{monto}</div>
      <div className="text-[9px] uppercase tracking-widest text-mute">
        {label}
      </div>
    </div>
  );
}

function TierCard({
  label,
  monto,
  tagline,
  impacto,
  beneficios,
  hereda,
  highlight,
}: {
  label: string;
  monto: string;
  tagline: string;
  impacto: string;
  beneficios: string[];
  hereda?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "relative flex h-full flex-col rounded-3xl border p-7 " +
        (highlight
          ? "border-amber bg-amber-soft/40 shadow-paper ring-2 ring-amber lg:-mt-3"
          : "border-line bg-paperSoft")
      }
    >
      {highlight && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-coal shadow">
          Más elegido
        </span>
      )}
      <div className="text-[11px] font-bold uppercase tracking-[0.2em] text-clay">{label}</div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="font-mono text-4xl font-bold text-ink">{monto}</span>
        <span className="text-sm text-mute">/ mes</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-ink">{tagline}</p>

      <div className="mt-4 rounded-xl border border-line bg-paper p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-moss">Tu aporte financia</div>
        <p className="mt-1 text-sm leading-snug text-ink">{impacto}</p>
      </div>

      {hereda && (
        <div className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-mute">{hereda}</div>
      )}
      <ul className="mt-3 flex-1 space-y-2">
        {beneficios.map((b) => (
          <li key={b} className="flex items-start gap-2 text-sm leading-snug text-mute">
            <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-moss" />
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <a
        href="https://example.com/donar-mensual"
        target="_blank"
        rel="noreferrer"
        className={
          "mt-6 rounded-full px-5 py-3 text-center text-sm font-semibold transition-all " +
          (highlight
            ? "bg-amber text-coal hover:scale-[1.03]"
            : "border border-ink/15 text-ink hover:bg-paperDeep")
        }
      >
        Donar {monto}/mes →
      </a>
    </div>
  );
}

function StackGroup({ titulo, rows, accent }: { titulo: string; rows: [string, string][]; accent?: string }) {
  return (
    <div>
      <div className={"text-[9px] font-bold uppercase tracking-wider " + (accent === "moss" ? "text-moss" : "text-clay")}>
        {titulo}
      </div>
      <div className="mt-1 divide-y divide-line/60">
        {rows.map(([name, cost]) => (
          <div key={name} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
            <span className="text-ink">{name}</span>
            <span className="shrink-0 font-mono text-xs text-mute">{cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompRow({
  label,
  n,
  pct,
  w,
  color,
}: {
  label: string;
  n: string;
  pct: string;
  w: string;
  color: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-mute">
          <span className="font-mono text-ink">{n}</span> · {pct}
        </span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-paperDeep">
        <div className={"h-full rounded-full " + color} style={{ width: w }} />
      </div>
    </div>
  );
}

function StackLayer({
  titulo,
  sub,
  tag,
  tagClass,
  nodes,
  highlight,
}: {
  titulo: string;
  sub: string;
  tag: string;
  tagClass: string;
  nodes: { icon: React.ReactNode; name: string; desc: string; cost: string }[];
  highlight?: boolean;
}) {
  return (
    <div
      className={
        "flex h-full flex-col rounded-2xl border p-5 " +
        (highlight ? "border-amber/50 bg-amber-soft/30 shadow-card" : "border-line bg-paperSoft")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-serif text-base font-bold text-ink">{titulo}</div>
          <div className="text-[11px] text-mute">{sub}</div>
        </div>
        <span className={"shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider " + tagClass}>
          {tag}
        </span>
      </div>
      <div className="mt-4 space-y-2.5">
        {nodes.map((n) => (
          <div key={n.name} className="flex items-center gap-3 rounded-xl border border-line bg-paper p-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink text-paper">{n.icon}</span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-tight text-ink">{n.name}</div>
              <div className="text-[11px] leading-tight text-mute">{n.desc}</div>
            </div>
            <span className="shrink-0 font-mono text-xs font-bold text-clay">{n.cost}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CostoCard({
  icon,
  title,
  monto,
  pct,
  body,
  color,
}: {
  icon: React.ReactNode;
  title: string;
  monto: string;
  pct: number;
  body: string;
  color: "rust" | "clay" | "amber" | "moss";
}) {
  const colorMap = {
    rust: "bg-rust/10 text-rust",
    clay: "bg-clay/10 text-clay",
    amber: "bg-amber/15 text-clay",
    moss: "bg-moss/15 text-moss",
  };
  const barMap = {
    rust: "bg-rust",
    clay: "bg-clay",
    amber: "bg-amber",
    moss: "bg-moss",
  };
  return (
    <div className="surface flex flex-col p-5">
      <span
        className={
          "inline-flex h-9 w-9 items-center justify-center rounded-lg " +
          colorMap[color]
        }
      >
        {icon}
      </span>
      <h3 className="mt-4 font-serif text-base font-bold text-ink">{title}</h3>
      <div className="mt-2 font-mono text-2xl font-bold text-ink">{monto}</div>
      <div className="mt-1 mb-3 flex items-center gap-2">
        <div className="h-1 flex-1 rounded-full bg-paperDeep">
          <div
            className={"h-full rounded-full " + barMap[color]}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className="font-mono text-[10px] text-mute">{pct}%</span>
      </div>
      <p className="text-[12px] leading-snug text-mute">{body}</p>
    </div>
  );
}

function CompromisoBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-paperSoft p-5">
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-moss text-paper">
        <CheckCircle2 size={14} />
      </span>
      <div>
        <h3 className="font-serif text-base font-bold text-ink">{title}</h3>
        <p className="mt-1 text-[13px] leading-snug text-mute">{body}</p>
      </div>
    </div>
  );
}
