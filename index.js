const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ==================================================
// TOKEN
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;

if (!TOKEN) {
  console.error("❌ TOKEN غير موجود في Environment Variables");
  process.exit(1);
}

// ==================================================
// CLIENT
// ==================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ],

  partials: [
    Partials.Channel
  ]
});

// ==================================================
// DATABASE
// ==================================================

const DB_FILE = path.join(
  __dirname,
  "database.json"
);

let db = {
  guilds: {},
  tickets: {},
  applications: {},
  warnings: {},
  jails: {}
};

// ==================================================
// LOAD DATABASE
// ==================================================

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      saveDB();
      return;
    }

    const data = fs.readFileSync(
      DB_FILE,
      "utf8"
    );

    db = JSON.parse(data);

    db.guilds ||= {};
    db.tickets ||= {};
    db.applications ||= {};
    db.warnings ||= {};
    db.jails ||= {};

  } catch (error) {
    console.error(
      "❌ Database load error:",
      error
    );
  }
}

// ==================================================
// SAVE DATABASE
// ==================================================

function saveDB() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(
        db,
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      "❌ Database save error:",
      error
    );
  }
}

// ==================================================
// LOAD
// ==================================================

loadDB();

// ==================================================
// DEFAULT PANEL
// ==================================================

const DEFAULT_PANEL = {
  title: "🎫 نظام التذاكر",

  description:
    "اضغط على الزر بالأسفل لفتح تذكرة.",

  buttonText:
    "فتح تذكرة",

  emoji:
    "🎫",

  color:
    "#5865F2",

  footer:
    "نظام التذاكر",

  thumbnail:
    null,

  image:
    null
};

// ==================================================
// DEFAULT GUILD
// ==================================================

function getGuild(guildId) {

  if (!db.guilds[guildId]) {

    db.guilds[guildId] = {

      juniorRole: null,

      middleRole: null,

      seniorRole: null,

      ownerRole: null,

      category: null,

      logsChannel: null,

      archiveChannel: null,

      applicationChannel: null,

      mentionRole: null,

      panelChannel: null,

      panelMessage: null,

      maxTickets: 1,

      requireRating: true,

      panel: {
        ...DEFAULT_PANEL
      },

      staff: {}
    };

    saveDB();
  }

  const settings = db.guilds[guildId];

  // Migration for older database versions.
  settings.juniorRole ??= null;
  settings.middleRole ??= null;
  settings.seniorRole ??= null;
  settings.ownerRole ??= null;
  settings.jailRole ??= null;
  settings.category ??= null;
  settings.logsChannel ??= null;
  settings.archiveChannel ??= null;
  settings.applicationChannel ??= null;
  settings.mentionRole ??= null;
  settings.panelChannel ??= null;
  settings.panelMessage ??= null;
  settings.maxTickets ??= 1;
  settings.requireRating ??= true;
  settings.panel = {
    ...DEFAULT_PANEL,
    ...(settings.panel || {})
  };
  settings.staff ||= {};
  db.warnings ||= {};
  db.jails ||= {};
  db.guilds[guildId] = settings;

  return settings;
}

// ==================================================
// TEXT SAFETY
// ==================================================

function safeText(
  value,
  fallback = ""
) {
  if (!value) {
    return fallback;
  }

  return String(value)
    .slice(0, 1024);
}

// ==================================================
// STARS
// ==================================================

function stars(number) {

  return "⭐".repeat(
    Math.max(
      0,
      Math.min(
        5,
        Number(number) || 0
      )
    )
  );
}



async function resolveRole(guild, token) {
  if (!token) return null;
  const clean = String(token).replace(/[<@&>]/g, "").trim();
  if (/^\d{15,25}$/.test(clean)) {
    return guild.roles.cache.get(clean) || null;
  }
  return guild.roles.cache.find(r => r.name.toLowerCase() === clean.toLowerCase()) || null;
}

// ==================================================
// GENERAL HELPERS / MODERATION
// ==================================================

function parseDuration(input) {
  if (!input) return null;

  const value = String(input).trim().toLowerCase();
  const match = value.match(/^(\d+(?:\.\d+)?)(s|m|h|d|w|ث|د|س|ي|اسبوع|أسبوع)$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000,
    ث: 1000,
    د: 60 * 1000,
    س: 60 * 60 * 1000,
    ي: 24 * 60 * 60 * 1000,
    اسبوع: 7 * 24 * 60 * 60 * 1000,
    "أسبوع": 7 * 24 * 60 * 60 * 1000
  };

  const ms = amount * multipliers[unit];
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.floor(ms);
}

function formatDuration(ms) {
  if (!ms) return "دائم";
  let seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  seconds %= 60;

  const parts = [];
  if (days) parts.push(`${days} يوم`);
  if (hours) parts.push(`${hours} ساعة`);
  if (minutes) parts.push(`${minutes} دقيقة`);
  if (seconds && parts.length < 2) parts.push(`${seconds} ثانية`);
  return parts.join(" و ") || "أقل من دقيقة";
}

async function resolveMember(guild, token) {
  if (!token) return null;

  const clean = String(token)
    .replace(/[<@!>]/g, "")
    .trim();

  if (/^\d{15,25}$/.test(clean)) {
    try {
      return await guild.members.fetch(clean);
    } catch {
      return null;
    }
  }

  const lower = clean.toLowerCase();
  return guild.members.cache.find(m =>
    m.user.username.toLowerCase() === lower ||
    m.displayName.toLowerCase() === lower
  ) || null;
}

function extractTargetAndArgs(content, commandNames) {
  const pattern = new RegExp(
    `^(?:${commandNames.map(x => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s+`,
    "i"
  );

  let rest = content.replace(pattern, "").trim();
  const mention = rest.match(/^<@!?(\d+)>/);

  let targetToken = null;
  if (mention) {
    targetToken = mention[1];
    rest = rest.slice(mention[0].length).trim();
  } else {
    const first = rest.split(/\s+/)[0];
    if (/^\d{15,25}$/.test(first)) {
      targetToken = first;
      rest = rest.slice(first.length).trim();
    }
  }

  return {
    targetToken,
    rest,
    args: rest ? rest.split(/\s+/) : []
  };
}

function canModerateTarget(actor, target, settings, { allowMember = false } = {}) {
  if (!actor || !target) return false;
  if (actor.id === target.id) return false;
  if (target.user?.bot && !allowMember) return false;

  const actorLevel = staffLevel(actor, settings);
  const targetLevel = staffLevel(target, settings);

  // Server owner can manage configured staff, but not above Discord owner.
  if (actor.guild.ownerId === actor.id) {
    return target.id !== actor.guild.ownerId;
  }

  return actorLevel > targetLevel;
}

function warningKey(guildId, userId) {
  return `${guildId}:${userId}`;
}

function getWarnings(guildId, userId) {
  db.warnings ||= {};
  const key = warningKey(guildId, userId);
  db.warnings[key] ||= [];
  return db.warnings[key];
}

function removeExpiredWarnings(guildId, userId) {
  const list = getWarnings(guildId, userId);
  const now = Date.now();
  const active = list.filter(w => !w.expiresAt || w.expiresAt > now);
  db.warnings[warningKey(guildId, userId)] = active;
  return active;
}

async function sendModerationLog(guild, settings, title, color, fields) {
  return sendLog(
    guild,
    settings,
    new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .addFields(fields)
      .setTimestamp()
  );
}

function moderationUsage(command, example) {
  return `❌ الاستخدام:\n\`${command} @العضو السبب المدة\`\nمثال: \`${example}\``;
}

// ==================================================
// STAFF LEVEL
// ==================================================

function staffLevel(
  member,
  settings
) {

  if (!member) {
    return 0;
  }

  if (
    settings.ownerRole &&
    member.roles.cache.has(
      settings.ownerRole
    )
  ) {
    return 4;
  }

  if (
    settings.seniorRole &&
    member.roles.cache.has(
      settings.seniorRole
    )
  ) {
    return 3;
  }

  if (
    settings.middleRole &&
    member.roles.cache.has(
      settings.middleRole
    )
  ) {
    return 2;
  }

  if (
    settings.juniorRole &&
    member.roles.cache.has(
      settings.juniorRole
    )
  ) {
    return 1;
  }

  return 0;
}

// ==================================================
// LEVEL NAME
// ==================================================

function levelName(level) {

  return [
    "عضو",
    "الاستف الصغرى",
    "الاستف الوسطى",
    "الاستف العليا",
    "الأونر"
  ][level] || "عضو";
}

// ==================================================
// SERVER MANAGER
// ==================================================

function isServerManager(member) {

  return Boolean(
    member &&
    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  );
}

// ==================================================
// TICKET PERMISSION
// ==================================================

function canManageTicket(
  member,
  ticket,
  settings
) {

  const level =
    staffLevel(
      member,
      settings
    );

  if (level < 1) {
    return false;
  }

  if (!ticket.claimedBy) {
    return true;
  }

  if (
    ticket.claimedBy ===
    member.id
  ) {
    return true;
  }

  return level >= 2;
}

// ==================================================
// CAN CLAIM
// ==================================================

function canClaim(
  member,
  settings
) {

  return (
    staffLevel(
      member,
      settings
    ) >= 1
  );
}

// ==================================================
// OPEN TICKETS
// ==================================================

function getOpenTicketsForUser(
  guildId,
  userId
) {

  return Object.values(
    db.tickets
  ).filter(ticket =>

    ticket.guildId ===
      guildId &&

    ticket.userId ===
      userId &&

    [
      "open",
      "locked"
    ].includes(
      ticket.status
    )
  );
}

// ==================================================
// STAFF STATS
// ==================================================

function addStat(
  guildId,
  userId,
  key,
  amount = 1
) {

  const settings =
    getGuild(guildId);

  settings.staff[userId] ||= {
    claimed: 0,
    closed: 0,
    ratings: 0,
    ratingSum: 0
  };

  settings.staff[userId][key] =
    (
      settings.staff[userId][key] ||
      0
    ) + amount;

  saveDB();
}

// ==================================================
// AVERAGE RATING
// ==================================================

function averageRating(
  guildId,
  userId
) {

  const settings =
    getGuild(guildId);

  const staff =
    settings.staff[userId];

  if (
    !staff ||
    !staff.ratings
  ) {
    return "لا يوجد";
  }

  return (
    staff.ratingSum /
    staff.ratings
  ).toFixed(2);
}

// ==================================================
// STARTUP MESSAGE
// ==================================================

console.log(
  "=========================================="
);

console.log(
  "🎫 KRX Ticket System"
);

console.log(
  "📦 Database loaded"
);

console.log(
  "=========================================="
);
// ==================================================
// LOG SYSTEM
// ==================================================

async function sendLog(
  guild,
  settings,
  embed
) {
  try {

    if (!settings.logsChannel) {
      return;
    }

    const channel =
      guild.channels.cache.get(
        settings.logsChannel
      );

    if (!channel) {
      return;
    }

    await channel.send({
      embeds: [embed]
    });

  } catch (error) {

    console.error(
      "❌ Log error:",
      error
    );
  }
}

// ==================================================
// LOG TIME
// ==================================================

function logTime() {

  return `<t:${Math.floor(
    Date.now() / 1000
  )}:F>`;
}

// ==================================================
// PANEL EMBED
// ==================================================

function panelEmbed(
  settings
) {

  const panel =
    settings.panel || DEFAULT_PANEL;

  const embed =
    new EmbedBuilder()
      .setTitle(
        panel.title ||
        DEFAULT_PANEL.title
      )
      .setDescription(
        panel.description ||
        DEFAULT_PANEL.description
      )
      .setColor(
        panel.color ||
        DEFAULT_PANEL.color
      )
      .setFooter({
        text:
          panel.footer ||
          DEFAULT_PANEL.footer
      });

  if (panel.thumbnail) {
    embed.setThumbnail(
      panel.thumbnail
    );
  }

  if (panel.image) {
    embed.setImage(
      panel.image
    );
  }

  return embed;
}

// ==================================================
// PANEL BUTTON
// ==================================================

function panelRow(
  settings
) {

  const panel =
    settings.panel || DEFAULT_PANEL;

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          "ticket_open"
        )
        .setLabel(
          panel.buttonText ||
          "فتح تذكرة"
        )
        .setEmoji(
          panel.emoji ||
          "🎫"
        )
        .setStyle(
          ButtonStyle.Primary
        )

    );
}

// ==================================================
// TICKET BUTTONS
// ==================================================

function ticketRow() {

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          "ticket_claim"
        )
        .setLabel(
          "استلام"
        )
        .setEmoji(
          "🙋"
        )
        .setStyle(
          ButtonStyle.Success
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_unclaim"
        )
        .setLabel(
          "إلغاء الاستلام"
        )
        .setEmoji(
          "↩️"
        )
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_lock"
        )
        .setLabel(
          "قفل"
        )
        .setEmoji(
          "🔒"
        )
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_close"
        )
        .setLabel(
          "إغلاق"
        )
        .setEmoji(
          "🔴"
        )
        .setStyle(
          ButtonStyle.Danger
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_delete"
        )
        .setLabel(
          "حذف"
        )
        .setEmoji(
          "🗑️"
        )
        .setStyle(
          ButtonStyle.Danger
        )

    );
}

// ==================================================
// TICKET EMBED
// ==================================================

function ticketEmbed(
  ticket,
  guild
) {

  const embed =
    new EmbedBuilder()
      .setTitle(
        "🎫 تذكرة جديدة"
      )
      .setColor(
        "#5865F2"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🆔 ID",
          value:
            ticket.userId,
          inline: true
        },

        {
          name:
            "📅 وقت الفتح",
          value:
            ticket.createdAt
              ? `<t:${Math.floor(
                  ticket.createdAt / 1000
                )}:F>`
              : logTime(),
          inline: true
        },

        {
          name:
            "📌 الحالة",
          value:
            ticket.status ||
            "open",
          inline: true
        },

        {
          name:
            "🙋 المستلم",
          value:
            ticket.claimedBy
              ? `<@${ticket.claimedBy}>`
              : "لم يتم الاستلام",
          inline: true
        }

      )
      .setTimestamp();

  if (guild) {
    embed.setFooter({
      text:
        guild.name
    });
  }

  return embed;
}

// ==================================================
// SET TICKET PERMISSIONS
// ==================================================

async function setTicketPermissions(
  channel,
  ticket,
  settings
) {

  try {

    const everyone =
      channel.guild.roles.everyone;

    await channel.permissionOverwrites.edit(
      everyone,
      {
        ViewChannel: false
      }
    );

    // صاحب التذكرة
    await channel.permissionOverwrites.edit(
      ticket.userId,
      {
        ViewChannel: true,
        SendMessages:
          !ticket.locked,
        ReadMessageHistory: true
      }
    );

    // الإدارة
    const roleIds = [
      settings.juniorRole,
      settings.middleRole,
      settings.seniorRole,
      settings.ownerRole
    ].filter(Boolean);

    for (
      const roleId of roleIds
    ) {

      await channel.permissionOverwrites.edit(
        roleId,
        {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages:
            !ticket.locked
        }
      );
    }

    // المستلم
    if (ticket.claimedBy) {

      await channel.permissionOverwrites.edit(
        ticket.claimedBy,
        {
          ViewChannel: true,
          ReadMessageHistory: true,
          SendMessages:
            !ticket.locked
        }
      );
    }

  } catch (error) {

    console.error(
      "❌ Permission error:",
      error
    );
  }
}

// ==================================================
// CREATE TICKET OBJECT
// ==================================================

function createTicketData(
  guildId,
  userId
) {

  return {

    guildId,

    userId,

    channelId: null,

    claimedBy: null,

    status: "open",

    locked: false,

    rated: false,

    rating: null,

    ratingSum: 0,

    createdAt:
      Date.now(),

    claimedAt: null,

    closedAt: null,

    deletedAt: null

  };
}

// ==================================================
// OPEN TICKET LOG
// ==================================================

async function logTicketOpened(
  guild,
  settings,
  ticket,
  channel,
  user
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🎫 Ticket Opened"
      )
      .setColor(
        "#57F287"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🛠️ فتح بواسطة",
          value:
            `${user}`,
          inline: true
        },

        {
          name:
            "🎫 التذكرة",
          value:
            `<#${channel.id}>`,
          inline: true
        },

        {
          name:
            "🆔 Channel ID",
          value:
            channel.id,
          inline: true
        },

        {
          name:
            "🆔 User ID",
          value:
            ticket.userId,
          inline: true
        },

        {
          name:
            "🕐 وقت الفتح",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
}

// ==================================================
// CLAIM LOG
// ==================================================

async function logTicketClaimed(
  guild,
  settings,
  ticket,
  channel,
  member
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🙋 Ticket Claimed"
      )
      .setColor(
        "#57F287"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🛡️ المستلم",
          value:
            `${member}`,
          inline: true
        },

        {
          name:
            "🎫 التذكرة",
          value:
            `<#${channel.id}>`,
          inline: true
        },

        {
          name:
            "🕐 وقت الاستلام",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
}

// ==================================================
// UNCLAIM LOG
// ==================================================

async function logTicketUnclaimed(
  guild,
  settings,
  ticket,
  channel,
  member,
  oldClaimer
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "↩️ Ticket Unclaimed"
      )
      .setColor(
        "#FEE75C"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🛡️ قام بإلغاء الاستلام",
          value:
            `${member}`,
          inline: true
        },

        {
          name:
            "🙋 المستلم السابق",
          value:
            oldClaimer
              ? `<@${oldClaimer}>`
              : "غير معروف",
          inline: true
        },

        {
          name:
            "🎫 التذكرة",
          value:
            `<#${channel.id}>`,
          inline: true
        },

        {
          name:
            "🕐 الوقت",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
}

// ==================================================
// LOCK / UNLOCK LOG
// ==================================================

async function logTicketLock(
  guild,
  settings,
  ticket,
  channel,
  member,
  locked
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        locked
          ? "🔒 Ticket Locked"
          : "🔓 Ticket Unlocked"
      )
      .setColor(
        locked
          ? "#ED4245"
          : "#57F287"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🛡️ بواسطة",
          value:
            `${member}`,
          inline: true
        },

        {
          name:
            "🎫 التذكرة",
          value:
            `<#${channel.id}>`,
          inline: true
        },

        {
          name:
            "📌 الحالة",
          value:
            locked
              ? "مقفلة 🔒"
              : "مفتوحة 🔓",
          inline: true
        },

        {
          name:
            "🕐 الوقت",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
}

// ==================================================
// CLOSE LOG
// ==================================================

async function logTicketClosed(
  guild,
  settings,
  ticket,
  channel,
  member
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🔴 Ticket Closed"
      )
      .setColor(
        "#ED4245"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🛡️ قام بالإغلاق",
          value:
            `${member}`,
          inline: true
        },

        {
          name:
            "🎫 التذكرة",
          value:
            `<#${channel.id}>`,
          inline: true
        },

        {
          name:
            "🙋 المستلم",
          value:
            ticket.claimedBy
              ? `<@${ticket.claimedBy}>`
              : "لم يتم الاستلام",
          inline: true
        },

        {
          name:
            "⭐ التقييم",
          value:
            settings.requireRating ? "مطلوب قبل الحذف" : "اختياري",
          inline: true
        },

        {
          name:
            "🕐 وقت الإغلاق",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
}

// ==================================================
// DELETE LOG
// ==================================================

async function logTicketDeleted(
  guild,
  settings,
  ticket,
  channel,
  member
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🗑️ Ticket Deleted"
      )
      .setColor(
        "#ED4245"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "🗑️ قام بالحذف",
          value:
            `${member}`,
          inline: true
        },

        {
          name:
            "🎫 التذكرة",
          value:
            `<#${channel.id}>`,
          inline: true
        },

        {
          name:
            "🆔 Channel ID",
          value:
            channel.id,
          inline: true
        },

        {
          name:
            "🙋 المستلم",
          value:
            ticket.claimedBy
              ? `<@${ticket.claimedBy}>`
              : "لم يتم الاستلام",
          inline: true
        },

        {
          name:
            "⭐ التقييم",
          value:
            ticket.rated
              ? `${stars(ticket.rating)} (${ticket.rating}/5)`
              : "لم يتم التقييم",
          inline: true
        },

        {
          name:
            "🕐 وقت الحذف",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
}

// ==================================================
// RATING LOG
// ==================================================

async function logTicketRated(
  guild,
  settings,
  ticket,
  rating,
  user
) {

  await sendLog(
    guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "⭐ Ticket Rated"
      )
      .setColor(
        "#FEE75C"
      )
      .addFields(

        {
          name:
            "👤 صاحب التذكرة",
          value:
            `<@${ticket.userId}>`,
          inline: true
        },

        {
          name:
            "⭐ التقييم",
          value:
            `${stars(rating)} (${rating}/5)`,
          inline: true
        },

        {
          name:
            "🙋 قام بالتقييم",
          value:
            `${user}`,
          inline: true
        },

        {
          name:
            "🛡️ الموظف",
          value:
            ticket.claimedBy
              ? `<@${ticket.claimedBy}>`
              : "لم يتم الاستلام",
          inline: true
        },

        {
          name:
            "🆔 Ticket ID",
          value:
            ticket.channelId ||
            "غير معروف",
          inline: true
        },

        {
          name:
            "🕐 وقت التقييم",
          value:
            logTime(),
          inline: true
        }

      )
      .setTimestamp()
  );
  }
// ==================================================
// CREATE TICKET CHANNEL
// ==================================================

async function createTicket(
  interaction,
  settings
) {

  const guild =
    interaction.guild;

  const user =
    interaction.user;

  // ----------------------------------------------
  // التأكد من الحد الأقصى للتذاكر
  // ----------------------------------------------

  const openTickets =
    getOpenTicketsForUser(
      guild.id,
      user.id
    );

  const maxTickets =
    Number(
      settings.maxTickets || 1
    );

  if (
    openTickets.length >=
    maxTickets
  ) {

    return interaction.reply({
      content:
        `❌ لديك بالفعل ${openTickets.length} تذكرة مفتوحة.\nالحد الأقصى: ${maxTickets}`,
      ephemeral: true
    });

  }

  // ----------------------------------------------
  // إنشاء بيانات التذكرة
  // ----------------------------------------------

  const ticket =
    createTicketData(
      guild.id,
      user.id
    );

  // ----------------------------------------------
  // اسم التذكرة
  // ----------------------------------------------

  const ticketNumber =
    Object.keys(db.tickets)
      .filter(id =>
        db.tickets[id]?.guildId ===
        guild.id
      ).length + 1;

  const channelName =
    `ticket-${ticketNumber}`;

  // ----------------------------------------------
  // صلاحيات الروم
  // ----------------------------------------------

  const overwrites = [

    {
      id:
        guild.roles.everyone.id,

      deny: [
        PermissionFlagsBits.ViewChannel
      ]
    },

    {
      id:
        user.id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }

  ];

  // ----------------------------------------------
  // إضافة رتب الإدارة
  // ----------------------------------------------

  const staffRoles = [

    settings.juniorRole,
    settings.middleRole,
    settings.seniorRole,
    settings.ownerRole

  ].filter(Boolean);

  for (
    const roleId of staffRoles
  ) {

    overwrites.push({

      id: roleId,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]

    });

  }

  // ----------------------------------------------
  // إنشاء الروم
  // ----------------------------------------------

  const channel =
    await guild.channels.create({

      name:
        channelName,

      type:
        ChannelType.GuildText,

      parent:
        settings.category || null,

      permissionOverwrites:
        overwrites

    });

  // ----------------------------------------------
  // حفظ Channel ID
  // ----------------------------------------------

  ticket.channelId =
    channel.id;

  db.tickets[channel.id] =
    ticket;

  saveDB();

  // ----------------------------------------------
  // Embed التذكرة
  // ----------------------------------------------

  const embed =
    ticketEmbed(
      ticket,
      guild
    );

  // ----------------------------------------------
  // رسالة الترحيب
  // ----------------------------------------------

  await channel.send({

    content:
      `<@${user.id}>`,

    embeds: [
      embed
    ],

    components: [
      ticketRow()
    ]

  });

  // ----------------------------------------------
  // Log فتح التذكرة
  // ----------------------------------------------

  await logTicketOpened(
    guild,
    settings,
    ticket,
    channel,
    user
  );

  // ----------------------------------------------
  // الرد
  // ----------------------------------------------

  await interaction.reply({

    content:
      `✅ تم إنشاء تذكرتك: ${channel}`,

    ephemeral: true

  });

  return channel;
}

// ==================================================
// CLAIM TICKET
// ==================================================

async function claimTicket(
  interaction,
  ticket,
  settings
) {

  const member =
    interaction.member;

  // ----------------------------------------------
  // الصلاحية
  // ----------------------------------------------

  if (
    !canClaim(
      member,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ ليس لديك صلاحية استلام التذاكر.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // التأكد من حالة التذكرة
  // ----------------------------------------------

  if (
    ticket.status ===
    "deleted"
  ) {

    return interaction.reply({

      content:
        "❌ هذه التذكرة محذوفة.",

      ephemeral: true

    });

  }

  if (
    ticket.status ===
    "closed_waiting_rating"
  ) {

    return interaction.reply({

      content:
        "❌ هذه التذكرة مغلقة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // إذا كانت مستلمة
  // ----------------------------------------------

  if (ticket.claimedBy) {

    if (
      ticket.claimedBy ===
      member.id
    ) {

      return interaction.reply({

        content:
          "⚠️ أنت مستلم هذه التذكرة بالفعل.",

        ephemeral: true

      });

    }

    return interaction.reply({

      content:
        `❌ التذكرة مستلمة بالفعل بواسطة <@${ticket.claimedBy}>.`,

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // الاستلام
  // ----------------------------------------------

  ticket.claimedBy =
    member.id;

  ticket.claimedAt =
    Date.now();

  saveDB();

  // ----------------------------------------------
  // تعديل الصلاحيات
  // ----------------------------------------------

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  // ----------------------------------------------
  // الإحصائيات
  // ----------------------------------------------

  addStat(
    interaction.guild.id,
    member.id,
    "claimed"
  );

  // ----------------------------------------------
  // Log
  // ----------------------------------------------

  await logTicketClaimed(
    interaction.guild,
    settings,
    ticket,
    interaction.channel,
    member
  );

  // ----------------------------------------------
  // تحديث الرسالة
  // ----------------------------------------------

  await interaction.reply({

    content:
      `🙋 تم استلام التذكرة بواسطة ${member}.`,

    ephemeral: false

  });

  // ----------------------------------------------
  // رسالة داخل التذكرة
  // ----------------------------------------------

  await interaction.channel.send({

    embeds: [

      new EmbedBuilder()

        .setTitle(
          "🙋 تم استلام التذكرة"
        )

        .setDescription(
          `تم استلام التذكرة بواسطة ${member}.`
        )

        .setColor(
          "#57F287"
        )

        .addFields({

          name:
            "🕐 وقت الاستلام",

          value:
            logTime(),

          inline: true

        })

        .setTimestamp()

    ]

  });
}

// ==================================================
// UNCLAIM TICKET
// ==================================================

async function unclaimTicket(
  interaction,
  ticket,
  settings
) {

  const member =
    interaction.member;

  if (
    !canManageTicket(
      member,
      ticket,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ لا تملك صلاحية إلغاء استلام هذه التذكرة.",

      ephemeral: true

    });

  }

  if (
    !ticket.claimedBy
  ) {

    return interaction.reply({

      content:
        "⚠️ التذكرة غير مستلمة أصلًا.",

      ephemeral: true

    });

  }

  const oldClaimer =
    ticket.claimedBy;

  // ----------------------------------------------
  // إزالة المستلم
  // ----------------------------------------------

  ticket.claimedBy =
    null;

  ticket.claimedAt =
    null;

  saveDB();

  // ----------------------------------------------
  // الصلاحيات
  // ----------------------------------------------

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  // ----------------------------------------------
  // Log
  // ----------------------------------------------

  await logTicketUnclaimed(
    interaction.guild,
    settings,
    ticket,
    interaction.channel,
    member,
    oldClaimer
  );

  // ----------------------------------------------
  // الرد
  // ----------------------------------------------

  await interaction.reply({

    content:
      `↩️ تم إلغاء استلام التذكرة.`

  });

}

// ==================================================
// LOCK / UNLOCK TICKET
// ==================================================

async function lockTicket(
  interaction,
  ticket,
  settings,
  locked = true
) {

  const member =
    interaction.member;

  // ----------------------------------------------
  // الصلاحية
  // ----------------------------------------------

  if (
    !canManageTicket(
      member,
      ticket,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ لا تملك صلاحية التحكم بهذه التذكرة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // الحالة نفسها
  // ----------------------------------------------

  if (
    Boolean(ticket.locked) ===
    Boolean(locked)
  ) {

    return interaction.reply({

      content:
        locked
          ? "⚠️ التذكرة مقفلة بالفعل."
          : "⚠️ التذكرة مفتوحة بالفعل.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // تغيير الحالة
  // ----------------------------------------------

  ticket.locked =
    locked;

  ticket.status =
    locked
      ? "locked"
      : "open";

  saveDB();

  // ----------------------------------------------
  // تغيير الصلاحيات
  // ----------------------------------------------

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  // ----------------------------------------------
  // Log
  // ----------------------------------------------

  await logTicketLock(
    interaction.guild,
    settings,
    ticket,
    interaction.channel,
    member,
    locked
  );

  // ----------------------------------------------
  // الرد
  // ----------------------------------------------

  await interaction.reply({

    embeds: [

      new EmbedBuilder()

        .setTitle(
          locked
            ? "🔒 تم قفل التذكرة"
            : "🔓 تم فتح التذكرة"
        )

        .setDescription(
          locked
            ? `تم قفل التذكرة بواسطة ${member}.`
            : `تم فتح التذكرة بواسطة ${member}.`
        )

        .setColor(
          locked
            ? "#ED4245"
            : "#57F287"
        )

        .addFields({

          name:
            "🕐 الوقت",

          value:
            logTime(),

          inline: true

        })

        .setTimestamp()

    ]

  });
}

// ==================================================
// REQUEST CLOSE
// ==================================================

async function requestClose(
  interaction,
  ticket,
  settings
) {

  const member =
    interaction.member;

  // ----------------------------------------------
  // الصلاحية
  // ----------------------------------------------

  if (
    !canManageTicket(
      member,
      ticket,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ لا تملك صلاحية إغلاق هذه التذكرة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // التأكد من الحالة
  // ----------------------------------------------

  if (
    ticket.status ===
    "closed_waiting_rating"
  ) {

    return interaction.reply({

      content:
        "⚠️ التذكرة مغلقة بالفعل.",

      ephemeral: true

    });

  }

  if (
    ticket.status ===
    "deleted"
  ) {

    return interaction.reply({

      content:
        "❌ التذكرة محذوفة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // تأكيد الإغلاق
  // ----------------------------------------------

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            "ticket_close_confirm"
          )
          .setLabel(
            "تأكيد الإغلاق"
          )
          .setEmoji(
            "🔴"
          )
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "ticket_close_cancel"
          )
          .setLabel(
            "إلغاء"
          )
          .setEmoji(
            "❌"
          )
          .setStyle(
            ButtonStyle.Secondary
          )

      );

  await interaction.reply({

    content:
      "⚠️ هل أنت متأكد من إغلاق هذه التذكرة؟",

    components: [
      row
    ],

    ephemeral: true

  });
}
// ==================================================
// CLOSE TICKET
// ==================================================

async function actuallyClose(
  interaction,
  ticket,
  settings
) {

  const guild =
    interaction.guild;

  const channel =
    interaction.channel;

  const member =
    interaction.member;

  // ----------------------------------------------
  // التأكد من الصلاحية
  // ----------------------------------------------

  if (
    !canManageTicket(
      member,
      ticket,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ لا تملك صلاحية إغلاق هذه التذكرة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // تغيير حالة التذكرة
  // ----------------------------------------------

  ticket.status =
    "closed_waiting_rating";

  ticket.closedAt =
    Date.now();

  ticket.locked =
    true;

  saveDB();

  // ----------------------------------------------
  // قفل التذكرة
  // ----------------------------------------------

  await setTicketPermissions(
    channel,
    ticket,
    settings
  );

  // ----------------------------------------------
  // إحصائية الإغلاق
  // ----------------------------------------------

  if (ticket.claimedBy) {

    addStat(
      guild.id,
      ticket.claimedBy,
      "closed"
    );

  }

  // ----------------------------------------------
  // أزرار التقييم
  //
  // مهم:
  // نضع Guild ID + Channel ID
  // حتى تعمل الأزرار من الـ DM
  // ----------------------------------------------

  const ratingRow =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            `rating_1_${guild.id}_${channel.id}`
          )
          .setLabel("1")
          .setEmoji("⭐")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `rating_2_${guild.id}_${channel.id}`
          )
          .setLabel("2")
          .setEmoji("⭐")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            `rating_3_${guild.id}_${channel.id}`
          )
          .setLabel("3")
          .setEmoji("⭐")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            `rating_4_${guild.id}_${channel.id}`
          )
          .setLabel("4")
          .setEmoji("⭐")
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            `rating_5_${guild.id}_${channel.id}`
          )
          .setLabel("5")
          .setEmoji("⭐")
          .setStyle(
            ButtonStyle.Success
          )

      );

  // ----------------------------------------------
  // إرسال التقييم لصاحب التذكرة
  // ----------------------------------------------

  let owner = null;

  try {

    owner =
      await guild.members.fetch(
        ticket.userId
      );

  } catch {

    owner = null;

  }

  if (owner) {

    try {

      await owner.send({

        content:
          `<@${ticket.userId}> ⭐`,

        embeds: [

          new EmbedBuilder()

            .setTitle(
              "⭐ تقييم التذكرة"
            )

            .setDescription(
              `تم إغلاق تذكرتك في **${guild.name}**.\n\n` +
              `يمكنك تقييم الخدمة من 1 إلى 5 نجوم.\n\n` +
              `⭐ **التقييم مطلوب قبل حذف التذكرة**`
            )

            .setColor(
              "#FEE75C"
            )

            .addFields(

              {
                name:
                  "🎫 التذكرة",

                value:
                  `#${channel.name}`,

                inline: true
              },

              {
                name:
                  "🕐 وقت الإغلاق",

                value:
                  `<t:${Math.floor(
                    Date.now() / 1000
                  )}:F>`,

                inline: true
              }

            )

            .setTimestamp()

        ],

        components: [
          ratingRow
        ]

      });

    } catch (error) {

      console.log(
        "⚠️ تعذر إرسال التقييم في الخاص:",
        error.message
      );

    }

  }

  // ----------------------------------------------
  // رسالة داخل التذكرة
  // ----------------------------------------------

  await channel.send({

    embeds: [

      new EmbedBuilder()

        .setTitle(
          "🔴 تم إغلاق التذكرة"
        )

        .setDescription(
          `تم إغلاق التذكرة بواسطة ${member}.\n\n` +
          `⭐ تم إرسال طلب التقييم إلى صاحب التذكرة في الخاص.\n` +
          `التقييم اختياري ويمكن حذف التذكرة بدون تقييم.`
        )

        .setColor(
          "#ED4245"
        )

        .addFields(

          {
            name:
              "👤 صاحب التذكرة",

            value:
              `<@${ticket.userId}>`,

            inline: true
          },

          {
            name:
              "🛡️ قام بالإغلاق",

            value:
              `${member}`,

            inline: true
          },

          {
            name:
              "🕐 وقت الإغلاق",

            value:
              logTime(),

            inline: true
          }

        )

        .setTimestamp()

    ]

  });

  // ----------------------------------------------
  // Log
  // ----------------------------------------------

  await logTicketClosed(
    guild,
    settings,
    ticket,
    channel,
    member
  );

  // ----------------------------------------------
  // الرد إذا لم يتم الرد سابقًا
  // ----------------------------------------------

  if (!interaction.replied &&
      !interaction.deferred) {

    await interaction.reply({

      content:
        "🔴 تم إغلاق التذكرة وتم إرسال التقييم في الخاص.",

      ephemeral: true

    });

  }

}

// ==================================================
// CANCEL CLOSE
// ==================================================

async function cancelClose(
  interaction
) {

  return interaction.update({

    content:
      "❌ تم إلغاء إغلاق التذكرة.",

    components: []

  });

}

// ==================================================
// HANDLE RATING
// ==================================================

async function handleRating(
  interaction
) {

  const parts =
    interaction.customId.split("_");

  /*
    الشكل:

    rating_5_GUILD_ID_CHANNEL_ID

    parts[0] = rating
    parts[1] = الرقم
    parts[2] = Guild ID
    parts[3] = Channel ID
  */

  const rating =
    Number(parts[1]);

  const guildId =
    parts[2];

  const channelId =
    parts[3];

  // ----------------------------------------------
  // التأكد من الرقم
  // ----------------------------------------------

  if (
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  ) {

    return interaction.reply({

      content:
        "❌ تقييم غير صالح.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // جلب السيرفر
  // ----------------------------------------------

  const guild =
    client.guilds.cache.get(
      guildId
    );

  if (!guild) {

    return interaction.reply({

      content:
        "❌ السيرفر لم يعد متاحًا للبوت.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // الإعدادات
  // ----------------------------------------------

  const settings =
    getGuild(guildId);

  // ----------------------------------------------
  // جلب التذكرة من DB
  //
  // مهم جدًا:
  // لا نعتمد على interaction.guild
  // لأن الزر تم الضغط عليه في DM
  // ----------------------------------------------

  const ticket =
    db.tickets[channelId];

  if (!ticket) {

    return interaction.reply({

      content:
        "❌ بيانات التذكرة غير موجودة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // التأكد أن الشخص هو صاحب التذكرة
  // ----------------------------------------------

  if (
    ticket.userId !==
    interaction.user.id
  ) {

    return interaction.reply({

      content:
        "❌ هذا التقييم ليس خاصًا بك.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // منع التقييم مرتين
  // ----------------------------------------------

  if (ticket.rated) {

    return interaction.reply({

      content:
        `⭐ لقد قمت بتقييم هذه التذكرة بالفعل: ${stars(ticket.rating)} (${ticket.rating}/5)`,

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // حفظ التقييم
  // ----------------------------------------------

  ticket.rating =
    rating;

  ticket.rated =
    true;

  ticket.ratedAt =
    Date.now();

  saveDB();

  // ----------------------------------------------
  // إضافة الإحصائيات
  // ----------------------------------------------

  if (ticket.claimedBy) {

    addStat(
      guildId,
      ticket.claimedBy,
      "ratings"
    );

    addStat(
      guildId,
      ticket.claimedBy,
      "ratingSum",
      rating
    );

  }

  // ----------------------------------------------
  // تحديث رسالة الـ DM
  // ----------------------------------------------

  await interaction.update({

    content:
      `⭐ شكرًا لك <@${interaction.user.id}>!\n\n` +
      `تم تسجيل تقييمك: ${stars(rating)} **(${rating}/5)**`,

    embeds: [

      new EmbedBuilder()

        .setTitle(
          "⭐ تم تسجيل التقييم"
        )

        .setDescription(
          `شكرًا لك على تقييم الخدمة في **${guild.name}**.\n\n` +
          `تقييمك: ${stars(rating)} **${rating}/5**`
        )

        .setColor(
          "#FEE75C"
        )

        .setTimestamp()

    ],

    components: []

  });

  // ----------------------------------------------
  // Log التقييم
  // ----------------------------------------------

  await logTicketRated(
    guild,
    settings,
    ticket,
    rating,
    interaction.user
  );

}

// ==================================================
// RATING BUTTON IDENTIFIER
// ==================================================

function isRatingButton(
  customId
) {

  return (
    typeof customId === "string" &&
    customId.startsWith(
      "rating_"
    )
  );

      }
// ==================================================
// BUILD TICKET TRANSCRIPT
// ==================================================

async function buildTranscript(
  channel
) {

  try {

    const messages = [];

    let lastId = null;

    while (true) {

      const options = {
        limit: 100
      };

      if (lastId) {
        options.before =
          lastId;
      }

      const batch =
        await channel.messages.fetch(
          options
        );

      if (
        !batch ||
        batch.size === 0
      ) {
        break;
      }

      messages.push(
        ...batch.values()
      );

      lastId =
        batch.last().id;

      if (
        batch.size < 100
      ) {
        break;
      }
    }

    // ----------------------------------------------
    // ترتيب الرسائل من الأقدم للأحدث
    // ----------------------------------------------

    messages.reverse();

    let transcript =
      "";

    transcript +=
      `========================================\n`;

    transcript +=
      `TICKET TRANSCRIPT\n`;

    transcript +=
      `SERVER: ${channel.guild.name}\n`;

    transcript +=
      `CHANNEL: #${channel.name}\n`;

    transcript +=
      `CHANNEL ID: ${channel.id}\n`;

    transcript +=
      `CREATED: ${new Date().toISOString()}\n`;

    transcript +=
      `========================================\n\n`;

    for (
      const message of messages
    ) {

      const time =
        new Date(
          message.createdTimestamp
        ).toLocaleString(
          "ar-EG"
        );

      const author =
        message.author
          ? `${message.author.tag} (${message.author.id})`
          : "Unknown";

      let content =
        message.content || "";

      // ----------------------------------------------
      // Embeds
      // ----------------------------------------------

      if (
        message.embeds &&
        message.embeds.length
      ) {

        for (
          const embed of message.embeds
        ) {

          if (embed.title) {
            content +=
              ` [Embed: ${embed.title}]`;
          }

          if (embed.description) {
            content +=
              ` ${embed.description}`;
          }
        }
      }

      // ----------------------------------------------
      // Attachments
      // ----------------------------------------------

      if (
        message.attachments &&
        message.attachments.size
      ) {

        for (
          const attachment of message.attachments.values()
        ) {

          content +=
            ` [Attachment: ${attachment.url}]`;
        }
      }

      transcript +=
        `[${time}] ${author}\n`;

      transcript +=
        `${content || "[بدون نص]"}\n`;

      transcript +=
        `----------------------------------------\n`;
    }

    return transcript;

  } catch (error) {

    console.error(
      "❌ Transcript error:",
      error
    );

    return (
      "❌ تعذر إنشاء Transcript لهذه التذكرة."
    );
  }
}

// ==================================================
// ARCHIVE TICKET
// ==================================================

async function archiveTicket(
  guild,
  settings,
  ticket,
  channel
) {

  try {

    if (
      !settings.archiveChannel
    ) {
      return null;
    }

    const archiveChannel =
      guild.channels.cache.get(
        settings.archiveChannel
      );

    if (!archiveChannel) {
      return null;
    }

    const transcript =
      await buildTranscript(
        channel
      );

    // ----------------------------------------------
    // Embed الأرشيف
    // ----------------------------------------------

    const archiveEmbed =
      new EmbedBuilder()

        .setTitle(
          "📦 Ticket Archive"
        )

        .setColor(
          "#5865F2"
        )

        .addFields(

          {
            name:
              "👤 صاحب التذكرة",

            value:
              `<@${ticket.userId}>`,

            inline: true
          },

          {
            name:
              "🆔 User ID",

            value:
              ticket.userId,

            inline: true
          },

          {
            name:
              "🎫 اسم التذكرة",

            value:
              `#${channel.name}`,

            inline: true
          },

          {
            name:
              "🆔 Channel ID",

            value:
              channel.id,

            inline: true
          },

          {
            name:
              "🙋 المستلم",

            value:
              ticket.claimedBy
                ? `<@${ticket.claimedBy}>`
                : "لم يتم الاستلام",

            inline: true
          },

          {
            name:
              "⭐ التقييم",

            value:
              ticket.rated
                ? `${stars(ticket.rating)} (${ticket.rating}/5)`
                : "لم يتم التقييم",

            inline: true
          },

          {
            name:
              "📅 وقت الفتح",

            value:
              ticket.createdAt
                ? `<t:${Math.floor(
                    ticket.createdAt / 1000
                  )}:F>`
                : "غير معروف",

            inline: true
          },

          {
            name:
              "🔴 وقت الإغلاق",

            value:
              ticket.closedAt
                ? `<t:${Math.floor(
                    ticket.closedAt / 1000
                  )}:F>`
                : "غير معروف",

            inline: true
          },

          {
            name:
              "🗑️ وقت الحذف",

            value:
              logTime(),

            inline: true
          }

        )

        .setTimestamp();

    // ----------------------------------------------
    // إرسال معلومات الأرشيف
    // ----------------------------------------------

    await archiveChannel.send({
      embeds: [
        archiveEmbed
      ]
    });

    // ----------------------------------------------
    // إرسال Transcript
    // ----------------------------------------------

    /*
      لو الـTranscript كبير جدًا
      نقسمه إلى أجزاء.
    */

    const MAX_LENGTH =
      1900;

    for (
      let i = 0;
      i < transcript.length;
      i += MAX_LENGTH
    ) {

      const chunk =
        transcript.slice(
          i,
          i + MAX_LENGTH
        );

      await archiveChannel.send({

        content:
          `\`\`\`\n${chunk}\n\`\`\``

      });
    }

    return true;

  } catch (error) {

    console.error(
      "❌ Archive error:",
      error
    );

    return false;
  }
}

// ==================================================
// DELETE TICKET
// ==================================================

async function deleteTicket(
  interaction,
  ticket,
  settings
) {

  const member =
    interaction.member;

  const channel =
    interaction.channel;

  const guild =
    interaction.guild;

  // ----------------------------------------------
  // الصلاحية
  // ----------------------------------------------

  if (
    !canManageTicket(
      member,
      ticket,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ لا تملك صلاحية حذف هذه التذكرة.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // التقييم الإجباري
  // ----------------------------------------------

  if (
    settings.requireRating &&
    !ticket.rated
  ) {
    return interaction.reply({
      content:
        "⭐ يجب على صاحب التذكرة تقييم الخدمة قبل حذف التذكرة.",
      ephemeral: true
    });
  }

  // ----------------------------------------------
  // منع الحذف المتكرر
  // ----------------------------------------------

  if (
    ticket.status ===
    "deleted"
  ) {

    return interaction.reply({

      content:
        "⚠️ هذه التذكرة يتم حذفها بالفعل.",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // الرد قبل الأرشفة
  // ----------------------------------------------

  if (
    !interaction.replied &&
    !interaction.deferred
  ) {

    await interaction.reply({

      content:
        "🗑️ جاري حفظ التذكرة وحذف الروم...",

      ephemeral: true

    });

  }

  // ----------------------------------------------
  // حفظ Transcript + Archive
  // ----------------------------------------------

  await archiveTicket(
    guild,
    settings,
    ticket,
    channel
  );

  // ----------------------------------------------
  // حفظ معلومات الحذف
  //
  // مهم:
  // لا نحذف db.tickets[channel.id]
  // ----------------------------------------------

  ticket.deleted =
    true;

  ticket.deletedAt =
    Date.now();

  ticket.status =
    "deleted";

  // ----------------------------------------------
  // حفظ آخر حالة في DB
  // ----------------------------------------------

  saveDB();

  // ----------------------------------------------
  // Log الحذف
  // ----------------------------------------------

  await logTicketDeleted(
    guild,
    settings,
    ticket,
    channel,
    member
  );

  // ----------------------------------------------
  // إرسال رسالة أخيرة
  // ----------------------------------------------

  try {

    await channel.send({

      embeds: [

        new EmbedBuilder()

          .setTitle(
            "🗑️ سيتم حذف التذكرة"
          )

          .setDescription(
            `سيتم حذف هذه التذكرة بواسطة ${member}.\n` +
            `تم حفظ بياناتها في الأرشيف.\n\n` +
            `⭐ التقييم المرسل في الخاص سيظل صالحًا.`
          )

          .setColor(
            "#ED4245"
          )

          .addFields({

            name:
              "🕐 وقت الحذف",

            value:
              logTime(),

            inline: true

          })

          .setTimestamp()

      ]

    });

  } catch {
    // تجاهل الخطأ إذا لم يعد بإمكان البوت الإرسال
  }

  // ----------------------------------------------
  // حذف الروم
  // ----------------------------------------------

  setTimeout(
    async () => {

      try {

        await channel.delete(
          "Ticket deleted"
        );

      } catch (error) {

        console.error(
          "❌ Channel delete error:",
          error
        );

      }

    },
    1500
  );
}

// ==================================================
// DELETE BUTTON CONFIRMATION
// ==================================================

async function confirmDelete(
  interaction,
  ticket,
  settings
) {

  const member =
    interaction.member;

  if (
    !canManageTicket(
      member,
      ticket,
      settings
    )
  ) {

    return interaction.reply({

      content:
        "❌ لا تملك صلاحية حذف هذه التذكرة.",

      ephemeral: true

    });

  }

  const row =
    new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()

          .setCustomId(
            "ticket_delete_confirm"
          )

          .setLabel(
            "تأكيد الحذف"
          )

          .setEmoji(
            "🗑️"
          )

          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()

          .setCustomId(
            "ticket_delete_cancel"
          )

          .setLabel(
            "إلغاء"
          )

          .setEmoji(
            "❌"
          )

          .setStyle(
            ButtonStyle.Secondary
          )

      );

  return interaction.reply({

    content:
      "⚠️ هل أنت متأكد من حذف التذكرة؟\n\n" +
      "سيتم حفظ الـTranscript قبل الحذف.",

    components: [
      row
    ],

    ephemeral: true

  });
}

// ==================================================
// CANCEL DELETE
// ==================================================

async function cancelDelete(
  interaction
) {

  return interaction.update({

    content:
      "❌ تم إلغاء حذف التذكرة.",

    components: []

  });

        }

// ==================================================
// MODERATION COMMANDS
// ==================================================

async function executeWarn({ guild, settings, actor, target, reason, duration }) {
  if (!target) return "❌ لم أجد العضو.";
  if (!canModerateTarget(actor, target, settings)) {
    return "❌ لا يمكنك تحذير عضو بنفس رتبتك أو أعلى.";
  }

  const list = removeExpiredWarnings(guild.id, target.id);
  const expiresAt = duration ? Date.now() + duration : null;

  list.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    moderatorId: actor.id,
    reason: reason || "بدون سبب",
    createdAt: Date.now(),
    expiresAt
  });

  db.warnings[warningKey(guild.id, target.id)] = list;
  saveDB();

  await sendModerationLog(
    guild,
    settings,
    "⚠️ تحذير جديد",
    "#FEE75C",
    [
      { name: "العضو", value: `${target}`, inline: true },
      { name: "المشرف", value: `${actor}`, inline: true },
      { name: "السبب", value: safeText(reason || "بدون سبب"), inline: false },
      { name: "المدة", value: duration ? formatDuration(duration) : "دائم", inline: true },
      { name: "عدد التحذيرات", value: String(list.length), inline: true }
    ]
  );

  let autoTimeout = false;
  if (list.length >= 3 && target.moderatable) {
    try {
      await target.timeout(30 * 60 * 1000, "الوصول إلى 3 تحذيرات");
      autoTimeout = true;
    } catch {}
  }

  return (
    `⚠️ تم تحذير ${target}.\n` +
    `السبب: **${safeText(reason || "بدون سبب")}**\n` +
    `المدة: **${duration ? formatDuration(duration) : "دائم"}**\n` +
    `التحذيرات النشطة: **${list.length}**` +
    (autoTimeout ? "\n⏱️ تم تطبيق Timeout لمدة 30 دقيقة بسبب وصوله إلى 3 تحذيرات." : "")
  );
}

async function executeTimeout({ guild, settings, actor, target, reason, duration }) {
  if (!target) return "❌ لم أجد العضو.";
  if (!canModerateTarget(actor, target, settings)) {
    return "❌ لا يمكنك إعطاء Timeout لعضو بنفس رتبتك أو أعلى.";
  }
  if (!duration) return "❌ يجب تحديد مدة مثل `10m` أو `1h` أو `1d`.";
  if (duration > 28 * 24 * 60 * 60 * 1000) {
    return "❌ أقصى مدة للـTimeout هي 28 يومًا.";
  }
  if (!target.moderatable) return "❌ رتبة البوت لا تسمح له بتطبيق Timeout على هذا العضو.";

  try {
    await target.timeout(duration, reason || "بدون سبب");
  } catch (error) {
    console.error("Timeout error:", error);
    return "❌ فشل تطبيق Timeout. تأكد من صلاحية Moderate Members وترتيب الرتب.";
  }

  await sendModerationLog(
    guild,
    settings,
    "⏱️ Timeout",
    "#ED4245",
    [
      { name: "العضو", value: `${target}`, inline: true },
      { name: "المشرف", value: `${actor}`, inline: true },
      { name: "المدة", value: formatDuration(duration), inline: true },
      { name: "السبب", value: safeText(reason || "بدون سبب"), inline: false }
    ]
  );

  return `⏱️ تم إعطاء ${target} Timeout لمدة **${formatDuration(duration)}**.\nالسبب: **${safeText(reason || "بدون سبب")}**`;
}

async function executeJail({ guild, settings, actor, target, reason, duration }) {
  if (!target) return "❌ لم أجد العضو.";
  if (staffLevel(actor, settings) < 3 && guild.ownerId !== actor.id) {
    return "❌ السجن متاح للاستف العليا أو الأونر فقط.";
  }
  if (!canModerateTarget(actor, target, settings)) {
    return "❌ لا يمكنك سجن عضو بنفس رتبتك أو أعلى.";
  }
  if (!settings.jailRole) {
    return "❌ لم يتم تحديد رتبة السجن. استخدم `/setup-jail-role` أو `$setup-jail-role @role`.";
  }
  const role = guild.roles.cache.get(settings.jailRole);
  if (!role) return "❌ رتبة السجن المحفوظة غير موجودة.";
  if (!role.editable) return "❌ البوت لا يستطيع إعطاء رتبة السجن بسبب ترتيب الرتب.";

  try {
    await target.roles.add(role, reason || "بدون سبب");
  } catch (error) {
    console.error("Jail error:", error);
    return "❌ فشل إعطاء رتبة السجن.";
  }

  const expiresAt = duration ? Date.now() + duration : null;
  db.jails[warningKey(guild.id, target.id)] = {
    guildId: guild.id,
    userId: target.id,
    roleId: role.id,
    moderatorId: actor.id,
    reason: reason || "بدون سبب",
    jailedAt: Date.now(),
    expiresAt
  };
  saveDB();

  await sendModerationLog(
    guild,
    settings,
    "🔒 سجن عضو",
    "#ED4245",
    [
      { name: "العضو", value: `${target}`, inline: true },
      { name: "المشرف", value: `${actor}`, inline: true },
      { name: "المدة", value: duration ? formatDuration(duration) : "دائم", inline: true },
      { name: "السبب", value: safeText(reason || "بدون سبب"), inline: false }
    ]
  );

  if (duration) {
    setTimeout(async () => {
      const key = warningKey(guild.id, target.id);
      const jail = db.jails[key];
      if (!jail || jail.expiresAt !== expiresAt) return;

      try {
        const member = await guild.members.fetch(target.id);
        if (member.roles.cache.has(role.id)) {
          await member.roles.remove(role, "انتهاء مدة السجن");
        }
      } catch {}

      delete db.jails[key];
      saveDB();
    }, Math.min(duration, 2147483647));
  }

  return `🔒 تم سجن ${target} لمدة **${duration ? formatDuration(duration) : "دائم"}**.\nالسبب: **${safeText(reason || "بدون سبب")}**`;
}

async function executeBan({ guild, settings, actor, target, reason }) {
  if (!target) return "❌ لم أجد العضو.";
  if (!canModerateTarget(actor, target, settings)) return "❌ لا يمكنك حظر عضو بنفس رتبتك أو أعلى.";
  if (!target.bannable) return "❌ البوت لا يستطيع حظر هذا العضو.";

  try {
    await target.ban({ reason: reason || "بدون سبب", deleteMessageSeconds: 0 });
  } catch {
    return "❌ فشل الحظر. تأكد من صلاحية Ban Members وترتيب الرتب.";
  }

  await sendModerationLog(guild, settings, "🔨 حظر عضو", "#ED4245", [
    { name: "العضو", value: `${target.user.tag} (${target.id})`, inline: true },
    { name: "المشرف", value: `${actor}`, inline: true },
    { name: "السبب", value: safeText(reason || "بدون سبب"), inline: false }
  ]);

  return `🔨 تم حظر **${target.user.tag}**.\nالسبب: **${safeText(reason || "بدون سبب")}**`;
}

async function executeKick({ guild, settings, actor, target, reason }) {
  if (!target) return "❌ لم أجد العضو.";
  if (!canModerateTarget(actor, target, settings)) return "❌ لا يمكنك طرد عضو بنفس رتبتك أو أعلى.";
  if (!target.kickable) return "❌ البوت لا يستطيع طرد هذا العضو.";

  try {
    await target.kick(reason || "بدون سبب");
  } catch {
    return "❌ فشل الطرد. تأكد من صلاحية Kick Members وترتيب الرتب.";
  }

  await sendModerationLog(guild, settings, "👢 طرد عضو", "#ED4245", [
    { name: "العضو", value: `${target.user.tag} (${target.id})`, inline: true },
    { name: "المشرف", value: `${actor}`, inline: true },
    { name: "السبب", value: safeText(reason || "بدون سبب"), inline: false }
  ]);

  return `👢 تم طرد **${target.user.tag}**.\nالسبب: **${safeText(reason || "بدون سبب")}**`;
}

async function executeUnban({ guild, settings, actor, userId, reason }) {
  if (staffLevel(actor, settings) < 2 && !isServerManager(actor) && guild.ownerId !== actor.id) {
    return "❌ ليس لديك صلاحية فك الحظر.";
  }
  if (!/^\d{15,25}$/.test(userId || "")) return "❌ اكتب ID العضو بعد الأمر.";

  try {
    await guild.bans.remove(userId, reason || "بدون سبب");
  } catch {
    return "❌ لم أستطع فك الحظر. تأكد من الـID وأن العضو محظور.";
  }

  await sendModerationLog(guild, settings, "🔓 فك حظر", "#57F287", [
    { name: "العضو ID", value: userId, inline: true },
    { name: "المشرف", value: `${actor}`, inline: true },
    { name: "السبب", value: safeText(reason || "بدون سبب"), inline: false }
  ]);

  return `🔓 تم فك الحظر عن **${userId}**.`;
}

async function restoreJails() {
  for (const [key, jail] of Object.entries(db.jails || {})) {
    const guild = client.guilds.cache.get(jail.guildId);
    if (!guild) continue;

    if (jail.expiresAt && jail.expiresAt <= Date.now()) {
      try {
        const member = await guild.members.fetch(jail.userId);
        const role = guild.roles.cache.get(jail.roleId);
        if (role && member.roles.cache.has(role.id)) {
          await member.roles.remove(role, "انتهاء مدة السجن");
        }
      } catch {}
      delete db.jails[key];
      continue;
    }

    if (jail.expiresAt) {
      const delay = Math.min(jail.expiresAt - Date.now(), 2147483647);
      setTimeout(async () => {
        const current = db.jails[key];
        if (!current || current.expiresAt !== jail.expiresAt) return;
        try {
          const member = await guild.members.fetch(jail.userId);
          const role = guild.roles.cache.get(jail.roleId);
          if (role && member.roles.cache.has(role.id)) {
            await member.roles.remove(role, "انتهاء مدة السجن");
          }
        } catch {}
        delete db.jails[key];
        saveDB();
      }, delay);
    }
  }
  saveDB();
}

// ==================================================
// INTERACTION HANDLER
// ==================================================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // ==================================================
      // BUTTONS
      // ==================================================

      if (interaction.isButton()) {

        // --------------------------------------------------
        // ⭐ RATING BUTTON
        // --------------------------------------------------
        // لازم يتعامل معاه قبل فحص interaction.guild
        // لأن التقييم يتم من الـDM
        // --------------------------------------------------

        if (
          isRatingButton(
            interaction.customId
          )
        ) {

          return await handleRating(
            interaction
          );

        }

        // --------------------------------------------------
        // أي زر آخر لازم يكون داخل السيرفر
        // --------------------------------------------------

        if (!interaction.guild) {

          return interaction.reply({

            content:
              "❌ هذا الزر يعمل داخل السيرفر فقط.",

            ephemeral: true

          });

        }

        // --------------------------------------------------
        // SETTINGS
        // --------------------------------------------------

        const settings =
          getGuild(
            interaction.guild.id
          );

        // --------------------------------------------------
        // TICKET OPEN
        // --------------------------------------------------

        if (
          interaction.customId ===
          "ticket_open"
        ) {

          return await createTicket(
            interaction,
            settings
          );

        }

        // --------------------------------------------------
        // GET TICKET
        // --------------------------------------------------

        const ticket =
          db.tickets[
            interaction.channel.id
          ];

        // --------------------------------------------------
        // التأكد من وجود التذكرة
        // --------------------------------------------------

        if (
          [
            "ticket_claim",
            "ticket_unclaim",
            "ticket_lock",
            "ticket_unlock",
            "ticket_close",
            "ticket_close_confirm",
            "ticket_close_cancel",
            "ticket_delete",
            "ticket_delete_confirm",
            "ticket_delete_cancel"
          ].includes(
            interaction.customId
          ) &&
          !ticket
        ) {

          return interaction.reply({

            content:
              "❌ بيانات التذكرة غير موجودة.",

            ephemeral: true

          });

        }

        // ==================================================
        // CLAIM
        // ==================================================

        if (
          interaction.customId ===
          "ticket_claim"
        ) {

          return await claimTicket(
            interaction,
            ticket,
            settings
          );

        }

        // ==================================================
        // UNCLAIM
        // ==================================================

        if (
          interaction.customId ===
          "ticket_unclaim"
        ) {

          return await unclaimTicket(
            interaction,
            ticket,
            settings
          );

        }

        // ==================================================
        // LOCK
        // ==================================================

        if (
          interaction.customId ===
          "ticket_lock"
        ) {

          return await lockTicket(
            interaction,
            ticket,
            settings,
            true
          );

        }

        // ==================================================
        // UNLOCK
        // ==================================================

        if (
          interaction.customId ===
          "ticket_unlock"
        ) {

          return await lockTicket(
            interaction,
            ticket,
            settings,
            false
          );

        }

        // ==================================================
        // CLOSE
        // ==================================================

        if (
          interaction.customId ===
          "ticket_close"
        ) {

          return await requestClose(
            interaction,
            ticket,
            settings
          );

        }

        // ==================================================
        // CLOSE CONFIRM
        // ==================================================

        if (
          interaction.customId ===
          "ticket_close_confirm"
        ) {

          await interaction.update({

            content:
              "🔴 جاري إغلاق التذكرة...",

            components: []

          });

          return await actuallyClose(
            interaction,
            ticket,
            settings
          );

        }

        // ==================================================
        // CLOSE CANCEL
        // ==================================================

        if (
          interaction.customId ===
          "ticket_close_cancel"
        ) {

          return await cancelClose(
            interaction
          );

        }

        // ==================================================
        // DELETE
        // ==================================================

        if (
          interaction.customId ===
          "ticket_delete"
        ) {

          return await confirmDelete(
            interaction,
            ticket,
            settings
          );

        }

        // ==================================================
        // DELETE CONFIRM
        // ==================================================

        if (
          interaction.customId ===
          "ticket_delete_confirm"
        ) {

          return await deleteTicket(
            interaction,
            ticket,
            settings
          );

        }

        // ==================================================
        // DELETE CANCEL
        // ==================================================

        if (
          interaction.customId ===
          "ticket_delete_cancel"
        ) {

          return await cancelDelete(
            interaction
          );

        }

      }

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (
        interaction.isChatInputCommand()
      ) {

        const command =
          interaction.commandName;

        const settings =
          getGuild(
            interaction.guild.id
          );


        // ==================================================
        // MODERATION SLASH COMMANDS
        // ==================================================

        if (["warn", "timeout", "jail", "ban", "kick", "unban"].includes(command)) {
          if (
            staffLevel(interaction.member, settings) < 1 &&
            !isServerManager(interaction.member) &&
            interaction.guild.ownerId !== interaction.user.id
          ) {
            return interaction.reply({ content: "❌ ليس لديك صلاحية استخدام هذا الأمر.", ephemeral: true });
          }

          if (command === "unban") {
            const result = await executeUnban({
              guild: interaction.guild,
              settings,
              actor: interaction.member,
              userId: interaction.options.getString("user_id"),
              reason: interaction.options.getString("reason")
            });
            return interaction.reply({ content: result, ephemeral: true });
          }

          const user = interaction.options.getUser("member");
          const target = await interaction.guild.members.fetch(user.id).catch(() => null);
          if (!target) {
            return interaction.reply({ content: "❌ تعذر جلب العضو من السيرفر.", ephemeral: true });
          }

          const reason = interaction.options.getString("reason") || "بدون سبب";
          const durationText = interaction.options.getString("duration");
          const duration = durationText ? parseDuration(durationText) : null;

          if (durationText && !duration) {
            return interaction.reply({
              content: "❌ مدة غير صحيحة. أمثلة: `10m`، `2h`، `7d`.",
              ephemeral: true
            });
          }

          let result;
          if (command === "warn") {
            result = await executeWarn({ guild: interaction.guild, settings, actor: interaction.member, target, reason, duration });
          } else if (command === "timeout") {
            result = await executeTimeout({ guild: interaction.guild, settings, actor: interaction.member, target, reason, duration });
          } else if (command === "jail") {
            result = await executeJail({ guild: interaction.guild, settings, actor: interaction.member, target, reason, duration });
          } else if (command === "ban") {
            result = await executeBan({ guild: interaction.guild, settings, actor: interaction.member, target, reason });
          } else {
            result = await executeKick({ guild: interaction.guild, settings, actor: interaction.member, target, reason });
          }

          return interaction.reply({ content: result, ephemeral: false });
        }

        // ==================================================
        // SETUP COMMANDS
        // ==================================================

        if ([
          "setup-ticket-category",
          "setup-logs",
          "setup-archive",
          "setup-application",
          "setup-jail-role",
          "staff-role",
          "rating-required",
          "max-tickets"
        ].includes(command)) {

          const manager =
            isServerManager(interaction.member) ||
            staffLevel(interaction.member, settings) >= 3 ||
            interaction.guild.ownerId === interaction.user.id;

          if (!manager) {
            return interaction.reply({
              content: "❌ هذا الأمر للإدارة العليا أو مالك السيرفر فقط.",
              ephemeral: true
            });
          }

          if (command === "setup-ticket-category") {
            const category = interaction.options.getChannel("category");
            if (category.type !== ChannelType.GuildCategory) {
              return interaction.reply({ content: "❌ يجب اختيار Category.", ephemeral: true });
            }
            settings.category = category.id;
          }

          if (command === "setup-logs") {
            const channel = interaction.options.getChannel("channel");
            settings.logsChannel = channel.id;
          }

          if (command === "setup-archive") {
            const channel = interaction.options.getChannel("channel");
            settings.archiveChannel = channel.id;
          }

          if (command === "setup-application") {
            const channel = interaction.options.getChannel("channel");
            settings.applicationChannel = channel.id;
          }

          if (command === "setup-jail-role") {
            const role = interaction.options.getRole("role");
            if (role.id === interaction.guild.id) {
              return interaction.reply({ content: "❌ لا يمكن اختيار @everyone.", ephemeral: true });
            }
            settings.jailRole = role.id;
          }

          if (command === "staff-role") {
            const level = interaction.options.getString("level");
            const role = interaction.options.getRole("role");
            settings[`${level}Role`] = role.id;
          }

          if (command === "rating-required") {
            settings.requireRating = interaction.options.getBoolean("enabled");
          }

          if (command === "max-tickets") {
            settings.maxTickets = interaction.options.getInteger("amount");
          }

          saveDB();

          return interaction.reply({
            content: "✅ تم حفظ الإعداد بنجاح.",
            ephemeral: true
          });
        }

        // ==================================================
        // /PANEL
        // ==================================================

        if (
          command ===
          "panel"
        ) {

          if (
            !isServerManager(interaction.member) &&
            staffLevel(interaction.member, settings) < 3 &&
            interaction.guild.ownerId !== interaction.user.id
          ) {
            return interaction.reply({
              content: "❌ هذا الأمر للإدارة العليا أو إدارة السيرفر فقط.",
              ephemeral: true
            });
          }

          const channel =
            interaction.options.getChannel("channel") ||
            interaction.channel;

          if (channel.type !== ChannelType.GuildText) {
            return interaction.reply({
              content: "❌ اختر روم نصي.",
              ephemeral: true
            });
          }

          const panelMessage = await channel.send({
            embeds: [panelEmbed(settings)],
            components: [panelRow(settings)]
          });

          settings.panelChannel = channel.id;
          settings.panelMessage = panelMessage.id;
          saveDB();

          return interaction.reply({
            content: `✅ تم إنشاء لوحة التذاكر في ${channel}.\n🆔 Message ID: \`${panelMessage.id}\``,
            ephemeral: true
          });
        }

        // ==================================================
        // /STATS
        // ==================================================

        if (
          command ===
          "stats"
        ) {

          const member =
            interaction.options.getMember(
              "member"
            ) ||
            interaction.member;

          const stats =
            settings.staff[
              member.id
            ] || {

              claimed: 0,
              closed: 0,
              ratings: 0,
              ratingSum: 0

            };

          const average =
            stats.ratings
              ? (
                  stats.ratingSum /
                  stats.ratings
                ).toFixed(2)
              : "لا يوجد";

          return interaction.reply({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  "📊 إحصائيات الموظف"
                )

                .setColor(
                  "#5865F2"
                )

                .setDescription(
                  `${member}`
                )

                .addFields(

                  {
                    name:
                      "🙋 التذاكر المستلمة",

                    value:
                      String(
                        stats.claimed || 0
                      ),

                    inline: true
                  },

                  {
                    name:
                      "🔴 التذاكر المغلقة",

                    value:
                      String(
                        stats.closed || 0
                      ),

                    inline: true
                  },

                  {
                    name:
                      "⭐ عدد التقييمات",

                    value:
                      String(
                        stats.ratings || 0
                      ),

                    inline: true
                  },

                  {
                    name:
                      "⭐ المتوسط",

                    value:
                      average,

                    inline: true
                  }

                )

                .setTimestamp()

            ],

            ephemeral: true

          });

        }

      }

    } catch (error) {

      console.error(
        "❌ Interaction Error:",
        error
      );

      try {

        if (
          interaction.replied ||
          interaction.deferred
        ) {

          await interaction.followUp({

            content:
              "❌ حدث خطأ أثناء تنفيذ الأمر.",

            ephemeral: true

          });

        } else {

          await interaction.reply({

            content:
              "❌ حدث خطأ أثناء تنفيذ الأمر.",

            ephemeral: true

          });

        }

      } catch {}

    }

  }
);

// ==================================================
// PREFIX COMMANDS
// ==================================================

client.on(
  "messageCreate",
  async message => {

    try {

      // --------------------------------------------------
      // تجاهل البوتات والـDM
      // --------------------------------------------------

      if (
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const content =
        message.content.trim();

      if (!content) {
        return;
      }

      const settings =
        getGuild(
          message.guild.id
        );


      // ==================================================
      // MODERATION PREFIX COMMANDS
      // ==================================================

      const moderationAliases = [
        "ت", "$ت", "تحذير", "$تحذير", "warn", "$warn",
        "تايم", "$تايم", "timeout", "$timeout",
        "سجن", "$سجن", "jail", "$jail",
        "تف", "$تف", "ban", "$ban",
        "طرد", "$طرد", "kick", "$kick",
        "رجع", "$رجع", "unban", "$unban",
        "$وقتي", "وقتي"
      ];

      const firstWord = content.split(/\s+/)[0].toLowerCase();

      if (moderationAliases.includes(firstWord)) {
        if (
          staffLevel(message.member, settings) < 1 &&
          !isServerManager(message.member) &&
          message.guild.ownerId !== message.author.id &&
          !["$وقتي", "وقتي"].includes(firstWord)
        ) {
          return message.reply("❌ ليس لديك صلاحية استخدام هذا الأمر.");
        }

        // $وقتي / وقتي
        if (firstWord === "$وقتي" || firstWord === "وقتي") {
          const jail = db.jails[warningKey(message.guild.id, message.author.id)];
          if (!jail) {
            return message.reply("ℹ️ أنت غير مسجون حاليًا.");
          }

          const remaining = jail.expiresAt
            ? Math.max(0, jail.expiresAt - Date.now())
            : null;

          return message.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle("🔒 معلومات السجن")
                .setColor("#ED4245")
                .addFields(
                  { name: "السبب", value: safeText(jail.reason || "بدون سبب"), inline: false },
                  { name: "المدة المتبقية", value: remaining ? formatDuration(remaining) : "دائم", inline: true },
                  { name: "وقت الانتهاء", value: jail.expiresAt ? `<t:${Math.floor(jail.expiresAt / 1000)}:R>` : "دائم", inline: true }
                )
                .setTimestamp()
            ]
          });
        }

        const rawNames = {
          warn: ["ت", "$ت", "تحذير", "$تحذير", "warn", "$warn"],
          timeout: ["تايم", "$تايم", "timeout", "$timeout"],
          jail: ["سجن", "$سجن", "jail", "$jail"],
          ban: ["تف", "$تف", "ban", "$ban"],
          kick: ["طرد", "$طرد", "kick", "$kick"],
          unban: ["رجع", "$رجع", "unban", "$unban"]
        };

        const matched = Object.entries(rawNames).find(([, names]) => names.includes(firstWord));
        if (!matched) return;

        const type = matched[0];

        if (type === "unban") {
          const rest = content.split(/\s+/).slice(1);
          const userId = rest.shift();
          const reason = rest.join(" ").trim() || "بدون سبب";
          const result = await executeUnban({
            guild: message.guild,
            settings,
            actor: message.member,
            userId,
            reason
          });
          return message.reply(result);
        }

        const extracted = extractTargetAndArgs(content, rawNames[type]);
        const target = await resolveMember(message.guild, extracted.targetToken);

        if (!target) {
          return message.reply(`❌ لم أجد العضو.\\nالاستخدام: \`${firstWord} @العضو السبب المدة\``);
        }

        let duration = null;
        let reason = extracted.rest;

        if (type === "warn" || type === "timeout" || type === "jail") {
          const last = extracted.args[extracted.args.length - 1];
          const parsed = parseDuration(last);
          if (parsed) {
            duration = parsed;
            reason = extracted.args.slice(0, -1).join(" ").trim();
          }
        }

        if (!reason) reason = "بدون سبب";

        let result;
        if (type === "warn") {
          result = await executeWarn({ guild: message.guild, settings, actor: message.member, target, reason, duration });
        } else if (type === "timeout") {
          if (!duration) return message.reply("❌ لازم تحدد مدة. مثال: `تايم @العضو سبام 10m`");
          result = await executeTimeout({ guild: message.guild, settings, actor: message.member, target, reason, duration });
        } else if (type === "jail") {
          result = await executeJail({ guild: message.guild, settings, actor: message.member, target, reason, duration });
        } else if (type === "ban") {
          result = await executeBan({ guild: message.guild, settings, actor: message.member, target, reason });
        } else {
          result = await executeKick({ guild: message.guild, settings, actor: message.member, target, reason });
        }

        return message.reply(result);
      }

      // ==================================================
      // STAFF / SETUP PREFIX COMMANDS
      // ==================================================

      if (firstWord === "$staffrole" || firstWord === "staffrole") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) {
          return message.reply("❌ هذا الأمر للإدارة فقط.");
        }

        const args = content.split(/\s+/).slice(1);
        const level = String(args.shift() || "").toLowerCase();
        const role = await resolveRole(message.guild, args.shift());

        if (!["junior", "middle", "senior", "owner"].includes(level) || !role) {
          return message.reply("❌ الاستخدام: `$staffrole junior @role` أو `$staffrole senior ROLE_ID`");
        }

        settings[`${level}Role`] = role.id;
        saveDB();
        return message.reply(`✅ تم ربط رتبة ${level} بالـID \`${role.id}\`.`);
      }

      if (firstWord === "$setup-ticket-category" || firstWord === "setup-ticket-category") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const roleOrChannel = message.mentions.channels.first();
        const id = roleOrChannel?.id || content.split(/\s+/)[1];
        const channel = id ? message.guild.channels.cache.get(id) : null;
        if (!channel || channel.type !== ChannelType.GuildCategory) return message.reply("❌ منشن Category صحيحة أو اكتب ID الكاتيجوري.");
        settings.category = channel.id;
        saveDB();
        return message.reply(`✅ تم تحديد كاتيجوري التذاكر: ${channel}`);
      }

      if (firstWord === "$setup-logs" || firstWord === "setup-logs") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(content.split(/\s+/)[1]);
        if (!channel) return message.reply("❌ منشن روم اللوج أو اكتب ID.");
        settings.logsChannel = channel.id;
        saveDB();
        return message.reply(`✅ تم تحديد روم اللوج: ${channel}`);
      }

      if (firstWord === "$setup-archive" || firstWord === "setup-archive") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(content.split(/\s+/)[1]);
        if (!channel) return message.reply("❌ منشن روم الأرشيف أو اكتب ID.");
        settings.archiveChannel = channel.id;
        saveDB();
        return message.reply(`✅ تم تحديد روم الأرشيف: ${channel}`);
      }

      if (firstWord === "$setup-application" || firstWord === "setup-application") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const channel = message.mentions.channels.first() || message.guild.channels.cache.get(content.split(/\s+/)[1]);
        if (!channel) return message.reply("❌ منشن روم التقديم أو اكتب ID.");
        settings.applicationChannel = channel.id;
        saveDB();
        return message.reply(`✅ تم تحديد روم التقديم: ${channel}`);
      }

      if (firstWord === "$setup-jail-role" || firstWord === "setup-jail-role") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const role = message.mentions.roles.first() || message.guild.roles.cache.get(content.split(/\s+/)[1]);
        if (!role || role.id === message.guild.id) return message.reply("❌ منشن رتبة السجن أو اكتب ID صحيح.");
        settings.jailRole = role.id;
        saveDB();
        return message.reply(`✅ تم تحديد رتبة السجن: ${role} — ID: \`${role.id}\``);
      }

      if (firstWord === "$rating-required" || firstWord === "rating-required") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const value = content.split(/\s+/)[1]?.toLowerCase();
        if (!["on","off","تشغيل","ايقاف","إيقاف"].includes(value)) return message.reply("❌ الاستخدام: `$rating-required on` أو `off`");
        settings.requireRating = ["on","تشغيل"].includes(value);
        saveDB();
        return message.reply(`✅ التقييم الإجباري: ${settings.requireRating ? "مفعل" : "متوقف"}`);
      }

      if (firstWord === "$max-tickets" || firstWord === "max-tickets") {
        if (!isServerManager(message.member) && message.guild.ownerId !== message.author.id) return message.reply("❌ للإدارة فقط.");
        const amount = Number(content.split(/\s+/)[1]);
        if (!Number.isInteger(amount) || amount < 1 || amount > 10) return message.reply("❌ العدد من 1 إلى 10.");
        settings.maxTickets = amount;
        saveDB();
        return message.reply(`✅ الحد الأقصى للتذاكر: **${amount}**`);
      }

      // ==================================================
      // $DM
      // ==================================================

      if (
        content === "$dm" ||
        content.startsWith("$dm ")
      ) {

        // ----------------------------------------------
        // الصلاحية
        // ----------------------------------------------

        if (
          staffLevel(
            message.member,
            settings
          ) < 1 &&
          !isServerManager(
            message.member
          )
        ) {

          return message.reply(
            "❌ ليس لديك صلاحية استخدام هذا الأمر."
          );

        }

        const target =
          message.mentions.users.first();

        if (!target) {

          return message.reply(
            "❌ الاستخدام:\n`$dm @العضو الرسالة`"
          );

        }

        // ----------------------------------------------
        // إزالة الأمر والمنشن
        // ----------------------------------------------

        let text =
          content
            .replace(
              /^\$dm\s*/i,
              ""
            )
            .replace(
              `<@${target.id}>`,
              ""
            )
            .replace(
              `<@!${target.id}>`,
              ""
            )
            .trim();

        if (!text) {

          return message.reply(
            "❌ اكتب الرسالة بعد المنشن."
          );

        }

        // ----------------------------------------------
        // إرسال DM
        // ----------------------------------------------

        try {

          await target.send({

            content:
              `<@${target.id}>\n${text}`

          });

          await message.reply(
            `✅ تم إرسال الرسالة إلى ${target}.`
          );

        } catch {

          await message.reply(
            "❌ لا يمكن إرسال رسالة خاصة لهذا العضو."
          );

        }

        return;
      }

      // ==================================================
      // $DMS
      // ==================================================

      if (
        content === "$dms" ||
        content.startsWith("$dms ")
      ) {

        // ----------------------------------------------
        // Manager فقط
        // ----------------------------------------------

        if (
          !isServerManager(
            message.member
          )
        ) {

          return message.reply(
            "❌ هذا الأمر للإدارة فقط."
          );

        }

        let text =
          content
            .replace(
              /^\$dms\s*/i,
              ""
            )
            .trim();

        if (!text) {

          return message.reply(
            "❌ الاستخدام:\n`$dms الرسالة`"
          );

        }

        // ----------------------------------------------
        // جلب الأعضاء
        // ----------------------------------------------

        let members;

        try {

          members =
            await message.guild.members.fetch();

        } catch {

          return message.reply(
            "❌ تعذر جلب أعضاء السيرفر."
          );

        }

        // ----------------------------------------------
        // بداية الإرسال
        // ----------------------------------------------

        await message.reply(
          "📨 جاري إرسال الرسالة للأعضاء..."
        );

        let sent = 0;
        let failed = 0;

        for (
          const member of members.values()
        ) {

          // تجاهل البوتات
          if (
            member.user.bot
          ) {
            continue;
          }

          try {

            await member.send({

              content:
                `<@${member.id}>\n${text}`

            });

            sent++;

          } catch {

            failed++;

          }

          // --------------------------------------------
          // تأخير بسيط لتقليل Rate Limit
          // --------------------------------------------

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                250
              )
          );

        }

        return message.channel.send({

          embeds: [

            new EmbedBuilder()

              .setTitle(
                "📨 تم الانتهاء"
              )

              .setColor(
                "#57F287"
              )

              .addFields(

                {
                  name:
                    "✅ تم الإرسال",

                  value:
                    String(sent),

                  inline: true
                },

                {
                  name:
                    "❌ فشل الإرسال",

                  value:
                    String(failed),

                  inline: true
                }

              )

              .setTimestamp()

          ]

        });

      }

      // ==================================================
      // $COME
      // ==================================================

      if (
        content === "$come" ||
        content.startsWith("$come ")
      ) {

        // ----------------------------------------------
        // الصلاحية
        // ----------------------------------------------

        if (
          staffLevel(
            message.member,
            settings
          ) < 1 &&
          !isServerManager(
            message.member
          )
        ) {

          return message.reply(
            "❌ ليس لديك صلاحية استخدام هذا الأمر."
          );

        }

        // ----------------------------------------------
        // Target
        // ----------------------------------------------

        const target =
          message.mentions.users.first();

        if (!target) {

          return message.reply(
            "❌ الاستخدام:\n`$come @العضو الرسالة`"
          );

        }

        // ----------------------------------------------
        // الرسالة الإضافية
        // ----------------------------------------------

        let customMessage =
          content
            .replace(
              /^\$come\s*/i,
              ""
            )
            .replace(
              `<@${target.id}>`,
              ""
            )
            .replace(
              `<@!${target.id}>`,
              ""
            )
            .trim();

        // ----------------------------------------------
        // مكان الأمر
        // ----------------------------------------------

        const channel =
          message.channel;

        // ----------------------------------------------
        // هل هو Ticket؟
        // ----------------------------------------------

        const ticket =
          db.tickets[
            channel.id
          ];

        const isTicket =
          Boolean(
            ticket &&
            ticket.guildId ===
              message.guild.id
          );

        const placeName =
          isTicket
            ? "التذكرة"
            : "الشات";

        // ----------------------------------------------
        // رابط مباشر للروم
        // ----------------------------------------------

        const channelUrl =
          `https://discord.com/channels/` +
          `${message.guild.id}/` +
          `${channel.id}`;

        // ----------------------------------------------
        // Embed
        // ----------------------------------------------

        const comeEmbed =
          new EmbedBuilder()

            .setTitle(
              "📢 تم استدعاؤك"
            )

            .setDescription(

              `أهلًا <@${target.id}> 👋\n\n` +

              `تم استدعاؤك إلى **${placeName}** في سيرفر **${message.guild.name}**.\n\n` +

              (
                customMessage
                  ? `💬 **الرسالة:**\n${customMessage}\n\n`
                  : ""
              ) +

              `اضغط الزر بالأسفل للانتقال مباشرة إلى ${placeName}.`

            )

            .setColor(
              "#5865F2"
            )

            .addFields(

              {
                name:
                  "📍 المكان",

                value:
                  `${channel}`,

                inline: true
              },

              {
                name:
                  "👤 بواسطة",

                value:
                  `${message.author}`,

                inline: true
              }

            )

            .setTimestamp();

                // ----------------------------------------------
        // زر الانتقال
        // ----------------------------------------------

        const row =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()

                .setLabel(
                  `الانتقال إلى ${placeName}`
                )

                .setEmoji(
                  isTicket
                    ? "🎫"
                    : "💬"
                )

                .setStyle(
                  ButtonStyle.Link
                )

                .setURL(
                  channelUrl
                )

            );

        // ----------------------------------------------
        // إرسال DM
        // ----------------------------------------------

        try {

          await target.send({

            content:
              `<@${target.id}>`,

            embeds: [
              comeEmbed
            ],

            components: [
              row
            ]

          });

          await message.reply(
            `✅ تم استدعاء ${target} وإرسال رابط ${placeName} في الخاص.`
          );

        } catch {

          await message.reply(
            "❌ لا يمكن إرسال رسالة خاصة لهذا العضو."
          );

        }

        return;
      }

// ==================================================
// ALIASES
// ==================================================

const aliases = {

  "$قفل":
    "lock",

  "$lock":
    "lock",

  "$فتح":
    "unlock",

  "$unlock":
    "unlock",

  "$close":
    "close",

  "$اغلاق":
    "close",

  "$حذف":
    "delete",

  "$مسح":
    "delete",

  "$delete":
    "delete"

};

const command =
  aliases[content];

if (!command) {
  return;
}

// ==================================================
// TICKET
// ==================================================

const ticket =
  db.tickets[
    message.channel.id
  ];

if (!ticket) {

  return message.reply(
    "❌ هذا الأمر يعمل داخل التذكرة فقط."
  );

}

// ==================================================
// FAKE INTERACTION
// ==================================================

const fakeInteraction = {

  guild:
    message.guild,

  channel:
    message.channel,

  member:
    message.member,

  user:
    message.author,

  replied:
    false,

  deferred:
    false,

  reply:
    async data => {

      if (
        typeof data ===
        "string"
      ) {

        return message.reply(
          data
        );

      }

      return message.reply(
        data.content || ""
      );

    },

  update:
    async data => {

      return message.reply(
        data.content || ""
      );

    }

};

// ==================================================
// LOCK
// ==================================================

if (
  command ===
  "lock"
) {

  return await lockTicket(
    fakeInteraction,
    ticket,
    settings,
    true
  );

}

// ==================================================
// UNLOCK
// ==================================================

if (
  command ===
  "unlock"
) {

  return await lockTicket(
    fakeInteraction,
    ticket,
    settings,
    false
  );

}

// ==================================================
// CLOSE
// ==================================================

if (
  command ===
  "close"
) {

  return await actuallyClose(
    fakeInteraction,
    ticket,
    settings
  );

}

// ==================================================
// DELETE
// ==================================================

if (
  command ===
  "delete"
) {

  return await deleteTicket(
    fakeInteraction,
    ticket,
    settings
  );

}

} catch (error) {

  console.error(
    "❌ Message Error:",
    error
  );

}

});


// ==================================================
// SLASH COMMAND REGISTRATION
// ==================================================

function buildSlashCommands() {
  return [
    new SlashCommandBuilder()
      .setName("panel")
      .setDescription("إرسال لوحة التذاكر")
      .addChannelOption(o =>
        o.setName("channel")
          .setDescription("الروم الذي سترسل فيه اللوحة")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("stats")
      .setDescription("عرض إحصائيات موظف")
      .addUserOption(o =>
        o.setName("member")
          .setDescription("الموظف")
          .setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("warn")
      .setDescription("تحذير عضو")
      .addUserOption(o =>
        o.setName("member").setDescription("العضو").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("السبب").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("duration").setDescription("المدة مثل 1h أو 7d").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("timeout")
      .setDescription("إعطاء Timeout لعضو")
      .addUserOption(o =>
        o.setName("member").setDescription("العضو").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("السبب").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("duration").setDescription("المدة مثل 10m أو 1h").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("jail")
      .setDescription("سجن عضو")
      .addUserOption(o =>
        o.setName("member").setDescription("العضو").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("السبب").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("duration").setDescription("المدة مثل 1h أو 1d").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("ban")
      .setDescription("حظر عضو")
      .addUserOption(o =>
        o.setName("member").setDescription("العضو").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("السبب").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("kick")
      .setDescription("طرد عضو")
      .addUserOption(o =>
        o.setName("member").setDescription("العضو").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("السبب").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("unban")
      .setDescription("فك حظر عضو بواسطة ID")
      .addStringOption(o =>
        o.setName("user_id").setDescription("Discord User ID").setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason").setDescription("السبب").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("setup-ticket-category")
      .setDescription("تحديد كاتيجوري التذاكر")
      .addChannelOption(o =>
        o.setName("category")
          .setDescription("كاتيجوري التذاكر")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("setup-logs")
      .setDescription("تحديد روم اللوج")
      .addChannelOption(o =>
        o.setName("channel")
          .setDescription("روم اللوج")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("setup-archive")
      .setDescription("تحديد روم أرشيف التذاكر")
      .addChannelOption(o =>
        o.setName("channel")
          .setDescription("روم الأرشيف")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("setup-application")
      .setDescription("تحديد روم التقديم")
      .addChannelOption(o =>
        o.setName("channel")
          .setDescription("روم التقديم")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("setup-jail-role")
      .setDescription("تحديد رتبة السجن")
      .addRoleOption(o =>
        o.setName("role")
          .setDescription("رتبة السجن")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("staff-role")
      .setDescription("ربط رتبة الاستف بمستوى")
      .addStringOption(o =>
        o.setName("level")
          .setDescription("مستوى الاستف")
          .setRequired(true)
          .addChoices(
            { name: "Junior / الصغرى", value: "junior" },
            { name: "Middle / الوسطى", value: "middle" },
            { name: "Senior / العليا", value: "senior" },
            { name: "Owner / الأونر", value: "owner" }
          )
      )
      .addRoleOption(o =>
        o.setName("role")
          .setDescription("الرتبة")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("rating-required")
      .setDescription("تشغيل أو إيقاف إلزام التقييم قبل حذف التذكرة")
      .addBooleanOption(o =>
        o.setName("enabled").setDescription("تشغيل").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("max-tickets")
      .setDescription("تحديد أقصى عدد تذاكر مفتوحة للعضو")
      .addIntegerOption(o =>
        o.setName("amount")
          .setDescription("العدد")
          .setMinValue(1)
          .setMaxValue(10)
          .setRequired(true)
      )
  ].map(c => c.toJSON());
}

// ==================================================
// READY
// ==================================================

client.once(
  "ready",
  async () => {

    console.log(
      "=========================================="
    );

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🆔 Bot ID: ${client.user.id}`
    );

    console.log(
      `🌐 Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "=========================================="
    );

    client.user.setActivity(
      "KRX Tickets",
      {
        type: 3
      }
    );

    try {
      await client.application.commands.set(
        buildSlashCommands()
      );
      console.log("✅ Slash commands registered.");
    } catch (error) {
      console.error("❌ Slash registration error:", error);
    }

    await restoreJails();
  }
);

// ==================================================
// LOGIN
// ==================================================

client.login(
  TOKEN
);
                
