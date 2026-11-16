/**
 * El bloque de nepotismo de una entidad (GET /entidades/:ruc → `nepotismo`) como sale al público.
 *
 * Cada caso es un funcionario que declaró en su DJI a un familiar que es locador de la misma entidad (vista dji_nepotismo).
 * Del funcionario sale su cargo y, si el parentesco no puede destapar el apellido tapado del familiar, su primer apellido
 * (apellidoFuncionario); del familiar, su nombre con un apellido tapado, su ficha, sus órdenes y su monto.
 *
 * Pero si el declarante es una AUTORIDAD ELECTA (su nombre completo es público: alcalde, regidor, gobernador…) y el
 * parentesco destapa (hermano, hijo, sobrino, primo, nieto o desconocido: parentescoPublicable), con su nombre a la vista
 * se deduciría el apellido tapado del familiar. Ese caso sale como «un familiar de una autoridad electa»: sin parentesco,
 * sin el nombre ni la ficha del familiar, sin órdenes ni monto, al final de la lista (su lugar entre los montos diría
 * cuánto cobró). Sólo cuenta en los totales; y un total que, restado de lo que sí se ve, daría el monto de un solo caso
 * reservado, no se da: el de un grado con un solo caso reservado y el general con un solo caso reservado cuando la lista
 * los trae todos (pedido del 2026-11-16).
 *
 * Y al revés: si el LOCADOR es la autoridad electa (va con su nombre completo en su ficha) y el parentesco destaparía el
 * apellido tapado del funcionario (parentescoInversoPublicable: hermano, madre, tío, primo…), el caso sale como «lo declaró
 * un funcionario de la entidad» (`declarante: "funcionario"`), con la misma reserva: ni el cargo, ni el apellido, ni la
 * ficha del funcionario, ni el parentesco, ni el locador, ni el monto (migración 312).
 */

import { apellidoFuncionario, parentescoInversoPublicable, parentescoPublicable, publicar } from "./privacidad.js";

/**
 * Una fila de dji_nepotismo para la ficha, con `electo`: el declarante es una autoridad electa (declaranteElectoSql); y
 * `locadorElecto`: el locador lo es (esElectoSql sobre su DNI).
 */
export interface FilaNepotismo {
  declarante: string | null;
  cargo: string | null;
  declaranteFicha: string | null;
  grado: string;
  parentesco: string | null;
  electo: boolean;
  locadorElecto?: boolean;
  proveedorRuc: string;
  proveedorNombre: string;
  proveedorCodigo: string | null;
  ordenes: number;
  monto: number;
}

/** Cuántos casos y cuánto, por grado, parentesco y quién es electo: de TODOS los casos (no sólo los listados). */
export interface GrupoNepotismo {
  grado: string;
  parentesco: string | null;
  electo: boolean;
  locadorElecto?: boolean;
  n: number;
  monto: number;
}

/**
 * El caso reservado: sólo que existe. Sin `declarante`, «un familiar de una autoridad electa» (la electa lo declaró); con
 * `declarante: "funcionario"`, «lo declaró un funcionario de la entidad» (el familiar es el electo).
 */
export interface CasoReservado {
  reservado: true;
  declarante?: "funcionario";
}

/** El declarante es electo y el parentesco destaparía el apellido tapado del familiar. */
export const casoReservado = (f: Pick<FilaNepotismo, "electo" | "parentesco">) => f.electo && !parentescoPublicable(f.parentesco);

/** El familiar es el electo y el parentesco destaparía el apellido tapado del funcionario que lo declaró (312). */
export const casoReservadoInverso = (f: Pick<FilaNepotismo, "locadorElecto" | "parentesco">) =>
  f.locadorElecto === true && !parentescoInversoPublicable(f.parentesco);

/**
 * Un caso, visto desde lo que es del FUNCIONARIO que lo declaró (su ficha de planilla). Si él es electo, sus casos
 * reservados (en cualquier sentido) salen sólo como que existen. Si no lo es, el caso inverso no sale: él va con un
 * apellido tapado y, en lo suyo, «declaró a un familiar» con su caso reservado lo señalaría (como la etiqueta del locador
 * en la 311).
 */
export function casoDelDeclarante(o: { parentesco: string | null; declaranteElecto: boolean; familiarElecto: boolean }): "ver" | "reservado" | "fuera" {
  const inverso = casoReservadoInverso({ locadorElecto: o.familiarElecto, parentesco: o.parentesco });
  if (inverso && !o.declaranteElecto) return "fuera";
  return inverso || casoReservado({ electo: o.declaranteElecto, parentesco: o.parentesco }) ? "reservado" : "ver";
}

/** Las señales de persona que nombran a un familiar declarado en la DJI: nepotismo (137), en el mismo gobierno (179) y en el Estado (180). */
export const SENALES_CON_PARIENTES: ReadonlySet<string> = new Set(["nepotismo", "nepotismo_gobierno", "familia_estado"]);

/**
 * El detalle de una de esas señales sin los familiares cuyo caso es el reservado de una autoridad electa (`reservado`:
 * el declarante es electo y el parentesco destapa; lo decide quien llama, con casoReservado). `null` si no queda ninguno
 * de los que traía: entonces la señal no sale. Tampoco como «reservada»: en la ficha del locador diría lo mismo que la
 * etiqueta «Posible nepotismo» que la lista ya no le pone (migración 311); su caso sólo suma en los totales de la entidad.
 * «entidades» de la familia en el Estado cuenta las de los que quedan. Sin nada que quitar, el mismo objeto.
 */
export function podarParientes<D extends Record<string, unknown>>(
  tipo: string, detalle: D, reservado: (pariente: Record<string, unknown>) => boolean,
): D | null {
  const par = detalle.parientes;
  if (!SENALES_CON_PARIENTES.has(tipo) || !Array.isArray(par)) return detalle;
  const quedan = (par as Record<string, unknown>[]).filter((p) => !reservado(p));
  if (quedan.length === par.length) return detalle;
  if (!quedan.length) return null;
  return {
    ...detalle,
    parientes: quedan,
    ...(tipo === "familia_estado" ? { entidades: new Set(quedan.map((p) => String(p.entidad_ruc ?? ""))).size } : {}),
  };
}

export function nepotismoPublico(filas: FilaNepotismo[], grupos: GrupoNepotismo[], total: number, montoTotal: number | null) {
  const visibles = filas.filter((f) => !casoReservado(f) && !casoReservadoInverso(f));
  // Los reservados: los de una autoridad electa que declaró, y los de un funcionario que declaró a una autoridad electa.
  const reservadas = filas.filter((f) => casoReservado(f)).length;
  const inversas = filas.filter((f) => !casoReservado(f) && casoReservadoInverso(f)).length;
  // Por grado: los casos y el monto de todos; sin monto si el grado tiene un solo caso reservado (de cualquier lado).
  const porGrado = new Map<string, { grado: string; n: number; monto: number; reservados: number }>();
  for (const g of grupos) {
    const x = porGrado.get(g.grado) ?? { grado: g.grado, n: 0, monto: 0, reservados: 0 };
    x.n += g.n;
    x.monto += g.monto;
    if (casoReservado(g) || casoReservadoInverso(g)) x.reservados += g.n;
    porGrado.set(g.grado, x);
  }
  const reservadosTodos = [...porGrado.values()].reduce((t, g) => t + g.reservados, 0);
  return {
    total,
    // Con un solo caso reservado y todos los demás en la lista, el total menos lo listado sería su monto.
    monto: reservadosTodos === 1 && total <= filas.length ? null : montoTotal ?? 0,
    porGrado: [...porGrado.values()]
      .map((g) => ({ grado: g.grado, n: g.n, monto: g.reservados === 1 ? null : g.monto }))
      .sort((a, b) => (b.monto ?? 0) - (a.monto ?? 0)),
    // El proveedor (RUC 10) va tapado por publicar() como cualquier locador. Del funcionario, su cargo y, sólo si no puede
    // destapar el apellido tapado del pariente, su primer apellido (apellidoFuncionario); nunca el nombre completo. Su ficha
    // de planilla, tampoco cuando el parentesco no es seguro. Los reservados, al final y sin nada de eso.
    detalle: [
      ...(publicar(
        visibles.map(({ declarante, declaranteFicha, electo: _e, locadorElecto: _l, ...r }) => {
          const funcionarioApellido = apellidoFuncionario(r.parentesco, declarante);
          return { ...r, funcionarioApellido, declaranteFicha: funcionarioApellido ? declaranteFicha : null };
        }),
      ) as Record<string, unknown>[]),
      ...Array.from({ length: reservadas }, (): CasoReservado => ({ reservado: true })),
      ...Array.from({ length: inversas }, (): CasoReservado => ({ reservado: true, declarante: "funcionario" })),
    ],
  };
}
