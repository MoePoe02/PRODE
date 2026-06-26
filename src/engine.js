// Validaciones de tiempo
function esPartidoPredecible(fechaInicioPartido, fechaServidor = new Date()) {
  const inicio = new Date(fechaInicioPartido);
  return fechaServidor.getTime() < inicio.getTime();
}

function esTop3Predecible(partidos, fechaServidor = new Date()) {
  const partidosGrupo = partidos.filter(p => p.fase === 'Fase de Grupos');
  if (partidosGrupo.length === 0) return true;
  
  // Encontrar el último partido de la fase de grupos por fecha de inicio
  const fechas = partidosGrupo.map(p => new Date(p.fecha_inicio).getTime());
  const ultimoInicio = new Date(Math.max(...fechas));
  
  return fechaServidor.getTime() < ultimoInicio.getTime();
}

// Cálculo de puntos por partido
function calcularPuntosPartido(golesLocalPred, golesVisitantePred, golesLocalReal, golesVisitanteReal, fase = 'Fase de Grupos', ganadorPred = '', ganadorReal = '') {
  if (golesLocalReal === null || golesVisitanteReal === null || golesLocalReal === undefined || golesVisitanteReal === undefined) {
    return 0;
  }
  
  const glPred = parseInt(golesLocalPred, 10);
  const gvPred = parseInt(golesVisitantePred, 10);
  const glReal = parseInt(golesLocalReal, 10);
  const gvReal = parseInt(golesVisitanteReal, 10);

  if (isNaN(glPred) || isNaN(gvPred) || isNaN(glReal) || isNaN(gvReal)) {
    return 0;
  }

  // 1. ACIERTO DE TENDENCIA (Ganador o Empate)
  const esKnockout = fase !== 'Fase de Grupos';
  let puntosTendencia = 0;

  if (esKnockout) {
    const realFuiAPenales = glReal === gvReal;
    const predFuiAPenales = glPred === gvPred;
    const winnerPred = glPred > gvPred ? 'local' : (glPred < gvPred ? 'visitante' : ganadorPred);
    const winnerReal = glReal > gvReal ? 'local' : (glReal < gvReal ? 'visitante' : ganadorReal);

    if (realFuiAPenales) {
      if (predFuiAPenales) {
        // Adivinó definición por penales (empate)
        puntosTendencia = 2; // base por penales
        if (winnerPred && winnerReal && winnerPred === winnerReal) {
          puntosTendencia += 1; // extra por ganador
        }
      } else {
        // Predijo victoria directa de un equipo
        if (winnerPred && winnerReal && winnerPred === winnerReal) {
          puntosTendencia = 1; // 1 punto si clasificó el equipo predicho pero falló la victoria directa
        }
      }
    } else {
      // Se definió sin penales
      if (!predFuiAPenales) {
        if (winnerPred && winnerReal && winnerPred === winnerReal) {
          puntosTendencia = 2; // normal acierto de victoria directa
        }
      }
    }
  } else {
    const tendenciaPred = Math.sign(glPred - gvPred);
    const tendenciaReal = Math.sign(glReal - gvReal);
    if (tendenciaPred === tendenciaReal) {
      puntosTendencia = 2;
    }
  }

  // Si se le yerra a la tendencia (no se acierta el ganador ni el empate), goles y pleno no suman nada (0 puntos en total)
  if (puntosTendencia === 0) {
    return 0;
  }

  // 2. PUNTOS PROPORCIONALES POR GOLES (Calculado por separado para cada selección)
  // Local
  let puntosLocal = 0;
  const desvioLocal = Math.abs(glPred - glReal);
  if (glReal === 0 && glPred === 0) {
    puntosLocal = 1;
  } else {
    puntosLocal = Math.max(0, glReal - desvioLocal);
  }

  // Visitante
  let puntosVisitante = 0;
  const desvioVisitante = Math.abs(gvPred - gvReal);
  if (gvReal === 0 && gvPred === 0) {
    puntosVisitante = 1;
  } else {
    puntosVisitante = Math.max(0, gvReal - desvioVisitante);
  }

  // 3. BONUS POR PLENO TOTAL (Resultado Exacto)
  const bonusPleno = (desvioLocal === 0 && desvioVisitante === 0) ? 2 : 0;

  return puntosTendencia + puntosLocal + puntosVisitante + bonusPleno;
}

// Cálculo de puntos por Top 3 (5 puntos por puesto correcto)
function calcularPuntosTop3(predTop3, realTop3) {
  if (!realTop3 || !realTop3.puesto_1 || !realTop3.puesto_2 || !realTop3.puesto_3) {
    return 0;
  }
  if (!predTop3) return 0;

  let puntos = 0;
  if (predTop3.puesto_1 === realTop3.puesto_1) puntos += 5;
  if (predTop3.puesto_2 === realTop3.puesto_2) puntos += 5;
  if (predTop3.puesto_3 === realTop3.puesto_3) puntos += 5;

  return puntos;
}

// Generación de la tabla de posiciones con historial de evolución
function obtenerScoreboard(usuarios, partidos, prediccionesPartidos, prediccionesTop3, realTop3) {
  // 1. Filtrar y ordenar partidos finalizados cronológicamente
  const partidosFinalizados = partidos
    .filter(p => p.finalizado)
    .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

  // 2. Calcular para cada usuario
  const scoreboard = usuarios.map(usr => {
    let puntajeTotal = 0;
    const historialPuntos = [0];
    const rachaDetalles = [];

    let puntosTendenciaAcum = 0;
    let puntosGolesAcum = 0;
    let puntosPlenoAcum = 0;

    // Obtener predicciones del usuario
    const predsUser = prediccionesPartidos.filter(p => p.username === usr.username);
    const predTop3User = prediccionesTop3.find(p => p.username === usr.username);

    // Evolución de puntos por partidos finalizados
    partidosFinalizados.forEach(partido => {
      const pred = predsUser.find(p => p.partido_id === partido.partido_id);
      let pts = 0;
      let tipo = 'loss';

      if (pred) {
        const glPred = parseInt(pred.goles_local_pred, 10);
        const gvPred = parseInt(pred.goles_visitante_pred, 10);
        const glReal = parseInt(partido.goles_local_real, 10);
        const gvReal = parseInt(partido.goles_visitante_real, 10);

        if (!isNaN(glPred) && !isNaN(gvPred) && !isNaN(glReal) && !isNaN(gvReal)) {
          const esKnockout = partido.fase !== 'Fase de Grupos';
          let ptsTendencia = 0;

          if (esKnockout) {
            const realFuiAPenales = glReal === gvReal;
            const predFuiAPenales = glPred === gvPred;
            const winnerPred = glPred > gvPred ? 'local' : (glPred < gvPred ? 'visitante' : (pred.ganador_pred || ''));
            const winnerReal = glReal > gvReal ? 'local' : (glReal < gvReal ? 'visitante' : (partido.ganador_real || ''));

            if (realFuiAPenales) {
              if (predFuiAPenales) {
                ptsTendencia = 2; // base por penales
                if (winnerPred && winnerReal && winnerPred === winnerReal) {
                  ptsTendencia += 1; // extra por ganador
                }
              } else {
                if (winnerPred && winnerReal && winnerPred === winnerReal) {
                  ptsTendencia = 1; // 1 punto si clasificó el equipo predicho pero falló la victoria directa
                }
              }
            } else {
              if (!predFuiAPenales) {
                if (winnerPred && winnerReal && winnerPred === winnerReal) {
                  ptsTendencia = 2; // normal acierto de victoria directa
                }
              }
            }
          } else {
            const tendenciaPred = Math.sign(glPred - gvPred);
            const tendenciaReal = Math.sign(glReal - gvReal);
            if (tendenciaPred === tendenciaReal) {
              ptsTendencia = 2;
            }
          }

          if (ptsTendencia > 0) {
            let ptsLocal = 0;
            const desvioLocal = Math.abs(glPred - glReal);
            if (glReal === 0 && glPred === 0) {
              ptsLocal = 1;
            } else {
              ptsLocal = Math.max(0, glReal - desvioLocal);
            }

            let ptsVisitante = 0;
            const desvioVisitante = Math.abs(gvPred - gvReal);
            if (gvReal === 0 && gvPred === 0) {
              ptsVisitante = 1;
            } else {
              ptsVisitante = Math.max(0, gvReal - desvioVisitante);
            }

            const ptsPleno = (desvioLocal === 0 && desvioVisitante === 0) ? 2 : 0;

            pts = ptsTendencia + ptsLocal + ptsVisitante + ptsPleno;
            
            puntosTendenciaAcum += ptsTendencia;
            puntosGolesAcum += (ptsLocal + ptsVisitante);
            puntosPlenoAcum += ptsPleno;
            
            if (ptsPleno > 0) {
              tipo = 'win';
            } else {
              tipo = 'draw';
            }
          }
        }
        puntajeTotal += pts;
      }
      rachaDetalles.push({ puntos: pts, tipo: tipo });
      historialPuntos.push(puntajeTotal);
    });

    // Puntos extra del Top 3 (si ya está definido el resultado final real)
    let puntosTop3 = 0;
    const tieneRealTop3 = realTop3 && realTop3.puesto_1 && realTop3.puesto_2 && realTop3.puesto_3;
    if (tieneRealTop3 && predTop3User) {
      puntosTop3 = calcularPuntosTop3(predTop3User, realTop3);
      puntajeTotal += puntosTop3;
      // Añadir la evolución final con los puntos de Top 3
      historialPuntos.push(puntajeTotal);
    }

    return {
      username: usr.username,
      avatar_emoji: usr.avatar_emoji || '⚽',
      puntaje_total: puntajeTotal,
      historial_puntos: historialPuntos,
      racha_detalles: rachaDetalles,
      desglose_puntos: {
        tendencia: puntosTendenciaAcum,
        goles: puntosGolesAcum,
        pleno: puntosPlenoAcum,
        top3: puntosTop3
      }
    };
  });

  // Ordenar por puntaje total de mayor a menor, y desempate por nombre
  return scoreboard.sort((a, b) => {
    if (b.puntaje_total !== a.puntaje_total) {
      return b.puntaje_total - a.puntaje_total;
    }
    return a.username.localeCompare(b.username);
  });
}

module.exports = {
  esPartidoPredecible,
  esTop3Predecible,
  calcularPuntosPartido,
  calcularPuntosTop3,
  obtenerScoreboard
};
