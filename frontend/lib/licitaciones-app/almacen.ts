/**
 * El estado del usuario en la app: sus búsquedas guardadas, lo que sigue (con su etapa), sus comentarios, el checklist de
 * postulación de cada proceso y el historial de lo que hizo. En esta etapa vive en el navegador (localStorage, con
 * try/catch: en una ventana privada o sin espacio funciona en memoria). La interfaz es la misma que tendrá con la API
 * de cuentas (docs/PLAN.md): quien la usa no sabe dónde se guarda.
 *
 * Puro salvo el almacenamiento, que se inyecta: así se prueba con un Map.
 */

export const ETAPAS = [
  { clave: "evaluar", etiqueta: "Por evaluar" },
  { clave: "preparando", etiqueta: "Preparando oferta" },
  { clave: "presentada", etiqueta: "Oferta presentada" },
  { clave: "ganada", etiqueta: "Ganada" },
  { clave: "perdida", etiqueta: "Perdida" },
  { clave: "descartada", etiqueta: "Descartada" },
] as const;
export type Etapa = (typeof ETAPAS)[number]["clave"];

export interface PerfilBusqueda {
  id: string;
  nombre: string;
  /** La búsqueda como URL, sin «?»: `q=toner&tipo=bienes`. */
  query: string;
  creado: string;
}

export interface Seguido {
  etapa: Etapa;
  desde: string;
  codigo: string | null;
  titulo: string | null;
}

export interface Comentario {
  id: string;
  texto: string;
  creado: string;
}

export interface Evento {
  fecha: string;
  texto: string;
}

export interface EstadoUsuario {
  perfiles: PerfilBusqueda[];
  seguidos: Record<string, Seguido>;
  comentarios: Record<string, Comentario[]>;
  checklist: Record<string, string[]>;
  historial: Record<string, Evento[]>;
}

export const VACIO: EstadoUsuario = { perfiles: [], seguidos: {}, comentarios: {}, checklist: {}, historial: {} };

export interface Guardado {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export class ErrorAlmacen extends Error {}

const CLAVE = "gobserva-app-v1";
export const LIMITE_PERFILES = 12;
export const LARGO_COMENTARIO = 1000;

const id = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function crearAlmacen(guardado: Guardado | null, reloj: () => Date = () => new Date()) {
  let estado: EstadoUsuario = VACIO;
  let cargado = false;
  const oyentes = new Set<() => void>();

  function cargar() {
    if (cargado) return;
    cargado = true;
    try {
      const t = guardado?.getItem(CLAVE);
      if (t) estado = { ...VACIO, ...(JSON.parse(t) as Partial<EstadoUsuario>) };
    } catch {
      estado = VACIO;
    }
  }

  function poner(siguiente: EstadoUsuario) {
    estado = siguiente;
    try {
      guardado?.setItem(CLAVE, JSON.stringify(estado));
    } catch {
      // Sin espacio o sin permiso: sigue en memoria mientras dure la pestaña.
    }
    oyentes.forEach((o) => o());
  }

  const ahora = () => reloj().toISOString();
  const anotar = (e: EstadoUsuario, op: string, texto: string): EstadoUsuario => ({
    ...e,
    historial: { ...e.historial, [op]: [{ fecha: ahora(), texto }, ...(e.historial[op] ?? [])].slice(0, 50) },
  });

  return {
    leer(): EstadoUsuario {
      cargar();
      return estado;
    },
    suscribir(o: () => void) {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },

    guardarPerfil(nombre: string, query: string): PerfilBusqueda {
      cargar();
      const n = nombre.trim();
      if (n.length < 2) throw new ErrorAlmacen("Ponle un nombre de al menos 2 letras.");
      if (n.length > 60) throw new ErrorAlmacen("El nombre puede tener hasta 60 letras.");
      if (estado.perfiles.some((p) => p.nombre.toLowerCase() === n.toLowerCase())) throw new ErrorAlmacen("Ya tienes una búsqueda con ese nombre.");
      if (estado.perfiles.length >= LIMITE_PERFILES) throw new ErrorAlmacen(`Puedes guardar hasta ${LIMITE_PERFILES} búsquedas. Borra una para guardar esta.`);
      const p: PerfilBusqueda = { id: id(), nombre: n, query, creado: ahora() };
      poner({ ...estado, perfiles: [...estado.perfiles, p] });
      return p;
    },
    borrarPerfil(pid: string) {
      cargar();
      poner({ ...estado, perfiles: estado.perfiles.filter((p) => p.id !== pid) });
    },

    seguir(op: string, datos: { codigo: string | null; titulo: string | null }) {
      cargar();
      if (estado.seguidos[op]) return;
      const e = { ...estado, seguidos: { ...estado.seguidos, [op]: { etapa: "evaluar" as Etapa, desde: ahora(), ...datos } } };
      poner(anotar(e, op, "Empezaste a seguir este proceso."));
    },
    dejarDeSeguir(op: string) {
      cargar();
      if (!estado.seguidos[op]) return;
      const { [op]: _, ...resto } = estado.seguidos;
      poner(anotar({ ...estado, seguidos: resto }, op, "Dejaste de seguir este proceso."));
    },
    cambiarEtapa(op: string, etapa: Etapa) {
      cargar();
      const s = estado.seguidos[op];
      if (!s || s.etapa === etapa) return;
      const nombre = ETAPAS.find((x) => x.clave === etapa)?.etiqueta ?? etapa;
      poner(anotar({ ...estado, seguidos: { ...estado.seguidos, [op]: { ...s, etapa } } }, op, `Pasó a «${nombre}».`));
    },

    comentar(op: string, texto: string): Comentario {
      cargar();
      const t = texto.trim();
      if (!t) throw new ErrorAlmacen("Escribe el comentario antes de publicarlo.");
      if (t.length > LARGO_COMENTARIO) throw new ErrorAlmacen(`El comentario puede tener hasta ${LARGO_COMENTARIO} caracteres.`);
      const c: Comentario = { id: id(), texto: t, creado: ahora() };
      const e = { ...estado, comentarios: { ...estado.comentarios, [op]: [c, ...(estado.comentarios[op] ?? [])] } };
      poner(anotar(e, op, "Dejaste un comentario."));
      return c;
    },
    borrarComentario(op: string, cid: string) {
      cargar();
      poner({ ...estado, comentarios: { ...estado.comentarios, [op]: (estado.comentarios[op] ?? []).filter((c) => c.id !== cid) } });
    },

    marcarRequisito(op: string, req: string, listo: boolean) {
      cargar();
      const actual = new Set(estado.checklist[op] ?? []);
      if (listo) actual.add(req);
      else actual.delete(req);
      poner({ ...estado, checklist: { ...estado.checklist, [op]: [...actual] } });
    },
  };
}

export type Almacen = ReturnType<typeof crearAlmacen>;
