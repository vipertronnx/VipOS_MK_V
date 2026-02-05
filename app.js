// Express App + Socket.IO inits
const express = require('express')
const app = express();
require('dotenv').config()

const http = require('http')
const server = http.createServer(app)
const { Server } = require("socket.io")
const io = new Server(server)

const cors = require('cors')
const favicon = require('serve-favicon')
const path = require('path')

// OBS init
const { obs } = require('./modules/obs');

// Chat Client inits
const chat = require('./modules/chat')(io);

/**
 * Setup static directory
 * and rendering engine
 *
 */
app.use(express.static('./public'))
app.set("view engine","ejs")
app.use(cors())
app.use(favicon(path.join(__dirname, '/public/assets/img/favicon.ico')))


/**
 * Home Page
 *
 */
app.get('/', (req, res) => {
  res.render('index.ejs')
})


/**
 * Overlays
 *
 */
app.get('/overlay/venom-coin',(req, res) => {
  res.render('overlays/venom-coin.ejs')
})



/**
 * API Endpoints
 *
 */

// app.post('/api/v1/text', express.json(), (req, res) => {
//   io.emit('text-alert', { message: req.body.msg });
//   res.sendStatus(200);
// })

// app.post('/api/v1/bg-alert', express.json(), (req, res) => {
//   io.emit('bg-alert');
//   res.sendStatus(200);
// })



/**
 * 404 / All
 *
 */
app.all('*', (req, res) => {
  res.status(404).render('404.ejs')
})


/**
 * Listen on port
 *
 */
server.listen(process.env.PORT, async () => {
  console.log(`server is listening on port ${process.env.PORT}....`)
})
