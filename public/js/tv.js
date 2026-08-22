'use strict'

;(function () {
  // Orden de los círculos de izquierda a derecha = orden de los jueces
  // desde la perspectiva del público (atleta y graderías). Verificar en
  // sitio antes del evento que juez 1 quede a la izquierda visto desde ahí.
  const lightEls = {
    1: document.getElementById('light-1'),
    2: document.getElementById('light-2'),
    3: document.getElementById('light-3'),
  }
  const timerEl = document.getElementById('timer')
  const votesCountEl = document.getElementById('votes-count')

  createWsClient({
    role: 'display',
    onState: (msg) => {
      updateLights(msg)
      syncTimer(msg.timer)
      updateVotesCount(msg)
    },
  })

  function updateLights(msg) {
    for (const id of [1, 2, 3]) {
      const el = lightEls[id]
      el.classList.remove('white', 'red')
      if (msg.phase === 'REVEALED' && msg.votes) {
        const value = msg.votes[id]
        if (value === 'white') el.classList.add('white')
        if (value === 'red') el.classList.add('red')
      }
    }
  }

  // El servidor manda el estado exacto (running + remainingMs) en cada
  // cambio y además cada 1s por el tick del heartbeat. Para que las
  // centésimas se vean fluidas sin necesidad de que el servidor transmita
  // a 60Hz, este cliente interpola localmente entre esos mensajes con
  // requestAnimationFrame, y cada mensaje nuevo re-sincroniza el punto de
  // partida (así se autocorrige cualquier deriva del reloj local).
  let syncRemainingMs = 60000
  let syncAt = Date.now()
  let timerRunning = false

  function syncTimer(timer) {
    syncRemainingMs = timer.remainingMs
    syncAt = Date.now()
    timerRunning = timer.running
  }

  function formatTimer(ms) {
    const totalCentis = Math.floor(ms / 10)
    const seconds = Math.floor(totalCentis / 100)
    const centis = totalCentis % 100
    return String(seconds) + '.' + String(centis).padStart(2, '0')
  }

  function renderTimer() {
    let ms = syncRemainingMs
    if (timerRunning) {
      ms = Math.max(0, syncRemainingMs - (Date.now() - syncAt))
    }
    timerEl.textContent = formatTimer(ms)
    timerEl.classList.toggle('low', ms < 10000)
    requestAnimationFrame(renderTimer)
  }
  requestAnimationFrame(renderTimer)

  function updateVotesCount(msg) {
    if (msg.phase === 'VOTING') {
      votesCountEl.textContent = msg.votesIn + ' de 3'
      votesCountEl.hidden = false
    } else {
      votesCountEl.hidden = true
    }
  }
})()
