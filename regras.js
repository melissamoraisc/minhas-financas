/* regras.js — datas, dias úteis, feriados bancários e 5º dia útil.
   Funções puras: funcionam no navegador (window.Regras) e no Node (require). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.Regras = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function pad(n) { return (n < 10 ? '0' : '') + n; }

  /* ---------- datas no formato AAAA-MM-DD ---------- */
  function partes(d) { return [+d.slice(0, 4), +d.slice(5, 7), +d.slice(8, 10)]; }
  function montar(a, m, d) { return a + '-' + pad(m) + '-' + pad(d); }
  function valida(d) {
    if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    var p = partes(d);
    return p[1] >= 1 && p[1] <= 12 && p[2] >= 1 && p[2] <= ultimoDia(p[0], p[1]);
  }
  function ultimoDia(a, m) { return new Date(Date.UTC(a, m, 0)).getUTCDate(); }
  function paraUTC(d) { var p = partes(d); return Date.UTC(p[0], p[1] - 1, p[2]); }
  function deUTC(ms) { var x = new Date(ms); return montar(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate()); }
  function addDias(d, n) { return deUTC(paraUTC(d) + n * 86400000); }
  function diffDias(a, b) { return Math.round((paraUTC(b) - paraUTC(a)) / 86400000); }
  function diaSemana(d) { return new Date(paraUTC(d)).getUTCDay(); } // 0 = domingo
  function hoje(agora) {
    var x = agora || new Date();
    return montar(x.getFullYear(), x.getMonth() + 1, x.getDate());
  }

  /* mês no formato AAAA-MM */
  function mesDe(d) { return d.slice(0, 7); }
  function addMes(mes, n) {
    var a = +mes.slice(0, 4), m = +mes.slice(5, 7) - 1 + n;
    a += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return a + '-' + pad(m + 1);
  }
  function diffMeses(a, b) { // quantos meses de a até b
    return (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  }
  /* soma meses numa data, ajustando para o último dia em meses curtos */
  function addMeses(d, n, diaDesejado) {
    var p = partes(d), mes = addMes(d.slice(0, 7), n);
    var a = +mes.slice(0, 4), m = +mes.slice(5, 7);
    var dia = Math.min(diaDesejado || p[2], ultimoDia(a, m));
    return montar(a, m, dia);
  }
  function dataNoMes(mes, dia) {
    var a = +mes.slice(0, 4), m = +mes.slice(5, 7);
    return montar(a, m, Math.min(dia, ultimoDia(a, m)));
  }

  /* ---------- feriados ---------- */
  function pascoa(ano) { // algoritmo de Meeus/Jones/Butcher
    var a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4,
      f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30,
      i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7,
      m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31),
      dia = ((h + l - 7 * m + 114) % 31) + 1;
    return montar(ano, mes, dia);
  }
  var NACIONAIS = [
    ['01-01', 'Confraternização Universal'], ['04-21', 'Tiradentes'], ['05-01', 'Dia do Trabalho'],
    ['09-07', 'Independência'], ['10-12', 'Nossa Senhora Aparecida'], ['11-02', 'Finados'],
    ['11-15', 'Proclamação da República'], ['11-20', 'Consciência Negra'], ['12-25', 'Natal']
  ];
  /* cal = { feriados: [{data:'MM-DD' ou 'AAAA-MM-DD', nome}], carnaval: bool, corpus: bool } */
  function feriadosDoAno(ano, cal) {
    cal = cal || {};
    var lista = {};
    NACIONAIS.forEach(function (f) { lista[ano + '-' + f[0]] = f[1]; });
    var p = pascoa(ano);
    lista[addDias(p, -2)] = 'Sexta-feira da Paixão';
    if (cal.carnaval) { lista[addDias(p, -48)] = 'Carnaval (segunda)'; lista[addDias(p, -47)] = 'Carnaval (terça)'; }
    if (cal.corpus) lista[addDias(p, 60)] = 'Corpus Christi';
    (cal.feriados || []).forEach(function (f) {
      if (!f || !f.data) return;
      if (/^\d{2}-\d{2}$/.test(f.data)) lista[ano + '-' + f.data] = f.nome || 'Feriado';
      else if (f.data.slice(0, 4) === String(ano)) lista[f.data] = f.nome || 'Feriado';
    });
    return lista;
  }
  var cacheFer = {};
  function chaveCal(cal) { return JSON.stringify(cal || {}); }
  function nomeFeriado(d, cal) {
    var k = d.slice(0, 4) + '|' + chaveCal(cal);
    if (!cacheFer[k]) cacheFer[k] = feriadosDoAno(+d.slice(0, 4), cal);
    return cacheFer[k][d] || null;
  }
  function limparCache() { cacheFer = {}; }

  /* dia útil bancário: não é sábado, domingo nem feriado */
  function ehDiaUtil(d, cal, sabadoConta) {
    var s = diaSemana(d);
    if (s === 0) return false;
    if (s === 6 && !sabadoConta) return false;
    return !nomeFeriado(d, cal);
  }
  function proximoDiaUtil(d, cal) { // o próprio dia, se já for útil
    var x = d, n = 0;
    while (!ehDiaUtil(x, cal) && n++ < 30) x = addDias(x, 1);
    return x;
  }
  /* n-ésimo dia útil do mês (salário no 5º dia útil) */
  function enesimoDiaUtil(mes, n, cal, sabadoConta) {
    var d = mes + '-01', cont = 0;
    for (var i = 0; i < 40; i++) {
      if (ehDiaUtil(d, cal, sabadoConta)) { cont++; if (cont === n) return d; }
      d = addDias(d, 1);
    }
    return null;
  }
  function quintoDiaUtil(mes, cal, sabadoConta) { return enesimoDiaUtil(mes, 5, cal, sabadoConta); }

  var DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  var MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  var MESES_C = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  function fmtData(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : ''; }
  function fmtDiaMes(d) { return d ? d.slice(8, 10) + '/' + d.slice(5, 7) : ''; }
  function nomeMes(mes, curto) { var i = +mes.slice(5, 7) - 1; return (curto ? MESES_C : MESES)[i]; }
  function fmtMes(mes) { return nomeMes(mes) + ' de ' + mes.slice(0, 4); }
  function fmtMesCurto(mes) { return nomeMes(mes, true) + '/' + mes.slice(2, 4); }
  /* aceita 25/12/2026 ou 2026-12-25 */
  function lerData(txt) {
    txt = String(txt || '').trim();
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(txt);
    if (m) {
      var a = +m[3]; if (a < 100) a += 2000;
      var d = montar(a, +m[2], +m[1]);
      return valida(d) ? d : null;
    }
    return valida(txt) ? txt : null;
  }

  return {
    pad: pad, valida: valida, ultimoDia: ultimoDia, addDias: addDias, diffDias: diffDias,
    diaSemana: diaSemana, hoje: hoje, mesDe: mesDe, addMes: addMes, diffMeses: diffMeses,
    addMeses: addMeses, dataNoMes: dataNoMes, pascoa: pascoa, feriadosDoAno: feriadosDoAno,
    nomeFeriado: nomeFeriado, limparCache: limparCache, ehDiaUtil: ehDiaUtil,
    proximoDiaUtil: proximoDiaUtil, enesimoDiaUtil: enesimoDiaUtil, quintoDiaUtil: quintoDiaUtil,
    DIAS: DIAS, MESES: MESES, fmtData: fmtData, fmtDiaMes: fmtDiaMes, nomeMes: nomeMes,
    fmtMes: fmtMes, fmtMesCurto: fmtMesCurto, lerData: lerData
  };
});
