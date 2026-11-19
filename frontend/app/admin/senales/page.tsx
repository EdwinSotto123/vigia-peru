"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleHelp, ExternalLink, GraduationCap, RefreshCw, Undo2, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  Aviso,
  Badge,
  Card,
  DataTable,
  EmptyState,
  ErrorBanner,
  FilterChips,
  SkeletonPanel,
  StatCard,
  StatGrid,
  claseBoton,
  fmtNum,
  plural,
  type Columna,
  type Tone,
} from "@/components/admin/ui";
import { adminFetch } from "@/lib/admin";
import { refrescarAdmin, useAdmin } from "@/lib/useAdmin";
import { useSesionEquipo } from "@/lib/useEquipo";

/**
 * Revisión a mano de los indicadores en observación (migraciones 329 y 398). Un indicador nuevo se muestra con su
 * evidencia y no puntúa hasta medir cuántas veces acierta: aquí el equipo revisa una muestra al azar de sus casos y
 * marca cada uno. Con 40 casos decididos, un administrador puede graduarlo (pasa a puntuar en el siguiente refresco).
 *
 * En la URL: `?tipo=` (el indicador que se revisa) y `?ver=revisados`. Fuente: /api/admin/senales-observacion.
 */

interface Indicador {
  tipo: string;
  etiqueta: string;
  enObservacion: boolean;
  casos: number;
  procesos: number;
  aciertan: number;
  noAciertan: number;
  dudosos: number;
  decididos: number;
  precision: number | null;
  precisionMinima: number | null;
  puedeGraduar: boolean;
  tasaBase: { casos: number; universo: number; que: string } | null;
}
interface Resumen {
  minimo: number;
  data: Indicador[];
}
interface Caso {
  ocid: string;
  ruc: string;
  severidad: "alta" | "media" | "baja";
  fecha: string | null;
  monto: number | null;
  detalle: Record<string, unknown> | null;
  personaRol: string | null;
  fuenteUrl: string | null;
  codigo: string | null;
  objeto: string | null;
  entidad: string | null;
  empresa: string | null;
  veredicto: Veredicto | null;
  nota: string | null;
  revisadoPor: string | null;
}
interface Cola {
  tipo: string;
  etiqueta: string;
  total: number;
  page: number;
  size: number;
  data: Caso[];
}
type Veredicto = "acierta" | "no_acierta" | "dudoso";

const VEREDICTOS: { valor: Veredicto; etiqueta: string; icono: React.ReactNode; tono: Tone }[] = [
  { valor: "acierta", etiqueta: "Acierta", icono: <CheckCircle2 size={15} aria-hidden />, tono: "ok" },
  { valor: "no_acierta", etiqueta: "No acierta", icono: <XCircle size={15} aria-hidden />, tono: "danger" },
  { valor: "dudoso", etiqueta: "Dudoso", icono: <CircleHelp size={15} aria-hidden />, tono: "pending" },
];
const TONO_SEVERIDAD: Record<string, Tone> = { alta: "danger", media: "warn", baja: "muted" };
const porcentaje = (v: number | null) => (v == null ? "Sin datos" : `${Math.round(v * 100)} %`);

export default function PanelSenales() {
  return (
    <AdminShell
      title="Indicadores en observación"
      subtitle="Revisa una muestra de cada indicador nuevo: con 40 casos decididos se sabe cuántas veces acierta"
      actions={
        <button type="button" onClick={() => refrescarAdmin("/senales-observacion")} className={claseBoton("secundario")}>
          <RefreshCw size={15} aria-hidden /> Actualizar
        </button>
      }
    >
      <Suspense fallback={<SkeletonPanel lineas={6} />}>
        <Contenido />
      </Suspense>
    </AdminShell>
  );
}

function useParametro() {
  const params = useSearchParams();
  const router = useRouter();
  const ruta = usePathname();
  const poner = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) (v ? p.set(k, v) : p.delete(k));
    router.replace(`${ruta}${p.size ? `?${p}` : ""}`, { scroll: false });
  };
  return { tipo: params.get("tipo"), ver: params.get("ver") === "revisados" ? "revisados" : "pendientes", poner } as const;
}

function Contenido() {
  const { data, error, isLoading, mutate } = useAdmin<Resumen>("/senales-observacion");
  const { tipo, ver, poner } = useParametro();
  const elegido = data?.data.find((x) => x.tipo === tipo);
  const pendientes = (data?.data ?? []).filter((x) => x.enObservacion);
  const porRevisar = pendientes.reduce((s, x) => s + Math.max(0, (data?.minimo ?? 40) - x.decididos), 0);
  const revisados = (data?.data ?? []).reduce((s, x) => s + x.aciertan + x.noAciertan + x.dudosos, 0);

  if (tipo && elegido) return <ColaDeRevision indicador={elegido} minimo={data!.minimo} ver={ver} poner={poner} onCambio={() => mutate()} />;

  const columnas: Columna<Indicador>[] = [
    { clave: "indicador", titulo: "Indicador", principal: true, celda: (x) => <span className="font-medium text-ink">{x.etiqueta}</span> },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (x) => <Badge tono={x.enObservacion ? "pending" : "ok"}>{x.enObservacion ? "En observación" : "Puntúa"}</Badge>,
    },
    { clave: "casos", titulo: "Casos", alinear: "derecha", celda: (x) => <span className="font-mono">{fmtNum(x.casos)}</span> },
    {
      clave: "revisados",
      titulo: "Decididos",
      alinear: "derecha",
      celda: (x) => <span className="font-mono">{fmtNum(x.decididos)} de {fmtNum(Math.min(data?.minimo ?? 40, x.casos))}</span>,
    },
    {
      clave: "precision",
      titulo: "Acierta",
      alinear: "derecha",
      celda: (x) => (
        <span className="font-mono" title={x.precisionMinima != null ? `Como mínimo ${porcentaje(x.precisionMinima)} (95 %)` : undefined}>
          {porcentaje(x.precision)}
        </span>
      ),
    },
    {
      clave: "accion",
      titulo: "",
      acciones: true,
      celda: (x) => (
        <button type="button" className={claseBoton("secundario", "sm")} onClick={() => poner({ tipo: x.tipo, ver: null })}>
          Revisar
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} onReintentar={() => mutate()} />
      <StatGrid columnas={3}>
        <StatCard etiqueta="En observación" valor={data ? pendientes.length : null} pista="indicadores que todavía no puntúan" cargando={isLoading} />
        <StatCard etiqueta="Casos por decidir" valor={data ? porRevisar : null} pista={`hasta ${data?.minimo ?? 40} por indicador`} cargando={isLoading} />
        <StatCard etiqueta="Revisados" valor={data ? revisados : null} pista="entre todos los indicadores" cargando={isLoading} />
      </StatGrid>
      <Card>
        <ol className="list-decimal space-y-1.5 pl-5 text-meta leading-relaxed text-inkSoft">
          <li>Elige un indicador y abre cada caso de la muestra: el orden es al azar, para que la precisión valga para todo el indicador.</li>
          <li>Lee la evidencia en la ficha del contrato y marca <b>Acierta</b> si el hecho es cierto y merece que un investigador lo mire.</li>
          <li>
            Marca <b>No acierta</b> si el dato está mal (lectura equivocada, homónimo, fecha) o si el hecho es normal y no dice nada; <b>Dudoso</b> si
            no se puede saber sin más documentos.
          </li>
        </ol>
      </Card>
      <DataTable
        columnas={columnas}
        filas={data?.data}
        claveFila={(x) => x.tipo}
        etiqueta="Indicadores en observación"
        onFila={(x) => poner({ tipo: x.tipo, ver: null })}
        cargando={isLoading}
        vacio={<EmptyState titulo="Sin indicadores en observación" descripcion="Todos los indicadores nuevos ya se midieron." />}
      />
    </div>
  );
}

function ColaDeRevision({
  indicador,
  minimo,
  ver,
  poner,
  onCambio,
}: {
  indicador: Indicador;
  minimo: number;
  ver: "pendientes" | "revisados";
  poner: (c: Record<string, string | null>) => void;
  onCambio: () => void;
}) {
  const [pagina, setPagina] = useState(1);
  const ruta = `/senales-observacion/${indicador.tipo}?ver=${ver}&page=${pagina}&size=10`;
  const { data, error, isLoading, mutate } = useAdmin<Cola>(ruta);
  const { rol } = useSesionEquipo();
  const [aviso, setAviso] = useState<string | null>(null);

  const graduar = async (accion: "graduar" | "observar") => {
    try {
      await adminFetch(`/senales-observacion/${indicador.tipo}/${accion}`, { method: "POST", body: "{}" });
      setAviso(accion === "graduar" ? "Graduado: puntúa desde el próximo refresco de los cruces." : "Devuelto a observación.");
      onCambio();
    } catch (e) {
      setAviso((e as Error).message);
    }
  };

  return (
    <div className="space-y-5">
      <button type="button" onClick={() => poner({ tipo: null, ver: null })} className={claseBoton("fantasma", "sm")}>
        <ArrowLeft size={15} aria-hidden /> Todos los indicadores
      </button>
      <StatGrid columnas={4}>
        <StatCard etiqueta="Casos del indicador" valor={indicador.casos} pista={plural(indicador.procesos, "proceso", "procesos")} />
        <StatCard etiqueta="Decididos" valor={`${indicador.decididos} de ${minimo}`} pista={`${plural(indicador.dudosos, "dudoso", "dudosos")} aparte`} />
        <StatCard etiqueta="Acierta" valor={porcentaje(indicador.precision)} pista={indicador.precisionMinima != null ? `como mínimo ${porcentaje(indicador.precisionMinima)}` : "sin casos todavía"} />
        <StatCard
          etiqueta="Frecuencia"
          valor={indicador.tasaBase ? porcentaje(indicador.tasaBase.casos / Math.max(1, indicador.tasaBase.universo)) : "Sin medir"}
          pista={indicador.tasaBase?.que}
        />
      </StatGrid>
      {aviso ? <Aviso tono="brand" titulo={aviso} /> : null}
      {rol === "admin" ? (
        indicador.enObservacion ? (
          <Aviso
            tono={indicador.puedeGraduar ? "ok" : "neutral"}
            titulo={indicador.puedeGraduar ? "Ya se puede graduar" : `Faltan ${minimo - indicador.decididos} casos decididos para poder graduarlo`}
            acciones={
              indicador.puedeGraduar ? (
                <button type="button" className={claseBoton("primario", "sm")} onClick={() => graduar("graduar")}>
                  <GraduationCap size={15} aria-hidden /> Graduar: que puntúe
                </button>
              ) : undefined
            }
          >
            Graduarlo lo hace contar para el riesgo de cada contrato. Decide con la precisión de arriba: el mínimo creíble es lo que
            acierta como poco con lo revisado.
          </Aviso>
        ) : (
          <Aviso
            tono="ok"
            titulo="Este indicador ya puntúa"
            acciones={
              <button type="button" className={claseBoton("secundario", "sm")} onClick={() => graduar("observar")}>
                <Undo2 size={15} aria-hidden /> Volver a observación
              </button>
            }
          />
        )
      ) : null}
      <FilterChips<"pendientes" | "revisados">
        etiqueta="Qué casos ver"
        valor={ver}
        onCambiar={(v) => {
          setPagina(1);
          poner({ ver: v === "revisados" ? "revisados" : null });
        }}
        opciones={[
          { valor: "pendientes", etiqueta: "Por revisar" },
          { valor: "revisados", etiqueta: "Revisados", cuenta: indicador.aciertan + indicador.noAciertan + indicador.dudosos },
        ]}
      />
      <ErrorBanner error={error} onReintentar={() => mutate()} />
      {isLoading && !data ? <SkeletonPanel lineas={5} /> : null}
      {data && !data.data.length ? (
        <EmptyState titulo={ver === "pendientes" ? "No quedan casos por revisar" : "Todavía no hay casos revisados"} descripcion="" />
      ) : null}
      <div className="space-y-4">
        {data?.data.map((caso) => (
          <TarjetaCaso key={`${caso.ocid}|${caso.ruc}`} tipo={indicador.tipo} caso={caso} onGuardado={() => { mutate(); onCambio(); }} />
        ))}
      </div>
      {data && data.total > data.size ? (
        <div className="flex items-center justify-between gap-3">
          <button type="button" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)} className={claseBoton("secundario", "sm")}>
            Anteriores
          </button>
          <span className="text-meta text-inkSoft">
            Página {pagina} de {Math.ceil(data.total / data.size)}
          </span>
          <button type="button" disabled={pagina * data.size >= data.total} onClick={() => setPagina((p) => p + 1)} className={claseBoton("secundario", "sm")}>
            Siguientes
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** Los datos simples del detalle del cruce (números, textos, sí o no), con su clave legible. */
function datosDelDetalle(d: Record<string, unknown> | null): [string, string][] {
  if (!d) return [];
  const fuera = new Set(["en_observacion", "documento_sha256", "documento", "lector", "modelo"]);
  return Object.entries(d)
    .filter(([k, v]) => !fuera.has(k) && v != null && v !== "" && ["string", "number", "boolean"].includes(typeof v))
    .slice(0, 12)
    .map(([k, v]) => [k.replace(/_/g, " "), typeof v === "boolean" ? (v ? "sí" : "no") : String(v).slice(0, 160)]);
}

function TarjetaCaso({ tipo, caso, onGuardado }: { tipo: string; caso: Caso; onGuardado: () => void }) {
  const [nota, setNota] = useState(caso.nota ?? "");
  const [guardando, setGuardando] = useState<Veredicto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const datos = datosDelDetalle(caso.detalle);

  const marcar = async (veredicto: Veredicto) => {
    setGuardando(veredicto);
    setError(null);
    try {
      await adminFetch(`/senales-observacion/${tipo}/veredicto`, {
        method: "POST",
        body: JSON.stringify({ ocid: caso.ocid, ruc: caso.ruc, veredicto, nota: nota.trim() || undefined }),
      });
      onGuardado();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGuardando(null);
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tono={TONO_SEVERIDAD[caso.severidad] ?? "neutral"}>{caso.severidad}</Badge>
            <span className="font-mono text-meta text-ink">{caso.codigo ?? caso.ocid}</span>
            {caso.veredicto ? (
              <Badge tono={VEREDICTOS.find((v) => v.valor === caso.veredicto)?.tono ?? "neutral"}>
                {VEREDICTOS.find((v) => v.valor === caso.veredicto)?.etiqueta}
              </Badge>
            ) : null}
          </div>
          <p className="line-clamp-2 text-meta text-ink">{caso.objeto ?? "Sin objeto"}</p>
          <p className="text-meta text-inkSoft">
            {caso.entidad ?? "Entidad sin nombre"}, ganó {caso.empresa ?? `RUC ${caso.ruc}`}
            {caso.fecha ? `, ${caso.fecha}` : ""}
            {caso.monto != null ? `, S/ ${fmtNum(Math.round(caso.monto))}` : ""}
          </p>
        </div>
        <Link
          href={`/app/contratos/${encodeURIComponent(caso.ocid)}`}
          target="_blank"
          rel="noopener noreferrer"
          className={claseBoton("secundario", "sm")}
        >
          <ExternalLink size={15} aria-hidden /> Abrir el contrato
        </Link>
      </div>
      {datos.length ? (
        <dl className="mt-3 grid gap-x-6 gap-y-1.5 text-meta sm:grid-cols-2">
          {datos.map(([k, v]) => (
            <div key={k} className="flex min-w-0 gap-2">
              <dt className="shrink-0 text-inkSoft first-letter:uppercase">{k}</dt>
              <dd className="min-w-0 truncate font-medium text-ink" title={v}>
                {v}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <label className="mt-3 block text-meta text-inkSoft">
        Nota (opcional)
        <textarea
          value={nota}
          onChange={(e) => setNota(e.target.value)}
          maxLength={1000}
          rows={2}
          className="mt-1 block w-full rounded-lg border border-line bg-caja px-3 py-2 text-meta text-ink"
        />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        {VEREDICTOS.map((v) => (
          <button
            key={v.valor}
            type="button"
            disabled={guardando != null}
            aria-pressed={caso.veredicto === v.valor}
            onClick={() => marcar(v.valor)}
            className={claseBoton(caso.veredicto === v.valor ? "primario" : "secundario", "sm")}
          >
            {v.icono} {guardando === v.valor ? "Guardando…" : v.etiqueta}
          </button>
        ))}
      </div>
      {error ? <p className="mt-2 text-meta text-danger">{error}</p> : null}
    </Card>
  );
}
