"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import useSWR from "swr";
import { CalendarClock, ChevronRight, Hourglass, LogIn, Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
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
import { ChipTipo, VacioEmprendedora } from "./Piezas";
import { MaquetaParaTi } from "./portada/Maquetas";
import { EscribeSolo } from "@/components/gobserva/portada/EscribeSolo";
import { CLASE_ENLACE_PIE, Caja } from "@/components/gobserva/app/Caja";

/**
 * «Para ti» (2026-11-07): la empresa dice lo que vende, en sus palabras (una línea de negocio), y ve las licitaciones y
 * los contratos menores abiertos ordenados por cuánto se parecen a eso (GET /gobserva/cuenta/para-ti, lib/afinidad.ts
 * del API). Las regiones y los tipos filtran; las palabras clave suben lo que las nombra. Sin cuenta, invita a crearla.
 */
export function ParaTi({ base }: { base: string }) {
  const { loading, conCuenta, esVigia } = useSesion();
  if (loading) return <Esqueleto className="h-64" />;
  if (!conCuenta) {
    // Sin cuenta (2026-11-22, el usuario: «esto es texto plano»): cómo se ve «Para ti» (la maqueta, marcada como ejemplo),
    // la invitación a crear la cuenta y, para probar ya sin cuenta, el buscador de oportunidades que escribe ejemplos solo.
    return (
      <section className="grid gap-6 rounded-3xl border border-granate/30 bg-granate-50 p-5 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <div className="min-w-0">
          <h2 className="text-balance font-display text-seccion font-bold leading-tight text-ink sm:text-titulo">Dinos qué vendes y te mostramos qué te conviene cotizar</h2>
          <p className="mt-2 max-w-[60ch] text-dato leading-relaxed text-inkSoft">
            Escribe lo que vende tu empresa en tus palabras y ordenamos las licitaciones y los contratos menores abiertos de lo más parecido a lo menos. Es
            gratis con tu cuenta.
          </p>
          {esVigia && <Aviso className="mt-3">Esa es una cuenta de Vigía. Para Gobserva, entra con tu correo o con Google.</Aviso>}
          <Link href={rutaEn(base, `/entrar?crear=1&next=${encodeURIComponent("/cuenta?tab=para-ti")}`)} className={claseAccion("primario", "mt-5", "md")}>
            <LogIn size={16} aria-hidden /> Crear mi cuenta gratis
          </Link>
          <form method="get" action={rutaEn(base, "/oportunidades")} role="search" className="mt-6 border-t border-granate/20 pt-5">
            <label htmlFor="probar-para-ti" className="block text-dato font-semibold text-ink">
              ¿Quieres probar antes? Busca lo que vendes, sin cuenta
            </label>
            <div className="mt-2 flex gap-2">
              <span className="relative min-w-0 flex-1">
                <Search size={17} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
                <input
                  id="probar-para-ti"
                  name="q"
                  type="search"
                  minLength={3}
                  maxLength={80}
                  enterKeyHint="search"
                  placeholder="Útiles de oficina, tóner…"
                  className="h-12 w-full rounded-2xl border border-line bg-paper pl-10 pr-3 text-destacado text-ink placeholder:text-mute focus:border-granate focus:outline-none focus:ring-2 focus:ring-granate/30"
                />
              </span>
              <button type="submit" className={claseAccion("secundario", "h-12 shrink-0 px-4")}>
                Buscar
              </button>
            </div>
            <EscribeSolo para="probar-para-ti" ejemplos={["útiles de oficina y tóner", "alquiler de camionetas 4x4", "servicio de limpieza", "alimentos para comedores", "uniformes"]} />
          </form>
        </div>
        <MaquetaParaTi />
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

  const regiones = actual.regiones.length ? actual.regiones.map(nombreRegion).join(", ") : "Todo el Perú";
  const tipos = actual.tipos.length ? actual.tipos.map(nombreTipo).join(", ") : "Bienes, servicios y obras";

  return (
    <div className="grid gap-4 sm:gap-6">
      <Caja
        id="linea"
        titulo={lista.length > 1 ? "Tus líneas de negocio" : `Tu línea: ${actual.nombre}`}
        descripcion="Lo que vendes, en tus palabras: con eso ordenamos lo abierto."
        accion={
          <>
            <button type="button" onClick={() => setEditando(actual)} className={claseAccion("secundario", "min-h-9 px-4")}>
              <Pencil size={14} aria-hidden /> Editar
            </button>
            {puedeSumar ? (
              <button type="button" onClick={() => setEditando("nueva")} className={claseAccion("secundario", "min-h-9 px-4")}>
                <Plus size={14} aria-hidden /> Otra línea
              </button>
            ) : (
              <Link href={rutaEn(base, "/planes")} className={CLASE_ENLACE_PIE}>
                Más líneas con un plan
              </Link>
            )}
          </>
        }
      >
        {lista.length > 1 && (
          <div role="tablist" aria-label="Tus líneas" className="mb-4 flex flex-wrap gap-1 rounded-lg bg-ink/[0.06] p-1 sm:inline-flex">
            {lista.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                aria-selected={l.id === actual.id}
                onClick={() => setElegida(l.id)}
                className={cn(
                  "min-h-9 rounded-md px-3 text-meta font-semibold transition-colors duration-rapido",
                  l.id === actual.id ? "bg-caja text-ink shadow-[0_1px_3px_rgb(0_0_0/0.12)]" : "text-inkSoft hover:text-ink",
                )}
              >
                {l.nombre}
              </button>
            ))}
          </div>
        )}
        <p className="max-w-[72ch] text-pretty text-dato leading-relaxed text-ink">{actual.descripcion}</p>
        <dl className="mt-4 grid gap-x-8 gap-y-3 text-meta sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="font-semibold text-mute">Palabras clave</dt>
            <dd className="mt-1.5 flex flex-wrap gap-1.5">
              {actual.palabras.length ? (
                actual.palabras.map((p) => (
                  <span key={p} className="inline-flex items-center gap-1 rounded-full bg-maiz/20 px-2.5 py-0.5 text-rotulo font-semibold text-ink">
                    <Sparkles size={11} aria-hidden /> {p}
                  </span>
                ))
              ) : (
                <span className="text-inkSoft">Ninguna: sólo pesa lo que vendes</span>
              )}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="font-semibold text-mute">Regiones</dt>
            <dd className="mt-1.5 text-dato text-ink">{regiones}</dd>
          </div>
          <div className="min-w-0">
            <dt className="font-semibold text-mute">Qué se compra</dt>
            <dd className="mt-1.5 text-dato text-ink">{tipos}</dd>
          </div>
        </dl>
      </Caja>
      <Resultados base={base} linea={actual} />
    </div>
  );
}

function Resultados({ base, linea }: { base: string; linea: Linea }) {
  const r = useSWR(["gobserva-para-ti", linea.id, linea.actualizada], () => cargarParaTi(linea.id), { revalidateOnFocus: false });
  if (r.isLoading) return <Esqueleto className="h-96" />;
  if (r.error || !r.data) return <Aviso tono="error">No pudimos armar tus oportunidades ahora. Vuelve a intentarlo en un momento.</Aviso>;
  const { data, limite, plan } = r.data;
  const tope = !plan && data.length >= limite;
  return (
    <Caja
      id="para-ti"
      titulo="Lo más parecido a lo que vendes"
      descripcion={data.length ? `${data.length} ${data.length === 1 ? "oportunidad abierta" : "oportunidades abiertas"}, de lo que más se parece a lo que menos` : undefined}
      relleno={false}
      pie={
        <div className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <p className="text-meta leading-snug text-mute">
            El puntaje dice cuánto se parece lo que se compra a lo que vendes, de 0 a 100; no es la probabilidad de ganar.
            {tope ? " Con un plan ves hasta 50 por línea y sumas más líneas." : ""}
          </p>
          {tope && (
            <Link href={rutaEn(base, "/planes")} className={claseAccion("secundario", "shrink-0")}>
              Ver los planes
            </Link>
          )}
        </div>
      }
    >
      {!data.length ? (
        <VacioEmprendedora
          className="py-8 sm:py-10"
          titulo="Nada abierto parecido a esta línea ahora"
          texto={`Prueba con otras palabras${linea.regiones.length || linea.tipos.length ? " o con menos regiones y tipos" : ""}: salen nuevas cada hora.`}
        />
      ) : (
        <ol className="divide-y divide-line">
          {data.map((o) => (
            <li key={`${o.fuente}-${o.id}`} className="min-w-0">
              <FilaParaTi o={o} base={base} />
            </li>
          ))}
        </ol>
      )}
    </Caja>
  );
}

/** Si el fin de consultas (un día de Lima, o una hora) ya pasó: entonces no es un plazo por cumplir. */
function consultasCerradas(hasta: string): boolean {
  const fin = /^\d{4}-\d{2}-\d{2}$/.test(hasta) ? Date.parse(`${hasta}T23:59:59-05:00`) : Date.parse(hasta);
  return Number.isFinite(fin) && fin < Date.now();
}

export function FilaParaTi({ o, base }: { o: OportunidadParaTi; base: string }) {
  const href = o.fuente === "menor" ? rutaEn(base, `/app/menor/${o.id}`) : rutaEn(base, `/app/oportunidad/${encodeURIComponent(o.id)}`);
  const c = o.fuente === "menor" ? cierreMenor(o.cierra) : null;
  return (
    <Link
      href={href}
      className="group grid min-w-0 grid-cols-[3.25rem_minmax(0,1fr)] gap-x-4 px-4 py-4 transition-colors duration-rapido hover:bg-ink/[0.035] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-granate sm:px-5 lg:grid-cols-[3.25rem_minmax(0,1fr)_1rem] lg:items-center"
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
            consultasCerradas(o.consultasHasta) ? (
              <Dato icono={Hourglass} className="text-mute">Consultas cerradas el {fechaCorta(o.consultasHasta)}</Dato>
            ) : (
              <Dato icono={Hourglass}>Consultas hasta el {fechaCorta(o.consultasHasta)}</Dato>
            )
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
    <form onSubmit={enviar} className="space-y-5 rounded-2xl border border-line bg-caja p-5 shadow-caja sm:p-6">
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
