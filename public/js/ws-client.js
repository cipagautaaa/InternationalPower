'use strict'

// Cliente WebSocket compartido por las tres vistas (juez, tv, control):
// reconexión con backoff, heartbeat de ping/pong, y cola de reintento de
// voto hasta recibir el ack correspondiente. No conoce nada de la UI de
// cada vista — solo expone callbacks.

function generateId() {
  // crypto.randomUUID() exige "secure context" (https o localhost). Los
  // celulares se conectan por http plano a la IP de la LAN del evento, así
  // que no podemos depender de él. getRandomValues() sí funciona sin TLS.
  const bytes = new Uint8Array(16)
  if (window.crypto && window.crypto.getRandomValues) {
    window.crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'))
  return (
    hex.slice(0, 4).join('') + '-' +
    hex.slice(4, 6).join('') + '-' +
    hex.slice(6, 8).join('') + '-' +
    hex.slice(8, 10).join('') + '-' +
    hex.slice(10, 16).join('')
  )
}

function createWsClient(options) {
  const role = options.role
  const judgeId = options.judgeId
  const onState = options.onState || function () {}
  const onAck = options.onAck || function () {}
  const onConnectionLost = options.onConnectionLost || function () {}
  const onConnectionRestored = options.onConnectionRestored || function () {}

  const PING_INTERVAL_MS = 2000
  const PONG_TIMEOUT_MS = 5000
  const RECONNECT_MAX_MS = 1000
  const VOTE_RETRY_MS = 500

  let ws = null
  let reconnectDelay = 200
  let lastPongAt = Date.now()
  let connectionLost = false

  // voteId -> { judgeId, value, retryTimer }. Sigue reintentando aunque el
  // socket esté caído; en cuanto reconecta, send() vuelve a funcionar solo.
  const pendingVotes = new Map()

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
    return proto + '//' + location.host
  }

  function connect() {
    ws = new WebSocket(wsUrl())

    ws.addEventListener('open', () => {
      reconnectDelay = 200
      // Optimista: recién abrió, se trata como viva hasta que el vigilante
      // diga lo contrario. Evita un falso "SIN CONEXIÓN" en el instante
      // entre reconectar y recibir el primer pong real.
      lastPongAt = Date.now()
      send({ type: 'hello', role: role, judgeId: judgeId })
      for (const voteId of pendingVotes.keys()) resendVote(voteId)
    })

    ws.addEventListener('message', (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return
      }
      handleMessage(msg)
    })

    ws.addEventListener('close', scheduleReconnect)
    ws.addEventListener('error', () => ws.close())
  }

  function scheduleReconnect() {
    setTimeout(connect, reconnectDelay)
    reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS)
  }

  function handleMessage(msg) {
    if (msg.type === 'pong') {
      lastPongAt = Date.now()
      if (connectionLost) {
        connectionLost = false
        onConnectionRestored()
      }
      return
    }
    if (msg.type === 'ack') {
      const pending = pendingVotes.get(msg.voteId)
      if (pending) {
        clearTimeout(pending.retryTimer)
        pendingVotes.delete(msg.voteId)
      }
      onAck(msg.voteId)
      return
    }
    if (msg.type === 'state') {
      onState(msg)
      return
    }
  }

  function send(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj))
    }
  }

  function resendVote(voteId) {
    const pending = pendingVotes.get(voteId)
    if (!pending) return
    send({ type: 'vote', judgeId: pending.judgeId, value: pending.value, voteId: voteId })
    pending.retryTimer = setTimeout(() => resendVote(voteId), VOTE_RETRY_MS)
  }

  function sendVote(voterJudgeId, value) {
    const voteId = generateId()
    pendingVotes.set(voteId, { judgeId: voterJudgeId, value: value, retryTimer: null })
    resendVote(voteId)
    return voteId
  }

  // El heartbeat corre para siempre, sin importar si el socket está abierto,
  // cerrado o a medio reconectar — es justo mientras se está reconectando
  // que hay que detectar la desconexión y mostrar el banner. Si se atara
  // este vigilante al ciclo open/close del socket, dejaría de vigilar
  // exactamente cuando más se le necesita.
  setInterval(() => send({ type: 'ping' }), PING_INTERVAL_MS)
  setInterval(() => {
    if (Date.now() - lastPongAt > PONG_TIMEOUT_MS && !connectionLost) {
      connectionLost = true
      onConnectionLost()
    }
  }, 500)

  connect()

  return { send, sendVote }
}
