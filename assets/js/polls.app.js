(()=>{(()=>{if(typeof window=="undefined"||typeof document=="undefined")return;if(window.__dxPollsAppLoaded&&typeof window.__dxPollsQueueBoot=="function"){try{window.__dxPollsQueueBoot()}catch{}return}window.__dxPollsAppLoaded=!0;let q="dx-polls-app-style-v2",N=120,Z=16,J=10,W=12,A="open",Y=new Set(["open","results","archive"]),ee=45e3,o={tab:A,pollId:"",closedPage:1,authSnapshot:{auth:null,authenticated:!1,token:null,user:null},collections:{open:{polls:[],page:1,pages:1,total:0},closed:{polls:[],page:1,pages:1,total:0},published:{rows:[],page:1,pages:1,total:0}},detail:null,detailCache:new Map,loading:!1,error:"",busyVote:!1};function i(e){return String(e!=null?e:"").trim()}function r(e){return String(e!=null?e:"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;")}function R(e){let t=String(e||"/").replace(/\/+/g,"/");return t==="/"?"/":t.endsWith("/")?t.slice(0,-1):t}function k(e){let t=i(e).toLowerCase();return Y.has(t)?t:A}function T(e=null){let t=new URLSearchParams(window.location.search||""),l=i(t.get("poll")),a=k(t.get("tab"));if(e instanceof Element){let n=i(e.getAttribute("data-dx-poll-id"));n&&!l&&(l=n,a="open")}let s=R(window.location.pathname||"/");if(s.startsWith("/polls/")){let n=s.slice(7).replace(/\/index\.html$/i,"").replace(/\/$/,"");n&&(l=decodeURIComponent(n),a="open")}return{tab:a,pollId:l}}function v(e,t=""){let l=new URLSearchParams,a=k(e),s=i(t);if(a==="open"&&s)return`/polls/${encodeURIComponent(s)}/`;a!==A&&l.set("tab",a),s&&l.set("poll",s);let n=l.toString();return`/polls/${n?`?${n}`:""}`}function z({tab:e,pollId:t},l=!1){let a=v(e,t),s=a.replace(/\/index\.html$/,"/");`${window.location.pathname}${window.location.search}`!==s&&(l?window.history.replaceState({},"",a):window.history.pushState({},"",a))}function S(e){let t=Date.parse(String(e||""));return Number.isFinite(t)?t:null}function f(e){let t=S(e);if(!t)return"TBD";try{return new Date(t).toLocaleString(void 0,{year:"numeric",month:"short",day:"numeric"})}catch{return new Date(t).toISOString().slice(0,10)}}function L(e){let t=S(e);if(!t)return"Closing date TBD";let l=t-Date.now();if(l<=0)return"Closed";let a=Math.floor(l/36e5),s=Math.floor(a/24),n=a%24;return s>0?`${s}d ${n}h left`:a>0?`${a}h left`:`${Math.max(1,Math.floor(l/6e4))}m left`}function te(e){return Array.isArray(e)?e.map(t=>i(t)).filter(Boolean):typeof e=="string"?e.split("|").map(t=>i(t)).filter(Boolean):[]}function h(e){let t=e&&typeof e=="object"?e:{};return{id:i(t.id),slug:i(t.slug)||null,status:i(t.status)||"draft",question:i(t.question)||"Untitled poll",options:te(t.options),createdAt:i(t.createdAt||t.created_at),closeAt:i(t.closeAt||t.close_at),manualClose:!!(t.manualClose||t.manual_close),visibility:i(t.visibility)==="members"?"members":"public",closed:!!t.closed}}function le(e){let t={};if(!e||typeof e!="object")return t;for(let[l,a]of Object.entries(e)){let s=Number(a);!Number.isFinite(s)||s<0||(t[String(l)]=Math.floor(s))}return t}function oe(e){let t=e&&typeof e=="object"?e:{};return{total:Math.max(0,Number(t.total||0)||0),counts:Array.isArray(t.counts)?t.counts.map(l=>Math.max(0,Number(l)||0)):le(t.counts),viewerVote:Number.isInteger(Number(t.viewerVote))?Number(t.viewerVote):null,closed:!!t.closed,mode:i(t.mode||"live")||"live",publishedSnapshot:t.publishedSnapshot&&typeof t.publishedSnapshot=="object"?t.publishedSnapshot:null}}function B(e,t=1){if(Array.isArray(e))return{polls:e.map(h),page:t,pages:1,total:e.length};let l=e&&typeof e=="object"?e:{},s=[l.polls,l.items,l.data,l.rows].find(n=>Array.isArray(n))||[];return{polls:s.map(h),page:Math.max(1,Number(l.page)||t),pages:Math.max(1,Number(l.pages||l.totalPages)||1),total:Math.max(0,Number(l.total||l.count||s.length)||0)}}function ae(e){let t=e&&typeof e=="object"?e:{},l=Array.isArray(t.items)?t.items:Array.isArray(t.rows)?t.rows:Array.isArray(t.polls)?t.polls:[];return{rows:l.map(a=>{let s=a!=null&&a.poll&&typeof a.poll=="object"?a.poll:a,n=a!=null&&a.publishedSnapshot&&typeof a.publishedSnapshot=="object"?a.publishedSnapshot:a!=null&&a.snapshot&&typeof a.snapshot=="object"?a.snapshot:null;return{poll:h(s),snapshot:n}}),page:Math.max(1,Number(t.page)||1),pages:Math.max(1,Number(t.pages||t.totalPages)||1),total:Math.max(0,Number(t.total||t.count||l.length)||0)}}function se(e){let t=e&&typeof e=="object"?e:{},l=t.trend&&typeof t.trend=="object"?t.trend:t;return(Array.isArray(l.series)?l.series:Array.isArray(l.points)?l.points:[]).map(s=>{var n,d,c;return{t:i(s.t||s.bucket||s.timestamp||s.date||s.label),value:Math.max(0,Number((c=(d=(n=s.value)!=null?n:s.count)!=null?d:s.total)!=null?c:0)||0)}}).filter(s=>s.t)}function D(e=[]){let t="\u2581\u2582\u2583\u2584\u2585\u2586\u2587\u2588";if(!Array.isArray(e)||e.length===0)return"";let l=e.map(s=>Math.max(0,Number(s.value)||0)),a=Math.max(...l,0);return a<=0?"\u2581".repeat(l.length):l.map(s=>{let n=s/a,d=Math.max(0,Math.min(t.length-1,Math.round(n*(t.length-1))));return t[d]}).join("")}function j(e){if(!e||e.status==="closed"||e.manualClose||e.closed)return!0;let t=S(e.closeAt);return t?t<=Date.now():!1}function ne(){return i(window.DEX_API_BASE_URL||window.DEX_API_ORIGIN||"https://dex-api.spring-fog-8edd.workers.dev").replace(/\/$/,"")}async function U(){let e=window.DEX_AUTH||window.dexAuth||null;if(!e)return{auth:null,authenticated:!1,token:null,user:null};try{typeof e.resolve=="function"?await e.resolve(2400):e.ready&&typeof e.ready.then=="function"&&await e.ready}catch{}let t=!1;try{typeof e.isAuthenticated=="function"&&(t=!!await e.isAuthenticated())}catch{}let l=null;if(t&&typeof e.getAccessToken=="function")try{l=await e.getAccessToken()}catch{l=null}let a=null;try{typeof e.getUser=="function"&&(a=await e.getUser())}catch{}return{auth:e,authenticated:t,token:l,user:a}}async function O(){var e;if(!(!((e=o.authSnapshot)!=null&&e.auth)||typeof o.authSnapshot.auth.signIn!="function"))try{await o.authSnapshot.auth.signIn({returnTo:`${window.location.pathname}${window.location.search}${window.location.hash}`})}catch{}}async function u(e,{method:t="GET",body:l=null,authRequired:a=!1}={}){var c;let s={accept:"application/json"};if(l!=null&&(s["content-type"]="application/json"),(c=o.authSnapshot)!=null&&c.token&&(s.authorization=`Bearer ${o.authSnapshot.token}`),a&&!s.authorization)return{ok:!1,status:401,data:{error:"AUTH_REQUIRED"}};let n=await fetch(`${ne()}${e}`,{method:t,headers:s,body:l==null?void 0:JSON.stringify(l)}),d=null;try{d=await n.json()}catch{d=null}return{ok:n.ok,status:n.status,data:d}}function P(e,t){e.setAttribute("data-dx-fetch-state",t),t==="loading"?e.setAttribute("aria-busy","true"):e.removeAttribute("aria-busy")}function re(){if(document.getElementById(q))return;let e=document.createElement("style");e.id=q,e.textContent=`
      .dx-polls-shell{
        --dx-polls-gap: clamp(14px,1.8vw,22px);
        width:var(--dx-header-frame-width);
        max-width:var(--dx-header-frame-width);
        margin:0 auto;
        display:grid;
        gap:var(--dx-polls-gap);
        padding:var(--dx-polls-gap) 0;
      }
      .dx-polls-panel{
        padding:clamp(16px,1.8vw,22px);
        border-radius:var(--dx-header-glass-radius,var(--dx-radius-md,10px));
        background:var(--dx-header-glass-bg);
        border:1px solid var(--dx-header-glass-rim);
        box-shadow:var(--dx-header-glass-shadow);
      }
      @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))){
        .dx-polls-panel{-webkit-backdrop-filter:var(--dx-header-glass-backdrop);backdrop-filter:var(--dx-header-glass-backdrop)}
      }
      .dx-polls-title{margin:0;font-family:var(--font-heading);font-size:clamp(1.55rem,3.2vw,2.3rem);letter-spacing:.02em;text-transform:uppercase}
      .dx-polls-subtitle{margin:10px 0 0 0;font-family:var(--font-body);font-size:clamp(.92rem,1.2vw,1rem);color:var(--dx-color-text-muted,#5e6270)}
      .dx-polls-tabs{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
      .dx-polls-tab{
        appearance:none;border:0;cursor:pointer;
        padding:10px 14px;border-radius:var(--dx-header-glass-radius,var(--dx-radius-md,10px));
        font-family:var(--font-heading);font-size:.84rem;letter-spacing:.02em;text-transform:uppercase;
        background:var(--dx-control-bg-subtle,rgba(255,255,255,.56));
        color:var(--dx-color-text,#1e2129);
      }
      .dx-polls-tab.is-active{background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);color:#fff}
      .dx-polls-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(320px,34%);gap:var(--dx-polls-gap)}
      .dx-polls-list{display:grid;gap:12px}
      .dx-poll-card{
        display:grid;gap:10px;padding:14px;border-radius:var(--dx-radius-sm,8px);
        background:rgba(255,255,255,.32);border:1px solid rgba(255,255,255,.56)
      }
      .dx-poll-card-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
      .dx-poll-chip{display:inline-flex;align-items:center;padding:2px 8px;border-radius:999px;border:1px solid rgba(38,42,52,.24);font-family:var(--font-body);font-size:.74rem;letter-spacing:.02em;text-transform:uppercase}
      .dx-poll-chip.is-accent{background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);color:#fff;border-color:rgba(0,0,0,.2)}
      .dx-poll-chip.is-members{background:rgba(18,22,30,.9);color:#fff;border-color:rgba(255,255,255,.24)}
      .dx-poll-question{margin:0;font-family:var(--font-heading);font-size:clamp(1rem,1.2vw,1.2rem);line-height:1.12;letter-spacing:.01em}
      .dx-poll-meta{margin:0;font-family:var(--font-body);font-size:.86rem;color:var(--dx-color-text-muted,#5e6270)}
      .dx-poll-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
      .dx-poll-action,
      .dx-poll-link{
        appearance:none;border:0;cursor:pointer;text-decoration:none;
        padding:10px 14px;border-radius:var(--dx-header-glass-radius,var(--dx-radius-md,10px));
        font-family:var(--font-heading);font-size:.82rem;letter-spacing:.02em;text-transform:uppercase;
        background:var(--dx-control-bg-subtle,rgba(255,255,255,.56));
        color:var(--dx-color-text,#1e2129);
      }
      .dx-poll-action.is-primary,.dx-poll-link.is-primary{background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);color:#fff}
      .dx-poll-action[disabled]{opacity:.48;cursor:default}
      .dx-polls-pager{display:flex;align-items:center;justify-content:space-between;gap:10px}
      .dx-polls-empty{margin:0;padding:14px;border-radius:var(--dx-radius-sm,8px);border:1px solid rgba(38,42,52,.16);background:rgba(255,255,255,.4);font-family:var(--font-body);color:var(--dx-color-text-muted,#5e6270)}
      .dx-polls-error{margin:0;padding:14px;border-radius:var(--dx-radius-sm,8px);border:1px solid rgba(175,29,23,.28);background:rgba(175,29,23,.08);font-family:var(--font-body);color:#611313}
      .dx-polls-detail{display:grid;gap:12px}
      .dx-polls-detail-grid{display:grid;gap:10px}
      .dx-poll-option{
        display:grid;gap:8px;cursor:pointer;text-align:left;border:0;
        padding:12px;border-radius:var(--dx-radius-sm,8px);background:rgba(255,255,255,.48)
      }
      .dx-poll-option[disabled]{opacity:.82;cursor:default}
      .dx-poll-option.is-selected{box-shadow:inset 0 0 0 1px rgba(255,77,26,.45)}
      .dx-poll-option-title{font-family:var(--font-heading);font-size:.95rem;letter-spacing:.01em;text-transform:uppercase}
      .dx-poll-bar{position:relative;height:8px;border-radius:999px;background:rgba(24,30,44,.12);overflow:hidden}
      .dx-poll-bar-fill{height:100%;width:0;background:linear-gradient(90deg,#ff2d13 0%,#ff7a1a 100%);transition:width .2s var(--dx-motion-ease-standard,cubic-bezier(.22,.8,.24,1))}
      .dx-poll-row-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;font-family:var(--font-body);font-size:.82rem;color:var(--dx-color-text-muted,#5e6270)}
      .dx-poll-published{padding:10px;border-radius:var(--dx-radius-sm,8px);background:rgba(255,255,255,.48);border:1px solid rgba(255,255,255,.62)}
      .dx-poll-trend{font-family:var(--font-body);font-size:.9rem;letter-spacing:.02em}
      .dx-poll-trend-line{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.9rem;letter-spacing:.02em}
      .dx-polls-loading{opacity:.7}
      @media (max-width:980px){
        .dx-polls-layout{grid-template-columns:1fr}
      }
    `,document.head.appendChild(e)}function E(){return document.querySelector("[data-dx-polls-app]")||document.getElementById("dx-polls-app")||document.getElementById("dex-console")}function ie(e,t){e.innerHTML=`
      <section class="dx-polls-shell">
        <article class="dx-polls-panel">
          <h1 class="dx-polls-title">Dex Polls</h1>
          <p class="dx-polls-error">${r(t||"Unable to load polls right now.")}</p>
        </article>
      </section>
    `}function V(e,{includeTrend:t=!1}={}){let l=j(e),a=e.visibility==="members"&&!o.authSnapshot.authenticated,s=v(o.tab,e.id),n=t&&Array.isArray(e.__trendPoints)&&e.__trendPoints.length?`<p class="dx-poll-trend">90d trend</p><p class="dx-poll-trend-line">${r(D(e.__trendPoints))}</p>`:"";return`
      <article class="dx-poll-card${a?" is-locked":""}" data-dx-poll-id="${r(e.id)}">
        <div class="dx-poll-card-head">
          <span class="dx-poll-chip ${l?"":"is-accent"}">${l?"Closed":"Open"}</span>
          ${e.visibility==="members"?'<span class="dx-poll-chip is-members">Members only</span>':""}
        </div>
        <h3 class="dx-poll-question">${r(e.question)}</h3>
        <p class="dx-poll-meta">${l?`Closed ${r(f(e.closeAt))}`:`Closes ${r(f(e.closeAt))} (${r(L(e.closeAt))})`}</p>
        ${n}
        <div class="dx-poll-actions">
          <a class="dx-poll-link is-primary" href="${r(s)}" data-dx-poll-open="${r(e.id)}" data-dx-soft-nav-skip="true">View Poll</a>
          ${a?'<button class="dx-poll-action" type="button" data-dx-poll-signin="true">Sign in</button>':""}
        </div>
      </article>
    `}function de(e){var c;let t=e.poll||h({}),l=e.snapshot&&typeof e.snapshot=="object"?e.snapshot:null,a=Number((l==null?void 0:l.total)||((c=l==null?void 0:l.totals)==null?void 0:c.total)||0)||0,s=i((l==null?void 0:l.headline)||""),n=i((l==null?void 0:l.summaryMarkdown)||(l==null?void 0:l.summary)||""),d=i((l==null?void 0:l.publishedAt)||(l==null?void 0:l.published_at));return`
      <article class="dx-poll-card" data-dx-poll-id="${r(t.id)}">
        <div class="dx-poll-card-head">
          <span class="dx-poll-chip">Published</span>
          ${t.visibility==="members"?'<span class="dx-poll-chip is-members">Members only</span>':""}
        </div>
        <h3 class="dx-poll-question">${r(s||t.question)}</h3>
        <p class="dx-poll-meta">${d?`Published ${r(f(d))}`:"Official snapshot"} \u2022 ${a} votes</p>
        ${n?`<div class="dx-poll-published">${r(n.slice(0,220))}</div>`:""}
        <div class="dx-poll-actions">
          <a class="dx-poll-link is-primary" href="${r(v("results",t.id))}" data-dx-poll-open="${r(t.id)}" data-dx-soft-nav-skip="true">View snapshot</a>
        </div>
      </article>
    `}function ce(e){if(!e)return`
        <article class="dx-polls-panel dx-polls-detail">
          <h2 class="dx-poll-question">Select a poll</h2>
          <p class="dx-polls-empty">Choose a poll card to inspect live results, published snapshots, and vote state.</p>
        </article>
      `;if(e.locked)return`
        <article class="dx-polls-panel dx-polls-detail">
          <h2 class="dx-poll-question">Members poll</h2>
          <p class="dx-polls-subtitle">This poll requires sign-in.</p>
          <div class="dx-polls-detail-grid">
            <p class="dx-polls-empty">Poll id: ${r(e.pollId)}</p>
            <button type="button" class="dx-poll-action is-primary" data-dx-poll-signin="true">Sign in to continue</button>
          </div>
        </article>
      `;let t=e.poll,l=e.results,a=j(t)||!!l.closed,s=Array.isArray(l.counts)?l.counts:t.options.map((b,p)=>{var g,y,M,X;return Number((X=(M=(g=l.counts)==null?void 0:g[String(p)])!=null?M:(y=l.counts)==null?void 0:y[p])!=null?X:0)}),n=t.options.map((b,p)=>{let g=Math.max(0,Number(s[p])||0),y=l.total>0?Math.round(g/l.total*100):0;return`
        <button type="button" class="dx-poll-option${l.viewerVote===p?" is-selected":""}" data-dx-poll-vote="${p}" ${a||o.busyVote?"disabled":""}>
          <span class="dx-poll-option-title">${r(b)}</span>
          <div class="dx-poll-bar"><div class="dx-poll-bar-fill" style="width:${y}%"></div></div>
          <div class="dx-poll-row-foot"><span>${g} votes</span><span>${y}%</span></div>
        </button>
      `}).join(""),d=l.publishedSnapshot&&typeof l.publishedSnapshot=="object"?l.publishedSnapshot:null,c=d?`
          <div class="dx-poll-published">
            <p class="dx-poll-meta">Official snapshot v${r(String(d.version||"1"))}${d.publishedAt?` \u2022 ${r(f(d.publishedAt))}`:""}</p>
            ${d.summaryMarkdown?`<p class="dx-poll-meta">${r(String(d.summaryMarkdown).slice(0,280))}</p>`:""}
          </div>
        `:"",$=Array.isArray(e.trend)&&e.trend.length?`
          <div class="dx-poll-published">
            <p class="dx-poll-meta">Trend (90d / day)</p>
            <p class="dx-poll-trend-line">${r(D(e.trend))}</p>
          </div>
        `:"";return`
      <article class="dx-polls-panel dx-polls-detail">
        <div class="dx-poll-card-head">
          <span class="dx-poll-chip ${a?"":"is-accent"}">${a?"Closed":"Open"}</span>
          <span class="dx-poll-chip">${r(l.mode||"live")}</span>
          ${t.visibility==="members"?'<span class="dx-poll-chip is-members">Members only</span>':""}
        </div>
        <h1 class="dx-poll-question">${r(t.question)}</h1>
        <p class="dx-polls-subtitle">${a?`Closed ${r(f(t.closeAt))}`:`Closes ${r(f(t.closeAt))} (${r(L(t.closeAt))})`}</p>
        ${o.authSnapshot.authenticated?"":'<p class="dx-polls-empty">Sign in to vote. Results remain visible.</p>'}
        ${c}
        ${$}
        <div class="dx-polls-detail-grid">${n}</div>
        <div class="dx-polls-pager">
          <span class="dx-poll-meta">${l.total} total votes</span>
          <a class="dx-poll-link" href="${r(v(o.tab,""))}" data-dx-poll-clear="true" data-dx-hover-variant="none" data-dx-motion-exclude="true" data-dx-soft-nav-skip="true">Back to polls</a>
        </div>
      </article>
    `}function _(e){let t=o.collections.open.polls.length?o.collections.open.polls.map(n=>V(n)).join(""):'<p class="dx-polls-empty">No open polls right now.</p>',l=o.collections.closed.polls.length?o.collections.closed.polls.map(n=>V(n,{includeTrend:!0})).join(""):'<p class="dx-polls-empty">No closed polls in this window.</p>',a=o.collections.published.rows.length?o.collections.published.rows.map(n=>de(n)).join(""):'<p class="dx-polls-empty">No published snapshots yet.</p>',s=o.tab==="open"?`
          <article class="dx-polls-panel">
            <h2 class="dx-poll-question">Open polls</h2>
            <p class="dx-polls-subtitle">Vote live. Members-only polls remain gated.</p>
            <div class="dx-polls-list">${t}</div>
            <h2 class="dx-poll-question">Recently closed</h2>
            <p class="dx-polls-subtitle">Closed polls remain viewable here for quick routing compatibility.</p>
            <div class="dx-polls-list">${l}</div>
          </article>
        `:o.tab==="results"?`
          <article class="dx-polls-panel">
            <h2 class="dx-poll-question">Published results</h2>
            <p class="dx-polls-subtitle">Official snapshot stream published by Dex staff.</p>
            <div class="dx-polls-list">${a}</div>
          </article>
        `:`
          <article class="dx-polls-panel">
            <h2 class="dx-poll-question">Archive + trends</h2>
            <p class="dx-polls-subtitle">Closed polls with trend sparkline previews.</p>
            <div class="dx-polls-list">${l}</div>
            <div class="dx-polls-pager">
              <button type="button" class="dx-poll-action" data-dx-poll-closed-prev="true" ${o.collections.closed.page<=1?"disabled":""}>Previous</button>
              <span class="dx-poll-meta">Page ${o.collections.closed.page} of ${o.collections.closed.pages}</span>
              <button type="button" class="dx-poll-action" data-dx-poll-closed-next="true" ${o.collections.closed.page>=o.collections.closed.pages?"disabled":""}>Next</button>
            </div>
          </article>
        `;e.innerHTML=`
      <section class="dx-polls-shell${o.loading?" dx-polls-loading":""}">
        <article class="dx-polls-panel">
          <h1 class="dx-polls-title">Dex Polls</h1>
          <p class="dx-polls-subtitle">Community signal desk with open voting, official snapshots, and archive trends.</p>
          <div class="dx-polls-tabs">
            <button type="button" class="dx-polls-tab${o.tab==="open"?" is-active":""}" data-dx-polls-tab="open">Open</button>
            <button type="button" class="dx-polls-tab${o.tab==="results"?" is-active":""}" data-dx-polls-tab="results">Results</button>
            <button type="button" class="dx-polls-tab${o.tab==="archive"?" is-active":""}" data-dx-polls-tab="archive">Archive & Trends</button>
          </div>
        </article>
        ${o.error?`<article class="dx-polls-panel"><p class="dx-polls-error">${r(o.error)}</p></article>`:""}
        <section class="dx-polls-layout">
          ${s}
          ${ce(o.detail)}
        </section>
      </section>
    `}async function pe(){let[e,t,l]=await Promise.all([u(`/polls?state=open&page=1&pageSize=${Z}`),u(`/polls?state=closed&page=${o.closedPage}&pageSize=${J}`),u(`/polls/published?page=1&pageSize=${W}`)]);if(!e.ok)throw new Error("Unable to load open polls");if(!t.ok)throw new Error("Unable to load closed polls");o.collections.open=B(e.data,1),o.collections.closed=B(t.data,o.closedPage),o.collections.published=l.ok?ae(l.data):{rows:[],page:1,pages:1,total:0},o.closedPage=o.collections.closed.page}async function H(e){try{let t=await u(`/polls/${encodeURIComponent(e)}/trend?bucket=day&window=90d`);return t.ok?se(t.data):[]}catch{return[]}}async function Q(e){var b,p;let t=i(e);if(!t){o.detail=null;return}let l=o.detailCache.get(t);if(l&&Date.now()-l.cachedAt<=ee&&!o.busyVote){o.detail=l.value;return}let a=await u(`/polls/${encodeURIComponent(t)}`);if(a.status===401||a.status===403){o.detail={locked:!0,pollId:t};return}if(!a.ok)throw new Error(`Unable to load poll ${t}`);let s=h(((b=a.data)==null?void 0:b.poll)||a.data),n=await u(`/polls/${encodeURIComponent(t)}/results`);if(!n.ok)throw new Error(`Unable to load poll results (${t})`);let d=oe(((p=n.data)==null?void 0:p.results)||n.data),c=await H(t),$={locked:!1,poll:s,results:d,trend:c};o.detail=$,o.detailCache.set(t,{cachedAt:Date.now(),value:$})}async function ue(e){if(!(!o.detail||o.detail.locked||o.busyVote)&&!(!Number.isInteger(e)||e<0)){if(o.authSnapshot=await U(),!o.authSnapshot.authenticated){await O();return}o.busyVote=!0;try{let t=o.detail.poll.id;if(!(await u(`/polls/${encodeURIComponent(t)}/vote`,{method:"POST",authRequired:!0,body:{optionIndex:e}})).ok)throw new Error("Vote failed");o.detailCache.delete(t),await Q(t)}finally{o.busyVote=!1}}}function C(e){e.querySelectorAll("[data-dx-polls-tab]").forEach(a=>{a.addEventListener("click",async()=>{let s=k(a.getAttribute("data-dx-polls-tab"));s!==o.tab&&(o.tab=s,o.error="",z({tab:o.tab,pollId:o.pollId},!1),await w(e))})}),e.querySelectorAll("[data-dx-poll-signin]").forEach(a=>{a.addEventListener("click",async s=>{s.preventDefault(),await O()})}),e.querySelectorAll("[data-dx-poll-vote]").forEach(a=>{a.addEventListener("click",async()=>{let s=Number(a.getAttribute("data-dx-poll-vote"));await ue(s),_(e),C(e)})});let t=e.querySelector("[data-dx-poll-closed-prev]");t&&t.addEventListener("click",async()=>{o.closedPage<=1||(o.closedPage-=1,await w(e))});let l=e.querySelector("[data-dx-poll-closed-next]");l&&l.addEventListener("click",async()=>{o.closedPage+=1,await w(e)})}async function fe(){if(o.tab!=="archive")return;let e=o.collections.closed.polls.slice(0,3);e.length&&await Promise.all(e.map(async t=>{if(!t.id)return;let l=await H(t.id);t.__trendPoints=l}))}async function w(e){o.loading=!0,_(e),C(e);try{await pe(),await fe(),await Q(o.pollId),o.error=""}catch(t){o.error=t instanceof Error?t.message:String(t)}finally{o.loading=!1,_(e),C(e)}}async function F(e){let t=performance.now()-e;t>=N||await new Promise(l=>window.setTimeout(l,N-t))}async function xe(){let e=E();if(!e)return;re();let t=performance.now();P(e,"loading");let l=T(e);o.tab=l.tab,o.pollId=l.pollId,z({tab:o.tab,pollId:o.pollId},!0);try{o.authSnapshot=await U(),await w(e),await F(t),P(e,"ready")}catch(a){console.error("[dx-polls] boot error",a),ie(e,"Unable to load polls right now. Please try again."),await F(t),P(e,"error")}}let x=null,I=!1,G="";function K(){let e=T(E()),t=R(window.location.pathname||"/"),l=i(window.location.search||"");return`${t}?${l}|${e.tab}|${e.pollId}`}async function he(){do I=!1,await xe(),G=K();while(I)}function m(){if(!x){let e=E();if(e&&e.getAttribute("data-dx-fetch-state")==="ready"&&K()===G)return Promise.resolve()}return x?(I=!0,x):(x=he().catch(e=>{console.error("[dx-polls] queue boot error",e)}).finally(()=>{x=null}),x)}window.__dxPollsQueueBoot=m,window.addEventListener("dx:slotready",()=>{m().catch(()=>{})},{once:!0}),window.addEventListener("popstate",()=>{m().catch(()=>{})}),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",()=>{m().catch(()=>{})},{once:!0}):m().catch(()=>{})})();})();
