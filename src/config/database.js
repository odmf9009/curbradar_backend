const mongoose = require('mongoose');

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI no está definida en las variables de entorno');
  }

  try {
    await mongoose.connect(uri, {
      // Opciones recomendadas para producción
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ MongoDB conectado:', mongoose.connection.host);
  } catch (err) {
    console.error('❌ Error al conectar MongoDB:', err.message);
    throw err;
  }

  mongoose.connection.on('error', (err) => {
    console.error('❌ Error en la conexión MongoDB:', err);
  });

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB desconectado');
  });
}

module.exports = { connectDB };
