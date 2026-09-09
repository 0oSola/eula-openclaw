"use client";
import {useEffect,useState} from "react";
import {V14D_GAME_DEFAULT_SETTINGS,normalizeV14dGameSettings,v14dGameSettingsStorageKey} from "./v14dGameAppearanceAssets.js";

const ranges=[
  ["exposure","曝光",-2,1,0.05],
  ["fabricDetail","织纹对比",0,2,0.05],
  ["legStructure","纵向细线",0,2,0.05],
  ["iris","虹膜参考光感",0,2,0.05],
  ["hairMaskStrength","头发分区上色",0,1,0.05],
] as const;

export function V14dGameControls({runtime,userId,modelPath,floating=false}:{runtime:any;userId:string;modelPath:string;floating?:boolean}){
  const [values,setValues]=useState<any>({...V14D_GAME_DEFAULT_SETTINGS});
  const [message,setMessage]=useState("");
  const [expanded,setExpanded]=useState(false);
  const storageKey=v14dGameSettingsStorageKey(userId,modelPath);
  useEffect(()=>{
    if(!runtime||runtime.destroyed)return;
    let next={...V14D_GAME_DEFAULT_SETTINGS};
    try{const saved=userId?localStorage.getItem(storageKey):null;if(saved)next=normalizeV14dGameSettings(JSON.parse(saved));setMessage("");}
    catch{setMessage("保存的参数无效，已恢复截图默认值。");}
    runtime.appearanceAdapter.setSettings(next);setValues(next);
  },[runtime,storageKey,userId]);
  function change(patch:Record<string,unknown>){
    if(!runtime||runtime.destroyed)return;
    try{const next=runtime.appearanceAdapter.setSettings(patch);setValues(next);if(userId)localStorage.setItem(storageKey,JSON.stringify(next));setMessage(userId?"已保存在本机，按用户和模型隔离。":"未登录，不保存参数。");}
    catch(error){setMessage(error instanceof Error?error.message:String(error));}
  }
  return <details data-testid="v14d-game-controls" data-pet-interactive={floating || undefined} onToggle={event=>setExpanded(event.currentTarget.open)} style={{position:floating?"fixed":"absolute",left:floating?12:undefined,right:floating?undefined:12,top:12,zIndex:12,width:floating&&!expanded?"auto":260,maxWidth:"calc(100% - 24px)",maxHeight:"70%",overflow:"auto",background:"rgba(12,20,36,.94)",color:"#dbeafe",border:"1px solid #54718d",borderRadius:10,padding:12,fontSize:13,pointerEvents:"auto"}} onPointerDown={event=>event.stopPropagation()}>
    <summary style={{cursor:"pointer"}}>{floating?"外观微调":"游戏参考 · 外观微调"}</summary>
    <fieldset disabled={!runtime} style={{border:0,padding:0,marginTop:10,display:"grid",gap:10}}>
      <label>显示变换<select aria-label="V14D显示变换" value={values.display} onChange={e=>change({display:e.target.value})} style={{width:"100%"}}><option value="game/ocio">本机 Blender OCIO</option><option value="game/builtin">内置 AgX（对照）</option></select></label>
      {ranges.map(([key,label,min,max,step])=><label key={key}>{label} <output>{Number(values[key]).toFixed(2)}</output><input aria-label={"V14D"+label} type="range" min={min} max={max} step={step} value={values[key]} onChange={e=>change({[key]:Number(e.target.value)})} style={{width:"100%"}}/></label>)}
      <label>眼部<select aria-label="V14D眼部" value={values.closedEye} onChange={e=>change({closedEye:e.target.value})} style={{width:"100%"}}><option value="reference">目标闭眼</option><option value="open">睁眼</option><option value="motion">跟随动作</option></select></label>
      <label>表情<select aria-label="V14D表情" value={values.smile===null?"motion":"smile"} onChange={e=>change({smile:e.target.value==="smile"?.55:null})} style={{width:"100%"}}><option value="smile">微笑（说话时跟随口型）</option><option value="motion">跟随动作</option></select></label>
      <label><input type="checkbox" checked={values.autoFace} onChange={e=>change({autoFace:e.target.checked})}/> 自动脸部阴影</label>
      <label>手动遮罩<select aria-label="V14D手动遮罩" disabled={values.autoFace} value={values.manualMask} onChange={e=>change({manualMask:Number(e.target.value)})}>{[0,1,2,3,4].map(i=><option key={i} value={i}>状态{i}</option>)}</select></label>
      <label><input type="checkbox" checked={values.lightingEnabled} onChange={e=>change({lightingEnabled:e.target.checked})}/> 启用六灯</label>
      <label><input type="checkbox" checked={values.hairMaskView} onChange={e=>change({hairMaskView:e.target.checked})}/> 头发遮罩诊断</label>
      <button type="button" onClick={()=>change({...V14D_GAME_DEFAULT_SETTINGS})}>恢复截图默认值</button>
      <small role="status">{message||"仅本机资源；不是游戏着色器等价证书。"}</small>
    </fieldset>
  </details>;
}
