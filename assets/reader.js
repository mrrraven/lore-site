(function(){
  // Safety-first paint: until studio.js finishes booting, nothing is editable
  // and nobody gets owner/editing rights just by knowing a URL parameter.
  document.documentElement.classList.add('reader');
  function lock(){
    document.querySelectorAll('[contenteditable]').forEach(function(el){
      el.setAttribute('contenteditable','false');
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', lock);
  else lock();

  // --- Sync plumbing -------------------------------------------------------
  // Каждая запись khripka-* получает метку времени — по ней на загрузке
  // отличаем свежую локальную правку от устаревшей копии.
  var SYNC_META = 'khripka-sync-times';
  var rawSet = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, val){
    rawSet.call(this, key, val);
    if(typeof key === 'string' && key.indexOf('khripka-') === 0 && key !== SYNC_META){
      var t = {};
      try { t = JSON.parse(this.getItem(SYNC_META) || '{}'); } catch(e){}
      t[key] = Date.now();
      rawSet.call(this, SYNC_META, JSON.stringify(t));
    }
  };

  // Страницы читают localStorage в своих инлайн-скриптах, которые выполнятся
  // сразу после нас, поэтому merge обязан быть синхронным — fetch() опоздает.
  function pullPublished(){
    var xhr = new XMLHttpRequest();
    xhr.open('GET', './data/site.json?ts=' + Date.now(), false);
    xhr.send(null);
    if(xhr.status < 200 || xhr.status >= 300) return null;
    return JSON.parse(xhr.responseText || '{}');
  }

  try {
    var published = pullPublished() || {};
    window.__khripkaPublished = published;
    var bag = published.data || {};
    var pubTimes = published.times || {};
    var localTimes = {};
    try { localTimes = JSON.parse(localStorage.getItem(SYNC_META) || '{}'); } catch(e){}
    Object.keys(bag).forEach(function(key){
      var pubT = pubTimes[key] || 0;
      var locT = localTimes[key] || 0;
      // Нет локальной копии — берём опубликованную. Есть, но она старее
      // опубликованной — тоже берём опубликованную. Свежая локальная
      // правка (например, незалитый черновик) не трогается.
      if(!localStorage.getItem(key) || pubT >= locT){
        localStorage.setItem(key, bag[key]);
      }
    });
  } catch(e) { window.__khripkaPublished = window.__khripkaPublished || null; }
})();