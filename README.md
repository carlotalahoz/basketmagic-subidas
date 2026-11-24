# basketmagic-subidas

Web estática (GitHub Pages) para que los entrenadores suban fotos y vídeos a BasketMagic desde el móvil.

- Solo contiene código público: **sin tokens, secretos, correos, nombres de equipos ni IDs privados**.
- `js/config.js` no está en el repositorio: lo genera GitHub Actions con las variables `GOOGLE_CLIENT_ID_WEB` y `APPS_SCRIPT_URL` (el ID de cliente web de Google es público por diseño).
- Los permisos y los equipos se guardan en un archivo privado del Drive de la administradora y los comprueba el servidor (Apps Script).
- Los archivos viajan directamente del móvil a Google Drive con subida reanudable y se verifican con MD5.

`index.html`: página de subida. `prueba.html`: prueba técnica.

Licencias de terceros: `js/vendor/spark-md5.LICENSE`.
