/* 苔藓时间 · 模拟层：涌现 / 生长 / 竞争 / 共生 / 大灭绝 / 离线演化 */
"use strict";

const Game = {
  state:{
    epoch:1, traits:[], substrate:"basalt",
    unlockedSubs:["basalt","wood","tile"],
    env:{temp:20,humidity:75,light:40,ph:6},
    patches:[], discovered:[], symbiosis:[],
    ach:[],          // 已解锁成就 id
    guideDone:false, // 新手引导是否完成
    boost:0, // 营养滴剂剩余秒数
    emerge:{}, // speciesId -> 累积概率
    hints:[],  // 委托奖励：观测笔记（图鉴线索）
    sporeRain:0, // 孢子雨剩余秒数
  },
};

const Sim = {
  seedCounter: 20240,
  weather:null,  // 事件天气 {hum,light,temp,ph,until}（不存档）
  zones:[],      // 局部作用区 {x,y,r,type,dv,until}（不存档）

  makePatch(sp,x,y,r,health,seed){
    return {sp, x, y, r: r||6, health: health??0.5, seed: seed??(this.seedCounter++), born: performance.now()};
  },

  spOf(id){ return SPECIES.find(s=>s.id===id); },

  // 带性状加成的容忍度
  tolOf(sp){
    const t=[...sp.tol], tr=Game.state.traits;
    if(tr.includes("耐旱")) t[1]*=1.5;
    if(tr.includes("耐寒")) t[0]+=8;
    if(tr.includes("嗜酸")) t[2+1]+=1.5; // pH 是第4维
    return t;
  },

  inRange(sp, env){
    const t=this.tolOf(sp), n=sp.need;
    return Math.abs(env.temp-n[0])<=t[0]
        && Math.abs(env.humidity-n[1])<=t[1]
        && Math.abs(env.light-n[2])<=t[2]
        && Math.abs(env.ph-n[3])<=t[3];
  },

  subMatch(sp){
    return sp.subs==="any" || sp.subs.includes(Game.state.substrate);
  },

  // 距最优的"贴合度" 0..1
  fitness(sp, env){
    const t=this.tolOf(sp), n=sp.need;
    const d=(Math.abs(env.temp-n[0])/t[0]
           + Math.abs(env.humidity-n[1])/t[1]
           + Math.abs(env.light-n[2])/t[2]
           + Math.abs(env.ph-n[3])/t[3])/4;
    return Math.max(0, 1-d);
  },

  randPos(){
    const a=Math.random()*Math.PI*2, r=Math.sqrt(Math.random())*0.85;
    return [Math.cos(a)*r, Math.sin(a)*r];
  },

  hasSpecies(id){ return Game.state.patches.some(p=>p.sp===id); },

  /* ---- 天气与局部区域 ---- */
  effectiveEnv(){
    const e={...Game.state.env};
    const w=this.weather;
    if(w && performance.now()<w.until){
      e.humidity=Math.max(0,Math.min(100,e.humidity+(w.hum||0)));
      e.light=Math.max(0,Math.min(100,e.light+(w.light||0)));
      e.temp=Math.max(0,Math.min(50,e.temp+(w.temp||0)));
      e.ph=Math.max(0,Math.min(14,e.ph+(w.ph||0)));
    }
    return e;
  },

  envAt(x,y,env){ // 某点处的环境（叠加上层天气已含在 env 内，此处叠加局部区域）
    if(!this.zones.length) return env;
    let out=null;
    const now=performance.now();
    for(const z of this.zones){
      if(now>=z.until) continue;
      if(Math.hypot(x-z.x,y-z.y)>z.r) continue;
      out=out||{...env};
      if(z.type==="ph") out.ph=Math.max(0,Math.min(14,out.ph+z.dv));
      if(z.type==="light") out.light=Math.max(0,Math.min(100,out.light+z.dv));
      if(z.type==="humidity") out.humidity=Math.max(0,Math.min(100,out.humidity+z.dv));
    }
    return out||env;
  },

  addZone(type,x,y,dv,secs){
    this.zones.push({x,y,r:0.28,type,dv,until:performance.now()+secs*1000});
  },

  // 指尖水珠：惊动附近的微型动物
  scare(x,y){
    let n=0;
    for(const p of Game.state.patches){
      const sp=this.spOf(p.sp);
      if(!sp||sp.style!=="critter") continue;
      const d=Math.hypot(p.x-x,p.y-y);
      if(d<0.3){
        const ang=Math.atan2(p.y-y,p.x-x);
        p.scared={dx:Math.cos(ang),dy:Math.sin(ang),until:performance.now()+1500};
        n++;
      }
    }
    return n;
  },

  // 引入食腐甲虫：啃食衰老与霉斑，为群落腾地方
  beetle(x,y){
    if(Game.state.patches.length>=40){ UI.toast("视野太满，甲虫无处下脚","bad"); return false; }
    const p=this.makePatch("beetle",x,y,7,1);
    p.dieAt=performance.now()+90000;
    Game.state.patches.push(p);
    UI.toast("食腐甲虫来了：它会啃掉衰老的组织，然后离开");
    AudioSys.blip(392,0.12,0.07);
    return true;
  },

  spawn(id, silent){
    const sp=this.spOf(id); if(!sp) return false;
    const s=Game.state;
    if(s.patches.length>=40) return false;
    const [x,y]=this.randPos();
    s.patches.push(this.makePatch(id,x,y,8+Math.random()*5,0.5));
    const isNew=!s.discovered.includes(id);
    if(isNew) s.discovered.push(id);
    if(!silent){
      UI.toast(isNew ? `新物种涌现：${sp.name}（已录入图鉴）` : `${sp.name} 再次出现`, isNew?"":"warn");
      if(isNew){ AudioSys.chime(); UI.refreshCodex(); }
    }
    UI.refreshDex();
    return true;
  },

  // 每帧模拟（dt 秒）
  tick(dt){
    const s=Game.state, env=this.effectiveEnv();

    // 1. 涌现累积
    for(const sp of SPECIES){
      if(sp.style==="critter"){
        if(sp.summon) continue; // 召唤物种不自然涌现
        // 微型动物：需要连续水膜（湿度>80）与已有生态（丰富度≥2），极少出现，来了也会走
        if(env.humidity>80 && this.richness()>=2 && this.inRange(sp,env) && s.patches.length<40){
          const eggMul=sp.egg?0.25:1;
          s.emerge[sp.id]=(s.emerge[sp.id]||0)+dt*this.fitness(sp,env)*0.004*eggMul;
          if(s.emerge[sp.id]>=1){
            s.emerge[sp.id]=0;
            if(this.spawn(sp.id)){
              const p=s.patches[s.patches.length-1];
              p.dieAt=performance.now()+60000+Math.random()*60000;
            }
          }
        }
        continue;
      }
      if(!this.subMatch(sp)) { s.emerge[sp.id]=0; continue; }
      if(this.inRange(sp,env)){
        const fit=this.fitness(sp,env);
        const tierMul = sp.tier===1?1 : sp.tier===2?0.55 : 0.28;
        const dupMul = this.hasSpecies(sp.id)?0.4:1;
        const sub = SUBSTRATES.find(x=>x.id===s.substrate);
        const nutMul = 0.6 + (sub?sub.nutrient:0.5)*0.8;
        // 地衣固氮：场上有地衣时其它物种涌现 +30%
        const lichMul = s.patches.some(p=>{const q=this.spOf(p.sp);return q&&q.style==="lichen";}) && sp.style!=="lichen" ? 1.3 : 1;
        let rate = dt*fit*tierMul*dupMul*nutMul*lichMul*0.02;
        if(s.sporeRain>0 && !s.discovered.includes(sp.id)) rate*=4; // 孢子雨：新物种更容易落下
        s.emerge[sp.id]=(s.emerge[sp.id]||0) + rate;
        if(s.emerge[sp.id]>=1){
          s.emerge[sp.id]=0;
          this.spawn(sp.id);
        }
      }else{
        s.emerge[sp.id]=Math.max(0,(s.emerge[sp.id]||0)-dt*0.05);
      }
    }

    // 2. 水熊虫彩蛋：随机爬过
    if(!this.hasSpecies("tardigrade") && Math.random()<dt*0.004){
      const [x,y]=this.randPos();
      const p=this.makePatch("tardigrade",x,y,8,1);
      Game.state.patches.push(p);
      if(!s.discovered.includes("tardigrade")){
        s.discovered.push("tardigrade");
        UI.toast("一个八条腿的小东西路过——已录入图鉴","warn");
        AudioSys.chime(); UI.refreshCodex(); UI.refreshDex();
      }
      setTimeout(()=>{
        const i=Game.state.patches.indexOf(p);
        if(i>=0) Game.state.patches.splice(i,1);
      }, 40000);
    }

    // 3. 生长与环境压力
    for(let i=s.patches.length-1;i>=0;i--){
      const p=s.patches[i], sp=this.spOf(p.sp);
      if(!sp){ s.patches.splice(i,1); continue; }
      if(sp.style==="critter"){
        // 微型动物：在水膜里缓慢游走，时间到了自行离开
        if(p.dieAt){
          const nowT=performance.now();
          if(p.scared && nowT<p.scared.until){
            // 被水珠惊动：快速逃离
            p.x+=p.scared.dx*dt*0.5; p.y+=p.scared.dy*dt*0.5;
          }else{
            p.x+=(Math.random()-0.5)*dt*0.05;
            p.y+=(Math.random()-0.5)*dt*0.05;
          }
          if(sp.id==="beetle"){
            // 甲虫：朝最近的霉斑爬，啃食途中衰老的组织
            let target=null, best=1e9;
            for(const q of s.patches){
              const qs=this.spOf(q.sp);
              if(!qs||qs.style==="critter") continue;
              const d=Math.hypot(p.x-q.x,p.y-q.y);
              const score=qs.style==="mold"?d*0.3:d;
              if(score<best){ best=score; target=q; }
            }
            if(target && best>0.06 && !(p.scared&&nowT<p.scared.until)){
              p.x+=Math.sign(target.x-p.x)*dt*0.12;
              p.y+=Math.sign(target.y-p.y)*dt*0.12;
            }
            for(const q of s.patches){
              const qs=this.spOf(q.sp);
              if(!qs||qs.style==="critter"||q===p) continue;
              if(Math.hypot(p.x-q.x,p.y-q.y)<0.09 && q.r>4){
                q.r=Math.max(4,q.r-dt*(qs.style==="mold"?2.0:0.7));
                if(qs.style==="mold") q.health-=dt*0.03; // 霉斑会被啃死
              }
            }
          }
          const d=Math.hypot(p.x,p.y);
          if(d>0.85){ p.x*=0.85/d; p.y*=0.85/d; }
          if(env.humidity<70) p.dieAt=Math.min(p.dieAt,performance.now()+8000); // 水膜干了就匆匆离去
          if(performance.now()>p.dieAt){
            UI.toast(`${sp.name} 游走离开了视野`);
            s.patches.splice(i,1);
          }
        }
        continue;
      }
      const ok=this.inRange(sp,this.envAt(p.x,p.y,env));
      if(ok){
        p.health=Math.min(1,p.health+dt*0.01);
        let grow=dt*0.02;
        if(this.symbiotic(p)) grow*=2;
        if(s.boost>0) grow*=2; // 营养滴剂
        if(p.invader) grow*=3; // 入侵种疯长
        p.r=Math.min(45,p.r+grow);
      }else{
        p.health-=dt*0.008;
      }

      // 入侵种挤压周围本地种
      if(p.invader){
        for(const q of s.patches){
          if(q===p) continue;
          const qs=this.spOf(q.sp);
          if(!qs||qs.style==="critter") continue;
          if(Math.hypot(p.x-q.x,p.y-q.y)<0.3) q.health-=dt*0.005;
        }
        p.health-=dt*0.004; // 辉煌撑不过一个雨季
      }

      // 4. 竞争：菌丝绞杀邻近苔藓
      if(sp.style==="hypha"){
        for(const q of s.patches){
          const qs=this.spOf(q.sp);
          if(qs && qs.style==="moss"){
            const d=Math.hypot(p.x-q.x,p.y-q.y);
            if(d<0.35) q.health-=dt*0.006;
          }
        }
      }
      if(p.health<=0){
        UI.toast(`${sp.name} 枯死了`,"bad");
        s.patches.splice(i,1);
      }
    }

    // 5. 营养滴剂 / 孢子雨倒计时，局部区域清理
    if(s.boost>0) s.boost=Math.max(0,s.boost-dt);
    if(s.sporeRain>0) s.sporeRain=Math.max(0,s.sporeRain-dt);
    const nowZ=performance.now();
    this.zones=this.zones.filter(z=>nowZ<z.until);

    // 6. 共生奇观检测
    for(const key in SYMBIOSIS){
      const [a,b]=key.split("+");
      if(this.hasSpecies(a)&&this.hasSpecies(b)&&!s.symbiosis.includes(key)){
        s.symbiosis.push(key);
        UI.toast(`共生奇观【${SYMBIOSIS[key].name}】形成！相关物种生长翻倍`,"warn");
        AudioSys.chime();
        if(window.AchSys) AchSys.stat("sym");
      }
      if((!this.hasSpecies(a)||!this.hasSpecies(b))&&s.symbiosis.includes(key)){
        s.symbiosis.splice(s.symbiosis.indexOf(key),1);
      }
    }
  },

  symbiotic(p){
    return Game.state.symbiosis.some(k=>k.split("+").includes(p.sp));
  },

  coverage(){
    let a=0;
    for(const p of Game.state.patches) a+=Math.pow(p.r*1.4,2);
    return Math.min(1, a*2/Math.pow(0.9*Render.R,2));
  },

  richness(){
    return new Set(Game.state.patches
      .filter(p=>{ const sp=this.spOf(p.sp); return sp && !sp.summon; })
      .map(p=>p.sp)).size;
  },

  climaxProgress(){
    const c=Math.min(1,this.coverage()/0.45);
    const r=Math.min(1,this.richness()/6);
    return (c+r)/2;
  },

  climaxReady(){
    return this.coverage()>=0.45 && this.richness()>=6;
  },

  /* ---- 手动干预操作 ---- */

  // 接种孢子：手动种下一个已发现物种（可选指定相对坐标 -1..1）
  inoculate(spId, rx, ry){
    const sp=this.spOf(spId);
    if(!sp || !Game.state.discovered.includes(spId)) return false;
    if(Game.state.patches.length>=40){ UI.toast("视野已满，无处可种","bad"); return false; }
    let x,y;
    if(rx!==undefined && ry!==undefined){
      const d=Math.hypot(rx,ry);
      if(d>0.88){ rx*=0.88/d; ry*=0.88/d; }
      x=rx; y=ry;
    }else{
      [x,y]=this.randPos();
    }
    Game.state.patches.push(this.makePatch(spId,x,y,10,0.7));
    UI.toast(`已接种：${sp.name}`);
    AudioSys.blip(587,0.15,0.08);
    return true;
  },

  // 营养滴剂：全体回血 + 60 秒双倍生长
  nutrientDrop(){
    const s=Game.state;
    for(const p of s.patches) p.health=Math.min(1,p.health+0.25);
    s.boost=60;
    UI.toast("营养滴剂已注入：全体恢复，60 秒内生长翻倍","warn");
    AudioSys.blip(740,0.2,0.08);
  },

  // 紫外消毒：清除全部霉斑类与一半菌丝
  uvLamp(){
    const s=Game.state;
    let killed=0, hyphaSeen=0;
    for(let i=s.patches.length-1;i>=0;i--){
      const sp=this.spOf(s.patches[i].sp);
      if(!sp) continue;
      if(sp.style==="mold"){ s.patches.splice(i,1); killed++; }
      else if(sp.style==="hypha" && (++hyphaSeen%2===0)){ s.patches.splice(i,1); killed++; }
    }
    UI.toast(killed?`紫外灯照射完成：清除了 ${killed} 个霉斑/菌丝斑块`:"没有可清除的目标",killed?"bad":"");
    AudioSys.alarm();
    return killed;
  },

  // 喷淋灌溉：湿度目标 +15（缓动生效）
  spray(){
    UI.targetEnv.humidity=Math.min(100,UI.targetEnv.humidity+15);
    const v=UI.targetEnv.humidity;
    UI.el("sl-humidity").value=v;
    UI.el("val-humidity").textContent=v.toFixed(0)+"%";
    UI.toast("喷淋完成：湿度上升 15%");
    AudioSys.blip(880,0.12,0.06);
  },

  // 大灭绝
  extinct(extId){
    const ext=EXTINCTIONS.find(e=>e.id===extId); if(!ext) return;
    const s=Game.state;
    let killed=0;
    for(let i=s.patches.length-1;i>=0;i--){
      const sp=this.spOf(s.patches[i].sp);
      if(sp && sp.style!=="critter" && ext.kill(sp)){ s.patches.splice(i,1); killed++; }
    }
    if(!s.traits.includes(ext.trait)) s.traits.push(ext.trait);
    s.epoch=Math.min(5,s.epoch+1);
    // 解锁新基质
    for(const sub of SUBSTRATES){
      if(sub.unlock<=s.epoch && !s.unlockedSubs.includes(sub.id)) s.unlockedSubs.push(sub.id);
    }
    s.emerge={};
    AudioSys.alarm();
    AudioSys.desolate(); // 大灭绝后音乐进入枯寂期
    if(window.AchSys) AchSys.stat("extinct");
    UI.toast(`${ext.name}降临，${killed} 个斑块灭绝。获得性状【${ext.trait}】`,"bad");
    UI.refreshAll();
    SaveSys.save();
  },

  // 离线演化
  offline(ms){
    const s=Game.state, report=[];
    const hours=ms/3600000;
    if(hours<0.05) return report;

    // 基础生长/衰减
    for(const p of s.patches){
      p.r=Math.min(30,p.r*(1+Math.min(2,hours)*0.05));
    }
    if(s.patches.length) report.push({type:"",text:`你离开了 ${hours>=1?hours.toFixed(1)+" 小时":Math.round(hours*60)+" 分钟"}。视野里的生命没有等你。`});

    // 事件 1：意外入侵种
    if(Math.random()<Math.min(0.9,hours*0.25)){
      const candidates=SPECIES.filter(sp=>sp.style!=="critter"&&this.subMatch(sp)&&!this.hasSpecies(sp.id));
      if(candidates.length){
        const inv=candidates[Math.floor(Math.random()*candidates.length)];
        if(this.spawn(inv.id,true)){
          const isNew=!Game.state.discovered.includes(inv.id);
          report.push({type:"good",text:`意外入侵种：${inv.name}趁你不在时占据了视野的一角${Game.state.discovered.includes(inv.id)?"（新物种，已录入图鉴）":""}。`});
          if(!Game.state.discovered.includes(inv.id)) Game.state.discovered.push(inv.id);
        }
      }
    }
    // 事件 2：共生奇观
    if(Math.random()<Math.min(0.6,hours*0.15)){
      for(const key in SYMBIOSIS){
        const [a,b]=key.split("+");
        if(this.hasSpecies(a)&&this.hasSpecies(b)&&!s.symbiosis.includes(key)){
          s.symbiosis.push(key);
          report.push({type:"good",text:`共生奇观【${SYMBIOSIS[key].name}】在你离开期间形成：${SYMBIOSIS[key].desc}`});
        }
      }
    }
    // 事件 3：局部灭绝
    if(Math.random()<Math.min(0.7,hours*0.2) && s.patches.length>2){
      const n=Math.max(1,Math.floor(s.patches.length*0.3));
      const names=[];
      for(let i=0;i<n;i++){
        const idx=Math.floor(Math.random()*s.patches.length);
        const sp=this.spOf(s.patches[idx].sp);
        if(sp) names.push(sp.name);
        s.patches.splice(idx,1);
      }
      report.push({type:"bad",text:`局部灭绝：视野边缘出现一块空白斑块——${[...new Set(names)].join("、")}没能撑过去。`});
    }
    return report;
  },
};
