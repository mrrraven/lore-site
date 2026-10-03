(function(){
  var PIN = 'север';
  var AUTH_KEY = 'khripka-authed';   // "знает пин в этом браузере" — переживает перезагрузку страницы
  var GH = 'khripka-github';
  var authed = localStorage.getItem(AUTH_KEY) === '1';
  var editing = false;               // "режим правки включён сейчас" — НИКОГДА не переживает перезагрузку
  var published = {pages:{}, gallery:[]};

  // --- editing state (html.owner / html.reader), decoupled from auth ---
  function applyEditingClass(){
    document.documentElement.classList.toggle('owner', editing);
    document.documentElement.classList.toggle('reader', !editing);
    document.querySelectorAll('[data-live]').forEach(function(el){
      el.setAttribute('contenteditable', editing ? 'true' : 'false');
    });
  }

  function setAuthed(on){
    authed = on;
    if(on) localStorage.setItem(AUTH_KEY,'1'); else localStorage.removeItem(AUTH_KEY);
    if(!on) setEditing(false);
    syncButtons();
  }

  function setEditing(on){
    editing = on && authed;
    applyEditingClass();
    syncButtons();
    if(editing) bindLive();
  }

  function syncButtons(){
    var authBtn = document.getElementById('authBtn');
    if(authBtn) authBtn.textContent = authed ? 'выйти' : 'войти';
    var editBtn = document.getElementById('editBtn');
    if(editBtn){
      editBtn.hidden = !authed;
      editBtn.textContent = editing ? 'закончить правку' : 'редактировать';
    }
    var pub = document.getElementById('publishBtn');
    if(pub) pub.hidden = !authed;
  }

  function modal(html){
    var old = document.getElementById('authModal');
    if(old) old.remove();
    var box = document.createElement('div');
    box.id = 'authModal';
    box.innerHTML = '<div class="auth-card"><div class="auth-kicker">ARCHIVE // ACCESS</div>'+html+'</div>';
    box.addEventListener('click', function(e){ if(e.target === box) box.remove(); });
    document.body.appendChild(box);
    return box;
  }

  function openAuth(){
    if(authed){ setAuthed(false); return; }
    var box = modal(
      '<h3>Вход в архив</h3><p>Закрытая полка. Гостям достаточно смотреть.</p>'+
      '<label>Код</label><input id="authPin" type="password" autocomplete="current-password">'+
      '<p class="auth-error" id="authError" hidden>Код не подошёл. Полка остаётся закрытой.</p>'+
      '<div class="auth-actions"><button type="button" id="authCancel">закрыть</button><button type="button" id="authOk">войти</button></div>'
    );
    var input = box.querySelector('#authPin');
    input.focus();
    function tryIn(){
      if((input.value||'').trim().toLowerCase() === PIN){ box.remove(); setAuthed(true); galleryLoad(); }
      else box.querySelector('#authError').hidden = false;
    }
    box.querySelector('#authOk').addEventListener('click', tryIn);
    box.querySelector('#authCancel').addEventListener('click', function(){ box.remove(); });
    input.addEventListener('keydown', function(e){ if(e.key === 'Enter') tryIn(); if(e.key === 'Escape') box.remove(); });
  }

  function ghLoad(){ try { return JSON.parse(localStorage.getItem(GH)||'{}'); } catch(e){ return {}; } }
  function openPublish(){
    var cfg = ghLoad();
    var box = modal(
      '<h3>Опубликовать в GitHub</h3><p>Токен хранится только в этом браузере и в репозиторий не попадает. Нужен fine-grained token с правом Contents: Read and write.</p>'+
      '<label>Владелец</label><input id="ghOwner" value="'+(cfg.owner||'')+'">'+
      '<label>Репозиторий</label><input id="ghRepo" value="'+(cfg.repo||'')+'">'+
      '<label>Ветка</label><input id="ghBranch" value="'+(cfg.branch||'main')+'">'+
      '<label>Token</label><input id="ghToken" type="password" value="'+(cfg.token||'')+'">'+
      '<p class="auth-error" id="ghError" hidden></p>'+
      '<div class="auth-actions"><button type="button" id="ghCancel">закрыть</button><button type="button" id="ghOk">залить правки</button></div>'
    );
    box.querySelector('#ghCancel').addEventListener('click', function(){ box.remove(); });
    box.querySelector('#ghOk').addEventListener('click', function(){
      var next = {
        owner: box.querySelector('#ghOwner').value.trim(),
        repo: box.querySelector('#ghRepo').value.trim(),
        branch: box.querySelector('#ghBranch').value.trim() || 'main',
        token: box.querySelector('#ghToken').value.trim()
      };
      if(!next.owner || !next.repo || !next.token){
        var err = box.querySelector('#ghError'); err.hidden = false; err.textContent = 'Нужны владелец, репозиторий и токен.'; return;
      }
      localStorage.setItem(GH, JSON.stringify(next));
      publish(next, box.querySelector('#ghError'), box);
    });
  }

  function pageKey(){ return 'khripka-page:' + location.pathname; }
  function collectPages(){
    var pages = Object.assign({}, published.pages || {});
    for(var i=0;i<localStorage.length;i++){
      var k = localStorage.key(i);
      if(k && k.indexOf('khripka-page:') === 0){
        try { pages[k.slice(13)] = JSON.parse(localStorage.getItem(k)); } catch(e) {}
      }
    }
    return pages;
  }

  function b64(text){
    return btoa(unescape(encodeURIComponent(text)));
  }

  function publish(cfg, errEl, box){
    errEl.hidden = true;
    var payload = {pages: collectPages(), gallery: JSON.parse(localStorage.getItem('khripka-gallery') || '[]')};
    var path = 'data/site.json';
    var url = 'https://api.github.com/repos/'+cfg.owner+'/'+cfg.repo+'/contents/'+path+'?ref='+encodeURIComponent(cfg.branch);
    fetch(url, {headers:{Authorization:'Bearer '+cfg.token, Accept:'application/vnd.github+json'}}).then(function(r){
      return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; });
    }).then(function(cur){
      var body = {message:'archive: publish site edits', content:b64(JSON.stringify(payload, null, 2)), branch:cfg.branch};
      if(cur.ok && cur.body.sha) body.sha = cur.body.sha;
      return fetch('https://api.github.com/repos/'+cfg.owner+'/'+cfg.repo+'/contents/'+path, {
        method:'PUT',
        headers:{Authorization:'Bearer '+cfg.token, Accept:'application/vnd.github+json', 'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
    }).then(function(r){
      return r.json().then(function(j){ if(!r.ok) throw new Error(j.message || 'GitHub отказал'); return j; });
    }).then(function(){
      box.querySelector('h3').textContent = 'Залито';
      errEl.hidden = false;
      errEl.style.color = '#b7d7c4';
      errEl.textContent = 'data/site.json обновлён. На Pages появится после сборки, обычно через минуту.';
    }).catch(function(e){
      errEl.hidden = false;
      errEl.style.color = '';
      errEl.textContent = e.message || 'Не удалось залить';
    });
  }

  function applyPublished(){
    var bag = (published.pages && published.pages[location.pathname]) || {};
    document.querySelectorAll('[data-live]').forEach(function(el){
      var id = el.getAttribute('data-live');
      if(bag[id]) el.innerHTML = bag[id];
    });
  }

  // Any element that itself holds text and has no element children is a
  // candidate — this finds dossier facts, quotes, status rows, chips etc.
  // automatically instead of relying on a hand-kept list of tags/classes
  // that silently misses new markup.
  // Besides UI chrome, this also steers clear of pages that already run
  // their own dedicated editor (lore's .doc / .editable, diary's #editor
  // and per-entry [data-inline], rp's .paper-content and cast rows) so the
  // generic data-live system never fights their own save logic.
  var SKIP = '.editor-bar, .modal, .toolbar, .subtools, .marquee, .gallery-grid, .pin, #authModal, #authBtn, #editBtn, #publishBtn, #lightbox, .doc, .editable, #editor, .paper-content, [data-inline], .cast-row, .entry';
  var SKIP_TAGS = {SCRIPT:1, STYLE:1, INPUT:1, TEXTAREA:1, SELECT:1, OPTION:1, BR:1, IMG:1, SVG:1, IFRAME:1};
  function findEditables(){
    var out = [];
    document.body.querySelectorAll('*').forEach(function(el){
      if(el.children.length) return;
      if(SKIP_TAGS[el.tagName]) return;
      if(el.closest(SKIP)) return;
      if(!(el.textContent||'').trim()) return;
      out.push(el);
    });
    return out;
  }

  function bindLive(){
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(pageKey()) || '{}'); } catch(e) {}
    findEditables().forEach(function(el, i){
      var id = el.getAttribute('data-live') || ('n'+i);
      el.setAttribute('data-live', id);
    });
    applyPublished();
    document.querySelectorAll('[data-live]').forEach(function(el){
      var id = el.getAttribute('data-live');
      if(saved[id]) el.innerHTML = saved[id];
      el.setAttribute('contenteditable', editing ? 'true' : 'false');
      if(!editing || el.dataset.bound) return;
      el.dataset.bound = '1';
      el.addEventListener('blur', function(){
        var bag = {};
        try { bag = JSON.parse(localStorage.getItem(pageKey()) || '{}'); } catch(e) {}
        bag[id] = el.innerHTML;
        localStorage.setItem(pageKey(), JSON.stringify(bag));
      });
    });
  }

  var defaults = [
    {src:'assets/khripka-art.png', alt:'Хрипка'},
    {src:'assets/north-bg.png', alt:'Север'},
    {src:'assets/north-map-official.png', alt:'Карта Северного клана'},
    {src:'assets/khripka-model.png', alt:'Модель'}
  ];
  function galleryLoad(){
    var grid = document.getElementById('galleryGrid');
    if(!grid) return;
    var extra = [];
    try { extra = JSON.parse(localStorage.getItem('khripka-gallery') || '[]'); } catch(e) {}
    if(!extra.length && published.gallery) extra = published.gallery;
    var items = defaults.concat(extra);
    grid.innerHTML = '';
    items.forEach(function(item, idx){
      var fig = document.createElement('figure');
      fig.className = 'shot';
      var img = document.createElement('img');
      img.src = item.src; img.alt = item.alt || '';
      img.addEventListener('click', function(){ openLight(item.src, item.alt); });
      fig.appendChild(img);
      if(editing && idx >= defaults.length){
        var del = document.createElement('button');
        del.type = 'button'; del.className = 'shot-del'; del.textContent = 'убрать';
        del.addEventListener('click', function(e){
          e.stopPropagation();
          extra.splice(idx - defaults.length, 1);
          localStorage.setItem('khripka-gallery', JSON.stringify(extra));
          galleryLoad();
        });
        fig.appendChild(del);
      }
      grid.appendChild(fig);
    });
    var add = document.getElementById('galleryAdd');
    var file = document.getElementById('galleryFile');
    if(add && file && !add.dataset.bound){
      add.dataset.bound = '1';
      add.addEventListener('click', function(){ file.click(); });
      file.addEventListener('change', function(){
        var files = Array.prototype.slice.call(file.files || []);
        var left = files.length;
        if(!left) return;
        files.forEach(function(f){
          var reader = new FileReader();
          reader.onload = function(){
            extra.push({src: reader.result, alt: f.name});
            left--;
            if(!left){ localStorage.setItem('khripka-gallery', JSON.stringify(extra)); galleryLoad(); }
          };
          reader.readAsDataURL(f);
        });
        file.value = '';
      });
    }
  }
  function openLight(src, alt){
    var box = document.getElementById('lightbox');
    if(!box){
      box = document.createElement('div');
      box.id = 'lightbox';
      box.innerHTML = '<button type="button" id="lightClose">закрыть</button><img alt="">';
      document.body.appendChild(box);
      box.addEventListener('click', function(e){ if(e.target === box || e.target.id === 'lightClose') box.classList.remove('show'); });
    }
    box.querySelector('img').src = src;
    box.querySelector('img').alt = alt || '';
    box.classList.add('show');
  }

  function boot(){
    var btn = document.createElement('button');
    btn.id = 'authBtn'; btn.type = 'button';
    btn.addEventListener('click', openAuth);
    document.body.appendChild(btn);

    var editBtn = document.createElement('button');
    editBtn.id = 'editBtn'; editBtn.type = 'button';
    editBtn.addEventListener('click', function(){ setEditing(!editing); });
    document.body.appendChild(editBtn);

    var pub = document.createElement('button');
    pub.id = 'publishBtn'; pub.type = 'button'; pub.textContent = 'опубликовать';
    pub.addEventListener('click', openPublish);
    document.body.appendChild(pub);

    applyEditingClass();
    syncButtons();

    fetch('./data/site.json', {cache:'no-store'}).then(function(r){ return r.ok ? r.json() : {}; }).catch(function(){ return {}; }).then(function(data){
      published = data || {pages:{}, gallery:[]};
      galleryLoad();
      bindLive();
      // ?edit=1 is a convenience that opens the login form — it no longer
      // grants access on its own; ?edit=0 just forces a clean reader view.
      var q = new URLSearchParams(location.search);
      if(q.get('edit') === '1' && !authed) openAuth();
      if(q.get('edit') === '0') setAuthed(false);
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
