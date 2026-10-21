/**
 * Tests for the reading log.
 *
 * The streak and heatmap maths is where the bugs hide, so the cases here
 * cover the awkward boundaries: a gap that breaks a streak, a streak that
 * ended yesterday, a week that rolls over, and a session logged for a day
 * that has not happened yet.
 *
 * Run with: node --test test-log.ts
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    addDays,
    currentStreak,
    daysBetween,
    daysForBook,
    exportLog,
    heatmapByWeek,
    heatmapForRange,
    isValidDateKey,
    levelFor,
    longestStreak,
    minutesInWeekEnding,
    minutesOn,
    readLog,
    recordSession,
    removeBook,
    sessionsForBook,
    streakEndingOn,
    toDateKey,
    writeLog,
    type LogState,
    type ReadingSession,
} from "./log.ts";

function session(
    book: string,
    date: string,
    minutes: number,
): ReadingSession {
    return { book, date, minutes };
}

function logOf(...sessions: ReadingSession[]): LogState {
    return { sessions };
}

// ─── Date keys ───────────────────────────────────────────────────────────────

test("date keys round-trip", () => {
    assert.equal(toDateKey(2026, 3, 5), "2026-03-05");
    assert.equal(toDateKey(2026, 12, 31), "2026-12-31");
});

test("invalid date keys are rejected", () => {
    assert.equal(isValidDateKey("2026-03-05"), true);
    assert.equal(isValidDateKey("2026-3-5"), false);
    assert.equal(isValidDateKey("2026-13-01"), false);
    assert.equal(isValidDateKey("2026-02-30"), false);
    assert.equal(isValidDateKey("not a date"), false);
    assert.equal(isValidDateKey(""), false);
});

test("adding days crosses month and year boundaries", () => {
    assert.equal(addDays("2026-01-31", 1), "2026-02-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addDays("2024-02-28", 1), "2024-02-29", "leap year");
});

test("days between two dates counts the gap", () => {
    assert.equal(daysBetween("2026-01-01", "2026-01-01"), 0);
    assert.equal(daysBetween("2026-01-01", "2026-01-08"), 7);
    assert.equal(daysBetween("2026-01-08", "2026-01-01"), -7);
    assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
});

// ─── Recording ───────────────────────────────────────────────────────────────

test("a session is recorded", () => {
    const log = recordSession(logOf(), session("Dune", "2026-01-01", 30));
    assert.equal(log.sessions.length, 1);
    assert.equal(log.sessions[0]!.minutes, 30);
});

test("a zero minute session is not recorded", () => {
    const log = recordSession(logOf(), session("Dune", "2026-01-01", 0));
    assert.equal(log.sessions.length, 0, "reading for no minutes is not a read");
});

test("a negative session is not recorded", () => {
    const log = recordSession(logOf(), session("Dune", "2026-01-01", -20));
    assert.equal(log.sessions.length, 0);
});

test("a session with an invalid date is not recorded", () => {
    const log = recordSession(logOf(), session("Dune", "2026-13-45", 30));
    assert.equal(log.sessions.length, 0);
});

test("a session with no book is not recorded", () => {
    const log = recordSession(logOf(), session("   ", "2026-01-01", 30));
    assert.equal(log.sessions.length, 0);
});

test("minutes are rounded to whole minutes", () => {
    const log = recordSession(logOf(), session("Dune", "2026-01-01", 30.6));
    assert.equal(log.sessions[0]!.minutes, 31);
});

// ─── Reading state persistence ───────────────────────────────────────────────

test("the log is read out of saved data", () => {
    const state = readLog({
        readingLog: { sessions: [session("Dune", "2026-01-01", 30)] },
    });
    assert.equal(state.sessions.length, 1);
});

test("the log tolerates missing or malformed saved data", () => {
    assert.equal(readLog(undefined).sessions.length, 0);
    assert.equal(readLog(null).sessions.length, 0);
    assert.equal(readLog({}).sessions.length, 0);
    assert.equal(readLog({ readingLog: {} }).sessions.length, 0);
    assert.equal(readLog({ readingLog: { sessions: "nope" } }).sessions.length, 0);
});

test("malformed sessions are dropped", () => {
    const state = readLog({
        readingLog: {
            sessions: [
                session("Dune", "2026-01-01", 30),
                { book: "Dune" },
                { date: "2026-01-01", minutes: 10 },
                null,
            ],
        },
    });
    assert.equal(state.sessions.length, 1);
});

test("writing the log leaves other settings alone", () => {
    const data = writeLog({ theme: "cozy", folderPath: "Books" }, {
        sessions: [session("Dune", "2026-01-01", 30)],
    });
    assert.equal(data.theme, "cozy");
    assert.equal(data.folderPath, "Books");
    assert.equal((data.readingLog as LogState).sessions.length, 1);
});

test("writing the log to empty data works", () => {
    const data = writeLog(undefined, { sessions: [] });
    assert.equal((data.readingLog as LogState).sessions.length, 0);
});

// ─── Queries ─────────────────────────────────────────────────────────────────

test("sessions for a book are oldest first", () => {
    const log = logOf(
        session("Dune", "2026-03-01", 20),
        session("Dune", "2026-01-05", 40),
        session("Other", "2026-02-01", 10),
    );
    const dates = sessionsForBook(log, "Dune").map((s) => s.date);
    assert.deepEqual(dates, ["2026-01-05", "2026-03-01"]);
});

test("days for a book combine multiple sessions on one day", () => {
    const log = logOf(
        session("Dune", "2026-01-05", 20),
        session("Dune", "2026-01-05", 15),
    );
    assert.equal(daysForBook(log, "Dune").get("2026-01-05"), 35);
});

test("minutes on a day and in a week", () => {
    const log = logOf(
        session("A", "2026-01-05", 20),
        session("B", "2026-01-06", 30),
        session("C", "2025-12-20", 90),
    );
    assert.equal(minutesOn(log, "2026-01-05"), 20);
    assert.equal(minutesOn(log, "2026-01-07"), 0);
    assert.equal(minutesInWeekEnding(log, "2026-01-06"), 50);
    assert.equal(
        minutesInWeekEnding(log, "2026-01-13"),
        0,
        "a week with no reading is zero",
    );
});

test("removing a book drops its sessions", () => {
    const log = logOf(session("Dune", "2026-01-01", 30), session("Other", "2026-01-01", 10));
    const after = removeBook(log, "Dune");
    assert.equal(after.sessions.length, 1);
    assert.equal(after.sessions[0]!.book, "Other");
});

// ─── Streaks ─────────────────────────────────────────────────────────────────

test("a streak counts consecutive days", () => {
    const log = logOf(
        session("A", "2026-01-01", 30),
        session("A", "2026-01-02", 30),
        session("A", "2026-01-03", 30),
    );
    assert.equal(currentStreak(log, "2026-01-03"), 3);
});

test("a gap breaks the streak", () => {
    const log = logOf(
        session("A", "2026-01-01", 30),
        session("A", "2026-01-02", 30),
        // 2026-01-03 missed
        session("A", "2026-01-04", 30),
    );
    assert.equal(currentStreak(log, "2026-01-04"), 1, "the gap ends the run");
});

test("a streak that ended yesterday still counts", () => {
    const log = logOf(
        session("A", "2026-01-01", 30),
        session("A", "2026-01-02", 30),
    );
    assert.equal(
        currentStreak(log, "2026-01-03"),
        2,
        "not reading today has not broken the streak yet",
    );
});

test("a streak is broken once a whole day has passed", () => {
    const log = logOf(session("A", "2026-01-01", 30));
    assert.equal(currentStreak(log, "2026-01-03"), 0);
});

test("no sessions means no streak", () => {
    assert.equal(currentStreak(logOf(), "2026-01-03"), 0);
});

test("a streak counts days across different books", () => {
    const log = logOf(
        session("A", "2026-01-01", 30),
        session("B", "2026-01-02", 30),
    );
    assert.equal(currentStreak(log, "2026-01-02"), 2, "the streak is about days, not books");
});

test("the longest streak is found across the whole history", () => {
    const log = logOf(
        session("A", "2026-01-01", 30),
        session("A", "2026-01-02", 30),
        session("A", "2026-01-03", 30),
        session("A", "2026-01-10", 30),
    );
    assert.equal(longestStreak(log), 3);
});

test("a streak ending on a given day", () => {
    const log = logOf(
        session("A", "2026-01-01", 30),
        session("A", "2026-01-02", 30),
    );
    assert.equal(streakEndingOn(log, "2026-01-02"), 2);
    assert.equal(streakEndingOn(log, "2026-01-05"), 0);
});

// ─── Heatmaps ────────────────────────────────────────────────────────────────

test("levels are based on minutes", () => {
    assert.equal(levelFor(0), 0);
    assert.equal(levelFor(10), 1);
    assert.equal(levelFor(20), 2);
    assert.equal(levelFor(45), 3);
    assert.equal(levelFor(120), 4);
});

test("a heatmap covers every day in the range", () => {
    const log = logOf(session("A", "2026-01-02", 30));
    const cells = heatmapForRange(log, "2026-01-01", "2026-01-04");
    assert.equal(cells.length, 4);
    assert.equal(cells[0]!.minutes, 0);
    assert.equal(cells[1]!.minutes, 30);
    assert.equal(cells[1]!.level, 3, "30 minutes is the third level");
    assert.equal(cells[3]!.minutes, 0);
});

test("a reversed heatmap range does not hang", () => {
    const cells = heatmapForRange(logOf(), "2026-01-04", "2026-01-01");
    assert.equal(cells.length, 0);
});

test("weeks are Monday to Sunday, oldest first", () => {
    // 2026-01-07 is a Wednesday.
    const weeks = heatmapByWeek(logOf(), "2026-01-07", 3);
    assert.equal(weeks.length, 3);
    assert.equal(weeks[2]!.start, "2026-01-05", "the current week starts on Monday");
    assert.equal(weeks[0]!.start, "2025-12-22");
    assert.equal(weeks[2]!.days.length, 7);
});

test("the heatmap by week buckets the sessions", () => {
    const log = logOf(session("A", "2026-01-06", 45));
    const weeks = heatmapByWeek(log, "2026-01-07", 2);
    const current = weeks[1]!;
    const cell = current.days.find((d) => d.date === "2026-01-06");
    assert.equal(cell?.minutes, 45);
    assert.equal(cell?.level, 3);
});

// ─── Export ──────────────────────────────────────────────────────────────────

test("the export contains the totals and the sessions", () => {
    const log = logOf(
        session("Dune", "2026-01-02", 30),
        session("Dune", "2026-01-01", 20),
        session("Other", "2026-01-01", 10),
    );
    const parsed = JSON.parse(exportLog(log));
    assert.equal(parsed.totalMinutes, 60);
    assert.equal(parsed.totalSessions, 3);
    assert.equal(parsed.books.Dune.minutes, 50);
    assert.equal(parsed.books.Dune.sessions, 2);
    assert.deepEqual(parsed.books.Dune.days, ["2026-01-01", "2026-01-02"]);
    assert.equal(
        parsed.sessions[0].date,
        "2026-01-01",
        "sessions are sorted so the export is stable",
    );
});

test("the export of an empty log is still valid", () => {
    const parsed = JSON.parse(exportLog(logOf()));
    assert.equal(parsed.totalMinutes, 0);
    assert.deepEqual(parsed.sessions, []);
});
