'use strict'

// Adaptador delgado: traduce mensajes de WebSocket a llamadas de lib/state.js
// y viceversa. No hay lógica de negocio aquí — solo transporte, conexiones
// y el filtrado de qué payload le corresponde a cada rol.

const state = require('./state.js')

// ws -> { role, judgeId, isAlive } de cada socket conectado.
const clients = new Map()

// Estado de conexión de los tres jueces, para la vista de control. Vive
// aquí y no en state.js porque es información de transporte (¿hay un
// socket vivo?), no del intento de levantamiento en curso.
const judgeConnections = { 1: false, 2: false, 3: false }

// judgeId -> socket que actualmente representa a ese juez. Necesario para
// la reconexión: cuando el celular reconecta, el socket viejo puede seguir
// cerrándose (evento 'close' tardío) después de que el nuevo ya mandó su
// 'hello'. Sin esto, ese cierre tardío apagaría judgeConnections aunque el
// juez ya esté conectado de nuevo por el socket nuevo.
const activeSocketByJudge = { 1: null, 2: null, 3: null }

// Último voteId procesado por juez, para deduplicar reintentos: el
// cliente reenvía el mismo voto cada 500ms hasta recibir el ack, y
// reprocesarlo no debe volver a "mover" el estado, solo reconfirmar.
const lastVoteIdByJudge = {}

function attachWebSocketServer(wss) {
  wss.on('connection', (ws) => {
    clients.set(ws, { role: null, judgeId: null })

    ws.on('message', (raw) => {
      let msg
      try {
        msg = JSON.parse(raw)
      } catch {
        return
      }
      handleMessage(ws, msg)
    })

    ws.on('close', () => {
      const meta = clients.get(ws)
      clients.delete(ws)
      if (
        meta &&
        meta.role === 'judge' &&
        judgeConnections[meta.judgeId] !== undefined &&
        activeSocketByJudge[meta.judgeId] === ws
      ) {
        judgeConnections[meta.judgeId] = false
        activeSocketByJudge[meta.judgeId] = null
        broadcastState()
      }
    })
  })

  // Retransmisión inmediata ante cualquier cambio de estado, incluido el
  // auto-reset que dispara state.js por su cuenta a los 8s de REVEALED.
  state.onChange(broadcastState)

  // Tick periódico solo para que el cronómetro visible avance en pantalla;
  // los cambios de fase (voto, revelado, reset) ya se transmiten al
  // instante vía state.onChange, así que esto no afecta la simultaneidad.
  setInterval(() => {
    if (clients.size > 0) broadcastState()
  }, 1000)
}

function handleMessage(ws, msg) {
  const meta = clients.get(ws)
  if (!meta) return

  switch (msg.type) {
    case 'hello': {
      meta.role = msg.role
      meta.judgeId = msg.judgeId !== undefined ? Number(msg.judgeId) : null
      if (meta.role === 'judge' && judgeConnections[meta.judgeId] !== undefined) {
        judgeConnections[meta.judgeId] = true
        activeSocketByJudge[meta.judgeId] = ws
      }
      sendState(ws, meta)
      broadcastState()
      break
    }

    case 'vote': {
      const id = Number(msg.judgeId)
      if (lastVoteIdByJudge[id] !== msg.voteId) {
        lastVoteIdByJudge[id] = msg.voteId
        state.registerVote(id, msg.value)
        // registerVote ya dispara broadcastState() vía state.onChange.
      }
      send(ws, { type: 'ack', voteId: msg.voteId })
      break
    }

    case 'reset': {
      if (meta.role === 'control') state.resetAttempt()
      break
    }

    case 'timer:start': {
      // El control siempre puede arrancarlo; el juez 2 (jefe) tiene su
      // propio botón físico para esto, según CLAUDE.md.
      if (meta.role === 'control' || (meta.role === 'judge' && meta.judgeId === 2)) {
        state.startTimer()
      }
      break
    }

    case 'timer:stop': {
      if (meta.role === 'control') state.stopTimer()
      break
    }

    case 'ping': {
      send(ws, { type: 'pong' })
      break
    }

    default:
      break
  }
}

function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload))
  }
}

function sendState(ws, meta) {
  const payload = state.getStateFor(meta.role, meta.judgeId)
  if (meta.role === 'control') {
    payload.judgeConnections = { ...judgeConnections }
  }
  send(ws, payload)
}

function broadcastState() {
  for (const [ws, meta] of clients) {
    if (meta.role) sendState(ws, meta)
  }
}

module.exports = { attachWebSocketServer }
