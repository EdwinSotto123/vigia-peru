/**
 * Plataforma de Cloud Run (Node): lo que usa SDKs de Node o el servidor de metadatos. Lo importa sólo
 * src/index.ts; el Worker registra la suya (workers/plataforma.ts) y nunca carga estos paquetes.
 *
 *   · ID tokens de Firebase: Firebase Admin SDK.
 *   · GCS: @google-cloud/storage con la identidad del servicio (firma v4 vía IAM signBlob).
 *   · Credenciales de Google: servidor de metadatos (ID token con audiencia y access token).
 */

import { initializeApp, applicationDefault, cert, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { Storage } from "@google-cloud/storage";
import { fijarPlataforma } from "../lib/plataforma.js";

if (!getApps().length) {
  const credsJson = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  initializeApp({
    credential: credsJson ? cert(JSON.parse(credsJson)) : applicationDefault(),
    projectId: process.env.FIREBASE_PROJECT_ID ?? "simplia-project",
  });
}

const storage = new Storage({
  projectId: process.env.GCS_PROJECT_ID,
});

const METADATA = "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default";

fijarPlataforma({
  verificarIdToken: (token) => getAuth().verifyIdToken(token),

  firmarUrl: async (bucket, ruta, opciones) => {
    const [url] = await storage.bucket(bucket).file(ruta).getSignedUrl({ version: "v4", ...opciones });
    return url;
  },
  metadatosObjeto: async (bucket, ruta) => {
    const [meta] = await storage.bucket(bucket).file(ruta).getMetadata();
    return meta;
  },
  descargarObjeto: async (bucket, ruta) => {
    const [buf] = await storage.bucket(bucket).file(ruta).download();
    return new Uint8Array(buf);
  },

  idTokenGoogle: async (audiencia, signal) => {
    const r = await fetch(`${METADATA}/identity?audience=${encodeURIComponent(audiencia)}`, {
      headers: { "Metadata-Flavor": "Google" },
      signal,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const token = (await r.text()).trim();
    if (!token) throw new Error("respuesta vacía");
    return token;
  },
  tokenAccesoGoogle: async () => {
    const tok = await fetch(`${METADATA}/token`, { headers: { "Metadata-Flavor": "Google" } });
    if (!tok.ok) return null;
    const { access_token } = (await tok.json()) as { access_token: string };
    return access_token;
  },
});
