const ICON = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="4" height="4" rx="1" opacity=".35"/><rect x="6" y="1" width="4" height="4" rx="1"/><rect x="11" y="1" width="4" height="4" rx="1" opacity=".6"/><rect x="1" y="6" width="4" height="4" rx="1"/><rect x="6" y="6" width="4" height="4" rx="1" opacity=".6"/><rect x="11" y="6" width="4" height="4" rx="1" opacity=".35"/><rect x="1" y="11" width="4" height="4" rx="1" opacity=".6"/><rect x="6" y="11" width="4" height="4" rx="1" opacity=".35"/><rect x="11" y="11" width="4" height="4" rx="1"/></svg>';

const COLORS = [
	{ key: "emerald", label: "Emerald", value: "#10b981" },
	{ key: "blue", label: "Blue", value: "#3b82f6" },
	{ key: "violet", label: "Violet", value: "#8b5cf6" },
	{ key: "amber", label: "Amber", value: "#f59e0b" },
	{ key: "rose", label: "Rose", value: "#f43f5e" },
];
const FILTERS = [
	{ key: "all", label: "All" },
	{ key: "teach", label: "Teaching" },
	{ key: "practice", label: "Practice" },
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TYPE_NAMES = [["message", "messages"], ["answer", "answers"], ["practice submission", "practice submissions"]];
const DAY_MS = 86400000;

const pad = (n) => String(n).padStart(2, "0");
const keyOf = (date) => date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
const dateOfKey = (key) => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };
const dayNumber = (key) => { const [y, m, d] = key.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / DAY_MS); };
const mondayIndex = (date) => (date.getDay() + 6) % 7;
const plural = (n, [one, many]) => n + " " + (n === 1 ? one : many);
const longDate = (date) => date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });

const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
const FOCUS_GAP_MS = 15 * 60 * 1000;
const number = (n) => n.toLocaleString("en-US");
const duration = (ms) => {
	const minutes = Math.round(ms / 60000);
	if (minutes < 60) return minutes + " min";
	return Math.floor(minutes / 60) + "h " + pad(minutes % 60) + "m";
};
const shortDate = (date) => date.toLocaleDateString("en-US", { month: "short", day: "numeric" });

/** Facts about the learner, recomputed from the event rows on every refresh. */
function computeFacts(events, days, streak, graph) {
	const facts = [];
	if (!events.length) return facts;
	const sorted = events.slice().sort((a, b) => a[0] - b[0]);
	const now = new Date();
	const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayIndex(now)).getTime();
	const lastWeekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayIndex(now) - 7).getTime();

	// Focused time: gaps between consecutive actions, ignoring long breaks.
	let focus = 0, focusWeek = 0;
	for (let i = 1; i < sorted.length; i++) {
		const gap = sorted[i][0] - sorted[i - 1][0];
		if (gap > FOCUS_GAP_MS) continue;
		focus += gap;
		if (sorted[i][0] >= weekStart) focusWeek += gap;
	}
	if (focus >= 60000) facts.push({ label: "Focused time", value: "≈ " + duration(focus),
		detail: focusWeek >= 60000 && focusWeek < focus ? duration(focusWeek) + " of it this week" : "Time between actions, not counting breaks over 15 minutes" });

	// This week against last week.
	let thisWeek = 0, lastWeek = 0;
	for (const [at] of sorted) { if (at >= weekStart) thisWeek++; else if (at >= lastWeekStart) lastWeek++; }
	let weekDetail;
	if (lastWeek === 0) weekDetail = sorted[0][0] >= weekStart ? "Your first tracked week: this is the baseline to beat" : "Nothing last week, so every action is a comeback";
	else if (thisWeek > lastWeek) weekDetail = "Up " + number(thisWeek - lastWeek) + " on last week's " + number(lastWeek);
	else if (thisWeek === lastWeek) weekDetail = "Level with last week. One more puts you ahead";
	else weekDetail = number(lastWeek - thisWeek + 1) + " more to beat last week's " + number(lastWeek);
	facts.push({ label: "This week", value: plural(thisWeek, ["action", "actions"]), detail: weekDetail,
		progress: lastWeek ? Math.min(1, thisWeek / lastWeek) : undefined });

	// Answers and the next milestone.
	const answers = sorted.filter((e) => e[2] === 1).length;
	if (answers) {
		const next = MILESTONES.find((m) => m > answers);
		const previous = [...MILESTONES].reverse().find((m) => m <= answers) || 0;
		facts.push({ label: "Questions answered", value: number(answers),
			detail: next ? number(next - answers) + " more to reach " + number(next) : "Past every milestone on the list",
			progress: next ? (answers - previous) / (next - previous) : 1 });
	}

	// Words written in the learner's own voice.
	const written = sorted.reduce((sum, e) => sum + (e[3] || 0), 0);
	if (written) {
		const pages = written / 300;
		facts.push({ label: "In your own words", value: number(written) + " words",
			detail: pages >= 1 ? "About " + (pages >= 10 ? Math.round(pages) : pages.toFixed(1)) + " pages of your own explanations" : "Typed or dictated while explaining your thinking" });
		const longest = sorted.reduce((top, e) => ((e[3] || 0) > (top[3] || 0) ? e : top), sorted[0]);
		if ((longest[3] || 0) >= 20) facts.push({ label: "Longest answer", value: number(longest[3]) + " words",
			detail: "Written on " + shortDate(new Date(longest[0])) });
	}

	// Knowledge graph size.
	if (graph && graph.propositions) facts.push({ label: "Knowledge graph", value: plural(graph.propositions, ["idea", "ideas"]),
		detail: graph.chains ? plural(graph.chains, ["reasoning chain connects", "reasoning chains connect"]) + " them" : "Collected from your teaching sessions" });

	// Rhythm: when the learner tends to study.
	const hours = new Array(24).fill(0), weekdays = new Array(7).fill(0);
	for (const [at] of sorted) { const d = new Date(at); hours[d.getHours()]++; weekdays[mondayIndex(d)]++; }
	const peakHour = hours.indexOf(Math.max(...hours));
	const peakDay = weekdays.indexOf(Math.max(...weekdays));
	const persona = peakHour >= 5 && peakHour < 9 ? "Early bird" : peakHour < 12 && peakHour >= 9 ? "Morning learner"
		: peakHour >= 12 && peakHour < 17 ? "Afternoon learner" : peakHour >= 17 && peakHour < 21 ? "Evening learner" : "Night owl";
	const fullDays = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
	facts.push({ label: "Your rhythm", value: persona, detail: "Most active around " + pad(peakHour) + ":00, and on " + fullDays[peakDay] });

	// Consistency over the last 30 days.
	const today = dayNumber(keyOf(now));
	let recent = 0;
	for (const key of days.keys()) { const n = dayNumber(key); if (n > today - 30 && n <= today) recent++; }
	const first = new Date(sorted[0][0]);
	const since = today - dayNumber(keyOf(first));
	facts.push({ label: "Last 30 days", value: recent + " of 30 active",
		detail: since === 0 ? "You started today" : "Learning here for " + plural(since + 1, ["day", "days"]) + ", since " + shortDate(first),
		progress: recent / 30 });

	// Streak record.
	if (streak.current > 0) facts.push({ label: "Streak record",
		value: streak.current >= streak.longest ? "Personal best" : plural(streak.longest - streak.current + 1, ["day", "days"]) + " to go",
		detail: streak.current >= streak.longest ? "This " + streak.current + "-day streak is your longest so far" : "Keep going to beat your record of " + plural(streak.longest, ["day", "days"]) });

	// Honest signals.
	const graded = sorted.filter((e) => e[4] === 1 || e[4] === 2).length;
	const correct = sorted.filter((e) => e[4] === 1).length;
	if (graded >= 3) facts.push({ label: "Multiple-choice checks", value: Math.round((correct / graded) * 100) + "% correct",
		detail: "Across " + plural(graded, ["check", "checks"]), progress: correct / graded });
	const unknown = sorted.filter((e) => e[4] === 3).length;
	if (unknown) facts.push({ label: "Honest gaps", value: unknown + "× “I don’t know”",
		detail: "Each one shows the teacher exactly where to start" });
	return facts;
}

function readPref(name, fallback) {
	try { return localStorage.getItem("activity-heatmap:" + name) || fallback; } catch { return fallback; }
}
function writePref(name, value) {
	try { localStorage.setItem("activity-heatmap:" + name, value); } catch { /* preference only */ }
}

function el(tag, className, text, parent) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined && text !== null) node.textContent = text;
	if (parent) parent.append(node);
	return node;
}

function mountHeatmap(ctx, container, signal) {
	let alive = !signal.aborted;
	let data = null;
	let year = new Date().getFullYear();
	let filter = readPref("filter", "all");
	let color = readPref("color", "emerald");
	let selected = null;
	let reloadTimer = null;
	let filtered = [];

	const root = el("div", "lh-heatmap", undefined, container);
	const applyColor = () => {
		const chosen = COLORS.find((c) => c.key === color) || COLORS[0];
		root.style.setProperty("--hm-accent", chosen.value);
	};
	applyColor();

	const toolbar = el("div", "hm-toolbar", undefined, root);
	const nav = el("div", "hm-nav", undefined, toolbar);
	const prev = el("button", "hm-btn hm-icon-btn", "‹", nav); prev.type = "button"; prev.setAttribute("aria-label", "Previous year");
	const yearLabel = el("div", "hm-year", String(year), nav);
	const next = el("button", "hm-btn hm-icon-btn", "›", nav); next.type = "button"; next.setAttribute("aria-label", "Next year");
	const todayBtn = el("button", "hm-btn", "Today", nav); todayBtn.type = "button";

	const segments = el("div", "hm-segments", undefined, toolbar);
	segments.setAttribute("role", "group"); segments.setAttribute("aria-label", "Session type");
	const segmentButtons = FILTERS.map((f) => {
		const b = el("button", "hm-segment", f.label, segments); b.type = "button";
		b.addEventListener("click", () => { filter = f.key; savePrefs(); selected = null; render(); });
		return [f.key, b];
	});

	const swatches = el("div", "hm-swatches", undefined, toolbar);
	swatches.setAttribute("role", "group"); swatches.setAttribute("aria-label", "Heatmap colour");
	const swatchButtons = COLORS.map((c) => {
		const b = el("button", "hm-swatch", undefined, swatches); b.type = "button";
		b.style.background = c.value; b.title = c.label; b.setAttribute("aria-label", c.label + " colour");
		b.addEventListener("click", () => { color = c.key; savePrefs(); applyColor(); syncControls(); });
		return [c.key, b];
	});

	const status = el("p", "hm-status", "Loading your activity…", root);
	const body = el("div", "hm-body", undefined, root);
	const tooltip = el("div", "hm-tooltip", undefined, root); tooltip.hidden = true;

	prev.addEventListener("click", () => { year--; selected = null; render(); });
	next.addEventListener("click", () => { year++; selected = null; render(); });
	todayBtn.addEventListener("click", () => { year = new Date().getFullYear(); selected = keyOf(new Date()); render(); });

	function syncControls() {
		yearLabel.textContent = String(year);
		next.disabled = year >= new Date().getFullYear();
		for (const [key, b] of segmentButtons) b.setAttribute("aria-pressed", String(key === filter));
		for (const [key, b] of swatchButtons) b.setAttribute("aria-pressed", String(key === color));
	}

	/** Bucket the filtered events by local day. */
	function aggregate() {
		const days = new Map();
		filtered = [];
		for (const event of data.events) {
			const [at, sessionIndex, type] = event;
			const session = data.sessions[sessionIndex];
			if (!session || (filter !== "all" && session.kind !== filter)) continue;
			filtered.push(event);
			const date = new Date(at);
			const key = keyOf(date);
			let day = days.get(key);
			if (!day) { day = { total: 0, types: [0, 0, 0], sessions: new Map(), hours: new Array(24).fill(0) }; days.set(key, day); }
			day.total++; day.types[type]++; day.hours[date.getHours()]++;
			day.sessions.set(sessionIndex, (day.sessions.get(sessionIndex) || 0) + 1);
		}
		return days;
	}

	function streaks(days) {
		const numbers = [...days.keys()].map(dayNumber).sort((a, b) => a - b);
		const active = new Set(numbers);
		let longest = 0, run = 0, previous = null;
		for (const n of numbers) {
			run = previous !== null && n === previous + 1 ? run + 1 : 1;
			if (run > longest) longest = run;
			previous = n;
		}
		const today = dayNumber(keyOf(new Date()));
		const doneToday = active.has(today);
		let cursor = doneToday ? today : today - 1, current = 0;
		while (active.has(cursor)) { current++; cursor--; }
		return { current, longest, doneToday };
	}

	function tile(parent, label, value, hint) {
		const box = el("div", "hm-tile", undefined, parent);
		el("div", "hm-tile-label", label, box);
		el("div", "hm-tile-value", value, box);
		if (hint) el("div", "hm-tile-hint", hint, box);
		return box;
	}

	function bars(parent, title, labels, values, describe) {
		const card = el("div", "hm-card", undefined, parent);
		el("h3", "hm-card-title", title, card);
		const chart = el("div", "hm-bars", undefined, card);
		const max = Math.max(1, ...values);
		values.forEach((value, i) => {
			const column = el("div", "hm-bar-col", undefined, chart);
			column.title = describe(i, value);
			const track = el("div", "hm-bar-track", undefined, column);
			const bar = el("div", "hm-bar", undefined, track);
			bar.style.height = (value ? Math.max(4, (value / max) * 100) : 0) + "%";
			el("div", "hm-bar-label", labels[i], column);
		});
	}

	function render() {
		syncControls();
		if (!data) return;
		body.replaceChildren();
		const days = aggregate();
		const todayKey = keyOf(new Date());
		const yearDays = [...days.entries()].filter(([key]) => key.startsWith(year + "-"));
		const yearTotal = yearDays.reduce((sum, [, day]) => sum + day.total, 0);
		const best = yearDays.reduce((top, entry) => (!top || entry[1].total > top[1].total ? entry : top), null);
		const allMax = Math.max(1, ...[...days.values()].map((day) => day.total));
		const streak = streaks(days);

		status.hidden = data.events.length > 0;
		if (!data.events.length) status.textContent = "No activity yet. Answer a question in a session and it will show up here.";

		// Stat tiles
		const tiles = el("div", "hm-tiles", undefined, body);
		tile(tiles, "Current streak", plural(streak.current, ["day", "days"]),
			streak.current === 0 ? "Study today to start one" : streak.doneToday ? "Today is done" : "Study today to keep it");
		tile(tiles, "Longest streak", plural(streak.longest, ["day", "days"]));
		tile(tiles, "Active days in " + year, String(yearDays.length));
		tile(tiles, "Actions in " + year, String(yearTotal),
			yearDays.length ? "≈ " + Math.round(yearTotal / yearDays.length) + " per active day" : undefined);
		tile(tiles, "Best day", best ? String(best[1].total) : "–",
			best ? dateOfKey(best[0]).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : undefined);

		// Heatmap grid
		const card = el("div", "hm-card", undefined, body);
		const scroller = el("div", "hm-scroller", undefined, card);
		const grid = el("div", "hm-grid", undefined, scroller);
		grid.setAttribute("role", "grid"); grid.setAttribute("aria-label", "Activity in " + year);
		[0, 2, 4].forEach((row) => {
			const label = el("div", "hm-weekday", WEEKDAYS[row], grid);
			label.style.gridRow = String(row + 2); label.style.gridColumn = "1";
		});
		const first = new Date(year, 0, 1);
		const offset = mondayIndex(first);
		let lastMonthColumn = -10;
		for (let cursor = new Date(first); cursor.getFullYear() === year; cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1)) {
			const dayOfYear = Math.round((Date.UTC(year, cursor.getMonth(), cursor.getDate()) - Date.UTC(year, 0, 1)) / DAY_MS);
			const column = Math.floor((dayOfYear + offset) / 7) + 2;
			const row = mondayIndex(cursor) + 2;
			const key = keyOf(cursor);
			if (cursor.getDate() === 1 && column - lastMonthColumn >= 3) {
				const month = el("div", "hm-month", MONTHS[cursor.getMonth()], grid);
				month.style.gridRow = "1"; month.style.gridColumn = column + " / span 3";
				lastMonthColumn = column;
			}
			const day = days.get(key);
			const total = day ? day.total : 0;
			const level = total ? Math.min(4, Math.ceil((total / allMax) * 4)) : 0;
			const cell = el("div", "hm-cell hm-l" + level, undefined, grid);
			cell.style.gridRow = String(row); cell.style.gridColumn = String(column);
			cell.dataset.key = key;
			cell.setAttribute("role", "gridcell");
			cell.setAttribute("aria-label", longDate(cursor) + ": " + plural(total, ["action", "actions"]));
			if (key === todayKey) cell.classList.add("hm-today");
			if (key > todayKey) cell.classList.add("hm-future");
			if (key === selected) cell.classList.add("hm-selected");
		}
		const focusCell = grid.querySelector(selected ? ".hm-selected" : ".hm-today");
		if (focusCell && scroller.scrollWidth > scroller.clientWidth) scroller.scrollLeft = focusCell.offsetLeft - scroller.clientWidth / 2;
		const legend = el("div", "hm-legend", undefined, card);
		el("span", undefined, "Less", legend);
		for (let level = 0; level <= 4; level++) el("span", "hm-cell hm-l" + level, undefined, legend);
		el("span", undefined, "More", legend);

		const describeDay = (key) => {
			const day = days.get(key);
			const date = longDate(dateOfKey(key));
			return day ? plural(day.total, ["action", "actions"]) + " on " + date : "Nothing on " + date;
		};
		grid.addEventListener("mouseover", (event) => {
			const cell = event.target.closest && event.target.closest(".hm-cell");
			if (!cell || !cell.dataset.key) { tooltip.hidden = true; return; }
			tooltip.textContent = describeDay(cell.dataset.key);
			tooltip.hidden = false;
			const rootBox = root.getBoundingClientRect(), box = cell.getBoundingClientRect();
			const left = Math.min(Math.max(box.left + box.width / 2 - rootBox.left, 90), rootBox.width - 90);
			tooltip.style.left = left + "px";
			tooltip.style.top = (box.top - rootBox.top - 8) + "px";
		});
		grid.addEventListener("mouseleave", () => { tooltip.hidden = true; });
		grid.addEventListener("click", (event) => {
			const cell = event.target.closest && event.target.closest(".hm-cell");
			if (!cell || !cell.dataset.key) return;
			selected = selected === cell.dataset.key ? null : cell.dataset.key;
			tooltip.hidden = true;
			render();
		});

		// Selected day detail
		if (selected) {
			const detail = el("div", "hm-card hm-detail", undefined, body);
			el("h3", "hm-card-title", longDate(dateOfKey(selected)), detail);
			const day = days.get(selected);
			if (!day) {
				el("p", "hm-muted", selected > todayKey ? "This day hasn't happened yet." : "No activity on this day.", detail);
			} else {
				const parts = day.types.map((n, i) => (n ? plural(n, TYPE_NAMES[i]) : null)).filter(Boolean);
				el("p", "hm-muted", parts.join(" · "), detail);
				const list = el("div", "hm-sessions", undefined, detail);
				for (const [sessionIndex, count] of [...day.sessions.entries()].sort((a, b) => b[1] - a[1])) {
					const session = data.sessions[sessionIndex];
					const row = el("button", "hm-session", undefined, list); row.type = "button";
					el("span", "hm-session-kind", session.kind === "practice" ? "Practice" : "Teaching", row);
					el("span", "hm-session-title", session.title, row);
					el("span", "hm-session-count", plural(count, ["action", "actions"]), row);
					row.addEventListener("click", () => ctx.app.openSession(session.id));
				}
			}
		}

		// Facts about the learner (all time, for the chosen session type)
		const facts = computeFacts(filtered, days, streak, data.graph);
		if (facts.length) {
			const about = el("section", "hm-about", undefined, body);
			const heading = el("div", "hm-about-head", undefined, about);
			el("h3", "hm-card-title", "About you", heading);
			el("span", "hm-muted", "All time · updates as you study", heading);
			const factGrid = el("div", "hm-facts", undefined, about);
			for (const fact of facts) {
				const box = el("div", "hm-fact", undefined, factGrid);
				el("div", "hm-tile-label", fact.label, box);
				el("div", "hm-fact-value", fact.value, box);
				el("div", "hm-tile-hint", fact.detail, box);
				if (typeof fact.progress === "number") {
					const track = el("div", "hm-progress", undefined, box);
					el("div", "hm-progress-fill", undefined, track).style.width = Math.round(Math.max(0, Math.min(1, fact.progress)) * 100) + "%";
				}
			}
		}

		// Rhythm charts for the selected year
		const weekdayTotals = new Array(7).fill(0), hourTotals = new Array(24).fill(0);
		for (const [key, day] of yearDays) {
			weekdayTotals[mondayIndex(dateOfKey(key))] += day.total;
			day.hours.forEach((n, hour) => { hourTotals[hour] += n; });
		}
		const charts = el("div", "hm-charts", undefined, body);
		bars(charts, "By weekday · " + year, WEEKDAYS, weekdayTotals, (i, n) => WEEKDAYS[i] + ": " + plural(n, ["action", "actions"]));
		bars(charts, "By hour of day · " + year, hourTotals.map((_, hour) => (hour % 6 === 0 ? pad(hour) : "")), hourTotals,
			(hour, n) => pad(hour) + ":00–" + pad(hour) + ":59: " + plural(n, ["action", "actions"]));

		el("p", "hm-footnote", "An action is a message you sent, a question you answered, or a practice submission. Darker squares mean more of them that day.", body);
	}

	function savePrefs() {
		writePref("color", color); writePref("filter", filter);
		ctx.call("setPrefs", { color, filter }).catch(() => { /* still applied for this visit */ });
	}
	async function loadPrefs() {
		try {
			const prefs = await ctx.call("getPrefs", {});
			if (!alive || !prefs) return;
			color = prefs.color; filter = prefs.filter;
			applyColor(); render();
		} catch { /* keep defaults */ }
	}

	async function load() {
		try {
			const result = await ctx.call("activity", {});
			if (!alive) return;
			data = result;
			render();
		} catch (error) {
			if (!alive) return;
			status.hidden = false;
			status.textContent = "Couldn't load activity: " + (error instanceof Error ? error.message : String(error));
		}
	}
	const scheduleReload = () => {
		if (!alive) return;
		clearTimeout(reloadTimer);
		reloadTimer = setTimeout(load, 1500);
	};
	const offEvent = ctx.onAppEvent((event) => { if (event && event.type === "turn-settled") scheduleReload(); });
	const offResync = ctx.onResync(scheduleReload);

	syncControls();
	loadPrefs().then(load);

	return () => {
		alive = false;
		clearTimeout(reloadTimer);
		offEvent(); offResync();
		container.replaceChildren();
	};
}

export function activate(ctx) {
	ctx.registerView({
		id: "heatmap",
		name: "Activity",
		mount: (container, signal) => mountHeatmap(ctx, container, signal),
	});
	ctx.registerAction({ id: "open", name: "Activity heatmap", icon: ICON, run: () => ctx.app.openView("heatmap") });
	ctx.placeAction({ id: "sidebar-open", actionId: "open", location: "sidebar" });
	ctx.placeAction({ id: "graph-open", actionId: "open", location: "graph" });
}
