import { ArrowRight, CloudOff, History } from "lucide-react";
import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { EnlaceFuente, FuenteDato, Nota } from "@/components/patrones";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { EstadoVacio } from "@/components/ui/EstadoVacio";
import { fechaCorta, numero, plural, solesCompacto } from "@/lib/formato";
import { getHistoria, type Carril, type Historia } from "@/lib/historia";
import { LineaDeTiempo } from "./LineaDeTiempo";

/**
 * La pestaña «Historia» de una entidad, una empresa o un partido (fase 3 del plan del 2026-10-27): lo que encadenan sus
 * datos (las secuencias, primero, con su evidencia), la línea de tiempo con todos sus renglones y, debajo, la lista
 * completa de hechos con su buscador y sus filtros, cada uno con su fuente (también es la versión accesible de la
 * línea). Server component: pide GET /historia/... una vez (CDN de una hora) y le pasa todo a la línea.
 */
export async function HistoriaFicha({ tipo, id, nombre }: { tipo: Historia["sujeto"]["tipo"]; id: string; nombre: string }) {
  const h = await getHistoria(tipo, id);
  if (!h) {
    return (
      <EstadoVacio variante="compacta" tono="error" icono={<CloudOff size={16} />}>
        No pudimos armar su historia ahora. Vuelve a intentarlo en un momento.
      </EstadoVacio>
    );
  }
  if (!h.carriles.length) {
    return (
      <EstadoVacio variante="compacta" icono={<History size={16} />}>
        Todavía no hay hechos con fecha de {nombre} en las fuentes que cruza Vigía.
      </EstadoVacio>
    );
  }
  const omitidos = Object.entries(h.omitidos).filter(([, n]) => (n ?? 0) > 0) as [Carril, number][];
  const titulo = (c: Carril) => h.carriles.find((x) => x.clave === c)?.titulo ?? c;

  return (
    <div className="space-y-6">
      {h.secuencias.length > 0 && (
        <section aria-labelledby="historia-secuencias" className="space-y-2">
          <h3 id="historia-secuencias" className="font-display text-bloque font-bold text-ink">
            Lo que encadenan sus datos
          </h3>
          <ul className="grid gap-2 md:grid-cols-2">
            {/* recorte: las primeras seis; la lista de abajo (filtro «Una cosa lleva a otra») tiene todas. */}
            {h.secuencias.slice(0, 6).map((s) => (
              <li key={s.id} className="rounded-xl border border-line bg-paper px-3.5 py-3">
                <div className="flex items-start gap-2">
                  <Severidad bandera={s.severidad} formato="punto" className="mt-1.5" />
                  <div className="min-w-0 space-y-1">
                    <p className="text-meta font-semibold text-ink">{s.titulo}</p>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-rotulo text-inkSoft">
                      {s.pasos.map((p, i) => (
                        <span key={i} className="inline-flex items-center gap-1.5">
                          {i > 0 && <ArrowRight size={12} className="text-mute" aria-hidden />}
                          <span>
                            {fechaCorta(p.fecha)}: {p.texto}
                          </span>
                        </span>
                      ))}
                    </p>
                    {s.href && (
                      <Link href={s.href} prefetch={false} className="inline-block text-rotulo font-semibold text-granate underline decoration-granate/40 underline-offset-2">
                        Ver la evidencia
                      </Link>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {h.secuencias.length > 6 && <p className="text-rotulo text-mute">Y {numero(h.secuencias.length - 6)} más en la lista de abajo.</p>}
        </section>
      )}

      <section aria-labelledby="historia-linea" className="space-y-2">
        <h3 id="historia-linea" className="font-display text-bloque font-bold text-ink">
          Su línea de tiempo
        </h3>
        <LineaDeTiempo h={h} etiqueta={`Historia de ${nombre}`} />
        {omitidos.length > 0 && (
          <Nota>
            En la línea van los hechos más graves y los más grandes de cada renglón:{" "}
            {omitidos.map(([c, n]) => `${numero(n)} ${plural(n, "más", "más")} en «${titulo(c)}»`).join(", ")}. Están todos en su pestaña.
          </Nota>
        )}
      </section>

      <ListaHechos h={h} titulo={titulo} />

      <FuenteDato fuente="Las fuentes oficiales de cada hecho (en su detalle)" enlaces={h.fuentes} />
    </div>
  );
}

/** Todos los hechos y las secuencias, de lo más reciente a lo más viejo, con su buscador, sus filtros y su fuente. */
function ListaHechos({ h, titulo }: { h: Historia; titulo: (c: Carril) => string }) {
  const columnas: Columna[] = [
    { clave: "que", titulo: "Qué pasó", ancho: "minmax(0,1fr)" },
    { clave: "monto", titulo: "Monto", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const sev = (s: string | null | undefined) => (s === "alta" ? "Grave" : s === "media" ? "Medio" : s === "baja" ? "Leve" : null);
  const filas: FilaFiltrable[] = [
    ...h.secuencias.map((s) => ({
      id: `s-${s.id}`,
      celdas: {
        que: (
          <CeldaPrincipal
            titulo={s.titulo}
            meta={[
              <Dato key="f" tipo="fecha" nombre="Cuándo">{`${fechaCorta(s.pasos[0].fecha)} a ${fechaCorta(s.pasos[s.pasos.length - 1].fecha)}`}</Dato>,
              <Dato key="c" tipo="tipo" nombre="Renglón">Una cosa lleva a otra</Dato>,
            ]}
          />
        ),
        monto: <CeldaNumero>Sin monto</CeldaNumero>,
      },
      detalle: {
        titulo: s.titulo,
        etiqueta: "Secuencia",
        contenido: (
          <div className="space-y-3">
            <p className="text-meta text-inkSoft">{s.explica}</p>
            <ol className="space-y-1.5">
              {s.pasos.map((p, i) => (
                <li key={i} className="text-meta text-ink">
                  <span className="font-mono text-rotulo tabular-nums text-inkSoft">{fechaCorta(p.fecha)}</span> {p.texto}
                </li>
              ))}
            </ol>
            <p className="text-rotulo text-mute">Fuente: {s.fuente}</p>
          </div>
        ),
        pie: s.href ? (
          <Link href={s.href} prefetch={false} className="text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2">
            Ver la evidencia
          </Link>
        ) : undefined,
      },
      buscable: `${s.titulo} ${s.explica} ${s.pasos.map((p) => p.texto).join(" ")}`,
      valores: { carril: "secuencias", severidad: s.severidad },
      claves: { fecha: s.pasos[s.pasos.length - 1].fecha },
    })),
    ...h.eventos.map((e) => ({
      id: `e-${e.id}`,
      celdas: {
        que: (
          <CeldaPrincipal
            titulo={e.titulo}
            meta={[
              <Dato key="f" tipo="fecha" nombre="Cuándo">{e.hasta ? `${fechaCorta(e.fecha)} a ${fechaCorta(e.hasta)}` : fechaCorta(e.fecha)}</Dato>,
              <Dato key="c" tipo="tipo" nombre="Renglón">{titulo(e.carril)}</Dato>,
              sev(e.severidad) && e.carril !== "gobierno" ? <Dato key="s" tipo="tipo" nombre="Gravedad">{sev(e.severidad)}</Dato> : null,
            ]}
          />
        ),
        monto: <CeldaNumero>{e.monto ? solesCompacto(e.monto) : "Sin monto"}</CeldaNumero>,
      },
      detalle: {
        titulo: e.titulo,
        etiqueta: titulo(e.carril),
        contenido: (
          <div className="space-y-2">
            <p className="text-meta text-inkSoft">
              {e.hasta ? `Del ${fechaCorta(e.fecha)} al ${fechaCorta(e.hasta)}` : fechaCorta(e.fecha)}
              {e.monto ? `; ${solesCompacto(e.monto)}` : ""}
            </p>
            {e.detalle && <p className="text-meta text-ink">{e.detalle}</p>}
            <p className="text-rotulo text-mute">
              Fuente: {e.enlace ? <EnlaceFuente href={e.enlace}>{e.fuente}</EnlaceFuente> : e.fuente}
            </p>
          </div>
        ),
        pie: e.href ? (
          <Link href={e.href} prefetch={false} className="text-meta font-semibold text-granate underline decoration-granate/40 underline-offset-2">
            Ver en Vigía
          </Link>
        ) : undefined,
      },
      buscable: `${e.titulo} ${e.detalle ?? ""} ${e.fuente} ${titulo(e.carril)}`,
      valores: { carril: e.carril, severidad: e.severidad ?? "ninguna" },
      claves: { fecha: e.hasta ?? e.fecha, monto: e.monto ?? 0 },
    })),
  ];
  const carriles = [...new Set(filas.map((f) => String(f.valores?.carril)))];
  return (
    <section aria-labelledby="historia-lista" className="space-y-2">
      <h3 id="historia-lista" className="font-display text-bloque font-bold text-ink">
        Todos los hechos
      </h3>
      <TablaFiltrable
        columnas={columnas}
        filas={filas}
        etiqueta="Hechos de su historia (toca uno para ver su fuente)"
        tam={20}
        nombre="hechos"
        buscar={{ placeholder: "Buscar un hecho, una entidad, una fuente…", etiqueta: "Buscar entre los hechos" }}
        filtros={[
          {
            clave: "carril",
            etiqueta: "Renglón",
            corta: "Renglón",
            opciones: carriles.map((c) => ({ valor: c, etiqueta: c === "secuencias" ? "Una cosa lleva a otra" : titulo(c as Carril) })),
          },
          {
            clave: "severidad",
            etiqueta: "Gravedad",
            corta: "Gravedad",
            opciones: [
              { valor: "alta", etiqueta: "Grave" },
              { valor: "media", etiqueta: "Medio" },
              { valor: "baja", etiqueta: "Leve" },
            ].filter((o) => filas.some((f) => f.valores?.severidad === o.valor)),
          },
        ]}
        ordenes={[
          { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
          { valor: "antiguo", etiqueta: "Lo más antiguo", clave: "fecha", dir: "asc" },
          { valor: "monto", etiqueta: "Mayor monto", clave: "monto", dir: "desc" },
        ]}
      />
    </section>
  );
}
