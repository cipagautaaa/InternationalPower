# Luces de jueces — INT Power 2026

Sistema que reemplaza las banderas manuales de los tres árbitros de powerlifting.
Cada juez vota válido/no válido desde su celular; el resultado se revela
simultáneamente en un televisor cuando entran los tres votos. Ver `CLAUDE.md`
para el diseño completo (arquitectura, máquina de estados, protocolo).

## Arrancar

```
npm install
node server.js
```

El servidor imprime en consola las URLs exactas (con la IP de la red local)
para cada vista — listas para dictárselas a quien esté configurando los
celulares:

- `/juez?id=1` — juez izquierdo
- `/juez?id=2` — juez central (jefe, tiene botón de cronómetro)
- `/juez?id=3` — juez derecho
- `/tv` — vista para el televisor (el portátil la abre en su propio
  navegador y la proyecta por HDMI)
- `/control` — vista para la mesa de control

`config.json` tiene el puerto, la duración del cronómetro, los segundos de
auto-reset tras revelar, y el timeout del heartbeat.

## Estructura

```
server.js            Express + WebSocketServer, imprime las URLs al arrancar
config.json
lib/state.js          máquina de estados IDLE→VOTING→REVEALED, sin transporte
lib/ws-adapter.js      adaptador delgado: traduce WebSocket <-> state.js
public/
  juez.html/js/css     vista de juez
  tv.html/js/css       vista de TV
  control.html/js/css  vista de mesa de control
  js/ws-client.js      reconexión, heartbeat, cola de reintento (compartido)
```

## Puntos delicados a tener presentes

- **Filtrado por rol**: `state.getStateFor(role, judgeId)` decide qué ve cada
  quién. Nunca se hace broadcast del estado completo — un juez o el TV jamás
  reciben el valor de un voto ajeno mientras se está votando, ni con las
  DevTools abiertas.
- **Wake Lock exige "secure context"** (https o localhost). Los celulares se
  conectan por http plano a la IP de la LAN, así que `navigator.wakeLock`
  puede no activarse — **probarlo con los celulares reales antes del
  evento**. Si falla, la salida es servir por HTTPS con certificado
  autofirmado.
- **Acciones administrativas con rol**: `reset` y `timer:stop` solo los
  procesa el servidor si vienen de un cliente con rol `control`;
  `timer:start` también lo acepta del juez 2 (su botón de cronómetro).
- **Heartbeat independiente del ciclo de conexión**: el vigilante que
  detecta "más de 5s sin pong" corre siempre, incluso mientras el socket
  está cerrado y reintentando reconectar — si se detuviera al cerrarse el
  socket, el banner de desconexión nunca aparecería.

## Verificado manualmente (checklist de CLAUDE.md)

Probado en navegador (Chrome vía automatización) contra el servidor real:

1. ✅ Con dos votos emitidos, ningún cliente recibe el valor de un voto
   ajeno (verificado inspeccionando los mensajes WebSocket, no solo la
   pantalla).
2. ✅ Al entrar el tercer voto, los tres círculos del TV cambian en el mismo
   evento de broadcast.
3. ✅ Un juez cambia su voto antes del tercer voto: se registra el cambio.
4. ✅ Un juez intenta cambiar su voto después del revelado: se ignora.
5. ✅ Se corta la conexión de un celular a media votación: banner "SIN
   CONEXIÓN" a los ~5s; al reconectar recupera el voto ya emitido sin
   perderlo (el servidor nunca lo perdió).
6. ✅ Se mata el proceso del servidor y se reinicia: el cliente reconecta
   solo, sin recargar la página, y puede volver a votar normalmente.
7. ⏳ 30 minutos de pantalla encendida — depende de Wake Lock funcionando en
   los celulares reales; pendiente de probar in situ.
8. ✅ Se toca un botón 10 veces seguidas rápido: se registra un solo voto.
9. ✅ El auto-reset devuelve a IDLE a los 8s del revelado.
10. ✅ La vista de TV se ve correctamente a 1920×1080 sin scroll ni recortes.

Durante estas pruebas se encontraron y corrigieron dos bugs reales:
- Una condición de carrera en `judgeConnections` (un socket viejo cerrándose
  tarde tras una reconexión podía marcar a un juez como desconectado aunque
  ya estuviera reconectado).
- El vigilante de heartbeat se detenía justo al perderse la conexión,
  impidiendo que el banner de desconexión apareciera.
