const {chromium}=require('playwright'); const {spawn}=require('child_process'); const path=require('path');
const TL=require('./timeline.js');
(async()=>{
  const [mode,arg,out]=process.argv.slice(2); // preview "t1,t2,.." | video fps out.mp4
  const b=await chromium.launch({args:['--allow-file-access-from-files']});
  const p=await b.newPage({viewport:{width:720,height:1280},deviceScaleFactor:1.5});
  p.on('pageerror',e=>console.error('PAGEERR',e.message));
  await p.goto('file://'+path.resolve('index.html')); await p.evaluate(()=>window.ready);
  if(mode==='preview'){ for(const t of arg.split(',')){await p.evaluate(t=>render(+t),t); await p.screenshot({path:`prev/p_${t}.jpg`,type:'jpeg',quality:85});} }
  else { const fps=+arg, n=Math.round(TL.duration*fps);
    const ff=spawn('ffmpeg',['-y','-v','error','-f','image2pipe','-framerate',String(fps),'-c:v','mjpeg','-i','-','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p',out],{stdio:['pipe','inherit','inherit']});
    for(let i=0;i<n;i++){await p.evaluate(t=>render(t),i/fps); const buf=await p.screenshot({type:'jpeg',quality:93});
      if(!ff.stdin.write(buf)) await new Promise(r=>ff.stdin.once('drain',r)); if(i%150===0) console.log('frame',i,'/',n);}
    ff.stdin.end(); await new Promise(r=>ff.on('close',r)); }
  await b.close();
})();
