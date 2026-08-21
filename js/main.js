/* 苔藓时间 · 主逻辑：UI 绑定 / 主循环 / 弹窗 / 离线结算 */
"use strict";

const UI = {
  el(id){ return document.getElementById(id); },

  toast(msg, kind, ms){
    const area=this.el("toast-area");
    const d=document.createElement("div");
    d.className="toast"+(kind?" "+kind:"");
    d.textContent=msg;
    area.appendChild(d);
    while(area.children.length>4) area.removeChild(area.firstChild);
    const life=ms||3800;
    setTimeout(()=>{ d.style.opacity="0"; d.style.transition="opacity .6s"; }, life);
    setTimeout(()=>d.remove(), life+700);
  },

  status(msg){ this.el("status-line").textContent=msg; },

  /* ---- 滑块（带阻尼缓动） ---- */
  targetEnv:{temp:20,humidity:75,light:40,ph:6},

  bindSliders(){
    const map={temp:["sl-temp","val-temp","°C",1],humidity:["sl-humidity","val-humidity","%",0],
               light:["sl-light","val-light","%",0],ph:["sl-ph","val-ph","",1]};
    for(const key in map){
      const [sl,val,unit,dec]=map[key];
      const input=this.el(sl), label=this.el(val);
      input.addEventListener("input",()=>{
        this.targetEnv[key]=parseFloat(input.value);
        label.textContent=this.targetEnv[key].toFixed(dec)+unit;
        AudioSys.blip(500+this.targetEnv[key]*4,0.03,0.05);
      });
    }
  },

  syncSliders(){
    const map={temp:["sl-temp","val-temp","°C",1],humidity:["sl-humidity","val-humidity","%",0],
               light:["sl-light","val-light","%",0],ph:["sl-ph","val-ph","",1]};
    for(const key in map){
      const [sl,val,unit,dec]=map[key];
      this.el(sl).value=Game.state.env[key];
      this.el(val).textContent=Number(Game.state.env[key]).toFixed(dec)+unit;
      this.targetEnv[key]=Game.state.env[key];
    }
  },

  /* ---- 基质 ---- */
  renderSubstrates(){
    const list=this.el("substrate-list");
    list.innerHTML="";
    for(const id of SUB_ORDER){
      const sub=SUBSTRATES.find(s=>s.id===id);
      const unlocked=Game.state.unlockedSubs.includes(id);
      const d=document.createElement("div");
      d.className="sub-item"+(unlocked?"":" locked")+(Game.state.substrate===id?" active":"");
      d.innerHTML=`<span><span class="sw" style="background:${sub.color}"></span>${sub.name}</span><span>${unlocked?"":"锁"}</span>`;
      if(unlocked){
        d.title=sub.note;
        d.onclick=()=>{
          if(Game.state.substrate!==id) this.askSubstrate(id);
        };
      }else{
        d.title=`第 ${sub.unlock} 纪元解锁`;
      }
      list.appendChild(d);
    }
  },

  /* ---- 更换基质（询问保留/清空） ---- */
  pendingSub:null,

  askSubstrate(id){
    const sub=SUBSTRATES.find(s=>s.id===id);
    this.pendingSub=id;
    this.el("sub-target-name").textContent=sub.name;
    if(Game.state.patches.length===0){ // 视野本来空，直接换
      this.applySubstrate(false);
      return;
    }
    this.el("modal-substrate").classList.remove("hidden");
  },

  applySubstrate(keep){
    const id=this.pendingSub;
    const sub=SUBSTRATES.find(s=>s.id===id);
    this.el("modal-substrate").classList.add("hidden");
    Game.state.substrate=id;
    if(!keep){
      Game.state.patches=[]; Game.state.symbiosis=[];
    }
    Game.state.emerge={};
    this.el("scope-sub").textContent=sub.name;
    this.renderSubstrates();
    this.toast(keep?`已更换基质：${sub.name}（样本已移植）`:`已更换基质：${sub.name}（样本已回收）`);
    AudioSys.blip(440,0.08,0.1);
    SaveSys.save();
    this.pendingSub=null;
  },

  /* ---- 放大镜 ---- */
  lensOn:false,

  bindLens(){
    const scope=this.el("scope"), lens=this.el("lens");
    this.el("btn-lens").onclick=function(){
      UI.lensOn=!UI.lensOn;
      this.textContent="放大镜:"+(UI.lensOn?"开":"关");
      if(!UI.lensOn) lens.classList.add("hidden");
      else UI.toast("将光标移到视野内查看放大细节");
    };
    scope.addEventListener("mousemove",e=>{
      if(!UI.lensOn) return;
      const rect=scope.getBoundingClientRect();
      // CSS 坐标 → 画布坐标
      const cx=(e.clientX-rect.left)*(scope.width/rect.width);
      const cy=(e.clientY-rect.top)*(scope.height/rect.height);
      const R=scope.width/2;
      if(Math.hypot(cx-R,cy-R)>R){ lens.classList.add("hidden"); return; }
      Render.lens(lens,cx,cy);
      // 镜头跟随光标（相对 scope-frame 定位）
      const fr=scope.parentElement.getBoundingClientRect();
      lens.style.left=(e.clientX-fr.left)+"px";
      lens.style.top=(e.clientY-fr.top)+"px";
      lens.classList.remove("hidden");
    });
    scope.addEventListener("mouseleave",()=>lens.classList.add("hidden"));
    // 触屏：触摸拖动同样可用
    scope.addEventListener("touchmove",e=>{
      if(!UI.lensOn) return;
      const t=e.touches[0];
      scope.dispatchEvent(new MouseEvent("mousemove",{clientX:t.clientX,clientY:t.clientY}));
      e.preventDefault();
    },{passive:false});
  },

  /* ---- 手动操作 ---- */
  OP_CD:{inoculate:60,nutrient:90,uv:120,spray:30},
  opReady:{inoculate:0,nutrient:0,uv:0,spray:0},

  bindOps(){
    const map={inoculate:"op-inoculate",nutrient:"op-nutrient",uv:"op-uv",spray:"op-spray",
               acid:"op-acid",shade:"op-shade",beetle:"op-beetle"};
    for(const key in map){
      this.el(map[key]).onclick=()=>this.useOp(key);
    }
    setInterval(()=>this.tickOps(),500);
  },

  useOp(key){
    const now=Date.now();
    if(now<this.opReady[key]) return;
    if(key==="inoculate"){
      if(this.planting){ this.cancelPlanting(); return; } // 选址中再点一次=取消
      this.openInoculate(); return; // 选完物种才进冷却
    }
    // 需要选址的工具：先武装，再在视野里点击
    if(key==="acid"||key==="shade"||key==="beetle"){
      if(this.armedTool===key){ this.disarmTool(); return; } // 再点一次=取消
      this.armedTool=key;
      if(this.planting) this.cancelPlanting(true);
      this.el("scope-wrap").classList.add("plant-mode");
      const names={acid:"滴酸管",shade:"遮光罩",beetle:"食腐甲虫"};
      this.toast(`在视野中点击选择「${names[key]}」的作用位置，再次点击按钮取消`);
      return; // 选址成功后才进冷却
    }
    if(key==="nutrient") Sim.nutrientDrop();
    if(key==="uv") Sim.uvLamp();
    if(key==="spray") Sim.spray();
    if(window.AchSys) AchSys.stat("op_"+key);
    this.opReady[key]=now+this.OP_CD[key]*1000;
    SaveSys.save();
  },

  disarmTool(silent){
    this.armedTool=null;
    this.el("scope-wrap").classList.remove("plant-mode");
    if(!silent) this.toast("已收起工具");
  },

  tickOps(){
    const now=Date.now();
    for(const key in this.OP_CD){
      const cdEl=this.el("cd-"+key), btn=this.el("op-"+key);
      if(!cdEl||!btn) continue;
      const left=Math.ceil((this.opReady[key]-now)/1000);
      if(left>0){ cdEl.textContent=left+"s"; btn.disabled=true; }
      else { cdEl.textContent=""; btn.disabled=false; }
    }
  },

  openInoculate(){
    const list=this.el("inoculate-list");
    list.innerHTML="";
    const disc=Game.state.discovered;
    if(!disc.length){ this.toast("尚未发现任何物种，无法接种","bad"); return; }
    for(const id of disc){
      const sp=SPECIES.find(s=>s.id===id); if(!sp) continue;
      const d=document.createElement("div");
      d.className="ino-item";
      d.innerHTML=`<span class="dot" style="background:hsl(${sp.hue},50%,50%)"></span>${sp.name}`;
      d.onclick=()=>{
        this.el("modal-inoculate").classList.add("hidden");
        this.startPlanting(id);
      };
      list.appendChild(d);
    }
    this.el("modal-inoculate").classList.remove("hidden");
  },

  /* ---- 接种位置选择 ---- */
  planting:null,

  startPlanting(spId){
    const sp=SPECIES.find(s=>s.id===spId);
    this.planting=spId;
    this.el("scope-wrap").classList.add("plant-mode");
    this.toast(`在视野中点击选择「${sp?sp.name:""}」的接种位置，再次点击「接种孢子」取消`);
  },

  cancelPlanting(silent){
    this.planting=null;
    this.el("scope-wrap").classList.remove("plant-mode");
    if(!silent) this.toast("已取消接种");
  },

  bindPlanting(){
    this.el("scope").addEventListener("click",e=>{
      const scope=this.el("scope");
      const rect=scope.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*(scope.width/rect.width);
      const cy=(e.clientY-rect.top)*(scope.height/rect.height);
      const R=scope.width/2;
      const rx=(cx-R)/(R*0.92), ry=(cy-R)/(R*0.92);
      // 接种选址
      if(this.planting){
        if(Math.hypot(rx,ry)>1){ this.toast("超出视野范围","bad"); return; }
        if(Sim.inoculate(this.planting, rx, ry)){
          this.opReady.inoculate=Date.now()+this.OP_CD.inoculate*1000;
          if(window.AchSys) AchSys.stat("op_inoculate");
          SaveSys.save();
        }
        this.cancelPlanting(true);
        return;
      }
      // 工具选址
      if(this.armedTool){
        if(Math.hypot(rx,ry)>1){ this.toast("超出视野范围","bad"); return; }
        const key=this.armedTool;
        if(key==="acid"){ Sim.addZone("ph",rx,ry,-2,90); this.toast("滴酸完成：这片区域的 pH 将在 90 秒内偏低"); }
        if(key==="shade"){ Sim.addZone("light",rx,ry,-50,90); this.toast("遮光罩已就位：这片区域将阴暗 90 秒"); }
        if(key==="beetle"){ if(!Sim.beetle(rx,ry)){ this.disarmTool(true); return; } }
        if(window.AchSys) AchSys.stat("op_"+key);
        this.opReady[key]=Date.now()+this.OP_CD[key]*1000;
        this.disarmTool(true);
        SaveSys.save();
        return;
      }
      // 指尖水珠：没有工具、不在识别模式、不在观展模式时，点击=落一滴水
      if(this.identOn || this.gallery) return;
      if(Math.hypot(rx,ry)>1) return;
      Render.drop(rx,ry);
      const scared=Sim.scare(rx,ry);
      AudioSys.plip();
      if(window.AchSys) AchSys.stat("op_drop");
      if(scared>0) this.toast("水珠落下，小家伙们四散而逃");
    });
  },

  /* ---- 物种识别器 ---- */
  identOn:false,

  bindIdent(){
    const scope=this.el("scope"), card=this.el("id-card"), wrap=this.el("scope-wrap");
    this.el("btn-ident").onclick=function(){
      UI.identOn=!UI.identOn;
      this.textContent="识别:"+(UI.identOn?"开":"关");
      wrap.classList.toggle("ident-mode",UI.identOn);
      if(!UI.identOn){ Render.highlight=null; card.classList.add("hidden"); }
      else UI.toast("光标悬停查看物种轮廓，点击查看详情");
    };
    scope.addEventListener("mousemove",e=>{
      if(!UI.identOn) return;
      const rect=scope.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*(scope.width/rect.width);
      const cy=(e.clientY-rect.top)*(scope.height/rect.height);
      Render.highlight=Render.hitTest(cx,cy);
    });
    scope.addEventListener("click",e=>{
      if(!UI.identOn) return;
      const rect=scope.getBoundingClientRect();
      const cx=(e.clientX-rect.left)*(scope.width/rect.width);
      const cy=(e.clientY-rect.top)*(scope.height/rect.height);
      const p=Render.hitTest(cx,cy);
      if(p) UI.showIdCard(p, e.clientX, e.clientY);
      else card.classList.add("hidden");
    });
  },

  showIdCard(p, px, py){
    const sp=SPECIES.find(s=>s.id===p.sp); if(!sp) return;
    const card=this.el("id-card"), wrap=this.el("scope-wrap");
    const wr=wrap.getBoundingClientRect();
    const styleName={moss:"苔藓类",hypha:"菌丝类",lichen:"地衣类",algae:"藻类",mold:"霉斑类",crystal:"结晶类",critter:"微型动物",slime:"黏菌类",shroom:"子实体（蘑菇）",fern:"蕨类原叶体"}[sp.style];
    const fit=Sim.inRange(sp,Game.state.env)?"适生中":"环境受压";
    card.innerHTML=`<h4>${sp.name}</h4>
      <div class="row"><span>类群</span><span>${styleName}</span></div>
      <div class="row"><span>状态</span><span>${fit}</span></div>
      <div class="row"><span>体量</span><span>${Math.round(p.r)}</span></div>
      <div class="row"><span>适生区间</span><span>${sp.need[0]}°C / ${sp.need[1]}% / ${sp.need[2]}% / pH${sp.need[3]}</span></div>
      <div class="hp"><i style="width:${Math.round(p.health*100)}%"></i></div>
      <div class="card-btns"><button id="idc-remove" class="tbtn danger">移除斑块</button><button id="idc-close" class="tbtn">关闭</button></div>`;
    card.style.left=Math.min(Math.max(0,wr.width-250), Math.max(0, px-wr.left+16))+"px";
    card.style.top=Math.max(0, py-wr.top-30)+"px";
    card.classList.remove("hidden");
    this.el("idc-close").onclick=()=>card.classList.add("hidden");
    this.el("idc-remove").onclick=()=>{
      const i=Game.state.patches.indexOf(p);
      if(i>=0) Game.state.patches.splice(i,1);
      Render.highlight=null;
      card.classList.add("hidden");
      UI.toast(`已移除斑块：${sp.name}`,"bad");
      SaveSys.save();
    };
  },

  /* ---- 图鉴 ---- */
  refreshCodex(){
    const list=this.el("codex-list");
    list.innerHTML="";
    const disc=Game.state.discovered;
    const qEl=this.el("codex-search"), fEl=this.el("codex-filter");
    const q=qEl?qEl.value.trim():"";
    const onlyFound=fEl?fEl.checked:false;
    for(const sp of SPECIES){
      if(q && !sp.name.includes(q)) continue;
      if(onlyFound && !disc.includes(sp.id)) continue;
      const d=document.createElement("div");
      const got=disc.includes(sp.id);
      d.className="codex-entry"+(got?"":" locked");
      if(got){
        d.innerHTML=`<h4>${sp.name}</h4>
          <div class="sci">${sp.sci}</div>
          <div class="poem">${sp.poem}</div>
          <div class="req">适生：${sp.need[0]}°C / 湿度${sp.need[1]}% / 光照${sp.need[2]}% / pH${sp.need[3]}</div>`;
      }else{
        d.innerHTML=`<h4>？？？</h4><div class="sci">尚未观测到该物种。调节环境参数，或更换基质。</div>`;
      }
      list.appendChild(d);
    }
  },

  refreshDex(){
    this.el("ro-dex").textContent=`${Game.state.discovered.length}/${window.COLLECTIBLE_COUNT||SPECIES.length}`;
  },

  /* ---- 大灭绝 ---- */
  openExtinct(){
    const box=this.el("extinct-options");
    box.innerHTML="";
    for(const ext of EXTINCTIONS){
      const d=document.createElement("div");
      d.className="ext-opt";
      d.innerHTML=`<h4>${ext.name} → 性状【${ext.trait}】</h4><p>${ext.desc}</p>`;
      d.onclick=()=>{
        this.el("modal-extinct").classList.add("hidden");
        Sim.extinct(ext.id);
        this.status(`第 ${Game.state.epoch} 纪元开启。${EPOCH_THEMES[Game.state.epoch].name}。`);
      };
      box.appendChild(d);
    }
    this.el("modal-extinct").classList.remove("hidden");
  },

  /* ---- 离线报告 ---- */
  showOffline(report){
    if(!report.length) return;
    if(window.AchSys) AchSys.stat("offline");
    const box=this.el("offline-report");
    box.innerHTML=report.map(r=>`<div class="rep-item ${r.type}">${r.text}</div>`).join("");
    this.el("modal-offline").classList.remove("hidden");
  },

  /* ---- 读数与徽标 ---- */
  _climaxWas:false,

  refreshReadout(){
    this.el("ro-cover").textContent=Math.round(Sim.coverage()*100)+"%";
    this.el("ro-rich").textContent=Sim.richness();
    this.el("ro-climax").textContent=Math.round(Sim.climaxProgress()*100)+"%";
    const ready=Sim.climaxReady();
    this.el("btn-extinct").classList.toggle("hidden",!ready);
    if(ready) this.status("顶极群落已达成。大灭绝的按钮在等你——或者，你可以再拖一会儿。");
    if(ready&&!this._climaxWas&&window.AchSys) AchSys.stat("climax");
    this._climaxWas=ready;
  },

  /* ---- 今日委托 ---- */
  renderQuests(){
    const list=this.el("quest-list");
    if(!list) return;
    list.innerHTML="";
    for(const q of QuestSys.quests){
      const def=QUEST_POOL.find(d=>d.id===q.id); if(!def) continue;
      const d=document.createElement("div");
      d.className="quest-item"+(q.done?" q-done":"");
      d.innerHTML=`<span class="q-text">${def.text}</span><span class="q-prog" id="qp-${q.id}"></span>`;
      list.appendChild(d);
    }
    this.renderQuestProgress();
  },

  renderQuestProgress(){
    const hintEl=this.el("quest-hint");
    if(hintEl){
      const h=Game.state.hints;
      hintEl.textContent=h.length?h[h.length-1]:"";
      hintEl.classList.toggle("hidden",!h.length);
    }
    // 已完成的委托补划掉样式（委托卡只在每日刷新时重建）
    for(const q of QuestSys.quests){
      if(q.done){
        const item=this.el("qp-"+q.id);
        if(item && item.parentElement && !item.parentElement.classList.contains("q-done"))
          item.parentElement.classList.add("q-done");
      }
    }
    for(const q of QuestSys.quests){
      const el=this.el("qp-"+q.id);
      if(!el) continue;
      const def=QUEST_POOL.find(d=>d.id===q.id); if(!def) continue;
      if(q.done){ el.textContent="已完成"; continue; }
      if(def.fmt==="time"){
        const c=Math.floor(q.cur), g=def.goal;
        el.textContent=`${Math.floor(c/60)}:${String(c%60).padStart(2,"0")} / ${Math.floor(g/60)}:${String(g%60).padStart(2,"0")}`;
      }else{
        el.textContent=`${Math.floor(q.cur)} / ${def.goal}`;
      }
    }
  },

  /* ---- 成就面板 ---- */
  refreshAch(){
    const list=this.el("ach-list");
    if(!list) return;
    const got=Game.state.ach;
    this.el("ach-progress").textContent=`${got.length} / ${ACHIEVEMENTS.length}`;
    list.innerHTML="";
    for(const a of ACHIEVEMENTS){
      const has=got.includes(a.id);
      const d=document.createElement("div");
      d.className="ach-item"+(has?" unlocked":"");
      d.innerHTML=has
        ?`<div class="ach-medal">✦</div><div><h4>${a.name}</h4><p>${a.desc}</p></div>`
        :`<div class="ach-medal">·</div><div><h4>？？？</h4><p>${a.desc}</p></div>`;
      list.appendChild(d);
    }
  },

  refreshEpoch(){
    this.el("epoch-badge").textContent=`第 ${Game.state.epoch} 纪元`;
    const tb=this.el("trait-badges");
    tb.innerHTML=Game.state.traits.map(t=>`<span>${t}</span>`).join("");
    document.body.className="epoch-"+Game.state.epoch;
  },

  refreshAll(){
    this.refreshEpoch(); this.renderSubstrates(); this.refreshCodex();
    this.refreshDex(); this.refreshReadout(); this.syncSliders();
    const sub=SUBSTRATES.find(s=>s.id===Game.state.substrate);
    this.el("scope-sub").textContent=sub?sub.name:"玄武岩";
  },

  /* ---- 拍照导出：海报级 PNG ---- */
  exportPhoto(){
    AudioSys.blip(660,0.09,0.08);
    if(window.AchSys) AchSys.stat("op_photo");
    const src=this.el("scope");
    const W=1800,H=2400;
    const cv=document.createElement("canvas"); cv.width=W; cv.height=H;
    const c=cv.getContext("2d");
    const SERIF='"Noto Serif SC","Songti SC","Noto Sans SC",serif';
    const SANS='"Noto Sans SC",sans-serif';
    const MONO='"JetBrains Mono","Courier New",monospace';
    // 纸底
    c.fillStyle="#fafaf8"; c.fillRect(0,0,W,H);
    const bg=c.createRadialGradient(W/2,1000,240,W/2,1000,1500);
    bg.addColorStop(0,"rgba(196,198,186,.28)"); bg.addColorStop(1,"rgba(250,250,248,0)");
    c.fillStyle=bg; c.fillRect(0,0,W,H);
    // 圆窗（视野高清放大）
    const R=640, cx=W/2, cy=1000;
    c.save();
    c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.clip();
    c.imageSmoothingEnabled=true; c.imageSmoothingQuality="high";
    c.drawImage(src,cx-R,cy-R,R*2,R*2);
    c.restore();
    // 苔色双环
    c.strokeStyle="rgba(108,123,95,.7)"; c.lineWidth=2;
    c.beginPath(); c.arc(cx,cy,R+1,0,Math.PI*2); c.stroke();
    c.strokeStyle="rgba(108,123,95,.26)"; c.lineWidth=1;
    c.beginPath(); c.arc(cx,cy,R+16,0,Math.PI*2); c.stroke();
    // 顶部：台号与题名
    const dim="#8b867d", ink="#2e2b26";
    c.textAlign="center";
    c.fillStyle=dim; c.font=`400 24px ${MONO}`;
    c.fillText("M O S S   T I M E   ·   观 测 台 01", W/2, 150);
    c.fillStyle=ink; c.font=`300 62px ${SERIF}`;
    c.fillText("苔 藓 时 间", W/2, 240);
    c.strokeStyle="rgba(108,123,95,.55)"; c.lineWidth=1;
    c.beginPath(); c.moveTo(W/2-64,276); c.lineTo(W/2+64,276); c.stroke();
    // 底部：一句诗，一行观测记录，一行日期
    const poem=POEMS[Math.floor(Math.random()*POEMS.length)];
    c.fillStyle=ink; c.font=`300 42px ${SERIF}`;
    c.fillText(poem.t, W/2, 1796);
    c.fillStyle=dim; c.font=`300 26px ${SERIF}`;
    c.fillText("—— "+poem.a, W/2, 1852);
    const sub=SUBSTRATES.find(s=>s.id===Game.state.substrate);
    c.fillStyle="#6f6a60"; c.font=`400 25px ${SANS}`;
    c.fillText(`第 ${Game.state.epoch} 纪元 · ${sub?sub.name:"玄武岩"} · 丰富度 ${Sim.richness()} · 覆盖度 ${Math.round(Sim.coverage()*100)}%`, W/2, 1984);
    const now=new Date(), p2=n=>String(n).padStart(2,"0");
    c.fillStyle="#a09a90"; c.font=`400 22px ${MONO}`;
    c.fillText(`图鉴 ${Game.state.discovered.length}/${window.COLLECTIBLE_COUNT||SPECIES.length}   ·   ${now.getFullYear()}-${p2(now.getMonth()+1)}-${p2(now.getDate())}`, W/2, 2036);
    c.fillText("OBSERVATION RECORD · MOSS TIME", W/2, 2260);
    cv.toBlob(b=>{
      if(!b){ this.toast("导出失败，请再试一次","bad"); return; }
      const a=document.createElement("a");
      a.href=URL.createObjectURL(b);
      a.download=`苔藓时间-观测海报-${now.getFullYear()}${p2(now.getMonth()+1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(()=>URL.revokeObjectURL(a.href),8000);
      this.toast("海报已导出 · 愿你收藏这一小片时间");
    },"image/png");
  },

  /* ---- 观展模式：只留圆窗与诗句 ---- */
  gallery:false,

  toggleGallery(force){
    const on=typeof force==="boolean"?force:!this.gallery;
    if(on===this.gallery) return;
    this.gallery=on;
    document.body.classList.toggle("gallery",on);
    if(on){
      this._preGallery={ident:this.identOn,lens:this.lensOn};
      if(this.identOn) this.el("btn-ident").click();
      if(this.lensOn) this.el("btn-lens").click();
      if(this.planting) this.cancelPlanting(true);
      document.querySelectorAll(".modal").forEach(m=>m.classList.add("hidden"));
      const hint=this.el("gallery-hint");
      hint.classList.remove("hidden");
      setTimeout(()=>hint.classList.add("hidden"),3000);
    }else{
      if(this._preGallery){
        if(this._preGallery.ident) this.el("btn-ident").click();
        if(this._preGallery.lens) this.el("btn-lens").click();
        this._preGallery=null;
      }
    }
    window.dispatchEvent(new Event("resize")); // 重算圆窗大小
  },

  /* ---- 存档导入导出 ---- */
  bindIO(){
    const box=this.el("io-box");
    this.el("btn-export").onclick=()=>{
      box.value=SaveSys.export();
      box.classList.remove("hidden");
      box.select();
      this.toast("存档码已生成，全选复制即可备份");
      setTimeout(()=>box.classList.add("hidden"),15000);
    };
    this.el("btn-import").onclick=()=>{
      if(box.classList.contains("hidden")){
        box.value=""; box.placeholder="在此粘贴存档码，然后再次点击「导入」";
        box.classList.remove("hidden"); box.focus();
      }else{
        if(SaveSys.import(box.value)){
          this.refreshAll();
          this.toast("存档导入成功");
          box.classList.add("hidden");
        }else{
          this.toast("存档码无效","bad");
        }
      }
    };
    this.el("btn-reset").onclick=()=>{
      if(confirm("确定要抹去全部观测记录吗？此操作不可撤销。")){
        SaveSys.wipe();
        location.reload();
      }
    };
  },
};

/* ---- 主循环 ---- */
let lastT=performance.now(), saveTimer=0, readTimer=0, achTimer=0;

function loop(t){
  const dt=Math.min(0.1,(t-lastT)/1000);
  lastT=t;

  // 滑块阻尼：环境参数缓动逼近目标
  const env=Game.state.env, tg=UI.targetEnv, k=1-Math.pow(0.25,dt*4);
  for(const key in env) env[key]+=(tg[key]-env[key])*k;

  if(!GuideSys.active) Sim.tick(dt); // 新手引导期间暂停生态演化
  Render.frame(t);

  readTimer+=dt;
  if(readTimer>0.5){ readTimer=0; UI.refreshReadout(); }

  achTimer+=dt;
  if(achTimer>2){
    achTimer=0;
    AchSys.stats.playSec=(AchSys.stats.playSec||0)+2;
    AchSys.check();
    // 音乐跟随生态情绪（含事件天气的影响）
    const eff=Sim.effectiveEnv();
    AudioSys.setMood({
      richness:Sim.richness(), coverage:Sim.coverage(),
      climax:Sim.climaxReady(),
      humidity:eff.humidity, light:eff.light, temp:eff.temp,
    });
    UI.renderQuestProgress(); // 委托进度与观测笔记随循环刷新
  }

  if(!GuideSys.active){ QuestSys.tick(dt); EventSys.tick(dt); } // 引导期间委托与事件也暂停

  saveTimer+=dt;
  if(saveTimer>10){ saveTimer=0; SaveSys.save(); }

  requestAnimationFrame(loop);
}

/* ---- 启动 ---- */
window.addEventListener("DOMContentLoaded",()=>{
  Render.init(UI.el("scope"));
  UI.bindSliders();
  UI.bindIO();
  UI.bindLens();
  UI.bindOps();
  UI.bindIdent();
  UI.bindPlanting();
  UI.el("codex-search").addEventListener("input",()=>UI.refreshCodex());
  UI.el("codex-filter").addEventListener("change",()=>UI.refreshCodex());
  UI.el("sub-keep").onclick=()=>UI.applySubstrate(true);
  UI.el("sub-clear").onclick=()=>UI.applySubstrate(false);
  UI.el("sub-cancel").onclick=()=>{UI.el("modal-substrate").classList.add("hidden");UI.pendingSub=null;};

  const data=SaveSys.load();
  if(data){
    const last=SaveSys.apply(data);
    const report=Sim.offline(Date.now()-last);
    UI.refreshAll();
    UI.showOffline(report);
    UI.status("欢迎回来，观测者。");
  }else{
    UI.refreshAll();
    UI.status("系统就绪。调节左侧参数，等待生命涌现。");
    setTimeout(()=>UI.toast("提示：普通苔藓喜欢 20°C / 湿度 80% / 光照 40% / pH 6 附近"),3000);
  }

  // 首次进入自动开启新手引导
  if(!Game.state.guideDone) setTimeout(()=>GuideSys.start(),900);

  QuestSys.ensure(true);
  UI.renderQuests();
  EventSys.init();

  // 顶栏按钮
  UI.el("btn-audio").onclick=function(){
    const on=AudioSys.toggle();
    this.textContent="音频:"+(on?"开":"关");
  };
  UI.el("btn-poem").onclick=function(){
    const on=PoemSys.toggle();
    this.textContent="诗句:"+(on?"开":"关");
  };
  UI.el("btn-help").onclick=()=>UI.el("modal-help").classList.remove("hidden");
  UI.el("btn-photo").onclick=()=>UI.exportPhoto();
  UI.el("btn-gallery").onclick=e=>{
    e.stopPropagation(); // 避免被下面的"点击退出"立刻吃掉
    UI.toggleGallery(true);
  };
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&UI.gallery) UI.toggleGallery(false);
  });
  document.addEventListener("click",()=>{ if(UI.gallery) UI.toggleGallery(false); });
  UI.el("btn-codex").onclick=()=>UI.el("modal-codex").classList.remove("hidden");
  UI.el("btn-ach").onclick=()=>{ UI.refreshAch(); UI.el("modal-ach").classList.remove("hidden"); };
  UI.el("btn-guide-replay").onclick=()=>{
    UI.el("modal-help").classList.add("hidden");
    GuideSys.start();
  };
  GuideSys.bind();
  UI.el("btn-extinct").onclick=()=>UI.openExtinct();
  document.querySelectorAll(".modal-close").forEach(b=>{
    b.onclick=()=>UI.el(b.dataset.close).classList.add("hidden");
  });

  // 画布自适应
  const fit=()=>{
    const gallery=document.body.classList.contains("gallery");
    const h=gallery
      ? Math.min(window.innerHeight*0.8, window.innerWidth*0.86, 880)
      : Math.min(window.innerHeight*0.6, window.innerWidth*0.5, 720);
    const cv=UI.el("scope");
    cv.style.width=h+"px"; cv.style.height=h+"px";
  };
  window.addEventListener("resize",fit);
  fit();

  window.addEventListener("beforeunload",()=>SaveSys.save());

  PoemSys.start();

  requestAnimationFrame(loop);
});
