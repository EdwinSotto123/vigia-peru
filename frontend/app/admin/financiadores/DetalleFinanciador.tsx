"use client";

import Link from "next/link";
import { ExternalLink, Eye, EyeOff, Users, X } from "lucide-react";
import { fmtPEN, type FinanciadorAdmin } from "@/lib/admin";
import { REDES } from "@/lib/perfilAliado";
import { Ruc } from "@/components/Redact";
import { Aviso, Badge, KeyValue, SinDato, claseBoton, fmtDia, motivoNoVisibleLabel, tipoFinanciadorLabel } from "@/components/admin/ui";

/**
 * Lo que un financiador publicó en su perfil, de SÓLO LECTURA: el perfil lo define quien aporta
 * desde su cuenta (/app/configuracion) y el panel no lo edita (PATCH /admin/financiadores/:id sólo
 * acepta visible y motivo). La única acción es moderar: ocultar o mostrar.
 */

/** Sólo enlaces https bien formados se vuelven href (los escribe quien aporta). */
const esHttps = (v: string | null | undefined): v is string => !!v && /^https:\/\/[^\s"'<>]+$/i.test(v);

function Enlace({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 break-all text-granate underline-offset-2 hover:underline">
      {children} <ExternalLink size={11} className="shrink-0" aria-hidden />
      <span className="sr-only">(se abre en otra pestaña)</span>
    </a>
  );
}

export function DetalleFinanciador({
  f,
  perfilDisponible,
  onModerar,
  onCerrar,
}: {
  f: FinanciadorAdmin;
  /** false = la base no tiene las columnas del perfil (migración 30): sólo hay nombre, tipo y logo. */
  perfilDisponible: boolean;
  onModerar: () => void;
  onCerrar: () => void;
}) {
  const redes = REDES.filter((r) => esHttps(f.redes?.[r.red]));
  const nombre = f.nombrePublico ?? "Anónimo";
  return (
    <section className="rounded-2xl border border-line bg-paper">
      <header className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="flex min-w-0 items-start gap-3">
          {f.logoUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={f.logoUrl} alt={`Logo de ${nombre}`} className="h-12 w-12 shrink-0 rounded-xl border border-line bg-paper object-contain" />
          ) : (
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-paperDeep text-inkSoft" aria-hidden><Users size={18} /></span>
          )}
          <div className="min-w-0">
            <p className={f.nombrePublico ? "font-display text-lg font-bold text-ink" : "text-lg italic text-mute"}>{nombre}</p>
            <p className="text-[12px] text-mute">{tipoFinanciadorLabel(f.tipo)}</p>
            <div className="mt-1">
              {f.visible ? (
                <Badge tono="ok" punto>Visible</Badge>
              ) : (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <Badge tono="danger" punto>Oculto</Badge>
                  <span className="text-[11px] text-mute">{motivoNoVisibleLabel(f.motivoNoVisible) ?? "sin motivo registrado"}</span>
                </span>
              )}
            </div>
          </div>
        </div>
        <button onClick={onCerrar} aria-label="Cerrar detalle" className="rounded-lg p-1 text-mute hover:bg-paperDeep hover:text-ink"><X size={16} aria-hidden /></button>
      </header>

      <div className="space-y-4 px-4 pb-4 pt-3 sm:px-5 sm:pb-5">
        {(f.sancionVigente || f.alertasActivas) && (
          <Aviso tono="danger" titulo="Conflicto de interés">
            {f.sancionVigente ? "Su RUC tiene una sanción OSCE vigente." : "Su RUC figura como proveedor en alertas activas."}
          </Aviso>
        )}

        {!perfilDisponible ? (
          <Aviso tono="warn" titulo="Perfil público no disponible">
            La base todavía no guarda el perfil público (falta la migración 30): sólo se ven nombre, tipo y logo.
          </Aviso>
        ) : (
          <>
            {esHttps(f.portadaUrl) && (
              <a href={f.portadaUrl} target="_blank" rel="noopener noreferrer nofollow" className="block overflow-hidden rounded-xl border border-line hover:border-ink/25">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.portadaUrl} alt={`Imagen de portada de ${nombre}`} className="h-20 w-full bg-paperDeep object-cover" />
                <span className="sr-only">(se abre en otra pestaña)</span>
              </a>
            )}
            <div>
              <p className="text-[11px] font-medium text-mute">Descripción</p>
              {f.descripcion ? <p className="mt-0.5 text-[13px] text-ink">{f.descripcion}</p> : <p className="mt-0.5 text-sm"><SinDato texto="No publicó descripción" /></p>}
            </div>
            <KeyValue
              columnas={1}
              items={[
                { etiqueta: "Web", valor: esHttps(f.sitioWeb) ? <Enlace href={f.sitioWeb}>{f.sitioWeb.replace(/^https:\/\//, "").replace(/\/$/, "")}</Enlace> : null },
                { etiqueta: "Correo de contacto (público)", valor: f.emailPublico },
                {
                  etiqueta: "Redes",
                  valor: redes.length ? (
                    <ul className="flex flex-wrap gap-x-3 gap-y-1">
                      {redes.map((r) => <li key={r.red}><Enlace href={f.redes[r.red]!}>{r.nombre}</Enlace></li>)}
                    </ul>
                  ) : null,
                },
              ]}
            />
          </>
        )}

        <KeyValue
          items={[
            { etiqueta: "RUC (privado)", valor: f.ruc ? <Ruc value={f.ruc} /> : null, mono: true },
            { etiqueta: "Alta", valor: fmtDia(f.createdAt) },
            { etiqueta: "Correo de la cuenta (privado)", valor: f.email, completo: true },
            { etiqueta: "Aportes", valor: String(f.aportes) },
            { etiqueta: "Contratos financiados", valor: String(f.contratosFinanciados) },
            { etiqueta: "Monto confirmado", valor: fmtPEN(f.montoPen), mono: true, completo: true },
          ]}
        />

        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <button onClick={onModerar} className={claseBoton(f.visible ? "peligro" : "secundario", "md")}>
            {f.visible ? <><EyeOff size={14} aria-hidden /> Ocultar</> : <><Eye size={14} aria-hidden /> Mostrar</>}
          </button>
          {f.visible && f.slug && (
            <Link href={`/aliado/${f.slug}`} target="_blank" className={claseBoton("fantasma", "md")}>
              <ExternalLink size={13} aria-hidden /> Ver perfil público<span className="sr-only"> (se abre en otra pestaña)</span>
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
