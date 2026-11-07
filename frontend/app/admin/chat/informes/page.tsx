"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, Coins, FolderOpen, MessagesSquare, Search, ShieldAlert, User } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { actorCorto, Badge, claseBoton, DataTable, EmptyState, ErrorBanner, fmtFechaHora, hace, plural, type Columna } from "@/components/admin/ui";
import { Dato } from "@/components/ui/Dato";
import { usd } from "@/components/admin/chat/conversacion";
import { ESTADO_INFORME, NOMBRE_MODELO, rutaInforme, type FilaInforme } from "@/components/admin/chat/informes";
import { adminFetch } from "@/lib/admin";

/**
 * Informes guardados del chat de investigación (sólo administradores): cada pregunta que se hizo, de cualquiera del
 * equipo, con cómo terminó, su revisión automática y su costo. Un informe sigue corriendo aunque se cierre la pestaña:
 * mientras haya alguno corriendo, la lista se actualiza sola.
 *
 * Fuente: GET /api/admin/chat/informes (?q, antes, limite).
 */

const POR_PAGINA = 50;
const CADA_MS = 10_000;

export default function InformesChatPage() {
  return (
    <AdminShell
      title="Informes guardados"
      subtitle="Cada pregunta al chat de investigación con su respuesta, sus pasos y su revisión. Siguen corriendo aunque se cierre la pestaña."
      actions={
        <Link href="/admin/chat" className={claseBoton("secundario", "sm")}>
          <MessagesSquare size={14} aria-hidden /> Volver al chat
        </Link>
      }
    >
      <Lista />
    </AdminShell>
  );
}

function Lista() {
  const [filas, setFilas] = useState<FilaInforme[] | null>(null);
  const [hayMas, setHayMas] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [buscado, setBuscado] = useState("");
  const [cargandoMas, setCargandoMas] = useState(false);
  const pedido = useRef(0);

  const cargar = useCallback(async (texto: string, antes?: string) => {
    const n = ++pedido.current;
    const qs = new URLSearchParams({ limite: String(POR_PAGINA) });
    if (texto.length >= 2) qs.set("q", texto);
    if (antes) qs.set("antes", antes);
    try {
      const r = await adminFetch<{ data: FilaInforme[]; hayMas: boolean }>(`/chat/informes?${qs}`);
      if (n !== pedido.current) return;
      setFilas((previas) => (antes && previas ? [...previas, ...r.data] : r.data));
      setHayMas(r.hayMas);
      setError(null);
    } catch (e) {
      if (n === pedido.current) setError(e);
    }
  }, []);

  // Al buscar, un momento después de dejar de escribir.
  useEffect(() => {
    const t = window.setTimeout(() => {
      setBuscado(q.trim());
      void cargar(q.trim());
    }, q ? 300 : 0);
    return () => window.clearTimeout(t);
  }, [q, cargar]);

  // Mientras alguno corre, la primera página se actualiza sola.
  const hayCorriendo = !!filas?.some((f) => f.estado === "corriendo");
  useEffect(() => {
    if (!hayCorriendo) return;
    const t = window.setInterval(() => void cargar(buscado), CADA_MS);
    return () => window.clearInterval(t);
  }, [hayCorriendo, buscado, cargar]);

  const masAntiguos = async () => {
    const ultimo = filas?.[filas.length - 1];
    if (!ultimo) return;
    setCargandoMas(true);
    await cargar(buscado, ultimo.creado);
    setCargandoMas(false);
  };

  return (
    <div className="space-y-3">
      <form role="search" onSubmit={(e) => e.preventDefault()} className="relative max-w-xl">
        <label htmlFor="buscar-informes" className="sr-only">
          Buscar en las preguntas
        </label>
        <Search size={16} aria-hidden className="absolute left-3.5 top-1/2 -translate-y-1/2 text-mute" />
        <input
          id="buscar-informes"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar en las preguntas"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-line bg-paperSoft pl-10 pr-3 text-destacado placeholder:text-mute focus:border-granate focus:bg-paper focus:outline-none focus:ring-2 focus:ring-granate/20"
        />
      </form>

      <ErrorBanner error={error} titulo="No se pudo leer la lista de informes" onReintentar={() => void cargar(buscado)} />

      <DataTable
        columnas={COLUMNAS}
        filas={filas}
        claveFila={(f) => f.id}
        etiqueta="Informes guardados del chat"
        hrefFila={(f) => rutaInforme(f.id)}
        cargando={!filas && !error}
        compactoMovil
        vacio={
          <EmptyState
            compacto
            icono={<FolderOpen size={18} />}
            titulo={buscado ? "Ninguna pregunta tiene esas palabras" : "Todavía no hay informes guardados"}
            descripcion={buscado ? "Prueba con otras palabras o borra la búsqueda." : "Cada pregunta que se hace en el chat de investigación queda acá."}
          />
        }
      />

      {hayMas && (
        <button type="button" onClick={() => void masAntiguos()} disabled={cargandoMas} className={claseBoton("secundario", "sm")}>
          {cargandoMas ? "Cargando…" : "Ver más antiguos"}
        </button>
      )}
    </div>
  );
}

function CeldaPregunta({ f }: { f: FilaInforme }) {
  const est = ESTADO_INFORME[f.estado];
  return (
    <div className="min-w-0">
      <p className="line-clamp-2 text-dato font-medium leading-snug text-ink [overflow-wrap:anywhere]">{f.pregunta}</p>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-rotulo text-mute">
        <Badge tono={est.tono}>{est.etiqueta}</Badge>
        <span>{NOMBRE_MODELO[f.modelo_pedido]}</span>
        {/* En el celular la tabla muestra sólo esta columna: quién y cuándo van acá. */}
        <span className="md:hidden">{fmtFechaHora(f.creado)}</span>
        <span className="md:hidden">{actorCorto(f.actor)}</span>
        {f.revision && f.revision.por_revisar > 0 && (
          <span className="text-amberTexto md:hidden">{plural(f.revision.por_revisar, "por revisar", "por revisar")}</span>
        )}
      </p>
    </div>
  );
}

function CeldaRevision({ f }: { f: FilaInforme }) {
  if (!f.revision) return <span className="text-mute">Sin revisión</span>;
  if (f.revision.por_revisar === 0) {
    return (
      <Dato icono={CheckCircle2} nombre="Revisión">
        <span className="text-mossTexto">Todo cuadra</span>
      </Dato>
    );
  }
  return (
    <Dato icono={ShieldAlert} nombre="Revisión">
      <span className="text-amberTexto">{plural(f.revision.por_revisar, "por revisar", "por revisar")}</span>
    </Dato>
  );
}

const COLUMNAS: Columna<FilaInforme>[] = [
  { clave: "pregunta", titulo: "Pregunta", principal: true, className: "max-w-xl", celda: (f) => <CeldaPregunta f={f} /> },
  {
    clave: "fecha",
    titulo: "Cuándo",
    soloEscritorio: true,
    celda: (f) => (
      <span className="whitespace-nowrap" title={fmtFechaHora(f.creado) ?? undefined}>
        {hace(f.creado)}
      </span>
    ),
  },
  {
    clave: "quien",
    titulo: "Quién",
    soloEscritorio: true,
    celda: (f) => (
      <Dato icono={User} nombre="Quién preguntó">
        {actorCorto(f.actor)}
      </Dato>
    ),
  },
  { clave: "revision", titulo: "Revisión", soloEscritorio: true, celda: (f) => <CeldaRevision f={f} /> },
  {
    clave: "costo",
    titulo: "Costo",
    alinear: "derecha",
    soloEscritorio: true,
    celda: (f) =>
      f.costo_usd != null ? (
        <Dato icono={Coins} nombre="Costo" mono>
          {usd(f.costo_usd)}
        </Dato>
      ) : (
        <span className="text-mute">—</span>
      ),
  },
];
