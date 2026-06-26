/**
 * worldcupScheduler.js
 * Programador de tareas (Cron) para automatizar y optimizar la actualización
 * de los resultados del Mundial 2026 usando la API de worldcup26.ir.
 * 
 * Lógica de ahorro de peticiones:
 * - Una llamada diaria a las 00:05 para obtener el fixture del día.
 * - Monitoreo automático cada 5 minutos para partidos en juego.
 * - Solo consulta a la API si pasaron >= 90 minutos desde el inicio del partido.
 * - Aplica un debounce de 4 minutos entre llamadas del mismo partido.
 * - Detiene el monitoreo para un partido una vez marcado como finalizado (FT/AET/PEN).
 */

'use strict';

const cronScheduler = require('node-cron');
const apiService = require('./worldcupService');
const dbReal = require('./db');

const db = {
  /**
   * Obtiene los partidos programados para el día de hoy.
   * @returns {Promise<Array>}
   */
  getMatchesToday: async () => {
    if (dbReal && typeof dbReal.leerPartidos === 'function') {
      const todos = await dbReal.leerPartidos();
      const hoyStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      
      return todos.filter(p => {
        const pFecha = p.fecha_inicio.split('T')[0];
        return pFecha === hoyStr;
      });
    }
    return [];
  },

  /**
   * Guarda o actualiza la información de un partido en la base de datos.
   * @param {Object} partido 
   */
  saveMatch: async (partido) => {
    if (dbReal && typeof dbReal.guardarPartido === 'function') {
      await dbReal.guardarPartido({
        partido_id: partido.partido_id,
        fase: partido.fase,
        equipo_local: partido.equipo_local,
        equipo_visitante: partido.equipo_visitante,
        fecha_inicio: partido.fecha_inicio,
        goles_local_real: partido.goles_local_real,
        goles_visitante_real: partido.goles_visitante_real,
        finalizado: partido.finalizado,
        api_game_id: partido.api_game_id,
        last_queried_api: partido.last_queried_api,
        ganador_real: partido.ganador_real
      });
    }
  }
};

const TRADUCCION_PAISES = {
  'germany': 'alemania',
  'saudi arabia': 'arabia saudita',
  'algeria': 'argelia',
  'argentina': 'argentina',
  'australia': 'australia',
  'austria': 'austria',
  'belgium': 'bélgica',
  'bosnia & herzegovina': 'bosnia y herzegovina',
  'bosnia and herzegovina': 'bosnia y herzegovina',
  'brazil': 'brasil',
  'cape verde': 'cabo verde',
  'canada': 'canadá',
  'qatar': 'catar',
  'colombia': 'colombia',
  'south korea': 'corea del sur',
  'korea south': 'corea del sur',
  'ivory coast': 'costa de marfil',
  'croatia': 'croacia',
  'curacao': 'curazao',
  'curaçao': 'curazao',
  'ecuador': 'ecuador',
  'egypt': 'egipto',
  'scotland': 'escocia',
  'spain': 'españa',
  'usa': 'estados unidos',
  'united states': 'estados unidos',
  'france': 'francia',
  'ghana': 'ghana',
  'haiti': 'haití',
  'england': 'inglaterra',
  'iraq': 'irak',
  'iran': 'irán',
  'japan': 'japón',
  'jordan': 'jordania',
  'morocco': 'marruecos',
  'mexico': 'méxico',
  'norway': 'noruega',
  'new zealand': 'nueva zelanda',
  'netherlands': 'países bajos',
  'panama': 'panamá',
  'paraguay': 'paraguay',
  'portugal': 'portugal',
  'dr congo': 'rd congo',
  'congo dr': 'rd congo',
  'democratic republic of the congo': 'rd congo',
  'czech republic': 'república checa',
  'senegal': 'senegal',
  'south africa': 'sudáfrica',
  'sweden': 'suecia',
  'switzerland': 'suiza',
  'tunisia': 'túnez',
  'turkey': 'turquía',
  'uruguay': 'uruguay',
  'uzbekistan': 'uzbekistán'
};

const LISTA_PAISES = [
  'Alemania', 'Arabia Saudita', 'Argelia', 'Argentina', 'Australia', 'Austria',
  'Bélgica', 'Bosnia y Herzegovina', 'Brasil', 'Cabo Verde', 'Canadá', 'Catar',
  'Colombia', 'Corea del Sur', 'Costa de Marfil', 'Croacia', 'Curazao', 'Ecuador',
  'Egipto', 'Escocia', 'España', 'Estados Unidos', 'Francia', 'Ghana', 'Haití',
  'Inglaterra', 'Irak', 'Irán', 'Japón', 'Jordania', 'Marruecos', 'México',
  'Noruega', 'Nueva Zelanda', 'Países Bajos', 'Panamá', 'Paraguay', 'Portugal',
  'RD Congo', 'República Checa', 'Senegal', 'Sudáfrica', 'Suecia', 'Suiza', 'Túnez',
  'Turquía', 'Uruguay', 'Uzbekistán'
];

/**
 * Traduce el nombre del país de la API a castellano con su formato de capitalización correcto.
 */
function obtenerNombrePaisCastellano(apiName) {
  if (!apiName) return '';
  const apiLower = apiName.toLowerCase().trim();
  const traduccion = TRADUCCION_PAISES[apiLower] || apiLower;
  const traduccionLower = traduccion.toLowerCase();
  
  const normalizar = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const tradNorm = normalizar(traduccionLower);
  
  const coincidencia = LISTA_PAISES.find(p => normalizar(p) === tradNorm);
  if (coincidencia) return coincidencia;
  
  return traduccion.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Mapea un ID de la API a tu ID interno de partido (p_01, ko_01, etc.)
 */
function mapearFixtureAPartidoLocal(apiFixture, partidosLocales) {
  const apiId = parseInt(apiFixture.fixture.id, 10);
  if (isNaN(apiId)) return null;

  // 1. Intentar buscar por coincidencia exacta de ID si ya lo guardamos antes
  let coincidencia = partidosLocales.find(p => p.api_game_id === apiId);
  if (coincidencia) return coincidencia;

  // 2. Si es fase eliminatoria, mapear por ID secuencial directo (73-104 -> ko_01-ko_32)
  if (apiId >= 73 && apiId <= 104) {
    const localId = `ko_${String(apiId - 72).padStart(2, '0')}`;
    return partidosLocales.find(p => p.partido_id === localId);
  }

  // 3. Si es fase de grupos, comparar los nombres de los equipos
  const apiHomeOriginal = apiFixture.teams.home.name.toLowerCase();
  const apiAwayOriginal = apiFixture.teams.away.name.toLowerCase();

  const apiHomeTeam = TRADUCCION_PAISES[apiHomeOriginal] || apiHomeOriginal;
  const apiAwayTeam = TRADUCCION_PAISES[apiAwayOriginal] || apiAwayOriginal;

  const normalizar = str => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const apiHomeNorm = normalizar(apiHomeTeam);
  const apiAwayNorm = normalizar(apiAwayTeam);

  return partidosLocales.find(p => {
    if (!p.partido_id.startsWith('p_')) return false;

    const localHomeNorm = normalizar(p.equipo_local.toLowerCase());
    const localAwayNorm = normalizar(p.equipo_visitante.toLowerCase());

    return (localHomeNorm === apiHomeNorm && localAwayNorm === apiAwayNorm) ||
           (localHomeNorm === apiAwayNorm && localAwayNorm === apiHomeNorm);
  });
}

/**
 * Tarea 1: Sincronización Diaria de Fixtures
 */
async function ejecutarSincronizacionDiaria() {
  console.log('[Scheduler] Iniciando sincronización de todos los partidos del Mundial...');
  try {
    const fixturesTodos = await apiService.obtenerTodosLosPartidos();
    
    if (fixturesTodos.length === 0) {
      console.log(`[Scheduler] No se encontraron partidos en la API de worldcup26.ir.`);
      return;
    }

    const partidosLocales = dbReal && typeof dbReal.leerPartidos === 'function' 
      ? await dbReal.leerPartidos() 
      : [];

    let count = 0;
    for (const apiFixture of fixturesTodos) {
      const partidoLocal = mapearFixtureAPartidoLocal(apiFixture, partidosLocales);

      if (partidoLocal) {
        let modificado = false;
        const apiId = parseInt(apiFixture.fixture.id, 10);

        if (partidoLocal.api_game_id !== apiId) {
          partidoLocal.api_game_id = apiId;
          modificado = true;
        }
        
        const apiHomeCastellano = obtenerNombrePaisCastellano(apiFixture.teams.home.name);
        const apiAwayCastellano = obtenerNombrePaisCastellano(apiFixture.teams.away.name);

        const esLocalPlaceholder = !LISTA_PAISES.includes(partidoLocal.equipo_local);
        const esVisitantePlaceholder = !LISTA_PAISES.includes(partidoLocal.equipo_visitante);

        if (esLocalPlaceholder && apiHomeCastellano && LISTA_PAISES.includes(apiHomeCastellano) && partidoLocal.equipo_local !== apiHomeCastellano) {
          partidoLocal.equipo_local = apiHomeCastellano;
          modificado = true;
        }
        if (esVisitantePlaceholder && apiAwayCastellano && LISTA_PAISES.includes(apiAwayCastellano) && partidoLocal.equipo_visitante !== apiAwayCastellano) {
          partidoLocal.equipo_visitante = apiAwayCastellano;
          modificado = true;
        }

        if (modificado) {
          await db.saveMatch(partidoLocal);
          count++;
          console.log(`[Scheduler] Partido local '${partidoLocal.partido_id}' actualizado con éxito (API ID: ${apiId})`);
        }
      }
    }
    console.log(`[Scheduler] Sincronización de partidos completada. Se actualizaron ${count} partidos.`);
  } catch (error) {
    console.error('[Scheduler] Error en la sincronización:', error.message);
    throw error;
  }
}

/**
 * Tarea 2: Monitoreo en Tiempo Real (Poller)
 */
async function ejecutarMonitoreoTiempoReal() {
  console.log('[Scheduler] Ejecutando monitoreo de partidos en tiempo real...');
  try {
    const todosLosPartidos = dbReal && typeof dbReal.leerPartidos === 'function' 
      ? await dbReal.leerPartidos() 
      : [];
    const ahora = Date.now();

    const partidosActivos = todosLosPartidos.filter(p => {
      if (p.finalizado) return false;
      if (!p.api_game_id) return false;

      const tiempoTranscurridoMs = ahora - new Date(p.fecha_inicio).getTime();
      return tiempoTranscurridoMs >= 90 * 60 * 1000;
    });

    console.log(`[Scheduler] Partidos activos para monitoreo: ${partidosActivos.length}`);

    if (partidosActivos.length === 0) {
      console.log('[Scheduler] No hay partidos activos para monitoreo.');
      return;
    }

    for (const partido of partidosActivos) {
      if (partido.last_queried_api) {
        const tiempoDesdeUltimaConsulta = ahora - new Date(partido.last_queried_api).getTime();
        const esperaMinimaMs = 4 * 60 * 1000; // 4 minutos de cooldown

        if (tiempoDesdeUltimaConsulta < esperaMinimaMs) {
          continue;
        }
      }

      const timestampConsulta = new Date().toISOString();
      const fixtureData = await apiService.obtenerEstadoFixture(partido.api_game_id);
      partido.last_queried_api = timestampConsulta;

      if (!fixtureData) {
        console.error(`[Scheduler] No se pudo obtener datos del fixture ${partido.api_game_id} de la API.`);
        await db.saveMatch(partido);
        continue;
      }

      const statusShort = fixtureData.fixture.status.short;
      const goalsHome = fixtureData.goals.home;
      const goalsAway = fixtureData.goals.away;
      const penaltyHome = fixtureData.penalty ? fixtureData.penalty.home : null;
      const penaltyAway = fixtureData.penalty ? fixtureData.penalty.away : null;

      console.log(`[Scheduler] Partido '${partido.partido_id}' (${partido.equipo_local} vs ${partido.equipo_visitante}). Estado API: ${statusShort}. Goles: ${goalsHome}-${goalsAway}`);

      if (goalsHome !== null && goalsAway !== null) {
        partido.goles_local_real = goalsHome;
        partido.goles_visitante_real = goalsAway;
      }

      const estadosFinales = ['FT', 'AET', 'PEN'];
      if (estadosFinales.includes(statusShort)) {
        partido.finalizado = true;

        const esKnockout = partido.fase !== 'Fase de Grupos';
        if (esKnockout && goalsHome !== null && goalsAway !== null) {
          const gh = parseInt(goalsHome, 10);
          const ga = parseInt(goalsAway, 10);
          if (gh > ga) {
            partido.ganador_real = 'local';
          } else if (gh < ga) {
            partido.ganador_real = 'visitante';
          } else {
            if (penaltyHome !== null && penaltyAway !== null) {
              const ph = parseInt(penaltyHome, 10);
              const pa = parseInt(penaltyAway, 10);
              if (ph > pa) {
                partido.ganador_real = 'local';
              } else if (ph < pa) {
                partido.ganador_real = 'visitante';
              }
            }
          }
        }
        console.log(`[Scheduler] ¡Partido '${partido.partido_id}' FINALIZADO! Guardando resultado definitivo: ${goalsHome}-${goalsAway}`);
      }

      await db.saveMatch(partido);
    }
  } catch (error) {
    console.error('[Scheduler] Error en el monitoreo de tiempo real:', error.message);
    throw error;
  }
}

function inicializarPlanificador() {
  console.log('[Scheduler] Inicializando planificador de tareas de worldcup26.ir...');

  // Cron Diario: Corre todos los días a las 00:05 AM
  cronScheduler.schedule('5 0 * * *', async () => {
    await ejecutarSincronizacionDiaria();
  });
  console.log('[Scheduler] Cron Diario registrado para las 00:05');

  // Cron de Monitoreo: Corre cada 5 minutos
  cronScheduler.schedule('*/5 * * * *', async () => {
    await ejecutarMonitoreoTiempoReal();
  });
  console.log('[Scheduler] Cron de Monitoreo registrado para correr cada 5 minutos');

  ejecutarSincronizacionDiaria()
    .then(() => ejecutarMonitoreoTiempoReal())
    .catch(err => console.error('[Scheduler] Error en ejecución inicial:', err.message));
}

module.exports = {
  inicializarPlanificador,
  ejecutarSincronizacionDiaria,
  ejecutarMonitoreoTiempoReal
};
