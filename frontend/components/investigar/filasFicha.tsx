"use client";

import { createContext, useContext, type ReactNode } from "react";
import Link from "next/link";
import { UsersRound } from "lucide-react";
import { Ayuda } from "@/components/patrones";
import { CeldaNumero, CeldaPrincipal, CLASE_ENLACE_CELDA, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { Severidad } from "@/components/ui/Severidad";
import { numero, plural, porcentaje, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import type { PatronGrupo } from "@/lib/patrones";
import { esRucEnClaro, esRucPersonaNatural } from "@/lib/privacidad";
import { detalleGrupo } from "./DetallePatron";

/**
 * Las listas de /app/patrones dentro de la ficha de una entidad o de una empresa (`ListaDePatron`), pedido del usuario del
 * 2026-11-18 («lo veo sin forma»):
 *
 * - La rejilla de la tabla se decide por el ancho de la TABLA (`medida="contenedor"`) y no de la pantalla: en la ficha la
 *   lista va a la derecha de la barra lateral y del índice, y a 1440 px las columnas fijas sumaban más que su ancho. La
 *   columna principal (`minmax(0,…)`) quedaba en 0 px: en «Grupos por dueño o familia» no se veía QUIÉNES eran y la primera
 *   columna visible era el monto partido en cuatro renglones.
 * - Nada se apila en el celular: la fila dice lo que le da sentido (quién y una cifra) y lo demás está en su panel. Antes
 *   cada fila de grupos era una tarjeta de 300 px (nueve pantallas para 25 grupos).
 * - En la ficha de una entidad la columna de la entidad dice lo mismo en todas las filas: la fila nombra a QUIÉNES (las
 *   empresas del grupo, el proveedor de la compra repetida).
 */
export type VistaFicha = "entidad" | "empresa";

/** La lista va dentro de una ficha: de quién (para no repetirlo en cada fila) y su RUC. Fuera de una ficha, null. */
export const EnFicha = createContext<{ vista: VistaFicha; ruc: string } | null>(null);
export const useFicha = () => useContext(EnFicha);

/**
 * Las columnas de una lista para la ficha: sin apilar (lo que no entra va al panel de la fila) y, si se pide, una cifra
 * que se ve en todo ancho (`siempre`, más angosta y con su nombre corto): la que da sentido a la fila en el celular.
 */
export function paraFicha(columnas: Columna[], siempre?: string): Columna[] {
  return columnas.map((c) => {
    const { apilar: _apilar, ...resto } = c;
    if (c.clave !== siempre) return resto;
    const { desde: _desde, ...visible } = resto;
    return { ...visible, titulo: c.corto ?? c.titulo, ancho: "6rem" };
  });
}

/** La cifra que se ve en todo ancho en la ficha, por lista: la que dice cuánto pesa cada caso. */
export const CIFRA_EN_FICHA: Partial<Record<string, string>> = {
  duenos: "monto",
  consorcios: "rivales",
  inhabilitadas: "contratos",
  control: "contratos",
  observados: "observados",
  renovaciones: "subida",
};

const Ninguno = ({ children = "Ninguno" }: { children?: ReactNode }) => <span className="font-sans text-mute">{children}</span>;

/** Un integrante de un grupo: la empresa a su ficha; la persona (un apellido tapado) a la suya, si la tiene. */
function Integrante({ m }: { m: PatronGrupo["miembros"][number] }) {
  if (!m.persona && esRucEnClaro(m.ruc) && !esRucPersonaNatural(m.ruc)) {
    return (
      <Link href={`/empresa/${m.ruc}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
        {m.nombre ? tituloNatural(m.nombre) : `RUC ${m.ruc}`}
      </Link>
    );
  }
  const n = m.nombre ? tituloNatural(m.nombre) : "Persona natural";
  return m.codigo ? (
    <Link href={`/app/personas/${m.codigo}`} prefetch={false} className={CLASE_ENLACE_CELDA}>
      {n}
    </Link>
  ) : (
    <>{n}</>
  );
}

const nombreMiembro = (m: PatronGrupo["miembros"][number]) => (m.nombre ? tituloNatural(m.nombre) : m.persona ? "Persona natural" : "Empresa sin nombre");

/**
 * QUIÉNES forman el grupo, en una línea: su severidad (ícono), los integrantes enlazados uno tras otro (lo que no entra
 * se corta; la lista entera en el `title` y en el panel) y cuántos son. `sin`: el de la ficha (una empresa), que está en
 * todas las filas.
 */
function CeldaQuienes({ p, sin }: { p: PatronGrupo; sin?: string }) {
  const todos = p.miembros ?? [];
  const otros = sin ? todos.filter((m) => m.ruc !== sin) : todos;
  return (
    <span className="flex w-full min-w-0 items-center gap-1.5">
      <Severidad bandera={p.severidad} formato="punto" className="shrink-0" />
      <span className="min-w-0 truncate text-dato font-semibold leading-snug text-ink" title={otros.map(nombreMiembro).join(", ")}>
        {sin ? <span className="font-normal text-mute">Con </span> : null}
        {otros.map((m, k) => (
          <span key={m.ruc}>
            {k > 0 ? ", " : ""}
            <Integrante m={m} />
          </span>
        ))}
      </span>
      <Dato icono={UsersRound} nombre="Integrantes" className="shrink-0 text-rotulo tabular-nums text-inkSoft">
        {numero(todos.length)}
      </Dato>
    </span>
  );
}

// ─── Grupos por dueño y familia ─────────────────────────────────────────────────

const AYUDA_MONTO = (
  <Ayuda titulo="¿Qué suma?">
    <span className="block">
      Las órdenes de compra y de servicio que la entidad les emitió a los integrantes desde 2018, sumadas como si fueran un solo proveedor. La barra
      lo compara con el grupo mayor de la página.
    </span>
  </Ayuda>
);
const AYUDA_JUNTOS = (
  <Ayuda titulo="¿Qué cuenta?">
    <span className="block">
      Días en que la entidad le emitió órdenes a dos o más integrantes. Debajo, los pares de órdenes con números correlativos (tres o menos de diferencia):
      suelen salir del mismo lote de requerimientos.
    </span>
  </Ayuda>
);
const AYUDA_REPARTIDO = (
  <Ayuda titulo="¿Qué es un objeto repartido?">
    <span className="block">El mismo objeto, el mismo año, en órdenes a varios integrantes que juntas pasan el tope de 8 UIT. Debajo, cuánto suman.</span>
  </Ayuda>
);
const AYUDA_BORDE = (
  <Ayuda titulo="¿Qué es «al borde»?">
    <span className="block">De sus órdenes de hasta 8 UIT (el tope sin proceso), cuántas quedan muy cerca del tope. Debajo, las que lo pasan.</span>
  </Ayuda>
);

/** Los grupos en la ficha de una ENTIDAD: quiénes, cuánto y lo que hicieron juntos; la entidad (la de la ficha), en ninguna fila. */
export const COLUMNAS_GRUPOS_ENTIDAD: Columna[] = [
  { clave: "grupo", titulo: "Quiénes forman el grupo", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Órdenes", ancho: "6.5rem", alinear: "der", ayuda: AYUDA_MONTO },
  { clave: "juntos", titulo: "Mismo día", ancho: "7rem", alinear: "der", desde: "md", ayuda: AYUDA_JUNTOS },
  { clave: "repartidos", titulo: "Repartido", ancho: "6.5rem", alinear: "der", desde: "lg", ayuda: AYUDA_REPARTIDO },
  { clave: "parte", titulo: "De sus ventas", ancho: "6.5rem", alinear: "der", desde: "xl" },
  { clave: "borde", titulo: "Al borde", ancho: "7rem", alinear: "der", desde: "xl", ayuda: AYUDA_BORDE },
];

/** Los grupos en la ficha de una EMPRESA: en qué entidad y con quiénes; ella misma, en ninguna fila. */
export const COLUMNAS_GRUPOS_EMPRESA: Columna[] = [
  { clave: "grupo", titulo: "Entidad y con quiénes", ancho: "minmax(0,1fr)" },
  { clave: "monto", titulo: "Órdenes", ancho: "6.5rem", alinear: "der", ayuda: AYUDA_MONTO },
  { clave: "juntos", titulo: "Mismo día", ancho: "7rem", alinear: "der", desde: "md", ayuda: AYUDA_JUNTOS },
  { clave: "repartidos", titulo: "Repartido", ancho: "6.5rem", alinear: "der", desde: "lg", ayuda: AYUDA_REPARTIDO },
  { clave: "borde", titulo: "Al borde", ancho: "7rem", alinear: "der", desde: "xl", ayuda: AYUDA_BORDE },
];

/** Una fila de grupos en una ficha: de una línea (≤ 48 px), con la barra del monto frente al mayor de la página. */
export function filaGrupoEnFicha(p: PatronGrupo, i: number, ficha: { vista: VistaFicha; ruc: string }): Fila {
  const celdaGrupo =
    ficha.vista === "entidad" ? (
      <CeldaQuienes p={p} />
    ) : (
      <CeldaPrincipal
        enLinea
        textoCompleto={p.entidad ? tituloNatural(p.entidad) : undefined}
        titulo={
          <>
            <Severidad bandera={p.severidad} formato="punto" className="mr-1.5 align-[-1px]" />
            {esRucEnClaro(p.entidadRuc) ? (
              <Link href={`/entidad/${p.entidadRuc}?seccion=patrones&patron=grupos`} prefetch={false} className={CLASE_ENLACE_CELDA}>
                {p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre"}
              </Link>
            ) : (
              p.entidad ? tituloNatural(p.entidad) : "Entidad sin nombre"
            )}
          </>
        }
        meta={
          <span title={(p.miembros ?? []).filter((m) => m.ruc !== ficha.ruc).map(nombreMiembro).join(", ")}>
            con{" "}
            {(p.miembros ?? [])
              .filter((m) => m.ruc !== ficha.ruc)
              .map((m, k) => (
                <span key={m.ruc}>
                  {k > 0 ? ", " : ""}
                  <Integrante m={m} />
                </span>
              ))}
          </span>
        }
      />
    );
  return {
    id: `grupo-${i}`,
    detalle: detalleGrupo(p),
    enlaces: true,
    etiqueta: `Ver el detalle de este grupo de ${plural((p.miembros ?? []).length, "proveedor", "proveedores")}`,
    magnitudes: { monto: p.monto },
    textos: { parte: p.parteEntidad == null ? null : undefined },
    celdas: {
      grupo: celdaGrupo,
      monto: <CeldaNumero>{solesCompacto(p.monto)}</CeldaNumero>,
      juntos: (
        <CeldaNumero sub={p.correlativas ? plural(p.correlativas, "par correlativo", "pares correlativos") : undefined}>
          {p.diasJuntos ? plural(p.diasJuntos, "día", "días") : <Ninguno />}
        </CeldaNumero>
      ),
      repartidos: (
        <CeldaNumero sub={p.repartidos ? solesCompacto(p.montoRepartido) : undefined}>
          {p.repartidos ? plural(p.repartidos, "objeto", "objetos") : <Ninguno />}
        </CeldaNumero>
      ),
      parte: p.parteEntidad != null ? <CeldaNumero>{porcentaje(p.parteEntidad * 100)}</CeldaNumero> : undefined,
      borde: (
        <CeldaNumero sub={p.sobreTope ? `${numero(p.sobreTope)} por encima` : undefined}>
          {p.hasta8Uit ? `${numero(p.borde)} de ${numero(p.hasta8Uit)}` : <Ninguno>Ninguna</Ninguno>}
        </CeldaNumero>
      ),
    },
  };
}
