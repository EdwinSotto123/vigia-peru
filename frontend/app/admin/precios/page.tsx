"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleDashed, CircleSlash, ExternalLink, Loader2, Search, XCircle } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorBanner,
  Expandable,
  KeyValue,
  Panel,
  StatCard,
  StatGrid,
  claseBoton,
  hace,
  mensajeError,
  type Columna,
  type Tone,
} from "@/components/admin/ui";
import { adminFetch } from "@/lib/admin";
import { useAdmin } from "@/lib/useAdmin";

/** GET /admin/precios-lab y /admin/precios-lab/:id (backend/api/src/routes/admin_precios.ts → vigia-precios-lab). */
interface Fila {
  id: string;
  estado: Estado;
  paso: string | null;
  consulta: string;
  creado: string;
  terminado: string | null;
  costo: number;
  veredicto: string | null;
  mediana: number | null;
  validas: number | null;
  ocid: string | null;
}
type Estado = "en_cola" | "corriendo" | "listo" | "error";
interface Paso {
  nombre: string;
  estado: "corriendo" | "listo" | "error" | "saltado";
  detalle: unknown;
  inicio: string | null;
  fin: string | null;
}
interface Referencia {
  fuente: string;
  detalle: string;
  unidad: string | null;
  n: number;
  mediana: number;
}
interface Oferta {
  n: number;
  fuente: "tienda" | "web";
  tienda: string;
  titulo: string;
  marca: string | null;
  url: string;
  precio: number | null;
  moneda: string | null;
  extraccion: string;
  confirmado: boolean | null;
  vendedor: string | null;
  similitud: number | null;
  coincidencia: "exacta" | "equivalente" | "distinta" | "sin_juicio";
  unidades: number | null;
  razon: string | null;
  precioUnitario: number | null;
  valida: boolean;
  motivo: string | null;
  evidencia: string | null;
}
interface Detalle {
  id: string;
  estado: Estado;
  paso: string | null;
  consulta: string;
  error: string | null;
  creado: string;
  terminado: string | null;
  entrada: { consulta: string; unidad?: string; cantidad?: number; precioReferencia?: number; referencias?: Referencia[]; ocid?: string; item?: number };
  ficha: { nombre: string; unidad_base: string; atributos: { nombre: string; valor: string; obligatorio: boolean }[]; busquedas: string[]; busqueda_web: string } | null;
  resumen: {
    n: number;
    validas: number;
    minimo: number | null;
    p25: number | null;
    mediana: number | null;
    p75: number | null;
    maximo: number | null;
    referencia: number | null;
    razon: number | null;
    veredicto: string;
    nota: string;
  } | null;
  tokens_entrada: number;
  tokens_salida: number;
  costo_modelo: number;
  busquedas_web: number;
  costo_web: number;
  segundos_navegador: number;
  pasos: Paso[];
  ofertas: Oferta[];
}

const soles = (n: number | null | undefined) =>
  n == null ? "" : `S/ ${n.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const usd = (n: number) => `US$ ${n.toLocaleString("es-PE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
const NUM = new Intl.NumberFormat("es-PE");

const ESTADO: Record<Estado, { texto: string; tono: Tone }> = {
  en_cola: { texto: "En cola", tono: "pending" },
  corriendo: { texto: "Investigando", tono: "pending" },
  listo: { texto: "Lista", tono: "ok" },
  error: { texto: "Falló", tono: "danger" },
};
const PASOS: { clave: string; titulo: string; que: string }[] = [
  { clave: "entender", titulo: "Entender", que: "GLM 5.3 flash arma la ficha del producto y las búsquedas" },
  { clave: "tiendas", titulo: "Tiendas", que: "15 tiendas peruanas por su propia búsqueda" },
  { clave: "web", titulo: "Web", que: "Páginas de venta en el Perú (Tavily)" },
  { clave: "leer", titulo: "Leer páginas", que: "schema.org, navegador de Cloudflare o GLM sobre el texto" },
  { clave: "emparejar", titulo: "Emparejar", que: "¿Mismo producto? ¿Cuántas unidades trae?" },
  { clave: "resumir", titulo: "Resumir", que: "Validar y comparar con la referencia" },
];
const COINCIDE: Record<Oferta["coincidencia"], { texto: string; tono: Tone }> = {
  exacta: { texto: "Mismo producto", tono: "ok" },
  equivalente: { texto: "Equivalente", tono: "ok" },
  distinta: { texto: "Otro producto", tono: "muted" },
  sin_juicio: { texto: "Sin juicio", tono: "muted" },
};
const LECTURA: Record<string, string> = {
  api_tienda: "Búsqueda de la tienda",
  json_ld: "schema.org (JSON-LD)",
  microdatos: "schema.org (microdatos)",
  open_graph: "Open Graph",
  ia: "GLM sobre el texto",
  navegador_json_ld: "Navegador y schema.org",
  navegador_ia: "Navegador y GLM",
};
const tonoVeredicto = (v: string): Tone => (/muy por encima/i.test(v) ? "danger" : /por encima/i.test(v) ? "warn" : /en línea|por debajo|encontrado/i.test(v) ? "ok" : "muted");

/** El detalle de un paso, en palabras («12 ofertas», «3 sin precio»). */
function detallePaso(d: unknown): string {
  if (d == null) return "";
  if (typeof d === "string") return d;
  if (typeof d !== "object") return String(d);
  const o = d as Record<string, unknown>;
  const partes: string[] = [];
  const nombres: Record<string, string> = {
    ofertas: "ofertas", paginas: "páginas", ok: "con precio", sin_precio: "sin precio", robots: "no permitidas por robots.txt", rechazo: "rechazaron la lectura",
    error: "con error", navegador: "abiertas con navegador", ia: "leídas por GLM", exactas: "mismo producto", equivalentes: "equivalentes", distintas: "otro producto",
    sinJuicio: "sin juicio", validas: "válidas",
  };
  for (const [k, v] of Object.entries(o)) {
    if (k === "busquedas" && Array.isArray(v)) partes.push(`busca ${v.map((x) => `«${x}»`).join(", ")}`);
    else if (k === "unidad") partes.push(`por ${v}`);
    else if (k === "via") partes.push(v === "duckduckgo" ? "por DuckDuckGo" : "por Tavily");
    else if (k === "veredicto") partes.push(String(v));
    else if (k === "tiendas" && v && typeof v === "object") partes.push(`${Object.values(v as Record<string, string>).filter((x) => /productos/.test(x)).length} tiendas con resultados`);
    else if (typeof v === "number" && nombres[k]) partes.push(`${NUM.format(v)} ${nombres[k]}`);
  }
  return partes.join("; ");
}

function IconoPaso({ estado }: { estado: Paso["estado"] | undefined }) {
  if (estado === "listo") return <CheckCircle2 size={16} className="text-mossTexto" aria-hidden />;
  if (estado === "corriendo") return <Loader2 size={16} className="animate-spin text-clayTexto" aria-hidden />;
  if (estado === "error") return <XCircle size={16} className="text-crimsonTexto" aria-hidden />;
  if (estado === "saltado") return <CircleSlash size={16} className="text-mute" aria-hidden />;
  return <CircleDashed size={16} className="text-mute" aria-hidden />;
}

function Formulario({ onCreada }: { onCreada: (id: string) => void }) {
  const [modo, setModo] = useState<"texto" | "contrato">("texto");
  const [consulta, setConsulta] = useState("");
  const [especificacion, setEspecificacion] = useState("");
  const [unidad, setUnidad] = useState("");
  const [precio, setPrecio] = useState("");
  const [ocid, setOcid] = useState("");
  const [item, setItem] = useState("");
  const [web, setWeb] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const cuerpo: Record<string, unknown> = { web };
    if (modo === "contrato") {
      if (!/^[A-Za-z0-9-]{3,80}$/.test(ocid.trim())) return setError("Escribe el código del contrato (por ejemplo 1212841).");
      cuerpo.ocid = ocid.trim();
      if (item.trim()) cuerpo.item = Number(item);
    } else if (consulta.trim().length < 3) {
      return setError("Escribe el producto que quieres investigar.");
    }
    if (consulta.trim()) cuerpo.consulta = consulta.trim();
    if (especificacion.trim()) cuerpo.especificacion = especificacion.trim();
    if (unidad.trim()) cuerpo.unidad = unidad.trim();
    const p = Number(precio.replace(",", "."));
    if (precio.trim() && p > 0) cuerpo.precioReferencia = p;
    setEnviando(true);
    try {
      const r = await adminFetch<{ id: string }>("/precios-lab", { method: "POST", body: JSON.stringify(cuerpo) });
      onCreada(r.id);
      setConsulta("");
      setEspecificacion("");
      setPrecio("");
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  const campo = "min-h-[38px] w-full rounded-lg border border-line bg-paperDeep px-3 text-dato text-ink placeholder:text-mute focus:border-granate/60";
  return (
    <Panel titulo="Nueva investigación" descripcion="Cada una cuesta centavos: GLM 5.3 flash y, si la dejas, una búsqueda web.">
      <form onSubmit={enviar} className="space-y-3">
        <div role="radiogroup" aria-label="De dónde sale el producto" className="flex flex-wrap gap-2">
          {(["texto", "contrato"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={modo === m}
              onClick={() => setModo(m)}
              className={claseBoton(modo === m ? "primario" : "secundario", "sm")}
            >
              {m === "texto" ? "Escribir el producto" : "Desde un contrato"}
            </button>
          ))}
        </div>
        {modo === "contrato" && (
          <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
            <label className="space-y-1">
              <span className="text-meta text-mute">Código del contrato</span>
              <input className={campo} value={ocid} onChange={(e) => setOcid(e.target.value)} placeholder="1212841" inputMode="text" />
            </label>
            <label className="space-y-1">
              <span className="text-meta text-mute">Ítem</span>
              <input className={campo} value={item} onChange={(e) => setItem(e.target.value.replace(/\D/g, ""))} placeholder="1" inputMode="numeric" />
            </label>
          </div>
        )}
        <label className="block space-y-1">
          <span className="text-meta text-mute">{modo === "contrato" ? "Producto (opcional: si lo dejas vacío, se usa el del ítem)" : "Producto"}</span>
          <input
            className={campo}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            maxLength={300}
            placeholder="Papel bond A4 75 g, paquete de 500 hojas"
          />
        </label>
        <Expandable resumen="Especificación, unidad y precio a comparar" variante="caja">
          <div className="space-y-3 pt-1">
            <label className="block space-y-1">
              <span className="text-meta text-mute">Especificación técnica (lo que piden las bases)</span>
              <textarea className={`${campo} min-h-[96px] py-2`} value={especificacion} onChange={(e) => setEspecificacion(e.target.value)} maxLength={20000} />
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1">
                <span className="text-meta text-mute">Unidad</span>
                <input className={campo} value={unidad} onChange={(e) => setUnidad(e.target.value)} placeholder="paquete" maxLength={60} />
              </label>
              <label className="space-y-1">
                <span className="text-meta text-mute">Precio unitario a comparar (S/)</span>
                <input className={campo} value={precio} onChange={(e) => setPrecio(e.target.value)} placeholder="25.90" inputMode="decimal" />
              </label>
            </div>
          </div>
        </Expandable>
        <label className="flex items-center gap-2 text-dato text-ink">
          <input type="checkbox" checked={web} onChange={(e) => setWeb(e.target.checked)} className="h-4 w-4 accent-granate" />
          Buscar también en la web (unos US$ 0,008 por búsqueda)
        </label>
        {error && <p className="text-meta text-crimsonTexto">{error}</p>}
        <button type="submit" disabled={enviando} className={claseBoton("primario", "md")}>
          {enviando ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Search size={14} aria-hidden />} Investigar precio
        </button>
      </form>
    </Panel>
  );
}

function VistaDetalle({ id }: { id: string }) {
  const { data, error, mutate } = useAdmin<Detalle>(`/precios-lab/${id}`, {
    refreshInterval: (d) => (d && (d.estado === "listo" || d.estado === "error") ? 0 : 3_000),
  });
  const [verTodas, setVerTodas] = useState(false);
  if (error) return <ErrorBanner error={error} titulo="No se pudo leer la investigación" onReintentar={() => mutate()} />;
  if (!data) return <Panel titulo="Cargando la investigación"><Loader2 size={16} className="animate-spin text-mute" aria-hidden /></Panel>;
  const r = data.resumen;
  const pasos = new Map(data.pasos.map((p) => [p.nombre, p]));
  const ofertas = verTodas ? data.ofertas : data.ofertas.filter((o) => o.valida || o.coincidencia === "exacta" || o.coincidencia === "equivalente");
  const costo = data.costo_modelo + data.costo_web;
  const refs = data.entrada.referencias ?? [];

  const columnas: Columna<Oferta>[] = [
    {
      clave: "titulo",
      titulo: "Oferta",
      principal: true,
      celda: (o) => (
        <span className="block min-w-0">
          <a href={o.url} target="_blank" rel="noreferrer" className="text-ink underline-offset-2 hover:underline">
            {o.titulo}
          </a>
          <span className="block text-meta text-mute">
            {o.tienda}
            {o.vendedor ? `, vende ${o.vendedor}` : ""}
            {o.marca ? `, marca ${o.marca}` : ""}
          </span>
        </span>
      ),
    },
    { clave: "precio", titulo: "Precio", alinear: "derecha", celda: (o) => (o.moneda && o.moneda !== "PEN" ? `${o.moneda} ${o.precio}` : soles(o.precio)) },
    { clave: "unidades", titulo: "Unidades", alinear: "derecha", soloEscritorio: true, celda: (o) => (o.unidades != null ? NUM.format(o.unidades) : "") },
    { clave: "unitario", titulo: "Por unidad", alinear: "derecha", celda: (o) => <span className={o.valida ? "font-semibold" : "text-mute"}>{soles(o.precioUnitario)}</span> },
    {
      clave: "coincide",
      titulo: "Juicio",
      celda: (o) => (
        <span className="block">
          <Badge tono={COINCIDE[o.coincidencia].tono}>{COINCIDE[o.coincidencia].texto}</Badge>
          {o.razon && <span className="mt-0.5 block text-meta text-mute">{o.razon}</span>}
        </span>
      ),
      anchoCompletoMovil: true,
    },
    {
      clave: "lectura",
      titulo: "Cómo se leyó",
      soloEscritorio: true,
      celda: (o) => (
        <span className="block text-meta">
          {LECTURA[o.extraccion] ?? o.extraccion}
          {o.confirmado === true ? ", precio visto en la página" : o.confirmado === false ? ", precio NO visto en la página" : ""}
          {o.evidencia && (
            <a
              href={`/api/admin/precios-lab/${data.id}/evidencia/${o.evidencia.split("/").pop()}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 inline-flex items-center gap-0.5 text-granate underline-offset-2 hover:underline"
            >
              evidencia <ExternalLink size={11} aria-hidden />
            </a>
          )}
        </span>
      ),
    },
    {
      clave: "valida",
      titulo: "Cuenta",
      celda: (o) => (o.valida ? <Badge tono="ok">Sí</Badge> : <span className="text-meta text-mute">{o.motivo ?? "No"}</span>),
    },
  ];

  return (
    <div className="space-y-5">
      <Panel
        titulo={data.consulta}
        descripcion={`Pedida ${hace(data.creado) ?? ""}${data.entrada.ocid ? `, del contrato ${data.entrada.ocid}${data.entrada.item ? ` ítem ${data.entrada.item}` : ""}` : ""}`}
        acciones={<Badge tono={ESTADO[data.estado].tono}>{ESTADO[data.estado].texto}</Badge>}
      >
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PASOS.map((p, i) => {
            const e = pasos.get(p.clave);
            return (
              <li key={p.clave} className="flex gap-2 rounded-lg border border-line bg-paperSoft p-3">
                <IconoPaso estado={e?.estado} />
                <div className="min-w-0">
                  <p className="text-dato font-medium text-ink">
                    {i + 1}. {p.titulo}
                  </p>
                  <p className="text-meta text-mute">{e?.detalle ? detallePaso(e.detalle) : p.que}</p>
                </div>
              </li>
            );
          })}
        </ol>
        {data.error && <p className="mt-3 text-meta text-crimsonTexto">Falló: {data.error}</p>}
      </Panel>

      {r && (
        <>
          <StatGrid columnas={4}>
            <StatCard etiqueta="Precio de mercado (mediana)" valor={r.mediana != null ? soles(r.mediana) : "Sin dato"} pista={data.ficha ? `por ${data.ficha.unidad_base}` : undefined} />
            <StatCard etiqueta="La mitad está entre" valor={r.p25 != null ? `${soles(r.p25)} y ${soles(r.p75)}` : "Sin dato"} pista={r.minimo != null ? `de ${soles(r.minimo)} a ${soles(r.maximo)}` : undefined} />
            <StatCard etiqueta="Ofertas que cuentan" valor={`${NUM.format(r.validas)} de ${NUM.format(r.n)}`} pista="mismo producto o equivalente, con precio confirmado" />
            <StatCard
              etiqueta="Frente a la referencia"
              valor={r.razon != null ? `${r.razon.toLocaleString("es-PE")} veces` : "Sin referencia"}
              pista={r.referencia != null ? `${soles(r.referencia)} por unidad` : "Escribe un precio a comparar o parte de un contrato"}
              tono={tonoVeredicto(r.veredicto) === "danger" ? "danger" : tonoVeredicto(r.veredicto) === "warn" ? "warn" : "neutral"}
            />
          </StatGrid>
          <Panel titulo={r.veredicto} tono={tonoVeredicto(r.veredicto)}>
            <p className="text-dato text-ink">{r.nota}</p>
            {refs.length > 0 && (
              <ul className="mt-2 space-y-1 text-meta text-inkSoft">
                {refs.map((x) => (
                  <li key={x.fuente}>
                    El Estado: mediana de {soles(x.mediana)}
                    {x.unidad ? ` por ${x.unidad.toLowerCase()}` : ""} en {x.detalle}.
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}

      {data.ficha && (
        <Expandable resumen="Lo que entendió el modelo" meta={data.ficha.nombre}>
          <KeyValue
            items={[
              { etiqueta: "Producto", valor: data.ficha.nombre },
              { etiqueta: "Se compara por", valor: data.ficha.unidad_base },
              { etiqueta: "Atributos", valor: data.ficha.atributos.map((a) => `${a.nombre}: ${a.valor}${a.obligatorio ? " (obligatorio)" : ""}`).join("; "), completo: true },
              { etiqueta: "Búsquedas en tiendas", valor: data.ficha.busquedas.map((b) => `«${b}»`).join(", "), completo: true },
              { etiqueta: "Búsqueda web", valor: data.ficha.busqueda_web, completo: true },
            ]}
          />
        </Expandable>
      )}

      {data.ofertas.length > 0 && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-dato font-semibold text-ink">Ofertas</h3>
            <button type="button" className={claseBoton("fantasma", "sm")} onClick={() => setVerTodas((v) => !v)}>
              {verTodas ? "Solo las que coinciden" : `Ver las ${NUM.format(data.ofertas.length)}, también las descartadas`}
            </button>
          </div>
          <DataTable etiqueta="Ofertas encontradas" columnas={columnas} filas={ofertas} claveFila={(o) => String(o.n)} porPagina={25} apilarHasta="lg" />
        </section>
      )}

      <p className="text-meta text-mute">
        Gasto: {usd(costo)} ({NUM.format(data.tokens_entrada + data.tokens_salida)} tokens de GLM 5.3 flash
        {data.busquedas_web ? `, ${data.busquedas_web} búsqueda web` : ""}
        {data.segundos_navegador ? `, ${Math.round(data.segundos_navegador)} s de navegador` : ""}).
      </p>
    </div>
  );
}

function Laboratorio() {
  const params = useSearchParams();
  const router = useRouter();
  const id = params.get("id");
  const { data, error, mutate, isLoading } = useAdmin<{ investigaciones: Fila[]; total: { n: number; costo: number } }>("/precios-lab", { refreshInterval: 10_000 });
  const elegir = (nuevo: string | null) => router.replace(nuevo ? `/admin/precios?id=${nuevo}` : "/admin/precios", { scroll: false });

  const columnas: Columna<Fila>[] = [
    { clave: "consulta", titulo: "Producto", principal: true, celda: (f) => f.consulta },
    {
      clave: "estado",
      titulo: "Estado",
      celda: (f) => <Badge tono={ESTADO[f.estado].tono}>{f.estado === "corriendo" && f.paso ? `${ESTADO[f.estado].texto}: ${f.paso}` : ESTADO[f.estado].texto}</Badge>,
    },
    { clave: "veredicto", titulo: "Resultado", celda: (f) => f.veredicto ?? "" , anchoCompletoMovil: true },
    { clave: "mediana", titulo: "Mediana", alinear: "derecha", celda: (f) => soles(f.mediana) },
    { clave: "costo", titulo: "Costo", alinear: "derecha", soloEscritorio: true, celda: (f) => usd(f.costo ?? 0) },
    { clave: "creado", titulo: "Cuándo", alinear: "derecha", celda: (f) => hace(f.creado) ?? "" },
  ];

  return (
    <AdminShell title="Laboratorio de precios" subtitle="Precio de mercado de un producto: tiendas peruanas, la web y lo que pagó el Estado, con GLM 5.3 flash">
      <div className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
          <Formulario
            onCreada={(nuevo) => {
              mutate();
              elegir(nuevo);
            }}
          />
          <div className="min-w-0 space-y-3">
            {error && <ErrorBanner error={error} titulo="No se pudo leer el laboratorio" onReintentar={() => mutate()} />}
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-dato font-semibold text-ink">Investigaciones</h2>
              {data && (
                <span className="text-meta text-mute">
                  {NUM.format(data.total.n)} en total, {usd(data.total.costo ?? 0)} gastados
                </span>
              )}
            </div>
            <DataTable
              etiqueta="Investigaciones de precio"
              columnas={columnas}
              filas={data?.investigaciones}
              claveFila={(f) => f.id}
              onFila={(f) => elegir(f.id)}
              cargando={isLoading}
              porPagina={10}
              vacio={<EmptyState compacto titulo="Todavía no hay investigaciones" descripcion="Escribe un producto o parte de un contrato." />}
            />
          </div>
        </div>
        {id ? <VistaDetalle id={id} /> : null}
      </div>
    </AdminShell>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Laboratorio />
    </Suspense>
  );
}
