/**
 * ficha.js
 * Lógica completa del formulario de carga de fichas — Mundial 2026
 * Depende de: config-firebase.js (auth, db, signInAnonymously)
 */

import { db } from './config-firebase.js';
import { ref, set } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';
// ─── Estado global ──────────────────────────────────────────────────────────
let fichaData       = {};
let cientificosCount = 0;
let destinosCount    = 0;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Valida que una cadena sea una URL http/https */
function esURLValida(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Muestra un toast temporal en pantalla */
function mostrarToast(msg, tipo = 'exito') {
  let toast = document.getElementById('ficha-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ficha-toast';
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
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity = '0'; }, 3000);
}

function mostrarError(msg)  { mostrarToast('⚠️ ' + msg, 'error'); }
function mostrarExito(msg)  { mostrarToast('✅ ' + msg, 'exito'); }

/** Lee el valor de un input/select/textarea por su name */
function val(name) {
  const el = document.querySelector(`[name="${name}"]`);
  return el ? el.value.trim() : '';
}

// ─── HTML Templates ─────────────────────────────────────────────────────────

function templateCientifico(idx) {
  return `
    <div class="cientifico-item" id="cientifico-${idx}">
      <div class="item-header">
        <h4>Científico #${idx}</h4>
        <button type="button" onclick="eliminarCientifico(${idx})" aria-label="Eliminar">✕</button>
      </div>
      <div class="item-body">
        <label>Nombre *
          <input type="text" name="cient_nombre_${idx}" placeholder="Ej: Mario Molina" required oninput="mostrarPrevia()">
        </label>
        <label>Disciplina *
          <select name="cient_disciplina_${idx}" required onchange="mostrarPrevia()">
            <option value="">-- Selecciona --</option>
            <option>Física</option>
            <option>Química</option>
            <option>Biología</option>
            <option>Matemáticas</option>
            <option>Astronomía</option>
            <option>Medicina</option>
            <option>Ingeniería</option>
            <option>Otro</option>
          </select>
        </label>
        <label>Aporte / Descubrimiento *
          <textarea name="cient_aporte_${idx}" placeholder="¿Qué descubrió o logró?" required oninput="mostrarPrevia()"></textarea>
        </label>
        <label>Años (Ej: 1943-2020) *
          <input type="text" name="cient_anios_${idx}" placeholder="1943-2020" pattern="\\d{4}(-\\d{4})?" required oninput="mostrarPrevia()">
        </label>
      </div>
    </div>`;
}

function templateDestino(idx) {
  return `
    <div class="destino-item" id="destino-${idx}">
      <div class="item-header">
        <h4>Destino #${idx}</h4>
        <button type="button" onclick="eliminarDestino(${idx})" aria-label="Eliminar">✕</button>
      </div>
      <div class="item-body">
        <label>Nombre *
          <input type="text" name="dest_nombre_${idx}" placeholder="Ej: Chichén Itzá" required oninput="mostrarPrevia()">
        </label>
        <label>Descripción *
          <textarea name="dest_descripcion_${idx}" placeholder="¿Por qué visitarlo?" required oninput="mostrarPrevia()"></textarea>
        </label>
        <label>Enlace Oficial (URL) *
          <input type="url" name="dest_url_${idx}" placeholder="https://..." required oninput="mostrarPrevia()">
        </label>
      </div>
    </div>`;
}

// ─── INIT ────────────────────────────────────────────────────────────────────
/**
 * Punto de entrada llamado desde DOMContentLoaded en agregar-ficha.html.
 * La página ya renderiza 2 científicos y 2 destinos con sus propias funciones,
 * así que init() sólo configura el submit y la restauración de borrador.
 */
function init() {
  // Restaurar borrador si la página aún no lo ha hecho
  const paisSelect = document.getElementById('pais');
  if (paisSelect) {
    // Intentar restaurar último borrador guardado
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('ficha_')) {
        const restaurar = confirm('Se encontró un borrador guardado. ¿Deseas restaurarlo?');
        if (restaurar) cargarBorrador(key);
        break;
      }
    }
  }

  // Submit del formulario → Firebase
  const form = document.getElementById('fichaForm');
  if (form) {
    form.addEventListener('submit', e => {
      e.preventDefault();
      enviarFirebase();
    });
  }

  mostrarPrevia();
}

// ─── AGREGAR / ELIMINAR CIENTÍFICOS ────────────────────────────────────────

function agregarCientifico() {
  const items = document.querySelectorAll('.cientifico-item').length;
  if (items >= 5) { alert('Máximo 5 científicos por ficha.'); return; }
  cientificosCount++;
  const container = document.getElementById('cientificosContainer');
  container.insertAdjacentHTML('beforeend', templateCientifico(cientificosCount));
  actualizarContadores();
  mostrarPrevia();
}

function eliminarCientifico(idx) {
  const items = document.querySelectorAll('.cientifico-item').length;
  if (items <= 2) { alert('Debes tener al menos 2 científicos.'); return; }
  const el = document.getElementById(`cientifico-${idx}`);
  if (el) el.remove();
  actualizarContadores();
  mostrarPrevia();
}

// ─── AGREGAR / ELIMINAR DESTINOS ───────────────────────────────────────────

function agregarDestino() {
  const items = document.querySelectorAll('.destino-item').length;
  if (items >= 5) { alert('Máximo 5 destinos por ficha.'); return; }
  destinosCount++;
  const container = document.getElementById('destinosContainer');
  container.insertAdjacentHTML('beforeend', templateDestino(destinosCount));
  actualizarContadores();
  mostrarPrevia();
}

function eliminarDestino(idx) {
  const items = document.querySelectorAll('.destino-item').length;
  if (items <= 2) { alert('Debes tener al menos 2 destinos.'); return; }
  const el = document.getElementById(`destino-${idx}`);
  if (el) el.remove();
  actualizarContadores();
  mostrarPrevia();
}

// ─── ACTUALIZAR CONTADORES / BOTÓN ENVIAR ──────────────────────────────────

function actualizarContadores() {
  const nc = document.querySelectorAll('.cientifico-item').length;
  const nd = document.querySelectorAll('.destino-item').length;
  const pais = document.getElementById('pais')?.value || '';

  const cc = document.getElementById('contadorCientificos');
  if (cc) {
    cc.textContent = `${nc} / mínimo 2 científicos`;
    cc.className   = 'contador ' + (nc >= 2 ? 'ok' : 'error');
  }

  const cd = document.getElementById('contadorDestinos');
  if (cd) {
    cd.textContent = `${nd} / mínimo 2 destinos`;
    cd.className   = 'contador ' + (nd >= 2 ? 'ok' : 'error');
  }

  const btnEnviar = document.getElementById('btnEnviar');
  const habilitado = !!pais && nc >= 2 && nd >= 2;
  if (btnEnviar) btnEnviar.disabled = !habilitado;

  const msgVal = document.getElementById('msgValidacion');
  if (msgVal) msgVal.classList.toggle('visible', !habilitado);
}

// ─── VALIDAR FICHA ─────────────────────────────────────────────────────────

function validarFicha() {
  const errores      = [];
  const advertencias = [];

  // Grupo y nombres
  const grupo   = document.getElementById('grupo')?.value   || '';
  const alumno1 = document.getElementById('alumno1')?.value.trim() || '';
  if (!grupo)   errores.push('Debes seleccionar tu grupo.');
  if (!alumno1) errores.push('Debes escribir al menos el nombre del alumno 1.');

  // País
  const pais = document.getElementById('pais')?.value || '';
  if (!pais) errores.push('Debes seleccionar un país.');

  // Científicos
  const cientItems = document.querySelectorAll('.cientifico-item');
  if (cientItems.length < 2) {
    errores.push('Debes agregar al menos 2 científicos.');
  }
  cientItems.forEach((item, i) => {
    const id = item.id.split('-')[1];
    const nombre     = item.querySelector(`[name="cient_nombre_${id}"]`)?.value.trim()     || '';
    const disciplina = item.querySelector(`[name="cient_disciplina_${id}"]`)?.value.trim() || '';
    const aporte     = item.querySelector(`[name="cient_aporte_${id}"]`)?.value.trim()     || '';
    const anios      = item.querySelector(`[name="cient_anios_${id}"]`)?.value.trim()      || '';

    if (!nombre)     errores.push(`Científico #${i + 1}: falta el nombre.`);
    if (!disciplina) errores.push(`Científico #${i + 1}: falta la disciplina.`);
    if (!aporte)     errores.push(`Científico #${i + 1}: falta el aporte/descubrimiento.`);
    if (!anios)      errores.push(`Científico #${i + 1}: faltan los años.`);
    if (aporte && aporte.length < 20) {
      advertencias.push(`Científico #${i + 1}: la descripción del aporte es muy corta.`);
    }
  });

  // Destinos
  const destItems = document.querySelectorAll('.destino-item');
  if (destItems.length < 2) {
    errores.push('Debes agregar al menos 2 destinos turísticos.');
  }
  destItems.forEach((item, i) => {
    const id = item.id.split('-')[1];
    const nombre      = item.querySelector(`[name="dest_nombre_${id}"]`)?.value.trim()      || '';
    const descripcion = item.querySelector(`[name="dest_descripcion_${id}"]`)?.value.trim() || '';
    const url         = item.querySelector(`[name="dest_url_${id}"]`)?.value.trim()         || '';

    if (!nombre)      errores.push(`Destino #${i + 1}: falta el nombre.`);
    if (!descripcion) errores.push(`Destino #${i + 1}: falta la descripción.`);
    if (!url) {
      errores.push(`Destino #${i + 1}: falta el enlace URL.`);
    } else if (!esURLValida(url)) {
      errores.push(`Destino #${i + 1}: la URL no es válida (debe empezar con http o https).`);
    }
    if (descripcion && descripcion.length < 20) {
      advertencias.push(`Destino #${i + 1}: la descripción es muy corta.`);
    }
  });

  return { valido: errores.length === 0, errores, advertencias };
}

// ─── CONSTRUIR OBJETO fichaData ─────────────────────────────────────────────

function construirFichaData(estado = 'borrador') {
  const pais   = document.getElementById('pais')?.value   || '';
  const grupo  = document.getElementById('grupo')?.value  || '';
  const nombres = [
    document.getElementById('alumno1')?.value.trim() || '',
    document.getElementById('alumno2')?.value.trim() || '',
    document.getElementById('alumno3')?.value.trim() || '',
  ].filter(n => n !== '');

  const cientificos = [];
  document.querySelectorAll('.cientifico-item').forEach(item => {
    const id = item.id.split('-')[1];
    cientificos.push({
      nombre:     item.querySelector(`[name="cient_nombre_${id}"]`)?.value.trim()     || '',
      disciplina: item.querySelector(`[name="cient_disciplina_${id}"]`)?.value.trim() || '',
      aporte:     item.querySelector(`[name="cient_aporte_${id}"]`)?.value.trim()     || '',
      años:       item.querySelector(`[name="cient_anios_${id}"]`)?.value.trim()      || '',
    });
  });

  const destinos = [];
  document.querySelectorAll('.destino-item').forEach(item => {
    const id = item.id.split('-')[1];
    destinos.push({
      nombre:      item.querySelector(`[name="dest_nombre_${id}"]`)?.value.trim()      || '',
      descripcion: item.querySelector(`[name="dest_descripcion_${id}"]`)?.value.trim() || '',
      enlace:      item.querySelector(`[name="dest_url_${id}"]`)?.value.trim()         || '',
    });
  });

  return {
    pais,
    grupo,
    nombres,
    cientificos,
    destinos,
    timestamp: Date.now(),
    estado,
  };
}

// ─── MOSTRAR PREVIA ─────────────────────────────────────────────────────────

function mostrarPrevia() {
  actualizarContadores();
  fichaData = construirFichaData('borrador');

  const ta = document.getElementById('previewJSON');
  if (ta) ta.value = JSON.stringify(fichaData, null, 2);

  // Auto-guardar borrador silencioso si hay país seleccionado
  if (fichaData.pais) {
    localStorage.setItem(`ficha_${fichaData.pais}`, JSON.stringify(fichaData));
  }
}

// ─── COPIAR JSON ────────────────────────────────────────────────────────────

function copiarJSON() {
  const ta = document.getElementById('previewJSON');
  if (!ta || !ta.value.trim()) { mostrarError('Primero completa el formulario.'); return; }
  navigator.clipboard.writeText(ta.value)
    .then(() => mostrarExito('JSON copiado al portapapeles.'))
    .catch(() => {
      ta.select();
      document.execCommand('copy');
      mostrarExito('JSON copiado.');
    });
}

// ─── GUARDAR BORRADOR ───────────────────────────────────────────────────────

function guardarBorrador() {
  fichaData = construirFichaData('borrador');
  if (!fichaData.pais) { mostrarError('Selecciona un país antes de guardar.'); return; }
  localStorage.setItem(`ficha_${fichaData.pais}`, JSON.stringify(fichaData));
  mostrarExito('Borrador guardado ✓');
  console.log('[ficha.js] Borrador guardado:', fichaData);
}

// ─── CARGAR BORRADOR ────────────────────────────────────────────────────────

function cargarBorrador(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return;
    const data = JSON.parse(raw);

    // Restaurar país
    const paisSel = document.getElementById('pais');
    if (paisSel && data.pais) paisSel.value = data.pais;

    // Restaurar científicos
    const cientContainer = document.getElementById('cientificosContainer');
    if (cientContainer && Array.isArray(data.cientificos)) {
      cientContainer.innerHTML = '';
      cientificosCount = 0;
      data.cientificos.forEach(c => {
        cientificosCount++;
        cientContainer.insertAdjacentHTML('beforeend', templateCientifico(cientificosCount));
        const id = cientificosCount;
        setVal(`cient_nombre_${id}`,     c.nombre);
        setVal(`cient_disciplina_${id}`, c.disciplina);
        setVal(`cient_aporte_${id}`,     c.aporte);
        setVal(`cient_anios_${id}`,      c.años);
      });
    }

    // Restaurar destinos
    const destContainer = document.getElementById('destinosContainer');
    if (destContainer && Array.isArray(data.destinos)) {
      destContainer.innerHTML = '';
      destinosCount = 0;
      data.destinos.forEach(d => {
        destinosCount++;
        destContainer.insertAdjacentHTML('beforeend', templateDestino(destinosCount));
        const id = destinosCount;
        setVal(`dest_nombre_${id}`,      d.nombre);
        setVal(`dest_descripcion_${id}`, d.descripcion);
        setVal(`dest_url_${id}`,         d.enlace);
      });
    }

    mostrarPrevia();
    console.log('[ficha.js] Borrador restaurado:', data);
  } catch (err) {
    console.error('[ficha.js] Error al cargar borrador:', err);
  }
}

/** Helper para asignar valor a un campo por name */
function setVal(name, value) {
  const el = document.querySelector(`[name="${name}"]`);
  if (el && value !== undefined) el.value = value;
}

// ─── ENVIAR A FIREBASE ──────────────────────────────────────────────────────

async function enviarFicha() {
  // 1. Validar
  const { valido, errores, advertencias } = validarFicha();

  if (!valido) {
    mostrarError(errores[0]);
    console.warn('[ficha.js] Errores de validación:', errores);
    // Mostrar todos los errores en consola para depuración
    errores.forEach(e => console.warn(' -', e));
    return;
  }

  if (advertencias.length) {
    advertencias.forEach(a => console.info('[ficha.js] Advertencia:', a));
  }

  // 2. Construir ficha con estado "pendiente"
  fichaData = construirFichaData('pendiente');

  try {
    // 3. Guardar en Firebase: fichas/{pais}/{grupo}-{timestamp}
    const key = `${fichaData.grupo}-${fichaData.timestamp}`;
    const fichaRef = ref(db, `fichas/${fichaData.pais}/${key}`);
    await set(fichaRef, fichaData);

    console.log('[ficha.js] Ficha enviada a Firebase:', fichaRef.toString());

    // 5. Limpiar borrador guardado
    localStorage.removeItem(`ficha_${fichaData.pais}`);

    // 6. Notificar y redirigir
    mostrarExito('Ficha enviada exitosamente para revisión.');
    alert('✅ Tu ficha fue enviada y está pendiente de revisión por el profesor.');
    setTimeout(() => { window.location.href = 'index.html'; }, 2000);

  } catch (err) {
    console.error('[ficha.js] Error al enviar a Firebase:', err);
    mostrarError('Error al conectar con Firebase. Revisa tu conexión e inténtalo de nuevo.');
    // Guardar como borrador para no perder datos
    guardarBorrador();
  }
}

// ─── LIMPIAR FORMULARIO ─────────────────────────────────────────────────────

function limpiarForm() {
  if (!confirm('¿Seguro que deseas limpiar todo el formulario? Se perderá el borrador.')) return;

  const pais = document.getElementById('pais')?.value;

  // Borrar borrador en localStorage
  if (pais) localStorage.removeItem(`ficha_${pais}`);

  // Resetear formulario HTML nativo
  const form = document.getElementById('fichaForm');
  if (form) form.reset();

  // Limpiar contenedores dinámicos
  const cc = document.getElementById('cientificosContainer');
  const dc = document.getElementById('destinosContainer');
  if (cc) cc.innerHTML = '';
  if (dc) dc.innerHTML = '';

  cientificosCount = 0;
  destinosCount    = 0;

  // Agregar 2 científicos y 2 destinos vacíos
  agregarCientifico();
  agregarCientifico();
  agregarDestino();
  agregarDestino();

  mostrarPrevia();
  mostrarExito('Formulario limpiado.');
}

// ─── Exponer al scope global (llamados desde onclick en HTML) ───────────────
window.init              = init;
window.agregarCientifico = agregarCientifico;
window.eliminarCientifico= eliminarCientifico;
window.agregarDestino    = agregarDestino;
window.eliminarDestino   = eliminarDestino;
window.mostrarPrevia     = mostrarPrevia;
window.copiarJSON        = copiarJSON;
window.guardarBorrador   = guardarBorrador;
window.limpiarForm       = limpiarForm;
window.enviarFicha       = enviarFicha;
// Alias usado por el submit listener en agregar-ficha.html
window.enviarFirebase    = enviarFicha;
