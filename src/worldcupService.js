/**
 * worldcupService.js
 * Servicio cliente HTTP para conectarse a la API de worldcup26.ir.
 */

'use strict';

const axios = require('axios');
const https = require('https');

const BASE_URL = 'https://worldcup26.ir';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false
});

/**
 * Obtiene todos los partidos del Mundial de worldcup26.ir
 * y los mapea al formato interno esperado por la aplicación.
 * @returns {Promise<Array>}
 */
async function obtenerTodosLosPartidos() {
  try {
    console.log(`[worldcup26.ir] Solicitando todos los partidos de la Copa del Mundo 2026...`);
    const response = await axios.get(`${BASE_URL}/get/games`, { 
      timeout: 25000,
      httpsAgent: httpsAgent,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': 'https://worldcup26.ir/'
      }
    });
    
    if (!response.data || !response.data.games) {
      throw new Error('Formato de respuesta inválido o sin partidos.');
    }

    return response.data.games.map(g => {
      const idNum = parseInt(g.id, 10);
      
      // Mapear estado
      let statusShort = 'NS';
      const homePenaltyVal = g.home_penalty !== null && g.home_penalty !== undefined && g.home_penalty !== 'null' && g.home_penalty !== '';
      const awayPenaltyVal = g.away_penalty !== null && g.away_penalty !== undefined && g.away_penalty !== 'null' && g.away_penalty !== '';

      if (g.finished && g.finished.toUpperCase() === 'TRUE') {
        if ((g.status && g.status.toLowerCase() === 'penalty') || homePenaltyVal || awayPenaltyVal) {
          statusShort = 'PEN';
        } else {
          statusShort = 'FT';
        }
      } else if (g.time_elapsed && g.time_elapsed !== 'notstarted') {
        statusShort = '1H'; // En juego
      }

      // Convertir local_date "06/11/2026 13:00" a UTC aproximada
      let matchDate = '';
      try {
        const parts = g.local_date.split(' ');
        const dateParts = parts[0].split('/');
        const timeParts = parts[1].split(':');
        const year = parseInt(dateParts[2], 10);
        const month = parseInt(dateParts[0], 10) - 1;
        const day = parseInt(dateParts[1], 10);
        const hour = parseInt(timeParts[0], 10);
        const min = parseInt(timeParts[1], 10);
        
        matchDate = new Date(Date.UTC(year, month, day, hour, min)).toISOString();
      } catch (e) {
        matchDate = new Date().toISOString();
      }

      return {
        fixture: {
          id: idNum,
          date: matchDate,
          status: {
            short: statusShort
          }
        },
        teams: {
          home: {
            name: g.home_team_name_en || ''
          },
          away: {
            name: g.away_team_name_en || ''
          }
        },
        goals: {
          home: g.home_score !== null && g.home_score !== undefined && g.home_score !== 'null' ? parseInt(g.home_score, 10) : null,
          away: g.away_score !== null && g.away_score !== undefined && g.away_score !== 'null' ? parseInt(g.away_score, 10) : null
        },
        penalty: {
          home: homePenaltyVal ? parseInt(g.home_penalty, 10) : null,
          away: awayPenaltyVal ? parseInt(g.away_penalty, 10) : null
        }
      };
    });
  } catch (error) {
    console.error(`[worldcup26.ir] Error al obtener partidos del fixture:`, error.message);
    throw error;
  }
}

/**
 * Obtiene todos los partidos del Mundial para una fecha específica.
 * @param {string} fecha - Formato 'YYYY-MM-DD'
 * @returns {Promise<Array>}
 */
async function obtenerPartidosPorFecha(fecha) {
  const todos = await obtenerTodosLosPartidos();
  return todos.filter(p => {
    const pFecha = p.fixture.date.split('T')[0];
    return pFecha === fecha;
  });
}

/**
 * Obtiene el estado y marcador detallado de un fixture específico por su ID externo.
 * @param {number|string} fixtureId - ID del partido.
 * @returns {Promise<Object|null>}
 */
async function obtenerEstadoFixture(fixtureId) {
  const todos = await obtenerTodosLosPartidos();
  const idNum = parseInt(fixtureId, 10);
  return todos.find(p => p.fixture.id === idNum) || null;
}

module.exports = {
  obtenerTodosLosPartidos,
  obtenerPartidosPorFecha,
  obtenerEstadoFixture
};
