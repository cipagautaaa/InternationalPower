'use strict'

const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const express = require('express')
const { WebSocketServer } = require('ws')

const config = require('./config.json')
const { attachWebSocketServer } = require('./lib/ws-adapter.js')

const app = express()
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }))

const server = http.createServer(app)
const wss = new WebSocketServer({ server })
attachWebSocketServer(wss)

server.listen(config.port, () => {
  printUrls()
})

// Adaptadores que nunca son la red del evento: switches virtuales de
// Hyper-V/Docker/WSL, VPNs, etc. Imprimirlos solo confunde a quien está
// dictando la URL a los celulares — ese adaptador no es alcanzable desde
// afuera del portátil.
const VIRTUAL_INTERFACE_PATTERN = /virtual|vethernet|hyper-v|wsl|docker|vmware|virtualbox|tailscale|zerotier|loopback/i

function localIPv4Addresses() {
  const interfaces = os.networkInterfaces()
  const addresses = []
  for (const name of Object.keys(interfaces)) {
    if (VIRTUAL_INTERFACE_PATTERN.test(name)) continue
    for (const net of interfaces[name]) {
      // 169.254.x.x es link-local: la asigna Windows cuando no hay DHCP,
      // nunca es la IP real de la red a la que se conectan los celulares.
      if (net.family === 'IPv4' && !net.internal && !net.address.startsWith('169.254.')) {
        addresses.push(net.address)
      }
    }
  }
  return addresses
}

function printUrls() {
  const hosts = localIPv4Addresses()
  if (hosts.length === 0) hosts.push('127.0.0.1')

  console.log(`\nServidor de luces escuchando en el puerto ${config.port}\n`)
  for (const host of hosts) {
    const base = `http://${host}:${config.port}`
    console.log(`  Juez 1 (izquierdo): ${base}/juez?id=1`)
    console.log(`  Juez 2 (jefe):      ${base}/juez?id=2`)
    console.log(`  Juez 3 (derecho):   ${base}/juez?id=3`)
    console.log(`  TV:                 ${base}/tv`)
    console.log(`  Control:            ${base}/control`)
    console.log('')
  }
}
