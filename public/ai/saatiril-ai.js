/**
 * SAATIRIL AI — Offline Pose Detection Module
 * 
 * Detects two key graduation ceremony moments:
 *   1. TOGA TRANSFER: Dean transfers graduation cap to student's head
 *   2. IJAZAH POSE: Student and dean pose together holding the diploma
 * 
 * Uses TensorFlow.js + MoveNet MultiPose Lightning model.
 * Loaded via <script> tag to bypass Next.js/Turbopack bundler issues.
 * 
 * Dependencies (loaded before this script):
 *   - /ai/tf.min.js         (TensorFlow.js UMD → window.tf)
 *   - /ai/pose-detection.min.js  (Pose Detection UMD → window.poseDetection)
 * 
 * Exposes: window.SaatirilAI
 */

(function () {
  'use strict';

  const CONFIG = {
    sensitivity: 0.5,
    minKeypointConfidence: 0.25,
    minPersonConfidence: 0.3,
    detectionInterval: 300,
    detectionCooldown: 3000,
    sustainDuration: 800,
    detectionWidth: 320,
    detectionHeight: 240,
    modelName: 'MoveNet MultiPose Lightning',
  };

  // MoveNet keypoint indices
  const KP = {
    nose:0,leftEye:1,rightEye:2,leftEar:3,rightEar:4,
    leftShoulder:5,rightShoulder:6,leftElbow:7,rightElbow:8,
    leftWrist:9,rightWrist:10,leftHip:11,rightHip:12,
    leftKnee:13,rightKnee:14,leftAnkle:15,rightAnkle:16,
  };

  let detector=null,isRunning=false,isModelLoaded=false,isModelLoading=false;
  let animationFrameId=null,lastDetectionTime=0,lastTogaTime=0,lastIjazahTime=0;
  let togaSustainStart=0,ijazahSustainStart=0;
  let videoElement=null,detectionCanvas=null,detectionCtx=null;
  let onMomentDetected=null,onStatusChange=null;
  let currentPoses=[],currentMomentState='idle';

  function log(...a){console.log('[SAATIRIL AI]',...a)}
  function warn(...a){console.warn('[SAATIRIL AI]',...a)}
  function dist(p1,p2){if(!p1||!p2)return Infinity;const dx=p1.x-p2.x,dy=p1.y-p2.y;return Math.sqrt(dx*dx+dy*dy)}
  function mid(p1,p2){if(!p1||!p2)return null;return{x:(p1.x+p2.x)/2,y:(p1.y+p2.y)/2}}
  function kp(pose,i){if(!pose||!pose.keypoints)return null;const k=pose.keypoints[i];return(!k||k.score<CONFIG.minKeypointConfidence)?null:k}

  async function loadModel(){
    if(isModelLoaded)return true;if(isModelLoading)return false;
    isModelLoading=true;emitStatus('loading_model');
    try{
      if(typeof tf==='undefined')throw new Error('TensorFlow.js not loaded');
      if(typeof poseDetection==='undefined')throw new Error('Pose Detection not loaded');
      log('Initializing TF.js backend...');await tf.ready();log('TF.js backend:',tf.getBackend());
      log('Loading MoveNet MultiPose Lightning...');
      detector=await poseDetection.createDetector(poseDetection.SupportedModels.MoveNet,{
        modelType:poseDetection.movenet.modelType.MULTIPOSE_LIGHTNING,
        enableTracking:true,trackerType:poseDetection.TrackerType.BoundingBox,
      });
      isModelLoaded=true;isModelLoading=false;log('Model loaded!');emitStatus('model_ready');return true;
    }catch(e){isModelLoading=false;warn('Model load failed:',e.message);emitStatus('error',e.message);return false}
  }

  function initCanvas(){
    if(!detectionCanvas){detectionCanvas=document.createElement('canvas');detectionCanvas.width=CONFIG.detectionWidth;detectionCanvas.height=CONFIG.detectionHeight;detectionCtx=detectionCanvas.getContext('2d')}
  }

  async function detectFrame(){
    if(!detector||!videoElement||!isRunning)return;
    const now=Date.now();
    if(now-lastDetectionTime<CONFIG.detectionInterval){animationFrameId=requestAnimationFrame(detectFrame);return}
    lastDetectionTime=now;
    try{
      initCanvas();detectionCtx.drawImage(videoElement,0,0,CONFIG.detectionWidth,CONFIG.detectionHeight);
      const poses=await detector.estimatePoses(detectionCanvas);currentPoses=poses||[];
      if(currentPoses.length>=1)analyzePoses(currentPoses,now);
      else{if(currentMomentState!=='idle'){currentMomentState='idle';emitStatus('detecting')}togaSustainStart=0;ijazahSustainStart=0}
    }catch(e){warn('Detection error:',e.message)}
    if(isRunning)animationFrameId=requestAnimationFrame(detectFrame);
  }

  function analyzePoses(poses,now){
    const valid=poses.filter(p=>{if(!p.keypoints)return false;return p.keypoints.filter(k=>k.score>=CONFIG.minKeypointConfidence).length>=5});
    if(valid.length<1){currentMomentState='idle';emitStatus('detecting');return}
    const toga=detectToga(valid,now);
    const ijazah=detectIjazah(valid,now);
    if(toga==='sustained')currentMomentState='toga_sustained';
    else if(toga==='possible')currentMomentState='toga_possible';
    else if(ijazah==='sustained')currentMomentState='ijazah_sustained';
    else if(ijazah==='possible')currentMomentState='ijazah_possible';
    else{currentMomentState='idle';emitStatus('detecting')}
  }

  function detectToga(poses,now){
    if(now-lastTogaTime<CONFIG.detectionCooldown)return'none';
    for(let i=0;i<poses.length;i++){
      const p=poses[i];
      const nose=kp(p,KP.nose),lSh=kp(p,KP.leftShoulder),rSh=kp(p,KP.rightShoulder);
      const lW=kp(p,KP.leftWrist),rW=kp(p,KP.rightWrist),lE=kp(p,KP.leftElbow),rE=kp(p,KP.rightElbow);
      if(!nose||(!lSh&&!rSh))continue;
      const shY=lSh?lSh.y:rSh.y;
      const lUp=lW&&lW.y<shY-0.05,rUp=rW&&rW.y<shY-0.05;
      if(!lUp&&!rUp)continue;
      const wrist=lUp?lW:rW,elbow=lUp?lE:rE;
      const aboveNose=wrist.y<nose.y+0.05;
      let found=false;
      if(poses.length>=2){
        for(let j=0;j<poses.length;j++){
          if(i===j)continue;const oNose=kp(poses[j],KP.nose);
          if(!oNose)continue;if(dist(wrist,oNose)<0.15*(1.5-CONFIG.sensitivity*0.5)){found=true;break}
        }
      }
      if(!found&&aboveNose&&elbow&&elbow.y<shY&&CONFIG.sensitivity>=0.6)found=true;
      if(found){
        if(togaSustainStart===0){togaSustainStart=now;return'possible'}
        const dur=now-togaSustainStart,req=CONFIG.sustainDuration*(1.5-CONFIG.sensitivity);
        if(dur>=req){lastTogaTime=now;togaSustainStart=0;log('TOGA DETECTED!',dur,'ms');
          if(onMomentDetected)onMomentDetected('toga',{timestamp:now,confidence:Math.min(1,dur/req),poses:currentPoses.length});return'sustained'}
        return'possible'
      }
    }
    togaSustainStart=0;return'none'
  }

  function detectIjazah(poses,now){
    if(now-lastIjazahTime<CONFIG.detectionCooldown)return'none';
    if(poses.length<2){ijazahSustainStart=0;return'none'}
    for(let i=0;i<poses.length;i++){
      for(let j=i+1;j<poses.length;j++){
        const a=poses[i],b=poses[j];
        const nA=kp(a,KP.nose),nB=kp(b,KP.nose);
        const lsA=kp(a,KP.leftShoulder),rsA=kp(a,KP.rightShoulder);
        const lsB=kp(b,KP.leftShoulder),rsB=kp(b,KP.rightShoulder);
        const lwA=kp(a,KP.leftWrist),rwA=kp(a,KP.rightWrist);
        const lwB=kp(b,KP.leftWrist),rwB=kp(b,KP.rightWrist);
        const lhA=kp(a,KP.leftHip),rhA=kp(a,KP.rightHip);
        const lhB=kp(b,KP.leftHip),rhB=kp(b,KP.rightHip);
        if(!nA||!nB)continue;if(!lsA&&!rsA)continue;if(!lsB&&!rsB)continue;
        const sA=mid(lsA,rsA)||lsA||rsA,sB=mid(lsB,rsB)||lsB||rsB;
        const pd=dist(sA,sB),maxD=0.3+CONFIG.sensitivity*0.3;
        if(pd>maxD||pd<0.05)continue;
        const sYA=sA.y,sYB=sB.y;
        const hYA=lhA?lhA.y:(rhA?rhA.y:sYA+0.35),hYB=lhB?lhB.y:(rhB?rhB.y:sYB+0.35);
        const wAF=wristFront(lwA,rwA,sYA,hYA),wBF=wristFront(lwB,rwB,sYB,hYB);
        if(!wAF||!wBF)continue;
        const wAC=mid(lwA,rwA)||lwA||rwA,wBC=mid(lwB,rwB)||lwB||rwB;
        if(!wAC||!wBC)continue;if(dist(wAC,wBC)>0.15+CONFIG.sensitivity*0.15)continue;
        if(ijazahSustainStart===0){ijazahSustainStart=now;return'possible'}
        const dur=now-ijazahSustainStart,req=CONFIG.sustainDuration*(1.5-CONFIG.sensitivity);
        if(dur>=req){lastIjazahTime=now;ijazahSustainStart=0;log('IJAZAH DETECTED!',dur,'ms');
          if(onMomentDetected)onMomentDetected('ijazah',{timestamp:now,confidence:Math.min(1,dur/req),poses:currentPoses.length});return'sustained'}
        return'possible'
      }
    }
    ijazahSustainStart=0;return'none'
  }

  function wristFront(lw,rw,shY,hipY){
    const tH=hipY-shY,minY=shY-tH*0.1,maxY=hipY+tH*0.1;
    return(lw&&lw.y>=minY&&lw.y<=maxY)||(rw&&rw.y>=minY&&rw.y<=maxY)
  }

  function emitStatus(status,detail){
    if(onStatusChange)onStatusChange({status,detail:detail||'',isModelLoaded,isRunning,momentState:currentMomentState,posesDetected:currentPoses.length,timestamp:Date.now()});
    if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('saatiril-ai-status',{detail:{status,detail:detail||'',isModelLoaded,isRunning,momentState:currentMomentState,posesDetected:currentPoses.length,timestamp:Date.now()}}));
  }

  async function startDetection(video,cb){
    if(isRunning){log('Already running');return}
    videoElement=video;
    if(cb){onMomentDetected=cb.onMomentDetected||null;onStatusChange=cb.onStatusChange||null}
    if(!isModelLoaded){const ok=await loadModel();if(!ok){emitStatus('error','Model failed');return}}
    isRunning=true;lastDetectionTime=0;lastTogaTime=0;lastIjazahTime=0;togaSustainStart=0;ijazahSustainStart=0;currentMomentState='idle';
    log('Detection started');emitStatus('detecting');animationFrameId=requestAnimationFrame(detectFrame);
  }

  function stopDetection(){
    isRunning=false;if(animationFrameId){cancelAnimationFrame(animationFrameId);animationFrameId=null}
    currentPoses=[];currentMomentState='idle';togaSustainStart=0;ijazahSustainStart=0;log('Detection stopped');emitStatus('stopped');
  }

  function updateConfig(c){
    if(c.sensitivity!==undefined)CONFIG.sensitivity=Math.max(0,Math.min(1,c.sensitivity));
    if(c.detectionInterval!==undefined)CONFIG.detectionInterval=Math.max(100,c.detectionInterval);
    if(c.detectionCooldown!==undefined)CONFIG.detectionCooldown=Math.max(1000,c.detectionCooldown);
    if(c.sustainDuration!==undefined)CONFIG.sustainDuration=Math.max(200,c.sustainDuration);
  }

  async function dispose(){stopDetection();if(detector){try{detector.dispose()}catch(e){}detector=null}isModelLoaded=false;log('AI disposed')}

  window.SaatirilAI={
    start:startDetection,stop:stopDetection,dispose,loadModel,
    getCurrentPoses:()=>currentPoses,getMomentState:()=>currentMomentState,
    updateConfig,getConfig:()=>({...CONFIG}),
    get isRunning(){return isRunning},get isModelLoaded(){return isModelLoaded},get isModelLoading(){return isModelLoading},
    version:'1.0.0',
  };
  log('SaatirilAI module loaded (v1.0.0)');
})();
