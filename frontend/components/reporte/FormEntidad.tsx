"use client";

// Formulario de denuncia de entidad (extraído de page.tsx).
//
// La entidad se busca en el API real (`GET /entidades?q=`, 2.121 entidades del
// Estado). Antes se buscaba en `lib/mock-entities`, una lista de una docena de
// municipalidades inventadas: una entidad real no aparecía nunca y el vecino no
// podía denunciarla.
//
// Contra bots: la subida de la evidencia y el envío llevan cada uno su token de
// Turnstile; el widget, junto al botón de enviar, sólo se ve si hay que marcar la casilla.

import { useEffect, useRef, useState } from "react";
import { Building2, Check, ChevronDown, Loader2, Paperclip, Pencil, Search, Send, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DisclaimerBanner } from "@/components/DisclaimerBanner";
import { Ayuda } from "@/components/patrones/Ayuda";
import { cn } from "@/lib/utils";
import { createReporte, getEntidad, getEntidades } from "@/lib/api-client";
import { ErrorTurnstile, useTurnstile } from "@/components/seguridad/Turnstile";
import { cabeceraTurnstile } from "@/components/seguridad/mensajes";
import { etiquetaTipoEntidad } from "@/lib/entidad-tipo";
import { numero } from "@/lib/formato";
import type { CategoriaDenuncia } from "@/lib/denuncias-meta";
import { CAMPO as campo, ETIQUETA as etiqueta, ErrorCampo, ErrorEnvio, OpcionesCategoria } from "./Campos";
import { PasosEnColumnas, type Paso } from "./PasosEnColumnas";
import { ProgressTracker } from "./ProgressTracker";
import {
  ACEPTA_ARCHIVO,
  DESCRIPCION_MAX,
  DESCRIPCION_MIN,
  MAX_MB,
  correoValido,
  detieneLasSubidas,
  mensajeEnvio,
  mensajeErrorSubida,
  mensajeSubida,
  subirArchivo,
  validarArchivo,
} from "./envio";

const CATEGORIAS_ENTIDAD: { id: CategoriaDenuncia; label: string }[] = [
  { id: "malversacion", label: "Malversación de fondos" },
  { id: "conflicto_interes", label: "Conflicto de interés sistemático" },
  { id: "favoritismo", label: "Favoritismo recurrente a un proveedor" },
  { id: "obstruccion", label: "Obstrucción a control o transparencia" },
  { id: "patron_corrupcion", label: "Patrón de corrupción documentable" },
  { id: "otra_entidad", label: "Otra irregularidad institucional" },
];

interface EntidadElegida {
  ruc: string;
  nombre: string;
  tipo: string | null;
  region: string | null;
  provincia: string | null;
}

type Errores = Partial<Record<"entidad" | "categoria" | "descripcion" | "correo" | "evidencia", string>>;

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
  const [ent, setEnt] = useState<EntidadElegida | null>(null);
  const [cargandoInicial, setCargandoInicial] = useState(/^\d{11}$/.test(initialRuc));
  const [query, setQuery] = useState("");
  const [resultados, setResultados] = useState<EntidadElegida[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [errorBusqueda, setErrorBusqueda] = useState(false);
  const [categoria, setCategoria] = useState<string>("");
  const [descripcion, setDescripcion] = useState("");
  const [evidencia, setEvidencia] = useState<File | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [contactoOpcional, setContactoOpcional] = useState("");
  const [errores, setErrores] = useState<Errores>({});
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const pedido = useRef(0);
  const verificacion = useTurnstile("denuncia");

  // ?ruc= (desde la ficha de una entidad): se precarga la entidad real.
  useEffect(() => {
    if (!/^\d{11}$/.test(initialRuc)) return;
    let vivo = true;
    getEntidad(initialRuc)
      .then((r) => {
        const e = r?.entidad;
        if (vivo && e?.ruc) {
          setEnt({ ruc: e.ruc, nombre: e.nombre, tipo: e.tipo ?? null, region: e.region ?? null, provincia: e.provincia ?? null });
        }
      })
      .catch(() => {})
      .finally(() => vivo && setCargandoInicial(false));
    return () => {
      vivo = false;
    };
  }, [initialRuc]);

  // Búsqueda con pausa de 300 ms. El API busca por nombre; un RUC de 11 dígitos
  // se resuelve directo con `GET /entidades/:ruc`.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResultados([]);
      setBuscando(false);
      setErrorBusqueda(false);
      return;
    }
    const n = ++pedido.current;
    setBuscando(true);
    const t = window.setTimeout(async () => {
      try {
        let filas: EntidadElegida[];
        if (/^\d{11}$/.test(q)) {
          const r = await getEntidad(q);
          const e = r?.entidad;
          filas = e ? [{ ruc: e.ruc, nombre: e.nombre, tipo: e.tipo ?? null, region: e.region ?? null, provincia: e.provincia ?? null }] : [];
        } else {
          const r = await getEntidades({ q, limit: 8 });
          filas = r.map((e) => ({ ruc: e.ruc, nombre: e.nombre, tipo: e.tipo ?? null, region: e.region ?? null, provincia: e.provincia ?? null }));
        }
        if (n !== pedido.current) return;
        setResultados(filas);
        setErrorBusqueda(false);
      } catch {
        if (n !== pedido.current) return;
        setResultados([]);
        setErrorBusqueda(true);
      } finally {
        if (n === pedido.current) setBuscando(false);
      }
    }, 300);
    return () => window.clearTimeout(t);
  }, [query]);

  const relatoOk = descripcion.trim().length >= DESCRIPCION_MIN;
  const milestones = [
    { label: "Entidad", done: !!ent },
    { label: "Categoría", done: !!categoria },
    { label: "Relato", done: relatoOk },
  ];
  const doneCount = milestones.filter((m) => m.done).length;
  const ready = doneCount === milestones.length;

  const elegirEvidencia = (f: File | null) => {
    setErrores((x) => ({ ...x, evidencia: undefined }));
    if (!f) {
      setEvidencia(null);
      return;
    }
    const invalido = validarArchivo(f);
    if (invalido) {
      setEvidencia(null);
      setErrores((x) => ({ ...x, evidencia: mensajeSubida(f.name, invalido) }));
      return;
    }
    setEvidencia(f);
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e: Errores = {};
    if (!ent) e.entidad = "Busca y elige la entidad que quieres denunciar.";
    if (!categoria) e.categoria = "Elige qué patrón estás denunciando.";
    if (!relatoOk) e.descripcion = `Describe lo que viste con al menos ${DESCRIPCION_MIN} caracteres.`;
    if (!correoValido(contactoOpcional)) e.correo = "El correo no parece válido. Revísalo o déjalo vacío.";
    setErrores((x) => ({ ...e, evidencia: x.evidencia }));
    if (Object.keys(e).length || !ent) {
      setErrorEnvio("Revisa los campos marcados arriba antes de enviar.");
      return;
    }
    setErrorEnvio(null);
    setSubmitting(true);
    try {
      // Antes, si la evidencia no se subía, la denuncia se enviaba igual sin
      // decir nada. Ahora se detiene y se explica.
      let fotoUrl: string | null = null;
      if (evidencia) {
        setSubiendo(true);
        try {
          // Al bucket privado: una denuncia a una entidad nunca se publica.
          fotoUrl = (await subirArchivo(evidencia, undefined, { modo: "entidad", verificar: verificacion.obtenerToken })).url;
        } catch (err) {
          if (err instanceof ErrorTurnstile) {
            setErrorEnvio(mensajeEnvio(err));
            return;
          }
          setErrores((x) => ({ ...x, evidencia: mensajeErrorSubida(evidencia.name, err) }));
          setErrorEnvio(
            detieneLasSubidas(err)
              ? "No pudimos subir la evidencia. Revisa el aviso junto al archivo."
              : "No pudimos subir la evidencia. Quítala o prueba con otro archivo.",
          );
          return;
        } finally {
          setSubiendo(false);
        }
      }
      const verificado = await verificacion.obtenerToken();
      const r = await createReporte(
        {
          modo: "entidad",
          categoria,
          descripcion: descripcion.trim(),
          fotoUrl,
          region: ent.region,
          rucEntidad: ent.ruc,
          contactoEmail: contactoOpcional.trim() || null,
        },
        cabeceraTurnstile(verificado),
      );
      onDone(r.id);
    } catch (err) {
      setErrorEnvio(mensajeEnvio(err));
    } finally {
      setSubmitting(false);
    }
  };

  const columnaEntidad = (
    <>
      {ent ? (
        <div className="flex items-start justify-between gap-3 rounded-xl border border-line bg-paperSoft p-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-micro text-mute">
              <span className="inline-flex items-center gap-1">
                <Building2 size={11} aria-hidden /> {etiquetaTipoEntidad(ent.tipo, ent.nombre, "corto")}
              </span>
              <span className="font-mono tabular-nums">RUC {ent.ruc}</span>
            </div>
            <div className="mt-0.5 font-display text-destacado leading-6 font-bold text-ink">{ent.nombre}</div>
            {(ent.region || ent.provincia) && <div className="text-rotulo leading-4 text-mute">{[ent.region, ent.provincia].filter(Boolean).join(", ")}</div>}
          </div>
          <button type="button" onClick={() => setEnt(null)} className="inline-flex min-h-[44px] shrink-0 items-center rounded-full px-3 text-meta font-medium text-granate underline-offset-2 hover:underline">
            Cambiar
          </button>
        </div>
      ) : cargandoInicial ? (
        <p className="inline-flex items-center gap-2 text-dato leading-5 text-mute">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Cargando la entidad…
        </p>
      ) : (
        <div className="relative">
          <label htmlFor="entidad-buscar" className={etiqueta}>
            Nombre de la entidad o RUC
          </label>
          <div className="relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-mute" aria-hidden />
            <input
              id="entidad-buscar"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ej: Municipalidad de Independencia, 20131369981"
              aria-invalid={!!errores.entidad}
              aria-describedby="entidad-estado"
              className={cn(campo, "px-9")}
            />
            {buscando && <Loader2 size={14} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-mute" aria-hidden />}
          </div>
          <div id="entidad-estado" aria-live="polite">
            {resultados.length > 0 && (
              <ul className="mt-2 max-h-80 overflow-y-auto rounded-xl border border-line bg-paper shadow-pop">
                {resultados.map((r) => (
                  <li key={r.ruc} className="border-b border-line last:border-b-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEnt(r);
                        setQuery("");
                        setErrores((x) => ({ ...x, entidad: undefined }));
                      }}
                      className="block min-h-[44px] w-full px-3 py-2 text-left transition-colors duration-rapido hover:bg-granate-50"
                    >
                      <span className="block text-dato leading-5 font-medium text-ink">{r.nombre}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 text-micro text-mute">
                        <span className="font-mono tabular-nums">RUC {r.ruc}</span>
                        <span>{etiquetaTipoEntidad(r.tipo, r.nombre, "corto")}</span>
                        {r.region && <span>{r.region}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!buscando && query.trim().length >= 2 && resultados.length === 0 && (
              <p className="mt-2 rounded-xl border border-dashed border-line bg-paperSoft p-3 text-rotulo leading-4 text-inkSoft">
                {errorBusqueda
                  ? "No pudimos buscar ahora mismo: el servidor de Vigía no respondió. Inténtalo otra vez en un momento."
                  : "No encontramos una entidad con ese nombre. Prueba con otra palabra del nombre oficial o con su RUC de 11 dígitos."}
              </p>
            )}
          </div>
        </div>
      )}
      {errores.entidad && <ErrorCampo>{errores.entidad}</ErrorCampo>}
      {!ent && (
        <ul className="mt-auto space-y-1 rounded-xl bg-paperSoft px-3 py-3 text-rotulo leading-4 text-inkSoft">
          <li className="flex items-start gap-1.5">
            <Check size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden /> Busca por el nombre oficial o por el RUC de 11 dígitos.
          </li>
          <li className="flex items-start gap-1.5">
            <Check size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden /> Son municipalidades, gobiernos regionales, hospitales y demás entidades del Estado.
          </li>
          <li className="flex items-start gap-1.5">
            <Check size={12} className="mt-0.5 shrink-0 text-moss" aria-hidden /> Tu denuncia queda en reserva: no se publica.
          </li>
        </ul>
      )}
    </>
  );

  const columnaQuePasa = (
    <>
      <div>
        <span className={etiqueta}>Qué patrón estás denunciando</span>
        <OpcionesCategoria
          opciones={CATEGORIAS_ENTIDAD}
          elegida={categoria}
          onElegir={(id) => {
            setCategoria(id);
            setErrores((x) => ({ ...x, categoria: undefined }));
          }}
          etiqueta="Patrón que denuncias"
          compacta
        />
        {errores.categoria && <ErrorCampo>{errores.categoria}</ErrorCampo>}
      </div>
      <div className="flex flex-1 flex-col">
        <label htmlFor="entidad-descripcion" className={etiqueta}>
          Describe lo que viste
        </label>
        <textarea
          id="entidad-descripcion"
          value={descripcion}
          onChange={(e) => {
            setDescripcion(e.target.value);
            if (e.target.value.trim().length >= DESCRIPCION_MIN) setErrores((x) => ({ ...x, descripcion: undefined }));
          }}
          rows={6}
          maxLength={DESCRIPCION_MAX}
          aria-invalid={!!errores.descripcion}
          aria-describedby="entidad-descripcion-ayuda"
          placeholder="Ej: La municipalidad lleva 4 años contratando siempre al mismo proveedor para mantenimiento. El gerente de logística es pariente del dueño de la empresa."
          className={cn(campo, "min-h-[140px] flex-1 py-3 leading-relaxed")}
        />
        <p id="entidad-descripcion-ayuda" className="mt-1 flex justify-between gap-2 text-micro text-mute">
          <span>Cargos, fechas, números de contrato y enlaces hacen que tu denuncia se pueda comprobar.</span>
          <span className="shrink-0 font-mono tabular-nums">
            {numero(descripcion.length)} / {numero(DESCRIPCION_MAX)}
          </span>
        </p>
        {errores.descripcion && <ErrorCampo>{errores.descripcion}</ErrorCampo>}
      </div>
    </>
  );

  const columnaPruebas = (
    <>
      <div>
        <span className={etiqueta}>Evidencia (opcional)</span>
        <label className="flex min-h-[96px] cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed border-line bg-paperSoft px-4 py-4 text-center transition-colors duration-rapido focus-within:border-granate hover:border-granate/40">
          <Upload size={18} className="shrink-0 text-mute" aria-hidden />
          <span className="text-dato leading-5">
            {evidencia ? (
              <span className="break-all font-medium text-ink">
                {evidencia.name} <Check size={14} className="ml-1 inline text-mossTexto" aria-hidden />
              </span>
            ) : (
              <>
                <span className="font-medium text-ink">Foto o documento PDF</span>
                <span className="block text-rotulo leading-4 text-mute">Opcional. JPG, PNG, WebP o PDF, hasta {MAX_MB} MB.</span>
              </>
            )}
          </span>
          <input
            type="file"
            accept={ACEPTA_ARCHIVO}
            className="sr-only"
            disabled={submitting}
            onChange={(e) => {
              elegirEvidencia(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
        {evidencia && (
          <button type="button" onClick={() => elegirEvidencia(null)} className="mt-1 inline-flex min-h-[44px] items-center gap-1 text-rotulo leading-4 text-inkSoft hover:text-ink hover:underline">
            <X size={12} aria-hidden /> Quitar el archivo
          </button>
        )}
        {errores.evidencia && <ErrorCampo>{errores.evidencia}</ErrorCampo>}
        <p className="mt-1 flex flex-wrap items-center gap-x-1 text-rotulo leading-4 text-mute">
          A las fotos les quitamos los datos ocultos antes de guardarlas.
          <Ayuda titulo="¿Qué datos ocultos les quitamos?">La ubicación GPS y el modelo del teléfono.</Ayuda>
        </p>
      </div>

      <details className="group rounded-xl border border-dashed border-line bg-paperSoft open:border-line open:bg-transparent" open={!!errores.correo || undefined}>
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-dato leading-5 font-semibold text-granate marker:hidden [&::-webkit-details-marker]:hidden">
          <ChevronDown size={16} className="transition-transform duration-normal group-open:rotate-180" aria-hidden />
          Contacto: tu correo, opcional
        </summary>
        <div className="space-y-2 px-3 pb-3 pt-1">
          <label htmlFor="entidad-correo" className={etiqueta}>
            Correo (opcional)
          </label>
          <input
            id="entidad-correo"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={contactoOpcional}
            onChange={(e) => {
              setContactoOpcional(e.target.value);
              setErrores((x) => ({ ...x, correo: undefined }));
            }}
            aria-invalid={!!errores.correo}
            placeholder="tu@correo.com"
            className={campo}
          />
          {errores.correo && <ErrorCampo>{errores.correo}</ErrorCampo>}
          <p className="text-rotulo text-mute">No hace falta cuenta ni nombre. Si dejas tu correo, queda guardado en reserva junto a la denuncia: no se publica.</p>
        </div>
      </details>

      <div className="mt-auto space-y-2 pt-1">
        <DisclaimerBanner />
        {verificacion.widget}
        {errorEnvio && <ErrorEnvio>{errorEnvio}</ErrorEnvio>}
        <Button type="submit" disabled={submitting} full variant="primary">
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin" aria-hidden /> {subiendo ? "Subiendo la evidencia…" : "Enviando…"}
            </>
          ) : (
            <>
              <Send size={16} aria-hidden /> Enviar la denuncia
            </>
          )}
        </Button>
        <p className="text-center text-rotulo leading-4 text-mute" aria-live="polite">
          {ready
            ? "Todo listo para enviar."
            : `Faltan ${milestones.length - doneCount} de ${milestones.length}: ${milestones
                .filter((m) => !m.done)
                .map((m) => m.label.toLowerCase())
                .join(", ")}.`}
        </p>
      </div>
    </>
  );

  const quePasaOk = !!categoria && relatoOk;
  const pasos: Paso[] = [
    {
      id: "entidad",
      titulo: "Entidad",
      icono: <Building2 size={14} />,
      completa: !!ent,
      bloqueado: false,
      motivo: "",
      resumen: ent?.nombre ?? "",
      children: columnaEntidad,
    },
    {
      id: "que-pasa",
      titulo: "Qué pasa",
      icono: <Pencil size={14} />,
      completa: quePasaOk,
      bloqueado: !ent,
      motivo: "Elige la entidad para seguir",
      resumen: `${numero(descripcion.trim().length)} caracteres`,
      children: columnaQuePasa,
    },
    {
      id: "pruebas",
      titulo: "Pruebas y envío",
      icono: <Paperclip size={14} />,
      completa: false,
      bloqueado: !ent || !quePasaOk,
      motivo: !ent ? "Elige la entidad para seguir" : !categoria ? "Elige el patrón para seguir" : "Cuenta lo que viste para seguir",
      resumen: evidencia ? evidencia.name : "Sin evidencia",
      children: columnaPruebas,
    },
  ];

  return (
    <form onSubmit={submit} noValidate className="space-y-3">
      <ProgressTracker milestones={milestones} />
      <PasosEnColumnas pasos={pasos} etiqueta="Pasos de la denuncia a una entidad" />
    </form>
  );
}
