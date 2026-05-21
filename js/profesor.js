/**
 * profesor.js
 * Lógica del panel de validación del profesor — Mundial 2026
 * Depende de: config-firebase.js (auth, db, signInAnonymously)
 */

import { auth, db, signInAnonymously } from './config-firebase.js';
import { ref, get, set, onValue } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';
import { signOut }               from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

// ─── Estado global ──────────────────────────────────────────────────────────
let fichasActuales = {};   // Cache de todas las fichas cargadas
let fichaActual    = null; // Código de país de la ficha abierta en el modal
let todasLasFichas = {};   // Snapshot completo para los contadores

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Valida que una cadena sea URL http/https */
function esURLValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Muestra un toast temporal en la pantalla */
function mostrarToast(msg, tipo = 'exito') {
  // Usa el toast del HTML si está disponible, o crea uno propio
  const fn = window.mostrarToastProfesor;
  if (fn) { fn(msg, tipo); return; }

  let toast = document.getElementById('profesor-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'profesor-toast';
    Object.assign(toast.style, {
      position: 'fixed', bottom: '24px', right: '24px',
      padding: '12px 20px', borderRadius: '6px',
      fontWeight: '600', fontSize: '14px',
      boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
      zIndex: '9999', transition: 'opacity 0.3s',
    });
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.background = tipo === 'exito' ? '#1B5E20' : '#c62828';
  toast.style.color       = 'white';
  toast.style.opacity     = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { toast.style.opacity = '0'; }, 3500);
}

/** Formatea un timestamp en fecha legible */
function formatFecha(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/** Valida los datos de una ficha y retorna resultado */
function validarFicha(fichaObj) {
  const errores      = [];
  const advertencias = [];

  const cients = Array.isArray(fichaObj.cientificos) ? fichaObj.cientificos : [];
  const dests  = Array.isArray(fichaObj.destinos)    ? fichaObj.destinos    : [];

  // Científicos
  if (cients.length < 2) errores.push('Menos de 2 científicos.');
  if (cients.length > 5) errores.push('Más de 5 científicos.');
  cients.forEach((c, i) => {
    if (!c.nombre)     errores.push(`Científico #${i + 1}: falta nombre.`);
    if (!c.disciplina) errores.push(`Científico #${i + 1}: falta disciplina.`);
    if (!c.aporte)     errores.push(`Científico #${i + 1}: falta aporte.`);
    if (!c.años)       errores.push(`Científico #${i + 1}: faltan años.`);
    if (c.aporte && c.aporte.length < 20)
      advertencias.push(`Científico #${i + 1}: aporte muy corto.`);
  });

  // Destinos
  if (dests.length < 2) errores.push('Menos de 2 destinos.');
  if (dests.length > 5) errores.push('Más de 5 destinos.');
  dests.forEach((d, i) => {
    if (!d.nombre)      errores.push(`Destino #${i + 1}: falta nombre.`);
    if (!d.descripcion) errores.push(`Destino #${i + 1}: falta descripción.`);
    if (!d.enlace) {
      errores.push(`Destino #${i + 1}: falta URL.`);
    } else if (!esURLValida(d.enlace)) {
      errores.push(`Destino #${i + 1}: URL inválida.`);
    }
    if (d.descripcion && d.descripcion.length < 20)
      advertencias.push(`Destino #${i + 1}: descripción muy corta.`);
  });

  return { valido: errores.length === 0, errores, advertencias };
}

/** Retorna el HTML de una fila simplificada de ficha */
function renderTarjeta(key, ficha) {
  const nombre  = escHtml(ficha.nombre || ficha._pais || key.split('/')[0]);
  const bandera = ficha.banderaEmoji || '🌍';
  const grupo   = ficha.autores?.grupo ? escHtml(ficha.autores.grupo) : '—';
  const autores = Array.isArray(ficha.autores?.nombres)
    ? ficha.autores.nombres.map(n => escHtml(n)).join(', ')
    : '—';
  const fecha   = formatFecha(ficha.timestamp);

  return `
    <div class="ficha-row">
      <div class="row-info">
        <span class="row-bandera">${bandera}</span>
        <div class="row-datos">
          <span class="row-pais">${nombre}</span>
          <span class="row-meta">Grupo <strong>${grupo}</strong>&nbsp;·&nbsp;${autores}</span>
        </div>
        <span class="row-fecha">${fecha}</span>
      </div>
      <div class="row-actions">
        <button class="btn-ver"      onclick="verFicha('${key}')">👁️ Vista Previa</button>
        <button class="btn-aprobar"  onclick="aprobarFicha('${key}')">✅ Aprobar</button>
        <button class="btn-rechazar" onclick="abrirRechazoDirecto('${key}')">❌ Rechazar</button>
      </div>
    </div>`;
}

/** Escapa HTML para evitar XSS al insertar datos del servidor */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── INIT ────────────────────────────────────────────────────────────────────

async function init() {
  try {
    // Autenticación anónima para poder leer/escribir en Firebase
    await signInAnonymously();
  } catch (err) {
    console.warn('[profesor.js] Auth anónima falló:', err);
  }

  // El acceso ya está protegido por la contraseña en index.html (2707)
  // No se verifica rol en Firebase para evitar conflictos entre dispositivos/navegadores

  // Listener en tiempo real sobre todas las fichas
  const fichasRef = ref(db, 'fichas/');
  onValue(fichasRef, snapshot => {
    todasLasFichas = snapshot.val() || {};
    renderListas(todasLasFichas);
    actualizarResumen(todasLasFichas);
  }, err => {
    console.error('[profesor.js] Error onValue fichas/', err);
    mostrarToast('Error al conectar con Firebase.', 'error');
  });
}


// ─── CARGAR Y RENDERIZAR FICHAS ─────────────────────────────────────────────

/**
 * Llama onValue una sola vez y rellena las tres listas.
 * En la práctica ya está cubierto por el listener de init(),
 * pero se exporta por si se necesita recargar manualmente.
 */
function cargarFichas() {
  const fichasRef = ref(db, 'fichas/');
  get(fichasRef).then(snapshot => {
    const data = snapshot.val() || {};
    renderListas(data);
    actualizarResumen(data);
  }).catch(err => {
    console.error('[profesor.js] cargarFichas error:', err);
    mostrarToast('No se pudieron cargar las fichas.', 'error');
  });
}

function renderListas(data) {
  const pendientes  = [];
  const aprobadas   = [];
  const rechazadas  = [];

  Object.entries(data).forEach(([pais, fichasPais]) => {
    // Cada país puede tener múltiples fichas indexadas por uid
    if (typeof fichasPais === 'object' && fichasPais !== null) {
      Object.entries(fichasPais).forEach(([uid, ficha]) => {
        if (typeof ficha !== 'object') return;
        const enriched = { ...ficha, uid, _pais: pais, _uid: uid };
        const est = ficha.estado || 'pendiente';
        if (est === 'pendiente')  pendientes.push([`${pais}/${uid}`, enriched]);
        else if (est === 'aprobado')  aprobadas.push([`${pais}/${uid}`, enriched]);
        else if (est === 'rechazado') rechazadas.push([`${pais}/${uid}`, enriched]);
      });
    }
  });

  fichasActuales = data;

  renderListaEnDOM('pendientesList',  pendientes,  'No hay fichas pendientes.');
  renderListaEnDOM('aprobadasList',   aprobadas,   'No hay fichas aprobadas todavía.');
  renderListaEnDOM('rechazadasList',  rechazadas,  'No hay fichas rechazadas.');
}

function renderListaEnDOM(containerId, items, mensajeVacio) {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (items.length === 0) {
    el.innerHTML = `<div class="tab-empty">${escHtml(mensajeVacio)}</div>`;
    return;
  }
  el.innerHTML = items
    .map(([key, ficha]) => renderTarjeta(key, ficha))
    .join('');
}

// ─── ACTUALIZAR RESUMEN ─────────────────────────────────────────────────────

function actualizarResumen(data) {
  let pendiente = 0, aprobado = 0, rechazado = 0;

  Object.values(data).forEach(fichasPais => {
    if (typeof fichasPais !== 'object') return;
    Object.values(fichasPais).forEach(ficha => {
      if (typeof ficha !== 'object') return;
      const est = ficha.estado || 'pendiente';
      if (est === 'pendiente')  pendiente++;
      else if (est === 'aprobado')  aprobado++;
      else if (est === 'rechazado') rechazado++;
    });
  });

  const set_ = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set_('countPendientes',  pendiente);
  set_('countAprobadas',   aprobado);
  set_('countRechazadas',  rechazado);
}

// ─── VER FICHA ──────────────────────────────────────────────────────────────

async function verFicha(key) {
  fichaActual = key;

  // key puede ser "MX/uid123" o simplemente "MX" en versión simplificada
  const parts   = key.split('/');
  const pais    = parts[0];
  const uid     = parts[1];
  const dbPath  = uid ? `fichas/${pais}/${uid}` : `fichas/${pais}`;

  try {
    const snapshot = await get(ref(db, dbPath));
    const ficha    = snapshot.val();
    if (!ficha) { mostrarToast('Ficha no encontrada.', 'error'); return; }

    const nombre  = escHtml(ficha.nombre   || pais);
    const bandera = ficha.banderaEmoji     || '🌍';
    const capital = escHtml(ficha.capital  || '—');
    const moneda  = escHtml(ficha.moneda   || '—');
    const grupo   = ficha.autores?.grupo   ? escHtml(ficha.autores.grupo) : '—';
    const autores = Array.isArray(ficha.autores?.nombres)
      ? ficha.autores.nombres.map(n => escHtml(n)).join(', ')
      : '—';
    const colP = ficha.coloresBandera?.primario   || '#0D3B2B';
    const colS = ficha.coloresBandera?.secundario || '#1B5E20';

    // Científicos
    const cients = Array.isArray(ficha.cientificos) ? ficha.cientificos : [];
    const cientHtml = cients.length
      ? cients.map(c => `
          <div class="preview-item">
            <strong>${escHtml(c.nombre || '?')}</strong><br>
            ${escHtml(c.aporte || '')}
          </div>`).join('')
      : '<p style="color:#aaa;font-size:13px;">Sin científicos registrados.</p>';

    // Jugadores
    const jugadores = Array.isArray(ficha.jugadoresEstrellas) ? ficha.jugadoresEstrellas : [];
    const jugHtml = jugadores.length
      ? jugadores.map(j => `
          <div class="preview-item">
            <strong>${escHtml(j.nombre || '?')}</strong> — ${escHtml(j.posicion || '?')}<br>
            Club: ${escHtml(j.club || '?')}
          </div>`).join('')
      : '<p style="color:#aaa;font-size:13px;">Sin jugadores registrados.</p>';

    // Sitios turísticos
    const sitios = Array.isArray(ficha.sitiosTuristicos) ? ficha.sitiosTuristicos : [];
    const sitHtml = sitios.length
      ? sitios.map(s => `
          <div class="preview-item">
            <strong>${escHtml(s.nombre || '?')}</strong><br>
            ${escHtml(s.descripcion || '')}<br>
            ${s.enlace ? `<a href="${escHtml(s.enlace)}" target="_blank" rel="noopener noreferrer">${escHtml(s.enlace)}</a>` : ''}
          </div>`).join('')
      : '<p style="color:#aaa;font-size:13px;">Sin sitios registrados.</p>';

    const body = document.getElementById('previewBody');
    if (body) {
      body.innerHTML = `
        <div class="preview-header" style="background:linear-gradient(135deg,${colP},${colS});">
          <span class="preview-bandera">${bandera}</span>
          <div>
            <div class="preview-titulo">${nombre}</div>
            <div class="preview-subtitulo">Capital: ${capital}&nbsp;·&nbsp;Moneda: ${moneda}</div>
          </div>
        </div>
        <div class="preview-section">
          <h4>🔬 Científicos</h4>
          ${cientHtml}
        </div>
        <div class="preview-section">
          <h4>⚽ Jugadores Estrellas</h4>
          ${jugHtml}
        </div>
        <div class="preview-section">
          <h4>🏖️ Sitios Turísticos</h4>
          ${sitHtml}
        </div>
        <div class="preview-autores">
          <strong>Grupo ${grupo}</strong>&nbsp;·&nbsp;Autores: ${autores}
          &nbsp;·&nbsp;Enviado: ${formatFecha(ficha.timestamp)}
        </div>
      `;
    }

    document.getElementById('fichaModal')?.classList.remove('hidden');

  } catch (err) {
    console.error('[profesor.js] verFicha error:', err);
    mostrarToast('Error al cargar la ficha.', 'error');
  }
}

// ─── CERRAR MODAL ───────────────────────────────────────────────────────────

function cerrarModal() {
  document.getElementById('fichaModal')?.classList.add('hidden');
}

// ─── APROBAR FICHA ──────────────────────────────────────────────────────────

async function aprobarFicha(key) {
  const target = key || fichaActual;
  if (!target) return;

  const parts  = target.split('/');
  const pais   = parts[0];
  const uid    = parts[1];
  const base   = uid ? `fichas/${pais}/${uid}` : `fichas/${pais}`;

  try {
    const uid_profesor = auth.currentUser?.uid || 'desconocido';

    // Actualizar estado de la ficha
    await set(ref(db, `${base}/estado`), 'aprobado');
    await set(ref(db, `${base}/fechaAprobacion`), Date.now());

    // Registrar en nodo de validación
    await set(ref(db, `validacion/${pais}`), {
      estado:           'aprobado',
      fechaAprobacion:  Date.now(),
      profesor_uid:     uid_profesor,
    });

    mostrarToast('✅ Ficha aprobada exitosamente.', 'exito');
    cerrarModal();
    fichaActual = null;
    console.log(`[profesor.js] Ficha aprobada: ${base}`);
  } catch (err) {
    console.error('[profesor.js] aprobarFicha error:', err);
    mostrarToast('Error al aprobar la ficha.', 'error');
  }
}

/** Alias para aprobar la ficha actualmente abierta en el modal */
function aprobarFichaActual() {
  aprobarFicha(fichaActual);
}

// ─── RECHAZAR FICHA ─────────────────────────────────────────────────────────

function abrirRechazo() {
  document.getElementById('motivoRechazo').value = '';
  document.getElementById('rechazoModal')?.classList.remove('hidden');
}

/** Rechaza directamente desde la tarjeta (sin abrir el modal de detalle) */
function abrirRechazoDirecto(key) {
  fichaActual = key;
  abrirRechazo();
}

function cerrarRechazo() {
  document.getElementById('rechazoModal')?.classList.add('hidden');
  document.getElementById('motivoRechazo').value = '';
}

async function guardarRechazo() {
  const motivo = document.getElementById('motivoRechazo')?.value.trim();
  if (!motivo) { alert('Escribe un motivo de rechazo antes de guardar.'); return; }

  const target = fichaActual;
  if (!target) return;

  const parts = target.split('/');
  const pais  = parts[0];
  const uid   = parts[1];
  const base  = uid ? `fichas/${pais}/${uid}` : `fichas/${pais}`;

  try {
    const uid_profesor = auth.currentUser?.uid || 'desconocido';

    await set(ref(db, `${base}/estado`),         'rechazado');
    await set(ref(db, `${base}/motivoRechazo`),  motivo);
    await set(ref(db, `${base}/fechaRechazo`),   Date.now());

    await set(ref(db, `validacion/${pais}`), {
      estado:        'rechazado',
      fechaRechazo:  Date.now(),
      profesor_uid:  uid_profesor,
      motivo,
    });

    mostrarToast('❌ Ficha rechazada.', 'error');
    cerrarRechazo();
    cerrarModal();
    fichaActual = null;
    console.log(`[profesor.js] Ficha rechazada: ${base}, motivo: ${motivo}`);
  } catch (err) {
    console.error('[profesor.js] guardarRechazo error:', err);
    mostrarToast('Error al rechazar la ficha.', 'error');
  }
}

// ─── LOGOUT ─────────────────────────────────────────────────────────────────

async function logout() {
  if (!confirm('¿Seguro que deseas cerrar sesión?')) return;
  try {
    await signOut(auth);
  } catch (err) {
    console.warn('[profesor.js] signOut error:', err);
  }
  window.location.href = 'index.html';
}

// ─── Exponer al scope global ─────────────────────────────────────────────────
window.init                = init;
window.verFicha            = verFicha;
window.cerrarModal         = cerrarModal;
window.aprobarFicha        = aprobarFicha;
window.aprobarFichaActual  = aprobarFichaActual;
window.abrirRechazo        = abrirRechazo;
window.abrirRechazoDirecto = abrirRechazoDirecto;
window.guardarRechazo      = guardarRechazo;
window.cerrarRechazo       = cerrarRechazo;
window.logout              = logout;
window.cargarFichas        = cargarFichas;
