const fs = require('node:fs');
const path = require('node:path');
const { SlashCommandBuilder } = require('discord.js');

function discoverSlashCommands(commandsPath = path.join(__dirname, '../slashCommands')) {
    const commands = [];
    const skipped = [];

    for (const category of fs.readdirSync(commandsPath)) {
        const categoryPath = path.join(commandsPath, category);
        if (!fs.statSync(categoryPath).isDirectory()) continue;

        for (const file of fs.readdirSync(categoryPath).filter((name) => name.endsWith('.js'))) {
            const filePath = path.join(categoryPath, file);
            try {
                const command = require(filePath);
                if (!command.data || !(command.data instanceof SlashCommandBuilder)) {
                    skipped.push(file);
                    continue;
                }
                commands.push({ category, filePath, module: command });
            } catch (error) {
                skipped.push(`${file} (${error.message})`);
            }
        }
    }

    return { commands, skipped };
}

function discoverMessageCommands(commandsPath = path.join(__dirname, '../messageCommands')) {
    const commands = [];
    const skipped = [];
    if (!fs.existsSync(commandsPath)) return { commands, skipped };

    const register = (filePath, category) => {
        const fileName = path.basename(filePath);
        try {
            const command = require(filePath);
            if (!command || typeof command !== 'object') {
                skipped.push(`${category}/${fileName} (invalid export)`);
                return;
            }
            if (typeof command.name !== 'string' || !command.name || typeof command.run !== 'function') {
                skipped.push(`${category}/${fileName} (missing name/run)`);
                return;
            }
            commands.push({ category, filePath, module: command });
        } catch (error) {
            skipped.push(`${category}/${fileName} (${error.message})`);
        }
    };

    for (const entry of fs.readdirSync(commandsPath, { withFileTypes: true })) {
        const entryPath = path.join(commandsPath, entry.name);
        if (entry.isDirectory()) {
            for (const file of fs.readdirSync(entryPath).filter((name) => name.endsWith('.js'))) {
                register(path.join(entryPath, file), entry.name);
            }
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            register(entryPath, 'root');
        }
    }

    return { commands, skipped };
}

function discoverCommandCatalog() {
    const slash = discoverSlashCommands();
    const message = discoverMessageCommands();
    const items = [
        ...slash.commands.map(({ category, module }) => ({
            name: module.data.name,
            description: module.data.description || '',
            type: 'slash',
            category,
            aliases: [],
        })),
        ...message.commands.map(({ category, module }) => ({
            name: module.name.toLowerCase(),
            description: typeof module.description === 'string' ? module.description : '',
            type: 'message',
            category,
            aliases: Array.isArray(module.aliases)
                ? module.aliases.filter((alias) => typeof alias === 'string' && alias.length > 0)
                : [],
        })),
    ];
    return items.sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = { discoverCommandCatalog, discoverMessageCommands, discoverSlashCommands };
