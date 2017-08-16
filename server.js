var http = require('http')
var path = require('path')
var fs = require('fs')
var url = require('url')
var pino = require('pino')
var get = require('simple-get')
var parser = require('html2hscript')
var h = require('hyperscript')
var moment = require('moment')
var logger = pino()
var config = require('./config.json').server
var [ PORT = config.port, HOST = config.host ] = process.argv.slice(2)
var DIRECTORY = 'public'
var tweets = {}
var root = path.resolve(__dirname, DIRECTORY)

const routes = {
  ['/']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(path.join(root, '/index.html')).pipe(res)
  },
  ['/hoco']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(path.join(root, '/hoco/index.html')).pipe(res)
  },
  ['/hoco/sss.jpg']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'image/jpg' })
    fs.createReadStream(path.join(root, '/hoco/sss.jpg')).pipe(res)
  },
  ['/bundle.js']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/javascript' })
    fs.createReadStream(path.join(root, '/bundle.js')).pipe(res)
  },
  ['/bundle.css']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/css' })
    fs.createReadStream(path.join(root, '/bundle.css')).pipe(res)
  },
  ['/logo-min.png']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'image/png' })
    fs.createReadStream(path.join(root, '/logo-min.png')).pipe(res)
  },
  ['/globe.svg']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    fs.createReadStream(path.join(root, '/globe.svg')).pipe(res)
  },
  ['/lightning.svg']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    fs.createReadStream(path.join(root, '/lightning.svg')).pipe(res)
  },
  ['/twitter.svg']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'image/svg+xml' })
    fs.createReadStream(path.join(root, '/twitter.svg')).pipe(res)
  },
  ['/tweets']: function(req, res) {
    var str = ''
    try {
      str = JSON.stringify(tweets)
    } catch (e) {
      if (e) return logger.error(e)
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.write(str)
    res.end()
  },
  ['404']: function(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    fs.createReadStream(path.join(root, '/index.html')).pipe(res)
  }
}

var server = http.createServer(function handler(req, res) {
  const { pathname } = url.parse(req.url)
  logger.info(req.url)
  if (!routes[pathname]) return routes[404](req, res)
  routes[pathname](req, res)
}).listen({ port: PORT, hostname: HOST }, () => logger.info(`listening on ${HOST}:${PORT}`))

function collectTweets(node, tweets) {
  if (node.classList && node.classList.contains('tweet')) {
    var id = node.dataset.tweetId
    if (id) {
      tweets[id] = { id }
      disectTweet(node, id, tweets)
    }
  }
  if (node.childNodes) {
    node.childNodes.forEach((node) => {
      collectTweets(node, tweets)
    })
  }
}

function gatherText(node, stack) {
  if (node.value) {
    stack.push({ type: 'text', value: node.value })
  } else if (node.tagName === 'a') {
    var links = {}
    links.href = node.attributes.href
    links.title = node.attributes.title
    links.expandedUrl = node.dataset.expandedUrl
    var mystack = []
    if (node.childNodes) node.childNodes.forEach((n) => gatherText(n, mystack))
    stack.push({ type: 'link', links, stack: mystack })
  } else if (node.childNodes) {
    node.childNodes.forEach((node) => gatherText(node, stack))
  }
  return stack
}

function getTS(node) {
  if (node.classList && node.classList.contains('tweet-timestamp')) {
    return node.attributes.title
  } else {
    if (!node.childNodes) return false
    return node.childNodes.reduce((last, next) => {
      if (last) return last
      var ts = getTS(next)
      return ts
    }, false)
  }
}

function disectTweet(node, id, tweets) {
  if (node.classList && node.classList.contains('stream-item-header')) {
    var ts = getTS(node)
    tweets[id].ts = ts
  }
  if (node.classList && node.classList.contains('tweet-text')) {
    var stack = gatherText(node, [])
    tweets[id].stack = stack
  }
  if (node.childNodes) {
    node.childNodes.forEach((node) => {
      disectTweet(node, id, tweets)
    })
  }
}

function fetchTweets(cache, cb) {
  get.concat(`https://twitter.com/${config.twitterScraping.account}`, (err, _, data) => {
    if (err) return logger.error({ err })
    parser(data.toString(), function(err, hscript) {
      if (err) return logger.error({ err })
      var lift = new Function('h', `return ${hscript.slice(6, hscript.length - 6)}`)
      collectTweets(lift(h), cache)
      if (cb) return cb(null, cache)
    })
  })
}


var tsFormat = "h:m a DD MMM YYYY"

setInterval(function () {
  fetchTweets({}, (_, cache) => {
    var ids = Object.getOwnPropertyNames(cache)
    // format ts
    var havets = ids.filter((id) => Boolean(cache[id].ts))

    havets.forEach(function (id) {
      var ts = cache[id].ts.split('-').map((s) => s.trim()).join(' ')
      if (!ts) return
      var m = moment(ts, tsFormat)
      cache[id].ts = {
        raw: new Date(m).valueOf(),
        formatted: m.format("M[.]D[.]YYYY")
      }
    })

    tweets = havets.reduce((obj, id) => {
      obj[id] = cache[id]
      return obj
    }, {})
  })
}, config.twitterScraping.pollingIntervalSeconds * 1000)
