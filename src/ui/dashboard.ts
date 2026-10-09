import { VERSION } from "../version.js";

/** Self-contained dashboard (no external requests, works fully offline). */
export function dashboardHtml(): string {
  return HTML.replace(/__VERSION__/g, VERSION);
}

const HTML = String.raw`<!doctype html>
<html lang="en" dir="ltr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>MihanStack · میهن‌استک</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23009f6b'/><text x='16' y='22' font-size='16' text-anchor='middle' fill='white' font-family='sans-serif'>M</text></svg>">
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e6e8ee; --dim:#8b93a7; --acc:#22c58b; --warn:#f2b84b; --err:#ef5b5b; --blue:#5aa2ff;
    --font: "Inter", "Vazirmatn", "Vazir", "Segoe UI", Tahoma, system-ui, sans-serif; --mono: ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace; }
  @media (prefers-color-scheme: light) { :root { --bg:#f6f7f9; --panel:#fff; --line:#e4e7ec; --text:#1d2330; --dim:#667085; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.55 var(--font); }
  html[dir=rtl] body { font-family: "Vazirmatn","Vazir",Tahoma,var(--font); }
  header { display:flex; align-items:center; gap:14px; padding:14px 22px; border-bottom:1px solid var(--line); position:sticky; top:0; background:var(--bg); z-index:2; }
  .logo { width:34px; height:34px; border-radius:9px; background:linear-gradient(135deg,#009f6b,#22c58b 60%,#f2b84b); display:grid; place-items:center; color:#fff; font-weight:800; }
  h1 { font-size:17px; margin:0; } .tag { color:var(--dim); font-size:12.5px; }
  .sp { flex:1; }
  button, select, input, textarea { font:inherit; color:inherit; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:6px 10px; }
  button { cursor:pointer; } button.pri { background:var(--acc); border-color:var(--acc); color:#05291b; font-weight:700; }
  button:hover { filter:brightness(1.1); }
  main { display:grid; grid-template-columns: minmax(0,1.15fr) minmax(0,1fr); gap:18px; padding:18px 22px; }
  @media (max-width:1050px) { main { grid-template-columns:1fr; } }
  section { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; }
  section h2 { font-size:14px; margin:0 0 12px; display:flex; align-items:center; gap:8px; }
  section h2 .count { color:var(--dim); font-weight:400; }
  .services { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:12px; }
  .svc { border:1px solid var(--line); border-radius:12px; padding:12px; display:grid; gap:8px; }
  .svc .top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
  .svc b { font-size:14.5px; } .cat { font:11px var(--mono); color:var(--dim); text-transform:uppercase; letter-spacing:.06em; }
  .svc label { display:grid; grid-template-columns: 92px 1fr; align-items:center; gap:8px; font-size:12.5px; color:var(--dim); }
  .svc code { font:11.5px var(--mono); color:var(--dim); direction:ltr; unicode-bidi:embed; }
  .pill { font:11px var(--mono); padding:2px 8px; border-radius:99px; background:#22c58b22; color:var(--acc); }
  .pill.bad { background:#ef5b5b22; color:var(--err); } .pill.warn { background:#f2b84b22; color:var(--warn); }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th, td { text-align:start; padding:6px 8px; border-bottom:1px solid var(--line); vertical-align:top; }
  th { color:var(--dim); font-weight:500; position:sticky; top:0; background:var(--panel); }
  td.mono, .mono { font-family:var(--mono); direction:ltr; unicode-bidi:embed; }
  .log { max-height:520px; overflow:auto; }
  tr.row { cursor:pointer; } tr.row:hover { background:#ffffff08; }
  .s2 { color:var(--acc); } .s3 { color:var(--blue); } .s4 { color:var(--warn); } .s5, .s0 { color:var(--err); }
  pre { margin:0; white-space:pre-wrap; word-break:break-all; font:11.5px var(--mono); direction:ltr; text-align:left; background:var(--bg); padding:8px; border-radius:8px; }
  .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .grid2 > * { min-width:0; }
  .stack { display:grid; gap:10px; }
  .right { display:grid; gap:18px; align-content:start; }
  .muted { color:var(--dim); font-size:12px; }
  .chaos-on { box-shadow: 0 0 0 1px var(--err) inset; }
  .sms { display:grid; gap:8px; max-height:260px; overflow:auto; }
  .bubble { background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:8px 10px; }
  .bubble .meta { display:flex; justify-content:space-between; font-size:11.5px; color:var(--dim); }
  .bubble p { margin:4px 0 0; direction:auto; unicode-bidi:plaintext; }
  input[type=range] { padding:0; }
</style>
</head>
<body>
<header>
  <div class="logo">M</div>
  <div><h1>MihanStack <span class="muted">v__VERSION__</span></h1><div class="tag" data-t="tagline"></div></div>
  <div class="sp"></div>
  <span id="health" class="pill">●</span>
  <button id="lang" title="فارسی / English">فا</button>
  <button id="reset" data-t="reset"></button>
</header>
<main>
  <div class="stack">
    <section><h2><span data-t="services"></span><span class="count" id="svc-count"></span></h2><div class="services" id="services"></div></section>
    <section>
      <h2><span data-t="log"></span><span class="count" id="log-count"></span><span class="sp"></span>
        <select id="log-filter"><option value="" data-t="all"></option></select>
        <button id="log-clear" data-t="clear"></button></h2>
      <div class="log"><table><thead><tr><th>#</th><th data-t="time"></th><th data-t="service"></th><th data-t="request"></th><th data-t="status"></th><th data-t="scenario"></th><th>ms</th></tr></thead><tbody id="log"></tbody></table></div>
    </section>
  </div>
  <div class="right">
    <section id="chaos-box">
      <h2 data-t="chaos"></h2>
      <div class="grid2">
        <label class="stack"><span class="muted" data-t="category"></span><select id="chaos-cat"></select></label>
        <label class="stack"><span class="muted"><span data-t="rate"></span>: <b id="chaos-rate-v"></b></span><input id="chaos-rate" type="range" min="0" max="1" step="0.05"></label>
      </div>
      <p class="muted" data-t="chaosHelp"></p>
      <button id="chaos-toggle" class="pri"></button>
    </section>
    <section>
      <h2 data-t="webhook"></h2>
      <form id="wh" class="stack">
        <div class="grid2">
          <select id="wh-provider"></select>
          <select id="wh-status"><option value="ok">OK ✓</option><option value="nok">NOK ✗</option></select>
        </div>
        <input id="wh-url" class="mono" placeholder="http://localhost:3000/payment/callback" required>
        <div class="grid2">
          <input id="wh-params" class="mono" placeholder='{"authority":"A000…"}'>
          <input id="wh-repeat" type="number" min="1" max="20" value="1" title="repeat">
        </div>
        <button class="pri" data-t="send"></button>
      </form>
      <table style="margin-top:10px"><tbody id="wh-out"></tbody></table>
    </section>
    <section>
      <h2><span data-t="inbox"></span><span class="count" id="sms-count"></span></h2>
      <div class="sms" id="sms"><p class="muted" data-t="noSms"></p></div>
    </section>
  </div>
</main>
<script>
(function(){
  var T = {
    en: { tagline:"The local development cloud for Iranian services", services:"Services", log:"Request log", all:"all services", clear:"Clear", time:"Time", service:"Service", request:"Request", status:"Status", scenario:"Scenario", chaos:"Chaos mode", category:"Category", rate:"Failure rate", chaosHelp:"Randomly injects failures (failed payments, timeouts, 500s, bad keys…) into matching services.", chaosOn:"Stop chaos", chaosOff:"Start chaos", webhook:"Webhook playground", send:"Send callback", inbox:"SMS inbox", noSms:"No messages yet. SMS sent through Kavenegar or SMS.ir appear here (OTP codes included).", reset:"Reset state", latency:"Latency (ms)", enabled:"Enabled", autoRedirect:"Auto-redirect", up:"running", down:"offline", attempt:"Attempt" },
    fa: { tagline:"ابر توسعهٔ محلی برای سرویس‌های ایرانی", services:"سرویس‌ها", log:"گزارش درخواست‌ها", all:"همهٔ سرویس‌ها", clear:"پاک کردن", time:"زمان", service:"سرویس", request:"درخواست", status:"وضعیت", scenario:"سناریو", chaos:"حالت آشوب", category:"دسته", rate:"نرخ خطا", chaosHelp:"خطاهای تصادفی (پرداخت ناموفق، تایم‌اوت، خطای ۵۰۰، کلید نامعتبر و…) را در سرویس‌های انتخابی تزریق می‌کند.", chaosOn:"توقف آشوب", chaosOff:"شروع آشوب", webhook:"زمین بازی وب‌هوک", send:"ارسال کال‌بک", inbox:"صندوق پیامک", noSms:"هنوز پیامی نیست. پیامک‌های ارسالی از کاوه‌نگار یا SMS.ir (همراه کد تایید) اینجا نمایش داده می‌شوند.", reset:"بازنشانی", latency:"تأخیر (ms)", enabled:"فعال", autoRedirect:"بازگشت خودکار", up:"در حال اجرا", down:"قطع", attempt:"تلاش" }
  };
  var lang = localStorage.getItem("mihan.lang") || ((navigator.language || "").slice(0,2) === "fa" ? "fa" : "en");
  var $ = function(s){ return document.querySelector(s); };
  var esc = function(s){ return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){ return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); };
  var t = function(k){ return (T[lang] || T.en)[k] || k; };
  var faDigits = function(s){ return lang === "fa" ? String(s).replace(/\d/g, function(d){ return "۰۱۲۳۴۵۶۷۸۹"[d]; }) : String(s); };
  function applyLang(){
    document.documentElement.lang = lang; document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
    document.querySelectorAll("[data-t]").forEach(function(el){ el.textContent = t(el.getAttribute("data-t")); });
    $("#lang").textContent = lang === "fa" ? "EN" : "فا";
    renderChaos(); renderServices();
  }
  function api(method, path, body){
    return fetch("/_mihan" + path, { method: method, headers: {"content-type":"application/json"}, body: body ? JSON.stringify(body) : undefined })
      .then(function(r){ return r.json().then(function(j){ if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  var services = [], chaos = { enabled:false, category:"all", rate:0.3 }, lastLog = 0, logs = [];
  function renderServices(){
    $("#svc-count").textContent = faDigits(services.length);
    $("#services").innerHTML = services.map(function(s){
      var st = s.settings;
      return '<div class="svc" data-name="'+esc(s.name)+'">' +
        '<div class="top"><div><div class="cat">'+esc(s.category)+'</div><b>'+esc(s.displayName)+'</b></div>' +
        '<span class="pill '+(st.scenario === "success" ? "" : "warn")+'">'+esc(st.scenario)+'</span></div>' +
        '<code>/'+esc(s.name)+' · '+esc((s.hosts||[])[0]||"")+'</code>' +
        '<label>'+esc(t("scenario"))+'<select data-k="scenario">'+s.scenarios.map(function(x){ return '<option'+(x===st.scenario?" selected":"")+'>'+esc(x)+'</option>'; }).join("")+'</select></label>' +
        '<label>'+esc(t("latency"))+'<input data-k="latency" class="mono" value="'+esc(st.latency)+'"></label>' +
        '<label>'+esc(t("enabled"))+'<input type="checkbox" data-k="enabled"'+(st.enabled?" checked":"")+'></label>' +
        (s.category === "payment" ? '<label>'+esc(t("autoRedirect"))+'<input type="checkbox" data-k="autoRedirect"'+(st.autoRedirect?" checked":"")+'></label>' : "") +
      '</div>';
    }).join("");
    var f = $("#log-filter"), cur = f.value;
    f.innerHTML = '<option value="">'+esc(t("all"))+'</option>' + services.map(function(s){ return '<option>'+esc(s.name)+'</option>'; }).join("") + '<option>webhook</option><option>callback</option>';
    f.value = cur;
    var wp = $("#wh-provider"), wcur = wp.value;
    wp.innerHTML = services.filter(function(s){ return s.webhook; }).map(function(s){ return '<option value="'+esc(s.name)+'">'+esc(s.displayName)+'</option>'; }).join("") + '<option value="custom">custom (POST JSON)</option>';
    if (wcur) wp.value = wcur;
    var cats = ["all","payment","sms","network"].concat(services.map(function(s){ return s.name; }));
    $("#chaos-cat").innerHTML = cats.map(function(c){ return '<option'+(c===chaos.category?" selected":"")+'>'+esc(c)+'</option>'; }).join("");
  }
  $("#services").addEventListener("change", function(e){
    var el = e.target, card = el.closest(".svc"); if (!card) return;
    var k = el.getAttribute("data-k"), v = el.type === "checkbox" ? el.checked : el.value;
    if (k === "latency" && /^\d+$/.test(v)) v = Number(v);
    var patch = {}; patch[k] = v;
    api("PUT", "/services/" + card.getAttribute("data-name"), patch).then(loadServices).catch(function(err){ alert(err.message); loadServices(); });
  });
  function loadServices(){ return api("GET","/services").then(function(s){ services = s; renderServices(); }); }
  function renderChaos(){
    $("#chaos-rate").value = chaos.rate; $("#chaos-rate-v").textContent = faDigits(Math.round(chaos.rate*100)) + "%";
    $("#chaos-toggle").textContent = chaos.enabled ? t("chaosOn") : t("chaosOff");
    $("#chaos-box").classList.toggle("chaos-on", chaos.enabled);
  }
  $("#chaos-rate").addEventListener("input", function(){ chaos.rate = Number(this.value); renderChaos(); if (chaos.enabled) api("POST","/chaos",{ enabled:true, rate:chaos.rate, category:$("#chaos-cat").value }); });
  $("#chaos-cat").addEventListener("change", function(){ chaos.category = this.value; if (chaos.enabled) api("POST","/chaos",{ enabled:true, rate:chaos.rate, category:chaos.category }); });
  $("#chaos-toggle").addEventListener("click", function(){
    var p = chaos.enabled ? api("DELETE","/chaos") : api("POST","/chaos",{ enabled:true, rate:Number($("#chaos-rate").value), category:$("#chaos-cat").value });
    p.then(function(c){ chaos = c; renderChaos(); }).catch(function(e){ alert(e.message); });
  });
  function cls(st){ return st == null ? "s0" : "s" + String(st)[0]; }
  function renderLogs(){
    var f = $("#log-filter").value;
    var rows = logs.filter(function(l){ return !f || l.service === f; }).slice(-300).reverse();
    $("#log-count").textContent = faDigits(rows.length);
    $("#log").innerHTML = rows.map(function(l){
      return '<tr class="row" data-id="'+l.id+'"><td class="mono">'+l.id+'</td><td class="mono">'+esc(new Date(l.at).toLocaleTimeString(lang === "fa" ? "fa-IR" : "en-GB"))+'</td><td>'+esc(l.service)+(l.chaos?' <span class="pill bad">chaos</span>':'')+(l.replayed?' <span class="pill">replay</span>':'')+'</td>' +
        '<td class="mono">'+esc(l.method)+' '+esc(l.path)+'</td><td class="mono '+cls(l.status)+'">'+(l.status == null ? "—" : l.status)+'</td><td>'+esc(l.scenario)+'</td><td class="mono">'+l.durationMs+'</td></tr>' +
        '<tr class="detail" data-for="'+l.id+'" hidden><td colspan="7"><div class="grid2"><pre>'+esc(JSON.stringify(l.request, null, 2))+'</pre><pre>'+esc(typeof l.response === "string" ? l.response : JSON.stringify(l.response, null, 2))+'</pre></div></td></tr>';
    }).join("");
  }
  $("#log").addEventListener("click", function(e){ var tr = e.target.closest("tr.row"); if (!tr) return; var d = document.querySelector('tr.detail[data-for="'+tr.getAttribute("data-id")+'"]'); if (d) d.hidden = !d.hidden; });
  $("#log-filter").addEventListener("change", renderLogs);
  $("#log-clear").addEventListener("click", function(){ api("DELETE","/logs").then(function(){ logs = []; renderLogs(); }); });
  function renderSms(list){
    $("#sms-count").textContent = faDigits(list.length);
    if (!list.length) { $("#sms").innerHTML = '<p class="muted">'+esc(t("noSms"))+'</p>'; return; }
    $("#sms").innerHTML = list.slice(-50).reverse().map(function(m){
      return '<div class="bubble"><div class="meta"><span class="mono">'+esc(m.receptor)+'</span><span>'+esc(m.provider)+(m.template ? " · " + esc(m.template) : "")+'</span></div><p>'+esc(m.message)+'</p></div>';
    }).join("");
  }
  var smsSig = "";
  function poll(){
    api("GET","/logs?since=" + lastLog).then(function(n){
      if (n.length) { logs = logs.concat(n).slice(-500); lastLog = n[n.length-1].id; renderLogs(); }
      $("#health").textContent = "● " + t("up"); $("#health").className = "pill";
    }).catch(function(){ $("#health").textContent = "● " + t("down"); $("#health").className = "pill bad"; });
    api("GET","/sms").then(function(list){ var sig = list.length + ":" + (list.length ? list[list.length-1].id : 0); if (sig !== smsSig) { smsSig = sig; renderSms(list); } }).catch(function(){});
  }
  $("#wh").addEventListener("submit", function(e){
    e.preventDefault();
    var params = {}; try { params = $("#wh-params").value ? JSON.parse($("#wh-params").value) : {}; } catch (err) { alert("params: invalid JSON"); return; }
    $("#wh-out").innerHTML = '<tr><td class="muted">…</td></tr>';
    api("POST","/webhook",{ provider:$("#wh-provider").value, url:$("#wh-url").value, status:$("#wh-status").value, params:params, repeat:Number($("#wh-repeat").value||1) })
      .then(function(r){
        $("#wh-out").innerHTML = '<tr><td colspan="4" class="mono muted">'+esc(r.request.method)+' '+esc(r.request.url)+'</td></tr>' + r.attempts.map(function(a){
          return '<tr><td>'+esc(t("attempt"))+' '+faDigits(a.attempt)+'</td><td class="mono '+cls(a.status)+'">'+(a.status == null ? esc(a.error) : a.status)+'</td><td class="mono">'+faDigits(a.ms)+' ms</td><td class="mono">'+esc((a.body||"").slice(0,80))+'</td></tr>';
        }).join("");
      }).catch(function(err){ $("#wh-out").innerHTML = '<tr><td class="s5">'+esc(err.message)+'</td></tr>'; });
  });
  $("#lang").addEventListener("click", function(){ lang = lang === "fa" ? "en" : "fa"; localStorage.setItem("mihan.lang", lang); applyLang(); renderLogs(); });
  $("#reset").addEventListener("click", function(){ api("POST","/reset").then(function(){ logs = []; lastLog = 0; renderLogs(); renderSms([]); }); });
  Promise.all([loadServices(), api("GET","/chaos").then(function(c){ chaos = c; })]).then(function(){ applyLang(); poll(); setInterval(poll, 1000); });
})();
</script>
</body>
</html>`;
