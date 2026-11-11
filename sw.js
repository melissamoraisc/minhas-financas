/* funciona sem internet: guarda os arquivos do app; os dados vêm do cofre */
var VERSAO = 'mf-08dd273a';
var ARQS = ["./", "index.html", "estilo.css", "regras.js", "dinheiro.js", "calculos.js", "graficos.js", "relatorio-pdf.js", "app.js", "manifest.webmanifest", "icone-180.png", "icone-192.png", "icone-512.png", "icone.svg"];
self.addEventListener('install', function (e) { e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(ARQS); }).then(function () { return self.skipWaiting(); })); });
self.addEventListener('activate', function (e) { e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== VERSAO; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); })); });
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return; // GitHub (cofre) e bibliotecas: direto pela internet
  e.respondWith(fetch(e.request).then(function (r) { var c = r.clone(); caches.open(VERSAO).then(function (cc) { cc.put(e.request, c); }); return r; }).catch(function () { return caches.match(e.request).then(function (r) { return r || caches.match('index.html'); }); }));
});
