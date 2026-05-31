const { SlashCommandBuilder } = require('@discordjs/builders');
const { Discord, EmbedBuilder, MessageFlags } = require("discord.js");
const config = require('../../config')
const commands = require('js-yaml').load(require('fs').readFileSync('./commands.yml', 'utf8'));
const utils = require("../../utils.js");
const Tickets = require("../../db/tickets");

module.exports = {
    enabled: commands.Ticket.Close.Enabled,
    data: new SlashCommandBuilder()
        .setName('close')
        .setDescription(commands.Ticket.Close.Description)
        .addStringOption(option => 
          option.setName('reason')
              .setDescription('Reason for closing the ticket')
              .setRequired(config.TicketSettings?.TicketCloseReason ?? false)
      ),
    async execute(interaction, client) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const ticketDB = Tickets.findByChannelID(interaction.channel.id);
    if(!ticketDB) return interaction.editReply({ content: config.Locale.NotInTicketChannel, flags: MessageFlags.Ephemeral })

    let supportRole = await utils.checkIfUserHasSupportRoles(interaction, null);

    if (config.TicketSettings.RestrictTicketClose && !supportRole) {
      return interaction.editReply({ content: config.Locale.restrictTicketClose, flags: MessageFlags.Ephemeral });
    }

    let closeReason = interaction.options.getString('reason') || "No reason provided.";

    Tickets.updateByChannelID(interaction.channel.id, {
      closeUserID: interaction.user.id, 
      closedAt: Date.now(),
      closeReason: closeReason
    });

    await client.emit('ticketClose', interaction);

    }

}