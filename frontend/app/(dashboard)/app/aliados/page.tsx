import Link from "next/link";
import { Ayuda, EncabezadoPagina, EstadoError, Pagina } from "@/components/patrones";
import { Cifras } from "@/components/ui/Cifras";
import { CapacidadColectiva } from "@/components/aliados/CapacidadColectiva";
import { MuroAliados, parseOrden } from "@/components/aliados/MuroAliados";
import { ReglasIndependencia } from "@/components/aliados/ReglasIndependencia";
import { InvitacionFinanciar } from "@/components/aliados/InvitacionFinanciar";
import { AvisoMaqueta, MarcaMaquetaBarra } from "@/components/aliados/AvisoMaqueta";
import { FiltroRegion } from "@/components/auditoria/FiltroRegion";
import { getEstadoGlobal, getZonas } from "@/lib/financiamiento";
import { getResumenContratos } from "@/lib/contratos";
import { numero } from "@/lib/formato";
import { hrefSinMaqueta, maquetaActiva, totalesMaqueta } from "@/lib/maqueta-aliados";

export const metadata = {
  title: "Aliados de transparencia",
  description:
    "Cuánto se ha leído de todo lo que hay por leer, y quién pagó por ello. El reconocimiento se cuenta en contratos, nunca en soles, y nadie elige qué se audita.",
};

export const revalidate = 300;

/**
 * /app/aliados — reordenada de raíz.
 *
 * Antes abría con un podio de tres puestos sobre un escenario morado, dos de
 * ellos "vacante", con medallas emoji y una animación en el puesto 1. Con un
 * único financiador —que es la propia plataforma— esa superficie probaba
 * soledad, y le daba escenario a quien paga en una herramienta cuya promesa
 * central es que *el que paga no elige*.
 *
 * El orden: primero el muro de quién aportó —una ficha por aliado, con su logo
 * clickeable, su franja textil de reconocimiento y su resumen al costado—,
 * después la capacidad colectiva (cuánto de lo publicado se financió y cuánto de
 * eso ya se leyó) y al final las reglas que hacen que ese dinero no compre nada,
 * cerrando con la única invitación a financiar, en granate profundo.
 *
 * Dato primero (DESIGN_SYSTEM.md §10.7): la bajada es una oración y lo que explica
 * por qué el dinero no compra nada vive en el ⓘ del título y en las reglas del pie.
 *
 * En DESARROLLO la página mezcla tres aliados INVENTADOS (lib/maqueta-aliados.ts)
 * para poder mirar el diseño con volumen, y lo avisa arriba, en la barra pegajosa
 * y en cada tarjeta; `?maqueta=0` los apaga. En PRODUCCIÓN no existen nunca, ni
 * con `?maqueta=1` escrito a mano.
 */
export default async function AliadosPage({
  searchParams,
}: {
  searchParams?: { ubigeo?: string; pagina?: string; maqueta?: string; orden?: string };
}) {
  const ubigeo = searchParams?.ubigeo && /^\d{2,6}$/.test(searchParams.ubigeo) ? searchParams.ubigeo : undefined;
  const pagina = Math.max(1, Number.parseInt(searchParams?.pagina ?? "1", 10) || 1);
  const maqueta = maquetaActiva(searchParams?.maqueta);
  const orden = parseOrden(searchParams?.orden);

  const [estado, zonas, resumenPais, resumenZona] = await Promise.all([
    getEstadoGlobal(),
    getZonas("departamento"),
    getResumenContratos(),
    ubigeo ? getResumenContratos({ ubigeo }) : Promise.resolve(null),
  ]);

  // El filtro ya no lista solo las regiones con aliados: una región con cola y sin
  // nadie que la financie es justo la que hay que poder mirar, y ahora su vacío
  // enseña qué falta en vez de quedar en blanco.
  const opciones = (zonas ?? [])
    .filter((z) => z.totalCola > 0)
    .sort((a, b) => b.pendientes - a.pendientes || a.nombre.localeCompare(b.nombre, "es"))
    .map((z) => ({
      ubigeo: z.ubigeo,
      nombre: z.nombre,
      hint: `${numero(z.pendientes)} sin financiar`,
    }));
  const zona = ubigeo ? (zonas ?? []).find((z) => z.ubigeo === ubigeo) : undefined;
  const ambito = zona?.nombre ?? "todo el Perú";

  // Los aliados de maqueta financian y hacen leer contratos de mentira: si no se
  // suman también acá, la cascada diría "45 financiados" arriba y el muro
  // listaría 247 abajo. Con `maqueta` apagado esto es exactamente cero.
  const extra = maqueta ? totalesMaqueta(ubigeo) : { financiados: 0, leidos: 0, conSenal: 0, enRevision: 0 };

  const publicados = (ubigeo ? resumenZona?.total : resumenPais?.total) ?? 0;
  // Financiados leídos (asignaciones procesadas), no "leídos" a secas: ver CapacidadColectiva.
  const leidos = (zona ? zona.procesados : estado?.contratosProcesados ?? 0) + extra.leidos;
  const financiados = (zona ? zona.financiados : estado?.contratosFinanciados ?? 0) + extra.financiados;

  // `?maqueta=0`: en desarrollo la vista sin parámetro vuelve a encender la maqueta.
  const salirMaqueta = hrefSinMaqueta(ubigeo ? `/app/aliados?ubigeo=${ubigeo}` : "/app/aliados");

  return (
    <Pagina className="space-y-8">
      <EncabezadoPagina
        titulo="Aliados de transparencia"
        bajada="Quién financia que estos contratos se lean. Se cuenta en contratos, nunca en soles."
        ayuda={
          <Ayuda titulo="¿Qué compra un aliado?">
            Nada: ni un resultado ni una región. Los contratos se asignan por antigüedad, en código, y lo que salga se
            publica igual, aunque señale a quien pagó.
          </Ayuda>
        }
        acciones={
          estado ? (
            <Cifras
              tam="lg"
              items={[
                { n: financiados, texto: financiados === 1 ? "contrato financiado" : "contratos financiados" },
                { n: leidos, de: financiados, texto: "financiados leídos" },
              ]}
            />
          ) : undefined
        }
      />

      {maqueta && (
        <AvisoMaqueta volverHref={salirMaqueta} financiados={extra.financiados} leidos={extra.leidos} />
      )}

      {/* Filtro pegajoso: el libro mayor pagina hasta 24 filas, cambiar de región no debería
          obligar a volver arriba. top-0 porque esta ruta cuelga de (dashboard)/layout.tsx, que
          no renderiza Header público — solo la barra LATERAL. */}
      <div className="sticky top-0 z-barra -mx-4 border-b border-line bg-paper/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm tabular-nums text-inkSoft" aria-live="polite">
            {zona
              ? <>{zona.nombre}: <strong className="font-semibold text-ink">{numero(zona.pendientes)}</strong> contratos sin financiar</>
              : "Todo el Perú"}
          </p>
          {/* `role="search"`: es el filtro de la vista, y así se anuncia como tal. */}
          <form role="search" aria-label="Filtrar aliados por región" className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* El recordatorio de maqueta viaja con la barra: mientras se recorre el muro,
                no se va de la pantalla. */}
            {maqueta && <MarcaMaquetaBarra volverHref={salirMaqueta} />}
            <FiltroRegion opciones={opciones} valor={ubigeo} />
          </form>
        </div>
      </div>

      {/* EL MURO VA PRIMERO. Esta página existe para reconocer a quien financia: el
          contexto no puede ganarle la pantalla al protagonista. */}
      <MuroAliados
        region={ubigeo}
        pagina={pagina}
        nombreRegion={zona?.nombre}
        financiadosAmbito={financiados}
        maqueta={maqueta}
        orden={orden}
      />

      {/* Si el API cae, se dice: no se dibujan ceros que parezcan dato. */}
      {estado ? (
        <CapacidadColectiva
          ambito={ambito}
          publicados={publicados}
          cola={zona ? zona.totalCola : (estado.colaGlobal ?? 0) + estado.contratosFinanciados}
          documentosListos={(zona ? zona.documentosListos : estado.documentosListos) ?? 0}
          financiados={financiados}
          leidos={leidos}
          conSenal={(zona ? zona.senales : estado.senalesHalladas) + extra.conSenal}
          enRevision={((zona ? zona.enRevision : estado.enRevision) ?? 0) + extra.enRevision}
          precioPen={zona?.precioPen ?? estado.tarifa?.precioPen ?? 3}
          alcance={estado.alcance ?? null}
        />
      ) : (
        <EstadoError titulo="No pudimos leer el estado de la cola" />
      )}

      <ReglasIndependencia />

      {/* La ÚNICA invitación a financiar de esta página (antes había tres: en el muro, en la
          cascada del déficit y acá). */}
      <InvitacionFinanciar />

      {/* La puerta de vuelta a la maqueta existe sólo en desarrollo (tras salir con
          ?maqueta=0). En producción la maqueta no existe: maquetaActiva() devuelve false
          aunque alguien escriba ?maqueta=1. */}
      {process.env.NODE_ENV !== "production" && !maqueta && (
        <p className="text-[12px] text-mute">
          <Link
            href={ubigeo ? `/app/aliados?ubigeo=${ubigeo}&maqueta=1` : "/app/aliados?maqueta=1"}
            className="underline underline-offset-2 hover:text-ink"
          >
            Ver esta página con aliados de maqueta
          </Link>
          : sólo en desarrollo.
        </p>
      )}
    </Pagina>
  );
}
