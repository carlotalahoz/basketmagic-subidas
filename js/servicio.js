// Comunicación con el servicio de BasketMagic (Apps Script) e identidad de Google.
const cfg = window.BASKETMAGIC_CONFIG || {};

export const configuracion = cfg;
export const configurado = Boolean(cfg.urlServicio && (cfg.modoSimulador || cfg.clientId));

let idToken = null;
let caducaEn = 0;

export function establecerToken(token) {
  idToken = token;
  try {
    const carga = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    caducaEn = (Number(carga.exp) || 0) * 1000;
  } catch {
    caducaEn = Date.now() + 50 * 60 * 1000;
  }
}

export function cerrarSesion() {
  idToken = null;
  caducaEn = 0;
  if (!cfg.modoSimulador && window.google?.accounts?.id) google.accounts.id.disableAutoSelect();
}

export const sesionActiva = () => Boolean(idToken) && Date.now() < caducaEn - 60000;

export class ErrorServicio extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

export async function llamar(accion, datos = {}, { tokenForzado } = {}) {
  const token = tokenForzado ?? idToken;
  if (!tokenForzado && !sesionActiva()) throw new ErrorServicio('identidad_no_valida', 'Tu sesión ha caducado. Vuelve a iniciar sesión.');
  let respuesta;
  try {
    respuesta = await fetch(cfg.urlServicio, {
      method: 'POST',
      // text/plain evita la comprobación previa CORS que Apps Script no admite.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ accion, idToken: token, ...datos }),
      redirect: 'follow'
    });
  } catch {
    throw new ErrorServicio('sin_conexion', 'No hay conexión con el servicio de BasketMagic.');
  }
  let cuerpo;
  try {
    cuerpo = await respuesta.json();
  } catch {
    throw new ErrorServicio('error_interno', 'Respuesta no válida del servicio.');
  }
  if (!cuerpo.ok) throw new ErrorServicio(cuerpo.error || 'error_interno', cuerpo.mensaje || 'Error del servicio.');
  return cuerpo.datos;
}

const TIPOS_POR_EXTENSION = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', m4v: 'video/x-m4v', mov: 'video/quicktime', '3gp': 'video/3gpp', webm: 'video/webm'
};

export function tipoDe(archivo) {
  if (archivo.type) return archivo.type.toLowerCase();
  const ext = (archivo.name.split('.').pop() || '').toLowerCase();
  return TIPOS_POR_EXTENSION[ext] || 'application/octet-stream';
}

export function ocultarCorreo(correo) {
  const [u, d] = String(correo || '').split('@');
  return u ? `${u.slice(0, 2)}***@${d || ''}` : '';
}
