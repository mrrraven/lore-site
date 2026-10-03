(function(){
  // Safety-first paint: until studio.js finishes booting, nothing is editable
  // and nobody gets owner/editing rights just by knowing a URL parameter.
  document.documentElement.classList.add('reader');
  function lock(){
    document.querySelectorAll('[contenteditable]').forEach(function(el){ el.setAttribute('contenteditable','false'); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', lock);
  else lock();
})();
