const DASHBOARD_MESSAGE_TYPES = new Set(['settings-read', 'snapshot']);
const IPC_TIMEOUT_MS = 2000;

function readDashboardMessage(message) {
    const raw = message?.raw ?? message;
    if (!raw || typeof raw !== 'object' || !DASHBOARD_MESSAGE_TYPES.has(raw.type)) return null;
    const allowedKeys = new Set(['type', '_type', 'nonce', 'options']);
    if (Object.keys(raw).some((key) => !allowedKeys.has(key))) return null;
    if (raw.options !== undefined) {
        if (!raw.options || typeof raw.options !== 'object'
            || Object.keys(raw.options).some((key) => key !== 'timeout')
            || (raw.options.timeout !== undefined
                && (!Number.isInteger(raw.options.timeout) || raw.options.timeout < 1 || raw.options.timeout > 10_000))) {
            return null;
        }
    }
    return raw;
}

function withTimeout(promise, timeoutMs = IPC_TIMEOUT_MS) {
    let timer;
    return Promise.race([
        promise,
        new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('Cluster request timed out')), timeoutMs);
        }),
    ]).finally(() => clearTimeout(timer));
}

module.exports = { DASHBOARD_MESSAGE_TYPES, IPC_TIMEOUT_MS, readDashboardMessage, withTimeout };
