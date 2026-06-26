/**
 * db.js — Capa de Persistencia con Supabase
 *
 * Se eliminó por completo el almacenamiento en archivos CSV locales y la API de GitHub.
 * Todos los datos se leen y escriben en Supabase utilizando el SDK oficial.
 */

'use strict';

const { supabase, supabaseAdmin } = require('./supabaseClient');
const { calcularPuntosTop3 } = require('./engine');

// ─────────────────────────────────────────────
// INTERFAZ PÚBLICA — Lectura
// ─────────────────────────────────────────────

async function leerUsuarios() {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('username, avatar_emoji')
    .order('username', { ascending: true });
  if (error) {
    console.error('[Supabase] Error al leer usuarios:', error.message);
    throw error;
  }
  return data || [];
}

async function leerPartidos() {
  const { data, error } = await supabaseAdmin
    .from('matches')
    .select('*')
    .order('date_iso', { ascending: true });
  if (error) {
    console.error('[Supabase] Error al leer partidos:', error.message);
    throw error;
  }

  // Mapear de base de datos a formato de negocio de la aplicación
  return (data || []).map(p => ({
    partido_id:           p.id,
    fase:                 p.fase,
    equipo_local:         p.home_team,
    equipo_visitante:     p.away_team,
    fecha_inicio:         p.date_iso,
    goles_local_real:     p.home_score,
    goles_visitante_real: p.away_score,
    finalizado:           p.finalizado,
    api_game_id:          p.api_game_id,
    last_queried_api:     p.last_queried_api,
    ganador_real:         p.ganador_real
  }));
}

async function leerPrediccionesPartidos() {
  const { data, error } = await supabaseAdmin
    .from('predictions')
    .select('home_score, away_score, ganador_pred, match_id, profiles(username)');
  if (error) {
    console.error('[Supabase] Error al leer predicciones de partidos:', error.message);
    throw error;
  }

  return (data || []).map(p => ({
    username:             p.profiles ? p.profiles.username : '',
    partido_id:           p.match_id,
    goles_local_pred:     p.home_score,
    goles_visitante_pred: p.away_score,
    ganador_pred:         p.ganador_pred || ''
  }));
}

async function leerPrediccionesTop3() {
  const { data, error } = await supabaseAdmin
    .from('predictions_top3')
    .select('puesto_1, puesto_2, puesto_3, profiles(username)');
  if (error) {
    console.error('[Supabase] Error al leer predicciones top3:', error.message);
    throw error;
  }

  return (data || []).map(p => ({
    username: p.profiles ? p.profiles.username : '',
    puesto_1: p.puesto_1,
    puesto_2: p.puesto_2,
    puesto_3: p.puesto_3
  }));
}

async function leerResultadoTop3() {
  const { data, error } = await supabaseAdmin
    .from('resultado_top3')
    .select('puesto_1, puesto_2, puesto_3')
    .eq('id', 1)
    .maybeSingle();
  if (error) {
    console.error('[Supabase] Error al leer resultado top3:', error.message);
    throw error;
  }
  return data || { puesto_1: '', puesto_2: '', puesto_3: '' };
}

// ─────────────────────────────────────────────
// INTERFAZ PÚBLICA — Escritura
// ─────────────────────────────────────────────

async function guardarUsuario(usuario) {
  // Actualiza el avatar del perfil en Supabase
  const { error } = await supabaseAdmin
    .from('profiles')
    .update({ avatar_emoji: usuario.avatar_emoji })
    .eq('username', usuario.username);
  if (error) {
    console.error('[Supabase] Error al guardar usuario:', error.message);
    throw error;
  }
}

async function actualizarUsername(oldUsername, newUsername) {
  const cleanOld = oldUsername.trim();
  const cleanNew = newUsername.trim();

  // 1. Obtener el UUID del usuario por su viejo username
  const { data: profile, error: getError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', cleanOld)
    .single();

  if (getError || !profile) {
    throw new Error('Usuario no encontrado.');
  }

  // 2. Actualizar la tabla de perfiles
  const { error: updateProfileError } = await supabaseAdmin
    .from('profiles')
    .update({ username: cleanNew })
    .eq('id', profile.id);

  if (updateProfileError) {
    console.error('[Supabase] Error al actualizar username del perfil:', updateProfileError.message);
    throw updateProfileError;
  }

  // 3. Actualizar los metadatos en la autenticación de Supabase
  const { error: authError } = await supabaseAdmin.auth.admin.updateUserById(
    profile.id,
    {
      user_metadata: { username: cleanNew }
    }
  );

  if (authError) {
    console.error('[Supabase] Error al actualizar username en Auth metadata:', authError.message);
    throw authError;
  }
}

async function guardarPartido(partido) {
  const record = {
    id:               partido.partido_id,
    fase:             partido.fase,
    home_team:        partido.equipo_local,
    away_team:        partido.equipo_visitante,
    date_iso:         partido.fecha_inicio,
    home_score:       partido.goles_local_real !== null && partido.goles_local_real !== '' ? parseInt(partido.goles_local_real, 10) : null,
    away_score:       partido.goles_visitante_real !== null && partido.goles_visitante_real !== '' ? parseInt(partido.goles_visitante_real, 10) : null,
    finalizado:       partido.finalizado === true || partido.finalizado === 'true',
    api_game_id:      partido.api_game_id !== null && partido.api_game_id !== '' ? parseInt(partido.api_game_id, 10) : null,
    last_queried_api: partido.last_queried_api || '',
    ganador_real:     partido.ganador_real || ''
  };

  const { error } = await supabaseAdmin
    .from('matches')
    .upsert(record, { onConflict: 'id' });

  if (error) {
    console.error('[Supabase] Error al guardar partido:', error.message);
    throw error;
  }
}

async function guardarPrediccionPartido(prediccion) {
  // 1. Buscar el UUID del usuario
  const { data: profile, error: getError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', prediccion.username)
    .single();

  if (getError || !profile) {
    throw new Error('Usuario no encontrado.');
  }

  const record = {
    user_id:      profile.id,
    match_id:     prediccion.partido_id,
    home_score:   parseInt(prediccion.goles_local_pred, 10),
    away_score:   parseInt(prediccion.goles_visitante_pred, 10),
    ganador_pred: prediccion.ganador_pred || ''
  };

  const { error } = await supabaseAdmin
    .from('predictions')
    .upsert(record, { onConflict: 'user_id,match_id' });

  if (error) {
    console.error('[Supabase] Error al guardar predicción:', error.message);
    throw error;
  }
}

async function eliminarPrediccionPartido(username, partidoId) {
  const { data: profile, error: getError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', username)
    .single();

  if (getError || !profile) {
    throw new Error('Usuario no encontrado.');
  }

  const { error } = await supabaseAdmin
    .from('predictions')
    .delete()
    .eq('user_id', profile.id)
    .eq('match_id', partidoId);

  if (error) {
    console.error('[Supabase] Error al eliminar predicción:', error.message);
    throw error;
  }
}

async function guardarPrediccionTop3(prediccion) {
  const { data: profile, error: getError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', prediccion.username)
    .single();

  if (getError || !profile) {
    throw new Error('Usuario no encontrado.');
  }

  const record = {
    user_id:    profile.id,
    puesto_1:   prediccion.puesto_1,
    puesto_2:   prediccion.puesto_2,
    puesto_3:   prediccion.puesto_3,
    updated_at: new Date().toISOString()
  };

  const { error } = await supabaseAdmin
    .from('predictions_top3')
    .upsert(record, { onConflict: 'user_id' });

  if (error) {
    console.error('[Supabase] Error al guardar predicción de Top 3:', error.message);
    throw error;
  }
}

async function guardarResultadoTop3(resultado) {
  const { error } = await supabaseAdmin
    .from('resultado_top3')
    .upsert({
      id: 1,
      puesto_1: resultado.puesto_1,
      puesto_2: resultado.puesto_2,
      puesto_3: resultado.puesto_3
    }, { onConflict: 'id' });

  if (error) {
    console.error('[Supabase] Error al guardar resultado real Top 3:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────
// CHAT / MURO
// ─────────────────────────────────────────────

async function leerMensajesChat() {
  const { data, error } = await supabaseAdmin
    .from('chat_messages')
    .select('id, texto, timestamp, reply_to_id, reply_to_username, reply_to_texto, profiles(username)')
    .order('timestamp', { ascending: true });

  if (error) {
    console.error('[Supabase] Error al leer mensajes de chat:', error.message);
    throw error;
  }

  return (data || []).map(m => ({
    id:                m.id,
    username:          m.profiles ? m.profiles.username : '',
    texto:             m.texto,
    timestamp:         m.timestamp,
    reply_to_id:       m.reply_to_id || '',
    reply_to_username: m.reply_to_username || '',
    reply_to_texto:    m.reply_to_texto || ''
  }));
}

async function guardarMensajeChat(mensaje) {
  const { data: profile, error: getError } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('username', mensaje.username)
    .single();

  if (getError || !profile) {
    throw new Error('Usuario no encontrado.');
  }

  const record = {
    id:                mensaje.id || undefined,
    user_id:           profile.id,
    texto:             mensaje.texto,
    reply_to_id:       mensaje.reply_to_id || null,
    reply_to_username: mensaje.reply_to_username || null,
    reply_to_texto:    mensaje.reply_to_texto || null,
    timestamp:         mensaje.timestamp ? new Date(mensaje.timestamp).toISOString() : new Date().toISOString()
  };

  const { error } = await supabaseAdmin
    .from('chat_messages')
    .insert(record);

  if (error) {
    console.error('[Supabase] Error al guardar mensaje de chat:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────
// CONFIGURACIÓN GLOBAL
// ─────────────────────────────────────────────

async function leerConfigGlobal() {
  const { data, error } = await supabaseAdmin
    .from('system_config')
    .select('argentina_mode')
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.error('[Supabase] Error al leer configuración global:', error.message);
    return { argentinaMode: false };
  }
  return { argentinaMode: data ? data.argentina_mode : false };
}

async function guardarConfigGlobal(config) {
  const { error } = await supabaseAdmin
    .from('system_config')
    .upsert({
      id: 1,
      argentina_mode: !!config.argentinaMode
    }, { onConflict: 'id' });

  if (error) {
    console.error('[Supabase] Error al guardar configuración global:', error.message);
    throw error;
  }
}

// ─────────────────────────────────────────────
// CÁLCULO DE RANKING EN BASE DE DATOS (Scoreboard)
// ─────────────────────────────────────────────

async function obtenerScoreboardDb() {
  // 1. Obtener todos los perfiles de usuario
  const { data: profiles, error: errProf } = await supabaseAdmin
    .from('profiles')
    .select('username, avatar_emoji');
  if (errProf) throw errProf;

  // 2. Obtener partidos finalizados ordenados por fecha de inicio
  const { data: matches, error: errMatches } = await supabaseAdmin
    .from('matches')
    .select('*')
    .eq('finalizado', true)
    .order('date_iso', { ascending: true });
  if (errMatches) throw errMatches;

  // 3. Obtener todas las predicciones de partidos con los puntos ya calculados por SQL
  const { data: predsWithPoints, error: errPreds } = await supabaseAdmin
    .from('predictions_with_points')
    .select('*');
  if (errPreds) throw errPreds;

  // 4. Obtener todas las predicciones del Top 3
  const { data: predsTop3, error: errTop3 } = await supabaseAdmin
    .from('predictions_top3')
    .select('puesto_1, puesto_2, puesto_3, profiles(username)');
  if (errTop3) throw errTop3;

  // 5. Obtener podio real actual
  const realTop3 = await leerResultadoTop3();

  // 6. Construir el Scoreboard
  const scoreboard = (profiles || []).map(usr => {
    let puntajeTotal = 0;
    const historialPuntos = [0];
    const rachaDetalles = [];

    let puntosTendenciaAcum = 0;
    let puntosGolesAcum = 0;
    let puntosPlenoAcum = 0;

    // Predicciones asociadas a este usuario
    const userPreds = (predsWithPoints || []).filter(p => p.username === usr.username);

    // Predicción Top 3 del usuario
    const userTop3 = (predsTop3 || []).find(p => p.profiles && p.profiles.username === usr.username);

    // Construcción del historial partido a partido
    (matches || []).forEach(match => {
      const pred = userPreds.find(p => p.match_id === match.id);
      let pts = 0;
      let tipo = 'loss';

      if (pred) {
        pts = pred.puntos_partido || 0;
        puntosTendenciaAcum += pred.puntos_tendencia || 0;
        puntosGolesAcum += pred.puntos_goles || 0;
        puntosPlenoAcum += pred.puntos_pleno || 0;

        if ((pred.puntos_pleno || 0) > 0) {
          tipo = 'win';
        } else if (pts > 0) {
          tipo = 'draw';
        }
      }

      puntajeTotal += pts;
      rachaDetalles.push({ puntos: pts, tipo });
      historialPuntos.push(puntajeTotal);
    });

    // Puntos extra por Top 3
    let puntosTop3Val = 0;
    const tieneRealTop3 = realTop3 && realTop3.puesto_1 && realTop3.puesto_2 && realTop3.puesto_3;
    if (tieneRealTop3 && userTop3) {
      puntosTop3Val = calcularPuntosTop3(userTop3, realTop3);
      puntajeTotal += puntosTop3Val;
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
        top3: puntosTop3Val
      }
    };
  });

  // Ordenar por puntaje total de mayor a menor y por nombre como desempate
  return scoreboard.sort((a, b) => {
    if (b.puntaje_total !== a.puntaje_total) {
      return b.puntaje_total - a.puntaje_total;
    }
    return a.username.localeCompare(b.username);
  });
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────

module.exports = {
  leerUsuarios,
  guardarUsuario,
  leerPartidos,
  guardarPartido,
  leerPrediccionesPartidos,
  guardarPrediccionPartido,
  eliminarPrediccionPartido,
  leerPrediccionesTop3,
  guardarPrediccionTop3,
  leerResultadoTop3,
  guardarResultadoTop3,
  leerMensajesChat,
  guardarMensajeChat,
  actualizarUsername,
  leerConfigGlobal,
  guardarConfigGlobal,
  obtenerScoreboardDb,
};
