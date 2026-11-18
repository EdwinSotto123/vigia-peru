"use client";

import { CeldaNumero, CeldaPrincipal, TablaFiltrable, type Columna, type FilaFiltrable } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { fechaConAnio, oracion, solesCompacto } from "@/lib/formato";
import type { FilaEvidencia, NodoCaso } from "@/lib/casoPatron";

/**
 * La evidencia de un caso de patrón, una por una (cada orden o contrato, con su enlace a la lista de compras de la entidad
 * ya filtrada): con buscador, filtros por integrante y por lo que la marca (el mismo día que otra del grupo, sobre el tope,
 * el mismo objeto repartido), orden y CSV. El nombre de una persona natural no entra en lo que se busca (docs/PRIVACIDAD.md).
 */
export function EvidenciaCaso({ filas, nodos, nombre, unidad = "órdenes" }: { filas: FilaEvidencia[]; nodos: NodoCaso[]; nombre: string; unidad?: string }) {
  const tipoDe = new Map(nodos.map((n) => [n.id, n.tipo]));
  const columnas: Columna[] = [
    { clave: "que", titulo: unidad.charAt(0).toUpperCase() + unidad.slice(1), ancho: "minmax(0,1fr)" },
    { clave: "monto", titulo: "Monto", ancho: "8rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  ];
  const sinMarca = "Sin marca";
  const datos: FilaFiltrable[] = filas.map((f) => {
    const esPersona = f.nodo ? tipoDe.get(f.nodo) === "persona" : false;
    return {
      id: f.id,
      href: f.href ?? undefined,
      celdas: {
        que: (
          <CeldaPrincipal
            titulo={f.que ? oracion(f.que) : f.documento}
            textoCompleto={f.que ?? undefined}
            dosLineas
            meta={[
              f.que ? <Dato key="d" tipo="codigo" nombre="Código">{f.documento}</Dato> : null,
              f.quien ? <Dato key="q" tipo={esPersona ? "personas" : "entidad"} nombre="Proveedor">{f.quien}</Dato> : null,
              f.fecha ? <Dato key="f" tipo="fecha" nombre="Emitida">{fechaConAnio(f.fecha)}</Dato> : null,
              f.estado ? <Dato key="e" tipo="tipo" nombre="Estado">{f.estado}</Dato> : null,
              ...(f.marcas ?? []).map((m) => (
                <span key={m} className="rounded-full bg-amber-soft px-2 py-0.5 text-rotulo font-semibold text-amberTexto">
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </span>
              )),
            ]}
          />
        ),
        monto: <CeldaNumero>{f.monto != null ? `${solesCompacto(f.monto)}${f.moneda ? ` (${f.moneda.toLowerCase()})` : ""}` : "Sin monto"}</CeldaNumero>,
      },
      buscable: `${f.documento} ${f.que ?? ""} ${esPersona ? "" : f.quien ?? ""} ${(f.marcas ?? []).join(" ")}`,
      valores: { quien: f.quien ?? "Sin nombre", marca: (f.marcas ?? []).length ? f.marcas! : [sinMarca] },
      claves: { fecha: f.fecha ?? "", monto: f.monto ?? 0 },
      csv: { fecha: f.fecha, orden: f.documento, proveedor: f.quien, objeto: f.que, monto: f.monto, moneda: f.moneda ?? "Soles", estado: f.estado, marcas: (f.marcas ?? []).join("; ") || null },
    };
  });
  const quienes = [...new Set(filas.map((f) => f.quien ?? "Sin nombre"))];
  const marcas = [...new Set(filas.flatMap((f) => f.marcas ?? []))];
  return (
    <TablaFiltrable
      columnas={columnas}
      filas={datos}
      etiqueta={`${unidad.charAt(0).toUpperCase() + unidad.slice(1)} del caso (toca una fila para abrirla)`}
      tam={15}
      nombre={unidad}
      descargar={{ archivo: nombre }}
      buscar={{ placeholder: "Buscar por código, objeto o nombre…", etiqueta: `Buscar entre ${unidad === "ventas" ? "las" : unidad === "órdenes" ? "las" : "los"} ${unidad} del caso` }}
      filtros={[
        ...(quienes.length > 1 ? [{ clave: "quien", etiqueta: "Quién", corta: "Quién", opciones: quienes.map((q) => ({ valor: q, etiqueta: q })) }] : []),
        ...(marcas.length ? [{ clave: "marca", etiqueta: "Lo que la marca", corta: "Marca", opciones: [...marcas.map((m) => ({ valor: m, etiqueta: m.charAt(0).toUpperCase() + m.slice(1) })), { valor: sinMarca, etiqueta: sinMarca }] }] : []),
      ]}
      ordenes={[
        { valor: "reciente", etiqueta: "Lo más reciente", clave: "fecha", dir: "desc" },
        { valor: "antiguo", etiqueta: "Lo más antiguo", clave: "fecha", dir: "asc" },
        { valor: "monto", etiqueta: "Mayor monto", clave: "monto", dir: "desc" },
      ]}
    />
  );
}
