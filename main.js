import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
    getFirestore, collection, addDoc, query, where, getDocs, updateDoc, doc,
    arrayUnion, arrayRemove, deleteDoc, getCountFromServer, getAggregateFromServer, sum
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import {
    getStorage, ref, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyDtX5JXgR8y0L0Uo5cn9Wrg_bbyqAHzIHc",
    authDomain: "motos-app-8a4bb.firebaseapp.com",
    projectId: "motos-app-8a4bb",
    storageBucket: "motos-app-8a4bb.firebasestorage.app",
    messagingSenderId: "343338706516",
    appId: "1:343338706516:web:b1b34b9fe4aa66ed486fc1"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// --- CONFIGURACIÓN ---
// Límites de referencia para las barras (nivel gratuito de Cloud Storage)
const LIMITE_ALMACENAMIENTO = 5 * 1024 ** 3;   // 5 GB
const LIMITE_SUBIDAS_MES = 5000;                // operaciones de subida gratis al mes
// Compresión de fotos
const MAX_LADO = 1920;     // px del lado más largo (las placas y papeles se siguen leyendo bien)
const CALIDAD_WEBP = 0.80;
const CALIDAD_JPEG = 0.82;
const PESO_PROMEDIO_ESTIMADO = 300 * 1024; // para fotos antiguas aún no medidas
const SESION_KEY = 'g89_sesion';

// --- DOM ---
const $ = (id) => document.getElementById(id);
const loginScreen = $('loginScreen');
const appContainer = $('appContainer');
const inputLoginPass = $('inputLoginPass');
const loginBtn = $('loginBtn');
const loginError = $('loginError');
const displayUser = $('displayUser');
const adminBadge = $('adminBadge');
const logoutBtn = $('logoutBtn');

const fileInput = $('fileInput');
const cameraInput = $('cameraInput');
const dropZone = $('dropZone');
const cameraBtn = $('cameraBtn');
const fileNameDisplay = $('fileName');
const previewImg = $('previewImg');
const uploadBtn = $('uploadBtn');
const messageDiv = $('message');
const plateInput = $('newPlate');
const searchPlateInput = $('searchPlate');
const notesInput = $('notes');
const searchBtn = $('searchBtn');
const resultadosDiv = $('resultados');
const loadingDiv = $('loading');

const usoAlmBarra = $('usoAlmBarra');
const usoAlmTexto = $('usoAlmTexto');
const usoMesBarra = $('usoMesBarra');
const usoMesTexto = $('usoMesTexto');
const usoNota = $('usoNota');
const usoRefresh = $('usoRefresh');
const adminTools = $('adminTools');
const optimizarBtn = $('optimizarBtn');
const optimizarEstado = $('optimizarEstado');

let currentUser = null;
let currentUserIsAdmin = false;
let fotoPreparada = null;      // { blob, ext, tipo, pesoOriginal }
let previewUrl = null;
const docsMostrados = new Map(); // id -> data (de la última búsqueda)

// --- UTILIDADES ---
const escapar = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

function formatoPeso(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function guardarSesion() {
    try { localStorage.setItem(SESION_KEY, JSON.stringify({ nombre: currentUser, admin: currentUserIsAdmin })); } catch { }
}
function leerSesion() {
    try { return JSON.parse(localStorage.getItem(SESION_KEY)); } catch { return null; }
}
function borrarSesion() {
    try { localStorage.removeItem(SESION_KEY); } catch { }
}

// --- FORMATO AUTOMÁTICO DE PLACA ---
function formatearPlaca(input) {
    input.addEventListener('input', (e) => {
        let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (value.length > 4) value = value.slice(0, 4) + '-' + value.slice(4);
        e.target.value = value;
    });
}
formatearPlaca(plateInput);
formatearPlaca(searchPlateInput);

// --- LOGIN ---
function entrar(nombre, esAdmin) {
    currentUser = nombre || 'Mecánico';
    currentUserIsAdmin = esAdmin === true;
    adminBadge.style.display = currentUserIsAdmin ? 'inline-block' : 'none';
    adminTools.style.display = currentUserIsAdmin ? 'block' : 'none';
    loginScreen.style.display = 'none';
    appContainer.style.display = 'block';
    displayUser.innerText = currentUser;
    cargarUso();
}

async function login() {
    const pass = inputLoginPass.value.trim();
    if (!pass) return;
    loginError.innerText = 'Verificando...';
    try {
        const q = query(collection(db, 'usuarios'), where('clave', '==', pass));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const userData = snapshot.docs[0].data();
            entrar(userData.nombre, userData.admin === true);
            guardarSesion();
            loginError.innerText = '';
        } else {
            loginError.innerText = 'Contraseña incorrecta';
        }
    } catch (e) {
        console.error(e);
        loginError.innerText = 'Error de conexión';
    }
}
loginBtn.addEventListener('click', login);
inputLoginPass.addEventListener('keyup', (e) => { if (e.key === 'Enter') login(); });

logoutBtn.addEventListener('click', () => { borrarSesion(); location.reload(); });

// Mantener la sesión abierta (evita que se cierre al usar la cámara en celulares)
const sesionGuardada = leerSesion();
if (sesionGuardada && sesionGuardada.nombre) entrar(sesionGuardada.nombre, sesionGuardada.admin);

// --- COMPRESIÓN DE IMÁGENES ---
async function decodificar(blob) {
    if ('createImageBitmap' in window) {
        try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }); } catch { }
    }
    return await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
        img.src = url;
    });
}

const aBlob = (canvas, tipo, calidad) => new Promise((r) => canvas.toBlob(r, tipo, calidad));

/** Devuelve { blob, ext, tipo } listo para subir. Si no se puede comprimir, devuelve el original. */
async function comprimirImagen(original) {
    const extOriginal = (original.name?.split('.').pop() || 'jpg').toLowerCase();
    const sinCambios = { blob: original, ext: extOriginal, tipo: original.type || 'image/jpeg' };
    try {
        const img = await decodificar(original);
        const w = img.width, h = img.height;
        const escala = Math.min(1, MAX_LADO / Math.max(w, h));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(w * escala);
        canvas.height = Math.round(h * escala);
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (img.close) img.close();

        let blob = await aBlob(canvas, 'image/webp', CALIDAD_WEBP);
        let ext = 'webp', tipo = 'image/webp';
        if (!blob || blob.type !== 'image/webp') { // Safari antiguo no genera WebP
            blob = await aBlob(canvas, 'image/jpeg', CALIDAD_JPEG);
            ext = 'jpg'; tipo = 'image/jpeg';
        }
        if (!blob || blob.size >= original.size) return sinCambios;
        return { blob, ext, tipo };
    } catch (e) {
        console.warn('Compresión omitida:', e);
        return sinCambios;
    }
}

// --- SELECCIÓN DE ARCHIVOS ---
dropZone.addEventListener('click', () => fileInput.click());
cameraBtn.addEventListener('click', () => cameraInput.click());
fileInput.addEventListener('change', (e) => procesarArchivo(e.target.files[0]));
cameraInput.addEventListener('change', (e) => procesarArchivo(e.target.files[0]));

['dragenter', 'dragover'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
    e.preventDefault(); dropZone.classList.add('drag-over');
}));
['dragleave', 'drop'].forEach((ev) => dropZone.addEventListener(ev, (e) => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
}));
dropZone.addEventListener('drop', (e) => procesarArchivo(e.dataTransfer.files[0]));

function limpiarFoto() {
    fotoPreparada = null;
    fileNameDisplay.textContent = '';
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = null;
    previewImg.style.display = 'none';
    previewImg.removeAttribute('src');
    fileInput.value = ''; cameraInput.value = '';
}

async function procesarArchivo(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) { alert('Solo imágenes.'); return; }
    uploadBtn.disabled = true;
    fileNameDisplay.innerHTML = '<span class="text-muted"><span class="spinner-border spinner-border-sm me-1"></span> Optimizando foto...</span>';

    const resultado = await comprimirImagen(file);
    fotoPreparada = { ...resultado, pesoOriginal: file.size };

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(resultado.blob);
    previewImg.src = previewUrl;
    previewImg.style.display = 'block';

    const ahorro = file.size > 0 ? Math.round((1 - resultado.blob.size / file.size) * 100) : 0;
    fileNameDisplay.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i> ${escapar(file.name)}<br>
        <span class="text-muted fw-normal">${formatoPeso(file.size)} → ${formatoPeso(resultado.blob.size)}${ahorro > 0 ? ` (−${ahorro}%)` : ''}</span>`;
    uploadBtn.disabled = false;
}

// --- SUBIR ---
uploadBtn.addEventListener('click', async () => {
    const plate = plateInput.value.toUpperCase();
    const notaInicial = notesInput.value.trim();
    messageDiv.innerHTML = '';

    if (plate.length < 5) { messageDiv.innerHTML = '<span class="text-danger">Placa incompleta.</span>'; return; }
    if (!fotoPreparada) { messageDiv.innerHTML = '<span class="text-danger">Selecciona una foto.</span>'; return; }

    try {
        messageDiv.innerHTML = '<span class="text-lime"><span class="spinner-border spinner-border-sm me-1"></span> Subiendo...</span>';
        uploadBtn.disabled = true;

        const { blob, ext, tipo, pesoOriginal } = fotoPreparada;
        const nombreArchivo = `${Date.now()}.${ext}`;
        const storageRef = ref(storage, `fotos_motos/${plate}/${nombreArchivo}`);
        await uploadBytes(storageRef, blob, { contentType: tipo, cacheControl: 'public, max-age=31536000' });
        const url = await getDownloadURL(storageRef);

        const comentarios = [];
        if (notaInicial) comentarios.push(`${notaInicial} (✍️ ${currentUser})`);

        await addDoc(collection(db, 'documentacion'), {
            placa: plate, urlImagen: url, nombreArchivo,
            fechaSubida: new Date().toISOString(), subidoPor: currentUser, comentarios,
            tamanoBytes: blob.size, tamanoOriginal: pesoOriginal, optimizada: true
        });

        messageDiv.innerHTML = '<span class="text-success">¡Guardado!</span>';
        plateInput.value = ''; notesInput.value = '';
        limpiarFoto();
        cargarUso();
        if (searchPlateInput.value.toUpperCase() === plate) buscarPlaca();
    } catch (error) {
        console.error(error);
        messageDiv.innerHTML = `<span class="text-danger">Error: ${escapar(error.message)}</span>`;
    } finally {
        uploadBtn.disabled = false;
    }
});

// --- BUSCAR ---
searchBtn.addEventListener('click', buscarPlaca);
searchPlateInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') buscarPlaca(); });

function tarjetaHTML(id, data) {
    const fecha = data.fechaSubida ? new Date(data.fechaSubida).toLocaleDateString() : '--';
    const url = escapar(data.urlImagen);

    const botonBorrar = currentUserIsAdmin ? `
        <button class="btn btn-danger btn-sm rounded-circle position-absolute top-0 end-0 m-2"
                data-accion="borrar-doc" data-id="${id}" title="Eliminar">
            <i class="bi bi-trash-fill"></i>
        </button>` : '';

    const comentarios = (data.comentarios || []).map((c, i) => `
        <div class="comment-item">
            <span class="text-light">${escapar(c)}</span>
            ${currentUserIsAdmin ? `<button class="btn btn-sm text-danger" data-accion="borrar-nota" data-id="${id}" data-idx="${i}"><i class="bi bi-trash"></i></button>` : ''}
        </div>`).join('');

    return `
        <div class="col-md-4 mb-4">
            <div class="card custom-card h-100">
                <div style="position:relative">
                    <a href="${url}" target="_blank" rel="noopener">
                        <img src="${url}" class="img-result" loading="lazy" alt="Foto ${escapar(data.placa)}">
                    </a>
                    ${botonBorrar}
                </div>
                <div class="card-body">
                    <h4 class="text-white">${escapar(data.placa)}</h4>
                    <p class="text-muted small">Subido por: <span class="text-lime">${escapar(data.subidoPor || '??')}</span> el ${fecha}</p>
                    <div class="comment-box">${comentarios || '<span class="text-muted small">Sin notas</span>'}</div>
                    <div class="input-group input-group-sm mt-3">
                        <input type="text" id="input-${id}" class="form-control" placeholder="Nueva nota..." data-enter-id="${id}">
                        <button class="btn btn-outline-lime" data-accion="agregar-nota" data-id="${id}"><i class="bi bi-send"></i></button>
                    </div>
                </div>
            </div>
        </div>`;
}

async function buscarPlaca() {
    const placa = searchPlateInput.value.toUpperCase();
    if (!placa) return;

    resultadosDiv.innerHTML = '';
    loadingDiv.style.display = 'block';

    try {
        const q = query(collection(db, 'documentacion'), where('placa', '==', placa));
        const snapshot = await getDocs(q);
        loadingDiv.style.display = 'none';
        docsMostrados.clear();

        if (snapshot.empty) {
            resultadosDiv.innerHTML = `<div class="text-center text-muted py-5"><h4>No hay registros de la placa ${escapar(placa)}</h4></div>`;
            return;
        }

        // Más recientes primero
        const docs = snapshot.docs
            .map((d) => ({ id: d.id, data: d.data() }))
            .sort((a, b) => (b.data.fechaSubida || '').localeCompare(a.data.fechaSubida || ''));

        docs.forEach(({ id, data }) => docsMostrados.set(id, data));
        resultadosDiv.innerHTML = docs.map(({ id, data }) => tarjetaHTML(id, data)).join('');
    } catch (e) {
        loadingDiv.style.display = 'none';
        console.error(e);
        alert('Error al buscar');
    }
}

// --- ACCIONES EN TARJETAS (delegación de eventos) ---
resultadosDiv.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-accion]');
    if (!btn) return;
    const { accion, id, idx } = btn.dataset;
    if (accion === 'borrar-doc') borrarDoc(id);
    if (accion === 'agregar-nota') agregarComentario(id);
    if (accion === 'borrar-nota') borrarComentario(id, Number(idx));
});
resultadosDiv.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' && e.target.dataset.enterId) agregarComentario(e.target.dataset.enterId);
});

async function borrarDoc(id) {
    if (!currentUserIsAdmin) { alert('No tienes permiso para eliminar.'); return; }
    const data = docsMostrados.get(id);
    if (!data) return;
    if (!confirm('⚠️ ¿ADMIN: ELIMINAR REGISTRO DEFINITIVAMENTE?')) return;
    try {
        await deleteDoc(doc(db, 'documentacion', id));
        await borrarArchivo(data);
        buscarPlaca();
        cargarUso();
    } catch (e) { alert(e.message); }
}

async function borrarArchivo(data) {
    try {
        const r = data.urlImagen ? ref(storage, data.urlImagen)
            : ref(storage, `fotos_motos/${data.placa}/${data.nombreArchivo}`);
        await deleteObject(r);
    } catch (e) { console.warn('No se pudo borrar el archivo:', e); }
}

async function agregarComentario(id) {
    const input = document.getElementById(`input-${id}`);
    const txt = input.value.trim();
    if (!txt) return;
    try {
        await updateDoc(doc(db, 'documentacion', id), {
            comentarios: arrayUnion(`${txt} (👤 ${currentUser})`)
        });
        buscarPlaca();
    } catch (e) { alert(e.message); }
}

async function borrarComentario(id, idx) {
    if (!currentUserIsAdmin) { alert('No tienes permiso para eliminar notas.'); return; }
    const texto = docsMostrados.get(id)?.comentarios?.[idx];
    if (texto === undefined) return;
    if (!confirm('¿Borrar nota?')) return;
    try {
        await updateDoc(doc(db, 'documentacion', id), { comentarios: arrayRemove(texto) });
        buscarPlaca();
    } catch (e) { alert(e.message); }
}

// --- BARRAS DE USO ---
function pintarBarra(barra, texto, fraccion) {
    const pct = Math.max(0, fraccion * 100);
    barra.style.width = `${Math.min(100, Math.max(pct, 1.5))}%`;
    barra.classList.remove('nivel-medio', 'nivel-alto');
    if (pct >= 90) barra.classList.add('nivel-alto');
    else if (pct >= 70) barra.classList.add('nivel-medio');
    texto.textContent = pct === 0 ? '0%' : pct < 0.1 ? '<0.1%' : pct < 10 ? `${pct.toFixed(1)}%` : `${Math.round(pct)}%`;
}

async function cargarUso() {
    usoRefresh.disabled = true;
    try {
        const col = collection(db, 'documentacion');
        const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

        const [agg, total, medidas, delMes] = await Promise.all([
            getAggregateFromServer(col, { bytes: sum('tamanoBytes') }),
            getCountFromServer(col),
            getCountFromServer(query(col, where('tamanoBytes', '>', 0))),
            getCountFromServer(query(col, where('fechaSubida', '>=', inicioMes)))
        ]);

        const bytesMedidos = agg.data().bytes || 0;
        const nTotal = total.data().count;
        const nMedidas = medidas.data().count;
        const pendientes = Math.max(0, nTotal - nMedidas);
        const promedio = nMedidas > 0 ? bytesMedidos / nMedidas : PESO_PROMEDIO_ESTIMADO;
        const bytesEstimados = bytesMedidos + pendientes * promedio;

        pintarBarra(usoAlmBarra, usoAlmTexto, bytesEstimados / LIMITE_ALMACENAMIENTO);
        pintarBarra(usoMesBarra, usoMesTexto, delMes.data().count / LIMITE_SUBIDAS_MES);

        usoNota.textContent = pendientes > 0
            ? `${nTotal} fotos registradas · ${pendientes} antiguas aún sin optimizar (uso aproximado)`
            : `${nTotal} fotos registradas · todas optimizadas`;
        optimizarBtn.disabled = pendientes === 0;
    } catch (e) {
        console.error(e);
        usoNota.textContent = 'No se pudo calcular el uso.';
    } finally {
        usoRefresh.disabled = false;
    }
}
usoRefresh.addEventListener('click', cargarUso);

// --- OPTIMIZAR FOTOS EXISTENTES (solo admin) ---
optimizarBtn.addEventListener('click', async () => {
    if (!currentUserIsAdmin) return;
    if (!confirm('Se van a comprimir todas las fotos antiguas. Puede tardar unos minutos y no debes cerrar la página. ¿Continuar?')) return;

    optimizarBtn.disabled = true;
    const estado = (html) => { optimizarEstado.innerHTML = html; };
    estado('<span class="text-muted">Buscando fotos...</span>');

    let hechas = 0, errores = 0, ahorro = 0;
    try {
        const snapshot = await getDocs(collection(db, 'documentacion'));
        const pendientes = snapshot.docs.filter((d) => d.data().optimizada !== true);
        if (pendientes.length === 0) { estado('<span class="text-success">Todas las fotos ya están optimizadas.</span>'); return; }

        for (let i = 0; i < pendientes.length; i++) {
            const d = pendientes[i];
            const data = d.data();
            estado(`<span class="text-lime"><span class="spinner-border spinner-border-sm me-1"></span>
                Optimizando ${i + 1} de ${pendientes.length}...</span>`);
            try {
                const refViejo = data.urlImagen ? ref(storage, data.urlImagen)
                    : ref(storage, `fotos_motos/${data.placa}/${data.nombreArchivo}`);

                let respuesta;
                try {
                    respuesta = await fetch(data.urlImagen, { cache: 'no-store' });
                } catch {
                    // fetch solo falla así por CORS o sin internet: no tiene sentido seguir
                    throw Object.assign(new Error('CORS'), { esCors: true });
                }
                if (respuesta.status === 404) {
                    await updateDoc(doc(db, 'documentacion', d.id), { optimizada: true, tamanoBytes: 0 });
                    hechas++;
                    continue;
                }
                if (!respuesta.ok) throw new Error(`HTTP ${respuesta.status}`);
                const original = await respuesta.blob();

                const resultado = await comprimirImagen(original);
                const ganancia = original.size - resultado.blob.size;

                if (resultado.blob !== original && ganancia > original.size * 0.1) {
                    const nuevoNombre = `${Date.now()}.${resultado.ext}`;
                    const refNuevo = ref(storage, `fotos_motos/${data.placa}/${nuevoNombre}`);
                    await uploadBytes(refNuevo, resultado.blob, { contentType: resultado.tipo, cacheControl: 'public, max-age=31536000' });
                    const nuevaUrl = await getDownloadURL(refNuevo);
                    await updateDoc(doc(db, 'documentacion', d.id), {
                        urlImagen: nuevaUrl, nombreArchivo: nuevoNombre,
                        tamanoBytes: resultado.blob.size, tamanoOriginal: original.size, optimizada: true
                    });
                    await deleteObject(refViejo).catch(() => { });
                    ahorro += ganancia;
                } else {
                    // Ya era liviana: solo registramos su peso
                    await updateDoc(doc(db, 'documentacion', d.id), {
                        tamanoBytes: original.size, tamanoOriginal: original.size, optimizada: true
                    });
                }
                hechas++;
            } catch (err) {
                if (err.esCors) throw err;
                console.error('Error optimizando', d.id, err);
                errores++;
            }
        }
        estado(`<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>
            Listo: ${hechas} fotos procesadas, ${formatoPeso(ahorro)} ahorrados${errores ? ` · ${errores} con error (vuelve a intentarlo)` : ''}.</span>`);
    } catch (e) {
        console.error(e);
        if (e.esCors) {
            estado(`<span class="text-warning"><i class="bi bi-exclamation-triangle-fill me-1"></i>
                El navegador no pudo descargar las fotos antiguas error en CORS en el bucket (reporte).
                ${hechas ? `Se alcanzaron a optimizar ${hechas}.` : ''}</span>`);
        } else {
            estado(`<span class="text-danger">Error: ${escapar(e.message)}</span>`);
        }
    } finally {
        cargarUso();
    }
});
