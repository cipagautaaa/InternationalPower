'use strict'

;(function () {
  const phaseEl = document.getElementById('phase')
  const votesInEl = document.getElementById('votes-in')
  const connEls = {
    1: document.getElementById('conn-1'),
    2: document.getElementById('conn-2'),
    3: document.getElementById('conn-3'),
  }
  const resetBtn = document.getElementById('reset-btn')
  const timerBtn = document.getElementById('timer-btn')
  const logBody = document.getElementById('log-body')

  const PHASE_LABELS = {
    IDLE: 'En espera',
    VOTING: 'Votando',
    REVEALED: 'Revelado',
  }

  let timerRunning = false

  const client = createWsClient({
    role: 'control',
    onState: (msg) => {
      updatePhase(msg)
      updateConnections(msg.judgeConnections)
      updateTimerButton(msg.timer)
      updateLog(msg.attemptLog)
    },
  })

  function updatePhase(msg) {
    phaseEl.textContent = PHASE_LABELS[msg.phase] || msg.phase
    votesInEl.textContent = msg.phase === 'VOTING' ? '(' + msg.votesIn + ' de 3)' : ''
  }

  function updateConnections(judgeConnections) {
    if (!judgeConnections) return
    for (const id of [1, 2, 3]) {
      const el = connEls[id]
      const connected = judgeConnections[id]
      el.textContent = 'Juez ' + id + ': ' + (connected ? 'conectado' : 'desconectado')
      el.classList.toggle('connected', !!connected)
      el.classList.toggle('disconnected', !connected)
    }
  }

  function updateTimerButton(timer) {
    timerRunning = timer.running
    timerBtn.textContent = timerRunning ? 'Detener cronómetro' : 'Iniciar cronómetro'
  }

  function updateLog(attemptLog) {
    if (!attemptLog) return
    logBody.innerHTML = ''
    for (const entry of attemptLog) {
      const row = document.createElement('tr')
      row.appendChild(cell(formatTime(entry.timestamp)))
      row.appendChild(voteCell(entry.votes[1]))
      row.appendChild(voteCell(entry.votes[2]))
      row.appendChild(voteCell(entry.votes[3]))
      logBody.appendChild(row)
    }
  }

  function cell(text) {
    const td = document.createElement('td')
    td.textContent = text
    return td
  }

  function voteCell(value) {
    const td = document.createElement('td')
    td.textContent = value === 'white' ? 'Blanco' : value === 'red' ? 'Rojo' : '—'
    if (value === 'white' || value === 'red') {
      td.classList.add(value === 'white' ? 'vote-white' : 'vote-red')
    }
    return td
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('es-CO', { hour12: false })
  }

  resetBtn.addEventListener('click', () => {
    client.send({ type: 'reset' })
  })

  timerBtn.addEventListener('click', () => {
    client.send({ type: timerRunning ? 'timer:stop' : 'timer:start' })
  })
})()
