const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, ActionRowBuilder, ButtonBuilder, EmbedBuilder, MessageSelectMenu, Message, ContextMenuCommandBuilder, ApplicationCommandType, SnowflakeUtil } = require("discord.js");
const config = require('../../config')
const commands = require('js-yaml').load(require('fs').readFileSync('./commands.yml', 'utf8'));

module.exports = {
    enabled: config.SuggestionSettings?.Enabled ?? false,
    data: new ContextMenuCommandBuilder()
    .setName("Accept Suggestion")
    .setType(ApplicationCommandType.Message)
}