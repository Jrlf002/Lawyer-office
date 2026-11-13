# Bufete Jurídico Fonseca

## Ejecutar

Requiere Node.js 18 o posterior.

1. Abra una terminal en esta carpeta y ejecute `npm start`.
2. La terminal muestra un código de activación de un solo uso. No lo comparta.
3. Abra `http://localhost:3000` y, en **Acceso administrativo**, active la cuenta única del dueño.
4. Inicie sesión para abrir el panel de gestión.

No abra `index.html` directamente: el acceso, las solicitudes y la configuración necesitan el servidor. El archivo `.bufete-data.json` contiene la cuenta, contactos y consultas. Manténgalo fuera de repositorios públicos y copias compartidas.

## Expedientes

El dueño crea los expedientes con nombre, cédula, teléfono, referencias de escritura y protocolo, estados de entrega y colaborador asignado. Puede adjuntar archivos PDF, JPG o PNG de hasta 5 MB, clasificados como cédula, escritura o protocolo. Solo el dueño y el colaborador asignado pueden ver esos expedientes y descargar sus adjuntos. El dueño puede asignar o quitar acceso a colaboradores; los colaboradores actualizan los estados y notas de sus expedientes.

Los expedientes y adjuntos contienen datos personales. Se guardan en `.bufete-data.json` y `private-files/`; ambos están excluidos del control de versiones mediante `.gitignore`.

## Colaboradores

Desde **Acceso administrativo → Solicitar acceso**, una persona crea una solicitud. La cuenta queda pendiente hasta que el dueño la apruebe. El dueño puede aprobar, rechazar o quitar el acceso.

## Recuperación por SMS

Para enviar códigos temporales, configure una cuenta de Twilio y estas variables privadas en el entorno del servidor: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` y `TWILIO_FROM_NUMBER`. No escriba esas credenciales en `app.js` ni las publique. El dueño y cada colaborador deben registrar un teléfono con código de país. Los códigos vencen en diez minutos.

## Consultas y mensajes

La consulta del formulario queda en el panel del dueño. WhatsApp abre un mensaje preparado al número principal y el cliente debe pulsar **Enviar**. El correo abre un borrador dirigido al bufete con las direcciones adicionales en copia. Para enviar mensajes automáticos a varios números de WhatsApp se necesita WhatsApp Business API y credenciales del negocio.

## Publicación

Use HTTPS y configure `NODE_ENV=production` para habilitar la cookie segura de sesión. Mantenga privado el terminal del servidor y los archivos de datos.
