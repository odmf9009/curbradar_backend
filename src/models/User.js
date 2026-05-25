const mongoose = require('mongoose');

// Lógica de niveles (ver CLAUDE.md sección 3.2):
// Nivel = floor(points / 500) + 1
// Explorador: <5, Cazador: <15, Experto: <30, Leyenda: 30+

const userSchema = new mongoose.Schema(
  {
    // firebaseUid es la primary key de identidad — viene de Firebase Auth
    firebaseUid: { type: String, required: true, unique: true, index: true },

    name: { type: String, required: true },
    username: { type: String, default: '', trim: true }, // Alias público
    email: { type: String, required: true, lowercase: true },
    profileImageUrl: { type: String, default: '' },

    // Gamificación
    points: { type: Number, default: 0 },
    level: { type: Number, default: 1 },
    postsCount: { type: Number, default: 0 },
    foundCount: { type: Number, default: 0 },
    confirmationsCount: { type: Number, default: 0 },
    totalImpactValue: { type: Number, default: 0.0 },

    // Favoritos (IDs de objetos guardados)
    favorites: [{ type: String }],

    // Estado en tiempo real (para el mapa de cazadores)
    isOnline: { type: Boolean, default: false },
    location: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },
    lastLocationUpdate: { type: Date, default: null },

    // Metadatos
    fcmToken: { type: String, default: null },
    lastActive: { type: Date, default: Date.now },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    isActive: { type: Boolean, default: true },
  },
  {
    timestamps: true,
  }
);

userSchema.index({ location: '2dsphere' });
userSchema.index({ points: -1 }); // Ranking
userSchema.index({ username: 1 }, { sparse: true });

// Virtual: Nombre mostrado (username o "Cazador Anónimo")
userSchema.virtual('displayName').get(function () {
  return this.username || 'Cazador Anónimo';
});

// Virtual: Título de nivel
userSchema.virtual('levelTitle').get(function () {
  if (this.level < 5) return 'Explorador';
  if (this.level < 15) return 'Cazador';
  if (this.level < 30) return 'Experto';
  return 'Leyenda';
});

// Método: Recalcular y actualizar nivel
userSchema.methods.recalculateLevel = function () {
  this.level = Math.floor(this.points / 500) + 1;
};

// Seguridad: Excluir campos sensibles al serializar
userSchema.methods.toPublicProfile = function () {
  return {
    id: this._id,
    firebaseUid: this.firebaseUid,
    username: this.displayName,
    profileImageUrl: this.profileImageUrl,
    points: this.points,
    level: this.level,
    levelTitle: this.levelTitle,
    postsCount: this.postsCount,
    foundCount: this.foundCount,
    confirmationsCount: this.confirmationsCount,
    totalImpactValue: this.totalImpactValue,
  };
};

const User = mongoose.model('User', userSchema);
module.exports = { User };
