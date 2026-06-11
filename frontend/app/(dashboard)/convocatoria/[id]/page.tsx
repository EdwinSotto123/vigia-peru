import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  ClipboardList,
  Award,
  FileSignature,
  ExternalLink,
  Calendar,
  MapPin,
  Coins,
  Users,
  Package,
  AlertCircle,
} from "lucide-react";
import {
  fetchConvocatoria,
  formatAmount,
  formatDate,
  shortIdFromOcid,
  type OcdsCompiledRelease,
  type OcdsItem,
} from "@/lib/oece";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { Badge } from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import { DocumentosAnalisis } from "@/components/DocumentosAnalisis";
import { EjecucionPresupuestal } from "@/components/EjecucionPresupuestal";
import { DeteccionInconsistencias } from "@/components/DeteccionInconsistencias";
import { Suspense } from "react";

export const revalidate = 3600;

export default async function ConvocatoriaPage({
  params,
}: {
  params: { id: string };
}) {
  const data = await fetchConvocatoria(params.id);
  if (!data) notFound();

  const shortId = shortIdFromOcid(data.ocid);
  const tender = data.tender ?? {};
  const planning = data.planning ?? {};
  const awards = data.awards ?? [];
  const contracts = data.contracts ?? [];
  const parties = data.parties ?? [];
  const buyer = parties.find((p) => p.roles?.includes("buyer")) ?? data.buyer;
  const buyerParty = parties.find((p) => p.id === buyer?.id);

  return (
    <div className="container-page max-w-5xl space-y-8 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver al mapa
      </Link>

      {/* Header */}
      <header className="surface p-6">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="amber">
            <Building2 size={11} /> OECE · OCDS
          </Badge>
          <Badge variant="neutral">{tender.procurementMethodDetails ?? "—"}</Badge>
          {tender.mainProcurementCategory && (
            <Badge variant="neutral">{tender.mainProcurementCategory}</Badge>
          )}
          <code className="ml-auto font-mono text-xs text-mute">
            convocatoria #{shortId}
          </code>
        </div>
        <h1 className="mt-3 font-serif text-3xl font-bold leading-tight text-ink sm:text-4xl">
          {tender.description ?? tender.title ?? "Convocatoria sin descripción"}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-mute">
          {tender.title && (
            <span className="font-mono">{tender.title}</span>
          )}
          {buyer && (
            <span className="inline-flex items-center gap-1">
              <Building2 size={13} /> {buyer.name}
            </span>
          )}
        </div>
      </header>

      <DisclaimerBanner />

      {/* Phase stepper */}
      <PhaseStepper
        hasPlanning={!!planning.budget || (planning.documents?.length ?? 0) > 0}
        hasTender={!!tender.title || !!tender.description}
        hasAwards={awards.length > 0}
        hasContracts={contracts.length > 0}
      />

      {/* FASE 1: PLANIFICACIÓN */}
      <PhaseSection
        n={1}
        title="Planificación"
        icon={<ClipboardList size={18} />}
        present={!!planning.budget || !!buyerParty}
      >
        <DataGrid>
          <DataItem label="Descripción">
            {tender.description ?? planning.budget?.description ?? "—"}
          </DataItem>
          <DataItem label="Fuente del presupuesto">
            {planning.budget?.description ??
              planning.budget?.source ??
              "—"}
          </DataItem>
          <DataItem label="Monto del presupuesto">
            <span className="font-mono font-semibold">
              {formatAmount(planning.budget?.amount)}
            </span>
          </DataItem>
          <DataItem label="Entidad compradora">
            {buyer?.name ?? "—"}
          </DataItem>
        </DataGrid>

        {buyerParty?.address && (
          <div className="mt-4 rounded-xl border border-line bg-paperDeep p-3 text-sm">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-mute">
              <MapPin size={11} /> Dirección
            </div>
            <div className="text-ink">
              {[
                buyerParty.address.streetAddress,
                buyerParty.address.locality,
                buyerParty.address.region,
                buyerParty.address.department,
              ]
                .filter(Boolean)
                .join(" · ")}
            </div>
          </div>
        )}
      </PhaseSection>

      {/* FASE 2: CONVOCATORIA */}
      <PhaseSection
        n={2}
        title="Convocatoria"
        icon={<ClipboardList size={18} />}
        present={!!tender.title || !!tender.description}
      >
        <DataGrid>
          <DataItem label="Nomenclatura">
            <span className="font-mono">{tender.title ?? "—"}</span>
          </DataItem>
          <DataItem label="Descripción">{tender.description ?? "—"}</DataItem>
          <DataItem label="Tipo de procedimiento">
            {tender.procurementMethodDetails ?? "—"}
          </DataItem>
          <DataItem label="Categoría">
            {tender.mainProcurementCategory ?? "—"}
          </DataItem>
          <DataItem label="Fecha publicación">
            {formatDate(tender.datePublished)}
          </DataItem>
          <DataItem label="Inicio convocatoria">
            {formatDate(tender.tenderPeriod?.startDate)}
          </DataItem>
          <DataItem label="Cierre convocatoria">
            {formatDate(tender.tenderPeriod?.endDate)}
          </DataItem>
          <DataItem label="Valor referencial">
            <span className="font-mono font-semibold">
              {formatAmount(tender.value)}
            </span>
          </DataItem>
        </DataGrid>

        {/* Items */}
        {tender.items && tender.items.length > 0 && (
          <div className="mt-5">
            <SubHeader icon={<Package size={14} />} title={`Items solicitados (${tender.items.length})`} />
            <div className="mt-2 space-y-2">
              {tender.items.slice(0, 8).map((it) => (
                <ItemRow key={it.id} item={it} />
              ))}
              {tender.items.length > 8 && (
                <div className="text-xs text-mute">
                  + {tender.items.length - 8} ítems más en el record OCDS oficial.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Oferentes (tenderers) */}
        {tender.tenderers && tender.tenderers.length > 0 && (
          <div className="mt-5">
            <SubHeader icon={<Users size={14} />} title={`Oferentes (${tender.tenderers.length})`} />
            <ul className="mt-2 grid gap-1 sm:grid-cols-2">
              {tender.tenderers.map((t) => (
                <li
                  key={t.id}
                  className="truncate rounded-lg border border-line bg-paperSoft px-3 py-2 text-xs"
                >
                  <span className="font-mono text-mute">{t.id}</span>
                  <span className="ml-2 text-ink">{t.name}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Documentos */}
        {tender.documents && tender.documents.length > 0 && (
          <DocsList docs={tender.documents} title="Documentos de la convocatoria" />
        )}
      </PhaseSection>

      {/* FASE 3: ADJUDICACIÓN */}
      <PhaseSection
        n={3}
        title="Adjudicación"
        icon={<Award size={18} />}
        present={awards.length > 0}
        emptyText="Aún no se ha publicado la adjudicación."
      >
        <div className="space-y-3">
          {awards.map((a) => (
            <div
              key={a.id}
              className="rounded-xl border border-line bg-paperDeep p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-serif text-base font-semibold text-ink">
                  {a.title ?? "Adjudicación"}
                </div>
                <div className="font-mono text-sm font-semibold text-clay">
                  {formatAmount(a.value)}
                </div>
              </div>
              <div className="mt-1 text-xs text-mute">
                <Calendar size={11} className="mr-1 inline" />
                {formatDate(a.date)} · estado: {a.status ?? "—"}
              </div>
              {a.suppliers && a.suppliers.length > 0 && (
                <div className="mt-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-mute">
                    Proveedor adjudicado
                  </div>
                  <ul className="mt-1 space-y-1">
                    {a.suppliers.map((s) => (
                      <li key={s.id} className="text-sm text-ink">
                        <span className="font-mono text-xs text-mute">{s.id}</span>{" "}
                        <span className="font-medium">{s.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {a.items && a.items.length > 0 && (
                <div className="mt-2 text-xs text-mute">
                  Items adjudicados: {a.items.length}
                </div>
              )}
            </div>
          ))}
        </div>
      </PhaseSection>

      {/* FASE 4: CONTRATO */}
      <PhaseSection
        n={4}
        title="Contrato"
        icon={<FileSignature size={18} />}
        present={contracts.length > 0}
        emptyText="Aún no se firma contrato (o no está publicado)."
      >
        <div className="space-y-3">
          {contracts.map((c) => (
            <div
              key={c.id}
              className="rounded-xl border border-line bg-paperDeep p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="font-serif text-base font-semibold text-ink">
                  {c.title ?? "Contrato"}
                </div>
                <div className="font-mono text-sm font-semibold text-clay">
                  {formatAmount(c.value)}
                </div>
              </div>
              <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-mute md:grid-cols-4">
                <span>Firmado: {formatDate(c.dateSigned)}</span>
                <span>Inicio: {formatDate(c.period?.startDate)}</span>
                <span>Fin: {formatDate(c.period?.endDate)}</span>
                <span>Estado: {c.status ?? "—"}</span>
              </div>
              {c.documents && c.documents.length > 0 && (
                <DocsList docs={c.documents} title="Documentos del contrato" compact />
              )}
            </div>
          ))}
        </div>
      </PhaseSection>

      {/* DETECCIÓN DE INCONSISTENCIAS */}
      <DeteccionInconsistencias release={data} />

      {/* DOCUMENTOS + ANÁLISIS IA */}
      <DocumentosAnalisis
        documents={[
          ...(tender.documents ?? []),
          ...(contracts.flatMap((c) => c.documents ?? []) ?? []),
        ]}
        convocatoriaId={shortId}
      />

      {/* CONTEXTO PRESUPUESTAL DE LA ENTIDAD */}
      {buyer && (
        <Suspense
          fallback={
            <div className="surface flex h-40 items-center justify-center text-sm text-mute">
              Consultando MEF…
            </div>
          }
        >
          <EjecucionPresupuestal
            query={buyer.name}
            title="Contexto presupuestal de la entidad"
            subtitle={`Búsqueda en MEF por "${buyer.name}"`}
          />
        </Suspense>
      )}

      {/* PARTIES */}
      {parties.length > 0 && (
        <section className="surface space-y-3 p-6">
          <SubHeader
            icon={<Users size={14} />}
            title={`Partes involucradas (${parties.length})`}
          />
          <ul className="grid gap-2 md:grid-cols-2">
            {parties.map((p) => (
              <li
                key={p.id}
                className="rounded-xl border border-line bg-paperDeep p-3"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[10px] text-mute">{p.id}</span>
                  <div className="flex gap-1">
                    {p.roles?.map((r) => (
                      <span
                        key={r}
                        className="rounded-full bg-paper px-1.5 py-0.5 text-[9px] font-medium text-mute"
                      >
                        {r}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="mt-1 text-sm font-medium text-ink">{p.name}</div>
                {p.address && (
                  <div className="mt-1 text-xs text-mute">
                    {[p.address.streetAddress, p.address.department]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* CTA */}
      <section className="surface p-6 text-center">
        <p className="text-sm text-mute">
          Datos obtenidos en vivo del{" "}
          <a
            href="https://contratacionesabiertas.oece.gob.pe/"
            target="_blank"
            rel="noreferrer"
            className="text-clay underline"
          >
            Portal de Contrataciones Abiertas del OECE
          </a>{" "}
          · Estándar OCDS 1.1 · Verificable en fuente oficial.
        </p>
        <a
          href={`https://contratacionesabiertas.oece.gob.pe/perfilProveedor/#!/transactions/contract/${data.ocid}`}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-clay hover:underline"
        >
          Ver el registro original en OECE <ExternalLink size={13} />
        </a>
      </section>
    </div>
  );
}

// ─── Subcomponentes ──────────────────────────────

function PhaseStepper({
  hasPlanning,
  hasTender,
  hasAwards,
  hasContracts,
}: {
  hasPlanning: boolean;
  hasTender: boolean;
  hasAwards: boolean;
  hasContracts: boolean;
}) {
  const phases = [
    { label: "Planificación", on: hasPlanning },
    { label: "Convocatoria", on: hasTender },
    { label: "Adjudicación", on: hasAwards },
    { label: "Contrato", on: hasContracts },
  ];
  return (
    <div className="surface flex items-center justify-between gap-2 p-3">
      {phases.map((p, i) => (
        <div key={p.label} className="flex flex-1 items-center gap-2">
          <div
            className={cn(
              "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold",
              p.on
                ? "bg-clay text-paper"
                : "border border-line bg-paperDeep text-mute",
            )}
          >
            {i + 1}
          </div>
          <span
            className={cn(
              "truncate text-xs font-medium",
              p.on ? "text-ink" : "text-mute",
            )}
          >
            {p.label}
          </span>
          {i < phases.length - 1 && (
            <span
              className={cn(
                "h-px flex-1",
                p.on && phases[i + 1].on ? "bg-clay" : "bg-line",
              )}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function PhaseSection({
  n,
  title,
  icon,
  children,
  present,
  emptyText,
}: {
  n: number;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  present: boolean;
  emptyText?: string;
}) {
  return (
    <section className="surface p-6">
      <header className="mb-4 flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ink text-paper">
          {icon}
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-mute">
            Fase {n}
          </div>
          <h2 className="font-serif text-xl font-bold text-ink">{title}</h2>
        </div>
      </header>
      {present ? (
        children
      ) : (
        <div className="flex items-center gap-2 rounded-xl border border-dashed border-line bg-paperDeep px-4 py-6 text-sm text-mute">
          <AlertCircle size={16} />
          {emptyText ?? "Sin datos publicados en esta fase."}
        </div>
      )}
    </section>
  );
}

function DataGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid gap-3 sm:grid-cols-2">{children}</dl>;
}

function DataItem({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-mute">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function SubHeader({
  icon,
  title,
}: {
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-mute">
      {icon}
      {title}
    </div>
  );
}

function ItemRow({ item }: { item: OcdsItem }) {
  return (
    <div className="rounded-xl border border-line bg-paperSoft p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="font-mono text-[10px] text-mute">
          #{item.position ?? item.id}
        </div>
        {item.statusDetails && (
          <span className="rounded-full bg-paper px-2 py-0.5 text-[9px] font-medium text-mute">
            {item.statusDetails}
          </span>
        )}
      </div>
      <div className="mt-1 text-sm text-ink">{item.description ?? "—"}</div>
      {item.classification && (
        <div className="mt-1 text-xs text-mute">
          {item.classification.scheme ?? "CUBSO"}{" "}
          <span className="font-mono">{item.classification.id}</span>{" "}
          — {item.classification.description}
        </div>
      )}
    </div>
  );
}

function DocsList({
  docs,
  title,
  compact,
}: {
  docs: NonNullable<OcdsCompiledRelease["tender"]>["documents"];
  title: string;
  compact?: boolean;
}) {
  if (!docs || docs.length === 0) return null;
  return (
    <div className={compact ? "mt-3" : "mt-5"}>
      {!compact && (
        <SubHeader
          icon={<ExternalLink size={14} />}
          title={`${title} (${docs.length})`}
        />
      )}
      <ul className={cn("grid gap-1", compact ? "" : "mt-2")}>
        {docs.slice(0, 5).map((d) => (
          <li key={d.id}>
            <a
              href={d.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 rounded-lg border border-line bg-paperSoft px-3 py-2 text-xs hover:bg-paperDeep"
            >
              <ExternalLink size={11} className="text-clay" />
              <span className="text-mute">
                {d.documentType ?? "documento"}
              </span>
              <span className="truncate text-ink">{d.title ?? d.url}</span>
              <span className="ml-auto text-[10px] text-mute">
                {formatDate(d.datePublished)}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
