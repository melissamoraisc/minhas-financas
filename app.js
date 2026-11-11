/* app.js — telas do Minhas Finanças (JavaScript puro, sem framework). */
(function () {
  'use strict';
  var R = window.Regras, D = window.Dinheiro, C = window.Calculos, G = window.Graficos;

  /* ===================== ESTADO ===================== */
  var CATS_PADRAO = [
    ['Moradia', '#5b6cf0', ''], ['Mercado', '#12a150', ''], ['Alimentação fora', '#f08a24', ''], ['Transporte', '#0a84ff', ''],
    ['Saúde', '#e5484d', ''], ['Educação', '#8e4ec6', ''], ['Lazer', '#ff6b9a', ''], ['Compras', '#d19a00', ''],
    ['Assinaturas', '#00a3a3', ''], ['Contas', '#6e7b91', ''], ['Outros', '#9aa5b8', '•']
  ];
  var RCATS_PADRAO = [['Salário', '#12873a', ''], ['Extra', '#0a84ff', ''], ['Reembolso', '#8e4ec6', ''], ['Outros', '#9aa5b8', '•']];
  var CORES_PESSOA = ['#e5484d', '#8e4ec6', '#f08a24', '#00a3a3', '#d19a00', '#5b6cf0', '#ff6b9a', '#12a150'];
  var FORMAS = { pix: 'Pix', cartao: 'Cartão', debito: 'Débito', dinheiro: 'Dinheiro' };

  function configVazia() {
    return {
      versao: 1, nome: 'Minhas Finanças', saldoRef: 0, saldoRefData: R.hoje(), cards: [],
      cats: CATS_PADRAO.map(function (c) { return { nome: c[0], cor: c[1], ico: c[2] }; }),
      rcats: RCATS_PADRAO.map(function (c) { return { nome: c[0], cor: c[1], ico: c[2] }; }),
      pessoas: [], grupos: [], pendencias: [], fatPagas: {}, rend: { ativo: false, pct: 100, fator: 1, ajustes: [] }, caixinhas: [], depositos: [],
      calendario: { feriados: [], carnaval: false, corpus: false, sabadoUtil: false }, prefs: {}, comecou: false
    };
  }
  /* começa já com os 4 cartões e as pessoas que usam (datas dos cartões: conferir) */
  function configPadrao() { return configVazia(); }
  var est = { config: configVazia(), tx: [], cdi: {}, hoje: R.hoje() };
  var ui = { aba: 'painel', mes: R.addMes(R.mesDe(R.hoje()), 1), ocultar: false, filtros: {}, verFiltros: false, ordem: { col: 'data', asc: false }, cardSel: null, busca: '' };

  /* ===================== ARMAZENAMENTO ===================== */
  /* Prévia: guarda no navegador. Versão instalada: troca por chamadas ao servidor (/api). */
  var CHAVE = 'minhas-financas-v4', memoria = null;
  var Armazem = {
    carregar: function () {
      var txt = null;
      try { txt = localStorage.getItem(CHAVE); } catch (e) { txt = memoria; }
      if (!txt) return null;
      try { return JSON.parse(txt); } catch (e) { return null; }
    },
    gravar: function () {
      var txt = JSON.stringify({ config: est.config, tx: est.tx, atualizadoEm: est.atualizadoEm || 0 });
      try { localStorage.setItem(CHAVE, txt); } catch (e) { memoria = txt; }
    },
    apagar: function () { try { localStorage.removeItem(CHAVE); } catch (e) { memoria = null; } }
  };
  var silencioso = false;
  function salvar() { if (!silencioso) est.atualizadoEm = Date.now(); Armazem.gravar(); if (!silencioso && typeof Nuvem !== 'undefined') Nuvem.agendar(); }
  function normalizar(cfg) {
    var base = configVazia();
    Object.keys(base).forEach(function (k) { if (cfg[k] == null) cfg[k] = base[k]; });
    ['feriados'].forEach(function (k) { if (!cfg.calendario[k]) cfg.calendario[k] = []; });
    if (!cfg.rend.ajustes) cfg.rend.ajustes = [];
    return cfg;
  }

  /* Cofre no GitHub: os dados ficam num repositório PRIVADO seu (pasta dados/), acessado com uma chave sua.
     Mesmo formato dos documentos da conta do Claude: meta, config, img-*, tx-AAAA-MM. */
  var GitHub = {
    CHAVE: 'mf-cofre-github',
    cfg: function () { try { return JSON.parse(localStorage.getItem(this.CHAVE) || 'null'); } catch (e) { return null; } },
    salvarCfg: function (c) { try { if (c) localStorage.setItem(this.CHAVE, JSON.stringify(c)); else localStorage.removeItem(this.CHAVE); } catch (e) { } },
    shas: {},
    enc: function (s) { return btoa(unescape(encodeURIComponent(s))); },
    dec: function (b) { return decodeURIComponent(escape(atob(String(b).replace(/\s/g, '')))); },
    hdr: function (c) { return { Authorization: 'Bearer ' + c.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; },
    url: function (c, k) { return 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + '/contents/dados/' + k + '.json'; },
    erro: function (r) { var e = new Error('GitHub respondeu ' + r.status); e.status = r.status; e.code = r.status === 401 || r.status === 403 ? 'not_granted' : 'unavailable'; return e; },
    testar: function (c) {
      return fetch('https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo), { headers: this.hdr(c), cache: 'no-store' }).then(function (r) {
        if (r.status === 404) throw new Error('Repositório não encontrado (confira o nome e se a chave tem acesso a ele)');
        if (r.status === 401) throw new Error('Chave inválida ou vencida');
        if (!r.ok) throw new Error('GitHub respondeu ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j.private) throw new Error('O repositório precisa ser PRIVADO para guardar seus dados');
        if (j.permissions && !j.permissions.push) throw new Error('A chave não tem permissão de escrita');
        return true;
      });
    },
    ref: function (k) {
      var self = this, c = self.cfg();
      function ler() {
        return fetch(self.url(c, k), { headers: self.hdr(c), cache: 'no-store' }).then(function (r) {
          if (r.status === 404) { delete self.shas[k]; return null; }
          if (!r.ok) throw self.erro(r);
          return r.json().then(function (j) { self.shas[k] = j.sha; return j; });
        });
      }
      return {
        get: function () { return ler().then(function (j) { var o = j && j.content ? JSON.parse(self.dec(j.content)) : null; return { exists: !!o, data: function () { return o || undefined; } }; }); },
        set: function (obj) {
          var tentativa = 0;
          function put() {
            var corpo = { message: 'Atualiza ' + k, content: self.enc(JSON.stringify(obj)) };
            if (self.shas[k]) corpo.sha = self.shas[k];
            return fetch(self.url(c, k), { method: 'PUT', headers: self.hdr(c), body: JSON.stringify(corpo) }).then(function (r) {
              if ((r.status === 409 || r.status === 422) && tentativa++ < 2) return ler().then(put);
              if (!r.ok) throw self.erro(r);
              return r.json().then(function (j) { self.shas[k] = j.content.sha; });
            });
          }
          return self.shas[k] ? put() : ler().then(put);
        },
        delete: function () {
          return (self.shas[k] ? Promise.resolve({ sha: self.shas[k] }) : ler()).then(function (j) {
            if (!j) return;
            return fetch(self.url(c, k), { method: 'DELETE', headers: self.hdr(c), body: JSON.stringify({ message: 'Remove ' + k, sha: j.sha || self.shas[k] }) }).then(function (r) { if (!r.ok && r.status !== 404) throw self.erro(r); delete self.shas[k]; });
          });
        }
      };
    }
  };

  /* ===================== SINCRONIZAÇÃO (sua conta do Claude) =====================
     Os dados ficam numa área privada da sua conta (data/users/<seu id>/), divididos em documentos:
     meta (data da última alteração), config, img-<cartão> (fotos) e tx-AAAA-MM (lançamentos do mês).
     Vale a versão mais recente: abriu no celular, puxa o que foi feito no computador, e vice-versa. */
  var Nuvem = {
    db: null, base: null, status: 'iniciando', ultimo: null, enviados: {}, timer: null, enviando: false, pendente: false, metaVista: 0,
    modo: null,
    ref: function (k) { return this.modo === 'github' ? GitHub.ref(k) : this.db.collection(this.base).doc(k); },
    docs: function () {
      var out = {}, cfg = JSON.parse(JSON.stringify(est.config)), imgs = {};
      (cfg.cards || []).forEach(function (c) { if (c.img) { imgs['img-' + c.id] = { img: c.img }; c.img = '__nuvem__'; } });
      out.config = { config: cfg };
      Object.keys(imgs).forEach(function (k) { out[k] = imgs[k]; });
      var porMes = {};
      est.tx.forEach(function (t) { var k = 'tx-' + (t.data || '0000-00').slice(0, 7); (porMes[k] = porMes[k] || []).push(t); });
      Object.keys(porMes).forEach(function (k) {
        var lista = porMes[k].slice().sort(function (a, b) { return a.id < b.id ? -1 : 1; }), partes = [[]], tam = 0;
        lista.forEach(function (t) { var s = JSON.stringify(t).length; if (tam + s > 180000) { partes.push([]); tam = 0; } partes[partes.length - 1].push(t); tam += s; });
        partes.forEach(function (p, i) { out[k + (i ? '-' + i : '')] = { tx: p }; });
      });
      return out;
    },
    iniciar: function () {
      var self = this;
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && self.base) self.puxar(false); });
      if (GitHub.cfg()) {   // cofre no GitHub configurado neste aparelho
        self.modo = 'github'; self.base = 'github'; self.status = 'iniciando';
        return self.puxar(true).catch(function (e) { console.error(e); self.status = 'erro'; render(); });
      }
      if (!window.claude || !window.claude.use) { self.status = 'indisponivel'; return; }
      self.modo = 'claude';
      var limite = setTimeout(function () { if (self.status === 'iniciando') { self.status = 'indisponivel'; render(); } }, 12000);
      window.claude.use('db').then(function (db) {
        if (!db) { clearTimeout(limite); self.status = 'indisponivel'; render(); return null; }
        self.db = db;
        return window.claude.use('user').then(function (u) { return u ? u.id() : null; });
      }).then(function (uid) {
        if (!self.db) return;
        if (!uid) { clearTimeout(limite); self.status = 'indisponivel'; render(); return; }
        self.base = 'data/users/' + uid;
        return self.puxar(true).then(function () { clearTimeout(limite); });
      }).catch(function (e) { clearTimeout(limite); console.error(e); self.status = 'erro'; render(); });
    },
    puxar: function (primeira) {
      var self = this;
      return self.ref('meta').get().then(function (m) {
        var meta = m.exists ? m.data() : null, local = +est.atualizadoEm || 0;
        if (!meta) { self.status = 'ok'; return self.enviarAgora(); }               // nuvem vazia: sobe o que tem aqui
        self.metaVista = +meta.atualizadoEm || 0;
        if (self.metaVista > local || (primeira && self.metaVista === local && !local)) {
          var chaves = ['config'].concat(meta.chaves || []);
          return Promise.all(chaves.map(function (k) { return self.ref(k).get(); })).then(function (snaps) {
            var dados = {}, tx = [];
            snaps.forEach(function (s, i) { if (s.exists) dados[chaves[i]] = s.data(); });
            if (!dados.config) { self.status = 'ok'; return self.enviarAgora(); }
            var cfg = JSON.parse(JSON.stringify(dados.config.config));
            (cfg.cards || []).forEach(function (c) { if (c.img === '__nuvem__') c.img = dados['img-' + c.id] ? dados['img-' + c.id].img : ''; });
            Object.keys(dados).forEach(function (k) { if (k.indexOf('tx-') === 0) tx = tx.concat(dados[k].tx || []); });
            est.config = normalizar(cfg); est.tx = tx; est.atualizadoEm = self.metaVista;
            self.enviados = {}; var d = self.docs(); Object.keys(d).forEach(function (k) { self.enviados[k] = JSON.stringify(d[k]); });
            Armazem.gravar(); self.status = 'ok'; self.ultimo = new Date(); render();
            if (!primeira) toast('Dados atualizados com o outro aparelho');
          });
        }
        self.status = 'ok';
        if (local > self.metaVista) return self.enviarAgora();
        if (primeira) { var d2 = self.docs(); Object.keys(d2).forEach(function (k) { self.enviados[k] = JSON.stringify(d2[k]); }); }
        self.ultimo = new Date(); render();
      });
    },
    agendar: function () {
      var self = this; if (!self.base) return;
      clearTimeout(self.timer); self.timer = setTimeout(function () { self.enviarAgora(); }, 1500);
    },
    enviarAgora: function () {
      var self = this; if (!self.base) return Promise.resolve();
      if (self.enviando) { self.pendente = true; return Promise.resolve(); }
      self.enviando = true; self.status = 'enviando';
      var docs = self.docs(), chaves = Object.keys(docs), mudou = chaves.filter(function (k) { return self.enviados[k] !== JSON.stringify(docs[k]); });
      var apagar = Object.keys(self.enviados).filter(function (k) { return !docs[k] && k !== 'meta'; });
      var p = Promise.resolve();
      mudou.forEach(function (k) { p = p.then(function () { return self.ref(k).set(docs[k]).then(function () { self.enviados[k] = JSON.stringify(docs[k]); }); }); });
      apagar.forEach(function (k) { p = p.then(function () { return self.ref(k).delete().then(function () { delete self.enviados[k]; }); }); });
      return p.then(function () {
        var at = est.atualizadoEm != null ? +est.atualizadoEm : Date.now(); est.atualizadoEm = at; // aparelho novo sem alterações sobe com 0: perde para quem já tem dados
        return self.ref('meta').set({ atualizadoEm: at, chaves: chaves.filter(function (k) { return k !== 'config'; }), versao: 1 });
      }).then(function () {
        self.metaVista = est.atualizadoEm; self.status = 'ok'; self.ultimo = new Date(); Armazem.gravar();
      }).catch(function (e) {
        console.error(e); self.status = 'erro';
        if (e && e.code === 'quota_exceeded') toast('Espaço da sincronização cheio');
      }).then(function () {
        self.enviando = false; render();
        if (self.pendente) { self.pendente = false; self.agendar(); }
      });
    },
    texto: function () {
      var onde = this.modo === 'github' ? 'seu cofre no GitHub' : 'sua conta do Claude';
      return { iniciando: 'Conectando…', ok: 'Sincronizado com ' + onde + (this.ultimo ? ' · ' + R.pad(this.ultimo.getHours()) + ':' + R.pad(this.ultimo.getMinutes()) : ''), enviando: 'Salvando na sua conta…',
        indisponivel: 'Sem sincronização: os dados ficam só neste aparelho. Conecte o cofre do GitHub abaixo.', erro: 'Não foi possível sincronizar agora. Os dados estão salvos neste aparelho.' }[this.status] || '';
    }
  };

  /* ===================== UTILITÁRIOS ===================== */
  function $(s, el) { return (el || document).querySelector(s); }
  function $$(s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function moeda(n, cls) {
    var p = D.partes(n);
    return '<span class="valor ' + (cls || '') + '">' + p.sinal + '<span class="rs">R$</span>' + p.reais + '<small>,' + p.centavos + '</small></span>';
  }
  function moedaTxt(n) { return D.fmt(n); }
  function cat(nome, receita) {
    var l = receita ? est.config.rcats : est.config.cats, k = null;
    for (var i = 0; i < l.length; i++) if (l[i].nome === nome) k = l[i];
    k = k || { nome: nome || 'Outros', cor: '#9aa5b8' };
    return { nome: k.nome, cor: k.cor, ico: '<span style="color:' + k.cor + ';font-weight:700">' + esc((k.nome || '?').charAt(0).toUpperCase()) + '</span>' };
  }
  function ativas() { return est.config.pessoas.filter(function (p) { return !p.arquivada; }); }
  function card(id) { return C.porId(est.config.cards, id); }
  function pessoa(id) { return id && id !== 'eu' ? C.porId(est.config.pessoas, id) : { id: 'eu', nome: 'Eu', cor: '#0a4fd1' }; }
  function iniciais(n) { return String(n || '?').trim().split(/\s+/).map(function (p) { return p[0]; }).slice(0, 2).join('').toUpperCase(); }
  function avatar(p, peq) { return '<span class="pessoa-av" style="background:' + (p.cor || '#0a4fd1') + (peq ? ';width:24px;height:24px;font-size:10px' : '') + '">' + esc(iniciais(p.nome)) + '</span>'; }
  function toast(msg) {
    var t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  }
  function hojeStr() { return est.hoje; }
  var ICO = {
    painel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5.5" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/><rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2"/></svg>',
    lanc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="3.5" cy="6" r="1.2" fill="currentColor"/><circle cx="3.5" cy="12" r="1.2" fill="currentColor"/><circle cx="3.5" cy="18" r="1.2" fill="currentColor"/></svg>',
    receitas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v14M6 11l6 6 6-6"/><path d="M4 21h16"/></svg>',
    cartoes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/></svg>',
    caixinhas: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h16v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M3 4h18v4H3zM10 12h4"/></svg>',
    ajustes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    olho: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    olhoX: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>',
    sino: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    sol: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2M12 20.5v2M4.6 4.6 6 6M18 18l1.4 1.4M1.5 12h2M20.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
    lua: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    mais: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    fechar: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    seta: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>',
    lupa: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>'
  };
  /* ilustrações "3D" dos cantos dos cartões */
  function ilus(tipo) { return ''; }
  function ilusAntiga(tipo) {
    var g = '<defs><linearGradient id="ga' + tipo + '" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7fb0ff"/><stop offset="1" stop-color="#0a4fd1"/></linearGradient><linearGradient id="gb' + tipo + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff" stop-opacity=".9"/><stop offset="1" stop-color="#cfe0ff" stop-opacity=".6"/></linearGradient></defs>';
    var c = {
      carteira: '<rect x="18" y="30" width="62" height="44" rx="12" fill="url(#ga' + tipo + ')"/><rect x="24" y="22" width="46" height="16" rx="6" fill="url(#gb' + tipo + ')" transform="rotate(-8 47 30)"/><rect x="56" y="44" width="28" height="16" rx="8" fill="#0033a0" opacity=".85"/><circle cx="66" cy="52" r="3.5" fill="#fff"/>',
      pizza: '<circle cx="50" cy="50" r="28" fill="url(#ga' + tipo + ')"/><path d="M50 50 L50 22 A28 28 0 0 1 76 40 Z" fill="url(#gb' + tipo + ')" transform="translate(4 -4)"/>',
      cartao: '<rect x="16" y="34" width="60" height="40" rx="8" fill="#0033a0" opacity=".5" transform="rotate(-12 46 54)"/><rect x="24" y="28" width="60" height="40" rx="8" fill="url(#ga' + tipo + ')"/><rect x="30" y="38" width="12" height="9" rx="2" fill="#ffd77a"/><rect x="30" y="56" width="30" height="4" rx="2" fill="#fff" opacity=".7"/>',
      grafico: '<rect x="20" y="52" width="13" height="24" rx="4" fill="url(#gb' + tipo + ')"/><rect x="38" y="38" width="13" height="38" rx="4" fill="url(#ga' + tipo + ')"/><rect x="56" y="26" width="13" height="50" rx="4" fill="url(#ga' + tipo + ')"/>',
      cofre: '<rect x="20" y="30" width="58" height="46" rx="12" fill="url(#ga' + tipo + ')"/><circle cx="49" cy="53" r="12" fill="url(#gb' + tipo + ')"/><circle cx="49" cy="53" r="4" fill="#0033a0"/>',
      receita: '<circle cx="50" cy="52" r="26" fill="url(#ga' + tipo + ')"/><path d="M50 36v32M40 58l10 10 10-10" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
      pessoas: '<circle cx="38" cy="40" r="11" fill="url(#ga' + tipo + ')"/><path d="M18 76a20 20 0 0 1 40 0z" fill="url(#ga' + tipo + ')"/><circle cx="62" cy="44" r="9" fill="url(#gb' + tipo + ')"/><path d="M46 78a16 16 0 0 1 32 0z" fill="url(#gb' + tipo + ')"/>'
    }[tipo] || '';
    return '<svg class="ilus" viewBox="0 0 100 100" aria-hidden="true">' + g + c + '</svg>';
  }

  /* ===================== CICLO DE TELA ===================== */
  var ABAS = [['painel', 'Painel'], ['lancamentos', 'Lançamentos'], ['cartoes', 'Cartões'], ['devendo', 'Cobranças'], ['receitas', 'Entradas'], ['caixinhas', 'Reservas'], ['ajustes', 'Ajustes']];
  var ICO_ABA = { devendo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 8v6M14 11h6"/></svg>', painel: ICO.painel, lancamentos: ICO.lanc, receitas: ICO.receitas, cartoes: ICO.cartoes, caixinhas: ICO.caixinhas, ajustes: ICO.ajustes };

  function render() {
    est.hoje = R.hoje();
    document.title = est.config.nome || 'Minhas Finanças';
    $('#marca-nome').textContent = est.config.nome || 'Minhas Finanças';
    $$('[data-aba]').forEach(function (b) { if (b.getAttribute('data-aba') === ui.aba) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    var titulo = (ABAS.filter(function (a) { return a[0] === ui.aba; })[0] || [])[1];
    $('#titulo').textContent = titulo;
    var prox = C.mesEmAndamento(est);
    $('#mes-txt').textContent = window.innerWidth <= 480 ? 'Fatura ' + R.nomeMes(ui.mes, true) + '/' + ui.mes.slice(0, 4) : 'Fatura de ' + R.fmtMes(ui.mes);
    $('#btn-prox').setAttribute('aria-pressed', ui.mes === prox);
    $('#mesnav').classList.toggle('oculto', ui.aba === 'ajustes' || ui.aba === 'caixinhas' || ui.aba === 'devendo');
    var al = C.alertas(est, est.hoje);
    $('#badge').textContent = al.length; $('#badge').classList.toggle('oculto', !al.length);
    $('#btn-olho').innerHTML = ui.ocultar ? ICO.olhoX : ICO.olho;
    $('#btn-olho').setAttribute('aria-pressed', ui.ocultar);
    document.body.classList.toggle('ocultar-valores', ui.ocultar);
    $('#btn-tema').innerHTML = document.documentElement.getAttribute('data-tema') === 'escuro' ? ICO.sol : ICO.lua;
    var html = '';
    if (!est.config.comecou && !est.tx.length && ui.aba === 'painel') html = telaComece();
    else html = ({ painel: telaPainel, lancamentos: telaLancamentos, receitas: telaReceitas, devendo: telaDevendo, cartoes: telaCartoes, caixinhas: telaCaixinhas, ajustes: telaAjustes })[ui.aba]();
    $('#conteudo').innerHTML = (est.config.exemplo ? '<div class="faixa"><span style="flex:1">Você está vendo <b>dados de exemplo</b> para conhecer o app.</span><button class="btn peq neu" data-acao="apagar-exemplo">Apagar e começar do zero</button></div>' : '') + html;
  }

  /* ===================== COMECE POR AQUI ===================== */
  function telaComece() {
    return '<div class="bloco com-ilus" style="max-width:640px;margin:0 auto">' + ilus('carteira') +
      '<h2>Primeiros passos</h2><p class="sub">Configure o essencial para começar.</p>' +
      '<ul class="lista">' +
      '<li class="clicavel" data-acao="ir-sync"><span class="ico-cat" style="background:#e8f0ff">0</span><span class="t"><b>Conectar o cofre</b><span>Traz seus dados e sincroniza computador e celular</span></span>' + ICO.seta + '</li>' +
      '<li class="clicavel" data-acao="ajustar-saldo"><span class="ico-cat" style="background:#e8f0ff">1</span><span class="t"><b>Quanto tem na conta hoje?</b><span>É o ponto de partida do saldo</span></span>' + ICO.seta + '</li>' +
      '<li class="clicavel" data-acao="aba" data-aba="cartoes"><span class="ico-cat" style="background:#e8f0ff">2</span><span class="t"><b>Confira seus 4 cartões</b><span>Coloque o dia do fechamento, do vencimento e o limite</span></span>' + ICO.seta + '</li>' +
      '<li class="clicavel" data-acao="importar"><span class="ico-cat" style="background:#e8f0ff">3</span><span class="t"><b>Importe a fatura de um cartão</b><span>PDF, planilha ou texto copiado · depois separe de quem é cada compra</span></span>' + ICO.seta + '</li>' +
      '</ul><div class="linha-flex" style="margin-top:14px"><span class="espaco"></span><button class="btn pri" data-acao="comecar">Ir para o painel</button></div></div>';
  }

  /* ===================== PAINEL ===================== */
  function telaPainel() {
    var hoje = est.hoje, mes = ui.mes, fimMes = R.dataNoMes(mes, 31);
    var serie = C.serieSaldo(est, R.addMes(R.mesDe(hoje), -1) + '-01', R.dataNoMes(R.addMes(R.mesDe(hoje), 6), 31), hoje);
    var saldoHoje = serie.saldo[hoje], saldoFim = C.saldoEm(est, fimMes, hoje);
    var rs = C.resumoMes(est, mes, hoje), fis = C.saldoFisico(est, hoje, hoje), cx = C.totalCaixinhas(est, hoje);
    var h = '<div class="grade">';
    // saldo
    h += '<section class="bloco c7 com-ilus">' + ilus('carteira') + '<h2>Saldo em conta hoje</h2><p class="sub">' + R.fmtData(hoje) + ' · toque para ver os gastos de hoje</p>' +
      '<div class="linha-flex"><button class="grande toque" data-acao="det-hoje" style="text-align:left">' + moeda(saldoHoje, saldoHoje < 0 ? 'neg' : '') + '</button><button class="btn peq sec" data-acao="ajustar-saldo">Ajustar</button></div>' +
      '<div class="mut" style="margin-top:6px;font-size:14px">Previsto para o fim de ' + R.nomeMes(mes) + ': <b class="' + (saldoFim < 0 ? 'neg' : '') + '">' + moeda(saldoFim) + '</b>' +
      (cx ? ' · Conta + reservas: <b>' + moeda(saldoHoje + cx) + '</b>' : '') + '</div>' +
      G.barraDividida([{ nome: 'Meus gastos', valor: rs.meu, cor: '#e5484d' }, { nome: 'De outras pessoas', valor: rs.deOutros, cor: '#f0b44c' }, { nome: 'Sobra', valor: Math.max(0, rs.receitaTotal - rs.meu), cor: '#12a150' }]) +
      '<div class="indicadores" style="margin-top:4px">' +
      ind('Recebido', rs.recebido, '#12a150', 'det-recebido') + ind('Meus gastos', rs.meu, '#e5484d', 'det-gasto') +
      ind('Saiu da conta', rs.saiuDaConta, '#f08a24', 'det-saiu') + ind('Resultado', rs.resultado, rs.resultado >= 0 ? '#0a84ff' : '#e5484d', 'det-resultado') +
      '</div>' + (rs.deOutros > 0 ? '<p class="mut" style="font-size:13px;margin:10px 0 0">Nos cartões, o total do mês é ' + moeda(rs.gasto) + ': ' + moeda(rs.meu) + ' seus e ' + moeda(rs.deOutros) + ' de outras pessoas.</p>' : '') + '</section>';
    // para onde foi
    h += blocoCategorias(mes);
    // cartões
    // cartões: ficam só na aba Cartões (pedido da usuária)
    // quem me deve
    var dev = C.devedores(est).filter(function (p) { return Math.abs(p.deve) > 0.009; }).sort(function (a, b) { return b.deve - a.deve; });
    if ((est.config.pessoas || []).length) {
      h += '<section class="bloco c5">' + '<div class="cab"><div><h2>Valores a receber</h2><p class="sub">Até a fatura de ' + R.nomeMes(C.mesEmAndamento(est)) + ', descontados os pagamentos recebidos</p></div><button class="link" data-acao="aba" data-aba="devendo">Ver tudo</button></div>' +
        (dev.length ? '<ul class="lista">' + dev.map(function (p) { return '<li class="clicavel" data-acao="ver-pessoa" data-id="' + p.id + '">' + avatar(p) + '<span class="t"><b>' + esc(p.nome) + '</b><span>' + (p.futuro > 0.009 ? 'Próximas faturas: ' + moedaTxt(p.futuro) : 'Sem parcelas futuras') + '</span></span><span class="v ' + (p.deve > 0 ? 'neg' : 'pos') + '">' + moeda(p.deve) + '</span></li>'; }).join('') + '</ul>'
          : vazio('Ninguém te deve nada', 'Escolha a pessoa ao lançar uma compra')) + '</section>';
    }
    // gráficos
    h += blocoGraficos(serie);
    // contas a pagar / a receber
    h += blocoContas(mes);
    // resumo e economizar (recolhíveis)
    h += '<section class="bloco c6"><details class="recolher"><summary aria-expanded="false"><h2>Resumo financeiro</h2><span class="seta">' + ICO.seta + '</span></summary>' + resumoFin(mes, rs, saldoHoje, cx, fis) + '</details></section>';
    var dc = C.dicas(est, mes, hoje);
    h += '<section class="bloco c6"><details class="recolher"><summary aria-expanded="false"><h2>Análise de gastos <span class="chip az">' + dc.length + '</span></h2><span class="seta">' + ICO.seta + '</span></summary>' +
      (dc.length ? '<ul class="lista">' + dc.map(function (d) { return '<li><span class="ico-cat" style="background:var(--surface-2)">' + ({ peso: '', subiu: '', repetida: '', assinatura: '', parcelas: '', duplicado: '', negativo: '' }[d.tipo] || '') + '</span><span class="t" style="white-space:normal">' + esc(d.texto) + '</span></li>'; }).join('') + '</ul>' : vazio('Nada para apontar agora', '')) + '</details></section>';
    return h + '</div>';
  }
  function mv(cardId, ref) { return C.mesVenc(est, cardId, ref); }
  function escopo(lista) { return ui.escopo === 'todos' ? lista : C.soMeu(lista); }
  function segEscopo() { return '<div class="seg" role="group"><button aria-pressed="' + (ui.escopo !== 'todos') + '" data-acao="escopo" data-v="meus">Meus</button><button aria-pressed="' + (ui.escopo === 'todos') + '" data-acao="escopo" data-v="todos">Todos</button></div>'; }
  function ind(rot, v, cor, acao) { return '<button class="ind toque" data-acao="' + acao + '"><span class="r"><i style="background:' + cor + '"></i>' + rot + '</span><div class="v">' + moeda(v) + '</div></button>'; }
  function vazio(t, s) { return '<div class="vazio"><b>' + esc(t) + '</b>' + esc(s || '') + '</div>'; }
  function resumoFin(mes, rs, saldoHoje, cx, fis) {
    var parcFut = 0; est.tx.forEach(function (t) { if (t.parcelas && !t.saldoInicial && t.data > R.dataNoMes(mes, 31)) parcFut += +t.valor; });
    var aPagar = 0; est.config.cards.forEach(function (c) { var fs = C.faturasDoCartao(est, c.id); Object.keys(fs).forEach(function (r) { if (C.precisaPagar(fs[r])) aPagar += fs[r].total; }); });
    var rows = [['Entradas do mês', rs.receitaTotal], ['Gastos do mês', -rs.gasto], ['Resultado', rs.resultado], ['Saldo em conta hoje', saldoHoje], ['Nas caixinhas', cx], ['Dinheiro físico', fis], ['Faturas em aberto (todas)', -aPagar], ['Parcelas futuras', -parcFut]];
    return '<ul class="lista">' + rows.map(function (r) { return '<li><span class="t">' + r[0] + '</span><span class="v ' + (r[1] < 0 ? 'neg' : '') + '">' + moeda(r[1]) + '</span></li>'; }).join('') + '</ul>';
  }

  function ccHtml(c, extra, estiloExtra) {
    var bg = c.img ? 'background-image:url(' + c.img + ')' : 'background:linear-gradient(135deg,' + (c.cor || '#0a4fd1') + ',' + escurecer(c.cor || '#0a4fd1') + ')';
    return '<button class="cc toque' + (c.img ? ' foto' : '') + (extra || '') + '" style="' + bg + ';' + (estiloExtra || '') + '" data-acao="sel-cartao" data-id="' + c.id + '" aria-label="Cartão ' + esc(c.nome) + '">' +
      (c.img ? '<span></span>' : '<span class="b">' + esc(c.banco || c.nome) + '</span>') + (c.img ? '' : '<span class="chipcc"></span>') +
      (estiloExtra ? '' : '<span class="n">' + esc(c.nome) + (c.modelo && c.nome.indexOf(c.modelo) < 0 ? ' · ' + esc(c.modelo) : '') + '</span>' + (c.bandeira && !c.img ? '<span class="band">' + esc(c.bandeira) + '</span>' : '')) + '</button>';
  }
  function escurecer(hex) {
    var n = parseInt(hex.slice(1), 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return 'rgb(' + Math.round(r * .55) + ',' + Math.round(g * .55) + ',' + Math.round(b * .55) + ')';
  }
  function blocoCartoesPainel() {
    var cards = est.config.cards;
    if (!cards.length) return '<section class="bloco c7 com-ilus">' + ilus('cartao') + '<h2>Cartões</h2><p class="sub">Nenhum cartão cadastrado</p><button class="btn sec" data-acao="novo-cartao">+ Novo cartão</button></section>';
    if (!ui.cardSel || !card(ui.cardSel)) ui.cardSel = cards[0].id;
    var c = card(ui.cardSel), ref = C.faturaDaCompra(c, est.hoje);
    // fatura a pagar mais urgente: a mais antiga não paga, senão a aberta
    var fs = C.faturasDoCartao(est, c.id), pend = Object.keys(fs).sort().filter(function (r) { return C.precisaPagar(fs[r]) && r <= ref; });
    var f = pend.length ? fs[pend[0]] : C.fatura(est, c.id, ref), st = C.statusFatura(est, f, est.hoje);
    var h = '<section class="bloco c7"><div class="cab"><div><h2>Cartões</h2><p class="sub">Arraste para trocar de cartão</p></div><button class="link" data-acao="aba" data-aba="cartoes">Ver todos</button></div>' +
      '<div class="carrossel">' + cards.map(function (x) { return ccHtml(x, x.id === c.id ? ' sel' : ''); }).join('') + '</div>' +
      '<div class="cab" style="align-items:center"><div><div class="mut" style="font-size:13px">Fatura de ' + R.nomeMes(mv(c.id, f.ref)) + ' · ' + chipStatus(st) + '</div><div class="medio">' + moeda(f.total) + '</div>' +
      '<div class="mut" style="font-size:13px">vence ' + R.fmtDiaMes(f.vencimento) + (f.adiada ? ' (' + R.DIAS[R.diaSemana(f.vencimento)] + ') · pagar até ' + R.fmtDiaMes(f.pagarAte) : '') + '</div></div>' +
      '<div class="linha-flex">' + (C.precisaPagar(f) && f.ref <= ref ? '<button class="btn pri peq" data-acao="pagar-fatura" data-id="' + c.id + '" data-ref="' + f.ref + '">Marcar como paga</button>' : '') + '<button class="btn neu peq" data-acao="ver-fatura" data-id="' + c.id + '" data-ref="' + f.ref + '">Detalhes</button></div></div>';
    var pp = C.porPessoa(f.itens), chaves = Object.keys(pp).filter(function (k) { return Math.abs(pp[k]) > .009; });
    if (chaves.length > 1 || (chaves.length === 1 && chaves[0] !== 'eu')) h += '<div class="chips" style="margin-top:10px">' + chaves.map(function (k) { var p = pessoa(k) || { nome: '?' }; return '<span class="chip">' + esc(p.nome) + ' ' + moedaTxt(pp[k]) + '</span>'; }).join('') + '</div>';
    h += '<div class="rot" style="margin-top:14px">Próximas faturas</div><ul class="lista">';
    for (var i = f.ref === ref ? 1 : 0, ate = i + 2; i <= ate; i++) { var fx = C.fatura(est, c.id, R.addMes(ref, i)); h += '<li class="clicavel" data-acao="ver-fatura" data-id="' + c.id + '" data-ref="' + fx.ref + '"><span class="t"><b>' + R.fmtMesCurto(mv(c.id, fx.ref)) + '</b><span>vence ' + R.fmtDiaMes(fx.vencimento) + '</span></span><span class="v">' + moeda(fx.total) + '</span></li>'; }
    return h + '</ul></section>';
  }
  function chipStatus(st) {
    var cls = { 'Paga': 'bom', 'Vencida · não paga': 'ruim', 'Vence hoje': 'av', 'Fechada': 'av', 'Aberta': 'az', 'Futura': '', 'Sem valor': '' }[st];
    return '<span class="chip ' + cls + '">' + st + '</span>';
  }

  /* gastos por categoria: valor, quantidade de compras e barra; Meus/Todos e Mês/12 meses */
  function blocoCategorias(mes) {
    var modo = ui.ondeModo || 'mes', lista = [];
    if (modo === 'mes') lista = C.gastosDoMes(est, mes); else for (var j = 0; j < 12; j++) lista = lista.concat(C.gastosDoMes(est, R.addMes(mes, -j)));
    lista = escopo(lista);
    var cont = {}; lista.forEach(function (t) { if (!t.estorno) cont[t.categoria || 'Outros'] = (cont[t.categoria || 'Outros'] || 0) + 1; });
    var cats = C.porCategoria(lista), max = cats.length ? cats[0].valor : 1, tot = D.soma(cats.map(function (c) { return c.valor; }));
    return '<section class="bloco c5"><h2>Gastos por categoria</h2><p class="sub">' + (modo === 'mes' ? 'Fatura de ' + R.fmtMes(mes) : 'Últimos 12 meses') + ' · ' + moedaTxt(tot) + '</p>' +
      '<div class="linha-flex" style="margin-bottom:6px">' + segEscopo() + '<div class="seg" role="group"><button aria-pressed="' + (modo === 'mes') + '" data-acao="onde-modo" data-v="mes">Mês</button><button aria-pressed="' + (modo === 'ano') + '" data-acao="onde-modo" data-v="ano">12 meses</button></div></div>' +
      (cats.length ? '<ul class="lista">' + cats.map(function (c) { var k = cat(c.nome); return '<li class="clicavel" data-acao="det-cat" data-cat="' + esc(c.nome) + '"><span class="ico-cat" style="background:' + k.cor + '22">' + k.ico + '</span><span class="t"><b>' + esc(c.nome) + '</b><span>' + (cont[c.nome] || 0) + ' compra(s) · ' + D.pct(tot ? c.valor / tot * 100 : 0) + '</span><div class="barra" style="margin-top:6px"><span style="width:' + (c.valor / max * 100).toFixed(1) + '%;background:' + k.cor + '"></span></div></span><span class="v">' + moeda(c.valor) + '</span></li>'; }).join('') + '</ul>'
        : vazio('Nenhum gasto nesta fatura', 'Use o botão + ou importe a fatura')) + '</section>';
  }
  function blocoGraficos(serie) {
    var mes = ui.mes, rot = [], rec = [], gas = [], h = '';
    for (var i = 11; i >= 0; i--) {
      var m = R.addMes(mes, -i), rs = C.resumoMes(est, m, est.hoje);
      rot.push(R.nomeMes(m, true)); rec.push(rs.receitaTotal); gas.push(ui.escopo === 'todos' ? rs.gasto : rs.meu);
    }
    h += '<section class="bloco c12 com-ilus">' + ilus('grafico') + '<h2>Entradas x Gastos</h2><p class="sub">Últimos 12 meses · ' + (ui.escopo === 'todos' ? 'gastos de todos' : 'só os seus gastos') + ' · toque num mês</p>' +
      G.barras({ rotulos: rot, series: [{ nome: 'Entradas', cor: '#12a150', valores: rec }, { nome: 'Gastos', cor: '#e5484d', valores: gas }], destaque: 11, clique: 'graf-mes', fmt: moedaTxt }) + '</section>';
    return h;
  }

  function blocoContas(mes) {
    var hoje = est.hoje, ini = mes + '-01', fim = R.dataNoMes(mes, 31), itens = [];
    est.tx.forEach(function (t) { if (t.tipo === 'despesa' && !C.ehCartao(t) && !t.fisico && ((t.data >= ini && t.data <= fim) || (!t.pago && t.data < ini && mes === R.mesDe(hoje)))) itens.push({ t: t, data: t.data }); });
    est.config.cards.forEach(function (c) { var fs = C.faturasDoCartao(est, c.id); Object.keys(fs).forEach(function (r) { var f = fs[r]; if (f.total > 0 && ((f.vencimento >= ini && f.vencimento <= fim) || (!f.pagamento && f.pagarAte < ini && mes === R.mesDe(hoje)))) itens.push({ f: f, c: c, data: f.vencimento }); }); });
    itens.sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var dias = {}; itens.forEach(function (i) { dias[+i.data.slice(8, 10)] = true; });
    var h = '<section class="bloco c6"><h2>Contas a pagar</h2><p class="sub">Marque o círculo ao efetuar o pagamento</p>';
    if (itens.length) h += '<div class="chips" style="margin-bottom:6px">' + Object.keys(dias).map(function (d) { return '<span class="chip">dia ' + d + '</span>'; }).join('') + '</div>';
    h += itens.length ? '<ul class="lista">' + itens.map(function (i) {
      if (i.f) {
        var pago = !!i.f.pagamento, st = C.statusFatura(est, i.f, hoje);
        return '<li><button class="circ' + (pago ? ' on' : '') + '" aria-label="Marcar fatura como paga" data-acao="' + (pago ? 'desfazer-pag' : 'pagar-fatura') + '" data-id="' + i.c.id + '" data-ref="' + i.f.ref + '">' + (pago ? ICO.check : '') + '</button><span class="t clicavel" data-acao="ver-fatura" data-id="' + i.c.id + '" data-ref="' + i.f.ref + '"><b>Fatura ' + esc(i.c.nome) + '</b><span>vence ' + R.fmtDiaMes(i.f.vencimento) + (i.f.adiada ? ' · pagar até ' + R.fmtDiaMes(i.f.pagarAte) : '') + ' · ' + st + '</span></span><span class="v">' + moeda(i.f.total) + '</span></li>';
      }
      var t = i.t, atras = !t.pago && t.data < hoje;
      return '<li><button class="circ' + (t.pago ? ' on' : '') + '" aria-label="Marcar como pago" data-acao="alternar-pago" data-id="' + t.id + '">' + (t.pago ? ICO.check : '') + '</button><span class="t clicavel" data-acao="editar" data-id="' + t.id + '"><b>' + esc(t.descricao || t.categoria) + '</b><span>' + R.fmtData(t.data) + ' · ' + FORMAS[t.forma] + (atras ? ' · <span class="neg">atrasado</span>' : '') + '</span></span><span class="v">' + moeda(t.valor) + '</span></li>';
    }).join('') + '</ul>' : vazio('Nada a pagar neste mês', '');
    h += '</section>';
    var rec = est.tx.filter(function (t) { return t.tipo === 'receita' && !t.pago && ((t.data >= ini && t.data <= fim) || (t.data < ini && mes === R.mesDe(hoje))); }).sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    h += '<section class="bloco c6"><h2>Entradas previstas</h2><p class="sub">Marque o círculo quando o valor for creditado</p>' + (rec.length ? '<ul class="lista">' + rec.map(function (t) {
      return '<li><button class="circ" aria-label="Marcar como recebido" data-acao="alternar-pago" data-id="' + t.id + '"></button><span class="t clicavel" data-acao="editar" data-id="' + t.id + '"><b>' + esc(t.descricao || t.categoria) + '</b><span>' + R.fmtData(t.data) + (t.regraData === '5du' ? ' · 5º dia útil' : '') + (t.data < hoje ? ' · <span class="neg">atrasado</span>' : '') + '</span></span><span class="v pos">' + moeda(t.valor) + '</span></li>';
    }).join('') + '</ul>' : vazio('Nenhuma entrada prevista', '')) + '</section>';
    return h;
  }

  function linhaTx(t) {
    var k = cat(t.categoria, t.tipo === 'receita'), c = t.cartaoId ? card(t.cartaoId) : null;
    var info = C.dataTxt(t) + ' · ' + (c ? esc(c.nome) : FORMAS[t.forma] || '') + (t.parcelas ? ' · ' + t.parcela + '/' + t.parcelas : '') + (t.recorrente ? ' · mensal' : '');
    var pes = C.temOutros(t) ? ' · ' + esc(C.descreverPessoas(est, t)) : (t.importado && !t.triado ? ' · <span class="aviso">a separar</span>' : '');
    return '<li class="clicavel" data-acao="editar" data-id="' + t.id + '"><span class="ico-cat" style="background:' + k.cor + '22">' + k.ico + '</span><span class="t"><b>' + esc(t.descricao || t.categoria) + chipCont(t) + '</b><span>' + info + pes + '</span></span><span class="v ' + (t.tipo === 'receita' || t.estorno ? 'pos' : '') + '">' + (t.estorno ? '−' : '') + moeda(t.valor) + '</span></li>';
  }

  /* ===================== LANÇAMENTOS ===================== */
  function filtrar() {
    var f = ui.filtros, mes = ui.mes, b = C.normDesc(ui.busca);
    return est.tx.filter(function (t) {
      if (!f.todosMeses && C.mesRef(t, est) !== mes) return false;
      if (f.tipo && t.tipo !== f.tipo) return false;
      if (f.cat && t.categoria !== f.cat) return false;
      if (f.forma && t.forma !== f.forma) return false;
      if (f.cartao && t.cartaoId !== f.cartao) return false;
      if (f.pessoa && !C.envolvePessoa(t, f.pessoa) && !(t.tipo === 'receita' && t.pessoaId === f.pessoa)) return false;
      if (f.sit === 'contestada') return !!t.contestacao && (!b || C.normDesc(t.descricao + ' ' + t.categoria).indexOf(b) >= 0);
      if (f.sit === 'pago' && !(t.pago || C.ehCartao(t))) return false;
      if (f.sit === 'pendente' && (t.pago || C.ehCartao(t))) return false;
      if (b && C.normDesc(t.descricao + ' ' + t.categoria).indexOf(b) < 0) return false;
      return true;
    });
  }
  function telaLancamentos() {
    var lista = filtrar(), o = ui.ordem, g = 0, r = 0;
    lista.forEach(function (t) { if (t.tipo === 'receita') r += +t.valor; else if (!t.saldoInicial) g += C.valorDespesa(t); });
    lista.sort(function (a, b) {
      var va, vb;
      if (o.col === 'valor') { va = +a.valor; vb = +b.valor; }
      else if (o.col === 'desc') { va = (a.descricao || '').toLowerCase(); vb = (b.descricao || '').toLowerCase(); }
      else if (o.col === 'cat') { va = a.categoria; vb = b.categoria; }
      else if (o.col === 'forma') { va = a.forma; vb = b.forma; }
      else if (o.col === 'pessoa') { va = C.descreverPessoas(est, a); vb = C.descreverPessoas(est, b); }
      else { va = a.data; vb = b.data; }
      return (va < vb ? -1 : va > vb ? 1 : 0) * (o.asc ? 1 : -1);
    });
    var nf = Object.keys(ui.filtros).filter(function (k) { return ui.filtros[k]; }).length;
    var h = '<div class="grade"><section class="bloco c12"><p class="sub" style="margin:0 0 10px">Cartão: compras da <b>fatura de ' + R.nomeMes(ui.mes) + '</b> (paga no início de ' + R.nomeMes(ui.mes) + ') · Pix e dinheiro: pela data</p><div class="indicadores" style="margin-top:0">' +
      ind('Gastos', g, '#e5484d', 'nada') + ind('Entradas', r, '#12a150', 'nada') + ind('Saldo', r - g, '#0a84ff', 'nada') +
      '<div class="ind"><span class="r"><i style="background:#9aa5b8"></i>Quantidade</span><div class="v">' + lista.length + '</div></div></div></section>' +
      '<section class="bloco c12"><div class="linha-flex"><label class="busca">' + ICO.lupa + '<input id="busca" type="search" placeholder="Buscar descrição ou categoria" value="' + esc(ui.busca) + '" aria-label="Buscar"></label>' +
      '<button class="btn ' + (nf ? 'sec' : 'neu') + '" data-acao="ver-filtros" aria-expanded="' + ui.verFiltros + '">Filtros' + (nf ? ' (' + nf + ')' : '') + '</button>' + (nf ? '<button class="link" data-acao="limpar-filtros">Limpar</button>' : '') + '</div>';
    if (ui.verFiltros) {
      var f = ui.filtros;
      h += '<div class="filtros-painel">' +
        sel('tipo', 'Tipo', [['', 'Todos'], ['despesa', 'Gastos'], ['receita', 'Entradas']], f.tipo) +
        sel('cat', 'Categoria', [['', 'Todas']].concat(est.config.cats.concat(est.config.rcats).map(function (c) { return [c.nome, c.nome]; })), f.cat) +
        sel('forma', 'Pagamento', [['', 'Todos'], ['pix', 'Pix'], ['cartao', 'Cartão'], ['debito', 'Débito'], ['dinheiro', 'Dinheiro']], f.forma) +
        sel('cartao', 'Cartão', [['', 'Todos']].concat(est.config.cards.map(function (c) { return [c.id, c.nome]; })), f.cartao) +
        sel('pessoa', 'De quem', [['', 'Todos'], ['eu', 'Eu']].concat(est.config.pessoas.map(function (p) { return [p.id, p.nome]; })), f.pessoa) +
        sel('sit', 'Situação', [['', 'Todas'], ['pago', 'Pago/recebido'], ['pendente', 'Pendente'], ['contestada', 'Contestada']], f.sit) +
        '<label class="alternar" style="align-self:end">Todos os meses<input type="checkbox" data-filtro="todosMeses" ' + (f.todosMeses ? 'checked' : '') + '></label></div>';
    }
    h += '</section><section class="bloco c12">';
    if (!lista.length) h += vazio('Nenhum lançamento encontrado', 'Mude o mês ou os filtros, ou use o +');
    else {
      var th = function (col, nome, cls) { return '<th data-acao="ordenar" data-col="' + col + '"' + (o.col === col ? ' aria-sort="' + (o.asc ? 'ascending' : 'descending') + '"' : '') + (cls ? ' style="text-align:right"' : '') + '><span>' + nome + '</span></th>'; };
      h += '<table class="tabela resp"><thead><tr>' + th('data', 'Data') + th('desc', 'Descrição') + th('cat', 'Categoria') + th('forma', 'Pagamento') + th('pessoa', 'De quem') + '<th>Situação</th>' + th('valor', 'Valor', 1) + '</tr></thead><tbody>' +
        lista.map(function (t) {
          var c = t.cartaoId ? card(t.cartaoId) : null, sit;
          if (C.ehCartao(t)) { var fx = C.fatura(est, t.cartaoId, t.faturaRef); sit = '<span class="chip ' + (fx.pagamento ? 'bom' : '') + '">fatura ' + R.nomeMes(mv(t.cartaoId, t.faturaRef), true) + '</span>'; }
          else sit = '<button class="chip ' + (t.pago ? 'bom' : (t.data < est.hoje ? 'ruim' : 'av')) + '" data-acao="alternar-pago" data-id="' + t.id + '">' + (t.pago ? (t.tipo === 'receita' ? 'Recebido' : 'Pago') : (t.data < est.hoje ? 'Atrasado' : 'Pendente')) + '</button>';
          var forma = c ? esc(c.nome) : (FORMAS[t.forma] || '');
          return '<tr data-acao="editar" data-id="' + t.id + '"><td class="num">' + C.dataTxt(t) + '</td><td class="m-desc">' + esc(t.descricao || t.categoria) + (t.parcelas ? ' <span class="mut">' + t.parcela + '/' + t.parcelas + '</span>' : '') + (t.estorno ? ' <span class="chip bom">estorno</span>' : '') + chipCont(t) + '</td>' +
            '<td>' + esc(t.categoria) + '</td><td>' + forma + '</td><td>' + esc(C.descreverPessoas(est, t)) + '</td><td class="m-sit">' + sit + '</td>' +
            '<td class="v ' + (t.tipo === 'receita' || t.estorno ? 'pos' : '') + '">' + (t.tipo === 'receita' ? '+' : (t.estorno ? '+' : '−')) + moeda(t.valor) + '</td>' +
            '<td class="m-info">' + C.dataTxt(t) + ' · ' + esc(t.categoria) + ' · ' + forma + (C.temOutros(t) ? ' · ' + esc(C.descreverPessoas(est, t)) : '') + '</td></tr>';
        }).join('') + '</tbody></table>';
    }
    return h + '</section></div>';
  }
  function sel(k, rot, ops, v) { return '<div class="campo" style="margin:0"><label>' + rot + '</label><select class="inp" data-filtro="' + k + '">' + ops.map(function (o) { return '<option value="' + esc(o[0]) + '"' + ((v || '') === o[0] ? ' selected' : '') + '>' + esc(o[1]) + '</option>'; }).join('') + '</select></div>'; }

  /* ===================== RECEITAS ===================== */
  function telaReceitas() {
    var mes = ui.mes, rs = C.resumoMes(est, mes, est.hoje), lista = C.receitasDoMes(est, mes).sort(function (a, b) { return a.data < b.data ? -1 : 1; });
    var falta = lista.filter(function (t) { return !t.pago; }), entrou = lista.filter(function (t) { return t.pago; });
    var h = '<div class="grade"><section class="bloco c12 com-ilus">' + ilus('receita') + '<h2>Entradas de ' + R.nomeMes(mes) + '</h2><p class="sub">Salário, receitas extras e reembolsos</p><div class="grande">' + moeda(rs.receitaTotal) + '</div>' +
      G.barraDividida([{ nome: 'Recebido', valor: rs.recebido, cor: '#12a150' }, { nome: 'Previsto', valor: rs.aReceber, cor: '#f0b44c' }]) +
      '<div class="leg" style="margin:0"><span><i style="background:#12a150"></i>Recebido ' + moedaTxt(rs.recebido) + '</span><span><i style="background:#f0b44c"></i>Previsto ' + moedaTxt(rs.aReceber) + '</span></div>' +
      '<div class="linha-flex" style="margin-top:14px"><button class="btn pri" data-acao="novo" data-tipo="receita">+ Nova entrada</button></div></section>';
    function lst(arr, vazioTxt) {
      return arr.length ? '<ul class="lista">' + arr.map(function (t) {
        return '<li><button class="circ' + (t.pago ? ' on' : '') + '" data-acao="alternar-pago" data-id="' + t.id + '" aria-label="' + (t.pago ? 'Desmarcar' : 'Marcar que entrou') + '">' + (t.pago ? ICO.check : '') + '</button><span class="t clicavel" data-acao="editar" data-id="' + t.id + '"><b>' + esc(t.descricao || t.categoria) + '</b><span>' + R.fmtData(t.data) + ' · ' + esc(t.categoria) + (t.regraData === '5du' ? ' · 5º dia útil' : '') + (t.fisico ? ' · em dinheiro' : '') + (t.acerto ? ' · ' + esc(C.nomePessoa(est, t.pessoaId)) + ' — pagamento' : '') + (!t.pago && t.data < est.hoje ? ' · <span class="neg">atrasado</span>' : '') + '</span></span><span class="v pos">' + moeda(t.valor) + '</span></li>';
      }).join('') + '</ul>' : vazio(vazioTxt, '');
    }
    h += '<section class="bloco c6"><h2>Previstas</h2><p class="sub">Marque quando o valor for creditado</p>' + lst(falta, 'Nada pendente neste mês') + '</section>';
    h += '<section class="bloco c6"><h2>Recebidas</h2><p class="sub">' + entrou.length + ' entrada(s)</p>' + lst(entrou, 'Nada ainda') + '</section>';
    var rot = [], val = [];
    for (var i = 11; i >= 0; i--) { var m = R.addMes(mes, -i); rot.push(R.nomeMes(m, true)); val.push(C.resumoMes(est, m, est.hoje).receitaTotal); }
    h += '<section class="bloco c12"><details class="recolher"><summary aria-expanded="false"><h2>Histórico dos últimos 12 meses</h2><span class="seta">' + ICO.seta + '</span></summary>' + G.barras({ rotulos: rot, series: [{ nome: 'Entradas', cor: '#12a150', valores: val }], destaque: 11, fmt: moedaTxt }) + '</details></section>';
    return h + '</div>';
  }

  /* ===================== CARTÕES ===================== */
  function telaCartoes() {
    var cards = est.config.cards.slice(), hoje = est.hoje, totPagar = 0, lim = 0, usado = 0, prox = null;
    cards.forEach(function (c) {
      var fs = C.faturasDoCartao(est, c.id);
      Object.keys(fs).forEach(function (r) { var f = fs[r]; if (C.precisaPagar(f) && r <= C.faturaDaCompra(c, hoje)) { totPagar += f.total; if (!prox || f.vencimento < prox.f.vencimento) prox = { f: f, c: c }; } });
      lim += +c.limite || 0; usado += C.limiteUsado(est, c.id, hoje);
    });
    var h = '<div class="grade"><section class="bloco c12 com-ilus">' + ilus('cartao') + '<h2>Todos os cartões</h2><p class="sub">Faturas fechadas e abertas que ainda não foram pagas</p>' +
      '<div class="grande">' + moeda(totPagar) + '</div>' + (prox ? '<p class="mut" style="margin:4px 0 0">Próxima: ' + esc(prox.c.nome) + ' · ' + moedaTxt(prox.f.total) + ' · vence ' + R.fmtDiaMes(prox.f.vencimento) + '</p>' : '') +
      (lim ? '<div class="barra" style="margin:14px 0 6px"><span style="width:' + Math.min(100, usado / lim * 100).toFixed(1) + '%"></span></div><div class="linha-flex mut" style="font-size:13px"><span>Usado ' + moeda(usado) + '</span><span class="espaco"></span><span>Disponível ' + moeda(lim - usado) + ' de ' + moeda(lim) + '</span></div>' : '') +
      '<div class="linha-flex" style="margin-top:14px"><button class="btn pri" data-acao="importar">Importar fatura</button><button class="btn neu" data-acao="novo" data-tipo="despesa" data-forma="cartao">+ Compra no cartão</button><button class="btn neu" data-acao="novo-cartao">+ Novo cartão</button></div></section>';
    h += blocoContestacoes();
    h += blocoSemDono();
    // quem usou
    if (est.config.pessoas.length) {
      var dev = C.devedores(est);
      h += '<section class="bloco c12 com-ilus">' + ilus('pessoas') + '<h2>Responsáveis pelas compras</h2><p class="sub">Saldo de cada pessoa nos cartões</p><ul class="lista">' + dev.map(function (p) {
        return '<li class="clicavel" data-acao="ver-pessoa" data-id="' + p.id + '">' + avatar(p) + '<span class="t"><b>' + esc(p.nome) + '</b><span>' + (p.futuro > 0.009 ? 'Próximas faturas: ' + moedaTxt(p.futuro) : 'Sem parcelas futuras') + '</span></span><span class="v ' + (p.deve > 0.009 ? 'neg' : 'pos') + '">' + (p.deve > 0.009 ? 'deve ' : '') + moeda(p.deve) + '</span></li>';
      }).join('') + '</ul></section>';
    } else {
      h += '<section class="bloco c12"><div class="linha-flex"><span style="flex:1"><b>Outras pessoas usam seus cartões?</b><br><span class="mut" style="font-size:14px">Cadastre-as para saber quanto cada uma te deve.</span></span><button class="btn sec" data-acao="nova-pessoa">+ Pessoa</button></div></section>';
    }
    // ordenar e busca
    var ord = ui.ordCartoes || 'nome';
    var dados = cards.map(function (c) {
      var fs = C.faturasDoCartao(est, c.id), aberta = C.faturaDaCompra(c, hoje), pagar = 0;
      Object.keys(fs).forEach(function (r) { if (C.precisaPagar(fs[r]) && r <= aberta) pagar += fs[r].total; });
      var f = C.fatura(est, c.id, aberta);
      return { c: c, pagar: pagar, usado: C.limiteUsado(est, c.id, hoje), aberta: f };
    });
    var ords = { nome: function (a, b) { return a.c.nome.localeCompare(b.c.nome); }, pagar: function (a, b) { return b.pagar - a.pagar; }, venc: function (a, b) { return a.aberta.vencimento < b.aberta.vencimento ? -1 : 1; }, fech: function (a, b) { return a.aberta.fechamento < b.aberta.fechamento ? -1 : 1; }, limite: function (a, b) { return (+b.c.limite || 0) - (+a.c.limite || 0); }, usado: function (a, b) { return b.usado - a.usado; }, disp: function (a, b) { return ((+b.c.limite || 0) - b.usado) - ((+a.c.limite || 0) - a.usado); }, pct: function (a, b) { return (b.usado / (+b.c.limite || 1)) - (a.usado / (+a.c.limite || 1)); } };
    dados.sort(ords[ord] || ords.nome);
    h += '<section class="bloco c12"><div class="linha-flex"><label class="busca">' + ICO.lupa + '<input id="busca-cartao" type="search" placeholder="Buscar compra no cartão pelo nome" value="' + esc(ui.buscaCartao || '') + '"></label>' +
      '<select class="inp" style="width:auto" data-acao-sel="ord-cartoes" aria-label="Ordenar">' + [['nome', 'Nome'], ['pagar', 'Maior a pagar'], ['venc', 'Vencimento mais próximo'], ['fech', 'Fechamento mais próximo'], ['limite', 'Maior limite'], ['usado', 'Mais usado'], ['disp', 'Mais disponível'], ['pct', '% do limite usado']].map(function (o) { return '<option value="' + o[0] + '"' + (ord === o[0] ? ' selected' : '') + '>Ordenar: ' + o[1] + '</option>'; }).join('') + '</select></div>';
    if (ui.buscaCartao) {
      var b = C.normDesc(ui.buscaCartao), achou = est.tx.filter(function (t) { return C.ehCartao(t) && C.normDesc(t.descricao).indexOf(b) >= 0; }).sort(function (a, b2) { return a.data < b2.data ? 1 : -1; }).slice(0, 40);
      h += '<ul class="lista" style="margin-top:10px">' + (achou.length ? achou.map(linhaTx).join('') : '<li class="mut">Nenhuma compra encontrada</li>') + '</ul>';
    }
    h += '</section>';
    if (!cards.length) h += '<section class="bloco c12">' + vazio('Nenhum cartão cadastrado', 'Toque em "+ Novo cartão"') + '</section>';
    dados.forEach(function (d) {
      var c = d.c, fs = C.faturasDoCartao(est, c.id), aberta = C.faturaDaCompra(c, hoje);
      var refs = {}; Object.keys(fs).forEach(function (r) { if ((r >= R.addMes(aberta, -1) && r <= R.addMes(aberta, 2)) || (C.precisaPagar(fs[r]) && r <= aberta)) refs[r] = 1; });
      for (var i = 0; i <= 2; i++) refs[R.addMes(aberta, i)] = 1;
      var lst = Object.keys(refs).sort(), outras = Object.keys(fs).filter(function (r) { return !refs[r]; }).sort();
      h += '<section class="bloco c6"><div class="linha-flex" style="align-items:flex-start;flex-wrap:nowrap">' + ccHtml(c, '', 'width:132px;padding:10px 12px;border-radius:12px;font-size:11px') +
        '<div style="flex:1;min-width:0"><h2>' + esc(c.nome) + '</h2><p class="sub" style="margin:0">Fecha dia ' + c.fechamento + ' · vence dia ' + c.vencimento + '</p><div class="mut" style="font-size:13px;margin-top:8px">A pagar</div><div class="medio">' + moeda(d.pagar) + '</div></div></div>' +
        (c.limite ? '<div class="barra" style="margin:14px 0 6px"><span style="width:' + Math.min(100, d.usado / c.limite * 100).toFixed(1) + '%;background:' + (c.cor || 'var(--brand-2)') + '"></span></div><div class="linha-flex mut" style="font-size:13px"><span>Usado ' + moeda(d.usado) + '</span><span class="espaco"></span><span>Livre ' + moeda(c.limite - d.usado) + '</span></div>' : '') +
        '<div style="margin-top:10px">' + lst.map(function (r) {
          var f = fs[r] || C.fatura(est, c.id, r), st = C.statusFatura(est, f, hoje);
          return '<div class="fatura-lin"><span class="t clicavel" style="flex:1;min-width:0;cursor:pointer" data-acao="ver-fatura" data-id="' + c.id + '" data-ref="' + r + '"><b style="font-weight:550">' + R.fmtMesCurto(mv(c.id, r)) + '</b> ' + chipStatus(st) + '<br><span class="mut" style="font-size:12.5px">vence ' + R.fmtDiaMes(f.vencimento) + (f.adiada ? ' · pagar até ' + R.fmtDiaMes(f.pagarAte) : '') + '</span></span><span class="v" style="font-weight:650">' + moeda(f.total) + '</span>' +
            (f.pagamento ? '<button class="btn peq neu" data-acao="desfazer-pag" data-id="' + c.id + '" data-ref="' + r + '">Desfazer</button>' : (f.total > 0 && r <= aberta ? '<button class="btn peq pri" data-acao="pagar-fatura" data-id="' + c.id + '" data-ref="' + r + '">Marcar como paga</button>' : '')) + '</div>';
        }).join('') + (outras.length ? '<details class="recolher" style="margin-top:6px"><summary aria-expanded="false"><span class="link">Outras faturas (' + outras.length + ')</span><span class="seta">' + ICO.seta + '</span></summary><ul class="lista">' + outras.map(function (r) { var f = fs[r]; return '<li class="clicavel" data-acao="ver-fatura" data-id="' + c.id + '" data-ref="' + r + '"><span class="t"><b>' + R.fmtMesCurto(mv(c.id, r)) + '</b><span>' + C.statusFatura(est, f, hoje) + ' · vence ' + R.fmtDiaMes(f.vencimento) + '</span></span><span class="v">' + moeda(f.total) + '</span></li>'; }).join('') + '</ul></details>' : '') + '</div>' +
        (c.conferir ? '<div class="previa" style="margin-top:10px">Confira o dia do fechamento, do vencimento e o limite deste cartão em "Editar".</div>' : '') +
        '<div class="linha-flex" style="margin-top:12px"><button class="btn peq pri" data-acao="importar" data-id="' + c.id + '">Importar fatura</button><button class="btn peq sec" data-acao="novo" data-tipo="despesa" data-forma="cartao" data-cartao="' + c.id + '">+ Compra</button><button class="btn peq neu" data-acao="editar-cartao" data-id="' + c.id + '">Editar</button><button class="btn peq neu" data-acao="dever-cartao" data-id="' + c.id + '">Quanto já devo</button></div></section>';
    });
    return h + '</div>';
  }

  /* ===================== DEVENDO ===================== */
  function telaDevendo() {
    var pessoas = est.config.pessoas.map(function (p) { return C.dividasPessoa(est, p.id); }).filter(function (d) { return !d.pessoa.arquivada || Math.abs(d.deve) > 0.009 || d.futuro > 0.009; });
    var tot = 0, nDev = 0; pessoas.forEach(function (d) { if (d.deve > 0.009) { tot += d.deve; nDev++; } });
    var devem = pessoas.filter(function (d) { return Math.abs(d.deve) > 0.009; }).sort(function (a, b) { return b.deve - a.deve; });
    var emDia = pessoas.filter(function (d) { return Math.abs(d.deve) <= 0.009; });
    var h = '<div class="grade"><section class="bloco c12 com-ilus">' + ilus('pessoas') + '<h2>Total a receber</h2><p class="sub">Até a fatura de ' + R.fmtMes(C.mesEmAndamento(est)) + ' (compras de ' + R.nomeMes(R.mesDe(est.hoje)) + '), descontados os pagamentos recebidos</p><div class="grande">' + moeda(tot) + '</div>' +
      '<p class="mut" style="margin:4px 0 0">' + nDev + ' pessoa(s) com valor em aberto</p></section>';
    devem.forEach(function (d) {
      var p = d.pessoa;
      h += '<section class="bloco c6"><div class="linha-flex" style="flex-wrap:nowrap">' + avatar(p) + '<div style="flex:1;min-width:0"><h2>' + esc(p.nome) + (p.tipo === 'empresa' ? ' ' : '') + '</h2><p class="sub" style="margin:0">' + (d.futuro > 0.009 ? 'Próximas faturas: ' + moedaTxt(d.futuro) : 'Sem parcelas futuras') + '</p></div><div class="medio ' + (d.deve > 0 ? 'neg' : 'pos') + '">' + moeda(d.deve) + '</div></div>' +
        '<ul class="lista" style="margin-top:8px">' + d.abertos.slice().reverse().map(function (x) {
          var det = [];
          if (x.compras) det.push('compras ' + moedaTxt(x.compras));
          if (x.pendencia) det.push('ficou em aberto ' + moedaTxt(x.pendencia));
          if (x.pago) det.push('pagou ' + moedaTxt(x.pago));
          return '<li class="clicavel" data-acao="ver-pessoa" data-id="' + p.id + '"><span class="t"><b>Fatura de ' + R.fmtMes(x.mes) + (x.mes === C.mesEmAndamento(est) ? ' <span class="chip az" style="display:inline-flex;margin-left:6px;vertical-align:middle">em andamento</span>' : '') + '</b><span>' + det.join(' · ') + '</span></span><span class="v ' + (x.aberto > 0 ? 'neg' : 'pos') + '">' + (x.aberto < 0 ? 'crédito ' : '') + moeda(Math.abs(x.aberto)) + '</span></li>';
        }).join('') + '</ul>' +
        '<div class="linha-flex" style="margin-top:12px"><button class="btn peq pri" data-acao="recebi-pessoa" data-id="' + p.id + '">Registrar pagamento</button><button class="btn peq sec" data-acao="pendencia-nova" data-id="' + p.id + '">+ Saldo em aberto</button><button class="btn peq neu" data-acao="ver-pessoa" data-id="' + p.id + '">Ver compras</button><button class="btn peq neu" data-acao="relacao" data-id="' + p.id + '">Extrato</button></div></section>';
    });
    if (!devem.length) h += '<section class="bloco c12">' + vazio('Nenhum valor a receber', '') + '</section>';
    if (emDia.length) h += '<section class="bloco c12"><details class="recolher"><summary aria-expanded="false"><h2>Em dia (' + emDia.length + ')</h2><span class="seta">' + ICO.seta + '</span></summary><ul class="lista">' + emDia.map(function (d) {
      return '<li>' + avatar(d.pessoa) + '<span class="t clicavel" data-acao="ver-pessoa" data-id="' + d.pessoa.id + '"><b>' + esc(d.pessoa.nome) + '</b><span>' + (d.futuro > 0.009 ? 'Próximas faturas: ' + moedaTxt(d.futuro) : 'Nada em aberto') + '</span></span><button class="btn peq sec" data-acao="pendencia-nova" data-id="' + d.pessoa.id + '">+ Saldo em aberto</button></li>';
    }).join('') + '</ul></details></section>';
    return h + '</div>';
  }
  function mesesOpcoes(sel, extra) {
    var ops = [], m0 = R.mesDe(est.hoje);
    for (var i = 1; i >= -12; i--) { var m = R.addMes(m0, i); ops.push('<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>Fatura de ' + R.fmtMes(m) + '</option>'); }
    return (extra || '') + ops.join('');
  }
  /* "Recebi de Fulano": registra o pagamento numa fatura */
  function abrirRecebi(id) {
    var d = C.dividasPessoa(est, id), p = d.pessoa, ab = d.abertos.filter(function (x) { return x.aberto > 0; });
    var j = abrirJanela('Pagamento de ' + p.nome, '<div class="bloco" style="background:var(--surface-2);box-shadow:none;padding:14px;margin-bottom:14px"><div class="mut" style="font-size:12.5px;font-weight:600">' + esc(p.nome).toUpperCase() + ' TE DEVE</div><div class="medio">' + moeda(d.deve) + '</div>' +
      (ab.length ? '<div class="mut" style="font-size:13px;margin-top:4px">' + ab.map(function (x) { return 'fatura ' + R.fmtMesCurto(x.mes) + ' ' + moedaTxt(x.aberto); }).join(' · ') + '</div>' : '') + '</div>' +
      '<div class="dois"><div class="campo"><label>Quanto recebeu</label><input class="inp" id="rc-v" inputmode="decimal" placeholder="0,00" autofocus><div class="dica-campo" id="rc-d"></div></div><div class="campo"><label>Data</label><input class="inp" type="date" id="rc-data" value="' + est.hoje + '"></div></div>' +
      '<div class="campo"><label>Abater de</label><select class="inp" id="rc-mes"><option value="">Do total que ' + esc(p.nome) + ' te deve (primeiro o mais antigo)</option>' + mesesOpcoes('__nenhum__') + '</select></div>' +
      '<button class="link" id="rc-tudo">Recebi tudo (' + moedaTxt(Math.max(0, d.deve)) + ')</button>',
      '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="rc-ok">Registrar</button>');
    function dica() {
      var v = D.ler($('#rc-v', j).value), el = $('#rc-d', j);
      if (!$('#rc-v', j).value) { el.textContent = ''; return; }
      el.className = 'dica-campo ' + (v ? 'ok' : 'ruim');
      el.textContent = v == null ? 'Valor não reconhecido' : '= ' + D.fmt(v) + ' · vai faltar ' + D.fmt(Math.max(0, d.deve - v));
    }
    $('#rc-v', j).oninput = dica;
    $('#rc-tudo', j).onclick = function () { $('#rc-v', j).value = D.fmt(Math.max(0, d.deve), true); dica(); };
    $('#rc-ok', j).onclick = function () {
      var v = D.ler($('#rc-v', j).value), dt = $('#rc-data', j).value, m = $('#rc-mes', j).value;
      if (!v || v <= 0) return toast('Digite quanto recebeu'); if (!R.valida(dt)) return toast('Data inválida');
      var t = { id: C.novoId(), tipo: 'receita', data: dt, valor: v, descricao: p.nome + ' — pagamento' + (m ? ' · fatura ' + R.fmtMesCurto(m) : ''), categoria: 'Reembolso', forma: 'pix', pago: true, acerto: true, pessoaId: id };
      if (m) t.mesFatura = m;
      est.tx.push(t); salvar(); fecharJanela(); render();
      var depois = C.dividasPessoa(est, id).deve;
      toast('Recebido ' + D.fmt(v) + ' ✓ · ' + (depois > 0.009 ? 'ainda falta ' + D.fmt(depois) : p.nome + ' está em dia'));
    };
  }
  /* valor que ficou em aberto de uma fatura (ex.: "ficou me devendo 27 de outubro") */
  function abrirPendencia(id, pdId) {
    var p = C.porId(est.config.pessoas, id), pd = pdId ? C.porId(est.config.pendencias, pdId) : { mes: R.mesDe(est.hoje), valor: '', obs: '' };
    var j = abrirJanela((pdId ? 'Editar' : 'Novo') + ' saldo em aberto · ' + p.nome, '<p class="mut" style="margin-top:0">Use quando a pessoa ficou devendo uma parte de uma fatura antiga.</p>' +
      '<div class="campo"><label>De qual fatura</label><select class="inp" id="pd-mes">' + mesesOpcoes(pd.mes) + '</select></div>' +
      '<div class="campo"><label>Quanto ficou devendo</label><input class="inp" id="pd-v" inputmode="decimal" value="' + (pd.valor ? D.fmt(pd.valor, true) : '') + '" placeholder="0,00"></div>' +
      '<div class="campo"><label>Observação</label><input class="inp" id="pd-o" value="' + esc(pd.obs || '') + '" placeholder="Opcional"></div>',
      (pdId ? '<button class="btn perigo" id="pd-rem">Remover</button><span class="espaco"></span>' : '') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="pd-ok">Salvar</button>');
    $('#pd-ok', j).onclick = function () {
      var v = D.ler($('#pd-v', j).value); if (!v || v <= 0) return toast('Valor inválido');
      var novo = { id: pdId || C.novoId(), pessoaId: id, mes: $('#pd-mes', j).value, valor: v, obs: $('#pd-o', j).value.trim() };
      est.config.pendencias = (est.config.pendencias || []).filter(function (x) { return x.id !== novo.id; }).concat([novo]);
      salvar(); fecharJanela(); render(); toast('Valor em aberto salvo');
    };
    if (pdId) $('#pd-rem', j).onclick = function () { est.config.pendencias = est.config.pendencias.filter(function (x) { return x.id !== pdId; }); salvar(); fecharJanela(); render(); };
  }

  /* ===================== CAIXINHAS ===================== */
  function telaCaixinhas() {
    var cxs = est.config.caixinhas, hoje = est.hoje, tot = 0, rend = 0, lim = 0;
    var dados = cxs.map(function (cx) { var s = C.serieCaixinha(cx, hoje, est.cdi, est.config.calendario); tot += s.saldo; rend += s.rendimento; lim += +cx.limite || 0; return { cx: cx, s: s }; });
    var h = '<div class="grade"><section class="bloco c12 com-ilus">' + ilus('cofre') + '<h2>Total em reservas</h2><p class="sub">Fica fora do saldo em conta</p><div class="grande">' + moeda(tot) + '</div>' +
      (lim ? '<div class="barra" style="margin:14px 0 6px"><span style="width:' + Math.min(100, tot / lim * 100).toFixed(1) + '%;background:var(--good)"></span></div><div class="mut" style="font-size:13px">Até o limite de rendimento maior: ' + moeda(lim) + '</div>' : '') +
      '<p class="mut" style="margin:8px 0 0">Rendimentos estimados: <b class="pos">' + moeda(rend) + '</b></p><div class="linha-flex" style="margin-top:14px"><button class="btn pri" data-acao="nova-caixinha">+ Nova reserva</button></div></section>';
    if (!cxs.length) h += '<section class="bloco c12">' + vazio('Nenhuma reserva', 'Crie uma para separar valores (emergência, viagem...)') + '</section>';
    dados.forEach(function (d) {
      var cx = d.cx;
      h += '<section class="bloco c6"><div class="cab"><div><h2>' + esc(cx.nome) + '</h2><p class="sub">' + (cx.pct || 0) + '% do CDI' + (cx.limite ? ' até ' + moedaTxt(cx.limite) + ', ' + (cx.pctAcima != null && cx.pctAcima !== '' ? cx.pctAcima : cx.pct) + '% acima' : '') + '</p></div><button class="link" data-acao="editar-caixinha" data-id="' + cx.id + '">Editar</button></div>' +
        '<div class="medio">' + moeda(d.s.saldo) + '</div><div class="mut" style="font-size:13px">rendeu ' + moedaTxt(d.s.rendimento) + '</div>' +
        '<div class="linha-flex" style="margin-top:12px"><button class="btn peq pri" data-acao="mov-caixinha" data-tipo="guardar" data-id="' + cx.id + '">Guardar</button><button class="btn peq sec" data-acao="mov-caixinha" data-tipo="resgatar" data-id="' + cx.id + '">Resgatar</button><button class="btn peq neu" data-acao="mov-caixinha" data-tipo="ajuste" data-id="' + cx.id + '">Rendimento real</button></div>' +
        '<details class="recolher" style="margin-top:12px"><summary aria-expanded="false"><span class="rot">Histórico (' + d.s.historico.length + ')</span><span class="seta">' + ICO.seta + '</span></summary><ul class="lista">' +
        d.s.historico.slice().reverse().slice(0, 20).map(function (x) { return '<li><span class="t"><b>' + ({ guardar: 'Guardei', resgatar: 'Resgatei', ajuste: 'Ajuste de rendimento' }[x.tipo]) + '</b><span>' + R.fmtData(x.data) + (x.m.mexeConta ? ' · da conta' : '') + '</span></span><span class="v ' + (x.tipo === 'resgatar' ? 'neg' : 'pos') + '">' + (x.tipo === 'resgatar' ? '−' : '+') + moeda(x.valor) + '</span><button class="icone-btn" style="width:32px;height:32px" aria-label="Apagar movimento" data-acao="apagar-mov" data-id="' + cx.id + '" data-mov="' + x.m.id + '">' + ICO.fechar + '</button></li>'; }).join('') + '</ul></details></section>';
    });
    h += '<section class="bloco c12"><details class="recolher"><summary aria-expanded="false"><h2>Como o rendimento é calculado</h2><span class="seta">' + ICO.seta + '</span></summary><p class="mut" style="margin:0">Em cada dia útil, o app pega o saldo do fim do dia, multiplica pela taxa DI do dia (Banco Central) e pelo % do CDI da caixinha. O valor entra no dia seguinte. Acima do limite, vale o outro %. Como o banco desconta imposto, use "Rendimento real" para corrigir com o valor do extrato.</p></details></section>';
    return h + '</div>';
  }

  /* ===================== AJUSTES ===================== */
  function telaAjustes() {
    var c = est.config, h = '';
    function item(id, ico, cor, t, s, corpo) { return '<details' + (ui.ajAberto === id ? ' open' : '') + ' data-aj="' + id + '"><summary><span class="ico-cat" style="background:' + cor + '">' + ico + '</span><span class="t">' + t + '<span>' + s + '</span></span><span class="seta">' + ICO.seta + '</span></summary><div class="corpo">' + corpo + '</div></details>'; }
    h += '<div style="max-width:720px;margin:0 auto"><p class="titulo-sec">Dinheiro</p><div class="ajustes-lista"><button data-acao="aba" data-aba="caixinhas"><span class="ico-cat" style="background:#12a150">R</span><span class="t">Reservas<span>Valores guardados à parte</span></span><span class="seta">' + ICO.seta + '</span></button>';
    h += item('saldo', 'S', '#12a150', 'Saldo da conta', 'Ponto de partida: ' + moedaTxt(c.saldoRef) + ' em ' + R.fmtData(c.saldoRefData),
      '<p class="mut" style="margin-top:0">O saldo de hoje é calculado a partir deste valor. Se estiver diferente do banco, use "Ajustar".</p><button class="btn sec" data-acao="ajustar-saldo">Ajustar saldo</button>');
    h += item('rend', 'R', '#0a84ff', 'Rendimento da conta', c.rend.ativo ? c.rend.pct + '% do CDI' : 'Desligado',
      '<label class="alternar">Minha conta rende automaticamente<input type="checkbox" data-cfg="rend.ativo" ' + (c.rend.ativo ? 'checked' : '') + '></label>' +
      '<div class="campo"><label>% do CDI</label><input class="inp" inputmode="decimal" data-cfg="rend.pct" value="' + esc(c.rend.pct) + '"></div>' +
      '<p class="mut" style="font-size:13px">Taxa DI: ' + (Object.keys(est.cdi || {}).length ? 'atualizada pelo Banco Central' : 'sem conexão com o Banco Central nesta prévia (usando ~14,9% ao ano)') + '. Fator de ajuste atual: ' + (c.rend.fator || 1).toFixed(3).replace('.', ',') + '</p><button class="btn neu" data-acao="rend-real">Informar quanto rendeu de verdade</button>');
    h += item('pessoas', 'P', '#8e4ec6', 'Pessoas e grupos', ativas().length ? ativas().map(function (p) { return p.nome; }).join(', ') : 'Nenhuma pessoa cadastrada',
      '<ul class="lista">' + c.pessoas.filter(function (p) { return !p.arquivada; }).map(function (p) { return '<li>' + avatar(p) + '<span class="t"><b>' + esc(p.nome) + '</b>' + (p.tipo === 'empresa' ? '<span>Empresa · lembrar de pedir reembolso</span>' : '') + '</span><button class="btn peq neu" data-acao="editar-pessoa" data-id="' + p.id + '">Editar</button></li>'; }).join('') + '</ul><button class="btn sec" data-acao="nova-pessoa">+ Pessoa</button>' + (c.pessoas.some(function (p) { return p.arquivada; }) ? '<details class="recolher" style="margin-top:14px"><summary aria-expanded="false"><span class="rot">Arquivadas (' + c.pessoas.filter(function (p) { return p.arquivada; }).length + ') · não aparecem nas opções</span><span class="seta">' + ICO.seta + '</span></summary><ul class="lista">' + c.pessoas.filter(function (p) { return p.arquivada; }).map(function (p) { return '<li>' + avatar(p) + '<span class="t"><b>' + esc(p.nome) + '</b></span><button class="btn peq neu" data-acao="reativar-pessoa" data-id="' + p.id + '">Voltar para as opções</button></li>'; }).join('') + '</ul></details>' : '') + '<div class="rot" style="margin:16px 0 4px">Grupos para dividir em um toque</div><ul class="lista">' + (c.grupos || []).map(function (g) { return '<li><span class="t"><b>' + esc(g.nome) + '</b><span>' + g.membros.map(function (m) { return esc(C.nomePessoa(est, m)); }).join(', ') + '</span></span><button class="btn peq neu" data-acao="editar-grupo" data-id="' + g.id + '">Editar</button></li>'; }).join('') + '</ul><button class="btn sec" data-acao="novo-grupo">+ Grupo</button>');
    h += item('cats', 'C', '#f08a24', 'Categorias', c.cats.length + ' de gasto · ' + c.rcats.length + ' de entrada', telaCats());
    h += '</div><p class="titulo-sec">Datas</p><div class="ajustes-lista">';
    h += item('cal', 'C', '#e5484d', 'Calendário bancário', 'Feriados e 5º dia útil',
      '<p class="mut" style="margin-top:0">Feriados nacionais e Sexta-feira da Paixão já estão incluídos.</p>' +
      '<label class="alternar">Carnaval (ponto facultativo)<input type="checkbox" data-cfg="calendario.carnaval" ' + (c.calendario.carnaval ? 'checked' : '') + '></label>' +
      '<label class="alternar">Corpus Christi (ponto facultativo)<input type="checkbox" data-cfg="calendario.corpus" ' + (c.calendario.corpus ? 'checked' : '') + '></label>' +
      '<label class="alternar">Sábado conta como dia útil na minha empresa (salário)<input type="checkbox" data-cfg="calendario.sabadoUtil" ' + (c.calendario.sabadoUtil ? 'checked' : '') + '></label>' +
      '<div class="rot" style="margin:10px 0 4px">Feriados da cidade/estado</div><ul class="lista">' + c.calendario.feriados.map(function (f, i) { return '<li><span class="t"><b>' + esc(f.nome) + '</b><span>' + esc(f.data.length === 5 ? f.data.slice(3) + '/' + f.data.slice(0, 2) + ' (todo ano)' : R.fmtData(f.data)) + '</span></span><button class="btn peq neu" data-acao="rem-feriado" data-i="' + i + '">Remover</button></li>'; }).join('') + '</ul>' +
      '<div class="dois"><input class="inp" id="fer-data" placeholder="dd/mm (todo ano) ou dd/mm/aaaa"><input class="inp" id="fer-nome" placeholder="Nome do feriado"></div><button class="btn sec" style="margin-top:10px" data-acao="add-feriado">Adicionar feriado</button>');
    h += '</div><p class="titulo-sec">Dados e segurança</p><div class="ajustes-lista">';
    h += item('sync', 'S', '#0a84ff', 'Sincronização', Nuvem.texto(), '<p class="mut" style="margin-top:0">' + (Nuvem.modo === 'github' ? 'Seus dados ficam num repositório privado do seu GitHub.' : 'Seus dados ficam guardados numa área privada da sua conta do Claude.') + ' Abra o app no computador ou no celular e tudo aparece igual. Vale sempre a alteração mais recente.</p><button class="btn sec" data-acao="sync-agora">Sincronizar agora</button>' +
      (GitHub.cfg() ? ' <button class="btn neu" data-acao="gh-desconectar">Desconectar o cofre deste aparelho</button>' :
        '<details class="recolher" style="margin-top:14px"><summary aria-expanded="false"><span class="rot">Conectar cofre no GitHub</span><span class="seta">' + ICO.seta + '</span></summary>' +
        '<div class="dois"><div class="campo"><label>Usuário do GitHub</label><input class="inp" id="gh-o" autocapitalize="off" autocomplete="off" value="' + esc((location.hostname.match(/^([^.]+)\.github\.io$/) || [])[1] || '') + '"></div><div class="campo"><label>Repositório privado</label><input class="inp" id="gh-r" value="minhas-financas-dados" autocapitalize="off"></div></div>' +
        '<div class="campo"><label>Chave de acesso (token)</label><input class="inp" id="gh-t" type="password" autocomplete="off" placeholder="github_pat_…"></div><button class="btn pri" data-acao="gh-conectar">Conectar</button></details>'));
    h += item('backup', 'B', '#5b6cf0', 'Backups', 'Na versão instalada: backup diário automático', '<p class="mut" style="margin-top:0">Na versão instalada, o app faz um backup por dia (guarda os 30 mais recentes) e outro antes de apagar, importar ou restaurar. Aqui na prévia, você pode baixar um arquivo com tudo.</p><button class="btn sec" data-acao="baixar-json">Baixar cópia dos dados</button> <label class="btn neu">Restaurar cópia<input type="file" accept=".json" id="restaurar-json" class="sr"></label>');
    h += item('celular', 'A', '#00a3a3', 'Acessar pelo celular', 'PIN e QR code (versão instalada)', '<p class="mut" style="margin-top:0">Na versão instalada no seu computador, aqui vão aparecer o PIN, os QR codes para parear o celular (rede de casa e Tailscale) e a lista de aparelhos conectados.</p>');
    h += item('csv', 'I', '#12a150', 'Importar / exportar planilha', 'CSV para Excel ou Google Sheets', '<p class="mut" style="margin-top:0">Colunas: data; tipo; descricao; valor; categoria; forma; cartao; parcela; pessoa; situacao.</p><button class="btn sec" data-acao="exportar-csv">Exportar CSV</button> <label class="btn neu">Importar CSV<input type="file" accept=".csv,text/csv" id="importar-csv" class="sr"></label>');
    h += item('aparencia', 'A', '#0a1f44', 'Aparência e nome', 'Tema e nome do app', '<div class="campo"><label>Nome do app</label><input class="inp" data-cfg="nome" value="' + esc(c.nome) + '"></div><div class="campo"><label>Seu nome (aparece no PDF da relação)</label><input class="inp" data-cfg="prefs.meuNome" value="' + esc(c.prefs.meuNome || '') + '" placeholder="Opcional"></div><div class="campo"><label>Sua chave Pix (aparece no PDF da relação)</label><input class="inp" data-cfg="prefs.pix" value="' + esc(c.prefs.pix || '') + '" placeholder="Opcional"></div><div class="seg largo" role="group">' + [['auto', 'Automático'], ['claro', 'Claro'], ['escuro', 'Escuro']].map(function (o) { return '<button data-acao="tema" data-v="' + o[0] + '" aria-pressed="' + ((c.prefs.tema || 'auto') === o[0]) + '">' + o[1] + '</button>'; }).join('') + '</div>');
    h += item('perigo', 'E', '#d32f2f', 'Excluir dados', 'Apagar todos os lançamentos e configurações', '<p class="mut" style="margin-top:0">Apaga todos os lançamentos, cartões e configurações. Na versão instalada, um backup é feito antes.</p><button class="btn perigo" data-acao="apagar-tudo">Apagar tudo</button>');
    return h + '</div></div>';
  }
  function telaCats() {
    function lst(arr, tipo) { return '<ul class="lista">' + arr.map(function (k, i) { return '<li><span class="ico-cat" style="background:' + k.cor + '22">' + cat(k.nome, tipo === 'rcats').ico + '</span><span class="t"><b>' + esc(k.nome) + '</b></span><input type="color" value="' + k.cor + '" data-cor-cat="' + tipo + '" data-i="' + i + '" aria-label="Cor" style="width:36px;height:30px;border:0;background:none"><button class="btn peq neu" data-acao="ren-cat" data-tipo="' + tipo + '" data-i="' + i + '">Renomear</button></li>'; }).join('') + '</ul>'; }
    return '<div class="rot">Gastos</div>' + lst(est.config.cats, 'cats') + '<div class="rot" style="margin-top:12px">Entradas</div>' + lst(est.config.rcats, 'rcats') +
      '<div class="dois" style="margin-top:10px"><input class="inp" id="nova-cat" placeholder="Nova categoria"><select class="inp" id="nova-cat-tipo"><option value="cats">de gasto</option><option value="rcats">de entrada</option></select></div><button class="btn sec" style="margin-top:10px" data-acao="add-cat">Adicionar</button>';
  }

  /* ===================== JANELAS ===================== */
  function abrirJanela(titulo, corpo, rodape, larga) {
    fecharJanela();
    var f = document.createElement('div'); f.className = 'fundo'; f.id = 'janela';
    f.innerHTML = '<div class="janela' + (larga ? ' larga' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(titulo) + '"><div class="alca"></div><div class="jcab"><h3>' + esc(titulo) + '</h3><button class="icone-btn" data-acao="fechar" aria-label="Fechar">' + ICO.fechar + '</button></div><div class="jcorpo">' + corpo + '</div>' + (rodape ? '<div class="jrod">' + rodape + '</div>' : '') + '</div>';
    f.addEventListener('click', function (e) { if (e.target === f) fecharJanela(); });
    document.body.appendChild(f);
    var foco = f.querySelector('[autofocus]') || f.querySelector('.inp'); if (foco && window.innerWidth > 860) foco.focus();
    return f;
  }
  function fecharJanela() { var j = $('#janela'); if (j) j.remove(); }
  function confirmar(titulo, texto, botao, perigo, cb) {
    var j = abrirJanela(titulo, '<p style="margin-top:0">' + texto + '</p>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn ' + (perigo ? 'perigo' : 'pri') + '" id="ok-conf">' + esc(botao) + '</button>');
    $('#ok-conf', j).onclick = function () { fecharJanela(); cb(); };
  }

  /* --------- detalhamento --------- */
  function detalhar(titulo, lista, dicasExtra) {
    var tot = 0; lista.forEach(function (t) { tot += t.tipo === 'receita' ? +t.valor : C.valorDespesa(t); });
    var cats = C.porCategoria(lista), fm = C.porForma(lista.filter(function (t) { return t.tipo === 'despesa'; }));
    var corpo = '<div class="indicadores" style="margin-top:0"><div class="ind"><span class="r">Total</span><div class="v">' + moeda(tot) + '</div></div><div class="ind"><span class="r">Quantidade</span><div class="v">' + lista.length + '</div></div><div class="ind"><span class="r">Média</span><div class="v">' + moeda(lista.length ? tot / lista.length : 0) + '</div></div><div class="ind"><span class="r">Maior</span><div class="v">' + moeda(lista.reduce(function (m, t) { return Math.max(m, +t.valor); }, 0)) + '</div></div></div>';
    if (cats.length > 1) corpo += '<div class="rot" style="margin-top:16px">Por categoria</div>' + G.barraDividida(cats.map(function (c) { return { nome: c.nome, valor: c.valor, cor: cat(c.nome).cor }; })) + '<div class="chips">' + cats.map(function (c) { return '<span class="chip"><i style="width:8px;height:8px;border-radius:4px;background:' + cat(c.nome).cor + '"></i>' + esc(c.nome) + ' ' + moedaTxt(c.valor) + '</span>'; }).join('') + '</div>';
    if (fm.length > 1) corpo += '<div class="rot" style="margin-top:16px">Por forma de pagamento</div><div class="chips">' + fm.map(function (c) { return '<span class="chip">' + c.nome + ' ' + moedaTxt(c.valor) + '</span>'; }).join('') + '</div>';
    if (dicasExtra) corpo += '<div class="previa" style="margin-top:14px">' + dicasExtra + '</div>';
    corpo += '<ul class="lista" style="margin-top:12px">' + (lista.length ? lista.slice().sort(function (a, b) { return a.data < b.data ? 1 : -1; }).map(linhaTx).join('') : '<li class="mut">Nada por aqui</li>') + '</ul>';
    abrirJanela(titulo, corpo, null, true);
  }

  /* --------- novo / editar lançamento --------- */
  var form = null;
  function abrirLancamento(op) {
    op = op || {};
    var t = op.id ? C.porId(est.tx, op.id) : null;
    form = t ? {
      id: t.id, orig: JSON.parse(JSON.stringify(t)), tipo: t.tipo, data: t.data, valor: D.fmt(t.grupo && !t.saldoInicial ? t.valor : t.valor, true), descricao: t.descricao, categoria: t.categoria, forma: t.forma, cartaoId: t.cartaoId,
      parcelas: t.parcelas || 1, assinatura: !!t.recorrente, pago: !!t.pago, fisico: !!t.fisico, estorno: !!t.estorno, pessoaId: t.pessoaId || 'eu',
      dividir: !!(t.divisao && t.divisao.length), divisao: t.divisao ? t.divisao.map(function (d) { return { pessoaId: d.pessoaId, valor: D.fmt(d.valor, true) }; }) : [],
      divSel: t.divisao ? t.divisao.map(function (d) { return d.pessoaId; }) : [], divManual: !!(t.divisao && t.divisao.some(function (d) { return Math.abs(d.valor - t.divisao[0].valor) > 0.011; })), descOriginal: t.descOriginal, obs: t.obs || '', regra5du: t.regraData === '5du', acerto: !!t.acerto
    } : {
      tipo: op.tipo || 'despesa', data: est.hoje, valor: '', descricao: '', categoria: op.tipo === 'receita' ? 'Salário' : (est.config.cats[0] || {}).nome, forma: op.forma || (est.config.cards.length ? 'cartao' : 'pix'), cartaoId: op.cartao || (est.config.cards[0] || {}).id,
      parcelas: 1, assinatura: false, repetir: 1, pago: true, fisico: false, estorno: false, pessoaId: op.pessoa || 'eu', dividir: false, divisao: [], divSel: [], divManual: false, regra5du: false, mesSalario: R.mesDe(est.hoje), acerto: !!op.acerto, valorIni: op.valor
    };
    if (form.acerto && op.pessoa) { form.categoria = 'Reembolso'; form.descricao = 'Recebi de ' + C.nomePessoa(est, op.pessoa); if (op.valor) form.valor = D.fmt(op.valor, true); }
    desenharForm();
  }
  function desenharForm() {
    var f = form, ed = !!f.id, rec = f.tipo === 'receita', noCartao = !rec && f.forma === 'cartao', cats = rec ? est.config.rcats : est.config.cats;
    var corpo = '';
    if (!ed) corpo += '<div class="seg largo" role="group" style="margin-bottom:14px"><button data-f="tipo" data-v="despesa" aria-pressed="' + !rec + '">Gasto</button><button data-f="tipo" data-v="receita" aria-pressed="' + rec + '">Entrada</button></div>';
    if (!rec) corpo += '<div class="campo"><span class="rot">Como pagou</span><div class="chips">' + ['cartao', 'pix', 'debito'].concat(f.forma === 'dinheiro' ? ['dinheiro'] : []).map(function (k) { return '<button class="opc" data-f="forma" data-v="' + k + '" aria-pressed="' + (f.forma === k) + '">' + (k === 'cartao' ? 'Cartão de crédito' : FORMAS[k]) + '</button>'; }).join('') + '</div></div>';
    if (noCartao) {
      if (!est.config.cards.length) corpo += '<div class="previa" style="margin-bottom:14px">Nenhum cartão cadastrado. <button class="link" data-acao="novo-cartao">Cadastrar agora</button></div>';
      else corpo += '<div class="campo"><span class="rot">Cartão</span><div class="chips">' + est.config.cards.map(function (c) { return '<button class="opc" data-f="cartaoId" data-v="' + c.id + '" aria-pressed="' + (f.cartaoId === c.id) + '"><i style="width:14px;height:10px;border-radius:3px;background:' + (c.cor || '#0a4fd1') + '"></i>' + esc(c.nome) + '</button>'; }).join('') + '</div></div>' +
        '<div class="seg largo" role="group" style="margin-bottom:14px"><button data-f="estorno" data-v="" aria-pressed="' + !f.estorno + '">Compra</button><button data-f="estorno" data-v="1" aria-pressed="' + !!f.estorno + '">Estorno / reembolso</button></div>';
    }
    corpo += '<div class="dois"><div class="campo"><label for="f-valor">Valor' + (ed && f.orig.parcelas ? ' da parcela' : '') + '</label><input class="inp" id="f-valor" inputmode="decimal" placeholder="0,00" value="' + esc(f.valor) + '" autofocus><div class="dica-campo" id="f-valor-dica"></div></div>' +
      '<div class="campo"><label for="f-data">' + (rec && f.regra5du ? 'Mês do salário' : 'Data') + '</label>' + (rec && f.regra5du && !ed ? '<input class="inp" id="f-mes" type="month" value="' + f.mesSalario + '">' : '<input class="inp" id="f-data" type="date" value="' + f.data + '">') + '<div class="dica-campo" id="f-data-dica"></div></div></div>';
    corpo += '<div class="campo"><label for="f-desc">Nome da compra' + (f.descOriginal ? ' (pode mudar)' : '') + '</label><input class="inp" id="f-desc" value="' + esc(f.descricao) + '" placeholder="' + (rec ? 'Ex.: Salário' : 'Ex.: Mercado do bairro') + '">' + (f.descOriginal ? '<div class="dica-campo">Na fatura aparece: ' + esc(f.descOriginal) + '</div>' : '') + '</div>';
    if (ed && f.orig.tipo === 'despesa' && !f.orig.estorno) corpo += '<button class="btn ' + (f.orig.contestacao ? 'sec' : 'perigo') + '" style="width:100%;margin-bottom:10px" data-acao="contestar" data-id="' + f.id + '">' + (f.orig.contestacao ? 'Contestada em ' + R.fmtData(f.orig.contestacao.data) + ' · ' + ST_CONT[f.orig.contestacao.status][0] + ' — atualizar' : 'Contestar compra') + '</button>';
    if (ed && f.orig.grupo && f.orig.parcelas && f.orig.forma === 'cartao' && !f.orig.saldoInicial) corpo += '<button class="btn sec" style="width:100%;margin-bottom:14px" data-acao="adiantar" data-grupo="' + f.orig.grupo + '">Adiantar parcelas desta compra</button>';
    corpo += '<div class="campo"><label for="f-obs">Observação</label><input class="inp" id="f-obs" value="' + esc(f.obs || '') + '" placeholder="Opcional"></div>';
    corpo += '<div class="campo"><span class="rot">Categoria</span><div class="chips">' + cats.map(function (c) { return '<button class="opc" data-f="categoria" data-v="' + esc(c.nome) + '" aria-pressed="' + (f.categoria === c.nome) + '">' + esc(c.nome) + '</button>'; }).join('') + '</div></div>';
    // de quem é
    if (!rec && est.config.pessoas.length) {
      var todas = [{ id: 'eu', nome: 'Eu', cor: '#0a4fd1' }].concat(ativas());
      if (f.pessoaId && f.pessoaId !== 'eu' && !todas.some(function (p) { return p.id === f.pessoaId; })) todas.push(pessoa(f.pessoaId));
      (f.divSel || []).forEach(function (id) { if (!todas.some(function (p) { return p.id === id; })) todas.push(pessoa(id)); });
      corpo += '<div class="campo"><span class="rot">Responsável pela compra</span><div class="seg largo" role="group" style="margin-bottom:8px"><button data-f="dividir" data-v="" aria-pressed="' + !f.dividir + '">Uma pessoa</button><button data-f="dividir" data-v="1" aria-pressed="' + !!f.dividir + '">Dividir</button></div>';
      if (!f.dividir) {
        corpo += '<div class="chips">' + todas.map(function (p) { return '<button class="opc" data-f="pessoaId" data-v="' + p.id + '" aria-pressed="' + (f.pessoaId === p.id) + '">' + avatar(p, 1) + esc(p.nome) + '</button>'; }).join('') + '</div>';
        var pe = pessoa(f.pessoaId); if (pe && pe.tipo === 'empresa') corpo += '<div class="previa" style="margin-top:8px">Compra da empresa: o app vai te lembrar de <b>pedir o reembolso</b>.</div>';
      } else {
        var sel = f.divSel || [];
        corpo += '<div class="divisao">' + ((est.config.grupos || []).length ? '<div class="chips" style="margin-bottom:8px">' + est.config.grupos.map(function (g) { return '<button class="opc" data-acao="div-grupo" data-id="' + g.id + '">' + esc(g.nome) + '</button>'; }).join('') + '</div>' : '') +
          '<div class="rot" style="margin-bottom:6px">Toque em quem participa</div><div class="chips">' + todas.map(function (p) { return '<button class="opc" data-acao="div-toggle" data-id="' + p.id + '" aria-pressed="' + (sel.indexOf(p.id) >= 0) + '">' + avatar(p, 1) + esc(p.nome) + '</button>'; }).join('') + '</div>' +
          '<label class="alternar" style="margin-top:6px">Valores diferentes para cada um<input type="checkbox" data-fc="divManual" ' + (f.divManual ? 'checked' : '') + '></label>';
        if (f.divManual) corpo += todas.filter(function (p) { return sel.indexOf(p.id) >= 0; }).map(function (p) { var d = f.divisao.filter(function (x) { return x.pessoaId === p.id; })[0]; return '<div class="lin">' + avatar(p, 1) + '<span>' + esc(p.nome) + '</span><input class="inp" inputmode="decimal" placeholder="0,00" data-div="' + p.id + '" value="' + esc(d ? d.valor : '') + '"></div>'; }).join('');
        corpo += '<div class="dica-campo" id="div-dica"></div></div>';
      }
      corpo += '</div>';
    }
    if (rec && est.config.pessoas.length) {
      corpo += '<label class="alternar">É pagamento de alguém que me devia<input type="checkbox" data-fc="acerto" ' + (f.acerto ? 'checked' : '') + '></label>';
      if (f.acerto) corpo += '<div class="chips" style="margin-bottom:12px">' + ativas().map(function (p) { return '<button class="opc" data-f="pessoaId" data-v="' + p.id + '" aria-pressed="' + (f.pessoaId === p.id) + '">' + avatar(p, 1) + esc(p.nome) + '</button>'; }).join('') + '</div>';
    }
    if (noCartao && !f.estorno) {
      if (!ed) corpo += '<div class="dois"><div class="campo"><label for="f-parc">Parcelas</label><select class="inp" id="f-parc"' + (f.assinatura ? ' disabled' : '') + '>' + Array.apply(null, Array(24)).map(function (_, i) { return '<option value="' + (i + 1) + '"' + (+f.parcelas === i + 1 ? ' selected' : '') + '>' + (i ? (i + 1) + 'x' : 'À vista') + '</option>'; }).join('') + '</select></div><div class="campo"><span class="rot">&nbsp;</span><label class="alternar" style="min-height:44px">Assinatura mensal<input type="checkbox" data-fc="assinatura" ' + (f.assinatura ? 'checked' : '') + '></label></div></div>';
    }
    if (!noCartao) {
      if (!ed) corpo += '<div class="campo"><label for="f-rep">Repetir</label><select class="inp" id="f-rep">' + [1, 2, 3, 4, 5, 6, 9, 12, 18, 24, 36].map(function (n) { return '<option value="' + n + '"' + (+f.repetir === n ? ' selected' : '') + '>' + (n === 1 ? 'Não repetir' : 'Por ' + n + ' meses') + '</option>'; }).join('') + '</select></div>';
      corpo += '<label class="alternar">' + (rec ? 'Já recebi' : 'Já paguei') + '<input type="checkbox" data-fc="pago" ' + (f.pago ? 'checked' : '') + '></label>';
      if (rec && f.fisico) corpo += '<label class="alternar">Recebi em dinheiro vivo<input type="checkbox" data-fc="fisico" checked></label>';
      if (rec && f.categoria === 'Salário' && !ed) corpo += '<label class="alternar">Cai no 5º dia útil<input type="checkbox" data-fc="regra5du" ' + (f.regra5du ? 'checked' : '') + '></label>';
    }
    if (ed && (f.orig.grupo || f.orig.recorrente || f.orig.repeticao)) corpo += '<div class="campo" style="margin-top:8px"><span class="rot">Aplicar mudanças em</span><div class="seg largo" role="group"><button data-f="escopo" data-v="esta" aria-pressed="' + (f.escopo !== 'todas') + '">Só esta</button><button data-f="escopo" data-v="todas" aria-pressed="' + (f.escopo === 'todas') + '">Todas da série</button></div><div class="dica-campo">Data, cartão, descrição, categoria e pessoa valem para a série toda. O valor segue a escolha acima.</div></div>';
    corpo += '<div class="previa" id="f-previa" style="margin-top:6px"></div>';
    var rod = (ed ? '<button class="btn perigo" data-acao="excluir-tx">Excluir</button><span class="espaco"></span>' : '') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" data-acao="salvar-tx">Salvar</button>';
    var titulo = ed ? 'Editar lançamento' : (rec ? 'Nova entrada' : (noCartao ? 'Compra no cartão de crédito' : 'Novo gasto'));
    var j = abrirJanela(titulo, corpo, rod);
    atualizarPrevia();
    j.addEventListener('input', function (e) { lerCampos(); atualizarPrevia(); });
  }
  function lerCampos() {
    var j = $('#janela'); if (!j || !form) return;
    var v = $('#f-valor', j); if (v) form.valor = v.value;
    var d = $('#f-data', j); if (d) form.data = d.value;
    var m = $('#f-mes', j); if (m) form.mesSalario = m.value;
    var ds = $('#f-desc', j); if (ds) form.descricao = ds.value;
    var ob = $('#f-obs', j); if (ob) form.obs = ob.value;
    var p = $('#f-parc', j); if (p) form.parcelas = +p.value;
    var r = $('#f-rep', j); if (r) form.repetir = +r.value;
    $$('[data-div]', j).forEach(function (i) {
      var pid = i.getAttribute('data-div'), x = form.divisao.filter(function (q) { return q.pessoaId === pid; })[0];
      if (!x) { x = { pessoaId: pid, valor: '' }; form.divisao.push(x); }
      x.valor = i.value;
    });
  }
  function atualizarPrevia() {
    var f = form, j = $('#janela'); if (!j) return;
    var v = D.ler(f.valor), dica = $('#f-valor-dica', j);
    if (dica) { dica.className = 'dica-campo ' + (f.valor ? (v != null && v > 0 ? 'ok' : 'ruim') : ''); dica.textContent = f.valor ? (v != null && v > 0 ? '= ' + D.fmt(v) : 'Valor não reconhecido') : ''; }
    var dd = $('#f-data-dica', j);
    if (dd && f.data && R.valida(f.data)) { var fer = R.nomeFeriado(f.data, est.config.calendario); dd.textContent = R.DIAS[R.diaSemana(f.data)] + (fer ? ' · ' + fer : ''); }
    var dv = $('#div-dica', j);
    if (dv && f.dividir && !f.divManual) {
      var nsel = (f.divSel || []).length;
      dv.className = 'dica-campo ' + (nsel >= 2 ? 'ok' : 'ruim');
      dv.textContent = nsel >= 2 ? (v ? nsel + ' pessoas · ' + D.fmt(D.dividir(v, nsel)[0]) + ' para cada' : nsel + ' pessoas') : 'Escolha pelo menos 2 pessoas';
    } else if (dv && f.dividir) {
      var soma = 0, ok = true; f.divisao.forEach(function (x) { if ((f.divSel || []).indexOf(x.pessoaId) < 0 || !String(x.valor).trim()) return; var n = D.ler(x.valor); if (n == null) ok = false; else soma += n; });
      var falta = D.arred((v || 0) - soma);
      dv.className = 'dica-campo ' + (!ok ? 'ruim' : Math.abs(falta) < 0.01 ? 'ok' : 'ruim');
      dv.textContent = !ok ? 'Algum valor não foi reconhecido' : Math.abs(falta) < 0.01 ? 'Divisão confere ✓' : (falta > 0 ? 'Faltam ' + D.fmt(falta) : 'Passou ' + D.fmt(-falta));
    }
    var pv = $('#f-previa', j), txt = '';
    if (f.tipo === 'despesa' && f.forma === 'cartao') {
      var c = card(f.cartaoId);
      if (c && c.conferir) txt = 'As datas deste cartão ainda não foram conferidas. ';
      if (c && R.valida(f.data)) {
        var ref = C.faturaDaCompra(c, f.data), dt = C.datasFatura(c, ref, est.config.calendario), n = +f.parcelas || 1;
        txt += f.estorno ? 'O estorno reduz a fatura de <b>' + R.fmtMes(mv(c.id, ref)) + '</b>.' :
          f.assinatura ? 'Cobrança mensal: a primeira cai na fatura de <b>' + R.fmtMes(mv(c.id, ref)) + '</b> (sai da conta em ' + R.fmtData(dt.pagarAte) + ' se pagar no vencimento).' :
            'Cai na fatura de <b>' + R.fmtMes(mv(c.id, ref)) + '</b>, que vence ' + R.fmtData(dt.vencimento) + (dt.adiada ? ' (' + R.DIAS[R.diaSemana(dt.vencimento)] + ', pode pagar até ' + R.fmtDiaMes(dt.pagarAte) + ')' : '') + '.' +
            (n > 1 && v ? '<br>' + n + 'x de ' + D.fmt(D.dividir(v, n)[0]) + ', até a fatura de ' + R.fmtMes(mv(c.id, R.addMes(ref, n - 1))) + '.' : '');
        if (form.id && form.orig && form.orig.forma === 'cartao' && (form.orig.data !== f.data || form.orig.cartaoId !== f.cartaoId) && form.orig.faturaRef !== ref) {
          txt += '<label class="alternar" style="margin-top:8px">Recalcular a fatura? Antes: ' + R.fmtMesCurto(mv(form.orig.cartaoId, form.orig.faturaRef)) + ' → depois: ' + R.fmtMesCurto(mv(c.id, ref)) + '<input type="checkbox" id="recalc" checked></label>';
        }
      }
    } else if (f.tipo === 'receita') {
      if (f.regra5du && !f.id) { var d5 = R.quintoDiaUtil(f.mesSalario || R.mesDe(est.hoje), est.config.calendario, est.config.calendario.sabadoUtil); txt = '5º dia útil: <b>' + R.fmtData(d5) + '</b> (' + R.DIAS[R.diaSemana(d5)] + ')' + (est.config.calendario.sabadoUtil ? ' · sábado conta' : ' · sábado não conta'); }
      else txt = f.fisico ? 'Fica em "Dinheiro físico" até você marcar que depositou.' : (f.pago ? 'Entra no saldo em ' + R.fmtData(f.data) + '.' : 'Fica como "a receber" até você marcar.');
    } else {
      txt = f.forma === 'dinheiro' ? 'Sai do "Dinheiro físico", não da conta.' : (f.pago ? 'Sai da conta em ' + R.fmtData(f.data) + '.' : 'Fica como conta a pagar em ' + R.fmtData(f.data) + '.');
    }
    pv.innerHTML = txt; pv.classList.toggle('oculto', !txt);
  }
  function salvarLancamento() {
    lerCampos();
    var f = form, v = D.ler(f.valor);
    if (v == null || v <= 0) { $('#f-valor').classList.add('erro'); toast('Digite um valor válido'); return; }
    if (!String(f.descricao || '').trim()) { var dsc = $('#f-desc'); if (dsc) { dsc.classList.add('erro'); dsc.focus(); } toast('Dê um nome para a compra'); return; }
    if (!(f.regra5du && !f.id) && !R.valida(f.data)) { toast('Data inválida'); return; }
    var div = null;
    if (f.dividir && f.tipo === 'despesa' && !f.divManual) {
      var selx = f.divSel || [];
      if (selx.length < 2) { toast('Escolha pelo menos 2 pessoas para dividir'); return; }
      var partesx = D.dividir(v, selx.length); div = selx.map(function (id, i) { return { pessoaId: id, valor: partesx[i] }; });
    } else if (f.dividir && f.tipo === 'despesa') {
      div = f.divisao.filter(function (x) { return (f.divSel || []).indexOf(x.pessoaId) >= 0 && String(x.valor).trim(); }).map(function (x) { return { pessoaId: x.pessoaId, valor: D.ler(x.valor) }; });
      if (div.some(function (x) { return x.valor == null; })) { toast('Confira os valores da divisão'); return; }
      div = div.filter(function (x) { return x.valor > 0; });
      if (div.length < 2) { toast('Na divisão, preencha pelo menos 2 pessoas'); return; }
      var somaDv = D.soma(div.map(function (x) { return x.valor; })); if (Math.abs(somaDv - v) > 0.009) { toast('A divisão soma ' + D.fmt(somaDv) + ', mas o valor é ' + D.fmt(v)); return; }
    }
    if (f.id) return salvarEdicao(v, div);
    try {
      var novos = C.criarLancamentos({
        tipo: f.tipo, data: f.data, valor: v, descricao: f.descricao, categoria: f.categoria, forma: f.forma, cartaoId: f.cartaoId,
        parcelas: f.assinatura ? 1 : f.parcelas, assinatura: f.assinatura, repetir: f.repetir, pago: f.pago, fisico: f.fisico, estorno: f.estorno,
        pessoaId: (f.tipo === 'receita' && !f.acerto) || f.dividir ? null : f.pessoaId, divisao: div, regra5du: f.regra5du, mesSalario: f.mesSalario, acerto: f.tipo === 'receita' && f.acerto
      }, est);
    } catch (e) { toast(e.message); return; }
    if ((f.obs || '').trim()) novos.forEach(function (t) { t.obs = f.obs.trim(); });
    est.tx = est.tx.concat(novos); est.config.comecou = true;
    salvar(); fecharJanela(); render();
    toast(novos.length > 1 ? novos.length + ' lançamentos criados' : 'Lançamento salvo');
  }
  function salvarEdicao(v, div) {
    var f = form, t = C.porId(est.tx, f.id), o = f.orig;
    var serie = est.tx.filter(function (x) { return (o.grupo && x.grupo === o.grupo) || (o.recorrente && x.recorrente === o.recorrente) || (o.repeticao && x.repeticao === o.repeticao); });
    if (!serie.length) serie = [t];
    var recalc = $('#recalc') ? $('#recalc').checked : true;
    var dDias = R.valida(f.data) ? R.diffDias(o.data, f.data) : 0;
    serie.forEach(function (x) {
      var eu = x.id === t.id;
      x.descricao = f.descricao.trim(); x.categoria = f.categoria;
      if (eu) { if ((f.obs || '').trim()) x.obs = f.obs.trim(); else delete x.obs; }
      if (o.tipo === 'despesa') {
        if (div && div.length) { x.divisao = div; delete x.pessoaId; } else { delete x.divisao; if (f.pessoaId && f.pessoaId !== 'eu') x.pessoaId = f.pessoaId; else delete x.pessoaId; }
      } else if (f.acerto) { x.acerto = true; x.pessoaId = f.pessoaId; } else { delete x.acerto; delete x.pessoaId; }
      if (eu || f.escopo === 'todas') { x.valor = v; if (x.divisao && serie.length > 1 && !eu) x.divisao = C.dividirProporcional(v, div || x.divisao, D.soma((div || x.divisao).map(function (q) { return q.valor; }))); }
      if (eu && x.divisao) x.divisao = C.dividirProporcional(v, x.divisao, D.soma(x.divisao.map(function (q) { return q.valor; })));
      if (dDias && !(x.regraData === '5du' && !eu)) { x.data = R.addDias(x.data, dDias); if (eu && x.regraData) x.dataManual = true; }
      if (o.forma === 'cartao') {
        x.cartaoId = f.cartaoId;
        x.estorno = !!f.estorno || undefined; if (!x.estorno) delete x.estorno;
      } else if (o.tipo === 'despesa') { x.forma = f.forma; if (f.forma === 'dinheiro') x.fisico = true; else delete x.fisico; }
      if (eu && !C.ehCartao(x)) { x.pago = f.pago; if (o.tipo === 'receita') { if (f.fisico) x.fisico = true; else delete x.fisico; } }
    });
    if (o.forma === 'cartao' && recalc && (dDias || o.cartaoId !== f.cartaoId)) {
      var c = card(f.cartaoId), p1 = serie.filter(function (q) { return q.parcela === 1; })[0];
      serie.forEach(function (x) { x.faturaRef = x.parcela && p1 ? R.addMes(C.faturaDaCompra(c, p1.data), x.parcela - 1) : C.faturaDaCompra(c, x.data); });
    }
    if (o.grupo && f.escopo === 'todas' && o.parcelas) serie.forEach(function (x) { x.valorTotal = D.arred(v * o.parcelas); });
    var volta = form.voltaSep;
    salvar(); fecharJanela(); render(); toast('Alterações salvas');
    if (volta) { sep = volta; if (sep.i < sep.ids.length - 1) { sep.i++; desenharSeparar(); } }
  }
  function excluirLancamento() {
    var t = C.porId(est.tx, form.id), o = form.orig, g = o.grupo || o.recorrente || o.repeticao;
    function apagar(ids) { est.tx = est.tx.filter(function (x) { return ids.indexOf(x.id) < 0; }); salvar(); fecharJanela(); render(); toast('Excluído'); }
    if (g) {
      var serie = est.tx.filter(function (x) { return x.grupo === g || x.recorrente === g || x.repeticao === g; });
      var j = abrirJanela('Excluir', '<p style="margin-top:0">Este lançamento faz parte de uma série com ' + serie.length + ' itens.</p>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn perigo" id="ex-um">Só este</button>' + (o.recorrente ? '<button class="btn perigo" id="ex-fut">Este e os próximos</button>' : '') + '<button class="btn perigo" id="ex-todos">Todos</button>');
      $('#ex-um', j).onclick = function () { apagar([t.id]); };
      if ($('#ex-fut', j)) $('#ex-fut', j).onclick = function () { apagar(serie.filter(function (x) { return x.data >= t.data; }).map(function (x) { return x.id; })); };
      $('#ex-todos', j).onclick = function () { apagar(serie.map(function (x) { return x.id; })); };
    } else confirmar('Excluir', 'Excluir "' + esc(t.descricao || t.categoria) + '"?', 'Excluir', true, function () { apagar([t.id]); });
  }

  /* --------- cartão --------- */
  function abrirCartao(id) {
    var c = id ? card(id) : { nome: '', banco: '', modelo: '', bandeira: '', fechamento: 1, vencimento: 10, limite: '', cor: '#0a4fd1', img: '' };
    var cores = ['#0a4fd1', '#0033a0', '#820ad1', '#ec7000', '#cc092f', '#11c76f', '#1a1a1a', '#b8860b', '#00a3a3', '#e5484d'];
    var corpo = '<div id="cc-prev" style="margin-bottom:16px">' + ccHtml(c) + '</div>' +
      '<div class="dois"><div class="campo"><label>Nome do cartão</label><input class="inp" id="c-nome" value="' + esc(c.nome) + '" placeholder="Ex.: Cartão roxo"></div><div class="campo"><label>Banco</label><input class="inp" id="c-banco" value="' + esc(c.banco) + '" placeholder="Ex.: Meu banco"></div></div>' +
      '<div class="dois"><div class="campo"><label>Modelo</label><input class="inp" id="c-modelo" value="' + esc(c.modelo) + '" placeholder="Ex.: Platinum"></div><div class="campo"><label>Bandeira</label><select class="inp" id="c-band">' + ['', 'Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'].map(function (b) { return '<option' + (c.bandeira === b ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="dois"><div class="campo"><label>Dia do fechamento</label><input class="inp" id="c-fech" type="number" min="1" max="31" inputmode="numeric" value="' + c.fechamento + '"></div><div class="campo"><label>Dia do vencimento</label><input class="inp" id="c-venc" type="number" min="1" max="31" inputmode="numeric" value="' + c.vencimento + '"></div></div>' +
      (id ? '<div class="dica-campo" style="margin:-8px 0 12px">Se mudar as datas, vale só para compras novas. Faturas já fechadas mantêm o dia antigo.</div>' : '') +
      '<div class="campo"><label>Limite</label><input class="inp" id="c-lim" inputmode="decimal" value="' + (c.limite ? D.fmt(c.limite, true) : '') + '" placeholder="0,00"></div>' +
      '<div class="campo"><span class="rot">Cor</span><div class="chips">' + cores.map(function (k) { return '<button class="opc" style="width:38px;padding:0;background:' + k + '" data-cor="' + k + '" aria-label="Cor ' + k + '" aria-pressed="' + (c.cor === k) + '"></button>'; }).join('') + '</div></div>' +
      '<div class="campo"><span class="rot">Foto da frente do cartão (opcional)</span><div class="linha-flex"><label class="btn neu">Escolher imagem<input type="file" accept="image/*" id="c-img" class="sr"></label>' + (c.img ? '<button class="btn neu" id="c-img-rem">Remover foto</button>' : '') + '</div><div class="dica-campo">A imagem é reduzida no aparelho. Se estiver em pé, ela é deitada automaticamente.</div></div>';
    var rod = (id ? '<button class="btn perigo" id="c-excluir">Excluir</button><span class="espaco"></span>' : '') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="c-salvar">Salvar</button>';
    var j = abrirJanela(id ? 'Editar cartão' : 'Novo cartão', corpo, rod), tmp = { cor: c.cor, img: c.img };
    function prev() { var x = { id: 'p', nome: $('#c-nome', j).value || 'Cartão', banco: $('#c-banco', j).value, modelo: $('#c-modelo', j).value, bandeira: $('#c-band', j).value, cor: tmp.cor, img: tmp.img }; $('#cc-prev', j).innerHTML = ccHtml(x); }
    j.addEventListener('input', prev);
    $$('[data-cor]', j).forEach(function (b) { b.onclick = function () { tmp.cor = b.getAttribute('data-cor'); $$('[data-cor]', j).forEach(function (q) { q.setAttribute('aria-pressed', q === b); }); prev(); }; });
    $('#c-img', j).onchange = function (e) { var file = e.target.files[0]; if (!file) return; reduzirImagem(file, function (url) { tmp.img = url; prev(); }); };
    if ($('#c-img-rem', j)) $('#c-img-rem', j).onclick = function () { tmp.img = ''; prev(); };
    $('#c-salvar', j).onclick = function () {
      var nome = $('#c-nome', j).value.trim(), fech = +$('#c-fech', j).value, venc = +$('#c-venc', j).value, lim = D.ler($('#c-lim', j).value || '0');
      if (!nome) return toast('Dê um nome ao cartão');
      if (!(fech >= 1 && fech <= 31 && venc >= 1 && venc <= 31)) return toast('Dias devem ser de 1 a 31');
      var novo = id ? C.mudarDatasCartao(c, fech, venc, est.hoje) : { id: C.novoId(), fechamento: fech, vencimento: venc };
      delete novo.conferir;
      Object.assign(novo, { nome: nome, banco: $('#c-banco', j).value.trim(), modelo: $('#c-modelo', j).value.trim(), bandeira: $('#c-band', j).value, limite: lim || 0, cor: tmp.cor, img: tmp.img || '' });
      var mudouDatas = id && (fech !== +c.fechamento || venc !== +c.vencimento);
      if (id) est.config.cards = est.config.cards.map(function (x) { return x.id === id ? novo : x; }); else est.config.cards.push(novo);
      if (id && (c.conferir || mudouDatas)) C.remapearPlanilha(est, novo);
      est.config.comecou = true; ui.cardSel = novo.id; salvar(); fecharJanela(); render();
      toast(mudouDatas ? 'Datas novas valem para compras a partir de agora' : 'Cartão salvo');
    };
    if (id) $('#c-excluir', j).onclick = function () {
      var n = est.tx.filter(function (t) { return t.cartaoId === id; }).length;
      confirmar('Excluir cartão', 'Excluir o cartão "' + esc(c.nome) + '" e as ' + n + ' compras dele? Na versão instalada, um backup é feito antes.', 'Excluir', true, function () {
        est.config.cards = est.config.cards.filter(function (x) { return x.id !== id; });
        est.tx = est.tx.filter(function (t) { return t.cartaoId !== id; });
        Object.keys(est.config.fatPagas).forEach(function (k) { if (k.indexOf(id + '|') === 0) delete est.config.fatPagas[k]; });
        salvar(); render(); toast('Cartão excluído');
      });
    };
  }
  /* reduz a foto do cartão para ~90 KB; se estiver em pé, deita; corta margens claras/escuras */
  function reduzirImagem(file, cb) {
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height, rot = h > w, cv = document.createElement('canvas'), W = 640, H = Math.round(640 / 1.586);
        cv.width = W; cv.height = H; var ctx = cv.getContext('2d');
        ctx.save();
        if (rot) { ctx.translate(W, 0); ctx.rotate(Math.PI / 2); var s = Math.max(H / w, W / h); ctx.drawImage(img, (H - w * s) / 2, (W - h * s) / 2, w * s, h * s); }
        else { var s2 = Math.max(W / w, H / h); ctx.drawImage(img, (W - w * s2) / 2, (H - h * s2) / 2, w * s2, h * s2); }
        ctx.restore();
        var q = .85, url = cv.toDataURL('image/jpeg', q);
        while (url.length > 120000 && q > .4) { q -= .1; url = cv.toDataURL('image/jpeg', q); }
        cb(url);
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function verFatura(cardId, ref) {
    var c = card(cardId), f = C.fatura(est, cardId, ref), st = C.statusFatura(est, f, est.hoje), pp = C.porPessoa(f.itens);
    var corpo = '<div class="linha-flex" style="align-items:flex-end"><div><div class="mut" style="font-size:13px">' + esc(c.nome) + ' · ' + chipStatus(st) + '</div><div class="grande">' + moeda(f.total) + '</div></div></div>' +
      '<p class="mut" style="margin:6px 0 0;font-size:14px">Fecha ' + R.fmtData(f.fechamento) + ' · vence ' + R.fmtData(f.vencimento) + (f.adiada ? ' (' + R.DIAS[R.diaSemana(f.vencimento)] + ') · pagar até ' + R.fmtData(f.pagarAte) : '') + (f.pagamento ? ' · paga em ' + R.fmtData(f.pagamento.data) : '') + '</p>';
    var ks = Object.keys(pp).filter(function (k) { return Math.abs(pp[k]) > .009; });
    if (ks.length && (ks.length > 1 || ks[0] !== 'eu')) corpo += '<div class="rot" style="margin-top:14px">Quanto é de cada pessoa</div><ul class="lista">' + ks.map(function (k) { var p = pessoa(k) || { nome: '?', cor: '#999' }; return '<li>' + avatar(p) + '<span class="t"><b>' + esc(p.nome) + '</b></span><span class="v">' + moeda(pp[k]) + '</span></li>'; }).join('') + '</ul>';
    corpo += '<div class="rot" style="margin-top:14px">Compras (' + f.itens.length + ')</div><ul class="lista">' + (f.itens.length ? f.itens.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; }).map(linhaTx).join('') : '<li class="mut">Nenhuma compra</li>') + '</ul>';
    var rod = '<button class="btn sec" data-acao="separar-fatura" data-id="' + cardId + '" data-ref="' + ref + '"' + (f.itens.length ? '' : ' disabled') + '>Classificar compras</button><span class="espaco"></span><button class="btn neu" data-acao="fechar">Fechar</button>' + (f.pagamento ? '<button class="btn sec" data-acao="desfazer-pag" data-id="' + cardId + '" data-ref="' + ref + '">Desfazer pagamento</button>' : (f.total > 0 ? '<button class="btn pri" data-acao="pagar-fatura" data-id="' + cardId + '" data-ref="' + ref + '">Marcar como paga</button>' : ''));
    abrirJanela('Fatura de ' + R.fmtMes(mv(cardId, ref)), corpo, rod, true);
  }
  function pagarFatura(cardId, ref) {
    var c = card(cardId), f = C.fatura(est, cardId, ref), sug = est.hoje < f.vencimento ? est.hoje : (est.hoje <= f.pagarAte ? est.hoje : est.hoje);
    var j = abrirJanela('Pagamento da fatura', '<p style="margin-top:0">' + esc(c.nome) + ' · fatura de ' + R.fmtMes(mv(cardId, ref)) + ' · <b>' + moedaTxt(f.total) + '</b></p><div class="campo"><label>Data do pagamento</label><input class="inp" type="date" id="pg-data" value="' + sug + '"></div><p class="mut" style="font-size:13px">O valor sai do saldo nessa data e o limite é liberado.</p>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="pg-ok">Confirmar</button>');
    $('#pg-ok', j).onclick = function () {
      var d = $('#pg-data', j).value; if (!R.valida(d)) return toast('Data inválida');
      est.config.fatPagas[cardId + '|' + ref] = { data: d, valor: f.total }; salvar(); fecharJanela(); render();
      toast(d > f.pagarAte ? 'Paga com atraso' : 'Fatura paga ✓');
    };
  }
  function deverCartao(id) {
    var c = card(id), j = abrirJanela('Quanto já devo neste cartão', '<p class="mut" style="margin-top:0">Para quem está começando a usar o app: informe o total que você já deve no ' + esc(c.nome) + ' (compras antigas e parcelas). O valor é distribuído nas próximas faturas como "Saldo anterior do cartão".</p><div class="dois"><div class="campo"><label>Valor total</label><input class="inp" id="dv-v" inputmode="decimal" placeholder="0,00"></div><div class="campo"><label>Em quantas faturas</label><input class="inp" id="dv-n" type="number" min="1" max="48" value="1"></div></div>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="dv-ok">Lançar</button>');
    $('#dv-ok', j).onclick = function () {
      var v = D.ler($('#dv-v', j).value), n = +$('#dv-n', j).value || 1; if (!v || v <= 0) return toast('Valor inválido');
      est.tx = est.tx.concat(C.saldoAnteriorCartao(est, c, v, n, est.hoje)); salvar(); fecharJanela(); render(); toast('Saldo anterior lançado');
    };
  }

  /* --------- pessoas --------- */
  function abrirPessoa(id) {
    var p = id ? C.porId(est.config.pessoas, id) : { nome: '', cor: CORES_PESSOA[est.config.pessoas.length % CORES_PESSOA.length] };
    var j = abrirJanela(id ? 'Editar pessoa' : 'Nova pessoa', '<div class="campo"><label>Nome</label><input class="inp" id="p-nome" value="' + esc(p.nome) + '" placeholder="Ex.: Mãe, Ana, Bruno"></div><label class="alternar">É empresa (preciso pedir reembolso)<input type="checkbox" id="p-emp" ' + (p.tipo === 'empresa' ? 'checked' : '') + '></label><div class="campo"><span class="rot">Cor</span><div class="chips">' + CORES_PESSOA.map(function (k) { return '<button class="opc" style="width:38px;padding:0;background:' + k + '" data-cor="' + k + '" aria-pressed="' + (p.cor === k) + '" aria-label="Cor"></button>'; }).join('') + '</div></div>',
      (id ? '<button class="btn perigo" id="p-rem">Remover</button><button class="btn neu" data-acao="arquivar-pessoa" data-id="' + id + '">Arquivar</button><span class="espaco"></span>' : '') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="p-ok">Salvar</button>'), cor = p.cor;
    $$('[data-cor]', j).forEach(function (b) { b.onclick = function () { cor = b.getAttribute('data-cor'); $$('[data-cor]', j).forEach(function (q) { q.setAttribute('aria-pressed', q === b); }); }; });
    $('#p-ok', j).onclick = function () {
      var n = $('#p-nome', j).value.trim(); if (!n) return toast('Digite o nome');
      var emp = $('#p-emp', j).checked;
      if (id) { p.nome = n; p.cor = cor; if (emp) p.tipo = 'empresa'; else delete p.tipo; } else est.config.pessoas.push(emp ? { id: C.novoId(), nome: n, cor: cor, tipo: 'empresa' } : { id: C.novoId(), nome: n, cor: cor });
      salvar(); fecharJanela(); render(); toast('Pessoa salva');
    };
    if (id) $('#p-rem', j).onclick = function () {
      var usa = est.tx.some(function (t) { return C.envolvePessoa(t, id) || t.pessoaId === id; });
      confirmar('Remover pessoa', usa ? 'As compras de ' + esc(p.nome) + ' continuam, mas passam a contar como suas.' : 'Remover ' + esc(p.nome) + '?', 'Remover', true, function () {
        est.config.pessoas = est.config.pessoas.filter(function (x) { return x.id !== id; });
        est.tx.forEach(function (t) { if (t.pessoaId === id) delete t.pessoaId; if (t.divisao) t.divisao.forEach(function (d) { if (d.pessoaId === id) d.pessoaId = 'eu'; }); });
        salvar(); render();
      });
    };
  }
  function verPessoa(id) {
    var p = C.porId(est.config.pessoas, id), d = C.devedores(est).filter(function (x) { return x.id === id; })[0], g = C.comprasDaPessoa(est, id);
    var emp = p.tipo === 'empresa';
    var corpo = '<div class="linha-flex">' + avatar(p) + '<div style="flex:1"><div class="mut" style="font-size:13px">' + (emp ? (d.deve > 0.009 ? 'A empresa precisa te reembolsar' : 'Reembolsos em dia') : (d.deve > 0.009 ? 'Saldo devedor' : 'Sem pendências')) + '</div><div class="grande ' + (d.deve > 0.009 ? 'neg' : 'pos') + '">' + moeda(d.deve) + '</div></div></div>' +
      '<div class="indicadores"><div class="ind"><span class="r">Em aberto</span><div class="v">' + moeda(d.compras) + '</div></div><div class="ind"><span class="r">Próximas faturas</span><div class="v">' + moeda(d.futuro) + '</div></div><div class="ind"><span class="r">Pago</span><div class="v">' + moeda(d.recebido) + '</div></div></div>' +
      ((est.config.pendencias || []).filter(function (x) { return x.pessoaId === id; }).length ? '<div class="rot" style="margin-top:14px">Valores que ficaram em aberto</div><ul class="lista">' + est.config.pendencias.filter(function (x) { return x.pessoaId === id; }).map(function (x) { return '<li class="clicavel" data-acao="pendencia-editar" data-id="' + id + '" data-pd="' + x.id + '"><span class="t"><b>Fatura de ' + R.fmtMes(x.mes) + '</b><span>' + esc(x.obs || 'ficou em aberto') + '</span></span><span class="v neg">' + moeda(x.valor) + '</span></li>'; }).join('') + '</ul>' : '') +
      '<div class="previa" style="margin-top:12px">' + (p.acertadoAte ? 'Faturas até <b>' + R.fmtMes(p.acertadoAte) + '</b> estão acertadas. ' : 'Nenhum mês marcado como acertado. ') + '<button class="link" data-acao="acertado-ate" data-id="' + id + '">Mudar</button></div>';
    var mesAt = R.mesDe(est.hoje), refs = Object.keys(g).filter(function (r) { return r <= mesAt; }).sort().reverse(), futs = Object.keys(g).filter(function (r) { return r > mesAt; }).sort();
    function blocoMes(r) {
      var parte = 0, aberto = 0; g[r].forEach(function (t) { C.partesDe(t).forEach(function (q) { if (q.pessoaId === id) { parte += q.valor; if (!C.itemAcertado(est, t, id)) aberto += q.valor; } }); });
      return '<div class="rot" style="margin-top:16px;display:flex;justify-content:space-between;gap:8px"><span>Fatura de ' + R.fmtMes(r) + '</span><span>' + moedaTxt(parte) + (aberto > 0.009 && Math.abs(aberto - parte) > 0.009 ? ' · em aberto ' + moedaTxt(aberto) : (aberto <= 0.009 ? ' ✓' : '')) + '</span></div><ul class="lista">' + g[r].map(function (t) {
        var q = 0; C.partesDe(t).forEach(function (x) { if (x.pessoaId === id) q += x.valor; });
        var ac = C.itemAcertado(est, t, id), porMes = !t.quitado && ac;
        var bt = emp ? '<button class="chip ' + (t.reembolsoPedido ? 'bom' : 'av') + '" data-acao="reemb-toggle" data-id="' + id + '" data-tx="' + t.id + '">' + (t.reembolsoPedido ? 'Pedido ✓' : 'Pedir') + '</button>' : '';
        bt += '<button class="circ' + (ac ? ' on' : '') + '" aria-label="Já me pagou" title="Já me pagou" data-acao="quitar-toggle" data-id="' + id + '" data-tx="' + t.id + '"' + (porMes ? ' disabled' : '') + '>' + (ac ? ICO.check : '') + '</button>';
        return '<li>' + bt + '<span class="t clicavel" data-acao="editar" data-id="' + t.id + '"><b>' + esc(t.descricao || t.categoria) + (t.parcelas ? ' ' + t.parcela + '/' + t.parcelas : '') + '</b><span>' + C.dataTxt(t) + ' · ' + (t.cartaoId ? esc((card(t.cartaoId) || {}).nome) : FORMAS[t.forma]) + (t.divisao ? ' · dividido' : '') + (t.obs ? ' · ' + esc(t.obs) : '') + '</span></span><span class="v ' + (q < 0 ? 'pos' : (ac ? 'mut' : '')) + '">' + moeda(q) + '</span></li>';
      }).join('') + '</ul>';
    }
    if (futs.length) corpo += '<details class="recolher" style="margin-top:14px"><summary aria-expanded="false"><span class="rot">Próximas faturas (' + futs.length + ' meses · ' + moedaTxt(d.futuro) + ')</span><span class="seta">' + ICO.seta + '</span></summary>' + futs.map(blocoMes).join('') + '</details>';
    corpo += refs.map(blocoMes).join('');
    var pag = est.tx.filter(function (t) { return t.acerto && t.pessoaId === id; });
    if (pag.length) corpo += '<div class="rot" style="margin-top:16px">Pagamentos recebidos</div><ul class="lista">' + pag.map(linhaTx).join('') + '</ul>';
    var top = $('#janela .janela') && $('#janela .janela').getAttribute('data-pessoa') === id ? $('#janela .janela').scrollTop : 0;
    var j = abrirJanela(p.nome + (emp ? ' ' : ''), corpo, '<button class="btn sec" data-acao="relacao" data-id="' + id + '">Extrato</button><button class="btn sec" data-acao="pendencia-nova" data-id="' + id + '">+ Saldo em aberto</button><span class="espaco"></span><button class="btn pri" data-acao="recebi-pessoa" data-id="' + id + '">Registrar pagamento</button>', true);
    var jan = $('.janela', j); jan.setAttribute('data-pessoa', id); jan.scrollTop = top;
  }

  /* --------- importar fatura --------- */
  var imp = null;
  function abrirImportar(cardId) {
    var cards = est.config.cards; if (!cards.length) return toast('Cadastre um cartão primeiro');
    var c = card(cardId) || cards[0], aberta = C.faturaDaCompra(c, est.hoje);
    imp = { cardId: c.id, ref: refSugerida(c), itens: null };
    desenharImportar();
  }
  function refSugerida(c) {
    var aberta = C.faturaDaCompra(c, est.hoje), ant = C.fatura(est, c.id, R.addMes(aberta, -1));
    return ant.pagamento || ant.total <= 0 && ant.vencimento < est.hoje ? aberta : R.addMes(aberta, -1);
  }
  function desenharImportar() {
    var c = card(imp.cardId), aberta = C.faturaDaCompra(c, est.hoje), opsRef = [];
    for (var i = -12; i <= 1; i++) opsRef.push(R.addMes(aberta, i));
    var corpo = '<div class="campo"><span class="rot">Cartão</span><div class="chips">' + est.config.cards.map(function (x) { return '<button class="opc" data-acao="imp-card" data-id="' + x.id + '" aria-pressed="' + (x.id === imp.cardId) + '"><i style="width:14px;height:10px;border-radius:3px;background:' + (x.cor || '#0a4fd1') + '"></i>' + esc(x.nome) + '</button>'; }).join('') + '</div></div>' +
      '<div class="campo"><label for="imp-ref">De qual fatura (mês do vencimento)</label><select class="inp" id="imp-ref">' + opsRef.reverse().map(function (r) { var d = C.datasFatura(c, r, est.config.calendario); return '<option value="' + r + '"' + (r === imp.ref ? ' selected' : '') + '>' + R.fmtMes(R.mesDe(d.vencimento)) + ' · vence ' + R.fmtData(d.vencimento) + '</option>'; }).join('') + '</select></div>';
    if (!imp.itens) {
      corpo += '<div class="campo"><span class="rot">Arquivo da fatura</span><label class="btn sec" style="width:100%">Escolher arquivo (PDF, CSV, OFX ou Excel salvo como CSV)<input type="file" id="imp-arq" class="sr" accept=".pdf,.csv,.ofx,.txt,application/pdf,text/csv"></label></div>' +
        '<div class="campo"><label for="imp-txt">…ou cole aqui o texto da fatura</label><textarea class="inp" id="imp-txt" style="height:140px" placeholder="Abra a fatura no app do banco ou no PDF, selecione as compras, copie e cole aqui.&#10;Ex.: 05/10 IFOOD *RESTAURANTE 45,90"></textarea></div>' +
        '<p class="mut" style="font-size:13px;margin:0">Cada compra vira um lançamento com o nome que aparece na fatura. Depois você separa de quem é cada uma e pode mudar o nome.</p>';
      abrirJanela('Importar fatura', corpo, '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" data-acao="imp-ler">Ler compras</button>');
    } else {
      var sel = imp.itens.filter(function (x) { return x.marcado; }), tot = 0;
      sel.forEach(function (x) { tot += x.credito ? -x.valor : x.valor; });
      var dup = imp.itens.filter(function (x) { return x.jaExiste; }).length;
      corpo += '<div class="previa" style="margin-bottom:10px">Encontrei <b>' + imp.itens.length + '</b> linha(s)' + (dup ? ' · <b>' + dup + '</b> já estão lançadas e não entram de novo' : '') + '. Vão entrar: <b>' + sel.length + '</b> · total <b>' + D.fmt(tot) + '</b>.</div>' +
        '<ul class="lista">' + imp.itens.map(function (x, i) {
          if (x.jaExiste) return '<li style="opacity:.6"><span class="chip" style="flex:none">já lançada</span><span class="t"><b>' + esc(x.descOriginal) + (x.parcelas ? ' <span class="chip az">parcela ' + x.parcela + '/' + x.parcelas + '</span>' : '') + '</b><span>' + R.fmtData(x.data) + ' · igual a "' + esc(x.igual.descricao) + '"' + (x.igual.data ? ' de ' + R.fmtDiaMes(x.igual.data) : '') + ' · não será importada</span></span><span class="v">' + moeda(x.valor) + '</span></li>';
          return '<li><input type="checkbox" data-imp="' + i + '" ' + (x.marcado ? 'checked' : '') + ' aria-label="Importar" style="width:22px;height:22px;flex:none"><span class="t"><b>' + esc(x.descOriginal) + (x.parcelas ? ' <span class="chip az">parcela ' + x.parcela + '/' + x.parcelas + '</span>' : '') + '</b><span>' + R.fmtData(x.data) + ' · ' + R.DIAS[R.diaSemana(x.data)] + ' · ' + esc(C.sugerirCategoria(est, x.descOriginal)) + (x.credito ? ' · <span class="pos">crédito/estorno</span>' : '') + (x.ignorar ? ' · parece pagamento/total' : '') + (x.jaExiste ? ' · <span class="aviso">já importada</span>' : '') + '</span></span><span class="v ' + (x.credito ? 'pos' : '') + '">' + (x.credito ? '−' : '') + moeda(x.valor) + '</span></li>';
        }).join('') + '</ul>';
      var sob = imp.sobrando || [], nRem = imp.fechada ? sob.filter(function (x) { return x.remover; }).length : 0;
      corpo += '<label class="alternar" style="margin-top:14px;border-top:1px solid var(--line);padding-top:12px">É a fatura fechada completa (conferir com o que está no app)<input type="checkbox" id="imp-fechada" ' + (imp.fechada ? 'checked' : '') + '></label>';
      if (imp.fechada) {
        var totApp = 0; est.tx.forEach(function (t) { if (t.cartaoId === imp.cardId && t.faturaRef === imp.ref && t.tipo === 'despesa' && !sob.some(function (x) { return x.id === t.id && x.remover; })) totApp += C.valorDespesa(t); });
        sel.forEach(function (x) { totApp += x.credito ? -x.valor : x.valor; });
        var tb = totalBanco(), dif = D.arred(totApp - tb);
        corpo += '<div class="previa" style="margin-top:6px">Total da fatura do banco: <b>' + D.fmt(tb) + '</b> · no app depois de confirmar: <b>' + D.fmt(totApp) + '</b>' + (Math.abs(dif) < 0.5 ? ' <span class="pos">✓ confere</span>' : ' · diferença de <b class="neg">' + D.fmt(dif) + '</b>') + '</div>';
        if (sob.length) corpo += '<div class="rot" style="margin:14px 0 4px">Estão no app mas NÃO estão na fatura do banco (' + sob.length + ')</div><p class="mut" style="font-size:13px;margin:0 0 6px">As marcadas serão removidas do app.</p><ul class="lista">' + sob.map(function (x) {
          var t = C.porId(est.tx, x.id); if (!t) return '';
          return '<li><input type="checkbox" data-sob="' + x.id + '" ' + (x.remover ? 'checked' : '') + ' aria-label="Remover" style="width:22px;height:22px;flex:none"><span class="t"><b>' + esc(t.descricao) + (t.parcelas ? ' <span class="chip az">parcela ' + t.parcela + '/' + t.parcelas + '</span>' : '') + '</b><span>' + C.dataTxt(t) + ' · ' + esc(C.descreverPessoas(est, t)) + (t.planilha ? ' · veio da planilha' : '') + '</span></span><span class="v neg">' + moeda(t.valor) + '</span></li>';
        }).join('') + '</ul>';
      }
      abrirJanela('Importar fatura', corpo, '<button class="btn neu" data-acao="imp-voltar">Voltar</button><button class="btn pri" data-acao="imp-confirmar">' + (nRem ? 'Importar ' + sel.length + ' e remover ' + nRem : 'Importar ' + sel.length + ' compra(s)') + '</button>', true);
    }
  }
  function lerArquivoFatura(file) {
    var nome = (file.name || '').toLowerCase();
    if (nome.endsWith('.pdf') || file.type === 'application/pdf') {
      toast('Lendo o PDF…');
      lerPDF(file).then(function (txt) { processarTextoFatura(txt, 'texto'); }).catch(function (e) { toast('Não consegui ler esse PDF. Tente copiar e colar o texto.'); console.error(e); });
      return;
    }
    if (/\.xlsx?$/.test(nome)) { toast('Salve a planilha como CSV (Arquivo › Salvar como › CSV) e envie de novo'); return; }
    var fr = new FileReader();
    fr.onload = function () { processarTextoFatura(fr.result, nome.endsWith('.ofx') ? 'ofx' : (nome.endsWith('.csv') ? 'csv' : 'texto')); };
    fr.readAsText(file, 'utf-8');
  }
  /* lê o texto de um PDF, montando as linhas pela posição (pdf.js fica na pasta vendor) */
  function lerPDF(file) {
    return import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs').then(function (pdfjs) {
      pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
      return file.arrayBuffer().then(function (buf) { return pdfjs.getDocument({ data: buf }).promise; }).then(function (doc) {
        var paginas = [];
        for (var i = 1; i <= doc.numPages; i++) paginas.push(doc.getPage(i).then(function (pg) { return pg.getTextContent(); }));
        return Promise.all(paginas).then(function (conteudos) {
          return conteudos.map(function (tc) {
            var linhas = [];
            tc.items.forEach(function (it) {
              if (!it.str || !it.str.trim()) return;
              var y = it.transform[5], x = it.transform[4], l = null;
              for (var k = 0; k < linhas.length; k++) if (Math.abs(linhas[k].y - y) < 3) { l = linhas[k]; break; }
              if (!l) { l = { y: y, itens: [] }; linhas.push(l); }
              l.itens.push({ x: x, s: it.str });
            });
            linhas.sort(function (a, b) { return b.y - a.y; });
            return linhas.map(function (l) { return l.itens.sort(function (a, b) { return a.x - b.x; }).map(function (q) { return q.s.trim(); }).join(' '); }).join('\n');
          }).join('\n');
        });
      });
    });
  }
  function processarTextoFatura(txt, tipo) {
    function ler(ref) { return tipo === 'ofx' ? C.lerExtratoOFX(txt, ref) : tipo === 'csv' ? C.lerExtratoCSV(txt, ref) : C.lerExtratoTexto(txt, ref); }
    var c = card(imp.cardId), itens = ler(imp.ref);
    // as compras à vista dizem de qual fatura é o extrato (datas lidas a partir da fatura aberta hoje, nunca no futuro)
    var aberta = C.faturaDaCompra(c, est.hoje), cont = {};
    ler(aberta).forEach(function (x) { if (x.parcelas || x.ignorar || x.credito) return; var d = x.data; if (d > est.hoje) d = (+d.slice(0, 4) - 1) + d.slice(4); var r = C.faturaDaCompra(c, d); cont[r] = (cont[r] || 0) + 1; });
    var melhor = Object.keys(cont).sort(function (a, b) { return cont[b] - cont[a]; })[0];
    if (melhor && melhor !== imp.ref && cont[melhor] >= 2 && melhor >= R.addMes(aberta, -3) && melhor <= aberta) {
      var antes = imp.ref; imp.ref = melhor; itens = ler(melhor);
      toast('Pelas datas das compras, esta é a fatura de ' + R.fmtMes(C.mesVenc(est, c.id, melhor)) + ' (você tinha escolhido ' + R.fmtMes(C.mesVenc(est, c.id, antes)) + ')');
    }
    if (!itens.length) return toast('Não encontrei compras. Confira se cada linha tem data, nome e valor.');
    C.marcarDuplicados(itens, est, imp.cardId, imp.ref);
    itens.forEach(function (x) { x.marcado = !x.ignorar && !x.jaExiste; });
    imp.itens = itens;
    var fx = C.fatura(est, imp.cardId, imp.ref);
    imp.fechada = est.hoje >= fx.fechamento;  // fatura fechada: confere tudo
    calcularSobrando(); desenharImportar();
  }
  /* compras do app nessa fatura que NÃO aparecem no arquivo do banco */
  function calcularSobrando() {
    var cas = imp.itens.casados || {}, ant = {};
    (imp.sobrando || []).forEach(function (x) { ant[x.id] = x.remover; });
    imp.sobrando = est.tx.filter(function (t) { return t.cartaoId === imp.cardId && t.faturaRef === imp.ref && t.tipo === 'despesa' && !cas[t.id]; })
      .map(function (t) { return { id: t.id, remover: ant[t.id] != null ? ant[t.id] : true }; });
  }
  function totalBanco() { var tot = 0; imp.itens.forEach(function (x) { if (!x.ignorar) tot += x.credito ? -x.valor : x.valor; }); return D.arred(tot); }
  function confirmarImportar() {
    var c = card(imp.cardId);
    C.marcarDuplicados(imp.itens, est, imp.cardId, imp.ref); // confere de novo na hora de salvar
    var sel = imp.itens.filter(function (x) { return x.marcado && !x.jaExiste; }), enriq = 0;
    imp.itens.forEach(function (x) {
      if (!x.jaExiste || !x.igual) return;
      var t = C.porId(est.tx, x.igual.id);
      if (t && t.semData) { t.data = x.data; delete t.semData; if (!t.descOriginal || t.planilha) t.descOriginal = x.descOriginal; enriq++; }
    });
    var remover = imp.fechada ? (imp.sobrando || []).filter(function (x) { return x.remover; }).map(function (x) { return x.id; }) : [];
    if (remover.length) est.tx = est.tx.filter(function (t) { return remover.indexOf(t.id) < 0; });
    if (!sel.length) { salvar(); fecharJanela(); render(); toast((remover.length ? remover.length + ' compra(s) removida(s) · ' : '') + (enriq ? enriq + ' ganharam a data do banco · ' : '') + 'fatura conferida ✓'); return; }

    var novos = C.lancamentosDoExtrato(sel, c, imp.ref, est);
    est.tx = est.tx.concat(novos); est.config.comecou = true; salvar(); fecharJanela(); render();
    var nFut = novos.filter(function (t) { return t.futura; }).length;
    toast((novos.length - nFut) + ' compra(s) importada(s)' + (nFut ? ' + ' + nFut + ' parcela(s) futura(s)' : '') + (remover.length ? ' · ' + remover.length + ' removida(s)' : ''));
    abrirSeparar(novos.filter(function (t) { return !t.futura; }).map(function (t) { return t.id; }), 'Classificar compras');
  }

  /* --------- separar compras (uma por uma) --------- */
  var sep = null;
  function abrirSeparar(ids, titulo) {
    if (!ids.length) return toast('Nenhuma compra para separar');
    sep = { ids: ids, i: 0, titulo: titulo || 'Separar compras' };
    var prim = ids.findIndex(function (id) { var t = C.porId(est.tx, id); return t && !t.triado; });
    if (prim > 0) sep.i = prim;
    desenharSeparar();
  }
  function desenharSeparar() {
    var t = C.porId(est.tx, sep.ids[sep.i]);
    if (!t) { fecharJanela(); return; }
    if (t.categoria === 'Outros' && !t.triado) { var sg = C.sugerirCategoria(est, t.descOriginal || t.descricao); if (sg !== 'Outros') { t.categoria = sg; t.catSugerida = true; } }
    var c = card(t.cartaoId), todas = [{ id: 'eu', nome: 'Eu', cor: '#0a4fd1' }].concat(ativas()), atual = t.divisao ? null : (t.pessoaId || 'eu');
    var feitas = sep.ids.filter(function (id) { var x = C.porId(est.tx, id); return x && x.triado; }).length;
    var corpo = '<div class="barra" style="margin-bottom:12px"><span style="width:' + (feitas / sep.ids.length * 100).toFixed(1) + '%;background:var(--good)"></span></div>' +
      '<div class="mut" style="font-size:13px">' + (sep.i + 1) + ' de ' + sep.ids.length + ' · ' + feitas + ' separada(s)</div>' +
      '<div class="bloco" style="background:var(--surface-2);box-shadow:none;margin:10px 0 14px;padding:16px"><div class="mut" style="font-size:13px">' + (t.semData ? C.dataTxt(t) : R.fmtData(t.data) + ' · ' + R.DIAS[R.diaSemana(t.data)]) + (c ? ' · ' + esc(c.nome) : '') + (t.parcelas ? ' · parcela ' + t.parcela + '/' + t.parcelas : '') + '</div>' +
      '<div class="medio" style="margin:4px 0">' + (t.estorno ? '−' : '') + moeda(t.valor) + '</div>' + (t.descOriginal ? '<div class="mut" style="font-size:13px">Na fatura: ' + esc(t.descOriginal) + '</div>' : '') + '</div>' +
      '<div class="campo"><label for="sep-nome">Nome da compra (pode mudar)</label><input class="inp" id="sep-nome" value="' + esc(t.descricao) + '"></div>' +
      '<div class="campo"><span class="rot">Categoria' + (t.importado && !t.planilha && !t.triado ? ' <span class="chip az">sugerida · troque se estiver errada</span>' : '') + '</span><select class="inp" id="sep-cat">' + est.config.cats.map(function (k) { return '<option' + (k.nome === t.categoria ? ' selected' : '') + '>' + esc(k.nome) + '</option>'; }).join('') + '</select></div>' +
      '<div class="rot" style="margin-bottom:6px">Responsável (ao tocar, avança para a próxima)</div><div class="chips">' + todas.map(function (p) { return '<button class="opc" data-acao="sep-pessoa" data-id="' + p.id + '" aria-pressed="' + (t.triado && atual === p.id) + '">' + avatar(p, 1) + esc(p.nome) + '</button>'; }).join('') + '</div>' +
      ((est.config.grupos || []).length ? '<div class="rot" style="margin:12px 0 6px">Dividir igualmente</div><div class="chips">' + est.config.grupos.map(function (g) { return '<button class="opc" data-acao="sep-grupo" data-id="' + g.id + '">' + esc(g.nome) + ' (' + g.membros.length + ')</button>'; }).join('') + '<button class="opc" data-acao="sep-dividir">Outra divisão</button></div>' : '') +
      '<div class="chips" style="margin-top:12px"><button class="opc" data-acao="sep-contestar" style="background:color-mix(in srgb,var(--bad) 12%,transparent);color:var(--bad)">Contestar compra</button></div>' + (t.contestacao ? '<div class="previa" style="margin-top:10px">Contestada em ' + R.fmtData(t.contestacao.data) + ' · ' + ST_CONT[t.contestacao.status][0] + '</div>' : '') +
      (t.divisao ? '<div class="previa" style="margin-top:10px">Dividida: ' + esc(C.descreverPessoas(est, t)) + '</div>' : '');
    var rod = '<button class="btn neu" data-acao="sep-ant"' + (sep.i ? '' : ' disabled') + '>‹ Anterior</button><span class="espaco"></span><button class="btn neu" data-acao="fechar">Fechar</button><button class="btn sec" data-acao="sep-prox">' + (sep.i < sep.ids.length - 1 ? 'Pular ›' : 'Concluir') + '</button>';
    abrirJanela(sep.titulo, corpo, rod);
  }
  function sepGuardarNome(t) {
    var n = $('#sep-nome'), k = $('#sep-cat');
    if (n && n.value.trim()) t.descricao = n.value.trim();
    if (k) t.categoria = k.value;
  }
  function propagarParcelas(t) {
    if (!t.grupo) return;
    est.tx.forEach(function (x) {
      if (x === t || x.grupo !== t.grupo || x.planilha) return;
      x.categoria = t.categoria; x.descricao = t.descricao; x.triado = true;
      if (t.divisao) { x.divisao = C.dividirProporcional(x.valor, t.divisao, D.soma(t.divisao.map(function (d) { return d.valor; }))); delete x.pessoaId; }
      else { delete x.divisao; if (t.pessoaId) x.pessoaId = t.pessoaId; else delete x.pessoaId; }
    });
  }
  function sepAvancar() {
    var atual = sep && C.porId(est.tx, sep.ids[sep.i]); if (atual) propagarParcelas(atual);
    salvar();
    if (sep.i < sep.ids.length - 1) { sep.i++; desenharSeparar(); }
    else { fecharJanela(); render(); toast('Classificação concluída'); }
  }

  /* --------- adiantar parcelas --------- */
  function abrirAdiantar(grupo) {
    var t0 = est.tx.filter(function (t) { return t.grupo === grupo; })[0], c = card(t0.cartaoId), aberta = C.faturaDaCompra(c, est.hoje);
    var destino = aberta, futuras = C.parcelasAdiantaveis(est, grupo, destino);
    if (!futuras.length) return toast('Não há parcelas futuras para adiantar');
    var soma = D.soma(futuras.map(function (t) { return t.valor; }));
    var j = abrirJanela('Adiantar parcelas', '<p style="margin-top:0"><b>' + esc(t0.descricao) + '</b> · ' + esc(c.nome) + '<br><span class="mut">' + futuras.length + ' parcela(s) ainda por vir, somando ' + D.fmt(soma) + '</span></p>' +
      '<div class="dois"><div class="campo"><label>Quantas adiantar</label><select class="inp" id="ad-n">' + futuras.map(function (_, i) { var n = futuras.length - i; return '<option value="' + n + '">' + (n === futuras.length ? 'Todas (' + n + ')' : n) + '</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><label>Para a fatura de</label><select class="inp" id="ad-ref">' + [R.addMes(aberta, -1), aberta, R.addMes(aberta, 1)].map(function (r) { return '<option value="' + r + '"' + (r === aberta ? ' selected' : '') + '>' + R.fmtMesCurto(mv(c.id, r)) + ' · vence ' + R.fmtDiaMes(C.datasFatura(c, r, est.config.calendario).vencimento) + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="campo"><label>Quanto vai pagar de fato (se teve desconto)</label><input class="inp" id="ad-v" inputmode="decimal" placeholder="' + D.fmt(soma, true) + '"><div class="dica-campo" id="ad-d"></div></div>' +
      '<p class="mut" style="font-size:13px">As últimas parcelas saem dos meses seguintes e entram na fatura escolhida. Se a compra é de outra pessoa ou dividida, a parte de cada um acompanha.</p>',
      '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="ad-ok">Adiantar</button>');
    function atual() {
      var n = +$('#ad-n', j).value, fut = C.parcelasAdiantaveis(est, grupo, $('#ad-ref', j).value), mov = fut.slice(Math.max(0, fut.length - n)), sm = D.soma(mov.map(function (t) { return t.valor; }));
      var v = D.ler($('#ad-v', j).value); $('#ad-d', j).textContent = 'Parcelas ' + mov.map(function (t) { return t.parcela; }).join(', ') + ' · ' + D.fmt(sm) + (v != null && v < sm ? ' · desconto de ' + D.fmt(sm - v) : '');
      return sm;
    }
    j.addEventListener('input', atual); j.addEventListener('change', atual); atual();
    $('#ad-ok', j).onclick = function () {
      var vtxt = $('#ad-v', j).value.trim(), v = vtxt ? D.ler(vtxt) : null; if (vtxt && v == null) return toast('Valor inválido');
      var r = C.adiantarParcelas(est, grupo, +$('#ad-n', j).value, $('#ad-ref', j).value, v);
      if (r.credito) est.tx.push(r.credito);
      salvar(); fecharJanela(); render(); toast(r.movidas.length + ' parcela(s) adiantada(s)' + (r.credito ? ' com desconto de ' + D.fmt(r.credito.valor) : ''));
    };
  }

  /* --------- relação de gastos de uma pessoa (escolhe a fatura; inclui o que ficou em aberto; texto e PDF) --------- */
  function abrirRelacao(id) {
    var p = C.porId(est.config.pessoas, id), refs = {}, atual = C.mesEmAndamento(est);
    refs[atual] = 1;
    est.tx.forEach(function (t) { if (t.tipo === 'despesa' && C.envolvePessoa(t, id)) refs[C.mesRef(t, est)] = 1; });
    var lista = Object.keys(refs).sort().reverse(), estado = { mes: atual, modo: 'tudo' };
    var j = abrirJanela('Extrato · ' + p.nome, '<div><div class="campo"><label>Fatura</label><select class="inp" id="rl-f">' + lista.map(function (r) { return '<option value="' + r + '"' + (r === atual ? ' selected' : '') + '>' + R.fmtMes(r) + (r === atual ? ' (próxima a pagar)' : '') + '</option>'; }).join('') + '</select></div>' +
      '<div class="campo"><span class="rot">O que mostrar</span><div class="seg largo" role="group" id="rl-modo"><button data-m="tudo" aria-pressed="true">Tudo</button><button data-m="atual" aria-pressed="false">Só esta fatura</button><button data-m="anteriores" aria-pressed="false">Só o de antes</button></div></div></div>' +
      '<div id="rl-prev"></div>',
      '<button class="btn sec" id="rl-c">Copiar texto</button><span class="espaco"></span><button class="btn neu" data-acao="fechar">Fechar</button><button class="btn pri" id="rl-pdf">Gerar PDF</button>', true);
    function rel() { return C.relatorioPessoa(est, id, estado.mes, estado.modo); }
    function desenhar() {
      var r = rel(), h = '<div class="bloco" style="background:var(--surface-2);box-shadow:none;padding:16px;margin-bottom:12px"><div class="mut" style="font-size:12.5px;font-weight:600">TOTAL A PAGAR</div><div class="grande">' + moeda(r.total) + '</div>' +
        '<div class="mut" style="font-size:13.5px;margin-top:6px">' + (r.modo === 'anteriores' ? 'Só o que ficou em aberto antes da fatura de ' + R.nomeMes(r.mes) : 'Compras da fatura ' + moedaTxt(r.totalFatura)) + (r.pendenciaMes ? ' · em aberto desta fatura ' + moedaTxt(r.pendenciaMes) : '') + (r.totalAnteriores ? ' · em aberto de antes ' + moedaTxt(r.totalAnteriores) : '') + (r.pagoMes ? ' · já pagou ' + moedaTxt(r.pagoMes) : '') + '</div></div>';
      r.porCartao.forEach(function (c) {
        h += '<div class="rot" style="display:flex;justify-content:space-between;margin-top:10px"><span><i style="display:inline-block;width:9px;height:9px;border-radius:5px;background:' + c.cor + ';margin-right:6px"></i>' + esc(c.nome) + '</span><span>' + moedaTxt(c.total) + '</span></div><ul class="lista">' +
          c.itens.map(function (i) { return '<li class="clicavel" data-acao="editar" data-id="' + i.t.id + '"><span class="t"><b>' + esc(i.descricao) + (i.parcela ? ' <span class="mut">' + i.parcela + '</span>' : '') + '</b><span>' + esc(i.data) + (i.dividido ? ' · parte de ' + moedaTxt(i.total) : '') + (i.pago ? ' · <span class="pos">já pago</span>' : '') + '</span></span><span class="v' + (i.pago ? ' pos' : '') + '">' + moeda(i.valor) + '</span></li>'; }).join('') + '</ul>';
      });
      if (!r.itens.length && r.modo !== 'anteriores') h += vazio('Nenhuma compra nesta fatura', '');
      var abertos = r.pendenciasMes.map(function (x) { return { mes: r.mes, valor: x.valor, descricao: x.obs || 'Valor em aberto' }; }).concat(r.anteriores);
      if (abertos.length) h += '<div class="rot" style="margin-top:14px">Valores em aberto</div><ul class="lista">' + abertos.map(function (a) { return '<li><span class="t"><b>Fatura de ' + R.fmtMes(a.mes) + '</b><span>' + esc(a.descricao) + (a.pago ? ' · era ' + moedaTxt(a.original) + ', já pagou ' + moedaTxt(a.pago) : '') + '</span></span><span class="v neg">' + moeda(a.valor) + '</span></li>'; }).join('') + '</ul>';
      else if (r.modo === 'anteriores') h += vazio('Nada em aberto de faturas anteriores', '');
      if (r.pagamentos.length) h += '<div class="rot" style="margin-top:14px">Pagamentos recebidos</div><ul class="lista">' + r.pagamentos.map(function (q) { return '<li><span class="t"><b>' + R.fmtData(q.data) + '</b><span>' + (q.mes ? 'fatura de ' + R.fmtMes(q.mes) : '') + '</span></span><span class="v pos">−' + moeda(q.valor) + '</span></li>'; }).join('') + '</ul>';
      $('#rl-prev', j).innerHTML = h;
    }
    $('#rl-f', j).onchange = function () { estado.mes = this.value; desenhar(); };
    $$('#rl-modo button', j).forEach(function (b) { b.onclick = function () { estado.modo = b.getAttribute('data-m'); $$('#rl-modo button', j).forEach(function (q) { q.setAttribute('aria-pressed', q === b); }); desenhar(); }; });
    desenhar();
    $('#rl-c', j).onclick = function () {
      var txt = C.relatorioTexto(rel()), ok = function () { toast('Texto copiado'); };
      var falhou = function () { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); ok(); } catch (e) { toast('Não consegui copiar'); } ta.remove(); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, falhou); else falhou();
    };
    $('#rl-pdf', j).onclick = function () {
      var b = this; b.disabled = true; b.textContent = 'Gerando…';
      var prefs = est.config.prefs || {};
      window.RelatorioPDF.gerar(rel(), { de: prefs.meuNome, pix: prefs.pix }).then(function (bytes) {
        var nome = 'Extrato ' + p.nome + ' - ' + (estado.modo === 'anteriores' ? 'em aberto antes de ' : 'fatura ') + R.nomeMes(estado.mes) + ' ' + estado.mes.slice(0, 4) + '.pdf';
        return baixar(nome, bytes, 'application/pdf');
      }).then(function () { toast('PDF pronto ✓'); }, function (e) { toast(e && e.message ? e.message : 'Não foi possível gerar o PDF'); })
        .then(function () { b.disabled = false; b.textContent = 'Gerar PDF'; });
    };
  }

  /* --------- grupos --------- */
  function abrirGrupo(id) {
    var g = id ? C.porId(est.config.grupos, id) : { nome: '', membros: [] }, sel = g.membros.slice();
    function desenha() {
      var j = abrirJanela(id ? 'Editar grupo' : 'Novo grupo', '<div class="campo"><label>Nome do grupo</label><input class="inp" id="g-nome" value="' + esc(g.nome) + '" placeholder="Ex.: Serviço"></div><div class="rot" style="margin-bottom:6px">Quem faz parte</div><div class="chips">' + [{ id: 'eu', nome: 'Eu', cor: '#0a4fd1' }].concat(ativas()).map(function (p) { return '<button class="opc" data-gm="' + p.id + '" aria-pressed="' + (sel.indexOf(p.id) >= 0) + '">' + avatar(p, 1) + esc(p.nome) + '</button>'; }).join('') + '</div>',
        (id ? '<button class="btn perigo" id="g-rem">Excluir</button><span class="espaco"></span>' : '') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="g-ok">Salvar</button>');
      $$('[data-gm]', j).forEach(function (b) { b.onclick = function () { g.nome = $('#g-nome', j).value; var k = b.getAttribute('data-gm'), i = sel.indexOf(k); if (i >= 0) sel.splice(i, 1); else sel.push(k); desenha(); }; });
      $('#g-ok', j).onclick = function () { var n = $('#g-nome', j).value.trim(); if (!n || sel.length < 2) return toast('Dê um nome e escolha pelo menos 2 pessoas'); if (id) { g.nome = n; g.membros = sel; } else est.config.grupos.push({ id: C.novoId(), nome: n, membros: sel }); salvar(); fecharJanela(); ui.ajAberto = 'pessoas'; render(); };
      if (id) $('#g-rem', j).onclick = function () { est.config.grupos = est.config.grupos.filter(function (x) { return x.id !== id; }); salvar(); fecharJanela(); ui.ajAberto = 'pessoas'; render(); };
    }
    desenha();
  }

  /* --------- contestações --------- */
  var ST_CONT = { aberta: ['Aguardando retorno', 'av'], estornada: ['Estornada ✓', 'bom'], negada: ['Negada', 'ruim'] };
  function chipCont(t) { if (!t.contestacao) return ''; var x = ST_CONT[t.contestacao.status] || ST_CONT.aberta; return ' <span class="chip ' + x[1] + '">' + (t.contestacao.status === 'aberta' ? 'contestada' : x[0]) + '</span>'; }
  function abrirContestacao(id) {
    var t = C.porId(est.tx, id), c = t.contestacao || { data: est.hoje, status: 'aberta', protocolo: '', obs: '' }, card0 = card(t.cartaoId);
    var prox = C.mesEmAndamento(est), novo = !t.contestacao;
    var j = abrirJanela(novo ? 'Contestar compra' : 'Contestação', '<div class="bloco" style="background:var(--surface-2);box-shadow:none;padding:14px;margin-bottom:14px"><b>' + esc(t.descricao) + '</b><div class="mut" style="font-size:13px">' + C.dataTxt(t) + (card0 ? ' · ' + esc(card0.nome) : '') + ' · ' + moedaTxt(t.valor) + (t.descOriginal && t.descOriginal !== t.descricao ? ' · na fatura: ' + esc(t.descOriginal) : '') + '</div></div>' +
      '<div class="dois"><div class="campo"><label>Data da contestação</label><input class="inp" type="date" id="ct-d" value="' + c.data + '"></div><div class="campo"><label>Protocolo (opcional)</label><input class="inp" id="ct-p" value="' + esc(c.protocolo || '') + '"></div></div>' +
      '<div class="campo"><label>Observação</label><input class="inp" id="ct-o" value="' + esc(c.obs || '') + '" placeholder="Ex.: não reconheço, liguei no banco"></div>' +
      '<div class="campo"><span class="rot">Situação</span><div class="seg largo" role="group" id="ct-s">' + ['aberta', 'estornada', 'negada'].map(function (k) { return '<button data-s="' + k + '" aria-pressed="' + (c.status === k) + '">' + ST_CONT[k][0] + '</button>'; }).join('') + '</div></div>' +
      '<div id="ct-est" class="' + (c.status === 'estornada' && !c.creditoId ? '' : 'oculto') + '"><label class="alternar">Lançar o crédito do estorno<input type="checkbox" id="ct-cred" checked></label><div class="campo"><label>Na fatura de</label><select class="inp" id="ct-mes">' + mesesOpcoes(prox) + '</select></div></div>' +
      '<p class="mut" style="font-size:13px">Enquanto estiver contestada ou estornada, a compra não conta nos seus gastos nem na conta de ninguém. Se o banco negar, ela volta a contar.</p>',
      (novo ? '' : '<button class="btn perigo" id="ct-rem">Não é mais contestada</button><span class="espaco"></span>') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="ct-ok">Salvar</button>');
    var st = c.status;
    $$('#ct-s button', j).forEach(function (b) { b.onclick = function () { st = b.getAttribute('data-s'); $$('#ct-s button', j).forEach(function (q) { q.setAttribute('aria-pressed', q === b); }); $('#ct-est', j).classList.toggle('oculto', !(st === 'estornada' && !c.creditoId)); }; });
    $('#ct-ok', j).onclick = function () {
      var nc = { data: $('#ct-d', j).value || est.hoje, status: st, protocolo: $('#ct-p', j).value.trim(), obs: $('#ct-o', j).value.trim(), retorno: st !== 'aberta' ? (c.retorno || est.hoje) : null, creditoId: c.creditoId };
      if (st === 'estornada' && !c.creditoId && $('#ct-cred', j).checked && t.cartaoId) {
        var mesV = $('#ct-mes', j).value, cc = card(t.cartaoId), ref = mesV;
        // achar a fatura (mês de fechamento) cujo vencimento cai no mês escolhido
        for (var k = -1; k <= 1; k++) { var r = R.addMes(mesV, k); if (C.mesVenc(est, cc.id, r) === mesV) { ref = r; break; } }
        var cr = { id: C.novoId(), tipo: 'despesa', forma: 'cartao', cartaoId: t.cartaoId, data: est.hoje, valor: t.valor, descricao: 'Estorno · ' + t.descricao, categoria: t.categoria, estorno: true, faturaRef: ref, estornoDe: t.id };
        est.tx.push(cr); nc.creditoId = cr.id;
      }
      if (st !== 'estornada' && c.creditoId) { est.tx = est.tx.filter(function (x) { return x.id !== c.creditoId; }); delete nc.creditoId; }
      t.contestacao = nc; t.triado = true;
      salvar(); fecharJanela(); render(); toast(st === 'aberta' ? 'Compra marcada como contestada ' : 'Contestação atualizada');
      if (sep && sep.continuar) { sep.continuar = false; sepAvancar(); }
    };
    if (!novo) $('#ct-rem', j).onclick = function () { if (c.creditoId) est.tx = est.tx.filter(function (x) { return x.id !== c.creditoId; }); delete t.contestacao; salvar(); fecharJanela(); render(); toast('Contestação removida'); };
  }
  /* compras importadas que ainda não têm dono */
  function semDono() { return est.tx.filter(function (t) { return t.importado && !t.planilha && !t.triado && !t.contestacao && t.tipo === 'despesa'; }).sort(function (a, b) { return a.data < b.data ? -1 : 1; }); }
  function blocoSemDono() {
    var lista = semDono(); if (!lista.length) return '';
    var tot = D.soma(lista.map(function (t) { return t.valor; }));
    return '<section class="bloco c12"><div class="cab"><div><h2>Compras a classificar</h2><p class="sub">' + lista.length + ' compra(s) importada(s) sem responsável definido · ' + moedaTxt(tot) + '</p></div></div>' +
      '<ul class="lista">' + lista.slice(0, 5).map(function (t) { var cc = card(t.cartaoId); return '<li class="clicavel" data-acao="identificar" data-id="' + t.id + '"><span class="t"><b>' + esc(t.descricao) + '</b><span>' + C.dataTxt(t) + (cc ? ' · ' + esc(cc.nome) : '') + ' · ' + esc(t.categoria) + '</span></span><span class="v">' + moeda(t.valor) + '</span></li>'; }).join('') + '</ul>' +
      (lista.length > 5 ? '<p class="mut" style="font-size:13px;margin:6px 0 0">e mais ' + (lista.length - 5) + '…</p>' : '') + '<button class="btn pri" style="width:100%;margin-top:12px" data-acao="identificar">Classificar</button></section>';
  }
  function blocoContestacoes() {
    var lista = est.tx.filter(function (t) { return t.contestacao; }).sort(function (a, b) { return (a.contestacao.status === 'aberta' ? 0 : 1) - (b.contestacao.status === 'aberta' ? 0 : 1) || (a.contestacao.data < b.contestacao.data ? 1 : -1); });
    if (!lista.length) return '';
    var abertas = lista.filter(function (t) { return t.contestacao.status === 'aberta'; });
    return '<section class="bloco c12"><div class="cab"><div><h2>Compras contestadas</h2><p class="sub">' + abertas.length + ' aguardando retorno do banco · toque para atualizar</p></div></div><ul class="lista">' + lista.map(function (t) {
      var c = t.contestacao, x = ST_CONT[c.status] || ST_CONT.aberta, dias = R.diffDias(c.data, est.hoje), cc = card(t.cartaoId);
      return '<li class="clicavel" data-acao="contestar" data-id="' + t.id + '"><span class="t"><b>' + esc(t.descricao) + '</b><span>' + C.dataTxt(t) + (cc ? ' · ' + esc(cc.nome) : '') + ' · contestada em ' + R.fmtData(c.data) + (c.status === 'aberta' ? ' (há ' + dias + ' dia' + (dias === 1 ? '' : 's') + ')' : (c.retorno ? ' · retorno ' + R.fmtData(c.retorno) : '')) + (c.protocolo ? ' · protocolo ' + esc(c.protocolo) : '') + '</span></span><span class="chip ' + x[1] + '">' + x[0] + '</span><span class="v">' + moeda(t.valor) + '</span></li>';
    }).join('') + '</ul></section>';
  }

  /* --------- caixinhas --------- */
  function abrirCaixinha(id) {
    var cx = id ? C.porId(est.config.caixinhas, id) : { nome: '', base: 0, baseData: est.hoje, pct: 100, limite: '', pctAcima: '' };
    var j = abrirJanela(id ? 'Editar reserva' : 'Nova reserva',
      '<div class="campo"><label>Nome</label><input class="inp" id="x-nome" value="' + esc(cx.nome) + '" placeholder="Ex.: Reserva de emergência"></div>' +
      (id ? '' : '<div class="dois"><div class="campo"><label>Quanto já tem guardado</label><input class="inp" id="x-base" inputmode="decimal" placeholder="0,00"></div><div class="campo"><label>Em que data</label><input class="inp" id="x-data" type="date" value="' + est.hoje + '"></div></div>') +
      '<div class="dois"><div class="campo"><label>Rende quantos % do CDI</label><input class="inp" id="x-pct" inputmode="decimal" value="' + esc(cx.pct) + '"></div><div class="campo"><label>Até quanto (opcional)</label><input class="inp" id="x-lim" inputmode="decimal" value="' + (cx.limite ? D.fmt(cx.limite, true) : '') + '" placeholder="sem limite"></div></div>' +
      '<div class="campo"><label>% do CDI acima do limite</label><input class="inp" id="x-pcta" inputmode="decimal" value="' + esc(cx.pctAcima) + '" placeholder="igual"></div>',
      (id ? '<button class="btn perigo" id="x-rem">Excluir</button><span class="espaco"></span>' : '') + '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="x-ok">Salvar</button>');
    $('#x-ok', j).onclick = function () {
      var n = $('#x-nome', j).value.trim(); if (!n) return toast('Dê um nome');
      var pct = parseFloat(String($('#x-pct', j).value).replace(',', '.')) || 0, lim = D.ler($('#x-lim', j).value || '0') || 0, pa = $('#x-pcta', j).value.trim();
      if (id) Object.assign(cx, { nome: n, pct: pct, limite: lim, pctAcima: pa === '' ? '' : parseFloat(pa.replace(',', '.')) });
      else est.config.caixinhas.push({ id: C.novoId(), nome: n, base: D.ler($('#x-base', j).value || '0') || 0, baseData: $('#x-data', j).value || est.hoje, pct: pct, limite: lim, pctAcima: pa === '' ? '' : parseFloat(pa.replace(',', '.')), movs: [] });
      salvar(); fecharJanela(); render(); toast('Reserva salva');
    };
    if (id) $('#x-rem', j).onclick = function () { confirmar('Excluir reserva', 'Excluir "' + esc(cx.nome) + '" e o histórico dela?', 'Excluir', true, function () { est.config.caixinhas = est.config.caixinhas.filter(function (x) { return x.id !== id; }); salvar(); render(); }); };
  }
  function movCaixinha(id, tipo) {
    var cx = C.porId(est.config.caixinhas, id), tit = { guardar: 'Guardar em ', resgatar: 'Resgatar de ', ajuste: 'Rendimento real · ' }[tipo] + cx.nome;
    var j = abrirJanela(tit, '<div class="dois"><div class="campo"><label>' + (tipo === 'ajuste' ? 'Diferença a somar (pode ser negativa)' : 'Valor') + '</label><input class="inp" id="m-v" inputmode="decimal" placeholder="0,00"></div><div class="campo"><label>Data</label><input class="inp" type="date" id="m-d" value="' + est.hoje + '"></div></div>' +
      (tipo === 'ajuste' ? '<p class="mut" style="font-size:13px">Compare o saldo do banco com o do app: se o banco mostra menos (por causa do imposto), digite a diferença negativa.</p>' : '<label class="alternar">' + (tipo === 'guardar' ? 'Tirar da conta' : 'Voltar para a conta') + '<input type="checkbox" id="m-conta" checked></label>'),
      '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="m-ok">Confirmar</button>');
    $('#m-ok', j).onclick = function () {
      var v = D.ler($('#m-v', j).value), d = $('#m-d', j).value; if (v == null || (tipo !== 'ajuste' && v <= 0)) return toast('Valor inválido');
      cx.movs = cx.movs || []; cx.movs.push({ id: C.novoId(), tipo: tipo, valor: v, data: d, mexeConta: tipo !== 'ajuste' && $('#m-conta', j).checked });
      salvar(); fecharJanela(); render(); toast('Feito');
    };
  }

  /* --------- saldo, rendimento, físico --------- */
  function ajustarSaldo() {
    var atual = C.saldoEm(est, est.hoje, est.hoje);
    var j = abrirJanela('Ajustar saldo', '<p class="mut" style="margin-top:0">Digite o saldo que aparece hoje no app do seu banco. O app recalcula o ponto de partida e mostra a diferença.</p><div class="campo"><label>Saldo real hoje</label><input class="inp" id="aj-v" inputmode="decimal" placeholder="0,00" value="' + D.fmt(atual, true) + '" autofocus><div class="dica-campo" id="aj-d"></div></div>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="aj-ok">Ajustar</button>');
    $('#aj-v', j).oninput = function () { var v = D.ler(this.value); $('#aj-d', j).textContent = v == null ? 'Valor não reconhecido' : 'Diferença: ' + D.fmt(v - atual); };
    $('#aj-ok', j).onclick = function () {
      var v = D.ler($('#aj-v', j).value); if (v == null) return toast('Valor inválido');
      var r = C.ajustarSaldo(est, v, est.hoje); est.config.saldoRef = r.saldoRef; est.config.saldoRefData = r.saldoRefData; est.config.comecou = true;
      salvar(); fecharJanela(); render(); toast(Math.abs(r.diferenca) < .01 ? 'Saldo confere ✓' : 'Ajustado (diferença de ' + D.fmt(r.diferenca) + ')');
    };
  }
  function dinheiroFisico() {
    var atual = C.saldoFisico(est, est.hoje, est.hoje);
    var j = abrirJanela('Dinheiro físico', '<div class="medio">' + moeda(atual) + '</div><p class="mut">Entradas "em dinheiro vivo" e gastos em "Dinheiro" ficam aqui, fora da conta.</p><div class="dois"><div class="campo"><label>Depositei na conta</label><input class="inp" id="df-v" inputmode="decimal" placeholder="0,00"></div><div class="campo"><label>Data</label><input class="inp" type="date" id="df-d" value="' + est.hoje + '"></div></div>', '<button class="btn neu" data-acao="fechar">Fechar</button><button class="btn pri" id="df-ok">Depositei</button>');
    $('#df-ok', j).onclick = function () { var v = D.ler($('#df-v', j).value); if (!v || v <= 0) return toast('Valor inválido'); est.config.depositos.push({ id: C.novoId(), data: $('#df-d', j).value, valor: v }); salvar(); fecharJanela(); render(); toast('Depósito registrado'); };
  }
  function rendReal() {
    var ini = R.addMes(R.mesDe(est.hoje), -1) + '-01', fim = R.addDias(R.mesDe(est.hoje) + '-01', -1);
    var j = abrirJanela('Quanto rendeu de verdade', '<p class="mut" style="margin-top:0">Pegue no extrato quanto a conta rendeu num período. O app compara com o que calculou e ajusta as próximas estimativas (efeito do imposto).</p><div class="dois"><div class="campo"><label>De</label><input class="inp" type="date" id="rr-de" value="' + ini + '"></div><div class="campo"><label>Até</label><input class="inp" type="date" id="rr-ate" value="' + fim + '"></div></div><div class="campo"><label>Rendeu de verdade</label><input class="inp" id="rr-v" inputmode="decimal" placeholder="0,00"><div class="dica-campo" id="rr-d"></div></div>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="rr-ok">Salvar</button>');
    function calc() { return C.rendimentoPeriodo(est, $('#rr-de', j).value, $('#rr-ate', j).value, est.hoje); }
    j.addEventListener('input', function () { $('#rr-d', j).textContent = 'O app calculou ' + D.fmt(calc()) + ' nesse período'; });
    $('#rr-ok', j).onclick = function () {
      var v = D.ler($('#rr-v', j).value), c = calc(); if (v == null) return toast('Valor inválido');
      est.config.rend.ajustes.push({ id: C.novoId(), data: R.addDias($('#rr-ate', j).value, 1), real: v, calc: c });
      if (c > 0) est.config.rend.fator = Math.max(.5, Math.min(1.2, (est.config.rend.fator || 1) * v / c));
      salvar(); fecharJanela(); render(); toast('Rendimento ajustado');
    };
  }

  /* --------- alertas e menu + --------- */
  function verAlertas() {
    var al = C.alertas(est, est.hoje);
    abrirJanela('Alertas', al.length ? '<ul class="lista">' + al.map(function (a) { return '<li class="clicavel" ' + (a.tipo === 'contestacao' ? 'data-acao="aba" data-aba="cartoes"' : a.tipo === 'semdono' ? 'data-acao="identificar"' : a.t ? 'data-acao="editar" data-id="' + a.t.id + '"' : a.pessoa ? 'data-acao="ver-pessoa" data-id="' + a.pessoa.id + '"' : 'data-acao="ver-fatura" data-id="' + a.card.id + '" data-ref="' + a.f.ref + '"') + '><span class="chip ' + (a.nivel === 'ruim' ? 'ruim' : 'av') + '">' + (a.nivel === 'ruim' ? '!' : '') + '</span><span class="t" style="white-space:normal">' + esc(a.texto) + '</span>' + ICO.seta + '</li>'; }).join('') + '</ul>' : vazio('Nenhum alerta', 'Sem atrasos nem vencimentos nos próximos 3 dias'));
  }
  function menuMais(ancora) {
    var m = $('#menu-mais'); if (m) { m.remove(); return; }
    m = document.createElement('div'); m.className = 'menu-pop'; m.id = 'menu-mais'; m.setAttribute('role', 'menu');
    m.innerHTML = [['novo', 'despesa', 'cartao', 'Compra no cartão de crédito'], ['importar', '', '', 'Importar fatura'], ['novo', 'despesa', 'pix', 'Gasto no Pix'], ['novo', 'receita', '', 'Nova entrada'], ['novo-cartao', '', '', 'Novo cartão'], ['nova-caixinha', '', '', 'Nova reserva'], ['nova-pessoa', '', '', 'Nova pessoa']].map(function (o) { return '<button role="menuitem" data-acao="' + o[0] + '" data-tipo="' + o[1] + '" data-forma="' + o[2] + '">' + o[3] + '</button>'; }).join('');
    document.body.appendChild(m);
    if (ancora && window.innerWidth > 860) { var r = ancora.getBoundingClientRect(); m.style.top = (r.bottom + 8) + 'px'; m.style.right = (window.innerWidth - r.right) + 'px'; }
    setTimeout(function () { document.addEventListener('click', function f(e) { if (!m.contains(e.target)) { m.remove(); } document.removeEventListener('click', f); }); }, 0);
  }

  /* ===================== AÇÕES ===================== */
  function ir(aba) { ui.aba = aba; window.scrollTo(0, 0); render(); }
  var acoes = {
    aba: function (el) { ir(el.getAttribute('data-aba')); },
    'mes-ant': function () { ui.mes = R.addMes(ui.mes, -1); render(); },
    'mes-prox': function () { ui.mes = R.addMes(ui.mes, 1); render(); },
    'mes-hoje': function () { ui.mes = C.mesEmAndamento(est); render(); },
    olho: function () { ui.ocultar = !ui.ocultar; render(); },
    tema: function (el) { var v = el && el.getAttribute('data-v'); if (!v) { v = document.documentElement.getAttribute('data-tema') === 'escuro' ? 'claro' : 'escuro'; } est.config.prefs.tema = v; aplicarTema(); salvar(); render(); },
    alertas: verAlertas, mais: function (el) { menuMais(el); },
    fechar: fecharJanela,
    novo: function (el) { var m = $('#menu-mais'); if (m) m.remove(); abrirLancamento({ tipo: el.getAttribute('data-tipo') || 'despesa', forma: el.getAttribute('data-forma') || null, cartao: el.getAttribute('data-cartao') }); },
    editar: function (el) { var m = $('#menu-mais'); if (m) m.remove(); abrirLancamento({ id: el.getAttribute('data-id') }); },
    'salvar-tx': salvarLancamento, 'excluir-tx': excluirLancamento,
    'alternar-pago': function (el) { var t = C.porId(est.tx, el.getAttribute('data-id')); t.pago = !t.pago; salvar(); render(); toast(t.pago ? (t.tipo === 'receita' ? 'Marcado como recebido' : 'Marcado como pago') : 'Marcado como pendente'); },
    'novo-cartao': function () { var m = $('#menu-mais'); if (m) m.remove(); abrirCartao(); },
    'editar-cartao': function (el) { abrirCartao(el.getAttribute('data-id')); },
    'sel-cartao': function (el) { if (ui.aba === 'painel') { ui.cardSel = el.getAttribute('data-id'); render(); } else abrirCartao(el.getAttribute('data-id')); },
    'ver-fatura': function (el) { verFatura(el.getAttribute('data-id'), el.getAttribute('data-ref')); },
    'pagar-fatura': function (el) { pagarFatura(el.getAttribute('data-id'), el.getAttribute('data-ref')); },
    'desfazer-pag': function (el) { delete est.config.fatPagas[el.getAttribute('data-id') + '|' + el.getAttribute('data-ref')]; salvar(); fecharJanela(); render(); toast('Pagamento desfeito'); },
    'dever-cartao': function (el) { deverCartao(el.getAttribute('data-id')); },
    'nova-pessoa': function () { var m = $('#menu-mais'); if (m) m.remove(); abrirPessoa(); },
    'editar-pessoa': function (el) { abrirPessoa(el.getAttribute('data-id')); },
    'ver-pessoa': function (el) { verPessoa(el.getAttribute('data-id')); },
    'recebi-pessoa': function (el) { abrirRecebi(el.getAttribute('data-id')); },
    'pendencia-nova': function (el) { abrirPendencia(el.getAttribute('data-id')); },
    'pendencia-editar': function (el) { abrirPendencia(el.getAttribute('data-id'), el.getAttribute('data-pd')); },
    'div-toggle': function (el) { lerCampos(); var id = el.getAttribute('data-id'), sel = form.divSel || (form.divSel = []), i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else sel.push(id); desenharForm(); },
    'div-grupo': function (el) { lerCampos(); var g = C.porId(est.config.grupos, el.getAttribute('data-id')); form.divSel = g.membros.slice(); desenharForm(); },
    importar: function (el) { var m = $('#menu-mais'); if (m) m.remove(); abrirImportar(el.getAttribute('data-id')); },
    'imp-card': function (el) { imp.cardId = el.getAttribute('data-id'); imp.ref = refSugerida(card(imp.cardId)); imp.itens = null; desenharImportar(); },
    'imp-ler': function () { var txt = $('#imp-txt').value; imp.ref = $('#imp-ref').value; if (!txt.trim()) return toast('Escolha um arquivo ou cole o texto'); processarTextoFatura(txt, 'texto'); },
    'imp-voltar': function () { imp.itens = null; desenharImportar(); },
    'imp-confirmar': confirmarImportar,
    'separar-fatura': function (el) { var f = C.fatura(est, el.getAttribute('data-id'), el.getAttribute('data-ref')); abrirSeparar(f.itens.slice().sort(function (a, b) { return a.data < b.data ? -1 : 1; }).map(function (t) { return t.id; }), 'Classificar compras · fatura ' + R.fmtMesCurto(mv(f.cardId, f.ref))); },
    'sep-pessoa': function (el) { var t = C.porId(est.tx, sep.ids[sep.i]), id = el.getAttribute('data-id'); sepGuardarNome(t); delete t.divisao; if (id === 'eu') delete t.pessoaId; else t.pessoaId = id; t.triado = true; sepAvancar(); },
    'sep-grupo': function (el) { var t = C.porId(est.tx, sep.ids[sep.i]), g = C.porId(est.config.grupos, el.getAttribute('data-id')), partes = D.dividir(t.valor, g.membros.length); sepGuardarNome(t); delete t.pessoaId; t.divisao = g.membros.map(function (id, i) { return { pessoaId: id, valor: partes[i] }; }); t.triado = true; sepAvancar(); },
    'sep-dividir': function () { var t = C.porId(est.tx, sep.ids[sep.i]); sepGuardarNome(t); t.triado = true; salvar(); var volta = sep; abrirLancamento({ id: t.id }); form.dividir = true; form.voltaSep = volta; desenharForm(); },
    'sep-ant': function () { var t = C.porId(est.tx, sep.ids[sep.i]); if (t) { sepGuardarNome(t); salvar(); } sep.i = Math.max(0, sep.i - 1); desenharSeparar(); },
    'sep-prox': function () { var t = C.porId(est.tx, sep.ids[sep.i]); if (t) sepGuardarNome(t); sepAvancar(); },
    identificar: function (el) {
      var ids = semDono().map(function (t) { return t.id; }), id = el.getAttribute('data-id');
      if (!ids.length) return toast('Todas as compras estão classificadas');
      abrirSeparar(ids, 'Classificar compras'); if (id) { sep.i = Math.max(0, ids.indexOf(id)); desenharSeparar(); }
    },
    contestar: function (el) { abrirContestacao(el.getAttribute('data-id')); },
    'sep-contestar': function () { var t = C.porId(est.tx, sep.ids[sep.i]); sepGuardarNome(t); salvar(); sep.continuar = true; abrirContestacao(t.id); },
    adiantar: function (el) { abrirAdiantar(el.getAttribute('data-grupo')); },
    relacao: function (el) { abrirRelacao(el.getAttribute('data-id')); },
    'reemb-toggle': function (el) { var t = C.porId(est.tx, el.getAttribute('data-tx')); if (t.reembolsoPedido) delete t.reembolsoPedido; else t.reembolsoPedido = est.hoje; salvar(); render(); verPessoa(el.getAttribute('data-id')); },
    'quitar-toggle': function (el) { var t = C.porId(est.tx, el.getAttribute('data-tx')); if (t.quitado) delete t.quitado; else t.quitado = true; salvar(); render(); verPessoa(el.getAttribute('data-id')); },
    'acertado-ate': function (el) {
      var id = el.getAttribute('data-id'), p = C.porId(est.config.pessoas, id), ops = [['', 'Nenhum (tudo em aberto)']];
      for (var i = -8; i <= 1; i++) { var m = R.addMes(R.mesDe(est.hoje), i); ops.push([m, 'Até a fatura de ' + R.fmtMes(m)]); }
      var j = abrirJanela('Acertado até', '<p class="mut" style="margin-top:0">Compras de ' + esc(p.nome) + ' nas faturas até o mês escolhido contam como já pagas.</p><select class="inp" id="aa">' + ops.map(function (o) { return '<option value="' + o[0] + '"' + ((p.acertadoAte || '') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') + '</select><p class="mut" style="font-size:13px">Se ficou faltando um valor de algum desses meses, use "+ Saldo em aberto".</p>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="aa-ok">Salvar</button>');
      $('#aa-ok', j).onclick = function () { var v = $('#aa', j).value; if (v) p.acertadoAte = v; else delete p.acertadoAte; salvar(); render(); verPessoa(id); };
    },
    'gh-conectar': function () {
      var c = { owner: $('#gh-o').value.trim(), repo: $('#gh-r').value.trim(), token: $('#gh-t').value.trim() };
      if (!c.owner || !c.repo || !c.token) return toast('Preencha usuário, repositório e chave');
      toast('Conferindo o cofre…');
      GitHub.testar(c).then(function () {
        GitHub.salvarCfg(c); Nuvem.modo = 'github'; Nuvem.base = 'github'; Nuvem.enviados = {}; Nuvem.status = 'iniciando'; render();
        return Nuvem.puxar(true).then(function () { toast('Cofre conectado'); render(); });
      }).catch(function (e) { toast(e.message || 'Não foi possível conectar'); });
    },
    'gh-desconectar': function () { confirmar('Desconectar cofre', 'Este aparelho deixa de sincronizar. Os dados continuam aqui e no cofre.', 'Desconectar', true, function () { GitHub.salvarCfg(null); location.reload(); }); },
    'ir-sync': function () { ui.aba = 'ajustes'; ui.ajAberto = 'sync'; render(); var d = document.querySelector('[data-aj="sync"] details'); if (d) d.open = true; },
    'sync-agora': function () { if (!Nuvem.base) return toast(Nuvem.texto()); Nuvem.puxar(false).then(function () { return Nuvem.enviarAgora(); }).then(function () { toast(Nuvem.status === 'ok' ? 'Sincronizado' : Nuvem.texto()); }); },
    'reativar-pessoa': function (el) { var p = C.porId(est.config.pessoas, el.getAttribute('data-id')); delete p.arquivada; salvar(); ui.ajAberto = 'pessoas'; render(); toast(p.nome + ' voltou para as opções'); },
    'arquivar-pessoa': function (el) { var p = C.porId(est.config.pessoas, el.getAttribute('data-id')); p.arquivada = true; est.config.grupos.forEach(function (g) { g.membros = g.membros.filter(function (m) { return m !== p.id; }); }); salvar(); fecharJanela(); ui.ajAberto = 'pessoas'; render(); toast(p.nome + ' arquivada'); },
    'novo-grupo': function () { abrirGrupo(); }, 'editar-grupo': function (el) { abrirGrupo(el.getAttribute('data-id')); },
    'nova-caixinha': function () { var m = $('#menu-mais'); if (m) m.remove(); abrirCaixinha(); },
    'editar-caixinha': function (el) { abrirCaixinha(el.getAttribute('data-id')); },
    'mov-caixinha': function (el) { movCaixinha(el.getAttribute('data-id'), el.getAttribute('data-tipo')); },
    'apagar-mov': function (el) { var cx = C.porId(est.config.caixinhas, el.getAttribute('data-id')), mid = el.getAttribute('data-mov'); confirmar('Apagar movimento', 'Apagar este movimento da caixinha?', 'Apagar', true, function () { cx.movs = cx.movs.filter(function (m) { return m.id !== mid; }); salvar(); render(); }); },
    'ajustar-saldo': ajustarSaldo, 'dinheiro-fisico': dinheiroFisico, 'rend-real': rendReal,
    'det-hoje': function () { detalhar('Gastos de hoje', est.tx.filter(function (t) { return t.tipo === 'despesa' && t.data === est.hoje; })); },
    'det-gasto': function () { detalhar('Meus gastos em ' + R.fmtMes(ui.mes), C.soMeu(C.gastosDoMes(est, ui.mes))); },
    'det-recebido': function () { detalhar('Recebido em ' + R.fmtMes(ui.mes), C.receitasDoMes(est, ui.mes).filter(function (t) { return t.pago; })); },
    'det-saiu': function () { var ini = ui.mes + '-01', fim = R.dataNoMes(ui.mes, 31); detalhar('Saiu da conta em ' + R.fmtMes(ui.mes), est.tx.filter(function (t) { return t.tipo === 'despesa' && !C.ehCartao(t) && !t.fisico && t.pago && t.data >= ini && t.data <= fim; }), 'Além destes, entram aqui as faturas de cartão pagas no mês e o que foi guardado em caixinhas.'); },
    'det-resultado': function () { detalhar('Movimento de ' + R.fmtMes(ui.mes), C.gastosDoMes(est, ui.mes).concat(C.receitasDoMes(est, ui.mes))); },
    'det-cat': function (el) { var c = el.getAttribute('data-cat'); fecharJanela(); var lista = ui.ondeModo === 'ano' && ui.aba === 'painel' && el.closest('.bloco') && el.closest('.bloco').querySelector('.seg') ? [].concat.apply([], Array.apply(null, Array(12)).map(function (_, i) { return C.gastosDoMes(est, R.addMes(ui.mes, -i)); })) : C.gastosDoMes(est, ui.mes); detalhar(c, escopo(lista).filter(function (t) { return t.categoria === c; })); },
    'det-forma': function (el) { var n = el.getAttribute('data-forma'), k = Object.keys(FORMAS).filter(function (x) { return FORMAS[x] === n; })[0]; detalhar('Pago com ' + n, C.gastosDoMes(est, ui.mes).filter(function (t) { return t.forma === k; })); },
    'graf-mes': function (el) { var m = R.addMes(ui.mes, +el.getAttribute('data-i') - 11); detalhar('Gastos de ' + R.fmtMes(m), C.gastosDoMes(est, m)); },
    escopo: function (el) { ui.escopo = el.getAttribute('data-v'); render(); },
    'onde-modo': function (el) { ui.ondeModo = el.getAttribute('data-v'); render(); },
    'ver-filtros': function () { ui.verFiltros = !ui.verFiltros; render(); },
    'limpar-filtros': function () { ui.filtros = {}; render(); },
    ordenar: function (el) { var c = el.getAttribute('data-col'); if (ui.ordem.col === c) ui.ordem.asc = !ui.ordem.asc; else ui.ordem = { col: c, asc: c !== 'data' && c !== 'valor' }; est.config.prefs.ordem = ui.ordem; salvar(); render(); },
    comecar: function () { est.config.comecou = true; salvar(); render(); },
    'carregar-exemplo': function () { carregarExemplo(); },
    'apagar-exemplo': function () { confirmar('Começar do zero', 'Apagar os dados de exemplo? Seus cartões e as pessoas continuam cadastrados.', 'Apagar', true, function () { est.config = configPadrao(); est.tx = []; salvar(); ui.aba = 'painel'; render(); }); },
    'apagar-tudo': function () { confirmar('Apagar tudo', 'Isso apaga todos os lançamentos, cartões, caixinhas e configurações. Tem certeza?', 'Apagar tudo', true, function () { est.config = configPadrao(); est.tx = []; salvar(); ui.aba = 'painel'; render(); toast('Tudo apagado'); }); },
    'add-feriado': function () {
      var txt = $('#fer-data').value.trim(), nome = $('#fer-nome').value.trim() || 'Feriado', d = null, m = /^(\d{1,2})\/(\d{1,2})$/.exec(txt);
      if (m) d = R.pad(+m[2]) + '-' + R.pad(+m[1]); else { d = R.lerData(txt); }
      if (!d) return toast('Use dd/mm ou dd/mm/aaaa');
      est.config.calendario.feriados.push({ data: d, nome: nome }); R.limparCache(); C.recalcular5du(est); salvar(); ui.ajAberto = 'cal'; render(); toast('Feriado adicionado');
    },
    'rem-feriado': function (el) { est.config.calendario.feriados.splice(+el.getAttribute('data-i'), 1); R.limparCache(); C.recalcular5du(est); salvar(); ui.ajAberto = 'cal'; render(); },
    'add-cat': function () { var n = $('#nova-cat').value.trim(), t = $('#nova-cat-tipo').value; if (!n) return; est.config[t].push({ nome: n, cor: CORES_PESSOA[est.config[t].length % 8], ico: '' }); salvar(); ui.ajAberto = 'cats'; render(); },
    'ren-cat': function (el) {
      var t = el.getAttribute('data-tipo'), i = +el.getAttribute('data-i'), k = est.config[t][i];
      var j = abrirJanela('Renomear categoria', '<div class="dois"><div class="campo"><label>Nome</label><input class="inp" id="rc-n" value="' + esc(k.nome) + '"></div></div><p class="mut" style="font-size:13px">Os lançamentos dessa categoria acompanham o novo nome.</p>', '<button class="btn neu" data-acao="fechar">Cancelar</button><button class="btn pri" id="rc-ok">Salvar</button>');
      $('#rc-ok', j).onclick = function () { var n = $('#rc-n', j).value.trim(); if (!n) return; var velho = k.nome; k.nome = n;  est.tx.forEach(function (x) { if (x.categoria === velho && (t === 'rcats') === (x.tipo === 'receita')) x.categoria = n; }); salvar(); fecharJanela(); ui.ajAberto = 'cats'; render(); };
    },
    'exportar-csv': function () { baixar('lancamentos-' + est.hoje + '.csv', C.exportarCSV(est), 'text/csv;charset=utf-8'); },
    'baixar-json': function () { baixar('minhas-financas-' + est.hoje + '.json', JSON.stringify({ config: est.config, tx: est.tx }), 'application/json'); },
    nada: function () { }
  };
  /* salva um arquivo: no Claude usa a permissão de download; no app instalado, um link normal */
  var downloadsCap = null;
  try { if (window.claude && window.claude.use) window.claude.use('downloads').then(function (d) { downloadsCap = d; }, function () { }); } catch (e) { }
  function baixar(nome, conteudo, tipo) {
    var blob = conteudo instanceof Blob ? conteudo : new Blob([conteudo], { type: tipo });
    if (downloadsCap) return downloadsCap.save({ filename: nome, data: blob }).catch(function (e) {
      if (e && /decline|cancel|recus/i.test(String(e.code || e.message))) throw new Error('Download cancelado');
      return blob.arrayBuffer().then(function (buf) { return downloadsCap.save({ filename: nome, data: new Uint8Array(buf) }); });
    });
    var a = document.createElement('a'), url = URL.createObjectURL(blob);
    a.href = url; a.download = nome; document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1500);
    return Promise.resolve();
  }


  function ligarEventos() {
    document.addEventListener('click', function (e) {
      var fEl = e.target.closest('[data-f]');
      if (fEl && form && $('#janela') && $('#janela').contains(fEl)) {
        lerCampos();
        var k = fEl.getAttribute('data-f'), v = fEl.getAttribute('data-v');
        if (k === 'estorno' || k === 'dividir') v = !!v;
        if (k === 'tipo' && v !== form.tipo) { form.categoria = v === 'receita' ? 'Salário' : est.config.cats[0].nome; form.pessoaId = 'eu'; form.acerto = false; }
        if (k === 'dividir' && v && !form.divisao.length) form.divisao = [];
        form[k] = v; desenharForm(); return;
      }
      var el = e.target.closest('[data-acao]');
      if (!el) return;
      var a = el.getAttribute('data-acao');
      if (acoes[a]) { e.preventDefault(); acoes[a](el, e); }
    });
    document.addEventListener('change', function (e) {
      var t = e.target;
      if (t.matches('[data-fc]') && form) { lerCampos(); form[t.getAttribute('data-fc')] = t.checked; if (t.getAttribute('data-fc') === 'regra5du' && t.checked) form.pago = false; desenharForm(); return; }
      if (t.matches('[data-filtro]')) { ui.filtros[t.getAttribute('data-filtro')] = t.type === 'checkbox' ? t.checked : t.value; render(); return; }
      if (t.matches('[data-acao-sel="ord-cartoes"]')) { ui.ordCartoes = t.value; est.config.prefs.ordCartoes = t.value; salvar(); render(); return; }
      if (t.matches('[data-cfg]')) {
        var path = t.getAttribute('data-cfg').split('.'), obj = est.config;
        for (var i = 0; i < path.length - 1; i++) obj = obj[path[i]];
        var val = t.type === 'checkbox' ? t.checked : t.value;
        if (path[path.length - 1] === 'pct') val = parseFloat(String(val).replace(',', '.')) || 0;
        obj[path[path.length - 1]] = val;
        if (path[0] === 'calendario') { R.limparCache(); var mud = C.recalcular5du(est); if (mud.length) toast(mud.length + ' salário(s) com data recalculada'); }
        ui.ajAberto = t.closest('[data-aj]') ? t.closest('[data-aj]').getAttribute('data-aj') : null;
        salvar(); render(); return;
      }
      if (t.matches('[data-cor-cat]')) { est.config[t.getAttribute('data-cor-cat')][+t.getAttribute('data-i')].cor = t.value; salvar(); ui.ajAberto = 'cats'; render(); return; }
      if (t.id === 'imp-arq' && t.files[0]) { imp.ref = $('#imp-ref').value; lerArquivoFatura(t.files[0]); return; }
      if (t.id === 'imp-ref') { imp.ref = t.value; if (imp.itens) { C.marcarDuplicados(imp.itens, est, imp.cardId, imp.ref); imp.itens.forEach(function (x) { if (x.jaExiste) x.marcado = false; }); imp.sobrando = null; calcularSobrando(); desenharImportar(); } return; }
      if (t.id === 'imp-fechada') { imp.fechada = t.checked; var tp0 = $('#janela .janela').scrollTop; desenharImportar(); $('#janela .janela').scrollTop = tp0; return; }
      if (t.matches('[data-sob]')) { imp.sobrando.forEach(function (x) { if (x.id === t.getAttribute('data-sob')) x.remover = t.checked; }); var tp1 = $('#janela .janela').scrollTop; desenharImportar(); $('#janela .janela').scrollTop = tp1; return; }
      if (t.matches('[data-imp]')) { imp.itens[+t.getAttribute('data-imp')].marcado = t.checked; var top = $('#janela .janela').scrollTop; desenharImportar(); $('#janela .janela').scrollTop = top; return; }
      if (t.id === 'importar-csv' && t.files[0]) {
        var fr = new FileReader(); fr.onload = function () {
          var r = C.importarCSV(fr.result, est);
          confirmar('Importar planilha', r.itens.length + ' lançamento(s) encontrados.' + (r.erros.length ? '<br><span class="neg">' + r.erros.slice(0, 5).map(esc).join('<br>') + '</span>' : ''), 'Importar', false, function () { est.tx = est.tx.concat(r.itens); est.config.comecou = true; salvar(); render(); toast('Importado'); });
        }; fr.readAsText(t.files[0]); return;
      }
      if (t.id === 'restaurar-json' && t.files[0]) {
        var f2 = new FileReader(); f2.onload = function () {
          try { var d = JSON.parse(f2.result); if (!d.config || !d.tx) throw 0; confirmar('Restaurar cópia', 'Substituir os dados atuais pelos do arquivo (' + d.tx.length + ' lançamentos)?', 'Restaurar', true, function () { est.config = normalizar(d.config); est.tx = d.tx; salvar(); render(); toast('Restaurado'); }); }
          catch (e) { toast('Arquivo inválido'); }
        }; f2.readAsText(t.files[0]);
      }
    });
    document.addEventListener('input', function (e) {
      if (e.target.id === 'busca') { ui.busca = e.target.value; var pos = e.target.selectionStart; render(); var b = $('#busca'); b.focus(); b.setSelectionRange(pos, pos); }
      if (e.target.id === 'busca-cartao') { ui.buscaCartao = e.target.value; var p2 = e.target.selectionStart; render(); var b2 = $('#busca-cartao'); b2.focus(); b2.setSelectionRange(p2, p2); }
    });
    document.addEventListener('toggle', function (e) { var s = e.target.querySelector && e.target.querySelector('summary'); if (s) s.setAttribute('aria-expanded', e.target.open); }, true);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { fecharJanela(); var m = $('#menu-mais'); if (m) m.remove(); } });
    if (window.matchMedia) window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { aplicarTema(); render(); });
  }
  function aplicarTema() {
    var t = est.config.prefs.tema || 'auto';
    if (t === 'auto') t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'escuro' : 'claro';
    document.documentElement.setAttribute('data-tema', t);
    var meta = $('meta[name="theme-color"]'); if (meta) meta.content = t === 'escuro' ? '#06122b' : '#eef3fb';
  }

  /* ===================== DADOS DE EXEMPLO ===================== */
  function carregarExemplo() { toast('Indisponível nesta versão'); }
  function migrar() { }
  function aplicarPlanilha() { }

  /* ===================== INÍCIO ===================== */
  function montarCasca() {
    $('#nav').innerHTML = ABAS.map(function (a) { return '<button class="nav-item" data-acao="aba" data-aba="' + a[0] + '">' + ICO_ABA[a[0]] + a[1] + '</button>'; }).join('');
    $('#abas-baixo').innerHTML = ABAS.filter(function (a) { return a[0] !== 'caixinhas'; }).map(function (a) { return '<button data-acao="aba" data-aba="' + a[0] + '">' + ICO_ABA[a[0]] + '<span>' + (a[0] === 'lancamentos' ? 'Lançam.' : a[1]) + '</span></button>'; }).join('');
    $('#btn-sino').innerHTML = ICO.sino + '<span class="badge oculto" id="badge">0</span>';
    $('#fab').innerHTML = ICO.mais;
  }
  function iniciar() {
    montarCasca();
    var d = Armazem.carregar();
    silencioso = true;
    if (d && d.config) { est.config = normalizar(d.config); est.tx = d.tx || []; est.atualizadoEm = d.atualizadoEm != null ? +d.atualizadoEm : 1; } // já usado antes: vale mais que um aparelho novo
    else { est.config = configPadrao(); if (window.DADOS_PLANILHA) aplicarPlanilha(window.DADOS_PLANILHA); est.atualizadoEm = 0; salvar(); }
    migrar();
    silencioso = false;
    if (est.config.prefs.ordem) ui.ordem = est.config.prefs.ordem;
    if (est.config.prefs.ordCartoes) ui.ordCartoes = est.config.prefs.ordCartoes;
    C.recalcular5du(est);
    aplicarTema(); ligarEventos(); render();
    Nuvem.iniciar();
    setInterval(function () { if (R.hoje() !== est.hoje) render(); }, 60000);
  }
  window.MinhasFinancas = { est: est, ui: ui, render: render, acoes: acoes };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
