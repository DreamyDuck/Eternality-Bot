const { OWNER_ID_PATTERN } = require('./config');

const DISCORD_API = 'https://discord.com/api/v10';

function responseJson(response, errorMessage) {
    if (!response.ok) throw new Error(errorMessage);
    return response.json().catch(() => {
        throw new Error(errorMessage);
    });
}

function createDiscordOAuth(config, fetchImpl = fetch) {
    return {
        async identify(code) {
            const form = new URLSearchParams({
                client_id: config.oauthClientId,
                client_secret: config.oauthClientSecret,
                grant_type: 'authorization_code',
                code,
                redirect_uri: config.callbackUrl,
            });
            const tokenResponse = await fetchImpl(`${DISCORD_API}/oauth2/token`, {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: form,
                signal: AbortSignal.timeout(5000),
            });
            const token = await responseJson(tokenResponse, 'Discord authorization failed');
            if (typeof token.access_token !== 'string' || !token.access_token) {
                throw new Error('Discord authorization failed');
            }

            const userResponse = await fetchImpl(`${DISCORD_API}/users/@me`, {
                headers: { authorization: `Bearer ${token.access_token}` },
                signal: AbortSignal.timeout(5000),
            });
            const user = await responseJson(userResponse, 'Discord identity lookup failed');
            if (!user || typeof user.id !== 'string' || !OWNER_ID_PATTERN.test(user.id)
                || typeof user.username !== 'string') {
                throw new Error('Discord identity lookup failed');
            }
            const avatarUrl = typeof user.avatar === 'string'
                ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
                : null;
            return {
                id: user.id,
                name: typeof user.global_name === 'string' && user.global_name.trim()
                    ? user.global_name.trim()
                    : user.username,
                avatarUrl,
            };
        },
    };
}

module.exports = { createDiscordOAuth };
