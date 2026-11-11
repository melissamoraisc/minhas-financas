/* graficos.js — gráficos simples em SVG, sem bibliotecas (funciona sem internet). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Graficos = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function curto(n) {
    var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace('.', ',') + 'mi';
    if (a >= 1e3) return s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace('.', ',') + 'mil';
    return s + Math.round(a);
  }
  function escala(min, max) {
    if (min === max) { max = min + 1; }
    var passo = Math.pow(10, Math.floor(Math.log10((max - min) / 4 || 1)));
    [1, 2, 2.5, 5, 10].some(function (m) { if ((max - min) / (passo * m) <= 5) { passo *= m; return true; } return false; });
    return { min: Math.floor(min / passo) * passo, max: Math.ceil(max / passo) * passo, passo: passo };
  }

  /* barras agrupadas: rotulos[], series [{nome, cor, valores[]}] */
  function barras(o) {
    var W = 640, H = 220, mL = 44, mB = 26, mT = 10, n = o.rotulos.length, ns = o.series.length;
    var max = 0; o.series.forEach(function (s) { s.valores.forEach(function (v) { if (v > max) max = v; }); });
    var e = escala(0, max || 1), h = H - mB - mT, w = (W - mL) / n, bw = Math.min(16, (w - 8) / ns);
    var y = function (v) { return mT + h - (v - e.min) / (e.max - e.min) * h; };
    var g = '';
    for (var t = e.min; t <= e.max + 1e-9; t += e.passo) g += '<line x1="' + mL + '" x2="' + W + '" y1="' + y(t) + '" y2="' + y(t) + '" class="gl"/><text x="' + (mL - 6) + '" y="' + (y(t) + 4) + '" class="ga" text-anchor="end">' + curto(t) + '</text>';
    o.rotulos.forEach(function (r, i) {
      var x0 = mL + i * w + (w - bw * ns - 3 * (ns - 1)) / 2;
      o.series.forEach(function (s, j) {
        var v = s.valores[i] || 0, yy = y(Math.max(0, v)), hh = Math.max(0, y(0) - yy);
        g += '<rect x="' + (x0 + j * (bw + 3)) + '" y="' + yy + '" width="' + bw + '" height="' + hh + '" rx="4" fill="' + s.cor + '"' + (o.destaque === i ? '' : ' opacity="' + (o.destaque != null ? .55 : 1) + '"') + '><title>' + esc(s.nome + ' ' + r + ': ' + (o.fmt ? o.fmt(v) : v)) + '</title></rect>';
      });
      g += '<text x="' + (mL + i * w + w / 2) + '" y="' + (H - 8) + '" class="ga" text-anchor="middle">' + esc(r) + '</text>';
      if (o.clique) g += '<rect x="' + (mL + i * w) + '" y="0" width="' + w + '" height="' + H + '" fill="transparent" data-acao="' + o.clique + '" data-i="' + i + '" style="cursor:pointer"/>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="graf" role="img" aria-label="' + esc(o.titulo || 'gráfico') + '">' + g + '</svg>' + legenda(o.series);
  }

  /* linha: pontos [{rotulo, valor, futuro}] — o futuro fica tracejado */
  function linha(o) {
    var W = 640, H = 220, mL = 48, mB = 26, mT = 12, p = o.pontos, n = p.length;
    if (!n) return '';
    var min = Math.min.apply(null, p.map(function (x) { return x.valor; }).concat([0])), max = Math.max.apply(null, p.map(function (x) { return x.valor; }));
    var e = escala(min, max), h = H - mB - mT;
    var X = function (i) { return mL + (n === 1 ? (W - mL) / 2 : i * (W - mL - 8) / (n - 1)); };
    var Y = function (v) { return mT + h - (v - e.min) / (e.max - e.min) * h; };
    var g = '';
    for (var t = e.min; t <= e.max + 1e-9; t += e.passo) g += '<line x1="' + mL + '" x2="' + W + '" y1="' + Y(t) + '" y2="' + Y(t) + '" class="gl' + (Math.abs(t) < 1e-9 ? ' zero' : '') + '"/><text x="' + (mL - 6) + '" y="' + (Y(t) + 4) + '" class="ga" text-anchor="end">' + curto(t) + '</text>';
    var passado = '', futuro = '', area = '';
    p.forEach(function (pt, i) {
      var c = X(i).toFixed(1) + ',' + Y(pt.valor).toFixed(1);
      if (!pt.futuro) passado += (passado ? ' L' : 'M') + c;
      if (pt.futuro || (p[i + 1] && p[i + 1].futuro)) futuro += (futuro ? ' L' : 'M') + c;
    });
    var ultimo = -1; p.forEach(function (pt, i) { if (!pt.futuro) ultimo = i; });
    if (ultimo > 0) area = passado + ' L' + X(ultimo) + ',' + Y(Math.max(e.min, 0)) + ' L' + X(0) + ',' + Y(Math.max(e.min, 0)) + 'Z';
    g += '<path d="' + area + '" fill="' + o.cor + '" opacity=".10"/>';
    g += '<path d="' + passado + '" fill="none" stroke="' + o.cor + '" stroke-width="2.5" stroke-linejoin="round"/>';
    g += '<path d="' + futuro + '" fill="none" stroke="' + o.cor + '" stroke-width="2.5" stroke-dasharray="6 5" opacity=".8"/>';
    var cada = Math.ceil(n / 7);
    p.forEach(function (pt, i) {
      if (i % cada === 0 || i === n - 1) g += '<text x="' + X(i) + '" y="' + (H - 8) + '" class="ga" text-anchor="middle">' + esc(pt.rotulo) + '</text>';
      if (pt.marcar) g += '<circle cx="' + X(i) + '" cy="' + Y(pt.valor) + '" r="4.5" fill="' + o.cor + '" stroke="var(--surface)" stroke-width="2"><title>' + esc(pt.rotulo + ': ' + (o.fmt ? o.fmt(pt.valor) : pt.valor)) + '</title></circle>';
    });
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" class="graf" role="img" aria-label="' + esc(o.titulo || 'gráfico') + '">' + g + '</svg>';
  }

  /* rosca: itens [{nome, valor, cor}] */
  function rosca(o) {
    var tot = 0; o.itens.forEach(function (i) { tot += Math.max(0, i.valor); });
    if (!tot) return '';
    var R0 = 70, r = 46, cx = 90, cy = 90, a = -Math.PI / 2, g = '';
    o.itens.forEach(function (it) {
      var v = Math.max(0, it.valor) / tot; if (!v) return;
      var a2 = a + v * Math.PI * 2 - (v === 1 ? 0.0001 : 0), lg = v > .5 ? 1 : 0;
      var p = function (rr, ang) { return (cx + rr * Math.cos(ang)).toFixed(2) + ',' + (cy + rr * Math.sin(ang)).toFixed(2); };
      g += '<path d="M' + p(R0, a) + ' A' + R0 + ',' + R0 + ' 0 ' + lg + ' 1 ' + p(R0, a2) + ' L' + p(r, a2) + ' A' + r + ',' + r + ' 0 ' + lg + ' 0 ' + p(r, a) + 'Z" fill="' + it.cor + '"><title>' + esc(it.nome) + '</title></path>';
      a = a2;
    });
    if (o.centro) g += '<text x="90" y="86" text-anchor="middle" class="gc1">' + esc(o.centro[0]) + '</text><text x="90" y="104" text-anchor="middle" class="gc2">' + esc(o.centro[1]) + '</text>';
    return '<svg viewBox="0 0 180 180" class="rosca" role="img" aria-label="' + esc(o.titulo || '') + '">' + g + '</svg>';
  }
  function legenda(series) {
    if (series.length < 2) return '';
    return '<div class="leg">' + series.map(function (s) { return '<span><i style="background:' + s.cor + '"></i>' + esc(s.nome) + '</span>'; }).join('') + '</div>';
  }
  /* barra dividida horizontal: itens [{nome, valor, cor}] */
  function barraDividida(itens) {
    var tot = 0; itens.forEach(function (i) { tot += Math.max(0, i.valor); });
    if (!tot) return '<div class="bdiv vazia"></div>';
    return '<div class="bdiv">' + itens.map(function (i) { var w = Math.max(0, i.valor) / tot * 100; return w > 0 ? '<span style="width:' + w.toFixed(2) + '%;background:' + i.cor + '" title="' + esc(i.nome) + '"></span>' : ''; }).join('') + '</div>';
  }
  return { barras: barras, linha: linha, rosca: rosca, barraDividida: barraDividida, curto: curto };
});
