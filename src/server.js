const express = require('express');
const crypto  = require('crypto');
const path    = require('path');
const {
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
} = require('./db');
const {
  esPartidoPredecible,
  esTop3Predecible,
  calcularPuntosPartido,
} = require('./engine');
const {
  inicializarPlanificador,
  ejecutarSincronizacionDiaria,
  ejecutarMonitoreoTiempoReal
} = require('./worldcupScheduler');
const { supabase, supabaseAdmin } = require('./supabaseClient');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Helper para centralizar el manejo de errores async en los handlers
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Middleware de Autenticación con Supabase JWT
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  let sessionUsername = req.headers['x-session-username'];

  if (!authHeader || !authHeader.startsWith('Bearer ') || !sessionUsername) {
    return res.status(401).json({ error: 'Sesión no iniciada o inválida. Por favor, inicia sesión nuevamente.' });
  }

  try {
    sessionUsername = decodeURIComponent(sessionUsername);
  } catch (e) {
    // Si no es decodificable, dejamos el valor recibido
  }

  const token = authHeader.split(' ')[1];

  // Validar token de acceso contra Supabase Auth
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Sesión inválida o expirada. Por favor, inicia sesión de nuevo.' });
  }

  const userMetadataName = user.user_metadata ? user.user_metadata.username : null;
  
  if (!userMetadataName || userMetadataName.toLowerCase() !== sessionUsername.toLowerCase()) {
    return res.status(401).json({ error: 'Conflicto de sesión de usuario.' });
  }

  req.authenticatedUser = userMetadataName;
  req.authenticatedUserId = user.id;
  next();
}

// ─────────────────────────────────────────────
// ESTADO EN MEMORIA — PRESENCIA ACTIVA Y TIPEO
// ─────────────────────────────────────────────
// { username: { lastPing: Number, escribiendoAt: Number } }
const presenciaActiva = {};
const PRESENCIA_TIMEOUT_MS  = 45 * 1000; // 45 segundos sin ping = inactivo
const ESCRIBIENDO_TIMEOUT_MS = 4 * 1000; // 4 segundos sin tipeo = paró de escribir

// ─────────────────────────────────────────────
// API AUTH
// ─────────────────────────────────────────────

// Registro de usuarios
app.post('/api/auth/register', asyncHandler(async (req, res) => {
  const { username, password, avatar_emoji } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
  }

  const cleanUsername = username.trim();
  if (cleanUsername.length < 2) {
    return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 2 caracteres.' });
  }
  if (cleanUsername.length > 30) {
    return res.status(400).json({ error: 'El nombre de usuario no puede superar los 30 caracteres.' });
  }

  const regex = /^[a-zA-Z0-9_\-\.]+$/;
  if (!regex.test(cleanUsername)) {
    return res.status(400).json({ error: 'El nombre de usuario sólo puede contener letras, números, guiones, puntos y guiones bajos.' });
  }

  // Generamos un email ficticio para no forzar email en el login frontend
  const email = `${cleanUsername.toLowerCase()}@prode.local`;

  // Crear usuario con el API Admin para auto-confirmarlo y pasar metadatos de perfil
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      username: cleanUsername,
      avatar_emoji: avatar_emoji || '⚽'
    }
  });

  if (error) {
    // Si el usuario ya existe en Supabase Auth
    if (error.message.includes('already registered') || error.message.includes('already exists')) {
      return res.status(400).json({ error: 'El nombre de usuario ya está registrado.' });
    }
    return res.status(400).json({ error: error.message });
  }

  // Iniciar sesión inmediatamente para devolver el token de acceso
  const { data: sessionData, error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (loginError || !sessionData || !sessionData.session) {
    return res.status(400).json({ error: 'Registro exitoso, pero ocurrió un error al iniciar sesión automáticamente.' });
  }

  res.json({
    username: cleanUsername,
    avatar_emoji: avatar_emoji || '⚽',
    token: sessionData.session.access_token
  });
}));

// Login
app.post('/api/auth/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña requeridos.' });
  }

  const email = `${username.trim().toLowerCase()}@prode.local`;
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (error || !data.user || !data.session) {
    return res.status(401).json({ error: 'Credenciales inválidas.' });
  }

  // Buscar perfil público del usuario
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('username, avatar_emoji')
    .eq('id', data.user.id)
    .maybeSingle();

  const finalUsername = profile ? profile.username : (data.user.user_metadata.username || username.trim());
  const finalAvatar = profile ? profile.avatar_emoji : (data.user.user_metadata.avatar_emoji || '⚽');

  res.json({
    username: finalUsername,
    avatar_emoji: finalAvatar,
    token: data.session.access_token
  });
}));

// Actualizar avatar del usuario
app.post('/api/user/avatar', authenticate, asyncHandler(async (req, res) => {
  const { username, avatar_emoji } = req.body;
  if (!username || !avatar_emoji) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No tienes permiso para modificar el avatar de otro usuario.' });
  }

  // Modificar avatar del perfil en Supabase
  await guardarUsuario({ username, avatar_emoji });
  res.json({ success: true, username, avatar_emoji });
}));

// Actualizar nombre de usuario
app.post('/api/user/username', authenticate, asyncHandler(async (req, res) => {
  const { oldUsername, newUsername } = req.body;
  if (!oldUsername || !newUsername) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }
  if (oldUsername !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No tienes permiso para modificar el nombre de otro usuario.' });
  }

  const cleanOld = oldUsername.trim();
  const cleanNew = newUsername.trim();

  if (cleanNew.length < 2) {
    return res.status(400).json({ error: 'El nombre de usuario debe tener al menos 2 caracteres.' });
  }
  if (cleanNew.length > 30) {
    return res.status(400).json({ error: 'El nombre de usuario no puede superar los 30 caracteres.' });
  }
  
  const regex = /^[a-zA-Z0-9_\-\.]+$/;
  if (!regex.test(cleanNew)) {
    return res.status(400).json({ error: 'El nombre de usuario solo puede contener letras, números, guiones, puntos y guiones bajos.' });
  }

  // Actualizar en base de datos y Auth metadata
  await actualizarUsername(cleanOld, cleanNew);

  if (presenciaActiva[cleanOld]) {
    delete presenciaActiva[cleanOld];
  }

  // En Supabase, para generar un nuevo token JWT con el metadato actualizado,
  // el cliente deberá refrescar sesión o usar el token antiguo hasta que expire.
  // Pero devolvemos success: true indicando que se ha cambiado correctamente.
  res.json({ success: true, oldUsername: cleanOld, newUsername: cleanNew });
}));

// Actualizar contraseña del usuario
app.post('/api/user/password', authenticate, asyncHandler(async (req, res) => {
  const { username, currentPassword, newPassword } = req.body;
  if (!username || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No tienes permiso para modificar la contraseña de otro usuario.' });
  }

  if (newPassword.length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  }

  // Primero validamos la contraseña actual intentando loguearnos
  const email = `${username.trim().toLowerCase()}@prode.local`;
  const { error: loginError } = await supabase.auth.signInWithPassword({
    email,
    password: currentPassword
  });

  if (loginError) {
    return res.status(400).json({ error: 'La contraseña actual es incorrecta.' });
  }

  // Modificar la contraseña vía Admin API
  const { error } = await supabaseAdmin.auth.admin.updateUserById(
    req.authenticatedUserId,
    { password: newPassword }
  );

  if (error) {
    return res.status(400).json({ error: `Error al cambiar contraseña: ${error.message}` });
  }

  res.json({ success: true, message: 'Contraseña actualizada correctamente.' });
}));

// ─────────────────────────────────────────────
// API PARTIDOS & PREDICCIONES
// ─────────────────────────────────────────────

app.get('/api/partidos', authenticate, asyncHandler(async (req, res) => {
  const { username } = req.query;
  if (username && username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No tienes permiso para consultar predicciones de otro usuario.' });
  }
  const partidos     = await leerPartidos();
  const predicciones = await leerPrediccionesPartidos();

  const ahora = new Date();

  // Calcular pálpito (distribución de votos) para cada partido
  function calcularPalpito(partidoId, equipoLocal, equipoVisitante, prediccionesTodas) {
    const predsPartido = prediccionesTodas.filter(p => p.partido_id === partidoId);
    const total = predsPartido.length;
    if (total === 0) return { local: 0, empate: 0, visitante: 0, total_votos: 0 };

    let votosLocal = 0, votosEmpate = 0, votosVisitante = 0;
    predsPartido.forEach(p => {
      const gl = parseInt(p.goles_local_pred, 10);
      const gv = parseInt(p.goles_visitante_pred, 10);
      if (isNaN(gl) || isNaN(gv)) return;
      const tendencia = Math.sign(gl - gv);
      if (tendencia > 0) votosLocal++;
      else if (tendencia === 0) votosEmpate++;
      else votosVisitante++;
    });

    const rawLocal     = (votosLocal     / total) * 100;
    const rawEmpate    = (votosEmpate    / total) * 100;
    const rawVisitante = (votosVisitante / total) * 100;

    const floorLocal     = Math.floor(rawLocal);
    const floorEmpate    = Math.floor(rawEmpate);
    const floorVisitante = Math.floor(rawVisitante);
    const remainder = 100 - floorLocal - floorEmpate - floorVisitante;

    const remainders = [
      { key: 'local',     value: rawLocal     - floorLocal,     floor: floorLocal },
      { key: 'empate',    value: rawEmpate    - floorEmpate,    floor: floorEmpate },
      { key: 'visitante', value: rawVisitante - floorVisitante, floor: floorVisitante },
    ].sort((a, b) => b.value - a.value);

    for (let i = 0; i < remainder; i++) remainders[i].floor++;

    const result = {};
    remainders.forEach(r => { result[r.key] = r.floor; });

    return { local: result.local, empate: result.empate, visitante: result.visitante, total_votos: total };
  }

  const partidosConPred = partidos.map(partido => {
    let pred = null;
    if (username) {
      pred = predicciones.find(p => p.username === username && p.partido_id === partido.partido_id) || null;
    }
    const predecible = esPartidoPredecible(partido.fecha_inicio, ahora);
    const palpito = !predecible
      ? calcularPalpito(partido.partido_id, partido.equipo_local, partido.equipo_visitante, predicciones)
      : null;
    return {
      ...partido,
      goles_local_pred:     pred ? pred.goles_local_pred     : null,
      goles_visitante_pred: pred ? pred.goles_visitante_pred : null,
      ganador_pred:         pred ? pred.ganador_pred         : '',
      predecible,
      palpito,
    };
  });

  const top3Predecible = esTop3Predecible(partidos, ahora);
  let prediccionTop3   = null;
  if (username) {
    const todasPredsTop3 = await leerPrediccionesTop3();
    prediccionTop3 = todasPredsTop3.find(p => p.username === username) || null;
  }

  res.json({
    partidos:        partidosConPred,
    top3_predecible: top3Predecible,
    prediccion_top3: prediccionTop3,
  });
}));

// Guardar predicción de un partido
app.post('/api/predicciones/partido', authenticate, asyncHandler(async (req, res) => {
  const { username, partido_id, goles_local_pred, goles_visitante_pred, ganador_pred } = req.body;
  if (!username || !partido_id || goles_local_pred === undefined || goles_visitante_pred === undefined) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const partidos = await leerPartidos();
  const partido  = partidos.find(p => p.partido_id === partido_id);
  if (!partido) {
    return res.status(404).json({ error: 'Partido no encontrado.' });
  }

  const ahora = new Date();
  if (!esPartidoPredecible(partido.fecha_inicio, ahora)) {
    return res.status(400).json({ error: 'El partido ya ha comenzado. Predicción bloqueada.' });
  }

  const gLocal    = parseInt(goles_local_pred,     10);
  const gVisitante = parseInt(goles_visitante_pred, 10);
  if (isNaN(gLocal) || isNaN(gVisitante) || gLocal < 0 || gVisitante < 0) {
    return res.status(400).json({ error: 'Marcadores inválidos.' });
  }

  await guardarPrediccionPartido({ username, partido_id, goles_local_pred: gLocal, goles_visitante_pred: gVisitante, ganador_pred: ganador_pred || '' });
  res.json({ message: 'Predicción guardada correctamente.' });
}));

// Eliminar predicción de un partido
app.delete('/api/predicciones/partido', authenticate, asyncHandler(async (req, res) => {
  const { username, partido_id } = req.body;
  if (!username || !partido_id) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const partidos = await leerPartidos();
  const partido  = partidos.find(p => p.partido_id === partido_id);
  if (!partido) {
    return res.status(404).json({ error: 'Partido no encontrado.' });
  }

  const ahora = new Date();
  if (!esPartidoPredecible(partido.fecha_inicio, ahora)) {
    return res.status(400).json({ error: 'El partido ya ha comenzado. No se puede eliminar la predicción.' });
  }

  await eliminarPrediccionPartido(username, partido_id);
  res.json({ message: 'Predicción eliminada correctamente.' });
}));

// Guardar predicción del Top 3
app.post('/api/predicciones/top3', authenticate, asyncHandler(async (req, res) => {
  const { username, puesto_1, puesto_2, puesto_3 } = req.body;
  if (!username || !puesto_1 || !puesto_2 || !puesto_3) {
    return res.status(400).json({ error: 'Debe rellenar los 3 puestos.' });
  }
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const partidos = await leerPartidos();
  const ahora    = new Date();
  if (!esTop3Predecible(partidos, ahora)) {
    return res.status(400).json({ error: 'La predicción del Top 3 ya está cerrada (comenzó el último partido de grupos).' });
  }

  await guardarPrediccionTop3({ username, puesto_1: puesto_1.trim(), puesto_2: puesto_2.trim(), puesto_3: puesto_3.trim() });
  res.json({ message: 'Top 3 guardado correctamente.' });
}));

// ─────────────────────────────────────────────
// API SCOREBOARD / RANKINGS
// ─────────────────────────────────────────────

app.get('/api/scoreboard', authenticate, asyncHandler(async (req, res) => {
  const scoreboard = await obtenerScoreboardDb();
  res.json({ scoreboard });
}));

app.get('/api/partidos/:partidoId/auditoria', authenticate, asyncHandler(async (req, res) => {
  const { partidoId } = req.params;
  const partidos = await leerPartidos();
  const partido = partidos.find(p => p.partido_id === partidoId);
  if (!partido) {
    return res.status(404).json({ error: 'Partido no encontrado.' });
  }

  const ahora = new Date();
  const predecible = esPartidoPredecible(partido.fecha_inicio, ahora);
  
  const usuarios = await leerUsuarios();
  const predicciones = await leerPrediccionesPartidos();
  const realTop3 = await leerResultadoTop3();
  const prediccionesTop3 = await leerPrediccionesTop3();
  
  const scoreboard = await obtenerScoreboardDb();
  const predsPartido = predicciones.filter(p => p.partido_id === partidoId);

  const auditoria = scoreboard.map(usr => {
    const pred = predsPartido.find(p => p.username === usr.username);
    
    let goles_local_pred = null;
    let goles_visitante_pred = null;
    if (pred && (!predecible || usr.username === req.authenticatedUser)) {
      goles_local_pred = pred.goles_local_pred;
      goles_visitante_pred = pred.goles_visitante_pred;
    }

    let puntosObtenidos = null;
    let color = '';
    
    if (partido.finalizado && goles_local_pred !== null && goles_visitante_pred !== null) {
      const pts = calcularPuntosPartido(
        goles_local_pred,
        goles_visitante_pred,
        partido.goles_local_real,
        partido.goles_visitante_real,
        partido.fase,
        pred ? pred.ganador_pred : '',
        partido.ganador_real
      );
      puntosObtenidos = `+${pts}`;

      const glPred = parseInt(goles_local_pred, 10);
      const gvPred = parseInt(goles_visitante_pred, 10);
      const glReal = parseInt(partido.goles_local_real, 10);
      const gvReal = parseInt(partido.goles_visitante_real, 10);
      
      const esKnockout = partido.fase !== 'Fase de Grupos';
      let acertoGoles = (glPred === glReal && gvPred === gvReal);
      let acertoTendencia = false;

      if (esKnockout) {
        const winnerPred = glPred > gvPred ? 'local' : (glPred < gvPred ? 'visitante' : (pred ? pred.ganador_pred : ''));
        const winnerReal = glReal > gvReal ? 'local' : (glReal < gvReal ? 'visitante' : partido.ganador_real);
        acertoTendencia = (winnerPred && winnerReal && winnerPred === winnerReal);
        if (acertoGoles && glPred === gvPred) {
          acertoGoles = acertoTendencia;
        }
      } else {
        acertoTendencia = (Math.sign(glPred - gvPred) === Math.sign(glReal - gvReal));
      }
      
      if (acertoGoles) {
        color = 'green';
      } else if (acertoTendencia) {
        color = 'blue';
      } else {
        color = 'red';
      }
    } else if (partido.finalizado) {
      puntosObtenidos = '+0';
      color = 'red';
    }

    return {
      username: usr.username,
      avatar_emoji: usr.avatar_emoji || '⚽',
      prediccion: (goles_local_pred !== null && goles_visitante_pred !== null) ? `${goles_local_pred} - ${goles_visitante_pred}` : '-',
      puntos: puntosObtenidos !== null ? puntosObtenidos : '-',
      color: color
    };
  });

  res.json({ auditoria });
}));

// ─────────────────────────────────────────────
// API PERFIL DE USUARIO
// ─────────────────────────────────────────────

app.get('/api/profile/:username', authenticate, asyncHandler(async (req, res) => {
  const { username } = req.params;
  const { viewer }   = req.query;

  if (!viewer || viewer !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const usuarios = await leerUsuarios();
  const usuario  = usuarios.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!usuario) {
    return res.status(404).json({ error: 'Usuario no encontrado.' });
  }

  const partidos           = await leerPartidos();
  const todasPredsPartidos = await leerPrediccionesPartidos();
  const todasPredsTop3     = await leerPrediccionesTop3();
  const realTop3           = await leerResultadoTop3();

  const ahora = new Date();

  const predsUsuario    = todasPredsPartidos.filter(p => p.username === usuario.username);
  const predTop3Usuario = todasPredsTop3.find(p => p.username === usuario.username) || null;
  const esDuenio        = viewer.toLowerCase() === usuario.username.toLowerCase();

  // Privacidad de predicciones en partidos
  const prediccionesCensuradas = partidos.map(partido => {
    const pred      = predsUsuario.find(p => p.partido_id === partido.partido_id);
    const yaComenzo = ahora.getTime() >= new Date(partido.fecha_inicio).getTime();

    let goles_local_pred     = null;
    let goles_visitante_pred = null;
    let oculto               = false;

    if (pred) {
      if (esDuenio || yaComenzo) {
        goles_local_pred     = pred.goles_local_pred;
        goles_visitante_pred = pred.goles_visitante_pred;
      } else {
        oculto = true;
      }
    }

    let puntos_ganados = 0;
    if (partido.finalizado && pred && !oculto) {
      puntos_ganados = calcularPuntosPartido(
        goles_local_pred,
        goles_visitante_pred,
        partido.goles_local_real,
        partido.goles_visitante_real,
        partido.fase,
        pred ? pred.ganador_pred : '',
        partido.ganador_real
      );
    }

    return {
      partido_id:    partido.partido_id,
      fase:          partido.fase,
      equipo_local:  partido.equipo_local,
      equipo_visitante: partido.equipo_visitante,
      fecha_inicio:  partido.fecha_inicio,
      resultado_real: partido.finalizado
        ? { goles_local: partido.goles_local_real, goles_visitante: partido.goles_visitante_real, finalizado: true, ganador_real: partido.ganador_real }
        : { finalizado: false },
      prediccion: pred ? { goles_local_pred, goles_visitante_pred, ganador_pred: pred.ganador_pred, oculto } : null,
      puntos_ganados: puntos_ganados
    };
  });

  // Privacidad del Top 3
  const tieneRealTop3 = realTop3 && realTop3.puesto_1 && realTop3.puesto_2 && realTop3.puesto_3;
  let top3Censurado   = null;
  if (predTop3Usuario) {
    if (esDuenio || tieneRealTop3) {
      top3Censurado = predTop3Usuario;
    } else {
      top3Censurado = { username: usuario.username, puesto_1: '🔒', puesto_2: '🔒', puesto_3: '🔒', oculto: true };
    }
  }

  const scoreboard    = await obtenerScoreboardDb();
  const datosScoreboard = scoreboard.find(s => s.username === usuario.username) || { puntaje_total: 0, historial_puntos: [0] };

  res.json({
    username:          usuario.username,
    avatar_emoji:      usuario.avatar_emoji || '⚽',
    puntaje_total:     datosScoreboard.puntaje_total,
    historial_puntos:  datosScoreboard.historial_puntos,
    predicciones:      prediccionesCensuradas,
    prediccion_top3:   top3Censurado,
  });
}));

// Privilegios de administrador
function isAdmin(username) {
  return username === 'admin' || username === 'BigM';
}

// ─────────────────────────────────────────────
// API ADMINISTRADOR
// ─────────────────────────────────────────────

// Configurar partido
app.post('/api/admin/partido', authenticate, asyncHandler(async (req, res) => {
  if (!isAdmin(req.authenticatedUser)) {
    return res.status(403).json({ error: 'No autorizado. Se requieren privilegios de administrador.' });
  }

  const {
    partido_id,
    fase,
    equipo_local,
    equipo_visitante,
    fecha_inicio,
    goles_local_real,
    goles_visitante_real,
    finalizado,
    ganador_real
  } = req.body;

  if (!partido_id || !fase || !equipo_local || !equipo_visitante || !fecha_inicio) {
    return res.status(400).json({ error: 'Datos de partido incompletos.' });
  }

  const partidos = await leerPartidos();
  const part = partidos.find(p => p.partido_id === partido_id);

  const golesLocal = (goles_local_real === '' || goles_local_real === undefined || goles_local_real === null) ? null : parseInt(goles_local_real, 10);
  const golesVisitante = (goles_visitante_real === '' || goles_visitante_real === undefined || goles_visitante_real === null) ? null : parseInt(goles_visitante_real, 10);

  const partidoActualizado = {
    partido_id,
    fase,
    equipo_local: equipo_local.trim(),
    equipo_visitante: equipo_visitante.trim(),
    fecha_inicio,
    goles_local_real: golesLocal,
    goles_visitante_real: golesVisitante,
    finalizado: !!finalizado,
    ganador_real: ganador_real || '',
    api_game_id: part ? part.api_game_id : null,
    last_queried_api: part ? part.last_queried_api : ''
  };

  await guardarPartido(partidoActualizado);
  res.json({ success: true, message: 'Partido guardado correctamente.', partido: partidoActualizado });
}));

// Configurar podio real del Top 3
app.post('/api/admin/top3', authenticate, asyncHandler(async (req, res) => {
  if (!isAdmin(req.authenticatedUser)) {
    return res.status(403).json({ error: 'No autorizado. Se requieren privilegios de administrador.' });
  }

  const { puesto_1, puesto_2, puesto_3 } = req.body;

  if (!puesto_1 || !puesto_2 || !puesto_3) {
    return res.status(400).json({ error: 'Debe especificar las 3 posiciones del podio.' });
  }

  const podioReal = {
    puesto_1: puesto_1.trim(),
    puesto_2: puesto_2.trim(),
    puesto_3: puesto_3.trim()
  };

  await guardarResultadoTop3(podioReal);
  res.json({ success: true, message: 'Podio real guardado correctamente.', podio: podioReal });
}));

// Consultar podio real
app.get('/api/admin/top3', authenticate, asyncHandler(async (req, res) => {
  if (!isAdmin(req.authenticatedUser)) {
    return res.status(403).json({ error: 'No autorizado. Solo un administrador puede consultar el podio real.' });
  }
  res.json(await leerResultadoTop3());
}));

// Obtener configuración global
app.get('/api/config', asyncHandler(async (req, res) => {
  const config = await leerConfigGlobal();
  res.json(config);
}));

// Modificar configuración global
app.post('/api/admin/config', authenticate, asyncHandler(async (req, res) => {
  if (!isAdmin(req.authenticatedUser)) {
    return res.status(403).json({ error: 'No autorizado. Se requieren privilegios de administrador.' });
  }
  const { argentinaMode } = req.body;
  if (argentinaMode === undefined) {
    return res.status(400).json({ error: 'Falta el parámetro argentinaMode.' });
  }
  
  const config = await leerConfigGlobal();
  config.argentinaMode = !!argentinaMode;
  await guardarConfigGlobal(config);
  
  res.json({ success: true, config });
}));

// ─────────────────────────────────────────────
// API CRON JOBS (VERCEL / EXTERNO)
// ─────────────────────────────────────────────

app.get('/api/cron/sync', asyncHandler(async (req, res) => {
  if (process.env.VERCEL && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado. Se requiere token de Vercel.' });
  }

  console.log('[Cron] Iniciando tarea de sincronización diaria desde endpoint HTTP...');
  try {
    await ejecutarSincronizacionDiaria();
    res.json({ success: true, message: 'Sincronización diaria completada.' });
  } catch (err) {
    console.error('[Cron] Error en sincronización diaria:', err.message);
    res.json({ success: false, error: err.message });
  }
}));

app.get('/api/cron/monitor', asyncHandler(async (req, res) => {
  if (process.env.VERCEL && req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'No autorizado. Se requiere token de Vercel.' });
  }

  console.log('[Cron] Iniciando monitoreo de partidos en tiempo real desde endpoint HTTP...');
  try {
    await ejecutarMonitoreoTiempoReal();
    res.json({ success: true, message: 'Monitoreo de tiempo real completado.' });
  } catch (err) {
    console.error('[Cron] Error en monitoreo de tiempo real:', err.message);
    res.json({ success: false, error: err.message });
  }
}));

// ─────────────────────────────────────────────
// API CHAT (LLORERÍA)
// ─────────────────────────────────────────────

app.get('/api/chat', authenticate, asyncHandler(async (req, res) => {
  const { username, escribiendo } = req.query;
  if (!username) return res.status(400).json({ error: 'Se requiere username.' });
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No autorizado.' });
  }

  const ahora = Date.now();

  if (!presenciaActiva[username]) {
    presenciaActiva[username] = {};
  }
  presenciaActiva[username].lastPing = ahora;
  if (escribiendo === 'true') {
    presenciaActiva[username].escribiendoAt = ahora;
  }

  for (const u of Object.keys(presenciaActiva)) {
    if (ahora - presenciaActiva[u].lastPing > PRESENCIA_TIMEOUT_MS) {
      delete presenciaActiva[u];
    }
  }

  const activosCount = Object.keys(presenciaActiva).length;
  const escribiendo_usuarios = Object.entries(presenciaActiva)
    .filter(([u, d]) => u !== username && d.escribiendoAt && (ahora - d.escribiendoAt) < ESCRIBIENDO_TIMEOUT_MS)
    .map(([u]) => u);

  const mensajes = await leerMensajesChat();
  const usuarios = await leerUsuarios();
  const avatars = {};
  usuarios.forEach(u => { avatars[u.username] = u.avatar_emoji || '⚽'; });

  const mensajesConAvatar = mensajes.map(m => ({
    ...m,
    avatar_emoji: avatars[m.username] || '⚽'
  }));

  const configGlobal = await leerConfigGlobal();

  res.json({
    mensajes: mensajesConAvatar,
    activosCount,
    escribiendo: escribiendo_usuarios,
    argentinaMode: !!configGlobal.argentinaMode
  });
}));

app.post('/api/chat', authenticate, asyncHandler(async (req, res) => {
  const { username, texto, replyTo } = req.body;
  if (!username || !texto || !texto.trim()) {
    return res.status(400).json({ error: 'Datos incompletos.' });
  }
  if (username !== req.authenticatedUser) {
    return res.status(403).json({ error: 'No autorizado.' });
  }
  
  const textoLimpio = texto.replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
  const ahora = new Date();
  const timestampAR = ahora.toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

  const mensaje = {
    id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    username,
    texto:     textoLimpio,
    timestamp: timestampAR,
    reply_to_id:       replyTo ? replyTo.id : '',
    reply_to_username: replyTo ? replyTo.username : '',
    reply_to_texto:    replyTo ? replyTo.texto : ''
  };

  await guardarMensajeChat(mensaje);
  res.json({ success: true, mensaje });
}));

// ─────────────────────────────────────────────
// MANEJADOR GLOBAL DE ERRORES ASYNC
// ─────────────────────────────────────────────

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: err.message || 'Error interno del servidor.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor de Prode corriendo en http://localhost:${PORT}`);
  console.log(`Modo de persistencia: ⚡ Supabase Database`);

  if (!process.env.VERCEL) {
    inicializarPlanificador();
  }
});

module.exports = app;
