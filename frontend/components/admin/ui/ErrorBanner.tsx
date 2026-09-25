import { AlertTriangle, CheckCircle2, Info, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONO, type Tone } from "./tono";
import { Expandable } from "./Expandable";
import { claseBoton } from "./boton";

/**
 * Aviso con tono: ícono, una línea en negrita, texto corto y acciones. Es la
 * base de ErrorBanner y sirve para "guardado", "cuesta ≈ S/ 1", etc. El texto
 * va en ink/inkSoft: sobre los fondos suaves, mute no llega a AA.
 *
 * Por defecto un aviso de peligro es role="alert" (se anuncia al aparecer). Uno que vive en una
 * página que se sondea sola pasa `rol="note"`: si no, se vuelve a anunciar con cada refresco.
 */
export function Aviso({
  tono = "warn",
  rol,
  titulo,
  icono,
  acciones,
  className,
  children,
}: {
  tono?: Tone;
  rol?: "alert" | "status" | "note";
  titulo?: React.ReactNode;
  icono?: React.ReactNode;
  acciones?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const Icono = tono === "ok" ? CheckCircle2 : tono === "danger" || tono === "warn" ? AlertTriangle : Info;
  return (
    <div role={rol ?? (tono === "danger" ? "alert" : tono === "ok" ? "status" : "note")} className={cn("flex flex-wrap items-start gap-3 rounded-2xl border px-4 py-3", TONO[tono].caja, className)}>
      <span className={cn("mt-0.5 shrink-0", TONO[tono].texto)} aria-hidden>
        {icono ?? <Icono size={16} />}
      </span>
      <div className="min-w-0 flex-1 text-[13px] leading-relaxed text-inkSoft">
        {titulo && <p className="font-semibold text-ink">{titulo}</p>}
        {children}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}

/** Lo que el admin necesita saber de un error, sin códigos: qué pasó, qué hacer, y el detalle técnico aparte. */
export function explicarError(e: unknown): { titulo: string; detalle: string; tecnico: string | null } {
  const status = typeof e === "object" && e && "status" in e && typeof (e as { status: unknown }).status === "number" ? (e as { status: number }).status : null;
  const crudo = e instanceof Error ? e.message : typeof e === "string" ? e : null;
  const tecnico = status ? `HTTP ${status}${crudo && crudo !== `HTTP ${status}` ? `: ${crudo}` : ""}` : crudo;
  if (status === 401) return { titulo: "Tu sesión expiró", detalle: "Vuelve a entrar al panel para seguir.", tecnico };
  if (status === 403) return { titulo: "Tu cuenta no tiene permiso para esto", detalle: "Pide acceso a quien administra el panel.", tecnico };
  if (status === 404) return { titulo: "No se encontró lo que buscabas", detalle: "Puede que ya no exista o que otra persona lo haya cambiado.", tecnico };
  if (status === 409) return { titulo: "Alguien ya cambió esto", detalle: "Actualiza la página y vuelve a intentarlo.", tecnico };
  if (status === 429) return { titulo: "Demasiados pedidos seguidos", detalle: "Espera un momento y vuelve a intentarlo.", tecnico };
  if (status === 400 || status === 422) return { titulo: "Los datos no se aceptaron", detalle: "Revisa lo que ingresaste e inténtalo de nuevo.", tecnico };
  if (status && status >= 500) return { titulo: "El servidor no pudo completar el pedido", detalle: "Suele ser momentáneo: vuelve a intentarlo en un minuto.", tecnico };
  if (!status && (e instanceof TypeError || /fetch|network/i.test(crudo ?? ""))) return { titulo: "No hay conexión con el servidor", detalle: "Revisa tu conexión e inténtalo de nuevo.", tecnico };
  return { titulo: "Algo no salió bien", detalle: crudo && crudo.length < 140 ? crudo : "Vuelve a intentarlo en un momento.", tecnico };
}

/** Una línea para un toast o un diálogo, donde no cabe el detalle plegado. */
export function mensajeError(e: unknown): string {
  const x = explicarError(e);
  return `${x.titulo}. ${x.detalle}`;
}

/** Error de carga o de acción en palabras llanas; el código y el mensaje crudo quedan plegados para depurar. */
export function ErrorBanner({ error, titulo, onReintentar, className }: { error: unknown; titulo?: string; onReintentar?: () => void; className?: string }) {
  if (!error) return null;
  const x = explicarError(error);
  return (
    <Aviso
      tono="danger"
      titulo={titulo ?? x.titulo}
      className={className}
      acciones={
        onReintentar && (
          <button type="button" onClick={onReintentar} className={claseBoton("secundario", "sm")}>
            <RefreshCw size={12} aria-hidden /> Reintentar
          </button>
        )
      }
    >
      <p>{titulo ? `${x.titulo}. ${x.detalle}` : x.detalle}</p>
      {x.tecnico && (
        <Expandable variante="linea" resumen="Detalle técnico" className="mt-1">
          <code className="block whitespace-pre-wrap break-words rounded-lg bg-paper/80 px-2 py-1.5 font-mono text-[11px] text-ink">{x.tecnico}</code>
        </Expandable>
      )}
    </Aviso>
  );
}
