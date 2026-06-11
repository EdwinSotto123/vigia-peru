"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  Camera,
  MapPin,
  Lock,
  Check,
  Upload,
  Loader2,
  ArrowLeft,
  Shield,
  Building2,
  HardHat,
  Search,
  Flag,
  Zap,
  Sparkles,
  Eye,
  HeartHandshake,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { ENTIDADES, TIPO_SHORT, type Entidad } from "@/lib/mock-entities";
import { cn } from "@/lib/utils";
import { createReporte } from "@/lib/api-client";

const CATEGORIAS_OBRA = [
  { id: "obra_paralizada", label: "Obra paralizada", emoji: "🚧" },
  { id: "obra_fantasma", label: "Obra fantasma o inaugurada de mentira", emoji: "🏚️" },
  { id: "funcionario_sospechoso", label: "Funcionario con bienes no declarados", emoji: "🕴️" },
  { id: "irregularidad_general", label: "Otra irregularidad", emoji: "❓" },
];

const CATEGORIAS_ENTIDAD = [
  { id: "malversacion", label: "Malversación de fondos", emoji: "💰" },
  { id: "conflicto_interes", label: "Conflicto de interés sistemático", emoji: "♻️" },
  { id: "favoritismo", label: "Favoritismo recurrente a un proveedor", emoji: "🎁" },
  { id: "obstruccion", label: "Obstrucción a control / transparencia", emoji: "🚪" },
  { id: "patron_corrupcion", label: "Patrón de corrupción documentable", emoji: "🔁" },
  { id: "otra_entidad", label: "Otra irregularidad institucional", emoji: "❓" },
];

type Modo = "obra" | "entidad";

export default function ReporteNuevoPage() {
  return (
    <Suspense fallback={<div className="container-page py-10">Cargando…</div>}>
      <ReporteNuevoInner />
    </Suspense>
  );
}

function ReporteNuevoInner() {
  const search = useSearchParams();
  const initialModo: Modo = search.get("modo") === "entidad" ? "entidad" : "obra";
  const initialRuc = search.get("ruc") ?? "";

  const [modo, setModo] = useState<Modo>(initialModo);
  const [submitting, setSubmitting] = useState(false);
  const [ok, setOk] = useState<string | null>(null);

  return (
    <div className="container-page max-w-3xl space-y-8 py-10">
      <Link
        href="/"
        className="inline-flex items-center gap-2 text-sm text-mute hover:text-ink"
      >
        <ArrowLeft size={16} /> Volver al mapa
      </Link>

      <header className="overflow-hidden rounded-3xl border border-line bg-ink text-paper">
        <div className="relative px-6 py-8 sm:px-10 sm:py-10">
          {/* glow sutil */}
          <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-rust/20 blur-3xl" />
          <div className="relative space-y-4">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-paper/20 bg-paper/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-paper/80">
              <Camera size={12} className="text-amber" /> Vigilancia ciudadana
            </span>
            <h1 className="font-serif text-4xl font-bold leading-[1.05] sm:text-5xl">
              Lo que viste<br />
              <span className="text-amber">el Estado no lo puede ignorar.</span>
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-paper/75">
              Sube una foto y cuéntanos qué pasa. En minutos, nuestros agentes la
              cruzan con contratos del SEACE, SUNAT y obras públicas. Tú eres los
              ojos que el sistema no tiene.
            </p>
            {/* tres promesas honestas */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { icon: <Lock size={13} />, text: "100% anónimo" },
                { icon: <Zap size={13} />, text: "Cruzado con datos del Estado" },
                { icon: <Flag size={13} />, text: "Si coincide → caso público" },
              ].map((p) => (
                <span
                  key={p.text}
                  className="inline-flex items-center gap-1.5 rounded-full bg-paper/10 px-3 py-1.5 text-xs font-medium text-paper/90"
                >
                  <span className="text-amber">{p.icon}</span> {p.text}
                </span>
              ))}
            </div>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-paperSoft p-1.5">
        <TabBig
          active={modo === "obra"}
          onClick={() => setModo("obra")}
          icon={<HardHat size={18} />}
          title="Una obra específica"
          subtitle="Obra paralizada, fantasma, etc."
        />
        <TabBig
          active={modo === "entidad"}
          onClick={() => setModo("entidad")}
          icon={<Building2 size={18} />}
          title="Una entidad del Estado"
          subtitle="Patrón sistemático en una institución"
        />
      </div>

      {ok ? (
        <Confirmacion id={ok} modo={modo} />
      ) : modo === "obra" ? (
        <FormObra
          submitting={submitting}
          setSubmitting={setSubmitting}
          onDone={setOk}
        />
      ) : (
        <FormEntidad
          submitting={submitting}
          setSubmitting={setSubmitting}
          onDone={setOk}
          initialRuc={initialRuc}
        />
      )}
    </div>
  );
}

function TabBig({
  active,
  onClick,
  icon,
  title,
  subtitle,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors",
        active
          ? "bg-ink text-paper shadow-card"
          : "bg-transparent text-mute hover:bg-paper hover:text-ink",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-paper/15 text-paper" : "bg-paperDeep text-clay",
        )}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold">{title}</div>
        <div className={cn("text-xs", active ? "text-paper/70" : "text-mute")}>
          {subtitle}
        </div>
      </div>
    </button>
  );
}

// ─── FORM OBRA ────────────────────────────────────

type MediaSubido = {
  url: string;
  tipo: "foto" | "video" | "documento" | "audio";
  filename: string;
  size_bytes: number;
  content_type?: string;
};

function FormObra({
  submitting,
  setSubmitting,
  onDone,
}: {
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onDone: (id: string) => void;
}) {
  const [categoria, setCategoria] = useState<string>("");
  const [descripcion, setDescripcion] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [subidos, setSubidos] = useState<MediaSubido[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  const [ubicacion, setUbicacion] = useState<{ lat: number; lon: number } | null>(null);
  const [direccionTexto, setDireccionTexto] = useState("");
  const [provincia, setProvincia] = useState("");
  const [distrito, setDistrito] = useState("");
  const [montoEstimado, setMontoEstimado] = useState("");
  const [periodoDesde, setPeriodoDesde] = useState("");
  const [periodoHasta, setPeriodoHasta] = useState("");
  const [personasInvolucradas, setPersonasInvolucradas] = useState("");
  const [enlacesExternos, setEnlacesExternos] = useState("");
  const [contactoOpcional, setContactoOpcional] = useState("");
  const [contactoNombre, setContactoNombre] = useState("");
  const [anonimo, setAnonimo] = useState(true);

  const usarMiUbicacion = () => {
    if (!navigator.geolocation) {
      alert("Tu navegador no soporta geolocalización. Escribe la dirección abajo.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => setUbicacion({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => alert("No pudimos obtener tu ubicación. Podés escribirla manualmente."),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const handleFilesPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const nuevos = Array.from(files);
    setArchivos((prev) => [...prev, ...nuevos]);
    setErrorSubida(null);
    setSubiendo(true);
    try {
      for (const f of nuevos) {
        const fd = new FormData();
        fd.append("file", f);
        const r = await fetch("/api/upload", { method: "POST", body: fd });
        const data = await r.json().catch(() => null);
        if (!r.ok || !data?.ok) {
          setErrorSubida(`No se pudo subir ${f.name}: ${data?.error || r.status}`);
          continue;
        }
        setSubidos((prev) => [...prev, {
          url: data.url, tipo: data.tipo, filename: data.filename || f.name,
          size_bytes: data.size_bytes || f.size, content_type: data.content_type,
        }]);
      }
    } finally {
      setSubiendo(false);
    }
  };

  const removeSubido = (i: number) => {
    setSubidos((prev) => prev.filter((_, idx) => idx !== i));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const hayFoto = subidos.some((s) => s.tipo === "foto");
    if (!categoria || !descripcion || !hayFoto || (!ubicacion && !direccionTexto)) {
      alert("Completa categoría, descripción, al menos una foto y ubicación.");
      return;
    }
    setSubmitting(true);
    try {
      const enlaces = enlacesExternos.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const r = await createReporte({
        modo: "obra",
        categoria, descripcion,
        fotoUrl: subidos.find((s) => s.tipo === "foto")?.url ?? null,
        media: subidos,
        lat: ubicacion?.lat ?? null, lon: ubicacion?.lon ?? null,
        direccionTexto: direccionTexto || null,
        provincia: provincia || null,
        distrito: distrito || null,
        montoEstimado: montoEstimado ? Number(montoEstimado) : null,
        periodoDesde: periodoDesde || null,
        periodoHasta: periodoHasta || null,
        personasInvolucradas: personasInvolucradas || null,
        enlacesExternos: enlaces.length ? enlaces : undefined,
        contactoEmail: contactoOpcional || null,
        contactoNombre: anonimo ? null : (contactoNombre || null),
        anonimo,
      });
      onDone(r.id);
    } catch (err) {
      alert("No se pudo enviar: " + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const hayFoto = subidos.some((s) => s.tipo === "foto");
  const hayLugar = !!(ubicacion || direccionTexto.trim());
  const milestones = [
    { label: "Tipo", done: !!categoria },
    { label: "Foto", done: hayFoto },
    { label: "Lugar", done: hayLugar },
    { label: "Relato", done: descripcion.trim().length > 10 },
  ];
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;

  return (
    <form onSubmit={submit} className="surface space-y-6 p-6">
      <ProgressTracker milestones={milestones} doneCount={doneCount} ready={ready} />

      <Step n={1} title="¿Qué tipo de obra/situación?">
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIAS_OBRA.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategoria(c.id)}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
                categoria === c.id
                  ? "border-rust bg-crimson-soft text-rust"
                  : "border-line bg-paperSoft hover:border-mute",
              )}
            >
              <span className="text-xl">{c.emoji}</span>
              {c.label}
            </button>
          ))}
        </div>
      </Step>

      <Step n={2} title="Sube fotos, videos o documentos (al menos una foto)">
        <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-paperDeep px-6 py-8 text-center hover:bg-paperEdge/50">
          <Upload size={20} className="text-mute" />
          <div className="text-sm">
            <span className="font-medium text-ink">Tomar foto, video o elegir archivos</span>
            <br />
            <span className="text-xs text-mute">
              JPG/PNG/MP4/PDF, hasta 50MB c/u · puedes agregar varios
            </span>
          </div>
          <input
            type="file"
            accept="image/*,video/*,audio/*,application/pdf,.doc,.docx"
            multiple
            className="hidden"
            onChange={(e) => handleFilesPick(e.target.files)}
          />
        </label>
        {subiendo && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-mute">
            <Loader2 size={12} className="animate-spin" /> Subiendo a Google Cloud Storage…
          </div>
        )}
        {errorSubida && (
          <div className="mt-2 text-xs text-rust">⚠ {errorSubida}</div>
        )}
        {subidos.length > 0 && (
          <ul className="mt-3 space-y-1.5">
            {subidos.map((s, i) => (
              <li
                key={s.url}
                className="flex items-center gap-2 rounded-lg border border-line bg-paperSoft px-3 py-2 text-xs"
              >
                <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-clay">
                  {s.tipo}
                </span>
                <a href={s.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-ink hover:underline">
                  {s.filename}
                </a>
                <span className="font-mono text-[10px] text-mute">
                  {(s.size_bytes / 1024 / 1024).toFixed(1)}MB
                </span>
                <button
                  type="button"
                  onClick={() => removeSubido(i)}
                  className="text-mute hover:text-rust"
                  aria-label="Quitar"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-2 text-xs text-mute">
          Sin al menos una foto no podemos publicar el reporte en el mapa público.
          Los archivos se almacenan en GCS de forma segura.
        </p>
      </Step>

      <Step n={3} title="¿Dónde?">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={usarMiUbicacion}>
            <MapPin size={16} /> Usar mi ubicación actual
          </Button>
          {ubicacion && (
            <Badge variant="navy">
              <Check size={12} /> {ubicacion.lat.toFixed(4)}, {ubicacion.lon.toFixed(4)}
            </Badge>
          )}
        </div>
        <input
          type="text"
          placeholder="Dirección o referencia (ej: Av. Confraternidad 320, Huaraz)"
          value={direccionTexto}
          onChange={(e) => setDireccionTexto(e.target.value)}
          className="mt-3 w-full rounded-xl border border-line bg-paperSoft px-4 py-2.5 text-sm"
        />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            type="text"
            placeholder="Provincia (opcional)"
            value={provincia}
            onChange={(e) => setProvincia(e.target.value)}
            className="w-full rounded-xl border border-line bg-paperSoft px-4 py-2 text-sm"
          />
          <input
            type="text"
            placeholder="Distrito (opcional)"
            value={distrito}
            onChange={(e) => setDistrito(e.target.value)}
            className="w-full rounded-xl border border-line bg-paperSoft px-4 py-2 text-sm"
          />
        </div>
      </Step>

      <Step n={4} title="Cuéntanos qué viste">
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          rows={5}
          placeholder="Ej: Esta obra dice ser un colegio terminado pero por dentro está vacío, sin ventanas. El alcalde la inauguró en agosto en Facebook."
          className="w-full rounded-xl border border-line bg-paperSoft px-4 py-3 text-sm leading-relaxed"
        />
      </Step>

      <Step n={5} title="Datos adicionales (opcional, suman al dossier)">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider text-mute">Monto estimado en S/.</label>
            <input
              type="number" min="0"
              value={montoEstimado}
              onChange={(e) => setMontoEstimado(e.target.value)}
              placeholder="Ej: 250000"
              className="mt-1 w-full rounded-xl border border-line bg-paperSoft px-4 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-mute">Desde</label>
              <input
                type="date"
                value={periodoDesde}
                onChange={(e) => setPeriodoDesde(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-paperSoft px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-[11px] font-semibold uppercase tracking-wider text-mute">Hasta</label>
              <input
                type="date"
                value={periodoHasta}
                onChange={(e) => setPeriodoHasta(e.target.value)}
                className="mt-1 w-full rounded-xl border border-line bg-paperSoft px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-mute">Personas involucradas (nombres, cargos)</label>
          <textarea
            rows={2}
            value={personasInvolucradas}
            onChange={(e) => setPersonasInvolucradas(e.target.value)}
            placeholder="Ej: Juan Pérez (Gerente Municipal), María López (Sub-Gerente Logística)"
            className="mt-1 w-full rounded-xl border border-line bg-paperSoft px-4 py-2 text-sm"
          />
        </div>
        <div className="mt-3">
          <label className="text-[11px] font-semibold uppercase tracking-wider text-mute">Enlaces externos (uno por línea)</label>
          <textarea
            rows={2}
            value={enlacesExternos}
            onChange={(e) => setEnlacesExternos(e.target.value)}
            placeholder="https://facebook.com/post/123&#10;https://noticia.pe/articulo"
            className="mt-1 w-full rounded-xl border border-line bg-paperSoft px-4 py-2 text-sm font-mono text-xs"
          />
        </div>
      </Step>

      <Step n={6} title="Contacto (opcional, anónimo por defecto)">
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={anonimo}
            onChange={(e) => setAnonimo(e.target.checked)}
            className="h-4 w-4 rounded border-line accent-clay"
          />
          <span className="text-ink">Mantener mi denuncia anónima</span>
          <Lock size={13} className="text-mute" />
        </label>
        <input
          type="email"
          value={contactoOpcional}
          onChange={(e) => setContactoOpcional(e.target.value)}
          placeholder="tu@email.com — sólo para volver a contactarte"
          className="w-full rounded-xl border border-line bg-paperSoft px-4 py-2.5 text-sm"
        />
        {!anonimo && (
          <input
            type="text"
            value={contactoNombre}
            onChange={(e) => setContactoNombre(e.target.value)}
            placeholder="Tu nombre"
            className="mt-2 w-full rounded-xl border border-line bg-paperSoft px-4 py-2.5 text-sm"
          />
        )}
        <p className="mt-2 text-[11px] text-mute">
          Si dejas el check de anónimo, tu nombre NO se publica en ningún lugar.
          Solo usamos el email para contactarte si tu denuncia se vuelve convergente.
        </p>
      </Step>

      <DisclaimerBanner />

      <div className="space-y-2">
        <Button type="submit" disabled={submitting} full variant="primary">
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" /> Enviando tu reporte…
            </>
          ) : (
            <>
              <HeartHandshake size={16} /> Enviar mi reporte ciudadano
            </>
          )}
        </Button>
        <p className="text-center text-xs text-mute">
          {ready
            ? "Todo listo. Gracias por dar la cara por tu comunidad."
            : `Faltan ${4 - doneCount} de 4: ${milestones.filter((m) => !m.done).map((m) => m.label.toLowerCase()).join(", ")}.`}
        </p>
      </div>
    </form>
  );
}

// ─── FORM ENTIDAD ─────────────────────────────────

function FormEntidad({
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

  const results = query.trim().length < 2
    ? []
    : ENTIDADES.filter(
        (e) =>
          e.nombre.toLowerCase().includes(query.toLowerCase()) ||
          e.ruc.includes(query),
      ).slice(0, 6);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ent || !categoria || !descripcion) {
      alert("Selecciona una entidad, una categoría y describe lo que viste.");
      return;
    }
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
      alert("No se pudo enviar: " + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={submit} className="surface space-y-6 p-6">
      <Step n={1} title="¿Cuál es la entidad?">
        {ent ? (
          <div className="flex items-start justify-between gap-3 rounded-xl border border-clay bg-amber-soft p-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[10px] text-clay">
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
              className="text-xs text-clay hover:underline"
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
              className="w-full rounded-xl border border-line bg-paperSoft px-9 py-2.5 text-sm placeholder:text-mute focus:border-clay focus:outline-none"
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
                    className="block w-full border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-paperDeep"
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
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition",
                categoria === c.id
                  ? "border-rust bg-crimson-soft text-rust"
                  : "border-line bg-paperSoft hover:border-mute",
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
    </form>
  );
}

// ─── Compartido ──────────────────────────────────

function ProgressTracker({
  milestones,
  doneCount,
  ready,
}: {
  milestones: { label: string; done: boolean }[];
  doneCount: number;
  ready: boolean;
}) {
  const pct = (doneCount / milestones.length) * 100;
  return (
    <div className="rounded-2xl border border-line bg-paperSoft p-4">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink">
          {ready ? (
            <Sparkles size={13} className="text-moss" />
          ) : (
            <Eye size={13} className="text-clay" />
          )}
          {ready
            ? "Reporte completo — listo para enviar"
            : `Tu reporte: ${doneCount} de ${milestones.length}`}
        </span>
        <span className="font-mono text-[11px] text-mute">{Math.round(pct)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-paperDeep">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            ready ? "bg-moss" : "bg-clay",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        {milestones.map((m) => (
          <div
            key={m.label}
            className={cn(
              "flex items-center justify-center gap-1 rounded-lg px-1 py-1 text-[10px] font-medium transition-colors",
              m.done ? "bg-moss/10 text-moss" : "bg-paperDeep/60 text-mute",
            )}
          >
            {m.done ? (
              <Check size={11} />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-mute/40" />
            )}
            {m.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">
          {n}
        </span>
        <h3 className="text-sm font-semibold text-ink">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function Confirmacion({ id, modo }: { id: string; modo: Modo }) {
  const pasos =
    modo === "obra"
      ? [
          { t: "Entra al mapa", d: "Aparece como pin rojo en validación." },
          { t: "Los agentes lo cruzan", d: "Con alertas automáticas del SEACE y SUNAT." },
          { t: "Coincidencia → caso", d: "Si calza con una alerta, se vuelve caso convergente público." },
          { t: "Te avisamos", d: "Si dejaste email, cuando pase a verificado." },
        ]
      : [
          { t: "Llega a revisión", d: "Entra al panel privado de validación." },
          { t: "Los agentes contrastan", d: "Contra OECE, SUNAT, ONPE y JNE." },
          { t: "Evidencia → dictamen", d: "Si hay patrón, se publica en el perfil de la entidad." },
          { t: "Te avisamos", d: "Si dejaste correo." },
        ];

  return (
    <div className="space-y-5">
      {/* Cabecera celebratoria */}
      <div className="relative overflow-hidden rounded-3xl border border-line bg-ink px-6 py-10 text-center text-paper">
        <div className="pointer-events-none absolute -left-16 -bottom-16 h-56 w-56 rounded-full bg-moss/25 blur-3xl" />
        <div className="relative">
          <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full bg-moss/20 ring-4 ring-moss/30">
            <Check size={40} strokeWidth={2.5} className="text-moss" />
          </div>
          <h2 className="mt-5 font-serif text-3xl font-bold leading-tight sm:text-4xl">
            Gracias por dar la cara.
          </h2>
          <p className="mx-auto mt-2 max-w-md text-paper/75">
            Tu reporte ya entró al sistema. Acabás de hacer algo que el Estado no
            hace solo: poner un ojo donde no llega el control.
          </p>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-paper/10 px-4 py-2 text-sm">
            <span className="text-paper/60">Código</span>
            <span className="font-mono font-bold text-amber">{id}</span>
          </div>
        </div>
      </div>

      {/* Qué pasa después — como un viaje */}
      <div className="surface p-6">
        <h3 className="mb-4 inline-flex items-center gap-2 text-sm font-bold text-ink">
          <Zap size={14} className="text-clay" /> El viaje de tu reporte
        </h3>
        <ol className="space-y-3">
          {pasos.map((p, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-bold text-paper">
                {i + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <div className="text-sm font-semibold text-ink">{p.t}</div>
                <div className="text-xs text-mute">{p.d}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Link href="/app/mapa">
          <Button variant="secondary" full>
            Ver mi reporte en el mapa
          </Button>
        </Link>
        <Link href="/reporte/nuevo">
          <Button variant="ink" full>
            <Camera size={16} /> Reportar algo más
          </Button>
        </Link>
      </div>
    </div>
  );
}
