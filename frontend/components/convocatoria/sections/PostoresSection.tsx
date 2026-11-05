"use client";

/**
 * Quién se registró y quién ganó según el registro OCDS, en una tabla (antes, tarjetas apiladas con un círculo por fila).
 * El OCDS llama «postor» a todo participante registrado: lo que pasó con cada OFERTA (admitida, descalificada y por qué)
 * sale del acta y se cuenta en la pestaña del proveedor («Contra quién compitió»).
 */

import { CeldaNumero, CeldaPrincipal, CeldaTexto, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { plural } from "@/lib/formato";
import { PersonName, Ruc, esPersonaNatural } from "../../Redact";

/** Roles OCDS → castellano. "tenderer + supplier" no le dice nada a nadie. */
const ROL: Record<string, string> = {
  tenderer: "postor",
  supplier: "adjudicatario",
  buyer: "entidad compradora",
  procuringEntity: "entidad convocante",
  payer: "pagador",
};

function rolesLegibles(roles: unknown): string | null {
  if (!Array.isArray(roles) || roles.length === 0) return null;
  const txt = Array.from(new Set(roles.map((r) => ROL[String(r)] ?? String(r).replace(/_/g, " "))));
  const t = txt.join(" y ");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const COLUMNAS: Columna[] = [
  { clave: "postor", titulo: "Postor", ancho: "minmax(0,1.5fr)" },
  { clave: "rol", titulo: "En el registro", ancho: "minmax(8rem,0.8fr)", desde: "md", apilar: true, igual: { texto: "Todos: {}" } },
  { clave: "monto", titulo: "Adjudicado", ancho: "9rem", alinear: "der", desde: "md", apilar: "con-rotulo", igual: { vacia: "Sin monto adjudicado" } },
];

export function PostoresSection({ postores, fmtMoney }: { postores: any[]; fmtMoney: (n: any) => string }) {
  const ganadores = postores.filter((p) => p.es_ganador);
  // El ganador primero: es la fila que se busca.
  const orden = [...postores].sort((a, b) => Number(!!b.es_ganador) - Number(!!a.es_ganador));
  const filas: Fila[] = orden.map((p, i) => {
    const natural = esPersonaNatural(p.ruc);
    const ruc20 = typeof p.ruc === "string" && /^20\d{9}$/.test(p.ruc);
    const roles = rolesLegibles(p.roles);
    const monto = p.monto_ganado != null && p.monto_ganado > 0 ? fmtMoney(p.monto_ganado) : null;
    return {
      id: `o-${i}`,
      resaltada: !!p.es_ganador,
      href: ruc20 ? `/empresa/${p.ruc}` : undefined,
      celdas: {
        postor: (
          <CeldaPrincipal
            // Persona natural con negocio (RUC 10): su nombre viene en orden SUNAT y se tapa el apellido materno.
            titulo={natural ? <PersonName name={p.nombre} orden="sunat" /> : p.nombre || "Sin razón social"}
            textoCompleto={natural ? undefined : p.nombre}
            dosLineas
            meta={[
              p.es_ganador && (
                <span key="g" className="pill border-granate/30 bg-granate-50 font-semibold text-granate">
                  Ganó
                </span>
              ),
              p.ruc && (
                <Dato key="ruc" tipo="ruc" mono>
                  <Ruc value={p.ruc} />
                </Dato>
              ),
              p.es_consorcio && <Dato key="c" tipo="personas">Consorcio</Dato>,
              natural && <Dato key="n" tipo="tipo">Persona natural</Dato>,
            ]}
          />
        ),
        rol: <CeldaTexto>{roles ?? "Sin rol"}</CeldaTexto>,
        monto: monto ? <CeldaNumero>{monto}</CeldaNumero> : <span className="text-meta text-mute">Sin monto</span>,
      },
      textos: { rol: roles, monto },
      buscable: natural ? undefined : [p.nombre, p.ruc].filter(Boolean).join(" "),
    };
  });
  return (
    <section className="space-y-3">
      <div>
        <h2 className="font-display text-bloque font-bold text-ink">Quién se registró y quién ganó</h2>
        <p className="mt-0.5 text-meta text-mute">
          {plural(postores.length, "postor registrado", "postores registrados")}, {plural(ganadores.length, "ganador", "ganadores")}. Fuente: registro OCDS del OECE.
        </p>
      </div>
      <TablaPaginada
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Postores del registro OCDS"
        nombre="postores"
        tam={10}
        controles="abajo"
        medida="contenedor"
        colapsarIguales
        buscar={{ placeholder: "Buscar un postor por razón social o RUC…", etiqueta: "Buscar en los postores" }}
      />
    </section>
  );
}
