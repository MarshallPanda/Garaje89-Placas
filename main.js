import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, collection, addDoc, query, where, getDocs, updateDoc, doc, arrayUnion, arrayRemove, deleteDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

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

// --- DOM Elements ---
const loginScreen = document.getElementById('loginScreen');
const appContainer = document.getElementById('appContainer');
const inputLoginPass = document.getElementById('inputLoginPass');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const displayUser = document.getElementById('displayUser');
const adminBadge = document.getElementById('adminBadge'); // NUEVO
const logoutBtn = document.getElementById('logoutBtn');

const fileInput = document.getElementById('fileInput');
const cameraInput = document.getElementById('cameraInput');
const dropZone = document.getElementById('dropZone');
const cameraBtn = document.getElementById('cameraBtn');
const fileNameDisplay = document.getElementById('fileName');
const uploadBtn = document.getElementById('uploadBtn');
const messageDiv = document.getElementById('message');
const plateInput = document.getElementById('newPlate');
const searchPlateInput = document.getElementById('searchPlate');
const notesInput = document.getElementById('notes');
const searchBtn = document.getElementById('searchBtn');
const resultadosDiv = document.getElementById('resultados');
const loadingDiv = document.getElementById('loading');

let currentUser = null;
let currentUserIsAdmin = false; // NUEVO: Variable para permiso
let fileToUpload = null;

// --- FORMATO AUTOMÁTICO DE PLACA ---
function formatearPlaca(input) {
    input.addEventListener('input', function(e) {
        let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (value.length > 4) {
            value = value.slice(0, 4) + '-' + value.slice(4);
        }
        e.target.value = value;
    });
}
formatearPlaca(plateInput);
formatearPlaca(searchPlateInput);

// --- LOGIN CON PERMISOS ---
loginBtn.addEventListener('click', async () => {
    const pass = inputLoginPass.value.trim();
    if (!pass) return;
    loginError.innerText = "Verificando...";
    try {
        const q = query(collection(db, "usuarios"), where("clave", "==", pass));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            const userData = snapshot.docs[0].data();
            
            currentUser = userData.nombre || "Mecánico";
            
            // LÓGICA DE PERMISO:
            // Buscamos si el usuario tiene 'admin: true' en la base de datos
            if (userData.admin === true) {
                currentUserIsAdmin = true;
                adminBadge.style.display = 'inline-block'; // Mostramos etiqueta ADMIN
            } else {
                currentUserIsAdmin = false;
                adminBadge.style.display = 'none';
            }

            loginScreen.style.display = 'none';
            appContainer.style.display = 'block';
            displayUser.innerText = currentUser;
        } else {
            loginError.innerText = "Contraseña incorrecta";
        }
    } catch (e) { 
        console.error(e);
        loginError.innerText = "Error de conexión"; 
    }
});

logoutBtn.addEventListener('click', () => location.reload());

// --- ARCHIVOS ---
dropZone.addEventListener('click', () => fileInput.click());
cameraBtn.addEventListener('click', () => cameraInput.click());
fileInput.addEventListener('change', (e) => procesarArchivo(e.target.files[0]));
cameraInput.addEventListener('change', (e) => procesarArchivo(e.target.files[0]));

function procesarArchivo(file) {
    if(!file) return;
    if(!file.type.startsWith('image/')) { alert("Solo imágenes."); return; }
    fileToUpload = file;
    fileNameDisplay.innerHTML = `<i class="bi bi-check-circle-fill me-1"></i> ${file.name}`;
}

// --- SUBIR ---
uploadBtn.addEventListener('click', async () => {
    const plate = plateInput.value.toUpperCase();
    const notaInicial = notesInput.value.trim();
    messageDiv.innerHTML = '';

    if (plate.length < 5) { messageDiv.innerHTML = '<span class="text-danger">Placa incompleta.</span>'; return; }
    if (!fileToUpload) { messageDiv.innerHTML = '<span class="text-danger">Selecciona una foto.</span>'; return; }

    try {
        messageDiv.innerHTML = '<span class="text-lime"><i class="bi bi-hourglass-split fa-spin"></i> Subiendo...</span>';
        uploadBtn.disabled = true;

        const nombreArchivo = `${Date.now()}_${fileToUpload.name}`;
        const storageRef = ref(storage, `fotos_motos/${plate}/${nombreArchivo}`);
        await uploadBytes(storageRef, fileToUpload);
        const url = await getDownloadURL(storageRef);

        let comentarios = [];
        if(notaInicial) comentarios.push(`${notaInicial} (✍️ ${currentUser})`);

        await addDoc(collection(db, "documentacion"), {
            placa: plate, urlImagen: url, nombreArchivo: nombreArchivo,
            fechaSubida: new Date().toISOString(), subidoPor: currentUser, comentarios: comentarios
        });

        messageDiv.innerHTML = '<span class="text-success">¡Guardado!</span>';
        plateInput.value = ''; notesInput.value = ''; fileToUpload = null; fileNameDisplay.textContent = '';
        if(searchPlateInput.value.toUpperCase() === plate) { buscarPlaca(); }

    } catch (error) { messageDiv.innerHTML = `<span class="text-danger">Error: ${error.message}</span>`; }
    finally { uploadBtn.disabled = false; }
});

// --- BUSCAR Y RENDERIZAR CON LÓGICA DE BORRADO ---
searchBtn.addEventListener('click', buscarPlaca);
searchPlateInput.addEventListener('keyup', (e) => { if(e.key === 'Enter') buscarPlaca(); });

async function buscarPlaca() {
    const placa = searchPlateInput.value.toUpperCase();
    if(!placa) return;

    resultadosDiv.innerHTML = "";
    loadingDiv.style.display = 'block';

    try {
        const q = query(collection(db, "documentacion"), where("placa", "==", placa));
        const snapshot = await getDocs(q);
        loadingDiv.style.display = 'none';

        if (snapshot.empty) {
            resultadosDiv.innerHTML = `<div class="text-center text-muted py-5"><h4>No hay registros de la placa ${placa}</h4></div>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const data = docSnap.data();
            const id = docSnap.id;
            const fecha = data.fechaSubida ? new Date(data.fechaSubida).toLocaleDateString() : '--';
            
            // HTML CONDICIONAL: Botón de borrar imagen
            // Solo se agrega al string si currentUserIsAdmin es true
            let deleteButtonHTML = '';
            if (currentUserIsAdmin) {
                deleteButtonHTML = `
                    <button class="btn btn-danger btn-sm rounded-circle position-absolute top-0 end-0 m-2" onclick="window.borrarDoc('${id}', '${data.placa}', '${data.nombreArchivo}')">
                        <i class="bi bi-trash-fill"></i>
                    </button>
                `;
            }

            let htmlComentarios = "";
            if(data.comentarios) {
                data.comentarios.forEach(c => {
                    const cSafe = c.replace(/"/g, '&quot;');
                    
                    // HTML CONDICIONAL: Botón de borrar comentario
                    let deleteCommentBtn = '';
                    if (currentUserIsAdmin) {
                         deleteCommentBtn = `<button class="btn btn-sm text-danger" onclick="window.borrarComentario('${id}', '${cSafe}')"><i class="bi bi-trash"></i></button>`;
                    }

                    htmlComentarios += `
                        <div class="comment-item">
                            <span class="text-light">${c}</span>
                            ${deleteCommentBtn}
                        </div>`;
                });
            }

            resultadosDiv.innerHTML += `
                <div class="col-md-4 mb-4">
                    <div class="card custom-card h-100">
                        <div style="position:relative">
                            <a href="${data.urlImagen}" target="_blank">
                                <img src="${data.urlImagen}" class="img-result">
                            </a>
                            ${deleteButtonHTML} </div>
                        <div class="card-body">
                            <h4 class="text-white">${data.placa}</h4>
                            <p class="text-muted small">Subido por: <span class="text-lime">${data.subidoPor || '??'}</span> el ${fecha}</p>
                            
                            <div class="comment-box">
                                ${htmlComentarios}
                            </div>

                            <div class="input-group input-group-sm mt-3">
                                <input type="text" id="input-${id}" class="form-control" placeholder="Nueva nota...">
                                <button class="btn btn-outline-lime btn-racing" onclick="window.agregarComentario('${id}')"><i class="bi bi-send"></i></button>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        });

    } catch (e) {
        loadingDiv.style.display = 'none';
        console.error(e);
        alert("Error al buscar");
    }
}

// --- FUNCIONES GLOBALES (Window) ---
// Estas necesitan estar en window porque se llaman desde el HTML onclick=""

window.borrarDoc = async (id, placa, nombreArchivo) => {
    // Doble verificación de seguridad en cliente
    if (!currentUserIsAdmin) {
        alert("No tienes permiso para eliminar.");
        return;
    }

    if(!confirm(`⚠️ ¿ADMIN: ELIMINAR REGISTRO DEFINITIVAMENTE?`)) return;
    try {
        await deleteDoc(doc(db, "documentacion", id));
        if(nombreArchivo) {
            const refF = ref(storage, `fotos_motos/${placa}/${nombreArchivo}`);
            await deleteObject(refF).catch(()=>{});
        }
        buscarPlaca();
    } catch(e) { alert(e.message); }
};

window.agregarComentario = async (id) => {
    const input = document.getElementById(`input-${id}`);
    const txt = input.value.trim();
    if(!txt) return;
    try {
        await updateDoc(doc(db, "documentacion", id), {
            comentarios: arrayUnion(`${txt} (👤 ${currentUser})`)
        });
        buscarPlaca();
    } catch(e) { alert(e.message); }
};

window.borrarComentario = async (id, txt) => {
    if (!currentUserIsAdmin) {
        alert("No tienes permiso para eliminar notas.");
        return;
    }
    if(!confirm("¿Borrar nota?")) return;
    try {
        await updateDoc(doc(db, "documentacion", id), {
            comentarios: arrayRemove(txt)
        });
        buscarPlaca();
    } catch(e) { alert(e.message); }
};