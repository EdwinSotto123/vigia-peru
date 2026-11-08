/**
 * Plataforma de Cloudflare Workers (lib/plataforma.ts): lo importa sólo src/worker.ts.
 *
 *   · ID tokens de Firebase: jose contra las llaves de securetoken (workers/firebase.ts).
 *   · Objetos: de R2 por el nombre del bucket de GCS (ámbito del pedido). Desde el 2026-11-06 GCP está sin facturación
 *     y sus buckets responden 403: GCS (workers/gcs.ts) queda solo para un bucket que no tenga copia en R2.
 *   · Credenciales de Google: JWT-bearer con esa misma cuenta (workers/google.ts).
 */

import { ambitoPedido, fijarPlataforma, type MetadatosObjeto } from "../lib/plataforma.js";
import { verificarIdTokenFirebase } from "./firebase.js";
import { grupoDelToken, leerCognito } from "../lib/cuentasApps.js";
import { verificarIdTokenCognito } from "../lib/cognito.js";

/**
 * El ID token de una app de Gobserva (Empleo, Licitaciones) es de su grupo de Cognito (COGNITO_GOBSERVA); el de Vigía,
 * de su Firebase (FIREBASE_PROJECT_ID). El emisor sólo elige con qué se verifica; la firma y todo lo demás, después.
 */
async function verificarConSuProyecto(token: string) {
  const grupo = grupoDelToken(token, leerCognito(process.env.COGNITO_GOBSERVA));
  if (grupo) return verificarIdTokenCognito(token, grupo);
  const vigia = process.env.FIREBASE_PROJECT_ID ?? "simplia-project";
  return { ...(await verificarIdTokenFirebase(token, vigia)), proyecto: vigia };
}
import { descargarObjeto, firmarUrlV4, metadatosObjeto } from "./gcs.js";
import { idTokenCuenta, tokenAccesoCuenta } from "./google.js";

const enR2 = (bucket: string) => ambitoPedido.getStore()?.almacen?.(bucket);

async function metadatos(bucket: string, ruta: string): Promise<MetadatosObjeto> {
  const r2 = enR2(bucket);
  if (!r2) return metadatosObjeto(bucket, ruta);
  const h = await r2.head(ruta);
  if (!h) throw new Error(`no está en R2: ${bucket}/${ruta}`);
  return { contentType: h.httpMetadata?.contentType, size: h.size };
}

async function descargar(bucket: string, ruta: string): Promise<Uint8Array<ArrayBuffer>> {
  const r2 = enR2(bucket);
  if (!r2) return descargarObjeto(bucket, ruta);
  const o = await r2.get(ruta);
  if (!o) throw new Error(`no está en R2: ${bucket}/${ruta}`);
  return new Uint8Array(await o.arrayBuffer());
}

fijarPlataforma({
  verificarIdToken: (token) => verificarConSuProyecto(token),
  firmarUrl: (bucket, ruta, opciones) => firmarUrlV4(bucket, ruta, opciones),
  metadatosObjeto: metadatos,
  descargarObjeto: descargar,
  idTokenGoogle: (audiencia, signal) => idTokenCuenta(audiencia, signal),
  tokenAccesoGoogle: () => tokenAccesoCuenta(),
});
