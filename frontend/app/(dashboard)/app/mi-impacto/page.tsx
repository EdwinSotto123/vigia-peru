"use client";

/**
 * Mi impacto (con sesión): mis aportes con progreso en vivo, contratos con señales y comprobante;
 * mis denuncias con su estado; zonas, entidades, empresas y partidos que sigo, y lo nuevo de lo que
 * sigo (migración 191: contratos con antecedentes, informes de control y sanciones).
 * Sin sesión → invitación a entrar (todo lo demás del sitio sigue funcionando sin cuenta).
 * `?aporte=VIG-…` (viene del comprobante) → formulario para asociar un aporte hecho como invitado.
 *
 * Palabras (DESIGN_SYSTEM.md §10.1): "leídos" = contratos cuyo análisis terminó; "con señales" =
 * contratos con al menos una señal publicada (así cuenta el API: `EXISTS banderas`), no señales
 * sueltas.
 *
 * Estructura (§14): las cifras de la cuenta en `Indicadores` y, debajo, una pestaña por lista
 * (§14.3) —Lo nuevo (si sigue algo) | Aportes | Denuncias | Zonas | Entidades | Empresas | Partidos
 * seguidos, cada una con su conteo—
 * en la `Tabla` de todo listado, con su detalle en el panel lateral armado con las piezas de
 * §14.4. Antes las cuatro listas se apilaban y había que bajar hasta la que uno buscaba.
 */

import { rutaContrato } from "@/lib/rutas";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MapPin, Camera, ArrowRight, Loader2, Building2, Bell, Link2, LogIn, ExternalLink, CheckCircle2, Clock, XCircle, GitMerge, Lock, CircleDot, HandCoins, Briefcase, Landmark, Newspaper, type LucideIcon } from "lucide-react";
import { Ayuda, Beneficios, BloqueDetalle, CabeceraPestana, Cargando, ChipsDetalle, CitaDetalle, CuerpoDetalle, type DatoClave, DatosClave, EncabezadoPagina, EstadoError, Franja, Migas, Pagina, Pestanas, PieDetalle } from "@/components/patrones";
import { CeldaFecha, CeldaNumero, CeldaPrincipal, Indicadores, TablaPaginada, type Columna, type Fila, type Indicador } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { ChipAporte, EstadoAporte, indicePaso } from "@/components/financiar/EstadoAporte";
import { SubirComprobante } from "@/components/financiar/SubirComprobante";
import { EnlaceAccion } from "@/components/ui/EnlaceAccion";
import { Partes, Separador } from "@/components/ui/Partes";
import { useAuth } from "@/components/auth/AuthProvider";
import { dejarDeSeguir, getImpacto, reclamarAporte, type AporteMio, type DenunciaMia, type EmpresaSeguidaResumen, type Impacto, type PartidoSeguidoResumen } from "@/lib/cuentas";
import { NovedadesSeguidas } from "@/components/cuenta/NovedadesSeguidas";
import { tituloNatural } from "@/lib/landing";
import { ESTADO_LABEL, ESTADO_PUNTO, type ZonaEstado } from "@/lib/financiamiento";
import { AliadosDelPais, CifrasDelPais, RecientesDelPais } from "@/components/cuenta/ResumenPublico";
import { CATEGORIA_META, type CategoriaDenuncia } from "@/lib/denuncias-meta";
import { fechaCorta, listaY, numero, plural, soles, solesCompacto } from "@/lib/formato";
import { UBIGEO_REGION } from "@/components/mapa/region-match";
import { cn } from "@/lib/utils";

/** Enlace de acción secundaria de una pestaña (arriba a la derecha) o de un vacío. */
const ENLACE_SECCION = "inline-flex min-h-[24px] items-center gap-1 text-meta font-medium text-granate underline-offset-2 hover:underline";

/** Categorías de las denuncias a una ENTIDAD: nunca se publican (backend/api/src/lib/publicacion.ts, regla 3). */
const CATEGORIAS_ENTIDAD = new Set(["malversacion", "conflicto_interes", "favoritismo", "obstruccion", "patron_corrupcion", "otra_entidad"]);
const esDeEntidad = (d: Pick<DenunciaMia, "id" | "categoria">) => d.id.startsWith("RPT-ENT-") || CATEGORIAS_ENTIDAD.has(d.categoria);

export default function MiImpactoPage() {
  return (
    <Pagina>
      <Migas items={[{ etiqueta: "Inicio", href: "/app" }, { etiqueta: "Mi impacto", href: "/app/mi-impacto" }]} />
      <EncabezadoPagina
        titulo="Mi impacto"
        bajada="Tus aportes, tus denuncias y lo que sigues, con lo nuevo de cada cosa, en un solo lugar."
        ayuda={
          <Ayuda titulo="¿Qué reúne esta página?">
            Tus aportes con su progreso en vivo, las denuncias que enviaste con sesión y las zonas, entidades, empresas y
            partidos que sigues, con lo nuevo de cada uno. Todo lo que financias es público; lo que sigues es sólo tuyo.
          </Ayuda>
        }
      />
      <Suspense fallback={<Cargando texto="Cargando tu cuenta…" />}>
        <Contenido />
      </Suspense>
    </Pagina>
  );
}

function Contenido() {
  const { user, loading } = useAuth();
  const search = useSearchParams();
  const aporteParam = search.get("aporte");
  const [data, setData] = useState<Impacto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const cargar = () => {
    setCargando(true);
    getImpacto().then(setData).catch((e) => setError((e as Error).message)).finally(() => setCargando(false));
  };
  useEffect(() => {
    if (loading) return;
    if (!user) { setCargando(false); return; }
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, loading]);

  if (loading || (user && cargando && !data)) return <Cargando texto="Cargando tu cuenta…" lineas={4} />;
  if (!user) return <SinSesion />;
  if (error && !data) {
    return (
      <EstadoError
        titulo="No pudimos cargar tu cuenta"
        detalle={error}
        accion={
          <button type="button" onClick={cargar} className="inline-flex min-h-[44px] items-center rounded-full bg-granate px-5 py-2 text-dato leading-5 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
            Reintentar
          </button>
        }
      />
    );
  }
  if (!data) return null;

  const { aportes, denuncias, zonasSeguidas, entidadesSeguidas, resumen, novedades } = data;
  const empresasSeguidas = data.empresasSeguidas ?? [];
  const partidosSeguidos = data.partidosSeguidos ?? [];
  const yaTiene = aporteParam ? aportes.some((a) => a.codigo === aporteParam.toUpperCase()) : false;
  const sigueAlgo = entidadesSeguidas.length + empresasSeguidas.length + partidosSeguidos.length > 0;
  const nada = !aportes.length && !denuncias.length && !zonasSeguidas.length && !sigueAlgo;
  const nNuevo = novedades ? novedades.contratos.length + novedades.informes.length + novedades.sanciones.length : 0;

  // Todavía nada con esta cuenta: un solo vacío (con la llamita) en vez de cuatro secciones vacías.
  if (nada) {
    return (
      <div className="space-y-6">
        {aporteParam && !yaTiene && <Reclamar codigo={aporteParam.toUpperCase()} onOk={cargar} />}
        <Franja
          titulo="Todavía no hay nada con esta cuenta"
          accion={
            <>
              <Link href="/app/financiar" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-dato leading-5 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep">
                Financiar una lectura <ArrowRight size={16} aria-hidden />
              </Link>
              <Link href="/reporte/nuevo" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-paper px-5 py-2 text-dato leading-5 font-semibold text-ink transition-colors duration-rapido hover:border-granate/40 hover:bg-granate-50">
                Denunciar una obra
              </Link>
            </>
          }
        >
          Si financiaste como invitado, abre tu comprobante <span className="font-mono text-ink">/impacto/VIG-…</span> y
          asócialo desde ahí.
        </Franja>
      </div>
    );
  }

  const cifras = indicadoresCuenta(aportes.length, resumen, denuncias);

  return (
    <div className="space-y-6">
      {aporteParam && !yaTiene && <Reclamar codigo={aporteParam.toUpperCase()} onOk={cargar} />}

      {/* Sólo con lo que el usuario realmente tiene: nada de ceros decorativos. */}
      {cifras.length >= 2 && <Indicadores items={cifras} />}

      {/* Una pestaña por lista (§14.3). La inicial sale de `?seccion=`, como en las fichas del servidor. */}
      <Pestanas
        etiqueta="Secciones de mi impacto"
        activa={search.get("seccion") ?? undefined}
        pestanas={[
          // Lo nuevo de lo que sigue, primero (si sigue algo): es lo que cambia de una visita a otra.
          ...(sigueAlgo
            ? [
                {
                  clave: "novedades",
                  etiqueta: "Lo nuevo",
                  icono: <Newspaper size={15} aria-hidden />,
                  conteo: nNuevo,
                  contenido: <NovedadesSeguidas d={novedades} sigueAlgo={sigueAlgo} />,
                },
              ]
            : []),
          {
            clave: "aportes",
            etiqueta: "Aportes",
            conteo: aportes.length,
            contenido: (
              <>
                <CabeceraPestana acciones={<>
                  <Link href="/app/financiar" className={ENLACE_SECCION}>Financiar otra zona <ArrowRight size={13} aria-hidden /></Link>
                </>} />
                {aportes.length === 0 ? (
                  <VacioSeccion icon={Building2}>
                    <p>Todavía no tienes aportes. Si financiaste como invitado, asócialo desde tu comprobante <span className="font-mono text-ink">/impacto/VIG-…</span>.</p>
                    <Link href="/app/mapa" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Elegir una zona en el mapa <ArrowRight size={14} aria-hidden /></Link>
                  </VacioSeccion>
                ) : (
                  <TablaPaginada
                    columnas={COLUMNAS_APORTES}
                    filas={aportes.map((a) => filaAporte(a, cargar))}
                    etiqueta="Mis aportes"
                    tam={10}
                    nombre="aportes"
                    buscar={{ placeholder: "Buscar una zona o el código de un aporte…", etiqueta: "Buscar en mis aportes" }}
                  />
                )}
              </>
            ),
          },
          {
            clave: "denuncias",
            etiqueta: "Denuncias",
            conteo: denuncias.length,
            contenido: (
              <>
                <CabeceraPestana acciones={<>
                  <Link href="/reporte/nuevo" className={ENLACE_SECCION}>Denunciar <ArrowRight size={13} aria-hidden /></Link>
                </>} />
                {denuncias.length === 0 ? (
                  <VacioSeccion icon={Camera}>
                    <p>Las denuncias que envías con sesión aparecen aquí con su estado; en público, sin tu nombre.</p>
                    <Link href="/reporte/nuevo" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Enviar tu primera denuncia <ArrowRight size={14} aria-hidden /></Link>
                  </VacioSeccion>
                ) : (
                  <TablaPaginada
                    columnas={COLUMNAS_DENUNCIAS}
                    filas={denuncias.map(filaDenuncia)}
                    etiqueta="Mis denuncias"
                    tam={10}
                    nombre="denuncias"
                    buscar={{ placeholder: "Buscar en lo que escribiste, la categoría o la zona…", etiqueta: "Buscar en mis denuncias" }}
                  />
                )}
              </>
            ),
          },
          {
            clave: "zonas",
            etiqueta: "Zonas seguidas",
            conteo: zonasSeguidas.length,
            contenido: (
              <>
                <CabeceraPestana acciones={<>
                  <Link href="/app/mapa" className={ENLACE_SECCION}>Seguir otra desde el mapa <ArrowRight size={13} aria-hidden /></Link>
                </>} />
                {zonasSeguidas.length === 0 ? (
                  <VacioSeccion icon={MapPin}>
                    <p>Sigue una zona desde el panel del mapa para verla aquí y resaltarla con el chip «Mis zonas».</p>
                    <Link href="/app/mapa" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Abrir el mapa <ArrowRight size={14} aria-hidden /></Link>
                  </VacioSeccion>
                ) : (
                  <TablaPaginada
                    columnas={COLUMNAS_ZONAS}
                    filas={zonasSeguidas.map((z) => filaZona(z, cargar))}
                    etiqueta="Zonas que sigo"
                    tam={10}
                    nombre="zonas"
                    buscar={{ placeholder: "Buscar una zona…", etiqueta: "Buscar en las zonas que sigo" }}
                  />
                )}
              </>
            ),
          },
          {
            clave: "entidades",
            etiqueta: "Entidades seguidas",
            conteo: entidadesSeguidas.length,
            contenido:
              entidadesSeguidas.length === 0 ? (
                <VacioSeccion icon={Building2}>
                  <p>Puedes seguir una entidad desde su ficha para verla aquí.</p>
                  <Link href="/app/entidades" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Ver entidades <ArrowRight size={14} aria-hidden /></Link>
                </VacioSeccion>
              ) : (
                <TablaPaginada
                  columnas={COLUMNAS_ENTIDADES}
                  filas={entidadesSeguidas.map((e) => filaEntidad(e, cargar))}
                  etiqueta="Entidades que sigo"
                  tam={10}
                  nombre="entidades"
                  buscar={{ placeholder: "Buscar una entidad o su RUC…", etiqueta: "Buscar en las entidades que sigo" }}
                />
              ),
          },
          {
            clave: "empresas",
            etiqueta: "Empresas seguidas",
            conteo: empresasSeguidas.length,
            contenido:
              empresasSeguidas.length === 0 ? (
                <VacioSeccion icon={Briefcase}>
                  <p>Sigue una empresa desde su ficha para ver aquí sus contratos con antecedentes y sus sanciones nuevas.</p>
                  <Link href="/app/empresas" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Ver empresas <ArrowRight size={14} aria-hidden /></Link>
                </VacioSeccion>
              ) : (
                <TablaPaginada
                  columnas={COLUMNAS_EMPRESAS}
                  filas={empresasSeguidas.map((e) => filaEmpresa(e, cargar))}
                  etiqueta="Empresas que sigo"
                  tam={10}
                  nombre="empresas"
                  buscar={{ placeholder: "Buscar una empresa o su RUC…", etiqueta: "Buscar en las empresas que sigo" }}
                />
              ),
          },
          {
            clave: "partidos",
            etiqueta: "Partidos seguidos",
            conteo: partidosSeguidos.length,
            contenido:
              partidosSeguidos.length === 0 ? (
                <VacioSeccion icon={Landmark}>
                  <p>Sigue un partido desde su ficha para ver aquí los contratos con antecedentes de los gobiernos que ganó.</p>
                  <Link href="/app/partidos" className={cn(ENLACE_SECCION, "mt-2 font-semibold")}>Ver partidos <ArrowRight size={14} aria-hidden /></Link>
                </VacioSeccion>
              ) : (
                <TablaPaginada
                  columnas={COLUMNAS_PARTIDOS}
                  filas={partidosSeguidos.map((p) => filaPartido(p, cargar))}
                  etiqueta="Partidos que sigo"
                  tam={10}
                  nombre="partidos"
                  buscar={{ placeholder: "Buscar un partido…", etiqueta: "Buscar en los partidos que sigo" }}
                />
              ),
          },
        ]}
      />

      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-meta text-inkSoft">
        <Bell size={15} className="shrink-0 text-mute" aria-hidden />
        <span>
          Avisos por correo: en <Link href="/app/configuracion" className="font-medium text-granate underline underline-offset-2">Configuración</Link>.
        </span>
        <Ayuda titulo="¿Qué avisos llegan?">
          Cuando se lea un contrato que financiaste o haya señales en tu zona. Por ahora sólo guardamos tu preferencia:
          todavía no enviamos correos.
        </Ayuda>
      </p>
    </div>
  );
}

// ─── cifras ──────────────────────────────────────────────────────────────────

/**
 * Las cifras de la cuenta (§10.7), cada una con su denominador. Sin aportes, las denuncias
 * son su única cifra de impacto; sin ninguna de las dos, no hay cifras que mostrar.
 */
function indicadoresCuenta(nAportes: number, r: Impacto["resumen"], denuncias: DenunciaMia[]): Indicador[] {
  const items: Indicador[] = [];
  if (nAportes > 0) {
    items.push(
      { valor: numero(r.contratosFinanciados), etiqueta: "contratos financiados", contexto: `en ${plural(nAportes, "aporte", "aportes")}`, ayuda: <Ayuda titulo="¿Qué cuenta?">Contratos de tus aportes ya validados.</Ayuda> },
      { valor: numero(r.procesados), etiqueta: "financiados leídos", contexto: `de ${numero(r.contratosFinanciados)}` },
      {
        valor: numero(r.senales),
        etiqueta: "con señales",
        contexto: `de ${numero(r.procesados)} leídos`,
        ayuda: <Ayuda titulo="¿Qué es “con señales”?">Leídos con al menos una señal publicada.</Ayuda>,
      },
    );
  }
  if (denuncias.length > 0) {
    items.push({ valor: numero(denuncias.length), etiqueta: denuncias.length === 1 ? "denuncia enviada" : "denuncias enviadas", contexto: "con esta cuenta" });
    if (nAportes === 0) {
      const confirmadas = denuncias.filter((d) => d.confirmado).length;
      items.push({
        valor: numero(confirmadas),
        etiqueta: confirmadas === 1 ? "confirmada" : "confirmadas",
        contexto: `de ${numero(denuncias.length)} enviadas`,
        ayuda: <Ayuda titulo="¿Qué es una denuncia confirmada?">La que respaldan dos o más reportes.</Ayuda>,
      });
    }
  }
  return items;
}

// ─── aportes ─────────────────────────────────────────────────────────────────

const COLUMNAS_APORTES: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "148px" },
  { clave: "aporte", titulo: "Aporte", ancho: "minmax(0,1fr)" },
  { clave: "leidos", titulo: "Leídos", ancho: "96px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "112px", alinear: "der", desde: "lg" },
  { clave: "fecha", titulo: "Registrado", ancho: "104px", desde: "lg" },
];

/** Un aporte: estado · zona y código · leídos · con señales · fecha; el seguimiento, en el panel. */
function filaAporte(a: AporteMio, recargar: () => void): Fila {
  // Pendiente y sin comprobante: lo único que el usuario tiene que hacer, dicho en la fila.
  const falta = a.estado === "pendiente_pago" && !a.tieneComprobante;
  const apoyo = a.tipo === "apoyo";
  const cantidad = apoyo
    ? `${a.periodicidad === "mensual" ? "Aporte de cada mes" : "Aporte único"} por ${soles(a.montoPen)}`
    : `${plural(a.contratos, "contrato", "contratos")} por ${soles(a.montoPen)}`;
  return {
    id: a.codigo,
    buscable: [a.zona, a.codigo].join(" "),
    celdas: {
      estado: <ChipAporte estado={a.estado} />,
      aporte: (
        <CeldaPrincipal
          titulo={a.zona}
          meta={[
            <Dato key="c" tipo="codigo" nombre="Código del aporte" mono>
              <span translate="no">{a.codigo}</span>
            </Dato>,
            falta ? (
              <span key="f" className="font-medium text-granate">Falta enviar tu comprobante</span>
            ) : (
              <Dato key="n" icono={HandCoins} nombre="Lo que financia">{cantidad}</Dato>
            ),
          ]}
        />
      ),
      leidos: apoyo ? <span className="text-rotulo text-mute">Fondo común</span> : <CeldaNumero sub={`de ${numero(a.contratos)}`}>{numero(a.procesados)}</CeldaNumero>,
      senales: apoyo ? <span className="text-rotulo text-mute">No aplica</span> : <CeldaNumero sub={a.enRevision > 0 ? `${numero(a.enRevision)} en revisión` : undefined}>{numero(a.senales)}</CeldaNumero>,
      fecha: <CeldaFecha fecha={a.createdAt} />,
    },
    detalle: {
      titulo: a.zona,
      etiqueta: `Ver el aporte ${a.codigo} a ${a.zona}`,
      descripcion: (
        <span className="font-mono" translate="no">
          {a.codigo}
        </span>
      ),
      contenido: apoyo ? (
        <div className="space-y-2 text-dato leading-relaxed text-inkSoft">
          <p>
            {cantidad}. Va al fondo común que sostiene la vigilancia: la base de datos, los servidores, la captura de datos y la
            lectura a fondo de los contratos más graves. Nadie elige qué contrato se lee.
          </p>
          <Link href="/app/cuanto-cuesta" className="inline-flex min-h-[24px] items-center gap-1 font-semibold text-granate hover:underline">
            En qué se usa <ArrowRight size={13} aria-hidden />
          </Link>
        </div>
      ) : (
        <DetalleAporte a={a} recargar={recargar} />
      ),
      pie: (
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-meta">
          <Link href={`/impacto/${a.codigo}`} className="inline-flex min-h-[24px] items-center gap-1 font-semibold text-granate underline-offset-2 hover:underline">Comprobante público <ArrowRight size={13} aria-hidden /></Link>
          {a.primerOcid && <Link href={rutaContrato(a.primerOcid, "vivo")} className="min-h-[24px] text-inkSoft underline-offset-2 hover:text-ink hover:underline">Primer contrato leído</Link>}
          {a.comprobanteUrl && <a href={a.comprobanteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[24px] items-center gap-1 text-inkSoft underline-offset-2 hover:text-ink hover:underline">Mi comprobante de pago <ExternalLink size={12} aria-hidden /></a>}
        </span>
      ),
    },
  };
}

/**
 * El panel de un aporte (§14.4): su chip → cuánto se leyó (Indicadores) → sus datos en filas →
 * el estado en cuatro pasos → si falta, el comprobante de pago. Antes era una pila de frases
 * ("Registrado el…, validado el…") con una barra de progreso suelta.
 */
function DetalleAporte({ a, recargar }: { a: AporteMio; recargar: () => void }) {
  const paso = indicePaso(a.estado, a.procesados, a.contratos);
  // La zona es el título del panel y el código su bajada: aquí, el resto.
  const datos: DatoClave[] = [
    { etiqueta: "Contratos financiados", valor: numero(a.contratos), mono: true },
    { etiqueta: "Monto", valor: soles(a.montoPen), mono: true },
    { etiqueta: "Registrado", valor: fechaCorta(a.createdAt), mono: true },
    ...(a.pagadaAt ? [{ etiqueta: "Validado", valor: fechaCorta(a.pagadaAt), mono: true }] : []),
  ];
  return (
    <CuerpoDetalle>
      <ChipsDetalle>
        <ChipAporte estado={a.estado} />
      </ChipsDetalle>
      {/* Las cifras, recién cuando hay contratos asignados: antes todo sería un cero. */}
      {paso >= 1 && (
        <Indicadores
          items={[
            {
              valor: numero(a.procesados),
              etiqueta: a.procesados === 1 ? "leído" : "leídos",
              contexto: `de ${numero(a.contratos)}${a.enRevision > 0 ? `, ${numero(a.enRevision)} en revisión` : ""}`,
            },
            { valor: numero(a.senales), etiqueta: "con señales", contexto: `de ${numero(a.procesados)} leídos` },
          ]}
        />
      )}
      <DatosClave items={datos} />
      <BloqueDetalle titulo="Estado del aporte">
        <EstadoAporte estado={a.estado} procesados={a.procesados} contratos={a.contratos} registrado={a.createdAt} />
      </BloqueDetalle>
      {/* Pendiente y sin comprobante: se sube acá mismo (antes el enlace llevaba a un formulario nuevo, en blanco). */}
      {a.estado === "pendiente_pago" && !a.tieneComprobante && (
        <BloqueDetalle titulo="Tu comprobante de pago">
          <p className="mb-2 text-meta text-inkSoft">Envía la captura o constancia de tu pago para que podamos validarlo.</p>
          <SubirComprobante codigo={a.codigo} onSubido={recargar} compacto />
        </BloqueDetalle>
      )}
    </CuerpoDetalle>
  );
}

// ─── denuncias ───────────────────────────────────────────────────────────────

const COLUMNAS_DENUNCIAS: Columna[] = [
  { clave: "estado", titulo: "Estado", ancho: "200px", desde: "md" },
  { clave: "denuncia", titulo: "Denuncia", ancho: "minmax(0,1fr)" },
  { clave: "fecha", titulo: "Enviada", ancho: "104px", desde: "md" },
];

/**
 * Una denuncia: estado (chip) · qué se denunció, su categoría y su zona · fecha. En el
 * celular el estado va en palabras en la meta. Una denuncia a una entidad no tiene ficha
 * pública: su fila abre un panel que explica por qué, no un enlace a una página que no existe.
 */
function filaDenuncia(d: DenunciaMia): Fila {
  const meta = CATEGORIA_META[d.categoria as CategoriaDenuncia];
  const reservada = esDeEntidad(d);
  const e = estadoDenuncia(d, reservada);
  const zona = [d.distrito, d.provincia, d.region].filter(Boolean).join(", ") || "Sin zona";
  const titulo = d.descripcion || "Denuncia sin descripción";
  return {
    id: d.id,
    href: reservada ? undefined : `/app/denuncias/${d.id}`,
    // Lo que el usuario escribió es suyo: lo puede buscar en su propia cuenta.
    buscable: [titulo, meta?.label ?? d.categoria, zona, e.label].filter(Boolean).join(" "),
    celdas: {
      estado: <ChipDenuncia e={e} />,
      denuncia: (
        <CeldaPrincipal
          titulo={titulo}
          meta={
            <>
              <span className="md:hidden">
                {e.label}
                <Separador />
              </span>
              <Partes
                partes={[
                  <Dato key="c" tipo="tipo" nombre="Categoría">{meta?.label ?? d.categoria}</Dato>,
                  <Dato key="z" tipo="lugar">{zona}</Dato>,
                ]}
              />
            </>
          }
        />
      ),
      fecha: <CeldaFecha fecha={d.createdAt} />,
    },
    detalle: reservada
      ? {
          titulo,
          etiqueta: `Ver por qué la denuncia «${titulo}» no se publica`,
          descripcion: `Enviada el ${fechaCorta(d.createdAt)}`,
          // §14.4: chip → datos en filas → por qué no se publica → lo que escribiste, citado.
          contenido: (
            <CuerpoDetalle>
              <ChipsDetalle>
                <ChipDenuncia e={e} />
              </ChipsDetalle>
              <DatosClave
                items={[
                  { etiqueta: "Categoría", valor: meta?.label ?? d.categoria },
                  { etiqueta: "Zona", valor: zona === "Sin zona" ? null : zona },
                  { etiqueta: "Código", valor: d.id, mono: true },
                ]}
              />
              <BloqueDetalle titulo="Por qué no se publica">
                <p className="text-inkSoft">
                  Las denuncias a una entidad quedan en reserva y no tienen ficha pública. La tuya está registrada con tu
                  cuenta.
                </p>
              </BloqueDetalle>
              {titulo.length > 70 && (
                <BloqueDetalle titulo="Lo que escribiste">
                  <CitaDetalle>{titulo}</CitaDetalle>
                </BloqueDetalle>
              )}
            </CuerpoDetalle>
          ),
        }
      : undefined,
  };
}

interface EstadoDenunciaUI { label: string; cls: string; Icon: LucideIcon; convergencia: boolean }

/**
 * Estado de una denuncia propia, con las palabras de /app/denuncias: una denuncia de obra
 * se publica al llegar (salvo que se rechace) y "confirmada" es la que respaldan dos o más
 * reportes.
 */
function estadoDenuncia(d: DenunciaMia, reservada: boolean): EstadoDenunciaUI {
  const convergencia = !!d.convergenciaId && !reservada;
  if (reservada) return { label: "En reserva, no se publica", cls: "border-line bg-paperDeep text-inkSoft", Icon: Lock, convergencia };
  if (d.convergenciaId) return { label: "Coincide con un contrato", cls: "border-ink bg-ink text-paper", Icon: GitMerge, convergencia };
  if (d.confirmado) return { label: "Confirmada", cls: "border-moss/30 bg-moss/10 text-mossTexto", Icon: CheckCircle2, convergencia };
  if (d.moderacionEstado === "rechazado") return { label: "No publicada", cls: "border-line bg-paperDeep text-inkSoft", Icon: XCircle, convergencia };
  return { label: "Publicada, sin confirmar", cls: "border-line bg-paper text-inkSoft", Icon: Clock, convergencia };
}

function ChipDenuncia({ e }: { e: EstadoDenunciaUI }) {
  const { Icon } = e;
  return (
    <span className={cn("pill whitespace-nowrap", e.cls)}>
      <Icon size={12} className={e.convergencia ? "text-maiz" : ""} aria-hidden /> {e.label}
    </span>
  );
}

// ─── zonas y entidades que sigo ──────────────────────────────────────────────

const COLUMNAS_ZONAS: Columna[] = [
  { clave: "estado", titulo: "", ancho: "10px" },
  { clave: "zona", titulo: "Zona", ancho: "minmax(0,1fr)" },
  { clave: "cola", titulo: "En cola", ancho: "92px", alinear: "der" },
  { clave: "financiados", titulo: "Financiados", ancho: "104px", alinear: "der", desde: "md" },
  { clave: "senales", titulo: "Con señales", ancho: "104px", alinear: "der", desde: "lg" },
];

type ZonaSeguida = Impacto["zonasSeguidas"][number];

/** El nivel en palabras: el API lo manda crudo ("departamento"). */
const NIVEL: Record<string, string> = { departamento: "Región", provincia: "Provincia", distrito: "Distrito" };

/**
 * Una zona que sigo, con la anatomía de la lista de /app/financiar: estado (punto, y en
 * palabras en la meta) · zona · en cola · financiados · con señales. Ir a la zona y dejar
 * de seguirla van en el panel: una fila es una sola acción.
 */
function filaZona(z: ZonaSeguida, recargar: () => void): Fila {
  const estado = z.estado as ZonaEstado;
  const regionId = UBIGEO_REGION[z.ubigeo.slice(0, 2)];
  const etiquetaEstado = ESTADO_LABEL[estado] ?? z.estado;
  return {
    id: z.ubigeo,
    buscable: [z.nombre, NIVEL[z.nivel] ?? z.nivel, etiquetaEstado].join(" "),
    celdas: {
      estado: <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", ESTADO_PUNTO[estado] ?? ESTADO_PUNTO.sin_datos)} aria-hidden />,
      zona: (
        <CeldaPrincipal
          titulo={z.nombre}
          meta={[
            <Dato key="n" tipo="tipo" nombre="Nivel">{NIVEL[z.nivel] ?? z.nivel}</Dato>,
            <Dato key="e" icono={CircleDot} nombre="Estado">{etiquetaEstado}</Dato>,
          ]}
        />
      ),
      cola: <CeldaNumero>{numero(z.pendientes)}</CeldaNumero>,
      financiados: <CeldaNumero sub={`${numero(z.procesados)} leídos`}>{numero(z.financiados)}</CeldaNumero>,
      senales: <CeldaNumero>{numero(z.senales)}</CeldaNumero>,
    },
    detalle: {
      titulo: z.nombre,
      etiqueta: `Ver ${z.nombre}`,
      descripcion: NIVEL[z.nivel] ?? z.nivel,
      // §14.4: chip de estado → cifras; ir a la zona y dejar de seguirla, al pie.
      contenido: (
        <CuerpoDetalle>
          <ChipsDetalle>
            <span className="pill border-line bg-paper text-inkSoft">
              <span className={cn("h-2 w-2 rounded-full", ESTADO_PUNTO[estado] ?? ESTADO_PUNTO.sin_datos)} aria-hidden />
              {etiquetaEstado}
            </span>
          </ChipsDetalle>
          <Indicadores
            items={[
              { valor: numero(z.pendientes), etiqueta: "en cola", contexto: "esperan financiamiento" },
              { valor: numero(z.financiados), etiqueta: "financiados", contexto: `${numero(z.procesados)} ya leídos` },
              {
                valor: numero(z.senales),
                etiqueta: "con señales",
                contexto: `de ${numero(z.procesados)} leídos${z.enRevision > 0 ? `, ${numero(z.enRevision)} en revisión` : ""}`,
              },
            ]}
          />
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <>
              <EnlaceAccion href={`/app/financiar/${z.ubigeo}`} flecha>
                Financiar su lectura
              </EnlaceAccion>
              {regionId && (
                <EnlaceAccion href={`/app/mapa?region=${regionId}`} variante="secundario">
                  <MapPin size={14} aria-hidden /> Verla en el mapa
                </EnlaceAccion>
              )}
            </>
          }
          secundarias={<DejarDeSeguir onClick={() => dejarDeSeguir("zona", z.ubigeo).then(recargar)} />}
        />
      ),
    },
  };
}

const COLUMNAS_ENTIDADES: Columna[] = [{ clave: "entidad", titulo: "Entidad", ancho: "minmax(0,1fr)" }];

function filaEntidad(e: Impacto["entidadesSeguidas"][number], recargar: () => void): Fila {
  return {
    id: e.ruc,
    buscable: [e.nombre, e.ruc].join(" "),
    celdas: {
      entidad: <CeldaPrincipal titulo={e.nombre} meta={[<Dato key="r" tipo="ruc" mono>RUC {e.ruc}</Dato>]} />,
    },
    detalle: {
      titulo: e.nombre,
      etiqueta: `Ver ${e.nombre}`,
      descripcion: "Entidad que sigues",
      // §14.4: sus datos en filas (el nombre ya es el título); abrir la ficha y dejar de seguirla, al pie.
      contenido: (
        <CuerpoDetalle>
          <DatosClave items={[{ etiqueta: "RUC", valor: e.ruc, mono: true }]} />
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <EnlaceAccion href={`/entidad/${e.ruc}`} flecha>
              <Building2 size={14} aria-hidden /> Abrir su ficha
            </EnlaceAccion>
          }
          secundarias={<DejarDeSeguir onClick={() => dejarDeSeguir("entidad", e.ruc).then(recargar)} />}
        />
      ),
    },
  };
}

const COLUMNAS_EMPRESAS: Columna[] = [
  { clave: "empresa", titulo: "Empresa", ancho: "minmax(0,1fr)" },
  { clave: "gano", titulo: "Ganó", ancho: "112px", alinear: "der", desde: "md" },
  { clave: "graves", titulo: "Antecedentes", ancho: "128px", alinear: "der", desde: "lg" },
];

/**
 * Una empresa que sigo (migración 191, sólo RUC 20): su nombre, a cuántas entidades vende, lo que ganó y sus
 * antecedentes graves; en el panel, lo de su ficha en filas, y abrirla o dejar de seguirla al pie.
 */
function filaEmpresa(e: EmpresaSeguidaResumen, recargar: () => void): Fila {
  const nombre = e.nombre ? tituloNatural(e.nombre) : `Empresa con RUC ${e.ruc}`;
  const datos: DatoClave[] = [
    { etiqueta: "RUC", valor: e.ruc, mono: true },
    { etiqueta: "En la SUNAT", valor: e.estadoSunat },
    { etiqueta: "Le vende a", valor: e.soloMenores ? "Sólo compras menores" : plural(e.entidades, "entidad", "entidades") },
    { etiqueta: "Procesos ganados", valor: e.adjProcesos ? `${numero(e.adjProcesos)} por ${soles(e.adjMonto)}` : null, mono: true },
    { etiqueta: "Órdenes de compra y servicio", valor: e.ordN ? `${numero(e.ordN)} por ${soles(e.ordMonto)}` : null, mono: true },
    { etiqueta: "Última buena pro", valor: e.ultima ? fechaCorta(e.ultima) : null, mono: true },
    { etiqueta: "Inhabilitada", valor: e.inhabilitada ? (e.inhabilitadaHasta ? `Hasta el ${fechaCorta(e.inhabilitadaHasta)}` : "Sí") : null },
  ];
  return {
    id: e.ruc,
    buscable: [nombre, e.ruc].join(" "),
    celdas: {
      empresa: (
        <CeldaPrincipal
          titulo={nombre}
          meta={[
            <Dato key="r" tipo="ruc" mono>RUC {e.ruc}</Dato>,
            e.soloMenores ? <Dato key="m" icono={Building2} nombre="Le vende a">Sólo compras menores</Dato> : <Dato key="n" icono={Building2} nombre="Le vende a">{plural(e.entidades, "entidad", "entidades")}</Dato>,
          ]}
        />
      ),
      gano: <CeldaNumero sub={e.adjProcesos ? plural(e.adjProcesos, "proceso", "procesos") : undefined}>{e.adjMonto ? solesCompacto(e.adjMonto) : "Nada"}</CeldaNumero>,
      graves: <CeldaNumero sub={e.nMedia ? `${numero(e.nMedia)} para revisar` : undefined}>{`${numero(e.nAlta)} ${e.nAlta === 1 ? "grave" : "graves"}`}</CeldaNumero>,
    },
    detalle: {
      titulo: nombre,
      etiqueta: `Ver ${nombre}`,
      descripcion: "Empresa que sigues",
      contenido: (
        <CuerpoDetalle>
          <DatosClave items={datos} />
          {e.nAlta + e.nMedia > 0 && (
            <BloqueDetalle titulo="Sus antecedentes">
              <p className="text-inkSoft">
                {plural(e.nAlta, "antecedente grave", "antecedentes graves")} y {plural(e.nMedia, "para revisar", "para revisar")}: datos
                oficiales que coinciden con la empresa (sanciones, vínculos, aportes). Son indicios para revisar, no acusaciones.
              </p>
            </BloqueDetalle>
          )}
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <EnlaceAccion href={`/empresa/${e.ruc}`} flecha>
              <Briefcase size={14} aria-hidden /> Abrir su ficha
            </EnlaceAccion>
          }
          secundarias={<DejarDeSeguir onClick={() => dejarDeSeguir("empresa", e.ruc).then(recargar)} />}
        />
      ),
    },
  };
}

const COLUMNAS_PARTIDOS: Columna[] = [
  { clave: "partido", titulo: "Partido", ancho: "minmax(0,1fr)" },
  { clave: "gobiernos", titulo: "Gobiernos", ancho: "104px", alinear: "der", desde: "md" },
];

/** Dónde gobierna en el período vigente, en palabras: sólo los niveles con alguno. */
function dondeGobierna(p: PartidoSeguidoResumen): string {
  return (
    listaY([
      ...(p.regional > 0 ? [plural(p.regional, "región", "regiones")] : []),
      ...(p.provincial > 0 ? [plural(p.provincial, "provincia", "provincias")] : []),
      ...(p.distrital > 0 ? [plural(p.distrital, "distrito", "distritos")] : []),
    ]) || "Sin gobiernos en este período"
  );
}

/** Un partido que sigo (migración 191): dónde gobierna hoy; abrir su ficha o dejar de seguirlo, al pie del panel. */
function filaPartido(p: PartidoSeguidoResumen, recargar: () => void): Fila {
  const nombre = p.nombre ?? p.clave;
  const periodo = `${p.anio + 1} a ${p.anio + 4}`;
  const total = p.regional + p.provincial + p.distrital;
  return {
    id: p.clave,
    buscable: nombre,
    celdas: {
      partido: <CeldaPrincipal titulo={nombre} meta={[<Dato key="g" tipo="lugar" nombre={`Gobierna en ${periodo}`}>{dondeGobierna(p)}</Dato>]} />,
      gobiernos: <CeldaNumero sub={periodo}>{numero(total)}</CeldaNumero>,
    },
    detalle: {
      titulo: nombre,
      etiqueta: `Ver ${nombre}`,
      descripcion: "Partido que sigues",
      contenido: (
        <CuerpoDetalle>
          <DatosClave
            items={[
              { etiqueta: `Gobierna (${periodo})`, valor: dondeGobierna(p) },
              { etiqueta: "Lo nuevo", valor: "Los contratos con antecedentes de esos gobiernos, en la pestaña «Lo nuevo»" },
            ]}
          />
        </CuerpoDetalle>
      ),
      pie: (
        <PieDetalle
          principal={
            <EnlaceAccion href={`/app/partidos/${p.clave}`} flecha>
              <Landmark size={14} aria-hidden /> Abrir su ficha
            </EnlaceAccion>
          }
          secundarias={<DejarDeSeguir onClick={() => dejarDeSeguir("partido", p.clave).then(recargar)} />}
        />
      ),
    },
  };
}

/** "Dejar de seguir": neutro (no es un error ni un riesgo), al pie del panel. */
function DejarDeSeguir({ onClick }: { onClick: () => Promise<unknown> }) {
  const [enviando, setEnviando] = useState(false);
  return (
    <button
      type="button"
      disabled={enviando}
      onClick={() => {
        setEnviando(true);
        // Si falla, el botón vuelve a quedar disponible; si no, la fila desaparece al recargar.
        onClick().catch(() => {}).finally(() => setEnviando(false));
      }}
      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 text-meta text-inkSoft underline-offset-2 transition-colors duration-rapido hover:bg-paperDeep hover:text-ink hover:underline disabled:opacity-60"
    >
      {enviando && <Loader2 size={13} className="animate-spin" aria-hidden />} Dejar de seguir
    </button>
  );
}

// ─── piezas ──────────────────────────────────────────────────────────────────

function Reclamar({ codigo, onOk }: { codigo: string; onOk: () => void }) {
  const [email, setEmail] = useState("");
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEstado("enviando"); setMsg(null);
    try { await reclamarAporte(codigo, email.trim()); setEstado("ok"); onOk(); }
    catch (err) { setEstado("error"); setMsg((err as Error).message); }
  };
  if (estado === "ok") return null;
  return (
    <form onSubmit={enviar} className="rounded-2xl border border-granate/30 bg-granate-50 p-5">
      <h2 className="inline-flex flex-wrap items-center gap-2 font-display text-bloque font-bold text-ink">
        <Link2 size={16} className="text-granate" aria-hidden /> Asociar el aporte <span className="font-mono" translate="no">{codigo}</span> a tu cuenta
      </h2>
      <p className="mt-1 text-meta text-inkSoft">Escribe el correo que usaste al aportar (es la prueba de que es tuyo; el código es público).</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input type="email" inputMode="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tu@correo.pe" className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2 text-dato leading-5 text-ink placeholder:text-mute focus:border-granate" aria-label="Correo usado en el aporte" />
        <button type="submit" disabled={estado === "enviando"} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-dato leading-5 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep disabled:opacity-60">
          {estado === "enviando" && <Loader2 size={14} className="animate-spin" aria-hidden />} Asociar
        </button>
      </div>
      {msg && <p className="mt-2 text-meta text-crimsonTexto" role="alert">{msg === "email_mismatch" ? "El correo no coincide con el usado en el aporte." : msg}</p>}
    </form>
  );
}

/**
 * Vacío de UNA sección, sin llamita: en esta página pueden convivir varios y la llamita
 * va una sola vez por pantalla (DESIGN_SYSTEM.md §2.4). Cuando la cuenta no tiene nada,
 * se muestra un único `EstadoVacio` con la llamita en su lugar.
 */
function VacioSeccion({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line bg-paperSoft p-6 text-center">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-paper text-mute" aria-hidden>
        <Icon size={18} />
      </span>
      <div className="max-w-sm text-dato leading-5 text-inkSoft">{children}</div>
    </div>
  );
}

function SinSesion() {
  // Sin cuenta no hay nada propio que mostrar, pero sí lo que ya hicieron entre todos (datos reales de la API).
  return (
    <div className="grid gap-5 lg:grid-cols-2 lg:items-start">
      <div className="space-y-3">
        <Franja
          icono={<LogIn size={18} />}
          titulo="Entra para reunir lo tuyo"
          accion={
            <Link href="/login?next=/app/mi-impacto" prefetch={false} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-granate px-5 py-2 text-dato leading-5 font-semibold text-paper transition-colors duration-rapido hover:bg-granate-deep"><LogIn size={16} aria-hidden /> Entrar</Link>
          }
        >
          Sin cuenta puedes ver todo, financiar como invitado (con tu código VIG-…) y denunciar sin tu nombre.{" "}
          <Link href="/signup?next=/app/mi-impacto" prefetch={false} className="font-semibold text-granate underline underline-offset-2">Crear cuenta</Link>
        </Franja>
        <Beneficios
          columnas={2}
          items={[
            { icono: <Link2 size={16} />, titulo: "Tus aportes", texto: "Su progreso en vivo, los contratos con señales y tu comprobante." },
            { icono: <Camera size={16} />, titulo: "Tus denuncias", texto: "Las que enviaste con sesión y en qué estado están." },
            { icono: <MapPin size={16} />, titulo: "Zonas que sigues", texto: "Lo nuevo en las regiones que te importan." },
            { icono: <Building2 size={16} />, titulo: "Entidades, empresas y partidos", texto: "Lo nuevo de lo que quieres vigilar: contratos con antecedentes, informes y sanciones." },
          ]}
        />
        <CifrasDelPais />
        <AliadosDelPais />
      </div>
      <RecientesDelPais cuantos={11} />
    </div>
  );
}
