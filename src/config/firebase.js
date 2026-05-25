const admin = require('firebase-admin');

function initFirebase() {
  if (admin.apps.length > 0) return; // Ya inicializado

  let credential;

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    // Opción para deploy (variable de entorno con JSON inline)
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    credential = admin.credential.cert(serviceAccount);
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
    // Opción para desarrollo local (archivo JSON)
    const serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    credential = admin.credential.cert(serviceAccount);
  } else {
    throw new Error('No se encontró configuración de Firebase Admin SDK');
  }

  admin.initializeApp({
    credential,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    projectId: process.env.FIREBASE_PROJECT_ID,
  });

  console.log('✅ Firebase Admin SDK inicializado');
}

module.exports = { initFirebase, admin };
