// ==========================================
// ESTADO GLOBAL DE LA APLICACIÓN
// ==========================================
let currentUser = null;
let ultimoPartidoComenzadoId = null;
let ultimoPartidoComenzadoTexto = '';
let partidosAuditoria = [];
let indiceAuditoriaActual = 0;

function isAdmin(user) {
  return user && (user.username === 'admin' || user.username === 'BigM');
}

// Interceptor de fetch para inyectar token de autenticación
(function() {
  const originalFetch = window.fetch;
  window.fetch = async function(resource, options) {
    options = options || {};
    options.headers = options.headers || {};

    if (currentUser && currentUser.token && currentUser.username) {
      if (options.headers instanceof Headers) {
        options.headers.set('Authorization', `Bearer ${currentUser.token}`);
        options.headers.set('X-Session-Username', encodeURIComponent(currentUser.username));
      } else if (Array.isArray(options.headers)) {
        options.headers.push(['Authorization', `Bearer ${currentUser.token}`]);
        options.headers.push(['X-Session-Username', encodeURIComponent(currentUser.username)]);
      } else {
        options.headers['Authorization'] = `Bearer ${currentUser.token}`;
        options.headers['X-Session-Username'] = encodeURIComponent(currentUser.username);
      }
    }

    const response = await originalFetch(resource, options);

    if (response.status === 401 || response.status === 403) {
      const isAuthRoute = typeof resource === 'string' && resource.includes('/api/auth/');
      if (!isAuthRoute) {
        currentUser = null;
        localStorage.removeItem('prode_session');
        actualizarHeaderUsuario();
        navegarTab('auth');
        showToast('Tu sesión ha expirado o es inválida. Inicia sesión de nuevo.', 'error');
      }
    }

    return response;
  };
})();

let activeTab = 'auth';
let partidos = [];
let top3Predecible = true;
let prediccionTop3 = null;
let scoreboard = [];
let chartInstance = null;
let currentChartIndex = 0;
const hiddenUsernames = new Set();
let activeHomeSubFase = 'groups'; // 'groups' o 'bracket'
let activeProfileSubFase = 'groups'; // 'groups' o 'bracket'
let sortMode = 'fecha'; // 'fecha' o 'grupo'
let profileSortMode = 'fecha'; // 'fecha' o 'grupo'

const EQUIPO_A_GRUPO = {
  // Grupo A
  'México': 'A', 'Sudáfrica': 'A', 'Corea del Sur': 'A', 'República Checa': 'A',
  // Grupo B
  'Canadá': 'B', 'Bosnia y Herzegovina': 'B', 'Catar': 'B', 'Suiza': 'B',
  // Grupo C
  'Estados Unidos': 'C', 'Paraguay': 'C', 'Australia': 'C', 'Turquía': 'C',
  // Grupo D
  'Brasil': 'D', 'Marruecos': 'D', 'Haití': 'D', 'Escocia': 'D',
  // Grupo E
  'Alemania': 'E', 'Curazao': 'E', 'Costa de Marfil': 'E', 'Ecuador': 'E',
  // Grupo F
  'Países Bajos': 'F', 'Japón': 'F', 'Suecia': 'F', 'Túnez': 'F',
  // Grupo G
  'España': 'G', 'Cabo Verde': 'G', 'Arabia Saudita': 'G', 'Uruguay': 'G',
  // Grupo H
  'Bélgica': 'H', 'Egipto': 'H', 'Irán': 'H', 'Nueva Zelanda': 'H',
  // Grupo I
  'Francia': 'I', 'Senegal': 'I', 'Irak': 'I', 'Noruega': 'I',
  // Grupo J
  'Argentina': 'J', 'Argelia': 'J', 'Austria': 'J', 'Jordania': 'J',
  // Grupo K
  'Portugal': 'K', 'RD Congo': 'K', 'Uzbekistán': 'K', 'Colombia': 'K',
  // Grupo L
  'Inglaterra': 'L', 'Croacia': 'L', 'Ghana': 'L', 'Panamá': 'L'
};

// Mapa de predicciones pendientes de guardar: { partidoId: { local, visitante } }
let pendingChanges = {};

// Obtiene los inputs y círculos de ganador correctos según el contexto visual actual
function obtenerElementosPartido(partidoId) {
  if (activeTab === 'home' && activeHomeSubFase === 'bracket') {
    const parent = document.getElementById(`match-card-${partidoId}`);
    if (parent) {
      return {
        local: parent.querySelector(`#local-${partidoId}`),
        visitante: parent.querySelector(`#visitante-${partidoId}`),
        circleL: parent.querySelector(`#win-local-${partidoId}`),
        circleV: parent.querySelector(`#win-visitante-${partidoId}`)
      };
    }
  }

  const parentCard = document.getElementById(`card-${partidoId}`);
  if (parentCard) {
    return {
      local: parentCard.querySelector(`#local-${partidoId}`),
      visitante: parentCard.querySelector(`#visitante-${partidoId}`),
      circleL: parentCard.querySelector(`#win-local-${partidoId}`),
      circleV: parentCard.querySelector(`#win-visitante-${partidoId}`)
    };
  }

  return {
    local: document.getElementById(`local-${partidoId}`),
    visitante: document.getElementById(`visitante-${partidoId}`),
    circleL: document.getElementById(`win-local-${partidoId}`),
    circleV: document.getElementById(`win-visitante-${partidoId}`)
  };
}

// ==========================================
// BOTÓN FLOTANTE "GUARDAR TODO"
// ==========================================
function actualizarBotonGuardarTodo() {
  const btn = document.getElementById('btn-save-all');
  const badge = document.getElementById('save-all-count');
  const count = Object.keys(pendingChanges).length;

  if (count > 0 && currentUser) {
    badge.textContent = count;
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
}

function marcarCambioPendiente(partidoId) {
  const { local: localInput, visitante: visInput, circleL, circleV } = obtenerElementosPartido(partidoId);
  if (!localInput || !visInput) return;

  let ganador_pred = '';
  if (circleL && circleL.classList.contains('selected')) {
    ganador_pred = 'local';
  } else if (circleV && circleV.classList.contains('selected')) {
    ganador_pred = 'visitante';
  }

  pendingChanges[partidoId] = {
    local:     localInput.value,
    visitante: visInput.value,
    ganador_pred: ganador_pred
  };
  actualizarBotonGuardarTodo();
}

function limpiarCambioPendiente(partidoId) {
  delete pendingChanges[partidoId];
  actualizarBotonGuardarTodo();
}

async function guardarTodo() {
  if (!currentUser || Object.keys(pendingChanges).length === 0) return;

  // Validar primero si hay empates de mata-mata sin ganador seleccionado
  const ids = Object.keys(pendingChanges);
  for (const partidoId of ids) {
    const { local, visitante, ganador_pred } = pendingChanges[partidoId];
    const partido = partidos.find(p => p.partido_id === partidoId);
    const esKnockout = partido && partido.fase !== 'Fase de Grupos';
    if (esKnockout && local !== '' && visitante !== '' && parseInt(local, 10) === parseInt(visitante, 10) && !ganador_pred) {
      showToast('Debes seleccionar un ganador para los partidos en resolución por penales del mata-mata antes de guardar.', 'error');
      return;
    }
  }

  const btn = document.getElementById('btn-save-all');
  btn.disabled = true;
  btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> <span>Guardando...</span>`;

  let guardados = 0;
  let errores = 0;

  for (const partidoId of ids) {
    const { local, visitante, ganador_pred } = pendingChanges[partidoId];

    if (local === '' || visitante === '') {
      errores++;
      continue;
    }

    try {
      const response = await fetch('/api/predicciones/partido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:            currentUser.username,
          partido_id:          partidoId,
          goles_local_pred:    local,
          goles_visitante_pred: visitante,
          ganador_pred:        ganador_pred || '',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      delete pendingChanges[partidoId];
      guardados++;
    } catch (err) {
      errores++;
      console.error(`Error guardando ${partidoId}:`, err.message);
    }
  }

  btn.disabled = false;
  btn.innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> <span>Guardar Todo</span> <span class="save-all-badge" id="save-all-count">${Object.keys(pendingChanges).length}</span>`;

  if (guardados > 0 && errores === 0) {
    showToast(`${guardados} predicción${guardados > 1 ? 'es' : ''} guardada${guardados > 1 ? 's' : ''} correctamente.`, 'success');
  } else if (guardados > 0 && errores > 0) {
    showToast(`${guardados} guardadas, ${errores} con errores.`, 'error');
  } else {
    showToast('Completa los marcadores antes de guardar.', 'error');
  }

  actualizarBotonGuardarTodo();
  if (guardados > 0) {
    cargarPartidosYPredicciones();
    cargarScoreboardMini();
  }
}

// Emojis disponibles para el registro
const AVATAR_EMOJIS = ['⚽', '🏆', '😎', '🔥', '👑', '🦁', '⭐', '⚡', '🦉', '🍕', '🎮', '🛸', '🚀', '🔮'];

// Listado Oficial de los 48 Clasificados del Mundial 2026 (Proporcionado por el usuario)
const PAISES_MUNDIAL = [
  'Alemania', 'Arabia Saudita', 'Argelia', 'Argentina', 'Australia', 'Austria',
  'Bélgica', 'Bosnia y Herzegovina', 'Brasil', 'Cabo Verde', 'Canadá', 'Catar',
  'Colombia', 'Corea del Sur', 'Costa de Marfil', 'Croacia', 'Curazao', 'Ecuador',
  'Egipto', 'Escocia', 'España', 'Estados Unidos', 'Francia', 'Ghana', 'Haití',
  'Inglaterra', 'Irak', 'Irán', 'Japón', 'Jordania', 'Marruecos', 'México',
  'Noruega', 'Nueva Zelanda', 'Países Bajos', 'Panamá', 'Paraguay', 'Portugal',
  'RD Congo', 'República Checa', 'Senegal', 'Sudáfrica', 'Suecia', 'Suiza', 'Túnez',
  'Turquía', 'Uruguay', 'Uzbekistán'
].sort();

// Diccionario de banderas emoji para tarjetas visuales de los partidos
const BANDERA_EMOJIS = {
  'Alemania': '🇩🇪',
  'Arabia Saudita': '🇸🇦',
  'Argelia': '🇩🇿',
  'Argentina': '🇦🇷',
  'Australia': '🇦🇺',
  'Austria': '🇦🇹',
  'Bélgica': '🇧🇪',
  'Bosnia y Herzegovina': '🇧🇦',
  'Brasil': '🇧🇷',
  'Cabo Verde': '🇨🇻',
  'Canadá': '🇨🇦',
  'Catar': '🇶🇦',
  'Colombia': '🇨🇴',
  'Corea del Sur': '🇰🇷',
  'Costa de Marfil': '🇨🇮',
  'Croacia': '🇭🇷',
  'Curazao': '🇨🇼',
  'Ecuador': '🇪🇨',
  'Egipto': '🇪🇬',
  'Escocia': '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'España': '🇪🇸',
  'Estados Unidos': '🇺🇸',
  'Francia': '🇫🇷',
  'Ghana': '🇬🇭',
  'Haití': '🇭🇹',
  'Inglaterra': '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Irak': '🇮🇶',
  'Irán': '🇮🇷',
  'Japón': '🇯🇵',
  'Jordania': '🇯🇴',
  'Marruecos': '🇲🇦',
  'México': '🇲🇽',
  'Noruega': '🇳🇴',
  'Nueva Zelanda': '🇳🇿',
  'Países Bajos': '🇳🇱',
  'Panamá': '🇵🇦',
  'Paraguay': '🇵🇾',
  'Portugal': '🇵🇹',
  'RD Congo': '🇨🇩',
  'República Checa': '🇨🇿',
  'Senegal': '🇸🇳',
  'Sudáfrica': '🇿🇦',
  'Suecia': '🇸🇪',
  'Suiza': '🇨🇭',
  'Túnez': '🇹🇳',
  'Turquía': '🇹🇷',
  'Uruguay': '🇺🇾',
  'Uzbekistán': '🇺🇿'
};

function obtenerEmojiBandera(pais) {
  return BANDERA_EMOJIS[pais] || '🏳️';
}

// Abreviaciones para nombres de países largos (usadas en vista móvil)
const ABREVIACIONES_PAIS = {
  'Bosnia y Herzegovina': 'Bosnia',
  'Estados Unidos': 'EE.UU.',
  'Corea del Sur': 'Corea S.',
  'Costa de Marfil': 'C. Marfil',
  'Nueva Zelanda': 'N. Zelanda',
  'Países Bajos': 'P. Bajos',
  'Arabia Saudita': 'Ar. Saudita',
  'República Checa': 'Rep. Checa',
  'Cabo Verde': 'Cabo Verde',
  'Sudáfrica': 'Sudáfrica',
};

function abreviarPais(nombre) {
  return ABREVIACIONES_PAIS[nombre] || nombre;
}

// Códigos oficiales FIFA (3 letras) para los 48 países del Mundial 2026
const FIFA_CODES = {
  'Alemania':            'GER',
  'Arabia Saudita':      'KSA',
  'Argelia':             'ALG',
  'Argentina':           'ARG',
  'Australia':           'AUS',
  'Austria':             'AUT',
  'Bélgica':             'BEL',
  'Bosnia y Herzegovina':'BIH',
  'Brasil':              'BRA',
  'Cabo Verde':          'CPV',
  'Canadá':              'CAN',
  'Catar':               'QAT',
  'Colombia':            'COL',
  'Corea del Sur':       'KOR',
  'Costa de Marfil':     'CIV',
  'Croacia':             'CRO',
  'Curazao':             'CUW',
  'Ecuador':             'ECU',
  'Egipto':              'EGY',
  'Escocia':             'SCO',
  'España':              'ESP',
  'Estados Unidos':      'USA',
  'Francia':             'FRA',
  'Ghana':               'GHA',
  'Haití':               'HAI',
  'Inglaterra':          'ENG',
  'Irak':                'IRQ',
  'Irán':                'IRN',
  'Japón':               'JPN',
  'Jordania':            'JOR',
  'Marruecos':           'MAR',
  'México':              'MEX',
  'Noruega':             'NOR',
  'Nueva Zelanda':       'NZL',
  'Países Bajos':        'NED',
  'Panamá':              'PAN',
  'Paraguay':            'PAR',
  'Portugal':            'POR',
  'RD Congo':            'COD',
  'República Checa':     'CZE',
  'Senegal':             'SEN',
  'Sudáfrica':           'RSA',
  'Suecia':              'SWE',
  'Suiza':               'SUI',
  'Túnez':               'TUN',
  'Turquía':             'TUR',
  'Uruguay':             'URU',
  'Uzbekistán':          'UZB',
};

function codigoFIFA(nombre) {
  return FIFA_CODES[nombre] || nombre.substring(0, 3).toUpperCase();
}

// ==========================================
// UTILIDAD: FECHAS EN HORA ARGENTINA (UTC-3)
// ==========================================
function formatearFechaAR(fechaISO, opciones = {}) {
  const defaults = { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' };
  return new Date(fechaISO).toLocaleString('es-AR', { ...defaults, ...opciones });
}

function obtenerEtiquetaFecha(fechaISO) {
  const parts = formatearFechaAR(fechaISO, { weekday: 'long', day: '2-digit', month: '2-digit', hour: undefined, minute: undefined });
  return parts.charAt(0).toUpperCase() + parts.slice(1);
}

// Inicializar al cargar el documento
document.addEventListener('DOMContentLoaded', () => {
  // Prevent pinch-to-zoom on mobile devices
  document.addEventListener('touchstart', function (event) {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchmove', function (event) {
    if (event.scale !== undefined && event.scale !== 1) {
      event.preventDefault();
    }
    // Prevent scrolling page on mobile when chat is active
    if (document.body.classList.contains('chat-active')) {
      const isScrollable = event.target.closest('#chat-messages-mobile');
      if (!isScrollable) {
        event.preventDefault();
      }
    }
  }, { passive: false });

  let lastTouchEnd = 0;
  document.addEventListener('touchend', function (event) {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      const isInput = event.target.tagName === 'INPUT' || 
                      event.target.tagName === 'TEXTAREA' || 
                      event.target.tagName === 'SELECT' || 
                      event.target.closest('button') || 
                      event.target.closest('a');
      if (!isInput) {
        event.preventDefault();
      }
    }
    lastTouchEnd = now;
  }, false);

  document.addEventListener('gesturestart', function (event) {
    event.preventDefault();
  });

  inicializarAuth();
  configurarNavegacion();
  configurarFormularios();
  poblarSelectoresPaises();
  inicializarModalAvatar();
  inicializarModalUsername();
  inicializarModalPassword();

  const btnCloseFormula = document.getElementById('btn-close-formula-modal');
  if (btnCloseFormula) {
    btnCloseFormula.addEventListener('click', () => {
      document.getElementById('modal-formula-puntos').style.display = 'none';
      document.body.style.overflow = '';
    });
  }
  const modalFormula = document.getElementById('modal-formula-puntos');
  if (modalFormula) {
    modalFormula.addEventListener('click', (e) => {
      if (e.target === modalFormula) {
        modalFormula.style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  }

  const btnInfoRules = document.getElementById('btn-info-rules');
  const modalReglas = document.getElementById('modal-reglas-puntos');
  const btnCloseReglas = document.getElementById('btn-close-reglas-modal');

  if (btnInfoRules && modalReglas) {
    btnInfoRules.addEventListener('click', () => {
      modalReglas.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    });
  }

  if (btnCloseReglas && modalReglas) {
    btnCloseReglas.addEventListener('click', () => {
      modalReglas.style.display = 'none';
      document.body.style.overflow = '';
    });
  }

  if (modalReglas) {
    modalReglas.addEventListener('click', (e) => {
      if (e.target === modalReglas) {
        modalReglas.style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  }

  // Conectar el botón flotante de guardar todo
  document.getElementById('btn-save-all').addEventListener('click', guardarTodo);

  // Conectar botón volver arriba
  const btnScrollTop = document.getElementById('btn-scroll-top');
  if (btnScrollTop) {
    btnScrollTop.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Conectar botones de expandir/colapsar acordeones
  const btnToggleHome = document.getElementById('btn-toggle-accordions-home');
  if (btnToggleHome) {
    btnToggleHome.addEventListener('click', toggleAccordionsHome);
  }

  // Conectar botón global de randomizar
  const btnRandAllHome = document.getElementById('btn-randomize-all-home');
  if (btnRandAllHome) {
    btnRandAllHome.addEventListener('click', () => {
      const idsToRandomize = partidos
        .filter(p => p.partido_id.startsWith('p_') && p.predecible)
        .map(p => p.partido_id);
      randomizarPartidos(idsToRandomize);
    });
  }

  // Conectar botón Día Actual (PC y Mobile)
  const btnGoToToday = document.getElementById('btn-go-to-today');
  if (btnGoToToday) {
    btnGoToToday.addEventListener('click', irAlDiaActual);
  }
  const btnGoToTodayMobile = document.getElementById('btn-go-to-today-mobile');
  if (btnGoToTodayMobile) {
    btnGoToTodayMobile.addEventListener('click', irAlDiaActual);
  }
  const btnToggleProfile = document.getElementById('btn-toggle-accordions-profile');
  if (btnToggleProfile) {
    btnToggleProfile.addEventListener('click', toggleAccordionsProfile);
  }

  // Manejo de clicks en el gráfico de evolución para ocultar tooltip en móviles, destacar líneas y abrir auditoría
  const canvasChart = document.getElementById('evolutionChart');
  if (canvasChart) {
    canvasChart.addEventListener('click', (evt) => {
      if (!chartInstance) return;
      const points = chartInstance.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
      if (points.length === 0) {
        // No se tocó ningún punto directamente. Ocultamos el tooltip y restauramos líneas.
        chartInstance.setActiveElements([]);
        chartInstance.tooltip.setActiveElements([], { x: 0, y: 0 });
        
        if (currentChartIndex === 0) {
          chartInstance.data.datasets.forEach(ds => {
            ds.borderWidth = 3;
            if (ds.borderColor.endsWith('33') || ds.borderColor.endsWith('22')) {
              ds.borderColor = ds.borderColor.substring(0, 7);
            }
          });
        }
        chartInstance.update();
      } else {
        const firstPoint = points[0];
        const datasetIndex = firstPoint.datasetIndex;
        const index = firstPoint.index;
        
        // 1. Destacar la línea del usuario seleccionado (si estamos en el gráfico de línea, índice 0)
        if (currentChartIndex === 0) {
          chartInstance.data.datasets.forEach((ds, idx) => {
            if (idx === datasetIndex) {
              ds.borderWidth = 5;
              ds.borderColor = ds.borderColor.substring(0, 7); // opacidad completa
            } else {
              ds.borderWidth = 1.5;
              if (ds.borderColor.length === 7) {
                ds.borderColor = ds.borderColor + '33'; // opacidad baja (20%)
              }
            }
          });
          chartInstance.update();
        }
        
        // 2. Abrir la auditoría del partido correspondiente si index > 0
        if (index > 0 && partidos && partidos.length > 0) {
          const partidosFinalizados = partidos
            .filter(p => p.finalizado)
            .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));
            
          if (index - 1 < partidosFinalizados.length) {
            const partido = partidosFinalizados[index - 1];
            const localEmoji = obtenerEmojiBandera(partido.equipo_local);
            const visEmoji = obtenerEmojiBandera(partido.equipo_visitante);
            const tituloAudit = `${partido.fase}: ${localEmoji} ${partido.equipo_local} ${partido.goles_local_real} - ${partido.goles_visitante_real} ${partido.equipo_visitante} ${visEmoji}`;
            
            ultimoPartidoComenzadoId = partido.partido_id;
            ultimoPartidoComenzadoTexto = tituloAudit;
            
            const container = document.getElementById('scoreboard-main-card-container');
            if (container) {
              if (!container.classList.contains('flipped')) {
                const btnShow = document.getElementById('btn-show-scoreboard-audit');
                if (btnShow) btnShow.click();
              } else {
                const subtitleText = document.getElementById('audit-match-subtitle');
                if (subtitleText) {
                  subtitleText.textContent = ultimoPartidoComenzadoTexto;
                }
                const tbody = document.getElementById('scoreboard-audit-body');
                if (tbody) {
                  tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-sub); padding: 2rem;">Cargando auditoría...</td></tr>';
                  cargarAuditoriaPartido(ultimoPartidoComenzadoId, tbody);
                }
              }
              container.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
          }
        }
      }
    });
  }


  // Conectar botones de Zoom
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnResetZoom = document.getElementById('btn-reset-zoom');

  if (btnZoomIn) {
    btnZoomIn.addEventListener('click', () => {
      if (chartInstance && typeof chartInstance.zoom === 'function') {
        chartInstance.zoom(1.15);
        if (btnResetZoom) btnResetZoom.style.display = 'flex';
        actualizarBotonesZoomState(chartInstance);
      }
    });
  }

  if (btnZoomOut) {
    btnZoomOut.addEventListener('click', () => {
      if (chartInstance && typeof chartInstance.zoom === 'function') {
        chartInstance.zoom(0.85);
        if (btnResetZoom) btnResetZoom.style.display = 'flex';
        actualizarBotonesZoomState(chartInstance);
      }
    });
  }

  if (btnResetZoom) {
    btnResetZoom.addEventListener('click', () => {
      if (chartInstance) {
        if (typeof chartInstance.resetZoom === 'function') {
          chartInstance.resetZoom();
        }
        const mL = chartInstance.maxLen;
        const mS = chartInstance.maxScore;
        if (mL) {
          chartInstance.options.scales.x.min = -0.8;
          chartInstance.options.scales.x.max = mL - 0.7;
        }
        chartInstance.options.scales.y.min = -1;
        chartInstance.options.scales.y.max = mS ? mS + 3 : undefined;
        chartInstance.update();
        actualizarBotonesZoomState(chartInstance);
      }
      btnResetZoom.style.display = 'none';
    });
  }

  // Ocultar tooltip si se toca cualquier otro lado fuera del canvas
  document.addEventListener('click', (evt) => {
    if (!chartInstance) return;
    const canvas = document.getElementById('evolutionChart');
    if (canvas && !canvas.contains(evt.target)) {
      chartInstance.setActiveElements([]);
      chartInstance.tooltip.setActiveElements([], { x: 0, y: 0 });
      
      if (currentChartIndex === 0) {
        chartInstance.data.datasets.forEach(ds => {
          ds.borderWidth = 3;
          if (ds.borderColor.endsWith('33') || ds.borderColor.endsWith('22')) {
            ds.borderColor = ds.borderColor.substring(0, 7);
          }
        });
      }
      chartInstance.update();
    }
  });

  // Si hay sesión guardada en localStorage, iniciar sesión
  const sesion = localStorage.getItem('prode_session');
  if (sesion) {
    currentUser = JSON.parse(sesion);
    if (!currentUser || !currentUser.token) {
      currentUser = null;
      localStorage.removeItem('prode_session');
      setTimeout(() => {
        showToast('Se ha actualizado la seguridad del sistema. Por favor, inicia sesión de nuevo.', 'info');
      }, 500);
      navegarTab('auth');
    } else {
      actualizarHeaderUsuario();
      navegarTab('home');
      inicializarChat();
    }
  } else {
    navegarTab('auth');
  }

  // Delegated event listeners for scoreboard profile views
  const miniBody = document.getElementById('mini-scoreboard-body');
  if (miniBody) {
    miniBody.addEventListener('click', (e) => {
      const target = e.target.closest('.clickable-profile');
      if (target) {
        const username = target.getAttribute('data-username');
        if (username) verPerfil(username);
      }
    });
  }

  const fullBody = document.getElementById('full-scoreboard-body');
  if (fullBody) {
    fullBody.addEventListener('click', (e) => {
      const target = e.target.closest('.clickable-profile');
      if (target) {
        const username = target.getAttribute('data-username');
        if (username) verPerfil(username);
      }
    });
  }

  // Redibujar conectores del árbol de llaves en redimensión
  window.addEventListener('resize', () => {
    if (activeTab === 'home' && activeHomeSubFase === 'bracket') {
      dibujarConectoresBracket('bracket-tree');
    }
    if (activeTab === 'profile' && activeProfileSubFase === 'bracket') {
      dibujarConectoresBracket('profile-bracket-tree');
    }
  });



  // Inicializar Modo Argentina
  inicializarModoArgentina();
});

// ==========================================
// NOTIFICACIONES (TOASTS)
// ==========================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'success') icon = 'fa-circle-check';
  if (type === 'error') icon = 'fa-circle-exclamation';
  if (type === 'randomize') icon = 'fa-dice';
  if (type === 'lila') icon = 'fa-fire';
  
  const isLilaTheme = type === 'randomize' || type === 'lila';
  toast.innerHTML = `<i class="fa-solid ${icon}" ${isLilaTheme ? 'style="color:#a78bfa;"' : ''}></i> <span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'slideIn 0.3s ease reverse forwards';
    setTimeout(() => {
      toast.remove();
      if (type === 'randomize') {
        showToast('FUAAAAA!! ESTAS RE PICANTE!!!', 'lila');
      }
    }, 300);
  }, 4000);
}

// ==========================================
// SEEDING DE PAISES EN SELECTORES (SIN EMOS/DIMINUTIVOS)
// ==========================================
function poblarSelectoresPaises() {
  const selectores = document.querySelectorAll('.select-pais');
  
  selectores.forEach(select => {
    const isRequired = select.hasAttribute('required');
    select.innerHTML = isRequired ? '' : '<option value="">-- Elige un País --</option>';
    
    PAISES_MUNDIAL.forEach(pais => {
      const opt = document.createElement('option');
      opt.value = pais;
      opt.textContent = pais; // Solo el nombre del país (sin banderas ni códigos)
      select.appendChild(opt);
    });
  });

  // Selector específico de Admin para crear/modificar partido
  const adminEqLocal = document.getElementById('admin-eq-local');
  const adminEqVis = document.getElementById('admin-eq-vis');
  
  const optionsHTML = PAISES_MUNDIAL.map(pais => 
    `<option value="${pais}">${pais}</option>`
  ).join('');

  // Permitir también placeholders descriptivos en administración de llaves
  const placeholdersHTML = `
    <option value="1A">1° Grupo A</option>
    <option value="2A">2° Grupo A</option>
    <option value="1B">1° Grupo B</option>
    <option value="2B">2° Grupo B</option>
    <option value="1C">1° Grupo C</option>
    <option value="2C">2° Grupo C</option>
    <option value="1D">1° Grupo D</option>
    <option value="2D">2° Grupo D</option>
    <option value="1E">1° Grupo E</option>
    <option value="2E">2° Grupo E</option>
    <option value="1F">1° Grupo F</option>
    <option value="2F">2° Grupo F</option>
    <option value="1G">1° Grupo G</option>
    <option value="2G">2° Grupo G</option>
    <option value="1H">1° Grupo H</option>
    <option value="2H">2° Grupo H</option>
    <option value="1I">1° Grupo I</option>
    <option value="2I">2° Grupo I</option>
    <option value="1J">1° Grupo J</option>
    <option value="2J">2° Grupo J</option>
    <option value="1K">1° Grupo K</option>
    <option value="2K">2° Grupo K</option>
    <option value="1L">1° Grupo L</option>
    <option value="2L">2° Grupo L</option>
    <option value="Ganador R32 1">Ganador R32 1</option>
    <option value="Ganador R32 2">Ganador R32 2</option>
    <option value="Ganador R32 3">Ganador R32 3</option>
    <option value="Ganador R32 4">Ganador R32 4</option>
    <option value="Ganador R32 5">Ganador R32 5</option>
    <option value="Ganador R32 6">Ganador R32 6</option>
    <option value="Ganador R32 7">Ganador R32 7</option>
    <option value="Ganador R32 8">Ganador R32 8</option>
    <option value="Ganador R32 9">Ganador R32 9</option>
    <option value="Ganador R32 10">Ganador R32 10</option>
    <option value="Ganador R32 11">Ganador R32 11</option>
    <option value="Ganador R32 12">Ganador R32 12</option>
    <option value="Ganador R32 13">Ganador R32 13</option>
    <option value="Ganador R32 14">Ganador R32 14</option>
    <option value="Ganador R32 15">Ganador R32 15</option>
    <option value="Ganador R32 16">Ganador R32 16</option>
    <option value="Ganador Octavos 1">Ganador Octavos 1</option>
    <option value="Ganador Octavos 2">Ganador Octavos 2</option>
    <option value="Ganador Octavos 3">Ganador Octavos 3</option>
    <option value="Ganador Octavos 4">Ganador Octavos 4</option>
    <option value="Ganador Octavos 5">Ganador Octavos 5</option>
    <option value="Ganador Octavos 6">Ganador Octavos 6</option>
    <option value="Ganador Octavos 7">Ganador Octavos 7</option>
    <option value="Ganador Octavos 8">Ganador Octavos 8</option>
    <option value="Ganador Cuartos 1">Ganador Cuartos 1</option>
    <option value="Ganador Cuartos 2">Ganador Cuartos 2</option>
    <option value="Ganador Cuartos 3">Ganador Cuartos 3</option>
    <option value="Ganador Cuartos 4">Ganador Cuartos 4</option>
    <option value="Ganador Semis 1">Ganador Semis 1</option>
    <option value="Ganador Semis 2">Ganador Semis 2</option>
    <option value="Perdedor Semis 1">Perdedor Semis 1</option>
    <option value="Perdedor Semis 2">Perdedor Semis 2</option>
  `;

  if (adminEqLocal && adminEqVis) {
    adminEqLocal.innerHTML = '<option value="">-- Local --</option>' + optionsHTML + placeholdersHTML;
    adminEqVis.innerHTML = '<option value="">-- Visitante --</option>' + optionsHTML + placeholdersHTML;
  }
}

// ==========================================
// AUTENTICACIÓN
// ==========================================
function inicializarAuth() {
  const emojiGrid = document.getElementById('register-emoji-grid');
  if (emojiGrid) {
    emojiGrid.innerHTML = '';
    AVATAR_EMOJIS.forEach((emoji, index) => {
      const item = document.createElement('div');
      item.className = 'emoji-item' + (index === 0 ? ' selected' : '');
      item.textContent = emoji;
      item.addEventListener('click', () => {
        document.querySelectorAll('.emoji-item').forEach(el => el.classList.remove('selected'));
        item.classList.add('selected');
        document.getElementById('register-avatar-emoji').value = emoji;
      });
      emojiGrid.appendChild(item);
    });
  }

  const tabLogin = document.getElementById('btn-tab-login');
  const tabRegister = document.getElementById('btn-tab-register');
  const formLogin = document.getElementById('form-login');
  const formRegister = document.getElementById('form-register');

  if (tabLogin && tabRegister && formLogin && formRegister) {
    tabLogin.addEventListener('click', () => {
      tabLogin.classList.add('active');
      tabRegister.classList.remove('active');
      formLogin.classList.add('active');
      formRegister.classList.remove('active');
    });

    tabRegister.addEventListener('click', () => {
      tabRegister.classList.add('active');
      tabLogin.classList.remove('active');
      formRegister.classList.add('active');
      formLogin.classList.remove('active');
    });
  }
}

function configurarFormularios() {
  // Submit Login
  document.getElementById('form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error al iniciar sesión');
      
      currentUser = data;
      localStorage.setItem('prode_session', JSON.stringify(currentUser));
      actualizarHeaderUsuario();
      showToast(`¡Bienvenido, ${currentUser.username}!`, 'success');
      navegarTab('home');
      inicializarChat();
      
      e.target.reset();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  // Submit Registro (si existe en el DOM)
  const formRegister = document.getElementById('form-register');
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('register-username').value;
      const password = document.getElementById('register-password').value;
      const confirmPassword = document.getElementById('register-confirm').value;
      const avatar_emoji = document.getElementById('register-avatar-emoji').value;
      
      if (password !== confirmPassword) {
        showToast('Las contraseñas no coinciden.', 'error');
        return;
      }
      
      if (password.length < 4) {
        showToast('La contraseña debe tener al menos 4 caracteres.', 'error');
        return;
      }

      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password, avatar_emoji })
        });
        
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Error al registrarse');
        
        currentUser = data;
        localStorage.setItem('prode_session', JSON.stringify(currentUser));
        actualizarHeaderUsuario();
        showToast('¡Registro exitoso!', 'success');
        navegarTab('home');
        inicializarChat();
        
        e.target.reset();
        document.getElementById('btn-tab-login').click();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  // Cambios en inputs de Top 3 para mostrar/ocultar el botón de guardar
  const onChangeTop3 = () => evaluarVisibilidadBotonTop3();
  document.getElementById('top3-p1').addEventListener('change', onChangeTop3);
  document.getElementById('top3-p2').addEventListener('change', onChangeTop3);
  document.getElementById('top3-p3').addEventListener('change', onChangeTop3);

  // Colapsar/Expandir la caja de Top 3 al hacer click en el header
  const top3Header = document.getElementById('top3-toggle-header');
  const top3Box = document.getElementById('top3-box');
  if (top3Header && top3Box) {
    top3Header.addEventListener('click', () => {
      // Si está colapsado, simplemente lo expandimos
      if (top3Box.classList.contains('collapsed')) {
        top3Box.classList.remove('collapsed');
      } else {
        // Si está abierto, solo colapsar si no hay cambios sin guardar
        const p1 = document.getElementById('top3-p1');
        const p2 = document.getElementById('top3-p2');
        const p3 = document.getElementById('top3-p3');
        if (p1 && p2 && p3) {
          const val1 = p1.value;
          const val2 = p2.value;
          const val3 = p3.value;
          const saved1 = prediccionTop3 ? (prediccionTop3.puesto_1 || '') : '';
          const saved2 = prediccionTop3 ? (prediccionTop3.puesto_2 || '') : '';
          const saved3 = prediccionTop3 ? (prediccionTop3.puesto_3 || '') : '';
          const haCambiado = val1 !== saved1 || val2 !== saved2 || val3 !== saved3;

          if (!haCambiado) {
            top3Box.classList.add('collapsed');
          } else {
            showToast('Tenés cambios sin guardar en el podio. Guardalos o revertilos antes de colapsar.', 'warning');
          }
        } else {
          top3Box.classList.add('collapsed');
        }
      }
    });
  }

  // Guardar Top 3
  document.getElementById('btn-save-top3').addEventListener('click', async () => {
    if (!currentUser) return;
    
    const puesto_1 = document.getElementById('top3-p1').value;
    const puesto_2 = document.getElementById('top3-p2').value;
    const puesto_3 = document.getElementById('top3-p3').value;

    if (!puesto_1 || !puesto_2 || !puesto_3) {
      showToast('Por favor, selecciona los 3 países del podio.', 'error');
      return;
    }

    try {
      const response = await fetch('/api/predicciones/top3', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          puesto_1,
          puesto_2,
          puesto_3
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      showToast(data.message, 'success');
      cargarPartidosYPredicciones();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });

  // Guardar/Modificar Partido Admin
  const formAdminPartido = document.getElementById('form-admin-partido');
  if (formAdminPartido) {
    formAdminPartido.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin(currentUser)) return;

      const partido_id = document.getElementById('admin-partido-id').value;
      const fase = document.getElementById('admin-fase').value;
      const equipo_local = document.getElementById('admin-eq-local').value;
      const equipo_visitante = document.getElementById('admin-eq-vis').value;
      const fecha_inicio = new Date(document.getElementById('admin-fecha').value).toISOString();
      const goles_local_real = document.getElementById('admin-goles-local').value;
      const goles_visitante_real = document.getElementById('admin-goles-vis').value;
      const finalizado = document.getElementById('admin-finalizado').checked;
      const ganador_real = document.getElementById('admin-ganador-real').value;

      try {
        const response = await fetch('/api/admin/partido', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester: 'admin',
            partido_id: partido_id === 'new' ? 'p_' + Date.now() : partido_id,
            fase,
            equipo_local,
            equipo_visitante,
            fecha_inicio,
            goles_local_real,
            goles_visitante_real,
            finalizado,
            ganador_real
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        showToast('Partido/Resultado guardado correctamente.', 'success');
        e.target.reset();
        cargarPartidosYPredicciones();
        cargarAdminConfig();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }

  // Guardar Podio Real Admin
  const formAdminTop3 = document.getElementById('form-admin-top3');
  if (formAdminTop3) {
    formAdminTop3.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!isAdmin(currentUser)) return;

      const puesto_1 = document.getElementById('admin-top3-p1').value;
      const puesto_2 = document.getElementById('admin-top3-p2').value;
      const puesto_3 = document.getElementById('admin-top3-p3').value;

      try {
        const response = await fetch('/api/admin/top3', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requester: 'admin',
            puesto_1,
            puesto_2,
            puesto_3
          })
        });

        const data = await response.json();
        if (!response.ok) throw new Error(data.error);

        showToast('Podio real guardado. Puntos actualizados.', 'success');
        cargarPartidosYPredicciones();
      } catch (error) {
        showToast(error.message, 'error');
      }
    });
  }
}

function actualizarHeaderUsuario() {
  const widget = document.getElementById('user-status-widget');
  if (currentUser) {
    widget.innerHTML = `
      <div class="logged-user-info">
        <span class="user-avatar-emoji">${currentUser.avatar_emoji}</span>
        <span class="user-name-text">${escapeHtml(currentUser.username)}</span>
        <button class="btn-logout" id="btn-logout" title="Cerrar Sesión"><i class="fa-solid fa-right-from-bracket"></i></button>
      </div>
    `;
    document.getElementById('btn-logout').addEventListener('click', cerrarSesion);
  } else {
    widget.innerHTML = `
      <button class="btn-primary" onclick="navegarTab('auth')">Iniciar Sesión <i class="fa-solid fa-user"></i></button>
    `;
  }
  actualizarBarraNavegacion();
  actualizarBarraNavegacionMovil();
}

function cerrarSesion() {
  currentUser = null;
  localStorage.removeItem('prode_session');
  actualizarHeaderUsuario();
  showToast('Has cerrado sesión.', 'info');
  navegarTab('auth');
}

// ==========================================
// RUTEADOR SPA
// ==========================================
function configurarNavegacion() {
  // Filtros de fase de grupos
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(el => el.classList.remove('active'));
      btn.classList.add('active');
      renderizarPartidos(btn.dataset.filter);
    });
  });

  document.getElementById('btn-go-scoreboard').addEventListener('click', () => {
    navegarTab('scoreboard');
  });

  // Alternadores de Grupos / Llaves (Panel de Juego)
  document.getElementById('btn-toggle-groups').addEventListener('click', () => {
    activeHomeSubFase = 'groups';
    document.getElementById('btn-toggle-groups').classList.add('active');
    document.getElementById('btn-toggle-bracket').classList.remove('active');
    document.getElementById('groups-container').style.display = 'block';
    document.getElementById('bracket-container').style.display = 'none';
    document.querySelector('.home-layout').classList.remove('bracket-view-active');
    actualizarVisibilidadPillHoy();
  });

  document.getElementById('btn-toggle-bracket').addEventListener('click', () => {
    activeHomeSubFase = 'bracket';
    document.getElementById('btn-toggle-bracket').classList.add('active');
    document.getElementById('btn-toggle-groups').classList.remove('active');
    document.getElementById('groups-container').style.display = 'none';
    document.getElementById('bracket-container').style.display = 'block';
    document.querySelector('.home-layout').classList.add('bracket-view-active');
    renderizarBracket();
    actualizarVisibilidadPillHoy();
  });

  // Ordenamiento de partidos (Fase de Grupos - Vista Home)
  document.getElementById('btn-sort-fecha').addEventListener('click', () => {
    sortMode = 'fecha';
    document.getElementById('btn-sort-fecha').classList.add('active');
    document.getElementById('btn-sort-grupo').classList.remove('active');
    const activeFilter = document.querySelector('.filters .filter-btn.active')?.dataset.filter || 'todos';
    renderizarPartidos(activeFilter);
  });

  document.getElementById('btn-sort-grupo').addEventListener('click', () => {
    sortMode = 'grupo';
    document.getElementById('btn-sort-grupo').classList.add('active');
    document.getElementById('btn-sort-fecha').classList.remove('active');
    const activeFilter = document.querySelector('.filters .filter-btn.active')?.dataset.filter || 'todos';
    renderizarPartidos(activeFilter);
  });

  // Carga dinámica en Admin
  const adminPartidoId = document.getElementById('admin-partido-id');
  if (adminPartidoId) {
    adminPartidoId.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val === 'new') {
        document.getElementById('form-admin-partido').reset();
        document.getElementById('admin-partido-id').value = 'new';
        // Restore the current fase selection for filtering
        poblarSelectoresPaises();
        actualizarGanadorRealAdmin();
      } else {
        const part = partidos.find(p => p.partido_id === val);
        if (part) {
          document.getElementById('admin-fase').value = part.fase;
          document.getElementById('admin-eq-local').value = part.equipo_local;
          document.getElementById('admin-eq-vis').value = part.equipo_visitante;
          
          const date = new Date(part.fecha_inicio);
          date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
          document.getElementById('admin-fecha').value = date.toISOString().slice(0, 16);
          
          document.getElementById('admin-goles-local').value = part.goles_local_real !== null ? part.goles_local_real : '';
          document.getElementById('admin-goles-vis').value = part.goles_visitante_real !== null ? part.goles_visitante_real : '';
          document.getElementById('admin-finalizado').checked = part.finalizado;
          
          const selectorGanador = document.getElementById('admin-ganador-real');
          if (selectorGanador) {
            selectorGanador.value = part.ganador_real || '';
          }
          actualizarGanadorRealAdmin();
        }
      }
    });
  }

  // Filtrado de partidos por fase en Admin
  const adminFaseSelect = document.getElementById('admin-fase');
  if (adminFaseSelect) {
    adminFaseSelect.addEventListener('change', () => {
      actualizarComboPartidosAdmin();
      // Reset form fields when changing phase (except fase itself)
      const faseActual = adminFaseSelect.value;
      document.getElementById('admin-partido-id').value = 'new';
      document.getElementById('admin-eq-local').value = '';
      document.getElementById('admin-eq-vis').value = '';
      document.getElementById('admin-fecha').value = '';
      document.getElementById('admin-goles-local').value = '';
      document.getElementById('admin-goles-vis').value = '';
      document.getElementById('admin-finalizado').checked = false;
      actualizarGanadorRealAdmin();
    });
  }

  // Event listeners para actualizar visibilidad del ganador real en admin
  const adminGolesLoc = document.getElementById('admin-goles-local');
  const adminGolesVis = document.getElementById('admin-goles-vis');
  if (adminGolesLoc && adminGolesVis) {
    const onAdminGolesChange = () => actualizarGanadorRealAdmin();
    adminGolesLoc.addEventListener('input', onAdminGolesChange);
    adminGolesVis.addEventListener('input', onAdminGolesChange);
  }

  // Carrusel de gráficos en Positions
  const btnChartPrev = document.getElementById('btn-chart-prev');
  const btnChartNext = document.getElementById('btn-chart-next');
  if (btnChartPrev) {
    btnChartPrev.addEventListener('click', () => {
      currentChartIndex = (currentChartIndex - 1 + 3) % 3;
      renderizarGraficoEvolucion();
    });
  }
  if (btnChartNext) {
    btnChartNext.addEventListener('click', () => {
      currentChartIndex = (currentChartIndex + 1) % 3;
      renderizarGraficoEvolucion();
    });
  }
}

function actualizarBarraNavegacion() {
  const nav = document.getElementById('main-nav');
  nav.innerHTML = '';
  
  if (!currentUser) return;

  nav.appendChild(crearNavLink('home', 'fa-house', 'Panel de Juego'));
  nav.appendChild(crearNavLink('scoreboard', 'fa-ranking-star', 'Posiciones'));
  nav.appendChild(crearNavLink('profile', 'fa-user', 'Mi Perfil', () => verPerfil(currentUser.username)));
  // Agregamos Llorería (se ocultará en CSS para Desktop, visible en Tablet)
  const chatLink = crearNavLink('chat', 'fa-comments', 'Llorería');
  chatLink.classList.add('nav-link-lloreria');
  nav.appendChild(chatLink);

  if (isAdmin(currentUser)) {
    nav.appendChild(crearNavLink('admin', 'fa-user-gear', 'Administrador'));
  }
}

function crearNavLink(tabId, iconClass, label, customAction = null) {
  const a = document.createElement('a');
  a.className = `nav-link ${activeTab === tabId ? 'active' : ''}`;
  a.innerHTML = `<i class="fa-solid ${iconClass}"></i> <span>${label}</span>`;
  a.addEventListener('click', () => {
    if (customAction) customAction();
    else navegarTab(tabId);
  });
  return a;
}

// Actualiza la barra de navegación táctil inferior (mobile bottom nav)
function actualizarBarraNavegacionMovil() {
  const nav = document.getElementById('mobile-bottom-nav');
  nav.innerHTML = '';
  
  if (!currentUser) return;

  nav.appendChild(crearMobileNavLink('home', 'fa-house', 'Juego'));
  nav.appendChild(crearMobileNavLink('scoreboard', 'fa-ranking-star', 'Posiciones'));
  nav.appendChild(crearMobileNavLink('profile', 'fa-user', 'Perfil', () => verPerfil(currentUser.username)));

  if (isAdmin(currentUser)) {
    nav.appendChild(crearMobileNavLink('admin', 'fa-user-gear', 'Admin'));
  }

  // Chat Button para Mobile (reemplazando el botón de Salir)
  const chatBtn = document.createElement('a');
  chatBtn.className = `mobile-nav-link mobile-nav-link-lloreria ${activeTab === 'chat' ? 'active' : ''}`;
  chatBtn.innerHTML = `<i class="fa-solid fa-comments"></i><span>Llorería</span>`;
  chatBtn.addEventListener('click', () => navegarTab('chat'));
  nav.appendChild(chatBtn);
}

function crearMobileNavLink(tabId, iconClass, label, customAction = null) {
  const a = document.createElement('a');
  a.className = `mobile-nav-link ${activeTab === tabId ? 'active' : ''}`;
  a.innerHTML = `<i class="fa-solid ${iconClass}"></i><span>${label}</span>`;
  a.addEventListener('click', () => {
    if (customAction) customAction();
    else navegarTab(tabId);
  });
  return a;
}

function marcarChatComoNoLeido() {
  const chatLink = document.querySelector('.nav-link-lloreria');
  const chatMobLink = document.querySelector('.mobile-nav-link-lloreria');
  if (chatLink) chatLink.classList.add('unread-dot');
  if (chatMobLink) chatMobLink.classList.add('unread-dot');
}

function marcarChatComoLeido() {
  const chatLink = document.querySelector('.nav-link-lloreria');
  const chatMobLink = document.querySelector('.mobile-nav-link-lloreria');
  if (chatLink) chatLink.classList.remove('unread-dot');
  if (chatMobLink) chatMobLink.classList.remove('unread-dot');
}

function marcarComoLeidoActual() {
  if (!currentUser) return;
  const isViewingChat = activeTab === 'chat' || (activeTab === 'home' && window.innerWidth > 1024);
  if (isViewingChat) {
    marcarChatComoLeido();
    const wallId = (activeTab === 'chat') ? 'chat-messages-mobile' : 'chat-messages-desktop';
    const lastRendered = chatState.lastRenderedMsgs[wallId];
    if (lastRendered) {
      try {
        const msgs = JSON.parse(lastRendered);
        if (msgs && msgs.length > 0) {
          localStorage.setItem('chat_last_read_id', msgs[msgs.length - 1].id);
        }
      } catch (_) {}
    }
  }
}

function navegarTab(tabId) {
  activeTab = tabId;
  
  const iconMap = {
    home: 'fa-house',
    scoreboard: 'fa-ranking-star',
    profile: 'fa-user',
    admin: 'fa-user-gear',
    chat: 'fa-comments'
  };
  const expectedIcon = iconMap[tabId] || 'fa-user';

  // Sincronizar clases activas en Navbar superior
  document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
  const currentLink = Array.from(document.querySelectorAll('.nav-link')).find(link => 
    link.innerHTML.includes(expectedIcon)
  );
  if (currentLink) currentLink.classList.add('active');

  // Sincronizar clases activas en Navbar inferior móvil
  document.querySelectorAll('.mobile-nav-link').forEach(link => link.classList.remove('active'));
  const currentMobLink = Array.from(document.querySelectorAll('.mobile-nav-link')).find(link => 
    link.innerHTML.includes(expectedIcon)
  );
  if (currentMobLink) currentMobLink.classList.add('active');

  // Alternar vistas
  document.querySelectorAll('.tab-view').forEach(view => view.classList.remove('active'));
  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) targetView.classList.add('active');

  // Aplicar clase al body si es el chat para ocultar el scroll/footer
  if (tabId === 'chat') {
    document.body.classList.add('chat-active');
    document.documentElement.classList.add('chat-active');
    ajustarAlturaChatMovil();
    
    // Forzar scroll al fondo cuando el chat móvil se hace visible
    setTimeout(() => {
      const wall = document.getElementById('chat-messages-mobile');
      if (wall) {
        wall.scrollTop = wall.scrollHeight;
      }
    }, 50);
  } else {
    document.body.classList.remove('chat-active');
    document.documentElement.classList.remove('chat-active');
    ajustarAlturaChatMovil();
  }

  if (tabId === 'home') {
    // Forzar scroll al fondo cuando el chat de escritorio se hace visible
    setTimeout(() => {
      const wall = document.getElementById('chat-messages-desktop');
      if (wall) {
        wall.scrollTop = wall.scrollHeight;
      }
    }, 50);
  }

  if (tabId === 'scoreboard') {
    setTimeout(() => {
      const el = document.getElementById('scoreboard-main-card-container');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 150);
  }

  if (tabId === 'profile') {
    window.scrollTo(0, 0);
  }

  marcarComoLeidoActual();

  // Hacer un poll inmediato para actualizar mensajes y forzar scroll si corresponde
  if (tabId === 'chat' || tabId === 'home') {
    chatPollAmbos(true);
  }

  // Cargar datos
  if (tabId === 'home') {
    cargarPartidosYPredicciones();
    cargarScoreboardMini();
  } else if (tabId === 'scoreboard') {
    cargarScoreboardCompleto();
  } else if (tabId === 'admin') {
    cargarAdminConfig();
  }

  actualizarVisibilidadPillHoy();
}

// ==========================================
// CONTROLADOR HOME Y PREDICCIONES
// ==========================================
async function cargarPartidosYPredicciones() {
  if (!currentUser) return;
  try {
    const response = await fetch(`/api/partidos?username=${currentUser.username}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    partidos = data.partidos;
    top3Predecible = data.top3_predecible;
    prediccionTop3 = data.prediccion_top3;

    // Limpiar cambios pendientes al recargar predicciones
    pendingChanges = {};
    actualizarBotonGuardarTodo();

    renderizarTop3();
    renderizarPartidos('todos');

    if (activeHomeSubFase === 'bracket') {
      renderizarBracket();
    }
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function renderizarTop3() {
  const badge = document.getElementById('top3-lock-status');
  const p1 = document.getElementById('top3-p1');
  const p2 = document.getElementById('top3-p2');
  const p3 = document.getElementById('top3-p3');
  const btn = document.getElementById('btn-save-top3');

  if (prediccionTop3) {
    p1.value = prediccionTop3.puesto_1 || '';
    p2.value = prediccionTop3.puesto_2 || '';
    p3.value = prediccionTop3.puesto_3 || '';
  } else {
    p1.value = '';
    p2.value = '';
    p3.value = '';
  }

  // Si ya tiene predicción completa del top 3, colapsar por defecto
  const box = document.getElementById('top3-box');
  if (box) {
    const yaHecha = prediccionTop3 && prediccionTop3.puesto_1 && prediccionTop3.puesto_2 && prediccionTop3.puesto_3;
    if (yaHecha) {
      box.classList.add('collapsed');
    } else {
      box.classList.remove('collapsed');
    }
  }

  if (top3Predecible) {
    badge.className = 'badge-status open';
    badge.textContent = 'Abierto';
    p1.disabled = false;
    p2.disabled = false;
    p3.disabled = false;
    evaluarVisibilidadBotonTop3();
  } else {
    badge.className = 'badge-status locked';
    badge.textContent = 'Cerrado';
    p1.disabled = true;
    p2.disabled = true;
    p3.disabled = true;
    btn.style.display = 'none';
  }
}

function renderizarPartidos(filtro = 'todos') {
  const container = document.getElementById('lista-partidos');
  container.innerHTML = '';
  
  if (typeof actualizarTextoBotonAcordeon === 'function') {
    actualizarTextoBotonAcordeon('btn-toggle-accordions-home', true);
  }

  // Encontrar el último partido bloqueado (el más reciente que ya comenzó y tiene pálpito con votos)
  let ultimoPartidoBloqueadoId = null;
  let maxFechaInicioBloqueada = 0;
  partidos.forEach(p => {
    if (!p.predecible && p.palpito && p.palpito.total_votos > 0) {
      const time = new Date(p.fecha_inicio).getTime();
      if (time > maxFechaInicioBloqueada) {
        maxFechaInicioBloqueada = time;
        ultimoPartidoBloqueadoId = p.partido_id;
      }
    }
  });

  // Actualizar estado habilitado/deshabilitado del botón global
  const btnRandAllHome = document.getElementById('btn-randomize-all-home');
  if (btnRandAllHome) {
    const allGlobalDisabled = partidos
      .filter(p => p.partido_id.startsWith('p_'))
      .every(p => !p.predecible);
    btnRandAllHome.disabled = allGlobalDisabled;
  }

  // Filtrar solo los partidos de grupo para esta sección (ID empieza con 'p_')
  let partidosFiltrados = partidos.filter(p => p.partido_id.startsWith('p_'));

  if (filtro === 'predecibles') {
    partidosFiltrados = partidosFiltrados.filter(p => p.predecible && !p.finalizado);
  } else if (filtro === 'finalizados') {
    partidosFiltrados = partidosFiltrados.filter(p => p.finalizado);
  }

  if (partidosFiltrados.length === 0) {
    container.innerHTML = `<div class="privacy-note text-center"><i class="fa-solid fa-circle-exclamation"></i> No hay partidos de grupo para mostrar.</div>`;
    return;
  }

  const grouped = {};

  if (sortMode === 'fecha') {
    partidosFiltrados.forEach(p => {
      const label = obtenerEtiquetaFecha(p.fecha_inicio);
      if (!grouped[label]) {
        grouped[label] = {
          label: label,
          timestamp: new Date(p.fecha_inicio).getTime(),
          partidos: []
        };
      }
      grouped[label].partidos.push(p);
    });

    // Ordenar grupos cronológicamente
    const sortedGroups = Object.values(grouped).sort((a, b) => a.timestamp - b.timestamp);

    sortedGroups.forEach(g => {
      // Ordenar partidos dentro de cada día
      g.partidos.sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

      // Crear el acordeón
      const section = document.createElement('div');
      // Guardar fecha en formato YYYY-MM-DD (hora Argentina) para búsqueda rápida
      const dateStringAR = new Date(g.partidos[0].fecha_inicio).toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      const todayStringAR = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });

      // Las fechas anteriores a hoy se inician contraídas
      const allPassed = dateStringAR < todayStringAR;
      section.className = `accordion-section ${allPassed ? 'collapsed' : ''}`;
      section.dataset.date = dateStringAR;

      const allAccDisabled = g.partidos.every(p => !p.predecible);

      section.innerHTML = `
        <div class="accordion-header">
          <span class="accordion-title">
            <i class="fa-regular fa-calendar-days"></i> ${g.label}
          </span>
          <div class="accordion-header-right" style="display: flex; align-items: center; gap: 0.8rem;">
            <button class="btn-randomize-accordion" title="Randomizar predicciones habilitadas de este día" ${allAccDisabled ? 'disabled' : ''}>
              <i class="fa-solid fa-dice"></i>
            </button>
            <span class="accordion-chevron"><i class="fa-solid fa-chevron-up"></i></span>
          </div>
        </div>
        <div class="accordion-body"></div>
      `;

      const body = section.querySelector('.accordion-body');
      g.partidos.forEach(partido => {
        const card = crearPartidoCard(partido, ultimoPartidoBloqueadoId);
        body.appendChild(card);
      });

      // Event listener para contraer/expandir
      section.querySelector('.accordion-header').addEventListener('click', (e) => {
        // Ignorar el click si viene del botón de dados
        if (e.target.closest('.btn-randomize-accordion')) return;
        section.classList.toggle('collapsed');
      });

      const btnRand = section.querySelector('.btn-randomize-accordion');
      if (btnRand) {
        btnRand.addEventListener('click', (e) => {
          e.stopPropagation();
          const idsToRandomize = g.partidos.filter(p => p.predecible).map(p => p.partido_id);
          randomizarPartidos(idsToRandomize);
        });
      }

      container.appendChild(section);
    });

  } else {
    // Ordenación por Grupo
    partidosFiltrados.forEach(p => {
      const grupoLetter = EQUIPO_A_GRUPO[p.equipo_local] || 'Otros';
      const label = `Grupo ${grupoLetter}`;
      if (!grouped[label]) {
        grouped[label] = {
          label: label,
          grupoLetter: grupoLetter,
          partidos: []
        };
      }
      grouped[label].partidos.push(p);
    });

    // Ordenar grupos alfabéticamente (Grupo A a L)
    const sortedGroups = Object.values(grouped).sort((a, b) => a.grupoLetter.localeCompare(b.grupoLetter));

    sortedGroups.forEach(g => {
      // Ordenar partidos cronológicamente dentro de cada grupo
      g.partidos.sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

      // Crear el acordeón (por defecto expandido)
      const section = document.createElement('div');
      section.className = 'accordion-section';

      const allAccDisabled = g.partidos.every(p => !p.predecible);

      section.innerHTML = `
        <div class="accordion-header">
          <span class="accordion-title">
            <i class="fa-solid fa-layer-group"></i> ${g.label}
          </span>
          <div class="accordion-header-right" style="display: flex; align-items: center; gap: 0.8rem;">
            <button class="btn-randomize-accordion" title="Randomizar predicciones habilitadas de este grupo" ${allAccDisabled ? 'disabled' : ''}>
              <i class="fa-solid fa-dice"></i>
            </button>
            <span class="accordion-chevron"><i class="fa-solid fa-chevron-up"></i></span>
          </div>
        </div>
        <div class="accordion-body"></div>
      `;

      const body = section.querySelector('.accordion-body');
      g.partidos.forEach(partido => {
        const card = crearPartidoCard(partido, ultimoPartidoBloqueadoId);
        body.appendChild(card);
      });

      // Event listener para contraer/expandir
      section.querySelector('.accordion-header').addEventListener('click', (e) => {
        if (e.target.closest('.btn-randomize-accordion')) return;
        section.classList.toggle('collapsed');
      });

      const btnRand = section.querySelector('.btn-randomize-accordion');
      if (btnRand) {
        btnRand.addEventListener('click', (e) => {
          e.stopPropagation();
          const idsToRandomize = g.partidos.filter(p => p.predecible).map(p => p.partido_id);
          randomizarPartidos(idsToRandomize);
        });
      }

      container.appendChild(section);
    });
  }
}

function crearPartidoCard(partido, ultimoPartidoBloqueadoId = null) {
  const card = document.createElement('div');
  const yaComenzo = !partido.predecible;
  card.className = `partido-card ${yaComenzo ? 'bloqueado' : ''}`;
  card.id = `card-${partido.partido_id}`;

  // Hora en zona horaria argentina
  const fechaFormat = formatearFechaAR(partido.fecha_inicio);

  const golesLocalVal = partido.goles_local_pred !== null ? partido.goles_local_pred : '';
  const golesVisVal = partido.goles_visitante_pred !== null ? partido.goles_visitante_pred : '';

  const esKnockout = partido.fase !== 'Fase de Grupos';
  const ganadorPred = partido.ganador_pred || '';
  
  let realWinner = '';
  if (partido.finalizado && partido.goles_local_real !== null && partido.goles_visitante_real !== null) {
    const glReal = parseInt(partido.goles_local_real, 10);
    const gvReal = parseInt(partido.goles_visitante_real, 10);
    if (glReal > gvReal) realWinner = 'local';
    else if (glReal < gvReal) realWinner = 'visitante';
    else realWinner = partido.ganador_real || '';
  }

  let classLocal = '';
  let classVisitante = '';
  if (ganadorPred === 'local') classLocal += ' selected';
  if (ganadorPred === 'visitante') classVisitante += ' selected';
  if (partido.finalizado) {
    if (realWinner === 'local') classLocal += ' real-winner';
    if (realWinner === 'visitante') classVisitante += ' real-winner';
  }

  let showLocalCircle = false;
  let showVisCircle = false;
  
  if (partido.finalizado) {
    if (realWinner === 'local') showLocalCircle = true;
    if (realWinner === 'visitante') showVisCircle = true;
    if (partido.goles_local_pred !== null && partido.goles_visitante_pred !== null && 
        parseInt(partido.goles_local_pred, 10) === parseInt(partido.goles_visitante_pred, 10)) {
      if (ganadorPred === 'local') showLocalCircle = true;
      if (ganadorPred === 'visitante') showVisCircle = true;
    }
  } else if (yaComenzo) {
    if (partido.goles_local_pred !== null && partido.goles_visitante_pred !== null && 
        parseInt(partido.goles_local_pred, 10) === parseInt(partido.goles_visitante_pred, 10)) {
      if (ganadorPred === 'local') showLocalCircle = true;
      if (ganadorPred === 'visitante') showVisCircle = true;
    }
  }

  card.innerHTML = `
    <div class="partido-header">
      <span class="fase-badge">${partido.fase}</span>
      <span class="partido-fecha"><i class="fa-regular fa-clock"></i> ${fechaFormat} <small style="color:var(--text-sub);font-size:0.72rem;">(ARG)</small></span>
    </div>
    <div class="partido-equipos">
      <div class="equipo local">
        <span class="equipo-nombre">${partido.equipo_local}</span>
        <span class="flag-emoji">${obtenerEmojiBandera(partido.equipo_local)}</span>
      </div>

      <div class="marcador-inputs">
        ${esKnockout ? `<span class="winner-circle${classLocal}" id="win-local-${partido.partido_id}" onclick="seleccionarGanadorPred('${partido.partido_id}', 'local')" style="display: ${(!yaComenzo && golesLocalVal !== '' && golesVisVal !== '' && parseInt(golesLocalVal, 10) === parseInt(golesVisVal, 10)) || (yaComenzo && showLocalCircle) ? 'inline-flex' : 'none'}; pointer-events: ${yaComenzo ? 'none' : 'auto'}"></span>` : ''}
        <input type="number" min="0"
               class="pred-input"
               id="local-${partido.partido_id}"
               value="${golesLocalVal}"
               ${yaComenzo ? 'disabled' : ''}
               placeholder="-">
        <span class="vs">vs</span>
        <input type="number" min="0"
               class="pred-input"
               id="visitante-${partido.partido_id}"
               value="${golesVisVal}"
               ${yaComenzo ? 'disabled' : ''}
               placeholder="-">
        ${esKnockout ? `<span class="winner-circle${classVisitante}" id="win-visitante-${partido.partido_id}" onclick="seleccionarGanadorPred('${partido.partido_id}', 'visitante')" style="display: ${(!yaComenzo && golesLocalVal !== '' && golesVisVal !== '' && parseInt(golesLocalVal, 10) === parseInt(golesVisVal, 10)) || (yaComenzo && showVisCircle) ? 'inline-flex' : 'none'}; pointer-events: ${yaComenzo ? 'none' : 'auto'}"></span>` : ''}
      </div>

      <div class="equipo visitante">
        <span class="flag-emoji">${obtenerEmojiBandera(partido.equipo_visitante)}</span>
        <span class="equipo-nombre">${partido.equipo_visitante}</span>
      </div>
    </div>
    <div class="partido-footer">
      ${yaComenzo
        ? `
          <span class="status-locked"><i class="fa-solid fa-lock"></i> Predicción cerrada</span>
          ${partido.finalizado
            ? `<div class="resultado-real">Resultado real: ${partido.goles_local_real} - ${partido.goles_visitante_real}</div>`
            : ''
          }
          ${partido.palpito && partido.palpito.total_votos > 0
            ? `<span class="palpito-hint"><i class="fa-solid fa-chart-area"></i> Pálpito</span>`
            : ''
          }
        `
        : `
          <div class="footer-left-content">
            <div class="footer-actions">
              <button class="btn-guardar" onclick="guardarPrediccion('${partido.partido_id}')">Guardar <i class="fa-solid fa-floppy-disk"></i></button>
              ${(partido.goles_local_pred !== null && partido.goles_visitante_pred !== null)
                ? `<button class="btn-eliminar-pred" onclick="eliminarPrediccion('${partido.partido_id}')" title="Eliminar predicción"><i class="fa-solid fa-trash-can"></i></button>`
                : ''
              }
            </div>
            ${partido.finalizado
              ? `<div class="resultado-real">Resultado real: ${partido.goles_local_real} - ${partido.goles_visitante_real}</div>`
              : ''
            }
          </div>
          
          <button class="btn-randomize-card" onclick="randomizarPartido('${partido.partido_id}', event)" title="Randomizar resultado">
            <i class="fa-solid fa-dice"></i>
          </button>
        `
      }
    </div>
  `;

  // Detectar cambios en los inputs para activar el botón flotante
  if (!yaComenzo) {
    const localInput = card.querySelector(`#local-${partido.partido_id}`);
    const visInput   = card.querySelector(`#visitante-${partido.partido_id}`);
    const onChange = () => marcarCambioPendiente(partido.partido_id);
    localInput.addEventListener('input', onChange);
    visInput.addEventListener('input', onChange);

    if (esKnockout) {
      const circleL    = card.querySelector(`#win-local-${partido.partido_id}`);
      const circleV    = card.querySelector(`#win-visitante-${partido.partido_id}`);

      const toggleWinnerCircles = () => {
        const valL = localInput.value;
        const valV = visInput.value;
        if (valL !== '' && valV !== '' && parseInt(valL, 10) === parseInt(valV, 10)) {
          circleL.style.display = 'inline-flex';
          circleV.style.display = 'inline-flex';
        } else {
          circleL.classList.remove('selected');
          circleV.classList.remove('selected');
          circleL.style.display = 'none';
          circleV.style.display = 'none';
          if (pendingChanges[partido.partido_id]) {
            pendingChanges[partido.partido_id].ganador_pred = '';
          }
        }
      };
      
      localInput.addEventListener('input', toggleWinnerCircles);
      visInput.addEventListener('input', toggleWinnerCircles);
    }
  }

  // Click handler para mostrar/ocultar el Pálpito (solo en cards bloqueadas con datos)
  if (yaComenzo && partido.palpito && partido.palpito.total_votos > 0) {
    card.style.cursor = 'pointer';
    card.addEventListener('click', (e) => {
      // Ignorar clicks en inputs o botones
      if (e.target.closest('input, button, a')) return;
      const isOpen = card.classList.toggle('palpito-open');
      let container = card.querySelector('.palpito-container');
      if (isOpen) {
        if (!container) {
          container = document.createElement('div');
          container.className = 'palpito-container';
          card.appendChild(container);
        }
        renderizarPalpito(container, partido);
      } else if (container) {
        container.remove();
      }
    });
  }

  // Auto-expandir el pálpito por defecto si es el último partido bloqueado
  const esElUltimoBloqueado = partido.partido_id === ultimoPartidoBloqueadoId;
  if (esElUltimoBloqueado && yaComenzo && partido.palpito && partido.palpito.total_votos > 0) {
    card.classList.add('palpito-open');
    const container = document.createElement('div');
    container.className = 'palpito-container';
    card.appendChild(container);
    renderizarPalpito(container, partido);
  }

  return card;
}

// ==========================================
// PÁLPITO DEL PARTIDO — Componente SVG Dinámico
// ==========================================
function renderizarPalpito(contenedor, partido) {
  const p = partido.palpito;
  const local     = p.local;
  const empate    = p.empate;
  const visitante = p.visitante;
  const totalVotos = p.total_votos;
  const nombreLocal     = partido.equipo_local;
  const nombreVisitante = partido.equipo_visitante;

  if (totalVotos === 0) { contenedor.innerHTML = ''; return; }

  // ── Posiciones X de frontera (viewBox 0-100) ──────────────────────────────
  const xDiv1 = local;           // Fin de la zona local / inicio empate
  const xDiv2 = local + empate;  // Fin de la zona empate / inicio visitante

  // ── Generador de path SVG para una sección de curva Bezier ────────────────
  // Separa fill y stroke en dos paths para que la línea no se afine en el vértice.
  function generarPath(xStart, xEnd, porcentaje, color) {
    if (porcentaje === 0 || xStart >= xEnd) return '';
    const svgHeight = 120;
    // Exponente > 1 amplifica las diferencias: porcentajes bajos quedan muy abajo,
    // porcentajes altos llegan casi al techo. Ratio 50% vs 25% = 2.8x de diferencia visual.
    const heightFactor = Math.pow(porcentaje / 100, 1.5);
    const peakY = svgHeight - Math.max(3, heightFactor * 117);
    const midX  = (xStart + xEnd) / 2;
    const cp1X  = xStart + (midX - xStart) * 0.5;
    const cp2X  = midX   + (xEnd  - midX)  * 0.5;

    // Arco superior compartido por ambos paths (curva de subida y bajada)
    const arc = `M ${xStart} ${svgHeight} C ${cp1X} ${svgHeight}, ${cp1X} ${peakY}, ${midX} ${peakY} C ${cp2X} ${peakY}, ${cp2X} ${svgHeight}, ${xEnd} ${svgHeight}`;

    // Path 1: relleno translúcido (cerrado, sin stroke)
    const fillEl = `<path d="${arc} Z" fill="${color}" stroke="none"/>`;

    // Path 2: curva superior como línea ABIERTA con grosor uniforme
    // Al ser un path abierto el stroke no converge en punta sino que mantiene su ancho
    const strokeColor = color.replace('0.18', '0.88');
    const strokeEl = `<path d="${arc}" fill="none" stroke="${strokeColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;

    return fillEl + strokeEl;
  }

  const pathLocal     = generarPath(0,      xDiv1, local,     'rgba(59, 130, 246, 0.18)');
  const pathEmpate    = generarPath(xDiv1,  xDiv2, empate,    'rgba(251, 191, 36, 0.18)');
  const pathVisitante = generarPath(xDiv2,  100,   visitante, 'rgba(16, 185, 129, 0.18)');

  // ── Líneas divisorias punteadas ───────────────────────────────────────────
  function linea(x) {
    if (x <= 0 || x >= 100) return '';
    return `<line x1="${x}" y1="0" x2="${x}" y2="100" stroke="rgba(255,255,255,0.2)" stroke-width="0.6" stroke-dasharray="3,2"/>`;
  }
  const lineaDiv1 = local > 0 && empate > 0     ? linea(xDiv1) : '';
  const lineaDiv2 = visitante > 0 && xDiv2 < 100 ? linea(xDiv2) : '';

  // ── Barra horizontal proporcional ─────────────────────────────────────────
  const esKnockout = partido.fase !== 'Fase de Grupos';
  const barLocal     = local     > 0 ? `<div class="palpito-bar-segment palpito-local"     style="width:${local}%"    title="${local}% Local"></div>`     : '';
  const titleEmpate  = esKnockout ? `${empate}% Resolución por penales` : `${empate}% Empate`;
  const barEmpate    = empate    > 0 ? `<div class="palpito-bar-segment palpito-empate"    style="width:${empate}%"   title="${titleEmpate}"></div>`    : '';
  const barVisitante = visitante > 0 ? `<div class="palpito-bar-segment palpito-visitante" style="width:${visitante}%" title="${visitante}% Visitante"></div>` : '';

  // ── Leyenda de texto ──────────────────────────────────────────────────────
  const partes = [];
  if (local     > 0) partes.push(`<span class="palpito-legend-local">${local}% gana ${nombreLocal}</span>`);
  if (empate    > 0) {
    const labelEmpate = esKnockout ? 'resolución por penales' : 'empate';
    partes.push(`<span class="palpito-legend-empate">${empate}% ${labelEmpate}</span>`);
  }
  if (visitante > 0) partes.push(`<span class="palpito-legend-visitante">${visitante}% gana ${nombreVisitante}</span>`);

  contenedor.innerHTML = `
    <div class="palpito-inner">
      <svg class="palpito-svg" viewBox="0 0 100 120" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
        ${pathLocal}${pathEmpate}${pathVisitante}
        ${lineaDiv1}${lineaDiv2}
      </svg>
      <div class="palpito-bar">${barLocal}${barEmpate}${barVisitante}</div>
      <div class="palpito-legend">${partes.join('<span class="palpito-sep"> — </span>')}</div>
      <div class="palpito-votos">${totalVotos} ${totalVotos === 1 ? 'palpitero' : 'palpiteros'}</div>
    </div>
  `;
}

// ==========================================
// RENDERIZADOR DE ÁRBOL DE LLAVES (BRACKET DESDE DIECISEISAVOS)
// ==========================================
function renderizarBracket() {
  const treeContainer = document.getElementById('bracket-tree');
  treeContainer.innerHTML = '';

  const koMatches = partidos.filter(p => p.partido_id.startsWith('ko_'));
  
  // Dividir por rondas (5 columnas conectadas de izquierda a derecha)
  const rondas = {
    'Dieciseisavos': koMatches.filter(p => p.fase === 'Dieciseisavos de Final').sort((a,b)=>a.partido_id.localeCompare(b.partido_id)),
    'Octavos': koMatches.filter(p => p.fase === 'Octavos de Final').sort((a,b)=>a.partido_id.localeCompare(b.partido_id)),
    'Cuartos': koMatches.filter(p => p.fase === 'Cuartos de Final').sort((a,b)=>a.partido_id.localeCompare(b.partido_id)),
    'Semis': koMatches.filter(p => p.fase === 'Semifinales').sort((a,b)=>a.partido_id.localeCompare(b.partido_id)),
    'Finales': koMatches.filter(p => p.fase === 'Gran Final' || p.fase === 'Tercer Puesto').sort((a,b)=>b.partido_id.localeCompare(a.partido_id))
  };

  const esPlaceholder = (equipo) => {
    return !equipo || equipo.includes('1') || equipo.includes('2') || equipo.includes('Ganador') || equipo.includes('Perdedor') || equipo.includes('TBD') || equipo.includes('/');
  };

  Object.entries(rondas).forEach(([nombreRonda, listaPartidos]) => {
    const roundDiv = document.createElement('div');
    roundDiv.className = 'bracket-round';
    
    const header = document.createElement('div');
    header.className = 'bracket-round-header';
    header.textContent = nombreRonda;
    roundDiv.appendChild(header);

    const matchList = document.createElement('div');
    matchList.className = 'bracket-match-list';

    listaPartidos.forEach(partido => {
      const matchCard = document.createElement('div');
      matchCard.className = 'bracket-match';
      matchCard.id = `match-card-${partido.partido_id}`;
      
      const locPlaceholder = esPlaceholder(partido.equipo_local);
      const visPlaceholder = esPlaceholder(partido.equipo_visitante);
      
      const yaComenzo = !partido.predecible;
      const deshabilitado = yaComenzo || locPlaceholder || visPlaceholder;

      const gLocal = partido.goles_local_pred !== null ? partido.goles_local_pred : '';
      const gVis = partido.goles_visitante_pred !== null ? partido.goles_visitante_pred : '';

      const fechaFormat = formatearFechaAR(partido.fecha_inicio, { day: '2-digit', month: '2-digit', hour: undefined, minute: undefined });

      const ganadorPred = partido.ganador_pred || '';
      let realWinner = '';
      if (partido.finalizado && partido.goles_local_real !== null && partido.goles_visitante_real !== null) {
        const glReal = parseInt(partido.goles_local_real, 10);
        const gvReal = parseInt(partido.goles_visitante_real, 10);
        if (glReal > gvReal) realWinner = 'local';
        else if (glReal < gvReal) realWinner = 'visitante';
        else realWinner = partido.ganador_real || '';
      }

      let classLocal = '';
      let classVisitante = '';
      if (ganadorPred === 'local') classLocal += ' selected';
      if (ganadorPred === 'visitante') classVisitante += ' selected';
      if (partido.finalizado) {
        if (realWinner === 'local') classLocal += ' real-winner';
        if (realWinner === 'visitante') classVisitante += ' real-winner';
      }

      let showLocalCircle = false;
      let showVisCircle = false;
      
      if (partido.finalizado) {
        if (realWinner === 'local') showLocalCircle = true;
        if (realWinner === 'visitante') showVisCircle = true;
        if (partido.goles_local_pred !== null && partido.goles_visitante_pred !== null && 
            parseInt(partido.goles_local_pred, 10) === parseInt(partido.goles_visitante_pred, 10)) {
          if (ganadorPred === 'local') showLocalCircle = true;
          if (ganadorPred === 'visitante') showVisCircle = true;
        }
      } else if (yaComenzo) {
        if (partido.goles_local_pred !== null && partido.goles_visitante_pred !== null && 
            parseInt(partido.goles_local_pred, 10) === parseInt(partido.goles_visitante_pred, 10)) {
          if (ganadorPred === 'local') showLocalCircle = true;
          if (ganadorPred === 'visitante') showVisCircle = true;
        }
      }

      matchCard.innerHTML = `
        <div class="bracket-match-info">
          <span>${partido.fase.replace(' de Final', '')} (${partido.partido_id.toUpperCase()})</span>
          <span>${fechaFormat}</span>
        </div>
        <div class="bracket-teams-row">
          <div class="bracket-team-line">
            <span class="bracket-team-info ${locPlaceholder ? 'placeholder-team' : ''}">
              ${locPlaceholder ? '' : obtenerEmojiBandera(partido.equipo_local)} ${partido.equipo_local}
            </span>
            <div style="display: flex; align-items: center; gap: 0.3rem;">
              <span class="winner-circle${classLocal}" id="win-local-${partido.partido_id}" onclick="seleccionarGanadorPred('${partido.partido_id}', 'local')" style="display: ${(!yaComenzo && gLocal !== '' && gVis !== '' && parseInt(gLocal, 10) === parseInt(gVis, 10)) || (yaComenzo && showLocalCircle) ? 'inline-flex' : 'none'}; pointer-events: ${yaComenzo ? 'none' : 'auto'}"></span>
              <input type="number" min="0" class="bracket-input" 
                     id="local-${partido.partido_id}" 
                     value="${gLocal}" 
                     ${deshabilitado ? 'disabled' : ''}>
            </div>
          </div>
          <div class="bracket-team-line">
            <span class="bracket-team-info ${visPlaceholder ? 'placeholder-team' : ''}">
              ${visPlaceholder ? '' : obtenerEmojiBandera(partido.equipo_visitante)} ${partido.equipo_visitante}
            </span>
            <div style="display: flex; align-items: center; gap: 0.3rem;">
              <span class="winner-circle${classVisitante}" id="win-visitante-${partido.partido_id}" onclick="seleccionarGanadorPred('${partido.partido_id}', 'visitante')" style="display: ${(!yaComenzo && gLocal !== '' && gVis !== '' && parseInt(gLocal, 10) === parseInt(gVis, 10)) || (yaComenzo && showVisCircle) ? 'inline-flex' : 'none'}; pointer-events: ${yaComenzo ? 'none' : 'auto'}"></span>
              <input type="number" min="0" class="bracket-input" 
                     id="visitante-${partido.partido_id}" 
                     value="${gVis}" 
                     ${deshabilitado ? 'disabled' : ''}>
            </div>
          </div>
        </div>
        <div class="bracket-match-footer">
          ${deshabilitado
            ? (yaComenzo
                ? `<span class="bracket-lock-lbl"><i class="fa-solid fa-lock"></i> Cerrado</span>`
                : `<span class="bracket-lock-lbl" title="Disponible cuando clasifiquen los equipos."><i class="fa-solid fa-clock"></i> Pendiente</span>`
              )
            : `
              <div class="bracket-footer-actions">
                <button class="btn-guardar-bracket" onclick="guardarPrediccion('${partido.partido_id}')">Guardar <i class="fa-solid fa-floppy-disk"></i></button>
                ${(partido.goles_local_pred !== null && partido.goles_visitante_pred !== null)
                  ? `<button class="btn-eliminar-pred-bracket" onclick="eliminarPrediccion('${partido.partido_id}')" title="Eliminar predicción"><i class="fa-solid fa-trash-can"></i></button>`
                  : ''
                }
                <button class="btn-randomize-bracket" onclick="randomizarPartido('${partido.partido_id}', event)" title="Randomizar resultado">
                  <i class="fa-solid fa-dice"></i>
                </button>
              </div>
            `
          }
          ${partido.finalizado
            ? `<span class="bracket-real-score">R: ${partido.goles_local_real}-${partido.goles_visitante_real}</span>`
            : ''
          }
        </div>
      `;
      matchList.appendChild(matchCard);

      // Detectar cambios en bracket para activar el botón flotante y mostrar/ocultar círculos
      if (!deshabilitado) {
        const localInp = matchCard.querySelector(`#local-${partido.partido_id}`);
        const visInp   = matchCard.querySelector(`#visitante-${partido.partido_id}`);
        if (localInp && visInp) {
          const circleL  = matchCard.querySelector(`#win-local-${partido.partido_id}`);
          const circleV  = matchCard.querySelector(`#win-visitante-${partido.partido_id}`);

          const onChange = () => marcarCambioPendiente(partido.partido_id);
          localInp.addEventListener('input', onChange);
          visInp.addEventListener('input', onChange);

          const toggleWinnerCircles = () => {
            const valL = localInp.value;
            const valV = visInp.value;
            if (valL !== '' && valV !== '' && parseInt(valL, 10) === parseInt(valV, 10)) {
              circleL.style.display = 'inline-flex';
              circleV.style.display = 'inline-flex';
            } else {
              circleL.classList.remove('selected');
              circleV.classList.remove('selected');
              circleL.style.display = 'none';
              circleV.style.display = 'none';
              if (pendingChanges[partido.partido_id]) {
                pendingChanges[partido.partido_id].ganador_pred = '';
              }
            }
          };
          
          localInp.addEventListener('input', toggleWinnerCircles);
          visInp.addEventListener('input', toggleWinnerCircles);
        }
      }
    });

    roundDiv.appendChild(matchList);
    treeContainer.appendChild(roundDiv);
  });

  requestAnimationFrame(() => {
    dibujarConectoresBracket('bracket-tree');
  });
}

function dibujarConectoresBracket(treeContainerId) {
  const treeContainer = document.getElementById(treeContainerId);
  if (!treeContainer) return;

  // Eliminar SVG anterior si existe
  const svgAnterior = treeContainer.querySelector('.bracket-svg-connectors');
  if (svgAnterior) {
    svgAnterior.remove();
  }

  // Crear SVG
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'bracket-svg-connectors');
  svg.style.position = 'absolute';
  svg.style.top = '0';
  svg.style.left = '0';
  svg.style.width = '100%';
  svg.style.height = '100%';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '0';

  // Añadir defs para las flechas
  svg.innerHTML = `
    <defs>
      <marker id="arrow-${treeContainerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
        <path d="M 0 1.5 L 7 5 L 0 8.5 z" fill="#3b82f6" opacity="0.8" />
      </marker>
    </defs>
  `;

  const containerRect = treeContainer.getBoundingClientRect();

  const conexiones = [
    // Dieciseisavos -> Octavos
    { src: 'ko_01', target: 'ko_17', type: 'local' },
    { src: 'ko_02', target: 'ko_17', type: 'visitor' },
    { src: 'ko_03', target: 'ko_18', type: 'local' },
    { src: 'ko_04', target: 'ko_18', type: 'visitor' },
    { src: 'ko_05', target: 'ko_19', type: 'local' },
    { src: 'ko_06', target: 'ko_19', type: 'visitor' },
    { src: 'ko_07', target: 'ko_20', type: 'local' },
    { src: 'ko_08', target: 'ko_20', type: 'visitor' },
    { src: 'ko_09', target: 'ko_21', type: 'local' },
    { src: 'ko_10', target: 'ko_21', type: 'visitor' },
    { src: 'ko_11', target: 'ko_22', type: 'local' },
    { src: 'ko_12', target: 'ko_22', type: 'visitor' },
    { src: 'ko_13', target: 'ko_23', type: 'local' },
    { src: 'ko_14', target: 'ko_23', type: 'visitor' },
    { src: 'ko_15', target: 'ko_24', type: 'local' },
    { src: 'ko_16', target: 'ko_24', type: 'visitor' },

    // Octavos -> Cuartos
    { src: 'ko_17', target: 'ko_25', type: 'local' },
    { src: 'ko_18', target: 'ko_25', type: 'visitor' },
    { src: 'ko_19', target: 'ko_26', type: 'local' },
    { src: 'ko_20', target: 'ko_26', type: 'visitor' },
    { src: 'ko_21', target: 'ko_27', type: 'local' },
    { src: 'ko_22', target: 'ko_27', type: 'visitor' },
    { src: 'ko_23', target: 'ko_28', type: 'local' },
    { src: 'ko_24', target: 'ko_28', type: 'visitor' },

    // Cuartos -> Semis
    { src: 'ko_25', target: 'ko_29', type: 'local' },
    { src: 'ko_26', target: 'ko_29', type: 'visitor' },
    { src: 'ko_27', target: 'ko_30', type: 'local' },
    { src: 'ko_28', target: 'ko_30', type: 'visitor' },

    // Semis -> Gran Final
    { src: 'ko_29', target: 'ko_32', type: 'local' },
    { src: 'ko_30', target: 'ko_32', type: 'visitor' },

    // Semis -> Tercer Puesto
    { src: 'ko_29', target: 'ko_31', type: 'local' },
    { src: 'ko_30', target: 'ko_31', type: 'visitor' }
  ];

  const prefix = treeContainerId === 'bracket-tree' ? 'match-card-' : 'profile-match-card-';

  conexiones.forEach(conn => {
    const sEl = treeContainer.querySelector(`#${prefix}${conn.src}`);
    const dEl = treeContainer.querySelector(`#${prefix}${conn.target}`);

    if (sEl && dEl) {
      const sRect = sEl.getBoundingClientRect();
      const dRect = dEl.getBoundingClientRect();

      // Punto de salida del partido origen: borde derecho al medio
      const sx = sRect.right - containerRect.left;
      const sy = sRect.top + sRect.height / 2 - containerRect.top;

      // Punto de llegada al partido destino: borde izquierdo alineado a la fila local o visitante
      const dx = dRect.left - containerRect.left;
      const dy = dRect.top + dRect.height * (conn.type === 'local' ? 0.32 : 0.68) - containerRect.top;

      // Línea escalonada a mitad de camino horizontal
      const mx = sx + (dx - sx) * 0.45;

      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', `M ${sx} ${sy} H ${mx} V ${dy} H ${dx}`);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'rgba(59, 130, 246, 0.45)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('marker-end', `url(#arrow-${treeContainerId})`);

      svg.appendChild(path);
    }
  });

  treeContainer.appendChild(svg);
}

// Guardar predicción de un partido individual (botón por fila)
async function guardarPrediccion(partidoId) {
  if (!currentUser) return;
  const { local: localInput, visitante: visInput, circleL, circleV } = obtenerElementosPartido(partidoId);
  if (!localInput || !visInput) return;
  const golesLocal     = localInput.value;
  const golesVisitante = visInput.value;

  const partido = partidos.find(p => p.partido_id === partidoId);
  const esKnockout = partido && partido.fase !== 'Fase de Grupos';

  let ganador_pred = '';
  if (esKnockout && golesLocal !== '' && golesVisitante !== '' && parseInt(golesLocal, 10) === parseInt(golesVisitante, 10)) {
    if (circleL && circleL.classList.contains('selected')) {
      ganador_pred = 'local';
    } else if (circleV && circleV.classList.contains('selected')) {
      ganador_pred = 'visitante';
    }
    if (!ganador_pred) {
      showToast('Debes seleccionar un ganador para el partido con resolución por penales.', 'error');
      return;
    }
  }

  if (golesLocal === '' || golesVisitante === '') {
    showToast('Debes ingresar el marcador de ambos equipos.', 'error');
    return;
  }

  try {
    const response = await fetch('/api/predicciones/partido', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username:            currentUser.username,
        partido_id:          partidoId,
        goles_local_pred:    golesLocal,
        goles_visitante_pred: golesVisitante,
        ganador_pred:        ganador_pred
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    // Limpiar este partido del mapa de pendientes
    limpiarCambioPendiente(partidoId);

    showToast(data.message, 'success');
    cargarPartidosYPredicciones();
    cargarScoreboardMini();
  } catch (error) {
    showToast(error.message, 'error');
  }
}
window.guardarPrediccion = guardarPrediccion;

function seleccionarGanadorPred(partidoId, lado) {
  const { local: localInput, visitante: visInput, circleL, circleV } = obtenerElementosPartido(partidoId);
  if (!localInput || !visInput) return;

  const valL = localInput.value;
  const valV = visInput.value;
  if (valL === '' || valV === '' || parseInt(valL, 10) !== parseInt(valV, 10)) return;

  if (!circleL || !circleV) return;

  if (lado === 'local') {
    circleL.classList.add('selected');
    circleV.classList.remove('selected');
  } else {
    circleV.classList.add('selected');
    circleL.classList.remove('selected');
  }

  marcarCambioPendiente(partidoId);
}
window.seleccionarGanadorPred = seleccionarGanadorPred;

async function eliminarPrediccion(partidoId) {
  if (!currentUser) return;

  if (!confirm('¿Seguro que quieres eliminar esta predicción y dejarla vacía?')) {
    return;
  }

  try {
    const response = await fetch('/api/predicciones/partido', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        partido_id: partidoId,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    // Limpiar de los inputs locales y pendientes
    const { local: localInp, visitante: visInp, circleL, circleV } = obtenerElementosPartido(partidoId);
    if (localInp) localInp.value = '';
    if (visInp) visInp.value = '';
    if (circleL) {
      circleL.classList.remove('selected');
      circleL.style.display = 'none';
    }
    if (circleV) {
      circleV.classList.remove('selected');
      circleV.style.display = 'none';
    }

    limpiarCambioPendiente(partidoId);

    showToast(data.message, 'success');
    cargarPartidosYPredicciones();
    cargarScoreboardMini();
  } catch (error) {
    showToast(error.message, 'error');
  }
}
window.eliminarPrediccion = eliminarPrediccion;

// ==========================================
// SCOREBOARD COMPLETOS Y MINI
// ==========================================
async function cargarScoreboardMini() {
  try {
    const response = await fetch('/api/scoreboard');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    const miniBody = document.getElementById('mini-scoreboard-body');
    miniBody.innerHTML = '';

    let currentRank = 0;
    let lastPoints = null;
    const scoreboardWithRanks = data.scoreboard.map((usr) => {
      if (lastPoints === null || usr.puntaje_total < lastPoints) {
        currentRank++;
      }
      lastPoints = usr.puntaje_total;
      return { ...usr, rank: currentRank };
    });

    scoreboardWithRanks.slice(0, 5).forEach((usr) => {
      const isMe = currentUser && usr.username === currentUser.username;
      const tr = document.createElement('tr');
      if (isMe) tr.style.backgroundColor = 'rgba(59, 130, 246, 0.08)';

      tr.innerHTML = `
        <td class="col-pos">
          <span class="pos-badge pos-${usr.rank}">${usr.rank}</span>
        </td>
        <td>
          <div class="row-user-cell clickable-profile" data-username="${escapeHtml(usr.username)}">
            <span>${usr.avatar_emoji}</span>
            <span>${escapeHtml(usr.username)} ${isMe ? '<small>(Tú)</small>' : ''}</span>
          </div>
        </td>
        <td class="col-pts text-right font-bold">${usr.puntaje_total}</td>
      `;
      miniBody.appendChild(tr);
    });
  } catch (error) {
    console.error('Error al cargar miniscoreboard:', error);
  }
}

async function cargarScoreboardCompleto() {
  try {
    const response = await fetch('/api/scoreboard');
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    let currentRank = 0;
    let lastPoints = null;
    scoreboard = data.scoreboard.map((usr) => {
      if (lastPoints === null || usr.puntaje_total < lastPoints) {
        currentRank++;
      }
      lastPoints = usr.puntaje_total;
      return { ...usr, rank: currentRank };
    });

    const fullBody = document.getElementById('full-scoreboard-body');
    fullBody.innerHTML = '';

    scoreboard.forEach((usr) => {
      const isMe = currentUser && usr.username === currentUser.username;
      const tr = document.createElement('tr');
      if (isMe) tr.style.backgroundColor = 'rgba(59, 130, 246, 0.08)';

      const rachaDetalles = usr.racha_detalles || [];
      const ultimasRachas = rachaDetalles.slice(-5);

      let rachaHTML = '<div class="racha-container">';
      if (ultimasRachas.length === 0) {
        rachaHTML += '<span class="text-sub font-normal">-</span>';
      } else {
        ultimasRachas.forEach(r => {
          rachaHTML += `<span class="racha-dot ${r.tipo}" title="+${r.puntos} pts"></span>`;
        });
      }
      rachaHTML += '</div>';

      tr.innerHTML = `
        <td>
          <span class="pos-badge pos-${usr.rank}">${usr.rank}</span>
        </td>
        <td>
          <div class="user-cell clickable-profile" data-username="${escapeHtml(usr.username)}">
            <span class="user-avatar-emoji">${usr.avatar_emoji}</span>
            <span>${escapeHtml(usr.username)} ${isMe ? '<small>(Tú)</small>' : ''}</span>
          </div>
        </td>
        <td>${rachaHTML}</td>
        <td class="font-bold" style="font-size: 1.1rem;">${usr.puntaje_total}</td>
      `;
      fullBody.appendChild(tr);
    });

    renderizarGraficoEvolucion();
    actualizarPalpitosEnVivoScoreboard();
  } catch (error) {
    showToast(error.message, 'error');
  }
}

function crearCanvasEmoji(emoji, size = 26) {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.font = `${size - 6}px "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, size / 2, size / 2);
  const img = new Image(size, size);
  img.src = canvas.toDataURL();
  return img;
}

function obtenerColorJugador(username) {
  const index = scoreboard.findIndex(s => s.username === username);
  const colores = ['#3b82f6', '#fbbf24', '#10b981', '#ec4899', '#8b5cf6', '#f97316', '#06b6d4', '#a855f7', '#14b8a6', '#f43f5e'];
  return index !== -1 ? colores[index % colores.length] : '#9ca3af';
}

function adjustColorBrightness(hex, percent) {
  let R = parseInt(hex.substring(1, 3), 16);
  let G = parseInt(hex.substring(3, 5), 16);
  let B = parseInt(hex.substring(5, 7), 16);

  R = parseInt(R * (100 + percent) / 100, 10);
  G = parseInt(G * (100 + percent) / 100, 10);
  B = parseInt(B * (100 + percent) / 100, 10);

  R = (R < 255) ? R : 255;
  G = (G < 255) ? G : 255;
  B = (B < 255) ? B : 255;

  R = (R > 0) ? R : 0;
  G = (G > 0) ? G : 0;
  B = (B > 0) ? B : 0;

  const rHex = R.toString(16).padStart(2, '0');
  const gHex = G.toString(16).padStart(2, '0');
  const bHex = B.toString(16).padStart(2, '0');

  return `#${rHex}${gHex}${bHex}`;
}

const barAvatarPlugin = {
  id: 'barAvatarPlugin',
  afterDatasetsDraw(chart, args, options) {
    const { ctx } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta || !meta.data) return;

    const activeData = chart.config.options.pyramidData;
    if (!activeData) return;

    ctx.save();
    meta.data.forEach((bar, index) => {
      const usr = activeData[index];
      if (!usr) return;

      const x = bar.x;
      const yTop = bar.y;
      
      ctx.font = '18px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(usr.avatar_emoji || '⚽', x, yTop - 6);
    });
    ctx.restore();
  }
};

const stackedDatalabelsPlugin = {
  id: 'stackedDatalabelsPlugin',
  afterDatasetsDraw(chart, args, options) {
    const { ctx } = chart;
    chart.data.datasets.forEach((dataset, datasetIndex) => {
      const meta = chart.getDatasetMeta(datasetIndex);
      if (meta.hidden) return;
      
      meta.data.forEach((element, index) => {
        const val = dataset.data[index];
        if (val && val > 0) {
          ctx.save();
          ctx.font = 'bold 11px sans-serif';
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          
          const xCenter = (element.x + element.base) / 2;
          const yCenter = element.y;
          
          const width = Math.abs(element.x - element.base);
          if (width > 18) {
            ctx.fillText(`+${val}`, xCenter, yCenter);
          }
          ctx.restore();
        }
      });
    });
  }
};

function ordenarEnPiramide(arr) {
  const izquierda = [];
  const derecha = [];
  arr.forEach((item, index) => {
    if (index === 0) {
      derecha.push(item);
    } else if (index % 2 === 1) {
      derecha.push(item);
    } else {
      izquierda.unshift(item);
    }
  });
  return [...izquierda, ...derecha];
}

// Función global para deshabilitar/habilitar botones de zoom según los límites del gráfico
function actualizarBotonesZoomState(chart) {
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  if (!chart || !btnZoomIn || !btnZoomOut) return;

  const xAxis = chart.scales.x;
  if (!xAxis) return;

  const currentXRange = xAxis.max - xAxis.min;
  const maxLimitRange = (chart.maxLen - 0.7) - (-0.8); // Rango máximo
  const minLimitRange = 4; // Rango mínimo (minRange)

  // Desactivar zoom out si ya estamos en el rango inicial completo
  if (currentXRange >= maxLimitRange - 0.05) {
    btnZoomOut.disabled = true;
    btnZoomOut.style.opacity = '0.4';
    btnZoomOut.style.cursor = 'not-allowed';
  } else {
    btnZoomOut.disabled = false;
    btnZoomOut.style.opacity = '';
    btnZoomOut.style.cursor = '';
  }

  // Desactivar zoom in si ya alcanzamos el límite mínimo de partidos visibles
  if (currentXRange <= minLimitRange + 0.05) {
    btnZoomIn.disabled = true;
    btnZoomIn.style.opacity = '0.4';
    btnZoomIn.style.cursor = 'not-allowed';
  } else {
    btnZoomIn.disabled = false;
    btnZoomIn.style.opacity = '';
    btnZoomIn.style.cursor = '';
  }
}

function renderizarGraficoEvolucion() {
  const ctx = document.getElementById('evolutionChart').getContext('2d');
  if (chartInstance) chartInstance.destroy();

  // Ocultar botón de reset zoom al renderizar o cambiar de gráfico
  const btnReset = document.getElementById('btn-reset-zoom');
  if (btnReset) btnReset.style.display = 'none';

  // Mostrar u ocultar controles de zoom según el gráfico activo
  const zoomControls = document.querySelector('.chart-zoom-controls');
  if (zoomControls) {
    zoomControls.style.display = currentChartIndex === 0 ? 'flex' : 'none';
  }

  const titleEl = document.getElementById('chart-card-title');
  const subtitleEl = document.getElementById('chart-card-subtitle');
  const chartCard = document.querySelector('.scoreboard-chart-card');

  if (currentChartIndex === 0) {
    if (chartCard) chartCard.classList.add('evolution-chart-active');
    if (titleEl) titleEl.textContent = 'Gráfico de Evolución';
    if (subtitleEl) subtitleEl.textContent = 'Mira el avance acumulado de cada jugador a lo largo del torneo.';
    renderizarLineaEvolucion(ctx);
  } else {
    if (chartCard) chartCard.classList.remove('evolution-chart-active');
    if (currentChartIndex === 1) {
      if (titleEl) titleEl.textContent = 'Pilas de Puntajes';
      if (subtitleEl) subtitleEl.textContent = 'Visualización de los puntos totales acumulados por cada jugador.';
      renderizarPilasMonedas(ctx);
    } else if (currentChartIndex === 2) {
      if (titleEl) titleEl.textContent = 'Composición de Puntos';
      if (subtitleEl) subtitleEl.textContent = 'Puntos desglosados por Tendencia (Azul), Goles de Selección (Amarillo) y Pleno (Verde).';
      renderizarBarrasCategorias(ctx);
    }
  }

  renderizarLegendCompartida();
}

function renderizarLineaEvolucion(ctx) {
  let maxLen = 0;
  let maxScore = 0;
  scoreboard.forEach(usr => {
    if (usr.historial_puntos.length > maxLen) maxLen = usr.historial_puntos.length;
    if (usr.historial_puntos.length > 0) {
      const highest = Math.max(...usr.historial_puntos);
      if (highest > maxScore) maxScore = highest;
    }
    if (usr.puntaje_total > maxScore) maxScore = usr.puntaje_total;
  });
  if (maxScore < 10) maxScore = 10; // piso mínimo razonable

  const zoomMode = 'xy';

  const labels = Array.from({ length: maxLen }, (_, i) => i === 0 ? 'Inicio' : `P${i}`);

  const datasets = scoreboard.map((usr) => {
    const color = obtenerColorJugador(usr.username);
    
    // Rellenamos el historial con el último puntaje en caso de que sea más corto (por ejemplo, si faltan predicciones de Top 3)
    // para garantizar que la línea se extienda hasta el final y los emojis queden perfectamente alineados verticalmente.
    const dataPoints = [...usr.historial_puntos];
    while (dataPoints.length < maxLen) {
      dataPoints.push(dataPoints[dataPoints.length - 1] || 0);
    }
    
    // Mapeamos los datos a objetos {x, y} para que Chart.js pueda graficarlos correctamente usando el eje lineal continuo (X)
    const dataPointsMapped = dataPoints.map((val, idx) => ({ x: idx, y: val }));
    
    const len = dataPoints.length;
    const pointStyles = Array(len).fill('circle');
    const pointRadii = Array(len).fill(2);
    const pointHoverRadii = Array(len).fill(3);
    
    if (len > 0) {
      const emojiCanvas = crearCanvasEmoji(usr.avatar_emoji || '⚽', 26);
      pointStyles[len - 1] = emojiCanvas;
      pointRadii[len - 1] = 13;
      pointHoverRadii[len - 1] = 16;
    }

    return {
      label: `${usr.avatar_emoji || '⚽'} ${usr.username}`,
      data: dataPointsMapped,
      borderColor: color,
      backgroundColor: color + '15',
      borderWidth: 3,
      pointStyle: pointStyles,
      pointRadius: pointRadii,
      pointHoverRadius: pointHoverRadii,
      tension: 0.2,
      fill: false,
      hidden: hiddenUsernames.has(usr.username),
      clip: { left: 5, top: 15, right: 25, bottom: 5 }
    };
  });

  chartInstance = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: {
          left: 10,
          right: 20,
          top: 15,
          bottom: 5
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          mode: 'nearest',
          intersect: true,
          backgroundColor: '#121522',
          titleColor: '#fbbf24',
          bodyColor: '#f3f4f6',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1
        },
        zoom: {
          limits: {
            x: {
              min: -0.8, // Limita el paneo antes de "Inicio"
              max: maxLen - 0.7, // Limita el paneo después del último partido (evita ver vacío)
              minRange: 4 // Evita hacer zoom infinito horizontalmente (con rango mínimo de 4 unidades, se garantizan al menos 5 partidos visibles en pantalla)
            },
            y: {
              min: 'original', // Limita el zoom-out y paneo vertical al mínimo inicial de -1
              max: maxScore + 3, // Limita el zoom-out y paneo vertical al máximo de los puntajes reales más un margen
              minRange: 5 // Evita hacer zoom vertical infinito, pero permite suficiente zoom para que sea proporcional al eje X
            }
          },
          zoom: {
            wheel: {
              enabled: true,
              speed: 0.08
            },
            pinch: {
              enabled: true // Permitir zoom con pellizco en dispositivos móviles
            },
            mode: zoomMode, // Permitir zoom tanto horizontal como vertical en PC (GeoGebra), pero limitado a horizontal en móvil para evitar que salte/se rompa
            drag: {
              enabled: false // Deshabilitamos zoom por arrastre de caja para permitir el arrastre normal para paneo (desplazamiento)
            },
            onZoom: function({chart}) {
              const xAxis = chart.scales.x;
              const yAxis = chart.scales.y;
              if (!xAxis || !yAxis) return;

              const initialXRange = (maxLen - 0.7) - (-0.8); // Rango inicial de X: maxLen - 0.5
              const initialYRange = (maxScore + 3) - (-1);   // Rango inicial de Y: maxScore + 4

              const currentXRange = xAxis.max - xAxis.min;
              const currentYRange = yAxis.max - yAxis.min;

              // Factor de zoom basado en la escala X
              const z = currentXRange / initialXRange;

              // Rango de Y sincronizado proporcionalmente con X
              const targetYRange = z * initialYRange;

              // Evitar recursión si la diferencia es insignificante
              if (Math.abs(currentYRange - targetYRange) < 0.001) return;

              const yCenter = (yAxis.max + yAxis.min) / 2;
              let newYMin = yCenter - targetYRange / 2;
              let newYMax = yCenter + targetYRange / 2;

              // Aplicar topes físicos de Y
              const limitYMin = -1;
              const limitYMax = maxScore + 3;

              if (newYMin < limitYMin) {
                newYMin = limitYMin;
                newYMax = newYMin + targetYRange;
              }
              if (newYMax > limitYMax) {
                newYMax = limitYMax;
                newYMin = newYMax - targetYRange;
                if (newYMin < limitYMin) newYMin = limitYMin;
              }

              yAxis.options.min = newYMin;
              yAxis.options.max = newYMax;
              chart.update('none');
              actualizarBotonesZoomState(chart);
            },
            onZoomComplete: function({chart}) {
              const btn = document.getElementById('btn-reset-zoom');
              if (btn) btn.style.display = 'flex';
              actualizarBotonesZoomState(chart);
            }
          },
          pan: {
            enabled: true, // Permitir arrastrar con el mouse o dedo para desplazarse por el gráfico
            mode: zoomMode, // Paneo bidireccional en PC, horizontal en celular para estabilidad
            onPanComplete: function({chart}) {
              const btn = document.getElementById('btn-reset-zoom');
              if (btn) btn.style.display = 'flex';
              actualizarBotonesZoomState(chart);
            }
          }
        }
      },
      scales: {
        x: { 
          type: 'linear', // Cambiamos a escala lineal para permitir un arrastre (paneo) continuo y sumamente fluido (tipo GeoGebra), sin saltos o tropezones
          position: 'bottom', // Asegura que el eje X esté siempre fijo en la base del gráfico
          min: -0.8, // Espacio antes de "Inicio"
          max: maxLen - 0.7, // Espacio al final del último partido
          grid: { color: 'rgba(255,255,255,0.05)' }, 
          ticks: { 
            color: '#9ca3af',
            autoSkip: true, // Habilitar auto-skip para que Chart.js decida cuántas etiquetas mostrar según el zoom y evite superposiciones
            autoSkipPadding: 5, // Reduce el margen mínimo requerido entre etiquetas para evitar que Chart.js las oculte al hacer zoom in
            precision: 0, // Forzar a Chart.js a generar únicamente divisiones en números enteros (partidos)
            stepSize: 1, // Forzar a Chart.js a generar divisiones de 1 en 1 para que al hacer zoom se dibuje cada partido
            minRotation: 45, // Rotación en ángulo para estackearlos mejor (comportamiento original)
            maxRotation: 45, // Rotación en ángulo para estackearlos mejor (comportamiento original)
            align: 'inner', // Alinea las etiquetas de los extremos hacia adentro para evitar que el gráfico vibre horizontalmente al ocultar "Inicio"
            callback: function(value) {
              // Mapeamos el índice numérico de vuelta a su etiqueta original (Inicio, P1, P2...)
              if (value % 1 === 0 && value >= 0 && value < maxLen) {
                return labels[value];
              }
              return null;
            }
          },
          offset: false // Desactivamos el offset para que las líneas verticales de la cuadrícula y las etiquetas coincidan EXACTAMENTE con los puntos graficados en enteros (0, 1, 2...)
        },
        y: { 
          grid: { color: 'rgba(255,255,255,0.05)' }, 
          min: -1, // Fija el mínimo inicial en -1 para dar holgura abajo desde el inicio sin poder panear más allá
          grace: 1, // Añade holgura arriba/abajo para que los emojis en los puntajes máximos/mínimos no se corten
          afterFit: function(scaleInstance) {
            scaleInstance.width = 45; // Fijar ancho del eje Y en 45px para evitar efecto de vibración/redimensión al aparecer/desaparecer decimales
          },
          ticks: { 
            color: '#9ca3af',
            callback: function(value) {
              // Ocultar etiquetas de valores negativos (aunque permitimos el paneo físico hacia abajo)
              if (value < 0) return null;
              // Mostrar solo valores enteros para evitar oscilación de decimales
              if (value % 1 === 0) return value;
              return null;
            }
          } 
        }
      }
    }
  });
  chartInstance.maxLen = maxLen;
  chartInstance.maxScore = maxScore;
  actualizarBotonesZoomState(chartInstance);
}

function renderizarPilasMonedas(ctx) {
  const visibleScoreboard = scoreboard.filter(usr => !hiddenUsernames.has(usr.username));
  const pyramidScoreboard = ordenarEnPiramide(visibleScoreboard);
  const maxPoints = Math.max(...scoreboard.map(u => u.puntaje_total), 10);

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: pyramidScoreboard.map(usr => usr.username),
      datasets: [
        {
          label: 'Puntos',
          data: pyramidScoreboard.map(usr => usr.puntaje_total),
          backgroundColor: pyramidScoreboard.map(usr => obtenerColorJugador(usr.username)),
          borderColor: pyramidScoreboard.map(usr => obtenerColorJugador(usr.username) + 'cc'),
          borderWidth: 1,
          borderRadius: { topLeft: 8, topRight: 8, bottomLeft: 0, bottomRight: 0 },
          borderSkipped: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      pyramidData: pyramidScoreboard,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#121522',
          titleColor: '#fbbf24',
          bodyColor: '#f3f4f6',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const usr = pyramidScoreboard[context.dataIndex];
              return `${usr.avatar_emoji || '⚽'} ${usr.username}: ${usr.puntaje_total} puntos`;
            }
          }
        },
        zoom: {
          zoom: {
            wheel: { enabled: false },
            pinch: { enabled: false }
          },
          pan: {
            enabled: false
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#9ca3af' }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af', precision: 0 },
          suggestedMin: 0,
          suggestedMax: maxPoints + 3
        }
      }
    },
    plugins: [barAvatarPlugin]
  });
}

function wrapUsername(username, maxLength = 15) {
  if (username.length <= maxLength) return [username];
  
  const words = username.split(' ');
  const lines = [];
  let currentLine = '';

  words.forEach(word => {
    if (word.length > maxLength) {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = '';
      }
      let remainingWord = word;
      while (remainingWord.length > maxLength) {
        lines.push(remainingWord.slice(0, maxLength));
        remainingWord = remainingWord.slice(maxLength);
      }
      currentLine = remainingWord;
    } else {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length > maxLength) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
  });

  if (currentLine) {
    lines.push(currentLine);
  }
  return lines;
}

function renderizarBarrasCategorias(ctx) {
  const visibleScoreboard = scoreboard.filter(usr => !hiddenUsernames.has(usr.username));

  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: visibleScoreboard.map(usr => {
        const label = `${usr.avatar_emoji || '⚽'} ${usr.username}`;
        return wrapUsername(label, 15);
      }),
      datasets: [
        {
          label: 'Tendencia',
          data: visibleScoreboard.map(usr => usr.desglose_puntos ? usr.desglose_puntos.tendencia : 0),
          backgroundColor: '#3b82f6',
          borderWidth: 0
        },
        {
          label: 'Goles por Selección',
          data: visibleScoreboard.map(usr => usr.desglose_puntos ? usr.desglose_puntos.goles : 0),
          backgroundColor: '#fbbf24',
          borderWidth: 0
        },
        {
          label: 'Pleno Perfecto',
          data: visibleScoreboard.map(usr => usr.desglose_puntos ? usr.desglose_puntos.pleno : 0),
          backgroundColor: '#10b981',
          borderWidth: 0
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: {
            color: '#f3f4f6',
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true,
            pointStyle: 'circle',
            font: {
              size: 11,
              weight: '600'
            }
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          backgroundColor: '#121522',
          titleColor: '#fbbf24',
          bodyColor: '#f3f4f6',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1
        },
        zoom: {
          zoom: {
            wheel: { enabled: false },
            pinch: { enabled: false }
          },
          pan: {
            enabled: false
          }
        }
      },
      scales: {
        x: {
          stacked: true,
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { color: '#9ca3af' }
        },
        y: {
          stacked: true,
          grid: { display: false },
          ticks: {
            color: '#f3f4f6',
            crossAlign: 'start',
            textAlign: 'left',
            padding: 8,
            font: {
              size: 12,
              weight: '600'
            }
          }
        }
      }
    },
    plugins: [stackedDatalabelsPlugin]
  });
}

function renderizarLegendCompartida() {
  const legendContainer = document.getElementById('chart-legend');
  if (!legendContainer) return;

  legendContainer.innerHTML = '';
  scoreboard.forEach((usr) => {
    const color = obtenerColorJugador(usr.username);
    const pill = document.createElement('div');
    pill.className = 'legend-pill';
    pill.style.borderColor = color;
    
    if (hiddenUsernames.has(usr.username)) {
      pill.classList.add('hidden');
    } else {
      pill.classList.remove('hidden');
    }

    pill.innerHTML = `
      <span class="legend-avatar">${usr.avatar_emoji || '⚽'}</span>
      <span class="legend-name">${escapeHtml(usr.username)}</span>
    `;

    pill.addEventListener('click', () => {
      if (hiddenUsernames.has(usr.username)) {
        hiddenUsernames.delete(usr.username);
      } else {
        hiddenUsernames.add(usr.username);
      }
      renderizarGraficoEvolucion();
    });

    legendContainer.appendChild(pill);
  });
}

// ─────────────────────────────────────────────
// LÓGICA DE SWITCH PESTAÑAS Y ESTADÍSTICAS DEL PERFIL
// ─────────────────────────────────────────────
let profileRadarChartInstance = null;

function toggleProfileViewTab(tab) {
  const historyContent = document.getElementById('profile-content-history');
  const statsContent = document.getElementById('profile-content-stats');
  const btnHistory = document.getElementById('btn-profile-tab-history');
  const btnStats = document.getElementById('btn-profile-tab-stats');

  if (!historyContent || !statsContent || !btnHistory || !btnStats) return;

  if (tab === 'history') {
    historyContent.style.display = 'block';
    statsContent.style.display = 'none';
    btnHistory.classList.add('active');
    btnStats.classList.remove('active');
  } else if (tab === 'stats') {
    historyContent.style.display = 'none';
    statsContent.style.display = 'block';
    btnHistory.classList.remove('active');
    btnStats.classList.add('active');
    
    // Dibujar el gráfico cuando el contenedor sea visible
    if (window.currentProfileData) {
      const stats = calcularEstadisticasPerfil(window.currentProfileData);
      renderizarRadarPerfil(window.currentProfileData.username, stats);
    }
  }
}

function calcularEstadisticasPerfil(data) {
  if (!data || !data.predicciones) {
    return {
      totalPuntos: 0,
      puntosGoles: 0,
      puntosTendencia: 0,
      plenos: 0,
      partidosErrados: 0,
      cantidadPrediccionesHechas: 0,
      porcentajeTendencia: 0,
      porcentajeGoles: 0,
      rachaAciertoMax: 0,
      rachaErrorMax: 0,
      promedioGolesPredichos: 0
    };
  }

  // Filtrar solo los partidos que finalizaron y tienen predicción no oculta
  const finishedPreds = data.predicciones.filter(item => 
    item.resultado_real && item.resultado_real.finalizado && item.prediccion && !item.prediccion.oculto
  );

  const totalPuntos = data.puntaje_total || 0;
  let puntosGoles = 0;
  let puntosTendencia = 0;
  let plenos = 0;
  let partidosErrados = 0;

  // Ordenar cronológicamente para calcular rachas
  const sortedFinishedPreds = [...finishedPreds].sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

  let rachaAciertoAct = 0;
  let rachaAciertoMax = 0;
  let rachaErrorAct = 0;
  let rachaErrorMax = 0;

  sortedFinishedPreds.forEach(item => {
    const glPred = parseInt(item.prediccion.goles_local_pred, 10);
    const gvPred = parseInt(item.prediccion.goles_visitante_pred, 10);
    const glReal = parseInt(item.resultado_real.goles_local, 10);
    const gvReal = parseInt(item.resultado_real.goles_visitante, 10);

    const tendenciaPred = Math.sign(glPred - gvPred);
    const tendenciaReal = Math.sign(glReal - gvReal);
    const correctoTendencia = (tendenciaPred === tendenciaReal);

    if (correctoTendencia) {
      puntosTendencia += 2;

      const desvioLocal = Math.abs(glPred - glReal);
      const desvioVisitante = Math.abs(gvPred - gvReal);

      let ptsLocal = (glReal === 0 && glPred === 0) ? 1 : Math.max(0, glReal - desvioLocal);
      let ptsVisitante = (gvReal === 0 && gvPred === 0) ? 1 : Math.max(0, gvReal - desvioVisitante);

      puntosGoles += (ptsLocal + ptsVisitante);

      const esPleno = (desvioLocal === 0 && desvioVisitante === 0);
      if (esPleno) {
        plenos++;
      }

      rachaAciertoAct++;
      rachaAciertoMax = Math.max(rachaAciertoMax, rachaAciertoAct);
      rachaErrorAct = 0;
    } else {
      partidosErrados++;

      rachaErrorAct++;
      rachaErrorMax = Math.max(rachaErrorMax, rachaErrorAct);
      rachaAciertoAct = 0;
    }
  });

  // Predicciones totales hechas (visibles/hechas)
  const cantidadPrediccionesHechas = data.predicciones.filter(item => 
    item.prediccion && !item.prediccion.oculto
  ).length;

  const totalPartidosFinalizadosConPred = finishedPreds.length;
  
  // Porcentaje aciertos de tendencia
  const porcentajeTendencia = totalPartidosFinalizadosConPred > 0
    ? (puntosTendencia / (2 * totalPartidosFinalizadosConPred)) * 100
    : 0;

  // Porcentaje goles acertados (cantidad de puntajes de equipo exactos)
  let golesAcertadosCount = 0;
  finishedPreds.forEach(item => {
    const glPred = parseInt(item.prediccion.goles_local_pred, 10);
    const gvPred = parseInt(item.prediccion.goles_visitante_pred, 10);
    const glReal = parseInt(item.resultado_real.goles_local, 10);
    const gvReal = parseInt(item.resultado_real.goles_visitante, 10);

    if (glPred === glReal) golesAcertadosCount++;
    if (gvPred === gvReal) golesAcertadosCount++;
  });

  const porcentajeGoles = totalPartidosFinalizadosConPred > 0
    ? (golesAcertadosCount / (2 * totalPartidosFinalizadosConPred)) * 100
    : 0;

  // Promedio goles predichos
  const allVisiblePreds = data.predicciones.filter(item => item.prediccion && !item.prediccion.oculto);
  let totalGolesPredichos = 0;
  allVisiblePreds.forEach(item => {
    totalGolesPredichos += (parseInt(item.prediccion.goles_local_pred, 10) || 0) + (parseInt(item.prediccion.goles_visitante_pred, 10) || 0);
  });
  const promedioGolesPredichos = allVisiblePreds.length > 0
    ? totalGolesPredichos / allVisiblePreds.length
    : 0;

  return {
    totalPuntos,
    puntosGoles,
    puntosTendencia,
    plenos,
    partidosErrados,
    cantidadPrediccionesHechas,
    porcentajeTendencia,
    porcentajeGoles,
    rachaAciertoMax,
    rachaErrorMax,
    promedioGolesPredichos
  };
}

function recargarEstadisticasPerfil(data) {
  const container = document.getElementById('profile-content-stats');
  if (!container) return;

  const stats = calcularEstadisticasPerfil(data);

  container.innerHTML = `
    <div class="profile-predictions-header">
      <h2>Estadísticas Totales</h2>
      <div class="privacy-note">
        <i class="fa-solid fa-chart-line"></i> Estadísticas calculadas en base a partidos finalizados.
      </div>
    </div>

    <div class="profile-stats-grid">
      <!-- Card 1: Puntos Totales -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #fbbf24; background-color: rgba(251, 191, 36, 0.1);">
          <i class="fa-solid fa-star"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Puntos Totales</span>
          <span class="stat-value">${stats.totalPuntos}</span>
        </div>
      </div>

      <!-- Card 2: Puntos por Goles -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #10b981; background-color: rgba(16, 185, 129, 0.1);">
          <i class="fa-solid fa-futbol"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Puntos por Goles</span>
          <span class="stat-value">${stats.puntosGoles}</span>
        </div>
      </div>

      <!-- Card 3: Puntos por Tendencia -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #3b82f6; background-color: rgba(59, 130, 246, 0.1);">
          <i class="fa-solid fa-arrow-trend-up"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Puntos por Tendencia</span>
          <span class="stat-value">${stats.puntosTendencia}</span>
        </div>
      </div>

      <!-- Card 4: Plenos -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #059669; background-color: rgba(5, 150, 105, 0.1);">
          <i class="fa-solid fa-bullseye"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Plenos (Marcador Exacto)</span>
          <span class="stat-value">${stats.plenos}</span>
        </div>
      </div>

      <!-- Card 5: Partidos Errados -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #ef4444; background-color: rgba(239, 68, 68, 0.1);">
          <i class="fa-solid fa-circle-xmark"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Partidos Errados</span>
          <span class="stat-value">${stats.partidosErrados}</span>
        </div>
      </div>

      <!-- Card 6: Predicciones Hechas -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #a855f7; background-color: rgba(168, 85, 247, 0.1);">
          <i class="fa-solid fa-pen-clip"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Predicciones Hechas</span>
          <span class="stat-value">${stats.cantidadPrediccionesHechas}</span>
        </div>
      </div>

      <!-- Card 7: Efectividad Tendencia -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #f97316; background-color: rgba(249, 115, 22, 0.1);">
          <i class="fa-solid fa-percentage"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Efectividad Tendencia</span>
          <span class="stat-value">${stats.porcentajeTendencia.toFixed(1)}%</span>
        </div>
      </div>

      <!-- Card 8: Efectividad Goles -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #06b6d4; background-color: rgba(6, 182, 212, 0.1);">
          <i class="fa-solid fa-crosshairs"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Efectividad Goles</span>
          <span class="stat-value">${stats.porcentajeGoles.toFixed(1)}%</span>
        </div>
      </div>

      <!-- Card 9: Racha Positiva Máxima -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #f59e0b; background-color: rgba(245, 158, 11, 0.1);">
          <i class="fa-solid fa-fire-flame-curved"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Racha Positiva Máxima</span>
          <span class="stat-value">${stats.rachaAciertoMax} <span class="stat-value-sub">part.</span></span>
        </div>
      </div>

      <!-- Card 10: Racha Negativa Máxima -->
      <div class="profile-stat-card">
        <div class="stat-icon" style="color: #64748b; background-color: rgba(100, 116, 139, 0.1);">
          <i class="fa-solid fa-heart-crack"></i>
        </div>
        <div class="stat-info-wrap">
          <span class="stat-label">Racha Negativa Máxima</span>
          <span class="stat-value">${stats.rachaErrorMax} <span class="stat-value-sub">part.</span></span>
        </div>
      </div>
    </div>

    <!-- Gráfico de Radar -->
    <div class="profile-radar-card">
      <h3>Habilidades de Pronóstico</h3>
      <p class="chart-subtitle">Análisis visual de tu desempeño en base a tus predicciones.</p>
      <div class="radar-chart-container" style="position: relative; height: 460px; width: 100%; max-width: 520px; margin: 0 auto;">
        <canvas id="profileRadarChart"></canvas>
      </div>
    </div>
  `;
}

function renderizarRadarPerfil(username, stats) {
  const canvas = document.getElementById('profileRadarChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  
  if (profileRadarChartInstance) {
    profileRadarChartInstance.destroy();
  }

  const isArgentina = document.body.classList.contains('argentina-mode');
  const textColor = isArgentina ? '#2d5080' : '#9ca3af';
  const gridColor = isArgentina ? 'rgba(30, 107, 184, 0.15)' : 'rgba(255, 255, 255, 0.08)';

  // Definir paleta de color adaptada al tema
  const primaryColor = isArgentina ? '#1e6bb8' : '#3b82f6';
  const primaryGlow = isArgentina ? 'rgba(30, 107, 184, 0.2)' : 'rgba(59, 130, 246, 0.2)';

  // Extraer valores crudos
  const porcentajeGoles = stats.porcentajeGoles;
  const porcentajeTendencia = stats.porcentajeTendencia;
  const rachaAciertoMax = stats.rachaAciertoMax;
  const rachaErrorMax = stats.rachaErrorMax;
  const promedioGolesPredichos = stats.promedioGolesPredichos;

  // Normalizar datos sobre escala [0 - 100]
  const normalizedData = [
    porcentajeGoles,
    porcentajeTendencia,
    Math.min(100, rachaAciertoMax * 10),
    Math.min(100, rachaErrorMax * 10),
    Math.min(100, promedioGolesPredichos * 20)
  ];

  // Ajustes de tamaño responsivos para celulares
  const isMobile = window.innerWidth <= 768;
  const isSmallMobile = window.innerWidth <= 480;

  const labels = isMobile
    ? ['Goles', 'Tendencia', 'Racha (+)', 'Racha (-)', 'Goles Prom.']
    : ['Acierto Goles', 'Tendencias', 'Racha (+)', 'Racha (-)', 'Prom. Goles'];

  const labelPadding = isMobile ? -18 : 10;
  const pointLabelFontSize = isSmallMobile ? 8.5 : (isMobile ? 9 : 10);
  const layoutPadding = isMobile ? 0 : 15;

  profileRadarChartInstance = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Rendimiento',
        data: normalizedData,
        backgroundColor: primaryGlow,
        borderColor: primaryColor,
        borderWidth: 2,
        pointBackgroundColor: primaryColor,
        pointBorderColor: isArgentina ? '#fff' : '#1e1b4b',
        pointHoverBackgroundColor: isArgentina ? '#1e6bb8' : '#fff',
        pointHoverBorderColor: primaryColor
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: layoutPadding
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#121522',
          titleColor: '#fbbf24',
          bodyColor: '#f3f4f6',
          borderColor: 'rgba(255,255,255,0.08)',
          borderWidth: 1,
          callbacks: {
            label: function(context) {
              const idx = context.dataIndex;
              const rawValues = [
                `${porcentajeGoles.toFixed(1)}%`,
                `${porcentajeTendencia.toFixed(1)}%`,
                `${rachaAciertoMax} ${rachaAciertoMax === 1 ? 'partido' : 'partidos'}`,
                `${rachaErrorMax} ${rachaErrorMax === 1 ? 'partido' : 'partidos'}`,
                `${promedioGolesPredichos.toFixed(2)} goles`
              ];
              return `${context.label}: ${rawValues[idx]}`;
            }
          }
        }
      },
      scales: {
        r: {
          min: 0,
          max: 100,
          ticks: {
            stepSize: 25,
            display: false,
            color: textColor,
            backdropColor: 'transparent'
          },
          grid: {
            color: gridColor
          },
          angleLines: {
            color: gridColor
          },
          pointLabels: {
            color: textColor,
            padding: labelPadding,
            font: {
              family: 'Inter',
              size: pointLabelFontSize,
              weight: '600'
            }
          }
        }
      }
    }
  });
}

// ==========================================
// VISTA DETALLES PERFIL (CON PRIVACIDAD ESTRICTA Y SOPORTE BRACKETS)
// ==========================================
async function verPerfil(username) {
  if (!currentUser) return;
  try {
    const viewer = currentUser.username;
    const response = await fetch(`/api/profile/${username}?viewer=${viewer}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    activeTab = 'profile';
    navegarTab('profile');

    document.getElementById('profile-username').textContent = data.username;
    document.getElementById('profile-avatar').textContent = data.avatar_emoji;
    document.getElementById('profile-points').textContent = data.puntaje_total;

    // Mostrar botón de cerrar sesión únicamente si es nuestro propio perfil
    const isMe = data.username === currentUser.username;
    const profileLogoutBtn = document.getElementById('profile-logout-btn');
    if (profileLogoutBtn) {
      profileLogoutBtn.style.display = isMe ? 'flex' : 'none';
    }

    // Mostrar botón de edición de avatar únicamente si es nuestro propio perfil
    const btnEditAvatar = document.getElementById('btn-edit-avatar');
    if (btnEditAvatar) {
      btnEditAvatar.style.display = isMe ? 'flex' : 'none';
    }

    // Mostrar botón de edición de nombre únicamente si es nuestro propio perfil
    const btnEditUsername = document.getElementById('btn-edit-username');
    if (btnEditUsername) {
      btnEditUsername.style.display = isMe ? 'inline-flex' : 'none';
    }

    // Mostrar botón de cambio de contraseña únicamente si es nuestro propio perfil
    const btnEditPassword = document.getElementById('profile-password-btn');
    if (btnEditPassword) {
      btnEditPassword.style.display = isMe ? 'flex' : 'none';
    }

    // Renderizar Top 3
    const top3Display = document.getElementById('profile-top3-display');
    top3Display.innerHTML = '';
    
    if (data.prediccion_top3) {
      const top3 = data.prediccion_top3;
      const esOculto = !!top3.oculto;
      top3Display.innerHTML = `
        <div class="top3-display-item ${esOculto ? 'oculto' : ''}">
          <span class="pos text-gold">1°</span>
          <span class="team">${top3.puesto_1}</span>
        </div>
        <div class="top3-display-item ${esOculto ? 'oculto' : ''}">
          <span class="pos text-slate">2°</span>
          <span class="team">${top3.puesto_2}</span>
        </div>
        <div class="top3-display-item ${esOculto ? 'oculto' : ''}">
          <span class="pos text-amber">3°</span>
          <span class="team">${top3.puesto_3}</span>
        </div>
      `;
    } else {
      top3Display.innerHTML = `<div class="privacy-note w-full text-center" style="grid-column: span 3;"><i class="fa-solid fa-circle-exclamation"></i> Este usuario no ha registrado su predicción de Top 3.</div>`;
    }

    window.currentProfileData = data;
    
    // Resetear modo de ordenamiento del perfil a Fecha por defecto
    profileSortMode = 'fecha';
    const btnProfileSortFecha = document.getElementById('btn-profile-sort-fecha');
    const btnProfileSortGrupo = document.getElementById('btn-profile-sort-grupo');
    if (btnProfileSortFecha && btnProfileSortGrupo) {
      btnProfileSortFecha.classList.add('active');
      btnProfileSortGrupo.classList.remove('active');
    }
    
    recargarPrediccionesPerfil(data.username);
    recargarEstadisticasPerfil(data);
    toggleProfileViewTab('stats');

  } catch (error) {
    showToast(error.message, 'error');
  }
}

function recargarPrediccionesPerfil(username) {
  const data = window.currentProfileData;
  if (!data) return;

  const container = document.getElementById('profile-partidos-list');
  container.innerHTML = '';

  container.innerHTML = '';

  // Helper: determine points color class
  function puntosColorClass(item) {
    if (!item.resultado_real || !item.resultado_real.finalizado) return '';
    if (!item.prediccion || item.prediccion.oculto) return '';
    const glPred = parseInt(item.prediccion.goles_local_pred, 10);
    const gvPred = parseInt(item.prediccion.goles_visitante_pred, 10);
    const glReal = parseInt(item.resultado_real.goles_local, 10);
    const gvReal = parseInt(item.resultado_real.goles_visitante, 10);
    
    const esKnockout = item.partido_id.startsWith('ko_');
    if (glPred === glReal && gvPred === gvReal) {
      if (esKnockout && glPred === gvPred) {
        if (item.prediccion.ganador_pred === item.resultado_real.ganador_real) {
          return 'pts-exact';
        } else {
          return 'pts-miss';
        }
      }
      return 'pts-exact';
    }
    
    let acertoTendencia = false;
    if (esKnockout) {
      const winnerPred = glPred > gvPred ? 'local' : (glPred < gvPred ? 'visitante' : item.prediccion.ganador_pred);
      const winnerReal = glReal > gvReal ? 'local' : (glReal < gvReal ? 'visitante' : item.resultado_real.ganador_real);
      acertoTendencia = (winnerPred && winnerReal && winnerPred === winnerReal);
    } else {
      acertoTendencia = Math.sign(glPred - gvPred) === Math.sign(glReal - gvReal);
    }
    if (acertoTendencia) return 'pts-tendency';
    return 'pts-miss';
  }

  function formatFechaCorta(fechaISO) {
    const d = new Date(fechaISO);
    return d.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: '2-digit', month: '2-digit' });
  }


  function buildTableSection(titulo, icono, items, esMataMata = false) {
    if (items.length === 0) return null;

    // Sort by date
    items.sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

    const section = document.createElement('div');
    section.className = 'profile-table-section';

    const header = document.createElement('div');
    header.className = 'profile-table-section-header';
    header.innerHTML = `<i class="${icono}"></i> ${titulo}`;
    section.appendChild(header);

    const tableWrap = document.createElement('div');
    tableWrap.className = 'profile-table-wrap';

    const table = document.createElement('table');
    table.className = 'profile-pred-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Partido</th>
          <th>PRED</th>
          <th>Real</th>
          <th>Pts</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement('tbody');

    items.forEach(item => {
      const tr = document.createElement('tr');

      const fecha = formatFechaCorta(item.fecha_inicio);
      const loc = codigoFIFA(item.equipo_local);
      const vis = codigoFIFA(item.equipo_visitante);
      const flagL = obtenerEmojiBandera(item.equipo_local);
      const flagV = obtenerEmojiBandera(item.equipo_visitante);
      const partido = `<span class="ppt-partido-nombre"><span class="ppt-fecha-inline">${fecha}</span> <span class="ppt-flag-l">${flagL}</span>${loc} <span class="ppt-vs">-</span> ${vis}<span class="ppt-flag-v">${flagV}</span></span>`;

      let predText = '-';
      if (item.prediccion) {
        if (item.prediccion.oculto) {
          predText = '🔒';
        } else {
          const gl = item.prediccion.goles_local_pred;
          const gv = item.prediccion.goles_visitante_pred;
          if (esMataMata) {
            let winPred = '';
            if (gl > gv) winPred = 'local';
            else if (gl < gv) winPred = 'visitante';
            else winPred = item.prediccion.ganador_pred;

            const styleL = winPred === 'local' ? 'class="winner-underlined"' : '';
            const styleV = winPred === 'visitante' ? 'class="winner-underlined"' : '';
            predText = `<span ${styleL}>${gl}</span>-<span ${styleV}>${gv}</span>`;
          } else {
            predText = `${gl}-${gv}`;
          }
        }
      }

      let realText = '-';
      if (item.resultado_real && item.resultado_real.finalizado) {
        const gl = item.resultado_real.goles_local;
        const gv = item.resultado_real.goles_visitante;
        if (esMataMata) {
          let winReal = '';
          if (gl > gv) winReal = 'local';
          else if (gl < gv) winReal = 'visitante';
          else winReal = item.resultado_real.ganador_real;

          const styleL = winReal === 'local' ? 'class="winner-underlined"' : '';
          const styleV = winReal === 'visitante' ? 'class="winner-underlined"' : '';
          realText = `<span ${styleL}>${gl}</span> - <span ${styleV}>${gv}</span>`;
        } else {
          realText = `${gl} - ${gv}`;
        }
      }

      let ptsText = '-';
      let colorClass = '';
      if (item.resultado_real && item.resultado_real.finalizado && item.prediccion && !item.prediccion.oculto) {
        const pts = item.puntos_ganados !== undefined ? item.puntos_ganados : 0;
        ptsText = pts > 0 ? `+${pts}` : '0';
        colorClass = puntosColorClass(item);
      }

      tr.innerHTML = `
        <td class="ppt-partido">${partido}</td>
        <td class="ppt-pred">${predText}</td>
        <td class="ppt-real">${realText}</td>
        <td class="ppt-pts ${colorClass}">${ptsText}</td>
      `;
      if (item.resultado_real && item.resultado_real.finalizado) {
        tr.classList.add('clickable-history-row');
        tr.addEventListener('click', () => {
          mostrarModalFormula(item);
        });
      }
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tableWrap.appendChild(table);
    section.appendChild(tableWrap);
    return section;
  }

  // Separate groups vs knockout
  const predsGrupos = data.predicciones.filter(item => item.partido_id.startsWith('p_'));
  const predsKO = data.predicciones.filter(item => item.partido_id.startsWith('ko_'));

  // Total points across all finished matches
  let totalPuntos = 0;
  data.predicciones.forEach(item => {
    if (item.resultado_real && item.resultado_real.finalizado && item.prediccion && !item.prediccion.oculto) {
      totalPuntos += (item.puntos_ganados || 0);
    }
  });

  const gruposSection = buildTableSection('Fase de Grupos', 'fa-solid fa-table-cells', predsGrupos, false);
  if (gruposSection) container.appendChild(gruposSection);

  const koSection = buildTableSection('Mata Mata', 'fa-solid fa-sitemap', predsKO, true);
  if (koSection) container.appendChild(koSection);

  // Total row
  const totalDiv = document.createElement('div');
  totalDiv.className = 'profile-table-total';
  totalDiv.innerHTML = `<span><i class="fa-solid fa-star"></i> Total puntos de partidos</span><span class="profile-table-total-pts">${totalPuntos}</span>`;
  container.appendChild(totalDiv);

  // (legacy accordion code removed)
}

function mostrarModalFormula(item) {
  const modal = document.getElementById('modal-formula-puntos');
  const body = document.getElementById('modal-formula-body');
  if (!modal || !body) return;

  const flagL = obtenerEmojiBandera(item.equipo_local);
  const flagV = obtenerEmojiBandera(item.equipo_visitante);
  const esMe = window.currentProfileData ? window.currentProfileData.username === currentUser.username : false;
  
  let headerHtml = `
    <div style="text-align: center; margin-bottom: 0.5rem; padding-bottom: 0.5rem; border-bottom: 1px dashed rgba(255,255,255,0.06);">
      <div style="font-size: 0.75rem; color: var(--text-sub); text-transform: uppercase; margin-bottom: 0.2rem;">${item.fase}</div>
      <div style="font-size: 1.1rem; font-weight: 700; display: flex; align-items: center; justify-content: center; gap: 0.5rem;">
        <span>${flagL} ${item.equipo_local}</span>
        <span style="color: var(--text-sub); font-size: 0.8rem; font-weight: 400;">vs</span>
        <span>${item.equipo_visitante} ${flagV}</span>
      </div>
    </div>
  `;

  if (!item.prediccion || item.prediccion.oculto) {
    const prName = esMe ? 'No realizaste ninguna predicción' : `El usuario ${window.currentProfileData ? window.currentProfileData.username : ''} no realizó ninguna predicción`;
    body.innerHTML = `
      ${headerHtml}
      <div style="text-align: center; padding: 1.5rem 1rem; color: var(--text-sub); display: flex; flex-direction: column; gap: 0.5rem; align-items: center;">
        <i class="fa-solid fa-circle-info" style="font-size: 2rem; color: var(--color-primary); opacity: 0.7;"></i>
        <div style="font-weight: 600; font-size: 0.95rem; color: var(--text-main); margin-top: 0.3rem;">${prName} para este partido.</div>
        <div style="font-size: 0.8rem;">Los marcadores y la fórmula de cálculo solo se habilitan para predicciones hechas.</div>
      </div>
    `;
    modal.style.display = 'flex';
    return;
  }

  const glPred = parseInt(item.prediccion.goles_local_pred, 10);
  const gvPred = parseInt(item.prediccion.goles_visitante_pred, 10);
  const glReal = parseInt(item.resultado_real.goles_local, 10);
  const gvReal = parseInt(item.resultado_real.goles_visitante, 10);
  const ganadorPred = item.prediccion.ganador_pred || '';
  const ganadorReal = item.resultado_real.ganador_real || '';
  const esKnockout = item.partido_id.startsWith('ko_');

  // Calcular desgloses
  let ptsTendencia = 0;
  let tendenciaDescripcion = '';
  
  if (esKnockout) {
    const realFuiAPenales = glReal === gvReal;
    const predFuiAPenales = glPred === gvPred;
    const winnerPred = glPred > gvPred ? 'local' : (glPred < gvPred ? 'visitante' : ganadorPred);
    const winnerReal = glReal > gvReal ? 'local' : (glReal < gvReal ? 'visitante' : ganadorReal);

    if (realFuiAPenales) {
      if (predFuiAPenales) {
        ptsTendencia = 2; // base por penales
        tendenciaDescripcion = 'Acertaste que se definía por penales (+2 pts)';
        if (winnerPred && winnerReal && winnerPred === winnerReal) {
          ptsTendencia += 1; // extra por ganador
          tendenciaDescripcion = 'Acertaste definición por penales y ganador (+3 pts)';
        }
      } else {
        if (winnerPred && winnerReal && winnerPred === winnerReal) {
          ptsTendencia = 1;
          tendenciaDescripcion = 'Acertaste el clasificado, pero no la victoria directa (+1 pt)';
        } else {
          tendenciaDescripcion = 'Le erraste al equipo clasificado (se definió por penales) (+0 pts)';
        }
      }
    } else {
      if (!predFuiAPenales) {
        if (winnerPred && winnerReal && winnerPred === winnerReal) {
          ptsTendencia = 2;
          tendenciaDescripcion = 'Acertaste victoria directa en tiempo de juego (+2 pts)';
        } else {
          tendenciaDescripcion = 'Le erraste al ganador (se definió en tiempo de juego) (+0 pts)';
        }
      } else {
        tendenciaDescripcion = 'Predijiste penales pero terminó en victoria directa (+0 pts)';
      }
    }
  } else {
    const tendenciaPred = Math.sign(glPred - gvPred);
    const tendenciaReal = Math.sign(glReal - gvReal);
    if (tendenciaPred === tendenciaReal) {
      ptsTendencia = 2;
      tendenciaDescripcion = tendenciaPred === 0 ? 'Acertaste el empate (+2 pts)' : 'Acertaste el equipo ganador (+2 pts)';
    } else {
      tendenciaDescripcion = 'Le erraste al ganador o empate (+0 pts)';
    }
  }

  let ptsLocal = 0;
  let ptsVisitante = 0;
  let ptsPleno = 0;
  let desvioLocal = Math.abs(glPred - glReal);
  let desvioVisitante = Math.abs(gvPred - gvReal);

  let descLocal = '';
  let descVisitante = '';

  if (ptsTendencia > 0) {
    if (glReal === 0 && glPred === 0) {
      ptsLocal = 1;
      descLocal = 'Arco en cero acertado: +1 pt';
    } else {
      ptsLocal = Math.max(0, glReal - desvioLocal);
      descLocal = `Goles reales: ${glReal} - Desvío goles: ${desvioLocal} = +${ptsLocal} pt(s)`;
    }

    if (gvReal === 0 && gvPred === 0) {
      ptsVisitante = 1;
      descVisitante = 'Arco en cero acertado: +1 pt';
    } else {
      ptsVisitante = Math.max(0, gvReal - desvioVisitante);
      descVisitante = `Goles reales: ${gvReal} - Desvío goles: ${desvioVisitante} = +${ptsVisitante} pt(s)`;
    }

    ptsPleno = (desvioLocal === 0 && desvioVisitante === 0) ? 2 : 0;
  } else {
    descLocal = 'No se suman goles porque la tendencia es incorrecta (0 pts)';
    descVisitante = 'No se suman goles porque la tendencia es incorrecta (0 pts)';
  }

  const ptsTotal = ptsTendencia + ptsLocal + ptsVisitante + ptsPleno;

  // Formateo del marcador del pred y real en el modal
  let textPredScore = `${glPred} - ${gvPred}`;
  let textRealScore = `${glReal} - ${gvReal}`;
  if (esKnockout) {
    const predWinner = glPred > gvPred ? 'local' : (glPred < gvPred ? 'visitante' : ganadorPred);
    const realWinner = glReal > gvReal ? 'local' : (glReal < gvReal ? 'visitante' : ganadorReal);

    const lPredU = predWinner === 'local' ? 'style="text-decoration: underline; text-decoration-color: #10b981; font-weight: bold;"' : '';
    const vPredU = predWinner === 'visitante' ? 'style="text-decoration: underline; text-decoration-color: #10b981; font-weight: bold;"' : '';
    const lRealU = realWinner === 'local' ? 'style="text-decoration: underline; text-decoration-color: #fbbf24; font-weight: bold;"' : '';
    const vRealU = realWinner === 'visitante' ? 'style="text-decoration: underline; text-decoration-color: #fbbf24; font-weight: bold;"' : '';
    
    textPredScore = `<span ${lPredU}>${glPred}</span> - <span ${vPredU}>${gvPred}</span>`;
    textRealScore = `<span ${lRealU}>${glReal}</span> - <span ${vRealU}>${gvReal}</span>`;
  }

  body.innerHTML = `
    ${headerHtml}
    
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; text-align: center; margin-bottom: 0.5rem; padding: 0.5rem; background: rgba(255,255,255,0.02); border-radius: 6px;">
      <div>
        <div style="font-size: 0.72rem; color: var(--text-sub); text-transform: uppercase;">Tu predicción</div>
        <div style="font-size: 1.1rem; font-weight: 700; margin-top: 0.2rem;">${textPredScore}</div>
      </div>
      <div>
        <div style="font-size: 0.72rem; color: var(--text-sub); text-transform: uppercase;">Resultado real</div>
        <div style="font-size: 1.1rem; font-weight: 700; margin-top: 0.2rem; color: var(--color-gold);">${textRealScore}</div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 0.6rem;">
      <div style="padding: 0.4rem 0.6rem; border-left: 3px solid #3b82f6; background: rgba(59, 130, 246, 0.05); border-radius: 0 4px 4px 0;">
        <div style="font-weight: 600; display: flex; justify-content: space-between;">
          <span>1. Acierto de Tendencia</span>
          <span style="color: #3b82f6;">+${ptsTendencia} pt(s)</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 0.15rem;">${tendenciaDescripcion}</div>
      </div>

      <div style="padding: 0.4rem 0.6rem; border-left: 3px solid #10b981; background: rgba(16, 185, 129, 0.05); border-radius: 0 4px 4px 0;">
        <div style="font-weight: 600; display: flex; justify-content: space-between;">
          <span>2. Goles Local (${item.equipo_local})</span>
          <span style="color: #10b981;">+${ptsLocal} pt(s)</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 0.15rem;">${descLocal}</div>
      </div>

      <div style="padding: 0.4rem 0.6rem; border-left: 3px solid #10b981; background: rgba(16, 185, 129, 0.05); border-radius: 0 4px 4px 0;">
        <div style="font-weight: 600; display: flex; justify-content: space-between;">
          <span>3. Goles Visitante (${item.equipo_visitante})</span>
          <span style="color: #10b981;">+${ptsVisitante} pt(s)</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 0.15rem;">${descVisitante}</div>
      </div>

      <div style="padding: 0.4rem 0.6rem; border-left: 3px solid #f59e0b; background: rgba(245, 158, 11, 0.05); border-radius: 0 4px 4px 0;">
        <div style="font-weight: 600; display: flex; justify-content: space-between;">
          <span>4. Bonus Pleno Total (Resultado Exacto)</span>
          <span style="color: #f59e0b;">+${ptsPleno} pt(s)</span>
        </div>
        <div style="font-size: 0.75rem; color: var(--text-sub); margin-top: 0.15rem;">
          ${ptsPleno > 0 ? '¡Resultado exacto acertado! (+2 pts)' : 'Resultado no exacto (+0 pts)'}
        </div>
      </div>

      <div style="margin-top: 0.4rem; padding: 0.6rem; border-top: 2px solid var(--border-glass); display: flex; justify-content: space-between; align-items: center; font-size: 1.05rem; font-weight: 700;">
        <span>Puntaje Total Sumado</span>
        <span style="color: var(--color-gold); font-size: 1.25rem;">+${ptsTotal} pt(s)</span>
      </div>
    </div>
  `;

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

// ==========================================
// ADMINISTRACIÓN
// ==========================================

// Filtra el dropdown de partidos de admin según la fase seleccionada
function actualizarComboPartidosAdmin() {
  const adminPartidoId = document.getElementById('admin-partido-id');
  const adminFase = document.getElementById('admin-fase');
  if (!adminPartidoId || !adminFase) return;

  const faseSeleccionada = adminFase.value;
  const selectedId = adminPartidoId.value;

  adminPartidoId.innerHTML = '<option value="new">-- Crear/Seleccionar Partido --</option>';

  const partidosFiltrados = faseSeleccionada
    ? partidos.filter(p => p.fase === faseSeleccionada)
    : partidos;

  partidosFiltrados.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.partido_id;
    opt.textContent = `[${p.partido_id.toUpperCase()}] ${p.equipo_local} vs ${p.equipo_visitante}`;
    adminPartidoId.appendChild(opt);
  });

  // Restaurar la selección previa si aún existe en la lista filtrada
  if (selectedId && partidosFiltrados.some(p => p.partido_id === selectedId)) {
    adminPartidoId.value = selectedId;
  }
}

function actualizarGanadorRealAdmin() {
  const fase = document.getElementById('admin-fase').value;
  const golesLocal = document.getElementById('admin-goles-local').value;
  const golesVis = document.getElementById('admin-goles-vis').value;
  const row = document.getElementById('admin-ganador-real-row');
  
  if (row) {
    if (fase && fase !== 'Fase de Grupos' && golesLocal !== '' && golesVis !== '' && parseInt(golesLocal, 10) === parseInt(golesVis, 10)) {
      row.style.display = 'flex';
    } else {
      row.style.display = 'none';
      const selector = document.getElementById('admin-ganador-real');
      if (selector) selector.value = '';
    }
  }
}
window.actualizarGanadorRealAdmin = actualizarGanadorRealAdmin;

async function cargarAdminConfig() {
  if (!isAdmin(currentUser)) return;

  try {
    // Cargar partidos en el selector de admin (filtrados por fase seleccionada)
    actualizarComboPartidosAdmin();

    // Cargar podio real
    const top3Res = await fetch('/api/admin/top3');
    if (top3Res.ok) {
      const top3Data = await top3Res.json();
      if (top3Data) {
        if (document.getElementById('admin-top3-p1')) document.getElementById('admin-top3-p1').value = top3Data.puesto_1 || '';
        if (document.getElementById('admin-top3-p2')) document.getElementById('admin-top3-p2').value = top3Data.puesto_2 || '';
        if (document.getElementById('admin-top3-p3')) document.getElementById('admin-top3-p3').value = top3Data.puesto_3 || '';
      }
    }

  } catch (error) {
    showToast('Error al cargar config admin: ' + error.message, 'error');
  }
}
window.verPerfil = verPerfil;

// crearProfilePartidoCard removed — profile now uses table rendering



// ==========================================
// PÁLPITOS EN VIVO EN SCOREBOARD
// ==========================================
function actualizarPalpitosEnVivoScoreboard() {
  const card = document.getElementById('scoreboard-palpitos-card');
  const list = document.getElementById('scoreboard-palpitos-list');
  if (!card || !list) return;

  if (!partidos || partidos.length === 0) {
    fetch('/api/partidos')
      .then(res => res.json())
      .then(data => {
        partidos = data.partidos;
        renderPalpitosScoreboard(partidos, card, list);
      })
      .catch(err => console.error('Error cargando pálpitos en posiciones:', err));
  } else {
    renderPalpitosScoreboard(partidos, card, list);
  }
}

function renderPalpitosScoreboard(partidosList, card, list) {
  list.innerHTML = '';
  
  // Buscar partidos en juego: ya comenzaron pero no finalizaron
  const partidosEnJuego = partidosList
    .filter(p => !p.predecible && !p.finalizado)
    .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));

  let partidosAMostrar = [];

  if (partidosEnJuego.length > 0) {
    // Si hay partidos en juego, obtener el de fecha_inicio más reciente
    const maxFecha = new Date(partidosEnJuego[partidosEnJuego.length - 1].fecha_inicio).getTime();
    // Y mostramos todos los que compartan esa misma hora de inicio
    partidosAMostrar = partidosEnJuego.filter(p => new Date(p.fecha_inicio).getTime() === maxFecha);
  } else {
    // Si no hay partidos en juego, mostrar el último partido que ya no es predecible
    const partidosComenzados = partidosList
      .filter(p => !p.predecible)
      .sort((a, b) => new Date(a.fecha_inicio) - new Date(b.fecha_inicio));
    if (partidosComenzados.length > 0) {
      const maxFecha = new Date(partidosComenzados[partidosComenzados.length - 1].fecha_inicio).getTime();
      partidosAMostrar = partidosComenzados.filter(p => new Date(p.fecha_inicio).getTime() === maxFecha);
    }
  }

  const btnShowAudit = document.getElementById('btn-show-scoreboard-audit');

  if (partidosAMostrar.length === 0) {
    card.style.display = 'none';
    ultimoPartidoComenzadoId = null;
    ultimoPartidoComenzadoTexto = '';
    partidosAuditoria = [];
    indiceAuditoriaActual = 0;
    if (btnShowAudit) btnShowAudit.style.display = 'none';
    return;
  }

  card.style.display = 'block';

  // Guardamos el partido actual para la auditoría de la scoreboard
  partidosAuditoria = partidosAMostrar;
  indiceAuditoriaActual = 0;

  const pSelected = partidosAuditoria[0];
  ultimoPartidoComenzadoId = pSelected.partido_id;
  ultimoPartidoComenzadoTexto = `${pSelected.equipo_local} vs ${pSelected.equipo_visitante}`;

  if (btnShowAudit) {
    btnShowAudit.style.display = 'inline-flex';
  }

  partidosAMostrar.forEach(partido => {
    const item = document.createElement('div');
    item.className = 'scoreboard-palpito-item';

    const header = document.createElement('div');
    header.className = 'scoreboard-palpito-item-header';
    
    let statusText = '';
    if (partido.finalizado) {
      statusText = `<span style="color: var(--color-text-muted);"><i class="fa-solid fa-circle-check" style="color: var(--color-green); margin-right: 0.25rem;"></i> Finalizado</span>`;
    } else {
      statusText = `<span><i class="fa-solid fa-circle-play" style="color: var(--color-red); margin-right: 0.25rem; animation: livePulse 1.5s infinite;"></i> En disputa</span>`;
    }

    header.innerHTML = `
      <span>${partido.fase}</span>
      ${statusText}
    `;
    item.appendChild(header);

    const teams = document.createElement('div');
    teams.className = 'scoreboard-palpito-item-teams';
    teams.style.setProperty('display', 'flex', 'important');
    teams.style.setProperty('flex-direction', 'row', 'important');
    teams.style.setProperty('justify-content', 'space-between', 'important');
    teams.style.setProperty('align-items', 'center', 'important');
    teams.style.setProperty('width', '100%', 'important');
    teams.style.setProperty('flex-wrap', 'nowrap', 'important');
    teams.style.setProperty('gap', '0.4rem', 'important');

    let vsHTML = 'vs';
    if (partido.finalizado) {
      vsHTML = `<strong class="final-score-badge" style="font-size: 1.2rem; color: var(--color-warning); background: rgba(251, 191, 36, 0.1); padding: 0.2rem 0.6rem; border-radius: 6px; margin: 0 0.5rem;">${partido.goles_local_real} - ${partido.goles_visitante_real}</strong>`;
    }

    teams.innerHTML = `
      <div class="equipo" style="display: flex !important; flex-direction: row !important; align-items: center !important; gap: 0.4rem; flex: 1; min-width: 0; justify-content: flex-start !important; white-space: nowrap;">
        <span class="flag-emoji">${obtenerEmojiBandera(partido.equipo_local)}</span>
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem;">${partido.equipo_local}</span>
      </div>
      <span class="vs">${vsHTML}</span>
      <div class="equipo" style="display: flex !important; flex-direction: row !important; align-items: center !important; gap: 0.4rem; flex: 1; min-width: 0; justify-content: flex-end !important; white-space: nowrap;">
        <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 0.95rem; text-align: right;">${partido.equipo_visitante}</span>
        <span class="flag-emoji">${obtenerEmojiBandera(partido.equipo_visitante)}</span>
      </div>
    `;
    item.appendChild(teams);

    const palpitoContainer = document.createElement('div');
    palpitoContainer.className = 'palpito-container';
    palpitoContainer.style.display = 'block';
    palpitoContainer.style.marginTop = '0.5rem';
    item.appendChild(palpitoContainer);

    list.appendChild(item);

    if (partido.palpito && partido.palpito.total_votos > 0) {
      renderizarPalpito(palpitoContainer, partido);
    } else {
      palpitoContainer.innerHTML = '<div style="text-align: center; font-size: 0.8rem; color: var(--text-sub);">Sin predicciones registradas para este partido.</div>';
    }
  });

  inicializarAuditoriaScoreboard();
}

function inicializarAuditoriaScoreboard() {
  const container = document.getElementById('scoreboard-main-card-container');
  if (!container || container.dataset.listenerBound === 'true') return;
  container.dataset.listenerBound = 'true';

  const btnShow = document.getElementById('btn-show-scoreboard-audit');
  const btnClose = document.getElementById('btn-close-scoreboard-audit');

  const mostrarAuditoriaActual = () => {
    const partidoActual = partidosAuditoria[indiceAuditoriaActual];
    if (!partidoActual) return;

    const subtitleText = document.getElementById('audit-match-subtitle');
    if (subtitleText) {
      subtitleText.textContent = `${partidoActual.equipo_local} vs ${partidoActual.equipo_visitante}`;
    }

    const tbody = document.getElementById('scoreboard-audit-body');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-sub); padding: 2rem;">Cargando auditoría...</td></tr>';
      cargarAuditoriaPartido(partidoActual.partido_id, tbody);
    }
  };

  const flipCard = () => {
    if (!partidosAuditoria || partidosAuditoria.length === 0) {
      showToast('No hay pálpitos disponibles para auditar todavía.', 'info');
      return;
    }

    const isFlipped = container.classList.contains('flipped');

    if (!isFlipped) {
      // De scoreboard a la auditoría del primer partido
      indiceAuditoriaActual = 0;
      container.classList.add('flipped');
      mostrarAuditoriaActual();
    } else {
      // De auditoría de un partido al siguiente partido o de vuelta al scoreboard
      indiceAuditoriaActual++;
      if (indiceAuditoriaActual < partidosAuditoria.length) {
        // Simular un flip al cambiar de auditoría
        container.classList.remove('flipped');
        setTimeout(() => {
          mostrarAuditoriaActual();
          container.classList.add('flipped');
        }, 600); // 600ms para completar el giro de vuelta y luego girar de nuevo
      } else {
        container.classList.remove('flipped');
        indiceAuditoriaActual = 0;
      }
    }
  };

  if (btnShow) {
    btnShow.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!container.classList.contains('flipped')) {
        flipCard();
      }
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', (e) => {
      e.stopPropagation();
      if (container.classList.contains('flipped')) {
        flipCard();
      }
    });
  }

  container.addEventListener('click', (e) => {
    if (e.target.closest('input, button, a, .full-table-container')) return;
    if (!container.classList.contains('flipped')) {
      flipCard();
    } else {
      container.classList.remove('flipped');
      indiceAuditoriaActual = 0;
    }
  });

  const auditBody = document.getElementById('scoreboard-audit-body');
  if (auditBody) {
    auditBody.addEventListener('click', (e) => {
      const target = e.target.closest('.clickable-profile');
      if (target) {
        const username = target.getAttribute('data-username');
        if (username) verPerfil(username);
      }
    });
  }
}
async function cargarAuditoriaPartido(partidoId, tbody) {
  try {
    const res = await fetch(`/api/partidos/${partidoId}/auditoria`);
    if (!res.ok) throw new Error('Error al cargar auditoría');
    const data = await res.json();
    
    tbody.innerHTML = '';
    data.auditoria.forEach(usr => {
      const isMe = currentUser && usr.username === currentUser.username;
      const tr = document.createElement('tr');
      if (isMe) tr.style.backgroundColor = 'rgba(59, 130, 246, 0.08)';
      
      let ptClass = '';
      if (usr.color === 'green') ptClass = 'audit-pt-green';
      else if (usr.color === 'blue') ptClass = 'audit-pt-blue';
      else if (usr.color === 'red') ptClass = 'audit-pt-red';

      // Find user rank from global scoreboard array to match front table
      const sbUser = scoreboard.find(s => s.username === usr.username);
      const rank = sbUser ? sbUser.rank : '-';

      tr.innerHTML = `
        <td>
          <span class="pos-badge pos-${rank}">${rank}</span>
        </td>
        <td>
          <div class="user-cell clickable-profile" data-username="${escapeHtml(usr.username)}">
            <span class="user-avatar-emoji">${usr.avatar_emoji}</span>
            <span>${escapeHtml(usr.username)} ${isMe ? '<small>(Tú)</small>' : ''}</span>
          </div>
        </td>
        <td style="font-weight: 500; text-align: center;">${usr.prediccion}</td>
        <td class="${ptClass} font-bold" style="text-align: center; font-size: 1.1rem;">${usr.puntos}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--color-red); padding: 1rem;">${err.message}</td></tr>`;
  }
}

// ==========================================
// CONTROLES DE ACORDEONES (EXPANDIR / COLAPSAR)
// ==========================================
function toggleAccordionsHome() {
  const container = document.getElementById('lista-partidos');
  if (!container) return;
  const sections = container.querySelectorAll('.accordion-section');
  const anyCollapsed = Array.from(sections).some(s => s.classList.contains('collapsed'));
  
  sections.forEach(s => {
    if (anyCollapsed) {
      s.classList.remove('collapsed');
    } else {
      s.classList.add('collapsed');
    }
  });
  
  actualizarTextoBotonAcordeon('btn-toggle-accordions-home', !anyCollapsed);
}

function toggleAccordionsProfile() {
  const container = document.getElementById('profile-partidos-list');
  if (!container) return;
  const sections = container.querySelectorAll('.accordion-section');
  const anyCollapsed = Array.from(sections).some(s => s.classList.contains('collapsed'));
  
  sections.forEach(s => {
    if (anyCollapsed) {
      s.classList.remove('collapsed');
    } else {
      s.classList.add('collapsed');
    }
  });
  
  actualizarTextoBotonAcordeon('btn-toggle-accordions-profile', !anyCollapsed);
}

function actualizarTextoBotonAcordeon(buttonId, willCollapse) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;
  if (willCollapse) {
    btn.innerHTML = `<i class="fa-solid fa-angles-down"></i> Expandir Todos`;
  } else {
    btn.innerHTML = `<i class="fa-solid fa-angles-up"></i> Contraer Todos`;
  }
}

// ==========================================
// EVALUACIÓN DINÁMICA: BOTÓN GUARDAR TOP 3
// ==========================================
function evaluarVisibilidadBotonTop3() {
  const p1 = document.getElementById('top3-p1');
  const p2 = document.getElementById('top3-p2');
  const p3 = document.getElementById('top3-p3');
  const btn = document.getElementById('btn-save-top3');
  if (!p1 || !p2 || !p3 || !btn) return;

  if (!top3Predecible) {
    btn.style.display = 'none';
    return;
  }

  const val1 = p1.value;
  const val2 = p2.value;
  const val3 = p3.value;

  const saved1 = prediccionTop3 ? (prediccionTop3.puesto_1 || '') : '';
  const saved2 = prediccionTop3 ? (prediccionTop3.puesto_2 || '') : '';
  const saved3 = prediccionTop3 ? (prediccionTop3.puesto_3 || '') : '';

  const haCambiado = val1 !== saved1 || val2 !== saved2 || val3 !== saved3;

  // Si no hay predicción guardada (al menos un puesto vacío)
  const sinGuardar = !saved1 || !saved2 || !saved3;

  if (haCambiado || sinGuardar) {
    btn.style.display = 'inline-flex';
  } else {
    btn.style.display = 'none';
  }
}



// ==========================================
// CHAT — LLORERÍA DE AMIGOS
// ==========================================

// Estado del chat
const chatState = {
  pollingInterval: null,
  escribiendo: false,
  escribiendoTimer: null,
  // Anti-spam: timestamps de últimos mensajes enviados
  mensajesRecientes: [],
  SPAM_VENTANA_MS: 15000,
  SPAM_MAX_MENSAJES: 3,
  spamTimeout: null,
  spamCountdownInterval: null,
  // Estado de respuesta
  replyingTo: null,
  lastRenderedMsgs: {}, // Cache of last rendered messages JSON string for each wallId
};

// Paleta de colores determinista para avatares de iniciales
const AVATAR_COLORS = [
  '#3b82f6', '#8b5cf6', '#ec4899', '#10b981', '#f59e0b',
  '#06b6d4', '#ef4444', '#84cc16', '#a855f7', '#f97316',
];

function generarAvatarUsuario(username) {
  // Hash simple del nombre para determinar color
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = (hash * 31 + username.charCodeAt(i)) & 0xffffffff;
  }
  const color = AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
  // Iniciales: primera letra del username, y si hay punto/espacio, la siguiente
  const partes = username.split(/[\.\s_\-]+/).filter(Boolean);
  let iniciales = partes[0]?.[0] || '?';
  if (partes[1]) iniciales += partes[1][0];
  else iniciales += (username[1] || '');
  return { color, iniciales: iniciales.toUpperCase().slice(0, 2) };
}

function renderizarMensajesChat(mensajes, wallId, esMobile = false, forceScroll = false) {
  const wall = document.getElementById(wallId);
  if (!wall) return;

  if (!mensajes || mensajes.length === 0) {
    wall.innerHTML = '<div class="chat-empty-state"><i class="fa-regular fa-comments"></i><br>¡El muro está vacío! Sé el primero en escribir algo.</div>';
    chatState.lastRenderedMsgs = chatState.lastRenderedMsgs || {};
    chatState.lastRenderedMsgs[wallId] = '[]';
    return;
  }

  // Evitar re-renderizar si los mensajes son idénticos y no se fuerza el scroll
  const msgsJson = JSON.stringify(mensajes);
  chatState.lastRenderedMsgs = chatState.lastRenderedMsgs || {};
  const prevMsgsJson = chatState.lastRenderedMsgs[wallId];
  if (prevMsgsJson === msgsJson && forceScroll !== true) {
    return;
  }

  // Guardar la posición de scroll actual antes de vaciar e insertar los nuevos mensajes
  const wasAtBottom = (wall.scrollHeight - wall.clientHeight - wall.scrollTop) < 80 || wall.scrollHeight === 0;
  const oldScrollTop = wall.scrollTop;

  wall.innerHTML = '';
  mensajes.forEach(msg => {
    const esPropio = currentUser && msg.username === currentUser.username;
    const avatarEmoji = msg.avatar_emoji || '⚽';

    const burbuja = document.createElement('div');
    burbuja.className = `chat-burbuja${esPropio ? ' propia' : ''}`;
    if (msg.id) burbuja.id = `${wallId}-msg-${msg.id}`;

    let replyHtml = '';
    if (msg.reply_to_id && msg.reply_to_username) {
      // Verificar si el mensaje original sigue en el historial actual
      const originalExiste = mensajes.some(m => m.id === msg.reply_to_id);
      
      if (originalExiste) {
        replyHtml = `
          <div class="chat-msg-reply-context" onclick="window.chatScrollToMsg('${wallId}', '${msg.reply_to_id}')">
            <span class="reply-user"><i class="fa-solid fa-reply"></i> ${escapeHtml(msg.reply_to_username)}</span>
            <span class="reply-text">${escapeHtml(msg.reply_to_texto || '')}</span>
          </div>
        `;
      } else {
        replyHtml = `
          <div class="chat-msg-reply-context" style="opacity: 0.6; cursor: default;" onclick="window.showToast('El mensaje original ya no está en el historial.', 'info')">
            <span class="reply-user"><i class="fa-solid fa-reply"></i> ${escapeHtml(msg.reply_to_username)}</span>
            <span class="reply-text"><em>Mensaje antiguo o eliminado</em></span>
          </div>
        `;
      }
    }

    burbuja.innerHTML = `
      <div class="chat-avatar-emoji-burbuja">${avatarEmoji}</div>
      <div class="chat-burbuja-body">
        ${!esPropio ? `<span class="chat-autor">${escapeHtml(msg.username)}</span>` : ''}
        ${replyHtml}
        <div class="chat-texto">${escapeHtml(msg.texto)}</div>
        <span class="chat-hora">${msg.timestamp || ''}</span>
      </div>
    `;

    // Eventos para responder al mensaje
    // En Desktop: Click derecho
    burbuja.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      chatResponderA(msg, esMobile);
    });

    // En Mobile/Tablet: Long Press
    let touchTimer = null;
    burbuja.addEventListener('touchstart', (e) => {
      touchTimer = setTimeout(() => {
        chatResponderA(msg, esMobile);
        // Vibrate if supported
        if (navigator.vibrate) navigator.vibrate(50);
      }, 500); // 500ms long press
    }, { passive: true });
    burbuja.addEventListener('touchend', () => {
      if (touchTimer) clearTimeout(touchTimer);
    });
    burbuja.addEventListener('touchmove', () => {
      if (touchTimer) clearTimeout(touchTimer);
    });

    wall.appendChild(burbuja);
  });

  // Guardar el JSON actual en el historial de caché
  chatState.lastRenderedMsgs[wallId] = msgsJson;

  // Auto-scroll al final solo si el usuario ya estaba abajo o si forzamos scroll de manera estricta (por ejemplo, al abrir el chat o enviar un mensaje)
  const pill = document.getElementById('pill-new-messages-' + (esMobile ? 'mobile' : 'desktop'));
  if (wasAtBottom || forceScroll === true) {
    wall.scrollTop = wall.scrollHeight;
    setTimeout(() => {
      wall.scrollTop = wall.scrollHeight;
    }, 10);
    if (pill) pill.style.display = 'none';
  } else {
    wall.scrollTop = oldScrollTop;
    setTimeout(() => {
      wall.scrollTop = oldScrollTop;
    }, 10);
    // Mostrar la píldora si llegaron mensajes nuevos y no estamos abajo
    if (prevMsgsJson && prevMsgsJson !== msgsJson && pill) {
      pill.style.display = 'flex';
    }
  }
}

function chatResponderA(msg, esMobile) {
  chatState.replyingTo = {
    id: msg.id,
    username: msg.username,
    texto: msg.texto
  };
  
  const prefix = esMobile ? '-mobile' : '-desktop';
  const previewContainer = document.getElementById(`chat-reply-preview${prefix}`);
  const replyUser = document.getElementById(`reply-user${prefix}`);
  const replyText = document.getElementById(`reply-text${prefix}`);
  const input = document.getElementById(`chat-input${prefix}`);
  
  if (previewContainer && replyUser && replyText) {
    replyUser.textContent = `Respondiendo a ${msg.username}`;
    replyText.textContent = msg.texto;
    previewContainer.style.display = 'flex';
  }
  
  if (input) input.focus();
}

// Global scope para el botón (X) en index.html
window.chatCancelarRespuesta = function() {
  chatState.replyingTo = null;
  document.getElementById('chat-reply-preview-desktop').style.display = 'none';
  document.getElementById('chat-reply-preview-mobile').style.display = 'none';
};

// Global scope para el scroll al mensaje original
window.chatScrollToMsg = function(wallId, msgId) {
  const msgEl = document.getElementById(`${wallId}-msg-${msgId}`);
  if (msgEl) {
    // Buscar el contenedor con overflow
    const wall = document.getElementById(wallId);
    
    // Obtener la posición relativa del mensaje dentro del wall
    const offsetTop = msgEl.offsetTop - wall.offsetTop;
    
    wall.scrollTo({
      top: offsetTop - 40, // Dejar un pequeño margen arriba
      behavior: 'smooth'
    });
    
    // Animación breve de resaltado
    msgEl.classList.add('chat-burbuja-highlight');
    setTimeout(() => {
      msgEl.classList.remove('chat-burbuja-highlight');
    }, 1500);
  } else {
    showToast('El mensaje original ya no está disponible en el historial.', 'info');
  }
};

function escapeHtml(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}



function actualizarIndicadorEscribiendo(escribiendoUsers, escribiendoId) {
  const el = document.getElementById(escribiendoId);
  if (!el) return;
  if (!escribiendoUsers || escribiendoUsers.length === 0) {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }
  const texto = escribiendoUsers.length === 1
    ? `<em>${escribiendoUsers[0]} está escribiendo</em>`
    : `<em>${escribiendoUsers.slice(0, -1).join(', ')} y ${escribiendoUsers.at(-1)} están escribiendo</em>`;
  el.innerHTML = `${texto} <span class="chat-escribiendo-dots"><span></span><span></span><span></span></span>`;
  el.style.display = 'flex';
}

function actualizarActivos(count, countId) {
  const el = document.getElementById(countId);
  if (el) el.textContent = count;
}

// Anti-spam: retorna true si el usuario está bloqueado
function chatVerificarSpam() {
  const ahora = Date.now();
  // Limpiar mensajes fuera de la ventana
  chatState.mensajesRecientes = chatState.mensajesRecientes.filter(t => ahora - t < chatState.SPAM_VENTANA_MS);
  return chatState.mensajesRecientes.length >= chatState.SPAM_MAX_MENSAJES;
}

function chatActivarBloqueoSpam(formId, overlayId, countId, inputId, sendId) {
  const overlay = document.getElementById(overlayId);
  const input = document.getElementById(inputId);
  const sendBtn = document.getElementById(sendId);
  if (!overlay) return;

  let segundosRestantes = Math.ceil(chatState.SPAM_VENTANA_MS / 1000);
  overlay.style.display = 'flex';
  if (input) { input.disabled = true; }
  if (sendBtn) { sendBtn.disabled = true; }

  const countEl = document.getElementById(countId);
  if (countEl) countEl.textContent = segundosRestantes;

  chatState.spamCountdownInterval = setInterval(() => {
    segundosRestantes--;
    if (countEl) countEl.textContent = segundosRestantes;
    if (segundosRestantes <= 0) {
      clearInterval(chatState.spamCountdownInterval);
      overlay.style.display = 'none';
      if (input) { input.disabled = false; input.focus(); }
      if (sendBtn) { sendBtn.disabled = false; }
      chatState.mensajesRecientes = [];
    }
  }, 1000);
}

async function chatPoll(esMobile = false, forceScroll = false) {
  if (!currentUser) return;

  const escribiendoParam = chatState.escribiendo ? 'true' : 'false';
  try {
    const res = await fetch(`/api/chat?username=${encodeURIComponent(currentUser.username)}&escribiendo=${escribiendoParam}`);
    if (!res.ok) return;
    const data = await res.json();

    const wallId = esMobile ? 'chat-messages-mobile' : 'chat-messages-desktop';
    const escribiendoId = esMobile ? 'chat-escribiendo-mobile' : 'chat-escribiendo-desktop';
    const activosCountId = esMobile ? 'chat-activos-count-mobile' : 'chat-activos-count-desktop';

    renderizarMensajesChat(data.mensajes, wallId, esMobile, forceScroll);
    actualizarIndicadorEscribiendo(data.escribiendo, escribiendoId);
    actualizarActivos(data.activosCount, activosCountId);
  } catch (_) {}
}

function iniciarPollingChat() {
  if (chatState.pollingInterval) return; // ya corriendo
  chatPollAmbos(true);
  chatState.pollingInterval = setInterval(chatPollAmbos, 4000);
}

// Hace una sola request y actualiza tanto el muro desktop como el mobile
async function chatPollAmbos(forceScroll = false) {
  if (!currentUser) return;
  const escribiendoParam = chatState.escribiendo ? 'true' : 'false';
  try {
    const res = await fetch(`/api/chat?username=${encodeURIComponent(currentUser.username)}&escribiendo=${escribiendoParam}`);
    if (!res.ok) return;
    const data = await res.json();

    // Actualizar el indicador de mensajes sin leer
    if (data.mensajes && data.mensajes.length > 0) {
      const latestMsg = data.mensajes[data.mensajes.length - 1];
      const lastReadId = localStorage.getItem('chat_last_read_id');
      const isViewingChat = activeTab === 'chat' || (activeTab === 'home' && window.innerWidth > 1024);

      if (isViewingChat) {
        localStorage.setItem('chat_last_read_id', latestMsg.id);
        marcarChatComoLeido();
      } else {
        if (lastReadId !== latestMsg.id) {
          marcarChatComoNoLeido();
        } else {
          marcarChatComoLeido();
        }
      }
    } else {
      marcarChatComoLeido();
    }

    renderizarMensajesChat(data.mensajes, 'chat-messages-desktop', false, forceScroll);
    renderizarMensajesChat(data.mensajes, 'chat-messages-mobile', true, forceScroll);
    actualizarIndicadorEscribiendo(data.escribiendo, 'chat-escribiendo-desktop');
    actualizarIndicadorEscribiendo(data.escribiendo, 'chat-escribiendo-mobile');
    actualizarActivos(data.activosCount, 'chat-activos-count-desktop');
    actualizarActivos(data.activosCount, 'chat-activos-count-mobile');

    if (data.argentinaMode !== undefined) {
      actualizarEstiloModoArgentina(data.argentinaMode);
    }


  } catch (_) {}
}

function detenerPollingChat() {
  if (chatState.pollingInterval) {
    clearInterval(chatState.pollingInterval);
    chatState.pollingInterval = null;
  }
}

async function chatEnviarMensaje(texto, esMobile = false) {
  if (!currentUser || !texto.trim()) return;

  const overlayId = esMobile ? 'chat-spam-mobile' : 'chat-spam-desktop';
  const countId = esMobile ? 'chat-spam-count-mobile' : 'chat-spam-count-desktop';
  const inputId = esMobile ? 'chat-input-mobile' : 'chat-input-desktop';
  const sendId = esMobile ? 'chat-send-mobile' : 'chat-send-desktop';
  const formId = esMobile ? 'chat-form-mobile' : 'chat-form-desktop';

  // Verificar anti-spam
  if (chatVerificarSpam()) {
    chatActivarBloqueoSpam(formId, overlayId, countId, inputId, sendId);
    return;
  }

  try {
    const payload = { 
      username: currentUser.username, 
      texto: texto.trim() 
    };
    if (chatState.replyingTo) {
      payload.replyTo = chatState.replyingTo;
    }

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { showToast('Error al enviar mensaje.', 'error'); return; }

    // Limpiar estado de respuesta
    if (chatState.replyingTo) {
      window.chatCancelarRespuesta();
    }

    // Registrar el mensaje en el historial anti-spam
    chatState.mensajesRecientes.push(Date.now());
    chatState.escribiendo = false;

    // Detectar si estamos en móvil o desktop para verificar spam
    if (chatVerificarSpam()) {
      chatActivarBloqueoSpam(formId, overlayId, countId, inputId, sendId);
    }

    // Refrescar inmediatamente y forzar el scroll al final
    chatPollAmbos(true);
  } catch (_) {
    showToast('Error de red al enviar mensaje.', 'error');
  }
}

function inicializarFormularioChat(formId, inputId, esMobile) {
  const form = document.getElementById(formId);
  const input = document.getElementById(inputId);
  if (!form || !input) return;

  // Evento de tipeo para el indicador
  input.addEventListener('input', () => {
    chatState.escribiendo = true;
    if (chatState.escribiendoTimer) clearTimeout(chatState.escribiendoTimer);
    chatState.escribiendoTimer = setTimeout(() => {
      chatState.escribiendo = false;
    }, 4000);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const texto = input.value;
    input.value = '';
    await chatEnviarMensaje(texto, esMobile);
  });
}

function ajustarAlturaChatMovil() {
  const viewChat = document.getElementById('view-chat');
  if (!viewChat) return;

  if (document.body.classList.contains('chat-active')) {
    const isKeyboardOpen = document.body.classList.contains('keyboard-open');
    const viewportHeight = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    
    // Si el teclado está abierto, el offset inferior es 0. De lo contrario, 65px (barra de navegación inferior).
    const bottomOffset = isKeyboardOpen ? 0 : 65;
    
    viewChat.style.position = 'fixed';
    viewChat.style.top = '0px';
    viewChat.style.left = '0px';
    viewChat.style.width = '100%';
    viewChat.style.height = `${viewportHeight - bottomOffset}px`;
    viewChat.style.bottom = `${bottomOffset}px`;
    
    const wall = document.getElementById('chat-messages-mobile');
    if (wall && isKeyboardOpen) {
      setTimeout(() => {
        wall.scrollTop = wall.scrollHeight;
      }, 50);
    }
  } else {
    viewChat.style.position = '';
    viewChat.style.top = '';
    viewChat.style.left = '';
    viewChat.style.width = '';
    viewChat.style.height = '';
    viewChat.style.bottom = '';
  }
}

function inicializarChat() {
  inicializarFormularioChat('chat-form-desktop', 'chat-input-desktop', false);
  inicializarFormularioChat('chat-form-mobile', 'chat-input-mobile', true);

  // Conectar las píldoras de nuevos mensajes (Desktop y Mobile)
  const conectarPill = (pillId, wallId) => {
    const pill = document.getElementById(pillId);
    const wall = document.getElementById(wallId);
    if (pill && wall) {
      pill.addEventListener('click', () => {
        wall.scrollTop = wall.scrollHeight;
        pill.style.display = 'none';
        
        // Marcar como leído al hacer scroll al fondo
        if (currentUser && chatState.lastRenderedMsgs[wallId]) {
          try {
            const msgs = JSON.parse(chatState.lastRenderedMsgs[wallId]);
            if (msgs && msgs.length > 0) {
              localStorage.setItem('chat_last_read_id', msgs[msgs.length - 1].id);
              marcarChatComoLeido();
            }
          } catch (_) {}
        }
      });
      
      wall.addEventListener('scroll', () => {
        const isAtBottom = (wall.scrollHeight - wall.clientHeight - wall.scrollTop) < 30;
        if (isAtBottom) {
          pill.style.display = 'none';
          
          // Marcar como leído al llegar al fondo
          if (currentUser && chatState.lastRenderedMsgs[wallId]) {
            try {
              const msgs = JSON.parse(chatState.lastRenderedMsgs[wallId]);
              if (msgs && msgs.length > 0) {
                localStorage.setItem('chat_last_read_id', msgs[msgs.length - 1].id);
                marcarChatComoLeido();
              }
            } catch (_) {}
          }
        }
      });
    }
  };

  conectarPill('pill-new-messages-desktop', 'chat-messages-desktop');
  conectarPill('pill-new-messages-mobile', 'chat-messages-mobile');

  iniciarPollingChat();

  const inputMobile = document.getElementById('chat-input-mobile');
  if (inputMobile) {
    inputMobile.addEventListener('focus', () => {
      document.body.classList.add('keyboard-open');
      document.documentElement.classList.add('keyboard-open');
      ajustarAlturaChatMovil();
      // Scroll to bottom of chat wall immediately to keep last messages in view
      setTimeout(() => {
        const wall = document.getElementById('chat-messages-mobile');
        if (wall) wall.scrollTop = wall.scrollHeight;
      }, 150);
    });
    inputMobile.addEventListener('blur', () => {
      document.body.classList.remove('keyboard-open');
      document.documentElement.classList.remove('keyboard-open');
      ajustarAlturaChatMovil();
    });
  }

  // Configurar observadores de cambio de tamaño del Visual Viewport para móviles
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', ajustarAlturaChatMovil);
    window.visualViewport.addEventListener('scroll', () => {
      if (document.body.classList.contains('chat-active')) {
        window.scrollTo(0, 0);
      }
    });
  } else {
    window.addEventListener('resize', ajustarAlturaChatMovil);
  }
}

// ==========================================
// MODAL PARA CAMBIAR AVATAR DESDE EL PERFIL
// ==========================================
function inicializarModalAvatar() {
  const modal = document.getElementById('modal-change-avatar');
  const btnEdit = document.getElementById('btn-edit-avatar');
  const profileAvatarLarge = document.getElementById('profile-avatar');
  const btnClose = document.getElementById('btn-close-avatar-modal');
  const grid = document.getElementById('profile-emoji-grid');

  if (!modal || !btnEdit || !profileAvatarLarge || !btnClose || !grid) return;

  // Abrir modal
  const openModal = () => {
    const profileUser = document.getElementById('profile-username').textContent;
    if (currentUser && profileUser === currentUser.username) {
      grid.innerHTML = '';
      AVATAR_EMOJIS.forEach(emoji => {
        const item = document.createElement('div');
        item.className = 'emoji-item' + (emoji === currentUser.avatar_emoji ? ' selected' : '');
        item.textContent = emoji;
        item.addEventListener('click', () => seleccionarNuevoAvatar(emoji));
        grid.appendChild(item);
      });
      modal.style.display = 'flex';
    }
  };

  btnEdit.addEventListener('click', openModal);
  profileAvatarLarge.addEventListener('click', openModal);

  // Cerrar modal
  const closeModal = () => {
    modal.style.display = 'none';
  };

  btnClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });
}

async function seleccionarNuevoAvatar(emoji) {
  if (!currentUser) return;
  try {
    const response = await fetch('/api/user/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: currentUser.username,
        avatar_emoji: emoji
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Error al cambiar avatar');

    currentUser.avatar_emoji = emoji;
    localStorage.setItem('prode_session', JSON.stringify(currentUser));
    
    // Actualizar elementos de la interfaz
    actualizarHeaderUsuario();
    cargarScoreboardMini();
    
    const profileAvatar = document.getElementById('profile-avatar');
    if (profileAvatar) profileAvatar.textContent = emoji;

    // Cerrar modal
    const modal = document.getElementById('modal-change-avatar');
    if (modal) modal.style.display = 'none';

    showToast('¡Avatar actualizado con éxito!', 'success');
  } catch (error) {
    showToast(error.message, 'error');
  }
}

// ==========================================
// MODAL PARA CAMBIAR NOMBRE DE USUARIO DESDE EL PERFIL
// ==========================================
function inicializarModalUsername() {
  const modal = document.getElementById('modal-change-username');
  const btnEdit = document.getElementById('btn-edit-username');
  const btnClose = document.getElementById('btn-close-username-modal');
  
  const stepInput = document.getElementById('username-step-input');
  const stepConfirm = document.getElementById('username-step-confirm');
  
  const inputField = document.getElementById('new-username-field');
  const btnStep1 = document.getElementById('btn-submit-username-step1');
  
  const spanNewName = document.getElementById('confirm-new-username-span');
  const btnBack = document.getElementById('btn-back-username-step2');
  const btnConfirm = document.getElementById('btn-confirm-username-change');

  if (!modal || !btnEdit || !btnClose || !stepInput || !stepConfirm || !inputField || !btnStep1 || !spanNewName || !btnBack || !btnConfirm) return;

  // Abrir modal
  btnEdit.addEventListener('click', () => {
    // Resetear al Paso 1
    inputField.value = '';
    stepInput.style.display = 'block';
    stepConfirm.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(() => inputField.focus(), 100);
  });

  // Cerrar modal
  const closeModal = () => {
    modal.style.display = 'none';
  };

  btnClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Paso 1 -> Paso 2
  btnStep1.addEventListener('click', () => {
    const nuevoNombre = inputField.value.trim();
    if (!nuevoNombre) {
      showToast('Por favor, ingresa un nombre de usuario.', 'error');
      return;
    }
    
    if (nuevoNombre.toLowerCase() === currentUser.username.toLowerCase()) {
      if (nuevoNombre === currentUser.username) {
        showToast('El nuevo nombre debe ser diferente al actual.', 'error');
        return;
      }
    }

    // Validar formato básico en cliente antes de continuar
    if (nuevoNombre.length < 2) {
      showToast('El nombre de usuario debe tener al menos 2 caracteres.', 'error');
      return;
    }
    const regex = /^[a-zA-Z0-9_\-\.]+$/;
    if (!regex.test(nuevoNombre)) {
      showToast('El nombre solo puede contener letras, números, guiones, puntos y guiones bajos.', 'error');
      return;
    }

    // Mostrar Paso 2
    spanNewName.textContent = nuevoNombre;
    stepInput.style.display = 'none';
    stepConfirm.style.display = 'block';
  });

  // Paso 2 -> Paso 1 (Volver)
  btnBack.addEventListener('click', () => {
    stepConfirm.style.display = 'none';
    stepInput.style.display = 'block';
  });

  // Confirmar cambio (Paso 2 -> Servidor)
  btnConfirm.addEventListener('click', async () => {
    const nuevoNombre = inputField.value.trim();
    if (!nuevoNombre || !currentUser) return;

    btnConfirm.disabled = true;
    const originalContent = btnConfirm.innerHTML;
    btnConfirm.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando...`;

    try {
      const response = await fetch('/api/user/username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          oldUsername: currentUser.username,
          newUsername: nuevoNombre
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error al cambiar el nombre de usuario.');

      // 1. Actualizar objeto local de sesión
      currentUser.username = data.newUsername;
      if (data.token) {
        currentUser.token = data.token;
      }
      localStorage.setItem('prode_session', JSON.stringify(currentUser));

      // 2. Refrescar interfaz
      actualizarHeaderUsuario();
      cargarScoreboardMini();
      
      // 3. Recargar el perfil con el nuevo nombre para actualizar todas las vistas de predicciones y podio
      await verPerfil(data.newUsername);

      // Cerrar modal
      closeModal();
      showToast('¡Nombre de usuario cambiado con éxito!', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btnConfirm.disabled = false;
      btnConfirm.innerHTML = originalContent;
    }
  });
}

// ==========================================
// MODAL PARA CAMBIAR CONTRASEÑA DESDE EL PERFIL
// ==========================================
function inicializarModalPassword() {
  const modal = document.getElementById('modal-change-password');
  const btnTrigger = document.getElementById('profile-password-btn');
  const btnClose = document.getElementById('btn-close-password-modal');
  const form = document.getElementById('form-change-password');

  const inputCurrent = document.getElementById('change-pwd-current');
  const inputNew = document.getElementById('change-pwd-new');
  const inputConfirm = document.getElementById('change-pwd-confirm');
  const errorBox = document.getElementById('change-pwd-error');

  if (!modal || !btnTrigger || !btnClose || !form || !inputCurrent || !inputNew || !inputConfirm || !errorBox) return;

  // Helper para mostrar error en el formulario
  const mostrarError = (mensaje) => {
    errorBox.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> <span>${mensaje}</span>`;
    errorBox.style.display = 'flex';
  };

  // Helper para limpiar error
  const limpiarError = () => {
    errorBox.innerHTML = '';
    errorBox.style.display = 'none';
  };

  // Abrir modal
  btnTrigger.addEventListener('click', () => {
    form.reset();
    limpiarError();
    modal.style.display = 'flex';
    setTimeout(() => inputCurrent.focus(), 100);
  });

  // Cerrar modal
  const closeModal = () => {
    modal.style.display = 'none';
  };

  btnClose.addEventListener('click', closeModal);
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      closeModal();
    }
  });

  // Submit formulario
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limpiarError();
    if (!currentUser) return;

    const currentPwd = inputCurrent.value;
    const newPwd = inputNew.value;
    const confirmPwd = inputConfirm.value;

    // Validar que la nueva clave no sea igual a la vieja
    if (currentPwd === newPwd) {
      mostrarError('La nueva contraseña no puede ser igual a la contraseña actual.');
      return;
    }

    // Validar coincidencia de nueva clave
    if (newPwd !== confirmPwd) {
      mostrarError('La nueva contraseña y su confirmación no coinciden.');
      return;
    }

    // Validar longitud
    if (newPwd.length < 4) {
      mostrarError('La nueva contraseña debe tener al menos 4 caracteres.');
      return;
    }

    const btnSubmit = form.querySelector('button[type="submit"]');
    btnSubmit.disabled = true;
    const originalContent = btnSubmit.innerHTML;
    btnSubmit.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Guardando...`;

    try {
      const response = await fetch('/api/user/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: currentUser.username,
          currentPassword: currentPwd,
          newPassword: newPwd
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Error al cambiar la contraseña.');

      showToast('¡Contraseña cambiada con éxito!', 'success');
      closeModal();
    } catch (err) {
      mostrarError(err.message);
    } finally {
      btnSubmit.disabled = false;
      btnSubmit.innerHTML = originalContent;
    }
  });
}

// ==========================================
// DESPLAZAR AL DÍA ACTUAL (MUNDIAL)
// ==========================================
function irAlDiaActual() {
  // Solo tiene sentido si estamos en la pestaña home y en el modo ordenación por fecha
  if (activeTab !== 'home' || sortMode !== 'fecha') {
    // Si no estamos en home, redirigimos a home
    if (activeTab !== 'home') {
      navegarTab('home');
    }
    // Si no estamos en ordenación por fecha, activamos ordenación por fecha
    const btnSortFecha = document.getElementById('btn-sort-fecha');
    if (btnSortFecha && !btnSortFecha.classList.contains('active')) {
      btnSortFecha.click();
    }
  }

  // Esperar un instante para que el renderizado de los partidos ocurra
  setTimeout(() => {
    const sections = Array.from(document.querySelectorAll('#lista-partidos .accordion-section'));
    if (sections.length === 0) return;

    // Obtener hoy en formato YYYY-MM-DD en zona horaria de Argentina
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
    const todayTime = new Date(todayStr).getTime();

    let targetSection = null;
    let minDiff = Infinity;

    // Buscar la sección del día actual, o en su defecto, la más cercana en el tiempo
    sections.forEach(sec => {
      const secDateStr = sec.dataset.date;
      if (!secDateStr) return;

      if (secDateStr === todayStr) {
        targetSection = sec;
        minDiff = 0;
      } else if (minDiff > 0) {
        const secTime = new Date(secDateStr).getTime();
        const diff = Math.abs(secTime - todayTime);
        if (diff < minDiff) {
          minDiff = diff;
          targetSection = sec;
        }
      }
    });

    if (targetSection) {
      // Expandir la sección
      targetSection.classList.remove('collapsed');
      
      // Scroll suave
      targetSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
      
      // Pulsar brillo visual en la cabecera
      const header = targetSection.querySelector('.accordion-header');
      if (header) {
        header.classList.add('highlight-pulse');
        setTimeout(() => header.classList.remove('highlight-pulse'), 2000);
      }
    }
  }, 150);
}

// Controla la visibilidad de la píldora flotante del día actual en móviles/tablets
function actualizarVisibilidadPillHoy() {
  const mobPill = document.getElementById('btn-go-to-today-mobile');
  const infoBtn = document.getElementById('btn-info-rules');
  const muteBtn = document.getElementById('btn-argentina-mute');

  const isVisibleHoy = activeTab === 'home' && activeHomeSubFase === 'groups' && window.innerWidth <= 1024;
  const isLogged = activeTab !== 'auth';

  if (mobPill) {
    mobPill.style.display = isVisibleHoy ? 'inline-flex' : 'none';
  }

  if (infoBtn) {
    infoBtn.style.display = isLogged ? 'inline-flex' : 'none';
  }

  // Ajustes de posiciones verticales para evitar solapamientos
  if (window.innerWidth <= 768) {
    // Móviles y tablets
    if (isVisibleHoy) {
      if (infoBtn) infoBtn.style.bottom = '130px';
      if (muteBtn) muteBtn.style.bottom = '180px';
    } else {
      if (infoBtn) infoBtn.style.bottom = '80px';
      if (muteBtn) muteBtn.style.bottom = '130px';
    }
  } else {
    // Escritorio
    if (infoBtn) infoBtn.style.bottom = '24px';
    if (muteBtn) muteBtn.style.bottom = '90px';
  }
}

// Escuchar cambios de tamaño/rotación para actualizar la píldora flotante hoy
window.addEventListener('resize', actualizarVisibilidadPillHoy);

// ==========================================
// LÓGICA PARA RANDOMIZAR RESULTADOS
// ==========================================
function obtenerGolesRandom() {
  const weights = [14.2, 13.18, 12.16, 11.14, 10.12, 9.1, 8.08, 7.06, 6.04, 5.02, 4.0];
  const totalWeight = 100.1;
  let r = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    if (r < weights[i]) {
      return i;
    }
    r -= weights[i];
  }
  return 10;
}

function randomizarPartido(partidoId, event) {
  if (event) {
    event.stopPropagation();
  }
  const partido = partidos.find(p => p.partido_id === partidoId);
  if (!partido || !partido.predecible) return;

  const randomGolesLocal = obtenerGolesRandom();
  const randomGolesVis   = obtenerGolesRandom();

  const { local: localInp, visitante: visInp, circleL, circleV } = obtenerElementosPartido(partidoId);

  if (localInp && visInp) {
    localInp.value = randomGolesLocal;
    visInp.value = randomGolesVis;
    
    // Si es eliminación directa, manejar el empate y círculos
    const esKnockout = partido.fase !== 'Fase de Grupos';
    let ganador_pred = '';
    if (esKnockout) {
      if (randomGolesLocal === randomGolesVis) {
        ganador_pred = Math.random() < 0.5 ? 'local' : 'visitante';
        if (circleL && circleV) {
          circleL.style.display = 'inline-flex';
          circleV.style.display = 'inline-flex';
          if (ganador_pred === 'local') {
            circleL.classList.add('selected');
            circleV.classList.remove('selected');
          } else {
            circleV.classList.add('selected');
            circleL.classList.remove('selected');
          }
        }
      } else {
        if (circleL && circleV) {
          circleL.classList.remove('selected');
          circleV.classList.remove('selected');
          circleL.style.display = 'none';
          circleV.style.display = 'none';
        }
      }
    }

    marcarCambioPendiente(partidoId);
    showToast(`Randomizado: ${partido.equipo_local} ${randomGolesLocal} - ${randomGolesVis} ${partido.equipo_visitante}${ganador_pred ? ' (Ganador: ' + (ganador_pred === 'local' ? partido.equipo_local : partido.equipo_visitante) + ')' : ''}`, 'randomize');
  }
}
window.randomizarPartido = randomizarPartido;

function randomizarPartidos(partidoIds) {
  let count = 0;
  partidoIds.forEach(id => {
    const partido = partidos.find(p => p.partido_id === id);
    if (partido && partido.predecible) {
      const randomGolesLocal = obtenerGolesRandom();
      const randomGolesVis   = obtenerGolesRandom();

      const { local: localInp, visitante: visInp, circleL, circleV } = obtenerElementosPartido(id);

      if (localInp && visInp) {
        localInp.value = randomGolesLocal;
        visInp.value = randomGolesVis;
        
        const esKnockout = partido.fase !== 'Fase de Grupos';
        if (esKnockout) {
          if (randomGolesLocal === randomGolesVis) {
            const ganador_pred = Math.random() < 0.5 ? 'local' : 'visitante';
            if (circleL && circleV) {
              circleL.style.display = 'inline-flex';
              circleV.style.display = 'inline-flex';
              if (ganador_pred === 'local') {
                circleL.classList.add('selected');
                circleV.classList.remove('selected');
              } else {
                circleV.classList.add('selected');
                circleL.classList.remove('selected');
              }
            }
          } else {
            if (circleL && circleV) {
              circleL.classList.remove('selected');
              circleV.classList.remove('selected');
              circleL.style.display = 'none';
              circleV.style.display = 'none';
            }
          }
        }

        marcarCambioPendiente(id);
        count++;
      }
    }
  });
  if (count > 0) {
    showToast(`Se randomizaron ${count} partido(s) habilitado(s).`, 'randomize');
  } else {
    showToast('No hay partidos habilitados para randomizar.', 'info');
  }
}
window.randomizarPartidos = randomizarPartidos;



// ==========================================
// MODO ARGENTINA
// ==========================================
let argentinaModeActive = false;
let argentinaMuted = localStorage.getItem('argentina_mute') === 'true';

function inicializarModoArgentina() {
  // 1. Consultar estado inicial
  fetch('/api/config')
    .then(r => r.json())
    .then(config => {
      if (config && config.argentinaMode !== undefined) {
        actualizarEstiloModoArgentina(config.argentinaMode);
      }
    })
    .catch(err => console.error('Error al cargar config global:', err));

  // 2. Event listener para el switch de admin
  const switchEl = document.getElementById('switch-argentina-mode');
  if (switchEl) {
    switchEl.addEventListener('change', async (e) => {
      const active = e.target.checked;
      try {
        const res = await fetch('/api/admin/config', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ argentinaMode: active })
        });
        const data = await res.json();
        if (data.error) {
          showToast(data.error, 'error');
          switchEl.checked = !active; // deshacer
        } else {
          showToast(active ? '¡Modo Argentina ACTIVADO! 🇦🇷' : 'Modo Argentina desactivado.', 'success');
          actualizarEstiloModoArgentina(active);
        }
      } catch (err) {
        showToast('Error al actualizar configuración global.', 'error');
        switchEl.checked = !active; // deshacer
      }
    });
  }

  // 3. Event listener para el botón de Mute
  const muteBtn = document.getElementById('btn-argentina-mute');
  if (muteBtn) {
    // Inicializar clase según preferencia guardada
    if (argentinaMuted) {
      muteBtn.classList.add('muted');
      muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
    } else {
      muteBtn.classList.remove('muted');
      muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
    }

    muteBtn.addEventListener('click', () => {
      argentinaMuted = !argentinaMuted;
      localStorage.setItem('argentina_mute', argentinaMuted ? 'true' : 'false');
      
      const audio = document.getElementById('audio-argentina');
      if (argentinaMuted) {
        muteBtn.classList.add('muted');
        muteBtn.innerHTML = '<i class="fa-solid fa-volume-xmark"></i>';
        if (audio) audio.pause();
      } else {
        muteBtn.classList.remove('muted');
        muteBtn.innerHTML = '<i class="fa-solid fa-volume-high"></i>';
        if (audio && argentinaModeActive) {
          audio.play().catch(() => {
            console.log('Reproducción diferida a la primera interacción del usuario');
          });
        }
      }
    });
  }

  // 4. Capturar primer click/touch para saltar la política de autoplay si es necesario
  const iniciarAudioEnInteraccion = (e) => {
    const audio = document.getElementById('audio-argentina');
    if (audio && argentinaModeActive && !argentinaMuted && audio.paused) {
      // Intentar cargar y reproducir; en móviles el gesto debe ser directo
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            // Reproducción exitosa: remover ambos listeners
            document.removeEventListener('click', iniciarAudioEnInteraccion);
            document.removeEventListener('touchstart', iniciarAudioEnInteraccion, { passive: true });
          })
          .catch(() => {
            // Falló (política de autoplay), se reintentará en el próximo gesto
          });
      }
    } else if (!argentinaModeActive || argentinaMuted) {
      // Modo apagado o silenciado: limpiar listeners innecesarios
      document.removeEventListener('click', iniciarAudioEnInteraccion);
      document.removeEventListener('touchstart', iniciarAudioEnInteraccion, { passive: true });
    }
  };
  document.addEventListener('click', iniciarAudioEnInteraccion);
  document.addEventListener('touchstart', iniciarAudioEnInteraccion, { passive: true });
}

function actualizarEstiloModoArgentina(active) {
  if (argentinaModeActive === active) {
    const switchEl = document.getElementById('switch-argentina-mode');
    if (switchEl) switchEl.checked = active;
    return;
  }
  argentinaModeActive = active;

  document.body.classList.toggle('argentina-mode', active);

  const switchEl = document.getElementById('switch-argentina-mode');
  if (switchEl) {
    switchEl.checked = active;
  }

  const muteBtn = document.getElementById('btn-argentina-mute');
  if (muteBtn) {
    muteBtn.style.display = active ? 'flex' : 'none';
  }



  const audio = document.getElementById('audio-argentina');
  if (audio) {
    if (active) {
      if (!argentinaMuted) {
        audio.play().catch(() => {
          console.log('Autoplay bloqueado. Esperando interacción del usuario para reproducir.');
        });
      }
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }
}

window.inicializarModoArgentina = inicializarModoArgentina;
window.actualizarEstiloModoArgentina = actualizarEstiloModoArgentina;



