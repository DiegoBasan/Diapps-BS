/* Modo escritorio de Diapps: en pantallas de 1100px o más cada app muestra todas sus pantallas a la vez en columnas.
   Desk.frame() arma la barra superior y la rejilla; Desk.go() lleva a una columna; Desk.keepFocus() conserva el campo activo al redibujar. */
(function(){
  const mq=matchMedia("(min-width:1100px)");
  const ic=p=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`;
  window.Desk={
    get on(){return mq.matches},
    watch(fn){mq.addEventListener("change",()=>{document.body.classList.toggle("desk",mq.matches);fn()})},
    /* o: {icon,name,sub,tabs:[[clave,nombre,svgPath]],cols:{clave:html},extra:html,cls} */
    frame(o){document.body.classList.add("desk");
      return `<div class="dkbar"><button class="dbrand press" data-menu><img src="${o.icon}" alt=""><span>${o.name}<small>${o.sub||""}</small></span></button><span class="sp"></span>
        ${(o.tabs||[]).map(([k,n,p])=>`<button class="dtab" data-go="${k}">${ic(p)}${n}</button>`).join("")}${o.extra||""}
        <button class="dtab" data-menu aria-label="Menú">${ic('<path d="M4 7h16M4 12h16M4 17h16"/>')}</button></div>
        <div class="dgrid ${o.cls||""}">${Object.entries(o.cols).map(([k,h])=>`<section class="dcol" data-col="${k}">${h}</section>`).join("")}</div>`},
    go(s){const c=document.querySelector(`.dcol[data-col="${s}"]`);if(!c)return false;c.scrollIntoView({behavior:"smooth",block:"start"});c.classList.remove("dflash");void c.offsetWidth;c.classList.add("dflash");return true},
    keepFocus(fn){const a=document.activeElement,col=a&&a.closest&&a.closest(".dcol"),id=a&&a.id,pos=a&&a.selectionStart;fn();
      if(col&&id){const n=document.querySelector(`.dcol[data-col="${col.dataset.col}"] #${CSS.escape(id)}`);if(n){n.focus();try{n.setSelectionRange(pos,pos)}catch(e){}}}}
  };
  if(mq.matches)document.documentElement.classList.add("desk-early");
})();
