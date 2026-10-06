(function(){const e=document.createElement("link").relList;if(e&&e.supports&&e.supports("modulepreload"))return;for(const s of document.querySelectorAll('link[rel="modulepreload"]'))r(s);new MutationObserver(s=>{for(const o of s)if(o.type==="childList")for(const l of o.addedNodes)l.tagName==="LINK"&&l.rel==="modulepreload"&&r(l)}).observe(document,{childList:!0,subtree:!0});function n(s){const o={};return s.integrity&&(o.integrity=s.integrity),s.referrerPolicy&&(o.referrerPolicy=s.referrerPolicy),s.crossOrigin==="use-credentials"?o.credentials="include":s.crossOrigin==="anonymous"?o.credentials="omit":o.credentials="same-origin",o}function r(s){if(s.ep)return;s.ep=!0;const o=n(s);fetch(s.href,o)}})();const z=["小生命","小攻击","小防御","大生命","大防御","大攻击","暴击","暴伤","充能","精通"],Z=["火伤","雷伤","岩伤","风伤","水伤","冰伤","草伤","物伤","治疗","爆伤"],tt=[...z,...Z],et={暴击:[2.7,3.1,3.5,3.9],暴伤:[5.4,6.2,7,7.8],大攻击:[4.1,4.7,5.3,5.8],小攻击:[14,16,18,19],精通:[16,19,21,23],充能:[4.5,5.2,5.8,6.5],大生命:[4.1,4.7,5.3,5.8],小生命:[209,239,269,299],大防御:[5.1,5.8,6.6,7.3],小防御:[16,19,21,23]},nt=5,ot=1e3;function st(t){return Math.round(t*ot)}const U=new Map;function rt(t,e){const n=`${t}|${e}`,r=U.get(n);if(r)return r;const s=et[t].map(d=>st(d)*e),o=[[0,1]];let l=new Map([[0,1]]);for(let d=1;d<=nt+2;d++){const b=new Map;for(const[g,h]of l)for(const L of s)b.set(g+L,(b.get(g+L)??0)+h);l=b;const p=new Array(b.size*2);let y=0;for(const[g,h]of b)p[y++]=g,p[y++]=h;o.push(p)}return U.set(n,o),o}const it=[[4,0,0,0,1],[3,1,0,0,4],[2,2,0,0,6],[2,1,1,0,12],[1,1,1,1,24]],at=[[5,0,0,0,1],[4,1,0,0,5],[3,2,0,0,10],[3,1,1,0,20],[2,2,1,0,30],[2,1,1,1,60]];function K(t){const e=t===3?it:at,n=new Map;for(const[r,s,o,l,d]of e)for(const b of ct([r,s,o,l]))n.set(b.map(p=>p+1).join(","),d);return n}function ct(t){const e=[],n=[],r=new Array(4).fill(!1),s=()=>{if(n.length===4){e.push([...n]);return}for(let o=0;o<4;o++)r[o]||o>0&&!r[o-1]&&t[o]===t[o-1]||(r[o]=!0,n.push(t[o]),s(),n.pop(),r[o]=!1)};return s(),e}function lt(t){const e=K(t);let n=0;for(const o of e.values())n+=o;const s=e.keys().next().value.split(",").reduce((o,l)=>o+Number(l),0);return n*4**s}function ut(t){const e=Math.floor(t/100);return t-e*100>=50?e+1:e}function dt(t){const{slots:e,initialVisible:n}=t;if(e.length!==4)throw new Error("slots 必须恰好 4 个：3 词条胚子的第 4 个位置传 weight = 0");const r=e.filter(h=>h.weight>0).length,o=n+1+1,l=e.map(h=>rt(h.attr,h.weight)),d=new Map;for(const[h,L]of K(n)){const E=h.split(",").map(Number);let M=0;for(let i=0;i<4;i++)e[i].weight>0&&(M+=E[i]);const A=M-r;if(A<0||A>=o)continue;let $=[0],u=[1];for(let i=0;i<4;i++){const c=l[i][E[i]],x=c.length/2,m=new Array($.length*x),C=new Array($.length*x);let v=0;for(let N=0;N<$.length;N++){const P=$[N],_=u[N];for(let O=0;O<x;O++)m[v]=P+c[O*2],C[v]=_*c[O*2+1],v++}$=m,u=C}for(let i=0;i<$.length;i++){const c=ut($[i]);let x=d.get(c);x||(x=new Map,d.set(c,x)),x.set(A,(x.get(A)??0)+u[i]*L)}}const b=[...d.keys()].sort((h,L)=>h-L),p=b.map(h=>{const L=d.get(h),E=new Array(o).fill(0);for(const[M,A]of L)E[M]=A;return E}),y=lt(n);let g=0;for(const h of p)for(const L of h)g+=L;if(g!==y)throw new Error(`权重之和 ${g} 不等于归一化常数 ${y}`);return{total:y,scores:b.map(h=>h/10),hits:p,scoredSlots:r,hitBuckets:o}}function Q(t){return t.hits.map(e=>e.reduce((n,r)=>n+r,0)/t.total)}function ht(t){const e=Q(t),n=new Array(e.length);let r=0;for(let s=e.length-1;s>=0;s--)r+=e[s],n[s]=r;return n}function ft(t){return Array.from({length:t.hitBuckets},(e,n)=>t.hits.map(r=>r[n]/t.total))}function pt(t){const e=[];for(let n=0;n<t.hitBuckets;n++){let r=0;for(const s of t.hits)r+=s[n];r>0&&e.push({hits:n,p:r/t.total})}return e}function D(t,e,n=!0){const r=Q(t);let s=0;for(let o=0;o<t.scores.length;o++){const l=t.scores[o];(n?l>=e:l>e)&&(s+=r[o])}return s}function gt(t,e){const n=ht(t);for(let r=0;r<n.length;r++)if(n[r]<=e)return t.scores[r]}function mt(t,e){const n=D(t,e);return n>0?1/n:void 0}function F(t,e){return t===0?"0%":t>=.01?`${(t*100).toFixed(e??2)}%`:t>=1e-4?`${(t*100).toFixed(4)}%`:`${(t*100).toExponential(2)}%`}function j(t){return!Number.isFinite(t)||t<=0?"—":t<1.05?"必然":t<10?`约 ${t.toFixed(1)} 次`:t<1e4?`约 ${Math.round(t).toLocaleString("zh-CN")} 次`:t<1e8?`约 ${(t/1e4).toFixed(1)} 万次`:`约 ${(t/1e8).toFixed(1)} 亿次`}function R(t){return t.toFixed(1)}function bt(t){return String(Number(t.toFixed(3)))}const wt="http://www.w3.org/2000/svg",B=["#334155","#3b82f6","#22d3ee","#34d399","#fbbf24","#f472b6"],I="#f87171";function S(t,e={}){const n=document.createElementNS(wt,t);for(const[r,s]of Object.entries(e))n.setAttribute(r,String(s));return n}function yt(t){const{data:e,hitLabels:n,width:r=1200,height:s=460,showLabels:o=!0,title:l=""}=t,d={top:l?42:20,right:64,bottom:78,left:62},b=r-d.left-d.right,p=s-d.top-d.bottom,y=S("svg",{viewBox:`0 0 ${r} ${s}`,class:"chart",preserveAspectRatio:"xMidYMid meet",role:"img","aria-label":l||"得分分布"});if(l){const a=S("text",{x:r/2,y:22,"text-anchor":"middle",class:"chart-title"});a.textContent=l,y.append(a)}const g=S("g",{transform:`translate(${d.left},${d.top})`});if(y.append(g),e.length===0)return y;const h=e.map(a=>a.byHit.reduce((f,w)=>f+w,0)),L=Math.max(...h)*1.15||1,E=b/e.length,M=Math.min(E*.72,26),A=a=>a*E+E/2,$=a=>p-a/L*p,u=5;for(let a=0;a<=u;a++){const f=L/u*a,w=$(f);g.append(S("line",{x1:0,x2:b,y1:w,y2:w,class:"grid"}));const T=S("text",{x:-8,y:w+4,"text-anchor":"end",class:"axis-label"});T.textContent=F(f,1),g.append(T)}e.forEach((a,f)=>{let w=0;a.byHit.forEach((T,H)=>{if(T<=0)return;const k=$(w+T),J=$(w)-k,q=S("rect",{x:A(f)-M/2,y:k,width:M,height:Math.max(J,.4),fill:B[H%B.length],class:"bar-seg","data-hit":H}),W=S("title");W.textContent=`${R(a.score)} 分 · ${n[H]??`命中 ${H} 次`}：${F(T)}`,q.append(W),g.append(q),w+=T})}),o&&E>=26&&e.forEach((a,f)=>{const w=a.byHit.reduce((H,k)=>H+k,0);if(w<L*.06)return;const T=S("text",{x:A(f),y:$(w)-4,"text-anchor":"middle",class:"bar-label"});T.textContent=F(w,1),g.append(T)});const i=Math.max(1,Math.ceil(e.length/14));e.forEach((a,f)=>{if(f%i!==0&&f!==e.length-1)return;const w=S("text",{x:A(f),y:p+18,"text-anchor":"end",class:"axis-label",transform:`rotate(-45 ${A(f)} ${p+18})`});w.textContent=R(a.score),g.append(w)});const c=S("text",{x:b/2,y:p+60,"text-anchor":"middle",class:"axis-title"});c.textContent="胚子得分",g.append(c);const x=new Array(e.length).fill(0);let m=0;for(let a=e.length-1;a>=0;a--)m+=h[a],x[a]=m;const C=e.map((a,f)=>`${f===0?"M":"L"}${A(f).toFixed(2)},${$(x[f]).toFixed(2)}`).join(" ");g.append(S("path",{d:C,fill:"none",stroke:I,"stroke-width":2,class:"cdf"})),e.forEach((a,f)=>{const w=S("circle",{cx:A(f),cy:$(x[f]),r:e.length>120?1.2:2.6,fill:I}),T=S("title");T.textContent=`≥ ${R(a.score)} 分：${F(x[f])}`,w.append(T),g.append(w)});const v=b+8;for(let a=0;a<=5;a++){const f=a/5,w=S("text",{x:v,y:$(0)-p*f+4,class:"axis-label cdf-label"});w.textContent=`${Math.round(f*100)}%`,g.append(w)}const N=a=>p-a/1.15*p,P=S("line",{x1:v-3,x2:v-3,y1:N(0),y2:N(1),stroke:I,"stroke-width":1,opacity:.5});g.append(P);const _=S("g",{transform:`translate(0,${p+26})`}),O=[...n.map((a,f)=>({label:a,color:B[f%B.length]})),{label:"累积概率（≥ 该分数）",color:I}];let V=0;for(const a of O){_.append(S("rect",{x:V,y:0,width:10,height:10,rx:2,fill:a.color}));const f=S("text",{x:V+14,y:9,class:"legend-label"});f.textContent=a.label,_.append(f),V+=14+a.label.length*11+16}return g.append(_),y}const G=[{label:"1（主）",value:1},{label:"0.5",value:.5},{label:"0.1",value:.1},{label:"0（不计分）",value:0}];function Y(){return{mainAttr:"暴击",slots:[{attr:"暴伤",weight:1},{attr:"大攻击",weight:.5},{attr:"",weight:0},{attr:"",weight:0}],initialVisible:4,targetScore:30,showLabels:!0}}function xt(t){const e=new URLSearchParams;return e.set("main",t.mainAttr),e.set("iv",String(t.initialVisible)),e.set("target",String(t.targetScore)),e.set("slots",t.slots.map(n=>`${n.attr}:${n.weight}`).join(",")),e.toString()}function vt(t){const e=Y();try{const n=new URLSearchParams(t),r=n.get("main"),s=Number(n.get("iv")),o=Number(n.get("target")),l=n.get("slots");if(!r||!l)return e;const d=l.split(",");if(d.length!==4)return e;const b=d.map(p=>{const y=p.lastIndexOf(":"),g=y>=0?p.slice(0,y):p,h=y>=0?Number(p.slice(y+1)):0;return{attr:g===""?"":g,weight:Number.isFinite(h)?h:0}});return{mainAttr:r,slots:b,initialVisible:s===3||s===4?s:e.initialVisible,targetScore:Number.isFinite(o)?o:e.targetScore,showLabels:e.showLabels}}catch{return e}}const $t="小防御";function St(t){return z.filter(e=>e!==t)}function Lt(t){return{slots:t.slots.map(n=>({attr:n.attr===""?$t:n.attr,weight:n.weight})),initialVisible:t.initialVisible}}function At(t,e){const n=ft(t).map(l=>t.scores.map((d,b)=>l[b]??0)),r=t.scores.map((l,d)=>({score:l,byHit:n.map(b=>b[d]??0)})),s=Array.from({length:t.hitBuckets},(l,d)=>`命中 ${d} 次`),o=D(t,e.targetScore);return{data:r,hitLabels:s,target:{score:e.targetScore,p:o,attempts:mt(t,e.targetScore)},hitProbs:pt(t),quantiles:[.5,.1,.01].map(l=>({alpha:l,score:gt(t,l)})),best:t.scores[t.scores.length-1],mean:t.scores.reduce((l,d,b)=>l+d*(t.hits[b].reduce((p,y)=>p+y,0)/t.total),0)}}function Mt(t){let e=vt(location.search);t.innerHTML=`
    <header class="hero">
      <h1>圣遗物词条概率分布</h1>
      <p>
        给定主词条、初始词条数与各副词条的计分权重，算出「胚子练满后得分」的
        <strong>完整概率分布</strong>——不是给单件打分，而是回答「我有多大几率练出这样的」。
      </p>
    </header>

    <div class="layout">
      <form class="panel" id="form">
        <h2>配置</h2>

        <label class="field">
          <span>主词条</span>
          <select id="mainAttr"></select>
        </label>

        <label class="field">
          <span>掉落时可见的词条数</span>
          <select id="initialVisible">
            <option value="4">4 词条</option>
            <option value="3">3 词条</option>
          </select>
        </label>

        <fieldset class="slots">
          <legend>副词条与权重</legend>
          <p class="hint">
            权重决定「这个词条值多少分」。建议把主词条之外的<b>全部</b>有用词条都填上——
            没填的按 0 分算。3 词条胚子的第 4 个位置通常是「已知但无用」，权重填 0。
          </p>
          <div id="slotRows"></div>
        </fieldset>

        <label class="field">
          <span>目标分数</span>
          <input id="targetScore" type="number" step="0.1" min="0" />
        </label>

        <div class="actions">
          <button type="button" id="shareBtn" class="ghost">复制分享链接</button>
          <button type="button" id="resetBtn" class="ghost">重置</button>
        </div>
      </form>

      <main class="results">
        <section class="cards" id="cards"></section>

        <section class="panel">
          <h2>得分分布</h2>
          <div class="chart-wrap" id="chart"></div>
          <p class="hint" id="chartHint"></p>
        </section>

        <section class="panel">
          <h2>命中次数分布</h2>
          <table class="data" id="hitTable"></table>
        </section>

        <section class="panel">
          <h2>分位分数</h2>
          <p class="hint">「只有 α 的概率能达到该分数及以上」——分数越高，概率越小。</p>
          <table class="data" id="quantileTable"></table>
        </section>
      </main>
    </div>
  `;const n=u=>{const i=t.querySelector(`#${u}`);if(!i)throw new Error(`找不到 #${u}`);return i},r=n("mainAttr"),s=n("initialVisible"),o=n("targetScore"),l=n("slotRows"),d=n("chart"),b=n("chartHint"),p=n("cards"),y=n("hitTable"),g=n("quantileTable");function h(u,i,c){return`<option value="${u}"${c?" selected":""}>${i}</option>`}function L(){r.innerHTML=tt.map(u=>h(u,u,u===e.mainAttr)).join("")}function E(){const u=St(e.mainAttr);l.innerHTML=e.slots.map((i,c)=>{const x=[h("","（不用）",i.attr===""),...u.map(v=>h(v,v,v===i.attr))].join(""),m=G.map(v=>h(String(v.value),v.label,v.value===i.weight)).join(""),C=G.some(v=>v.value===i.weight)?"":h(String(i.weight),bt(i.weight),!0);return`
          <div class="slot-row">
            <span class="slot-index">${c+1}</span>
            <select data-slot="${c}" data-key="attr">${x}</select>
            <select data-slot="${c}" data-key="weight">${m}${C}</select>
            <input type="number" step="0.1" min="0" data-slot="${c}" data-key="weightInput"
                   value="${i.weight}" aria-label="自定义权重" />
          </div>`}).join("")}function M(u){e={...e,...u},A()}r.addEventListener("change",()=>{const u=r.value,i=e.slots.map(c=>c.attr===u?{attr:"",weight:0}:c);M({mainAttr:u,slots:i})}),s.addEventListener("change",()=>{M({initialVisible:Number(s.value)===3?3:4})}),o.addEventListener("input",()=>{const u=Number(o.value);Number.isFinite(u)&&M({targetScore:u})}),l.addEventListener("change",u=>{const i=u.target,c=i.dataset.slot;if(c===void 0)return;const x=Number(c),m=[...e.slots],C={...m[x]};if(i.dataset.key==="attr")C.attr=i.value;else{const v=Number(i.value);C.weight=Number.isFinite(v)&&v>=0?v:0}m[x]=C,M({slots:m})}),n("resetBtn").addEventListener("click",()=>{M(Y())}),n("shareBtn").addEventListener("click",async u=>{const i=`${location.origin}${location.pathname}?${xt(e)}`;try{await navigator.clipboard.writeText(i),u.target.textContent="已复制 ✓",setTimeout(()=>{u.target.textContent="复制分享链接"},1500)}catch{prompt("复制下面的链接：",i)}});function A(){L(),s.value=String(e.initialVisible),o.value=String(e.targetScore),E();const u=Lt(e);let i;try{i=dt(u)}catch(m){d.innerHTML=`<p class="error">计算失败：${m.message}</p>`,p.innerHTML="",y.innerHTML="",g.innerHTML="";return}const c=At(i,e),x=e.slots.filter(m=>m.weight>0&&m.attr!=="").length;p.innerHTML=[$("目标分数",R(c.target.score)+" 分",""),$("达到概率",F(c.target.p),"≥ 目标分数（含）"),$("大约需要",c.target.attempts?j(c.target.attempts):"不可能","按 1/p 估算，单位是「个胚子」"),$("最高可能分",R(c.best)+" 分",`计分槽位 ${x}/4`)].join(""),d.replaceChildren(yt({data:c.data,hitLabels:c.hitLabels,showLabels:e.showLabels&&c.data.length<=60,title:`${e.mainAttr} · ${e.initialVisible} 词条 · 得分分布`})),b.textContent=c.data.length>60?`共 ${c.data.length} 个可能分数，已省略柱上标注；把鼠标移到柱子上可看该分数的明细。`:"悬停柱状图可看该分数下各命中档的概率；红线是「≥ 该分数」的累积概率。",y.innerHTML=`
      <thead><tr><th>命中有效词条</th><th>概率</th><th>平均多少次出一个</th></tr></thead>
      <tbody>
        ${c.hitProbs.map(m=>`<tr><td>${m.hits} 次</td><td>${F(m.p)}</td><td>${j(1/m.p)}</td></tr>`).join("")}
      </tbody>`,g.innerHTML=`
      <thead><tr><th>目标概率 α</th><th>需要的分数线</th><th>相当于</th></tr></thead>
      <tbody>
        ${c.quantiles.map(m=>m.score===void 0?`<tr><td>前 ${m.alpha*100}%</td><td>—</td><td>该分数超出可能范围</td></tr>`:`<tr><td>前 ${m.alpha*100}%</td><td>${R(m.score)} 分</td><td>约 ${j(1/D(i,m.score))}出一个</td></tr>`).join("")}
      </tbody>`}function $(u,i,c){return`<div class="card">
      <div class="card-label">${u}</div>
      <div class="card-value">${i}</div>
      ${c?`<div class="card-note">${c}</div>`:""}
    </div>`}A()}const X=document.getElementById("app");if(!X)throw new Error("找不到 #app 挂载点");Mt(X);
