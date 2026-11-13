/**
 * Activity heatmap backend: a read-only projection of learner activity.
 * It returns one row per thing the learner did (a message, an answered
 * question, a practice submission). The frontend buckets them by local day.
 * Nothing here writes to LearnHarness's learning data.
 *
 * Event row: [timestampMs, sessionIndex, type, wordsWritten, outcome]
 *   outcome: 0 none, 1 quiz correct, 2 quiz incorrect, 3 "I don't know"
 */
const fs = require("node:fs");
const path = require("node:path");

const MESSAGE = 0, ANSWER = 1, PRACTICE = 2;
const COLORS = ["emerald", "blue", "violet", "amber", "rose"];
const FILTERS = ["all", "teach", "practice"];

const words = (text) => {
	if (typeof text !== "string") return 0;
	const trimmed = text.trim();
	return trimmed ? trimmed.split(/\s+/).length : 0;
};
const contentWords = (content) => {
	if (typeof content === "string") return words(content);
	if (!Array.isArray(content)) return 0;
	return content.reduce((sum, block) => sum + (block && block.type === "text" ? words(block.text) : 0), 0);
};

exports.activate = (ctx) => {
	// Display preferences live in this plugin's own data folder, so they
	// survive restarts (the app's local address changes on every launch).
	const prefsFile = path.join(ctx.dataDirectory, "prefs.json");
	const readPrefs = () => {
		let saved = {};
		try { saved = JSON.parse(fs.readFileSync(prefsFile, "utf8")); } catch { saved = {}; }
		if (!saved || typeof saved !== "object") saved = {};
		return {
			color: COLORS.includes(saved.color) ? saved.color : "emerald",
			filter: FILTERS.includes(saved.filter) ? saved.filter : "all",
		};
	};
	ctx.handle("getPrefs", () => readPrefs());
	ctx.handle("setPrefs", (input) => {
		const next = readPrefs();
		if (input && typeof input === "object") {
			if (COLORS.includes(input.color)) next.color = input.color;
			if (FILTERS.includes(input.filter)) next.filter = input.filter;
		}
		fs.mkdirSync(ctx.dataDirectory, { recursive: true });
		const temp = prefsFile + ".tmp";
		fs.writeFileSync(temp, JSON.stringify(next));
		fs.renameSync(temp, prefsFile);
		return next;
	});
	ctx.handle("activity", () => {
		const sessions = [];
		const events = [];
		for (const summary of ctx.learning.listSessions()) {
			let record = null;
			try { record = ctx.learning.getSession(summary.id); } catch { record = null; }
			if (!record || !Array.isArray(record.messages)) continue;
			const index = sessions.length;
			let count = 0;
			for (const message of record.messages) {
				if (!message || typeof message !== "object") continue;
				let type = -1, written = 0, outcome = 0;
				let at = typeof message.timestamp === "number" ? message.timestamp : NaN;
				if (message.role === "user") {
					type = MESSAGE;
					written = contentWords(message.content);
				} else if (message.role === "toolResult") {
					const details = message.details;
					if (details && typeof details === "object" && typeof details.answeredAt === "string" && !details.dismissed) {
						type = ANSWER;
						const answered = Date.parse(details.answeredAt);
						if (Number.isFinite(answered)) at = answered;
						written = words(details.text) + words(details.other) + words(details.thinking ?? details.note) + words(details.readingThinking);
						if (details.dontKnow) outcome = 3;
						else if (details.correct === true) outcome = 1;
						else if (details.correct === false) outcome = 2;
					}
				} else if (message.role === "custom" && message.customType === "practice-thinking") {
					type = PRACTICE;
					written = words(message.details && message.details.text);
				}
				// 8.64e15 ms is the largest instant a JavaScript Date can hold.
				if (type < 0 || !Number.isFinite(at) || Math.abs(at) > 8.64e15) continue;
				events.push([at, index, type, written, outcome]);
				count++;
			}
			sessions.push({
				id: summary.id,
				title: summary.title || "Untitled session",
				kind: summary.kind === "practice" ? "practice" : "teach",
				count,
			});
		}
		let graph = null;
		try {
			const snapshot = ctx.learning.graph();
			graph = {
				propositions: Array.isArray(snapshot.propositions) ? snapshot.propositions.length : 0,
				chains: Array.isArray(snapshot.chains) ? snapshot.chains.length : 0,
			};
		} catch { graph = null; }
		return { sessions, events, graph };
	});
};
