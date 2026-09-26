/**
 * Plataforma de Cloudflare Workers (lib/plataforma.ts): lo importa sólo src/worker.ts.
 *
 *   · ID tokens de Firebase: jose contra las llaves de securetoken (workers/firebase.ts).
 *   · GCS: API JSON + firma v4 local con la cuenta de servicio de GCP_SA_KEY (workers/gcs.ts).
 *   · Credenciales de Google: JWT-bearer con esa misma cuenta (workers/google.ts).
 */

import { fijarPlataforma } from "../lib/plataforma.js";
import { verificarIdTokenFirebase } from "./firebase.js";
import { descargarObjeto, firmarUrlV4, metadatosObjeto } from "./gcs.js";
import { idTokenCuenta, tokenAccesoCuenta } from "./google.js";

fijarPlataforma({
  verificarIdToken: (token) => verificarIdTokenFirebase(token, process.env.FIREBASE_PROJECT_ID ?? "simplia-project"),
  firmarUrl: (bucket, ruta, opciones) => firmarUrlV4(bucket, ruta, opciones),
  metadatosObjeto,
  descargarObjeto,
  idTokenGoogle: (audiencia, signal) => idTokenCuenta(audiencia, signal),
  tokenAccesoGoogle: () => tokenAccesoCuenta(),
});
