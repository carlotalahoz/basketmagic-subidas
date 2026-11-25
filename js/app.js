import { configuracion as cfg, configurado, establecerToken, cerrarSesion, sesionActiva, llamar, tipoDe } from './servicio.js';
import { SubidaReanudable, ErrorSubida } from './subida.js';

const $ = (id) => document.getElementById(id);
const CLAVE_PENDIENTES = 'bm_subidas_pendientes';
const DIAS_VALIDEZ_SESION = 6;
const SIMULTANEAS = 2;

const CATEGORIAS = {
  foto_dni: { nombre: 'Fotos tipo DNI', acepta: 'image/*', icono: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17c.5-2 2-3 3.5-3s3 1 3.5 3M15 9h3M15 13h3"/>' },
  foto_cuerpo: { nombre: 'Fotos cuerpo entero', acepta: 'image/*', icono: '<circle cx="12" cy="4" r="2"/><path d="M12 6v8M8 9h8M12 14l-3 7M12 14l3 7"/>' },
  foto_grupal_equipo: { nombre: 'Foto grupal del equipo', acepta: 'image/*', icono: '<circle cx="7" cy="9" r="3"/><circle cx="17" cy="9" r="3"/><circle cx="12" cy="7" r="3"/><path d="M2 20c0-3 2-5 5-5M22 20c0-3-2-5-5-5M7 21c0-4 2-6 5-6s5 2 5 6"/>' },
  foto_grupal_generacion: { nombre: 'Foto grupal de la generación', acepta: 'image/*', icono: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 15l5-5 4 4 3-3 6 6"/>' },
  felicitacion: { nombre: 'Felicitación', acepta: 'image/*,video/*', icono: '<path d="M12 2l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 9l6-1z"/>' },
  video_entrenando: { nombre: 'Vídeos entrenando', acepta: 'video/*', icono: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>' },
  cancion: { nombre: 'Canción', acepta: 'audio/*,video/*', icono: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>' },
  prueba_tecnica: { nombre: 'Prueba técnica', acepta: '', icono: '<path d="M9 2h6M10 2v6l-6 11a2 2 0 002 3h12a2 2 0 002-3L14 8V2"/>' }
};

const estado = { usuario: null, equipo: null, categoria: null, cola: [], activas: 0, bloqueoPantalla: null };

function mostrar(id) {
  for (const p of ['pantalla-error-config', 'pantalla-acceso', 'pantalla-equipos', 'pantalla-subir']) $(p).hidden = p !== id;
}

function avisar(texto) {
  const m = $('mensaje');
  m.textContent = texto;
  m.hidden = false;
  clearTimeout(avisar.t);
  avisar.t = setTimeout(() => { m.hidden = true; }, 5000);
}

const formatoBytes = (n) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(2)} GB` : n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

// ---------- Inicio de sesión ----------
function iniciar() {
  if (!configurado) return mostrar('pantalla-error-config');
  mostrar('pantalla-acceso');
  if (cfg.modoSimulador) {
    $('aviso-simulador').hidden = false;
    $('acceso-simulado').hidden = false;
    $('acceso-simulado').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const correo = $('correo-simulado').value.trim();
      const carga = btoa(JSON.stringify({ email: correo, exp: Math.floor(Date.now() / 1000) + 3600 })).replace(/=+$/, '');
      alIdentificarse({ credential: `SIMULADO.${carga}.x` });
    });
    return;
  }
  const esperarGoogle = () => {
    if (!window.google?.accounts?.id) return setTimeout(esperarGoogle, 100);
    google.accounts.id.initialize({ client_id: cfg.clientId, callback: alIdentificarse, auto_select: true, ux_mode: 'popup', use_fedcm_for_prompt: true });
    google.accounts.id.renderButton($('boton-google'), { theme: 'filled_blue', size: 'large', text: 'signin_with', shape: 'pill', locale: 'es' });
    google.accounts.id.prompt();
  };
  esperarGoogle();
}

async function alIdentificarse(respuesta) {
  establecerToken(respuesta.credential);
  try {
    estado.usuario = await llamar('yo');
  } catch (err) {
    cerrarSesion();
    mostrar('pantalla-acceso');
    return avisar(err.message);
  }
  $('usuario').hidden = false;
  $('usuario-correo').textContent = estado.usuario.correo;
  pintarEquipos();
  pintarPendientes();
}

$('boton-salir').addEventListener('click', () => {
  if (estado.activas > 0 && !confirm('Hay subidas en curso. ¿Salir igualmente? Podrás continuarlas más tarde.')) return;
  estado.cola.forEach((t) => t.control?.abort());
  cerrarSesion();
  estado.usuario = null;
  $('usuario').hidden = true;
  mostrar('pantalla-acceso');
});

// ---------- Equipos y categorías ----------
async function pintarEquipos() {
  mostrar('pantalla-equipos');
  const lista = $('lista-equipos');
  lista.replaceChildren();
  $('sin-equipos').hidden = estado.usuario.equipos.length > 0;
  let progreso = {};
  try { progreso = (await llamar('progreso')).equipos || {}; } catch { /* el progreso es opcional */ }
  for (const eq of estado.usuario.equipos) {
    const b = document.createElement('button');
    b.className = 'tarjeta-equipo';
    b.type = 'button';
    const pct = progreso[eq.id]?.porcentaje;
    b.innerHTML = '<strong></strong><small></small>' + (pct != null ? '<div class="barra"><span></span></div><small class="pct"></small>' : '');
    b.querySelector('strong').textContent = eq.nombre;
    b.querySelector('small').textContent = `${eq.evento}${eq.puedeSubir ? '' : ' · solo consulta'}`;
    if (pct != null) {
      b.querySelector('.barra > span').style.width = `${pct}%`;
      b.querySelector('.pct').textContent = `Progreso: ${pct} %`;
    }
    b.addEventListener('click', () => abrirEquipo(eq));
    lista.append(b);
  }
}

function abrirEquipo(eq) {
  estado.equipo = eq;
  estado.categoria = null;
  $('titulo-equipo').textContent = `${eq.nombre} · ${eq.evento}`;
  $('selector-archivos').hidden = true;
  const lista = $('lista-categorias');
  lista.replaceChildren();
  if (!eq.puedeSubir) {
    lista.innerHTML = '<p class="tarjeta">Tienes acceso de consulta a este equipo, pero no puedes subir material.</p>';
  } else {
    for (const id of eq.categorias) {
      const c = CATEGORIAS[id];
      if (!c) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'categoria';
      b.dataset.categoria = id;
      b.setAttribute('aria-pressed', 'false');
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${c.icono}</svg><span></span>`;
      b.querySelector('span').textContent = c.nombre;
      b.addEventListener('click', () => elegirCategoria(id));
      lista.append(b);
    }
  }
  mostrar('pantalla-subir');
}

function elegirCategoria(id) {
  estado.categoria = id;
  for (const b of document.querySelectorAll('.categoria')) b.setAttribute('aria-pressed', String(b.dataset.categoria === id));
  const entrada = $('entrada-archivos');
  entrada.accept = CATEGORIAS[id].acepta;
  $('texto-selector').textContent = `Elegir archivos · ${CATEGORIAS[id].nombre}`;
  $('selector-archivos').hidden = false;
}

$('volver').addEventListener('click', () => pintarEquipos());

$('entrada-archivos').addEventListener('change', (ev) => {
  for (const archivo of ev.target.files) encolar(archivo, estado.equipo, estado.categoria);
  ev.target.value = '';
});

// ---------- Subidas pendientes (reanudación tras cerrar la página) ----------
const leerPendientes = () => { try { return JSON.parse(localStorage.getItem(CLAVE_PENDIENTES)) || {}; } catch { return {}; } };
const guardarPendientes = (p) => localStorage.setItem(CLAVE_PENDIENTES, JSON.stringify(p));
const huella = (archivo, equipoId, categoria) => [estado.usuario.correo, equipoId, categoria, archivo.name, archivo.size, archivo.lastModified].join('|');

function limpiarPendientesCaducados() {
  const p = leerPendientes();
  const limite = Date.now() - DIAS_VALIDEZ_SESION * 86400000;
  for (const [k, v] of Object.entries(p)) if (v.creado < limite) delete p[k];
  guardarPendientes(p);
  return p;
}

function pintarPendientes() {
  const propios = Object.entries(limpiarPendientesCaducados()).filter(([k]) => k.startsWith(estado.usuario.correo + '|') && !estado.cola.some((t) => t.clave === k));
  const panel = $('panel-pendientes');
  panel.hidden = propios.length === 0;
  if (!propios.length) return;
  panel.innerHTML = '<strong>Subidas sin terminar</strong><p>Para continuarlas, entra en el equipo y vuelve a elegir el mismo archivo. Solo se enviará lo que falta.</p><ul></ul>';
  for (const [, v] of propios) {
    const li = document.createElement('li');
    li.textContent = `${v.nombre} · ${v.equipoNombre} · ${Math.round((v.offset / v.tamano) * 100)} %`;
    panel.querySelector('ul').append(li);
  }
}

// ---------- Cola de subidas ----------
function encolar(archivo, equipo, categoria) {
  const clave = huella(archivo, equipo.id, categoria);
  if (estado.cola.some((t) => t.clave === clave && !['ok', 'error', 'cancelada'].includes(t.fase))) return avisar(`«${archivo.name}» ya está en la cola.`);
  const tarea = { clave, archivo, equipo, categoria, fase: 'espera', control: null };
  tarea.li = crearFila(tarea);
  estado.cola.push(tarea);
  $('panel-subidas').hidden = false;
  procesarCola();
}

function crearFila(tarea) {
  const li = document.createElement('li');
  li.className = 'subida';
  li.innerHTML = '<div class="fila"><span class="nombre"></span><button class="boton secundario pequeno accion" type="button">Cancelar</button></div><div class="barra"><span></span></div><div class="estado">En espera</div>';
  li.querySelector('.nombre').textContent = `${tarea.archivo.name} · ${formatoBytes(tarea.archivo.size)} · ${tarea.equipo.nombre}`;
  li.querySelector('.accion').addEventListener('click', () => {
    if (tarea.fase === 'error' || tarea.fase === 'cancelada') {
      tarea.fase = 'espera';
      li.className = 'subida';
      ponerEstado(tarea, 'En espera');
      li.querySelector('.accion').textContent = 'Cancelar';
      procesarCola();
    } else if (tarea.fase === 'espera') {
      tarea.fase = 'cancelada';
      ponerEstado(tarea, 'Cancelada');
      li.querySelector('.accion').textContent = 'Reintentar';
    } else {
      tarea.control?.abort();
    }
  });
  $('lista-subidas').prepend(li);
  return li;
}

function ponerEstado(tarea, texto, pct) {
  tarea.li.querySelector('.estado').textContent = texto;
  if (pct != null) tarea.li.querySelector('.barra > span').style.width = `${pct}%`;
}

async function procesarCola() {
  while (estado.activas < SIMULTANEAS) {
    const tarea = estado.cola.find((t) => t.fase === 'espera');
    if (!tarea) break;
    estado.activas++;
    mantenerPantalla(true);
    subir(tarea).finally(() => {
      estado.activas--;
      if (estado.activas === 0) mantenerPantalla(false);
      procesarCola();
    });
  }
}

async function subir(tarea) {
  tarea.fase = 'subiendo';
  tarea.control = new AbortController();
  const pendientes = leerPendientes();
  let previo = pendientes[tarea.clave];
  const inicio = Date.now();
  try {
    if (!previo) {
      if (!sesionActiva()) throw new ErrorSubida('identidad_no_valida', 'Tu sesión ha caducado. Sal y vuelve a entrar.');
      ponerEstado(tarea, 'Preparando…', 0);
      const s = await llamar('iniciarSubida', { equipoId: tarea.equipo.id, categoria: tarea.categoria, nombre: tarea.archivo.name, tamano: tarea.archivo.size, tipo: tipoDe(tarea.archivo) });
      previo = { idSubida: s.idSubida, url: s.urlSubida, trozo: s.tamanoTrozo, offset: 0, md5Estado: null, md5Offset: 0, creado: Date.now(), nombre: tarea.archivo.name, tamano: tarea.archivo.size, equipoNombre: tarea.equipo.nombre };
      guardarPendientes({ ...leerPendientes(), [tarea.clave]: previo });
    } else {
      ponerEstado(tarea, 'Reanudando…');
    }
    const subida = new SubidaReanudable({
      archivo: tarea.archivo,
      urlSubida: previo.url,
      tamanoTrozo: previo.trozo,
      estado: previo,
      senal: tarea.control.signal,
      consultarRecibidos: () => llamar('estadoSubida', { idSubida: previo.idSubida }),
      alProgreso: (hecho, total) => {
        const seg = (Date.now() - inicio) / 1000;
        ponerEstado(tarea, `Subiendo ${Math.floor((hecho / total) * 100)} % · ${formatoBytes(hecho)} de ${formatoBytes(total)}${seg > 2 ? ` · ${formatoBytes(hecho / seg)}/s` : ''}`, (hecho / total) * 100);
      },
      alGuardarEstado: (e) => {
        const p = leerPendientes();
        if (p[tarea.clave]) { Object.assign(p[tarea.clave], e); guardarPendientes(p); }
      }
    });
    const r = await subida.ejecutar({ reanudar: previo.offset > 0 || Boolean(pendientes[tarea.clave]) });
    const p = leerPendientes();
    delete p[tarea.clave];
    guardarPendientes(p);
    tarea.fase = 'ok';
    tarea.resultado = r;
    tarea.li.classList.add('ok', 'completa');
    if (previo.idSubida) llamar('subidaTerminada', { idSubida: previo.idSubida }).catch(() => {});
    ponerEstado(tarea, r.verificado === true ? 'Verificado ✓ (Drive ha recibido el archivo íntegro)' : r.verificado === false ? 'Subido, pero la comprobación no coincide: vuelve a subirlo' : 'Subido ✓', 100);
    if (r.verificado === false) tarea.li.classList.replace('ok', 'error');
    tarea.li.querySelector('.accion').hidden = true;
    pintarPendientes();
  } catch (err) {
    if (err instanceof ErrorSubida && err.codigo === 'sesion_caducada') {
      const p = leerPendientes();
      delete p[tarea.clave];
      guardarPendientes(p);
    }
    tarea.fase = err.codigo === 'cancelada' ? 'cancelada' : 'error';
    tarea.li.classList.add(tarea.fase === 'error' ? 'error' : 'subida');
    ponerEstado(tarea, err.codigo === 'cancelada' ? 'Cancelada. Puedes continuarla más tarde.' : err.message || 'Error en la subida.');
    tarea.li.querySelector('.accion').textContent = 'Reintentar';
    pintarPendientes();
  }
}

async function mantenerPantalla(activar) {
  try {
    if (activar && !estado.bloqueoPantalla && 'wakeLock' in navigator) estado.bloqueoPantalla = await navigator.wakeLock.request('screen');
    if (!activar && estado.bloqueoPantalla) { await estado.bloqueoPantalla.release(); estado.bloqueoPantalla = null; }
  } catch { /* no disponible */ }
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && estado.activas > 0) { estado.bloqueoPantalla = null; mantenerPantalla(true); } });
window.addEventListener('beforeunload', (ev) => { if (estado.activas > 0) { ev.preventDefault(); ev.returnValue = ''; } });

iniciar();
