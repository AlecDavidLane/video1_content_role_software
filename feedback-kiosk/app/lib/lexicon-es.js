/** Spanish emotion lexicon covering all five artwork states (brief §5:
 * Spanish is a functional change - translated buttons alone are not
 * enough). Matching is diacritics-insensitive (see classify.js), so
 * entries are written naturally and match unaccented typing too.
 *
 * STATUS: starter set built for the demonstration; the approved
 * test-phrase list and a fluent reviewer must sign this off before a
 * public Spanish event (tracked in docs/acceptance).
 */
export const ES_LEXICON = {
  joy: [
    'feliz', 'felicidad', 'contento', 'contenta', 'alegre', 'alegría',
    'encantado', 'encantada', 'genial', 'fantástico', 'fantástica',
    'maravilloso', 'maravillosa', 'increíble', 'me encanta', 'me encantó',
    'divertido', 'divertida', 'estupendo', 'estupenda', 'brillante',
    'perfecto', 'perfecta', 'emocionado', 'emocionada', 'disfruté',
    'disfrutado', 'guay', 'chulo', 'chula', 'flipante', 'precioso', 'preciosa',
  ],
  calm: [
    'tranquilo', 'tranquila', 'tranquilidad', 'relajado', 'relajada',
    'relajante', 'paz', 'sereno', 'serena', 'agradable', 'bien', 'bonito',
    'bonita', 'suave', 'cómodo', 'cómoda', 'a gusto', 'apacible',
    'interesante', 'curioso', 'curiosa',
  ],
  sad: [
    'triste', 'tristeza', 'pena', 'decepcionado', 'decepcionada',
    'decepción', 'decepcionante', 'llorar', 'melancólico', 'melancólica',
    'apagado', 'apagada', 'aburrido', 'aburrida', 'soledad', 'solo', 'sola',
    'echo de menos', 'nostalgia', 'nostálgico', 'nostálgica', 'lástima',
  ],
  angry: [
    'enfadado', 'enfadada', 'enfado', 'enojado', 'enojada', 'furioso',
    'furiosa', 'rabia', 'molesto', 'molesta', 'indignado', 'indignada',
    'fatal', 'horrible', 'terrible', 'odio', 'odié', 'harto', 'harta',
    'frustrado', 'frustrada', 'frustrante', 'cabreado', 'cabreada', 'asco',
  ],
  surprised: [
    'sorprendido', 'sorprendida', 'sorpresa', 'asombrado', 'asombrada',
    'asombroso', 'asombrosa', 'impresionado', 'impresionada',
    'impresionante', 'alucinante', 'alucinado', 'alucinada',
    'no me lo esperaba', 'inesperado', 'inesperada', 'wow', 'guau',
    'madre mía', 'qué fuerte', 'no puedo creer',
  ],
}
