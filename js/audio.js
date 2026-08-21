/* 苔藓时间 · WebAudio 环境声 v3.4：真实采样分层 + 生态联动生成式音乐
   雨(湿度) / 风(干燥与寒冷) / 鸟鸣(光照与绿意) / 虫鸣(夜晚) 四层真实环境声
   采样为公有领域/CC0，加载失败（如本地 file:// 打开）自动回退程序合成
   和声垫与铃音仍为程序合成：丰富度逐层加入 / 顶极换亮色系 / 大灭绝后枯寂 */
"use strict";

const AudioSys = {
  ctx:null, master:null, musicBus:null, lp:null,
  rainGain:null, subGain:null, padBus:null,
  sampRainGain:null, windGain:null, birdGain:null, cricketGain:null,
  ambientNodes:[], timers:[], on:false,

  // 生态情绪（由主循环每 2 秒喂入）
  mood:{richness:0, coverage:0, climax:false, humidity:75, light:40},
  desolateUntil:0,

  /* 和声库 */
  CHORDS_CALM:[ // Cmaj9 / Am9 / Fmaj9 / G6
    [130.8,196.0,246.9,329.6,493.9],
    [110.0,164.8,246.9,329.6,493.9],
    [87.3, 174.6,261.6,329.6,440.0],
    [98.0, 196.0,246.9,293.7,329.6],
  ],
  CHORDS_CLIMAX:[ // 顶极：Lydian 亮色系 Cmaj9#11 / Am11 / Fmaj9#11 / G6/9
    [130.8,196.0,246.9,293.7,370.0],
    [110.0,164.8,196.0,246.9,293.7],
    [87.3, 174.6,246.9,329.6,440.0],
    [98.0, 196.0,246.9,293.7,440.0],
  ],
  chordIdx:0,

  init(){
    if(this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if(!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.ctx.destination);
    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = 1.0;
    // 轻柔总线低通：所有声音都"隔着一层水"， cutoff 随光照缓慢开合
    this.lp = this.ctx.createBiquadFilter();
    this.lp.type="lowpass"; this.lp.frequency.value=2400; this.lp.Q.value=0.3;
    this.musicBus.connect(this.lp); this.lp.connect(this.master);
  },

  toggle(){
    this.init();
    if(!this.ctx) return false;
    if(this.ctx.state === "suspended") this.ctx.resume();
    this.on = !this.on;
    const t = this.ctx.currentTime;
    if(this.on){
      this.master.gain.linearRampToValueAtTime(0.55, t + 2.5);
      this.startAmbient();
    }else{
      this.master.gain.linearRampToValueAtTime(0.0, t + 1.2);
      this.timers.forEach(clearTimeout); this.timers=[];
      setTimeout(()=>{ if(!this.on) this.stopAmbient(); }, 1400);
    }
    return this.on;
  },

  /* ---- 生态情绪入口：主循环定期调用 ---- */
  setMood(m){
    Object.assign(this.mood, m);
    if(!this.on || !this.ctx) return;
    const t=this.ctx.currentTime;
    const desolate = performance.now() < this.desolateUntil;

    // 雨声跟随湿度：越湿越清晰（采样就绪后淡出合成雨、淡入真实雨）
    const h=this.mood.humidity/100;
    const rainT=(0.004 + h*0.02) * (desolate?0.5:1);
    const rainSampT=(0.05 + h*0.30) * (desolate?0.5:1);
    const wet=this.sampRainGain?1:0;
    if(this.rainGain) this.rainGain.gain.setTargetAtTime(rainT*(1-wet), t, 2.5);
    if(this.sampRainGain) this.sampRainGain.gain.setTargetAtTime(rainSampT, t, 3);
    // 风：越干燥越起风，天冷时风更硬
    if(this.windGain){
      let wg=(1-h)*0.20;
      if(this.mood.temp<8) wg+=0.08;
      this.windGain.gain.setTargetAtTime(wg, t, 4);
    }
    // 鸟鸣：光照足、有绿意才来；枯寂期鸟儿也沉默
    if(this.birdGain){
      const l=this.mood.light;
      const bg=(l>55 && this.mood.richness>=2 && !desolate) ? (l-55)/45*0.16 : 0;
      this.birdGain.gain.setTargetAtTime(bg, t, 5);
    }
    // 虫鸣：入夜（低光照）且温度适宜；枯寂期虫鸣减半——生命还在，只是很轻
    if(this.cricketGain){
      const l=this.mood.light, tp=this.mood.temp;
      const tempWin=(tp>=12&&tp<=30)?1:0.3;
      const cg=(l<45) ? (45-l)/45*0.16*tempWin*(desolate?0.5:1) : 0;
      this.cricketGain.gain.setTargetAtTime(cg, t, 5);
    }
    // 总线明亮度跟随光照与覆盖度：绿意越盛，声音越开阔
    if(this.lp){
      const cutoff=1400 + this.mood.light/100*1400 + this.mood.coverage*500;
      this.lp.frequency.setTargetAtTime(cutoff, t, 3);
    }
    // 枯寂期：和声垫静默，只留雨与低频
    if(this.padBus){
      this.padBus.gain.setTargetAtTime(desolate?0:1, t, desolate?1.2:8);
    }
  },

  desolate(){ // 大灭绝后调用：约两分半的枯寂
    this.desolateUntil = performance.now()+150000;
  },

  startAmbient(){
    this.stopAmbient();
    const c=this.ctx;

    // 雨声：粉噪 + 低通，增益由 setMood 随湿度驱动
    const len=c.sampleRate*3;
    const buf=c.createBuffer(1,len,c.sampleRate);
    const d=buf.getChannelData(0);
    let last=0;
    for(let i=0;i<len;i++){
      const w=Math.random()*2-1;
      last=(last+0.03*w)/1.03;
      d[i]=last*3.2;
    }
    const noise=c.createBufferSource(); noise.buffer=buf; noise.loop=true;
    const nf=c.createBiquadFilter(); nf.type="lowpass"; nf.frequency.value=700; nf.Q.value=0.2;
    this.rainGain=c.createGain(); this.rainGain.gain.value=0.012;
    const nLfo=c.createOscillator(); nLfo.frequency.value=0.04;
    const nLfoG=c.createGain(); nLfoG.gain.value=0.004;
    nLfo.connect(nLfoG); nLfoG.connect(this.rainGain.gain);
    noise.connect(nf); nf.connect(this.rainGain); this.rainGain.connect(this.musicBus);
    noise.start(); nLfo.start();
    this.ambientNodes.push(noise,nLfo);

    // 极低频垫底（几乎不可闻的安定感，枯寂期也在）
    const sub=c.createOscillator(); sub.type="sine"; sub.frequency.value=65.4;
    this.subGain=c.createGain(); this.subGain.gain.value=0.018;
    sub.connect(this.subGain); this.subGain.connect(this.musicBus); sub.start();
    this.ambientNodes.push(sub);

    // 和声垫总线（枯寂期整体静默）
    this.padBus=c.createGain(); this.padBus.gain.value=1;
    this.padBus.connect(this.musicBus);

    this.chordIdx=0;
    this.scheduleChord();
    this.scheduleDrop();
    this.scheduleBell();
    this.scheduleShimmer();

    this.loadSamples(); // 异步装载真实环境声采样，失败则保持程序合成
  },

  SAMPLE_SRCS:{
    rain:"audio/rain.ogg", wind:"audio/wind.ogg",
    birds:"audio/birds.ogg", crickets:"audio/crickets.ogg"
  },

  loadSamples(){
    if(this.samplesLoading || !this.ctx) return;
    if(location.protocol==="file:") return; // 本地直接打开时跳过采样，维持程序合成
    this.samplesLoading=true;
    for(const key in this.SAMPLE_SRCS){
      fetch(this.SAMPLE_SRCS[key])
        .then(r=>{ if(!r.ok) throw new Error("http "+r.status); return r.arrayBuffer(); })
        .then(ab=>this.ctx.decodeAudioData(ab))
        .then(buf=>{ if(this.on) this.startSampleLayer(key,buf); })
        .catch(()=>{}); // 静默回退：file:// 或网络失败时维持程序合成层
    }
  },

  startSampleLayer(key,buf){
    const c=this.ctx;
    const src=c.createBufferSource(); src.buffer=buf; src.loop=true;
    const g=c.createGain(); g.gain.value=0; // 初始静音，由 setMood 淡入
    src.connect(g); g.connect(this.musicBus);
    src.start();
    this.ambientNodes.push(src);
    if(key==="rain")this.sampRainGain=g;
    if(key==="wind")this.windGain=g;
    if(key==="birds")this.birdGain=g;
    if(key==="crickets")this.cricketGain=g;
  },

  plip(){ // 指尖水珠落水声
    if(!this.on || !this.ctx) return;
    const c=this.ctx, t=c.currentTime;
    const o=c.createOscillator(), g=c.createGain();
    o.type="sine";
    o.frequency.setValueAtTime(740+Math.random()*160, t);
    o.frequency.exponentialRampToValueAtTime(320, t+0.18);
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t+0.4);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+0.45);
  },

  scheduleChord(){
    if(!this.on) return;
    const c=this.ctx, t=c.currentTime+0.05;
    const palette = this.mood.climax ? this.CHORDS_CLIMAX : this.CHORDS_CALM;
    const chord=palette[this.chordIdx % palette.length];
    this.chordIdx++;
    chord.forEach((f,i)=>{
      // 每个音两只微失谐三角波，更厚更柔
      for(const det of [-0.003,0.003]){
        const o=c.createOscillator(); o.type="triangle";
        o.frequency.value=f*(1+det+(Math.random()-0.5)*0.001);
        const g=c.createGain();
        const peak=(0.024 - i*0.0025)*(0.8+this.mood.coverage*0.4);
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(peak,t+4.2);
        g.gain.setValueAtTime(peak,t+7.5);
        g.gain.linearRampToValueAtTime(0,t+13.5);
        o.connect(g); g.connect(this.padBus);
        o.start(t); o.stop(t+13.8);
      }
    });
    this.timers.push(setTimeout(()=>this.scheduleChord(), 8000));
  },

  scheduleDrop(){ // 水滴：湿度越高滴得越勤
    if(!this.on) return;
    const c=this.ctx, t=c.currentTime+0.05;
    const scale=[523.3,587.3,659.3,784.0,880.0,1046.5];
    const f=scale[Math.floor(Math.random()*scale.length)];
    const o=c.createOscillator(); o.type="sine"; o.frequency.value=f;
    const g=c.createGain();
    g.gain.setValueAtTime(0,t);
    g.gain.linearRampToValueAtTime(0.02,t+0.02);
    g.gain.exponentialRampToValueAtTime(0.0004,t+2.2);
    this.pan(o,g);
    o.start(t); o.stop(t+2.4);
    const humMul=1.6-this.mood.humidity/100; // 湿度 100 时约 0.6 倍间隔
    this.timers.push(setTimeout(()=>this.scheduleDrop(), (12000+Math.random()*26000)*humMul));
  },

  scheduleBell(){ // 铃音旋律层：丰富度 ≥3 才出现，越丰富越密
    if(!this.on) return;
    if(this.mood.richness>=3 && performance.now()>=this.desolateUntil){
      const c=this.ctx, t=c.currentTime+0.05;
      const penta=[261.6,293.7,329.6,392.0,440.0,523.3,587.3];
      const f=penta[Math.floor(Math.random()*penta.length)];
      // 基音 + 微弱三度泛音，长衰减
      for(const [mul,vol] of [[1,0.016],[2.76,0.004]]){
        const o=c.createOscillator(); o.type="sine"; o.frequency.value=f*mul;
        const g=c.createGain();
        g.gain.setValueAtTime(0,t);
        g.gain.linearRampToValueAtTime(vol,t+0.4); // 慢起音，像很远处的铃
        g.gain.exponentialRampToValueAtTime(0.0003,t+4.5);
        this.pan(o,g);
        o.start(t); o.stop(t+4.8);
      }
    }
    const base=Math.max(4000, 14000-this.mood.richness*800);
    this.timers.push(setTimeout(()=>this.scheduleBell(), base+Math.random()*base));
  },

  scheduleShimmer(){ // 微光层：丰富度 ≥7 的极轻高音点缀
    if(!this.on) return;
    if(this.mood.richness>=7 && performance.now()>=this.desolateUntil){
      const c=this.ctx, t=c.currentTime+0.05;
      const f=[1568,1760,2093,2349][Math.floor(Math.random()*4)];
      const o=c.createOscillator(); o.type="sine"; o.frequency.value=f;
      const g=c.createGain();
      g.gain.setValueAtTime(0,t);
      g.gain.linearRampToValueAtTime(0.006,t+1.2);
      g.gain.exponentialRampToValueAtTime(0.0002,t+5);
      this.pan(o,g);
      o.start(t); o.stop(t+5.2);
    }
    this.timers.push(setTimeout(()=>this.scheduleShimmer(), 16000+Math.random()*22000));
  },

  pan(o,g){ // 随机立体声定位（不支持则直连）
    if(this.ctx.createStereoPanner){
      const p=this.ctx.createStereoPanner();
      p.pan.value=Math.random()*1.4-0.7;
      o.connect(g); g.connect(p); p.connect(this.musicBus);
    }else{
      o.connect(g); g.connect(this.musicBus);
    }
  },

  stopAmbient(){
    this.ambientNodes.forEach(n=>{ try{n.stop();}catch(e){} });
    this.ambientNodes=[];
    this.timers.forEach(clearTimeout); this.timers=[];
    this.rainGain=null; this.subGain=null; this.padBus=null;
    this.sampRainGain=null; this.windGain=null; this.birdGain=null; this.cricketGain=null;
    this.samplesLoading=false; // 下次开启时重新装载
  },

  blip(freq=660, dur=0.05, vol=0.10, type="sine"){
    if(!this.on || !this.ctx) return;
    const c=this.ctx, t=c.currentTime;
    const o=c.createOscillator(), g=c.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,t);
    g.gain.exponentialRampToValueAtTime(0.001,t+dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t+dur+0.02);
  },

  chime(){ // 涌现：柔和上行三音
    if(!this.on||!this.ctx) return;
    [523,659,880].forEach((f,i)=>{
      setTimeout(()=>this.blip(f,0.5,0.05,"sine"), i*180);
    });
  },

  alarm(){ // 大灭绝：低沉双音
    if(!this.on||!this.ctx) return;
    this.blip(196,0.8,0.08,"sine");
    setTimeout(()=>this.blip(147,1.2,0.08,"sine"),500);
  },
};
