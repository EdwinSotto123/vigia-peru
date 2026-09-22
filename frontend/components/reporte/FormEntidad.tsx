"use client";

// Formulario de denuncia de entidad (extraído de page.tsx).

import { useState } from "react";
import {
  Building2,
  Search,
  Upload,
  Check,
  Loader2,
  Flag,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { ENTIDADES, TIPO_SHORT, type Entidad } from "@/lib/mock-entities";
import { cn } from "@/lib/utils";
import { createReporte } from "@/lib/api-client";
import { Step } from "./Step";
import { ProgressTracker } from "./ProgressTracker";

const CATEGORIAS_ENTIDAD = [
  { id: "malversacion", label: "Malversación de fondos", emoji: "💰" },
  { id: "conflicto_interes", label: "Conflicto de interés sistemático", emoji: "♻️" },
  { id: "favoritismo", label: "Favoritismo recurrente a un proveedor", emoji: "🎁" },
  { id: "obstruccion", label: "Obstrucción a control / transparencia", emoji: "🚪" },
  { id: "patron_corrupcion", label: "Patrón de corrupción documentable", emoji: "🔁" },
  { id: "otra_entidad", label: "Otra irregularidad institucional", emoji: "❓" },
];

export function FormEntidad({
  submitting,
  setSubmitting,
  onDone,
  initialRuc,
}: {
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onDone: (id: string) => void;
  initialRuc: string;
}) {
  const [ent, setEnt] = useState<Entidad | null>(
    initialRuc ? ENTIDADES.find((e) => e.ruc === initialRuc) ?? null : null,
  );
  const [query, setQuery] = useState("");
  const [categoria, setCategoria] = useState<string>("");
  const [descripcion, setDescripcion] = useState("");
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [contactoOpcional, setContactoOpcional] = useState("");
  // Antes estas dos validaciones interrumpían con un alert() nativo del navegador —
  // el mismo patrón "sin feedback visual" que el resto del sistema de diseño evita:
  // ahora es un aviso en línea, junto al botón de enviar, igual que en FormObra.
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);

  const results = query.trim().length < 2
    ? []
    : ENTIDADES.filter(
        (e) =>
          e.nombre.toLowerCase().includes(query.toLowerCase()) ||
          e.ruc.includes(query),
      ).slice(0, 6);

  const milestones = [
    { label: "Entidad", done: !!ent },
    { label: "Categoría", done: !!categoria },
    { label: "Relato", done: descripcion.trim().length > 10 },
  ];
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ent || !categoria || !descripcion.trim()) {
      setErrorEnvio("Selecciona una entidad, una categoría y describe lo que viste.");
      return;
    }
    setErrorEnvio(null);
    setSubmitting(true);
    try {
      let fotoUrl: string | null = null;
      if (evidencia) {
        const fd = new FormData();
        fd.append("file", evidencia);
        const up = await fetch("/api/upload", { method: "POST", body: fd });
        if (up.ok) fotoUrl = (await up.json())?.url || null;
      }
      const r = await createReporte({
        modo: "entidad",
        categoria, descripcion, fotoUrl,
        region: ent.region,
        rucEntidad: ent.ruc,
        contactoEmail: contactoOpcional || null,
      });
      onDone(r.id);
    } catch (err) {
      setErrorEnvio("No se pudo enviar: " + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="surface space-y-6 p-6">
      <ProgressTracker milestones={milestones} />

      <Step n={1} title="¿Cuál es la entidad?">
        {ent ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-paperSoft p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] text-mute">
                <Building2 size={11} /> {TIPO_SHORT[ent.tipo]} · RUC {ent.ruc}
              </div>
              <div className="mt-0.5 font-serif text-base font-bold text-ink">
                {ent.nombre}
              </div>
              <div className="text-xs text-mute">
                {ent.region}
                {ent.provincia && ` · ${ent.provincia}`}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setEnt(null)}
              className="text-xs text-mute hover:text-ink hover:underline"
            >
              cambiar
            </button>
          </div>
        ) : (
          <div className="relative">
            <Search
              size={15}
              className="absolute left-3 top-3 text-mute"
            />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre o RUC (ej: Independencia, 20131369981)"
              className="w-full rounded-xl border border-line bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:border-heroViolet focus:outline-none"
            />
            {results.length > 0 && (
              <div className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-line bg-paperSoft shadow-card">
                {results.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setEnt(r);
                      setQuery("");
                    }}
                    className="block w-full border-b border-line px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-paperDeep"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-mute">
                      <span className="font-mono">RUC {r.ruc}</span>
                      <span>·</span>
                      <span>{TIPO_SHORT[r.tipo]}</span>
                      <span>·</span>
                      <span>{r.region}</span>
                    </div>
                    <div className="text-sm font-medium text-ink">{r.nombre}</div>
                  </button>
                ))}
              </div>
            )}
            {query.trim().length >= 2 && results.length === 0 && (
              <div className="mt-2 rounded-xl border border-dashed border-line bg-paperDeep p-3 text-xs text-mute">
                Sin resultados. La base se va a expandir con el tiempo.
              </div>
            )}
          </div>
        )}
      </Step>

      <Step n={2} title="¿Qué patrón estás denunciando?">
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIAS_ENTIDAD.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoria(c.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition-colors",
                categoria === c.id
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-paperSoft text-ink hover:border-mute hover:bg-paperDeep",
              )}
            >
              <span className="text-xl">{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>
      </Step>

      <Step n={3} title="Describe lo que viste (con detalle)">
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={6}
          placeholder="Ej: La Municipalidad lleva 4 años contratando siempre al mismo proveedor para servicios de mantenimiento. El gerente de logística es cuñado del dueño de la empresa. Tengo nombres y fechas."
          className="w-full rounded-xl border border-line bg-paperSoft px-4 py-3 text-sm leading-relaxed"
        />
        <p className="mt-1 text-xs text-mute">
          Nombres, fechas, números de contrato y enlaces ayudan a los agentes a validar.
        </p>
      </Step>

      <Step n={4} title="Adjunta evidencia (opcional)">
        <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-paperDeep px-6 py-6 text-center hover:bg-paperEdge/50">
          <Upload size={18} className="text-mute" />
          <div className="text-sm">
            {evidencia ? (
              <span className="font-medium text-ink">
                {evidencia.name} <Check size={14} className="ml-1 inline text-moss" />
              </span>
            ) : (
              <>
                <span className="font-medium text-ink">Documento, foto o PDF</span>
                <br />
                <span className="text-xs text-mute">Opcional — máx 12MB</span>
              </>
            )}
          </div>
          <input
            type="file"
            accept="image/*,.pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => setEvidencia(e.target.files?.[0] ?? null)}
          />
        </label>
      </Step>

      <Step n={5} title="Contacto opcional">
        <input
          type="email"
          value={contactoOpcional}
          onChange={(e) => setContactoOpcional(e.target.value)}
          placeholder="tu@email.com — sólo lo usamos para volver a contactarte"
          className="w-full rounded-xl border border-line bg-paperSoft px-4 py-2.5 text-sm"
        />
      </Step>

      <DisclaimerBanner />

      <div className="space-y-2">
        {errorEnvio && (
          <p
            className="flex items-start gap-2 rounded-xl border border-rust/30 bg-crimson-soft px-3 py-2.5 text-sm text-rust"
            role="alert"
          >
            <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {errorEnvio}
          </p>
        )}
        <Button type="submit" disabled={submitting} full variant="primary">
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Enviando…
            </>
          ) : (
            <>
              <Flag size={16} /> Reportar entidad
            </>
          )}
        </Button>
        <p className="text-center text-xs text-mute">
          {ready
            ? "Todo listo para enviar."
            : `Faltan ${milestones.length - doneCount} de ${milestones.length}: ${milestones.filter((m) => !m.done).map((m) => m.label.toLowerCase()).join(", ")}.`}
        </p>
      </div>
    </form>
  );
}
