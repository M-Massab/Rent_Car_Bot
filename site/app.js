(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const pkr = (n) => "PKR " + Number(n).toLocaleString("en-US");
  const CAT = { hatchback: "Hatchback", sedan: "Sedan", suv: "SUV", luxury: "Luxury sedan", van: "Van", bus: "Minibus" };
  const ICON = { hatchback: "i-hatchback", sedan: "i-sedan", luxury: "i-sedan", suv: "i-suv", van: "i-van", bus: "i-bus" };
  const FILTERS = [
    { id: "all", label: "All", cats: null },
    { id: "small", label: "Hatchbacks", cats: ["hatchback"] },
    { id: "sedan", label: "Sedans", cats: ["sedan"] },
    { id: "suv", label: "SUVs", cats: ["suv"] },
    { id: "lux", label: "Luxury", cats: ["luxury"] },
    { id: "group", label: "Vans and buses", cats: ["van", "bus"] },
  ];
  const state = { mode: "driver", filter: "all", cfg: null, fleet: [] };

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid);
    return el;
  }
  const icon = (id) => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#" + id);
    svg.append(use);
    return svg;
  };
  const getJSON = async (u) => {
    const r = await fetch(u);
    if (!r.ok) throw new Error(u + " " + r.status);
    return r.json();
  };
  const waLink = (text) => `https://wa.me/${state.cfg.whatsapp}?text=${encodeURIComponent(text)}`;

  function bindConfig(cfg) {
    document.querySelectorAll("[data-bind]").forEach((el) => (el.textContent = cfg[el.dataset.bind] ?? ""));
    document.querySelectorAll("[data-wa]").forEach((el) => (el.href = waLink(el.dataset.wa)));
    const tel = $("[data-bind-tel]"), mail = $("[data-bind-mail]");
    tel.href = "tel:" + cfg.phone.replace(/\s+/g, ""); tel.textContent = cfg.phone;
    mail.href = "mailto:" + cfg.email; mail.textContent = cfg.email;
    $("#demo-notice").textContent = cfg.demo_notice || "";
  }

  function renderPlate() {
    const sd = state.fleet.filter((c) => c.self_drive_day != null).sort((a, b) => a.self_drive_day - b.self_drive_day)[0];
    if (!sd) return;
    $("#plate-cap").textContent = sd.name;
    $("#plate-price").textContent = pkr(sd.self_drive_day);
    $("#plate").hidden = false;
  }

  function renderChips() {
    const box = $("#chips");
    box.replaceChildren(...FILTERS.map((f) => {
      const b = h("button", { type: "button", class: "chip", "aria-pressed": String(state.filter === f.id), text: f.label });
      b.addEventListener("click", () => { state.filter = f.id; renderChips(); renderFleet(); });
      return b;
    }));
  }

  function carCard(c) {
    const cfg = state.cfg, ch = cfg.charges, drv = state.mode === "driver";
    const price = drv ? c.with_driver_day : c.self_drive_day;
    const lines = drv
      ? [`Includes ${cfg.with_driver_package.hours} hours, ${cfg.with_driver_package.km} km and fuel`,
         `Extra hour ${pkr(c.extra_hour)}, extra km ${pkr(c.extra_km)}`,
         `Outstation ${pkr(c.outstation_day)} a day, ${cfg.outstation_package.km_per_day} km included`]
      : [`${ch.self_drive_km_per_day} km a day included, fuel not included`,
         `Extra km ${pkr(ch.self_drive_extra_km)}`,
         `Refundable deposit ${pkr(ch.deposit[c.category])}`];
    const q = `Hello, I would like to rent the ${c.name} ${drv ? "with a driver" : "self-drive"}.`;
    const link = h("a", { class: "car-link", href: waLink(q), target: "_blank", rel: "noopener", text: "Ask about this car on WhatsApp" });
    return h("article", { class: "car" },
      h("div", { class: "car-art" }, icon(ICON[c.category]), h("span", { class: "car-cat", text: CAT[c.category] })),
      h("div", { class: "car-body" },
        h("h3", { text: `${c.name} (${c.year})` }),
        h("p", { class: "car-meta", text: `${c.seats} seats, ${c.bags} ${c.bags === 1 ? "bag" : "bags"}, ${c.transmission}, ${c.fuel}` }),
        h("div", { class: "car-price" }, h("strong", { text: pkr(price) }), h("span", { text: drv ? "per day with driver" : "per day, self-drive" })),
        h("ul", { class: "car-list" }, lines.map((t) => h("li", { text: t }))),
        h("p", { class: "car-best", text: `Best for ${c.best_for}.` }),
        link));
  }

  function renderFleet() {
    const f = FILTERS.find((x) => x.id === state.filter);
    let cars = state.fleet.filter((c) => !f.cats || f.cats.includes(c.category));
    const driverOnly = state.fleet.filter((c) => c.self_drive_day == null);
    if (state.mode === "self") cars = cars.filter((c) => c.self_drive_day != null);
    $("#mode-note").textContent = state.mode === "self"
      ? `Self-drive needs a CNIC, a licence held for 2 years or more, and age 25 or over. ${driverOnly.map((c) => c.short).join(", ")} are rented with a driver only.`
      : "Driver, fuel and the city package are included. Tolls and parking are paid by the customer.";
    const grid = $("#fleet-grid");
    grid.replaceChildren(...(cars.length ? cars.map(carCard) : [h("p", { class: "note", text: "No cars match this choice. Try another type." })]));
  }

  function renderCharges() {
    const c = state.cfg.charges, a = c.airport_transfer;
    const rows = [
      ["Airport transfer, one way (sedan, SUV, Hiace)", `${pkr(a.sedan)}, ${pkr(a.suv)}, ${pkr(a.van)}`],
      ["Airport waiting after landing", `${c.airport_waiting_free_minutes} min free, then ${pkr(c.airport_waiting_per_30min)} per 30 min`],
      ["Driver night allowance outside Lahore", `${pkr(c.driver_night_allowance)} a night`],
      ["Self-drive deposit (hatchback, sedan, SUV)", `${pkr(c.deposit.hatchback)}, ${pkr(c.deposit.sedan)}, ${pkr(c.deposit.suv)}`],
      ["Self-drive late return, after a " + c.late_return_grace_hours + " hour grace", `${pkr(c.late_return_per_hour)} an hour`],
      ["Child seat", `${pkr(c.child_seat_per_day)} a day`],
      ["Wedding car decoration", `${pkr(c.wedding_decoration)} per car`],
      ["Weekly (7 days or more) and monthly (30 days or more) discount", `${c.weekly_discount_pct} and ${c.monthly_discount_pct} percent off`],
      ["Eid holiday surcharge", `${c.eid_surcharge_pct} percent`],
      ["Advance to confirm a booking", `${c.advance_pct} percent`],
    ];
    $("#charges-list").replaceChildren(...rows.map(([k, v]) => h("div", {}, h("dt", { text: k }), h("dd", { text: v }))));
  }

  function renderFaq(items) {
    const box = $("#faq-list");
    box.replaceChildren(...items.map((it) => {
      const d = h("details", {}, h("summary", { dir: "auto", text: it.question }), h("div", { class: "faq-a" }, h("p", { dir: "auto", text: it.answer })));
      return d;
    }));
  }

  function wireControls() {
    document.querySelectorAll(".seg-btn").forEach((b) =>
      b.addEventListener("click", () => {
        state.mode = b.dataset.mode;
        document.querySelectorAll(".seg-btn").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        renderFleet();
      }));
  }

  async function init() {
    try {
      const [cfg, fleet, faq] = await Promise.all([getJSON("/api/config"), getJSON("/api/fleet"), getJSON("/api/faq")]);
      Object.assign(state, { cfg, fleet });
      bindConfig(cfg); renderPlate(); renderChips(); wireControls(); renderFleet(); renderCharges(); renderFaq(faq);
    } catch (e) {
      $("#fleet-grid").replaceChildren(h("p", { class: "note", text: "The fleet could not be loaded. Please refresh, or message us on WhatsApp." }));
      console.error(e);
    }
  }
  init();
})();
