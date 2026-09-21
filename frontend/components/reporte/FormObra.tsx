"use client";

// Formulario de denuncia de obra (extraído de page.tsx).

import { useState } from "react";
import {
  Camera,
  MapPin,
  Lock,
  Check,
  Upload,
  Loader2,
  HeartHandshake,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { cn } from "@/lib/utils";
import { createReporte } from "@/lib/api-client";
import { REGIONES } from "@/lib/peru-data";
import { Step } from "./Step";
import { ProgressTracker } from "./ProgressTracker";

const CATEGORIAS_OBRA = [
  { id: "obra_paralizada", label: "Obra paralizada", emoji: "🚧" },
  { id: "obra_fantasma", label: "Obra fantasma o inaugurada de mentira", emoji: "🏚️" },
  { id: "funcionario_sospechoso", label: "Funcionario con bienes no declarados", emoji: "🕴️" },
  { id: "irregularidad_general", label: "Otra irregularidad", emoji: "❓" },
];

type MediaSubido = {
  url: string;
  tipo: "foto" | "video" | "documento" | "audio";
  filename: string;
  size_bytes: number;
  content_type?: string;
};

export function FormObra({
  submitting,
  setSubmitting,
  onDone,
  initialRegion = "",
}: {
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  onDone: (id: string, region?: string) => void;
  initialRegion?: string;
}) {
  const [categoria, setCategoria] = useState<string>("");
  const [progreso, setProgreso] = useState<Record<string, number>>({});   // nombre → % subido
  const [geoEstado, setGeoEstado] = useState<"idle" | "buscando" | "ok" | "error">("idle");
  const [region, setRegion] = useState(initialRegion);
  const [descripcion, setDescripcion] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [subidos, setSubidos] = useState<MediaSubido[]>([]);
  const [subiendo, setSubiendo] = useState(false);
  const [errorSubida, setErrorSubida] = useState<string | null>(null);
  // Distinto de errorSubida (que es por-archivo, mostrado junto al picker en el paso 2):
  // esto es "no se puede enviar el formulario todavía", y se muestra junto al botón de
  // enviar — antes reusaba errorSubida y el aviso aparecía arriba en el paso de la foto
  // aunque lo que faltara fuera la ubicación o el relato, lejos de donde mirás al enviar.
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
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
    if (!navigator.geolocation) { setGeoEstado("error"); return; }
    setGeoEstado("buscando");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setUbicacion({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setGeoEstado("ok"); },
      () => setGeoEstado("error"),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
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
        setProgreso((p) => ({ ...p, [f.name]: 0 }));
        try {
          const data = await subirArchivo(f, (pct) => setProgreso((p) => ({ ...p, [f.name]: pct })));
          setSubidos((prev) => [...prev, {
            url: data.url, tipo: data.tipo, filename: data.filename || f.name,
            size_bytes: data.size_bytes || f.size, content_type: data.content_type,
          }]);
        } catch (e) {
          setErrorSubida(`No se pudo subir ${f.name}: ${(e as Error).message}`);
        } finally {
          setProgreso((p) => { const { [f.name]: _x, ...rest } = p; return rest; });
        }
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
    if (!descripcion.trim() || !hayFoto || (!ubicacion && !direccionTexto.trim())) {
      setErrorEnvio("Faltan datos obligatorios: revisa foto, lugar y relato arriba.");
      return;
    }
    setErrorEnvio(null);
    setSubmitting(true);
    try {
      const enlaces = enlacesExternos.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
      const r = await createReporte({
        modo: "obra",
        categoria: categoria || "irregularidad_general", descripcion,
        fotoUrl: subidos.find((s) => s.tipo === "foto")?.url ?? null,
        media: subidos,
        lat: ubicacion?.lat ?? null, lon: ubicacion?.lon ?? null,
        direccionTexto: direccionTexto || null,
        region: region || null,
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
      onDone(r.id, region || undefined);
    } catch (err) {
      setErrorEnvio("No se pudo enviar: " + (err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const hayFoto = subidos.some((s) => s.tipo === "foto");
  const hayLugar = !!(ubicacion || direccionTexto.trim());
  const milestones = [
    { label: "Foto", done: hayFoto },
    { label: "Lugar", done: hayLugar },
    { label: "Relato", done: descripcion.trim().length > 10 },
  ];
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;

  return (
    <form onSubmit={submit} className="surface space-y-6 p-6">
      <ProgressTracker milestones={milestones} />

      <Step n={1} title="¿Qué tipo de obra/situación? (opcional)">
        <div className="grid gap-2 sm:grid-cols-2">
          {CATEGORIAS_OBRA.map((c) => (
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

      <Step n={2} title="Foto (obligatoria) — también videos o documentos">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          {/* Cámara directa en móvil (capture) */}
          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-heroViolet/40 bg-heroViolet-soft px-4 py-6 text-center transition-colors hover:border-heroViolet sm:hidden">
            <Camera size={22} className="text-heroViolet" aria-hidden />
            <div className="text-sm">
              <span className="font-semibold text-ink">Tomar foto ahora</span>
              <br />
              <span className="text-xs text-mute">abre la cámara del teléfono</span>
            </div>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => handleFilesPick(e.target.files)}
            />
          </label>
          <label className="flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-paperDeep px-4 py-6 text-center hover:bg-paperEdge/50 sm:col-span-2">
            <Upload size={20} className="text-mute" aria-hidden />
            <div className="text-sm">
              <span className="font-medium text-ink">Elegir fotos, videos o archivos</span>
              <br />
              <span className="text-xs text-mute">
                JPG/PNG/MP4/PDF, hasta 50MB c/u · puedes agregar varios
              </span>
            </div>
            <input
              type="file"
              accept="image/*,video/*,audio/*,application/pdf,.doc,.docx"
              multiple
              className="sr-only"
              onChange={(e) => handleFilesPick(e.target.files)}
            />
          </label>
        </div>
        {Object.entries(progreso).map(([nombre, pct]) => (
          <div key={nombre} className="mt-2">
            <div className="flex items-center justify-between text-[11px] text-mute">
              <span className="inline-flex items-center gap-1.5 truncate"><Loader2 size={11} className="animate-spin" aria-hidden /> Subiendo {nombre}</span>
              <span className="font-mono">{pct}%</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-paperDeep" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`Subida de ${nombre}`}>
              <div className="h-full rounded-full bg-heroViolet transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        ))}
        {subiendo && Object.keys(progreso).length === 0 && (
          <div className="mt-2 inline-flex items-center gap-2 text-xs text-mute">
            <Loader2 size={12} className="animate-spin" aria-hidden /> Subiendo…
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
                <span className="rounded-full bg-paperDeep px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-mute">
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

      <Step n={3} title="¿Dónde? (obligatorio: ubicación o dirección)">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="secondary" onClick={usarMiUbicacion} disabled={geoEstado === "buscando"}>
            {geoEstado === "buscando" ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <MapPin size={16} aria-hidden />}
            {geoEstado === "buscando" ? "Buscando tu ubicación…" : ubicacion ? "Actualizar mi ubicación" : "Usar mi ubicación actual"}
          </Button>
          {ubicacion && (
            <span className="pill border-heroGreen/30 bg-heroGreen-soft text-heroGreen">
              <Check size={12} /> {ubicacion.lat.toFixed(4)}, {ubicacion.lon.toFixed(4)}
            </span>
          )}
          {geoEstado === "error" && !ubicacion && (
            <span className="text-xs text-rust" role="status">No pudimos obtener tu ubicación: escribe la dirección abajo.</span>
          )}
        </div>
        <input
          type="text"
          placeholder="Dirección o referencia (ej: Av. Confraternidad 320, Huaraz)"
          value={direccionTexto}
          onChange={(e) => setDireccionTexto(e.target.value)}
          className="mt-3 w-full rounded-xl border border-line bg-paperSoft px-4 py-2.5 text-sm"
        />
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="mt-2 w-full rounded-xl border border-line bg-paperSoft px-4 py-2 text-sm text-ink"
        >
          <option value="">Región (departamento)</option>
          {REGIONES.map((r) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
        </select>
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

      <Step n={4} title="Cuéntanos qué viste (obligatorio)">
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
            className="h-4 w-4 rounded border-line accent-heroViolet"
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
            : `Faltan ${milestones.length - doneCount} de ${milestones.length}: ${milestones.filter((m) => !m.done).map((m) => m.label.toLowerCase()).join(", ")}.`}
        </p>
      </div>
    </form>
  );
}

/** Sube un archivo a /api/upload con progreso real (XHR). */
function subirArchivo(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ url: string; tipo: MediaSubido["tipo"]; filename?: string; size_bytes?: number; content_type?: string }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload");
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data?.ok) resolve(data);
        else reject(new Error(data?.error || String(xhr.status)));
      } catch { reject(new Error(String(xhr.status))); }
    };
    xhr.onerror = () => reject(new Error("sin conexión"));
    xhr.send(fd);
  });
}
