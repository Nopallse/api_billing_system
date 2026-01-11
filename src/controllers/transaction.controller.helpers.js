// Shared helpers for transaction duration calculation
// Used by both transaction and device controllers

const parseLocalDateTime = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;
    if (typeof value === 'string') {
        // Expected 'YYYY-MM-DD HH:mm:ss' from DB
        const parts = value.split(' ');
        if (parts.length === 2) {
            const [y, m, d] = parts[0].split('-').map(Number);
            const [hh, mm, ss] = parts[1].split(':').map(Number);
            return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0, ss || 0);
        }
    }
    return new Date(value);
};

const formatLocalDateTime = (date) => {
    if (!date) return null;
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = date.getFullYear();
    const mm = pad(date.getMonth() + 1);
    const dd = pad(date.getDate());
    const HH = pad(date.getHours());
    const MM = pad(date.getMinutes());
    const SS = pad(date.getSeconds());
    return `${yyyy}-${mm}-${dd} ${HH}:${MM}:${SS}`;
};

const computeUsageSecondsFromActivities = (activities, start, end) => {
    if (!Array.isArray(activities)) return 0;

    const toDate = (v) => parseLocalDateTime(v);
    const sorted = [...activities].sort(
        (a, b) => toDate(a.timestamp) - toDate(b.timestamp)
    );

    let total = 0;
    let activeSince = null;

    for (const act of sorted) {
        const ts = toDate(act.timestamp);
        if (!ts) continue;

        const type = (act.activityType || '').toLowerCase();

        if (type === 'start' || type === 'resume') {
            if (!activeSince) activeSince = ts;
        }

        if (type === 'stop') {
            if (activeSince) {
                total += Math.max(0, Math.floor((ts - activeSince) / 1000));
                activeSince = null;
            }
        }

        if (type === 'end') {
            if (activeSince) {
                const endTs = end ? toDate(end) : ts;
                total += Math.max(0, Math.floor((endTs - activeSince) / 1000));
                activeSince = null;
            }
        }
    }

    // Jika masih aktif sampai end
    if (activeSince && end) {
        total += Math.max(0, Math.floor((toDate(end) - activeSince) / 1000));
    }

    return total;
};

module.exports = {
    parseLocalDateTime,
    formatLocalDateTime,
    computeUsageSecondsFromActivities
};
