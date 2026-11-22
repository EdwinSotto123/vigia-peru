"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, ChevronRight, Hospital, Loader2, LogIn, Pill, RotateCw, Stethoscope, Trash2, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Insignia } from "@/components/gobserva/ui/Insignia";
import { EstadoError, EstadoVacio } from "@/components/gobserva/ui/Estados";
import { nombreMed } from "@/components/salud/medicamentos/piezas";
import { rutaEn } from "@/lib/gobserva";
import { fechaCorta, nombrePropio, numero, rutaFicha, rutaMedicamento, rutaMedico, soles } from "@/lib/gobserva-salud";
import { ErrorCuenta, quitar, useGuardados, type GuardadoSalud, type TipoGuardado } from "@/lib/salud-cuenta";
import { cn } from "@/lib/utils";

const SECCIONES: { tipo: TipoGuardado; nombre: string; Icono: LucideIcon; vacio: string; donde: string; ir: string }[] = [
  { tipo: "establecimiento", nombre: "Establecimientos", Icono: Hospital, vacio: "Abre la ficha de una clínica o un hospital y toca «Guardar».", donde: "/establecimientos", ir: "Buscar un establecimiento" },
  { tipo: "medico", nombre: "Médicos", Icono: Stethoscope, vacio: "Verifica a un médico con su número de colegiatura y toca «Guardar».", donde: "/medico", ir: "Verificar a un médico" },
  { tipo: "medicamento", nombre: "Medicamentos", Icono: Pill, vacio: "Busca un medicamento, abre su ficha y toca «Guardar».", donde: "/medicamentos", ir: "Verificar un medicamento" },
];

/** Lo nuevo de una cosa guardada desde que se guardó (lo que la cuenta vigila). */
function novedades(g: GuardadoSalud): { texto: string; tono: "urgente" | "aviso" }[] {
  const out: { texto: string; tono: "urgente" | "aviso" }[] = [];
  if (g.sancionesNuevas) out.push({ texto: g.sancionesNuevas === 1 ? "Sanción nueva" : `${g.sancionesNuevas} sanciones nuevas`, tono: "urgente" });
  if (g.cambiosNuevos) out.push({ texto: g.cambiosNuevos === 1 ? "Cambió en RENIPRESS" : `${g.cambiosNuevos} cambios en RENIPRESS`, tono: "aviso" });
  if (g.alertasNuevas) out.push({ texto: g.alertasNuevas === 1 ? "Alerta nueva de DIGEMID" : `${g.alertasNuevas} alertas nuevas de DIGEMID`, tono: "urgente" });
  if (g.tipo === "establecimiento" && g.ipressEnRegistro === false) out.push({ texto: "Ya no figura en RENIPRESS", tono: "aviso" });
  return out;
}

function Fila({ g, base, onQuitar }: { g: GuardadoSalud; base: string; onQuitar: () => Promise<void> }) {
  const [ocupado, setOcupado] = useState(false);
  const nuevas = novedades(g);
  let titulo: string;
  let detalle: string;
  let href: string;
  if (g.tipo === "establecimiento") {
    titulo = nombrePropio(g.ipressNombre ?? g.nombre) || `IPRESS ${g.ref}`;
    detalle = [g.categoria ? `Categoría ${g.categoria}` : null, nombrePropio(g.distrito), nombrePropio(g.departamento), g.ipressActivo === false ? (g.ipressEstado ?? "").toLowerCase() : null, g.sanciones ? `${numero(g.sanciones)} sanciones firmes` : null]
      .filter(Boolean)
      .join(", ");
    href = rutaFicha(g.ref);
  } else if (g.tipo === "medicamento") {
    titulo = [nombreMed(g.medNombre ?? g.nombre), g.concentracion?.toLowerCase()].filter(Boolean).join(" ") || `Medicamento ${g.ref}`;
    detalle = [nombreMed(g.forma), g.registro ? `R.S. ${g.registro}` : null, g.precioMediana != null ? `${soles(g.precioMediana)} por unidad` : null, g.alertas ? `${numero(g.alertas)} alertas sobre su registro` : "Ninguna alerta sobre su registro"]
      .filter(Boolean)
      .join(", ");
    href = rutaMedicamento(g.ref);
  } else {
    titulo = `Colegiatura N.° ${g.ref}`;
    detalle = g.comoResponsable
      ? `Responsable de la atención en ${numero(g.comoResponsable)} ${g.comoResponsable === 1 ? "establecimiento" : "establecimientos"} según RENIPRESS`
      : "Su habilitación se confirma en el Colegio Médico";
    href = rutaMedico(g.ref);
  }
  return (
    <li className="flex items-center gap-2 pr-2">
      <Link href={rutaEn(base, href)} className="group flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 transition-colors duration-rapido hover:bg-ink/[0.03] sm:px-5">
        <div className="min-w-0 flex-1">
          <p className="text-cuerpo font-semibold text-ink group-hover:underline group-hover:decoration-granate/50 group-hover:underline-offset-4">{titulo}</p>
          {detalle && <p className="mt-0.5 text-meta text-mute">{detalle}</p>}
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {nuevas.map((n) => (
              <Insignia key={n.texto} tono={n.tono}>
                {n.texto}
              </Insignia>
            ))}
            <span className="text-rotulo text-mute">Guardado el {fechaCorta(g.guardadoAl)}</span>
          </p>
        </div>
        <ChevronRight size={16} aria-hidden className="shrink-0 text-mute group-hover:text-granate" />
      </Link>
      <button
        type="button"
        onClick={() => {
          setOcupado(true);
          void onQuitar().finally(() => setOcupado(false));
        }}
        disabled={ocupado}
        aria-label={`Quitar ${titulo} de lo guardado`}
        className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-mute transition-colors duration-rapido hover:bg-crimson-soft hover:text-crimsonTexto disabled:opacity-50"
      >
        {ocupado ? <Loader2 size={17} aria-hidden className="animate-spin" /> : <Trash2 size={17} aria-hidden />}
      </button>
    </li>
  );
}

/**
 * «Mis guardados» de Gobserva Salud (2026-11-21): lo que la persona guardó, en tres pestañas, con lo nuevo desde que lo
 * guardó marcado arriba de cada fila (una sanción, un cambio en RENIPRESS, una alerta de DIGEMID). Sin cuenta, la
 * invitación a crearla (gratis).
 */
export function MisGuardados({ base }: { base: string }) {
  const { guardados, conCuenta, cargandoSesion, error, isLoading, mutate } = useGuardados();
  const [seccion, setSeccion] = useState<TipoGuardado>("establecimiento");
  const [aviso, setAviso] = useState<string | null>(null);

  if (cargandoSesion || (conCuenta && isLoading && !guardados)) {
    return <div aria-hidden className="mt-6 h-64 animate-pulse rounded-2xl bg-paperDeep" />;
  }
  if (!conCuenta) {
    return (
      <div className="mt-6 rounded-2xl border border-line bg-paper">
        <EstadoVacio
          Icono={Bookmark}
          titulo="Guarda lo que verificas"
          texto="Con una cuenta gratis guardas clínicas, médicos y medicamentos, y te marcamos si les aparece una sanción o una alerta."
          acciones={
            <>
              <a href={rutaEn(base, "/entrar?crear=1&next=/cuenta")} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-granate px-5 text-dato font-semibold text-paper hover:bg-granate-deep">
                <UserPlus size={16} aria-hidden /> Crear mi cuenta gratis
              </a>
              <a href={rutaEn(base, "/entrar?next=/cuenta")} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 text-dato font-semibold text-ink hover:border-granate/50">
                <LogIn size={16} aria-hidden /> Ya tengo cuenta
              </a>
            </>
          }
        />
      </div>
    );
  }
  if (error && !guardados) {
    return (
      <div className="mt-6 rounded-2xl border border-line bg-paper">
        <EstadoError
          texto={error instanceof ErrorCuenta ? error.message : "No pudimos leer lo que guardaste. Vuelve a intentarlo."}
          acciones={
            <button type="button" onClick={() => void mutate()} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line px-5 text-dato font-semibold text-ink">
              <RotateCw size={15} aria-hidden /> Volver a intentar
            </button>
          }
        />
      </div>
    );
  }

  const todos = guardados ?? [];
  const nuevas = todos.filter((g) => g.sancionesNuevas || g.alertasNuevas || g.cambiosNuevos).length;
  const actual = SECCIONES.find((s) => s.tipo === seccion)!;
  const lista = todos.filter((g) => g.tipo === seccion);

  async function sacar(g: GuardadoSalud) {
    setAviso(null);
    try {
      await quitar(g.tipo, g.ref);
      await mutate();
    } catch (e) {
      setAviso(e instanceof ErrorCuenta ? e.message : "No pudimos quitarlo ahora.");
    }
  }

  return (
    <div className="mt-6 space-y-4">
      {nuevas > 0 && (
        <p className="rounded-2xl border border-crimson/30 bg-crimson-soft/40 px-5 py-3.5 text-dato font-semibold text-ink">
          {nuevas === 1 ? "Una de tus cosas guardadas tiene algo nuevo" : `${numero(nuevas)} de tus cosas guardadas tienen algo nuevo`} desde que la guardaste. Está marcado en cada fila.
        </p>
      )}
      <div role="tablist" aria-label="Lo que guardaste" className="flex gap-2 overflow-x-auto">
        {SECCIONES.map((s) => {
          const n = todos.filter((g) => g.tipo === s.tipo).length;
          return (
            <button
              key={s.tipo}
              type="button"
              role="tab"
              aria-selected={seccion === s.tipo}
              onClick={() => setSeccion(s.tipo)}
              className={cn(
                "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-dato font-semibold transition-colors duration-rapido",
                seccion === s.tipo ? "border-granate bg-granate text-paper" : "border-line bg-paper text-inkSoft hover:border-granate/50",
              )}
            >
              <s.Icono size={16} aria-hidden /> {s.nombre} <span className="tabular-nums opacity-80">{numero(n)}</span>
            </button>
          );
        })}
      </div>
      {aviso && (
        <p role="alert" className="text-meta text-crimsonTexto">
          {aviso}
        </p>
      )}
      <div role="tabpanel" aria-label={actual.nombre}>
        {lista.length === 0 ? (
          <div className="rounded-2xl border border-line bg-paper">
            <EstadoVacio
              Icono={actual.Icono}
              titulo={`Todavía no guardas ${actual.nombre.toLowerCase()}`}
              texto={actual.vacio}
              acciones={
                <Link href={rutaEn(base, actual.donde)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-granate px-5 text-dato font-semibold text-paper hover:bg-granate-deep">
                  {actual.ir}
                </Link>
              }
            />
          </div>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-paper">
            {lista.map((g) => (
              <Fila key={`${g.tipo}-${g.ref}`} g={g} base={base} onQuitar={() => sacar(g)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
