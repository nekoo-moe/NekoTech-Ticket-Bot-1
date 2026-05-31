const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require ("discord.js")
const config = require('../../config')
const commands = require('js-yaml').load(require('fs').readFileSync('./commands.yml', 'utf8'));
const utils = require("../../utils.js");
const Tickets = require("../../db/tickets");

module.exports = {
    enabled: commands.Ticket.Pin.Enabled,
    data: new SlashCommandBuilder()
        .setName('pin')
        .setDescription(commands.Ticket.Pin.Description),
    async execute(interaction, client) {
        const ticketDB = Tickets.findByChannelID(interaction.channel.id);
        if(!ticketDB) return interaction.reply({ content: config.Locale.NotInTicketChannel, flags: Discord.MessageFlags.Ephemeral })
    
        let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);
        if(!supportRole) return interaction.reply({ content: config.Locale.NoPermsMessage, flags: Discord.MessageFlags.Ephemeral })
    
        if(interaction.channel.name.startsWith("📌")) return interaction.reply({ content: config.Locale.ticketAlreadyPinned, flags: Discord.MessageFlags.Ephemeral })
    
        await interaction.deferReply();

        interaction.channel.setPosition(1)
        interaction.channel.setName(`📌${interaction.channel.name}`)
    
        const embed = new Discord.EmbedBuilder()
        .setColor("Green")
        .setDescription(config.Locale.ticketPinned)
        interaction.editReply({ embeds: [embed] })

    }

}