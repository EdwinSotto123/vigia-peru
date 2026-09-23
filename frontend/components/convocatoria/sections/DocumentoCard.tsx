"use client";

import { AlertTriangle, Award, Coins, ExternalLink, Package, Scale, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";
import { formatoNormalizado } from "./DocumentosSection";

export function DocumentoCard({ doc, fmtMoney }: { doc: any; fmtMoney: (n: any) => string }) {
  const meta = doc.__doc_meta || {};
  const ext  = doc.extraccion || {};
  const items: any[]      = ext.items || [];
  const postores: any[]   = ext.postores_admitidos || ext.postores || [];
  const ganadores: any[]  = ext.ganadores || [];
  const redFlags: any[]   = ext.red_flags_observadas || ext.especs_restrictivas || [];
  const fundamento: any[] = ext.fundamento_legal || [];
  const hasError = !!doc.error;

  return (
    <article className={cn("surface overflow-hidden p-0", hasError && "border-rust/30")}>
      <div className="flex items-start justify-between gap-3 border-b border-line bg-paperDeep px-4 py-3">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase tracking-widest text-heroViolet">
            {doc.tipo || meta.documentType || "documento"}
          </div>
          <div className="truncate text-sm font-semibold text-ink">
            {meta.titulo || "(sin título)"}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[10px] text-mute">
            {meta.format && <span className="font-mono">{formatoNormalizado(meta.format).toUpperCase()}</span>}
            {doc.size_bytes && <span>{(doc.size_bytes / 1024 / 1024).toFixed(1)} MB</span>}
            {meta.datePublished && <span>{meta.datePublished.slice(0, 10)}</span>}
            {doc.format_detectado && <span>detectado: {formatoNormalizado(doc.format_detectado)}</span>}
          </div>
        </div>
        {meta.url_oece && (
          <a href={meta.url_oece} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 rounded-full border border-line bg-paperSoft px-2 py-1 text-[10px] font-medium text-heroViolet hover:bg-paper">
            <ExternalLink size={10} /> PDF
          </a>
        )}
      </div>

      <div className="space-y-3 px-4 py-3">
        {hasError && (
          <div className="rounded-lg border border-rust/30 bg-crimson-soft px-2.5 py-2 text-[11px] text-rust">
            <AlertTriangle size={11} className="mr-1 inline" />
            No se pudo leer este documento.
          </div>
        )}

        {ext.cuantia_total != null && ext.cuantia_total > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-paperSoft px-2.5 py-1.5 text-xs">
            <Coins size={13} className="text-heroViolet" />
            <span className="text-mute">Cuantía total:</span>
            <span className="font-mono font-bold text-ink">{fmtMoney(ext.cuantia_total)}</span>
            {ext.fuente_financiamiento && (
              <span className="ml-auto rounded-full bg-paperDeep px-1.5 py-0 text-[10px] font-medium text-mute">
                {ext.fuente_financiamiento}
              </span>
            )}
          </div>
        )}

        {items.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
              <Package size={11} /> Items extraídos ({items.length})
            </div>
            <ul className="space-y-1">
              {items.slice(0, 4).map((it: any, i: number) => (
                <li key={i} className="rounded-lg border border-line bg-paper px-2.5 py-1.5 text-[11px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium text-ink">
                      {it.numero || i + 1}. {(it.descripcion_corta || it.descripcion || "—").slice(0, 60)}
                    </span>
                    <span className="font-mono text-mute">{it.cantidad ?? "—"} {it.unidad ?? ""}</span>
                  </div>
                  {it.precio_unitario_referencial != null && (
                    <div className="mt-0.5 font-mono text-[10px] text-heroViolet">
                      unit. {fmtMoney(it.precio_unitario_referencial)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {(postores.length > 0 || ganadores.length > 0) && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-mute">
              <Users size={11} /> Postores y ganadores
            </div>
            <ul className="space-y-1">
              {(ganadores.length > 0 ? ganadores : postores).slice(0, 4).map((p: any, i: number) => (
                <li key={i} className="rounded-lg bg-amber-soft/50 px-2.5 py-1 text-[11px]">
                  <div className="flex items-center gap-2">
                    <Award size={10} className="text-amberTexto" />
                    <span className="font-medium text-ink truncate flex-1">
                      {esPersonaNatural(p.ruc) ? (
                        <PersonName name={p.razon_social || p.nombre || p.empresa} orden="sunat" />
                      ) : (
                        p.razon_social || p.nombre || p.empresa || "—"
                      )}
                    </span>
                    {(p.monto_oferta != null || p.monto != null) && (
                      <span className="font-mono text-mute">{fmtMoney(p.monto_oferta ?? p.monto)}</span>
                    )}
                  </div>
                  {p.ruc && (
                    <div className="ml-4 font-mono text-[10px] text-mute">
                      RUC <Ruc value={p.ruc} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {redFlags.length > 0 && (
          <div>
            <div className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-rust">
              <AlertTriangle size={11} /> Red flags observados por el agente
            </div>
            <ul className="space-y-0.5">
              {redFlags.slice(0, 4).map((f: any, i: number) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-ink">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rust" />
                  <span>{typeof f === "string" ? f : (f.detalle || JSON.stringify(f).slice(0, 80))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {fundamento.length > 0 && (
          <div className="text-[10px] text-mute">
            <Scale size={10} className="mr-1 inline" />
            Fundamento: {fundamento.slice(0, 2).join("; ")}
          </div>
        )}

        {doc.resumen && (
          <p className="border-t border-line pt-2 text-[11px] italic leading-relaxed text-mute">
            "{doc.resumen}"
          </p>
        )}
      </div>
    </article>
  );
}
