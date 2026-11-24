const cdp = process.env.LEAPMORE_CDP_ORIGIN ?? 'http://127.0.0.1:9337';
export const wait = ms => new Promise(r=>setTimeout(r,ms));
export async function browser(url, width=320, height=700) {
 const response=await fetch(cdp + '/json/new?about:blank',{method:'PUT'});
 const target=await response.json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
 const pending=new Map(), events=new Map(), errors=[];
 let num=0;
 ws.onmessage=({data})=>{const msg=JSON.parse(data); if(msg.id){ const [ok,fail]=pending.get(msg.id);pending.delete(msg.id); msg.error?fail(msg.error):ok(msg.result); } else if(msg.method==='Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text); else events.get(msg.method)?.(msg.params);};
 const send=(method,params={})=>new Promise((resolve,reject)=>{pending.set(++num,[resolve,reject]);ws.send(JSON.stringify({id:num,method,params}));});
 const run=async(expression)=>{const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value};
 const navigate=async(url)=>{await send('Page.navigate',{url});await wait(250);};
 const reload=async()=>{
  let timer;
  const loaded=new Promise((resolve,reject)=>{
   events.set('Page.loadEventFired',resolve);
   timer=setTimeout(()=>reject(new Error('页面重载超时')),10000);
  });
  try {await Promise.all([send('Page.reload'),loaded]);}
  finally {clearTimeout(timer);events.delete('Page.loadEventFired');}
 };
 const click=async(selector)=>{await run(`(() => { const node=document.querySelector(${JSON.stringify(selector)}); if (!node) throw Error(${JSON.stringify(selector)}); node.click(); })()`);};
 await send('Page.enable');
 await send('Emulation.setAutoDarkModeOverride',{enabled:false}).catch(()=>{});
 await send('Runtime.enable');
 await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
 await navigate(url);
 return {run, click, send, navigate, reload, errors, on:(method, callback)=>events.set(method, callback), close:async()=>{ws.close(); await fetch(cdp + '/json/close/'+target.id);}};
}
