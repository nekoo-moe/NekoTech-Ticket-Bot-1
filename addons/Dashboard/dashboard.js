const express = require('express');
const passport = require('passport');
const session = require('express-session');
const DiscordStrategy = require('passport-discord').Strategy;
const ejs = require('ejs');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const MongoStore = require('connect-mongo');
const ms = require('ms');

const app = express();

const { Discord, ChannelType} = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const dconfig = yaml.load(fs.readFileSync('./addons/Dashboard/config.yml', 'utf8'))
const guildModel = require("../../models/guildModel");
const ticketModel = require("../../models/ticketModel");
const reviewsModel = require("../../models/reviewsModel");
const dashboardModel = require("../../models/dashboardModel");
const { marked } = require('marked');
const { WebhookClient } = require('discord.js');

const PORT = dconfig.Port;

module.exports.register = ({ on, emit, client }) => {

async function checkDatabase(userId) {
    let dModel = await dashboardModel.findOne({});
    
    if (!dModel) {
        dModel = new dashboardModel({
            guildID: config.GuildID,
            url: dconfig.URL,
            port: PORT,
        });
        await dModel.save();
    } else {
        if (dModel.guildID !== config.GuildID) {
            await dashboardModel.deleteMany({});
            dModel = new dashboardModel({
                guildID: config.GuildID,
                url: dconfig.URL,
                port: PORT,
            });
            await dModel.save();
        } else {
            dModel.url = dconfig.URL;
            dModel.port = PORT;
            await dModel.save();
        }
    }
}
checkDatabase()

  const currentDirectory = path.basename(__dirname);
  if (currentDirectory !== 'Dashboard') {
    console.log('\x1b[31m%s\x1b[0m', `[DASHBOARD] The folder name for the Dashboard addon needs to be named "Dashboard" or it won't function! Rename it and restart the bot.`);
    console.log('\x1b[31m%s\x1b[0m', `[DASHBOARD] The folder name for the Dashboard addon needs to be named "Dashboard" or it won't function! Rename it and restart the bot.`);
    console.log('\x1b[31m%s\x1b[0m', `[DASHBOARD] The folder name for the Dashboard addon needs to be named "Dashboard" or it won't function! Rename it and restart the bot.`);
    return;
  }

  if(config?.trustProxy) app.set('trust proxy', 1);

app.use(session({
  secret: dconfig.secretKey,
  resave: true,
  saveUninitialized: true,
  store: MongoStore.create({ 
      mongoUrl: config.MongoURI,
      ttl: ms(dconfig.SessionExpires),
      autoRemove: 'native'
  }),

  cookie: {
      secure: dconfig.Secure,
      maxAge: ms(dconfig.SessionExpires)
  }
}));


app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());
app.use(passport.session());
app.use(bodyParser.json());

passport.use(
    new DiscordStrategy(
      {
        clientID: dconfig.clientID,
        clientSecret: dconfig.clientSecret,
        callbackURL: dconfig.callbackURL,
        scope: ['identify', 'guilds'],
      },
      (accessToken, refreshToken, profile, done) => {
        return done(null, profile);
      }
    )
);

passport.serializeUser((user, done) => {
    done(null, user);
  });
  
  passport.deserializeUser((obj, done) => {
    done(null, obj);
  });

app.set('view engine', 'ejs');
app.set('views', __dirname + '/views');

const publicPath = path.join(__dirname, 'public');
app.use(express.static(publicPath));

// Get Plex Tickets version
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
const discordBotVersion = packageJson.version;
app.locals.discordBotVersion = discordBotVersion;

// Get Dashboard version
const versionJsonPath = path.join(__dirname, 'version.json');
const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
const dashboardVersion = versionJson.dashboardVersion;
app.locals.dashboardVersion = dashboardVersion;


function hexToRgb(hex) {
  hex = hex.replace('#', '');
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

function getAccentColor() {
  const config = yaml.load(fs.readFileSync('config.yml', 'utf8'));
  const hexColor = config.EmbedColors;
  const rgbColor = hexToRgb(hexColor);
  return { hex: hexColor, rgb: rgbColor };
}

const { hex, rgb } = getAccentColor();
app.locals.accentColorHex = hex;
app.locals.accentColorRgb = rgb;
  
const isLoggedIn = async (req, res, next) => {
  if (req.isAuthenticated()) {
    try {
      const guild = client.guilds.cache.get(config.GuildID);
      if (guild && guild.members) {
        const member = await guild.members.fetch(req.user.id);
        if (member && member.roles) {
          const supportRoles = Object.values(config.TicketCategories || {})
            .flatMap(category => category.SupportRoles || []);
          
          const uniqueSupportRoles = [...new Set(supportRoles)];
          
          const userHasSupportRole = member.roles.cache.some((role) =>
            uniqueSupportRoles.includes(role.id)
          );

          if (userHasSupportRole) {
            return next();
          }
        }
      }
    } catch (error) {
      console.error("Error fetching guild or member from Discord API:", error);
    }
  }
  res.cookie("redirectAfterLogin", req.originalUrl);
  res.redirect(`/login`);
};

const transcriptAccessCheck = async (req, res, next) => {
  const { channelId, dateNow } = req.query;
  if (!channelId || !dateNow) {
    return res.status(400).render('error', { message: 'Missing required parameters' });
  }

  const fileName = `transcript-${channelId}-${dateNow}.html`;
  const filePath = path.join(__dirname, 'transcripts', fileName);

  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
  } catch (err) {
    return res.status(403).render('error', { message: 'Transcript not found' });
  }

  if (dconfig.PublicTranscripts === true) {
    req.transcriptFilePath = filePath;
    return next();
  }

  if (req.isAuthenticated()) {
    req.transcriptFilePath = filePath;
    return next();
  } else {
    res.cookie('redirectAfterLogin', req.originalUrl);
    return res.redirect('/login');
  }
};
  

app.get('/auth/discord/callback', passport.authenticate('discord', { failureRedirect: '/login' }), (req, res) => {
  const redirectUrl = req.cookies['redirectAfterLogin'] || '/';
  res.redirect(redirectUrl);
});

app.get('/auth', passport.authenticate('discord'));


app.get('/home', isLoggedIn, async (req, res) => {
  try {
    const guildStats = await guildModel.findOne({ guildID: config.GuildID });

    const ratings = guildStats.reviews.map(review => review.rating);
    const nonZeroRatings = ratings.filter(rating => rating !== 0);
    const averageRating = nonZeroRatings.length
      ? (nonZeroRatings.reduce((a, b) => a + b) / nonZeroRatings.length).toFixed(1)
      : "0.0";

    const recentTickets = await ticketModel
      .find({ guildID: config.GuildID })
      .sort({ ticketCreationDate: -1 })
      .limit(5);


      const ticketsWithUsernames = await Promise.all(
        recentTickets.map(async (ticket) => {
          try {
            const user = await client.users.fetch(ticket.userID);
            return { ...ticket._doc, username: user.username };
          } catch (error) {
            console.error(`Failed to fetch username for userID: ${ticket.userID}`, error);
            return { ...ticket._doc, username: "Unknown User" };
          }
        })
      );


    res.render('home', { user: req.user, guildStats: guildStats, averageRating: averageRating, recentTickets: ticketsWithUsernames, config: dconfig,
    });
  } catch (error) {
    console.error('Error fetching data from MongoDB:', error);
    res.render('home', { user: req.user, guildStats: null, averageRating: "0.0", recentTickets: [], });
  }
});



app.get('/statistics', isLoggedIn, async (req, res) => {
  try {
      const guildStats = await guildModel.findOne({ guildID: config.GuildID });
      const guild = client.guilds.cache.get(config.GuildID);

      const ratings = guildStats.reviews.map(review => review.rating);
      const nonZeroRatings = ratings.filter(rating => rating !== 0);
      const averageRating = nonZeroRatings.length ? (nonZeroRatings.reduce((a, b) => a + b) / nonZeroRatings.length).toFixed(1) : "0.0";

      res.render('statistics', { user: req.user, guildStats: guildStats, averageRating: averageRating, guild: guild });
  } catch (error) {
      console.error('Error fetching data from MongoDB:', error);
      res.render('statistics', { user: req.user, guildStats: null, averageRating: "0.0" });
  }
});

async function getUserInfo(userId) {
  try {
      const discordUser = await client.users.fetch(userId);

      const avatarURL = discordUser.avatar ? discordUser.avatarURL() : 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png';

      return {
          username: discordUser.username,
          avatarURL: avatarURL,
      };
  } catch (error) {
      return {
          username: 'Unknown',
          avatarURL: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png', // Provide a default avatar URL
      };
  }
}


async function getUserRoles(userId, guildId) {
  try {
    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(userId);

    const userRoles = member.roles.cache.map(role => role.id);

    return userRoles;
  } catch (error) {
    console.error('Error fetching user roles:', error);
    return [];
  }
}


app.get('/reviews', isLoggedIn, async (req, res) => {
  try {
    const reviewsData = await reviewsModel.find({ rating: { $gte: 1 } });

    const reviewsWithUserInfo = await Promise.all(reviewsData.map(async (review) => {
      const userInfo = await getUserInfo(review.userID);
      return {
        ...review._doc,
        userInfo,
      };
    }));

    const sortOption = req.query.sort || 'recent';
    const hasDate = (review) => review.updatedAt || review.createdAt;

    switch (sortOption) {
      case 'lowToHigh':
        reviewsWithUserInfo.sort((a, b) => a.rating - b.rating);
        break;
      case 'highToLow':
        reviewsWithUserInfo.sort((a, b) => b.rating - a.rating);
        break;
      case 'recent':
        reviewsWithUserInfo.sort((a, b) => {
          if (hasDate(a) && hasDate(b)) {
            return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
          } else if (hasDate(a)) {
            return -1;
          } else if (hasDate(b)) {
            return 1;
          } else {
            return 0;
          }
        });
        break;
      default:
        break;
    }

    const page = parseInt(req.query.page) || 1;
    const limit = 9;
    const startIndex = (page - 1) * limit;
    const endIndex = page * limit;

    const paginatedReviews = reviewsWithUserInfo.slice(startIndex, endIndex);
    const totalPages = Math.ceil(reviewsWithUserInfo.length / limit);

    const userRoles = await getUserRoles(req.user.id, config.GuildID);

    res.render('reviews', {
      user: req.user,
      reviews: paginatedReviews,
      req: req,
      sortOption: sortOption,
      userRoles: userRoles,
      currentPage: page,
      reviewsData,
      totalPages: totalPages,
    });
  } catch (error) {
    console.error('Error fetching reviews data:', error);
    res.render('reviews', { user: req.user, reviews: [], req: req });
  }
});


app.get('/transcript', transcriptAccessCheck, async (req, res) => {
  try {
    if (dconfig.PublicTranscripts === true) {
      return fs.readFile(req.transcriptFilePath, 'utf8', (err, data) => {
        if (err) {
          return res.status(500).render('error', { message: 'Error reading transcript' });
        }
        res.send(data);
      });
    }

    const { channelId } = req.query;
    
    const ticketDB = await ticketModel.findOne({ channelID: channelId });
    if (!ticketDB) return res.status(403).render('error', { message: 'Ticket not found' });

    const ticketCreator = await client.users.cache.get(ticketDB.userID);
    const guild = client.guilds.cache.get(config.GuildID);
    const requesterMember = guild.members.cache.get(req.user.id);

    const userRoles = await getUserRoles(req.user.id, config.GuildID);

    let supportR = false;
    
    if (config.TicketCategories) {
      const category = Object.values(config.TicketCategories).find(
        cat => cat.CategoryName === ticketDB.ticketType
      );
      
      if (category && category.SupportRoles) {
        supportR = category.SupportRoles.some(role => userRoles.includes(role));
      }
    }

    const hasPermission =
      (ticketCreator && ticketCreator.id && req.user.id === ticketCreator.id) ||
      supportR;

    if (!hasPermission) {
      return res.status(403).render('error', { message: 'You do not have the required permissions to access this page.' });
    }

    fs.readFile(req.transcriptFilePath, 'utf8', (err, data) => {
      if (err) {
        return res.status(500).render('error', { message: 'Error reading transcript' });
      }
      res.send(data);
    });
  } catch (error) {
    console.error('Error fetching ticket information:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.get('/tickets', isLoggedIn, async (req, res) => {
  try {
    const userRoles = await getUserRoles(req.user.id, config.GuildID);
    const accessibleCategories = Object.entries(config.TicketCategories || {})
    .filter(([categoryId, category]) => 
      category.SupportRoles?.some(role => userRoles.includes(role))
    )
    .map(([categoryId, category]) => category.CategoryName);

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;
    const searchQuery = req.query.search?.trim();

    let query = {
      status: 'Closed',
      ticketType: { $in: accessibleCategories }
    };

    if (searchQuery) {
      query = {
        ...query,
        $or: [
          { identifier: { $regex: searchQuery, $options: 'i' } },
          { userID: { $regex: searchQuery, $options: 'i' } },
        ]
      };
    }

    const totalTickets = await ticketModel.countDocuments(query);
    const totalPages = Math.ceil(totalTickets / limit);

    const closedTickets = await ticketModel.find(query)
      .sort({ closedAt: -1 })
      .skip(skip)
      .limit(limit);

    const closedTicketsWithInfo = await Promise.all(
      closedTickets.map(async ticket => {
        const userInfo = await getUserInfo(ticket.userID);
        const closedByInfo = ticket.closedBy ? await getUserInfo(ticket.closedBy) : null;

        return {
          ...ticket._doc,
          username: userInfo.username,
          avatar: userInfo.avatarURL,
          closedByUsername: closedByInfo ? closedByInfo.username : 'Unknown',
          totalMessages: ticket.messages || 0,
          createdAtFormatted: new Date(ticket.createdAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit'
          }),
          closedAtFormatted: new Date(ticket.closedAt).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: '2-digit'
          })
        };
      })
    );

    res.render('tickets', {
      user: req.user,
      tickets: closedTicketsWithInfo,
      currentPage: page,
      totalPages: totalPages,
      totalTickets: totalTickets,
      searchQuery: searchQuery,
      config: dconfig
    });
  } catch (error) {
    console.error('Error fetching tickets history:', error);
    res.render('tickets', { 
      user: req.user, 
      tickets: [], 
      currentPage: 1,
      totalPages: 1,
      totalTickets: 0,
      searchQuery: req.query.search
    });
  }
});

app.get('/open-tickets', isLoggedIn, async (req, res) => {
  try {
    const userRoles = await getUserRoles(req.user.id, config.GuildID);

    const accessibleCategories = Object.entries(config.TicketCategories || {})
      .filter(([categoryId, category]) => 
        category.SupportRoles?.some(role => userRoles.includes(role))
      )
      .map(([categoryId, category]) => category.CategoryName);

    const openTickets = await ticketModel.find({
      status: 'Open',
      ticketType: { $in: accessibleCategories },
    });

    const openTicketsTotal = openTickets.length;

    const openTicketsWithUserInfo = await Promise.all(
      openTickets.map(async ticket => {
        const userInfo = await getUserInfo(ticket.userID);
        const claimUser = ticket.claimUser ? await getUserInfo(ticket.claimUser) : null;

        return {
          ...ticket._doc,
          username: userInfo.username,
          avatar: userInfo.avatarURL,
          claimUserInfo: claimUser
            ? {
                username: claimUser.username,
                avatar: claimUser.avatarURL,
              }
            : {
                username: "Not claimed",
                avatar: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png",
              },
        };
      })
    );

    const categorizedTickets = {};
    openTicketsWithUserInfo.forEach(ticket => {
      if (ticket.ticketType) {
        if (!categorizedTickets[ticket.ticketType]) {
          categorizedTickets[ticket.ticketType] = [];
        }
        categorizedTickets[ticket.ticketType].push(ticket);
      }
    });

    const filteredCategories = Object.keys(categorizedTickets).reduce(
      (acc, ticketType) => {
        if (categorizedTickets[ticketType].length > 0) {
          acc[ticketType] = categorizedTickets[ticketType];
        }
        return acc;
      },
      {}
    );

    res.render('open-tickets', {
      user: req.user,
      categorizedTickets: filteredCategories,
      userRoles: userRoles,
      openTicketsTotal: openTicketsTotal,
      config: dconfig,
    });
  } catch (error) {
    console.error('Error fetching tickets data:', error);
    res.render('open-tickets', { user: req.user, tickets: [], currentPage: 1 });
  }
});


app.get('/open-tickets/:ticket_id', isLoggedIn, async (req, res) => {
  try {
    const ticketId = req.params.ticket_id;

    const ticket = await ticketModel.findOne({ identifier: ticketId });
    if (!ticket) {
      return res.redirect('/open-tickets');
    }

    const ticketCreator = await client.users.cache.get(ticket.userID);
    const guild = client.guilds.cache.get(config.GuildID);
    const requesterMember = guild.members.cache.get(req.user.id);

    const userRoles = await getUserRoles(req.user.id, config.GuildID);

    let supportR = false;
    
    if (config.TicketCategories) {
      const category = Object.values(config.TicketCategories).find(
        cat => cat.CategoryName === ticket.ticketType
      );
      
      if (category && category.SupportRoles) {
        supportR = category.SupportRoles.some(role => userRoles.includes(role));
      }
    }

    const hasPermission =
      (ticketCreator && ticketCreator.id && req.user.id === ticketCreator.id) ||
      supportR;

    if (!hasPermission) {
      return res.status(403).render('error', { message: 'You do not have the required permissions to access this page.' });
    }

    const channel = await client.channels.fetch(ticket.channelID);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).render('error', { message: 'Channel not found or not accessible.' });
    }

    const userInfo = await getUserInfo(ticket.userID);

    const createdAt = new Date(ticket.createdAt);
    const now = new Date();
    const duration = now - createdAt;

    const durationDays = Math.floor(duration / (1000 * 60 * 60 * 24));
    const durationHours = Math.floor((duration % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const durationMinutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));

    let openDuration = '';
    if (durationDays > 0) openDuration += `${durationDays} day${durationDays > 1 ? 's' : ''}`;
    if (durationHours > 0) openDuration += `${openDuration ? ', ' : ''}${durationHours} hour${durationHours > 1 ? 's' : ''}`;
    if (durationMinutes > 0 || openDuration === '') openDuration += `${openDuration ? ', ' : ''}${durationMinutes} minute${durationMinutes > 1 ? 's' : ''}`;

    const messages = await channel.messages.fetch({ limit: 100 });
    const messageArray = messages.map(msg => ({
      id: msg.id,
      username: msg.author.username,
      avatar: msg.author.displayAvatarURL(),
      content: msg.content,
      createdAt: msg.createdAt,
      attachments: msg.attachments.map(attachment => ({
        url: attachment.url,
        name: attachment.name,
        type: attachment.contentType,
      })),
      embeds: msg.embeds.map(embed => ({
        title: embed.title,
        description: embed.description ? marked(embed.description) : null,
        url: embed.url,
        color: embed.color,
        fields: embed.fields?.map(field => ({
          name: field.name,
          value: marked(field.value),
          inline: field.inline,
        })),
        footer: embed.footer,
        timestamp: embed.timestamp,
        thumbnail: embed.thumbnail?.url,
        image: embed.image?.url,
      })),
    }));

    res.render('view-ticket', {
      user: req.user,
      ticket: {
        ...ticket.toJSON(),
        channelName: channel.name,
        openDuration,
      },
      userInfo,
      messages: messageArray,
    });
  } catch (error) {
    console.error('Error fetching ticket data:', error);
    res.status(500).render('error', { message: 'An error occurred while fetching the ticket.' });
  }
});

app.post('/open-tickets/:ticket_id/close', isLoggedIn, async (req, res) => {
  try {
    const ticketId = req.params.ticket_id;

    const ticket = await ticketModel.findOne({ identifier: ticketId });
    if (!ticket) {
      res.redirect('/open-tickets'); 
    }

    const channel = await client.channels.fetch(ticket.channelID);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).render('error', { message: 'Channel not found or not accessible.' });
    }

    const guild = client.guilds.cache.get(config.GuildID);


    const mockInteraction = {
      customId: 'closeTicket',
      dashboard: true,
      channel,
      guild,
      user: req.user,
    };

              await ticketModel.updateOne(
                { channelID: channel.id },
                {
                    $set: {
                        closeUserID: req.user.id,
                        closedAt: Date.now(),
                        status: 'Closed',
                    },
                }
            );

    await client.emit('ticketClose', mockInteraction);

    res.status(200).json({ success: true, message: 'Ticket closed successfully.' });
  } catch (error) {
    console.error('Error closing ticket:', error);
    res.status(500).json({ error: 'An error occurred while closing the ticket.' });
  }
});

async function getOrCreateWebhook(channel) {
  const webhooks = await channel.fetchWebhooks();
  let webhook = webhooks.find(w => w.name === "TicketWebhook");

  if (!webhook) {
    webhook = await channel.createWebhook({
      name: "TicketWebhook",
      avatar: "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png", // Optional: Set your webhook avatar
    });
  }

  return webhook;
}

app.post('/open-tickets/:ticket_id/respond', isLoggedIn, async (req, res) => {
  try {
    const ticketId = req.params.ticket_id;
    const { message } = req.body;

    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const ticket = await ticketModel.findOne({ identifier: ticketId });
    if (!ticket) {
      return res.status(404).render('error', { message: 'Ticket not found.' });
    }

    const channel = await client.channels.fetch(ticket.channelID);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).render('error', { message: 'Channel not found or not accessible.' });
    }

    const webhook = await getOrCreateWebhook(channel);

    await webhook.send({
      content: message,
      username: req.user.username,
      avatarURL: `https://cdn.discordapp.com/avatars/${req.user.id}/${req.user.avatar}.webp?size=240` || 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png', // Use user's avatar
    });

  if (config.TicketAlert.Enabled) {
    const filtered = await ticketModel.find({
      closeNotificationTime: { $exists: true, $ne: null },
      channelID: channel.id
    });

    for (const time of filtered) {
      if (!time) continue;
      if (!time.channelID) continue;
      if (time.closeNotificationTime === 0) continue;

      if (time.channelID === channel.id) {
        await ticketModel.findOneAndUpdate(
          { channelID: channel.id },
          { $unset: { closeReason: 1 }, $set: { closeNotificationTime: 0 } }
        );

        try {
          const msg = await channel.messages.fetch(time.closeNotificationMsgID);
          await msg.delete();
        } catch (error) {
          console.error("Error deleting message:", error);
        }
      }
    }
  }

    res.status(200).json({ success: true, message: 'Response sent successfully.' });
  } catch (error) {
    console.error('Error sending response:', error);
    res.status(500).json({ error: 'An error occurred while sending the response.' });
  }
});


app.get('/open-tickets/:ticket_id/messages', isLoggedIn, async (req, res) => {
  const ticketId = req.params.ticket_id;
  const ticket = await ticketModel.findOne({ identifier: ticketId });
  const channel = await client.channels.fetch(ticket.channelID);

   const messages = await channel.messages.fetch({ limit: 100 });
   const messageArray = messages.map((msg) => ({
     id: msg.id,
     username: msg.author.username,
     avatar: msg.author.displayAvatarURL(),
     content: msg.content,
     createdAt: msg.createdAt,
     attachments: msg.attachments.map((attachment) => ({
       url: attachment.url,
       name: attachment.name,
       type: attachment.contentType,
     })),
     embeds: msg.embeds.map((embed) => ({
       title: embed.title,
       description: embed.description ? marked(embed.description) : null,
       url: embed.url,
       color: embed.color,
       fields: embed.fields?.map((field) => ({
         name: field.name,
         value: marked(field.value),
         inline: field.inline,
       })),
       footer: embed.footer,
       timestamp: embed.timestamp,
       thumbnail: embed.thumbnail?.url,
       image: embed.image?.url,
     })),
   }));

   res.json(messageArray);
});


app.post('/delete-ticket/:channelId', isLoggedIn, async (req, res) => {
  try {
      const ticketId = req.params && req.params.channelId;

      await ticketModel.findOneAndDelete({ channelID: ticketId });
      res.redirect('/open-tickets'); 
  } catch (error) {
      console.error('Error deleting ticket:', error);
      res.redirect('/open-tickets');
  }
});



const BlacklistedUser = require('../../models/blacklistedUsersModel');
app.get('/blacklist', isLoggedIn, async (req, res) => {
  try {
      const blacklistedUsers = await BlacklistedUser.find({ blacklisted: true });

      const blacklistedUsersWithInfo = await Promise.all(blacklistedUsers.map(async (user) => {
          try {
              const userInfo = await getUserInfo(user.userId);

              return {
                  ...user._doc,
                  username: userInfo.username,
                  avatar: userInfo.avatarURL,
              };
          } catch (error) {
              return {
                  ...user._doc,
                  username: 'Unknown',
                  avatar: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png',
              };
          }
      }));

      blacklistedUsersWithInfo.sort((a, b) => b.updatedAt - a.updatedAt);
      const userRoles = await getUserRoles(req.user.id, config.GuildID);

      res.render('blacklist', { user: req.user, blacklistedUsers: blacklistedUsersWithInfo, userRoles: userRoles, config: dconfig, invalidUserId: false });
  } catch (error) {
      console.error('Error fetching blacklisted users:', error);
      res.status(500).send('Internal Server Error');
  }
});

app.post('/blacklist', isLoggedIn, async (req, res) => {
  const { userId, action } = req.body;

  try {
    const guild = client.guilds.cache.get(config.GuildID);
    const member = await guild.members.fetch(userId).catch(() => null);

    if (member || action === 'unblacklist') {
      if (action === 'unblacklist') {
        await BlacklistedUser.findOneAndUpdate({ userId }, { $set: { blacklisted: false } });
      } else {
        await BlacklistedUser.findOneAndUpdate({ userId }, { $set: { blacklisted: true } }, { upsert: true });
      }
      return res.redirect('/blacklist');
    } else {
      return res.render('blacklist', {
        user: req.user,
        blacklistedUsers: await BlacklistedUser.find({ blacklisted: true }),
        invalidUserId: true,
      });
    }
  } catch (error) {
    console.error('Error processing blacklist request:', error);
    res.status(500).send('Internal Server Error');
  }
});

  
app.get('/', (req, res) => {
    res.redirect('/home');
});

  app.get('/login', (req, res) => {
    res.render('login');
  });

  app.get('/logout', (req, res) => {
    res.clearCookie('redirectAfterLogin');
    req.logout((err) => {
      if (err) {
        console.error('Error during logout:', err);
        return next(err);
      }
      res.redirect('/');
    });
  });
  
  app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something went wrong!');
  });
  

  const color = require('ansi-colors');
  app.listen(PORT, () => {
    console.log(
      `${color.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n` +
      `${color.green.bold.underline(`Plex Tickets Dashboard v${dashboardVersion} Successfully Loaded!`)}\n` +
      `Dashboard is live and accessible at: ${color.cyan.bold(dconfig.URL)}\n\n` +
      `${color.bold.green('Made by Plex Development')}\n` +
      `${color.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`
      );
  });
};