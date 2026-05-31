const yaml = require("js-yaml");
const fs = require("fs");
const config = yaml.load(fs.readFileSync("./addons/StickyMessages/config.yml", "utf8"));
const StickyDB = require("../../db/sticky");

// Create a Map to store cooldown information for each channel
const cooldowns = new Map();

module.exports.register = ({ on, client }) => {
    if (!config.Enabled) return;

    on("messageCreate", async (message) => {
        if (message.author.id === message.client.user.id || !message.guild) return;

        const stickyMessage = StickyDB.find(message.channel.id);

        if (stickyMessage) {
            StickyDB.incrementCount(message.channel.id);

            // Check if the channel has a cooldown active
            if (!cooldowns.has(message.channel.id) || cooldowns.get(message.channel.id) <= Date.now()) {
                // Reset the cooldown
                cooldowns.set(message.channel.id, Date.now() + 1 * 1000);

                if (stickyMessage.msgCount >= config.MaxMessages) {
                    // Delete previous sticky messages
                    const messages = await message.channel.messages.fetch();
                    messages.forEach(async (msg) => {
                        if (msg.author.id === message.client.user.id) {
                            if (
                                (!config.EnableEmbeds && msg.content.includes(stickyMessage.message)) ||
                                (config.EnableEmbeds && msg.embeds.some(embed => embed.description && embed.description.includes(stickyMessage.message)))
                            ) {
                                await msg.delete().catch(() => {});
                            }
                        }
                    });

                    // Create the new sticky message
                    const embed = new message.client.EmbedBuilder();
                    if (config.EmbedSettings.Embed.Title) embed.setTitle(config.EmbedSettings.Embed.Title);
                    embed.setDescription(stickyMessage.message);
                    if (config.EmbedSettings.Embed.Color) embed.setColor(config.EmbedSettings.Embed.Color);
                    if (config.EmbedSettings.Embed.Image) embed.setImage(config.EmbedSettings.Embed.PanelImage);
                    if (config.EmbedSettings.Embed.CustomThumbnailURL) embed.setThumbnail(config.EmbedSettings.Embed.CustomThumbnailURL);
                    if (config.EmbedSettings.Embed.Footer.Enabled && config.EmbedSettings.Embed.Footer.text) {
                        embed.setFooter({ text: config.EmbedSettings.Embed.Footer.text });
                    }
                    if (config.EmbedSettings.Embed.Footer.CustomIconURL) {
                        embed.setFooter({ text: config.EmbedSettings.Embed.Footer.text, iconURL: config.EmbedSettings.Embed.Footer.CustomIconURL });
                    }
                    if (config.EmbedSettings.Embed.Timestamp) embed.setTimestamp();

                    let sentMessage;
                    if (config.EnableEmbeds) {
                        sentMessage = await message.channel.send({ embeds: [embed] });
                    } else {
                        sentMessage = await message.channel.send({ content: `${config.StickiedMessageTitle}\n\n${stickyMessage.message}` });
                    }

                    StickyDB.resetCount(message.channel.id);
                }
            } else {
                // Cooldown is still active, skip execution
                return;
            }
        }
    });
};
