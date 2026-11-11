/* calculos.js — regras de negócio puras: faturas, saldo, rendimento, caixinhas, pessoas, alertas e dicas.
   Não mexe na tela nem no servidor; recebe os dados e devolve resultados (fácil de testar). */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica(require('./regras.js'), require('./dinheiro.js'));
  else raiz.Calculos = fabrica(raiz.Regras, raiz.Dinheiro);
})(typeof self !== 'undefined' ? self : this, function (R, D) {
  'use strict';

  var arred = D.arred;
  function novoId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function porId(lista, id) { for (var i = 0; i < (lista || []).length; i++) if (lista[i].id === id) return lista[i]; return null; }

  /* ================= CARTÃO E FATURA ================= */

  /* Em qual fatura (AAAA-MM do fechamento) cai uma compra feita em "data".
     Compra no dia do fechamento ou depois → fatura seguinte. Fechamento efetivo = min(dia, último dia do mês). */
  function faturaDaCompra(card, data) {
    var mes = R.mesDe(data), dia = +data.slice(8, 10);
    var fech = Math.min(+card.fechamento || 1, R.ultimoDia(+mes.slice(0, 4), +mes.slice(5, 7)));
    return dia >= fech ? R.addMes(mes, 1) : mes;
  }
  /* dias de fechamento/vencimento que valiam para uma fatura (histórico: faturas antigas mantêm o dia antigo) */
  function diasDaFatura(card, ref) {
    var h = (card.vencHist || []).slice().sort(function (a, b) { return a.desde < b.desde ? -1 : 1; });
    var fech = +card.fechamento, venc = +card.vencimento;
    for (var i = 0; i < h.length; i++) if (h[i].desde <= ref) { fech = +h[i].fech || fech; venc = +h[i].dia || venc; }
    return { fech: fech, venc: venc };
  }
  function datasFatura(card, ref, cal) {
    var d = diasDaFatura(card, ref);
    var fechData = R.dataNoMes(ref, d.fech);
    var mesVenc = d.venc > d.fech ? ref : R.addMes(ref, 1); // vencimento > fechamento → mesmo mês
    var vencData = R.dataNoMes(mesVenc, d.venc);
    var pagarAte = R.proximoDiaUtil(vencData, cal);
    return { fechamento: fechData, vencimento: vencData, pagarAte: pagarAte, adiada: pagarAte !== vencData };
  }
  /* Ao mudar as datas do cartão: guarda o histórico a partir da fatura aberta hoje (as fechadas mantêm o dia antigo). */
  function mudarDatasCartao(card, novoFech, novoVenc, hoje) {
    var c = JSON.parse(JSON.stringify(card));
    novoFech = +novoFech; novoVenc = +novoVenc;
    if (novoFech === +card.fechamento && novoVenc === +card.vencimento) return c;
    c.vencHist = c.vencHist || [];
    if (!c.vencHist.length) c.vencHist.push({ desde: '0000-00', fech: +card.fechamento, dia: +card.vencimento });
    var desde = faturaDaCompra(card, hoje);
    c.vencHist = c.vencHist.filter(function (h) { return h.desde < desde; });
    c.vencHist.push({ desde: desde, fech: novoFech, dia: novoVenc });
    c.fechamento = novoFech; c.vencimento = novoVenc;
    return c;
  }

  function ehCartao(t) { return t.tipo === 'despesa' && t.forma === 'cartao' && t.cartaoId; }
  function sinal(t) { return t.estorno ? -1 : 1; }
  function valorDespesa(t) { return t.tipo === 'despesa' ? sinal(t) * (+t.valor || 0) : 0; }

  /* Todas as faturas de um cartão: { ref: {ref, total, itens, pagamento, datas...} } */
  function faturasDoCartao(estado, cardId) {
    var card = porId(estado.config.cards, cardId); if (!card) return {};
    var out = {}, cal = estado.config.calendario;
    estado.tx.forEach(function (t) {
      if (!ehCartao(t) || t.cartaoId !== cardId) return;
      var ref = t.faturaRef || faturaDaCompra(card, t.data);
      if (!out[ref]) out[ref] = { ref: ref, cardId: cardId, total: 0, itens: [] };
      out[ref].total = arred(out[ref].total + valorDespesa(t));
      out[ref].itens.push(t);
    });
    var pagas = estado.config.fatPagas || {};
    Object.keys(pagas).forEach(function (k) {
      var p = k.split('|'); if (p[0] !== cardId) return;
      if (!out[p[1]]) out[p[1]] = { ref: p[1], cardId: cardId, total: 0, itens: [] };
    });
    Object.keys(out).forEach(function (ref) {
      var f = out[ref];
      f.pagamento = pagas[cardId + '|' + ref] || null;
      var d = datasFatura(card, ref, cal);
      f.fechamento = d.fechamento; f.vencimento = d.vencimento; f.pagarAte = d.pagarAte; f.adiada = d.adiada;
    });
    return out;
  }
  function fatura(estado, cardId, ref) {
    var f = faturasDoCartao(estado, cardId)[ref];
    if (f) return f;
    var card = porId(estado.config.cards, cardId), d = datasFatura(card, ref, estado.config.calendario);
    return { ref: ref, cardId: cardId, total: 0, itens: [], pagamento: null, fechamento: d.fechamento, vencimento: d.vencimento, pagarAte: d.pagarAte, adiada: d.adiada };
  }
  /* Status: Paga, Vencida · não paga, Vence hoje, Fechada, Aberta, Futura, Sem valor */
  function statusFatura(estado, f, hoje) {
    var card = porId(estado.config.cards, f.cardId);
    if (f.pagamento) return 'Paga';
    if (f.total <= 0) return 'Sem valor';
    if (hoje > f.pagarAte) return 'Vencida · não paga';
    if (hoje >= f.vencimento) return 'Vence hoje';
    if (hoje >= f.fechamento) return 'Fechada';
    if (card && faturaDaCompra(card, hoje) === f.ref) return 'Aberta';
    return hoje < f.fechamento && f.ref < faturaDaCompra(card, hoje) ? 'Fechada' : 'Futura';
  }
  function precisaPagar(f) { return !f.pagamento && f.total > 0; }

  /* Limite usado: parcelas ocupam o limite todo desde a compra; assinatura só no dia da cobrança. Pagar libera. */
  function limiteUsado(estado, cardId, hoje) {
    var fs = faturasDoCartao(estado, cardId), usado = 0;
    Object.keys(fs).forEach(function (ref) {
      var f = fs[ref]; if (f.pagamento) return;
      f.itens.forEach(function (t) {
        if (t.recorrente && t.data > hoje) return;
        if (!t.parcelas && !t.saldoInicial && t.data > hoje && !t.estorno) return; // compra comum futura ainda não aconteceu
        usado += valorDespesa(t);
      });
    });
    return arred(Math.max(0, usado));
  }

  /* ================= CRIAR LANÇAMENTOS ================= */
  /* f = {tipo, data, valor, descricao, categoria, forma, cartaoId, parcelas, assinatura, meses (assinatura),
          repetir, pago, fisico, pessoaId, estorno, regra5du, mesSalario, sabadoUtil} */
  function criarLancamentos(f, estado) {
    var cal = estado.config.calendario || {}, out = [], hoje = estado.hoje;
    var base = {
      tipo: f.tipo, valor: arred(+f.valor), descricao: (f.descricao || '').trim(), categoria: f.categoria || 'Outros',
      forma: f.tipo === 'receita' ? (f.fisico ? 'dinheiro' : 'pix') : (f.forma || 'pix')
    };
    if (f.pessoaId && f.pessoaId !== 'eu') base.pessoaId = f.pessoaId;
    var div = null;
    if (f.tipo === 'despesa' && f.divisao && f.divisao.length > 1) {
      div = f.divisao.map(function (d) { return { pessoaId: d.pessoaId || 'eu', valor: arred(+d.valor) }; });
      var somaDiv = D.soma(div.map(function (d) { return d.valor; }));
      if (Math.abs(somaDiv - base.valor) > 0.009) throw new Error('A divisão soma ' + D.fmt(somaDiv) + ', mas o valor é ' + D.fmt(base.valor));
      delete base.pessoaId;
    }
    function comDiv(t) { if (div) t.divisao = dividirProporcional(t.valor, div, base.valor); return t; }
    if (f.fisico) base.fisico = true;
    if (f.forma === 'dinheiro' && f.tipo === 'despesa') base.fisico = true;
    if (f.acerto) base.acerto = true;

    if (f.tipo === 'despesa' && f.forma === 'cartao') {
      var card = porId(estado.config.cards, f.cartaoId);
      if (!card) throw new Error('Escolha o cartão');
      base.cartaoId = card.id;
      if (f.estorno) { base.estorno = true; }
      var ref0 = faturaDaCompra(card, f.data);
      var n = Math.max(1, Math.min(48, +f.parcelas || 1));
      if (f.assinatura) {
        var meses = Math.max(1, Math.min(60, +f.meses || 24)), g = novoId(), dia = +f.data.slice(8, 10);
        for (var i = 0; i < meses; i++) {
          var dt = R.addMeses(f.data, i, dia);
          out.push(comDiv(Object.assign({}, base, { id: novoId(), data: dt, recorrente: g, faturaRef: faturaDaCompra(card, dt) })));
        }
      } else if (n > 1 && !f.estorno) {
        var vals = D.dividir(base.valor, n), grupo = novoId(), dia2 = +f.data.slice(8, 10);
        for (var j = 0; j < n; j++) {
          out.push(comDiv(Object.assign({}, base, {
            id: novoId(), valor: vals[j], data: R.addMeses(f.data, j, dia2), parcela: j + 1, parcelas: n, grupo: grupo,
            valorTotal: base.valor, faturaRef: R.addMes(ref0, j)
          })));
        }
      } else {
        out.push(comDiv(Object.assign({}, base, { id: novoId(), data: f.data, faturaRef: ref0 })));
      }
      return out;
    }

    // fora do cartão
    var rep = Math.max(1, Math.min(120, +f.repetir || 1)), grupoR = rep > 1 ? novoId() : null, diaR = +f.data.slice(8, 10);
    for (var k = 0; k < rep; k++) {
      var t = comDiv(Object.assign({}, base, { id: novoId() }));
      if (f.tipo === 'receita' && f.regra5du && !f.dataManual) {
        var mes = R.addMes(f.mesSalario || R.mesDe(f.data), k);
        t.regraData = '5du'; t.mesRef = mes;
        t.data = R.quintoDiaUtil(mes, cal, !!cal.sabadoUtil);
      } else {
        t.data = R.addMeses(f.data, k, diaR);
        if (f.dataManual) t.dataManual = true;
      }
      if (grupoR) { t.repeticao = grupoR; t.repN = k + 1; t.repTotal = rep; }
      t.pago = k === 0 ? !!f.pago : (t.data <= hoje && !!f.pago);
      out.push(t);
    }
    return out;
  }

  /* "Quanto você já deve neste cartão": valor distribuído em N faturas a partir da aberta */
  function saldoAnteriorCartao(estado, card, valor, n, hoje) {
    var vals = D.dividir(arred(valor), Math.max(1, n)), ref0 = faturaDaCompra(card, hoje), g = novoId(), out = [];
    vals.forEach(function (v, i) {
      var ref = R.addMes(ref0, i);
      out.push({
        id: novoId(), tipo: 'despesa', forma: 'cartao', cartaoId: card.id, valor: v, descricao: 'Saldo anterior do cartão',
        categoria: 'Outros', data: i === 0 ? hoje : R.addDias(R.dataNoMes(ref, Math.max(1, +card.fechamento - 1)), 0),
        faturaRef: ref, saldoInicial: true, grupo: g, parcela: i + 1, parcelas: vals.length
      });
    });
    return out;
  }

  /* Salário: recalcula a data do 5º dia útil (recebidos e "data manual" nunca mudam sozinhos) */
  function recalcular5du(estado) {
    var cal = estado.config.calendario || {}, mudou = [];
    estado.tx.forEach(function (t) {
      if (t.regraData !== '5du' || t.pago || t.dataManual || !t.mesRef) return;
      var d = R.quintoDiaUtil(t.mesRef, cal, !!cal.sabadoUtil);
      if (d && d !== t.data) { t.data = d; mudou.push(t); }
    });
    return mudou;
  }

  /* ================= SALDO ================= */
  /* Eventos que mexem na conta (e no dinheiro físico), pela data em que o dinheiro realmente entra/sai. */
  function eventos(estado, hoje) {
    var cfg = estado.config, conta = [], fisico = [], amanha = R.addDias(hoje, 1), atrasados = [];
    estado.tx.forEach(function (t) {
      if (ehCartao(t)) return;
      var v = t.tipo === 'receita' ? +t.valor : -valorDespesa(t);
      var naFisico = t.fisico || (t.tipo === 'despesa' && t.forma === 'dinheiro');
      var data = t.data;
      if (!t.pago) {
        if (t.data < hoje) { data = amanha; atrasados.push(t); }
      }
      (naFisico ? fisico : conta).push({ data: data, valor: arred(v), origem: 'tx', t: t, previsto: !t.pago });
    });
    (cfg.cards || []).forEach(function (card) {
      var fs = faturasDoCartao(estado, card.id);
      Object.keys(fs).forEach(function (ref) {
        var f = fs[ref];
        if (f.pagamento) {
          conta.push({ data: f.pagamento.data, valor: -arred(f.pagamento.valor != null ? +f.pagamento.valor : f.total), origem: 'fatura', f: f });
        } else if (f.total > 0) {
          var d = f.vencimento >= hoje ? f.vencimento : (f.pagarAte >= hoje ? f.pagarAte : amanha);
          conta.push({ data: d, valor: -f.total, origem: 'fatura', f: f, previsto: true, atrasada: f.pagarAte < hoje });
        }
      });
    });
    (cfg.depositos || []).forEach(function (dp) {
      fisico.push({ data: dp.data, valor: -arred(+dp.valor), origem: 'deposito' });
      conta.push({ data: dp.data, valor: arred(+dp.valor), origem: 'deposito' });
    });
    (cfg.caixinhas || []).forEach(function (cx) {
      (cx.movs || []).forEach(function (m) {
        if (!m.mexeConta) return;
        if (m.tipo === 'guardar') conta.push({ data: m.data, valor: -arred(+m.valor), origem: 'caixinha', cx: cx });
        if (m.tipo === 'resgatar') conta.push({ data: m.data, valor: arred(+m.valor), origem: 'caixinha', cx: cx });
      });
    });
    var rend = cfg.rend || {};
    (rend.ajustes || []).forEach(function (a) {
      var dif = arred(+a.real - +a.calc);
      if (dif) conta.push({ data: a.data, valor: dif, origem: 'ajusteRend' });
    });
    if (cfg.fisicoRef) fisico.push({ data: cfg.fisicoRef.data, valor: arred(+cfg.fisicoRef.valor), origem: 'fisicoInicial' });
    return { conta: conta, fisico: fisico, atrasados: atrasados };
  }

  function agrupar(lista) {
    var m = {};
    lista.forEach(function (e) { m[e.data] = arred((m[e.data] || 0) + e.valor); });
    return m;
  }
  function taxaDoDia(taxas, d, ultimaRef) {
    if (taxas[d] != null) return taxas[d];
    return ultimaRef;
  }
  /* lista ordenada de datas com taxa → função que devolve a taxa do dia (ou a última conhecida antes dele) */
  function buscadorTaxa(taxas) {
    var datas = Object.keys(taxas || {}).sort();
    var padrao = 0.0551; // ~14,9% ao ano, só se nunca houve internet
    return function (d) {
      if (taxas[d] != null) return +taxas[d];
      var lo = 0, hi = datas.length - 1, res = -1;
      while (lo <= hi) { var mid = (lo + hi) >> 1; if (datas[mid] <= d) { res = mid; lo = mid + 1; } else hi = mid - 1; }
      if (res >= 0) return +taxas[datas[res]];
      return datas.length ? +taxas[datas[0]] : padrao;
    };
  }

  /* Série diária do saldo em conta, de "de" até "ate" (inclusive). Inclui o rendimento % do CDI.
     A âncora (saldoRef em saldoRefData) é o saldo no FIM daquele dia. */
  function serieSaldo(estado, de, ate, hoje) {
    var cfg = estado.config, ancora = cfg.saldoRefData || hoje, ref = +cfg.saldoRef || 0;
    var ev = eventos(estado, hoje), porDia = agrupar(ev.conta), cal = cfg.calendario || {};
    var rend = cfg.rend || {}, taxa = buscadorTaxa(estado.cdi || {}), pct = (+rend.pct || 0) / 100, fator = +rend.fator || 1;
    var out = {}, rendDia = {};
    // para frente a partir da âncora
    var fim = ate > ancora ? ate : ancora, saldo = ref, d = ancora, pend = 0;
    out[ancora] = ref;
    var guard = 0;
    while (d < fim && guard++ < 5000) {
      // rendimento do fim do dia d (se dia útil), entra no dia seguinte
      if (rend.ativo && pct > 0 && saldo > 0 && R.ehDiaUtil(d, cal)) pend = saldo * taxa(d) / 100 * pct * fator; else pend = 0;
      d = R.addDias(d, 1);
      saldo = arred(saldo + (porDia[d] || 0) + pend);
      if (pend) rendDia[d] = pend;
      out[d] = saldo;
    }
    // para trás (sem rendimento)
    if (de < ancora) {
      saldo = ref; d = ancora; guard = 0;
      while (d > de && guard++ < 5000) {
        saldo = arred(saldo - (porDia[d] || 0));
        d = R.addDias(d, -1);
        out[d] = saldo;
      }
    }
    return { saldo: out, rendDia: rendDia, eventos: ev };
  }
  function saldoEm(estado, data, hoje) { return serieSaldo(estado, data, data, hoje).saldo[data]; }

  /* Rendimento estimado da conta num período (soma dos créditos com data em [de, ate]) */
  function rendimentoPeriodo(estado, de, ate, hoje) {
    var s = serieSaldo(estado, de, ate, hoje), tot = 0;
    Object.keys(s.rendDia).forEach(function (d) { if (d >= de && d <= ate) tot += s.rendDia[d]; });
    return arred(tot);
  }

  function saldoFisico(estado, ate, hoje) {
    var ev = eventos(estado, hoje).fisico, tot = 0;
    ev.forEach(function (e) { if (e.data <= ate) tot += e.valor; });
    return arred(tot);
  }

  /* Ajustar: digito o saldo real hoje e a âncora passa a ser hoje */
  function ajustarSaldo(estado, saldoReal, hoje) {
    var atual = saldoEm(estado, hoje, hoje);
    return { saldoRef: arred(saldoReal), saldoRefData: hoje, diferenca: arred(saldoReal - atual), anterior: atual };
  }

  /* ================= CAIXINHAS ================= */
  function serieCaixinha(cx, ate, cdi, cal) {
    var taxa = buscadorTaxa(cdi || {}), d = cx.baseData || ate, saldo = +cx.base || 0, rendTot = 0, pend = 0;
    var movsPorDia = {}, hist = [];
    (cx.movs || []).forEach(function (m) { (movsPorDia[m.data] = movsPorDia[m.data] || []).push(m); });
    function aplicar(dia) {
      (movsPorDia[dia] || []).forEach(function (m) {
        var v = m.tipo === 'resgatar' ? -m.valor : +m.valor;
        saldo = arred(saldo + v);
        if (m.tipo === 'ajuste') rendTot += +m.valor;
        hist.push({ data: dia, tipo: m.tipo, valor: +m.valor, saldo: saldo, m: m });
      });
    }
    // movimentos anteriores à base entram direto
    Object.keys(movsPorDia).sort().forEach(function (dia) { if (dia <= d && dia <= ate) aplicar(dia); });
    var guard = 0, pct = (+cx.pct || 0) / 100, pctA = (cx.pctAcima != null && cx.pctAcima !== '' ? +cx.pctAcima : +cx.pct || 0) / 100, lim = +cx.limite || 0;
    while (d < ate && guard++ < 8000) {
      if (saldo > 0 && R.ehDiaUtil(d, cal || {})) {
        var dentro = lim > 0 ? Math.min(saldo, lim) : saldo, fora = lim > 0 ? Math.max(0, saldo - lim) : 0;
        pend = (dentro * pct + fora * pctA) * taxa(d) / 100;
      } else pend = 0;
      d = R.addDias(d, 1);
      if (pend) { saldo = saldo + pend; rendTot += pend; }
      aplicar(d);
    }
    return { saldo: arred(saldo), rendimento: arred(rendTot), historico: hist };
  }
  function totalCaixinhas(estado, ate) {
    var tot = 0;
    (estado.config.caixinhas || []).forEach(function (cx) { tot += serieCaixinha(cx, ate, estado.cdi, estado.config.calendario).saldo; });
    return arred(tot);
  }

  /* ================= MÊS: indicadores, categorias ================= */
  /* compra contestada (não reconheço): fica de fora dos gastos e das dívidas, a não ser que o banco negue a contestação */
  function contestada(t) { return !!(t.contestacao && t.contestacao.status !== 'negada'); }
  function ehGastoReal(t) { return t.tipo === 'despesa' && !t.saldoInicial && !contestada(t); }
  function gastosDoMes(estado, mes) {
    /* cartão: pelo mês da fatura (mês em que você paga), como nas abas da planilha; Pix/dinheiro: pela data */
    return estado.tx.filter(function (t) { return ehGastoReal(t) && mesRef(t, estado) === mes; });
  }
  function receitasDoMes(estado, mes) {
    return estado.tx.filter(function (t) { return t.tipo === 'receita' && R.mesDe(t.data) === mes; });
  }
  function resumoMes(estado, mes, hoje) {
    var g = gastosDoMes(estado, mes), r = receitasDoMes(estado, mes);
    var gasto = 0, recebido = 0, aReceber = 0, deOutros = 0, meu = 0;
    g.forEach(function (t) { gasto += valorDespesa(t); partesDe(t).forEach(function (p) { if (p.pessoaId !== 'eu') deOutros += p.valor; else meu += p.valor; }); });
    r.forEach(function (t) { if (t.pago) recebido += +t.valor; else aReceber += +t.valor; });
    var ini = mes + '-01', fim = R.dataNoMes(mes, 31), saiu = 0, entrou = 0;
    var ev = eventos(estado, hoje).conta;
    ev.forEach(function (e) { if (e.data >= ini && e.data <= fim && !e.previsto) { if (e.valor < 0) saiu -= e.valor; else entrou += e.valor; } });
    return {
      gasto: arred(gasto), recebido: arred(recebido), aReceber: arred(aReceber), receitaTotal: arred(recebido + aReceber),
      saiuDaConta: arred(saiu), entrouNaConta: arred(entrou), resultado: arred(recebido + aReceber - meu), deOutros: arred(deOutros), meu: arred(meu)
    };
  }
  /* só a minha parte de cada gasto (tira o que é de outras pessoas) */
  function soMeu(lista) {
    var out = [];
    lista.forEach(function (t) {
      if (t.tipo !== 'despesa') { out.push(t); return; }
      var meu = 0; partesDe(t).forEach(function (p) { if (p.pessoaId === 'eu') meu += p.valor; });
      if (Math.abs(meu) < 0.005) return;
      out.push(Object.assign({}, t, { valor: arred(Math.abs(meu)), _total: t.valor }));
    });
    return out;
  }
  function porCategoria(lista) {
    var m = {};
    lista.forEach(function (t) { var c = t.categoria || 'Outros'; m[c] = arred((m[c] || 0) + (t.tipo === 'receita' ? +t.valor : valorDespesa(t))); });
    return Object.keys(m).map(function (c) { return { nome: c, valor: m[c] }; })
      .filter(function (x) { return Math.abs(x.valor) > 0.004; })
      .sort(function (a, b) { return b.valor - a.valor; });
  }
  function porForma(lista) {
    var nomes = { pix: 'Pix', cartao: 'Cartão', debito: 'Débito', dinheiro: 'Dinheiro' }, m = {};
    lista.forEach(function (t) { var c = nomes[t.forma] || 'Pix'; m[c] = arred((m[c] || 0) + valorDespesa(t)); });
    return Object.keys(m).map(function (c) { return { nome: c, valor: m[c] }; }).sort(function (a, b) { return b.valor - a.valor; });
  }
  function maioresGastos(estado, mes, n) {
    return gastosDoMes(estado, mes).filter(function (t) { return !t.estorno; })
      .sort(function (a, b) { return (b.valorTotal || b.valor) - (a.valorTotal || a.valor); }).slice(0, n || 5);
  }

  /* ================= PESSOAS (de quem é a compra) ================= */
  function nomePessoa(estado, id) {
    if (!id || id === 'eu') return 'Eu';
    var p = porId(estado.config.pessoas, id); return p ? p.nome : 'Pessoa removida';
  }
  /* Parte de cada pessoa num lançamento: [{pessoaId, valor}] (com sinal: estorno é negativo).
     t.divisao = [{pessoaId, valor}] quando a compra é dividida; senão, tudo de t.pessoaId (ou "eu"). */
  function partesDe(t) {
    var s = t.tipo === 'despesa' ? sinal(t) : 1;
    if (t.divisao && t.divisao.length) return t.divisao.map(function (d) { return { pessoaId: d.pessoaId || 'eu', valor: arred(s * +d.valor) }; });
    return [{ pessoaId: t.pessoaId || 'eu', valor: arred(s * (+t.valor || 0)) }];
  }
  function envolvePessoa(t, id) { return partesDe(t).some(function (p) { return p.pessoaId === id; }); }
  function temOutros(t) { return partesDe(t).some(function (p) { return p.pessoaId !== 'eu'; }); }
  /* divide "valor" na mesma proporção de "divisao" (soma = total); a última parte absorve o arredondamento */
  function dividirProporcional(valor, divisao, total) {
    var cents = Math.round(valor * 100), usados = 0;
    return divisao.map(function (d, i) {
      var c = i === divisao.length - 1 ? cents - usados : Math.round(cents * (+d.valor) / total);
      usados += c; return { pessoaId: d.pessoaId, valor: c / 100 };
    });
  }
  function porPessoa(itens) {
    var m = {};
    itens.forEach(function (t) { if (t.tipo !== 'despesa') return; partesDe(t).forEach(function (p) { m[p.pessoaId] = arred((m[p.pessoaId] || 0) + p.valor); }); });
    return m;
  }
  /* Quem me deve: compras de cada pessoa (com estornos) − o que já recebi dela (receitas marcadas como acerto) */
  function devedores(estado) {
    return (estado.config.pessoas || []).map(function (p) {
      var d = dividasPessoa(estado, p.id), compras = 0;
      d.meses.forEach(function (x) { if (!x.futuro) compras += x.compras + x.pendencia; });
      return { id: p.id, nome: p.nome, cor: p.cor, tipo: p.tipo, compras: arred(compras), recebido: d.pago, futuro: d.futuro, deve: d.deve, abertos: d.abertos, acertado: 0, anterior: 0 };
    });
  }

  function descreverPessoas(estado, t) {
    if (!t.divisao || !t.divisao.length) return nomePessoa(estado, t.pessoaId);
    return t.divisao.map(function (d) { return nomePessoa(estado, d.pessoaId) + ' ' + D.fmt(d.valor, true); }).join(' + ');
  }
  /* mês em que a fatura é paga (vencimento) — é assim que a planilha chama as faturas */
  function mesVenc(estado, cardId, ref) {
    var card = porId(estado.config.cards, cardId);
    return card ? datasFatura(card, ref, estado.config.calendario).vencimento.slice(0, 7) : ref;
  }
  function mesRef(t, estado) {
    if (!ehCartao(t)) return R.mesDe(t.data);
    if (t.mesFatura) return t.mesFatura;
    return estado ? mesVenc(estado, t.cartaoId, t.faturaRef || faturaDaCompra(porId(estado.config.cards, t.cartaoId), t.data)) : (t.faturaRef || R.mesDe(t.data));
  }
  /* já acertado: marcado "já me pagou" ou numa fatura até o mês "acertado até" da pessoa */
  function itemAcertado(estado, t, pessoaId) {
    if (t.quitado) return true;
    var p = porId(estado.config.pessoas, pessoaId);
    return !!(p && p.acertadoAte && mesRef(t, estado) <= p.acertadoAte);
  }
  function dataTxt(t) { return t.semData ? 'compra em ' + R.fmtMesCurto(R.mesDe(t.data)) : R.fmtData(t.data); }
  /* ao conferir as datas do cartão, as compras da planilha mantêm o MÊS DO VENCIMENTO */
  function remapearPlanilha(estado, card) {
    var d0 = { fech: +card.fechamento, venc: +card.vencimento }, n = 0;
    estado.tx.forEach(function (t) {
      if (t.cartaoId !== card.id || !t.mesFatura) return;
      var ref = d0.venc > d0.fech ? t.mesFatura : R.addMes(t.mesFatura, -1);
      if (t.faturaRef !== ref) { t.faturaRef = ref; n++; }
    });
    var pagas = estado.config.fatPagas, novas = {};
    Object.keys(pagas).forEach(function (k) {
      var p = pagas[k], c = k.split('|');
      if (c[0] === card.id && p.mesVenc) {
        var ref = d0.venc > d0.fech ? p.mesVenc : R.addMes(p.mesVenc, -1);
        var dt = datasFatura(card, ref, estado.config.calendario);
        novas[card.id + '|' + ref] = Object.assign({}, p, { data: dt.vencimento });
      } else novas[k] = p;
    });
    estado.config.fatPagas = novas;
    return n;
  }

  /* ================= DEVENDO: o que cada pessoa deve, fatura por fatura =================
     - compras da pessoa no mês da fatura (sem as marcadas "já me pagou")
     - meses até "acertado até" contam como pagos, a não ser que haja um valor que ficou em aberto (pendência)
     - pendências: valores que ficaram em aberto de um mês (config.pendencias)
     - pagamentos: entradas marcadas como pagamento da pessoa; com mês da fatura vão para ele, sem mês abatem do mais antigo */
  function mesEmAndamento(estado) { return R.addMes(R.mesDe(estado.hoje || R.hoje()), 1); }
  function dividasPessoa(estado, pessoaId) {
    /* a fatura "em andamento" é a do mês que vem: compras deste mês, pagas no início do próximo */
    var p = porId(estado.config.pessoas, pessoaId) || {}, mesAtual = mesEmAndamento(estado), meses = {};
    function m(k) { return meses[k] || (meses[k] = { mes: k, compras: 0, pendencia: 0, pago: 0, itens: [], pendencias: [], pagamentos: [], aberto: 0 }); }
    estado.tx.forEach(function (t) {
      if (t.tipo !== 'despesa' || !envolvePessoa(t, pessoaId) || contestada(t)) return;
      var k = mesRef(t, estado), x = m(k), q = 0;
      partesDe(t).forEach(function (pp) { if (pp.pessoaId === pessoaId) q += pp.valor; });
      x.itens.push(t);
      if (!itemAcertado(estado, t, pessoaId)) x.compras = arred(x.compras + q);
    });
    (estado.config.pendencias || []).forEach(function (pd) { if (pd.pessoaId !== pessoaId) return; var x = m(pd.mes); x.pendencia = arred(x.pendencia + +pd.valor); x.pendencias.push(pd); });
    var semMes = [];
    estado.tx.forEach(function (t) {
      if (t.tipo !== 'receita' || !t.acerto || t.pessoaId !== pessoaId || !t.pago) return;
      if (t.mesFatura) { var x = m(t.mesFatura); x.pago = arred(x.pago + +t.valor); x.pagamentos.push(t); } else semMes.push(t);
    });
    var lista = Object.keys(meses).sort().map(function (k) { var x = meses[k]; x.futuro = k > mesAtual; x.aberto = arred(x.compras + x.pendencia - x.pago); return x; });
    // pagamentos sem mês: abatem dos meses mais antigos em aberto
    semMes.sort(function (a, b) { return a.data < b.data ? -1 : 1; }).forEach(function (t) {
      var resto = +t.valor;
      lista.forEach(function (x) { if (resto <= 0 || x.futuro || x.aberto <= 0) return; var v = Math.min(resto, x.aberto); x.aberto = arred(x.aberto - v); x.pago = arred(x.pago + v); x.pagamentos.push(t); resto = arred(resto - v); });
      if (resto > 0) { var ult = lista.filter(function (x) { return !x.futuro; }).pop() || m(mesAtual); ult.aberto = arred(ult.aberto - resto); ult.pago = arred(ult.pago + resto); }
    });
    var deve = 0, futuro = 0, pago = 0;
    lista.forEach(function (x) { if (x.futuro) futuro += x.compras; else deve += x.aberto; pago += x.pago; });
    return { pessoa: p, meses: lista, deve: arred(deve), futuro: arred(futuro), pago: arred(pago),
      abertos: lista.filter(function (x) { return !x.futuro && Math.abs(x.aberto) > 0.009; }) };
  }

  /* relação de uma pessoa para uma fatura: compras da fatura + o que ficou em aberto antes − o que já pagou dessa fatura */
  /* modo: 'tudo' (fatura escolhida + o que ficou de antes), 'atual' (só a fatura escolhida) ou 'anteriores' (só o que ficou de antes) */
  function relatorioPessoa(estado, pessoaId, mes, modo) {
    if (modo === true || modo == null) modo = 'tudo'; if (modo === false) modo = 'atual';
    var comAtual = modo !== 'anteriores', comAnt = modo !== 'atual';
    var d = dividasPessoa(estado, pessoaId), itens = [], totalFatura = 0, pagosItens = 0;
    if (comAtual) estado.tx.forEach(function (t) {
      if (t.tipo !== 'despesa' || !envolvePessoa(t, pessoaId) || mesRef(t, estado) !== mes || contestada(t)) return;
      var q = 0; partesDe(t).forEach(function (p) { if (p.pessoaId === pessoaId) q += p.valor; });
      var card = t.cartaoId ? porId(estado.config.cards, t.cartaoId) : null, pago = !!t.quitado;
      itens.push({ t: t, data: t.semData ? R.fmtMesCurto(R.mesDe(t.data)) : R.fmtData(t.data), ordem: t.data,
        descricao: t.descricao || t.categoria, cartao: card ? card.nome : (t.forma === 'dinheiro' ? 'Dinheiro' : 'Pix'), cor: card ? card.cor : '#00a3a3',
        parcela: t.parcelas ? t.parcela + '/' + t.parcelas : '', valor: arred(q), total: +t.valor, dividido: !!t.divisao, pago: pago, obs: t.obs || '' });
      if (pago) pagosItens += q; else totalFatura += q;
    });
    itens.sort(function (a, b) { return a.cartao < b.cartao ? -1 : a.cartao > b.cartao ? 1 : (a.ordem < b.ordem ? -1 : 1); });
    var porCartao = {};
    itens.forEach(function (i) { var c = porCartao[i.cartao] || (porCartao[i.cartao] = { nome: i.cartao, cor: i.cor, itens: [], total: 0 }); c.itens.push(i); if (!i.pago) c.total = arred(c.total + i.valor); });
    var x = d.meses.filter(function (q) { return q.mes === mes; })[0] || { pendencia: 0, pago: 0, pendencias: [], pagamentos: [] };
    var anteriores = [], pagamentos = [];
    function addPag(lista, mesP) { lista.forEach(function (t) { if (!pagamentos.some(function (p) { return p.id === t.id; })) pagamentos.push({ id: t.id, data: t.data, valor: +t.valor, mes: t.mesFatura || mesP }); }); }
    if (comAnt) d.meses.forEach(function (q) {
      if (q.mes >= mes || q.futuro || q.aberto <= 0.009) return;
      var obs = q.pendencias.map(function (p) { return p.obs; }).filter(Boolean).join(' · ');
      anteriores.push({ mes: q.mes, valor: q.aberto, original: arred(q.compras + q.pendencia), pago: q.pago, descricao: obs || (q.compras > 0 ? 'Compras dessa fatura que ficaram em aberto' : 'Valor que ficou em aberto') });
      addPag(q.pagamentos, q.mes);
    });
    if (comAtual) addPag(x.pagamentos || [], mes);
    pagamentos.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var totAnt = 0; anteriores.forEach(function (a) { totAnt += a.valor; });
    var pendMes = comAtual ? (x.pendencia || 0) : 0, pagoMes = comAtual ? (x.pago || 0) : 0;
    return { pessoa: d.pessoa, mes: mes, modo: modo, itens: itens, porCartao: Object.keys(porCartao).map(function (k) { return porCartao[k]; }), totalFatura: arred(totalFatura),
      pendenciaMes: arred(pendMes), pendenciasMes: comAtual ? (x.pendencias || []) : [], anteriores: anteriores, totalAnteriores: arred(totAnt), pagoMes: arred(pagoMes), pagosItens: arred(pagosItens),
      pagamentos: pagamentos, total: arred(totalFatura + pendMes + totAnt - pagoMes) };
  }
  function relatorioTexto(r) {
    var L = ['*Extrato de compras no cartão*', r.pessoa.nome + ' · ' + (r.modo === 'anteriores' ? 'valores em aberto antes da fatura de ' : 'fatura de ') + R.fmtMes(r.mes), ''];
    r.porCartao.forEach(function (c) {
      L.push('*' + c.nome + '*');
      c.itens.forEach(function (i) { L.push(i.data + ' · ' + i.descricao + (i.parcela ? ' (' + i.parcela + ')' : '') + (i.dividido ? ' · sua parte' : '') + ' · ' + D.fmt(i.valor) + (i.pago ? ' ✓ pago' : '')); });
      L.push('Subtotal: ' + D.fmt(c.total), '');
    });
    if (r.pendenciaMes) L.push('Valor em aberto desta fatura: ' + D.fmt(r.pendenciaMes));
    if (r.anteriores.length) { L.push('*Em aberto de faturas anteriores*'); r.anteriores.forEach(function (a) { L.push('Fatura de ' + R.fmtMesCurto(a.mes) + ' · ' + a.descricao + (a.pago ? ' · era ' + D.fmt(a.original) + ', já pagou ' + D.fmt(a.pago) : '') + ' · falta ' + D.fmt(a.valor)); }); L.push(''); }
    if (r.pagamentos.length) { L.push('*Pagamentos recebidos*'); r.pagamentos.forEach(function (p) { L.push(R.fmtDiaMes(p.data) + ' · ' + D.fmt(p.valor) + (p.mes ? ' (fatura ' + R.fmtMesCurto(p.mes) + ')' : '')); }); L.push(''); }
    if (r.pagoMes) L.push('Já pago desta fatura: -' + D.fmt(r.pagoMes));
    L.push('*Total a pagar: ' + D.fmt(r.total) + '*');
    return L.join('\n');
  }

  /* compras de uma pessoa agrupadas por fatura/mês */
  function comprasDaPessoa(estado, pessoaId) {
    var grupos = {};
    estado.tx.forEach(function (t) {
      if (t.tipo !== 'despesa' || !envolvePessoa(t, pessoaId)) return;
      var chave = mesRef(t, estado);
      (grupos[chave] = grupos[chave] || []).push(t);
    });
    return grupos;
  }

  /* ================= ALERTAS ================= */
  function alertas(estado, hoje) {
    var out = [], lim = R.addDias(hoje, 3);
    estado.tx.forEach(function (t) {
      if (ehCartao(t) || t.pago || t.data >= hoje) return;
      out.push({ tipo: 'atrasado', nivel: 'ruim', t: t, texto: (t.tipo === 'receita' ? 'Não recebido: ' : 'Não pago: ') + (t.descricao || t.categoria) + ' (' + R.fmtDiaMes(t.data) + ')' });
    });
    (estado.config.cards || []).forEach(function (card) {
      var fs = faturasDoCartao(estado, card.id);
      Object.keys(fs).forEach(function (ref) {
        var f = fs[ref]; if (!precisaPagar(f)) return;
        if (hoje > f.pagarAte) out.push({ tipo: 'fatura', nivel: 'ruim', f: f, card: card, texto: 'Fatura ' + card.nome + ' vencida (' + R.fmtDiaMes(f.vencimento) + ')' });
        else if (f.pagarAte <= lim) out.push({ tipo: 'fatura', nivel: 'aviso', f: f, card: card, texto: 'Fatura ' + card.nome + (f.vencimento === hoje ? ' vence hoje' : ' vence ' + R.fmtDiaMes(f.vencimento)) + (f.adiada ? ' · pagar até ' + R.fmtDiaMes(f.pagarAte) : '') });
      });
    });
    var semDono = estado.tx.filter(function (t) { return t.importado && !t.planilha && !t.triado && !t.contestacao && t.tipo === 'despesa'; });
    if (semDono.length) out.push({ tipo: 'semdono', nivel: 'aviso', texto: semDono.length + ' compra(s) importada(s) sem responsável' });
    var cont = estado.tx.filter(function (t) { return t.contestacao && t.contestacao.status === 'aberta'; });
    if (cont.length) out.push({ tipo: 'contestacao', nivel: 'aviso', texto: cont.length + ' compra(s) contestada(s) aguardando retorno do banco' });
    (estado.config.pessoas || []).forEach(function (p) {
      if (p.tipo !== 'empresa') return;
      var n = 0, v = 0;
      estado.tx.forEach(function (t) { if (t.tipo === 'despesa' && !t.reembolsoPedido && envolvePessoa(t, p.id) && !itemAcertado(estado, t, p.id) && !contestada(t)) { n++; partesDe(t).forEach(function (q) { if (q.pessoaId === p.id) v += q.valor; }); } });
      if (n) out.push({ tipo: 'reembolso', nivel: 'aviso', pessoa: p, texto: 'Pedir reembolso à ' + p.nome + ': ' + n + ' compra(s), ' + D.fmt(v) });
    });
    estado.tx.forEach(function (t) {
      if (ehCartao(t) || t.pago || t.tipo !== 'despesa' || t.data < hoje || t.data > lim) return;
      out.push({ tipo: 'vence', nivel: 'aviso', t: t, texto: 'Vence ' + (t.data === hoje ? 'hoje' : R.fmtDiaMes(t.data)) + ': ' + (t.descricao || t.categoria) });
    });
    return out;
  }

  /* ================= ONDE POSSO ECONOMIZAR ================= */
  function normDesc(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function dicas(estado, mes, hoje) {
    var out = [], g = gastosDoMes(estado, mes), total = 0;
    g.forEach(function (t) { total += valorDespesa(t); });
    var cats = porCategoria(g);
    if (total > 0 && cats.length) {
      cats.slice(0, 3).forEach(function (c) { out.push({ tipo: 'peso', texto: c.nome + ' pesa ' + D.pct(c.valor / total * 100) + ' dos gastos (' + D.fmt(c.valor) + ')' }); });
    }
    // categorias que subiram mais de 30% vs média dos 3 meses anteriores
    var ant = {};
    for (var i = 1; i <= 3; i++) porCategoria(gastosDoMes(estado, R.addMes(mes, -i))).forEach(function (c) { ant[c.nome] = (ant[c.nome] || 0) + c.valor / 3; });
    cats.forEach(function (c) {
      if (ant[c.nome] > 1 && c.valor > ant[c.nome] * 1.3) out.push({ tipo: 'subiu', texto: c.nome + ' subiu ' + D.pct((c.valor / ant[c.nome] - 1) * 100) + ' em relação à média dos 3 meses anteriores' });
    });
    // compras repetidas
    var rep = {};
    g.forEach(function (t) { if (t.parcelas || t.recorrente || t.estorno) return; var k = normDesc(t.descricao); if (!k) return; (rep[k] = rep[k] || []).push(t); });
    Object.keys(rep).forEach(function (k) {
      if (rep[k].length >= 3) { var s = 0; rep[k].forEach(function (t) { s += +t.valor; }); out.push({ tipo: 'repetida', texto: rep[k][0].descricao + ': ' + rep[k].length + ' compras no mês, ' + D.fmt(s) }); }
    });
    // assinaturas
    var ass = {}, totAss = 0;
    estado.tx.forEach(function (t) { if (t.recorrente && R.mesDe(t.data) === mes) { ass[t.recorrente] = t; totAss += +t.valor; } });
    var nAss = Object.keys(ass).length;
    estado.tx.forEach(function (t) { if (t.repeticao && R.mesDe(t.data) === mes && t.tipo === 'despesa') { nAss++; totAss += +t.valor; } });
    if (nAss) out.push({ tipo: 'assinatura', texto: nAss + ' conta(s) fixa(s)/assinatura(s) neste mês: ' + D.fmt(totAss) });
    // parcelas comprometidas (depois deste mês)
    var fimMes = R.dataNoMes(mes, 31), parc = 0;
    estado.tx.forEach(function (t) { if (t.parcelas && !t.saldoInicial && t.data > fimMes) parc += +t.valor; });
    if (parc > 0) out.push({ tipo: 'parcelas', texto: 'Parcelas já comprometidas nos próximos meses: ' + D.fmt(parc) });
    // possíveis duplicados
    var vistos = {};
    g.forEach(function (t) {
      if (t.grupo || t.recorrente || t.repeticao) return;
      var k = normDesc(t.descricao) + '|' + t.valor + '|' + t.data;
      if (vistos[k]) out.push({ tipo: 'duplicado', texto: 'Possível duplicado: ' + (t.descricao || t.categoria) + ' ' + D.fmt(t.valor) + ' em ' + R.fmtDiaMes(t.data), t: t });
      vistos[k] = true;
    });
    // meses no negativo (previsão até 12 meses)
    var negs = [], fim = R.dataNoMes(R.addMes(R.mesDe(hoje), 11), 31), s = serieSaldo(estado, hoje, fim, hoje).saldo;
    for (var m = 0; m < 12; m++) {
      var mm = R.addMes(R.mesDe(hoje), m), menor = Infinity;
      for (var dia = 1; dia <= R.ultimoDia(+mm.slice(0, 4), +mm.slice(5, 7)); dia++) { var dd = R.dataNoMes(mm, dia); if (dd >= hoje && s[dd] != null && s[dd] < menor) menor = s[dd]; }
      if (menor < 0) negs.push(R.fmtMesCurto(mm));
    }
    if (negs.length) out.push({ tipo: 'negativo', texto: 'O saldo previsto fica negativo em: ' + negs.join(', ') });
    return out;
  }

  /* ================= CSV ================= */
  function csvEscapar(v) { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  var CSV_COLS = ['data', 'tipo', 'descricao', 'valor', 'categoria', 'forma', 'cartao', 'parcela', 'pessoa', 'situacao'];
  function exportarCSV(estado) {
    var nomes = { pix: 'Pix', cartao: 'Cartão', debito: 'Débito', dinheiro: 'Dinheiro' };
    var linhas = [CSV_COLS.join(';')];
    estado.tx.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; }).forEach(function (t) {
      var card = t.cartaoId ? porId(estado.config.cards, t.cartaoId) : null;
      linhas.push([R.fmtData(t.data), t.tipo === 'receita' ? 'Receita' : (t.estorno ? 'Estorno' : 'Gasto'), t.descricao, D.fmt(t.valor, true),
        t.categoria, nomes[t.forma] || '', card ? card.nome : '', t.parcelas ? t.parcela + '/' + t.parcelas : '', descreverPessoas(estado, t),
        ehCartao(t) ? '' : (t.pago ? (t.tipo === 'receita' ? 'Recebido' : 'Pago') : 'Pendente')].map(csvEscapar).join(';'));
    });
    return '﻿' + linhas.join('\r\n');
  }
  function lerCSV(texto) {
    texto = String(texto || '').replace(/^﻿/, '');
    var sep = (texto.split('\n')[0].match(/;/g) || []).length >= (texto.split('\n')[0].match(/,/g) || []).length ? ';' : ',';
    var linhas = [], campo = '', linha = [], aspas = false;
    for (var i = 0; i < texto.length; i++) {
      var c = texto[i];
      if (aspas) { if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c; }
      else if (c === '"') aspas = true;
      else if (c === sep) { linha.push(campo); campo = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; linha.push(campo); campo = ''; if (linha.join('').trim()) linhas.push(linha); linha = []; }
      else campo += c;
    }
    linha.push(campo); if (linha.join('').trim()) linhas.push(linha);
    return linhas;
  }
  /* devolve {itens, erros}; colunas reconhecidas pelo cabeçalho */
  function importarCSV(texto, estado) {
    var linhas = lerCSV(texto); if (!linhas.length) return { itens: [], erros: ['Arquivo vazio'] };
    var cab = linhas[0].map(normDesc), idx = {};
    CSV_COLS.forEach(function (c) { idx[c] = cab.indexOf(c); });
    if (idx.data < 0 || idx.valor < 0) return { itens: [], erros: ['O arquivo precisa ter as colunas "data" e "valor"'] };
    var itens = [], erros = [], formas = { pix: 'pix', cartao: 'cartao', debito: 'debito', dinheiro: 'dinheiro' };
    linhas.slice(1).forEach(function (l, n) {
      function col(c) { return idx[c] >= 0 ? (l[idx[c]] || '').trim() : ''; }
      var data = R.lerData(col('data')), valor = D.ler(col('valor'));
      if (!data || valor == null) { erros.push('Linha ' + (n + 2) + ': data ou valor inválido'); return; }
      var tipoTxt = normDesc(col('tipo')), tipo = tipoTxt.indexOf('receita') === 0 ? 'receita' : 'despesa';
      if (valor < 0) { valor = -valor; if (!tipoTxt) tipo = 'despesa'; }
      var forma = formas[normDesc(col('forma'))] || 'pix', cartaoId = null;
      if (forma === 'cartao') {
        var nc = normDesc(col('cartao')), card = (estado.config.cards || []).filter(function (c) { return normDesc(c.nome) === nc; })[0];
        if (card) cartaoId = card.id; else forma = 'pix';
      }
      var pessoa = normDesc(col('pessoa')), pid = null;
      (estado.config.pessoas || []).forEach(function (p) { if (normDesc(p.nome) === pessoa) pid = p.id; });
      var t = { id: novoId(), tipo: tipo, data: data, valor: valor, descricao: col('descricao'), categoria: col('categoria') || 'Outros', forma: tipo === 'receita' ? 'pix' : forma };
      if (tipoTxt === 'estorno') t.estorno = true;
      if (pid) t.pessoaId = pid;
      if (cartaoId && tipo === 'despesa') { t.cartaoId = cartaoId; t.faturaRef = faturaDaCompra(porId(estado.config.cards, cartaoId), data); }
      else { var sit = normDesc(col('situacao')); t.pago = sit ? (sit === 'pago' || sit === 'recebido') : data <= estado.hoje; }
      if (t.forma === 'dinheiro') t.fisico = true;
      itens.push(t);
    });
    return { itens: itens, erros: erros };
  }

  /* ================= IMPORTAR EXTRATO DA FATURA ================= */
  var MESES_TXT = { jan: 1, fev: 2, mar: 3, abr: 4, mai: 5, jun: 6, jul: 7, ago: 8, set: 9, out: 10, nov: 11, dez: 12 };
  var RE_VALOR = '-?\\s?(?:R\\$\\s?)?-?\\d{1,3}(?:\\.\\d{3})*,\\d{2}(?:\\s?-|\\s?[DC]\\b)?';
  var RE_DATA = '\\d{1,2}\\/\\d{1,2}(?:\\/\\d{2,4})?|\\d{1,2}\\s?(?:de\\s)?(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-zç]*\\.?(?:\\s?\\d{4})?';
  function anoDaCompra(mes, refFatura) {
    var a = +refFatura.slice(0, 4), m = +refFatura.slice(5, 7);
    return mes > m ? a - 1 : a;
  }
  function dataDoExtrato(txt, refFatura) {
    txt = txt.trim().toLowerCase();
    var m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(txt), dia, mes, ano;
    if (m) { dia = +m[1]; mes = +m[2]; ano = m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null; }
    else {
      m = /^(\d{1,2})\s?(?:de\s)?([a-zç]{3})[a-zç]*\.?(?:\s?(\d{4}))?$/.exec(txt);
      if (!m || !MESES_TXT[m[2]]) return null;
      dia = +m[1]; mes = MESES_TXT[m[2]]; ano = m[3] ? +m[3] : null;
    }
    if (mes < 1 || mes > 12) return null;
    if (!ano) ano = anoDaCompra(mes, refFatura);
    var d = R.pad(ano) + '-' + R.pad(mes) + '-' + R.pad(Math.min(dia, R.ultimoDia(ano, mes)));
    return R.valida(d) ? d : null;
  }
  var IGNORAR = /(pagamento|pagto|pgto|saldo anterior|saldo em aberto|total (da|de)|^total|limite|vencimento|fatura anterior|credito rotativo|encargos financiados)/i;
  var CREDITO = /(estorno|devolu|reembolso|credito|cr[eé]dito|cashback|desconto)/i;
  /* monta um item a partir de data, descrição e valor (texto) */
  /* parcela no nome: "PARC 02/10", "Parcela 2 de 10", "(2/10)", "2/10" no fim, "02 DE 10"; ou numa coluna própria */
  function lerParcela(desc, coluna) {
    function ok(k, n) { return k >= 1 && n >= 2 && k <= n && n <= 72; }
    if (coluna) {
      var mc = /(\d{1,2})\s*(?:\/|de|of)\s*(\d{1,2})/i.exec(String(coluna));
      if (mc && ok(+mc[1], +mc[2])) return { k: +mc[1], n: +mc[2], resto: desc };
    }
    var res = [
      /\s*[-–(\[]?\s*\bparc(?:ela)?s?\.?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*[)\]]?/i,  // PARC 02/10, Parcela 2 de 10
      /\s*[(\[]\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*[)\]]/i,                         // (2/10)
      /\s+[-–]?\s*(\d{1,2})\s*(?:\/|de)\s*(\d{1,2})\s*$/i,                                 // ... 02/10 no fim
      /\s+(\d{1,2})\s+de\s+(\d{1,2})\b/i                                                   // ... 2 de 10 no meio
    ];
    for (var i = 0; i < res.length; i++) {
      var m = res[i].exec(desc);
      if (m && ok(+m[1], +m[2])) return { k: +m[1], n: +m[2], resto: (desc.slice(0, m.index) + ' ' + desc.slice(m.index + m[0].length)).replace(/\s{2,}/g, ' ').replace(/[-–\s]+$/, '').trim() };
    }
    return null;
  }
  function itemDoExtrato(dataTxt, desc, valorTxt, refFatura, forcarSinal, parcTxt) {
    var data = dataDoExtrato(dataTxt, refFatura); if (!data) return null;
    var vt = String(valorTxt).trim(), neg = /^-|-$|\sC$|^-\s/.test(vt) || /\bC$/.test(vt);
    var v = D.ler(vt.replace(/R\$\s?/i, '').replace(/[-\s]|[DC]$/g, ''));
    if (v == null || v === 0) return null;
    if (forcarSinal != null) neg = forcarSinal < 0;
    desc = String(desc || '').replace(/\s{2,}/g, ' ').trim();
    var parcela = null, parcelas = null, pp = lerParcela(desc, parcTxt);
    if (pp) { parcela = pp.k; parcelas = pp.n; desc = pp.resto; }
    // parcela sem ano na data: o ano certo é o que deixa a compra perto de (fatura − parcelas já passadas)
    if (parcela && !/\d{4}|\/\d{2}\/\d{2}$/.test(String(dataTxt).trim())) {
      var esperado = R.addMes(refFatura, -(parcela - 1)), melhor = data, dist = 99;
      [-2, -1, 0, 1].forEach(function (da) {
        var cand = (+data.slice(0, 4) + da) + data.slice(4);
        if (!R.valida(cand)) return;
        var dd = Math.abs(R.diffMeses(R.mesDe(cand), esperado));
        if (R.mesDe(cand) <= refFatura && dd < dist) { dist = dd; melhor = cand; }
      });
      data = melhor;
    }
    var credito = neg || CREDITO.test(desc);
    return { data: data, descOriginal: desc, valor: v, credito: credito, parcela: parcela, parcelas: parcelas, ignorar: IGNORAR.test(desc) };
  }
  /* texto (copiado do PDF/app ou extraído do PDF) → itens */
  function lerExtratoTexto(texto, refFatura) {
    var re = new RegExp('(?:^|\\s)(' + RE_DATA + ')\\s+(.+?)\\s+(?:US\\$\\s?[\\d.,]+\\s+)?(' + RE_VALOR + ')(?=\\s+(?:' + RE_DATA + ')\\s|\\s*$)', 'gi');
    var out = [];
    String(texto || '').split(/\r?\n/).forEach(function (linha) {
      linha = linha.replace(/\t/g, ' ').replace(/\u00a0/g, ' ').trim(); if (!linha) return;
      var m; re.lastIndex = 0;
      while ((m = re.exec(linha))) {
        var it = itemDoExtrato(m[1], m[2], m[3], refFatura);
        if (it && it.descOriginal && !/^\d+$/.test(it.descOriginal)) out.push(it);
      }
    });
    return out;
  }
  function lerExtratoOFX(texto, refFatura) {
    var out = [], blocos = String(texto).split(/<STMTTRN>/i).slice(1);
    blocos.forEach(function (b) {
      function tag(n) { var m = new RegExp('<' + n + '>([^<\\r\\n]*)', 'i').exec(b); return m ? m[1].trim() : ''; }
      var dt = tag('DTPOSTED'), v = parseFloat(tag('TRNAMT').replace(',', '.'));
      if (!/^\d{8}/.test(dt) || !isFinite(v)) return;
      var d = dt.slice(0, 4) + '-' + dt.slice(4, 6) + '-' + dt.slice(6, 8);
      var it = itemDoExtrato(R.fmtData(d), tag('MEMO') || tag('NAME'), D.fmt(Math.abs(v), true), refFatura, v > 0 ? -1 : 1);
      if (it) out.push(it);
    });
    return out;
  }
  function lerExtratoCSV(texto, refFatura) {
    var linhas = lerCSV(texto); if (linhas.length < 2) return [];
    var cab = linhas[0].map(normDesc), iD = -1, iDesc = -1, iV = -1, iP = -1;
    cab.forEach(function (c, i) {
      if (iD < 0 && /^data/.test(c)) iD = i;
      if (iDesc < 0 && /(descri|lancamento|estabelecimento|historico|titulo|nome)/.test(c)) iDesc = i;
      if (/(valor|amount|r\$)/.test(c) && !/dolar|usd/.test(c)) iV = i;
      if (iP < 0 && /(parcela|parcelas|prestac|installment|tipo)/.test(c)) iP = i;
    });
    if (iD < 0 || iV < 0) return lerExtratoTexto(texto.replace(/[;,"]/g, ' '), refFatura);
    var out = [];
    linhas.slice(1).forEach(function (l) {
      var vt = String(l[iV] || '').trim(), num = vt.replace(/R\$\s?/i, '');
      if (/^-?\d+\.\d{1,2}$/.test(num)) num = num.replace('.', ',');
      var dt = String(l[iD] || '').trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(dt)) dt = R.fmtData(dt.slice(0, 10));
      var it = itemDoExtrato(dt, iDesc >= 0 ? l[iDesc] : '', num, refFatura, null, iP >= 0 ? l[iP] : null);
      if (it) out.push(it);
    });
    return out;
  }
  /* Marca as linhas do extrato que JÁ ESTÃO lançadas (não podem ser importadas de novo).
     Cada lançamento existente "casa" com no máximo uma linha (duas compras iguais no mesmo dia continuam valendo).
     Casa quando é o mesmo cartão e o mesmo valor e:
       1) mesma data e mesmo nome da fatura (importação repetida), ou
       2) mesma parcela (ex.: 3/10) na mesma fatura, ou
       3) mesma data (compra lançada à mão), ou
       4) mesma fatura e o lançamento existente não tem data (veio da planilha). */
  function marcarDuplicados(itens, estado, cardId, refFatura) {
    var usados = {};
    var existentes = estado.tx.filter(function (t) { return t.cartaoId === cardId && t.tipo === 'despesa'; });
    function candidato(it, regra) {
      for (var i = 0; i < existentes.length; i++) {
        var t = existentes[i]; if (usados[t.id]) continue;
        var dif = Math.abs(+t.valor - it.valor), tol = it.parcelas && t.parcelas ? 0.10 : 0.009;
        if (dif > tol || !!t.estorno !== !!it.credito) continue;
        var mesmaFatura = !refFatura || t.faturaRef === refFatura;
        if (regra === 1 && t.data === it.data && normDesc(t.descOriginal || t.descricao) === normDesc(it.descOriginal)) return t;
        if (regra === 2 && it.parcelas && t.parcelas === it.parcelas && t.parcela === it.parcela && (mesmaFatura || t.semData)) return t;
        if (regra === 3 && !t.semData && t.data === it.data) return t;
        if (regra === 4 && t.semData && mesmaFatura && (!it.parcelas || !t.parcelas || t.parcela === it.parcela)) return t;
        if (regra === 4 && t.estornoDe && it.credito && mesmaFatura) return t;
      }
      return null;
    }
    itens.forEach(function (it) { it.jaExiste = false; it.igual = null; });
    itens.casados = usados;
    [1, 2, 3, 4].forEach(function (regra) {
      itens.forEach(function (it) {
        if (it.jaExiste) return;
        var t = candidato(it, regra);
        if (t) { usados[t.id] = true; it.jaExiste = true; it.igual = { id: t.id, descricao: t.descricao, data: t.semData ? null : t.data }; }
      });
    });
    return itens;
  }
  /* "IFOOD *RESTAURANTE XPTO" → "Ifood Restaurante Xpto" */
  function nomeBonito(s) {
    s = String(s || '').replace(/[*_]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (s !== s.toUpperCase()) return s;
    var min = { de: 1, da: 1, do: 1, das: 1, dos: 1, e: 1 };
    return s.toLowerCase().split(' ').map(function (w, i) { return i && min[w] ? w : w.charAt(0).toUpperCase() + w.slice(1); }).join(' ');
  }
  /* ===== sugestão de categoria =====
     1) o que você já usou antes para uma compra com o mesmo nome (aprende com você);
     2) palavras do nome (ifood → Comida, uber → Transporte...); 3) senão, Outros. */
  var REGRAS_CAT = [
    [/\bpic ?pay\b/, 'PicPay'],
    [/celular|carregador|fone|pelicula|capinha|eletro|samsung|apple store|kabum|magazine|magalu|casas bahia/, 'Eletrônicos'],
    [/farmacia|drogaria|droga |drogarias?|pharma|droga ?raia|drogasil|pague menos|araujo|panvel|farma|hospital|clinica|laborat|consulta|dentist|odonto|unimed|hapvida|saude/, 'Saúde'],
    [/barbearia|salao|cabelo|manicure|estetica|depila|boticario|natura|sephora|beleza|maquiagem|cosmetic|perfum/, 'Beleza'],
    [/calcado|sapato|tenis|centauro|netshoes|arezzo|havaianas/, 'Sapato'],
    [/renner|riachuelo|c ?& ?a\b|cea\b|zara|shein|hering|marisa|youcom|roupa|moda|malwee|lojas americanas/, 'Roupa'],
    [/uber|99 ?app|99 ?pop|99 ?taxi|cabify|estacionamento|pedagio|sem parar|conectcar|veloe|metro|onibus|passagem|auto ?pecas|oficina|mecanic/, 'Transporte'],
    [/posto|shell|ipiranga|petrobras|\bbr\b mania|combustivel|gasolina/, 'Gasolina'],
    [/netflix|spotify|amazonprime|amazon ?prime|disney|hbo|\bmax\b|prime video|amazon prime|youtube|deezer|globoplay|icloud|google one|assinatura|paramount|crunchyroll|chatgpt|openai|claude|duolingo/, 'Assinatura Mensal'],
    [/\bvivo\b|claro|\btim\b|\boi\b|energia|cemig|copasa|sabesp|light|enel|internet|telefon/, 'Contas Mensais'],
    [/ifood|ifd|rappi|99 ?food|churrasquinho|fruit|peixao|grann? ?sabor|emporio|sacolao|rates|restaurante|lanche|lanchonete|padaria|panificadora|pizz|hamburg|burger|mcdonald|bk\b|subway|acai|sorvete|cafe|cafeteria|starbucks|supermercado|mercado(?! livre| pago)|atacad|assai|carrefour|extra\b|pao de acucar|bh supermercados|epa\b|sacolao|hortifruti|acougue|emporio|doceria|confeitaria|churras|espetinho|comida|food/, 'Comida'],
    [/bar\b|boteco|cervej|bebida|distribuidora|adega|chopp|drink|agua/, 'Bebidas'],
    [/leroy|telhanorte|casa ?&|tok ?stok|camicado|etna|utilidade|chuveiro|limpeza|lavanderia|moveis|madeira ?madeira/, 'Casa'],
    [/cinema|ingresso|sympla|eventim|show|teatro|parque|loteri|figurinha|steam|playstation|xbox|nintendo|game|viagem|hotel|airbnb|booking|decolar/, 'Lazer'],
    [/faculdade|curso|escola|livraria|livro|udemy|alura|apostila|papelaria|una\b|jaleco/, 'Estudos']
  ];
  function sugerirCategoria(estado, desc) {
    var n = normDesc(desc); if (!n) return 'Outros';
    var cats = (estado.config.cats || []).map(function (c) { return c.nome; }), ok = function (c) { return cats.indexOf(c) >= 0; };
    // 1) aprende com o histórico: mesmo nome (ou mesma primeira palavra) já categorizado
    var porNome = {}, porPalavra = {}, p1 = n.split(' ')[0];
    estado.tx.forEach(function (t) {
      if (t.tipo !== 'despesa' || !t.categoria || t.categoria === 'Outros') return;
      [normDesc(t.descricao), normDesc(t.descOriginal)].forEach(function (k) {
        if (!k) return;
        if (k === n) porNome[t.categoria] = (porNome[t.categoria] || 0) + 1;
        if (p1.length >= 4 && k.split(' ')[0] === p1) porPalavra[t.categoria] = (porPalavra[t.categoria] || 0) + 1;
      });
    });
    function maisUsada(m) { var k = Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0]; return k && ok(k) ? k : null; }
    var h = maisUsada(porNome) || maisUsada(porPalavra); if (h) return h;
    // 2) palavras-chave
    for (var i = 0; i < REGRAS_CAT.length; i++) if (REGRAS_CAT[i][0].test(n) && ok(REGRAS_CAT[i][1])) return REGRAS_CAT[i][1];
    return 'Outros';
  }

  function lancamentosDoExtrato(itens, card, refFatura, estado) {
    var futuras = [];
    var lista = itens.map(function (it) {
      var t = { id: novoId(), tipo: 'despesa', forma: 'cartao', cartaoId: card.id, data: it.data, valor: it.valor, descricao: nomeBonito(it.descOriginal) || 'Compra sem nome na fatura', descOriginal: it.descOriginal,
        categoria: estado ? sugerirCategoria(estado, it.descOriginal) : 'Outros', faturaRef: refFatura, importado: true };
      if (it.credito) t.estorno = true;
      if (it.parcelas) {
        t.parcela = it.parcela; t.parcelas = it.parcelas; t.parcImportada = true; t.grupo = novoId(); t.valorTotal = arred(it.valor * it.parcelas);
        // próximas parcelas (as que ainda não existem no app)
        for (var j = it.parcela + 1; j <= it.parcelas; j++) {
          var ref = R.addMes(refFatura, j - it.parcela);
          var existe = estado && estado.tx.some(function (x) { return x.cartaoId === card.id && x.parcelas === it.parcelas && x.parcela === j && Math.abs(+x.valor - it.valor) < 0.01 && x.faturaRef === ref; });
          if (existe) continue;
          futuras.push(Object.assign({}, t, { id: novoId(), parcela: j, faturaRef: ref, futura: true }));
        }
      }
      return t;
    });
    return lista.concat(futuras);
  }

  /* Adiantar parcelas: as N últimas parcelas futuras da compra passam para a fatura "refDestino".
     Se o banco der desconto, informe quanto pagou de fato: a diferença vira um crédito na mesma fatura. */
  function parcelasAdiantaveis(estado, grupo, refDestino) {
    return estado.tx.filter(function (t) { return t.grupo === grupo && !t.estorno && (t.faturaRef || '') > refDestino; })
      .sort(function (a, b) { return a.parcela - b.parcela; });
  }
  function adiantarParcelas(estado, grupo, qtd, refDestino, valorPago) {
    var futuras = parcelasAdiantaveis(estado, grupo, refDestino);
    if (!futuras.length) return { movidas: [], credito: null };
    var mover = futuras.slice(Math.max(0, futuras.length - qtd)), soma = 0;
    mover.forEach(function (t) { t.faturaOriginal = t.faturaOriginal || t.faturaRef; t.faturaRef = refDestino; t.adiantada = true; soma += +t.valor; });
    var credito = null, base = mover[0];
    if (valorPago != null && valorPago < soma - 0.004) {
      credito = { id: novoId(), tipo: 'despesa', forma: 'cartao', cartaoId: base.cartaoId, data: base.data > estado.hoje ? estado.hoje : estado.hoje, valor: arred(soma - valorPago),
        descricao: 'Desconto por adiantar parcelas · ' + (base.descricao || ''), categoria: base.categoria, estorno: true, faturaRef: refDestino, grupoDesconto: grupo };
      if (base.divisao) credito.divisao = dividirProporcional(credito.valor, base.divisao, D.soma(base.divisao.map(function (d) { return d.valor; })));
      else if (base.pessoaId) credito.pessoaId = base.pessoaId;
    }
    return { movidas: mover, credito: credito, soma: arred(soma) };
  }

  /* relação de gastos de uma pessoa (texto para mandar) */
  function relacaoPessoa(estado, pessoaId, filtro) {
    var p = porId(estado.config.pessoas, pessoaId), linhas = [], tot = 0;
    var lista = estado.tx.filter(function (t) { return t.tipo === 'despesa' && envolvePessoa(t, pessoaId) && (!filtro || filtro(t)); })
      .sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    lista.forEach(function (t) {
      var q = 0; partesDe(t).forEach(function (x) { if (x.pessoaId === pessoaId) q += x.valor; });
      tot += q;
      var card = t.cartaoId ? porId(estado.config.cards, t.cartaoId) : null;
      linhas.push(dataTxt(t) + ' · ' + (t.descricao || t.categoria) + (t.parcelas ? ' (' + t.parcela + '/' + t.parcelas + ')' : '') + (card ? ' · ' + card.nome : '') +
        (t.divisao ? ' · sua parte de ' + D.fmt(t.valor) : '') + ' · ' + (q < 0 ? '-' : '') + D.fmt(Math.abs(q)));
    });
    return { itens: lista, total: arred(tot), texto: 'Extrato de ' + (p ? p.nome : '') + ' no cartão\n\n' + linhas.join('\n') + '\n\nTotal: ' + D.fmt(tot) };
  }

  return {
    lerExtratoTexto: lerExtratoTexto, lerExtratoOFX: lerExtratoOFX, lerExtratoCSV: lerExtratoCSV, marcarDuplicados: marcarDuplicados,
    nomeBonito: nomeBonito, lerParcela: lerParcela, sugerirCategoria: sugerirCategoria, mesRef: mesRef, mesVenc: mesVenc, dividasPessoa: dividasPessoa, relatorioPessoa: relatorioPessoa, relatorioTexto: relatorioTexto, mesEmAndamento: mesEmAndamento, itemAcertado: itemAcertado, dataTxt: dataTxt, remapearPlanilha: remapearPlanilha, parcelasAdiantaveis: parcelasAdiantaveis, adiantarParcelas: adiantarParcelas, lancamentosDoExtrato: lancamentosDoExtrato, relacaoPessoa: relacaoPessoa, dataDoExtrato: dataDoExtrato,
    contestada: contestada, novoId: novoId, porId: porId, faturaDaCompra: faturaDaCompra, diasDaFatura: diasDaFatura, datasFatura: datasFatura,
    mudarDatasCartao: mudarDatasCartao, ehCartao: ehCartao, valorDespesa: valorDespesa, faturasDoCartao: faturasDoCartao,
    fatura: fatura, statusFatura: statusFatura, precisaPagar: precisaPagar, limiteUsado: limiteUsado,
    criarLancamentos: criarLancamentos, saldoAnteriorCartao: saldoAnteriorCartao, recalcular5du: recalcular5du,
    eventos: eventos, serieSaldo: serieSaldo, saldoEm: saldoEm, rendimentoPeriodo: rendimentoPeriodo, saldoFisico: saldoFisico,
    ajustarSaldo: ajustarSaldo, buscadorTaxa: buscadorTaxa, serieCaixinha: serieCaixinha, totalCaixinhas: totalCaixinhas,
    gastosDoMes: gastosDoMes, receitasDoMes: receitasDoMes, resumoMes: resumoMes, porCategoria: porCategoria, soMeu: soMeu, porForma: porForma,
    maioresGastos: maioresGastos, nomePessoa: nomePessoa, porPessoa: porPessoa, partesDe: partesDe, envolvePessoa: envolvePessoa, temOutros: temOutros,
    dividirProporcional: dividirProporcional, descreverPessoas: descreverPessoas, devedores: devedores, comprasDaPessoa: comprasDaPessoa,
    alertas: alertas, dicas: dicas, normDesc: normDesc, exportarCSV: exportarCSV, lerCSV: lerCSV, importarCSV: importarCSV
  };
});
