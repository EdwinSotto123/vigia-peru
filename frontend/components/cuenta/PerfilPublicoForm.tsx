"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Eye, EyeOff, ImagePlus, Loader2, ShieldAlert, Upload } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { Ruc } from "@/components/Redact";
import { cn } from "@/lib/utils";
import { subirImagenPerfil, type Perfil } from "@/lib/cuentas";
import { MAX_DESCRIPCION, REDES, largoDescripcion } from "@/lib/perfilAliado";
import { ETIQUETA, SUBTITULO, campo, opcion } from "./estilos";
import { idCampo, motivoOculto, type BorradorPerfil, type CampoForm, type ErroresForm, type TipoAliado } from "./perfilPropio";

/**
 * "Tu perfil público" en /app/configuracion: TODO lo que quien aporta muestra de sí en el ranking
 * y en su página /aliado/<slug> (DESIGN_SYSTEM.md §14.6) lo define acá, no el equipo de Vigía
 * (el panel admin sólo modera). Controlado: el borrador y los errores viven en la página, que
 * guarda todo junto con el correo y los avisos.
 *
 * `completo` = la API ya acepta el perfil entero (contrato A6). Si todavía no, sólo se ofrecen
 * nombre, tipo, logo y visibilidad: no se muestra un campo que no se guardaría.
 */

const TIPOS: { valor: TipoAliado; texto: string }[] = [
  { valor: "persona", texto: "Persona" },
  { valor: "empresa", texto: "Empresa" },
  { valor: "organizacion", texto: "Organización" },
];

export function PerfilPublicoForm({
  perfil,
  valor,
  onCambiar,
  errores,
  completo,
}: {
  /** Lo guardado: RUC ya registrado y estado de moderación. */
  perfil: Perfil;
  valor: BorradorPerfil;
  onCambiar: (cambio: Partial<BorradorPerfil>) => void;
  errores: ErroresForm;
  completo: boolean;
}) {
  const [subiendo, setSubiendo] = useState<"logo" | "portada" | null>(null);
  const [errorSubida, setErrorSubida] = useState<{ logo?: string; portada?: string }>({});
  const logoInput = useRef<HTMLInputElement>(null);
  const portadaInput = useRef<HTMLInputElement>(null);
  const oculto = motivoOculto(perfil);
  const largo = largoDescripcion(valor.descripcion);

  const subir = async (cual: "logo" | "portada", f: File | null) => {
    if (!f) return;
    setSubiendo(cual);
    setErrorSubida((e) => ({ ...e, [cual]: undefined }));
    try {
      const url = await subirImagenPerfil(f);
      onCambiar(cual === "logo" ? { logoUrl: url } : { portadaUrl: url });
    } catch (err) {
      setErrorSubida((e) => ({ ...e, [cual]: (err as Error).message }));
    } finally {
      setSubiendo(null);
    }
  };

  const errorLogo = errores.logoUrl ?? errorSubida.logo;
  const errorPortada = errores.portadaUrl ?? errorSubida.portada;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex gap-2" role="radiogroup" aria-label="Visibilidad">
          <button type="button" role="radio" aria-checked={!valor.visible} onClick={() => onCambiar({ visible: false })} className={cn(opcion(!valor.visible), "flex-1")}>
            <EyeOff size={14} aria-hidden /> Anónimo
          </button>
          <button type="button" role="radio" aria-checked={valor.visible} onClick={() => onCambiar({ visible: true })} className={cn(opcion(valor.visible), "flex-1")}>
            <Eye size={14} aria-hidden /> Visible en público
          </button>
        </div>
        {oculto && (
          <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-amber-soft px-3 py-2 text-[13px] text-ink" role="status">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amberTexto" aria-hidden />
            <span>
              {oculto} Tus aportes financian contratos igual. Mientras siga oculto, elegir “Visible” no lo muestra.
            </span>
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <div className="space-y-4">
          <Campo campo="nombre" etiqueta={`Nombre público ${valor.visible ? "(obligatorio para aparecer)" : "(opcional)"}`} error={errores.nombre}>
            {(props) => <input {...props} value={valor.nombre} onChange={(e) => onCambiar({ nombre: e.target.value })} maxLength={80} autoComplete="organization" placeholder="Ej. María Q., o Empresa X S.A.C." />}
          </Campo>
          <div>
            <span id="cuenta-tipo-etiqueta" className={ETIQUETA}>Tipo</span>
            <div className="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-labelledby="cuenta-tipo-etiqueta">
              {TIPOS.map((t) => (
                <button type="button" key={t.valor} role="radio" aria-checked={valor.tipo === t.valor} onClick={() => onCambiar({ tipo: t.valor })} className={opcion(valor.tipo === t.valor)}>
                  {t.texto}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="sm:text-center">
          <span className={ETIQUETA}>Logo</span>
          <button
            type="button"
            id={idCampo("logoUrl")}
            onClick={() => logoInput.current?.click()}
            disabled={subiendo === "logo"}
            aria-label={valor.logoUrl ? "Cambiar logo" : "Subir logo"}
            aria-invalid={errorLogo ? true : undefined}
            aria-describedby={errorLogo ? `${idCampo("logoUrl")}-error` : undefined}
            className="relative mt-1 flex h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-line bg-paperSoft transition-colors hover:border-granate/50 disabled:cursor-wait sm:mx-auto"
          >
            {valor.logoUrl ? (
              <Image src={valor.logoUrl} alt="Tu logo" width={80} height={80} className="h-full w-full object-contain" unoptimized />
            ) : (
              <Upload size={18} className="text-mute" aria-hidden />
            )}
            {subiendo === "logo" && (
              <span className="absolute inset-0 flex items-center justify-center bg-paper/80">
                <Loader2 size={16} className="animate-spin text-granate" aria-hidden />
              </span>
            )}
          </button>
          <input ref={logoInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void subir("logo", e.target.files?.[0] ?? null); e.target.value = ""; }} />
          <div className="mt-1 flex gap-2 text-[11px] sm:justify-center">
            <button type="button" onClick={() => logoInput.current?.click()} disabled={subiendo === "logo"} className="inline-flex items-center gap-1 text-ink underline transition-colors hover:text-granate disabled:opacity-60">
              {valor.logoUrl ? "Cambiar" : "Subir"}
            </button>
            {valor.logoUrl && <button type="button" onClick={() => onCambiar({ logoUrl: null })} className="text-mute underline transition-colors hover:text-ink">Quitar</button>}
          </div>
          {errorLogo && <p id={`${idCampo("logoUrl")}-error`} className="mt-1 max-w-[12rem] text-[12px] text-crimsonTexto">{errorLogo}</p>}
        </div>
      </div>

      {completo && (
        <>
          <Campo
            campo="descripcion"
            etiqueta="Descripción (opcional)"
            error={errores.descripcion}
            pista={<span className={cn("tabular-nums", largo > MAX_DESCRIPCION && "font-semibold text-crimsonTexto")}>{largo} de {MAX_DESCRIPCION} caracteres</span>}
          >
            {(props) => <textarea {...props} rows={3} value={valor.descripcion} onChange={(e) => onCambiar({ descripcion: e.target.value })} placeholder="Quién eres y por qué apoyas la transparencia, en una o dos frases" />}
          </Campo>

          <div className="grid gap-4 sm:grid-cols-2">
            <Campo campo="sitioWeb" etiqueta="Web (opcional)" error={errores.sitioWeb}>
              {(props) => <input {...props} value={valor.sitioWeb} onChange={(e) => onCambiar({ sitioWeb: e.target.value })} inputMode="url" autoComplete="url" autoCapitalize="none" spellCheck={false} placeholder="https://empresa.pe" />}
            </Campo>
            <Campo campo="emailPublico" etiqueta="Correo de contacto público (opcional)" error={errores.emailPublico} pista="Es el único correo que se muestra en tu página. El de tu cuenta sigue privado.">
              {(props) => <input {...props} type="email" value={valor.emailPublico} onChange={(e) => onCambiar({ emailPublico: e.target.value })} inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="contacto@empresa.pe" />}
            </Campo>
          </div>

          <fieldset aria-describedby={errores.redes ? `${idCampo("redes")}-error` : undefined}>
            <legend className={SUBTITULO}>Redes (opcional): pega el enlace a tu página en cada una</legend>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {REDES.map((r) => (
                <Campo key={r.red} campo={r.red} etiqueta={r.nombre} error={errores[r.red]}>
                  {(props) => (
                    <input
                      {...props}
                      value={valor.redes[r.red] ?? ""}
                      onChange={(e) => onCambiar({ redes: { ...valor.redes, [r.red]: e.target.value } })}
                      inputMode="url"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={r.ejemplo}
                    />
                  )}
                </Campo>
              ))}
            </div>
            {errores.redes && <p id={`${idCampo("redes")}-error`} className="mt-2 text-[13px] text-crimsonTexto">{errores.redes}</p>}
          </fieldset>

          <div>
            <span className={ETIQUETA}>Imagen de portada (opcional)</span>
            <div className="mt-1 overflow-hidden rounded-xl border border-line bg-paperSoft">
              {valor.portadaUrl ? (
                <div className="relative h-24 w-full sm:h-28">
                  <Image src={valor.portadaUrl} alt="Tu imagen de portada" fill unoptimized className="object-cover" />
                </div>
              ) : (
                <p className="flex h-24 items-center justify-center px-4 text-center text-[13px] text-mute sm:h-28">Sin portada, tu página usa la franja textil de Vigía.</p>
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
              <button
                type="button"
                id={idCampo("portadaUrl")}
                onClick={() => portadaInput.current?.click()}
                disabled={subiendo === "portada"}
                aria-invalid={errorPortada ? true : undefined}
                aria-describedby={[`${idCampo("portadaUrl")}-pista`, errorPortada && `${idCampo("portadaUrl")}-error`].filter(Boolean).join(" ")}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full border border-line bg-paper px-4 py-2 font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50 disabled:cursor-wait disabled:opacity-60"
              >
                {subiendo === "portada" ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <ImagePlus size={14} aria-hidden />}
                {valor.portadaUrl ? "Cambiar portada" : "Subir portada"}
              </button>
              {valor.portadaUrl && <button type="button" onClick={() => onCambiar({ portadaUrl: "" })} className="text-mute underline transition-colors hover:text-ink">Quitar</button>}
            </div>
            <input ref={portadaInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" tabIndex={-1} aria-hidden onChange={(e) => { void subir("portada", e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <p id={`${idCampo("portadaUrl")}-pista`} className="mt-1 text-xs text-mute">JPG, PNG o WebP horizontal, de unos 1500 × 500 px y hasta 12 MB.</p>
            {errorPortada && <p id={`${idCampo("portadaUrl")}-error`} className="mt-1 text-[13px] text-crimsonTexto">{errorPortada}</p>}
          </div>

          <CampoRuc perfil={perfil} valor={valor} onCambiar={onCambiar} errores={errores} />
        </>
      )}
    </div>
  );
}

/**
 * El RUC no se publica nunca: sirve para el chequeo de conflicto de interés. Se registra una
 * sola vez (el API responde 409 si ya hay uno), así que se pide confirmarlo antes de guardar.
 */
function CampoRuc({ perfil, valor, onCambiar, errores }: { perfil: Perfil; valor: BorradorPerfil; onCambiar: (c: Partial<BorradorPerfil>) => void; errores: ErroresForm }) {
  const persona = valor.tipo === "persona";
  const ayuda = (
    <Ayuda titulo="¿Para qué es el RUC?">
      Con él revisamos el conflicto de interés: si tiene una sanción vigente del OECE o figura como proveedor en contratos con
      señales activas, tu perfil no se muestra en público. Tus aportes financian contratos igual.
    </Ayuda>
  );
  if (perfil.ruc) {
    return (
      <div className="rounded-xl bg-paperSoft px-3 py-2.5 text-sm">
        <span className="flex items-center gap-1 font-semibold text-inkSoft">RUC registrado {ayuda}</span>
        <span className="font-mono text-ink"><Ruc value={perfil.ruc} /></span>
        <span className="block text-xs text-mute">No se muestra en público y no se puede cambiar.</span>
        {errores.ruc && <p className="mt-1 text-[13px] text-crimsonTexto" role="alert">{errores.ruc}</p>}
      </div>
    );
  }
  const pista = persona
    ? "Si tu RUC empieza con 10, lleva tu DNI adentro: por eso nunca se muestra en público. Una vez guardado, no se puede cambiar."
    : "No se muestra en público. Una vez guardado, no se puede cambiar.";
  return (
    <div>
      <Campo
        campo="ruc"
        etiqueta={persona ? "RUC (opcional)" : valor.tipo === "empresa" ? "RUC de la empresa (opcional)" : "RUC de la organización (opcional)"}
        extraEtiqueta={ayuda}
        error={errores.ruc}
        pista={pista}
      >
        {(props) => (
          <input
            {...props}
            value={valor.ruc}
            onChange={(e) => onCambiar({ ruc: e.target.value.replace(/\D/g, "").slice(0, 11), rucConfirmado: false })}
            inputMode="numeric"
            autoComplete="off"
            placeholder={persona ? "10XXXXXXXXX" : "20XXXXXXXXX"}
            className={cn(props.className, "font-mono sm:max-w-[16rem]")}
          />
        )}
      </Campo>
      {valor.ruc && (
        <label className="mt-2 flex cursor-pointer items-start gap-2.5 text-[13px] text-ink">
          <input
            type="checkbox"
            id={idCampo("rucConfirmado")}
            checked={valor.rucConfirmado}
            onChange={(e) => onCambiar({ rucConfirmado: e.target.checked })}
            aria-invalid={errores.rucConfirmado ? true : undefined}
            aria-describedby={errores.rucConfirmado ? `${idCampo("rucConfirmado")}-error` : undefined}
            className="mt-0.5 h-4 w-4 rounded border-line accent-granate"
          />
          <span>
            El RUC <span className="font-mono">{valor.ruc}</span> es correcto. Sé que después no se puede cambiar.
          </span>
        </label>
      )}
      {errores.rucConfirmado && <p id={`${idCampo("rucConfirmado")}-error`} className="mt-1 text-[13px] text-crimsonTexto">{errores.rucConfirmado}</p>}
    </div>
  );
}

/**
 * Un campo con su etiqueta visible, su pista y su error enlazados al control (aria-describedby,
 * aria-invalid). El control lo pone quien llama, con las props que le pasa esta pieza.
 */
function Campo({
  campo: nombre,
  etiqueta,
  extraEtiqueta,
  pista,
  error,
  children,
}: {
  campo: CampoForm;
  etiqueta: string;
  extraEtiqueta?: React.ReactNode;
  pista?: React.ReactNode;
  error?: string;
  children: (props: { id: string; className: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const id = idCampo(nombre);
  const describe = [pista ? `${id}-pista` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return (
    <div className="text-sm">
      <span className="flex items-center gap-1">
        <label htmlFor={id} className={ETIQUETA}>{etiqueta}</label>
        {extraEtiqueta}
      </span>
      {children({ id, className: campo(error), "aria-invalid": error ? true : undefined, "aria-describedby": describe || undefined })}
      {pista && <p id={`${id}-pista`} className="mt-1 text-xs text-mute">{pista}</p>}
      {error && <p id={`${id}-error`} className="mt-1 text-[13px] text-crimsonTexto">{error}</p>}
    </div>
  );
}
