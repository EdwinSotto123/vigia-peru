"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import useSWR from "swr";
import { CalendarClock, ChevronRight, Hourglass, LogIn, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { Aviso, CAMPO, ETIQUETA, Esqueleto, useSesion } from "@/components/gobserva/cuenta/comun";
import { Dato } from "@/components/ui/Dato";
import { claseAccion } from "@/components/ui/EnlaceAccion";
import { fechaCorta, solesCompacto } from "@/lib/formato";
import { rutaEn } from "@/lib/gobserva";
import {
  borrarLinea,
  cambiarLinea,
  cargarLineas,
  cargarParaTi,
  crearLinea,
  ErrorCuenta,
  type Linea,
  type LineaNueva,
  type OportunidadParaTi,
  type TipoLinea,
} from "@/lib/gobserva-cuenta";
import { tituloNatural } from "@/lib/landing";
import { REGIONES_UBIGEO, TIPOS, cierreMenor, limpiar, nombreRegion, nombreTipo } from "@/lib/licitaciones";
import { cn } from "@/lib/utils";
import { ChipTipo } from "./Piezas";

/**
 * «Para ti» (2026-11-07): la empresa dice lo que vende, en sus palabras (una línea de negocio), y ve las licitaciones y
 * los contratos menores abiertos ordenados por cuánto se parecen a eso (GET /gobserva/cuenta/para-ti, lib/afinidad.ts
 * del API). Las regiones y los tipos filtran; las palabras clave suben lo que las nombra. Sin cuenta, invita a crearla.
 */
export function ParaTi({ base }: { base: string }) {
  const { loading, conCuenta, esVigia } = useSesion();
  if (loading) return <Esqueleto className="h-64" />;
  if (!conCuenta) {
    return (
      <section className="rounded-3xl border border-granate/30 bg-granate-50 p-5 sm:p-8">
        <h2 className="text-balance font-display text-seccion font-bold leading-tight text-ink">Dinos qué vendes y te mostramos qué te conviene cotizar</h2>
        <p className="mt-2 max-w-[60ch] text-dato leading-relaxed text-inkSoft">
          Escribe lo que vende tu empresa en tus palabras («útiles de oficina y tóner», «alquiler de camionetas 4x4») y ordenamos las licitaciones y los
          contratos menores abiertos de lo más parecido a lo menos. Es gratis con tu cuenta.
        </p>
        {esVigia && <Aviso className="mt-3">Esa es una cuenta de Vigía. Para Gobserva, entra con tu correo o con Google.</Aviso>}
        <Link href={rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/cuenta?tab=para-ti")}`)} className={claseAccion("primario", "mt-5", "md")}>
          <LogIn size={16} aria-hidden /> Crear mi cuenta gratis
        </Link>
      </section>
    );
  }
  return <ConCuenta base={base} />;
}

function ConCuenta({ base }: { base: string }) {
  const lineas = useSWR("gobserva-lineas", cargarLineas, { revalidateOnFocus: false });
  const [elegida, setElegida] = useState<number | null>(null);
  const [editando, setEditando] = useState<Linea | "nueva" | null>(null);
  const lista = lineas.data?.data ?? [];
  const actual = lista.find((l) => l.id === elegida) ?? lista[0] ?? null;
  useEffect(() => {
    if (!lineas.isLoading && lista.length === 0 && editando === null) setEditando("nueva");
  }, [lineas.isLoading, lista.length, editando]);

  if (lineas.isLoading) return <Esqueleto className="h-64" />;
  if (lineas.error) return <Aviso tono="error">No pudimos leer tus líneas de negocio. Vuelve a intentarlo en un momento.</Aviso>;
  const limites = lineas.data?.limites;
  const puedeSumar = !!limites && lista.length < limites.lineas;

  if (editando) {
    return (
      <Editor
        linea={editando === "nueva" ? null : editando}
        primera={lista.length === 0}
        onListo={async (id) => {
          await lineas.mutate();
          if (id) setElegida(id);
          setEditando(null);
        }}
        onCancelar={lista.length ? () => setEditando(null) : undefined}
      />
    );
  }
  if (!actual) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-meta font-semibold text-mute">Tus líneas:</span>
        {lista.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => setElegida(l.id)}
            aria-pressed={l.id === actual.id}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-3.5 text-meta font-semibold transition-colors duration-rapido sm:min-h-9",
              l.id === actual.id ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
            )}
          >
            {l.nombre}
          </button>
        ))}
        <button type="button" onClick={() => setEditando(actual)} className={claseAccion("secundario", "min-h-11 sm:min-h-9")}>
          <Pencil size={14} aria-hidden /> Editar
        </button>
        {puedeSumar ? (
          <button type="button" onClick={() => setEditando("nueva")} className={claseAccion("secundario", "min-h-11 sm:min-h-9")}>
            <Plus size={14} aria-hidden /> Otra línea
          </button>
        ) : (
          <Link href={rutaEn(base, "/planes")} className="text-meta font-semibold text-granate underline-offset-2 hover:underline">
            Más líneas con un plan
          </Link>
        )}
      </div>
      <p className="max-w-[72ch] text-dato leading-relaxed text-inkSoft">{actual.descripcion}</p>
      <Resultados base={base} linea={actual} />
    </div>
  );
}

function Resultados({ base, linea }: { base: string; linea: Linea }) {
  const r = useSWR(["gobserva-para-ti", linea.id, linea.actualizada], () => cargarParaTi(linea.id), { revalidateOnFocus: false });
  if (r.isLoading) return <Esqueleto className="h-96" />;
  if (r.error || !r.data) return <Aviso tono="error">No pudimos armar tus oportunidades ahora. Vuelve a intentarlo en un momento.</Aviso>;
  const { data, limite, plan } = r.data;
  if (!data.length) {
    return (
      <Aviso>
        Ahora no hay licitaciones ni contratos menores abiertos parecidos a esta línea{linea.regiones.length || linea.tipos.length ? " con sus regiones y tipos" : ""}.
        Prueba con otras palabras o con menos filtros; salen nuevas cada hora.
      </Aviso>
    );
  }
  return (
    <section aria-labelledby="para-ti-t">
      <h2 id="para-ti-t" className="font-display text-seccion font-bold leading-tight text-ink">
        Lo más parecido a lo que vendes
      </h2>
      <ol className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
        {data.map((o) => (
          <li key={`${o.fuente}-${o.id}`} className="min-w-0">
            <FilaParaTi o={o} base={base} />
          </li>
        ))}
      </ol>
      <p className="mt-3 text-meta leading-snug text-mute">
        El puntaje dice cuánto se parece lo que se compra a lo que vendes, de 0 a 100; no es la probabilidad de ganar.
        {!plan && data.length >= limite ? " Con un plan ves hasta 50 por línea y sumas más líneas." : ""}
      </p>
      {!plan && data.length >= limite && (
        <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "mt-3")}>
          Ver los planes
        </Link>
      )}
    </section>
  );
}

export function FilaParaTi({ o, base }: { o: OportunidadParaTi; base: string }) {
  const href = o.fuente === "menor" ? rutaEn(base, `/menor/${o.id}`) : rutaEn(base, `/oportunidad/${encodeURIComponent(o.id)}`);
  const c = o.fuente === "menor" ? cierreMenor(o.cierra) : null;
  return (
    <Link
      href={href}
      className="group grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-4 px-4 py-4 transition-colors duration-rapido hover:bg-paperSoft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5 lg:grid-cols-[3.25rem_minmax(0,1fr)_1rem] lg:items-center"
    >
      <span
        className={cn(
          "flex h-12 w-12 flex-col items-center justify-center rounded-2xl font-display text-bloque font-bold tabular-nums leading-none",
          o.puntaje >= 70 ? "bg-moss/15 text-mossTexto" : o.puntaje >= 45 ? "bg-granate-50 text-granate" : "bg-paperDeep text-inkSoft",
        )}
        title="Cuánto se parece a lo que vendes (0 a 100)"
      >
        {o.puntaje}
        <span className="sr-only"> de 100 de parecido</span>
      </span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="rounded-full bg-paperDeep px-2.5 py-0.5 text-rotulo font-semibold text-inkSoft">{o.fuente === "menor" ? "Contrato menor" : "Licitación"}</span>
          <ChipTipo tipo={o.tipo} />
          {o.palabras.map((p) => (
            <span key={p} className="inline-flex items-center gap-1 rounded-full bg-maiz/20 px-2.5 py-0.5 text-rotulo font-semibold text-ink">
              <Sparkles size={11} aria-hidden /> {p}
            </span>
          ))}
        </div>
        <p className="mt-2 line-clamp-2 font-display text-destacado font-semibold leading-snug text-ink group-hover:text-granate">
          {limpiar(o.titulo) || "Sin descripción registrada"}
        </p>
        <p className="mt-1.5 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-meta text-inkSoft">
          <Dato tipo="entidad" className="min-w-0 max-w-full truncate">
            {o.entidad ? tituloNatural(o.entidad) : "Entidad sin nombre registrado"}
          </Dato>
          {o.regiones?.[0] && <Dato tipo="lugar">{nombreRegion(o.regiones[0])}</Dato>}
          {c ? (
            <Dato icono={CalendarClock} className={cn(c.urgente && "font-semibold text-crimsonTexto")}>
              {c.texto}
            </Dato>
          ) : o.consultasHasta ? (
            <Dato icono={Hourglass}>Consultas hasta el {fechaCorta(o.consultasHasta)}</Dato>
          ) : null}
          {o.valor ? <Dato icono={Sparkles}>{solesCompacto(o.valor)} referencial</Dato> : null}
        </p>
      </div>
      <ChevronRight size={16} aria-hidden className="hidden text-mute transition-transform duration-rapido group-hover:translate-x-0.5 group-hover:text-granate lg:block" />
    </Link>
  );
}

/** Crear o cambiar una línea de negocio: qué vende (lo que más pesa), palabras clave, regiones y tipos. */
function Editor({ linea, primera, onListo, onCancelar }: { linea: Linea | null; primera: boolean; onListo: (id: number | null) => Promise<void>; onCancelar?: () => void }) {
  const id = useId();
  const [nombre, setNombre] = useState(linea?.nombre ?? "");
  const [descripcion, setDescripcion] = useState(linea?.descripcion ?? "");
  const [palabras, setPalabras] = useState((linea?.palabras ?? []).join(", "));
  const [regiones, setRegiones] = useState<string[]>(linea?.regiones ?? []);
  const [tipos, setTipos] = useState<TipoLinea[]>(linea?.tipos ?? []);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const alternar = <T,>(xs: T[], x: T) => (xs.includes(x) ? xs.filter((y) => y !== x) : [...xs, x]);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const b: LineaNueva = {
      nombre: nombre.trim(),
      descripcion: descripcion.trim(),
      palabras: palabras.split(",").map((p) => p.trim()).filter((p) => p.length >= 2).slice(0, 20),
      regiones,
      tipos,
      montoMin: linea?.montoMin ?? null,
      montoMax: linea?.montoMax ?? null,
    };
    try {
      const r = linea ? await cambiarLinea(linea.id, b) : await crearLinea(b);
      await onListo(r.id);
    } catch (err) {
      setError(err instanceof ErrorCuenta ? err.message : "No pudimos guardar tu línea. Vuelve a intentarlo.");
    } finally {
      setEnviando(false);
    }
  };

  const borrar = async () => {
    if (!linea) return;
    setEnviando(true);
    try {
      await borrarLinea(linea.id);
      await onListo(null);
    } catch (err) {
      setError(err instanceof ErrorCuenta ? err.message : "No pudimos borrar la línea.");
      setEnviando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-5 rounded-3xl border border-line bg-paperSoft p-5 sm:p-7">
      <div>
        <h2 className="font-display text-seccion font-bold leading-tight text-ink">{linea ? "Edita tu línea de negocio" : primera ? "¿Qué vende tu empresa?" : "Otra línea de negocio"}</h2>
        <p className="mt-1 text-dato text-inkSoft">Lo que escribas aquí es lo que más pesa: dilo como se lo contarías a un cliente.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <label className="min-w-0">
          <span className={ETIQUETA}>Nombre de la línea</span>
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} required placeholder="Útiles de oficina" className={CAMPO} />
        </label>
        <label className="min-w-0">
          <span className={ETIQUETA}>Palabras clave, separadas por comas</span>
          <input value={palabras} onChange={(e) => setPalabras(e.target.value)} placeholder="tóner, papel bond, archivadores" className={CAMPO} />
        </label>
      </div>
      <label className="block">
        <span className={ETIQUETA}>Qué vendes, en tus palabras</span>
        <textarea
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
          required
          minLength={3}
          maxLength={1000}
          rows={3}
          placeholder="Vendemos útiles de oficina, papel bond, tóner y cartuchos para impresoras, y material de escritorio."
          className={cn(CAMPO, "h-auto py-2.5")}
        />
      </label>
      <fieldset>
        <legend className={ETIQUETA}>Tipos (ninguno = todos)</legend>
        <div className="flex flex-wrap gap-2">
          {TIPOS.map((t) => (
            <Opcion key={t.clave} activa={tipos.includes(t.clave as TipoLinea)} onClick={() => setTipos((x) => alternar(x, t.clave as TipoLinea))}>
              {nombreTipo(t.clave)}
            </Opcion>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className={ETIQUETA}>Regiones donde vendes (ninguna = todo el Perú)</legend>
        <div className="flex flex-wrap gap-1.5" id={`${id}-regiones`}>
          {REGIONES_UBIGEO.map((r) => (
            <Opcion key={r.ubigeo} activa={regiones.includes(r.ubigeo)} onClick={() => setRegiones((x) => alternar(x, r.ubigeo))}>
              {r.nombre}
            </Opcion>
          ))}
        </div>
      </fieldset>
      {error && <Aviso tono="error">{error}</Aviso>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={enviando || nombre.trim().length < 1 || descripcion.trim().length < 3} className={claseAccion("primario", "min-h-11")}>
          {enviando ? "Guardando…" : linea ? "Guardar cambios" : "Ver mis oportunidades"}
        </button>
        {onCancelar && (
          <button type="button" onClick={onCancelar} disabled={enviando} className={claseAccion("secundario", "min-h-11")}>
            Cancelar
          </button>
        )}
        {linea && (
          <button type="button" onClick={() => void borrar()} disabled={enviando} className={claseAccion("fantasma", "ml-auto min-h-11")}>
            <Trash2 size={14} aria-hidden /> Borrar esta línea
          </button>
        )}
      </div>
    </form>
  );
}

function Opcion({ activa, onClick, children }: { activa: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={cn(
        "inline-flex min-h-10 items-center rounded-full border px-3 text-meta font-medium transition-colors duration-rapido sm:min-h-8",
        activa ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/40 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
