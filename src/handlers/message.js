const { colorize } = require('../utils/consoleStyle');
const { discoverMessageCommands } = require('../services/commandDiscovery');

module.exports = (client) => {
    const loadedCommands = [];

    client.commands.clear();
    client.aliases.clear();

    const { commands, skipped: skippedCommands } = discoverMessageCommands();
    for (const { category, module: command } of commands) {
        const commandName = command.name.toLowerCase();
        client.commands.set(commandName, command);

        if (Array.isArray(command.aliases)) {
            for (const alias of command.aliases) {
                if (!alias || typeof alias !== 'string') continue;
                client.aliases.set(alias.toLowerCase(), commandName);
            }
        }
        loadedCommands.push(`${category}/${commandName}`);
    }

    const allCommands = [
        'LOADED COMMANDS:',
        ...loadedCommands.map(name => `  • ${name}`),
        skippedCommands.length > 0 ? '\nSKIPPED COMMANDS:' : '',
        ...skippedCommands.map(file => `  • ${file}`),
    ].join('\n');

    const boxLength = Math.max(...allCommands.split('\n').map(line => line.length)) + 4;
    const top = `╔${'═'.repeat(boxLength)}╗`;
    const bottom = `╚${'═'.repeat(boxLength)}╝`;
    console.log(colorize('green', top));
    allCommands.split('\n').forEach(line => {
        console.log(colorize('green', `║ ${line.padEnd(boxLength - 2)} ║`));
    });
    console.log(colorize('green', bottom));

    console.log(colorize('magenta', 'SUCCESS: Message commands loaded successfully!'));
};
