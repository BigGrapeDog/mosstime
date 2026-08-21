/* 苔藓时间 · 渲染层 v3：实时生长动画
   每个物种的形状由「生长元素模型」构成：元素带出生时间 t 与时长 d，
   随斑块半径增长（prog 0→1）逐段绘制到离屏画布——肉眼可见地生长 */
"use strict";

const Render = {
  cv:null, ctx:null, R:0, cx:0, cy:0,
  cache:new Map(),      // key -> {cv, ctx, half, model, tips, lastProg}
  highlight:null,
  drops:[],             // 指尖水珠涟漪 {x,y,t0}
  CACHE_MAX: 400,

  drop(x,y){ // 指尖点下一颗水珠
    this.drops.push({x,y,t0:performance.now()});
    if(this.drops.length>8) this.drops.shift();
  },

  init(canvas){
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.R = canvas.width/2;
    this.cx = this.R; this.cy = this.R;
  },

  rng(seed){
    let s = seed>>>0 || 1;
    return function(){
      s = (s*1664525 + 1013904223)>>>0;
      return s/4294967296;
    };
  },

  frame(t){
    const ctx=this.ctx, s=Game.state;
    const sub = SUBSTRATES.find(x=>x.id===s.substrate) || SUBSTRATES[0];
    ctx.clearRect(0,0,this.cv.width,this.cv.height);

    ctx.save();
    ctx.beginPath(); ctx.arc(this.cx,this.cy,this.R-2,0,Math.PI*2); ctx.clip();
    ctx.fillStyle = sub.color;
    ctx.fillRect(0,0,this.cv.width,this.cv.height);
    this.grain(sub);

    const theme = EPOCH_THEMES[Math.min(5,s.epoch)];
    if(theme && theme.tint){ ctx.fillStyle=theme.tint; ctx.fillRect(0,0,this.cv.width,this.cv.height); }

    const sorted=[...s.patches].sort((a,b)=>b.r-a.r);
    for(const p of sorted) this.patch(p, t);

    // 识别器高亮圈
    if(this.highlight && s.patches.includes(this.highlight)){
      const [x,y]=this.pos(this.highlight);
      const rr=this.highlight.r*1.5;
      ctx.save();
      ctx.strokeStyle="rgba(143,212,138,.9)";
      ctx.setLineDash([5,4]);
      ctx.lineDashOffset=-t/60;
      ctx.lineWidth=1.5;
      ctx.beginPath(); ctx.arc(x,y,Math.max(10,rr),0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }

    this.particles(t, theme);
    this.zones(t);    // 局部干预区域（遮光罩暗斑 / 滴酸琥珀环）
    this.droplets(t); // 指尖水珠涟漪

    const vg = ctx.createRadialGradient(this.cx,this.cy,this.R*0.7,this.cx,this.cy,this.R);
    vg.addColorStop(0,"rgba(0,0,0,0)");
    vg.addColorStop(1,"rgba(0,0,0,0.55)");
    ctx.fillStyle=vg; ctx.fillRect(0,0,this.cv.width,this.cv.height);
    ctx.restore();
  },

  grain(sub){
    const ctx=this.ctx, n=900;
    ctx.save(); ctx.globalAlpha=0.07;
    const rnd=this.rng(12345 + SUB_ORDER.indexOf(sub.id));
    for(let i=0;i<n;i++){
      const a=rnd()*Math.PI*2, r=Math.sqrt(rnd())*(this.R-4);
      const x=this.cx+Math.cos(a)*r, y=this.cy+Math.sin(a)*r;
      const g=Math.floor(rnd()*70);
      ctx.fillStyle = rnd()>0.5 ? `rgba(${200+g},${200+g},${190+g},0.5)` : "rgba(0,0,0,0.6)";
      ctx.fillRect(x,y,1.4,1.4);
    }
    ctx.restore();
  },

  /* ---- 斑块：生长进度驱动 ---- */
  patch(p, t){
    const sp = SPECIES.find(x=>x.id===p.sp); if(!sp) return;
    const ctx=this.ctx;
    if(sp.style==="critter"){ this.critter(p,sp,p.r,t); return; }

    // 生长进度：半径 7→43 映射为 0→1
    const prog=Math.max(0.04,Math.min(1,(p.r-7)/36));
    const breathe = 1 + 0.06*Math.sin(t/900 + p.seed);
    const alpha = Math.min(1, p.health*1.4);

    const bucket = Math.round(p.r/4);
    const phTag = sp.style==="lichen" ? "|ph"+Math.round(Game.state.env.ph) : "";
    const key = p.sp+"|"+p.seed+"|"+bucket+phTag;
    let entry = this.cache.get(key);
    if(!entry){
      entry = this.buildPatch(p, sp, bucket*4);
      if(this.cache.size>this.CACHE_MAX) this.cache.clear();
      this.cache.set(key, entry);
    }
    // 进度有变化才重绘（生长中约每十几秒一帧，几乎无开销）
    if(entry.lastProg<0 || prog-entry.lastProg>0.004 || prog<entry.lastProg){
      this.paint(entry, prog);
      entry.lastProg=prog;
    }

    const [x,y]=this.pos(p);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x,y);
    ctx.scale(breathe,breathe);
    ctx.drawImage(entry.cv, -entry.half, -entry.half);
    ctx.restore();

    // 发光类微光脉动（动态层）
    if(sp.id==="lichen_glow" || sp.id==="lux_spore" || sp.id==="glow_slime"){
      const pulse=0.4+0.6*Math.abs(Math.sin(t/1200+p.seed));
      ctx.save();
      ctx.globalAlpha=pulse*0.5*alpha;
      const g=ctx.createRadialGradient(x,y,0,x,y,p.r*1.6);
      g.addColorStop(0,`hsla(${sp.hue},90%,60%,.5)`);
      g.addColorStop(1,"transparent");
      ctx.fillStyle=g;
      ctx.beginPath(); ctx.arc(x,y,p.r*1.6,0,Math.PI*2); ctx.fill();
      ctx.restore();
    }

    // 黏菌原生质往返流动：一道沿脉网扩散的亮环
    if(sp.style==="slime" && alpha>0.1){
      const cyc=((t/2600)+p.seed%7)%1;
      const rr=cyc*p.r*1.35;
      ctx.save();
      ctx.globalCompositeOperation="lighter";
      ctx.globalAlpha=0.28*alpha*Math.sin(cyc*Math.PI);
      ctx.strokeStyle=`hsla(${sp.hue+15},85%,72%,1)`;
      ctx.lineWidth=Math.max(2,p.r*0.16);
      ctx.beginPath(); ctx.arc(x,y,rr,0,Math.PI*2); ctx.stroke();
      ctx.restore();
    }

    // 生长尖端脉冲（菌丝/黏菌的前端在呼吸）
    if((sp.style==="hypha"||sp.style==="slime") && entry.tips && entry.tips.length && prog>0.3){
      ctx.save();
      ctx.translate(x,y); ctx.scale(breathe,breathe);
      const visN=Math.ceil(entry.tips.length*prog);
      ctx.fillStyle=`hsla(${sp.hue},45%,80%,${(0.35+0.3*Math.sin(t/500+p.seed))*alpha})`;
      for(let i=0;i<visN;i++){
        const tp=entry.tips[i];
        const tw=1+0.5*Math.sin(t/400+i*2.1+p.seed);
        ctx.beginPath(); ctx.arc(tp[0],tp[1],Math.max(0.8,tw),0,Math.PI*2); ctx.fill();
      }
      ctx.restore();
    }
  },

  /* ---- 构建生长模型 + 离屏画布 ---- */
  buildPatch(p, sp, r){
    const pad=r*1.5+8, size=pad*2;
    const cv=document.createElement("canvas");
    cv.width=cv.height=size;
    const c=cv.getContext("2d");
    c.translate(pad,pad);
    const rnd=this.rng(p.seed);
    const model={items:[],tips:null};
    switch(sp.style){
      case "moss": this.buildMoss(model,c,rnd,sp,r); break;
      case "hypha": this.buildHypha(model,c,rnd,sp,r); break;
      case "lichen": this.buildLichen(model,c,rnd,sp,r); break;
      case "algae": this.buildAlgae(model,c,rnd,sp,r); break;
      case "mold": this.buildMold(model,c,rnd,sp,r); break;
      case "crystal": this.buildCrystal(model,c,rnd,sp,r); break;
      case "slime": this.buildSlime(model,c,rnd,sp,r); break;
      case "shroom": this.buildShroom(model,c,rnd,sp,r); break;
      case "fern": this.buildFern(model,c,rnd,sp,r); break;
    }
    return {cv, ctx:c, half:pad, model, tips:model.tips, lastProg:-1};
  },

  /* ---- 生长模型绘制器：把 t<=prog 的元素画到离屏画布 ---- */
  paint(entry, prog){
    const c=entry.ctx, pad=entry.half;
    c.clearRect(-pad,-pad,pad*2,pad*2);
    c.lineCap="round"; c.lineJoin="round";
    for(const e of entry.model.items){
      const lp=(prog-e.t)/e.d;
      if(lp<=0) continue;
      const k=Math.min(1,lp);
      const ease=k*k*(3-2*k); // smoothstep 缓动
      switch(e.kind){
        case "glow":{
          const rr=Math.max(0.5,e.rr*ease);
          const g=c.createRadialGradient(e.x,e.y,0,e.x,e.y,rr);
          for(const [o,col] of e.stops) g.addColorStop(o,col);
          c.globalAlpha=(e.alpha??1)*(0.25+0.75*ease);
          c.fillStyle=g;
          c.beginPath(); c.arc(e.x,e.y,rr,0,Math.PI*2); c.fill();
          c.globalAlpha=1;
          break;
        }
        case "seg":{
          const mx=e.x0+(e.x1-e.x0)*k, my=e.y0+(e.y1-e.y0)*k;
          c.strokeStyle=e.col; c.lineWidth=e.w;
          c.globalAlpha=(e.alpha??1)*Math.min(1,k*3);
          c.beginPath(); c.moveTo(e.x0,e.y0); c.lineTo(mx,my); c.stroke();
          c.globalAlpha=1;
          break;
        }
        case "curve":{
          // de Casteljau 分割：画出曲线的前 k 段
          const qx=(1-k)*e.x0+k*e.cx, qy=(1-k)*e.y0+k*e.cy;
          const ex=(1-k)*(1-k)*e.x0+2*(1-k)*k*e.cx+k*k*e.x1;
          const ey=(1-k)*(1-k)*e.y0+2*(1-k)*k*e.cy+k*k*e.y1;
          c.strokeStyle=e.col; c.lineWidth=e.w;
          c.globalAlpha=(e.alpha??1)*Math.min(1,k*3);
          c.beginPath(); c.moveTo(e.x0,e.y0); c.quadraticCurveTo(qx,qy,ex,ey); c.stroke();
          c.globalAlpha=1;
          break;
        }
        case "disc":{
          c.fillStyle=e.col;
          c.globalAlpha=(e.alpha??1)*ease;
          c.beginPath(); c.arc(e.x,e.y,Math.max(0.3,e.rr*ease),0,Math.PI*2); c.fill();
          c.globalAlpha=1;
          break;
        }
        case "ring":{
          c.strokeStyle=e.col; c.lineWidth=e.w;
          c.globalAlpha=(e.alpha??1)*Math.min(1,k*2.5);
          c.beginPath(); c.arc(e.x,e.y,e.rr,e.a0,e.a0+e.sweep*k); c.stroke();
          c.globalAlpha=1;
          break;
        }
        case "leaf":{
          c.save();
          c.translate(e.x,e.y); c.rotate(e.rot);
          c.fillStyle=e.col;
          c.globalAlpha=(e.alpha??1)*ease;
          c.beginPath(); c.ellipse(0,0,Math.max(0.3,e.rx*ease),Math.max(0.2,e.ry*ease),0,0,Math.PI*2); c.fill();
          c.restore(); c.globalAlpha=1;
          break;
        }
        case "poly":{
          c.fillStyle=e.col;
          c.globalAlpha=(e.alpha??1)*ease;
          c.beginPath();
          for(let i=0;i<e.pts.length;i++){
            const px=e.cx+(e.pts[i][0]-e.cx)*ease, py=e.cy+(e.pts[i][1]-e.cy)*ease;
            i===0?c.moveTo(px,py):c.lineTo(px,py);
          }
          c.closePath(); c.fill();
          if(e.stroke){ c.strokeStyle=e.stroke; c.lineWidth=0.8; c.stroke(); }
          c.globalAlpha=1;
          break;
        }
        case "dot":{
          c.fillStyle=e.col;
          c.globalAlpha=(e.alpha??1)*ease;
          c.fillRect(e.x,e.y,e.s,e.s);
          c.globalAlpha=1;
          break;
        }
      }
    }
  },

  /* ======== 各族系的生长模型构建（元素按出生时间排序） ======== */

  buildMoss(m,c,rnd,sp,r){
    const H=h=>`hsla(${h},45%,L%,A)`;
    // 底层绒垫先铺开
    const lobes=5+Math.floor(rnd()*4);
    for(let i=0;i<lobes;i++){
      const a=rnd()*Math.PI*2, d=rnd()*r*0.5;
      const lr=r*(0.4+rnd()*0.4);
      const h=sp.hue+rnd()*20-10;
      m.items.push({kind:"glow",t:0.02*i,d:0.14,x:Math.cos(a)*d,y:Math.sin(a)*d,rr:lr,
        stops:[[0,`hsla(${h},42%,${26+rnd()*10}%,0.85)`],[1,`hsla(${h},42%,18%,0)`]]});
    }
    // 拟茎叶体枝条：一节一节长叶
    const shoots=6+Math.floor(rnd()*4);
    for(let s=0;s<shoots;s++){
      let a=(s/shoots)*Math.PI*2 + rnd()*0.7;
      let bx=rnd()*r*0.15*(rnd()>0.5?1:-1), by=rnd()*r*0.15*(rnd()>0.5?1:-1);
      const steps=7+Math.floor(rnd()*5);
      const leafBase=r*0.09;
      let clock=0.18+rnd()*0.12; // 各枝条错峰萌发
      for(let i=0;i<steps;i++){
        a+=(rnd()-0.5)*0.55;
        const len=r*0.11;
        bx+=Math.cos(a)*len; by+=Math.sin(a)*len;
        const h=sp.hue+rnd()*16-8;
        const ls=leafBase*(1+i/steps*0.9)*(0.7+rnd()*0.5);
        const nl=2+(rnd()>0.6?1:0);
        for(let l=0;l<nl;l++){
          const la=a+(l-(nl-1)/2)*1.9+(rnd()-0.5)*0.4;
          m.items.push({kind:"leaf",t:clock,d:0.07,
            x:bx+Math.cos(la)*ls*0.8,y:by+Math.sin(la)*ls*0.8,rot:la,rx:ls,ry:ls*0.42,
            col:`hsla(${h},48%,${34+i*2+rnd()*8}%,0.85)`});
          m.items.push({kind:"seg",t:clock,d:0.07,
            x0:bx,y0:by,x1:bx+Math.cos(la)*ls*1.5,y1:by+Math.sin(la)*ls*1.5,w:0.5,
            col:`hsla(${h+10},55%,${55+i*2}%,0.5)`});
        }
        clock+=0.045;
      }
      // 枝端偶发孢蒴（很晚才出现）
      if(rnd()<0.35){
        const sl=r*0.22;
        const ex=bx+Math.cos(a)*sl, ey=by+Math.sin(a)*sl;
        m.items.push({kind:"curve",t:Math.min(0.85,clock+0.05),d:0.12,
          x0:bx,y0:by,cx:bx+Math.cos(a)*sl*0.5+2,cy:by+Math.sin(a)*sl*0.5-2,x1:ex,y1:ey,w:0.7,
          col:`hsla(${sp.hue+20},40%,52%,0.8)`});
        m.items.push({kind:"leaf",t:Math.min(0.92,clock+0.14),d:0.08,
          x:ex,y:ey,rot:a,rx:2,ry:1.3,col:`hsla(${sp.hue+25},55%,45%,0.95)`});
      }
    }
    // 露珠高光最后凝结
    const dots=Math.floor(r*0.6);
    for(let i=0;i<dots;i++){
      const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r*0.8;
      m.items.push({kind:"dot",t:0.45+rnd()*0.5,d:0.1,x:Math.cos(a)*d,y:Math.sin(a)*d,s:1.1,
        col:`hsla(${sp.hue+15},60%,60%,0.7)`});
    }
  },

  buildHypha(m,c,rnd,sp,r){
    const tips=[];
    const branches=6+Math.floor(rnd()*4);
    for(let b=0;b<branches;b++){
      let a=(b/branches)*Math.PI*2 + rnd()*0.8;
      let bx=0,by=0;
      const segs=7+Math.floor(rnd()*5);
      let clock=0.04+b*0.05; // 各主枝错峰延伸
      for(let i=0;i<segs;i++){
        a += (rnd()-0.5)*0.9;
        const len=r*0.18*(0.6+rnd()*0.8);
        const nx=bx+Math.cos(a)*len, ny=by+Math.sin(a)*len;
        m.items.push({kind:"seg",t:clock,d:0.05,x0:bx,y0:by,x1:nx,y1:ny,w:3,
          col:`hsla(${sp.hue},30%,70%,0.15)`});
        m.items.push({kind:"seg",t:clock,d:0.05,x0:bx,y0:by,x1:nx,y1:ny,w:1,
          col:`hsla(${sp.hue},35%,74%,0.8)`});
        if(rnd()>0.68){
          const fa=a+(rnd()>0.5?0.75:-0.75);
          m.items.push({kind:"seg",t:clock+0.02,d:0.05,x0:nx,y0:ny,
            x1:nx+Math.cos(fa)*len*0.7,y1:ny+Math.sin(fa)*len*0.7,w:1,
            col:`hsla(${sp.hue},35%,74%,0.7)`});
        }
        if(i%3===2) m.items.push({kind:"dot",t:clock,d:0.05,x:nx-0.5,y:ny-0.5,s:1,
          col:`hsla(${sp.hue},30%,80%,0.5)`});
        bx=nx; by=ny; clock+=0.045;
      }
      tips.push([bx,by]);
    }
    // 菌丝融合横联（长到中后段才搭桥）
    const nodes=[];
    for(const it of m.items) if(it.kind==="seg"&&it.w===1) nodes.push([it.x1,it.y1]);
    let links=0;
    for(let i=0;i<nodes.length&&links<branches;i++){
      for(let j=i+1;j<nodes.length&&links<branches;j++){
        const d=Math.hypot(nodes[i][0]-nodes[j][0],nodes[i][1]-nodes[j][1]);
        if(d>r*0.12 && d<r*0.3 && rnd()<0.12){
          const mx=(nodes[i][0]+nodes[j][0])/2+(rnd()-0.5)*d*0.4;
          const my=(nodes[i][1]+nodes[j][1])/2+(rnd()-0.5)*d*0.4;
          m.items.push({kind:"curve",t:0.55+rnd()*0.3,d:0.1,
            x0:nodes[i][0],y0:nodes[i][1],cx:mx,cy:my,x1:nodes[j][0],y1:nodes[j][1],w:1,
            col:`hsla(${sp.hue},35%,74%,0.6)`});
          links++;
        }
      }
    }
    m.items.push({kind:"disc",t:0,d:0.08,x:0,y:0,rr:Math.max(2,r*0.08),
      col:`hsla(${sp.hue},40%,60%,0.9)`});
    m.tips=tips;
  },

  buildLichen(m,c,rnd,sp,r){
    const ph=Game.state.env.ph;
    const baseH = ph<5 ? 65 : ph<7.5 ? sp.hue : 250;
    const wobPts=(lr,jag)=>{
      const pts=[];
      const n=18;
      for(let i=0;i<n;i++){
        const a=(i/n)*Math.PI*2;
        const wob=1+jag*Math.sin(a*3+rnd()*6)+jag*0.6*rnd();
        pts.push([Math.cos(a)*lr*wob,Math.sin(a)*lr*wob]);
      }
      return pts;
    };
    // 下生层（开疆前线）先铺
    m.items.push({kind:"poly",t:0,d:0.2,cx:0,cy:0,pts:wobPts(r*1.06,0.22),
      col:`hsla(${baseH},20%,14%,0.5)`});
    // 叶状裂片由内向外扩
    for(let l=2;l>=0;l--){
      const lr=r*(1-l*0.24);
      m.items.push({kind:"poly",t:0.08+(2-l)*0.1,d:0.18,cx:0,cy:0,pts:wobPts(lr,0.2+l*0.06),
        col:`hsla(${baseH+l*10},${30+l*12}%,${28+l*10}%,${0.35+l*0.15})`});
    }
    // 粉霜质感
    const n=Math.floor(r*0.9);
    for(let i=0;i<n;i++){
      const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r*0.85;
      m.items.push({kind:"dot",t:0.25+d/r*0.5,d:0.08,x:Math.cos(a)*d,y:Math.sin(a)*d,s:1.2,
        col:`hsla(${baseH+8},${25+rnd()*20}%,${40+rnd()*25}%,0.25)`});
    }
    // 子囊盘最后成熟
    const ap=Math.floor(r*0.28)+1;
    for(let i=0;i<ap;i++){
      const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r*0.6;
      const ax=Math.cos(a)*d, ay=Math.sin(a)*d;
      const ar=Math.max(1.2,r*0.05+rnd()*r*0.05);
      m.items.push({kind:"disc",t:0.6+rnd()*0.3,d:0.12,x:ax,y:ay,rr:ar,
        col:`hsla(${baseH+30},45%,32%,0.9)`});
      m.items.push({kind:"disc",t:0.68+rnd()*0.3,d:0.1,x:ax,y:ay,rr:ar*0.45,
        col:`hsla(${baseH+30},55%,55%,0.9)`});
    }
  },

  buildAlgae(m,c,rnd,sp,r){
    m.items.push({kind:"glow",t:0,d:0.2,x:0,y:0,rr:r*1.3,
      stops:[[0,`hsla(${sp.hue},55%,38%,0.5)`],[0.7,`hsla(${sp.hue},55%,30%,0.28)`],[1,`hsla(${sp.hue},55%,25%,0)`]]});
    const n=Math.floor(r*0.5);
    for(let i=0;i<n;i++){
      const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r;
      m.items.push({kind:"disc",t:0.1+(d/r)*0.7,d:0.12,x:Math.cos(a)*d,y:Math.sin(a)*d,rr:1+rnd()*1.5,
        col:`hsla(${sp.hue+20},70%,65%,0.3)`});
    }
  },

  buildMold(m,c,rnd,sp,r){
    const n=Math.floor(r*1.1);
    for(let i=0;i<n;i++){
      const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r;
      m.items.push({kind:"dot",t:0.03+(d/r)*0.6+rnd()*0.1,d:0.1,
        x:Math.cos(a)*d,y:Math.sin(a)*d,s:1+rnd()*2.2,
        col:`hsla(${sp.hue},30%,70%,0.5)`});
    }
    const n2=Math.floor(r*0.3);
    for(let i=0;i<n2;i++){
      const a=rnd()*Math.PI*2,d=Math.sqrt(rnd())*r*0.6;
      m.items.push({kind:"dot",t:0.55+rnd()*0.35,d:0.1,x:Math.cos(a)*d,y:Math.sin(a)*d,s:1,
        col:`hsla(${sp.hue},35%,80%,0.6)`});
    }
  },

  buildCrystal(m,c,rnd,sp,r){
    const n=5+Math.floor(rnd()*4);
    for(let i=0;i<n;i++){
      const a=rnd()*Math.PI*2,d=rnd()*r*0.5;
      const cx=Math.cos(a)*d, cy=Math.sin(a)*d;
      const cr=r*(0.15+rnd()*0.25);
      const sides=5+Math.floor(rnd()*3);
      const rot=rnd()*Math.PI;
      const pts=[];
      for(let k=0;k<sides;k++){
        const ka=rot+(k/sides)*Math.PI*2;
        pts.push([cx+Math.cos(ka)*cr,cy+Math.sin(ka)*cr]);
      }
      m.items.push({kind:"poly",t:0.06+i*0.09,d:0.16,cx,cy,pts,
        col:`hsla(${sp.hue},50%,60%,0.75)`,stroke:`hsla(${sp.hue},70%,85%,0.6)`});
    }
  },

  /* 黏菌：主脉一段段向外延伸，侧枝随后，横联最后，探索珠收尾 */
  buildSlime(m,c,rnd,sp,r){
    const tips=[];
    m.items.push({kind:"glow",t:0,d:0.14,x:0,y:0,rr:r*0.5,
      stops:[[0,`hsla(${sp.hue},72%,56%,0.85)`],[1,`hsla(${sp.hue},65%,48%,0)`]]});
    const nV=5+Math.floor(rnd()*4);
    const veinEnds=[];
    for(let v=0;v<nV;v++){
      let a=(v/nV)*Math.PI*2 + rnd()*0.9;
      let bx=0, by=0;
      const segs=8+Math.floor(rnd()*5);
      const w0=Math.max(1.6,r*0.075)*(0.8+rnd()*0.5);
      let clock=0.1+v*0.07;
      const mids=[];
      for(let i=0;i<segs;i++){
        a+=(rnd()-0.5)*0.5;
        const len=r*0.13*(0.7+rnd()*0.7);
        const nx=bx+Math.cos(a)*len, ny=by+Math.sin(a)*len;
        const w=w0*(1-(i+1)/segs*0.75);
        m.items.push({kind:"seg",t:clock,d:0.05,x0:bx,y0:by,x1:nx,y1:ny,w:w*3,
          col:`hsla(${sp.hue},65%,60%,0.14)`});
        m.items.push({kind:"seg",t:clock,d:0.05,x0:bx,y0:by,x1:nx,y1:ny,w:Math.max(0.6,w),
          col:`hsla(${sp.hue},72%,${58+Math.min(16,w*4)}%,0.85)`});
        if(i>=2&&i%2===0) mids.push([nx,ny,w]);
        // 侧枝随后分出
        if(rnd()<0.4){
          const fa=a+(rnd()>0.5?1:-1)*(0.6+rnd()*0.5);
          let sx=nx,sy=ny,sa=fa;
          const bw=w*0.5;
          const sn=3+Math.floor(rnd()*3);
          let sclock=clock+0.05;
          for(let k=0;k<sn;k++){
            sa+=(rnd()-0.5)*0.5;
            const sl=r*0.1*(0.6+rnd()*0.7);
            const ex=sx+Math.cos(sa)*sl, ey=sy+Math.sin(sa)*sl;
            m.items.push({kind:"seg",t:sclock,d:0.05,x0:sx,y0:sy,x1:ex,y1:ey,w:Math.max(0.5,bw*(1-(k+1)/sn*0.7)),
              col:`hsla(${sp.hue},70%,60%,0.75)`});
            sx=ex;sy=ey;sclock+=0.04;
          }
          tips.push([sx,sy]);
        }
        bx=nx;by=ny;clock+=0.05;
      }
      tips.push([bx,by]);
      veinEnds.push(...mids);
    }
    // 脉间横联（网络成型期才搭桥）
    let links=0;
    for(let i=0;i<veinEnds.length&&links<nV;i++){
      for(let j=i+1;j<veinEnds.length&&links<nV;j++){
        const d=Math.hypot(veinEnds[i][0]-veinEnds[j][0],veinEnds[i][1]-veinEnds[j][1]);
        if(d>r*0.14&&d<r*0.38&&rnd()<0.3){
          const mx=(veinEnds[i][0]+veinEnds[j][0])/2+(rnd()-0.5)*d*0.35;
          const my=(veinEnds[i][1]+veinEnds[j][1])/2+(rnd()-0.5)*d*0.35;
          m.items.push({kind:"curve",t:0.68+rnd()*0.2,d:0.1,
            x0:veinEnds[i][0],y0:veinEnds[i][1],cx:mx,cy:my,x1:veinEnds[j][0],y1:veinEnds[j][1],
            w:Math.max(0.6,veinEnds[i][2]*0.55),
            col:`hsla(${sp.hue},70%,62%,0.7)`});
          links++;
        }
      }
    }
    // 探索缘亮珠最后出现
    for(const [tx,ty] of tips){
      if(tx*tx+ty*ty>r*r*1.5) continue;
      m.items.push({kind:"disc",t:0.85+rnd()*0.12,d:0.08,x:tx,y:ty,rr:1.2+rnd()*1,
        col:`hsla(${sp.hue+10},82%,70%,0.65)`});
    }
    m.tips=tips;
  },

  /* 蘑菇：菌丝垫 → 原基小点 → 菌盖撑开 → 环带与菌褶 → 伞心 */
  buildShroom(m,c,rnd,sp,r){
    m.items.push({kind:"glow",t:0,d:0.16,x:0,y:0,rr:r*1.2,
      stops:[[0,`hsla(${sp.hue},28%,68%,0.4)`],[1,`hsla(${sp.hue},25%,60%,0)`]]});
    const n=5+Math.floor(rnd()*4);
    for(let i=0;i<n;i++){
      const a=rnd()*Math.PI*2, d=Math.sqrt(rnd())*r*0.72;
      const cx=Math.cos(a)*d, cy=Math.sin(a)*d;
      const cr=r*(0.3+rnd()*0.3);
      const h=sp.hue+rnd()*16-8;
      const t0=0.12+i*(0.6/n)+rnd()*0.05; // 错峰出土
      // 原基：先冒一个小点
      m.items.push({kind:"disc",t:t0,d:0.06,x:cx,y:cy,rr:cr*0.18,
        col:`hsla(${h},35%,55%,0.9)`});
      // 菌盖撑开（带阴影）
      m.items.push({kind:"leaf",t:t0+0.05,d:0.14,x:cx+cr*0.18,y:cy+cr*0.22,rot:0,rx:cr,ry:cr*0.9,
        col:`hsla(${h},30%,20%,0.3)`});
      m.items.push({kind:"glow",t:t0+0.06,d:0.16,x:cx,y:cy,rr:cr,
        stops:[[0,`hsla(${h},${40+rnd()*15}%,${62+rnd()*10}%,0.95)`],
               [0.75,`hsla(${h},42%,46%,0.92)`],[1,`hsla(${h},38%,30%,0.95)`]]});
      // 同心生长环
      for(let ring=1;ring<=3;ring++){
        m.items.push({kind:"ring",t:t0+0.14+ring*0.03,d:0.1,x:cx,y:cy,rr:cr*ring/3.6,
          a0:rnd()*Math.PI*2,sweep:Math.PI*2,w:0.8,
          col:`hsla(${h},30%,34%,0.35)`});
      }
      // 菌褶月牙
      m.items.push({kind:"ring",t:t0+0.2,d:0.1,x:cx,y:cy,rr:cr*0.82,
        a0:rnd()*Math.PI*2,sweep:Math.PI*0.55,w:cr*0.14,
        col:`hsla(${h+20},45%,72%,0.7)`});
      // 伞心
      m.items.push({kind:"disc",t:t0+0.22,d:0.08,x:cx-cr*0.1,y:cy-cr*0.1,rr:cr*0.16,
        col:`hsla(${h},45%,${55+rnd()*12}%,0.9)`});
    }
  },

  /* 蕨：原叶体一片片展开 / 复叶一节节抽叶 */
  buildFern(m,c,rnd,sp,r){
    if(rnd()<0.5){
      const hearts=3+Math.floor(rnd()*2);
      for(let i=0;i<hearts;i++){
        const a=rnd()*Math.PI*2, d=rnd()*r*0.4;
        const hx=Math.cos(a)*d, hy=Math.sin(a)*d;
        const hr=r*(0.5+rnd()*0.35), rot=rnd()*Math.PI*2;
        const h=sp.hue+rnd()*14-7;
        // 心形轮廓采样为多边形
        const bz=(p0,c1,c2,p1,t)=>{
          const u=1-t;
          return [u*u*u*p0[0]+3*u*u*t*c1[0]+3*u*t*t*c2[0]+t*t*t*p1[0],
                  u*u*u*p0[1]+3*u*u*t*c1[1]+3*u*t*t*c2[1]+t*t*t*p1[1]];
        };
        const raw=[];
        for(let k=0;k<=10;k++) raw.push(bz([0,hr*0.1],[-hr*0.9,-hr*0.55],[-hr*0.55,-hr*1.05],[0,-hr*0.62],k/10));
        for(let k=0;k<=10;k++) raw.push(bz([0,-hr*0.62],[hr*0.55,-hr*1.05],[hr*0.9,-hr*0.55],[0,hr*0.1],k/10));
        const ca=Math.cos(rot),sa=Math.sin(rot);
        const pts=raw.map(([px,py])=>[hx+px*ca-py*sa, hy+px*sa+py*ca]);
        const t0=0.08+i*0.18;
        m.items.push({kind:"poly",t:t0,d:0.2,cx:hx,cy:hy,pts,
          col:`hsla(${h},45%,${34+rnd()*8}%,0.85)`});
        // 细胞质感
        const cn=Math.floor(hr*1.2);
        for(let k=0;k<cn;k++){
          const da=rnd()*Math.PI*2, dd=Math.sqrt(rnd())*hr*0.5;
          const lx=Math.cos(da)*dd, ly=-hr*0.45+Math.sin(da)*dd*0.7;
          m.items.push({kind:"dot",t:t0+0.12+rnd()*0.15,d:0.08,
            x:hx+lx*ca-ly*sa, y:hy+lx*sa+ly*ca, s:1.1,
            col:`hsla(${h+10},50%,${45+rnd()*10}%,0.35)`});
        }
        // 假根
        for(let k=0;k<6;k++){
          const ra=(k/6-0.5)*1.2;
          const x0=hx+(0)*ca-(hr*0.05)*sa, y0=hy+(0)*sa+(hr*0.05)*ca;
          const x1=hx+(Math.sin(ra)*hr*0.3)*ca-(hr*0.05+Math.cos(ra)*hr*0.35)*sa;
          const y1=hy+(Math.sin(ra)*hr*0.3)*sa+(hr*0.05+Math.cos(ra)*hr*0.35)*ca;
          m.items.push({kind:"seg",t:t0+0.16,d:0.08,x0,y0,x1,y1,w:0.6,
            col:`hsla(${h-10},35%,26%,0.6)`});
        }
      }
    }else{
      const fronds=3+Math.floor(rnd()*3);
      for(let f=0;f<fronds;f++){
        let a=(f/fronds)*Math.PI*2+rnd()*0.8;
        const len=r*(0.75+rnd()*0.45);
        const segs=9+Math.floor(rnd()*4);
        let bx=0,by=0;
        let clock=0.1+f*0.12;
        let prevA=a;
        for(let i=0;i<segs;i++){
          a+=(rnd()-0.5)*0.3;
          const nx=bx+Math.cos(a)*len/segs, ny=by+Math.sin(a)*len/segs;
          m.items.push({kind:"seg",t:clock,d:0.05,x0:bx,y0:by,x1:nx,y1:ny,w:1,
            col:`hsla(${sp.hue},40%,30%,0.8)`});
          // 羽片跟着节间长出
          if(i>=2){
            const tt=i/segs;
            const ls=r*0.1*(1-tt*0.75);
            const pa=Math.atan2(ny-by,nx-bx);
            for(const side of [-1,1]){
              const la=pa+side*(Math.PI/2.4);
              m.items.push({kind:"leaf",t:clock+0.03,d:0.07,
                x:nx+Math.cos(la)*ls*0.75,y:ny+Math.sin(la)*ls*0.75,rot:la,rx:ls,ry:ls*0.38,
                col:`hsla(${sp.hue+Math.floor(rnd()*12)-6},48%,${36+tt*14}%,0.9)`});
            }
          }
          bx=nx;by=ny;clock+=0.045;
        }
      }
    }
  },

  /* 局部作用区：遮光=柔暗斑，滴酸=琥珀色脉动环 */
  zones(t){
    const ctx=this.ctx, now=performance.now();
    for(const z of Sim.zones){
      const [x,y]=this.pos(z);
      const rr=z.r*this.R*0.92;
      if(z.type==="light"){
        const g=ctx.createRadialGradient(x,y,0,x,y,rr);
        g.addColorStop(0,"rgba(14,12,8,0.32)");
        g.addColorStop(0.8,"rgba(14,12,8,0.18)");
        g.addColorStop(1,"rgba(14,12,8,0)");
        ctx.fillStyle=g;
        ctx.beginPath(); ctx.arc(x,y,rr,0,Math.PI*2); ctx.fill();
      }else{
        const pulse=0.5+0.5*Math.sin(t/500);
        ctx.strokeStyle=`rgba(216,164,74,${0.25+pulse*0.3})`;
        ctx.lineWidth=1.2; ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.arc(x,y,rr*(0.94+pulse*0.04),0,Math.PI*2); ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  },

  /* 指尖水珠：两圈扩散涟漪 + 中心一点水光 */
  droplets(t){
    const ctx=this.ctx, now=performance.now();
    this.drops=this.drops.filter(d=>now-d.t0<1200);
    for(const d of this.drops){
      const [x,y]=this.pos(d);
      const k=(now-d.t0)/1200;
      for(const [mul,a] of [[1,0.5],[0.55,0.35]]){
        ctx.strokeStyle=`rgba(220,235,240,${a*(1-k)})`;
        ctx.lineWidth=1.4;
        ctx.beginPath(); ctx.arc(x,y,4+k*46*mul,0,Math.PI*2); ctx.stroke();
      }
      if(k<0.3){
        ctx.fillStyle=`rgba(235,245,248,${0.7*(1-k/0.3)})`;
        ctx.beginPath(); ctx.arc(x,y,2.2-k*1.5,0,Math.PI*2); ctx.fill();
      }
    }
  },

  critter(p,sp,r,t){
    const ctx=this.ctx,[x,y]=this.pos(p);
    const s=Math.max(3,r*0.3);
    let kind="ciliate";
    if(sp.id==="tardigrade") kind="tardigrade";
    else if(sp.id==="beetle") kind="beetle";
    else if(/线虫/.test(sp.name)) kind="nematode";
    else if(/轮虫/.test(sp.name)) kind="rotifer";
    else if(/孢囊/.test(sp.name)) kind="cyst";
    const dir=Math.sin(t/2600+p.seed)*0.8+(p.seed%6);
    ctx.save();
    ctx.translate(x,y);

    if(kind==="tardigrade"){
      const wob=Math.sin(t/300+p.seed)*2;
      ctx.rotate(dir*0.3);
      ctx.fillStyle=`hsla(${sp.hue},45%,60%,0.95)`;
      ctx.beginPath(); ctx.ellipse(0,0,s,s*0.7,wob*0.1,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`hsla(${sp.hue},45%,55%,0.9)`;
      ctx.lineWidth=1.2;
      for(let i=0;i<4;i++){
        const lx=-s*0.7+i*(s*0.45);
        const lw=Math.sin(t/200+i)*1.5;
        ctx.beginPath(); ctx.moveTo(lx,s*0.5); ctx.lineTo(lx+lw,s*0.85); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx,-s*0.5); ctx.lineTo(lx+lw,-s*0.85); ctx.stroke();
      }
    }else if(kind==="beetle"){
      // 食腐甲虫：深色椭圆鞘翅 + 中缝 + 六条步足
      ctx.rotate(dir*0.5);
      const wob=Math.sin(t/260+p.seed)*0.06;
      ctx.rotate(wob);
      ctx.fillStyle="hsla(28,45%,22%,0.96)";
      ctx.beginPath(); ctx.ellipse(0,0,s,s*0.68,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle="hsla(30,40%,12%,0.8)"; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(-s*0.9,0); ctx.lineTo(s*0.9,0); ctx.stroke(); // 鞘翅中缝
      ctx.fillStyle="hsla(30,45%,16%,0.95)";
      ctx.beginPath(); ctx.ellipse(s*1.05,0,s*0.32,s*0.26,0,0,Math.PI*2); ctx.fill(); // 头
      ctx.strokeStyle="hsla(28,40%,18%,0.85)"; ctx.lineWidth=1.1;
      for(let i=0;i<3;i++){
        const lx=-s*0.5+i*s*0.5, sw=Math.sin(t/140+i*2+p.seed)*1.6;
        ctx.beginPath(); ctx.moveTo(lx,s*0.55); ctx.lineTo(lx+sw,s*1.05); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(lx,-s*0.55); ctx.lineTo(lx+sw,-s*1.05); ctx.stroke();
      }
      // 鞘翅光泽
      ctx.fillStyle="hsla(35,50%,55%,0.18)";
      ctx.beginPath(); ctx.ellipse(-s*0.25,-s*0.2,s*0.4,s*0.18,-0.3,0,Math.PI*2); ctx.fill();
    }else if(kind==="nematode"){
      ctx.strokeStyle=`hsla(${sp.hue},40%,68%,0.9)`;
      ctx.lineWidth=1.4; ctx.lineCap="round";
      ctx.beginPath();
      const L=s*3.2, seg=12;
      for(let i=0;i<=seg;i++){
        const px=-L/2+(i/seg)*L;
        const py=Math.sin(i*0.9 - t/160 + p.seed)*s*0.35*(i/seg*0.6+0.4);
        const ca=Math.cos(dir*0.4), sa=Math.sin(dir*0.4);
        i===0?ctx.moveTo(px*ca-py*sa,px*sa+py*ca):ctx.lineTo(px*ca-py*sa,px*sa+py*ca);
      }
      ctx.stroke();
    }else if(kind==="rotifer"){
      ctx.rotate(dir);
      ctx.fillStyle=`hsla(${sp.hue},40%,62%,0.9)`;
      ctx.beginPath(); ctx.ellipse(0,0,s*0.9,s*0.55,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`hsla(${sp.hue},40%,58%,0.85)`; ctx.lineWidth=1;
      ctx.beginPath(); ctx.moveTo(-s*0.9,0); ctx.lineTo(-s*1.5,Math.sin(t/350+p.seed)*1.5); ctx.stroke();
      ctx.strokeStyle=`hsla(${sp.hue+15},60%,75%,0.9)`;
      for(let k=0;k<8;k++){
        const ca=(k/8)*Math.PI*2 + t/90;
        ctx.beginPath();
        ctx.arc(s*0.85+Math.cos(ca)*1.6, Math.sin(ca)*1.6, 1.4, ca, ca+1.6);
        ctx.stroke();
      }
    }else if(kind==="cyst"){
      const pulse=0.5+0.5*Math.sin(t/1500+p.seed);
      ctx.fillStyle=`hsla(${sp.hue},40%,60%,0.9)`;
      ctx.beginPath(); ctx.arc(0,Math.sin(t/900+p.seed)*1.5,s*0.6,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`hsla(${sp.hue},50%,75%,${0.3+pulse*0.3})`;
      ctx.beginPath(); ctx.arc(0,Math.sin(t/900+p.seed)*1.5,s*0.85,0,Math.PI*2); ctx.stroke();
    }else{
      ctx.rotate(dir*0.5);
      ctx.fillStyle=`hsla(${sp.hue},42%,60%,0.9)`;
      ctx.beginPath(); ctx.ellipse(0,0,s,s*0.6,0,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle=`hsla(${sp.hue},45%,70%,0.55)`; ctx.lineWidth=0.7;
      for(let k=0;k<10;k++){
        const ca=(k/10)*Math.PI*2;
        const flick=Math.sin(t/120+k*1.3)*0.8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ca)*s,Math.sin(ca)*s*0.6);
        ctx.lineTo(Math.cos(ca)*(s+2.4)+flick,Math.sin(ca)*(s*0.6+2.4));
        ctx.stroke();
      }
    }
    ctx.restore();
  },

  pos(p){ return [this.cx + p.x*(this.R*0.92), this.cy + p.y*(this.R*0.92)]; },

  hitTest(cx, cy){
    let best=null, bestD=1e9;
    for(const p of Game.state.patches){
      const [x,y]=this.pos(p);
      const d=Math.hypot(cx-x,cy-y);
      if(d<Math.max(14,p.r*1.4) && d<bestD){ best=p; bestD=d; }
    }
    return best;
  },

  lens(lensCv, mx, my){
    const lctx=lensCv.getContext("2d");
    const src=76;
    lctx.clearRect(0,0,200,200);
    lctx.save();
    lctx.beginPath(); lctx.arc(100,100,99,0,Math.PI*2); lctx.clip();
    lctx.imageSmoothingEnabled=false;
    lctx.drawImage(this.cv, mx-src, my-src, src*2, src*2, 0, 0, 200, 200);
    lctx.strokeStyle="rgba(143,212,138,.35)";
    lctx.beginPath(); lctx.moveTo(100,84); lctx.lineTo(100,116);
    lctx.moveTo(84,100); lctx.lineTo(116,100); lctx.stroke();
    const vg=lctx.createRadialGradient(100,100,60,100,100,100);
    vg.addColorStop(0,"rgba(0,0,0,0)"); vg.addColorStop(1,"rgba(0,0,0,.5)");
    lctx.fillStyle=vg; lctx.fillRect(0,0,200,200);
    lctx.restore();
  },

  particles(t, theme){
    const ctx=this.ctx, col=(theme&&theme.particle)||"#8fd48a";
    const n=26;
    for(let i=0;i<n;i++){
      const ph=i*2.39996 + t*0.00005*(1+(i%5)*0.3);
      const rr=(0.15+0.8*((i*0.618)%1))*(this.R*0.9);
      const x=this.cx+Math.cos(ph+i)*rr, y=this.cy+Math.sin(ph*0.9+i*2)*rr;
      const tw=0.25+0.35*Math.abs(Math.sin(t/2000+i*1.7));
      ctx.fillStyle=col;
      ctx.globalAlpha=tw;
      ctx.fillRect(x,y,1.3,1.3);
    }
    ctx.globalAlpha=1;
  },
};
