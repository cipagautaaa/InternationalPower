'use strict'

// Lógica pura de la máquina de estados. No sabe nada de WebSocket, HTTP,
// ni de quién le está preguntando por transporte: eso lo resuelve el
// adaptador (lib/ws-adapter.js) llamando a estas funciones.

const EventEmitter = require('node:events')
const config = require('../config.json')

const JUDGE_IDS = [1, 2, 3]

// El adaptador se suscribe a esto para retransmitir. Existe sobre todo por
// el auto-reset: ese timeout corre adentro de este módulo (ver
// registerVote) y nadie desde afuera lo dispara, así que sin este evento
// el adaptador nunca se enteraría de que el estado cambió a IDLE solo.
const emitter = new EventEmitter()
function notifyChange() {
  emitter.emit('change')
}

const PHASE = {
  IDLE: 'IDLE',
  VOTING: 'VOTING',
  REVEALED: 'REVEALED',
}

function emptyVotes() {
  return { 1: null, 2: null, 3: null }
}

const state = {
  phase: PHASE.IDLE,
  votes: emptyVotes(),
  revealedAt: null,
  attemptLog: [], // últimos intentos revelados: [{ votes, timestamp }, ...]
  timer: {
    running: false,
    startedAt: null,
    durationMs: config.timerSeconds * 1000,
    // Valor en el que quedó congelado el cronómetro al detenerse (manual o
    // por revelado). null significa "sin congelar": mostrar la duración
    // completa, que es el estado tras un reset.
    frozenRemainingMs: null,
  },
}

let autoResetHandle = null

function countVotesIn() {
  return JUDGE_IDS.reduce((n, id) => n + (state.votes[id] ? 1 : 0), 0)
}

function clearAutoReset() {
  if (autoResetHandle) {
    clearTimeout(autoResetHandle)
    autoResetHandle = null
  }
}

function registerVote(judgeId, value) {
  const id = Number(judgeId)
  if (!JUDGE_IDS.includes(id)) return
  if (value !== 'white' && value !== 'red') return

  // Los votos quedan congelados una vez revelados: ni siquiera el propio
  // juez puede cambiarlo después de REVEALED.
  if (state.phase === PHASE.REVEALED) return

  state.votes[id] = value

  if (countVotesIn() === 3) {
    state.phase = PHASE.REVEALED
    state.revealedAt = Date.now()
    // El cronómetro se detiene en cuanto hay veredicto de los tres jueces:
    // congela el tiempo que llevaba, no lo reinicia (eso pasa en resetAttempt).
    freezeTimer()
    clearAutoReset()
    autoResetHandle = setTimeout(resetAttempt, config.autoResetSeconds * 1000)
  } else {
    state.phase = PHASE.VOTING
  }

  notifyChange()
}

function resetAttempt() {
  clearAutoReset()

  if (state.phase === PHASE.REVEALED) {
    state.attemptLog.unshift({ votes: { ...state.votes }, timestamp: Date.now() })
    state.attemptLog = state.attemptLog.slice(0, 10)
  }

  state.phase = PHASE.IDLE
  state.votes = emptyVotes()
  state.revealedAt = null
  // El reset (automático a los 8s o manual desde control) también reinicia
  // el cronómetro a la duración completa, junto con las luces.
  state.timer.running = false
  state.timer.startedAt = null
  state.timer.frozenRemainingMs = null

  notifyChange()
}

function startTimer() {
  state.timer.running = true
  state.timer.startedAt = Date.now()
  state.timer.frozenRemainingMs = null
  notifyChange()
}

function stopTimer() {
  freezeTimer()
  notifyChange()
}

// Vuelve el cronómetro a la duración completa sin arrancarlo. Para eso ya
// está el botón de "iniciar": este es el botón de "reiniciar" del jefe,
// para el caso en que el tiempo se acabó o se arrancó por error.
function resetTimer() {
  state.timer.running = false
  state.timer.startedAt = null
  state.timer.frozenRemainingMs = null
  notifyChange()
}

// Congela el cronómetro en el tiempo restante actual, sin reiniciarlo.
// Usado tanto por el botón manual de "detener" como al completarse el
// revelado con el tercer voto.
function freezeTimer() {
  state.timer.frozenRemainingMs = getTimerRemainingMs()
  state.timer.running = false
  state.timer.startedAt = null
}

function getTimerRemainingMs() {
  if (state.timer.running && state.timer.startedAt) {
    const elapsedMs = Date.now() - state.timer.startedAt
    return Math.max(0, state.timer.durationMs - elapsedMs)
  }
  if (state.timer.frozenRemainingMs !== null) {
    return state.timer.frozenRemainingMs
  }
  return state.timer.durationMs
}

// Filtrado por rol — el punto más delicado de todo el sistema. Un juez o
// el display jamás reciben el valor de un voto ajeno mientras se está
// votando; solo al llegar a REVEALED se abren los tres valores a la vez.
// Ocultar esto en el cliente no cuenta: si el payload lo trae, las
// DevTools lo revelan. Por eso el corte vive aquí, no en el HTML/JS.
function getStateFor(role, judgeId) {
  const base = {
    type: 'state',
    phase: state.phase,
    votesIn: countVotesIn(),
    timer: {
      running: state.timer.running,
      remainingMs: getTimerRemainingMs(),
    },
  }

  if (state.phase === PHASE.REVEALED) {
    base.votes = { ...state.votes }
    base.attemptLog = state.attemptLog
    return base
  }

  if (role === 'judge') {
    const id = Number(judgeId)
    base.myVote = JUDGE_IDS.includes(id) ? state.votes[id] : null
    return base
  }

  if (role === 'control') {
    base.attemptLog = state.attemptLog
    return base
  }

  // role === 'display', en IDLE o VOTING: solo el conteo, nunca valores.
  return base
}

function onChange(listener) {
  emitter.on('change', listener)
}

module.exports = {
  PHASE,
  JUDGE_IDS,
  registerVote,
  resetAttempt,
  startTimer,
  stopTimer,
  resetTimer,
  getStateFor,
  onChange,
}
