# 📱 Guía de Conexión y Configuración de Traccar Client

Con **Traccar Client**, los repartidores transmitirán su ubicación satelital continua en segundo plano, **incluso con el teléfono bloqueado en el bolsillo o utilizando Google Maps / Waze**.

---

## 1. Descarga de la Aplicación en el Móvil del Repartidor

Cada repartidor debe descargar la aplicación oficial gratuita:
* **Android (Google Play):** Buscar **"Traccar Client"** (desarrollador *Anton Tananaev* / *Traccar*).
* **iPhone / iOS (App Store):** Buscar **"Traccar Client"**.

---

## 2. Configuración en el Móvil (Paso a Paso)

Abre la app **Traccar Client** en el teléfono. Verás una pantalla de ajustes muy sencilla:

| Opción en Traccar | Valor a Configurar | Explicación |
| :--- | :--- | :--- |
| **Identificador de dispositivo** | `jeferson` (o `javier`, `carlos`) | **El nombre del repartidor** en minúsculas. Así el mapa sabe quién es. |
| **URL del servidor** | `http://TU_SERVIDOR:5055` | La dirección web de tu puente Traccar (ver sección 3). |
| **Ubicación** | `Activado / Fina (Alta precisión)` | Usa GPS satelital. |
| **Frecuencia (Intervalo)** | `3` o `5` | Segundos entre cada emisión GPS (recomendado: 3 s). |
| **Distancia** | `5` o `10` | Metros mínimos recorridos para actualizar (recomendado: 5 m). |
| **Ángulo** | `25` o `30` | Grados de giro en una esquina para enviar la curva en tiempo real. |

> ⚠️ **Permisos importantes en Android:**
> 1. Cuando la app pregunte permisos de ubicación, selecciona **"Permitir todo el tiempo"** (para que funcione con la pantalla apagada).
> 2. En Ajustes de Batería de Android, desactiva la "Optimización de batería" para Traccar Client (así Android nunca la suspenderá).

---

## 3. ¿Cómo activar el Puente (Bridge) para conectar Traccar con tu Mapa?

Como los repartidores están en la calle con datos móviles (4G/5G), necesitan una dirección de internet donde enviar sus coordenadas.

### Opción A: Despliegue Gratis 24/7 en la Nube con Glitch o Render (Recomendado)
No necesitas tener tu ordenador encendido ni instalar nada:

1. Entra en [https://glitch.com](https://glitch.com) (o [https://render.com](https://render.com)).
2. Crea un proyecto nuevo e importa este repositorio o copia los 2 archivos:
   - `package.json`
   - `traccar_bridge.js`
3. Glitch te dará una URL pública con HTTPS inmediata (ejemplo: `https://madrid-delivery-gps.glitch.me`).
4. **¡Listo!** Esa es la URL que pones en el campo **"URL del Servidor"** de Traccar en los móviles de los repartidores.

### Opción B: Ejecutar Localmente en tu Ordenador (Pruebas)
Si tienes Node.js instalado en tu equipo:
```bash
npm install
npm start
```
El servidor escuchará en el puerto `5055`. Puedes usar una herramienta como `ngrok` (`ngrok http 5055`) para obtener una URL pública temporal para los móviles.

---

## 4. ¿Cómo trabaja el repartidor en su jornada diaria?

1. Al empezar el turno, abre **Traccar Client**.
2. Enciende el interruptor superior: **"Estado del servicio: ACTIVADO"**.
3. Guarda el móvil en el bolsillo o abre Google Maps.
4. **Automáticamente aparecerá en tu mapa central**, moviéndose en vivo por las calles de Madrid con su velocidad y estela de ruta.
5. Al terminar su turno, apaga el interruptor: **"Estado del servicio: DESACTIVADO"**.
