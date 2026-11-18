"use client";

import Link from "next/link";
import { CeldaNumero, CeldaPrincipal, CeldaTexto, CLASE_ENLACE_CELDA, Tabla, type Columna, type Fila } from "@/components/listado";
import { fechaConAnio, numero, plural, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { PatronAutoridadExsocio, PatronCompraFamilia } from "@/lib/patrones";
import { esRucEnClaro, esRucPersonaNatural } from "@/lib/privacidad";
import { detalleAutoridadExsocio, detalleCompraFamilia } from "./DetallePatron";

/**
 * Las filas de dos patrones en observación (migraciones 364-370), con su panel de detalle: «trabaja en compras y un
 * familiar cobra de su entidad» y «la autoridad dejó de figurar en una empresa que le vende». Las usan /app/patrones
 * (PatronesVista) y las fichas de entidad y de empresa (EnObservacionFicha): la misma fila dice lo mismo en los dos lados.
 */

function EnlaceEmpresa({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  const texto = nombre ? tituloNatural(nombre) : "Empresa sin nombre";
  if (!esRucEnClaro(ruc) || esRucPersonaNatural(ruc)) return <>{texto}</>;
  return (
    <Link href={`/empresa/${ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {texto}
    </Link>
  );
}

function EnlaceEntidad({ ruc, nombre }: { ruc: string; nombre: string | null }) {
  const texto = nombre ? tituloNatural(nombre) : "Entidad sin nombre";
  if (!esRucEnClaro(ruc)) return <>{texto}</>;
  return (
    <Link href={`/entidad/${ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {texto}
    </Link>
  );
}

export const COLUMNAS_AUTORIDAD_EXSOCIO: Columna[] = [
  { clave: "autoridad", titulo: "Autoridad, cargo y entidad", ancho: "minmax(0,1.5fr)" },
  { clave: "empresa", titulo: "Empresa en la que figuraba", ancho: "minmax(0,1.2fr)", desde: "md", apilar: "con-rotulo", corto: "Empresa" },
  { clave: "monto", titulo: "Le vendió en su periodo", ancho: "10rem", alinear: "der", corto: "Le vendió" },
  { clave: "salida", titulo: "Dejó de figurar", ancho: "minmax(8rem,0.7fr)", desde: "lg", apilar: "con-rotulo" },
];

export function filaAutoridadExsocio(p: PatronAutoridadExsocio, i: number): Fila {
  const total = p.ordenes + p.procesos;
  return {
    id: `autoridad-${i}`,
    detalle: detalleAutoridadExsocio(p),
    enlaces: true,
    celdas: {
      autoridad: (
        <CeldaPrincipal
          dosLineas
          titulo={<>{p.autoridad ? tituloNatural(p.autoridad) : "Autoridad electa"}</>}
          meta={
            <span className="block">
              {`${tituloNatural(p.cargo)}, `}
              <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
            </span>
          }
        />
      ),
      empresa: (
        <CeldaTexto sub={p.roles.join(", ")}>
          <EnlaceEmpresa ruc={p.empresaRuc} nombre={p.empresa} />
        </CeldaTexto>
      ),
      monto: <CeldaNumero sub={`${plural(total, "venta", "ventas")}, ${numero(p.ventasEnPlazo)} en el plazo`}>{solesCompacto(p.montoOrdenes + p.montoProcesos)}</CeldaNumero>,
      salida: <CeldaTexto sub="corte mensual del RNP">{fechaConAnio(p.bajaCorte)}</CeldaTexto>,
    },
  };
}

export const COLUMNAS_COMPRAS_FAMILIA: Columna[] = [
  { clave: "persona", titulo: "Persona, puesto y entidad", ancho: "minmax(0,1.7fr)" },
  { clave: "familiar", titulo: "Familiar que declaró", ancho: "minmax(8rem,0.8fr)", desde: "md", apilar: "con-rotulo", corto: "Familiar" },
  { clave: "monto", titulo: "Con la persona en el puesto", ancho: "11rem", alinear: "der", corto: "En el puesto" },
  { clave: "anios", titulo: "Órdenes en total", ancho: "minmax(8rem,0.7fr)", desde: "lg", apilar: "con-rotulo", corto: "En total" },
];

export function filaCompraFamilia(p: PatronCompraFamilia, i: number): Fila {
  const anios = p.desde && p.hasta ? (p.desde === p.hasta ? `${p.desde}` : `${p.desde} a ${p.hasta}`) : "Sin años";
  return {
    id: `compras-${i}`,
    detalle: detalleCompraFamilia(p),
    enlaces: true,
    celdas: {
      persona: (
        <CeldaPrincipal
          dosLineas
          titulo={
            p.codigo ? (
              <Link href={`/app/personas/cargo/${p.codigo}?seccion=revision`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {p.persona ?? "Persona con cargo público"}
              </Link>
            ) : (
              <>{p.persona ?? "Persona con cargo público"}</>
            )
          }
          meta={
            <span className="block">
              {`${tituloNatural(p.cargo)}, `}
              <EnlaceEntidad ruc={p.entidadRuc} nombre={p.entidad} />
            </span>
          }
        />
      ),
      familiar: (
        <CeldaTexto sub={p.via === "empresa" ? `con ${p.empresa ? tituloNatural(p.empresa) : "su empresa"}` : "a su nombre"}>{p.parentesco}</CeldaTexto>
      ),
      monto:
        p.ordenesEnPuesto == null ? (
          <CeldaNumero sub={plural(p.ordenes, "orden", "órdenes")}>{solesCompacto(p.monto)}</CeldaNumero>
        ) : p.ordenesEnPuesto + (p.procesosEnPuesto ?? 0) > 0 ? (
          <CeldaNumero
            sub={`${[
              p.ordenesEnPuesto ? plural(p.ordenesEnPuesto, "orden", "órdenes") : null,
              p.procesosEnPuesto ? plural(p.procesosEnPuesto, "proceso", "procesos") : null,
            ].filter(Boolean).join(" y ")}${p.empezoDespues ? ", ninguna antes" : ""}`}
          >
            {solesCompacto((p.montoEnPuesto ?? 0) + (p.montoProcesosEnPuesto ?? 0))}
          </CeldaNumero>
        ) : (
          <CeldaNumero sub="antes o después del puesto"><span className="font-sans text-mute">Ninguna</span></CeldaNumero>
        ),
      anios: <CeldaTexto sub={anios}>{p.ordenes ? `${solesCompacto(p.monto)} en ${plural(p.ordenes, "orden", "órdenes")}` : "Sólo procesos"}</CeldaTexto>,
    },
  };
}

/** Los casos de una ficha: la misma tabla de Patrones; cada fila abre su panel con la evidencia. */
export function TablaCasosCompras({ casos }: { casos: PatronCompraFamilia[] }) {
  if (!casos.length) return null;
  return <Tabla columnas={COLUMNAS_COMPRAS_FAMILIA} filas={casos.map(filaCompraFamilia)} etiqueta="Personas con puesto de compras y un familiar que cobra de la entidad" />;
}

export function TablaCasosAutoridad({ casos }: { casos: PatronAutoridadExsocio[] }) {
  if (!casos.length) return null;
  return <Tabla columnas={COLUMNAS_AUTORIDAD_EXSOCIO} filas={casos.map(filaAutoridadExsocio)} etiqueta="Autoridades que dejaron de figurar en una empresa que le vendió a su entidad" />;
}
