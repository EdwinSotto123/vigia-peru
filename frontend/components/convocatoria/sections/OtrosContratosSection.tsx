"use client";

/**
 * «Otros contratos» del proveedor, en una tabla: las buenas pro del CONOSCE que trae el expediente (lo oficial, con su
 * código y a su ficha en Vigía) y, para lo que no esté ahí, lo que encontró el agente web (a su fuente). Marcados los
 * que son con ESTA entidad. Antes eran tarjetas apiladas con un «Fuente» suelto en cada una.
 */

import { CeldaFecha, CeldaNumero, CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { oracion, plural } from "@/lib/formato";
import { rutaContrato } from "@/lib/rutas";
import { redactDnis } from "../../Redact";
import { montoDossier } from "../dossier";
import type { FilaContrato } from "./red/proveedor";

const COLUMNAS: Columna[] = [
  { clave: "contrato", titulo: "Contrato", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Monto", ancho: "9rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
  { clave: "fecha", titulo: "Buena pro", ancho: "7.5rem", alinear: "der", desde: "md", apilar: "con-rotulo" },
];

/** Lo que encontró el agente web, como filas (para quien llama con `otros`, sin el expediente). */
function filasDeWeb(otros: any[]): FilaContrato[] {
  return otros.map((c, i): FilaContrato => ({
    id: `w-${i}`,
    objeto: c?.objeto ?? null,
    entidad: c?.entidad ?? null,
    codigo: c?.ocid_o_contrato ? String(c.ocid_o_contrato) : null,
    monto: typeof c?.monto === "number" ? c.monto : null,
    fecha: c?.fecha ?? null,
    conEsta: false,
    quien: null,
    url: typeof c?.url === "string" && /^https?:\/\//i.test(c.url) ? c.url : null,
    fuente: "web",
  }));
}

export function OtrosContratosSection({
  otros = [],
  relacion,
  fmtMoney = montoDossier,
  filas: filasDadas,
}: {
  otros?: any[];
  relacion?: any;
  fmtMoney?: (n: any) => string;
  /** Las filas ya unidas (CONOSCE + web, `filasOtrosContratos`); sin ellas, las de `otros`. */
  filas?: FilaContrato[];
}) {
  const filas = filasDadas ?? filasDeWeb(otros);
  const nEsta = filas.filter((f) => f.conEsta).length;
  const tabla: Fila[] = filas.map((c) => {
    const titulo = c.objeto ? oracion(String(c.objeto)) : "Sin objeto publicado";
    // Al proceso en Vigía (su ficha, por su código del CONOSCE); lo de la web, a su fuente.
    const href = c.fuente === "CONOSCE" && c.codigo ? rutaContrato(c.codigo) : c.url ?? undefined;
    return {
      id: c.id,
      href,
      externo: !!href && c.fuente === "web",
      celdas: {
        contrato: (
          <CeldaPrincipal
            titulo={titulo}
            dosLineas
            metaEnVarias
            meta={[
              c.conEsta && (
                <span key="esta" className="pill border-granate/40 bg-granate-50 font-semibold text-granate">
                  Con esta entidad
                </span>
              ),
              c.codigo && <Dato key="cod" tipo="codigo" nombre="Código del proceso" mono>{c.codigo}</Dato>,
              c.entidad && <Dato key="ent" tipo="entidad">{c.entidad}</Dato>,
              c.quien && <Dato key="quien" tipo="personas" nombre="Lo ganó el integrante">{redactDnis(c.quien)}</Dato>,
              c.fuente === "web" && <Dato key="web" tipo="documento" nombre="Fuente">según la web</Dato>,
            ]}
          />
        ),
        monto: <CeldaNumero>{c.monto != null ? fmtMoney(c.monto) : "Sin dato"}</CeldaNumero>,
        fecha: <CeldaFecha fecha={c.fecha ? String(c.fecha).slice(0, 10) : null} />,
      },
      textos: { monto: c.monto != null ? fmtMoney(c.monto) : null, fecha: c.fecha ?? null },
      buscable: [titulo, c.entidad, c.codigo].filter(Boolean).join(" "),
    };
  });

  return (
    <div className="space-y-3">
      {relacion && (typeof relacion.contratos_previos === "number" || relacion.detalle) && (
        <p className="text-meta leading-relaxed text-inkSoft">
          {typeof relacion.contratos_previos === "number" && (
            <>
              Con esta entidad, según el agente:{" "}
              <strong className="font-semibold text-ink">{plural(relacion.contratos_previos, "contrato previo", "contratos previos")}</strong>.{" "}
            </>
          )}
          {redactDnis(relacion.detalle)}
        </p>
      )}
      {tabla.length > 0 ? (
        <TablaPaginada
          columnas={COLUMNAS}
          filas={tabla}
          etiqueta={`Otros contratos del proveedor${nEsta ? `, ${nEsta} con esta entidad` : ""}`}
          nombre="contratos"
          tam={10}
          controles="abajo"
          medida="contenedor"
          buscar={{ placeholder: "Buscar por objeto, entidad o código…", etiqueta: "Buscar en los otros contratos" }}
        />
      ) : (
        <p className="text-meta text-mute">No se encontraron otros contratos del proveedor con el Estado.</p>
      )}
    </div>
  );
}
