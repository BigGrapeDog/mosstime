/* 苔藓时间 · 新手引导：分步高亮教学，可随时跳过/重看 */
"use strict";

const GuideSys={
  steps:[
   {el:null, title:"欢迎来到苔藓时间",
    text:"这里是一台生态观测仪。你不「购买」生命——你只调节环境，生命自己决定要不要出现。"},
   {el:"panel-left", title:"第一步 · 调节环境",
    text:"拖动四个滑块：温度、湿度、光照、pH。普通苔藓喜欢 20°C / 湿度 80% / 光照 40% / pH 6 附近。数值变化是缓慢的，像真实的培养箱。"},
   {el:"scope-wrap", title:"第二步 · 观察视野",
    text:"圆窗是你的培养皿。环境落进某个物种的适生区间时，它会以小斑块的形式涌现、长大。给它几十秒——生命不赶时间。"},
   {el:"readout", title:"第三步 · 看懂读数",
    text:"覆盖度与丰富度决定顶极进度。顶极达成后，你可以选择一场大灭绝，带着适应性状进入下一纪元。"},
   {el:"substrate-list", title:"第四步 · 换一块基质",
    text:"玄武岩、沉木、陶片……不同基质孕育不同物种，新基质随纪元解锁。更换时可以选择保留或回收当前样本。"},
   {el:"ops-list", title:"第五步 · 手动干预",
    text:"接种孢子、营养滴剂、紫外消毒、喷淋灌溉——你不仅是旁观者。每个操作有冷却，谨慎使用。"},
   {el:"topbar", title:"小工具与收藏",
    text:"顶栏有物种识别器、放大镜、环境音与诗句。右侧面板里有观测者日志（图鉴）与成就面板，会记录你见证过的一切。"},
   {el:null, title:"剩下的交给时间",
    text:"共生奇观、离线演化、微型动物的造访……都会在你不经意时发生。观测愉快。"},
  ],
  i:0, active:false,

  start(){
    this.i=0; this.active=true;
    this.el("guide-overlay").classList.remove("hidden");
    this.show();
  },

  el(id){ return document.getElementById(id); },

  show(){
    const st=this.steps[this.i];
    const spot=this.el("guide-spot"), card=this.el("guide-card");
    // 清掉上一步的激活高亮
    document.querySelectorAll(".guide-focus,.guide-focus-up")
      .forEach(e=>e.classList.remove("guide-focus","guide-focus-up"));
    this.el("guide-step-no").textContent=`${this.i+1} / ${this.steps.length}`;
    this.el("guide-title").textContent=st.title;
    this.el("guide-text").textContent=st.text;
    this.el("guide-next").textContent=this.i===this.steps.length-1?"开始观测":"下一步";

    if(st.el){
      const target=this.el(st.el);
      // 让被介绍的 UI 处于激活态：自身与祖先面板都提亮（面板平时只有 10% 不透明度）
      target.classList.add("guide-focus");
      let p=target.parentElement;
      while(p&&p!==document.body){ p.classList.add("guide-focus-up"); p=p.parentElement; }
      const r=target.getBoundingClientRect();
      const pad=8;
      spot.style.display="block";
      spot.style.left=(r.left-pad)+"px";
      spot.style.top=(r.top-pad)+"px";
      spot.style.width=(r.width+pad*2)+"px";
      spot.style.height=(r.height+pad*2)+"px";
      // 卡片放在目标附近（避免遮挡）
      let cx=r.left, cy=r.bottom+18;
      if(cy+150>window.innerHeight) cy=r.top-170;
      if(cx+320>window.innerWidth) cx=window.innerWidth-336;
      card.style.left=Math.max(12,cx)+"px";
      card.style.top=Math.max(12,cy)+"px";
    }else{
      spot.style.display="none";
      card.style.left="50%";
      card.style.top="50%";
      card.style.transform="translate(-50%,-50%)";
      if(st.el===null&&this.i!==this.steps.length-1&&this.i!==0){} // 居中步保持 transform
      else card.style.transform="translate(-50%,-50%)";
    }
    if(st.el) card.style.transform="";
  },

  next(){
    this.i++;
    if(this.i>=this.steps.length) this.finish();
    else this.show();
  },

  finish(){
    this.active=false;
    document.querySelectorAll(".guide-focus,.guide-focus-up")
      .forEach(e=>e.classList.remove("guide-focus","guide-focus-up"));
    this.el("guide-overlay").classList.add("hidden");
    Game.state.guideDone=true;
    SaveSys.save();
    UI.toast("引导完成。调节参数，等待第一抹绿。");
  },

  bind(){
    this.el("guide-next").onclick=()=>{ AudioSys.blip(660,0.06,0.06); this.next(); };
    this.el("guide-skip").onclick=()=>this.finish();
  },
};
