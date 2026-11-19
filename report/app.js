(function(){
  var tabs=document.querySelectorAll('.tab'), btns=document.querySelectorAll('.tb-btn'), mbtns=document.querySelectorAll('.md-btn');
  var mode=FIRST_MODE, cur=FIRST_TAB;
  function render(push){
    var found=false;
    tabs.forEach(function(t){ var on=t.dataset.tab===cur && t.dataset.mode===mode; t.hidden=!on; if(on) found=true; });
    if(!found){ if(cur===FIRST_TAB){ mode=FIRST_MODE; } cur=FIRST_TAB; return render(push); }
    btns.forEach(function(b){ b.classList.toggle('on', b.dataset.go===cur); });
    mbtns.forEach(function(b){ b.classList.toggle('on', b.dataset.mode===mode); });
    document.querySelectorAll('.vfoot').forEach(function(f){ f.hidden = f.dataset.mode!==mode; });
    if(push!==false){ try{ history.replaceState(null,'','#'+mode+'-'+cur); }catch(e){} }
    var bar=document.querySelector('.tabbar');
    if(window.scrollY > bar.offsetTop) window.scrollTo({top:Math.max(0,document.querySelector('.banner').offsetHeight)});
    var a=document.querySelector('.tb-btn.on'); if(a&&a.scrollIntoView) a.scrollIntoView({block:'nearest',inline:'center'});
  }
  document.addEventListener('click',function(e){
    var b=e.target.closest('[data-go]'); if(b){ e.preventDefault(); cur=b.dataset.go; render(); return; }
    var m=e.target.closest('.md-btn'); if(m){ e.preventDefault(); mode=m.dataset.mode; render(); }
  });
  (function(){ var h=(location.hash||'').slice(1).split('-'); if(h[0]) mode=h[0]; if(h[1]) cur=h[1]; render(false); })();

  document.querySelectorAll('.fpills').forEach(function(fp){
    var gal=fp.nextElementSibling;
    fp.addEventListener('click',function(e){
      var b=e.target.closest('.fp'); if(!b) return;
      fp.querySelectorAll('.fp').forEach(function(x){x.classList.toggle('on',x===b)});
      gal.querySelectorAll('.shot').forEach(function(s){ s.hidden = !(b.dataset.f==='all' || s.dataset.c===b.dataset.f); });
    });
  });

  // lightbox (works for gallery .shot and annotated .frame)
  var lb=document.getElementById('lb'), fr=lb.querySelector('.lb-frame'), img=fr.querySelector('img'), cb=lb.querySelector('.lb-c'),
      tb=lb.querySelector('.lb-cap b'), p=lb.querySelector('.lb-cap p'), list=[], idx=0;
  function show(i){
    idx=(i+list.length)%list.length; var f=list[idx], im=f.querySelector('img');
    img.src=im.src; img.alt=im.alt;
    fr.querySelectorAll('.bx').forEach(function(b){b.remove()});
    var fig=f.closest('.vshot'); fr.className='lb-frame '+(fig?fig.className.replace('vshot',''):'');
    f.querySelectorAll('.bx').forEach(function(b){ fr.appendChild(b.cloneNode(true)); });
    cb.textContent=f.dataset.casino; tb.textContent=f.dataset.title; p.textContent=f.dataset.obs;
  }
  function open(f){
    var scope=f.closest('.vpoint')||f.closest('.gal');
    list=Array.prototype.filter.call(scope.querySelectorAll('.shot,.frame'),function(s){return !s.hidden});
    lb.hidden=false; document.body.style.overflow='hidden'; show(list.indexOf(f));
  }
  function close(){ lb.hidden=true; document.body.style.overflow=''; }
  document.querySelectorAll('.shot,.frame').forEach(function(f){
    f.addEventListener('click',function(){open(f)});
    f.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){e.preventDefault();open(f)} });
  });
  lb.querySelector('.lb-x').onclick=close;
  lb.querySelector('.lb-prev').onclick=function(e){e.stopPropagation();show(idx-1)};
  lb.querySelector('.lb-next').onclick=function(e){e.stopPropagation();show(idx+1)};
  lb.addEventListener('click',function(e){ if(e.target===lb) close(); });
  document.addEventListener('keydown',function(e){ if(lb.hidden) return;
    if(e.key==='Escape') close(); else if(e.key==='ArrowLeft') show(idx-1); else if(e.key==='ArrowRight') show(idx+1); });
})();
