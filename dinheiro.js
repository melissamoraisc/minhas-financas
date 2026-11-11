/* dinheiro.js — ler e mostrar valores em reais.
   "1.500" = 1500 · "1.500,00" = 1500 · "25,90" = 25,9 · "10.5" = 10,5 · formatos estranhos = inválido (null). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Dinheiro = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function ler(txt) {
    if (typeof txt === 'number') return isFinite(txt) ? arred(txt) : null;
    var s = String(txt == null ? '' : txt).trim().replace(/^R\$\s*/i, '').replace(/\s+/g, '');
    if (!s) return null;
    var neg = false;
    if (s[0] === '-') { neg = true; s = s.slice(1); }
    if (!/^[\d.,]+$/.test(s)) return null;
    var temV = s.indexOf(',') >= 0, temP = s.indexOf('.') >= 0, n;
    if (temV && temP) {
      // 1.234,56 — pontos de milhar e vírgula decimal
      if (!/^\d{1,3}(\.\d{3})+,\d{1,2}$/.test(s)) return null;
      n = parseFloat(s.replace(/\./g, '').replace(',', '.'));
    } else if (temV) {
      if (!/^\d+,\d{1,2}$/.test(s)) return null; // 25,90 ou 25,9
      n = parseFloat(s.replace(',', '.'));
    } else if (temP) {
      if (/^\d{1,3}(\.\d{3})+$/.test(s)) n = parseFloat(s.replace(/\./g, '')); // 1.500 = mil e quinhentos
      else if (/^\d+\.\d{1,2}$/.test(s)) n = parseFloat(s);                    // 10.5 = dez e cinquenta
      else return null;
    } else {
      if (!/^\d+$/.test(s)) return null;
      n = parseFloat(s);
    }
    if (!isFinite(n) || n > 1e11) return null;
    return arred(neg ? -n : n);
  }

  function arred(n) { return Math.round((n + (n >= 0 ? 1e-9 : -1e-9)) * 100) / 100; }

  function fmt(n, semSimbolo) {
    n = arred(+n || 0);
    var neg = n < 0, a = Math.abs(n);
    var inteiro = Math.floor(a + 1e-9), cent = Math.round((a - inteiro) * 100);
    if (cent === 100) { inteiro += 1; cent = 0; }
    var s = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ',' + (cent < 10 ? '0' : '') + cent;
    return (neg ? '-' : '') + (semSimbolo ? '' : 'R$ ') + s;
  }
  /* separa para mostrar centavos menores: { sinal, reais, centavos } */
  function partes(n) {
    var t = fmt(n, true), neg = t[0] === '-';
    if (neg) t = t.slice(1);
    var i = t.lastIndexOf(',');
    return { sinal: neg ? '-' : '', reais: t.slice(0, i), centavos: t.slice(i + 1) };
  }
  /* divide um valor em N partes; a última absorve o arredondamento */
  function dividir(total, n) {
    var cents = Math.round(total * 100), base = Math.floor(cents / n), out = [];
    for (var i = 0; i < n; i++) out.push(base / 100);
    out[n - 1] = (cents - base * (n - 1)) / 100;
    return out;
  }
  function soma(lista) { return arred(lista.reduce(function (a, b) { return a + (+b || 0); }, 0)); }
  function pct(n) { return (Math.round(n * 10) / 10).toString().replace('.', ',') + '%'; }

  return { ler: ler, fmt: fmt, partes: partes, dividir: dividir, arred: arred, soma: soma, pct: pct };
});
