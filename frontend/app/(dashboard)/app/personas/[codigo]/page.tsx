import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { Building2, CalendarRange, Flag, Gavel, ListOrdered, Receipt, Route, Wallet } from "lucide-react";
import {
  Ayuda,
  BloqueDetalle,
  CabeceraPestana,
  ChipsDetalle,
  CuerpoDetalle,
  DatosClave,
  BanderasFicha,
  Cargando,
  EncabezadoPagina,
  EstadoVacio,
  SinSenalesEstado,
  FichaNoLeida,
  Migas,
  Pagina,
  Pestanas,
  PieDetalle,
} from "@/components/patrones";
import { Aviso } from "@/components/partidos/AvisoPartido";
import { CeldaNumero, CeldaPrincipal, CuentaGrupo, Indicadores, Tabla, TablaPaginada, type Columna, type Fila, type GrupoFilas, type Indicador } from "@/components/listado";
import { CrucesCelda } from "@/components/contratos/CrucesCelda";
import { SenalesBrevesEntidad, SenalesPorEntidad, senalesDeEntidad } from "@/components/personas/SenalesFicha";
import { PestanaOrdenes, TAM_ORDENES } from "@/components/personas/OrdenesPersona";
import { PerfilPersonaSeccion } from "@/components/personas/PerfilPersona";
import { LineaMeses } from "@/components/charts/LineaMeses";
import { AvisoDato } from "@/components/ui/BanderaDato";
import { Dato } from "@/components/ui/Dato";
import { BanderaAparte } from "@/components/ui/BanderaAparte";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Severidad } from "@/components/ui/Severidad";
import { motivoDudoso } from "@/lib/datoDudoso";
import { decimal, fechaConAnio, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import {
  SENAL,
  TIPOS_SENAL,
  aniosTexto,
  filtrosOrdenesDeUrl,
  getFichaPersona,
  getOrdenesPersona,
  hayFiltrosOrdenes,
  banderasPersona,
  senalesDistintas,
  type AnioDePersona,
  type EntidadDePersona,
  type FichaPersona,
  type ProcesoGanado,
} from "@/lib/personas";
import { rutaContrato } from "@/lib/rutas";
import { nombrePartido } from "@/lib/planilla";
import { peorSeveridad } from "@/lib/severidad";
import { uno } from "@/lib/utils";
import { rutaFichaUnica } from "@/lib/funcionarios";
import { NoSePudoLeer, indicadores, pestanasContratada } from "@/components/personas/ficha/contratada";

export const revalidate = 600;

export async function generateMetadata({ params }: { params: { codigo: string } }): Promise<Metadata> {
  const f = await getFichaPersona(params.codigo);
  return { title: f?.persona.nombre ? `${f.persona.nombre}, persona contratada` : "Persona contratada", robots: { index: false } };
}

/** La etiqueta corta de cada señal para la celda de una fila (`CrucesCelda`, una línea con su ícono de severidad). */
const CORTO_SENAL = Object.fromEntries(TIPOS_SENAL.map((t) => [t, SENAL[t].corto]));

/**
 * /app/personas/[codigo] — una persona que recibe órdenes de servicio del Estado (código al azar: nunca el RUC ni el
 * DNI; un apellido tapado). Pestañas (?seccion=):
 *   · Señales: en cada entidad, qué registro público coincide (candidatura, aporte, autoridad, apellidos, meses,
 *     pago), lo grave primero, con su evidencia plegada y su fuente. La entidad elegida va en `?sent=<RUC>`.
 *   · Recorrido: lo que es en otros registros, unido por su DNI (sus empresas, su política, quién lo declaró como
 *     pariente, su planilla, sus visitas) y su línea de vida. Se lee aparte (`/personas/:codigo/perfil`), en streaming.
 *   · Lo que cobró: por entidad y año, cuánto por mes frente a la mediana de la entidad y del país para el mismo
 *     tipo de servicio.
 *   · Órdenes: todas, paginadas, por entidad y año.
 *   · Entidades: dónde trabajó; cada una abre su panel con lo que le pagó, sus años y sus señales.
 * No se indexa en buscadores (robots): es una persona privada.
 */
export default async function PersonaPage({ params, searchParams }: { params: { codigo: string }; searchParams?: Record<string, string | string[] | undefined> }) {
  const f = await getFichaPersona(params.codigo);
  if (!f) {
    if (!/^[0-9a-f]{12}$/.test(params.codigo)) notFound();
    return <NoSePudoLeer codigo={params.codigo} />;
  }
  // La ficha única de la persona es la de su cargo público: si la API la reconoce ahí (misma entidad y mismo nombre que su
  // planilla, o nombre completo único), esta dirección lleva a ella con su pestaña y sus filtros. `?directo=1` la deja sola.
  const unica = f.mismaPersona?.fichaCargo;
  if (unica && !uno(searchParams?.directo)) redirect(rutaFichaUnica(unica, searchParams));
  const ruta = `/app/personas/${params.codigo}`;
  const p = f.persona;
  const nombre = p.nombre ?? "Persona contratada";
  const cuenta = senalesDistintas(f.entidades);
  // Sus banderas, fijas bajo el nombre en todas las pestañas (el nepotismo ya no se queda en la de señales).
  const banderas = banderasPersona(cuenta.lista, `${ruta}?seccion=senales`);
  const filtrosOrdenes = filtrosOrdenesDeUrl(searchParams);
  const seccionUrl = uno(searchParams?.seccion);
  // Quien no tiene órdenes y sí procesos ganados (migración 317) abre en sus procesos.
  const procesos = f.procesos ?? [];
  const soloProcesos = p.ordenes === 0 && procesos.length > 0;
  const seccion = seccionUrl ?? (hayFiltrosOrdenes(filtrosOrdenes) ? "ordenes" : soloProcesos ? "procesos" : undefined);
  const sentUrl = uno(searchParams?.sent);
  const sent = sentUrl && f.entidades.some((e) => e.entidadRuc === sentUrl) ? sentUrl : undefined;
  const ordenesP = getOrdenesPersona(params.codigo, { ...filtrosOrdenes, size: TAM_ORDENES });
  // Las dos puntas con su año: «Del 23 ene. 2018 al 25 ago.» dejaba la segunda sin año (era la del año en curso).
  const fechas = p.primera && p.ultima ? (p.primera === p.ultima ? `El ${fechaConAnio(p.primera)}` : `Del ${fechaConAnio(p.primera)} al ${fechaConAnio(p.ultima)}`) : null;
  // El ⓘ va pegado al último dato de la bajada, dentro de su fila: como `ayuda` del encabezado caía en un renglón propio
  // (la bajada es una fila flexible y el ⓘ iba después de ella).
  const ayuda = (
    <Ayuda titulo="¿Por qué está esta persona aquí?">
      <span className="block">
        Porque recibió órdenes de servicio del Estado o ganó procesos de selección como persona natural: el OECE (CONOSCE) los
        publica con su nombre y lo que se le pagó o adjudicó. Vigía no muestra su DNI ni su RUC y tapa uno de sus apellidos.
      </span>
      <span className="mt-2 block">
        Las señales dicen qué otro registro público coincide con esta persona. Ninguna prueba un delito ni un parentesco.{" "}
        <Link href="/privacidad" className="text-granate underline-offset-2 hover:underline">¿Eres tú? Pide una corrección</Link>
      </span>
    </Ayuda>
  );

  return (
    <Pagina>
      <Migas
        items={[
          { etiqueta: "Inicio", href: "/app" },
          { etiqueta: "Personas contratadas", href: "/app/personas" },
          { etiqueta: nombre, href: ruta },
        ]}
        pestanas={{ primera: "senales", activa: seccion ?? "senales", etiquetas: { procesos: "Procesos", recorrido: "Recorrido", pagos: "Lo que cobró", ordenes: "Órdenes", entidades: "Entidades" } }}
      />
      <EncabezadoPagina
        titulo={nombre}
        bajada={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span className="inline-flex items-center gap-1.5">
              <Building2 size={14} className="shrink-0 text-mute" aria-hidden />{" "}
              {soloProcesos
                ? `Ganó ${plural(procesos.length, "proceso de selección", "procesos de selección")} en ${plural(p.entidadesProcesos ?? 1, "entidad", "entidades")}`
                : `Órdenes de servicio de ${plural(p.entidades, "entidad", "entidades")}${procesos.length ? ` y ${plural(procesos.length, "proceso ganado", "procesos ganados")}` : ""}`}
              {!fechas && ayuda}
            </span>
            {fechas && (
              <span className="inline-flex items-center gap-1.5">
                <CalendarRange size={14} className="shrink-0 text-mute" aria-hidden />
                {fechas}
                {ayuda}
              </span>
            )}
          </span>
        }
        banderas={banderas.length ? <BanderasFicha etiqueta="Banderas de esta persona" banderas={banderas} /> : undefined}
      />
      <Indicadores items={indicadores(f, cuenta, ruta)} />
      {p.dudosas?.ordenes ? (
        <AvisoDato motivo={motivoDudoso(p.dudosas.motivos?.[0]) ?? "mayor_100m"} fuente="conosce_ordenes">
          {p.dudosas.ordenes === 1
            ? `Una de sus órdenes trae ${soles(p.dudosas.monto ?? 0)}. `
            : `${p.dudosas.ordenes} de sus órdenes traen ${soles(p.dudosas.monto ?? 0)} en total. `}
          <Link href={`${ruta}?seccion=ordenes`} className="font-semibold text-granate underline-offset-2 hover:underline">
            Están en la pestaña Órdenes, con su bandera
          </Link>
          .
        </AvisoDato>
      ) : null}

      <Pestanas
        fija
        // La entidad elegida también: «Ver su evidencia» (panel de Entidades) vuelve a Señales con esa entidad abierta.
        key={`${seccion ?? ""}|${sent ?? ""}`}
        etiqueta="Secciones de la persona"
        activa={seccion}
        pestanas={pestanasContratada({ f, codigo: params.codigo, ruta, nombre, sent, filtrosOrdenes, ordenesP })}
      />
      <Aviso tono="neutro">
        Una señal no es una acusación ni prueba un parentesco. El título, la edad y la experiencia de esta persona no están en
        datos abiertos: Vigía no puede decir si cumple el perfil del servicio.
      </Aviso>
    </Pagina>
  );
}
