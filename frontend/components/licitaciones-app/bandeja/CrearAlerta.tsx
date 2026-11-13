"use client";

import { useState } from "react";
import { BellPlus, Loader2 } from "lucide-react";
import { nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { ErrorCuenta, crearAlerta } from "@/lib/gobserva-cuenta";
import { useMe } from "@/components/gobserva/cuenta/comun";
import { aParams, filtrosActivos, type FiltrosBandeja } from "@/lib/licitaciones-app/filtros";
import { useLista } from "@/lib/licitaciones-app/useListaUrl";
import { cn } from "@/lib/utils";
import { Desplegable } from "@/components/gobserva/ui/Desplegable";
import { useAvisos } from "@/components/gobserva/ui/Avisos";

/** Un nombre que diga qué busca la alerta: «Bienes con «tóner» en Lima», «Servicios y obras en Cusco y Puno». */
export function nombreSugerido(f: FiltrosBandeja): string {
  const y = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}` : xs[0] ?? "");
  const tipos = y(f.tipo.map(nombreTipo));
  const que = tipos ? tipos.charAt(0).toUpperCase() + tipos.slice(1).toLowerCase() : "Oportunidades";
  const texto = `${que}${f.q ? ` con «${f.q}»` : ""}${f.region.length ? ` en ${y(f.region.map(nombreRegion))}` : ""}`;
  return (texto === "Oportunidades" ? "Todo lo nuevo" : texto).slice(0, 80);
}

/**
 * «Crear alerta con esta búsqueda»: guarda los filtros que estás viendo (los de la bandeja, con su marca) como una alerta
 * de tu cuenta; lo nuevo te llega al correo y a tus notificaciones. Con el plan gratis, una alerta semanal.
 */
export function CrearAlerta() {
  const { filtros } = useLista();
  const { me } = useMe("licitaciones");
  const avisar = useAvisos();
  const diaria = !!me?.producto?.limites?.frecuencias.includes("diaria");
  return (
    <Desplegable etiqueta="Crear alerta" Icono={BellPlus} alinear="derecha" ancho="sm:w-96">
      {(cerrar) => <Formulario filtros={filtros} diaria={diaria} cerrar={cerrar} avisar={avisar} />}
    </Desplegable>
  );
}

function Formulario({ filtros, diaria, cerrar, avisar }: { filtros: FiltrosBandeja; diaria: boolean; cerrar: () => void; avisar: ReturnType<typeof useAvisos> }) {
  const [nombre, setNombre] = useState(() => nombreSugerido(filtros));
  const [frecuencia, setFrecuencia] = useState<"semanal" | "diaria">(diaria ? "diaria" : "semanal");
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function enviar() {
    if (nombre.trim().length < 2) return setError("Ponle un nombre a la alerta.");
    setEnviando(true);
    setError(null);
    try {
      const params = Object.fromEntries(aParams({ ...filtros, pag: 1 }));
      await crearAlerta({ producto: "licitaciones", nombre: nombre.trim(), filtros: { bandeja: 1, ...params }, frecuencia });
      cerrar();
      avisar({ tono: "ok", texto: `Alerta creada: lo nuevo de «${nombre.trim()}» te llega ${frecuencia === "diaria" ? "cada mañana" : "cada semana"}.`, accion: { etiqueta: "Ver mis alertas", href: "/cuenta?tab=alertas" } });
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos crear la alerta. Vuelve a intentarlo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void enviar();
      }}
    >
      <p className="text-meta leading-relaxed text-inkSoft">
        {filtrosActivos(filtros) > 0 ? "Te avisamos de lo nuevo que calce con los filtros que estás viendo." : "Sin filtros, te avisamos de todo lo nuevo. Filtra primero para que te llegue sólo lo tuyo."}
      </p>
      <label htmlFor="alerta-nombre" className="mb-1 mt-3 block text-meta font-semibold text-ink">
        Nombre
      </label>
      <input
        id="alerta-nombre"
        value={nombre}
        onChange={(e) => {
          setNombre(e.target.value);
          setError(null);
        }}
        maxLength={80}
        aria-invalid={!!error}
        className="h-10 w-full rounded-lg border border-line bg-caja px-3 text-destacado text-ink focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30 aria-[invalid=true]:border-crimson sm:text-dato"
      />
      <fieldset className="mt-3">
        <legend className="mb-1 text-meta font-semibold text-ink">Cada cuánto</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["semanal", "diaria"] as const).map((f) => {
            const bloqueada = f === "diaria" && !diaria;
            return (
              <label key={f} className={cn("flex min-h-10 items-center gap-2 rounded-lg border px-3 text-dato", bloqueada ? "cursor-not-allowed opacity-60" : "cursor-pointer", frecuencia === f ? "border-granate bg-granate-50 font-semibold text-ink" : "border-line text-inkSoft")}>
                <input type="radio" name="alerta-frec" disabled={bloqueada} checked={frecuencia === f} onChange={() => setFrecuencia(f)} className="h-4 w-4 accent-[rgb(var(--granate))]" />
                {f === "semanal" ? "Cada semana" : "Cada mañana"}
              </label>
            );
          })}
        </div>
        {!diaria && <p className="mt-1.5 text-meta text-mute">Cada mañana viene con un plan de pago.</p>}
      </fieldset>
      {error && (
        <p role="alert" className="mt-3 text-meta font-medium text-crimsonTexto">
          {error}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={cerrar} className="min-h-10 rounded-lg px-3 text-dato font-semibold text-inkSoft hover:bg-ink/[0.06]">
          Cancelar
        </button>
        <button type="submit" disabled={enviando} className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-granate px-4 text-dato font-semibold text-paper hover:bg-granate-deep disabled:opacity-70">
          {enviando && <Loader2 size={15} aria-hidden className="animate-spin" />} Crear la alerta
        </button>
      </div>
    </form>
  );
}
