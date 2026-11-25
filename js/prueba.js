import { configuracion as cfg, configurado, establecerToken, llamar, ErrorServicio, ocultarCorreo } from './servicio.js';
import { SubidaReanudable } from './subida.js';

const $ = (id) => document.getElementById(id);
const resultados = [];
const ENTORNO = cfg.modoSimulador ? 'SIMULADO' : 'REAL';
let usuario = null;

function anotar(prueba, estado, detalle) {
  resultados.push({ entorno: ENTORNO, prueba, estado, detalle });
  const tr = document.createElement('tr');
  tr.innerHTML = `<td><span class="entorno ${ENTORNO.toLowerCase()}">${ENTORNO}</span></td><td></td><td></td><td></td>`;
  tr.children[0].title = ENTORNO === 'SIMULADO' ? 'Simulador local: no es Google ni Drive' : 'Prueba real contra Google Drive';
  tr.children[1].textContent = prueba;
  tr.children[2].textContent = { ok: 'Correcto', error: 'Fallo', aviso: 'Aviso' }[estado];
  tr.children[2].className = `res-${estado}`;
  tr.children[3].textContent = detalle;
  $('resultados').append(tr);
  $('copiar').hidden = false;
}

function generarArchivo(mb, nombre) {
  const base = new Uint8Array(1024 * 1024);
  for (let i = 0; i < base.length; i += 65536) crypto.getRandomValues(base.subarray(i, i + 65536));
  const partes = [];
  for (let i = 0; i < mb; i++) {
    const cab = new Uint8Array(16);
    crypto.getRandomValues(cab);
    partes.push(cab, base.subarray(16));
  }
  return new File(partes, nombre, { type: 'application/octet-stream', lastModified: Date.now() });
}

async function subirArchivo(archivo, { abortarEn = null } = {}) {
  const equipoId = $('equipo').value;
  const t0 = Date.now();
  const s = await llamar('iniciarSubida', { equipoId, categoria: 'prueba_tecnica', nombre: archivo.name, tamano: archivo.size, tipo: archivo.type || 'application/octet-stream' });
  const msSesion = Date.now() - t0;
  let control = new AbortController();
  let estado = null;
  let sub = new SubidaReanudable({
    archivo, urlSubida: s.urlSubida, tamanoTrozo: s.tamanoTrozo, senal: control.signal,
    consultarRecibidos: () => llamar('estadoSubida', { idSubida: s.idSubida }),
    alGuardarEstado: (e) => { estado = e; },
    alProgreso: (hecho, total) => { if (abortarEn && hecho / total >= abortarEn && !control.signal.aborted) control.abort(); }
  });
  let interrumpida = false;
  let r;
  try {
    r = await sub.ejecutar();
  } catch (err) {
    if (err.codigo !== 'cancelada') throw err;
    interrumpida = true;
    control = new AbortController();
    sub = new SubidaReanudable({ archivo, urlSubida: s.urlSubida, tamanoTrozo: s.tamanoTrozo, senal: control.signal, estado, consultarRecibidos: () => llamar('estadoSubida', { idSubida: s.idSubida }) });
    r = await sub.ejecutar({ reanudar: true });
  }
  let cerrada = null;
  try { cerrada = (await llamar('subidaTerminada', { idSubida: s.idSubida })).cerrada; } catch { /* se informa abajo */ }
  return { ...r, ms: Date.now() - t0, msSesion, interrumpida, cerrada, diag: sub.diagnostico, url: s.urlSubida };
}

const mbps = (bytes, ms) => `${((bytes / 1024 / 1024) / (ms / 1000)).toFixed(1)} MB/s`;

async function ejecutar() {
  $('ejecutar').disabled = true;
  $('resultados').replaceChildren();
  resultados.length = 0;
  const marca = Date.now().toString(36);

  // 1. Identidad y equipos
  anotar('Identidad de Google verificada por el servicio', 'ok', `${ocultarCorreo(usuario.correo)} · ${usuario.equipos.length} equipo(s) visibles`);

  // 2. Token manipulado
  try {
    await llamar('yo', {}, { tokenForzado: 'eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImZhbHNvQGdtYWlsLmNvbSJ9.firma' });
    anotar('Rechazo de identidad falsificada', 'error', 'El servicio aceptó un token falso');
  } catch (err) {
    anotar('Rechazo de identidad falsificada', err.codigo === 'identidad_no_valida' ? 'ok' : 'error', err.codigo);
  }

  // 3. Equipo no asignado
  try {
    await llamar('iniciarSubida', { equipoId: '__no_asignado__', categoria: 'prueba_tecnica', nombre: 'x.bin', tamano: 10, tipo: 'application/octet-stream' });
    anotar('Bloqueo de equipo no asignado', 'error', 'Se permitió subir a un equipo no asignado');
  } catch (err) {
    anotar('Bloqueo de equipo no asignado', err.codigo === 'sin_permiso' ? 'ok' : 'error', err.codigo);
  }

  // 4. Tipo no permitido en categoría
  try {
    await llamar('iniciarSubida', { equipoId: $('equipo').value, categoria: 'fotos_individuales', nombre: 'x.exe', tamano: 10, tipo: 'application/x-msdownload' });
    anotar('Bloqueo de tipo de archivo no válido', 'error', 'Se aceptó un ejecutable');
  } catch (err) {
    anotar('Bloqueo de tipo de archivo no válido', ['tipo_no_valido', 'categoria_no_valida'].includes(err.codigo) ? 'ok' : 'error', err.codigo);
  }

  const paso = async (nombre, fn) => {
    try { await fn(); } catch (err) { anotar(nombre, 'error', `${err.codigo || ''} ${err.message}`); }
  };

  // 5. Subida pequeña con verificación
  let urlCompletada = null;
  await paso('Subida pequeña verificada (2 MB)', async () => {
    const r = await subirArchivo(generarArchivo(2, `prueba_${marca}_pequena.bin`));
    urlCompletada = r.url;
    anotar('Subida pequeña verificada (2 MB)', r.verificado ? 'ok' : 'error', `MD5 ${r.verificado ? 'coincide' : 'NO coincide'} · registro de sesión cerrado: ${r.cerrada} · sesión ${r.msSesion} ms · total ${r.ms} ms`);
  });

  // 6. Seguridad de la sesión: no admite un tamaño distinto del declarado
  await paso('Sesión de subida no admite otro tamaño', async () => {
    const s = await llamar('iniciarSubida', { equipoId: $('equipo').value, categoria: 'prueba_tecnica', nombre: `prueba_${marca}_manipulada.bin`, tamano: 1024, tipo: 'application/octet-stream' });
    const datos = new Uint8Array(2048);
    let codigo = null;
    try { codigo = (await fetch(s.urlSubida, { method: 'PUT', headers: { 'Content-Range': 'bytes 0-2047/2048' }, body: datos })).status; } catch { /* Drive responde 4xx sin cabeceras CORS: el navegador solo ve «error de red» */ }
    // Comprobación independiente desde Apps Script: ¿Drive guardó algo de esa sesión?
    let estado = null;
    try { estado = await llamar('estadoSubida', { idSubida: s.idSubida }); } catch (err) { estado = { error: err.codigo || 'sesion_caducada' }; }
    const aceptada = codigo === 200 || codigo === 201 || estado?.terminado === true || estado?.recibidos > 0;
    const vista = codigo === null ? 'bloqueada (sin cabeceras CORS)' : `HTTP ${codigo}`;
    const servidor = estado?.error ? `sesión anulada por Drive (${estado.error})` : `terminada: ${estado?.terminado} · bytes guardados: ${estado?.recibidos}`;
    anotar('Sesión de subida no admite otro tamaño', aceptada ? 'error' : estado ? 'ok' : 'aviso', `Navegador: ${vista} · Apps Script: ${servidor}`);
  });

  // 7. Sesión terminada no reutilizable
  if (urlCompletada) await paso('Sesión completada no se puede reutilizar', async () => {
    let codigo = 'error de red';
    try { codigo = (await fetch(urlCompletada, { method: 'PUT', headers: { 'Content-Range': 'bytes 0-9/10' }, body: new Uint8Array(10) })).status; } catch { /* rechazo */ }
    anotar('Sesión completada no se puede reutilizar', codigo === 200 || codigo === 201 || codigo === 308 ? 'aviso' : 'ok', `Respuesta de Drive: ${codigo} (200 = Drive devuelve el mismo archivo ya terminado, sin cambiarlo)`);
  });

  // 8. Subida grande
  await paso('Subida grande', async () => {
    const real = $('archivo-real').files[0];
    const archivo = real ? new File([real], `prueba_${marca}_real_${real.name}`, { type: real.type || 'video/mp4' }) : generarArchivo(Number($('tamano-grande').value) || 200, `prueba_${marca}_grande.bin`);
    const r = await subirArchivo(archivo);
    anotar(`Subida grande (${(archivo.size / 1024 / 1024).toFixed(0)} MB)`, r.verificado ? 'ok' : 'error', `MD5 ${r.verificado ? 'coincide' : 'NO coincide'} · ${mbps(archivo.size, r.ms)} · reintentos ${r.diag.reintentos}`);
  });

  // 9. Interrupción y reanudación
  await paso('Interrupción y reanudación', async () => {
    const archivo = generarArchivo(40, `prueba_${marca}_reanudada.bin`);
    const r = await subirArchivo(archivo, { abortarEn: 0.4 });
    anotar('Interrupción al 40 % y reanudación', r.interrumpida && r.verificado ? 'ok' : 'error', `Interrumpida: ${r.interrumpida} · MD5 ${r.verificado ? 'coincide' : 'NO coincide'} · consultas de estado ${r.diag.consultasEstado} · bytes reenviados tras reanudar ${(r.diag.bytesEnviados / 1024 / 1024).toFixed(1)} MB de 40 MB · cabecera Range ${r.diag.rangeVisible === null ? 'no consultada' : r.diag.rangeVisible ? 'visible' : 'oculta por CORS'} · posición pedida a Apps Script: ${r.diag.recibidosServicio || 0} vez/veces`);
  });

  // 10. Simultáneas
  await paso('Subidas simultáneas', async () => {
    const n = Math.min(8, Math.max(2, Number($('simultaneas').value) || 4));
    const t0 = Date.now();
    const rs = await Promise.allSettled(Array.from({ length: n }, (_, i) => subirArchivo(generarArchivo(20, `prueba_${marca}_simultanea_${i + 1}.bin`))));
    const ok = rs.filter((x) => x.status === 'fulfilled' && x.value.verificado).length;
    anotar(`${n} subidas simultáneas de 20 MB`, ok === n ? 'ok' : 'error', `${ok}/${n} verificadas · ${mbps(20 * 1024 * 1024 * n, Date.now() - t0)} en conjunto`);
  });

  $('ejecutar').disabled = false;
}

$('copiar').addEventListener('click', async () => {
  const informe = { entorno: ENTORNO, aviso: ENTORNO === 'SIMULADO' ? 'Resultados del simulador local: NO son pruebas reales con Google' : 'Resultados reales contra Google Drive', fecha: new Date().toISOString(), navegador: navigator.userAgent, resultados };
  await navigator.clipboard.writeText(JSON.stringify(informe, null, 2));
  $('copiar').textContent = 'Informe copiado';
});

async function alIdentificarse(r) {
  establecerToken(r.credential);
  try {
    usuario = await llamar('yo');
  } catch (err) {
    anotar('Identidad y autorización', 'error', `${err.codigo}: ${err.message}`);
    return;
  }
  const sel = $('equipo');
  sel.replaceChildren();
  for (const eq of usuario.equipos.filter((e) => e.puedeSubir && e.categorias.includes('prueba_tecnica'))) {
    const o = document.createElement('option');
    o.value = eq.id;
    o.textContent = eq.nombre;
    sel.append(o);
  }
  $('identidad').textContent = `Sesión: ${ocultarCorreo(usuario.correo)}. Equipos con carpeta de prueba: ${sel.options.length}`;
  $('controles').hidden = false;
  $('ejecutar').disabled = sel.options.length === 0;
}

$('ejecutar').addEventListener('click', ejecutar);

$('etiqueta-entorno').textContent = ENTORNO === 'SIMULADO' ? 'SIMULADO · no es Google' : 'REAL · Google Drive';
$('etiqueta-entorno').className = `entorno ${ENTORNO.toLowerCase()}`;

if (!configurado) {
  anotar('Configuración', 'error', 'Falta js/config.js');
} else if (cfg.modoSimulador) {
  $('aviso-simulador').hidden = false;
  $('acceso-simulado').hidden = false;
  $('acceso-simulado').addEventListener('submit', (ev) => {
    ev.preventDefault();
    const carga = btoa(JSON.stringify({ email: $('correo-simulado').value.trim(), exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '');
    alIdentificarse({ credential: `SIMULADO.${carga}.x` });
  });
} else {
  const esperar = () => {
    if (!window.google?.accounts?.id) return setTimeout(esperar, 100);
    google.accounts.id.initialize({ client_id: cfg.clientId, callback: alIdentificarse, ux_mode: 'popup', use_fedcm_for_prompt: true });
    google.accounts.id.renderButton($('boton-google'), { theme: 'filled_blue', size: 'large', locale: 'es' });
  };
  esperar();
}
