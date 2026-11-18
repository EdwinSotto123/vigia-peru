import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Building2, CircleCheck, Flag, LayoutDashboard, Wallet } from "lucide-react";
import { Ayuda, AyudaTermino, BanderasFicha, CabeceraPestana, DatosClave, EncabezadoPagina, EstadoVacio, FichaNoLeida, FuenteDato, SinSenalesEstado, Migas, Pagina, Pestanas } from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, CuentaGrupo, Indicadores, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { SenalesPlanillaBreves, SenalesPlanillaLista } from "@/components/personas/SenalesPlanilla";
import { PestanaOrdenes, TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { IrAPestana } from "@/components/personas/IrAPestana";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { motivoDudoso } from "@/lib/datoDudoso";
import { numero, plural, soles, solesCompacto } from "@/lib/formato";
import { PORTAL_TRANSPARENCIA, personalPte } from "@/lib/fuentes";
import { tituloNatural } from "@/lib/landing";
import { filtrosOrdenesDeUrl, getFichaPersona, getOrdenesPersona, hayFiltrosOrdenes, type FichaPersona } from "@/lib/personas";
import { REGIMEN, SENAL_PLANILLA, getFichaPlanilla, mes, parientesProveedores, periodoMeses, rutaPlanilla, type FichaPlanilla, type ParienteProveedor } from "@/lib/planilla";
import { uno } from "@/lib/utils";
import { rutaFichaUnica } from "@/lib/funcionarios";
import { NoSePudoLeer, indicadores, pestanasPlanilla, prepararPlanilla } from "@/components/personas/ficha/planilla";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaPlanilla(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, en planilla` : "Persona en planilla", robots: { index: false } };
}

/**
 * /app/personas/planilla/[codigo] — una persona de la planilla de una entidad (Portal de Transparencia), con la misma
 * información que la ficha de quien recibe órdenes (pedido del usuario, 2026-10-22). Código al azar (migración 107):
 * nunca el nombre, que lleva el materno tapado. Pestañas (?seccion=):
 *   · Resumen: tres tarjetas con título (sus señales en una línea cada una, lo que cobró con su línea mes a mes, dónde
 *     trabaja), cada una con su atajo a la pestaña del detalle.
 *   · Sueldo: lo que cobró cada mes publicado (antes iba al pie del Resumen; pedido del usuario del 2026-10-29).
 *   · Señales: cada una con su evidencia plegada y su fuente, lo grave primero. El nepotismo del lado del funcionario
 *     (parientes que declaró en su DJI y que le venden a su entidad) es una señal más, con las órdenes de cada pariente.
 *   · Órdenes: si también recibe órdenes de servicio (su ficha de persona contratada), todas, con sus filtros.
 *   · Otras planillas: la misma persona en la planilla de otras entidades (antes, también al pie del Resumen).
 * No se indexa en buscadores (robots).
 */
export default async function FichaPlanillaPage({ params, searchParams }: { params: { codigo: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const f = await getFichaPlanilla(params.codigo);
  if (!f) {
    if (!/^[0-9a-f]{12}$/.test(params.codigo)) notFound();
    return <NoSePudoLeer codigo={params.codigo} />;
  }
  // La ficha única de la persona es la de su cargo público (toda persona de planilla tiene una): esta dirección lleva a
  // ella, a la pestaña que corresponde y con esta planilla elegida (`pl`). `?directo=1` la deja sola.
  const unica = f.mismaPersona?.fichaCargo;
  if (unica && !uno(searchParams?.directo)) {
    const pedida = uno(searchParams?.seccion);
    const seccionUnica = pedida === "otras" ? "cargos" : pedida === "resumen" ? undefined : pedida;
    redirect(rutaFichaUnica(unica, searchParams, { seccion: seccionUnica, pl: params.codigo }));
  }
  const ruta = rutaPlanilla(params.codigo);
  const filtrosOrdenes = filtrosOrdenesDeUrl(searchParams);
  const d = await prepararPlanilla(f, ruta);
  const { p, entidad, locador, nSenales, altas, banderas } = d;
  const seccion = uno(searchParams?.seccion) ?? (p.codigo && hayFiltrosOrdenes(filtrosOrdenes) ? "ordenes" : undefined);
  const cargo = p.cargo ? tituloNatural(p.cargo) : null;
  const motivo = motivoDudoso(p.dudoso?.motivo);
  const ordenesP = p.codigo ? getOrdenesPersona(p.codigo, { ...filtrosOrdenes, size: TAM_ORDENES }) : null;
  // La bajada: su cargo, su entidad y su régimen, con el ⓘ pegado al último (abajo).
  const regimen = p.regimen != null ? REGIMEN[p.regimen] ?? `Régimen ${p.regimen}` : null;
  const enlaceEntidad = (
    <Link href={`/entidad/${p.entidadRuc}?seccion=planilla`} className="underline-offset-2 hover:text-granate hover:underline">
      <Dato tipo="entidad">{entidad}</Dato>
    </Link>
  );

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Personas contratadas", href: "/app/personas" },
          { etiqueta: "Planilla", href: "/app/personas?seccion=planilla" },
          { etiqueta: p.nombre, href: ruta },
        ]}
        pestanas={{ primera: "resumen", activa: seccion ?? "resumen", etiquetas: { sueldo: "Sueldo", senales: "Señales", ordenes: "Órdenes", otras: "Otras planillas" } }}
      />
      <EncabezadoPagina
        titulo={p.nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {cargo && <Dato tipo="cargo">{cargo}</Dato>}
            {regimen && enlaceEntidad}
            {/* El ⓘ va dentro de la fila, pegado al último dato: pasado como `ayuda` del encabezado quedaba después de
                esta fila (un flex, del ancho entero) y caía solo en una línea propia, en el escritorio y en el celular. */}
            <span className="inline-flex items-center gap-1">
              {regimen ? <Dato tipo="regimen">{regimen}</Dato> : enlaceEntidad}
              <Ayuda titulo="¿Por qué está esta persona aquí?">
                <span className="block">
                  Porque figura en la planilla que su entidad publica en el Portal de Transparencia Estándar, con su cargo y lo
                  que cobra cada mes. Vigía tapa uno de sus apellidos y no muestra su DNI (la planilla no lo trae).
                </span>
                <span className="mt-2 block">
                  Las señales dicen qué otro registro público coincide con esta persona. Ninguna prueba un delito ni un parentesco.{" "}
                  <Link href="/privacidad" className="text-granate underline-offset-2 hover:underline">¿Eres tú? Pide una corrección</Link>
                </span>
              </Ayuda>
            </span>
          </span>
        }
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta persona" banderas={banderas} /> : undefined}
      />
      <Indicadores items={indicadores(f, { nSenales, altas, locador }, ruta)} />
      {motivo && (
        <AvisoDato motivo={motivo} fuente="pte_personal">
          {`Su planilla de ${mes(p.ultimoMes) ?? "su último mes"} trae ${p.dudoso?.total != null ? soles(p.dudoso.total) : "un monto"} en total. Mira su sueldo mes a mes, en la pestaña Sueldo.`}
        </AvisoDato>
      )}

      <Pestanas
        fija
        key={seccion ?? "resumen"}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={pestanasPlanilla({ f, d, ruta, filtrosOrdenes, ordenesP })}
      />
      <Aviso tono="neutro">
        Una señal no es una acusación ni prueba un parentesco: dice qué registro público coincide con esta persona, para que
        alguien lo revise. El título, la edad o la experiencia de cada persona no están en datos abiertos.
      </Aviso>
    </Pagina>
  );
}
