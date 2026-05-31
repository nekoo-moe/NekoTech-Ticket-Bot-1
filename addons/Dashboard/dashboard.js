const express = require('express');
const passport = require('passport');
const session = require('express-session');
const DiscordStrategy = require('passport-discord').Strategy;
const ejs = require('ejs');
const path = require('path');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const SQLiteStore = require('../../db/sessionStore');
const ms = require('ms');

const app = express();

const { Discord, ChannelType} = require("discord.js");
const fs = require('fs');
const yaml = require("js-yaml")
const config  = yaml.load(fs.readFileSync('./config.yml', 'utf8'))
const dconfig = yaml.load(fs.readFileSync('./addons/Dashboard/config.yml', 'utf8'))

// SQLite DB modules (thay thế Mongoose)
const db         = require('../../db/index');
const Guild      = require('../../db/guild');
const Tickets    = require('../../db/tickets');
const Reviews    = require('../../db/reviews');
const { getConfig } = require('../../db/config');
const { t, getTranslations } = require('../../lang/index');

const { marked } = require('marked');
const { WebhookClient } = require('discord.js');

const PORT = dconfig.Port;

let _serverStarted = false;

module.exports.register = ({ on, emit, client }) => {

// Lưu URL/port vào SQLite thay vì dashboardModel
function checkDatabase() {
  db.prepare(`
    INSERT INTO dashboard (guildID, url, port) VALUES (?, ?, ?)
    ON CONFLICT(guildID) DO UPDATE SET url = excluded.url, port = excluded.port
  `).run(config.GuildID, dconfig.URL, String(PORT));
}
checkDatabase();

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
  resave: false,
  saveUninitialized: false,
  store: new (SQLiteStore(session))({
    ttl: ms(dconfig.SessionExpires) / 1000,
  }),
  cookie: {
    secure: dconfig.Secure,
    maxAge: ms(dconfig.SessionExpires),
  },
}));


app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());
app.use(passport.session());

// ── i18n middleware — truyền hàm t() vào tất cả EJS templates ──────────────
app.use((req, res, next) => {
  res.locals.t    = t;
  res.locals.lang = getTranslations();
  next();
});

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

// Get Heiznerd Tickets version
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
  const hexColor = config.EmbedColors || getConfig('bot.embedColor', '#5e99ff');
  const rgbColor = hexToRgb(hexColor);
  return { hex: hexColor, rgb: rgbColor };
}

const { hex, rgb } = getAccentColor();
app.locals.accentColorHex = hex;
app.locals.accentColorRgb = rgb;
  
const isLoggedIn = async (req, res, next) => {
  if (req.isAuthenticated()) {
    // Nếu chưa chọn server, redirect về server selection
    if (!req.session.selectedGuildId) {
      res.cookie('redirectAfterLogin', req.originalUrl);
      return res.redirect('/servers');
    }

    try {
      const guildId = req.session.selectedGuildId;
      const guild = client.guilds.cache.get(guildId);
      if (guild && guild.members) {
        const member = await guild.members.fetch(req.user.id);
        if (member && member.roles) {

          // ── Kiểm tra quyền Admin Discord (Owner hoặc Administrator) ──────
          if (member.permissions.has('Administrator')) {
            return next();
          }

          // ── Kiểm tra staffRoles từ SQLite config ─────────────────────────
          const staffRoles = getConfig('staffRoles', []);

          // ── Kiểm tra support roles từ categories trong SQLite ─────────────
          const Categories = require('../../db/categories');
          const allCats = Categories.findAll();
          const catSupportRoles = allCats.flatMap(cat =>
            Array.isArray(cat.supportRoles) ? cat.supportRoles : []
          );

          const allAllowedRoles = [...new Set([...staffRoles, ...catSupportRoles])];

          const userHasRole = member.roles.cache.some(role =>
            allAllowedRoles.includes(role.id)
          );

          if (userHasRole) {
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
  // Sau khi login, redirect về server selection thay vì thẳng vào dashboard
  const redirectUrl = req.cookies['redirectAfterLogin'];
  if (redirectUrl && redirectUrl !== '/' && redirectUrl !== '/home') {
    res.clearCookie('redirectAfterLogin');
    res.redirect(redirectUrl);
  } else {
    res.redirect('/servers');
  }
});

// ── Server Selection ──────────────────────────────────────────────────────────
app.get('/servers', async (req, res) => {
  if (!req.isAuthenticated()) {
    res.cookie('redirectAfterLogin', '/servers');
    return res.redirect('/login');
  }
  try {
    // Lấy danh sách guilds mà bot đang có mặt
    const botGuilds = client.guilds.cache;
    const servers = [];

    for (const [guildId, guild] of botGuilds) {
      try {
        // Kiểm tra user có quyền truy cập không
        const member = await guild.members.fetch(req.user.id).catch(() => null);
        if (!member) continue;

        // Admin Discord hoặc có staff/support role
        const staffRoles = require('../../db/config').getConfig('staffRoles', []);
        const Categories = require('../../db/categories');
        const allCats = Categories.findAll();
        const catRoles = allCats.flatMap(c => Array.isArray(c.supportRoles) ? c.supportRoles : []);
        const allRoles = [...new Set([...staffRoles, ...catRoles])];

        const hasAccess = member.permissions.has('Administrator') ||
          member.roles.cache.some(r => allRoles.includes(r.id));

        if (hasAccess) {
          servers.push({
            id:          guild.id,
            name:        guild.name,
            icon:        guild.icon,
            memberCount: guild.memberCount,
          });
        }
      } catch (_) {}
    }

    res.render('select-server', {
      user: req.user,
      servers,
      accentColorHex: app.locals.accentColorHex,
      accentColorRgb: app.locals.accentColorRgb,
    });
  } catch (error) {
    console.error('Error loading server list:', error);
    res.status(500).render('error', { message: 'Lỗi tải danh sách máy chủ', accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb });
  }
});

// Chọn server cụ thể — lưu vào session rồi redirect vào dashboard
app.get('/select-server/:guildId', async (req, res) => {
  if (!req.isAuthenticated()) return res.redirect('/login');
  const { guildId } = req.params;
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return res.status(404).render('error', { message: 'Máy chủ không tồn tại hoặc bot chưa được thêm vào.', accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb });

  // Kiểm tra quyền
  const member = await guild.members.fetch(req.user.id).catch(() => null);
  if (!member) return res.status(403).render('error', { message: 'Bạn không phải thành viên của máy chủ này.', accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb });

  // Lưu guildId đã chọn vào session
  req.session.selectedGuildId = guildId;
  res.redirect('/home');
});

app.get('/auth', passport.authenticate('discord'));


app.get('/home', isLoggedIn, async (req, res) => {
  try {
    const guildStats = Guild.getOrCreate(config.GuildID);

    const ratings    = guildStats.reviews.map(r => r.rating);
    const nonZero    = ratings.filter(r => r !== 0);
    const avgRating  = nonZero.length
      ? (nonZero.reduce((a, b) => a + b) / nonZero.length).toFixed(1)
      : "0.0";

    const recentTickets = db.prepare(
      'SELECT * FROM tickets WHERE guildID = ? ORDER BY ticketCreationDate DESC LIMIT 5'
    ).all(config.GuildID);


      const ticketsWithUsernames = await Promise.all(
        recentTickets.map(async (ticket) => {
          try {
            const user = await client.users.fetch(ticket.userID);
            return { ...ticket, username: user.username };
          } catch (error) {
            console.error(`Failed to fetch username for userID: ${ticket.userID}`, error);
            return { ...ticket, username: "Unknown User" };
          }
        })
      );


    res.render('home', { user: req.user, guildStats: guildStats, averageRating: avgRating, recentTickets: ticketsWithUsernames, config: dconfig, accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb,
    });
  } catch (error) {
    console.error('Error fetching data:', error);
    res.render('home', { user: req.user, guildStats: { totalTickets:0, totalMessages:0, averageResponse:'N/A', averageRating:0, totalReviews:0 }, averageRating: "0.0", recentTickets: [], accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb });
  }
});



app.get('/statistics', isLoggedIn, async (req, res) => {
  try {
      const guildStats = Guild.getOrCreate(config.GuildID);
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
    const reviewsData = db.prepare(
      'SELECT * FROM reviews WHERE rating >= 1 ORDER BY createdAt DESC'
    ).all();

    const reviewsWithUserInfo = await Promise.all(reviewsData.map(async (review) => {
      const userInfo = await getUserInfo(review.userID);
      return {
        ...review,
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
    
    const ticketDB = Tickets.findByChannelID(channelId);
    if (!ticketDB) return res.status(403).render('error', { message: 'Ticket not found' });

    const ticketCreator = await client.users.cache.get(ticketDB.userID);
    const guild = client.guilds.cache.get(config.GuildID);
    const requesterMember = guild.members.cache.get(req.user.id);

    const userRoles = await getUserRoles(req.user.id, config.GuildID);

    let supportR = false;
    
    // Đọc từ SQLite thay vì config.TicketCategories
    const CatsDB = require('../../db/categories');
    const allCatsForTranscript = CatsDB.findAll();
    const catForTicket = allCatsForTranscript.find(c => c.categoryName === ticketDB.ticketType);
    if (catForTicket && Array.isArray(catForTicket.supportRoles)) {
      supportR = catForTicket.supportRoles.some(role => userRoles.includes(role));
    }
    // Admin Discord luôn có quyền
    const guildForCheck = client.guilds.cache.get(config.GuildID);
    const memberForCheck = guildForCheck?.members.cache.get(req.user.id);
    if (memberForCheck?.permissions.has('Administrator')) supportR = true;

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
    const accessibleCategories = (() => {
      const CatsDB = require('../../db/categories');
      const allCats = CatsDB.findAll();
      // Admin Discord thấy tất cả categories
      const guildMember = client.guilds.cache.get(config.GuildID)?.members.cache.get(req.user.id);
      if (guildMember?.permissions.has('Administrator')) {
        return allCats.map(c => c.categoryName);
      }
      return allCats
        .filter(cat => (Array.isArray(cat.supportRoles) ? cat.supportRoles : []).some(r => userRoles.includes(r)))
        .map(cat => cat.categoryName);
    })();

    // Pagination
    const page = parseInt(req.query.page) || 1;
    const limit = 10;
    const skip = (page - 1) * limit;
    const searchQuery = req.query.search?.trim();

    let query = {
      status: 'Closed',
      ticketType: { $in: accessibleCategories }
    };

    // SQLite: bỏ qua $or search phức tạp, dùng LIKE
    let sqlWhere = "guildID = ? AND status = 'Closed'";
    const sqlParams = [config.GuildID];
    if (searchQuery) {
      sqlWhere += ' AND (identifier LIKE ? OR userID LIKE ?)';
      sqlParams.push(`%${searchQuery}%`, `%${searchQuery}%`);
    }

    const totalTickets = db.prepare(`SELECT COUNT(*) AS cnt FROM tickets WHERE ${sqlWhere}`).get(...sqlParams).cnt;
    const totalPages   = Math.ceil(totalTickets / limit);

    const closedTickets = db.prepare(
      `SELECT * FROM tickets WHERE ${sqlWhere} ORDER BY closedAt DESC LIMIT ? OFFSET ?`
    ).all(...sqlParams, limit, skip);

    const closedTicketsWithInfo = await Promise.all(
      closedTickets.map(async ticket => {
        const userInfo     = await getUserInfo(ticket.userID);
        const closedByInfo = ticket.closeUserID ? await getUserInfo(ticket.closeUserID) : null;

        return {
          ...ticket,
          username:         userInfo.username,
          avatar:           userInfo.avatarURL,
          closedByUsername: closedByInfo ? closedByInfo.username : 'Không rõ',
          totalMessages:    ticket.messages || 0,
          createdAtFormatted: new Date(ticket.createdAt).toLocaleDateString('vi-VN', {
            year: 'numeric', month: 'short', day: '2-digit',
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

    const Categories = require('../../db/categories');
    const allCats = Categories.findAll();
    const accessibleCategories = allCats
      .filter(cat => {
        const roles = Array.isArray(cat.supportRoles) ? cat.supportRoles : [];
        return roles.some(role => userRoles.includes(role));
      })
      .map(cat => cat.categoryName);

    const openTickets = db.prepare(
      "SELECT * FROM tickets WHERE guildID = ? AND status = 'Open'"
    ).all(config.GuildID).filter(t => accessibleCategories.includes(t.ticketType));

    const openTicketsTotal = openTickets.length;

    const openTicketsWithUserInfo = await Promise.all(
      openTickets.map(async ticket => {
        const userInfo = await getUserInfo(ticket.userID);
        const claimUser = ticket.claimUser ? await getUserInfo(ticket.claimUser) : null;

        return {
          ...ticket,
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

    const ticket = db.prepare('SELECT * FROM tickets WHERE identifier = ?').get(ticketId);
    if (!ticket) {
      return res.redirect('/open-tickets');
    }

    const ticketCreator = await client.users.cache.get(ticket.userID);
    const guild = client.guilds.cache.get(config.GuildID);
    const requesterMember = guild.members.cache.get(req.user.id);

    const userRoles = await getUserRoles(req.user.id, config.GuildID);

    let supportR = false;
    
    // Đọc từ SQLite thay vì config.TicketCategories
    const CatsDB2 = require('../../db/categories');
    const allCatsForTicket = CatsDB2.findAll();
    const catForOpenTicket = allCatsForTicket.find(c => c.categoryName === ticket.ticketType);
    if (catForOpenTicket && Array.isArray(catForOpenTicket.supportRoles)) {
      supportR = catForOpenTicket.supportRoles.some(role => userRoles.includes(role));
    }
    // Admin Discord luôn có quyền
    const guildForCheck2 = client.guilds.cache.get(config.GuildID);
    const memberForCheck2 = guildForCheck2?.members.cache.get(req.user.id);
    if (memberForCheck2?.permissions.has('Administrator')) supportR = true;

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
        ...ticket,
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

    const ticket = db.prepare('SELECT * FROM tickets WHERE identifier = ?').get(ticketId);
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

    Tickets.updateByChannelID(channel.id, {
        closeReason: null,
        closeNotificationTime: 0,
        closeUserID: req.user.id,
        closedAt: Date.now(),
        status: 'Closed',
    });

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

    const ticket = db.prepare('SELECT * FROM tickets WHERE identifier = ?').get(ticketId);
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

  if (getConfig('alert.enabled', true)) {
    const alertTicket = Tickets.findByChannelID(channel.id);
    if (alertTicket && alertTicket.closeNotificationTime > 0) {
      Tickets.updateByChannelID(channel.id, { closeNotificationTime: 0, closeReason: null });
      try {
        const msg = await channel.messages.fetch(alertTicket.closeNotificationMsgID);
        await msg.delete();
      } catch (_) {}
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
  const ticket = db.prepare('SELECT * FROM tickets WHERE identifier = ?').get(ticketId);
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

      Tickets.deleteByChannelID(ticketId);
      res.redirect('/open-tickets'); 
  } catch (error) {
      console.error('Error deleting ticket:', error);
      res.redirect('/open-tickets');
  }
});



const Blacklist = require('../../db/blacklist');
app.get('/blacklist', isLoggedIn, async (req, res) => {
  try {
      const blacklistedUsers = Blacklist.findAll();

      const blacklistedUsersWithInfo = await Promise.all(blacklistedUsers.map(async (user) => {
          try {
              const userInfo = await getUserInfo(user.userId);

              return {
                  ...user,
                  username: userInfo.username,
                  avatar: userInfo.avatarURL,
              };
          } catch (error) {
              return {
                  ...user,
                  username: 'Unknown',
                  avatar: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fd/Faenza-avatar-default-symbolic.svg/2048px-Faenza-avatar-default-symbolic.svg.png',
              };
          }
      }));

      blacklistedUsersWithInfo.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
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
        Blacklist.remove(userId);
      } else {
        Blacklist.add(userId);
      }
      return res.redirect('/blacklist');
    } else {
      const blacklistedUsers = Blacklist.findAll();
      return res.render('blacklist', {
        user: req.user,
        blacklistedUsers: blacklistedUsers,
        invalidUserId: true,
        userRoles: await getUserRoles(req.user.id, config.GuildID),
        config: dconfig,
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

// ── Setup Wizard ──────────────────────────────────────────────────────────────
app.get('/setup-wizard', isLoggedIn, async (req, res) => {
  try {
    const { getAllConfig } = require('../../db/config');
    const Categories = require('../../db/categories');
    const Panels     = require('../../db/panels');
    const cfg        = getAllConfig();
    const categories = Categories.findAll();
    const guildId    = req.session.selectedGuildId || config.GuildID;
    const panels     = Panels.findAll(guildId);
    res.render('setup-wizard', { user: req.user, cfg, categories, panels, config: dconfig, accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb });
  } catch (error) {
    console.error('Error loading setup wizard:', error);
    res.status(500).render('error', { message: 'Lỗi tải trang cài đặt', accentColorHex: app.locals.accentColorHex, accentColorRgb: app.locals.accentColorRgb });
  }
});

// API: Save section config
app.post('/api/setup/save', isLoggedIn, async (req, res) => {
  try {
    const { setConfig } = require('../../db/config');
    const { section, ...data } = req.body;

    const setters = {
      ticket: () => {
        if (data.logsChannelID !== undefined) setConfig('ticket.logsChannelID', data.logsChannelID);
        if (data.maxTickets    !== undefined) setConfig('ticket.maxTickets',    data.maxTickets);
        if (data.deleteTime    !== undefined) setConfig('ticket.deleteTime',    data.deleteTime);
        if (data.cooldown      !== undefined) setConfig('ticket.cooldown',      data.cooldown);
        if (data.embedColor    !== undefined) setConfig('bot.embedColor',       data.embedColor);
        if (data.staffRoles    !== undefined) setConfig('staffRoles',           data.staffRoles);
        if (data.channelTopic  !== undefined) setConfig('ticket.channelTopic',  data.channelTopic);
        if (data.mentionAuthor !== undefined) setConfig('ticket.mentionAuthor', data.mentionAuthor);
        if (data.restrictClose !== undefined) setConfig('ticket.restrictClose', data.restrictClose);
        if (data.closeReason   !== undefined) setConfig('ticket.closeReason',   data.closeReason);
        if (data.selectMenu    !== undefined) setConfig('ticket.selectMenu',    data.selectMenu);
      },
      transcript: () => {
        if (data.type                !== undefined) setConfig('transcript.type',                data.type);
        if (data.saveInFolder        !== undefined) setConfig('transcript.saveInFolder',        data.saveInFolder);
        if (data.saveImages          !== undefined) setConfig('transcript.saveImages',          data.saveImages);
        if (data.messagesRequirement !== undefined) setConfig('transcript.messagesRequirement', data.messagesRequirement);
      },
      claiming: () => {
        if (data.enabled          !== undefined) setConfig('claiming.enabled',              data.enabled);
        if (data.maxPerStaff      !== undefined) setConfig('claiming.maxPerStaff',          data.maxPerStaff);
        if (data.lockNewTickets   !== undefined) setConfig('claiming.lockNewTickets',        data.lockNewTickets);
        if (data.autoClaimEnabled !== undefined) setConfig('claiming.autoClaim.enabled',    data.autoClaimEnabled);
        if (data.autoClaimShowMsg !== undefined) setConfig('claiming.autoClaim.showMessage',data.autoClaimShowMsg);
        if (data.moveEnabled      !== undefined) setConfig('claiming.moveEnabled',          data.moveEnabled);
        if (data.moveCategoryID   !== undefined) setConfig('claiming.moveCategoryID',       data.moveCategoryID);
        if (data.autoClaimMessage !== undefined) setConfig('claiming.autoClaim.message',    data.autoClaimMessage);
      },
      alert: () => {
        if (data.enabled          !== undefined) setConfig('alert.enabled',                data.enabled);
        if (data.time             !== undefined) setConfig('alert.time',                   data.time);
        if (data.dmUser           !== undefined) setConfig('alert.dmUser',                 data.dmUser);
        if (data.autoAlertEnabled !== undefined) setConfig('alert.autoAlert.enabled',      data.autoAlertEnabled);
        if (data.inactiveTime     !== undefined) setConfig('alert.autoAlert.inactiveTime', data.inactiveTime);
        if (data.message          !== undefined) setConfig('alert.message',                data.message);
      },
      workinghours: () => {
        if (data.enabled      !== undefined) setConfig('workingHours.enabled',      data.enabled);
        if (data.timezone     !== undefined) setConfig('workingHours.timezone',     data.timezone);
        if (data.allowOutside !== undefined) setConfig('workingHours.allowOutside', data.allowOutside);
        if (data.sendNotice   !== undefined) setConfig('workingHours.sendNotice',   data.sendNotice);
        if (data.schedule     !== undefined) setConfig('workingHours.schedule',     data.schedule);
      },
      review: () => {
        if (data.enabled        !== undefined) setConfig('review.enabled',              data.enabled);
        if (data.askWhyModal    !== undefined) setConfig('review.askWhyModal',          data.askWhyModal);
        if (data.channelEnabled !== undefined) setConfig('review.channel.enabled',      data.channelEnabled);
        if (data.channelID      !== undefined) setConfig('review.channel.channelID',    data.channelID);
        if (data.minimumWords   !== undefined) setConfig('review.minimumWords',         data.minimumWords);
        if (data.maximumWords   !== undefined) setConfig('review.maximumWords',         data.maximumWords);
      },
      suggestion: () => {
        if (data.enabled       !== undefined) setConfig('suggestion.enabled',       data.enabled);
        if (data.channelID     !== undefined) setConfig('suggestion.channelID',     data.channelID);
        if (data.createThreads !== undefined) setConfig('suggestion.createThreads', data.createThreads);
      },
      channelstats: () => {
        const keys = ['totalTickets','openTickets','averageRating','memberCount'];
        keys.forEach(k => {
          if (data[k]) {
            setConfig(`channelStats.${k}.enabled`,     data[k].enabled);
            setConfig(`channelStats.${k}.channelID`,   data[k].channelID);
            setConfig(`channelStats.${k}.channelName`, data[k].channelName);
          }
        });
      },
      archive: () => {
        if (data.enabled           !== undefined) setConfig('archive.enabled',           data.enabled);
        if (data.hideFromCreator   !== undefined) setConfig('archive.hideFromCreator',   data.hideFromCreator);
        if (data.moveToCategory    !== undefined) setConfig('archive.moveToCategory',    data.moveToCategory);
        if (data.categoryID        !== undefined) setConfig('archive.categoryID',        data.categoryID);
        if (data.channelNamePrefix !== undefined) setConfig('archive.channelNamePrefix', data.channelNamePrefix);
      },
      vietqr: () => {
        if (data.bankId        !== undefined) setConfig('vietqr.bankId',        data.bankId);
        if (data.accountNo     !== undefined) setConfig('vietqr.accountNo',     data.accountNo);
        if (data.accountName   !== undefined) setConfig('vietqr.accountName',   data.accountName);
        if (data.template      !== undefined) setConfig('vietqr.template',      data.template);
        if (data.onlyInTickets !== undefined) setConfig('vietqr.onlyInTickets', data.onlyInTickets);
      },
    };

    if (setters[section]) {
      setters[section]();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Section không hợp lệ' });
    }
  } catch (error) {
    console.error('Error saving setup config:', error);
    res.status(500).json({ error: 'Lỗi lưu cấu hình' });
  }
});

// API: Create category
app.post('/api/setup/category/create', isLoggedIn, async (req, res) => {
  try {
    const Categories = require('../../db/categories');
    const { key, name, category_channel, support_roles, emoji, description, button_color, logs_channel, channel_name, embed_title, embed_message } = req.body;

    if (!key || !name || !category_channel || !support_roles) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }
    if (!/^[a-z0-9-]+$/.test(key)) {
      return res.status(400).json({ error: 'Key chỉ được chứa chữ thường, số và dấu gạch ngang' });
    }
    if (Categories.findByKey(key)) {
      return res.status(400).json({ error: `Danh mục "${key}" đã tồn tại` });
    }

    const supportRoles = support_roles.split(',').map(r => r.trim()).filter(Boolean);

    Categories.create({
      categoryKey:         key,
      categoryName:        name,
      description:         description || '',
      parentCategoryID:    category_channel,
      embedTitle:          embed_title || `Ticket ${name} ({category})`,
      embedMessage:        embed_message || '> Cảm ơn bạn đã liên hệ.\n> Vui lòng mô tả vấn đề và chờ nhân viên hỗ trợ.',
      categoryEmoji:       emoji || '',
      buttonColor:         button_color || 'Green',
      supportRoles,
      mentionSupportRoles: false,
      channelName:         channel_name || 'ticket-{username}',
      logsChannelID:       logs_channel || '',
      requiredRoles:       [],
      questions:           [],
      sortOrder:           Categories.findAll().length,
      enabled:             true,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ error: 'Lỗi tạo danh mục' });
  }
});

// API: Delete category
app.post('/api/setup/category/delete', isLoggedIn, async (req, res) => {
  try {
    const Categories = require('../../db/categories');
    const { key } = req.body;
    if (!key) return res.status(400).json({ error: 'Thiếu key' });
    const cat = Categories.findByKey(key);
    if (!cat) return res.status(404).json({ error: 'Không tìm thấy danh mục' });
    Categories.delete(key);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting category:', error);
    res.status(500).json({ error: 'Lỗi xóa danh mục' });
  }
});

// API: Update category
app.post('/api/setup/category/update', isLoggedIn, async (req, res) => {
  try {
    const Categories = require('../../db/categories');
    const { key, name, emoji, category_channel, support_roles, logs_channel, channel_name, embed_title, embed_message, button_color, mention_roles } = req.body;
    if (!key) return res.status(400).json({ error: 'Thiếu key' });
    if (!Categories.findByKey(key)) return res.status(404).json({ error: 'Không tìm thấy danh mục' });

    const updates = {};
    if (name)                        updates.categoryName        = name;
    if (emoji !== undefined)         updates.categoryEmoji       = emoji;
    if (category_channel)            updates.parentCategoryID    = category_channel;
    if (logs_channel !== undefined)  updates.logsChannelID       = logs_channel;
    if (channel_name)                updates.channelName         = channel_name;
    if (embed_title)                 updates.embedTitle          = embed_title;
    if (embed_message)               updates.embedMessage        = embed_message;
    if (button_color)                updates.buttonColor         = button_color;
    if (mention_roles !== undefined) updates.mentionSupportRoles = mention_roles;
    if (support_roles)               updates.supportRoles        = support_roles.split(',').map(r => r.trim()).filter(Boolean);

    Categories.update(key, updates);
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating category:', error);
    res.status(500).json({ error: 'Lỗi cập nhật danh mục' });
  }
});

// API: Send panel to Discord channel
app.post('/api/setup/panel/send', isLoggedIn, async (req, res) => {
  try {
    const { panelId, channelId, title, desc, color, categories: catKeys } = req.body;
    if (!panelId || !channelId || !catKeys || catKeys.length === 0) {
      return res.status(400).json({ error: 'Thiếu thông tin bắt buộc' });
    }

    const guildId = req.session.selectedGuildId || config.GuildID;
    const guild   = client.guilds.cache.get(guildId);
    if (!guild) return res.status(404).json({ error: 'Không tìm thấy máy chủ' });

    const channel = guild.channels.cache.get(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(404).json({ error: 'Không tìm thấy kênh hoặc kênh không phải text channel' });
    }

    const Categories = require('../../db/categories');
    const Panels     = require('../../db/panels');
    const { getConfig: gc } = require('../../db/config');
    const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require('discord.js');

    const embedColor = color || gc('bot.embedColor', '#59d4b5');
    const embed = new EmbedBuilder().setColor(embedColor).setDescription(desc || '> Nhấn vào nút bên dưới để tạo ticket hỗ trợ.');
    if (title) embed.setTitle(title);

    const useSelectMenu = gc('ticket.selectMenu', true);
    const colorMap = { Green: ButtonStyle.Success, Blurple: ButtonStyle.Primary, Gray: ButtonStyle.Secondary, Red: ButtonStyle.Danger };

    const cats = catKeys.map(k => Categories.findByKey(k)).filter(Boolean);
    if (cats.length === 0) return res.status(400).json({ error: 'Không tìm thấy danh mục nào' });

    let components = [];
    const options = cats.map(cat => ({
      label: cat.categoryName, value: `ticket-${cat.categoryKey}`,
      description: cat.description || undefined, emoji: cat.categoryEmoji || undefined,
    }));

    if (useSelectMenu) {
      const menu = new StringSelectMenuBuilder()
        .setCustomId('categorySelect').setPlaceholder('Chọn loại ticket...')
        .setMinValues(1).setMaxValues(1)
        .addOptions(options.map(o => {
          const opt = { label: o.label, value: o.value };
          if (o.description) opt.description = o.description;
          if (o.emoji) opt.emoji = o.emoji;
          return opt;
        }));
      components = [new ActionRowBuilder().addComponents(menu)];
    } else {
      const buttons = cats.map(cat => {
        const btn = new ButtonBuilder()
          .setCustomId(`ticket-${cat.categoryKey}`).setLabel(cat.categoryName)
          .setStyle(colorMap[cat.buttonColor] || ButtonStyle.Success);
        if (cat.categoryEmoji) btn.setEmoji(cat.categoryEmoji);
        return btn;
      });
      for (let i = 0; i < buttons.length; i += 5) {
        components.push(new ActionRowBuilder().addComponents(...buttons.slice(i, i + 5)));
      }
    }

    const sentMsg = await channel.send({ embeds: [embed], components });
    Panels.upsert(guildId, panelId, sentMsg.id, useSelectMenu ? options : []);
    res.json({ success: true, messageId: sentMsg.id });
  } catch (error) {
    console.error('Error sending panel:', error);
    res.status(500).json({ error: 'Lỗi gửi panel: ' + error.message });
  }
});

// API: Delete panel record
app.post('/api/setup/panel/delete', isLoggedIn, async (req, res) => {
  try {
    const Panels  = require('../../db/panels');
    const guildId = req.session.selectedGuildId || config.GuildID;
    const { panelId } = req.body;
    if (!panelId) return res.status(400).json({ error: 'Thiếu panelId' });
    Panels.delete(guildId, panelId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting panel:', error);
    res.status(500).json({ error: 'Lỗi xóa panel' });
  }
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
  if (!_serverStarted) {
    _serverStarted = true;
    app.listen(PORT, () => {
      console.log(
        `${color.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}\n` +
        `${color.green.bold.underline(`Heiznerd Tickets Dashboard v${dashboardVersion} Successfully Loaded!`)}\n` +
        `Dashboard is live and accessible at: ${color.cyan.bold(dconfig.URL)}\n\n` +
        `${color.bold.green('Made by Heiznerd')}\n` +
        `${color.cyan.bold('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')}`
        );
    });
  }
};
