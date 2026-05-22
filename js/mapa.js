/**
 * mapa.js
 * Lógica completa del mapa interactivo — Mundial 2026
 * Dependencias: Leaflet 1.9.4 (cargado en index.html)
 */

import { db } from './config-firebase.js';
import { ref, get, onValue } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js';

// ─── Estado global ─────────────────────────────────────────────────────────
let map;                   // Instancia del mapa Leaflet
let markers    = {};       // { [codigo]: L.CircleMarker }
let paises     = {};       // { [codigo]: objeto país } cargado desde paises.json
let currentCountry = null; // Código del país actualmente seleccionado
let fichasCache    = {};   // { [codigo]: ficha más relevante } — actualizado en tiempo real

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Devuelve el color de marcador según el estado de ficha del país */
function colorPorEstado(code) {
  const f = fichasCache[code];
  if (!f) return '#2196F3';
  if (f.estado === 'aprobado')  return '#4CAF50';
  if (f.estado === 'pendiente') return '#FFC107';
  if (f.estado === 'rechazado') return '#F44336';
  return '#2196F3';
}

/**
 * De un objeto { uid: fichaObj } devuelve la ficha más relevante.
 * Prioridad: aprobado > pendiente > rechazado, desempate por timestamp.
 */
function getMejorFicha(fichasPais) {
  if (!fichasPais || typeof fichasPais !== 'object') return null;
  const lista = Object.values(fichasPais).filter(f => f && typeof f === 'object');
  if (!lista.length) return null;
  const prio = { aprobado: 0, pendiente: 1, rechazado: 2 };
  return lista.sort((a, b) => {
    const pa = prio[a.estado] ?? 3;
    const pb = prio[b.estado] ?? 3;
    return pa !== pb ? pa - pb : (b.timestamp || 0) - (a.timestamp || 0);
  })[0];
}

/** Escapa HTML para prevenir XSS al insertar datos de Firebase */
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Genera el HTML del contenido de una ficha aprobada */
function renderFichaContent(ficha) {
  // Si la ficha tiene HTML (formato de los alumnos), mostrarlo en iframe
  // NOTA: el srcdoc se asigna por propiedad JS en select() para evitar problemas de encoding
  if (ficha.html) {
    return `
    <div class="info-section">
      <h4>📄 Ficha del país</h4>
      <iframe
        id="fichaIframe"
        style="width:100%;height:420px;border:1px solid #e0e0e0;border-radius:6px;margin-top:6px;"
        sandbox="allow-same-origin allow-scripts"
        title="Ficha del país"
      ></iframe>
    </div>`;
  }

  // Fallback: datos estructurados (compatibilidad futura)
  const cients = Array.isArray(ficha.cientificos) ? ficha.cientificos : [];
  const dests  = Array.isArray(ficha.destinos)    ? ficha.destinos    : [];

  const cientHtml = cients.length
    ? cients.map(c => `
        <div class="cientifico-card">
          <strong>${escHtml(c.nombre)}</strong> &mdash; ${escHtml(c.disciplina || '?')} (${escHtml(c.años || '?')})<br>
          <span style="color:#555;">${escHtml(c.aporte || '')}</span>
        </div>`).join('')
    : '<p style="color:#aaa;font-size:11px;">Sin científicos registrados.</p>';

  const destHtml = dests.length
    ? dests.map(d => `
        <div class="destino-card">
          <strong>${escHtml(d.nombre)}</strong><br>
          <span style="color:#555;">${escHtml(d.descripcion || '')}</span><br>
          ${d.enlace ? `<a href="${escHtml(d.enlace)}" target="_blank" rel="noopener noreferrer" class="destino-link">🔗 Visitar sitio</a>` : ''}
        </div>`).join('')
    : '<p style="color:#aaa;font-size:11px;">Sin destinos registrados.</p>';

  return `
    <div class="info-section">
      <h4>🔬 Científicos</h4>
      ${cientHtml}
    </div>
    <div class="info-section">
      <h4>🏖️ Destinos</h4>
      ${destHtml}
    </div>`;
}

// ─── Estructura de grupos A–L ───────────────────────────────────────────────
const grupos = {
  A: { nombre: 'Grupo A', paises: ['MX', 'ZA', 'KR', 'CZ'] },
  B: { nombre: 'Grupo B', paises: ['CA', 'BA', 'QA', 'CH'] },
  C: { nombre: 'Grupo C', paises: ['BR', 'MA', 'HT', 'SC'] },
  D: { nombre: 'Grupo D', paises: ['US', 'PY', 'AU', 'TR'] },
  E: { nombre: 'Grupo E', paises: ['DE', 'CW', 'CI', 'EC'] },
  F: { nombre: 'Grupo F', paises: ['NL', 'JP', 'SE', 'TN'] },
  G: { nombre: 'Grupo G', paises: ['BE', 'EG', 'IR', 'NZ'] },
  H: { nombre: 'Grupo H', paises: ['ES', 'CV', 'SA', 'UY'] },
  I: { nombre: 'Grupo I', paises: ['FR', 'SN', 'IQ', 'NO'] },
  J: { nombre: 'Grupo J', paises: ['AR', 'DZ', 'AT', 'JO'] },
  K: { nombre: 'Grupo K', paises: ['PT', 'CD', 'UZ', 'CO'] },
  L: { nombre: 'Grupo L', paises: ['GB', 'HR', 'GH', 'PA'] },
};

// ─── Estilos CSS de tarjetas (inyectados una sola vez) ──────────────────────
(function injectCardStyles() {
  if (document.getElementById('mapa-card-styles')) return;
  const style = document.createElement('style');
  style.id = 'mapa-card-styles';
  style.textContent = `
    .country-card {
      background: white;
      border-radius: 8px;
      border: 1px solid #e0e0e0;
      overflow: hidden;
    }
    .card-header {
      background: linear-gradient(160deg, #0D3B2B, #1B5E20);
      color: white;
      padding: 12px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .card-flag { font-size: 36px; line-height: 1; }
    .card-title h3 {
      font-size: 14px;
      font-weight: 600;
      color: white;
      margin-bottom: 2px;
    }
    .card-title p {
      font-size: 11px;
      opacity: 0.75;
      color: white;
    }
    .card-body { padding: 12px; }
    .info-row {
      margin-bottom: 8px;
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      font-size: 12px;
    }
    .info-label {
      color: #888;
      font-weight: 600;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      flex-shrink: 0;
    }
    .info-value {
      color: #1a1a1a;
      text-align: right;
      flex: 1;
      margin-left: 6px;
    }
    .card-ficha-hint {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
      font-size: 12px;
      color: #888;
      text-align: center;
    }
    /* ── Badge contador de fichas ── */
    .badge {
      font-size: 11px;
      color: rgba(255,255,255,0.85);
      margin-top: 8px;
      padding: 3px 8px;
      background: rgba(255,255,255,0.12);
      border-radius: 12px;
      display: inline-block;
    }
    .badge #fichasAprobadas { font-weight: 700; color: #A5D6A7; }
    /* ── Estado badge en tarjeta ── */
    .status-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: 600;
      margin-left: auto;
      align-self: flex-start;
      white-space: nowrap;
    }
    .status-badge.pending  { background: #FFC107; color: #333; }
    .status-badge.approved { background: #4CAF50; color: white; }
    .status-badge.rejected { background: #F44336; color: white; }
    /* ── Secciones de ficha aprobada ── */
    .info-section {
      margin-top: 10px;
      padding-top: 10px;
      border-top: 1px solid #e0e0e0;
    }
    .info-section h4 {
      color: #0D3B2B;
      font-size: 11px;
      font-weight: 700;
      margin-bottom: 8px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .cientifico-card {
      background: #f9f9f9;
      padding: 8px;
      border-radius: 4px;
      margin-bottom: 6px;
      border-left: 3px solid #0D3B2B;
      font-size: 11px;
      line-height: 1.6;
    }
    .destino-card {
      background: #f9f9f9;
      padding: 8px;
      border-radius: 4px;
      margin-bottom: 6px;
      border-left: 3px solid #4CAF50;
      font-size: 11px;
      line-height: 1.6;
    }
    .destino-link {
      color: #0D5A7F;
      text-decoration: none;
      font-weight: 600;
      font-size: 11px;
    }
    .destino-link:hover { text-decoration: underline; }
  `;
  document.head.appendChild(style);
})();

// ───────────────────────────────────────────────────────────────────────────
// INIT — Punto de entrada llamado desde DOMContentLoaded en index.html
// ───────────────────────────────────────────────────────────────────────────
function init() {
  // 1. Crear mapa centrado en el mundo
  map = L.map('map').setView([20, 0], 3);

  // 2. Cargar capa de tiles (OpenStreetMap)
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);

  // 3. Cargar datos de países desde paises.json
  fetch('data/paises.json')
    .then(res => {
      if (!res.ok) throw new Error('No se pudo cargar data/paises.json');
      return res.json();
    })
    .then(json => {
      // Transformar array a mapa indexado por código
      json.paises.forEach(p => { paises[p.codigo] = p; });

      // 4. Crear un marcador Leaflet por cada país
      Object.values(paises).forEach(p => {
        const marker = L.circleMarker([p.latitud, p.longitud], {
          radius:      7,
          fillColor:   '#2196F3',
          color:       '#fff',
          weight:      2,
          opacity:     1,
          fillOpacity: 0.85,
        }).addTo(map);

        // Tooltip permanente con emoji + nombre
        const label = `${p.emoji} ${p.nombre}`;
        marker.bindTooltip(label, {
          permanent:  false,
          direction:  'top',
          offset:     [0, -8],
          className:  'leaflet-tooltip-pais',
        });

        // Evento click
        marker.on('click', () => select(p.codigo));

        markers[p.codigo] = marker;
      });

      // 5. Poblar las listas laterales
      renderPaises();
      renderGrupos();

      // 6. Inyectar badge de fichas aprobadas en el header de la lista
      const listHeader = document.querySelector('.list-header');
      if (listHeader && !document.getElementById('fichasBadge')) {
        const badge = document.createElement('div');
        badge.id        = 'fichasBadge';
        badge.className = 'badge';
        badge.innerHTML = '<span id="fichasAprobadas">0</span>/48 fichas aprobadas';
        listHeader.appendChild(badge);
      }

      // 7. Escuchar cambios de fichas en tiempo real
      escucharCambiosFichas();
    })
    .catch(err => console.error('Error cargando paises.json:', err));
}

// ───────────────────────────────────────────────────────────────────────────
// RENDER PAÍSES — Lista alfabética en el tab "País"
// ───────────────────────────────────────────────────────────────────────────
function renderPaises() {
  const sorted = Object.entries(paises).sort(([, a], [, b]) =>
    a.nombre.localeCompare(b.nombre, 'es')
  );

  const html = sorted.map(([code, p]) => `
    <div class="country-item" id="item-${code}" onclick="select('${code}')">
      <span class="country-item-emoji">${p.emoji}</span>
      <span class="country-item-name">${p.nombre}</span>
      <span class="country-item-code">${code}</span>
    </div>
  `).join('');

  document.getElementById('countriesScroll').innerHTML = html;
}

// ───────────────────────────────────────────────────────────────────────────
// RENDER GRUPOS — Lista agrupada en el tab "Grupos"
// ───────────────────────────────────────────────────────────────────────────
function renderGrupos() {
  const html = Object.entries(grupos).map(([letra, grupo]) => {
    const items = grupo.paises.map(code => {
      const p = paises[code];
      if (!p) return '';
      return `
        <div class="country-item" id="item-grp-${code}" onclick="select('${code}')">
          <span class="country-item-emoji">${p.emoji}</span>
          <span class="country-item-name">${p.nombre}</span>
          <span class="country-item-code">${code}</span>
        </div>
      `;
    }).join('');

    return `
      <div class="group">
        <div class="group-name" onclick="toggleGroup(this)">
          <span>${grupo.nombre}</span>
          <span class="group-toggle" id="toggle-${letra}">▼</span>
        </div>
        <div class="group-items" id="group-items-${letra}">
          ${items}
        </div>
      </div>
    `;
  }).join('');

  document.getElementById('groupsScroll').innerHTML = html;
}

// ───────────────────────────────────────────────────────────────────────────
// TOGGLE GROUP — Expande / colapsa un grupo en la vista de Grupos
// ───────────────────────────────────────────────────────────────────────────
function toggleGroup(element) {
  const items  = element.nextElementSibling;
  const toggle = element.querySelector('.group-toggle');
  if (!items || !toggle) return;
  items.classList.toggle('collapsed');
  toggle.classList.toggle('collapsed');
}

// ───────────────────────────────────────────────────────────────────────────
// SWITCH TAB — Cambia entre los tabs "País" y "Grupos"
// ───────────────────────────────────────────────────────────────────────────
function switchTab(tab) {
  // Desactivar todos los botones y paneles
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });
  document.querySelectorAll('#paises-tab, #grupos-tab').forEach(panel => {
    panel.classList.remove('active');
  });

  // Activar botón del tab seleccionado
  const btn = document.querySelector(`.tab-btn[onclick="switchTab('${tab}')"]`);
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
  }

  // Activar panel del tab seleccionado
  const panel = document.getElementById(`${tab}-tab`);
  if (panel) panel.classList.add('active');
}

// ───────────────────────────────────────────────────────────────────────────
// SELECT — Selecciona un país: resalta marcador, lista y muestra tarjeta
// ───────────────────────────────────────────────────────────────────────────
async function select(code) {
  const data = paises[code];
  if (!data) return;

  currentCountry = code;

  // ── Resaltar ítem en las listas ──────────────────────────────────────────
  document.querySelectorAll('.country-item').forEach(el => el.classList.remove('active'));
  ['item-' + code, 'item-grp-' + code].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.classList.add('active');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  });

  // ── Resetear todos los marcadores al color de su ficha ──────────────────
  Object.entries(markers).forEach(([c, m]) => {
    if (m._path) m._path.classList.remove('marker-pulse', 'marker-blink');
    m.setRadius(7);
    m.setStyle({ weight: 2, fillOpacity: 0.85, fillColor: colorPorEstado(c) });
  });

  // ── Resaltar marcador seleccionado (más grande + animación) ──────────────
  const selectedMarker = markers[code];
  if (selectedMarker) {
    if (selectedMarker._path) selectedMarker._path.classList.add('marker-pulse', 'marker-blink');
    selectedMarker.setRadius(14);
    // Usar color de ficha; si no hay ficha, verde para indicar selección
    const col = colorPorEstado(code) !== '#2196F3' ? colorPorEstado(code) : '#4CAF50';
    selectedMarker.setStyle({ weight: 3, fillOpacity: 1, fillColor: col });
  }

  // ── Mover el mapa al país ────────────────────────────────────────────────
  map.setView([data.latitud, data.longitud], 6, { animate: true });

  // ── Construir tarjeta base de inmediato ──────────────────────────────────
  const grupoLetra  = data.grupo;
  const grupoNombre = grupos[grupoLetra] ? grupos[grupoLetra].nombre : `Grupo ${grupoLetra}`;

  document.querySelector('.panel-content').innerHTML = `
    <div class="country-card">
      <div class="card-header">
        <div class="card-flag">${data.emoji}</div>
        <div class="card-title">
          <h3>${data.nombre}</h3>
          <p>${data.codigo} · ${grupoNombre}</p>
        </div>
        <div id="cardStatus" class="status-badge"></div>
      </div>
      <div class="card-body">
        <div class="info-row">
          <span class="info-label">Capital</span>
          <span class="info-value">${data.capital}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Moneda</span>
          <span class="info-value">${data.moneda}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Ubicación</span>
          <span class="info-value">${data.ubicacion}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Coordenadas</span>
          <span class="info-value" style="font-family:monospace;font-size:11px;">
            ${data.latitud}°, ${data.longitud}°
          </span>
        </div>
        <div id="fichaContent">
          <div class="card-ficha-hint" style="color:#bbb;">⏳ Cargando ficha…</div>
        </div>
      </div>
    </div>`;

  // ── Obtener ficha desde Firebase ─────────────────────────────────────────
  try {
    const snapshot = await get(ref(db, `fichas/${code}`));
    const ficha    = getMejorFicha(snapshot.val());

    // Ignorar si el usuario ya cambió de país mientras cargaba
    if (currentCountry !== code) return;

    const statusEl = document.getElementById('cardStatus');
    const fichaEl  = document.getElementById('fichaContent');

    if (!ficha) {
      // Sin ficha registrada
      if (statusEl) statusEl.className = 'status-badge';
      if (fichaEl)  fichaEl.innerHTML  = '<div class="card-ficha-hint">📌 Ficha lista para llenar</div>';

    } else if (ficha.estado === 'aprobado') {
      if (statusEl) { statusEl.className = 'status-badge approved'; statusEl.textContent = '✓ Aprobada'; }
      if (fichaEl) {
        fichaEl.innerHTML = renderFichaContent(ficha);
        // Asignar srcdoc como propiedad para evitar problemas de encoding HTML
        if (ficha.html) {
          const iframe = document.getElementById('fichaIframe');
          if (iframe) iframe.srcdoc = ficha.html;
        }
      }

    } else if (ficha.estado === 'pendiente') {
      if (statusEl) { statusEl.className = 'status-badge pending'; statusEl.textContent = '⏳ Pendiente'; }
      if (fichaEl)  fichaEl.innerHTML  = '<div class="card-ficha-hint">⏳ Ficha enviada, en revisión por el profesor…</div>';

    } else if (ficha.estado === 'rechazado') {
      const motivo = ficha.motivoRechazo
        ? `<p style="margin-top:6px;font-size:11px;color:#c62828;">${escHtml(ficha.motivoRechazo)}</p>`
        : '';
      if (statusEl) { statusEl.className = 'status-badge rejected'; statusEl.textContent = '✗ Rechazada'; }
      if (fichaEl)  fichaEl.innerHTML  = `<div class="card-ficha-hint">⚠️ Ficha rechazada.</div>${motivo}`;
    }

  } catch (err) {
    console.error('[mapa.js] Error al obtener ficha:', err);
    if (currentCountry === code) {
      const fichaEl = document.getElementById('fichaContent');
      if (fichaEl) fichaEl.innerHTML = '<div class="card-ficha-hint" style="color:#bbb;">Sin conexión a Firebase.</div>';
    }
  }
}

// ───────────────────────────────────────────────────────────────────────────
// ESCUCHAR CAMBIOS DE FICHAS — actualiza colores y badge en tiempo real
// ───────────────────────────────────────────────────────────────────────────
function escucharCambiosFichas() {
  onValue(ref(db, 'fichas/'), snapshot => {
    const data = snapshot.val() || {};
    let aprobadas = 0;

    // Actualizar cache y colores de todos los marcadores
    Object.keys(paises).forEach(code => {
      const ficha = getMejorFicha(data[code]);
      if (ficha) {
        fichasCache[code] = ficha;
        if (ficha.estado === 'aprobado') aprobadas++;
      } else {
        delete fichasCache[code];
      }

      // Solo tocar marcadores que NO son el actualmente seleccionado
      // (el seleccionado conserva la animación)
      const marker = markers[code];
      if (marker && code !== currentCountry) {
        marker.setStyle({ fillColor: colorPorEstado(code) });
      }
    });

    // Actualizar badge contador
    const badge = document.getElementById('fichasAprobadas');
    if (badge) badge.textContent = aprobadas;

    // Si hay país seleccionado en pantalla, refrescar su panel de info
    if (currentCountry && data[currentCountry]) {
      const ficha    = getMejorFicha(data[currentCountry]);
      const fichaEl  = document.getElementById('fichaContent');
      const statusEl = document.getElementById('cardStatus');
      if (!fichaEl || !statusEl) return;

      if (!ficha) {
        statusEl.className   = 'status-badge';
        statusEl.textContent = '';
        fichaEl.innerHTML    = '<div class="card-ficha-hint">📌 Ficha lista para llenar</div>';
      } else if (ficha.estado === 'aprobado') {
        statusEl.className   = 'status-badge approved';
        statusEl.textContent = '✓ Aprobada';
        fichaEl.innerHTML    = renderFichaContent(ficha);
      } else if (ficha.estado === 'pendiente') {
        statusEl.className   = 'status-badge pending';
        statusEl.textContent = '⏳ Pendiente';
        fichaEl.innerHTML    = '<div class="card-ficha-hint">⏳ Ficha en revisión por el profesor…</div>';
      } else if (ficha.estado === 'rechazado') {
        const motivo = ficha.motivoRechazo
          ? `<p style="margin-top:6px;font-size:11px;color:#c62828;">${escHtml(ficha.motivoRechazo)}</p>`
          : '';
        statusEl.className   = 'status-badge rejected';
        statusEl.textContent = '✗ Rechazada';
        fichaEl.innerHTML    = `<div class="card-ficha-hint">⚠️ Ficha rechazada.</div>${motivo}`;
      }
    }
  }, err => {
    console.error('[mapa.js] escucharCambiosFichas error:', err);
  });
}

// ─── Exponer funciones al scope global (necesario para onclick en HTML) ─────
window.init         = init;
window.select       = select;
window.switchTab    = switchTab;
window.toggleGroup  = toggleGroup;
