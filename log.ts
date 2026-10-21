/**
 * The reading log.
 *
 * A session is one sitting with a book, on a given day, for a number of
 * minutes. Everything the shelf shows about your reading — the streak, the
 * heatmap, the per-book heat dots — is derived from this list.
 *
 * The functions here are pure over a session array, so they can be tested
 * without Obsidian.
 */

export interface ReadingSession {
    /** The book this session was for, matched against a note's title. */
    book: string;
    /** The path of the note, so a book can be identified even if renamed. */
    path?: string;
    /** Local date as YYYY-MM-DD. */
    date: string;
    /** Minutes read. */
    minutes: number;
}

export const LOG_KEY = "readingLog";

export interface LogState {
    sessions: ReadingSession[];
}

/** Read the log out of a plugin's saved data, tolerating older shapes. */
export function readLog(data: unknown): LogState {
    if (!data || typeof data !== "object") return { sessions: [] };
    const raw = (data as Record<string, unknown>)[LOG_KEY];
    if (!raw || typeof raw !== "object") return { sessions: [] };
    const sessions = (raw as Record<string, unknown>).sessions;
    if (!Array.isArray(sessions)) return { sessions: [] };
    return {
        sessions: sessions.filter(
            (entry): entry is ReadingSession =>
                !!entry &&
                typeof entry === "object" &&
                typeof (entry as ReadingSession).book === "string" &&
                typeof (entry as ReadingSession).date === "string" &&
                typeof (entry as ReadingSession).minutes === "number",
        ),
    };
}

/** Put the log into a plugin's saved data, leaving every other key alone. */
export function writeLog(data: unknown, log: LogState): Record<string, unknown> {
    const base =
        data && typeof data === "object"
            ? { ...(data as Record<string, unknown>) }
            : {};
    base[LOG_KEY] = log;
    return base;
}

// ─── Dates ───────────────────────────────────────────────────────────────────
// Dates are handled as plain YYYY-MM-DD strings in local time, so a session
// logged at 11pm belongs to that day and not to the next one.

export function toDateKey(year: number, month: number, day: number): string {
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function isValidDateKey(value: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split("-").map(Number);
    if (!year || !month || !day) return false;
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    const date = new Date(year, month - 1, day);
    return (
        date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
    );
}

/** Today, as a date key, in local time. */
export function todayKey(now: Date = new Date()): string {
    return toDateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Add a number of days to a date key. */
export function addDays(key: string, days: number): string {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year!, month! - 1, day! + days);
    return toDateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

/** The number of days between two date keys, `to` minus `from`. */
export function daysBetween(from: string, to: string): number {
    const [fy, fm, fd] = from.split("-").map(Number);
    const [ty, tm, td] = to.split("-").map(Number);
    const a = new Date(fy!, fm! - 1, fd!);
    const b = new Date(ty!, tm! - 1, td!);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
}

// ─── Recording ───────────────────────────────────────────────────────────────

/**
 * Add a session to the log.
 *
 * A session of zero minutes is not recorded: it would count as a day read
 * without any reading having happened.
 */
export function recordSession(
    log: LogState,
    session: ReadingSession,
): LogState {
    if (!isValidDateKey(session.date)) return log;
    if (!Number.isFinite(session.minutes) || session.minutes <= 0) return log;
    if (session.book.trim() === "") return log;

    return {
        sessions: [
            ...log.sessions,
            {
                ...session,
                book: session.book.trim(),
                minutes: Math.round(session.minutes),
            },
        ],
    };
}

/** Remove every session for a book, used when a note is deleted. */
export function removeBook(log: LogState, book: string): LogState {
    return {
        sessions: log.sessions.filter((session) => session.book !== book),
    };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/** Every session for a book, oldest first. */
export function sessionsForBook(
    log: LogState,
    book: string,
): ReadingSession[] {
    return log.sessions
        .filter((session) => session.book === book)
        .sort((a, b) => a.date.localeCompare(b.date));
}

/** The days on which a book was read, with the minutes for each. */
export function daysForBook(
    log: LogState,
    book: string,
): Map<string, number> {
    const days = new Map<string, number>();
    for (const session of sessionsForBook(log, book)) {
        days.set(session.date, (days.get(session.date) ?? 0) + session.minutes);
    }
    return days;
}

/** Every day with any reading, and the minutes for each. */
export function readingDays(log: LogState): Map<string, number> {
    const days = new Map<string, number>();
    for (const session of log.sessions) {
        days.set(session.date, (days.get(session.date) ?? 0) + session.minutes);
    }
    return days;
}

/** The total minutes read on a day. */
export function minutesOn(log: LogState, date: string): number {
    return log.sessions
        .filter((session) => session.date === date)
        .reduce((sum, session) => sum + session.minutes, 0);
}

/** The total minutes read in the seven days ending on `end`. */
export function minutesInWeekEnding(log: LogState, end: string): number {
    const start = addDays(end, -6);
    return log.sessions
        .filter((session) => session.date >= start && session.date <= end)
        .reduce((sum, session) => sum + session.minutes, 0);
}

/**
 * The current streak: consecutive days with reading, counting back from
 * `today`.
 *
 * A streak that ended yesterday still counts — you have not broken it yet,
 * you have simply not read today. It breaks only once a whole day has passed
 * with nothing read.
 */
export function currentStreak(
    log: LogState,
    today: string = todayKey(),
): number {
    const days = readingDays(log);
    if (days.size === 0) return 0;

    // Start from today if it was read, otherwise from yesterday, so that a
    // streak is not reported as broken before the day is over.
    let cursor = days.has(today) ? today : addDays(today, -1);
    if (!days.has(cursor)) return 0;

    let streak = 0;
    while (days.has(cursor)) {
        streak++;
        cursor = addDays(cursor, -1);
    }
    return streak;
}

/** The longest streak ever recorded. */
export function longestStreak(log: LogState): number {
    const days = [...readingDays(log).keys()].sort();
    if (days.length === 0) return 0;

    let longest = 1;
    let run = 1;
    for (let i = 1; i < days.length; i++) {
        if (daysBetween(days[i - 1]!, days[i]!) === 1) {
            run++;
            longest = Math.max(longest, run);
        } else {
            run = 1;
        }
    }
    return longest;
}

/** The number of consecutive days ending on `date` that have reading. */
export function streakEndingOn(
    log: LogState,
    date: string,
): number {
    const days = readingDays(log);
    let cursor = date;
    let streak = 0;
    while (days.has(cursor)) {
        streak++;
        cursor = addDays(cursor, -1);
    }
    return streak;
}

// ─── Heatmaps ────────────────────────────────────────────────────────────────

export interface HeatCell {
    /** The date key this cell covers. */
    date: string;
    /** The minutes read on that day. */
    minutes: number;
    /** 0 to 4, the intensity of the cell. */
    level: number;
}

/**
 * The intensity of a cell, from 0 to 4.
 *
 * The thresholds are in minutes rather than fractions, so a cell means the
 * same thing whatever the reader's habits are.
 */
export function levelFor(minutes: number): number {
    if (minutes <= 0) return 0;
    if (minutes < 15) return 1;
    if (minutes < 30) return 2;
    if (minutes < 60) return 3;
    return 4;
}

/** One cell per day over a range, oldest first. */
export function heatmapForRange(
    log: LogState,
    from: string,
    to: string,
): HeatCell[] {
    const days = readingDays(log);
    const cells: HeatCell[] = [];
    let cursor = from;
    // Guard against a reversed or runaway range.
    let guard = 0;
    while (cursor <= to && guard < 2000) {
        const minutes = days.get(cursor) ?? 0;
        cells.push({ date: cursor, minutes, level: levelFor(minutes) });
        cursor = addDays(cursor, 1);
        guard++;
    }
    return cells;
}

/**
 * The last `weeks` weeks as columns, each a week of seven days.
 *
 * The oldest week comes first, and the last day of each week is the most
 * recent, so the grid reads left to right like a calendar.
 */
export interface HeatWeek {
    /** The date key of the first day of the week. */
    start: string;
    days: HeatCell[];
}

export function heatmapByWeek(
    log: LogState,
    today: string,
    weeks: number,
): HeatWeek[] {
    // Start on the Monday of the current week, so each column is a week.
    const [year, month, day] = today.split("-").map(Number);
    const date = new Date(year!, month! - 1, day!);
    const weekday = (date.getDay() + 6) % 7;
    const thisWeekStart = addDays(today, -weekday);

    const columns: HeatWeek[] = [];
    for (let i = weeks - 1; i >= 0; i--) {
        const start = addDays(thisWeekStart, -i * 7);
        columns.push({
            start,
            days: heatmapForRange(log, start, addDays(start, 6)),
        });
    }
    return columns;
}

// ─── Export ──────────────────────────────────────────────────────────────────

/**
 * The log as JSON, for handing to another tool.
 *
 * The sessions are sorted so the export is stable, and every book is
 * summarised with its totals.
 */
export function exportLog(log: LogState): string {
    const sessions = [...log.sessions].sort(
        (a, b) =>
            a.date.localeCompare(b.date) || a.book.localeCompare(b.book),
    );

    const books: Record<
        string,
        { minutes: number; sessions: number; days: string[] }
    > = {};
    for (const session of sessions) {
        const entry = books[session.book] ?? {
            minutes: 0,
            sessions: 0,
            days: [],
        };
        entry.minutes += session.minutes;
        entry.sessions += 1;
        if (!entry.days.includes(session.date)) entry.days.push(session.date);
        books[session.book] = entry;
    }

    const totalMinutes = sessions.reduce(
        (sum, session) => sum + session.minutes,
        0,
    );

    return JSON.stringify(
        {
            exportedAt: new Date().toISOString(),
            totalMinutes,
            totalSessions: sessions.length,
            books,
            sessions,
        },
        null,
        2,
    );
}
