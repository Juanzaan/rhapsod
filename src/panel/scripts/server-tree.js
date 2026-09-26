function spacerText(name) {
  var m = /^\[\*?(?:[crl]?spacer)\d*\](.*)$/i.exec(name || "");
  if (!m) return null;
  var rest = (m[1] || "").trim();
  if (rest.length === 0 || /^[^a-z0-9]+$/i.test(rest)) return "";
  return rest;
}
function isSpacer(name) {
  return spacerText(name) !== null;
}
function serverTreeHtml(view, opts) {
  opts = opts || {};
  var interactive = opts.interactive !== false;
  var collapsed = opts.collapsed || {};
  var chs = (view && view.channels) || [];
  var cls = (view && view.clients) || [];
  var bot = (view && view.botChannelId) || 0;
  var byId = {};
  var gi;
  for (gi = 0; gi < chs.length; gi++) {
    byId[chs[gi].cid] = chs[gi];
  }
  // Spacers cannot hold channels: subchannels of a spacer render under
  // the spacer's own parent so hiding decoration never hides music.
  var effParent = function (c) {
    var p = c.parentCid;
    var guard = {};
    guard[c.cid] = true;
    while (p && byId[p] && !guard[p]) {
      guard[p] = true;
      if (!isSpacer(byId[p].name)) return p;
      p = byId[p].parentCid;
    }
    return 0;
  };
  var byParent = {};
  for (var i = 0; i < chs.length; i++) {
    var c = chs[i];
    var p = effParent(c);
    if (!byParent[p]) byParent[p] = [];
    byParent[p].push(c);
  }
  // channel_order is the cid below which a channel sorts (0 first), not
  // a position number: resolve every sibling group as a chain. Stale
  // links, cycles and missing order fall back to name, then cid.
  var nameCmp = function (a, b) {
    var r = String(a.name || "").localeCompare(String(b.name || ""), "es");
    if (r !== 0) return r;
    return (a.cid || 0) - (b.cid || 0);
  };
  var chainGroup = function (kids) {
    var ordered = kids.slice().sort(nameCmp);
    var group = {};
    var g;
    for (g = 0; g < ordered.length; g++) {
      group[ordered[g].cid] = ordered[g];
    }
    var next = {};
    var heads = [];
    var h;
    for (h = 0; h < ordered.length; h++) {
      var ch = ordered[h];
      var o =
        typeof ch.order === "number" && isFinite(ch.order) ? ch.order : -1;
      if (o === 0) {
        heads.push(ch);
      } else if (o > 0 && o !== ch.cid && group[o]) {
        (next[o] || (next[o] = [])).push(ch);
      }
    }
    var placed = {};
    var out = [];
    var follow = function (start) {
      var cur = start;
      var guard = 0;
      while (cur && !placed[cur.cid] && guard <= ordered.length) {
        guard++;
        placed[cur.cid] = true;
        out.push(cur);
        var cands = next[cur.cid] || [];
        var n = 0;
        while (n < cands.length && placed[cands[n].cid]) {
          n++;
        }
        cur = n < cands.length ? cands[n] : undefined;
      }
    };
    for (h = 0; h < heads.length; h++) {
      follow(heads[h]);
    }
    for (h = 0; h < ordered.length; h++) {
      if (!placed[ordered[h].cid]) {
        follow(ordered[h]);
      }
    }
    return out;
  };
  var pids = Object.keys(byParent);
  for (var k = 0; k < pids.length; k++) {
    byParent[pids[k]] = chainGroup(byParent[pids[k]]);
  }
  var byChannel = {};
  var total = 0;
  for (var j = 0; j < cls.length; j++) {
    var u = cls[j];
    if (!byChannel[u.cid]) byChannel[u.cid] = [];
    byChannel[u.cid].push(u);
    total++;
  }
  var seen = {};
  var rowHtml = function (ch, us, here, hasKids) {
    var h = '<div class="chrow' + (here ? " here" : "") + '">';
    h += '<div class="chhead">';
    if (interactive) {
      h +=
        '<button type="button" class="chev' +
        (hasKids ? (collapsed[ch.cid] ? " closed" : "") : " leaf") +
        '" aria-label="Mostrar subcanales" aria-expanded="' +
        !collapsed[ch.cid] +
        '" onclick="toggleCh(event,' +
        ch.cid +
        ')">›</button>';
    }
    h +=
      '<button type="button" class="channel-move" onclick="moveBot(' +
      ch.cid +
      ')" title="Mover el bot a este canal"><span class="channel-symbol" aria-hidden="true">#</span><span class="chnm">' +
      esc(ch.name) +
      "</span></button>" +
      (here ? '<span class="botpill">BOT</span>' : "") +
      '<span class="chct">' +
      (us.length ? us.length : "Vacío") +
      "</span></div>";
    if (us.length > 0) {
      h += '<ul class="users">';
      for (var u = 0; u < us.length; u++) {
        h +=
          '<li style="--h:' +
          (typeof hashHue === "function"
            ? hashHue(String(us[u].name || "").toLowerCase())
            : 110) +
          '">' +
          esc(us[u].name) +
          "</li>";
      }
      h += "</ul>";
    }
    return h + "</div>";
  };
  var walk = function (pid, depth) {
    var out = "";
    var kids = byParent[pid] || [];
    for (var q = 0; q < kids.length; q++) {
      var ch = kids[q];
      if (seen[ch.cid]) continue;
      seen[ch.cid] = true;
      if (depth > 8) continue;
      var sp = spacerText(ch.name);
      if (sp !== null) {
        if (sp !== "") {
          out += '<div class="spacer">' + esc(sp) + "</div>";
        }
        continue;
      }
      out += rowHtml(
        ch,
        byChannel[ch.cid] || [],
        ch.cid === bot,
        (byParent[ch.cid] || []).length > 0,
      );
      var inner = walk(ch.cid, depth + 1);
      if (inner !== "") {
        out +=
          '<div class="kids" data-kids="' +
          ch.cid +
          '"' +
          (collapsed[ch.cid] ? ' style="display:none"' : "") +
          ">" +
          inner +
          "</div>";
      }
    }
    return out;
  };
  var html = walk(0, 0);
  for (var remaining = 0; remaining < chs.length; remaining++) {
    var orphan = chs[remaining];
    if (!seen[orphan.cid]) {
      seen[orphan.cid] = true;
      var osp = spacerText(orphan.name);
      if (osp !== null) {
        if (osp !== "") {
          html += '<div class="spacer">' + esc(osp) + "</div>";
        }
        continue;
      }
      html += rowHtml(
        orphan,
        byChannel[orphan.cid] || [],
        orphan.cid === bot,
        false,
      );
      html += walk(orphan.cid, 0);
    }
  }
  return { html: html, total: total };
}
