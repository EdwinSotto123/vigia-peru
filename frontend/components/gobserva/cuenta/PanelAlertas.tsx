"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Bell, BellOff, Eye, Loader2, Mail, Pencil, Plus, Send, Trash2 } from "lucide-react";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { rutaEn, type Producto } from "@/lib/gobserva";
import {
  ErrorCuenta, borrarAlerta, cambiarAlerta, cargarAlertas, cargarBandeja, crearAlerta, enviarAlertaAhora, probarAlerta,
  type Alerta, type Frecuencia, type ItemAviso, type Me,
} from "@/lib/gobserva-cuenta";
import { cn } from "@/lib/utils";
import { Aviso, CAMPO, COSAS, ETIQUETA, FILTROS, chipsFiltros, nombreSugerido } from "./comun";

export function PanelAlertas({ producto, base, me, onCambio }: { producto: Producto; base: string; me: Me; onCambio: () => void }) {
  const { data, mutate, isLoading } = useSWR(["gobserva-alertas", producto], () => cargarAlertas(producto));
  const bandeja = useSWR(["gobserva-bandeja", producto], () => cargarBandeja(producto));
  const [nueva, setNueva] = useState(false);
  const [editando, setEditando] = useState<number | null>(null);
  const lim = me.producto?.limites;
  const alertas = data?.data ?? [];
  const lleno = !!lim && alertas.length >= lim.alertas;
  const refrescar = () => {
    void mutate();
    void bandeja.mutate();
    onCambio();
  };

  if (me.producto && !me.producto.alertas) {
    return <Aviso>Las alertas de este producto llegan pronto. Mientras tanto, guarda lo que te interesa y te avisamos antes de que cierre.</Aviso>;
  }

  return (
    <div className="space-y-6">
      <section aria-labelledby="alertas-t" className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="alertas-t" className="font-display text-seccion font-bold leading-tight text-ink">Tus alertas</h2>
            <p className="mt-1 flex items-start gap-2 text-dato leading-relaxed text-inkSoft">
              <Mail size={16} aria-hidden className="mt-0.5 shrink-0 text-granate" />
              {me.correoActivo
                ? me.cuenta.emailVerificado
                  ? `Te escribimos a ${me.cuenta.email} con lo nuevo, a las 7:00 de la mañana.`
                  : "Verifica tu correo para recibirlas por correo. Mientras tanto quedan en tu bandeja, aquí abajo."
                : "Lo nuevo de cada alerta queda en tu bandeja, aquí abajo. Muy pronto también llega a tu correo."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => { setNueva(true); setEditando(null); }}
            disabled={lleno}
            className={claseAccion("primario")}
          >
            <Plus size={16} aria-hidden /> Nueva alerta
          </button>
        </div>
        {lim && (
          <p className="mt-3 text-meta text-mute">
            Usas {alertas.length} de {lim.alertas} {lim.alertas === 1 ? "alerta" : "alertas"}.
            {lleno && (
              <>
                {" "}
                <Link href={rutaEn(base, "/planes")} className="font-semibold text-granate hover:underline">Con un plan de pago tienes más.</Link>
              </>
            )}
          </p>
        )}

        {nueva && (
          <FormAlerta
            producto={producto}
            base={base}
            diariaPermitida={!!lim?.frecuencias.includes("diaria")}
            onListo={() => { setNueva(false); refrescar(); }}
            onCancelar={() => setNueva(false)}
          />
        )}

        {isLoading ? (
          <div aria-hidden className="mt-5 h-24 animate-pulse rounded-2xl bg-paperDeep" />
        ) : alertas.length === 0 && !nueva ? (
          <div className="mt-5 rounded-2xl border border-dashed border-line p-6 text-center">
            <Bell size={28} aria-hidden className="mx-auto text-mute" />
            <p className="mt-2 text-dato text-inkSoft">
              Todavía no tienes alertas. Crea una aquí o desde la lista de {COSAS[producto].varias} con «Crear alerta con esta búsqueda».
            </p>
          </div>
        ) : (
          <ul className="mt-5 space-y-3">
            {alertas.map((a) =>
              editando === a.id ? (
                <li key={a.id}>
                  <FormAlerta
                    producto={producto}
                    base={base}
                    alerta={a}
                    diariaPermitida={!!lim?.frecuencias.includes("diaria")}
                    onListo={() => { setEditando(null); refrescar(); }}
                    onCancelar={() => setEditando(null)}
                  />
                </li>
              ) : (
                <FilaAlerta key={a.id} a={a} producto={producto} base={base} onEditar={() => { setEditando(a.id); setNueva(false); }} onCambio={refrescar} />
              ),
            )}
          </ul>
        )}
      </section>

      <section aria-labelledby="bandeja2-t" className="rounded-3xl border border-line bg-paper p-5 sm:p-6">
        <h2 id="bandeja2-t" className="font-display text-bloque font-bold text-ink">Bandeja</h2>
        <p className="mt-1 text-dato text-inkSoft">Lo que te avisamos, con sus enlaces. Se guardan los últimos 30 avisos.</p>
        {!bandeja.data ? (
          <div aria-hidden className="mt-4 h-20 animate-pulse rounded-2xl bg-paperDeep" />
        ) : bandeja.data.data.length === 0 ? (
          <p className="mt-4 text-dato text-mute">Sin avisos todavía.</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {bandeja.data.data.map((e) => (
              <li key={e.id} className="rounded-2xl border border-line">
                <details className="group">
                  <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 py-3">
                    <span className="min-w-0">
                      <span className="block text-dato font-semibold text-ink">{e.asunto}</span>
                      <span className="block text-meta text-mute">
                        {e.creado}
                        {" | "}
                        {e.estado === "enviado" ? "Enviado a tu correo" : e.estado === "en_la_web" ? "En tu cuenta" : "No se pudo enviar al correo"}
                      </span>
                    </span>
                    <span className="text-meta font-semibold text-granate group-open:hidden">Ver</span>
                    <span className="hidden text-meta font-semibold text-granate group-open:inline">Ocultar</span>
                  </summary>
                  {e.items.length > 0 && <ListaItems items={e.items} className="border-t border-line px-4 py-2" />}
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function ListaItems({ items, className }: { items: ItemAviso[]; className?: string }) {
  return (
    <ul className={cn("divide-y divide-line", className)}>
      {items.map((i) => (
        <li key={i.ref} className="py-2.5">
          {i.marca && <span className="mb-1 inline-block rounded-full bg-amber-soft px-2 py-0.5 text-rotulo font-semibold text-amberTexto">{i.marca}</span>}
          <a href={i.enlace} className="block text-dato font-semibold text-ink hover:text-granate hover:underline">{i.titulo}</a>
          <p className="text-meta text-inkSoft">{i.datos.join(" | ")}</p>
        </li>
      ))}
    </ul>
  );
}

function FilaAlerta({ a, producto, base, onEditar, onCambio }: { a: Alerta; producto: Producto; base: string; onEditar: () => void; onCambio: () => void }) {
  const [ocupado, setOcupado] = useState<"" | "activa" | "enviar" | "borrar">("");
  const [nota, setNota] = useState<{ tono: "ok" | "error"; texto: string } | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const chips = chipsFiltros(producto, a.filtros);
  const qs = new URLSearchParams(Object.entries(a.filtros).map(([k, v]) => [k, String(v)])).toString();

  async function hacer(que: "activa" | "enviar" | "borrar") {
    setNota(null);
    setOcupado(que);
    try {
      if (que === "activa") await cambiarAlerta(a.id, { activa: !a.activa });
      if (que === "borrar") await borrarAlerta(a.id);
      if (que === "enviar") {
        const r = await enviarAlertaAhora(a.id);
        setNota({ tono: "ok", texto: r.conNovedades ? (r.correos ? "Listo: te lo enviamos al correo y quedó en tu bandeja." : "Listo: quedó en tu bandeja.") : "No hay nada nuevo desde el último aviso." });
      }
      onCambio();
    } catch (e) {
      setNota({ tono: "error", texto: e instanceof ErrorCuenta ? e.message : "No pudimos hacerlo ahora." });
    } finally {
      setOcupado("");
      setConfirmar(false);
    }
  }

  return (
    <li className={cn("rounded-2xl border p-4", a.activa ? "border-line" : "border-dashed border-line bg-paperSoft")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-destacado font-bold text-ink">
            {a.nombre}
            <span className={cn("rounded-full px-2 py-0.5 text-rotulo font-semibold", a.frecuencia === "diaria" ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft")}>
              {a.frecuencia === "diaria" ? "Cada mañana" : "Cada semana"}
            </span>
            {!a.activa && <span className="rounded-full bg-paperDeep px-2 py-0.5 text-rotulo font-semibold text-mute">Pausada</span>}
          </p>
          {chips.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {chips.map((c) => <li key={c} className="rounded-full bg-paperDeep px-2.5 py-0.5 text-meta text-inkSoft">{c}</li>)}
            </ul>
          )}
          <p className="mt-2 text-meta text-mute">
            {a.ultimoEnvio ? `Último aviso: ${a.ultimoEnvio}${a.ultimoConteo != null ? `, con ${a.ultimoConteo} ${a.ultimoConteo === 1 ? COSAS[producto].una : COSAS[producto].varias}` : ""}.` : "Todavía no avisó: el primer aviso sale en la próxima vuelta."}
          </p>
        </div>
        <Link href={rutaEn(base, `${COSAS[producto].lista}${qs ? `?${qs}` : ""}`)} className="shrink-0 text-dato font-semibold text-granate hover:underline">
          Ver la búsqueda
        </Link>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void hacer("activa")} disabled={!!ocupado} className={claseAccion("secundario")}>
          {ocupado === "activa" ? <Loader2 size={15} aria-hidden className="animate-spin" /> : a.activa ? <BellOff size={15} aria-hidden /> : <Bell size={15} aria-hidden />}
          {a.activa ? "Pausar" : "Reanudar"}
        </button>
        <button type="button" onClick={onEditar} disabled={!!ocupado} className={claseAccion("fantasma")}>
          <Pencil size={15} aria-hidden /> Editar
        </button>
        {a.activa && (
          <button type="button" onClick={() => void hacer("enviar")} disabled={!!ocupado} className={claseAccion("fantasma")}>
            {ocupado === "enviar" ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <Send size={15} aria-hidden />} Enviar ahora
          </button>
        )}
        {confirmar ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-crimson-soft px-3 text-meta text-crimsonTexto">
            ¿Borrarla?
            <button type="button" onClick={() => void hacer("borrar")} className="font-bold underline">Sí, borrar</button>
            <button type="button" onClick={() => setConfirmar(false)} className="underline">No</button>
          </span>
        ) : (
          <button type="button" onClick={() => setConfirmar(true)} disabled={!!ocupado} className={claseAccion("fantasma", "text-crimsonTexto")}>
            <Trash2 size={15} aria-hidden /> Borrar
          </button>
        )}
      </div>
      {nota && <Aviso tono={nota.tono} className="mt-3">{nota.texto}</Aviso>}
    </li>
  );
}

/** Crear o editar una alerta: su nombre, sus filtros (los de la lista del producto) y la frecuencia, con vista previa. */
export function FormAlerta({
  producto, base, alerta, inicial, diariaPermitida, onListo, onCancelar,
}: {
  producto: Producto;
  base: string;
  alerta?: Alerta;
  inicial?: Record<string, string>;
  diariaPermitida: boolean;
  onListo: () => void;
  onCancelar: () => void;
}) {
  const campos = FILTROS[producto];
  const [filtros, setFiltros] = useState<Record<string, string>>(
    () => Object.fromEntries(Object.entries(alerta?.filtros ?? inicial ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [nombre, setNombre] = useState(alerta?.nombre ?? nombreSugerido(producto, inicial ?? {}));
  const [frecuencia, setFrecuencia] = useState<Frecuencia>(alerta?.frecuencia ?? (diariaPermitida ? "diaria" : "semanal"));
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previa, setPrevia] = useState<{ total: number; items: ItemAviso[] } | null>(null);
  const [mirando, setMirando] = useState(false);

  const limpios = () => Object.fromEntries(Object.entries(filtros).filter(([, v]) => v.trim() !== "").map(([k, v]) => [k, v.trim()]));

  async function verPrevia() {
    setMirando(true);
    setError(null);
    try {
      setPrevia(await probarAlerta(producto, limpios()));
    } catch (e) {
      setError(e instanceof ErrorCuenta ? e.message : "No pudimos probar la búsqueda.");
    } finally {
      setMirando(false);
    }
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) return setError("Ponle un nombre a la alerta.");
    setEnviando(true);
    try {
      if (alerta) await cambiarAlerta(alerta.id, { nombre: nombre.trim(), filtros: limpios(), frecuencia });
      else await crearAlerta({ producto, nombre: nombre.trim(), filtros: limpios(), frecuencia });
      onListo();
    } catch (err) {
      setError(err instanceof ErrorCuenta ? err.message : "No pudimos guardar la alerta.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <form onSubmit={guardar} className="mt-5 rounded-2xl border border-granate/40 bg-granate-50/40 p-4 sm:p-5" noValidate>
      <p className="font-display text-bloque font-bold text-ink">{alerta ? "Editar la alerta" : "Nueva alerta"}</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={`al-nombre-${alerta?.id ?? "n"}`} className={ETIQUETA}>Nombre</label>
          <input id={`al-nombre-${alerta?.id ?? "n"}`} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} className={CAMPO} placeholder="Para reconocerla en tu correo" />
        </div>
        {campos.map((c) => (
          <div key={c.clave}>
            <label htmlFor={`al-${c.clave}-${alerta?.id ?? "n"}`} className={ETIQUETA}>{c.etiqueta}</label>
            {c.tipo === "opcion" ? (
              <select
                id={`al-${c.clave}-${alerta?.id ?? "n"}`}
                value={filtros[c.clave] ?? ""}
                onChange={(e) => setFiltros((f) => ({ ...f, [c.clave]: e.target.value }))}
                className={CAMPO}
              >
                <option value="">Cualquiera</option>
                {c.opciones?.map((o) => <option key={o.valor} value={o.valor}>{o.etiqueta}</option>)}
              </select>
            ) : (
              <input
                id={`al-${c.clave}-${alerta?.id ?? "n"}`}
                type={c.tipo === "numero" ? "number" : "text"}
                inputMode={c.tipo === "numero" ? "numeric" : undefined}
                min={c.tipo === "numero" ? 0 : undefined}
                value={filtros[c.clave] ?? ""}
                onChange={(e) => setFiltros((f) => ({ ...f, [c.clave]: e.target.value }))}
                placeholder={c.placeholder}
                maxLength={c.tipo === "texto" ? 80 : undefined}
                className={CAMPO}
              />
            )}
          </div>
        ))}
      </div>

      <fieldset className="mt-4">
        <legend className={ETIQUETA}>Cada cuánto</legend>
        <div className="flex flex-wrap gap-2">
          {(["diaria", "semanal"] as const).map((f) => {
            const bloqueada = f === "diaria" && !diariaPermitida;
            return (
              <label
                key={f}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-full border px-4 py-2 text-dato",
                  frecuencia === f ? "border-granate bg-paper font-semibold text-ink" : "border-line text-inkSoft",
                  bloqueada && "cursor-not-allowed opacity-60",
                )}
              >
                <input type="radio" name={`frec-${alerta?.id ?? "n"}`} value={f} checked={frecuencia === f} disabled={bloqueada} onChange={() => setFrecuencia(f)} className="accent-[rgb(var(--granate))]" />
                {f === "diaria" ? "Cada mañana" : "Cada semana"}
              </label>
            );
          })}
        </div>
        {!diariaPermitida && (
          <p className="mt-2 text-meta text-mute">
            Cada mañana es de los planes de pago. <Link href={rutaEn(base, "/planes")} className="font-semibold text-granate hover:underline">Ver los planes</Link>
          </p>
        )}
      </fieldset>

      {previa && (
        <div className="mt-4 rounded-2xl border border-line bg-paper p-4">
          <p className="text-dato font-semibold text-ink">
            En los últimos 7 días habría avisado {previa.total > 10 ? "más de 10" : previa.total} {previa.total === 1 ? COSAS[producto].una : COSAS[producto].varias}.
          </p>
          {previa.items.length > 0 && <ListaItems items={previa.items.slice(0, 5)} className="mt-1" />}
        </div>
      )}
      {error && <Aviso tono="error" className="mt-4">{error}</Aviso>}
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="submit" disabled={enviando} className={claseAccion("primario")}>
          {enviando && <Loader2 size={15} aria-hidden className="animate-spin" />} {alerta ? "Guardar cambios" : "Crear la alerta"}
        </button>
        <button type="button" onClick={verPrevia} disabled={mirando} className={claseAccion("secundario")}>
          {mirando ? <Loader2 size={15} aria-hidden className="animate-spin" /> : <Eye size={15} aria-hidden />} Ver qué avisaría
        </button>
        <button type="button" onClick={onCancelar} className={claseAccion("fantasma")}>Cancelar</button>
      </div>
    </form>
  );
}
