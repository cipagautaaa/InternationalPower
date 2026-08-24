# Sistema de luces de jueces — INT Power 2026

## Contexto

Competencia nacional de powerlifting, 12 y 13 de septiembre de 2026, Tunja (Colombia).
~100 atletas, público numeroso. Este sistema reemplaza las banderas manuales de los
jueces: tres árbitros emiten su decisión (válido / no válido) y el resultado se muestra
en un televisor visible para atleta, público y mesa de control.

Es un sistema **de un solo día crítico, sin segunda oportunidad**. La prioridad absoluta
es que no falle, no que sea elegante.

## Regla del deporte que gobierna todo el diseño

Los tres jueces votan **a ciegas**. Ningún juez puede saber lo que votaron los otros
antes de que los tres hayan votado. Las tres luces se revelan **simultáneamente**, solo
cuando el tercer voto entra.

Violar esto invalida la competencia. Es el requisito #1 del sistema.

## Arquitectura

```
3 celulares (navegador)  --WiFi 5GHz aislada-->  Portátil (servidor Node)  --HDMI-->  TV
```

La red WiFi aislada ya está montada y configurada. No hay que resolver nada de red.
El portátil corre el servidor y además abre la vista de TV en su propio navegador,
que se proyecta al televisor por HDMI (pantalla extendida).

Solo los tres celulares van por aire. El resto es cable.

## Stack

- Node.js 20+, JavaScript puro (sin TypeScript)
- `express` para servir estáticos, `ws` para WebSockets
- Frontend: HTML + CSS + JS vanilla. **Sin React, sin bundler, sin paso de build.**
- Estado en memoria del proceso. **Sin base de datos.**
- Cero dependencias de internet: nada de CDNs, fuentes de Google ni librerías remotas.
  Todo lo que el navegador necesite debe estar servido desde el propio servidor.

Identificadores y nombres de variables en inglés. Todo el texto visible al usuario, en
español.

## Requisito de arquitectura: capa de entrada desacoplada

La lógica del sistema vive en un módulo (`lib/state.js`) que expone funciones puras
respecto al transporte:

```js
registerVote(judgeId, value)   // value: 'white' | 'red'
resetAttempt()
startTimer()
stopTimer()
getStateFor(role, judgeId)
```

El manejador de WebSocket es un **adaptador delgado** que traduce mensajes a estas
llamadas. Nada de lógica de negocio dentro del handler de WS.

Motivo: en una edición futura se conectarán botones físicos vía Arduino por puerto
serial. Ese adaptador debe poder llamar `registerVote()` sin que se toque una sola línea
de la lógica ni del display.

## Máquina de estados

```
IDLE  --primer voto-->  VOTING  --tercer voto-->  REVEALED  --reset-->  IDLE
```

- `IDLE`: TV muestra tres círculos apagados (contorno gris). No hay votos.
- `VOTING`: hay 1 o 2 votos. El TV **no muestra absolutamente nada** de los votos.
  Opcionalmente puede mostrar cuántos jueces han votado (ej. "2 de 3"), sin indicar
  cuáles ni qué votaron.
- `REVEALED`: los tres colores aparecen de golpe.
- Reset: automático a los 15 segundos de `REVEALED`, o manual desde la vista de control.

Un juez **puede cambiar su voto** presionando el otro botón, pero solo mientras el
estado sea `VOTING`. En `REVEALED` los votos quedan congelados.

## Protocolo WebSocket

Todos los mensajes son JSON.

### Cliente → servidor

| Mensaje | Emisor | Notas |
|---|---|---|
| `{type:'hello', role:'judge'\|'display'\|'control', judgeId}` | todos | primer mensaje tras conectar |
| `{type:'vote', judgeId, value, voteId}` | juez | `voteId` es un UUID generado en el cliente |
| `{type:'reset'}` | control | reset manual |
| `{type:'timer:start'}` / `{type:'timer:stop'}` | control | cronómetro de 1 minuto |
| `{type:'ping'}` | todos | cada 2 s |

### Servidor → cliente

| Mensaje | Notas |
|---|---|
| `{type:'ack', voteId}` | confirmación de voto recibido |
| `{type:'state', ...}` | estado completo, **filtrado por rol** |
| `{type:'pong'}` | respuesta al heartbeat |

### Filtrado por rol — CRÍTICO

`getStateFor()` debe devolver payloads distintos según quién pregunta. Nunca hagas
broadcast del estado completo a todo el mundo.

- **A un juez, durante `VOTING`**: solo su propio voto y cuántos votos van en total.
  Jamás los valores de los otros dos. Un juez con las DevTools abiertas no puede ser
  capaz de ver el voto de otro.
- **Al display, durante `VOTING`**: solo el conteo. Nunca los valores.
- **En `REVEALED`**: todos reciben los tres valores.

Este filtrado se implementa en el servidor, no en el cliente. Ocultar con CSS no cuenta.

## Idempotencia y reintentos

- El cliente reenvía el voto cada 500 ms hasta recibir el `ack` correspondiente.
- El servidor deduplica por `voteId`: recibir el mismo `voteId` dos veces es un no-op
  que igual responde `ack`.
- El voto solo se considera confirmado en el cliente cuando llega el `ack`.

## Vista de juez — `/juez?id=1|2|3`

`id` 1 = juez izquierdo, 2 = juez central (jefe), 3 = juez derecho.

Requisitos:

- Dos botones ocupando cada uno **media pantalla completa**: blanco arriba, rojo abajo.
  Separación central de al menos 40 px para evitar toques accidentales entre zonas.
- Al tocar: el botón queda marcado con un borde grueso **solo cuando llega el `ack`**,
  nunca al momento del toque. Es la única señal de que el voto llegó de verdad.
- `navigator.vibrate(80)` al recibir el `ack`. Es el sustituto del clic físico.
- `navigator.wakeLock.request('screen')` al cargar, con re-solicitud en
  `visibilitychange`. La pantalla no se puede apagar en toda la jornada.
- Botón discreto para entrar a pantalla completa (`requestFullscreen`).
- **Banner de desconexión**: si pasan más de 5 s sin `pong`, cubrir toda la pantalla con
  un aviso rojo, opaco e imposible de ignorar que diga "SIN CONEXIÓN". Que el juez se
  entere tarde es peor que la falla misma.
- Reconexión automática del WebSocket con backoff, tope de 1 s entre intentos.
- Al reconectar, el cliente recupera el estado del intento en curso desde el servidor.
- `user-select: none` y `touch-action: manipulation` en todo. Nada de zoom accidental
  ni de menú contextual por pulsación larga.
- El juez 2 (jefe) tiene además un botón pequeño y separado para iniciar el cronómetro.

## Vista de TV — `/tv`

- Fondo negro. Máximo contraste.
- Tres círculos grandes en fila horizontal, ocupando el ancho útil de la pantalla.
- **Orden desde la perspectiva del público**: el círculo de la izquierda corresponde al
  juez izquierdo visto por el atleta y el público. Verificar esto en sitio antes del
  evento.
- Apagado: contorno gris, relleno transparente. Válido: relleno blanco puro.
  No válido: relleno rojo saturado (`#E02020`).
- Cronómetro de 60 s en la parte superior, en dígitos grandes. Cambia a rojo bajo 10 s.
- La transición de apagado a revelado es instantánea para los tres. Sin animaciones
  escalonadas, sin fades por separado: si un círculo aparece antes que otro, se rompe
  la simultaneidad visual.
- Sin scroll, sin barras, sin cursor visible (`cursor: none`).
- Diseñar para 1920×1080 pero que escale con `vw`/`vh`.

## Vista de control — `/control`

Para el portátil de la mesa de control. Sencilla:

- Estado actual del sistema y de las tres conexiones (conectado / desconectado por juez).
- Botón de reset manual.
- Botón de iniciar/detener cronómetro.
- Log de los últimos 10 intentos con sus tres decisiones y la hora.

## Configuración

Un `config.json` en la raíz con: puerto, segundos del cronómetro (60), segundos de
auto-reset tras revelar (15), y el timeout del heartbeat.

Al arrancar, el servidor imprime en consola las URLs exactas de cada vista con la IP
de la red local, listas para dictárselas a quien esté configurando los celulares.

## Estructura de archivos

```
server.js
config.json
lib/
  state.js          lógica pura, sin conocimiento del transporte
  ws-adapter.js     traduce WebSocket <-> state.js
public/
  juez.html   js/juez.js   css/juez.css
  tv.html     js/tv.js     css/tv.css
  control.html js/control.js css/control.css
  js/ws-client.js   reconexión, heartbeat, cola de reintentos (compartido)
README.md
```

## Fuera de alcance

- Autenticación, usuarios, permisos
- Base de datos o persistencia en disco
- Integración con LiftingCast
- Soporte para más de una plataforma simultánea
- Cualquier cosa que requiera internet
- Modo oscuro/claro, i18n, responsive más allá de celular y 1080p

## Criterios de aceptación

Antes de considerar esto terminado, cada punto debe pasar manualmente:

1. Con dos votos emitidos, ni el TV ni ninguna de las tres vistas de juez muestra el
   valor de ningún voto ajeno — verificado inspeccionando el tráfico WebSocket en las
   DevTools, no solo mirando la pantalla.
2. Al entrar el tercer voto, los tres círculos cambian en el mismo frame.
3. Un juez cambia su voto de blanco a rojo antes del tercer voto: se registra el cambio.
4. Un juez intenta cambiar su voto después del revelado: se ignora.
5. Se apaga el WiFi de un celular a media votación: aparece el banner de desconexión
   en menos de 6 s. Al reconectar, recupera el estado sin perder el voto ya emitido.
6. Se mata el proceso del servidor y se reinicia: los tres clientes reconectan solos
   sin recargar la página a mano.
7. Un celular queda 30 minutos con la vista abierta y sin tocar: la pantalla sigue
   encendida y el WebSocket sigue vivo.
8. Se toca el botón blanco 10 veces seguidas rápido: se registra un solo voto.
9. El auto-reset devuelve a `IDLE` a los 15 s del revelado.
10. La vista de TV se ve correctamente a 1920×1080 sin scroll ni recortes.

## Estilo de trabajo

- Prioriza claridad sobre astucia. Este código lo va a leer alguien con sueño a las
  11 de la noche del 11 de septiembre.
- No agregues dependencias sin justificarlo. `express` y `ws` deberían bastar.
- Comenta únicamente lo no obvio: sobre todo el filtrado por rol y la deduplicación.
- Trabaja en incrementos verificables: primero el servidor con la máquina de estados y
  un test manual por consola, después la vista de juez, después la de TV, y de última
  la de control.1