const { SlashCommandBuilder } = require('@discordjs/builders');
const Discord = require("discord.js");
const { SnowflakeUtil } = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml");
const GiveawayModel = require('./GiveawayModel');
const config = yaml.load(fs.readFileSync('./addons/Giveaways/config.yml', 'utf8'));
const ms = require('ms');
const path = require('path');

module.exports.register = ({ on, emit, client }) => {
    // Handle giveaways ending periodically
    setInterval(async () => {
        try {
            const currentTime = Date.now();

            const giveaways = await GiveawayModel.find({
                status: 'active',
                endTime: { $lte: currentTime },
            });

            for (const giveaway of giveaways) {
                const channel = client.channels.cache.get(giveaway.channelId);
                if (!channel) {
                    console.error(`Channel ${giveaway.channelId} not found. Marking giveaway as ended.`);
                    await GiveawayModel.updateOne({ _id: giveaway._id }, { status: 'ended' });
                    continue;
                }

                const giveawayMessage = await channel.messages.fetch(giveaway.messageId).catch(() => null);
                if (!giveawayMessage) {
                    console.error(`Message ${giveaway.messageId} not found. Marking giveaway as ended.`);
                    await GiveawayModel.updateOne({ _id: giveaway._id }, { status: 'ended' });
                    continue;
                }

                let winners = [];
                let winnerMentions = '';
                let announcementMessage = '';

                if (giveaway.entrants.length > 0) {
                    // Shuffle entrants and select winners
                    for (let i = giveaway.entrants.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [giveaway.entrants[i], giveaway.entrants[j]] = [giveaway.entrants[j], giveaway.entrants[i]];
                    }

                    winners = giveaway.entrants.slice(0, Math.min(giveaway.winners, giveaway.entrants.length));
                    winnerMentions = winners.map(id => `<@${id}>`).join(', ');
                    announcementMessage = config.Messages.GiveawayWinnersAnnouncement
                        .replace('{prize}', giveaway.prize)
                        .replace('{winners}', winnerMentions);
                } else {
                    announcementMessage = config.Messages.GiveawayNoWinners.replace('{prize}', giveaway.prize);
                    winnerMentions = 'No valid entries!';
                }

                const nonce = SnowflakeUtil.generate();

                // Announce giveaway results
                await channel.send({ content: announcementMessage, enforceNonce: true, nonce: nonce.toString() });

                let hostedByUser = await client.users.fetch(giveaway.startedBy);

                // Create ended giveaway embed
                const endedEmbed = new Discord.EmbedBuilder()
                    .setTitle(config.EmbedEnded.Title.replace('{prize}', giveaway.prize))
                    .setDescription(
                        config.EmbedEnded.Description
                            .replace('{prize}', giveaway.prize)
                            .replace('{winners}', winnerMentions)
                            .replace('{entries}', giveaway.entrants.length)
                    )
                    .setColor(config.EmbedEnded.Color || '#FF6347')
                    .setTimestamp();

                if (config.EmbedEnded.Image) endedEmbed.setImage(config.EmbedEnded.Image);
                if (config.EmbedEnded.CustomThumbnailURL) endedEmbed.setThumbnail(config.EmbedEnded.CustomThumbnailURL);
                if (config.EmbedEnded.Footer.Enabled && config.EmbedEnded.Footer.text) {
                    endedEmbed.setFooter({
                        text: config.EmbedEnded.Footer.text.replace('{hosted-by}', `${hostedByUser.username}`),
                        iconURL: config.EmbedEnded.Footer.CustomIconURL || null,
                    });
                }

                if (giveawayMessage) {
                    await giveawayMessage.edit({ embeds: [endedEmbed], components: [] });
                }

                await GiveawayModel.updateOne({ _id: giveaway._id }, { status: 'ended' });
            }
        } catch (error) {
            console.error('Error checking giveaways:', error);
        }
    }, 2 * 60 * 1000); // Runs every 2 minutes

    // Handle interactionCreate for giveaways
    on('interactionCreate', async (interaction) => {
        if (interaction.customId === 'giveaway_enter') {
            try {
                await interaction.deferReply({ ephemeral: true });

                const giveaway = await GiveawayModel.findOne({
                    messageId: interaction.message.id,
                    channelId: interaction.channel.id,
                });

                if (!giveaway) {
                    return interaction.editReply({ content: config.Messages.GiveawayNotFound });
                }

                if (giveaway.minJoinDurationMs) {
                    const member = await interaction.guild.members.fetch(interaction.user.id);
                    const timeInServer = Date.now() - member.joinedAt;

                    if (timeInServer < giveaway.minJoinDurationMs) {
                        const requiredDays = Math.floor(giveaway.minJoinDurationMs / (1000 * 60 * 60 * 24));
                        return interaction.editReply({
                            content: `❌ You must be a member of this server for at least **${requiredDays} day(s)** to enter this giveaway.`,
                            ephemeral: true,
                        });
                    }
                }

                if (giveaway.entrants.includes(interaction.user.id)) {
                    return interaction.editReply({ content: config.Messages.AlreadyEntered || 'You have already entered this giveaway!' });
                }

                giveaway.entrants.push(interaction.user.id);
                await giveaway.save();

                const logFilePath = path.join(__dirname, 'logs.txt');
                const logEntry = `User Entered Giveaway:\n` +
                    `- User: ${interaction.user.username} (${interaction.user.id})\n` +
                    `- Giveaway: ${giveaway.prize}\n` +
                    `- Channel: #${interaction.channel.name} (${interaction.channel.id})\n` +
                    `- Time: ${new Date().toLocaleString()}\n\n`;
                fs.appendFileSync(logFilePath, logEntry, 'utf8');

                const entriesButtonVariables = config.EntriesButton.Label.replace(/{entries}/g, `${giveaway.entrants.length}`);
                const updatedButton = new Discord.ButtonBuilder()
                    .setCustomId('giveaway_enter')
                    .setStyle(config.Button.Style)
                    .setLabel(config.Button.Label);

                const updatedEntriesButton = new Discord.ButtonBuilder()
                    .setCustomId('giveaway_entries')
                    .setDisabled(true)
                    .setLabel(entriesButtonVariables)
                    .setStyle(Discord.ButtonStyle[config.EntriesButton.Style]);

                const actionRow = new Discord.ActionRowBuilder().addComponents(updatedButton, updatedEntriesButton);
                await interaction.message.edit({ components: [actionRow] });

                const successMessage = config.Messages.EntrySuccess.replace(/{prize}/g, giveaway.prize)
                    .replace(/{winners}/g, giveaway.winners)
                    .replace(/{hosted-by}/g, `<@${giveaway.startedBy}>`);

                interaction.editReply({ content: successMessage });
            } catch (error) {
                console.error('Error adding giveaway entry:', error);
                interaction.editReply({ content: config.Messages.EntryError || 'An error occurred while entering the giveaway. Please try again later.' });
            }
        }
    });

    // Handle messageDelete
    on('messageDelete', async (message) => {
        try {
            const giveaway = await GiveawayModel.findOne({ messageId: message.id });
            if (giveaway) {
                await GiveawayModel.deleteOne({ messageId: message.id });
            }
        } catch (error) {
            console.error('Error deleting giveaway after message deletion:', error);
        }
    });

    // Handle channelDelete
    on('channelDelete', async (channel) => {
        try {
            const giveaways = await GiveawayModel.find({ channelId: channel.id });
            if (giveaways.length > 0) {
                await GiveawayModel.deleteMany({ channelId: channel.id });
            }
        } catch (error) {
            console.error('Error deleting giveaways after channel deletion:', error);
        }
    });

    // Handle guildMemberRemove
    on('guildMemberRemove', async (member) => {
        try {
            const activeGiveaways = await GiveawayModel.find({ status: 'active', entrants: member.id });

            for (const giveaway of activeGiveaways) {
                giveaway.entrants = giveaway.entrants.filter(userId => userId !== member.id);
                await giveaway.save();
            }

            console.log(`User ${member.id} removed from ${activeGiveaways.length} giveaway(s) due to leaving the server.`);
        } catch (error) {
            console.error(`Error removing user ${member.id} from giveaways:`, error);
        }
    });
};
