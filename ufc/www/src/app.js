/* UFC Hub app logic — mobile-first, offline-tolerant.
   Live sources (all optional, each fails soft to bundled data):
   - ESPN scoreboard (upcoming events), ESPN news (media)
   - Arctic Shift r/MMA (social), Wikipedia (web/bios) */
(function () {
  "use strict";
  var D = window.UFC_DATA || { fighters: [], prospects: [], eventsUpcoming: [], eventsRecent: [] };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var cache = { espnEvents: null, espnNews: null, reddit: null, ts: {} };
  var state = { tab: "feed", evMode: "upcoming", fStatus: "all", fDiv: "all", fQ: "", searchQ: "", searchSrc: "all", wDiv: "all", vf: "all", vScope: "latest", rankDiv: "Men's Pound-for-Pound" };
  var gallery = { fid: null, photos: [], idx: 0 };
  var videos = { list: [], playing: null };
  var eventsUp = [];

  function liveFetch() {
    try {
      if (window.root && window.root.superFetch) return window.root.superFetch;
    } catch (e) {}
    try {
      if (typeof root !== "undefined" && root.superFetch) return root.superFetch;
    } catch (e2) {}
    return fetch.bind(window);
  }
  async function getJSON(url, ms) {
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, ms || 12000);
    try {
      var r = await liveFetch()(url, { signal: ctl.signal, headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error("http " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* 12-hour freshness policy: feeds persist on-device, refetch when stale */
  var TTL = 12 * 3600 * 1000;
  function lsGet(k) {
    try { var v = localStorage.getItem("ufchub." + k); return v ? JSON.parse(v) : null; }
    catch (e) { return null; }
  }
  function lsSet(k, data) {
    try { localStorage.setItem("ufchub." + k, JSON.stringify({ ts: Date.now(), data: data })); }
    catch (e) {}
  }
  function lsDel(k) { try { localStorage.removeItem("ufchub." + k); } catch (e) {} }
  function isFresh(ts) { return ts && (Date.now() - ts < TTL); }
  function ageStr(ts) {
    if (!ts) return "";
    var m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return "updated just now";
    if (m < 60) return "updated " + m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 24) return "updated " + h + "h ago";
    return "updated " + Math.floor(h / 24) + "d ago";
  }
  function setAge(sel, ts) { var el = $(sel); if (el) el.textContent = ageStr(ts); }
  function fmtDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) { return iso; }
  }
  function daysUntil(iso) {
    var ms = new Date(iso) - Date.now();
    var d = Math.ceil(ms / 86400000);
    return d < 0 ? "done" : d === 0 ? "today" : "in " + d + "d";
  }
  function redditTime(ts) {
    try {
      var created = ts > 1e12 ? ts : ts * 1000;
      var h = Math.floor((Date.now() - created) / 3600000);
      if (h < 1) return "now";
      if (h < 24) return h + "h";
      return Math.floor(h / 24) + "d";
    } catch (e) { return ""; }
  }

  /* ---------- tabs ---------- */
  function switchTab(name) {
    state.tab = name;
    $$(".tabBtn").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === name); });
    $$(".tabPage").forEach(function (p) { p.hidden = p.id !== "page-" + name; });
    window.scrollTo({ top: 0 });
    if (name === "feed" && !cache.feedLoaded) loadFeed();
    if (name === "events" && !cache.eventsLoaded) loadEvents();
    if (name === "fighters" && !cache.fightersLoaded) renderFighters();
    if (name === "women") renderWomen();
    if (name === "videos") loadVideos();
    if (name === "ranks") loadRanks();
    if (name === "prospects" && !cache.prospectsLoaded) renderProspects();
  }

  /* ---------- FEED ---------- */
  async function fetchEspnEvents() {
    if (cache.espnEvents && cache.espnEvents.length) return cache.espnEvents;
    var saved = lsGet("events2");
    if (saved && saved.data && saved.data.length) {
      cache.espnEvents = saved.data;
      if (isFresh(saved.ts)) return cache.espnEvents;
    }
    var j = await getJSON("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard");
    var cal = (((j.leagues || [])[0] || {}).calendar) || [];
    if (cal.length) {
      cache.espnEvents = cal.map(function (c) {
        var m = /events\/(\d+)/.exec((c.event && c.event.$ref) || "");
        return { label: c.label, startDate: c.startDate, id: m ? m[1] : null };
      });
      lsSet("events2", cache.espnEvents);
    }
    return cache.espnEvents;
  }
  async function loadFeed() {
    cache.feedLoaded = true;
    renderHero();
    try { await fetchEspnEvents(); renderHero(); } catch (e) {}
    await Promise.all([loadNews(), loadSocial(), loadRumors()]);
    checkAlerts();
    renderForYou(true);
    paintGreeting();
  }
  function eventList() {
    return (cache.espnEvents && cache.espnEvents.length ? cache.espnEvents : D.eventsUpcoming.map(function (e) {
      return { label: e.name, startDate: e.date, venue: e.venue };
    }));
  }
  function nextEvent() {
    var list = eventList().slice().sort(function (a, b) { return new Date(a.startDate) - new Date(b.startDate); });
    var i;
    for (i = 0; i < list.length; i++) {
      if (new Date(list[i].startDate) > Date.now() - 86400000) return { ev: list[i], live: true, idx: i };
    }
    return { ev: list[list.length - 1], live: false, idx: list.length - 1 };
  }
  function renderHero() {
    var r = nextEvent();
    var n = r.ev;
    var el = $("#heroCard");
    if (!n) { el.innerHTML = "<b>No upcoming event found.</b>"; return; }
    var kick = r.live ? "NEXT UP &bull; " + esc(daysUntil(n.startDate).toUpperCase()) : "LATEST EVENT";
    el.innerHTML =
      '<div class="heroKicker">' + kick + "</div>" +
      '<div class="heroTitle">' + esc(n.label || n.name) + "</div>" +
      '<div class="heroMeta">' + esc(fmtDate(n.startDate)) + (n.venue ? " &bull; " + esc(n.venue) : "") + "</div>" +
      '<button class="btn ghost" id="heroEvBtn">Full schedule</button>';
    var b = $("#heroEvBtn");
    if (b) b.onclick = function () { switchTab("events"); };
  }
  async function loadNews() {
    var box = $("#newsList");
    var saved = lsGet("news");
    if (saved && saved.data && saved.data.length) {
      cache.espnNews = saved.data; cache.ts.news = saved.ts;
      paintNews(); setAge("#newsAge", saved.ts);
      if (isFresh(saved.ts)) return;
    } else {
      box.innerHTML = skel(3);
    }
    try {
      var j = await getJSON("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/news?limit=20");
      cache.espnNews = (j.articles || []).map(function (a) {
        return {
          title: a.headline, desc: a.description,
          img: a.images && a.images[0] && a.images[0].url,
          date: a.published,
          url: (a.links && a.links.web && a.links.web.href) || "https://www.espn.com/mma/"
        };
      });
      cache.ts.news = Date.now();
      lsSet("news", cache.espnNews);
    } catch (e) { /* offline -> paint from whatever we have */ }
    paintNews(); setAge("#newsAge", cache.ts.news);
  }
  function paintNews() {
    var box = $("#newsList");
    var items = cache.espnNews && cache.espnNews.length ? cache.espnNews : D.eventsRecent.slice(0, 4).map(function (e) {
      return { title: e.name, desc: e.headliner, date: e.date, url: "https://www.espn.com/mma/", img: null };
    });
    box.innerHTML = items.map(function (a) {
      return '<a class="card link" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
        (a.img ? '<img class="thumb" loading="lazy" src="' + esc(a.img) + '" alt="">' : "") +
        '<div><div class="cardT">' + esc(a.title) + "</div>" +
        (a.desc ? '<div class="cardS">' + esc(a.desc) + "</div>" : "") +
        '<div class="cardM">' + esc(fmtDate(a.date)) + " &bull; ESPN</div></div></a>";
    }).join("");
  }
  async function loadSocial() {
    var box = $("#socialList");
    var saved = lsGet("reddit");
    if (saved && saved.data && saved.data.length) {
      cache.reddit = saved.data; cache.ts.reddit = saved.ts;
      paintSocial(); setAge("#socialAge", saved.ts);
      if (isFresh(saved.ts)) return;
    } else {
      box.innerHTML = skel(3);
    }
    try {
      var j = await getJSON("https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=MMA&limit=15&sort=desc", 14000);
      cache.reddit = (j.data || []).map(function (p) {
        return {
          title: p.title, sub: p.subreddit || "MMA", author: p.author,
          comments: p.num_comments, score: p.score, ts: p.created_utc,
          url: "https://www.reddit.com" + p.permalink
        };
      });
      cache.ts.reddit = Date.now();
      lsSet("reddit", cache.reddit);
    } catch (e) { /* offline */ }
    paintSocial(); setAge("#socialAge", cache.ts.reddit);
  }
  function paintSocial() {
    var box = $("#socialList");
    if (!cache.reddit || !cache.reddit.length) {
      box.innerHTML = '<div class="card"><div class="cardS">Fan talk is offline right now. Check the Fighters and Events tabs — they work without internet.</div></div>';
      return;
    }
    box.innerHTML = cache.reddit.map(function (p) {
      return '<a class="card link" href="' + esc(p.url) + '" target="_blank" rel="noopener">' +
        '<div><div class="cardT">' + esc(p.title) + "</div>" +
        '<div class="cardM">r/' + esc(p.sub) + " &bull; u/" + esc(p.author) + " &bull; " +
        esc(redditTime(p.ts)) + " ago &bull; " + esc(p.comments) + " comments</div></div></a>";
    }).join("");
  }
  function skel(n) {
    return '<div class="logoSpin"><span class="ufcMark ufcMark--md isSpinning">UFC</span></div>';
  }

  /* ---------- EVENTS ---------- */
  async function loadEvents() {
    cache.eventsLoaded = true;
    renderEvents();
    try {
      var cal = await fetchEspnEvents();
      if (cal && cal.length) { renderEvents(); renderHero(); checkAlerts(); }
    } catch (e) {}
  }
  function renderEvents() {
    var box = $("#eventsList");
    $$(".segBtn").forEach(function (b) { b.classList.toggle("on", b.dataset.mode === state.evMode); });
    if (state.evMode === "upcoming") {
      var up = cache.espnEvents && cache.espnEvents.length ? cache.espnEvents : D.eventsUpcoming.map(function (e) {
        return { label: e.name, startDate: e.date, venue: e.venue, note: e.note };
      });
      up = up.slice().sort(function (a, b) { return new Date(a.startDate) - new Date(b.startDate); });
      var future = up.filter(function (e) { return new Date(e.startDate) > Date.now() - 86400000; });
      up = future.length ? future : up;
      box.innerHTML = up.map(function (e, i) {
        var isPast = new Date(e.startDate) <= Date.now() - 86400000;
        return '<div class="card">' +
          '<div class="cardK">' + esc(daysUntil(e.startDate)) + (i === 0 && !isPast ? " &bull; NEXT" : "") + "</div>" +
          '<div class="cardT">' + esc(e.label) + "</div>" +
          '<div class="cardM">' + esc(fmtDate(e.startDate)) + (e.venue ? " &bull; " + esc(e.venue) : "") + "</div>" +
          (e.note ? '<div class="cardS">' + esc(e.note) + "</div>" : "") +
          '<div class="row">' + (isPast ? "" : '<button class="btn sm remindBtn" data-i="' + i + '">🔔 Remind me</button>') +
          (e.id ? '<button class="btn sm ghost cardBtn" data-eid="' + esc(e.id) + '">📋 Full card</button>' : "") +
          '<a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.espn.com/mma/schedule">ESPN</a>' +
          '<a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.ufc.com/events">UFC.com</a></div>' +
          (e.id ? '<div class="cardBouts" data-eid="' + esc(e.id) + '" hidden></div>' : "") + "</div>";
      }).join("");
      eventsUp = up;
      $$(".remindBtn", box).forEach(function (b) {
        b.onclick = function () { remindMe(up[+b.dataset.i], b); };
      });
      $$(".cardBtn", box).forEach(function (b) {
        b.onclick = function () {
          var c = box.querySelector('.cardBouts[data-eid="' + b.dataset.eid + '"]');
          if (!c) return;
          if (c.hidden) { c.hidden = false; b.textContent = "▴ Hide card"; loadCard(b.dataset.eid, c); }
          else { c.hidden = true; b.textContent = "📋 Full card"; }
        };
      });
    } else {
      box.innerHTML = D.eventsRecent.map(function (e) {
        var res = (e.results || []).map(function (r) {
          return '<div class="res"><span>' + esc(r[0]) + "</span><span class=\"dim\">" + esc(r[1]) + (r[2] ? " (" + esc(r[2]) + ")" : "") + "</span></div>";
        }).join("");
        return '<div class="card"><div class="cardK">RESULT</div>' +
          '<div class="cardT">' + esc(e.name) + "</div>" +
          '<div class="cardM">' + esc(fmtDate(e.date)) + " &bull; " + esc(e.venue) + "</div>" +
          '<div class="cardS">' + esc(e.headliner) + "</div>" + res +
          '<div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://www.espn.com/mma/schedule">Full card on ESPN</a></div></div>';
      }).join("");
    }
  }

  /* ---------- FULL FIGHT CARDS ---------- */
  var eventCards = {};
  var athNames = null;
  function getAthCache() {
    if (!athNames) {
      try { var v = lsGet("athletes"); athNames = (v && v.data) || {}; }
      catch (e) { athNames = {}; }
    }
    return athNames;
  }
  async function athName(id) {
    var c = getAthCache();
    if (c[id] && c[id].n) return c[id].n;
    var j = await getJSON("https://sports.core.api.espn.com/v2/sports/mma/athletes/" + id + "?lang=en&region=us", 10000);
    var n = j.displayName || (j.firstName + " " + j.lastName);
    c[id] = { n: n, ts: Date.now() };
    try { lsSet("athletes", c); } catch (e) {}
    return n;
  }
  function athIdFromRef(ref) {
    var m = /athletes\/(\d+)/.exec(ref || "");
    return m ? m[1] : null;
  }
  async function loadCard(eid, box) {
    if (eventCards[eid] && eventCards[eid].bouts) { paintCard(eid, box); return; }
    box.innerHTML = skel(1);
    try {
      var j = await getJSON("https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc/events/" + eid + "?lang=en&region=us", 15000);
      var comps = (j.competitions || []).slice().sort(function (a, b) { return (a.matchNumber || 99) - (b.matchNumber || 99); });
      // collect unique athlete ids
      var ids = [];
      comps.forEach(function (c) {
        (c.competitors || []).forEach(function (x) {
          var id = athIdFromRef(x.athlete && x.athlete.$ref);
          if (id && ids.indexOf(id) < 0) ids.push(id);
        });
      });
      var missing = ids.filter(function (id) { return !(getAthCache()[id] && getAthCache()[id].n); });
      for (var i = 0; i < missing.length; i += 6) {
        await Promise.all(missing.slice(i, i + 6).map(function (id) {
          return athName(id).catch(function () { return "TBD"; });
        }));
      }
      var bouts = comps.map(function (c) {
        var names = (c.competitors || []).map(function (x) {
          var id = athIdFromRef(x.athlete && x.athlete.$ref);
          return { name: (getAthCache()[id] && getAthCache()[id].n) || "TBD", winner: !!x.winner };
        });
        var seg = (c.cardSegment && c.cardSegment.description) || "";
        return { div: (c.type && (c.type.abbreviation || c.type.text)) || "", seg: seg, names: names, decided: names.some(function (x) { return x.winner; }) };
      });
      eventCards[eid] = { bouts: bouts, ts: Date.now() };
      paintCard(eid, box);
    } catch (e) {
      box.innerHTML = '<div class="cardS dim">Card unavailable — check ESPN.</div>';
    }
  }
  function paintCard(eid, box) {
    var bouts = (eventCards[eid] && eventCards[eid].bouts) || [];
    if (!bouts.length) { box.innerHTML = '<div class="cardS dim">No bouts listed yet.</div>'; return; }
    var lastSeg = null, html = "";
    bouts.forEach(function (b) {
      if (b.seg && b.seg !== lastSeg) { lastSeg = b.seg; html += '<div class="resH">' + esc(b.seg) + "</div>"; }
      var line = b.names.map(function (x) {
        return x.winner ? "<b>★ " + esc(x.name) + "</b>" : esc(x.name);
      }).join(" <span class=\"dim\">vs</span> ");
      html += '<div class="res"><span>' + line + '</span><span class="dim">' + esc(b.div) + "</span></div>";
    });
    box.innerHTML = html;
  }

  /* ---------- FIGHTERS ---------- */
  function divisions() {
    var s = {};
    D.fighters.forEach(function (f) { s[f.div] = 1; });
    return Object.keys(s).sort();
  }
  function renderFighters() {
    cache.fightersLoaded = true;
    var ds = divisions();
    $("#fDivSel").innerHTML = '<option value="all">All divisions</option>' + ds.map(function (d) {
      return '<option value="' + esc(d) + '"' + (state.fDiv === d ? " selected" : "") + ">" + esc(d) + "</option>";
    }).join("");
    $$(".chipBtn").forEach(function (b) { b.classList.toggle("on", b.dataset.st === state.fStatus); });
    var q = state.fQ.trim().toLowerCase();
    var list = D.fighters.filter(function (f) {
      if (state.fStatus !== "all" && f.status !== state.fStatus) return false;
      if (state.fDiv !== "all" && f.div !== state.fDiv) return false;
      if (q && (f.name + " " + (f.nick || "") + " " + f.div).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var box = $("#fighterGrid");
    if (!list.length) { box.innerHTML = '<div class="card"><div class="cardS">No fighters match. Try clearing filters.</div></div>'; return; }
    box.innerHTML = list.map(function (f) {
      var r = f.rec;
      var photo = f.img
        ? '<img class="wphoto" loading="lazy" src="' + esc(f.img) + '" alt="' + esc(f.name) + '">'
        : '<div class="wph">' + esc(f.name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2)) + "</div>";
      return '<button class="wcard" data-id="' + esc(f.id) + '">' + photo +
        '<div class="wBody"><div class="fRank">' + esc(f.div.replace("Women's ", "").toUpperCase()) + " &bull; " + esc(f.rank) + "</div>" +
        '<div class="fName">' + esc(f.name) + "</div>" +
        (f.nick ? '<div class="fNick">"' + esc(f.nick) + '"</div>' : "") +
        '<div class="fMeta">' + r.w + "-" + r.l + (r.d ? "-" + r.d : "") + " &bull; " + (f.status === "legend" ? "Legend" : esc(f.country)) + "</div></div></button>";
    }).join("");
    $$(".wcard", box).forEach(function (c) { c.onclick = function () { openFighter(c.dataset.id); }; });
  }
  function openFighter(id) {
    var f = D.fighters.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    var r = f.rec;
    var dec = Math.max(0, r.w - r.ko - r.sub);
    var tot = Math.max(1, r.w);
    var last = (f.last || []).map(function (L) {
      var cls = L.res === "W" ? "w" : L.res === "L" ? "l" : "n";
      return '<div class="res"><span class="badge ' + cls + '">' + esc(L.res) + '</span><span>' + esc(L.opp) +
        '</span><span class="dim">' + esc(L.method) + " &bull; " + esc(L.event) + " &bull; " + esc(L.date) + "</span></div>";
    }).join("");
    $("#modalBody").innerHTML =
      (f.img ? '<img class="wphoto" style="height:230px" src="' + esc(f.img) + '" alt="' + esc(f.name) + '">' : "") +
      '<div class="mHead"><div class="fRank">' + esc(f.div.toUpperCase()) + " &bull; " + esc(f.rank) + "</div>" +
      '<div class="mName">' + esc(f.name) + "</div>" +
      (f.nick ? '<div class="fNick">"' + esc(f.nick) + '"</div>' : "") +
      '<div class="bigRec">' + r.w + "-" + r.l + (r.d ? "-" + r.d : "") + '</div><div class="dim">' +
      (f.status === "legend" ? "Legend" : "Active") + " &bull; " + esc(f.country) + " &bull; Age " + esc(f.age) + "</div></div>" +
      '<div class="statGrid">' +
      stat("Height", f.height) + stat("Reach", f.reach) + stat("Stance", f.stance) + stat("Camp", f.camp) + "</div>" +
      '<div class="cardT">Finish breakdown</div><div class="bars">' +
      bar("KO/TKO", r.ko, tot) + bar("Subs", r.sub, tot) + bar("Decisions", dec, tot) + "</div>" +
      (f.next ? '<div class="nextBox"><div class="cardK">NEXT FIGHT</div><div class="cardT">vs ' + esc(f.next.opp) + "</div>" +
        '<div class="cardM">' + esc(f.next.event) + " &bull; " + esc(f.next.date) + (f.next.venue ? " &bull; " + esc(f.next.venue) : "") + "</div></div>"
        : '<div class="nextBox dim">No date announced — check Events tab.</div>') +
      '<div class="cardT">Last fights</div>' + (last || '<div class="dim">No recent bouts logged.</div>') +
      (f.note ? '<div class="cardS" style="margin-top:10px">' + esc(f.note) + "</div>" : "") +
      '<div class="cardT" style="margin-top:12px">Bio (Wikipedia live)</div><div id="wikiBio" class="cardS">Loading…</div>' +
      '<div class="row"><a class="btn sm" target="_blank" rel="noopener" href="https://en.wikipedia.org/wiki/' + esc(f.wiki) + '">Wikipedia</a>' +
      '<a class="btn sm ghost" target="_blank" rel="noopener" href="https://www.espn.com/mma/fighter/_/id/placeholder">ESPN profile</a></div>';
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    loadWikiBio(f.wiki);
  }
  function stat(k, v) { return '<div class="stat"><div class="statK">' + esc(k) + '</div><div class="statV">' + esc(v) + "</div></div>"; }
  function bar(k, v, tot) {
    var p = Math.round((v / tot) * 100);
    return '<div class="barRow"><span>' + esc(k) + " " + v + '</span><div class="bar"><i style="width:' + p + '%"></i></div><span>' + p + "%</span></div>";
  }
  async function loadWikiBio(wiki) {
    var box = $("#wikiBio");
    try {
      var j = await getJSON("https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(wiki), 10000);
      if (box) box.textContent = j.extract || "No bio found.";
    } catch (e) { if (box) box.textContent = "Bio unavailable offline."; }
  }
  function closeModal() { $("#modal").hidden = true; document.body.style.overflow = ""; }

  /* ---------- PROSPECTS ---------- */
  function renderProspects() {
    cache.prospectsLoaded = true;
    $("#prospectGrid").innerHTML = D.prospects.map(function (p) {
      var stars = "";
      for (var i = 0; i < 5; i++) stars += i < p.hype ? "★" : "☆";
      return '<div class="card"><div class="cardK">' + esc(p.promo.toUpperCase()) + " &bull; " + esc(p.div.toUpperCase()) + "</div>" +
        '<div class="cardT">' + esc(p.name) + ' <span class="dim">' + esc(p.rec) + "</span></div>" +
        '<div class="hype">' + stars + ' <span class="dim">' + esc(p.style) + (p.age ? " &bull; Age " + p.age : "") + "</span></div>" +
        '<div class="cardS"><b>Last:</b> ' + esc(p.last) + "<br><b>Next:</b> " + esc(p.next) + "</div>" +
        '<div class="cardS dim">' + esc(p.note) + "</div></div>";
    }).join("");
  }

  /* ---------- SEARCH ---------- */
  var searchTimer = null;
  function bindSearch() {
    var inp = $("#searchInput");
    inp.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () { runSearch(inp.value.trim()); }, 450);
    });
    $("#searchBtn").onclick = function () { runSearch(inp.value.trim()); };
    $$(".srcBtn").forEach(function (b) {
      b.onclick = function () {
        state.searchSrc = b.dataset.src;
        $$(".srcBtn").forEach(function (x) { x.classList.toggle("on", x === b); });
        runSearch(inp.value.trim());
      };
    });
  }
  async function runSearch(q) {
    state.searchQ = q;
    var box = $("#searchResults");
    if (!q) { box.innerHTML = '<div class="card"><div class="cardS">Try "Topuria", "UFC 324", "heavyweight", or "DWCS". Results pull from the built-in roster plus live Wikipedia, ESPN news and r/MMA fan talk.</div></div>'; return; }
    box.innerHTML = skel(3);
    var src = state.searchSrc;
    var out = "";
    // 1. local fighters
    if (src === "all" || src === "fighters") {
      var hits = D.fighters.filter(function (f) {
        return (f.name + " " + (f.nick || "") + " " + f.div).toLowerCase().indexOf(q.toLowerCase()) >= 0;
      });
      out += '<div class="resH">Fighters (' + hits.length + ")</div>";
      out += hits.length ? hits.map(function (f) {
        return '<button class="card link" data-fid="' + esc(f.id) + '"><div><div class="cardT">' + esc(f.name) + "</div>" +
          '<div class="cardM">' + esc(f.div) + " &bull; " + f.rec.w + "-" + f.rec.l + " &bull; " + (f.status === "legend" ? "Legend" : f.rank) + "</div></div></button>";
      }).join("") : '<div class="card"><div class="cardS">No roster match.</div></div>';
    }
    // 2. wikipedia (open web)
    if (src === "all" || src === "web") {
      out += '<div class="resH">Open web — Wikipedia</div><div id="sWeb"><div class="card"><div class="sk"></div></div></div>';
    }
    // 3. ESPN news (media)
    if (src === "all" || src === "media") {
      out += '<div class="resH">Media — ESPN</div><div id="sMedia"><div class="card"><div class="sk"></div></div></div>';
    }
    // 4. reddit (social)
    if (src === "all" || src === "social") {
      out += '<div class="resH">Social — r/MMA</div><div id="sSocial"><div class="card"><div class="sk"></div></div></div>';
    }
    box.innerHTML = out;
    $$("[data-fid]", box).forEach(function (b) { b.onclick = function () { openFighter(b.dataset.fid); }; });
    if (src === "all" || src === "web") searchWiki(q);
    if (src === "all" || src === "media") searchMedia(q);
    if (src === "all" || src === "social") searchSocial(q);
  }
  async function searchWiki(q) {
    var box = $("#sWeb");
    try {
      var j = await getJSON("https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=" + encodeURIComponent("UFC " + q) + "&srlimit=8&format=json&origin=*");
      var items = ((j.query || {}).search) || [];
      box.innerHTML = items.length ? items.map(function (s) {
        return '<a class="card link" target="_blank" rel="noopener" href="https://en.wikipedia.org/wiki/' + esc(encodeURIComponent(s.title.replace(/ /g, "_"))) + '">' +
          '<div><div class="cardT">' + esc(s.title) + "</div><div class=\"cardS\">" + s.snippet.replace(/<[^>]+>/g, "") + "…</div></div></a>";
      }).join("") : '<div class="card"><div class="cardS">No wiki hits.</div></div>';
    } catch (e) { box.innerHTML = '<div class="card"><div class="cardS">Web search offline.</div></div>'; }
  }
  async function searchMedia(q) {
    var box = $("#sMedia");
    try {
      var news = cache.espnNews;
      if (!news) {
        var j = await getJSON("https://site.api.espn.com/apis/site/v2/sports/mma/ufc/news?limit=30");
        news = (j.articles || []).map(function (a) {
          return { title: a.headline, desc: a.description, date: a.published, url: (a.links && a.links.web && a.links.web.href) || "https://www.espn.com/mma/" };
        });
        cache.espnNews = news;
      }
      var ql = q.toLowerCase();
      var hits = news.filter(function (a) { return ((a.title || "") + " " + (a.desc || "")).toLowerCase().indexOf(ql) >= 0; }).slice(0, 8);
      var rhits = (cache.rumors || []).filter(function (a) { return ((a.title || "") + " " + (a.desc || "")).toLowerCase().indexOf(ql) >= 0; }).slice(0, 6);
      var html = hits.length ? hits.map(function (a) {
        return '<a class="card link" target="_blank" rel="noopener" href="' + esc(a.url) + '"><div><div class="cardT">' + esc(a.title) + "</div>" +
          '<div class="cardM">ESPN &bull; ' + esc(fmtDate(a.date)) + "</div></div></a>";
      }).join("") : "";
      if (rhits.length) html += '<div class="resH">Rumor press</div>' + rhits.map(function (a) {
        return '<a class="card link" target="_blank" rel="noopener" href="' + esc(a.url) + '"><div><div class="cardT">' + esc(a.title) + "</div>" +
          '<div class="cardM">' + esc(a.src) + " &bull; unconfirmed</div></div></a>";
      }).join("");
      box.innerHTML = html || '<div class="card"><div class="cardS">No recent stories mention "' + esc(q) + '". Try the full feed on the Home tab.</div></div>';
    } catch (e) { box.innerHTML = '<div class="card"><div class="cardS">Media search offline.</div></div>'; }
  }
  async function searchSocial(q) {
    var box = $("#sSocial");
    try {
      var j = await getJSON("https://arctic-shift.photon-reddit.com/api/posts/search?subreddit=MMA&query=" + encodeURIComponent(q) + "&limit=10&sort=desc", 14000);
      var items = j.data || [];
      if (!items.length) {
        var all = cache.reddit || [];
        var ql = q.toLowerCase();
        items = all.filter(function (p) { return (p.title || "").toLowerCase().indexOf(ql) >= 0; });
      }
      box.innerHTML = items.length ? items.map(function (p) {
        var title = p.title || p.title === "" ? p.title : "(untitled)";
        return '<a class="card link" target="_blank" rel="noopener" href="https://www.reddit.com' + esc(p.permalink || "") + '">' +
          '<div><div class="cardT">' + esc(title) + "</div>" +
          '<div class="cardM">u/' + esc(p.author || "?") + " &bull; " + esc(p.num_comments != null ? p.num_comments : "?") + " comments</div></div></a>";
      }).join("") : '<div class="card"><div class="cardS">No r/MMA threads found for "' + esc(q) + '".</div></div>';
    } catch (e) { box.innerHTML = '<div class="card"><div class="cardS">Social search offline.</div></div>'; }
  }

  /* ---------- WOMEN + GALLERY ---------- */
  function womenList() {
    return D.fighters.filter(function (f) { return f.div.indexOf("Women's") === 0; });
  }
  function renderWomen() {
    $$("#wChips .wchip").forEach(function (b) {
      b.classList.toggle("on", b.dataset.wdiv === state.wDiv);
      if (!b._wired) { b._wired = true; b.onclick = function () { state.wDiv = b.dataset.wdiv; renderWomen(); }; }
    });
    var list = womenList().filter(function (f) {
      if (state.wDiv === "legends") return f.status === "legend";
      if (state.wDiv !== "all") return f.div === state.wDiv && f.status === "active";
      return true;
    });
    var box = $("#womenGrid");
    box.innerHTML = list.map(function (f) {
      var photo = f.img
        ? '<img class="wphoto" loading="lazy" src="' + esc(f.img) + '" alt="' + esc(f.name) + '">'
        : '<div class="wph">' + esc(f.name.split(" ").map(function (w) { return w[0]; }).join("").slice(0, 2)) + "</div>";
      return '<button class="wcard" data-id="' + esc(f.id) + '">' + photo +
        '<div class="wBody"><div class="fRank">' + esc(f.div.replace("Women's ", "").toUpperCase()) + " &bull; " + esc(f.rank) + "</div>" +
        '<div class="fName">' + esc(f.name) + "</div>" +
        '<div class="fMeta">' + f.rec.w + "-" + f.rec.l + (f.rec.d ? "-" + f.rec.d : "") + (f.status === "legend" ? " &bull; Legend" : "") + "</div></div></button>";
    }).join("") || '<div class="card"><div class="cardS">Nobody here yet.</div></div>';
    $$(".wcard", box).forEach(function (c) { c.onclick = function () { openGallery(c.dataset.id); }; });
  }
  function openGallery(id) {
    var f = D.fighters.filter(function (x) { return x.id === id; })[0];
    if (!f) return;
    gallery = { fid: id, photos: [], idx: 0 };
    if (f.img) gallery.photos.push({ src: f.img, full: f.img, credit: "Profile photo via Wikipedia (tap Commons below for license details)." });
    $("#modalBody").innerHTML =
      '<div class="mHead"><div class="fRank">' + esc(f.div.toUpperCase()) + " &bull; " + esc(f.rank) + "</div>" +
      '<div class="mName">' + esc(f.name) + "</div>" +
      '<div class="dim">' + f.rec.w + "-" + f.rec.l + (f.rec.d ? "-" + f.rec.d : "") + " &bull; " + esc(f.country) + " &bull; Age " + esc(f.age) + "</div></div>" +
      '<div class="gMainWrap"><img class="gMain" id="gMain" src="' + esc(f.img || "") + '" alt="' + esc(f.name) + '">' +
      '<button class="gArrow l" id="gPrev">‹</button><button class="gArrow r" id="gNext">›</button>' +
      '<div class="gCount" id="gCount">1 / 1</div></div>' +
      '<div class="credit" id="gCredit"></div>' +
      '<div class="gThumbs" id="gThumbs"></div>' +
      '<div class="cardS" id="gStatus">Loading freely-licensed photos from Wikimedia Commons…</div>' +
      '<div class="row"><button class="btn sm" id="gStatsBtn">Full stats + fights</button>' +
      '<a class="btn sm ghost" target="_blank" rel="noopener" href="https://en.wikipedia.org/wiki/' + esc(f.wiki) + '">Wikipedia</a></div>';
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    paintGallery();
    $("#gPrev").onclick = function (e) { e.stopPropagation(); stepGallery(-1); };
    $("#gNext").onclick = function (e) { e.stopPropagation(); stepGallery(1); };
    $("#gStatsBtn").onclick = function () { openFighter(id); };
    loadCommonsGallery(f);
  }
  function paintGallery() {
    var m = $("#gMain"), c = $("#gCount"), t = $("#gThumbs"), cr = $("#gCredit");
    if (!m) return;
    var p = gallery.photos[gallery.idx];
    if (!p) { m.removeAttribute("src"); if (c) c.textContent = "0 / 0"; return; }
    m.src = p.full || p.src;
    if (c) c.textContent = (gallery.idx + 1) + " / " + gallery.photos.length;
    if (cr) cr.textContent = p.credit || "";
    if (t) t.innerHTML = gallery.photos.map(function (q, i) {
      return '<img loading="lazy" src="' + esc(q.src) + '" class="' + (i === gallery.idx ? "on" : "") + '" data-i="' + i + '" alt="photo ' + (i + 1) + '">';
    }).join("");
    if (t) $$("img", t).forEach(function (im) { im.onclick = function () { gallery.idx = +im.dataset.i; paintGallery(); }; });
  }
  function stepGallery(d) {
    if (!gallery.photos.length) return;
    gallery.idx = (gallery.idx + d + gallery.photos.length) % gallery.photos.length;
    paintGallery();
  }
  function stripTags(h) { return String(h || "").replace(/<[^>]+>/g, "").trim(); }
  async function loadCommonsGallery(f) {
    var st = $("#gStatus");
    try {
      var q = '"' + f.name + '"';
      var url = "https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrsearch=" +
        encodeURIComponent(q) + "&gsrnamespace=6&gsrlimit=24&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=400";
      var j = await getJSON(url, 15000);
      var pages = (j.query && j.query.pages) || {};
      var seen = {};
      gallery.photos.forEach(function (p) { seen[p.src] = 1; });
      Object.keys(pages).forEach(function (k) {
        var info = (pages[k].imageinfo || [])[0];
        if (!info || !info.thumburl) return;
        if (seen[info.thumburl]) return;
        if (info.width && info.width < 250) return;
        seen[info.thumburl] = 1;
        var md = info.extmetadata || {};
        var artist = stripTags(md.Artist && md.Artist.value);
        var lic = stripTags(md.LicenseShortName && md.LicenseShortName.value);
        gallery.photos.push({
          src: info.thumburl, full: info.url,
          credit: (artist ? "Photo: " + artist + ". " : "") + (lic ? "License: " + lic + ". " : "") + "Via Wikimedia Commons."
        });
      });
      if (st) st.textContent = gallery.photos.length > 1
        ? gallery.photos.length + " photos — all freely licensed. Swipe with the arrows."
        : "Only the profile photo turned up in Commons — try her Wikipedia page for more.";
      paintGallery();
    } catch (e) {
      if (st) st.textContent = "Extra photos unavailable offline — profile photo above still works.";
    }
  }

  /* ---------- CALENDAR REMINDERS (.ics → native calendar) ---------- */
  function icsEsc(s) {
    return String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toICSDate(d, utc) {
    // utc:true → YYYYMMDDTHHMMSSZ ; false → floating local time
    var g = utc ? "getUTC" : "get";
    return d[g + "FullYear"]() + pad(d[g + "Month"]() + 1) + pad(d[g + "Date"]()) +
      "T" + pad(d[g + "Hours"]()) + pad(d[g + "Minutes"]()) + "00" + (utc ? "Z" : "");
  }
  function buildICS(e) {
    var hasTime = /T/.test(e.startDate);
    var d = new Date(hasTime ? e.startDate : e.startDate + "T21:00:00");
    var dt = toICSDate(d, hasTime);
    var uid = "ufc-" + dt + "-" + (e.label || "").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 24) + "@ufchub";
    var desc = "UFC Hub reminder." + (e.venue ? " Venue: " + e.venue + "." : "") + " Card subject to change — confirm on ESPN / UFC.com.";
    var lines = [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UFC Hub//EN//", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", "UID:" + uid,
      "DTSTAMP:" + toICSDate(new Date(), true),
      "DTSTART:" + dt, "DURATION:PT5H",
      "SUMMARY:" + icsEsc(e.label || "UFC event"),
      "DESCRIPTION:" + icsEsc(desc),
      e.venue ? "LOCATION:" + icsEsc(e.venue) : null,
      "BEGIN:VALARM", "ACTION:DISPLAY", "TRIGGER:-PT2H",
      "DESCRIPTION:" + icsEsc((e.label || "UFC event") + " starts in 2 hours"),
      "END:VALARM", "END:VEVENT", "END:VCALENDAR"
    ];
    return lines.filter(Boolean).join("\r\n");
  }
  function remindMe(e, btn) {
    try {
      var blob = new Blob([buildICS(e)], { type: "text/calendar;charset=utf-8" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "UFC-" + (e.label || "event").replace(/[^a-z0-9]+/gi, "-").slice(0, 40) + ".ics";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      if (btn) { btn.textContent = "✓ Saved — open your calendar"; btn.disabled = true; }
    } catch (err) {
      if (btn) btn.textContent = "Couldn't save — try again";
    }
  }

  /* ---------- ALERTS (in-app push-style notifications) ---------- */
  var lastAlertCheck = 0;
  function getSeen() {
    var s = lsGet("seen");
    if (!s || !s.data) return { news: [], videos: [], eventsWarned: [] };
    s.data.news = s.data.news || []; s.data.videos = s.data.videos || []; s.data.eventsWarned = s.data.eventsWarned || [];
    return s.data;
  }
  function saveSeen(s) { lsSet("seen", s); }
  async function checkAlerts() {
    if (Date.now() - lastAlertCheck < 5 * 60 * 1000) return;
    lastAlertCheck = Date.now();
    var fresh = [];
    try {
      var seen = getSeen();
      var firstRun = !lsGet("seen");
      // news
      if (cache.espnNews && cache.espnNews.length) {
        cache.espnNews.slice(0, 8).forEach(function (a) {
          if (seen.news.indexOf(a.url) < 0) {
            seen.news.push(a.url);
            if (!firstRun && fresh.length < 10) fresh.push({ kind: "news", title: a.title, sub: "New story • ESPN", ts: Date.now(), tab: "feed" });
          }
        });
        seen.news = seen.news.slice(-60);
      }
      // videos (fetch RSS if the Videos tab was never opened)
      if (!videos.list.length) {
        try {
          var items = await fetchUfcRss();
          if (items.length) { videos.list = items; archiveVideos(items); }
        } catch (e) {}
      }
      videos.list.slice(0, 8).forEach(function (v) {
        if (seen.videos.indexOf(v.id) < 0) {
          seen.videos.push(v.id);
          if (!firstRun && fresh.length < 10) fresh.push({ kind: "video", title: v.title, sub: "New upload • UFC official", ts: Date.now(), tab: "videos", extra: v.id });
        }
      });
      seen.videos = seen.videos.slice(-60);
      // fight weekend: next event within 72h, warn once per event
      try {
        var r = nextEvent();
        if (r.live && (new Date(r.ev.startDate) - Date.now()) < 72 * 3600 * 1000) {
          var key = (r.ev.label || "") + "|" + r.ev.startDate;
          if (seen.eventsWarned.indexOf(key) < 0) {
            seen.eventsWarned.push(key);
            if (!firstRun) fresh.push({ kind: "event", title: (r.ev.label || "UFC event") + " is " + daysUntil(r.ev.startDate), sub: "Tap Remind me in Events to get the calendar alert", ts: Date.now(), tab: "events" });
          }
        }
      } catch (e2) {}
      saveSeen(seen);
      if (fresh.length) {
        cache.alerts = (fresh.concat(cache.alerts || [])).slice(0, 30);
        paintBadge();
        maybeNotify(fresh);
      }
    } catch (e3) {}
  }
  function unreadCount() {
    var since = 0;
    try { var v = lsGet("alertsSeen"); since = (v && v.data) || 0; } catch (e) {}
    return (cache.alerts || []).filter(function (a) { return a.ts > since; }).length;
  }
  function paintBadge() {
    var b = $("#bellBadge");
    if (!b) return;
    var n = unreadCount();
    b.hidden = n <= 0;
    b.textContent = n > 9 ? "9+" : n;
  }
  function maybeNotify(fresh) {
    try {
      if (!("Notification" in window) || Notification.permission !== "granted") return;
      var pop = false;
      try { pop = lsGet("notifPop") && lsGet("notifPop").data === true; } catch (e) {}
      if (!pop || !fresh.length) return;
      var show = fresh.slice(0, 3);
      show.forEach(function (a) {
        try { new Notification(a.kind === "video" ? "New UFC video" : a.kind === "event" ? "Fight weekend" : "UFC news", { body: a.title }); } catch (e2) {}
      });
    } catch (e3) {}
  }
  function openAlerts() {
    var list = cache.alerts || [];
    $("#modalBody").innerHTML =
      '<div class="mHead"><div class="mName">Alerts</div>' +
      '<div class="dim">New stories, uploads and fight weekends land here.</div></div>' +
      '<div class="row" style="margin-bottom:12px"><button class="btn sm ghost" id="notifPopBtn">Enable pop-up alerts</button></div>' +
      (list.length ? list.map(function (a, i) {
        var ic = a.kind === "video" ? "▶️" : a.kind === "event" ? "📅" : "📰";
        return '<button class="alItem" data-ai="' + i + '"><span class="alIc">' + ic + "</span>" +
          "<span><div class=\"cardT\" style=\"font-size:14px\">" + esc(a.title) + "</div>" +
          '<div class="cardM">' + esc(a.sub) + "</div></span></button>";
      }).join("") : '<div class="card"><div class="cardS">You\'re all caught up. Fresh items appear here as they arrive.</div></div>');
    $("#modal").hidden = false;
    document.body.style.overflow = "hidden";
    try { lsSet("alertsSeen", Date.now()); } catch (e) {}
    paintBadge();
    $$("#modalBody .alItem").forEach(function (b) {
      b.onclick = function () {
        var a = list[+b.dataset.ai];
        closeModal();
        if (!a) return;
        switchTab(a.tab);
        if (a.kind === "video" && a.extra) setTimeout(function () { playVideo(a.extra); }, 600);
      };
    });
    var nb = $("#notifPopBtn");
    if (nb) nb.onclick = async function () {
      try {
        if (!("Notification" in window)) { nb.textContent = "Not supported here"; return; }
        var p = await Notification.requestPermission();
        if (p === "granted") { lsSet("notifPop", true); nb.textContent = "✓ Pop-ups on"; }
        else nb.textContent = "Blocked in browser settings";
      } catch (e) { nb.textContent = "Not supported here"; }
    };
  }

  /* ---------- RUMOR MILL (MMA press RSS) ---------- */
  var RUMOR_FEEDS = [
    { name: "MMA Fighting", url: "https://www.mmafighting.com/rss/index.xml" },
    { name: "BJPenn.com", url: "https://www.bjpenn.com/feed/" },
    { name: "LowKick MMA", url: "https://www.lowkickmma.com/feed/" }
  ];
  var RUMOR_RX = /rumou?r|reportedly|targeting|in talks|close to|nearing|teas(es?|ing)|hints? at|comeback|return(ing|s)?|re-sign|new contract|dating|girlfriend|boyfriend|split|break-?up|divorce|retire|unretire|call-?out|calls? out|beef|feud|trash[- ]talk|superfight|dream fight|money fight|offered|turned down|negotiat/i;
  async function fetchRumorFeed(f) {
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 12000);
    try {
      var r = await liveFetch()(f.url, { signal: ctl.signal, headers: { Accept: "application/xml, text/xml" } });
      if (!r.ok) return [];
      var xml = new DOMParser().parseFromString(await r.text(), "text/xml");
      var out = [];
      xml.querySelectorAll("item").forEach(function (it, idx) {
        if (idx >= 8) return;
        var t = it.querySelector("title"), l = it.querySelector("link"), d = it.querySelector("pubDate"), desc = it.querySelector("description");
        var th = it.getElementsByTagNameNS("*", "thumbnail")[0] || it.getElementsByTagNameNS("*", "content")[0];
        var img = th ? (th.getAttribute("url") || th.getAttribute("src")) : null;
        if (!img && desc) { var m = desc.textContent.match(/<img[^>]+src="([^"]+)"/); if (m) img = m[1]; }
        if (t && l) out.push({ title: t.textContent.trim(), url: l.textContent.trim(), date: d ? d.textContent : "", desc: desc ? desc.textContent.replace(/<[^>]+>/g, "").slice(0, 140) : "", img: img, src: f.name });
      });
      xml.querySelectorAll("entry").forEach(function (it, idx) {
        if (idx >= 8) return;
        var t = it.querySelector("title"), p = it.querySelector("published") || it.querySelector("updated"), s = it.querySelector("summary");
        var link = null;
        it.querySelectorAll("link").forEach(function (L) {
          if (!link && (!L.getAttribute("rel") || L.getAttribute("rel") === "alternate")) link = L.getAttribute("href");
        });
        if (t && link) out.push({ title: t.textContent.trim(), url: link, date: p ? p.textContent : "", desc: s ? s.textContent.replace(/<[^>]+>/g, "").slice(0, 140) : "", img: null, src: f.name });
      });
      return out;
    } catch (e) { return []; }
    finally { clearTimeout(to); }
  }
  async function loadRumors() {
    var box = $("#rumorList");
    var saved = lsGet("rumors");
    if (saved && saved.data && saved.data.length) {
      cache.rumors = saved.data; cache.ts.rumors = saved.ts;
      paintRumors(); setAge("#rumorAge", saved.ts);
      if (isFresh(saved.ts)) return;
    } else if (box) {
      box.innerHTML = skel(2);
    }
    var parts = await Promise.all(RUMOR_FEEDS.map(fetchRumorFeed));
    var seen = {};
    var all = [];
    parts.forEach(function (p) { p.forEach(function (a) { if (!seen[a.url]) { seen[a.url] = 1; all.push(a); } }); });
    all.sort(function (a, b) { return new Date(b.date) - new Date(a.date); });
    if (all.length) {
      cache.rumors = all.slice(0, 20);
      cache.ts.rumors = Date.now();
      lsSet("rumors", cache.rumors);
      paintRumors(); setAge("#rumorAge", cache.ts.rumors);
    } else if (!cache.rumors) {
      if (box) box.innerHTML = '<div class="card"><div class="cardS">Rumor wires are quiet/offline right now.</div></div>';
    }
  }
  function paintRumors() {
    var box = $("#rumorList");
    if (!box || !cache.rumors) return;
    box.innerHTML = cache.rumors.map(function (a) {
      var hot = RUMOR_RX.test(a.title + " " + a.desc);
      return '<a class="card link" href="' + esc(a.url) + '" target="_blank" rel="noopener">' +
        (a.img ? '<img class="thumb" loading="lazy" src="' + esc(a.img) + '" alt="">' : "") +
        "<div>" + (hot ? '<span class="vTag hl">RUMOR</span>' : "") +
        '<div class="cardT">' + esc(a.title) + "</div>" +
        (a.desc ? '<div class="cardS">' + esc(a.desc) + "…</div>" : "") +
        '<div class="cardM">' + esc(a.src) + (a.date ? " &bull; " + esc(fmtDate(a.date)) : "") + "</div></div></a>";
    }).join("");
  }

  /* ---------- PROFILE + FOR YOU ---------- */
  var POPULAR = ["topuria", "makhachev", "pereira", "aspinall", "paddy", "gaethje", "volk", "omar", "chimaev", "holloway", "weili", "harrison", "shevchenko", "jones", "conor", "nunes"];
  var TOPICS = [["news", "📰 News"], ["rumors", "🧂 Rumors"], ["videos", "▶️ Videos"], ["events", "📅 Events"]];
  function getProfile() {
    try { var v = lsGet("profile"); return v && v.data ? v.data : null; }
    catch (e) { return null; }
  }
  function greetWord() {
    var h = new Date().getHours();
    return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  }
  function paintGreeting() {
    var p = getProfile();
    if (!p || !p.name) return;
    var bs = $("#brandSub");
    if (bs) bs.textContent = "Hey " + p.name + " 👋";
    var h = $("#forYouH");
    if (h) h.textContent = greetWord() + ", " + p.name + " — for you";
  }
  function fighterById(id) {
    return D.fighters.filter(function (f) { return f.id === id; })[0];
  }
  function escRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
  function fighterHit(f, text) {
    var t = " " + String(text || "").toLowerCase() + " ";
    var name = f.name.toLowerCase();
    if (t.indexOf(" " + name) >= 0 || t.indexOf(name + " ") >= 0 || t.indexOf(name) >= 0) return true;
    var sur = f.name.split(" ").pop();
    try { return new RegExp("\\b" + escRx(sur.toLowerCase()) + "\\b").test(t); }
    catch (e) { return false; }
  }
  function openOnboard() {
    var p = getProfile() || { name: "", fighters: [], topics: ["news", "rumors", "videos", "events"] };
    $("#obName").value = p.name || "";
    $("#obTitle").textContent = p.name ? "Your Hub preferences ⚙️" : "Welcome to UFC Hub 👊";
    var sel = {};
    (p.fighters || []).forEach(function (id) { sel[id] = 1; });
    $("#obFighters").innerHTML = POPULAR.map(function (id) {
      var f = fighterById(id);
      if (!f) return "";
      return '<button class="pkChip' + (sel[id] ? " on" : "") + '" data-id="' + esc(id) + '">' + esc(f.name) + "</button>";
    }).join("");
    var ts = {};
    (p.topics && p.topics.length ? p.topics : ["news", "rumors", "videos", "events"]).forEach(function (t) { ts[t] = 1; });
    $("#obTopics").innerHTML = TOPICS.map(function (t) {
      return '<button class="pkChip' + (ts[t[0]] ? " on" : "") + '" data-t="' + t[0] + '">' + esc(t[1]) + "</button>";
    }).join("");
    $$("#obFighters .pkChip").forEach(function (c) { c.onclick = function () { c.classList.toggle("on"); }; });
    $$("#obTopics .pkChip").forEach(function (c) { c.onclick = function () { c.classList.toggle("on"); }; });
    $("#onboard").hidden = false;
  }
  function closeOnboard(save) {
    if (save) {
      var name = ($("#obName").value || "").trim().slice(0, 20) || "Fight fan";
      var fighters = $$("#obFighters .pkChip.on").map(function (c) { return c.dataset.id; });
      var topics = $$("#obTopics .pkChip.on").map(function (c) { return c.dataset.t; });
      lsSet("profile", { name: name, fighters: fighters, topics: topics.length ? topics : ["news", "rumors", "videos", "events"] });
    }
    $("#onboard").hidden = true;
    paintGreeting();
    renderForYou(true);
  }
  async function renderForYou(fetchVids) {
    var box = $("#forYou"), list = $("#forYouList");
    if (!box || !list) return;
    var p = getProfile();
    if (!p || !p.fighters || !p.fighters.length) { box.hidden = true; return; }
    var picks = p.fighters.map(fighterById).filter(Boolean);
    if (!picks.length) { box.hidden = true; return; }
    var topics = p.topics && p.topics.length ? p.topics : ["news", "rumors", "videos", "events"];
    var items = [];
    function pushAll(arr, kind, getText) {
      (arr || []).forEach(function (a) {
        var f = picks.filter(function (x) { return fighterHit(x, getText(a)); })[0];
        if (f && items.length < 10) items.push({ kind: kind, f: f, a: a });
      });
    }
    // scheduled bouts for picks come first
    picks.forEach(function (f) {
      if (f.next && items.length < 10) items.push({ kind: "sched", f: f, a: f.next });
    });
    if (topics.indexOf("events") >= 0) {
      eventList().filter(function (e) { return new Date(e.startDate) > Date.now() - 86400000; }).forEach(function (e) {
        var f = picks.filter(function (x) { return fighterHit(x, e.label); })[0];
        if (f && items.length < 10) items.push({ kind: "event", f: f, a: e });
      });
    }
    if (topics.indexOf("news") >= 0) pushAll(cache.espnNews, "news", function (a) { return a.title + " " + (a.desc || ""); });
    if (topics.indexOf("rumors") >= 0) pushAll(cache.rumors, "rumor", function (a) { return a.title + " " + (a.desc || ""); });
    if (topics.indexOf("videos") >= 0) {
      if (!videos.list.length && fetchVids) {
        try { var items2 = await fetchUfcRss(); if (items2.length) videos.list = items2; } catch (e) {}
      }
      pushAll(videos.list, "video", function (v) { return v.title; });
    }
    if (!items.length) { box.hidden = true; return; }
    box.hidden = false;
    paintGreeting();
    list.innerHTML = items.slice(0, 8).map(function (it, i) {
      if (it.kind === "news" || it.kind === "rumor") {
        return '<a class="card link" href="' + esc(it.a.url) + '" target="_blank" rel="noopener"><div>' +
          (it.kind === "rumor" ? '<span class="vTag hl">RUMOR</span>' : "") +
          '<div class="cardT" style="font-size:14px">' + esc(it.a.title) + "</div>" +
          '<div class="cardM">For ' + esc(it.f.name) + "</div></div></a>";
      }
      if (it.kind === "video") {
        return '<button class="vcard" data-vi="' + esc(it.a.id) + '"><span class="vthumb"><img loading="lazy" src="https://i.ytimg.com/vi/' + esc(it.a.id) + '/hqdefault.jpg" alt=""><span class="vplay">▶</span></span>' +
          '<span><div class="cardT" style="font-size:14px">' + esc(it.a.title) + "</div>" +
          '<div class="cardM">For ' + esc(it.f.name) + "</div></span></button>";
      }
      if (it.kind === "event") {
        return '<button class="card link" data-ei="' + i + '"><div><div class="cardK">YOUR FIGHTER • ' + esc(daysUntil(it.a.startDate).toUpperCase()) + "</div>" +
          '<div class="cardT" style="font-size:14px">' + esc(it.a.label) + "</div>" +
          '<div class="cardM">' + esc(fmtDate(it.a.startDate)) + " — tap for Remind me</div></div></button>";
      }
      return '<button class="card link" data-fi="' + esc(it.f.id) + '"><div><div class="cardK">NEXT FIGHT • ' + esc(it.f.name.toUpperCase()) + "</div>" +
        '<div class="cardT" style="font-size:14px">vs ' + esc(it.a.opp) + "</div>" +
        '<div class="cardM">' + esc(it.a.event) + " &bull; " + esc(it.a.date) + "</div></div></button>";
    }).join("");
    $$("#forYouList [data-vi]", list).forEach(function (b) {
      b.onclick = function () { switchTab("videos"); setTimeout(function () { playVideo(b.dataset.vi); }, 600); };
    });
    $$("#forYouList [data-ei]", list).forEach(function (b) { b.onclick = function () { switchTab("events"); }; });
    $$("#forYouList [data-fi]", list).forEach(function (b) { b.onclick = function () { openFighter(b.dataset.fi); }; });
  }

  /* ---------- RANKINGS ---------- */
  var RANK_SHORT = { "Men's Pound-for-Pound": "P4P", "Women's Pound-for-Pound": "W-P4P", Flyweight: "FLW", Bantamweight: "BW", Featherweight: "FW", Lightweight: "LW", Welterweight: "WW", Middleweight: "MW", "Light Heavyweight": "LHW", Heavyweight: "HW", "Women's Strawweight": "W-SW", "Women's Flyweight": "W-FL", "Women's Bantamweight": "W-BW" };
  function normName(s) {
    return (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  }
  function rosterByName(name) {
    var n = normName(name);
    return D.fighters.filter(function (f) { return normName(f.name) === n; })[0] || null;
  }
  function rankData() {
    return (cache.ranks && cache.ranks.divs) || (window.UFC_RANKINGS && window.UFC_RANKINGS.divs) || [];
  }
  function parseRankingsDoc(doc) {
    var out = [], seen = {};
    doc.querySelectorAll(".view-grouping-header").forEach(function (h) {
      var header = h.textContent.replace(/\s+/g, " ").replace(/\s*Top Rank\s*/i, "").trim();
      if (!header || seen[header]) return;
      var block = h.parentElement;
      var isP4P = /pound-for-pound/i.test(header);
      var capA = block.querySelector("caption h5 a");
      var rows = [];
      block.querySelectorAll("tbody tr").forEach(function (tr) {
        var tds = tr.querySelectorAll("td");
        var a = tr.querySelector("td a");
        if (!tds.length || !a) return;
        rows.push({ rank: parseInt(tds[0].textContent, 10) || 0, slug: (a.getAttribute("href") || "").split("/").pop(), name: a.textContent.trim() });
      });
      if (!rows.length) return;
      seen[header] = 1;
      out.push({ div: header, champ: (!isP4P && capA) ? { slug: (capA.getAttribute("href") || "").split("/").pop(), name: capA.textContent.trim() } : null, list: rows.slice(0, 15) });
    });
    return out;
  }
  async function loadRanks() {
    paintRanks();
    var saved = lsGet("rankings");
    if (saved && saved.data && saved.data.divs && saved.data.divs.length) {
      cache.ranks = saved.data;
      paintRanks();
      if (isFresh(saved.ts)) return;
    } else if (window.UFC_RANKINGS) {
      cache.ranks = window.UFC_RANKINGS;
      paintRanks();
    }
    try {
      var ctl = new AbortController();
      var to = setTimeout(function () { ctl.abort(); }, 14000);
      var r = await liveFetch()("https://www.ufc.com/rankings", { signal: ctl.signal, headers: { Accept: "text/html" } });
      clearTimeout(to);
      if (!r.ok) throw new Error("http " + r.status);
      var doc = new DOMParser().parseFromString(await r.text(), "text/html");
      var divs = parseRankingsDoc(doc);
      if (divs.length >= 10) {
        cache.ranks = { updated: new Date().toISOString().slice(0, 10), divs: divs };
        lsSet("rankings", cache.ranks);
        paintRanks();
      }
    } catch (e) { /* snapshot stays */ }
  }
  function paintRanks() {
    var divs = rankData();
    var chips = $("#rankChips"), body = $("#rankBody");
    if (!chips || !body) return;
    if (!divs.length) { body.innerHTML = skel(1); return; }
    if (!divs.filter(function (d) { return d.div === state.rankDiv; }).length) state.rankDiv = divs[0].div;
    chips.innerHTML = divs.map(function (d) {
      return '<button class="vchip' + (d.div === state.rankDiv ? " on" : "") + '" data-rd="' + esc(d.div) + '">' + esc(RANK_SHORT[d.div] || d.div) + "</button>";
    }).join("");
    $$("#rankChips .vchip").forEach(function (b) {
      b.onclick = function () { state.rankDiv = b.dataset.rd; paintRanks(); };
    });
    var cur = divs.filter(function (d) { return d.div === state.rankDiv; })[0];
    var html = "";
    if (cur.champ) {
      var cf = rosterByName(cur.champ.name);
      html += '<button class="rkRow rkChamp" data-slug="' + esc(cur.champ.slug) + '" data-name="' + esc(cur.champ.name) + '">' +
        '<span class="rkCrown">👑</span><span><div class="cardT">' + esc(cur.champ.name) + (cf ? " ⭐" : "") + "</div>" +
        '<div class="cardM">CHAMPION • ' + esc(cur.div) + "</div></span></button>";
    }
    html += cur.list.map(function (x) {
      var f = rosterByName(x.name);
      return '<button class="rkRow" data-slug="' + esc(x.slug) + '" data-name="' + esc(x.name) + '">' +
        '<span class="rkNum">' + x.rank + "</span>" +
        "<span><div class=\"cardT\" style=\"font-size:14.5px\">" + esc(x.name) + (f ? " ⭐" : "") + "</div></span></button>";
    }).join("");
    body.innerHTML = html;
    $$("#rankBody .rkRow").forEach(function (b) {
      b.onclick = function () {
        var f = rosterByName(b.dataset.name);
        if (f) openFighter(f.id);
        else window.open("https://www.ufc.com/athlete/" + b.dataset.slug, "_blank", "noopener");
      };
    });
  }

  /* ---------- HEAD-TO-HEAD ---------- */
  function h2hOptions(sel, except) {
    var el = $(sel);
    if (!el) return;
    el.innerHTML = D.fighters.map(function (f) {
      return '<option value="' + esc(f.id) + '">' + esc(f.name) + " (" + f.rec.w + "-" + f.rec.l + ")</option>";
    }).join("");
    if (except) el.value = except;
  }
  function streakOf(f) {
    var s = "", n = 0;
    for (var i = 0; i < (f.last || []).length; i++) {
      var r = f.last[i].res;
      if (i === 0) s = r;
      if (r === s) n++;
      else break;
    }
    return s ? s + "x" + n : "—";
  }
  function finishPct(f) {
    var t = Math.max(1, f.rec.w);
    return Math.round(((f.rec.ko + f.rec.sub) / t) * 100);
  }
  function inches(h) {
    var m = /(\d+)'(\d+)/.exec(h || "");
    return m ? (+m[1]) * 12 + (+m[2]) : 0;
  }
  function compareH2H() {
    var a = fighterById($("#h2hA").value), b = fighterById($("#h2hB").value);
    var out = $("#h2hOut");
    if (!a || !b || a.id === b.id) { out.innerHTML = '<div class="dim">Pick two different fighters.</div>'; return; }
    function edge(av, bv) { return av === bv ? "" : (av > bv ? " ★" : ""); }
    var aH = inches(a.height), bH = inches(b.height);
    var aR = parseFloat(a.reach) || 0, bR = parseFloat(b.reach) || 0;
    var aF = finishPct(a), bF = finishPct(b);
    var rows = [
      ["Record", a.rec.w + "-" + a.rec.l + (a.rec.d ? "-" + a.rec.d : ""), b.rec.w + "-" + b.rec.l + (b.rec.d ? "-" + b.rec.d : "")],
      ["Age", a.age + (a.age < b.age ? " ★" : ""), b.age + (b.age < a.age ? " ★" : "")],
      ["Height", a.height + edge(aH, bH), b.height + edge(bH, aH)],
      ["Reach", a.reach + edge(aR, bR), b.reach + edge(bR, aR)],
      ["Stance", a.stance, b.stance],
      ["KO wins", a.rec.ko, b.rec.ko],
      ["Sub wins", a.rec.sub, b.rec.sub],
      ["Finish rate", aF + "%" + edge(aF, bF), bF + "%" + edge(bF, aF)],
      ["Form (latest first)", (a.last || []).map(function (x) { return x.res; }).join(" ") || "—", (b.last || []).map(function (x) { return x.res; }).join(" ") || "—"],
      ["Streak", streakOf(a), streakOf(b)]
    ];
    var an = {}, commons = [];
    (a.last || []).forEach(function (x) { an[normName(x.opp)] = x.opp; });
    (b.last || []).forEach(function (x) {
      var k = normName(x.opp);
      if (an[k]) commons.push(an[k]);
    });
    var commonHtml = "";
    if (commons.length) {
      var detail = commons.map(function (c) { return esc(c); }).join(", ");
      commonHtml = '<div class="cardS" style="margin-top:10px"><b>Shared recent opponents:</b> ' + detail + "</div>";
    }
    out.innerHTML =
      '<div class="fGrid" style="grid-template-columns:1fr 1fr">' +
      [a, b].map(function (f) {
        return '<div class="card" style="margin:0">' +
          (f.img ? '<img class="wphoto" style="height:130px" loading="lazy" src="' + esc(f.img) + '" alt="">' : "") +
          '<div class="fName" style="margin-top:6px">' + esc(f.name) + "</div>" +
          '<div class="fMeta">' + esc(f.div) + " • " + esc(f.rank) + "</div></div>";
      }).join("") + "</div>" +
      '<div style="margin-top:10px">' + rows.map(function (r) {
        return '<div class="resH" style="margin-top:10px">' + esc(r[0]) + "</div>" +
          '<div class="res" style="border-top:none;padding-top:2px"><span>' + esc(String(r[1])) + "</span><span style=\"text-align:right\">" + esc(String(r[2])) + "</span></div>";
      }).join("") + "</div>" + commonHtml +
      '<div class="row"><button class="btn sm ghost" id="h2hSwap">⇄ Swap</button></div>';
    $("#h2hSwap").onclick = function () {
      var v = $("#h2hA").value;
      $("#h2hA").value = $("#h2hB").value;
      $("#h2hB").value = v;
      compareH2H();
    };
  }

  /* ---------- boot ---------- */
  function vKind(t) {
    t = (t || "").toLowerCase();
    if (/full fight|free fight|marathon/.test(t)) return "full";
    if (/interview|press conference|weigh-in|weigh in|media day|countdown|embedded|road to|prank|reacts/.test(t)) return "talk";
    return "hl";
  }
  function vKindLabel(k) {
    return k === "full" ? ["full", "FULL FIGHT"] : k === "talk" ? ["talk", "INTERVIEW / SHOW"] : ["hl", "HIGHLIGHT"];
  }
  async function fetchUfcRss() {
    var ctl = new AbortController();
    var to = setTimeout(function () { ctl.abort(); }, 14000);
    var r = await liveFetch()(window.UFC_VIDEOS.rss, { signal: ctl.signal, headers: { Accept: "application/xml" } });
    clearTimeout(to);
    if (!r.ok) throw new Error("http " + r.status);
    var xml = new DOMParser().parseFromString(await r.text(), "text/xml");
    var items = [];
    xml.querySelectorAll("entry").forEach(function (e) {
      var idEl = e.getElementsByTagNameNS("*", "videoId")[0];
      var tEl = e.getElementsByTagName("title")[0];
      var pEl = e.getElementsByTagName("published")[0];
      if (idEl && tEl) items.push({ id: idEl.textContent, title: tEl.textContent, date: pEl ? pEl.textContent.slice(0, 10) : "" });
    });
    return items;
  }
  async function loadVideos() {
    paintVideos();
    if (videos.list.length) return;
    videos.list = (window.UFC_VIDEOS && window.UFC_VIDEOS.snapshot || []).slice();
    paintVideos();
    try {
      var items = await fetchUfcRss();
      if (items.length) { videos.list = items; archiveVideos(items); paintVideos(); checkAlerts(); }
    } catch (e) { /* snapshot stays */ }
  }
  function archiveVideos(items) {
    try {
      var v = lsGet("varchive");
      var arch = (v && v.data) || [];
      var have = {};
      arch.forEach(function (x) { have[x.id] = 1; });
      items.forEach(function (x) { if (!have[x.id]) { have[x.id] = 1; arch.unshift({ id: x.id, title: x.title, date: x.date }); } });
      lsSet("varchive", arch.slice(0, 120));
    } catch (e) {}
  }
  function classicVideos() {
    var arch = [];
    try { var v = lsGet("varchive"); arch = (v && v.data) || []; } catch (e) {}
    var cur = {};
    videos.list.forEach(function (x) { cur[x.id] = 1; });
    return arch.filter(function (x) { return !cur[x.id]; });
  }
  function paintVideos() {
    $$("#vChips .vchip").forEach(function (b) {
      b.classList.toggle("on", b.dataset.vf === state.vf);
      if (!b._wired) { b._wired = true; b.onclick = function () { state.vf = b.dataset.vf; paintVideos(); }; }
    });
    $$("#vScope .scopeBtn").forEach(function (b) {
      b.classList.toggle("on", b.dataset.vs === state.vScope);
      if (!b._wired) { b._wired = true; b.onclick = function () { state.vScope = b.dataset.vs; paintVideos(); }; }
    });
    var box = $("#videoGrid");
    if (!box) return;
    var pool = state.vScope === "classics" ? classicVideos() : videos.list;
    var list = pool.filter(function (v) { return state.vf === "all" || vKind(v.title) === state.vf; });
    if (state.vScope === "classics" && !classicVideos().length) {
      box.innerHTML = '<div class="card"><div class="cardS">No classics saved yet — they build up automatically as new uploads arrive. Check back after the next event.</div></div>';
      return;
    }
    if (!list.length) { box.innerHTML = skel(3); return; }
    box.innerHTML = list.map(function (v) {
      var k = vKindLabel(vKind(v.title));
      return '<button class="vcard" data-vid="' + esc(v.id) + '">' +
        '<span class="vthumb"><img loading="lazy" src="https://i.ytimg.com/vi/' + esc(v.id) + '/hqdefault.jpg" alt="">' +
        '<span class="vplay">▶</span>' + (vKind(v.title) === "full" ? '<span class="vlen">FULL</span>' : "") + "</span>" +
        '<span><span class="vTag ' + k[0] + '">' + k[1] + "</span>" +
        '<div class="cardT" style="font-size:14px">' + esc(v.title) + "</div>" +
        '<div class="cardM">' + esc(v.date ? fmtDate(v.date) : "UFC official") + "</div></span></button>";
    }).join("");
    $$(".vcard", box).forEach(function (c) { c.onclick = function () { playVideo(c.dataset.vid); }; });
  }
  function ytBlocked() { try { return sessionStorage.getItem("ytEmbedBlocked") === "1"; } catch (e) { return false; } }
  function setYtBlocked() { try { sessionStorage.setItem("ytEmbedBlocked", "1"); } catch (e) {} }
  function playVideo(id) {
    videos.playing = id;
    $("#videoPlayer").hidden = false;
    $("#vYTLink").href = "https://www.youtube.com/watch?v=" + id;
    if (ytBlocked()) { showWatchHandoff(id); return; }
    var spin = $("#vSpin");
    if (spin) spin.hidden = false;
    var err = $("#vErr");
    if (err) err.hidden = true;
    var vw = $("#vWatch");
    if (vw) vw.hidden = true;
    var vf = document.querySelector("#videoPlayer .vFrame");
    if (vf) vf.hidden = false;
    if (window.YT && window.YT.Player && ytPlayer) {
      try { ytPlayer.loadVideoById(id); }
      catch (e) { rawSetVideo(id); }
    } else {
      rawSetVideo(id);
      ensureYTApi(attachYTPlayer);
    }
    $("#videoPlayer").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function showWatchHandoff(id) {
    var v = (videos.list || []).filter(function (x) { return x.id === id; })[0] || {};
    var vf = document.querySelector("#videoPlayer .vFrame");
    if (vf) vf.hidden = true;
    var s = $("#vSpin"); if (s) s.hidden = true;
    var e = $("#vErr"); if (e) e.hidden = true;
    var t = $("#vWatchThumb"); if (t) t.src = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
    var tt = $("#vWatchTitle"); if (tt) tt.textContent = v.title || "UFC video";
    var l = $("#vWatchLink"); if (l) l.href = "https://www.youtube.com/watch?v=" + id;
    var w = $("#vWatch"); if (w) w.hidden = false;
  }
  function rawSetVideo(id) {
    var origin = "";
    try { origin = "&origin=" + encodeURIComponent(window.location.origin); } catch (e) {}
    $("#vFrame").src = "https://www.youtube.com/embed/" + id + "?autoplay=1&rel=0&playsinline=1&enablejsapi=1" + origin;
  }
  var ytPlayer = null, ytApiLoading = false, ytReadyCbs = [];
  try {
    window.onYouTubeIframeAPIReady = function () {
      ytReadyCbs.forEach(function (cb) { try { cb(); } catch (e) {} });
      ytReadyCbs = [];
    };
  } catch (e) {}
  function ensureYTApi(cb) {
    if (window.YT && window.YT.Player) { try { cb(); } catch (e2) {} return; }
    ytReadyCbs.push(cb);
    if (ytApiLoading) return;
    ytApiLoading = true;
    try {
      var s = document.createElement("script");
      s.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(s);
    } catch (e3) {}
  }
  function attachYTPlayer() {
    if (ytPlayer || !document.querySelector("#vFrame")) return;
    try {
      ytPlayer = new window.YT.Player("vFrame", {
        events: {
          onReady: function () { var s = $("#vSpin"); if (s) s.hidden = true; },
          onStateChange: function (ev) {
            if (window.YT && ev.data === window.YT.PlayerState.PLAYING) {
              try { sessionStorage.removeItem("ytEmbedBlocked"); } catch (e3) {}
              var s = $("#vSpin"); if (s) s.hidden = true;
              var e = $("#vErr"); if (e) e.hidden = true;
            }
          },
          onError: function (ev) {
            setYtBlocked();
            if (videos.playing) showWatchHandoff(videos.playing);
          }
        }
      });
    } catch (e) {}
  }
  function boot() {
    $$(".tabBtn").forEach(function (b) { b.onclick = function () { switchTab(b.dataset.tab); }; });
    var bell = $("#bellBtn");
    if (bell) bell.onclick = openAlerts;
    var vfr = $("#vFrame");
    if (vfr) vfr.addEventListener("load", function () { var s = $("#vSpin"); if (s) s.hidden = true; });
    $$(".segBtn").forEach(function (b) { b.onclick = function () { state.evMode = b.dataset.mode; renderEvents(); }; });
    $$(".chipBtn").forEach(function (b) { b.onclick = function () { state.fStatus = b.dataset.st; renderFighters(); }; });
    var qs = $("#fSearch"), ds = $("#fDivSel");
    if (qs) qs.addEventListener("input", function () { state.fQ = qs.value; renderFighters(); });
    if (ds) ds.addEventListener("change", function () { state.fDiv = ds.value; renderFighters(); });
    $("#modalClose").onclick = closeModal;
    $("#modal").addEventListener("click", function (e) { if (e.target.id === "modal") closeModal(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeModal(); });
    $("#refreshBtn").onclick = function () {
      cache.feedLoaded = false; cache.eventsLoaded = false;
      cache.espnEvents = null; cache.espnNews = null; cache.reddit = null;
      lsDel("news"); lsDel("reddit"); lsDel("events2"); lsDel("rumors");
      if (state.tab === "feed") loadFeed();
      if (state.tab === "events") loadEvents();
    };
    // Revalidate stale feeds when the app comes back into view,
    // and every 30 min while open (12h freshness policy).
    document.addEventListener("visibilitychange", function () {
      if (document.hidden || state.tab !== "feed" || !cache.feedLoaded) return;
      var n = lsGet("news"), r = lsGet("reddit"), m = lsGet("rumors");
      if ((n && !isFresh(n.ts)) || (r && !isFresh(r.ts)) || (m && !isFresh(m.ts))) loadFeed();
    });
    setInterval(function () {
      if (document.hidden || state.tab !== "feed" || !cache.feedLoaded) return;
      var n = lsGet("news"), r = lsGet("reddit"), m = lsGet("rumors");
      if ((n && !isFresh(n.ts)) || (r && !isFresh(r.ts)) || (m && !isFresh(m.ts))) loadFeed();
      else checkAlerts();
    }, 30 * 60 * 1000);
    bindSearch();
    runSearch("");
    var gear = $("#gearBtn");
    if (gear) gear.onclick = openOnboard;
    var ep = $("#editPicksBtn");
    if (ep) ep.onclick = openOnboard;
    $("#obSave").onclick = function () { closeOnboard(true); };
    $("#obSkip").onclick = function () { closeOnboard(false); };
    h2hOptions("#h2hA", "topuria");
    h2hOptions("#h2hB", "makhachev");
    var hg = $("#h2hGo");
    if (hg) hg.onclick = compareH2H;
    switchTab("feed");
    paintGreeting();
    setTimeout(function () { var bo = $("#bootOverlay"); if (bo) bo.classList.add("gone"); }, 600);
    if (!getProfile()) setTimeout(openOnboard, 900);
  }
  if (document.readyState !== "loading") boot();
  else document.addEventListener("DOMContentLoaded", boot);
})();
