const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js");
const { SnowflakeUtil } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const GiveawayModel = require('./GiveawayModel');
const config = yaml.load(fs.readFileSync('./addons/Giveaways/config.yml', 'utf8'));
const ms = require('ms');

module.exports = {
    data: new SlashCommandBuilder()
      .setName('giveaway')
      .setDescription('Manage Giveaways')
      .addSubcommand(subcommand =>
        subcommand
          .setName('create')
          .setDescription('Create a giveaway')
          .addStringOption(option =>
            option.setName('prize').setDescription('The prize for the giveaway').setRequired(true)
          )
          .addIntegerOption(option =>
            option.setName('winners').setDescription('Number of winners').setRequired(true)
          )
          .addStringOption(option =>
            option.setName('duration').setDescription('When the giveaway ends (e.g., 10m, 2h, 1d)').setRequired(true)
          )
          .addStringOption(option =>
            option.setName('min_server_join_date')
              .setDescription('Minimum time the user must have been in the server to enter (e.g., 2d, 5d)')
              .setRequired(false)
          )
          .addRoleOption(option =>
            option.setName('mention_role')
              .setDescription('Role to mention when the giveaway is created')
              .setRequired(false)
          )
      )
      .addSubcommand(subcommand =>
        subcommand
          .setName('reroll')
          .setDescription('Reroll winners for an existing giveaway')
          .addStringOption(option =>
            option.setName('message_id')
              .setDescription('The message ID of the giveaway')
              .setRequired(true)
          )
          .addIntegerOption(option =>
            option.setName('reroll_winners')
              .setDescription('Number of winners to reroll (defaults to total winners)')
              .setRequired(false)
          )
      ),

  async execute(interaction, client) {
    // Permission check
    if (!interaction.member.permissions.has('ManageMessages')) return interaction.reply({ content: config.Errors.NoPermission, ephemeral: true });

    let subCmd = interaction.options.getSubcommand();

    if (subCmd === 'create') {
        await interaction.deferReply({ ephemeral: true });
  
        const winners = interaction.options.getInteger('winners');
        const duration = interaction.options.getString('duration');
        const prize = interaction.options.getString('prize');
        const minServerJoinDate = interaction.options.getString('min_server_join_date') || null;
        const mentionRole = interaction.options.getRole('mention_role');
  
        const minJoinDurationMs = minServerJoinDate ? ms(minServerJoinDate) : 0;
        if (minJoinDurationMs === undefined) {
          return interaction.editReply({ content: 'Invalid format for minimum server join date. Use values like 2d, 5h.' });
        }
  
        const timeMs = ms(duration);
        if (!timeMs || timeMs <= 0) {
          return interaction.editReply({ content: config.Errors.InvalidDuration });
        }
  
        const endTime = Date.now() + timeMs;
  
        let embedTitle = config.Embed.Title.replace(/{prize}/g, `${prize}`).replace(/{winners}/g, `${winners}`).replace(/{hosted-by}/g, `${interaction.user.username}`).replace(/{ends}/g, `<t:${Math.floor(endTime / 1000)}:R>`)
        let embedDescription = config.Embed.Description.replace(/{prize}/g, `${prize}`).replace(/{winners}/g, `${winners}`).replace(/{hosted-by}/g, `${interaction.user.username}`).replace(/{ends}/g, `<t:${Math.floor(endTime / 1000)}:R>`)
        let embedFooter= config.Embed.Footer.text.replace(/{prize}/g, `${prize}`).replace(/{winners}/g, `${winners}`).replace(/{hosted-by}/g, `${interaction.user.username}`).replace(/{ends}/g, `<t:${Math.floor(endTime / 1000)}:R>`)

        const giveawayEmbed = new Discord.EmbedBuilder()
        if(config.Embed.Title) giveawayEmbed.setTitle(embedTitle)
        giveawayEmbed.setDescription(embedDescription)
        if(config.Embed.Color) giveawayEmbed.setColor(config.Embed.Color)
        if(!config.Embed.Color) giveawayEmbed.setColor("Orange")
        if(config.Embed.Image) giveawayEmbed.setImage(config.Embed.Image)
        if(config.Embed.CustomThumbnailURL) giveawayEmbed.setThumbnail(config.Embed.CustomThumbnailURL)
        if(config.Embed.Footer.Enabled && config.Embed.Footer.text) giveawayEmbed.setFooter({ text: `${embedFooter}` })
        if(config.Embed.Footer.Enabled && config.Embed.Footer.text && config.Embed.Footer.CustomIconURL) giveawayEmbed.setFooter({ text: `${embedFooter}`, iconURL: `${config.Embed.Footer.CustomIconURL}` })
        if(config.Embed.Timestamp) giveawayEmbed.setTimestamp()

    let entriesButtonVariables = config.EntriesButton.Label.replace(/{entries}/g, `0`)

      // Build button from config
      const enterButton = new Discord.ButtonBuilder()
        .setCustomId('giveaway_enter')
        .setLabel(config.Button.Label)
        .setStyle(Discord.ButtonStyle[config.Button.Style]);

     const entriesButton = new Discord.ButtonBuilder()
        .setCustomId('giveaway_entries')
        .setDisabled(true)
        .setLabel(entriesButtonVariables)
        .setStyle(Discord.ButtonStyle[config.EntriesButton.Style]);

      const actionRow = new Discord.ActionRowBuilder().addComponents(enterButton, entriesButton);

      const nonce = SnowflakeUtil.generate();

      const messagePayload = {
        embeds: [giveawayEmbed],
        components: [actionRow],
        enforceNonce: true, 
        nonce: nonce.toString()
      };
      
      if (mentionRole) messagePayload.content = `${mentionRole}`;
      const giveawayMessage = await interaction.channel.send(messagePayload);

      await GiveawayModel.create({
        messageId: giveawayMessage.id,
        channelId: interaction.channel.id,
        startedBy: interaction.user.id,
        prize: prize,
        winners: winners,
        endTime: endTime,
        minServerJoinDate: minServerJoinDate,
        minJoinDurationMs: minJoinDurationMs,
        entrants: [],
      });
  
        interaction.editReply({ content: config.Messages.GiveawayCreated });
      } 
      else if (subCmd === 'reroll') {
        await interaction.deferReply({ ephemeral: true });
  
        const messageId = interaction.options.getString('message_id');
        const rerollWinners = interaction.options.getInteger('reroll_winners');
  
        const giveaway = await GiveawayModel.findOne({ messageId });
        if (!giveaway) {
          return interaction.editReply({ content: '❌ No giveaway found with that message ID.' });
        }
  
        if (giveaway.entrants.length === 0) {
          return interaction.editReply({ content: '❌ No entries found for this giveaway.' });
        }
  
        const winnersToReroll = rerollWinners || giveaway.winners;
        const shuffled = giveaway.entrants.sort(() => 0.5 - Math.random());
        const newWinners = shuffled.slice(0, Math.min(winnersToReroll, giveaway.entrants.length));
        const winnerMentions = newWinners.map(id => `<@${id}>`).join(', ');
  
        const channel = client.channels.cache.get(giveaway.channelId);
        if (!channel) {
          return interaction.editReply({ content: '❌ Giveaway channel no longer exists.' });
        }
  
        const nonce = SnowflakeUtil.generate();

        await channel.send({ content: `🔄 **Reroll Results for Giveaway: ${giveaway.prize}**\n🏆 **New Winners:** ${winnerMentions}`, enforceNonce: true, nonce: nonce.toString() });
  
        interaction.editReply({ content: `✅ Giveaway has been rerolled!` });
      }
      else if (subCmd === 'reroll') {
        await interaction.deferReply({ ephemeral: true });
      
        const messageId = interaction.options.getString('message_id');
        const rerollWinners = interaction.options.getInteger('reroll_winners');
      
        // Fetch the giveaway from the database
        const giveaway = await GiveawayModel.findOne({ messageId });
        if (!giveaway) {
          return interaction.editReply({ content: '❌ No giveaway found with that message ID.' });
        }
      
        if (giveaway.entrants.length === 0) {
          return interaction.editReply({ content: '❌ No entries found for this giveaway.' });
        }
      
        // Determine how many winners to reroll
        const winnersToReroll = rerollWinners || giveaway.winners;
      
        // Shuffle and select winners from the entrants
        const shuffled = giveaway.entrants.sort(() => 0.5 - Math.random());
        const newWinners = shuffled.slice(0, Math.min(winnersToReroll, giveaway.entrants.length));
      
        // Format winner mentions
        const winnerMentions = newWinners.map(id => `<@${id}>`).join(', ');
      
        // Fetch the channel and giveaway message
        const channel = client.channels.cache.get(giveaway.channelId);
        if (!channel) {
          return interaction.editReply({ content: '❌ Giveaway channel no longer exists.' });
        }
      
        const giveawayMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
        if (!giveawayMessage) {
          return interaction.editReply({ content: '❌ Giveaway message no longer exists.' });
        }
      
        // Announce the new winners
        await channel.send({
          content: `🔄 **Reroll Results for Giveaway: ${giveaway.prize}**\n🏆 **New Winners:** ${winnerMentions}`,
        });
      
        interaction.editReply({
          content: `✅ Giveaway has been successfully rerolled!`,
        });
      }
}
};