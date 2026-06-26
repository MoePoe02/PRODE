const assert = require('assert');
const {
  calcularPuntosPartido,
  calcularPuntosTop3,
  obtenerScoreboard,
  esPartidoPredecible,
  esTop3Predecible
} = require('./engine');

console.log('--- Iniciando Pruebas de Lógica de Negocio (Prode) ---');

try {
  // 1. Pruebas de cálculo de puntos de partido
  console.log('1. Probando calcularPuntosPartido con los casos de validación...');
  
  // Caso A: El Pleno Perfecto en un partido común
  // Real: 2-0, Pred: 2-0 -> Tendencia (2) + Local (2) + Visitante (Arco en cero: 1) + Bonus Pleno (2) = 7
  assert.strictEqual(calcularPuntosPartido(2, 0, 2, 0), 7, 'Caso A: 2-0 vs 2-0 debe dar 7 pts');

  // Caso B: El usuario que estuvo muy cerca por un gol de diferencia
  // Real: 2-0, Pred: 2-1 -> Tendencia (2) + Local (2) + Visitante (0) + Bonus Pleno (0) = 4
  assert.strictEqual(calcularPuntosPartido(2, 1, 2, 0), 4, 'Caso B: 2-1 vs 2-0 debe dar 4 pts');

  // Caso C: El usuario que se desvió por un gol en cada selección
  // Real: 2-0, Pred: 3-1 -> Tendencia (2) + Local (1) + Visitante (0) + Bonus Pleno (0) = 3
  assert.strictEqual(calcularPuntosPartido(3, 1, 2, 0), 3, 'Caso C: 3-1 vs 2-0 debe dar 3 pts');

  // Caso D: El "Desquiciado" que intentó inflar goles (Trampa de números gigantes)
  // Real: 2-0, Pred: 8-0 -> Tendencia (2) + Local (0) + Visitante (Arco en cero: 1) + Bonus Pleno (0) = 3
  assert.strictEqual(calcularPuntosPartido(8, 0, 2, 0), 3, 'Caso D: 8-0 vs 2-0 debe dar 3 pts');

  // Caso E: El Pleno Perfecto de un empate sin goles (0-0)
  // Real: 0-0, Pred: 0-0 -> Tendencia (2) + Local (Arco en cero: 1) + Visitante (Arco en cero: 1) + Bonus Pleno (2) = 6
  assert.strictEqual(calcularPuntosPartido(0, 0, 0, 0), 6, 'Caso E: 0-0 vs 0-0 debe dar 6 pts');

  // Caso F: El usuario que le erró a la tendencia
  // Real: 2-0, Pred: 1-1 -> Tendencia fallida -> Debe dar 0 pts
  assert.strictEqual(calcularPuntosPartido(1, 1, 2, 0), 0, 'Caso F: Tendencia fallida debe dar 0 pts');

  // Pruebas específicas de Knockout (mata-mata)
  console.log('   Probando casos de eliminación directa (mata-mata)...');
  // Caso KO-A: Empate y acierta ganador
  // Real: 1-1, ganador local. Pred: 1-1, ganador local.
  // ptsTendencia = 3 (2 base + 1 extra) + Local(1) + Vis(1) + Pleno(2) = 7
  assert.strictEqual(calcularPuntosPartido(1, 1, 1, 1, 'Octavos de Final', 'local', 'local'), 7, 'Caso KO-A: 1-1 vs 1-1 y mismo ganador en penales debe dar 7 pts');

  // Caso KO-B: Empate y le erra al ganador
  // Real: 1-1, ganador visitante. Pred: 1-1, ganador local.
  // ptsTendencia = 2 (base) + Local(1) + Vis(1) + Pleno(2) = 6
  assert.strictEqual(calcularPuntosPartido(1, 1, 1, 1, 'Octavos de Final', 'local', 'visitante'), 6, 'Caso KO-B: Errar el ganador en penales pero acertar penales debe dar 6 pts');

  // Caso KO-C: Predice ganador en 90 min, partido termina en empate (penales) pero gana el mismo equipo en penales
  // Real: 1-1, ganador local en penales. Pred: 2-1 (ganador local).
  // ptsTendencia = 1 (ganador sin victoria directa) + Local(0) + Vis(1) + Pleno(0) = 2
  assert.strictEqual(calcularPuntosPartido(2, 1, 1, 1, 'Octavos de Final', '', 'local'), 2, 'Caso KO-C: Pred 2-1 vs Real 1-1 (ganador local) debe dar 2 pts');

  // Caso KO-D: Predice ganador en 90 min, partido termina en empate (penales) pero gana el otro en penales
  // Real: 1-1, ganador visitante en penales. Pred: 2-1 (ganador local).
  // ptsTendencia = 0
  assert.strictEqual(calcularPuntosPartido(2, 1, 1, 1, 'Octavos de Final', '', 'visitante'), 0, 'Caso KO-D: Pred 2-1 vs Real 1-1 (ganador visitante) debe dar 0 pts');
  
  console.log('   ✓ calcularPuntosPartido pasando correctamente los casos de prueba de mata-mata.');

  // 2. Pruebas de puntos de Top 3
  console.log('2. Probando calcularPuntosTop3...');
  const realTop3 = { puesto_1: 'Argentina', puesto_2: 'Francia', puesto_3: 'Brasil' };
  
  assert.strictEqual(calcularPuntosTop3({ puesto_1: 'Argentina', puesto_2: 'Francia', puesto_3: 'Brasil' }, realTop3), 15, 'Todo correcto debe dar 15 pts');
  assert.strictEqual(calcularPuntosTop3({ puesto_1: 'Argentina', puesto_2: 'Chile', puesto_3: 'Brasil' }, realTop3), 10, 'Dos correctos debe dar 10 pts');
  assert.strictEqual(calcularPuntosTop3({ puesto_1: 'Uruguay', puesto_2: 'Chile', puesto_3: 'Brasil' }, realTop3), 5, 'Un correcto debe dar 5 pts');
  assert.strictEqual(calcularPuntosTop3({ puesto_1: 'Uruguay', puesto_2: 'Chile', puesto_3: 'Alemania' }, realTop3), 0, 'Ningún correcto debe dar 0 pts');
  
  console.log('   ✓ calcularPuntosTop3 funcionando correctamente.');

  // 3. Pruebas de restricciones de tiempo
  console.log('3. Probando validación de tiempos...');
  const ahora = new Date('2026-06-06T12:00:00Z');
  
  assert.strictEqual(esPartidoPredecible('2026-06-06T13:00:00Z', ahora), true, 'Partido en el futuro debe ser predecible');
  assert.strictEqual(esPartidoPredecible('2026-06-06T11:00:00Z', ahora), false, 'Partido en el pasado no debe ser predecible');
  
  const partidos = [
    { fase: 'Fase de Grupos', fecha_inicio: '2026-06-02T16:00:00Z' },
    { fase: 'Fase de Grupos', fecha_inicio: '2026-06-07T18:00:00Z' },
    { fase: 'Octavos de Final', fecha_inicio: '2026-06-15T18:00:00Z' }
  ];
  
  // El último partido de fase de grupos es el 2026-06-07T18:00:00Z
  assert.strictEqual(esTop3Predecible(partidos, ahora), true, 'Top 3 predecible antes del final de fase de grupos');
  assert.strictEqual(esTop3Predecible(partidos, new Date('2026-06-08T00:00:00Z')), false, 'Top 3 bloqueado después del final de fase de grupos');
  
  console.log('   ✓ Validación de tiempos funcionando correctamente.');

  // 4. Prueba del Scoreboard completo
  console.log('4. Probando obtenerScoreboard...');
  const mockUsuarios = [
    { username: 'martin_99', avatar_emoji: '⚽' },
    { username: 'lucia_12', avatar_emoji: '🏆' }
  ];
  const mockPartidos = [
    { partido_id: 'p1', fase: 'Fase de Grupos', fecha_inicio: '2026-06-01T12:00:00Z', goles_local_real: 2, goles_visitante_real: 1, finalizado: true },
    { partido_id: 'p2', fase: 'Fase de Grupos', fecha_inicio: '2026-06-02T12:00:00Z', goles_local_real: 1, goles_visitante_real: 1, finalizado: true }
  ];
  const mockPreds = [
    // martin_99: p1 exacto (7), p2 tendencia (2) -> total 9
    { username: 'martin_99', partido_id: 'p1', goles_local_pred: 2, goles_visitante_pred: 1 },
    { username: 'martin_99', partido_id: 'p2', goles_local_pred: 2, goles_visitante_pred: 2 },
    // lucia_12: p1 tendencia (3), p2 exacto (6) -> total 9
    { username: 'lucia_12', partido_id: 'p1', goles_local_pred: 1, goles_visitante_pred: 0 },
    { username: 'lucia_12', partido_id: 'p2', goles_local_pred: 1, goles_visitante_pred: 1 }
  ];
  
  const scoreboard = obtenerScoreboard(mockUsuarios, mockPartidos, mockPreds, [], {});
  
  assert.strictEqual(scoreboard.length, 2, 'Debe retornar 2 usuarios');
  
  const martin = scoreboard.find(s => s.username === 'martin_99');
  const lucia = scoreboard.find(s => s.username === 'lucia_12');
  
  assert.strictEqual(martin.puntaje_total, 9, 'El puntaje de martin debe ser 9');
  assert.deepStrictEqual(martin.historial_puntos, [0, 7, 9], 'El historial de martin debe ser [0, 7, 9]');
  
  assert.strictEqual(lucia.puntaje_total, 9, 'El puntaje de lucia debe ser 9');
  assert.deepStrictEqual(lucia.historial_puntos, [0, 3, 9], 'El historial de lucia debe ser [0, 3, 9]');
  
  console.log('   ✓ obtenerScoreboard funcionando correctamente.');
  
  console.log('--- ¡TODAS LAS PRUEBAS PASARON EXITOSAMENTE! ---');
  process.exit(0);
} catch (error) {
  console.error('❌ Error de validación en las pruebas:');
  console.error(error);
  process.exit(1);
}
