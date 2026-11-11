/* relatorio-pdf.js — monta o PDF da relação de compras de uma pessoa (usa pdf-lib, na pasta vendor). */
(function () {
  'use strict';
  var R = window.Regras, D = window.Dinheiro;

  function carregarPdfLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    return new Promise(function (ok, erro) {
      var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      s.onload = function () { ok(window.PDFLib); }; s.onerror = function () { erro(new Error('Não consegui carregar o gerador de PDF')); };
      document.head.appendChild(s);
    });
  }
  /* a fonte padrão do PDF só tem letras do português/latim: tira emojis e símbolos estranhos */
  var PERMITIDOS = '–—‘’“”•…€';
  function limpo(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').split('').map(function (c) {
      var n = c.charCodeAt(0); return (n >= 32 && n <= 126) || (n >= 160 && n <= 255) || PERMITIDOS.indexOf(c) >= 0 ? c : '';
    }).join('').trim();
  }
  function hex(cor, PDFLib) {
    var n = parseInt(String(cor || '#0033a0').replace('#', ''), 16);
    if (isNaN(n)) n = 0x0033a0;
    return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  function gerar(r, opcoes) {
    opcoes = opcoes || {};
    return carregarPdfLib().then(function (PDFLib) {
      var rgb = PDFLib.rgb;
      return PDFLib.PDFDocument.create().then(function (doc) {
        doc.setTitle('Extrato de compras - ' + limpo(r.pessoa.nome) + ' - fatura de ' + R.fmtMes(r.mes));
        doc.setCreator('Minhas Finanças'); doc.setProducer('Minhas Finanças');
        return Promise.all([doc.embedFont(PDFLib.StandardFonts.Helvetica), doc.embedFont(PDFLib.StandardFonts.HelveticaBold)]).then(function (f) {
          var fonte = f[0], negrito = f[1];
          var AZUL = rgb(0, 0.2, 0.627), AZUL2 = rgb(0.04, 0.31, 0.82), TEXTO = rgb(0.04, 0.12, 0.27), CINZA = rgb(0.38, 0.45, 0.57),
            FUNDO = rgb(0.933, 0.953, 0.984), LINHA = rgb(0.88, 0.9, 0.94), VERDE = rgb(0.07, 0.53, 0.23), VERMELHO = rgb(0.83, 0.18, 0.18), BRANCO = rgb(1, 1, 1);
          var W = 595.28, H = 841.89, M = 40, pag, y, paginas = [];
          function novaPagina() { pag = doc.addPage([W, H]); paginas.push(pag); y = H - M; }
          function largura(t, tam, fn) { return (fn || fonte).widthOfTextAtSize(limpo(t), tam); }
          function texto(t, x, yy, tam, fn, cor) { pag.drawText(limpo(t), { x: x, y: yy, size: tam, font: fn || fonte, color: cor || TEXTO }); }
          function direita(t, xd, yy, tam, fn, cor) { texto(t, xd - largura(t, tam, fn), yy, tam, fn, cor); }
          function cortar(t, max, tam, fn) { t = limpo(t); if (largura(t, tam, fn) <= max) return t; while (t.length > 1 && largura(t + '…', tam, fn) > max) t = t.slice(0, -1); return t + '…'; }
          function espaco(h) { if (y - h < M + 30) { novaPagina(); cabecalhoCurto(); } }
          function retangulo(x, yy, w, h, cor, raio) {
            if (!raio) { pag.drawRectangle({ x: x, y: yy, width: w, height: h, color: cor }); return; }
            var r0 = Math.min(raio, h / 2, w / 2);
            pag.drawRectangle({ x: x + r0, y: yy, width: w - 2 * r0, height: h, color: cor });
            pag.drawRectangle({ x: x, y: yy + r0, width: w, height: h - 2 * r0, color: cor });
            [[x + r0, yy + r0], [x + w - r0, yy + r0], [x + r0, yy + h - r0], [x + w - r0, yy + h - r0]].forEach(function (c) { pag.drawCircle({ x: c[0], y: c[1], size: r0, color: cor }); });
          }
          function cabecalhoCurto() {
            texto('Extrato de compras · ' + r.pessoa.nome + ' · fatura de ' + R.fmtMes(r.mes), M, y - 4, 9, fonte, CINZA);
            y -= 22;
          }

          novaPagina();
          // ---- cabeçalho ----
          retangulo(0, H - 128, W, 128, AZUL);
          pag.drawCircle({ x: W - 40, y: H - 10, size: 90, color: AZUL2, opacity: 0.55 });
          pag.drawCircle({ x: W - 120, y: H - 120, size: 46, color: AZUL2, opacity: 0.35 });
          texto('EXTRATO DE COMPRAS NO CARTÃO', M, H - 48, 10, negrito, rgb(0.75, 0.83, 1));
          texto(r.pessoa.nome, M, H - 80, 26, negrito, BRANCO);
          texto((r.modo === 'anteriores' ? 'Valores em aberto antes da fatura de ' : 'Fatura de ') + R.fmtMes(r.mes) + (r.modo === 'atual' ? ' (só esta fatura)' : '') + (opcoes.de ? '  ·  enviado por ' + opcoes.de : ''), M, H - 104, 12, fonte, rgb(0.85, 0.9, 1));
          y = H - 128 - 22;

          // ---- resumo ----
          var linhasResumo = r.modo === 'anteriores' ? [] : [['Compras da fatura de ' + R.nomeMes(r.mes), r.totalFatura, TEXTO]];
          if (r.pendenciaMes) linhasResumo.push(['Valor em aberto desta fatura', r.pendenciaMes, TEXTO]);
          if (r.totalAnteriores) linhasResumo.push(['Em aberto de faturas anteriores', r.totalAnteriores, TEXTO]);
          if (r.pagoMes) linhasResumo.push(['Já pago desta fatura', -r.pagoMes, VERDE]);
          var hRes = 74 + linhasResumo.length * 18;
          retangulo(M, y - hRes, W - 2 * M, hRes, FUNDO, 12);
          texto('TOTAL A PAGAR', M + 18, y - 26, 9, negrito, CINZA);
          texto(D.fmt(r.total), M + 18, y - 58, 28, negrito, r.total > 0 ? AZUL : VERDE);
          var yy = y - 84;
          linhasResumo.forEach(function (l) { texto(l[0], M + 18, yy, 10.5, fonte, CINZA); direita((l[1] < 0 ? '- ' : '') + D.fmt(Math.abs(l[1])), W - M - 18, yy, 10.5, negrito, l[2]); yy -= 18; });
          y -= hRes + 26;

          // ---- tabela por cartão ----
          var cols = { data: M + 8, desc: M + 78, parc: W - M - 150, valor: W - M - 8 };
          if (!r.itens.length && r.modo !== 'anteriores') { texto('Nenhuma compra nesta fatura.', M, y, 11, fonte, CINZA); y -= 24; }
          r.porCartao.forEach(function (c) {
            espaco(70);
            pag.drawCircle({ x: M + 5, y: y + 4, size: 5, color: hex(c.cor, PDFLib) });
            texto(c.nome, M + 16, y, 13, negrito, TEXTO);
            direita(c.itens.length + (c.itens.length === 1 ? ' compra' : ' compras'), W - M, y, 9.5, fonte, CINZA);
            y -= 16;
            pag.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.8, color: LINHA });
            y -= 14;
            texto('DATA', cols.data, y, 8, negrito, CINZA); texto('COMPRA', cols.desc, y, 8, negrito, CINZA); texto('PARCELA', cols.parc, y, 8, negrito, CINZA); direita('VALOR', cols.valor, y, 8, negrito, CINZA);
            y -= 8;
            c.itens.forEach(function (i, n) {
              var temSub = i.dividido || i.obs || i.pago, h = temSub ? 30 : 20;
              espaco(h + 4);
              if (n % 2 === 0) retangulo(M, y - h + 4, W - 2 * M, h, rgb(0.97, 0.98, 0.995), 4);
              var base = y - 10;
              texto(i.data, cols.data, base, 9.5, fonte, CINZA);
              texto(cortar(i.descricao, cols.parc - cols.desc - 10, 10, negrito), cols.desc, base, 10, negrito, TEXTO);
              texto(i.parcela || 'à vista', cols.parc, base, 9.5, fonte, CINZA);
              direita(D.fmt(i.valor), cols.valor, base, 10, negrito, i.pago ? VERDE : TEXTO);
              if (temSub) {
                var sub = [i.dividido ? 'sua parte de ' + D.fmt(i.total) : '', i.pago ? 'já pago' : '', i.obs].filter(Boolean).join(' · ');
                texto(cortar(sub, cols.parc - cols.desc - 10, 8.5), cols.desc, base - 12, 8.5, fonte, i.pago ? VERDE : CINZA);
              }
              y -= h;
            });
            y -= 4;
            pag.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.8, color: LINHA });
            y -= 16;
            direita('Subtotal ' + c.nome + ':  ' + D.fmt(c.total), W - M, y, 10.5, negrito, TEXTO);
            y -= 28;
          });

          // ---- valores em aberto ----
          var abertos = r.pendenciasMes.map(function (p) { return { mes: r.mes, valor: p.valor, descricao: p.obs || 'Valor em aberto' }; }).concat(r.anteriores);
          if (abertos.length) {
            espaco(60);
            pag.drawCircle({ x: M + 5, y: y + 4, size: 5, color: VERMELHO });
            texto('Valores em aberto', M + 16, y, 13, negrito, TEXTO);
            y -= 16; pag.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.8, color: LINHA }); y -= 6;
            abertos.forEach(function (a) {
              var sub = a.pago ? 'era ' + D.fmt(a.original) + ', já pagou ' + D.fmt(a.pago) : '';
              espaco(sub ? 36 : 26);
              texto('Fatura de ' + R.fmtMes(a.mes), cols.data, y - 12, 10, negrito, TEXTO);
              texto(cortar(a.descricao, cols.valor - cols.data - 230, 9), cols.data + 150, y - 12, 9, fonte, CINZA);
              direita(D.fmt(a.valor), cols.valor, y - 12, 10, negrito, VERMELHO);
              if (sub) { texto(sub, cols.data + 150, y - 24, 8.5, fonte, VERDE); y -= 12; }
              y -= 24;
            });
            y -= 10;
          }

          // ---- pagamentos recebidos ----
          if (r.pagamentos && r.pagamentos.length) {
            espaco(60);
            pag.drawCircle({ x: M + 5, y: y + 4, size: 5, color: VERDE });
            texto('Pagamentos recebidos', M + 16, y, 13, negrito, TEXTO);
            y -= 16; pag.drawLine({ start: { x: M, y: y }, end: { x: W - M, y: y }, thickness: 0.8, color: LINHA }); y -= 6;
            r.pagamentos.forEach(function (q) {
              espaco(24);
              texto(R.fmtData(q.data), cols.data, y - 12, 10, negrito, TEXTO);
              if (q.mes) texto('abatido da fatura de ' + R.fmtMes(q.mes), cols.data + 150, y - 12, 9, fonte, CINZA);
              direita('- ' + D.fmt(q.valor), cols.valor, y - 12, 10, negrito, VERDE);
              y -= 22;
            });
            y -= 10;
          }

          // ---- total final ----
          espaco(50);
          retangulo(M, y - 40, W - 2 * M, 40, AZUL, 10);
          texto('Total a pagar', M + 16, y - 25, 12, negrito, BRANCO);
          direita(D.fmt(r.total), W - M - 16, y - 26, 16, negrito, BRANCO);
          y -= 60;
          if (opcoes.pix) { espaco(20); texto('Pix para pagamento: ' + opcoes.pix, M, y, 10.5, negrito, TEXTO); y -= 18; }

          // ---- rodapé ----
          var hoje = R.fmtData(R.hoje());
          paginas.forEach(function (p, i) {
            p.drawLine({ start: { x: M, y: 34 }, end: { x: W - M, y: 34 }, thickness: 0.5, color: LINHA });
            p.drawText(limpo('Gerado em ' + hoje + ' pelo app Minhas Finanças'), { x: M, y: 20, size: 8, font: fonte, color: CINZA });
            var t = 'Página ' + (i + 1) + ' de ' + paginas.length;
            p.drawText(t, { x: W - M - fonte.widthOfTextAtSize(t, 8), y: 20, size: 8, font: fonte, color: CINZA });
          });
          return doc.save();
        });
      });
    });
  }
  window.RelatorioPDF = { gerar: gerar };
})();
