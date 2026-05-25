const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI;

function getGenAI() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY no está configurada');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  }
  return genAI;
}

/**
 * Analiza una imagen (Buffer) de un objeto en la calle.
 * Retorna { title, category, description } o null si falla.
 *
 * Categorías válidas: Muebles, Electrodomésticos, Electrónica, Ropa, Juguetes, Otros
 */
async function analyzeObjectImage(imageBuffer, mimeType = 'image/jpeg') {
  try {
    const model = getGenAI().getGenerativeModel({ model: 'gemini-2.5-flash' });

    const prompt = `Analiza esta imagen de un objeto abandonado en la calle.
Genera: 1. Un título corto. 2. Una categoría: [Muebles, Electrodomésticos, Electrónica, Ropa, Juguetes, Otros]. 3. Una descripción de 15 palabras.
Responde ÚNICAMENTE en formato JSON plano: {"title": "...", "category": "...", "description": "..."}`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          mimeType,
          data: imageBuffer.toString('base64'),
        },
      },
    ]);

    const text = result.response.text();
    const jsonMatch = text.match(/\{.*\}/s);

    if (jsonMatch) {
      const data = JSON.parse(jsonMatch[0]);
      return {
        title: data.title?.trim() || '',
        category: data.category?.trim() || 'Otros',
        description: data.description?.trim() || '',
      };
    }

    return null;
  } catch (err) {
    console.error('[AI] Error en analyzeObjectImage:', err.message);
    return null;
  }
}

module.exports = { analyzeObjectImage };
