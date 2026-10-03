(function(){
  var KEY='khripka-owner';
  var q=new URLSearchParams(location.search);
  if(q.get('edit')==='1') localStorage.setItem(KEY,'1');
  if(q.get('edit')==='0') localStorage.removeItem(KEY);
  var owner=localStorage.getItem(KEY)==='1';
  document.documentElement.classList.add(owner?'owner':'reader');
  function lock(){
    if(owner) return;
    document.querySelectorAll('[contenteditable]').forEach(function(el){el.setAttribute('contenteditable','false')});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', lock);
  else lock();
})();
