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
      updateTimer(msg.timer)
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

  function updateTimer(timer) {
    timerEl.textContent = String(timer.secondsRemaining)
    timerEl.classList.toggle('low', timer.secondsRemaining < 10)
  }

  function updateVotesCount(msg) {
    if (msg.phase === 'VOTING') {
      votesCountEl.textContent = msg.votesIn + ' de 3'
      votesCountEl.hidden = false
    } else {
      votesCountEl.hidden = true
    }
  }
})()
