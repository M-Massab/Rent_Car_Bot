(() => {
  "use strict";
  const MAX_LEN = 500, MAX_HISTORY = 10;
  const SUGGESTIONS = [
    "How much is a Corolla per day?",
    "What do I need for self-drive?",
    "Murree jane ka kiraya kitna hai?",
    "کیا ڈرائیور کے بغیر گاڑی مل سکتی ہے؟",
  ];
  const history = [];
  let cfg = null, busy = false, lastOpener = null;

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(typeof kid === "string" ? document.createTextNode(kid) : kid);
    return el;
  }

  // Model output is rendered as text nodes only: **bold**, "- " bullets and [n] markers. Never innerHTML.
  function inline(s) {
    return s.split(/(\*\*[^*]+\*\*|\[\d+\])/).filter(Boolean).map((part) => {
      if (/^\*\*[^*]+\*\*$/.test(part)) return h("strong", { text: part.slice(2, -2) });
      if (/^\[\d+\]$/.test(part)) return h("span", { class: "cite", text: part });
      return part;
    });
  }
  function renderRich(box, text) {
    let ul = null;
    for (const line of text.split("\n")) {
      const m = line.match(/^\s*[-•*]\s+(.*)$/);
      if (m) {
        if (!ul) { ul = h("ul", { dir: "auto" }); box.append(ul); }
        ul.append(h("li", { dir: "auto" }, inline(m[1])));
      } else {
        ul = null;
        if (line.trim()) box.append(h("p", { dir: "auto" }, inline(line)));
      }
    }
  }

  const waLink = (t) => `https://wa.me/${cfg.whatsapp}?text=${encodeURIComponent(t)}`;

  const fab = h("button", { type: "button", class: "chat-fab", "aria-haspopup": "dialog", "aria-expanded": "false" },
    (() => { const s = document.createElementNS("http://www.w3.org/2000/svg", "svg"); s.setAttribute("viewBox", "0 0 24 24"); s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2"); s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", "M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z"); s.append(p); return s; })(),
    "Ask a question");
  const closeBtn = h("button", { type: "button", class: "chat-x", "aria-label": "Close chat", text: "×" });
  const demoBar = h("div", { class: "chat-demo", hidden: true });
  const log = h("div", { class: "chat-log", role: "log", "aria-live": "polite", "aria-label": "Conversation" });
  const suggest = h("div", { class: "suggest" });
  const input = h("textarea", { rows: "1", maxlength: String(MAX_LEN), placeholder: "Type your question", "aria-label": "Your question", dir: "auto" });
  const sendBtn = h("button", { type: "submit", text: "Send" });
  const form = h("form", { class: "chat-form" }, input, sendBtn);
  const panel = h("section", { class: "chat", role: "dialog", "aria-modal": "false", "aria-labelledby": "chat-title", "data-open": "false" },
    h("div", { class: "chat-head" }, h("h2", { id: "chat-title" }, "Ask about our cars", h("small", { text: "Answers come from our rates and policies" })), closeBtn),
    demoBar, log, suggest, form,
    h("p", { class: "chat-foot", text: "Prices are estimates. Our team confirms every booking on WhatsApp." }));
  document.body.append(fab, panel);

  function scrollDown() { log.scrollTop = log.scrollHeight; }
  function addMsg(kind, text, extras) {
    const m = h("div", { class: "msg " + kind });
    renderRich(m, text);
    if (extras) m.append(...extras);
    log.append(m); scrollDown();
    return m;
  }
  function typing() {
    const t = h("div", { class: "msg bot", role: "status", "aria-label": "Assistant is typing" }, h("span", { class: "typing" }, h("i"), h("i"), h("i")));
    log.append(t); scrollDown();
    return t;
  }
  function handoffBtn(question) {
    return h("a", { class: "btn handoff", href: waLink(`Hello, I asked on your website: "${question}"`), target: "_blank", rel: "noopener", text: "Continue on WhatsApp" });
  }

  async function send(raw) {
    const text = raw.trim();
    if (!text || busy) return;
    busy = true; sendBtn.disabled = true; suggest.hidden = true;
    addMsg("user", text);
    input.value = ""; autosize();
    const wait = typing();
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history: history.slice(-MAX_HISTORY) }),
      });
      wait.remove();
      if (res.status === 429) { addMsg("err", "You are sending messages too quickly. Wait a minute, then try again."); return; }
      if (res.status === 422) { addMsg("err", `Please send a message of 1 to ${MAX_LEN} characters.`); return; }
      if (!res.ok) throw new Error("status " + res.status);
      const data = await res.json();
      const extras = [];
      if (data.sources && data.sources.length) {
        extras.push(h("div", { class: "src", dir: "auto", text: "Sources: " + data.sources.map((s) => `[${s.n}] ${s.title}, ${s.section}`).join("; ") }));
      }
      if (data.handoff) extras.push(h("div", {}, handoffBtn(text)));
      addMsg("bot", data.answer, extras);
      history.push({ role: "user", content: text }, { role: "assistant", content: data.answer });
    } catch (e) {
      wait.remove();
      addMsg("err", "The assistant could not be reached. Check your connection and try again, or message us on WhatsApp.", [h("div", {}, handoffBtn(text))]);
      console.error(e);
    } finally {
      busy = false; sendBtn.disabled = false; input.focus();
    }
  }

  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 110) + "px"; }
  function open() {
    lastOpener = document.activeElement;
    panel.dataset.open = "true"; fab.hidden = true; fab.setAttribute("aria-expanded", "true");
    if (!log.children.length) addMsg("bot", "Assalam o Alaikum. Ask me about rates, cars, documents, airport pickups or trips. English, Urdu and Roman Urdu are fine.");
    input.focus();
  }
  function close() {
    panel.dataset.open = "false"; fab.hidden = false; fab.setAttribute("aria-expanded", "false");
    (lastOpener && document.contains(lastOpener) ? lastOpener : fab).focus();
  }

  fab.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.dataset.open === "true") close(); });
  form.addEventListener("submit", (e) => { e.preventDefault(); send(input.value); });
  input.addEventListener("input", autosize);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(input.value); }
  });
  SUGGESTIONS.forEach((s) => {
    const b = h("button", { type: "button", dir: "auto", text: s });
    b.addEventListener("click", () => send(s));
    suggest.append(b);
  });

  fetch("/api/config").then((r) => r.json()).then((c) => {
    cfg = c;
    if (c.llm_mode === "extractive") {
      demoBar.hidden = false;
      demoBar.textContent = "Demo mode: no AI model is connected, so replies show the closest passage from our information.";
    }
  }).catch(() => { cfg = { whatsapp: "" }; });
})();
