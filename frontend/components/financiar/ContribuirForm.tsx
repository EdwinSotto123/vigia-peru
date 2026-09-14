"use client";

/**
 * Formulario de contribución — fase 0 (sin pasarela).
 * Flujo: elegir N contratos → identidad → POST /contribuciones → instrucciones de
 * pago (Yape/Plin/transferencia con el código como concepto) → subir comprobante.
 * La confirmación la hace un admin (POST /admin/contribuciones/:codigo/validar).
 */

import { useState } from "react";
import { Building2, User, Users, EyeOff, Upload, CheckCircle2, Loader2 } from "lucide-react";
import { formatPEN } from "@/lib/financiamiento";
import { BrandBadge, PaymentMethods, type PagoPublico } from "./PaymentMethods";

const API = process.env.NEXT_PUBLIC_VIGIA_API_URL ?? "https://vigia-peru-api-36169102688.us-central1.run.app";

type Tipo = "empresa" | "organizacion" | "persona" | "anonimo";

interface Props {
  ubigeo: string;
  zonaNombre: string;
  precioPen: number;
  restantes: number;   // contratos aún sin financiar
  metodos?: string[];  // marcas configuradas (yape, plin, BCP…) para mostrar antes de pagar
}

interface Creada {
  codigo: string;
  montoPen: number;
  contratos: number;
  pago: PagoPublico & { concepto: string; metodo: string };
}

export function ContribuirForm({ ubigeo, zonaNombre, precioPen, restantes, metodos = [] }: Props) {
  const presets = [5, 20, 50, 100, 500].filter((n) => n <= Math.max(restantes, 5));
  const [contratos, setContratos] = useState<number>(presets[Math.min(1, presets.length - 1)] ?? 5);
  const [tipo, setTipo] = useState<Tipo>("empresa");
  const [nombre, setNombre] = useState("");
  const [ruc, setRuc] = useState("");
  const [email, setEmail] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [metodo, setMetodo] = useState<"yape" | "plin" | "transferencia">("yape");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creada, setCreada] = useState<Creada | null>(null);
  const [comprobante, setComprobante] = useState<File | null>(null);
  const [subido, setSubido] = useState(false);

  const monto = contratos * precioPen;
  const necesitaRuc = tipo === "empresa" || tipo === "organizacion";

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (contratos < 5) return setError("El mínimo son 5 contratos.");
    if (necesitaRuc && !/^\d{11}$/.test(ruc)) return setError("Ingresa un RUC de 11 dígitos.");
    if (tipo !== "anonimo" && nombre.trim().length < 2) return setError("Ingresa el nombre que quieres mostrar.");
    setLoading(true);
    try {
      const r = await fetch(`${API}/contribuciones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ubigeo,
          contratos,
          metodo,
          mensajePublico: mensaje.trim() || undefined,
          financiador: {
            tipo: tipo === "anonimo" ? "persona" : tipo,
            nombrePublico: tipo === "anonimo" ? undefined : nombre.trim(),
            ruc: necesitaRuc ? ruc : undefined,
            email,
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.detail ?? j.error ?? "No se pudo registrar el aporte");
      setCreada(j);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function subirComprobante() {
    if (!creada || !comprobante) return;
    setLoading(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", comprobante);
      fd.append("kind", "comprobante");
      const up = await fetch("/api/upload", { method: "POST", body: fd });
      const uj = await up.json();
      if (!up.ok || !uj.url) throw new Error(uj.error ?? "No se pudo subir el comprobante");
      const r = await fetch(`${API}/contribuciones/${creada.codigo}/comprobante`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: uj.url }),
      });
      if (!r.ok) throw new Error("No se pudo adjuntar el comprobante");
      setSubido(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (creada) {
    const step = subido ? 3 : 2;
    return (
      <div className="rounded-2xl border border-line bg-paper p-6">
        <Stepper step={step} />
        <div className="mt-5 flex items-center gap-2 text-moss"><CheckCircle2 size={18} /><span className="text-sm font-semibold">Aporte registrado</span></div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-mono text-2xl font-bold text-ink">{creada.codigo}</h3>
          <span className="text-sm text-mute">{creada.contratos} contratos en {zonaNombre}</span>
        </div>

        {!subido ? (
          <>
            <div className="mt-5">
              <div className="text-[11px] uppercase tracking-wide text-mute">Paso 2 · Paga</div>
              <div className="mt-2">
                <PaymentMethods pago={creada.pago} monto={formatPEN(creada.montoPen)} concepto={creada.codigo} metodoPreferido={creada.pago.metodo} />
              </div>
            </div>
            <div className="mt-5 rounded-xl border border-line p-4">
              <div className="text-[11px] uppercase tracking-wide text-mute">Paso 3 · Sube el comprobante</div>
              <p className="mt-1 text-sm text-mute">Captura de Yape/Plin o constancia de transferencia. Se guarda en privado; solo lo ve el equipo que valida.</p>
              <input type="file" accept="image/*,.pdf" onChange={(e) => setComprobante(e.target.files?.[0] ?? null)} className="mt-3 block w-full text-sm text-mute file:mr-3 file:rounded-lg file:border-0 file:bg-ink file:px-3 file:py-1.5 file:text-paper" />
              <button onClick={subirComprobante} disabled={!comprobante || loading} className="mt-3 inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-paper disabled:opacity-50">
                {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Enviar comprobante
              </button>
            </div>
          </>
        ) : (
          <div className="mt-5 rounded-xl border border-moss/30 bg-moss/5 p-4 text-sm text-ink">
            <div className="font-semibold">Comprobante recibido. ¡Gracias!</div>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-mute">
              <li>Validamos el pago en menos de 48 h y te avisamos por correo.</li>
              <li>Al confirmarse, se asignan {creada.contratos} contratos de {zonaNombre} por antigüedad.</li>
              <li>Tu comprobante de impacto se va llenando con cada contrato procesado.</li>
            </ol>
            <a href={`/impacto/${creada.codigo}`} className="mt-3 inline-block rounded-lg bg-ink px-3 py-1.5 text-xs font-semibold text-paper">Ver mi comprobante de impacto →</a>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-rust">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={crear} className="rounded-2xl border border-line bg-paper p-6">
      <Stepper step={1} />
      <h3 className="mt-5 font-serif text-xl font-bold text-ink">Financiar auditoría en {zonaNombre}</h3>
      <p className="mt-1 text-sm text-mute">{formatPEN(precioPen)} por contrato · quedan {restantes.toLocaleString("es-PE")} sin financiar</p>

      {/* Cantidad */}
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-wide text-mute">¿Cuántos contratos?</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {presets.map((n) => (
            <button type="button" key={n} onClick={() => setContratos(n)} className={`rounded-lg border px-3 py-1.5 text-sm ${contratos === n ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
              {n} · {formatPEN(n * precioPen)}
            </button>
          ))}
          {restantes > 5 && (
            <button type="button" onClick={() => setContratos(restantes)} className={`rounded-lg border px-3 py-1.5 text-sm ${contratos === restantes ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
              Todos ({restantes}) · {formatPEN(restantes * precioPen)}
            </button>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <span className="text-mute">Otro:</span>
          <input type="number" min={5} value={contratos} onChange={(e) => setContratos(Math.max(5, Number(e.target.value) || 5))} className="w-28 rounded-lg border border-line px-2 py-1 font-mono" />
          <span className="font-mono text-ink">= {formatPEN(monto)}</span>
        </div>
      </div>

      {/* Identidad */}
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-wide text-mute">¿Quién financia?</div>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([["empresa", "Empresa", Building2], ["organizacion", "Organización", Users], ["persona", "Persona", User], ["anonimo", "Anónimo", EyeOff]] as const).map(([k, label, Icon]) => (
            <button type="button" key={k} onClick={() => setTipo(k)} className={`flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-sm ${tipo === k ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {tipo !== "anonimo" && (
            <label className="text-sm">
              <span className="text-mute">{tipo === "persona" ? "Nombre a mostrar" : "Razón social / nombre público"}</span>
              <input value={nombre} onChange={(e) => setNombre(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder={tipo === "persona" ? "Ej. María Q." : "Ej. Empresa X S.A.C."} />
            </label>
          )}
          {necesitaRuc && (
            <label className="text-sm">
              <span className="text-mute">RUC (se valida contra SUNAT y sanciones OSCE)</span>
              <input value={ruc} onChange={(e) => setRuc(e.target.value.replace(/\D/g, "").slice(0, 11))} className="mt-1 w-full rounded-lg border border-line px-3 py-2 font-mono" placeholder="20XXXXXXXXX" />
            </label>
          )}
          <label className="text-sm">
            <span className="text-mute">Correo (privado, para el comprobante)</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="tu@correo.pe" />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="text-mute">Mensaje público (opcional, 140 caracteres)</span>
            <input maxLength={140} value={mensaje} onChange={(e) => setMensaje(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2" placeholder="Por un San Martín de Porres sin sobrecostos" />
          </label>
        </div>
      </div>

      {/* Método */}
      <div className="mt-5">
        <div className="text-[11px] uppercase tracking-wide text-mute">Método de pago</div>
        <div className="mt-2 flex gap-2">
          {(["yape", "plin", "transferencia"] as const).map((m) => (
            <button type="button" key={m} onClick={() => setMetodo(m)} className={`rounded-lg border px-3 py-1.5 text-sm capitalize ${metodo === m ? "border-ink bg-ink text-paper" : "border-line text-ink hover:bg-paperDeep"}`}>{m}</button>
          ))}
        </div>
        {metodos.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px] text-mute">Aceptamos {metodos.map((m) => <BrandBadge key={m} brand={m} />)}</div>
        )}
        <p className="mt-2 text-[12px] text-mute">Recibes el código de tu aporte y los datos de pago (número, QR, cuenta); subes el comprobante y lo validamos en menos de 48 h.</p>
      </div>

      {error && <p className="mt-4 text-sm text-rust">{error}</p>}

      <button type="submit" disabled={loading} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-ink px-4 py-3 text-sm font-semibold text-paper transition-transform hover:scale-[1.01] disabled:opacity-60">
        {loading && <Loader2 size={14} className="animate-spin" />}
        Financiar {contratos} contratos · {formatPEN(monto)}
      </button>
      <p className="mt-3 text-center text-[11px] leading-relaxed text-mute">
        Financias capacidad de análisis, no resultados. Los contratos se asignan por antigüedad; el pipeline no
        sabe quién aportó. Si tu empresa tiene sanción vigente o alertas activas, el aporte se acepta pero no hay reconocimiento público.
      </p>
    </form>
  );
}

function Stepper({ step }: { step: 1 | 2 | 3 }) {
  const steps = ["Elige", "Paga", "Comprobante"];
  return (
    <ol className="flex items-center gap-2 text-[11px]">
      {steps.map((s, i) => {
        const n = (i + 1) as 1 | 2 | 3;
        const done = n < step, active = n === step;
        return (
          <li key={s} className="flex items-center gap-2">
            <span className={`flex h-5 w-5 items-center justify-center rounded-full font-mono ${done ? "bg-moss text-paper" : active ? "bg-ink text-paper" : "bg-paperDeep text-mute"}`}>{done ? "✓" : n}</span>
            <span className={active ? "font-semibold text-ink" : "text-mute"}>{s}</span>
            {i < steps.length - 1 && <span className="mx-1 h-px w-6 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}
