const express = require('express');
const router = express.Router();
const multer = require('multer');
const authMiddleware = require('../middlewares/auth.middleware');
const { uploadImage } = require('../services/upload.service');

// Multer en memoria (no guarda en disco — pasa directo a Firebase Storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB máximo
    files: 1,
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Solo se permiten imágenes JPG, PNG o WEBP'));
    }
  },
});

/**
 * POST /api/upload/image
 * Sube una imagen a Firebase Storage y retorna la URL pública.
 *
 * Form-data:
 *   - file   : El archivo de imagen
 *   - folder : (opcional) 'objects' | 'profiles' — default: 'objects'
 *
 * Response: { url: "https://storage.googleapis.com/..." }
 *
 * ⭐ Este endpoint es el ÚNICO punto de subida de imágenes.
 *    Flutter NO sube directamente a Firebase Storage.
 */
router.post('/image', authMiddleware, upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo' });
    }

    const folder = req.body.folder === 'profiles' ? 'profiles' : 'objects';

    const url = await uploadImage(
      req.file.buffer,
      req.file.mimetype,
      folder,
    );

    res.json({ url });
  } catch (err) {
    next(err);
  }
});

// Manejo de error de Multer (tamaño/tipo)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message.includes('Solo se permiten')) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});

module.exports = router;
