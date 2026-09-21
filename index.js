// ==================================================
// PROFESSIONAL TICKET BOT
// index.js
// ==================================================

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

// ==================================================
// CLIENT
// ==================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

// ==================================================
// ENV
// ==================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID environment variable.");
  process.exit(1);
}

// ==================================================
// FILES
// ==================================================

const DATA_FILE = path.join(__dirname, "data.json");

const TRANSCRIPT_DIR = path.join(__dirname, "transcripts");

if (!fs.existsSync(TRANSCRIPT_DIR)) {
  fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });
}

// ==================================================
// DEFAULT PANEL
// ==================================================

const DEFAULT_PANEL = {
  title: "🎫 الدعم الفني",
  description:
    "اضغط على الزر بالأسفل لفتح تذكرة والتواصل مع فريق الدعم.",
  buttonText: "فتح تذكرة",
  emoji: "🎫",
  color: "#5865F2",
  footer: "نظام التذاكر",
  thumbnail: "",
  image: ""
};

// ==================================================
// DEFAULT SETTINGS
// ==================================================

const DEFAULTS = {
  juniorRole: null,
  middleRole: null,
  seniorRole: null,
  ownerRole: null,

  ticketCategory: null,

  logsChannel: null,
  archiveChannel: null,
  applicationChannel: null,

  panelChannel: null,
  panelMessage: null,

  mentionRole: null,

  maxOpenTickets: 1,

  autoCloseMinutes: 0,

  requireRating: true,

  panel: DEFAULT_PANEL,

  application: {
    title: "📋 التقديم",
    description: "اضغط على الزر بالأسفل لفتح نموذج التقديم.",
    buttonText: "📝 تقديم",
    emoji: "📝"
  },

  staff: {}
};

// ==================================================
// DATABASE
// ==================================================

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      const initialData = {
        guilds: {},
        tickets: {},
        applications: {}
      };

      fs.writeFileSync(
        DATA_FILE,
        JSON.stringify(initialData, null, 2),
        "utf8"
      );
    }

    const data = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    data.guilds ||= {};
    data.tickets ||= {};
    data.applications ||= {};

    return data;
  } catch (error) {
    console.error("❌ Database load error:", error);

    return {
      guilds: {},
      tickets: {},
      applications: {}
    };
  }
}

let db = loadDB();

// ==================================================
// SAVE DATABASE
// ==================================================

function saveDB() {
  try {
    const tmp = DATA_FILE + ".tmp";

    fs.writeFileSync(
      tmp,
      JSON.stringify(db, null, 2),
      "utf8"
    );

    fs.renameSync(tmp, DATA_FILE);
  } catch (error) {
    console.error("❌ Database save error:", error);
  }
}

// ==================================================
// GET GUILD SETTINGS
// ==================================================

function getGuild(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = JSON.parse(
      JSON.stringify(DEFAULTS)
    );

    saveDB();
  }

  const guild = db.guilds[guildId];

  guild.panel ||= JSON.parse(
    JSON.stringify(DEFAULT_PANEL)
  );

  guild.application ||= {
    title: "📋 التقديم",
    description:
      "اضغط على الزر بالأسفل لفتح نموذج التقديم.",
    buttonText: "📝 تقديم",
    emoji: "📝"
  };

  guild.staff ||= {};

  guild.maxOpenTickets ||= 1;

  if (typeof guild.requireRating !== "boolean") {
    guild.requireRating = true;
  }

  return guild;
}

// ==================================================
// PERMISSIONS
// ==================================================

function isServerManager(member) {
  if (!member) return false;

  return (
    member.permissions.has(
      PermissionsBitField.Flags.ManageGuild
    ) ||
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

// ==================================================
// STAFF LEVEL
// ==================================================

function staffLevel(member, settings) {
  if (!member) return 0;

  if (
    settings.ownerRole &&
    member.roles.cache.has(settings.ownerRole)
  ) {
    return 4;
  }

  if (
    settings.seniorRole &&
    member.roles.cache.has(settings.seniorRole)
  ) {
    return 3;
  }

  if (
    settings.middleRole &&
    member.roles.cache.has(settings.middleRole)
  ) {
    return 2;
  }

  if (
    settings.juniorRole &&
    member.roles.cache.has(settings.juniorRole)
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
// TICKET PERMISSIONS
// ==================================================

function canManageTicket(member, ticket, settings) {
  const level = staffLevel(member, settings);

  if (level < 1) {
    return false;
  }

  if (!ticket.claimedBy) {
    return true;
  }

  if (ticket.claimedBy === member.id) {
    return true;
  }

  return level >= 2;
}

// ==================================================
// CAN CLAIM
// ==================================================

function canClaim(member, settings) {
  return staffLevel(member, settings) >= 1;
}

// ==================================================
// OPEN TICKETS
// ==================================================

function getOpenTicketsForUser(guildId, userId) {
  return Object.values(db.tickets).filter(
    ticket =>
      ticket.guildId === guildId &&
      ticket.userId === userId &&
      [
        "open",
        "locked",
        "closed_waiting_rating"
      ].includes(ticket.status)
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
  const settings = getGuild(guildId);

  settings.staff[userId] ||= {
    claimed: 0,
    closed: 0,
    ratings: 0,
    ratingSum: 0
  };

  settings.staff[userId][key] =
    (settings.staff[userId][key] || 0) + amount;

  saveDB();
}

// ==================================================
// AVERAGE RATING
// ==================================================

function averageRating(guildId, userId) {
  const settings = getGuild(guildId);

  const staff = settings.staff[userId];

  if (!staff || !staff.ratings) {
    return "لا يوجد";
  }

  return (
    staff.ratingSum / staff.ratings
  ).toFixed(2);
}

// ==================================================
// STARS
// ==================================================

function stars(number) {
  return "⭐".repeat(
    Math.max(
      0,
      Math.min(5, Number(number) || 0)
    )
  );
}

// ==================================================
// SAFE TEXT
// ==================================================

function safeText(
  value,
  fallback = ""
) {
  if (!value) {
    return fallback;
  }

  return String(value).slice(0, 1024);
}

// ==================================================
// PANEL EMBED
// ==================================================

function panelEmbed(settings) {
  const panel = settings.panel || DEFAULT_PANEL;

  const embed = new EmbedBuilder()
    .setTitle(
      panel.title || DEFAULT_PANEL.title
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
    embed.setThumbnail(panel.thumbnail);
  }

  if (panel.image) {
    embed.setImage(panel.image);
  }

  return embed;
}

// ==================================================
// PANEL BUTTON
// ==================================================

function panelRow(settings) {
  const panel = settings.panel || DEFAULT_PANEL;

  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open")
      .setLabel(
        panel.buttonText || "فتح تذكرة"
      )
      .setEmoji(
        panel.emoji || "🎫"
      )
      .setStyle(ButtonStyle.Primary)
  );
}

// ==================================================
// TICKET BUTTONS
// ==================================================

function ticketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel("استلام")
      .setEmoji("📥")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("ticket_unclaim")
      .setLabel("إلغاء الاستلام")
      .setEmoji("↩️")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_lock")
      .setLabel("قفل")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("إغلاق")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger)
  );
}

// ==================================================
// TICKET EMBED
// ==================================================

function ticketEmbed(
  ticket,
  settings
) {
  const claim = ticket.claimedBy
    ? `<@${ticket.claimedBy}>`
    : "غير مستلمة";

  let status = "🟢 مفتوحة";

  if (
    ticket.status === "locked"
  ) {
    status = "🔒 مقفلة";
  }

  if (
    ticket.status ===
    "closed_waiting_rating"
  ) {
    status = "⭐ بانتظار التقييم";
  }

  return new EmbedBuilder()
    .setTitle("🎫 تذكرة دعم")
    .setDescription(
      `👤 صاحب التذكرة: <@${ticket.userId}>\n` +
      `📥 المستلم: ${claim}\n` +
      `📌 الحالة: ${status}`
    )
    .setColor(
      ticket.status === "locked"
        ? "#ED4245"
        : "#5865F2"
    )
    .setFooter({
      text:
        settings.panel.footer ||
        "نظام التذاكر"
    });
}

// ==================================================
// SEND LOG
// ==================================================

async function sendLog(
  guild,
  settings,
  embed
) {
  if (!settings.logsChannel) {
    return;
  }

  const channel =
    guild.channels.cache.get(
      settings.logsChannel
    );

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return;
  }

  try {
    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error(
      "❌ Log send error:",
      error.message
    );
  }
}

// ==================================================
// BUILD TRANSCRIPT
// ==================================================

async function buildTranscript(channel) {
  const allMessages = [];

  let lastId = null;

  while (true) {
    const options = {
      limit: 100
    };

    if (lastId) {
      options.before = lastId;
    }

    const batch =
      await channel.messages
        .fetch(options)
        .catch(() => null);

    if (
      !batch ||
      batch.size === 0
    ) {
      break;
    }

    allMessages.push(
      ...batch.values()
    );

    lastId = batch.last().id;

    if (batch.size < 100) {
      break;
    }
  }

  allMessages.reverse();

  const lines = [];

  lines.push(
    `Transcript: ${channel.name}`
  );

  lines.push(
    `Channel ID: ${channel.id}`
  );

  lines.push(
    `Generated: ${new Date().toISOString()}`
  );

  lines.push(
    "=".repeat(70)
  );

  for (const message of allMessages) {
    if (
      message.author?.bot &&
      !message.content &&
      !message.embeds?.length
    ) {
      continue;
    }

    const content =
      message.content || "";

    const embeds =
      message.embeds?.length
        ? ` [embeds: ${message.embeds.length}]`
        : "";

    const attachments =
      message.attachments?.size
        ? ` [attachments: ${[
            ...message.attachments.values()
          ]
            .map(
              attachment =>
                attachment.url
            )
            .join(", ")}]`
        : "";

    lines.push(
      `[${new Date(
        message.createdTimestamp
      ).toISOString()}] ` +
      `${message.author?.tag || "Unknown"}: ` +
      `${content}${embeds}${attachments}`
    );
  }

  const file = path.join(
    TRANSCRIPT_DIR,
    `${channel.id}-${Date.now()}.txt`
  );

  fs.writeFileSync(
    file,
    lines.join("\n"),
    "utf8"
  );

  return file;
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
  let transcriptPath = null;

  try {
    transcriptPath =
      await buildTranscript(channel);
  } catch (error) {
    console.error(
      "❌ Transcript error:",
      error
    );
  }

  const archive =
    settings.archiveChannel
      ? guild.channels.cache.get(
          settings.archiveChannel
        )
      : null;

  if (
    archive &&
    archive.isTextBased()
  ) {
    const embed =
      new EmbedBuilder()
        .setTitle(
          "🗃️ Ticket Archive"
        )
        .setDescription(
          `👤 صاحب التذكرة: <@${ticket.userId}>\n` +
          `📥 المستلم: ${
            ticket.claimedBy
              ? `<@${ticket.claimedBy}>`
              : "غير مستلمة"
          }\n` +
          `⭐ التقييم: ${
            ticket.rating
              ? `${stars(ticket.rating)} (${ticket.rating}/5)`
              : "لم يتم التقييم"
          }`
        )
        .setTimestamp();

    try {
      await archive.send({
        embeds: [embed],
        files: transcriptPath
          ? [transcriptPath]
          : []
      });
    } catch (error) {
      console.error(
        "❌ Archive send error:",
        error
      );
    }
  }

  if (transcriptPath) {
    setTimeout(() => {
      try {
        fs.unlinkSync(
          transcriptPath
        );
      } catch {}
    }, 60_000);
  }
}

// ==================================================
// SET TICKET PERMISSIONS
// ==================================================

async function setTicketPermissions(
  channel,
  ticket,
  settings
) {
  const guild = channel.guild;

  const overwrites = [
    {
      id: guild.roles.everyone.id,

      deny: [
        PermissionsBitField.Flags.ViewChannel
      ]
    },

    {
      id: ticket.userId,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles
      ]
    }
  ];

  const staffRoles = [
    settings.juniorRole,
    settings.middleRole,
    settings.seniorRole,
    settings.ownerRole
  ].filter(Boolean);

  for (const roleId of staffRoles) {
    overwrites.push({
      id: roleId,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory
      ],

      deny: [
        PermissionsBitField.Flags.SendMessages
      ]
    });
  }

  // ==================================================
  // UNCLAIMED
  // ==================================================

  if (
    !ticket.claimedBy &&
    settings.juniorRole
  ) {
    overwrites.push({
      id: settings.juniorRole,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  // ==================================================
  // CLAIMED
  // ==================================================

  if (ticket.claimedBy) {
    overwrites.push({
      id: ticket.claimedBy,

      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles
      ]
    });
  }

  // ==================================================
  // LOCKED
  // ==================================================

  if (
    ticket.locked ||
    ticket.status ===
      "closed_waiting_rating"
  ) {
    const ownerOverwrite =
      overwrites.find(
        overwrite =>
          overwrite.id ===
          ticket.userId
      );

    if (ownerOverwrite) {
      ownerOverwrite.deny = [
        PermissionsBitField.Flags.SendMessages
      ];
    }
  }

  await channel.permissionOverwrites.set(
    overwrites
  );
}

// ==================================================
// CREATE TICKET
// ==================================================

async function createTicket(
  interaction,
  settings
) {
  if (!settings.ticketCategory) {
    return interaction.reply({
      content:
        "❌ لم يتم تحديد Category التذاكر. استخدم `/setup category` أولًا.",
      ephemeral: true
    });
  }

  if (!settings.juniorRole) {
    return interaction.reply({
      content:
        "❌ لم يتم تحديد رتبة الاستف الصغرى. استخدم `/setup junior` أولًا.",
      ephemeral: true
    });
  }

  const openTickets =
    getOpenTicketsForUser(
      interaction.guild.id,
      interaction.user.id
    );

  if (
    openTickets.length >=
    Number(
      settings.maxOpenTickets || 1
    )
  ) {
    return interaction.reply({
      content:
        `❌ لديك بالفعل ${openTickets.length} تذكرة مفتوحة.`,
      ephemeral: true
    });
  }

  const category =
    interaction.guild.channels.cache.get(
      settings.ticketCategory
    );

  if (
    !category ||
    category.type !==
      ChannelType.GuildCategory
  ) {
    return interaction.reply({
      content:
        "❌ Category التذاكر غير موجودة أو غير صالحة.",
      ephemeral: true
    });
  }

  const safeUsername =
    interaction.user.username
      .toLowerCase()
      .replace(/[^a-z0-9-_]/g, "")
      .slice(0, 18) || "user";

  const name =
    `ticket-${safeUsername}-${Math.floor(
      Math.random() * 9999
    )}`;

  const ticket = {
    id: null,

    guildId:
      interaction.guild.id,

    userId:
      interaction.user.id,

    claimedBy: null,

    status: "open",

    locked: false,

    createdAt: Date.now(),

    closedAt: null,

    rating: null,

    rated: false,

    deleted: false
  };

  let channel;

  try {
    channel =
      await interaction.guild.channels.create(
        {
          name,

          type: ChannelType.GuildText,

          parent: category.id,

          topic:
            `Ticket | Owner: ${interaction.user.id}`
        }
      );
  } catch (error) {
    console.error(
      "❌ Ticket channel creation error:",
      error
    );

    return interaction.reply({
      content:
        "❌ لم أستطع إنشاء التذكرة. تأكد أن رتبة البوت لديها Manage Channels.",
      ephemeral: true
    });
  }

  ticket.id = channel.id;

  db.tickets[channel.id] =
    ticket;

  saveDB();

  try {
    await setTicketPermissions(
      channel,
      ticket,
      settings
    );
  } catch (error) {
    console.error(
      "❌ Permission setup error:",
      error
    );
  }

  const mention =
    settings.mentionRole
      ? `<@&${settings.mentionRole}>`
      : `<@&${settings.juniorRole}>`;

  await channel.send({
    content:
      `${interaction.user} ${mention}`,

    embeds: [
      ticketEmbed(
        ticket,
        settings
      )
    ],

    components: [
      ticketRow()
    ]
  });

  await interaction.reply({
    content:
      `✅ تم فتح تذكرتك: ${channel}`,
    ephemeral: true
  });

  await sendLog(
    interaction.guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🎫 Ticket Opened"
      )
      .setDescription(
        `👤 <@${interaction.user.id}>\n` +
        `📌 ${channel}`
      )
      .setTimestamp()
  );
}

// ==================================================
// CLAIM
// ==================================================

async function claimTicket(
  interaction,
  ticket,
  settings
) {
  if (
    !canClaim(
      interaction.member,
      settings
    )
  ) {
    return interaction.reply({
      content:
        "❌ ليس لديك رتبة Staff مسجلة.",
      ephemeral: true
    });
  }

  if (ticket.claimedBy) {
    return interaction.reply({
      content:
        `❌ التذكرة مستلمة بالفعل بواسطة <@${ticket.claimedBy}>.`,
      ephemeral: true
    });
  }

  if (
    ticket.status ===
    "closed_waiting_rating"
  ) {
    return interaction.reply({
      content:
        "❌ لا يمكن استلام تذكرة مغلقة.",
      ephemeral: true
    });
  }

  ticket.claimedBy =
    interaction.user.id;

  ticket.status = ticket.locked
    ? "locked"
    : "open";

  saveDB();

  addStat(
    interaction.guild.id,
    interaction.user.id,
    "claimed"
  );

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  await interaction.reply({
    content:
      `📥 تم استلام التذكرة بواسطة ${interaction.user}.`
  });

  await interaction.channel.send({
    embeds: [
      ticketEmbed(
        ticket,
        settings
      )
    ]
  });

  await sendLog(
    interaction.guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "📥 Ticket Claimed"
      )
      .setDescription(
        `التذكرة: ${interaction.channel}\n` +
        `المستلم: ${interaction.user}`
      )
      .setTimestamp()
  );
}

// ==================================================
// UNCLAIM
// ==================================================

async function unclaimTicket(
  interaction,
  ticket,
  settings
) {
  if (!ticket.claimedBy) {
    return interaction.reply({
      content:
        "❌ التذكرة غير مستلمة.",
      ephemeral: true
    });
  }

  const level =
    staffLevel(
      interaction.member,
      settings
    );

  if (
    ticket.claimedBy !==
      interaction.user.id &&
    level < 2
  ) {
    return interaction.reply({
      content:
        "❌ فقط مستلم التذكرة أو Staff أعلى يمكنه إلغاء الاستلام.",
      ephemeral: true
    });
  }

  const old =
    ticket.claimedBy;

  ticket.claimedBy = null;

  ticket.status =
    ticket.locked
      ? "locked"
      : "open";

  saveDB();

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  await interaction.reply({
    content:
      `↩️ تم إلغاء استلام التذكرة بواسطة ${interaction.user}.`
  });

  await sendLog(
    interaction.guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "↩️ Ticket Unclaimed"
      )
      .setDescription(
        `التذكرة: ${interaction.channel}\n` +
        `المستلم السابق: <@${old}>\n` +
        `بواسطة: ${interaction.user}`
      )
      .setTimestamp()
  );
}

// ==================================================
// LOCK / UNLOCK
// ==================================================

async function lockTicket(
  interaction,
  ticket,
  settings,
  locked = true
) {
  if (
    !canManageTicket(
      interaction.member,
      ticket,
      settings
    )
  ) {
    return interaction.reply({
      content:
        "❌ لا تملك صلاحية إدارة هذه التذكرة.",
      ephemeral: true
    });
  }

  if (
    ticket.status ===
      "closed_waiting_rating" &&
    !locked
  ) {
    return interaction.reply({
      content:
        "❌ لا يمكن فتح تذكرة مغلقة بانتظار التقييم.",
      ephemeral: true
    });
  }

  ticket.locked = locked;

  ticket.status =
    locked
      ? "locked"
      : "open";

  saveDB();

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  await interaction.reply({
    content: locked
      ? "🔒 تم قفل التذكرة."
      : "🔓 تم فتح التذكرة."
  });

  await sendLog(
    interaction.guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        locked
          ? "🔒 Ticket Locked"
          : "🔓 Ticket Unlocked"
      )
      .setDescription(
        `التذكرة: ${interaction.channel}\n` +
        `بواسطة: ${interaction.user}`
      )
      .setTimestamp()
  );
}

// ==================================================
// REQUEST CLOSE
// ==================================================

async function requestClose(
  interaction,
  ticket,
  settings
) {
  if (
    !canManageTicket(
      interaction.member,
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

  if (
    ticket.status ===
    "closed_waiting_rating"
  ) {
    return interaction.reply({
      content:
        "❌ التذكرة مغلقة بالفعل وتنتظر التقييم.",
      ephemeral: true
    });
  }

  const confirm =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          "close_confirm"
        )
        .setLabel(
          "تأكيد الإغلاق"
        )
        .setStyle(
          ButtonStyle.Danger
        ),

      new ButtonBuilder()
        .setCustomId(
          "close_cancel"
        )
        .setLabel("إلغاء")
        .setStyle(
          ButtonStyle.Secondary
        )
    );

  return interaction.reply({
    content:
      "⚠️ هل أنت متأكد من إغلاق التذكرة؟ بعد الإغلاق سيتم طلب التقييم من صاحب التذكرة.",

    components: [confirm],

    ephemeral: true
  });
}

// ==================================================
// ACTUALLY CLOSE
// ==================================================

async function actuallyClose(
  interaction,
  ticket,
  settings
) {
  ticket.status =
    "closed_waiting_rating";

  ticket.closedAt =
    Date.now();

  ticket.locked = true;

  saveDB();

  await setTicketPermissions(
    interaction.channel,
    ticket,
    settings
  );

  if (ticket.claimedBy) {
    addStat(
      interaction.guild.id,
      ticket.claimedBy,
      "closed"
    );
  }

  const owner =
    await interaction.guild.members
      .fetch(ticket.userId)
      .catch(() => null);

  const ratingRow =
    new ActionRowBuilder().addComponents(
      ...[1, 2, 3, 4, 5].map(
        number =>
          new ButtonBuilder()
            .setCustomId(
              `rating_${number}_${interaction.channel.id}`
            )
            .setLabel(
              String(number)
            )
            .setEmoji("⭐")
            .setStyle(
              number >= 4
                ? ButtonStyle.Success
                : number >= 3
                  ? ButtonStyle.Primary
                  : ButtonStyle.Danger
            )
      )
    );

  if (owner) {
    try {
      await owner.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              "⭐ تقييم التذكرة"
            )
            .setDescription(
              `تم إغلاق تذكرتك في **${interaction.guild.name}**.\n` +
              "يرجى تقييم الخدمة من 1 إلى 5."
            )
            .setColor("#FEE75C")
        ],

        components: [
          ratingRow
        ]
      });
    } catch {
      await interaction.channel.send(
        `⚠️ <@${ticket.userId}> تعذر إرسال الـDM. استخدم أزرار التقييم هنا.`
      );

      await interaction.channel.send({
        components: [
          ratingRow
        ]
      });
    }
  }

  if (
    interaction.isButton?.() &&
    interaction.deferred === false
  ) {
    await interaction.followUp({
      content:
        "🔒 تم إغلاق التذكرة. تم طلب التقييم من صاحبها.",
      ephemeral: true
    }).catch(() => {});
  }

  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(
          "🔒 تم إغلاق التذكرة"
        )
        .setDescription(
          "⭐ يجب على صاحب التذكرة إكمال التقييم قبل السماح بالحذف."
        )
        .setColor("#ED4245")
    ]
  });

  await sendLog(
    interaction.guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🔒 Ticket Closed"
      )
      .setDescription(
        `التذكرة: ${interaction.channel}\n` +
        `بواسطة: ${interaction.user}`
      )
      .setTimestamp()
  );
}

// ==================================================
// DELETE TICKET
// ==================================================

async function deleteTicket(
  interaction,
  ticket,
  settings
) {
  if (
    !canManageTicket(
      interaction.member,
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

  if (
    ticket.status !==
    "closed_waiting_rating" &&
    settings.requireRating
  ) {
    return interaction.reply({
      content:
        "❌ يجب إغلاق التذكرة أولًا ثم الحصول على التقييم.",
      ephemeral: true
    });
  }

  if (
    settings.requireRating &&
    !ticket.rated
  ) {
    return interaction.reply({
      content:
        "⭐ لا يمكن حذف التذكرة قبل أن يقوم صاحبها بالتقييم.",
      ephemeral: true
    });
  }

  await interaction.reply({
    content:
      "🗃️ يتم حفظ الـTranscript ثم حذف التذكرة..."
  });

  await archiveTicket(
    interaction.guild,
    settings,
    ticket,
    interaction.channel
  );

  await sendLog(
    interaction.guild,
    settings,

    new EmbedBuilder()
      .setTitle(
        "🗑️ Ticket Deleted"
      )
      .setDescription(
        `التذكرة: ${interaction.channel}\n` +
        `بواسطة: ${interaction.user}`
      )
      .setTimestamp()
  );

  ticket.deleted = true;

  delete db.tickets[
    interaction.channel.id
  ];

  saveDB();

  setTimeout(() => {
    interaction.channel
      .delete(
        "Ticket deleted after archive"
      )
      .catch(() => {});
  }, 1500);
}

// ==================================================
// STAFF STATS
// ==================================================

async function showStats(
  interaction,
  user
) {
  const settings =
    getGuild(
      interaction.guild.id
    );

  const member =
    user
      ? await interaction.guild.members
          .fetch(user.id)
          .catch(() => null)
      : interaction.member;

  if (!member) {
    return interaction.reply({
      content:
        "❌ لم أستطع العثور على العضو.",
      ephemeral: true
    });
  }

  const staff =
    settings.staff[member.id] || {
      claimed: 0,
      closed: 0,
      ratings: 0,
      ratingSum: 0
    };

  const avg =
    staff.ratings
      ? (
          staff.ratingSum /
          staff.ratings
        ).toFixed(2)
      : "لا يوجد";

  const embed =
    new EmbedBuilder()
      .setTitle(
        "📊 إحصائيات الإداري"
      )
      .setDescription(
        `${member}`
      )
      .addFields(
        {
          name:
            "🎫 التذاكر المستلمة",
          value: String(
            staff.claimed || 0
          ),
          inline: true
        },

        {
          name:
            "🔒 التذاكر المغلقة",
          value: String(
            staff.closed || 0
          ),
          inline: true
        },

        {
          name:
            "⭐ عدد التقييمات",
          value: String(
            staff.ratings || 0
          ),
          inline: true
        },

        {
          name:
            "⭐ متوسط التقييم",
          value: avg,
          inline: true
        },

        {
          name:
            "🏷️ المستوى",
          value:
            levelName(
              staffLevel(
                member,
                settings
              )
            ),
          inline: true
        }
      )
      .setColor("#5865F2");

  return interaction.reply({
    embeds: [embed],
    ephemeral: true
  });
}

// ==================================================
// SLASH COMMANDS
// ==================================================

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription(
      "إعداد نظام التذاكر"
    )

    .addSubcommand(
      sub =>
        sub
          .setName("junior")
          .setDescription(
            "تحديد رتبة الاستف الصغرى"
          )
          .addRoleOption(
            option =>
              option
                .setName("role")
                .setDescription(
                  "الرتبة"
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("middle")
          .setDescription(
            "تحديد رتبة الاستف الوسطى"
          )
          .addRoleOption(
            option =>
              option
                .setName("role")
                .setDescription(
                  "الرتبة"
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("senior")
          .setDescription(
            "تحديد رتبة الاستف العليا"
          )
          .addRoleOption(
            option =>
              option
                .setName("role")
                .setDescription(
                  "الرتبة"
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("owner")
          .setDescription(
            "تحديد رتبة الأونر"
          )
          .addRoleOption(
            option =>
              option
                .setName("role")
                .setDescription(
                  "الرتبة"
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("category")
          .setDescription(
            "تحديد Category التذاكر"
          )
          .addChannelOption(
            option =>
              option
                .setName("channel")
                .setDescription(
                  "Category"
                )
                .addChannelTypes(
                  ChannelType.GuildCategory
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("logs")
          .setDescription(
            "تحديد روم اللوج"
          )
          .addChannelOption(
            option =>
              option
                .setName("channel")
                .setDescription(
                  "الروم"
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("archive")
          .setDescription(
            "تحديد روم الأرشيف"
          )
          .addChannelOption(
            option =>
              option
                .setName("channel")
                .setDescription(
                  "الروم"
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("application")
          .setDescription(
            "تحديد روم التقديم"
          )
          .addChannelOption(
            option =>
              option
                .setName("channel")
                .setDescription(
                  "الروم"
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("mention")
          .setDescription(
            "الرتبة التي يتم منشنها عند فتح التذكرة"
          )
          .addRoleOption(
            option =>
              option
                .setName("role")
                .setDescription(
                  "الرتبة"
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("panel-channel")
          .setDescription(
            "تحديد روم Panel التذاكر"
          )
          .addChannelOption(
            option =>
              option
                .setName("channel")
                .setDescription(
                  "الروم"
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("max-tickets")
          .setDescription(
            "عدد التذاكر المفتوحة المسموحة للعضو"
          )
          .addIntegerOption(
            option =>
              option
                .setName("number")
                .setDescription(
                  "العدد"
                )
                .setMinValue(1)
                .setMaxValue(5)
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName("require-rating")
          .setDescription(
            "إجبار التقييم قبل الحذف"
          )
          .addBooleanOption(
            option =>
              option
                .setName("enabled")
                .setDescription(
                  "تفعيل"
                )
                .setRequired(true)
          )
    ),

  new SlashCommandBuilder()
    .setName("panel")
    .setDescription(
      "إرسال Panel التذاكر"
    ),

  new SlashCommandBuilder()
    .setName("panel-edit")
    .setDescription(
      "تعديل Panel التذاكر"
    ),

  new SlashCommandBuilder()
    .setName("ticket-settings")
    .setDescription(
      "عرض إعدادات التذاكر"
    ),

  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "إحصائيات الإداري"
    )
    .addUserOption(
      option =>
        option
          .setName("user")
          .setDescription(
            "الإداري"
          )
          .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription(
      "إغلاق التذكرة"
    ),

  new SlashCommandBuilder()
    .setName("delete")
    .setDescription(
      "حذف التذكرة"
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription(
      "قفل التذكرة"
    ),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription(
      "فتح التذكرة"
    ),

  new SlashCommandBuilder()
    .setName("application-panel")
    .setDescription(
      "إرسال Panel التقديم"
    )
].map(command =>
  command.toJSON()
);

// ==================================================
// REGISTER COMMANDS
// ==================================================

async function registerCommands() {
  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(
      CLIENT_ID
    ),
    {
      body: commands
    }
  );

  console.log(
    "✅ Slash commands registered globally."
  );
}

// ==================================================
// HANDLE SLASH COMMANDS
// ==================================================

async function handleSlash(
  interaction
) {
  if (!interaction.guild) {
    return interaction.reply({
      content:
        "❌ هذا الأمر يعمل داخل السيرفر فقط.",
      ephemeral: true
    });
  }

  const settings =
    getGuild(
      interaction.guild.id
    );

  const command =
    interaction.commandName;

  // ==================================================
  // SETUP
  // ==================================================

  if (command === "setup") {
    if (
      !isServerManager(
        interaction.member
      )
    ) {
      return interaction.reply({
        content:
          "❌ تحتاج Manage Server أو Administrator.",
        ephemeral: true
      });
    }

    const sub =
      interaction.options.getSubcommand();

    const role =
      interaction.options.getRole(
        "role"
      );

    const channel =
      interaction.options.getChannel(
        "channel"
      );

    const map = {
      junior: "juniorRole",
      middle: "middleRole",
      senior: "seniorRole",
      owner: "ownerRole",

      category: "ticketCategory",

      logs: "logsChannel",

      archive: "archiveChannel",

      application:
        "applicationChannel",

      mention: "mentionRole",

      "panel-channel":
        "panelChannel"
    };

    if (sub === "max-tickets") {
      settings.maxOpenTickets =
        interaction.options.getInteger(
          "number"
        );
    }

    else if (
      sub === "require-rating"
    ) {
      settings.requireRating =
        interaction.options.getBoolean(
          "enabled"
        );
    }

    else {
      const key = map[sub];

      if (!key) {
        return interaction.reply({
          content:
            "❌ إعداد غير معروف.",
          ephemeral: true
        });
      }

      settings[key] =
        role
          ? role.id
          : channel.id;
    }

    saveDB();

    return interaction.reply({
      content:
        `✅ تم حفظ إعداد **${sub}** بنجاح.`,
      ephemeral: true
    });
  }

  // ==================================================
  // TICKET SETTINGS
  // ==================================================

  if (
    command ===
    "ticket-settings"
  ) {
    const fields = [
      [
        "الصغرى",
        settings.juniorRole
          ? `<@&${settings.juniorRole}>`
          : "❌"
      ],

      [
        "الوسطى",
        settings.middleRole
          ? `<@&${settings.middleRole}>`
          : "❌"
      ],

      [
        "العليا",
        settings.seniorRole
          ? `<@&${settings.seniorRole}>`
          : "❌"
      ],

      [
        "الأونر",
        settings.ownerRole
          ? `<@&${settings.ownerRole}>`
          : "❌"
      ],

      [
        "Category",
        settings.ticketCategory
          ? `<#${settings.ticketCategory}>`
          : "❌"
      ],

      [
        "Logs",
        settings.logsChannel
          ? `<#${settings.logsChannel}>`
          : "❌"
      ],

      [
        "Archive",
        settings.archiveChannel
          ? `<#${settings.archiveChannel}>`
          : "❌"
      ],

      [
        "Applications",
        settings.applicationChannel
          ? `<#${settings.applicationChannel}>`
          : "❌"
      ],

      [
        "Panel",
        settings.panelChannel
          ? `<#${settings.panelChannel}>`
          : "❌"
      ],

      [
        "حد التذاكر",
        String(
          settings.maxOpenTickets ||
          1
        )
      ],

      [
        "التقييم إجباري",
        settings.requireRating
          ? "نعم ⭐"
          : "لا"
      ]
    ];

    const embed =
      new EmbedBuilder()
        .setTitle(
          "⚙️ إعدادات التذاكر"
        )
        .setColor("#5865F2")
        .addFields(
          fields.map(
            ([name, value]) => ({
              name,
              value,
              inline: true
            })
          )
        );

    return interaction.reply({
      embeds: [embed],
      ephemeral: true
    });
  }

  // ==================================================
  // PANEL
  // ==================================================

  if (command === "panel") {
    if (
      !isServerManager(
        interaction.member
      )
    ) {
      return interaction.reply({
        content:
          "❌ تحتاج Manage Server.",
        ephemeral: true
      });
    }

    const target =
      settings.panelChannel
        ? interaction.guild.channels.cache.get(
            settings.panelChannel
          )
        : interaction.channel;

    if (
      !target ||
      !target.isTextBased()
    ) {
      return interaction.reply({
        content:
          "❌ حدد روم Panel باستخدام `/setup panel-channel`.",
        ephemeral: true
      });
    }

    let message;

    try {
      message =
        await target.send({
          embeds: [
            panelEmbed(
              settings
            )
          ],

          components: [
            panelRow(
              settings
            )
          ]
        });
    } catch (error) {
      console.error(
        "❌ Panel send error:",
        error
      );

      return interaction.reply({
        content:
          "❌ لا أستطيع إرسال الـPanel في هذا الروم. تأكد من صلاحيات البوت.",
        ephemeral: true
      });
    }

    settings.panelChannel =
      target.id;

    settings.panelMessage =
      message.id;

    saveDB();

    return interaction.reply({
      content:
        `✅ تم إرسال Panel في ${target}.`,
      ephemeral: true
    });
  }

  // ==================================================
  // PANEL EDIT
  // ==================================================

  if (
    command === "panel-edit"
  ) {
    if (
      !isServerManager(
        interaction.member
      )
    ) {
      return interaction.reply({
        content:
          "❌ تحتاج Manage Server.",
        ephemeral: true
      });
    }

    const modal =
      new ModalBuilder()
        .setCustomId(
          "panel_edit_modal"
        )
        .setTitle(
          "تعديل Panel"
        );

    const title =
      new TextInputBuilder()
        .setCustomId("title")
        .setLabel("العنوان")
        .setStyle(
          TextInputStyle.Short
        )
        .setRequired(true)
        .setMaxLength(256)
        .setValue(
          settings.panel.title
        );

    const description =
      new TextInputBuilder()
        .setCustomId(
          "description"
        )
        .setLabel("الوصف")
        .setStyle(
          TextInputStyle.Paragraph
        )
        .setRequired(true)
        .setMaxLength(4000)
        .setValue(
          settings.panel.description
        );

    const button =
      new TextInputBuilder()
        .setCustomId("button")
        .setLabel("نص الزر")
        .setStyle(
          TextInputStyle.Short
        )
        .setRequired(true)
        .setMaxLength(80)
        .setValue(
          settings.panel.buttonText
        );

    const color =
      new TextInputBuilder()
        .setCustomId("color")
        .setLabel(
          "لون HEX مثل #5865F2"
        )
        .setStyle(
          TextInputStyle.Short
        )
        .setRequired(false)
        .setMaxLength(7)
        .setValue(
          settings.panel.color
        );

    const footer =
      new TextInputBuilder()
        .setCustomId("footer")
        .setLabel("Footer")
        .setStyle(
          TextInputStyle.Short
        )
        .setRequired(false)
        .setMaxLength(200)
        .setValue(
          settings.panel.footer
        );

    modal.addComponents(
      new ActionRowBuilder().addComponents(
        title
      ),

      new ActionRowBuilder().addComponents(
        description
      ),

      new ActionRowBuilder().addComponents(
        button
      ),

      new ActionRowBuilder().addComponents(
        color
      ),

      new ActionRowBuilder().addComponents(
        footer
      )
    );

    return interaction.showModal(
      modal
    );
  }

  // ==================================================
  // STATS
  // ==================================================

  if (command === "stats") {
    const user =
      interaction.options.getUser(
        "user"
      ) || interaction.user;

    return showStats(
      interaction,
      user
    );
  }

  // ==================================================
  // TICKET ACTIONS
  // ==================================================

  if (
    [
      "close",
      "delete",
      "lock",
      "unlock"
    ].includes(command)
  ) {
    const ticket =
      db.tickets[
        interaction.channel.id
      ];

    if (!ticket) {
      return interaction.reply({
        content:
          "❌ هذا الروم ليس تذكرة.",
        ephemeral: true
      });
    }

    if (command === "close") {
      return requestClose(
        interaction,
        ticket,
        settings
      );
    }

    if (command === "delete") {
      return deleteTicket(
        interaction,
        ticket,
        settings
      );
    }

    if (command === "lock") {
      return lockTicket(
        interaction,
        ticket,
        settings,
        true
      );
    }

    if (command === "unlock") {
      return lockTicket(
        interaction,
        ticket,
        settings,
        false
      );
    }
  }

  // ==================================================
  // APPLICATION PANEL
  // ==================================================

  if (
    command ===
    "application-panel"
  ) {
    if (
      !isServerManager(
        interaction.member
      )
    ) {
      return interaction.reply({
        content:
          "❌ تحتاج Manage Server.",
        ephemeral: true
      });
    }

    if (
      !settings.applicationChannel
    ) {
      return interaction.reply({
        content:
          "❌ حدد روم التقديم أولًا باستخدام `/setup application`.",
        ephemeral: true
      });
    }

    const channel =
      interaction.guild.channels.cache.get(
        settings.applicationChannel
      );

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return interaction.reply({
        content:
          "❌ روم التقديم غير صالح.",
        ephemeral: true
      });
    }

    const embed =
      new EmbedBuilder()
        .setTitle(
          settings.application.title
        )
        .setDescription(
          settings.application.description
        )
        .setColor("#5865F2");

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(
            "application_open"
          )
          .setLabel(
            settings.application.buttonText
          )
          .setEmoji(
            settings.application.emoji
          )
          .setStyle(
            ButtonStyle.Primary
          )
      );

    try {
      await channel.send({
        embeds: [embed],
        components: [row]
      });
    } catch (error) {
      console.error(
        "❌ Application panel error:",
        error
      );

      return interaction.reply({
        content:
          "❌ لا أستطيع إرسال Panel التقديم.",
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        `✅ تم إرسال Panel التقديم في ${channel}.`,
      ephemeral: true
    });
  }
}

// ==================================================
// INTERACTION CREATE
// ==================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {
      // ==================================================
      // SLASH
      // ==================================================

      if (
        interaction.isChatInputCommand()
      ) {
        return handleSlash(
          interaction
        );
      }

      // ==================================================
      // BUTTONS
      // ==================================================

      if (
        interaction.isButton()
      ) {
        if (!interaction.guild) {
          return interaction.reply({
            content:
              "❌ هذا الزر يعمل داخل السيرفر فقط.",
            ephemeral: true
          });
        }

        const settings =
          getGuild(
            interaction.guild.id
          );

        // ==================================================
        // OPEN TICKET
        // ==================================================

        if (
          interaction.customId ===
          "ticket_open"
        ) {
          return createTicket(
            interaction,
            settings
          );
        }

        // ==================================================
        // CURRENT TICKET
        // ==================================================

        const ticket =
          db.tickets[
            interaction.channel?.id
          ];

        // ==================================================
        // CLAIM
        // ==================================================

        if (
          interaction.customId ===
          "ticket_claim"
        ) {
          if (!ticket) {
            return interaction.reply({
              content:
                "❌ التذكرة غير مسجلة.",
              ephemeral: true
            });
          }

          return claimTicket(
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
          if (!ticket) {
            return interaction.reply({
              content:
                "❌ التذكرة غير مسجلة.",
              ephemeral: true
            });
          }

          return unclaimTicket(
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
          if (!ticket) {
            return interaction.reply({
              content:
                "❌ التذكرة غير مسجلة.",
              ephemeral: true
            });
          }

          return lockTicket(
            interaction,
            ticket,
            settings,
            !ticket.locked
          );
        }

        // ==================================================
        // CLOSE
        // ==================================================

        if (
          interaction.customId ===
          "ticket_close"
        ) {
          if (!ticket) {
            return interaction.reply({
              content:
                "❌ التذكرة غير مسجلة.",
              ephemeral: true
            });
          }

          return requestClose(
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
          "close_cancel"
        ) {
          return interaction.update({
            content:
              "❌ تم إلغاء الإغلاق.",
            components: []
          });
        }

        // ==================================================
        // CLOSE CONFIRM
        // ==================================================

        if (
          interaction.customId ===
          "close_confirm"
        ) {
          if (!ticket) {
            return interaction.update({
              content:
                "❌ التذكرة غير موجودة.",
              components: []
            });
          }

          if (
            !canManageTicket(
              interaction.member,
              ticket,
              settings
            )
          ) {
            return interaction.update({
              content:
                "❌ لا تملك صلاحية إغلاق هذه التذكرة.",
              components: []
            });
          }

          await interaction.update({
            content:
              "⏳ جاري إغلاق التذكرة...",
            components: []
          });

          return actuallyClose(
            interaction,
            ticket,
            settings
          );
        }

        // ==================================================
        // RATINGS
        // ==================================================

        if (
          interaction.customId.startsWith(
            "rating_"
          )
        ) {
          const parts =
            interaction.customId.split(
              "_"
            );

          const rating =
            Number(parts[1]);

          const channelId =
            parts.slice(2).join("_");

          const ticket =
            db.tickets[channelId];

          if (!ticket) {
            return interaction.reply({
              content:
                "❌ التذكرة غير موجودة.",
              ephemeral: true
            });
          }

          if (
            ticket.userId !==
            interaction.user.id
          ) {
            return interaction.reply({
              content:
                "❌ هذا التقييم لصاحب التذكرة فقط.",
              ephemeral: true
            });
          }

          if (ticket.rated) {
            return interaction.reply({
              content:
                "❌ تم إرسال التقييم بالفعل.",
              ephemeral: true
            });
          }

          if (
            !Number.isInteger(
              rating
            ) ||
            rating < 1 ||
            rating > 5
          ) {
            return interaction.reply({
              content:
                "❌ تقييم غير صالح.",
              ephemeral: true
            });
          }

          ticket.rating =
            rating;

          ticket.rated = true;

          saveDB();

          if (
            ticket.claimedBy
          ) {
            addStat(
              interaction.guild.id,
              ticket.claimedBy,
              "ratings"
            );

            addStat(
              interaction.guild.id,
              ticket.claimedBy,
              "ratingSum",
              rating
            );
          }

          await interaction.update({
            content:
              `⭐ شكرًا لك! تم تسجيل تقييمك: ${stars(rating)} (${rating}/5)`,
            embeds: [],
            components: []
          });

          await sendLog(
            interaction.guild,
            settings,

            new EmbedBuilder()
              .setTitle(
                "⭐ Ticket Rated"
              )
              .setDescription(
                `التذكرة: <#${channelId}>\n` +
                `التقييم: ${stars(rating)} (${rating}/5)\n` +
                `بواسطة: <@${interaction.user.id}>`
              )
              .setTimestamp()
          );

          return;
        }

        // ==================================================
        // APPLICATION OPEN
        // ==================================================

        if (
          interaction.customId ===
          "application_open"
        ) {
          const modal =
            new ModalBuilder()
              .setCustomId(
                "application_modal"
              )
              .setTitle(
                "📋 التقديم"
              );

          const name =
            new TextInputBuilder()
              .setCustomId(
                "name"
              )
              .setLabel(
                "اسمك / اسمك في السيرفر"
              )
              .setStyle(
                TextInputStyle.Short
              )
              .setRequired(true)
              .setMaxLength(100);

          const experience =
            new TextInputBuilder()
              .setCustomId(
                "experience"
              )
              .setLabel(
                "خبرتك"
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true)
              .setMaxLength(1000);

          const reason =
            new TextInputBuilder()
              .setCustomId(
                "reason"
              )
              .setLabel(
                "لماذا تريد التقديم؟"
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true)
              .setMaxLength(1000);

          modal.addComponents(
            new ActionRowBuilder().addComponents(
              name
            ),

            new ActionRowBuilder().addComponents(
              experience
            ),

            new ActionRowBuilder().addComponents(
              reason
            )
          );

          return interaction.showModal(
            modal
          );
        }
      }

      // ==================================================
      // MODALS
      // ==================================================

      if (
        interaction.isModalSubmit()
      ) {
        // ==================================================
        // PANEL EDIT
        // ==================================================

        if (
          interaction.customId ===
          "panel_edit_modal"
        ) {
          if (
            !isServerManager(
              interaction.member
            )
          ) {
            return interaction.reply({
              content:
                "❌ لا تملك الصلاحية.",
              ephemeral: true
            });
          }

          const settings =
            getGuild(
              interaction.guild.id
            );

          settings.panel.title =
            interaction.fields.getTextInputValue(
              "title"
            );

          settings.panel.description =
            interaction.fields.getTextInputValue(
              "description"
            );

          settings.panel.buttonText =
            interaction.fields.getTextInputValue(
              "button"
            );

          const color =
            interaction.fields.getTextInputValue(
              "color"
            );

          if (
            /^#[0-9A-Fa-f]{6}$/.test(
              color
            )
          ) {
            settings.panel.color =
              color;
          }

          settings.panel.footer =
            interaction.fields.getTextInputValue(
              "footer"
            ) ||
            "نظام التذاكر";

          saveDB();

          let updated = false;

          if (
            settings.panelChannel &&
            settings.panelMessage
          ) {
            const channel =
              interaction.guild.channels.cache.get(
                settings.panelChannel
              );

            if (
              channel &&
              channel.isTextBased()
            ) {
              const message =
                await channel.messages
                  .fetch(
                    settings.panelMessage
                  )
                  .catch(() => null);

              if (message) {
                await message
                  .edit({
                    embeds: [
                      panelEmbed(
                        settings
                      )
                    ],
                    components: [
                      panelRow(
                        settings
                      )
                    ]
                  })
                  .catch(() => {});

                updated = true;
              }
            }
          }

          return interaction.reply({
            content: updated
              ? "✅ تم تعديل الـPanel وتحديث الرسالة القديمة."
              : "✅ تم حفظ التعديلات. استخدم `/panel` لإرسال Panel جديد.",
            ephemeral: true
          });
        }

        // ==================================================
        // APPLICATION
        // ==================================================

        if (
          interaction.customId ===
          "application_modal"
        ) {
          const settings =
            getGuild(
              interaction.guild.id
            );

          const application = {
            id:
              `${interaction.guild.id}-${interaction.user.id}-${Date.now()}`,

            guildId:
              interaction.guild.id,

            userId:
              interaction.user.id,

            name:
              interaction.fields.getTextInputValue(
                "name"
              ),

            experience:
              interaction.fields.getTextInputValue(
                "experience"
              ),

            reason:
              interaction.fields.getTextInputValue(
                "reason"
              ),

            createdAt:
              Date.now()
          };

          db.applications[
            application.id
          ] = application;

          saveDB();

          const target =
            settings.applicationChannel
              ? interaction.guild.channels.cache.get(
                  settings.applicationChannel
                )
              : null;

          if (
            target &&
            target.isTextBased()
          ) {
            await target.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle(
                    "📋 تقديم جديد"
                  )
                  .setDescription(
                    `👤 المتقدم: <@${interaction.user.id}>`
                  )
                  .addFields(
                    {
                      name: "الاسم",
                      value:
                        safeText(
                          application.name
                        ),
                      inline: false
                    },

                    {
                      name: "الخبرة",
                      value:
                        safeText(
                          application.experience
                        ),
                      inline: false
                    },

                    {
                      name:
                        "سبب التقديم",
                      value:
                        safeText(
                          application.reason
                        ),
                      inline: false
                    }
                  )
                  .setTimestamp()
              ]
            });
          }

          return interaction.reply({
            content:
              "✅ تم إرسال تقديمك بنجاح.",
            ephemeral: true
          });
        }
      }
    } catch (error) {
      console.error(
        "❌ Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content:
              "❌ حدث خطأ غير متوقع.",
            ephemeral: true
          })
          .catch(() => {});
      }
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
      if (
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const content =
        message.content.trim();

      const settings =
        getGuild(
          message.guild.id
        );

      const aliases = {
        "$قفل": "lock",
        "$lock": "lock",

        "$فتح": "unlock",
        "$unlock": "unlock",

        "$close": "close",

        "$delete": "delete",
        "$حذف": "delete",
        "$مسح": "delete"
      };

      // ==================================================
      // $وقتي
      // ==================================================

      if (
        content === "$وقتي"
      ) {
        const ticket =
          db.tickets[
            message.channel.id
          ];

        if (
          !ticket ||
          ticket.userId !==
            message.author.id
        ) {
          return;
        }

        const claim =
          ticket.claimedBy
            ? `<@${ticket.claimedBy}>`
            : "غير مستلمة";

        let status =
          "🟢 مفتوحة";

        if (
          ticket.status ===
          "locked"
        ) {
          status =
            "🔒 مقفلة";
        }

        if (
          ticket.status ===
          "closed_waiting_rating"
        ) {
          status =
            "⭐ بانتظار التقييم";
        }

        return message.reply(
          `🎫 التذكرة: ${message.channel}\n` +
          `📥 المستلم: ${claim}\n` +
          `📌 الحالة: ${status}`
        );
      }

      const action =
        aliases[content];

      if (!action) {
        return;
      }

      const ticket =
        db.tickets[
          message.channel.id
        ];

      if (!ticket) {
        return message.reply(
          "❌ هذا الروم ليس تذكرة."
        );
      }

      // ==================================================
      // PREFIX FAKE INTERACTION
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

        replied: false,

        deferred: false,

        isButton: () =>
          false,

        reply: async payload => {
          return message.reply(
            payload
          );
        },

        followUp: async payload => {
          return message.reply(
            payload
          );
        }
      };

      if (
        action === "lock"
      ) {
        return lockTicket(
          fakeInteraction,
          ticket,
          settings,
          true
        );
      }

      if (
        action === "unlock"
      ) {
        return lockTicket(
          fakeInteraction,
          ticket,
          settings,
          false
        );
      }

      if (
        action === "close"
      ) {
        return requestClose(
          fakeInteraction,
          ticket,
          settings
        );
      }

      if (
        action === "delete"
      ) {
        return deleteTicket(
          fakeInteraction,
          ticket,
          settings
        );
      }
    } catch (error) {
      console.error(
        "❌ Message command error:",
        error
      );
    }
  }
);

// ==================================================
// READY
// ==================================================

client.once(
  "ready",
  () => {
    console.log(
      "=========================================="
    );

    console.log(
      `🤖 ${client.user.tag} is online.`
    );

    console.log(
      `🆔 Client ID: ${client.user.id}`
    );

    console.log(
      `🌐 Servers: ${client.guilds.cache.size}`
    );

    console.log(
      "🎫 Ticket System: ONLINE"
    );

    console.log(
      "⭐ Rating System: ONLINE"
    );

    console.log(
      "🗃️ Transcript System: ONLINE"
    );

    console.log(
      "=========================================="
    );
  }
);

// ==================================================
// ERROR EVENTS
// ==================================================

client.on(
  "error",
  error => {
    console.error(
      "❌ Discord Client Error:",
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "⚠️ Discord Warning:",
      warning
    );
});

// ==================================================
// START BOT
// ==================================================

(async () => {
  try {
    console.log(
      "🚀 Starting bot..."
    );

    await registerCommands();

    console.log(
      "🔐 Logging into Discord..."
    );

    await client.login(
      TOKEN
    );
  } catch (error) {
    console.error(
      "❌ Startup error:",
      error
    );

    process.exit(1);
  }
})();
