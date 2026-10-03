(function(){
  var PIN = 'север';
  var AUTH_KEY = 'khripka-authed';   // "знает пин в этом браузере" — переживает перезагрузку страницы
  var GH = 'khripka-github';
  var SYNC_META = 'khripka-sync-times';
  // Эти ключи не публикуем: вход, токен, служебный реестр времени
  // и личный вид графов (масштаб/центр — настройка конкретного браузера).
  var SYNC_SKIP = {'khripka-authed':1,'khripka-github':1,'khripka-sync-times':1,'khripka-graph-view-v3':1};
  var authed = localStorage.getItem(AUTH_KEY) === '1';
  var editing = false;               // "режим правки включён сейчас" — НИКОГДА не переживает перезагрузку
  var published = {pages:{}, gallery:[], data:{}, times:{}};
  var liveObserver = null;

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
    document.body.classList.toggle('owner-authed', authed);
    syncButtons();
  }

  // Вход НЕ включает правку. Редактирование — только явно, кнопкой.
  function setEditing(on){
    editing = on && authed;
    applyEditingClass();
    syncButtons();
    bindLive();
  }

  function syncButtons(){
    var authBtn = document.getElementById('authBtn');
    if(authBtn) authBtn.textContent = authed ? 'выйти' : 'войти';
    var editBtn = document.getElementById('editBtn');
    if(editBtn){
      editBtn.hidden = !authed;
      editBtn.textContent = editing ? 'закончить правку' : 'редактировать';
      editBtn.title = 'Правки сохраняются в этом браузере. Чтобы увидели остальные — нажми «опубликовать».';
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
      '<h3>Опубликовать в GitHub</h3><p>Улетит всё: текст страниц, лор, дневник, РП-сцены, семейное дерево, связи, тотемы и галерея. Другие браузеры подхватят автоматически после сборки Pages (обычно ~минута). Токен хранится только в этом браузере; нужен fine-grained token с правом Contents: Read and write.</p>'+
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

  // Все khripka-* данные проекта: лор, семья, связи, тотемы, дневник,
  // РП, страничные правки, галерея. Раньше публиковались только страницы
  // и галерея — поэтому правки и терялись.
  function collectData(){
    var data = {}, times = {}, reg = {};
    try { reg = JSON.parse(localStorage.getItem(SYNC_META) || '{}'); } catch(e){}
    for(var i=0;i<localStorage.length;i++){
      var k = localStorage.key(i);
      if(!k || k.indexOf('khripka-') !== 0 || SYNC_SKIP[k]) continue;
      data[k] = localStorage.getItem(k);
      times[k] = reg[k] || Date.now();
    }
    return {data: data, times: times};
  }

  function b64(text){
    return btoa(unescape(encodeURIComponent(text)));
  }

  function publish(cfg, errEl, box){
    errEl.hidden = true;
    errEl.style.color = '';
    var payload = {pages: collectPages(), gallery: JSON.parse(localStorage.getItem('khripka-gallery') || '[]')};
    var extra = collectData();
    payload.data = extra.data;
    payload.times = extra.times;
    var json = JSON.stringify(payload, null, 2);
    // GitHub Contents API принимает файлы до ~1 МБ, в base64 выходит больше.
    if(json.length > 700000){
      errEl.hidden = false;
      errEl.textContent = 'Слишком много данных (>~700 КБ): почти наверняка в дневнике/сценах тяжёлые картинки в полном размере. Пережми их (например, до 1200px по длинной стороне) и опубликуй снова.';
      return;
    }
    var path = 'data/site.json';
    var url = 'https://api.github.com/repos/'+cfg.owner+'/'+cfg.repo+'/contents/'+path+'?ref='+encodeURIComponent(cfg.branch);
    fetch(url, {headers:{Authorization:'Bearer '+cfg.token, Accept:'application/vnd.github+json'}}).then(function(r){
      return r.json().then(function(j){ return {ok:r.ok, status:r.status, body:j}; });
    }).then(function(cur){
      var body = {message:'archive: publish site edits', content:b64(json), branch:cfg.branch};
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
      errEl.textContent = 'data/site.json обновлён: лор, дневник, сцены, семья, связи, галерея. На Pages появится после сборки, обычно через минуту. Проверь из другого браузера.';
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

  // Элементы без детей И контейнеры, у которых внутри только инлайн-теги
  // (<b>, <i>, <span>...), — раньше абзац с жирным куском пролетал мимо.
  // Зоны со своими редакторами (.doc, #editor, .paper-content и т.п.)
  // по-прежнему редактируются их собственными механизмами.
  var SKIP = '.editor-bar, .modal, .toolbar, .subtools, .marquee, .gallery-grid, .pin, #authModal, #authBtn, #editBtn, #publishBtn, #lightbox, .doc, .editable, #editor, .paper-content, [data-inline], .cast-row, .entry';
  var SKIP_TAGS = {SCRIPT:1, STYLE:1, INPUT:1, TEXTAREA:1, SELECT:1, OPTION:1, BR:1, IMG:1, SVG:1, IFRAME:1, BUTTON:1, LABEL:1};
  var INLINE_TAGS = {A:1,B:1,I:1,EM:1,STRONG:1,SPAN:1,SMALL:1,U:1,S:1,SUB:1,SUP:1,BR:1};
  function findEditables(){
    var out = [];
    var covered = new Set();
    document.body.querySelectorAll('*').forEach(function(el){
      if(covered.has(el)) return;
      if(SKIP_TAGS[el.tagName]) return;
      if(el.closest(SKIP)) return;
      if(el.children.length){
        var allInline = true;
        for(var i=0;i<el.children.length;i++){
          if(!INLINE_TAGS[el.children[i].tagName]){ allInline = false; break; }
        }
        if(!allInline) return;
        if(!(el.textContent||'').trim()) return;
        el.querySelectorAll('*').forEach(function(d){ covered.add(d); });
        out.push(el);
        return;
      }
      if(!(el.textContent||'').trim()) return;
      out.push(el);
    });
    return out;
  }

  function assignLive(){
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

  function bindLive(){
    if(liveObserver){ liveObserver.disconnect(); liveObserver = null; }
    assignLive();
    // Динамические блоки (новые записи дневника, сцены и т.п.) появляются
    // уже после первичной привязки — подхватываем их на лету.
    if(!editing || typeof MutationObserver === 'undefined') return;
    var timer = null;
    liveObserver = new MutationObserver(function(muts){
      var touched = false;
      for(var i=0;i<muts.length && !touched;i++){
        var m = muts[i];
        for(var j=0;j<m.addedNodes.length;j++){
          var n = m.addedNodes[j];
          if(n.nodeType === 1 && n.id !== 'authModal' && n.id !== 'lightbox' && !n.closest('#authModal,#lightbox')){
            touched = true; break;
          }
        }
      }
      if(!touched) return;
      clearTimeout(timer);
      timer = setTimeout(function(){
        assignLive();
        document.querySelectorAll('[data-live]').forEach(function(el){
          el.setAttribute('contenteditable', editing ? 'true' : 'false');
        });
      }, 150);
    });
    liveObserver.observe(document.body, {childList:true, subtree:true});
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

    // Гостям прячем кнопки локальных редакторов страниц (лор, дневник, RP).
    var hideCss = document.createElement('style');
    hideCss.textContent = [
      'body:not(.owner-authed) #editToggle2','body:not(.owner-authed) #saveBtn','body:not(.owner-authed) #resetBtn',
      'body:not(.owner-authed) #toolbar','body:not(.owner-authed) #saveEntry','body:not(.owner-authed) #cancelEdit',
      'body:not(.owner-authed) #addScene','body:not(.owner-authed) #saveScene','body:not(.owner-authed) #addCast',
      'body:not(.owner-authed) #insertImage','body:not(.owner-authed) #clearScene','body:not(.owner-authed) #visualMode',
      'body:not(.owner-authed) #bbMode','body:not(.owner-authed) #linkBtn','body:not(.owner-authed) #imageBtn',
      'body:not(.owner-authed) #clearFmt','body:not(.owner-authed) #galleryAdd','body:not(.owner-authed) .subtools'
    ].join(',\n') + '{display:none!important}';
    document.head.appendChild(hideCss);

    applyEditingClass();
    syncButtons();
    document.body.classList.toggle('owner-authed', authed);

    function afterLoad(){
      galleryLoad();
      bindLive();
      // ?edit=1 only opens the login form — it no longer grants access
      // on its own; ?edit=0 forces a clean reader view.
      var q = new URLSearchParams(location.search);
      if(q.get('edit') === '1' && !authed) openAuth();
      if(q.get('edit') === '0') setAuthed(false);
    }

    // reader.js уже мог синхронно подтянуть site.json — не дёргаем сеть повторно.
    var preloaded = window.__khripkaPublished;
    if(preloaded && typeof preloaded === 'object'){
      published = preloaded;
      afterLoad();
    } else {
      fetch('./data/site.json', {cache:'no-store'}).then(function(r){ return r.ok ? r.json() : {}; }).catch(function(){ return {}; }).then(function(data){
        published = data || {pages:{}, gallery:[]};
        afterLoad();
      });
    }
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();