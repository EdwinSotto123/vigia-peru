/**
 * La pestaña «Participantes» de la ficha de un contrato (§14.2, §14.3): quiénes se registraron en el proceso (registro
 * OCDS), quiénes presentaron oferta (CONOSCE) y quién ganó, una fila por participante con su ficha SUNAT, su historial
 * en Vigía y sus banderas; cada fila abre el panel compartido con todo (§14.4). Va cuando el expediente no se leyó:
 * con dictamen, «Postores y ofertas» trae las ofertas leídas de las actas.
 *
 * Antes la cifra de cabecera decía «17 postores» de un proceso en que ofertaron 3: el OCDS llama «tenderers» a los que
 * se REGISTRARON (pedido del usuario, 2026-10-26: «la API de SEACE te trae participantes y demás»).
 *
 * Server component; el panel de cada fila es una isla de cliente (ParticipanteDetalle.tsx) que recibe el participante como
 * dato. Los nombres de personas naturales y sus RUC llegan tapados por la API; aquí no se buscan por nombre.
 */

import { BadgeCheck, Trophy, UserRound } from "lucide-react";
import { Ayuda, CabeceraPestana, FuenteDato } from "@/components/patrones";
import { CeldaPrincipal, TablaPaginada, type Columna, type Fila } from "@/components/listado";
import { Dato } from "@/components/ui/Dato";
import { CrucesCelda } from "./CrucesCelda";
import { ChipEstado, DetalleParticipante, NombreParticipante } from "./ParticipanteDetalle";
import { conDesde } from "@/lib/desde";
import { rutaEmpresa } from "@/lib/empresas";
import { fechaCorta, numero, oracion, plural } from "@/lib/formato";
import { tituloNatural } from "@/lib/landing";
import { esPersonaNatural, type ContratoDetalle as Detalle } from "@/lib/contratos";
import {
  ETIQUETAS_PARTICIPANTE, EXPLICA_VINCULO, antecedentesDe, antiguedad, estadoParticipante, estadoSunat, rucVisibleDe,
  vinculosComoBanderas, type Participante,
} from "@/lib/procesoContrato";

const AYUDA_FICHA =
  "Su estado y su condición en la SUNAT, la fecha de alta de su RUC (entre paréntesis, cuánto llevaba inscrita el día de la convocatoria) y, de los procesos en que presentó oferta desde 2018, cuántos ganó.";

// Por el ancho de la TABLA (medida="contenedor"): en la ficha, la columna de las pestañas mide ~660 px a 1366 de pantalla.
// Ahí van el participante, lo que hizo en el proceso (y lo que lo une ahí con el ganador u otro participante) y sus
// antecedentes; su ficha (SUNAT, fundación, procesos ganados), debajo del nombre, cada dato con su ícono (en columnas de
// 100 px se partían en tres renglones por fila, y un consorcio sin RUC decía «Sin dato» tres veces). Desde 1024 px de
// tabla, en su columna.
const COLUMNAS: Columna[] = [
  { clave: "participante", titulo: "Participante", ancho: "minmax(0,1.5fr)" },
  {
    clave: "estado", titulo: "En el proceso", ancho: "minmax(10.5rem,0.9fr)", desde: "md", apilar: true,
    ayuda: (
      <Ayuda titulo="¿Qué dice esta columna?">
        <span className="block">Si ganó, si presentó oferta (con el día, según CONOSCE) o si sólo se registró.</span>
        <span className="mt-2 block">
          Debajo, lo que lo une en ESTE proceso con el ganador o con otro participante: el mismo domicilio fiscal (SUNAT) o un
          socio o representante en común (RNP). Es un dato, no una acusación.
        </span>
      </Ayuda>
    ),
  },
  {
    clave: "banderas", titulo: "Antecedentes", ancho: "minmax(0,1fr)", desde: "md", apilar: "con-rotulo",
    ayuda: (
      <Ayuda titulo="¿Qué son los antecedentes?">
        Lo que otros registros públicos dicen de la empresa en otros procesos: sanciones, penalidades, aportes, precios
        altos, si gana casi siempre a la misma entidad. Son datos con su fuente, no acusaciones; en el panel de cada fila, todos.
      </Ayuda>
    ),
  },
  {
    clave: "ficha", titulo: "Su ficha", ancho: "minmax(0,1.2fr)", desde: "xl", apilar: true,
    ayuda: <Ayuda titulo="¿Qué es su ficha?">{AYUDA_FICHA}</Ayuda>,
  },
];

/**
 * Su ficha en una línea (dos si no entra): el estado en la SUNAT, cuándo se fundó y cuánto llevaba al convocarse, y
 * cuántos procesos ganó de los que ofertó; cada dato con su ícono. Sin nada de eso, por qué.
 */
function FichaCorta({ p }: { p: Participante }) {
  const s = p.sunat;
  const h = p.historial;
  const ant = antiguedad(s?.mesesAlConvocar ?? null);
  // En este orden caben dos por línea en la columna de ~240 px: el estado y lo ganado arriba, la fundación debajo.
  const partes = [
    s && estadoSunat(s) && <Dato key="sunat" icono={BadgeCheck} nombre="En la SUNAT">{estadoSunat(s)}</Dato>,
    h && <Dato key="ganadas" icono={Trophy} nombre="Procesos ganados">{`Ganó ${numero(h.ganadas)} de ${numero(h.postulaciones)}`}</Dato>,
    s?.fechaAlta && <Dato key="alta" tipo="fecha" nombre="Fundada">{`Fundada el ${fechaCorta(s.fechaAlta)}${ant ? ` (${ant})` : ""}`}</Dato>,
  ].filter(Boolean);
  if (!partes.length) {
    return (
      <span className="text-meta text-mute">
        {p.tipo === "consorcio" ? "Sin ficha en la SUNAT: no tiene RUC propio" : p.tipo === "persona" ? "Vigía no arma la ficha de una persona natural" : "Vigía no tiene su ficha de la SUNAT"}
      </span>
    );
  }
  return <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-meta text-inkSoft">{partes}</span>;
}

/**
 * Sus antecedentes en una línea: en la fila, el más grave entero y «+n» (la columna mide ~180 px y dos quedaban recortados
 * en «Mism…»). Sin historial en Vigía, «Sin dato» (no «Sin antecedentes», que se leería limpio).
 */
function Antecedentes({ p }: { p: Participante }) {
  if (!p.historial) return <span className="text-meta text-mute">Sin dato</span>;
  return <CrucesCelda cruces={antecedentesDe(p)} etiquetas={ETIQUETAS_PARTICIPANTE} etiquetaLista="Antecedentes del participante" max={1} />;
}

/** Lo que lo une en este proceso con el ganador u otro participante, como bandera (nada si no hay). */
function Vinculos({ p, max = 1 }: { p: Participante; max?: number }) {
  const v = vinculosComoBanderas(p);
  if (!v.length) return null;
  return <CrucesCelda cruces={v} etiquetas={ETIQUETAS_PARTICIPANTE} explicaciones={EXPLICA_VINCULO} etiquetaLista="Lo que lo une con otros participantes" max={max} />;
}

export function SeccionParticipantes({ c }: { c: Detalle }) {
  const ps = c.participantes ?? [];
  const conOfertas = ps.some((p) => p.oferta);
  const registrados = ps.filter((p) => p.registrado).length;
  const ofertaron = ps.filter((p) => p.oferta).length;
  const sinRegistro = ps.filter((p) => p.oferta && !p.registrado).length;
  // La vuelta desde la ficha de una empresa: a esta pestaña de este contrato.
  const aqui = `/app/contratos/${encodeURIComponent(c.ocid)}?seccion=participantes`;
  // Los dos conteos, y lo que falta dicho como falta: sin la lista del OCDS o sin las ofertas de CONOSCE.
  const ofertas = conOfertas ? `${plural(ofertaron, "presentó", "presentaron")} oferta` : "CONOSCE todavía no publica quién presentó oferta";
  const resumen = registrados
    ? `${plural(registrados, "participante registrado", "participantes registrados")}, ${ofertas}${sinRegistro ? `; ${plural(sinRegistro, "ofertó", "ofertaron")} sin figurar entre los registrados` : ""}.`
    : `${ofertas} según CONOSCE; el registro OCDS no lista a los participantes.`;
  const hayGanador = ps.some((p) => p.gano);
  const filas: Fila[] = ps.map((p) => filaDe(p, { conOfertas, hayGanador, aqui }));
  return (
    <>
      <CabeceraPestana
        ayuda={
          <Ayuda titulo="¿Registrarse es competir?">
            <span className="block">
              No. Para ofertar, una empresa primero se registra como participante (el registro OCDS los llama a todos
              «tenderers»). Muchas se registran y no presentan oferta: la competencia real son las que ofertaron, según
              CONOSCE.
            </span>
            <span className="mt-2 block">
              De cada una, lo que la une con otros participantes de este proceso, sus antecedentes y su ficha: {AYUDA_FICHA.charAt(0).toLocaleLowerCase("es") + AYUDA_FICHA.slice(1)}
            </span>
          </Ayuda>
        }
      >
        {resumen}
      </CabeceraPestana>
      <TablaPaginada
        columnas={COLUMNAS}
        filas={filas}
        etiqueta="Participantes del proceso: quién se registró, quién ofertó y quién ganó"
        nombre="participantes"
        tam={20}
        medida="contenedor"
        buscar={{ placeholder: "Buscar un participante por razón social o RUC…", etiqueta: "Buscar en los participantes" }}
      />
      <FuenteDato fuente="registro OCDS del OECE (quién se registró), CONOSCE (quién ofertó y ganó), SUNAT y RNP" className="mt-2" />
    </>
  );
}

interface Contexto {
  /** CONOSCE trae quién ofertó en este proceso (sin eso, no se sabe quién no ofertó). */
  conOfertas: boolean;
  hayGanador: boolean;
  /** La ruta de esta pestaña: la vuelta desde la ficha de una empresa. */
  aqui: string;
}

function filaDe(p: Participante, ctx: Contexto): Fila {
  const { conOfertas, aqui } = ctx;
  const estado = estadoParticipante(p, conOfertas);
  const ruc = rucVisibleDe(p);
  const natural = esPersonaNatural(p.ruc);
  const s = p.sunat;
  const h = p.historial;
  const ficha = ruc && p.tipo !== "consorcio" && h ? conDesde(rutaEmpresa(ruc), aqui) : undefined;
  const titulo = p.nombre ?? "Sin razón social";
  return {
    id: p.ruc,
    resaltada: p.gano,
    celdas: {
      // El chip y, al lado, el día en que ofertó (CONOSCE); debajo, lo que lo une con el ganador u otro participante.
      estado: (
        <span className="block min-w-0 max-w-full">
          <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
            <ChipEstado estado={estado} />
            {p.oferta?.desde && <span className="shrink-0 text-rotulo tabular-nums text-mute" title="Día en que presentó su oferta">{fechaCorta(p.oferta.desde)}</span>}
          </span>
          {p.vinculos.length > 0 && <span className="mt-1 block min-w-0"><Vinculos p={p} /></span>}
        </span>
      ),
      participante: (
        <CeldaPrincipal
          titulo={<NombreParticipante ruc={p.ruc} nombre={p.nombre} />}
          textoCompleto={natural ? undefined : titulo}
          dosLineas
          meta={[
            ruc && <Dato key="ruc" tipo="ruc" mono>{ruc}</Dato>,
            natural && <Dato key="persona" icono={UserRound} nombre="Tipo">Persona natural</Dato>,
            // Quiénes lo forman, con sus nombres (antes «Consorcio de 2», sin decir quiénes): en el panel, cada uno con su ficha.
            p.tipo === "consorcio" && (
              <Dato key="consorcio" tipo="personas" nombre="Integrantes del consorcio">
                {p.integrantes.length ? (
                  <>
                    Consorcio de{" "}
                    {p.integrantes.map((x, i) => (
                      <span key={x.ruc}>
                        {i > 0 && (i === p.integrantes.length - 1 ? " y " : ", ")}
                        <NombreParticipante ruc={x.ruc} nombre={x.nombre} />
                      </span>
                    ))}
                  </>
                ) : (
                  "Consorcio"
                )}
              </Dato>
            ),
            s?.distrito && <Dato key="lugar" tipo="lugar" nombre="Distrito de su domicilio fiscal">{tituloNatural(s.distrito)}</Dato>,
          ]}
        />
      ),
      banderas: <Antecedentes p={p} />,
      ficha: <FichaCorta p={p} />,
    },
    detalle: {
      titulo,
      etiqueta: `Ver a ${natural ? "este participante" : titulo}`,
      descripcion: ruc ? <span className="font-mono tabular-nums">RUC {ruc}</span> : natural ? "Persona natural con negocio" : p.tipo === "consorcio" ? "Consorcio" : undefined,
      ficha,
      // El panel se arma en el navegador a partir del participante (ParticipanteDetalle.tsx): no viaja armado por fila.
      contenido: <DetalleParticipante p={p} conOfertas={ctx.conOfertas} hayGanador={ctx.hayGanador} aqui={aqui} />,
    },
    // Una persona natural no se busca por su nombre ni por su RUC (docs/PRIVACIDAD.md): sólo por lo que hizo. Un consorcio,
    // también por sus integrantes que son empresas.
    buscable: [
      natural ? null : titulo, ruc, estado, natural ? "persona natural" : null, s?.distrito,
      ...p.integrantes.filter((x) => !esPersonaNatural(x.ruc)).flatMap((x) => [x.nombre, x.ruc]),
    ].filter(Boolean).join(" "),
  };
}
