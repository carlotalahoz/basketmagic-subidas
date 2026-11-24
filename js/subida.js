// Subida reanudable directa a Google Drive (protocolo «resumable upload»).
// La sesión la crea el servicio de BasketMagic (Apps Script) tras verificar identidad y permisos.

const ESPERAS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];

export class ErrorSubida extends Error {
  constructor(codigo, mensaje) {
    super(mensaje);
    this.codigo = codigo;
  }
}

const dormir = (ms, senal) => new Promise((ok, mal) => {
  const t = setTimeout(ok, ms);
  senal?.addEventListener('abort', () => { clearTimeout(t); mal(new ErrorSubida('cancelada', 'Subida cancelada.')); }, { once: true });
});

function finDesdeRange(valor) {
  const m = /bytes=0-(\d+)/.exec(valor || '');
  return m ? Number(m[1]) + 1 : 0;
}

/**
 * Sube `archivo` a `urlSubida` por trozos.
 * estado = { offset, md5Estado, md5Offset } permite continuar tras recargar la página.
 */
export class SubidaReanudable {
  constructor({ archivo, urlSubida, tamanoTrozo = 8 * 1024 * 1024, estado = null, alProgreso = () => {}, alGuardarEstado = () => {}, senal = null }) {
    this.archivo = archivo;
    this.url = urlSubida;
    this.trozo = Math.max(256 * 1024, Math.floor(tamanoTrozo / (256 * 1024)) * 256 * 1024);
    this.alProgreso = alProgreso;
    this.alGuardarEstado = alGuardarEstado;
    this.senal = senal;
    this.md5 = new SparkMD5.ArrayBuffer();
    this.md5Offset = 0;
    if (estado?.md5Estado) {
      this.md5.setState(estado.md5Estado);
      this.md5Offset = estado.md5Offset || 0;
    }
    this.diagnostico = { reintentos: 0, consultasEstado: 0, rangeVisible: null, bytesEnviados: 0 };
  }

  async ejecutar({ reanudar = false } = {}) {
    const total = this.archivo.size;
    let offset = 0;
    if (reanudar) {
      const r = await this.consultarEstado();
      if (r.terminado) return this.finalizar(r.archivoDrive);
      offset = r.offset;
    }
    let intento = 0;
    while (offset < total) {
      this.comprobarCancelacion();
      const fin = Math.min(offset + this.trozo, total);
      let respuesta;
      try {
        const datos = await this.archivo.slice(offset, fin).arrayBuffer();
        await this.avanzarMd5(offset, datos);
        respuesta = await fetch(this.url, {
          method: 'PUT',
          headers: { 'Content-Range': `bytes ${offset}-${fin - 1}/${total}` },
          body: datos,
          signal: this.senal
        });
        this.diagnostico.bytesEnviados += fin - offset;
      } catch (err) {
        if (this.senal?.aborted) throw new ErrorSubida('cancelada', 'Subida cancelada.');
        respuesta = null;
      }

      if (respuesta && (respuesta.status === 200 || respuesta.status === 201)) {
        this.md5Offset = total;
        return this.finalizar(await respuesta.json().catch(() => ({})));
      }
      if (respuesta && respuesta.status === 308) {
        const range = respuesta.headers.get('Range');
        this.diagnostico.rangeVisible = range !== null;
        offset = range !== null ? finDesdeRange(range) : fin;
        intento = 0;
        this.alProgreso(offset, total);
        this.alGuardarEstado({ offset, ...this.estadoMd5(offset) });
        continue;
      }
      if (respuesta && [404, 410, 499].includes(respuesta.status)) {
        throw new ErrorSubida('sesion_caducada', 'La sesión de subida ya no es válida (ha caducado o se ha cancelado). Vuelve a elegir el archivo.');
      }
      if (respuesta && respuesta.status >= 400 && respuesta.status < 500 && respuesta.status !== 408 && respuesta.status !== 429) {
        throw new ErrorSubida('rechazada', `Google Drive ha rechazado el archivo (HTTP ${respuesta.status}).`);
      }
      // Error de red, 408, 429 o 5xx: esperar, preguntar a Drive cuánto tiene y seguir.
      if (intento >= ESPERAS_MS.length) {
        throw new ErrorSubida('sin_conexion', 'No hay conexión estable. La subida se puede continuar más tarde.');
      }
      this.diagnostico.reintentos++;
      await dormir(ESPERAS_MS[intento++], this.senal);
      try {
        const r = await this.consultarEstado();
        if (r.terminado) return this.finalizar(r.archivoDrive);
        offset = r.offset;
        this.alProgreso(offset, total);
      } catch (err) {
        if (err instanceof ErrorSubida && err.codigo !== 'sin_conexion') throw err;
      }
    }
    // Todos los bytes confirmados pero sin respuesta final: preguntar.
    const r = await this.consultarEstado();
    if (r.terminado) return this.finalizar(r.archivoDrive);
    throw new ErrorSubida('incompleta', 'Drive no ha confirmado el archivo completo.');
  }

  async consultarEstado() {
    this.comprobarCancelacion();
    this.diagnostico.consultasEstado++;
    let r;
    try {
      r = await fetch(this.url, { method: 'PUT', headers: { 'Content-Range': `bytes */${this.archivo.size}` }, signal: this.senal });
    } catch (err) {
      if (this.senal?.aborted) throw new ErrorSubida('cancelada', 'Subida cancelada.');
      throw new ErrorSubida('sin_conexion', 'Sin conexión.');
    }
    if (r.status === 200 || r.status === 201) return { terminado: true, archivoDrive: await r.json().catch(() => ({})) };
    if (r.status === 308) {
      const range = r.headers.get('Range');
      this.diagnostico.rangeVisible = range !== null;
      return { terminado: false, offset: finDesdeRange(range) };
    }
    if ([404, 410, 499].includes(r.status)) throw new ErrorSubida('sesion_caducada', 'La sesión de subida ya no es válida (ha caducado o se ha cancelado). Vuelve a elegir el archivo.');
    throw new ErrorSubida('sin_conexion', `Respuesta inesperada de Drive (HTTP ${r.status}).`);
  }

  async avanzarMd5(inicio, datosTrozo) {
    if (this.md5Offset > inicio) {
      this.md5 = new SparkMD5.ArrayBuffer();
      this.md5Offset = 0;
    }
    const paso = 4 * 1024 * 1024;
    while (this.md5Offset < inicio) {
      const hasta = Math.min(this.md5Offset + paso, inicio);
      this.md5.append(await this.archivo.slice(this.md5Offset, hasta).arrayBuffer());
      this.md5Offset = hasta;
    }
    this.md5.append(datosTrozo);
    this.md5Offset = inicio + datosTrozo.byteLength;
  }

  estadoMd5(offset) {
    // Solo se guarda el estado si coincide con lo confirmado por Drive.
    return this.md5Offset === offset ? { md5Estado: this.md5.getState(), md5Offset: this.md5Offset } : { md5Estado: null, md5Offset: 0 };
  }

  async finalizar(archivoDrive) {
    if (this.md5Offset !== this.archivo.size) await this.avanzarMd5(this.archivo.size, new ArrayBuffer(0));
    const md5Local = this.md5.end();
    const md5Drive = archivoDrive?.md5Checksum || null;
    this.alProgreso(this.archivo.size, this.archivo.size);
    return {
      idDrive: archivoDrive?.id || null,
      nombre: archivoDrive?.name || this.archivo.name,
      md5Local,
      md5Drive,
      verificado: md5Drive ? md5Drive === md5Local : null
    };
  }

  comprobarCancelacion() {
    if (this.senal?.aborted) throw new ErrorSubida('cancelada', 'Subida cancelada.');
  }
}
