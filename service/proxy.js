var http = require('http');
var https = require('https');
var url = require('url');

var server = null;

function getCandidateUrls(rawPortal, search) {
  var clean = (rawPortal || '').trim().replace(/\/+$/, '');
  if (clean.indexOf('http://') !== 0 && clean.indexOf('https://') !== 0) {
    clean = 'http://' + clean;
  }
  var qs = search || '';
  if (clean.indexOf('.php') !== -1) {
    return [clean + qs];
  }
  var base = clean
    .replace(/\/stalker_portal\/c$/i, '')
    .replace(/\/stalker_portal$/i, '')
    .replace(/\/c$/i, '');

  return [
    base + '/portal.php' + qs,
    base + '/stalker_portal/server/load.php' + qs,
    base + '/server/load.php' + qs
  ];
}

function getReferer(rawPortal) {
  var clean = (rawPortal || '').trim().replace(/\/+$/, '');
  if (clean.indexOf('http://') !== 0 && clean.indexOf('https://') !== 0) {
    clean = 'http://' + clean;
  }
  var base = clean.replace(/\/(portal|load)\.php.*$/i, '').replace(/\/server$/i, '');
  if (base.slice(-2) !== '/c') {
    base += '/c/';
  } else {
    base += '/';
  }
  return base;
}

function requestWithFallback(candidates, idx, headers, redirectsLeft, callback) {
  if (idx >= candidates.length) {
    callback(new Error('All portal endpoints returned empty/invalid JSON'));
    return;
  }

  var target = url.parse(candidates[idx]);
  var isHttps = target.protocol === 'https:';
  var client = isHttps ? https : http;

  var reqHeaders = Object.assign({}, headers, {
    Host: target.host
  });

  var options = {
    hostname: target.hostname,
    port: target.port || (isHttps ? 443 : 80),
    path: target.path,
    method: 'GET',
    headers: reqHeaders,
    rejectUnauthorized: false,
    timeout: 8000
  };

  var proxyReq = client.request(options, function(proxyRes) {
    var status = proxyRes.statusCode;

    if ((status === 301 || status === 302 || status === 303 || status === 307 || status === 308) && proxyRes.headers.location && redirectsLeft > 0) {
      var nextUrl = url.resolve(candidates[idx], proxyRes.headers.location);
      var redirectedList = candidates.slice();
      redirectedList[idx] = nextUrl;
      requestWithFallback(redirectedList, idx, headers, redirectsLeft - 1, callback);
      return;
    }

    var body = '';
    proxyRes.on('data', function(chunk) {
      body += chunk;
    });

    proxyRes.on('end', function() {
      var trimmed = (body || '').trim();
      if (status >= 200 && status < 300 && trimmed.length > 0) {
        try {
          JSON.parse(trimmed);
          callback(null, trimmed);
          return;
        } catch (e) {}
      }
      requestWithFallback(candidates, idx + 1, headers, 3, callback);
    });
  });

  proxyReq.on('error', function() {
    requestWithFallback(candidates, idx + 1, headers, 3, callback);
  });

  proxyReq.on('timeout', function() {
    proxyReq.abort();
  });

  proxyReq.end();
}

function startProxyServer() {
  if (server) {
    return;
  }

  server = http.createServer(function(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    var rawPortal = req.headers['x-stalker-portal'];
    var mac = req.headers['x-stalker-mac'];
    var token = req.headers['x-stalker-token'] || '';

    if (!rawPortal || !mac) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing Portal URL or MAC' }));
      return;
    }

    var parsedReq = url.parse(req.url);
    var candidates = getCandidateUrls(rawPortal, parsedReq.search);
    var cleanMac = mac.trim().toUpperCase();

    var headers = {
      'User-Agent': 'Mozilla/5.0 (QtEmbedded; U; Linux; C) AppleWebKit/533.3 (KHTML, like Gecko) MAG200 stbapp ver: 2 rev: 250 Safari/533.3',
      'X-User-Agent': 'Model: MAG250; Link: WiFi',
      'Referer': getReferer(rawPortal),
      'Accept': '*/*',
      'Cookie': 'mac=' + cleanMac + '; stb_lang=en; timezone=UTC' + (token ? '; token=' + token : '')
    };
    if (token) {
      headers.Authorization = 'Bearer ' + token;
    }

    requestWithFallback(candidates, 0, headers, 3, function(err, body) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (err) {
        res.end(JSON.stringify({ error: err.message }));
        return;
      }
      res.end(body);
    });
  });

  server.listen(3000, '127.0.0.1');
}

module.exports.onStart = startProxyServer;
module.exports.onRequest = startProxyServer;
module.exports.onExit = function() {
  if (server) {
    server.close();
    server = null;
  }
};