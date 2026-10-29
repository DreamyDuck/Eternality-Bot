// ========================= SLASH COMMAND HANDLER =========================
const { REST, Routes } = require('discord.js');
const { colorize } = require('../utils/consoleStyle');
const { discoverSlashCommands } = require('../services/commandDiscovery');
require('dotenv').config({ quiet: true });

module.exports = async (client) => {
    const { commands, skipped: skippedCommands } = discoverSlashCommands();
    const slash = commands.map(({ module: commandModule }) => {
        client.slash.set(commandModule.data.name, commandModule);
        return commandModule.data.toJSON();
    });
    const loadedCommands = commands.map(({ module: commandModule }) => commandModule.data.name);

    // Build single box log
    const allCommands = [
        'LOADED COMMANDS:',
        ...loadedCommands.map(name => `  • ${name}`),
        skippedCommands.length > 0 ? '\nSKIPPED COMMANDS:' : '',
        ...skippedCommands.map(file => `  • ${file}`)
    ].join('\n');

    const boxLength = Math.max(...allCommands.split('\n').map(line => line.length)) + 4;
    const top = `╔${'─'.repeat(boxLength)}╗`;
    const bottom = `╚${'─'.repeat(boxLength)}╝`;
    console.log(colorize('green', top));
    allCommands.split('\n').forEach(line => {
        console.log(colorize('green', `║ ${line.padEnd(boxLength - 2)} ║`));
    });
    console.log(colorize('green', bottom));

    // Check .env
    if (!process.env.TOKEN || !process.env.CLIENTID) {
        console.log(colorize('red', 'ERROR: TOKEN or CLIENTID missing in .env'));
        return process.exit();
    }

    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    try {
        await rest.put(
            Routes.applicationCommands(process.env.CLIENTID),
            { body: slash }
        );
        console.log(colorize('magenta', 'SUCCESS: Slash commands registered successfully!'));
    } catch (err) {
        console.log(colorize('red', `ERROR: Failed to register commands: ${err}`));
    }
};
