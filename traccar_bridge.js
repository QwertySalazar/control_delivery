/**
 * PUENTE DE CONEXIÓN TRACCAR -> MAPA CENTRAL DE REPARTO
 * ----------------------------------------------------
 * Este servidor recibe las peticiones HTTP (GET y POST) que envía la app "Traccar Client"
 * desde los móviles de los repartidores y las retransmite instantáneamente
 * al canal MQTT del mapa en tiempo real.
 */

const http = require('http');
const url = require('url');
const querystring = require('querystring');
const mqtt = require('mqtt');

const PORT = process.env.PORT || 5055;
const MQTT_BROKER = process.env.MQTT_BROKER || 'mqtt://broker.emqx.io:1883';
const MQTT_TOPIC = 'madrid_fleet_sync_channel_v1/events';

console.log('==================================================');
console.log('🚀 Iniciando Puente Traccar GPS -> Control Delivery');
console.log('==================================================');

// Conexión al Broker MQTT
const mqttClient = mqtt.connect(MQTT_BROKER, {
  clientId: 'traccar_bridge_' + Math.random().toString(16).substring(2, 8),
  keepalive: 30,
  reconnectPeriod: 3000
});

mqttClient.on('connect', () => {
  console.log(`✅ Conectado exitosamente al broker MQTT (${MQTT_BROKER})`);
  console.log(`📡 Retransmitiendo al canal: ${MQTT_TOPIC}`);
});

mqttClient.on('error', (err) => {
  console.warn('⚠️ Error de conexión MQTT:', err.message);
});

let totalPingsReceived = 0;
const lastDriverUpdates = {};

// Servidor HTTP que escucha los envíos de la app Traccar Client (Protocolo OsmAnd: GET y POST)
const server = http.createServer((req, res) => {
  // Configurar cabeceras CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // 1. Endpoint para limpiar y reiniciar todas las ubicaciones
  if (pathname === '/reset' || parsedUrl.query.reset === '1' || parsedUrl.query.limpiar === '1') {
    const previousCount = Object.keys(lastDriverUpdates).length;
    for (const key in lastDriverUpdates) delete lastDriverUpdates[key];
    totalPingsReceived = 0;

    const resetPayload = {
      type: 'FLEET_RESET',
      source: 'traccar_client',
      timestamp: Date.now()
    };

    if (mqttClient && mqttClient.connected) {
      mqttClient.publish(MQTT_TOPIC, JSON.stringify(resetPayload));
      console.log('🧹 [Traccar Bridge] Emitida orden de limpieza FLEET_RESET al mapa central.');
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Ubicaciones Limpiadas</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui, sans-serif; background: #0b111a; color: #fff; padding: 32px; max-width: 550px; margin: 0 auto; text-align: center; }
          .card { background: #182232; border: 1px solid #22c55e; border-radius: 12px; padding: 24px; margin-top: 24px; }
          a { display: inline-block; margin-top: 18px; padding: 10px 20px; background: #22c55e; color: #022c22; text-decoration: none; font-weight: bold; border-radius: 8px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div style="font-size: 40px; margin-bottom: 8px;">🧹</div>
          <h2 style="color:#4ade80; margin:0 0 8px 0;">¡Ubicaciones Limpiadas con Éxito!</h2>
          <p style="color:#94a3b8; font-size:14px; margin:0;">
            Se han borrado los ${previousCount} repartidores anteriores en el servidor y se ha enviado la señal de limpieza al mapa central.
          </p>
          <a href="/">← Volver al Panel</a>
        </div>
      </body>
      </html>
    `);
    return;
  }

  // 2. Capturar cuerpo de la petición (para peticiones POST que envía Traccar Client)
  const bodyChunks = [];
  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const rawBody = Buffer.concat(bodyChunks).toString();

    let bodyData = {};
    if (rawBody && rawBody.trim().length > 0) {
      try {
        if (rawBody.trim().startsWith('{')) {
          bodyData = JSON.parse(rawBody);
        } else {
          bodyData = querystring.parse(rawBody);
        }
      } catch (e) {
        try {
          bodyData = querystring.parse(rawBody);
        } catch (e2) {}
      }
    }

    // Combinar query string de la URL + cuerpo POST
    const merged = { ...parsedUrl.query, ...bodyData };

    // Extraer campos de Traccar (soporta múltiples variantes de nombres de campo)
    const driverId = (merged.id || merged.deviceid || merged.deviceId || merged.uniqueId || '').toString().trim().toLowerCase();
    const lat = parseFloat(merged.lat !== undefined ? merged.lat : merged.latitude);
    const lon = parseFloat(merged.lon !== undefined ? merged.lon : (merged.lng !== undefined ? merged.lng : merged.longitude));

    // Si recibimos coordenadas válidas de Traccar
    if (driverId && !isNaN(lat) && !isNaN(lon)) {
      totalPingsReceived++;

      // Traccar envía velocidad en nudos (knots). 1 knot = 1.852 km/h
      const rawSpeed = parseFloat(merged.speed) || 0;
      const speedKmh = Math.round(rawSpeed * 1.852);
      const heading = Math.round(parseFloat(merged.bearing || merged.heading) || 0);
      const accuracy = Math.round(parseFloat(merged.accuracy) || 8);
      const battery = (merged.batt !== undefined) ? Math.round(parseFloat(merged.batt)) : ((merged.battery !== undefined) ? Math.round(parseFloat(merged.battery)) : null);

      const payload = {
        type: 'GPS_UPDATE',
        driverId: driverId,
        lat: lat,
        lon: lon,
        accuracy: accuracy,
        speed: speedKmh,
        heading: heading,
        battery: battery,
        timestamp: Date.now(),
        source: 'traccar_client'
      };

      lastDriverUpdates[driverId] = {
        ...payload,
        timeStr: new Date().toLocaleTimeString()
      };

      // Publicar al mapa central por MQTT
      if (mqttClient && mqttClient.connected) {
        mqttClient.publish(MQTT_TOPIC, JSON.stringify(payload));
        console.log(`📍 [Traccar OK] 🛵 ${driverId.toUpperCase()} (${req.method}): Lat ${lat.toFixed(5)}, Lon ${lon.toFixed(5)} | Vel ${speedKmh} km/h | Bat ${battery !== null ? battery + '%' : 'N/A'}`);
      } else {
        console.warn(`⚠️ [Traccar] Recibido ${driverId} pero MQTT está reconectando...`);
      }

      // Respuesta obligatoria para Traccar Client
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }

    // Si abren la URL desde el navegador para consultar el estado
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    const driversListHtml = Object.keys(lastDriverUpdates).length > 0
      ? Object.entries(lastDriverUpdates).map(([id, d]) => `
          <li style="margin-bottom:8px;">
            <b>🛵 ${id.toUpperCase()}:</b> Lat ${d.lat.toFixed(4)}, Lon ${d.lon.toFixed(4)} | 
            ⚡ ${d.speed} km/h | 🎯 ±${d.accuracy}m | 🔋 ${d.battery !== null ? d.battery + '%' : '--'} | ⏱️ ${d.timeStr}
          </li>
        `).join('')
      : '<li>Ningún repartidor ha emitido aún.</li>';

    res.end(`
      <!DOCTYPE html>
      <html lang="es">
      <head>
        <meta charset="utf-8">
        <title>Puente Traccar - Central de Reparto</title>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
          body { font-family: system-ui, sans-serif; background: #0b111a; color: #fff; padding: 24px; max-width: 650px; margin: 0 auto; line-height: 1.5; }
          .card { background: #182232; border: 1px solid #334155; border-radius: 12px; padding: 20px; margin-top: 16px; }
          h1 { color: #22c55e; font-size: 22px; margin-bottom: 4px; }
          code { background: #0f172a; padding: 3px 8px; border-radius: 6px; color: #38bdf8; font-family: monospace; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: bold; background: rgba(34, 197, 94, 0.2); color: #4ade80; border: 1px solid #22c55e; }
          ul { padding-left: 20px; }
        </style>
      </head>
      <body>
        <h1>📡 Servidor Puente Traccar Activo</h1>
        <p><span class="badge">ONLINE</span> Conectado con el mapa de entrega en vivo.</p>

        <div class="card">
          <h3>Configuración para la App "Traccar Client":</h3>
          <p><b>URL del Servidor:</b> <code>https://traccar-bridge.onrender.com</code></p>
          <p><b>Identificador de dispositivo:</b> El nombre del repartidor (ej: <code>jeferson</code>, <code>javier</code>, <code>carlos</code>)</p>
          <p><b>Intervalo de frecuencia:</b> <code>3</code> o <code>5</code> segundos</p>
        </div>

        <div class="card">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0;">Repartidores activos (${Object.keys(lastDriverUpdates).length}):</h3>
            <a href="/reset" onclick="return confirm('¿Limpiar todas las ubicaciones y repartidores anteriores?')" style="background:#ef4444; color:#fff; padding:6px 12px; border-radius:6px; font-size:12px; font-weight:bold; text-decoration:none;">🧹 Limpiar Ubicaciones</a>
          </div>
          <ul>${driversListHtml}</ul>
          <p style="font-size: 12px; color: #94a3b8;">Total de señales GPS procesadas: <b>${totalPingsReceived}</b></p>
        </div>
      </body>
      </html>
    `);
  });
});

server.listen(PORT, () => {
  console.log(`🎯 Servidor HTTP escuchando en el puerto ${PORT}`);
});
