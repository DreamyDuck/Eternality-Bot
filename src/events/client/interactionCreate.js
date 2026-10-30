const {
    MessageFlags,
    TextDisplayBuilder,
    ContainerBuilder,
} = require('discord.js');
const config = require('../../config/config.json');
const { getAccentColor, getBotSettings } = require('../../services/botSettings');

module.exports = {
    name: 'interactionCreate',
    once: false,
    async execute(client, interaction) {
        let settings;
        try {
            if (interaction.isChatInputCommand()) {
                settings = await getBotSettings(client);

                // Block DM (server-only commands)
                if (!interaction.guild) {
                    const accentColor = getAccentColor(settings);
                    const dmBlock = new ContainerBuilder()
                        .setAccentColor(accentColor)
                        .addTextDisplayComponents(
                            new TextDisplayBuilder().setContent(`${config.crossmark_emoji || '⚠'} This command can only be used in a server.`)
                        );

                    return interaction.reply({
                        flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                        components: [dmBlock],
                    });
                }

                const command = client.slash.get(interaction.commandName);
                if (!command) return;

                await command.run(client, interaction, interaction.options, settings);
            }

        } catch (err) {
            console.error('[INTERACTION ERROR]', err);

            if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
                const errorBlock = new ContainerBuilder()
                    .setAccentColor(getAccentColor(settings))
                    .addTextDisplayComponents(
                        new TextDisplayBuilder().setContent('An unexpected error occurred while handling this interaction.')
                    );

                interaction.reply({
                    flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
                    components: [errorBlock],
                }).catch(console.error);
            }
        }
    },
};
