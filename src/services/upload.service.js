const { admin } = require('../config/firebase');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Servicio de subida de imágenes a Firebase Storage.
 *
 * ⭐ ARQUITECTURA HÍBRIDA:
 * - Flutter sube la imagen al BACKEND (no directamente a Firebase Storage)
 * - El backend la sube a Firebase Storage con el Admin SDK
 * - Devuelve la URL pública firmada
 *
 * Esto mantiene la regla del cliente en Firebase Storage (gratis)
 * pero con las credenciales seguras en el servidor.
 */

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE_MB = 10;

/**
 * Sube un buffer de imagen a Firebase Storage.
 * @param {Buffer} fileBuffer  — Buffer del archivo
 * @param {string} mimeType    — MIME type ('image/jpeg', etc.)
 * @param {string} folder      — Carpeta destino en Storage ('objects', 'profiles')
 * @returns {Promise<string>}  — URL pública de la imagen
 */
async function uploadImage(fileBuffer, mimeType, folder = 'objects') {
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`Tipo de archivo no permitido: ${mimeType}`);
  }

  if (fileBuffer.length > MAX_FILE_SIZE_MB * 1024 * 1024) {
    throw new Error(`El archivo supera el límite de ${MAX_FILE_SIZE_MB}MB`);
  }

  const bucket = admin.storage().bucket();
  const extension = mimeType.split('/')[1];
  const fileName = `${folder}/${uuidv4()}.${extension}`;
  const file = bucket.file(fileName);

  // Subir a Firebase Storage
  await file.save(fileBuffer, {
    metadata: {
      contentType: mimeType,
      // Token para URL pública (evita tener que generar signed URLs)
      metadata: {
        firebaseStorageDownloadTokens: uuidv4(),
      },
    },
  });

  // Hacer el archivo público
  await file.makePublic();

  // Construir URL pública directa
  const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
  return publicUrl;
}

/**
 * Elimina una imagen de Firebase Storage dado su URL público.
 * Se usa cuando el usuario actualiza su foto o borra un objeto.
 */
async function deleteImage(publicUrl) {
  try {
    const bucket = admin.storage().bucket();
    // Extraer el path desde la URL
    // URL formato: https://storage.googleapis.com/BUCKET/path/to/file.jpg
    const urlPath = new URL(publicUrl).pathname;
    const filePath = urlPath.replace(`/${bucket.name}/`, '');
    await bucket.file(filePath).delete();
  } catch (err) {
    // No lanzar error si la imagen no existe — solo loguear
    console.warn('[Storage] No se pudo eliminar imagen:', err.message);
  }
}

module.exports = { uploadImage, deleteImage };
