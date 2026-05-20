/**
 * config-firebase.js
 * Configuración e inicialización de Firebase para Mundial 2026
 */

// Import Firebase SDK from CDN
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js";
import { getAuth, signInAnonymously as _signInAnonymously } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js";
import { getDatabase, ref, get, set } from "https://www.gstatic.com/firebasejs/10.7.0/firebase-database.js";

// ================================================================================
// CREDENCIALES DE FIREBASE
// Obtenidas de: Firebase Console → Configuración del proyecto → Tus aplicaciones → SDK
// ================================================================================

const firebaseConfig = {
  apiKey: "AIzaSyDVLLTC-kqLBJ0Me06rqsu5BRneQiFkoE4",
  authDomain: "mundial-2026-12e6c.firebaseapp.com",
  databaseURL: "https://mundial-2026-12e6c-default-rtdb.firebaseio.com",
  projectId: "mundial-2026-12e6c",
  storageBucket: "mundial-2026-12e6c.firebasestorage.app",
  messagingSenderId: "498565136746",
  appId: "1:498565136746:web:3a73c5e92a5bdfc5726513"
};

// ================================================================================
// INICIALIZAR FIREBASE
// ================================================================================

const app = initializeApp(firebaseConfig);

// ================================================================================
// OBTENER REFERENCIAS A AUTH Y DATABASE
// ================================================================================

export const auth = getAuth(app);
export const db = getDatabase(app);

// ================================================================================
// FUNCIÓN PARA INICIAR SESIÓN ANÓNIMA
// ================================================================================

export function signInAnonymously() {
  return _signInAnonymously(auth);
}

// ================================================================================
// FUNCIONES HELPER PARA FIREBASE
// ================================================================================

/**
 * Obtener datos de una referencia
 * @param {string} path - Ruta en la base de datos (ej: "paises/MX")
 * @returns {Promise} - Datos obtenidos
 */
export async function getData(path) {
  const reference = ref(db, path);
  const snapshot = await get(reference);
  return snapshot.val();
}

/**
 * Guardar datos en Firebase
 * @param {string} path - Ruta en la base de datos
 * @param {object} data - Datos a guardar
 * @returns {Promise}
 */
export async function saveData(path, data) {
  const reference = ref(db, path);
  return set(reference, data);
}

// ================================================================================
// VERIFICAR SI EL USUARIO ACTUAL ES PROFESOR
// ================================================================================

export async function esProfesor() {
  const user = auth.currentUser;
  if (!user) return false;
  const snapshot = await get(ref(db, `profesores/${user.uid}`));
  return snapshot.exists();
}

// ================================================================================
// REGISTRAR USUARIO CON ROL EN LA BASE DE DATOS
// ================================================================================

export async function crearUsuario(role) {
  const user = auth.currentUser;
  if (!user) return;
  const userRef = ref(db, `usuarios/${user.uid}`);
  const snapshot = await get(userRef);
  if (!snapshot.exists()) {
    await set(userRef, { role, createdAt: Date.now() });
  }
}

// ================================================================================
// EXPORTAR REFERENCIAS PARA USO EN OTROS ARCHIVOS
// ================================================================================

export { ref, get, set };