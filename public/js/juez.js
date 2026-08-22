'use strict'

;(function () {
  const params = new URLSearchParams(location.search)
  const judgeId = Number(params.get('id'))

  if (![1, 2, 3].includes(judgeId)) {
    document.body.innerHTML =
      '<p style="color:#fff;font-size:4vh;text-align:center;margin-top:40vh;padding:0 20px">' +
      'URL inválida. Usar /juez?id=1, /juez?id=2 o /juez?id=3.</p>'
    return
  }

  const isChief = judgeId === 2

  const whiteBtn = document.getElementById('btn-white')
  const redBtn = document.getElementById('btn-red')
  const banner = document.getElementById('disconnect-banner')
  const idLabel = document.getElementById('judge-id-label')
  const fullscreenBtn = document.getElementById('fullscreen-btn')
  const timerBtn = document.getElementById('timer-btn')
  const timerBtnLabel = document.getElementById('timer-btn-label')

  idLabel.textContent = 'Juez ' + judgeId + (isChief ? ' (jefe)' : '')
  if (isChief) {
    document.body.classList.add('is-chief')
    timerBtn.hidden = false
  }

  let currentPhase = 'IDLE'
  let confirmedVote = null
  let timerRunning = false

  const client = createWsClient({
    role: 'judge',
    judgeId: judgeId,
    onState: (msg) => {
      currentPhase = msg.phase
      confirmedVote = msg.myVote !== undefined ? msg.myVote : confirmedVote
      updateSelection(confirmedVote)
      if (isChief) updateTimerButton(msg.timer)
    },
    onAck: () => {
      if (navigator.vibrate) navigator.vibrate(80)
    },
    onConnectionLost: () => {
      banner.hidden = false
    },
    onConnectionRestored: () => {
      banner.hidden = true
    },
  })

  function updateSelection(vote) {
    whiteBtn.classList.toggle('selected', vote === 'white')
    redBtn.classList.toggle('selected', vote === 'red')
  }

  function updateTimerButton(timer) {
    timerRunning = timer.running
    timerBtn.classList.toggle('running', timerRunning)
    timerBtnLabel.textContent = timerRunning ? 'Reiniciar cronómetro' : 'Iniciar cronómetro'
  }

  function castVote(value) {
    if (currentPhase === 'REVEALED') return
    if (value === confirmedVote) return // ya registrado, no reenviar de más
    client.sendVote(judgeId, value)
  }

  whiteBtn.addEventListener('click', () => castVote('white'))
  redBtn.addEventListener('click', () => castVote('red'))

  if (isChief) {
    // El mismo botón sirve para arrancar y para reiniciar: mientras el
    // cronómetro corre, 'timer:start' lo vuelve a poner en la duración
    // completa (por ejemplo si se acabó el tiempo o el jefe se equivocó
    // al arrancarlo). El texto cambia según el estado (ver updateTimerButton).
    timerBtn.addEventListener('click', () => client.send({ type: 'timer:start' }))
  }

  fullscreenBtn.addEventListener('click', () => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen().catch(() => {})
    }
  })

  // Wake Lock exige "secure context" (https o localhost). Los celulares se
  // conectan por http plano a la IP de la LAN, así que puede no activarse:
  // probarlo con los celulares reales antes del evento, no asumir que
  // funciona solo porque no lanza error.
  let wakeLock = null
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      console.warn('Wake Lock no disponible (revisar si hace falta HTTPS).')
      return
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen')
    } catch (err) {
      console.warn('No se pudo obtener wake lock:', err)
    }
  }
  requestWakeLock()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock()
  })
})()
