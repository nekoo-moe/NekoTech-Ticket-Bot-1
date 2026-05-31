if (process.platform !== "win32") require("child_process").exec("npm install");


const color = require('ansi-colors');
console.log(`${color.yellow(`Starting bot, this can take a while..`)}`);
const fs = require('fs');

const version = Number(process.version.split('.')[0].replace('v', ''));
if (version < 18) {
  console.log(`${color.red(`[ERROR] Heiznerd Tickets requires a NodeJS version of 18 or higher!\nYou can check your NodeJS by running the "node -v" command in your terminal.`)}`);

  console.log(`${color.blue(`\n[INFO] To update Node.js, follow the instructions below for your operating system:`)}`);
  console.log(`${color.green(`- Windows:`)} Download and run the installer from ${color.cyan(`https://nodejs.org/`)}`);
  console.log(`${color.green(`- Ubuntu/Debian:`)} Run the following commands in the Terminal:`);
  console.log(`${color.cyan(`  - sudo apt update`)}`);
  console.log(`${color.cyan(`  - sudo apt upgrade nodejs`)}`);
  console.log(`${color.green(`- CentOS:`)} Run the following commands in the Terminal:`);
  console.log(`${color.cyan(`  - sudo yum update`)}`);
  console.log(`${color.cyan(`  - sudo yum install -y nodejs`)}`);

  let logMsg = `\n\n[${new Date().toLocaleString()}] [ERROR] Heiznerd Tickets requires a NodeJS version of 18 or higher!`;
  fs.appendFile("./logs.txt", logMsg, (e) => { 
    if(e) console.log(e);
  });

  process.exit()
}

const packageFile = require('./package.json');
let logMsg = `\n\n[${new Date().toLocaleString()}] [STARTING] Attempting to start the bot..\nNodeJS Version: ${process.version}\nBot Version: ${packageFile.version}`;
fs.appendFile("./logs.txt", logMsg, (e) => { 
  if(e) console.log(e);
});

const { Collection, Client, Discord, ActionRowBuilder, ButtonBuilder, GatewayIntentBits, ActivityType } = require('discord.js');
const yaml = require("js-yaml")
const client = new Client({ 
  restRequestTimeout: 60000,
  intents: [
    GatewayIntentBits.Guilds, 
    GatewayIntentBits.GuildMessages, 
    GatewayIntentBits.GuildMembers, 
    GatewayIntentBits.GuildPresences, 
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessageReactions
  ],
  presence: {
    status: 'dnd',
    activities: [{ name: 'Starting up...', type: ActivityType.Playing }]
  },
  retryLimit: 3
});

let config = ""
try {
  config = require('./config')
  } catch (e) {
    console.error(color.red('Error loading configuration:'), e.message);
    process.exit(1); 
  }

module.exports = client
require("./utils.js");

const utils = require("./utils.js");
const { getConfig } = require('./db/config');

const createTranscriptFolder = () => {
  const dashboardExists = fs.existsSync('./addons/Dashboard/dashboard.js');
  const saveInFolder    = getConfig('transcript.saveInFolder', true);
  if (saveInFolder && !dashboardExists && !fs.existsSync('./transcripts')) fs.mkdirSync('./transcripts');
  if (dashboardExists && !fs.existsSync('./addons/Dashboard/transcripts')) fs.mkdirSync('./addons/Dashboard/transcripts');
};
createTranscriptFolder();


// ── Error Handling — ghi log local vào logs/ ─────────────────────────────────
const logsDir = './logs';
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

function handleAndLogError(errorType, error) {
  console.log(error);

  const errorPrefix = `[${new Date().toLocaleString()}] [${errorType}] [v${packageFile.version}]`;
  const errorMsg    = `\n\n${errorPrefix}\n${error.stack || error}`;

  // Ghi vào logs.txt (tổng hợp)
  fs.appendFile('./logs.txt', errorMsg, (e) => { if (e) console.log(e); });

  // Ghi vào file log riêng theo ngày trong thư mục logs/
  const dateStr  = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const logFile  = `${logsDir}/${dateStr}.log`;
  fs.appendFile(logFile, errorMsg, (e) => { if (e) console.log(e); });

  console.log(color.yellow(`[LOG] Lỗi đã được ghi vào ${logFile}`));
}

client.on('warn', (error) => {
  handleAndLogError('WARN', error);
});

client.on('error', (error) => {
  handleAndLogError('ERROR', error);
});

process.on('unhandledRejection', (error) => {
  handleAndLogError('unhandledRejection', error);
});

process.on('uncaughtException', (error) => {
  handleAndLogError('uncaughtException', error);
});

// ── Load Events ──────────────────────────────────────────────────────────────
console.log(color.cyan('[SYSTEM] Loading events...'));

// Các event này là custom (ticketCreate, ticketClose, ticketClaim, sendUserDM)
// được emit thủ công bởi code, không phải Discord event thật
const customEvents = new Set(['ticketCreate', 'ticketClose', 'ticketClaim', 'sendUserDM']);

const eventFiles = fs.readdirSync('./events').filter(f => f.endsWith('.js'));
for (const file of eventFiles) {
  const event = require(`./events/${file}`);
  const eventName = file.split('.')[0];

  if (eventName === 'ready') {
    // ready chỉ chạy một lần
    client.once('ready', (...args) => event(client, ...args));
  } else if (customEvents.has(eventName)) {
    // Custom events: client emit thủ công, handler nhận (client, ...args)
    client.on(eventName, (...args) => event(client, ...args));
  } else {
    // Discord events thật: Discord truyền args trực tiếp, không có client
    client.on(eventName, (...args) => event(client, ...args));
  }

  console.log(color.green(`[EVENT] ${file} loaded!`));
}
console.log(color.cyan(`[SYSTEM] Loaded ${eventFiles.length} events!`));

// ── Đăng nhập Discord ─────────────────────────────────────────────────────────
client.login(config.Token).catch(err => {
  console.error(color.red(`[ERROR] Đăng nhập thất bại: ${err.message}`));
  console.error(color.yellow('Kiểm tra lại Token trong config.yml'));
  process.exit(1);
});
