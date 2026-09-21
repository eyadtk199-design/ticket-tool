
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
  StringSelectMenuBuilder,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID environment variable.");
  process.exit(1);
}

const DATA_FILE = path.join(__dirname, "data.json");
const TRANSCRIPT_DIR = path.join(__dirname, "transcripts");
if (!fs.existsSync(TRANSCRIPT_DIR)) fs.mkdirSync(TRANSCRIPT_DIR, { recursive: true });

const DEFAULT_PANEL = {
  title: "🎫 الدعم الفني",
  description: "اضغط على الزر بالأسفل لفتح تذكرة والتواصل مع فريق الدعم.",
  buttonText: "فتح تذكرة",
  emoji: "🎫",
  color: "#5865F2",
  footer: "نظام التذاكر",
  thumbnail: "",
  image: ""
};

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

function loadDB() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, JSON.stringify({ guilds: {}, tickets: {}, applications: {} }, null, 2));
    }
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    data.guilds ||= {};
    data.tickets ||= {};
    data.applications ||= {};
    return data;
  } catch (e) {
    console.error("Database load error:", e);
    return { guilds: {}, tickets: {}, applications: {} };
  }
}

let db = loadDB();

function saveDB() {
  const tmp = DATA_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

function getGuild(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = JSON.parse(JSON.stringify(DEFAULTS));
    saveDB();
  }
  const g = db.guilds[guildId];
  g.panel ||= JSON.parse(JSON.stringify(DEFAULT_PANEL));
  g.application ||= { title: "📋 التقديم", description: "اضغط على الزر بالأسفل لفتح نموذج التقديم.", buttonText: "📝 تقديم", emoji: "📝" };
  g.staff ||= {};
  return g;
}

function isServerManager(member) {
  return member.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
         member.permissions.has(PermissionsBitField.Flags.Administrator);
}

function staffLevel(member, settings) {
  if (!member) return 0;
  if (settings.ownerRole && member.roles.cache.has(settings.ownerRole)) return 4;
  if (settings.seniorRole && member.roles.cache.has(settings.seniorRole)) return 3;
  if (settings.middleRole && member.roles.cache.has(settings.middleRole)) return 2;
  if (settings.juniorRole && member.roles.cache.has(settings.juniorRole)) return 1;
  return 0;
}

function levelName(level) {
  return ["عضو", "الاستف الصغرى", "الاستف الوسطى", "الاستف العليا", "الأونر"][level] || "عضو";
}

function canManageTicket(member, ticket, settings) {
  const level = staffLevel(member, settings);
  if (level < 1) return false;
  if (!ticket.claimedBy) return true;
  if (ticket.claimedBy === member.id) return true;
  return level >= 2;
}

function canClaim(member, settings) {
  return staffLevel(member, settings) >= 1;
}

function getOpenTicketsForUser(guildId, userId) {
  return Object.values(db.tickets).filter(t =>
    t.guildId === guildId &&
    t.userId === userId &&
    ["open", "locked", "closed_waiting_rating"].includes(t.status)
  );
}

function addStat(guildId, userId, key, amount = 1) {
  const g = getGuild(guildId);
  g.staff[userId] ||= { claimed: 0, closed: 0, ratings: 0, ratingSum: 0 };
  g.staff[userId][key] = (g.staff[userId][key] || 0) + amount;
  saveDB();
}

function averageRating(guildId, userId) {
  const s = getGuild(guildId).staff[userId];
  if (!s || !s.ratings) return "لا يوجد";
  return (s.ratingSum / s.ratings).toFixed(2);
}

function stars(n) {
  return "⭐".repeat(Math.max(0, Math.min(5, n)));
}

function safeText(value, fallback = "") {
  if (!value) return fallback;
  return String(value).slice(0, 1024);
}

function panelEmbed(settings) {
  const p = settings.panel;
  const e = new EmbedBuilder()
    .setTitle(p.title || DEFAULT_PANEL.title)
    .setDescription(p.description || DEFAULT_PANEL.description)
    .setColor(p.color || DEFAULT_PANEL.color)
    .setFooter({ text: p.footer || DEFAULT_PANEL.footer });
  if (p.thumbnail) e.setThumbnail(p.thumbnail);
  if (p.image) e.setImage(p.image);
  return e;
}

function panelRow(settings) {
  const p = settings.panel;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_open")
      .setLabel(p.buttonText || "فتح تذكرة")
      .setEmoji(p.emoji || "🎫")
      .setStyle(ButtonStyle.Primary)
  );
}

function ticketRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ticket_claim").setLabel("استلام").setEmoji("📥").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("ticket_unclaim").setLabel("إلغاء الاستلام").setEmoji("↩️").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_lock").setLabel("قفل").setEmoji("🔒").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("ticket_close").setLabel("إغلاق").setEmoji("❌").setStyle(ButtonStyle.Danger)
  );
}

function ticketEmbed(ticket, settings) {
  const claim = ticket.claimedBy ? `<@${ticket.claimedBy}>` : "غير مستلمة";
  return new EmbedBuilder()
    .setTitle("🎫 تذكرة دعم")
    .setDescription(
      `👤 صاحب التذكرة: <@${ticket.userId}>\n` +
      `📥 المستلم: ${claim}\n` +
      `📌 الحالة: ${ticket.status === "locked" ? "🔒 مقفلة" : ticket.status === "closed_waiting_rating" ? "⭐ بانتظار التقييم" : "🟢 مفتوحة"}`
    )
    .setColor(ticket.status === "locked" ? "#ED4245" : "#5865F2")
    .setFooter({ text: settings.panel.footer || "نظام التذاكر" });
}

async function sendLog(guild, settings, embed) {
  if (!settings.logsChannel) return;
  const ch = guild.channels.cache.get(settings.logsChannel);
  if (!ch || !ch.isTextBased()) return;
  try { await ch.send({ embeds: [embed] }); } catch {}
}

async function buildTranscript(channel) {
  let all = [];
  let lastId;
  while (true) {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;
    const batch = await channel.messages.fetch(options).catch(() => null);
    if (!batch || batch.size === 0) break;
    all.push(...batch.values());
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  all.reverse();

  const lines = [];
  lines.push(`Transcript: ${channel.name}`);
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("=".repeat(70));

  for (const m of all) {
    if (m.author?.bot && !m.content && !m.embeds?.length) continue;
    const content = m.content || "";
    const embeds = m.embeds?.length ? ` [embeds: ${m.embeds.length}]` : "";
    const attachments = m.attachments?.size ? ` [attachments: ${[...m.attachments.values()].map(a => a.url).join(", ")}]` : "";
    lines.push(`[${new Date(m.createdTimestamp).toISOString()}] ${m.author?.tag || "Unknown"}: ${content}${embeds}${attachments}`);
  }

  const file = path.join(TRANSCRIPT_DIR, `${channel.id}-${Date.now()}.txt`);
  fs.writeFileSync(file, lines.join("\n"), "utf8");
  return file;
}

async function archiveTicket(guild, settings, ticket, channel) {
  let transcriptPath = null;
  try { transcriptPath = await buildTranscript(channel); } catch (e) { console.error(e); }

  const archive = settings.archiveChannel ? guild.channels.cache.get(settings.archiveChannel) : null;
  if (archive && archive.isTextBased()) {
    const embed = new EmbedBuilder()
      .setTitle("🗃️ Ticket Archive")
      .setDescription(
        `👤 صاحب التذكرة: <@${ticket.userId}>\n` +
        `📥 المستلم: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "غير مستلمة"}\n` +
        `⭐ التقييم: ${ticket.rating ? `${stars(ticket.rating)} (${ticket.rating}/5)` : "لم يتم التقييم"}`
      )
      .setTimestamp();
    try {
      await archive.send({
        embeds: [embed],
        files: transcriptPath ? [transcriptPath] : []
      });
    } catch (e) {
      console.error("Archive send error:", e);
    }
  }

  if (transcriptPath) {
    setTimeout(() => {
      try { fs.unlinkSync(transcriptPath); } catch {}
    }, 60_000);
  }
}

async function setTicketPermissions(channel, ticket, settings) {
  const guild = channel.guild;
  const owner = guild.members.cache.get(ticket.userId);
  if (!owner) return;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
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

  const roles = [
    settings.juniorRole,
    settings.middleRole,
    settings.seniorRole,
    settings.ownerRole
  ].filter(Boolean);

  for (const roleId of roles) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory
      ],
      deny: [PermissionsBitField.Flags.SendMessages]
    });
  }

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
  } else if (settings.juniorRole) {
    overwrites.push({
      id: settings.juniorRole,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  if (ticket.locked || ticket.status === "closed_waiting_rating") {
    const ownerOverwrite = overwrites.find(x => x.id === ticket.userId);
    if (ownerOverwrite) ownerOverwrite.deny = [PermissionsBitField.Flags.SendMessages];
  }

  await channel.permissionOverwrites.set(overwrites);
}

async function createTicket(interaction, settings) {
  if (!settings.ticketCategory) {
    return interaction.reply({ content: "❌ لم يتم تحديد Category التذاكر. استخدم `/setup category` أولًا.", ephemeral: true });
  }
  if (!settings.juniorRole) {
    return interaction.reply({ content: "❌ لم يتم تحديد رتبة الاستف الصغرى. استخدم `/setup junior` أولًا.", ephemeral: true });
  }

  const open = getOpenTicketsForUser(interaction.guild.id, interaction.user.id);
  if (open.length >= Number(settings.maxOpenTickets || 1)) {
    return interaction.reply({ content: `❌ لديك بالفعل ${open.length} تذكرة مفتوحة.`, ephemeral: true });
  }

  const category = interaction.guild.channels.cache.get(settings.ticketCategory);
  if (!category || category.type !== ChannelType.GuildCategory) {
    return interaction.reply({ content: "❌ Category التذاكر غير موجودة أو غير صالحة.", ephemeral: true });
  }

  const name = `ticket-${interaction.user.username.toLowerCase().replace(/[^a-z0-9-_]/g, "").slice(0, 18) || "user"}-${Math.floor(Math.random()*9999)}`;

  const ticket = {
    id: null,
    guildId: interaction.guild.id,
    userId: interaction.user.id,
    claimedBy: null,
    status: "open",
    locked: false,
    createdAt: Date.now(),
    closedAt: null,
    rating: null,
    rated: false,
    deleted: false
  };

  const channel = await interaction.guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `Ticket | Owner: ${interaction.user.id}`
  });

  ticket.id = channel.id;
  db.tickets[channel.id] = ticket;
  saveDB();

  await setTicketPermissions(channel, ticket, settings);

  const mention = settings.mentionRole ? `<@&${settings.mentionRole}>` : `<@&${settings.juniorRole}>`;

  const embed = ticketEmbed(ticket, settings);

  await channel.send({
    content: `${interaction.user} ${mention}`,
    embeds: [embed],
    components: [ticketRow()]
  });

  await interaction.reply({
    content: `✅ تم فتح تذكرتك: ${channel}`,
    ephemeral: true
  });

  await sendLog(interaction.guild, settings, new EmbedBuilder()
    .setTitle("🎫 Ticket Opened")
    .setDescription(`👤 <@${interaction.user.id}>\n📌 ${channel}`)
    .setTimestamp()
  );
}

async function claimTicket(interaction, ticket, settings) {
  if (!canClaim(interaction.member, settings)) {
    return interaction.reply({ content: "❌ ليس لديك رتبة Staff مسجلة.", ephemeral: true });
  }
  if (ticket.claimedBy) {
    return interaction.reply({ content: `❌ التذكرة مستلمة بالفعل بواسطة <@${ticket.claimedBy}>.`, ephemeral: true });
  }

  ticket.claimedBy = interaction.user.id;
  ticket.status = "open";
  saveDB();

  addStat(interaction.guild.id, interaction.user.id, "claimed");
  await setTicketPermissions(interaction.channel, ticket, settings);

  await interaction.reply({
    content: `📥 تم استلام التذكرة بواسطة ${interaction.user}. 🔒 تم منع باقي الاستف الصغرى من الكتابة.`
  });

  await interaction.channel.send({ embeds: [ticketEmbed(ticket, settings)] });
  await sendLog(interaction.guild, settings, new EmbedBuilder()
    .setTitle("📥 Ticket Claimed")
    .setDescription(`التذكرة: ${interaction.channel}\nالمستلم: ${interaction.user}`)
    .setTimestamp()
  );
}

async function unclaimTicket(interaction, ticket, settings) {
  if (!ticket.claimedBy) {
    return interaction.reply({ content: "❌ التذكرة غير مستلمة.", ephemeral: true });
  }

  const level = staffLevel(interaction.member, settings);
  if (ticket.claimedBy !== interaction.user.id && level < 2) {
    return interaction.reply({ content: "❌ فقط مستلم التذكرة أو Staff أعلى يمكنه إلغاء الاستلام.", ephemeral: true });
  }

  const old = ticket.claimedBy;
  ticket.claimedBy = null;
  ticket.status = ticket.locked ? "locked" : "open";
  saveDB();

  await setTicketPermissions(interaction.channel, ticket, settings);

  await interaction.reply({ content: `↩️ تم إلغاء استلام التذكرة بواسطة ${interaction.user}.` });
  await sendLog(interaction.guild, settings, new EmbedBuilder()
    .setTitle("↩️ Ticket Unclaimed")
    .setDescription(`التذكرة: ${interaction.channel}\nالمستلم السابق: <@${old}>\nبواسطة: ${interaction.user}`)
    .setTimestamp()
  );
}

async function lockTicket(interaction, ticket, settings, locked = true) {
  if (!canManageTicket(interaction.member, ticket, settings)) {
    return interaction.reply({ content: "❌ لا تملك صلاحية إدارة هذه التذكرة.", ephemeral: true });
  }

  ticket.locked = locked;
  ticket.status = locked ? "locked" : "open";
  saveDB();
  await setTicketPermissions(interaction.channel, ticket, settings);

  await interaction.reply({
    content: locked ? "🔒 تم قفل التذكرة." : "🔓 تم فتح التذكرة."
  });

  await sendLog(interaction.guild, settings, new EmbedBuilder()
    .setTitle(locked ? "🔒 Ticket Locked" : "🔓 Ticket Unlocked")
    .setDescription(`التذكرة: ${interaction.channel}\nبواسطة: ${interaction.user}`)
    .setTimestamp()
  );
}

async function requestClose(interaction, ticket, settings) {
  if (!canManageTicket(interaction.member, ticket, settings)) {
    return interaction.reply({ content: "❌ لا تملك صلاحية إغلاق هذه التذكرة.", ephemeral: true });
  }

  const confirm = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("close_confirm").setLabel("تأكيد الإغلاق").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId("close_cancel").setLabel("إلغاء").setStyle(ButtonStyle.Secondary)
  );

  return interaction.reply({
    content: "⚠️ هل أنت متأكد من إغلاق التذكرة؟ بعد الإغلاق سيتم طلب التقييم من صاحب التذكرة.",
    components: [confirm],
    ephemeral: true
  });
}

async function actuallyClose(interaction, ticket, settings) {
  ticket.status = "closed_waiting_rating";
  ticket.closedAt = Date.now();
  ticket.locked = true;
  saveDB();

  await setTicketPermissions(interaction.channel, ticket, settings);

  if (ticket.claimedBy) addStat(interaction.guild.id, ticket.claimedBy, "closed");

  const owner = interaction.guild.members.cache.get(ticket.userId);
  if (owner) {
    const ratingRow = new ActionRowBuilder().addComponents(
      ...[1,2,3,4,5].map(n =>
        new ButtonBuilder()
          .setCustomId(`rating_${n}_${interaction.channel.id}`)
          .setLabel(`${n}`)
          .setEmoji("⭐")
          .setStyle(n >= 4 ? ButtonStyle.Success : n >= 3 ? ButtonStyle.Primary : ButtonStyle.Danger)
      )
    );

    try {
      await owner.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("⭐ تقييم التذكرة")
            .setDescription(`تم إغلاق تذكرتك في **${interaction.guild.name}**.\nيرجى تقييم الخدمة من 1 إلى 5.`)
            .setColor("#FEE75C")
        ],
        components: [ratingRow]
      });
    } catch {
      await interaction.channel.send(`⚠️ <@${ticket.userId}> تعذر إرسال الـDM. استخدم أزرار التقييم هنا.`);
      await interaction.channel.send({ components: [ratingRow] });
    }
  }

  await interaction.followUp({ content: "🔒 تم إغلاق التذكرة. تم طلب التقييم من صاحبها.", ephemeral: true }).catch(() => {});
  await interaction.channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔒 تم إغلاق التذكرة")
        .setDescription("⭐ يجب على صاحب التذكرة إكمال التقييم قبل السماح بالحذف.")
        .setColor("#ED4245")
    ]
  });

  await sendLog(interaction.guild, settings, new EmbedBuilder()
    .setTitle("🔒 Ticket Closed")
    .setDescription(`التذكرة: ${interaction.channel}\nبواسطة: ${interaction.user}`)
    .setTimestamp()
  );
}

async function deleteTicket(interaction, ticket, settings) {
  if (!canManageTicket(interaction.member, ticket, settings)) {
    return interaction.reply({ content: "❌ لا تملك صلاحية حذف هذه التذكرة.", ephemeral: true });
  }

  if (settings.requireRating && !ticket.rated) {
    return interaction.reply({
      content: "⭐ لا يمكن حذف التذكرة قبل أن يقوم صاحبها بالتقييم.",
      ephemeral: true
    });
  }

  await interaction.reply({ content: "🗃️ يتم حفظ الـTranscript ثم حذف التذكرة..." });

  await archiveTicket(interaction.guild, settings, ticket, interaction.channel);

  await sendLog(interaction.guild, settings, new EmbedBuilder()
    .setTitle("🗑️ Ticket Deleted")
    .setDescription(`التذكرة: ${interaction.channel}\nبواسطة: ${interaction.user}`)
    .setTimestamp()
  );

  delete db.tickets[interaction.channel.id];
  saveDB();

  setTimeout(() => interaction.channel.delete("Ticket deleted after archive").catch(() => {}), 1500);
}

async function showStats(interaction, user) {
  const settings = getGuild(interaction.guild.id);
  const member = user ? interaction.guild.members.cache.get(user.id) : interaction.member;
  const s = settings.staff[member.id] || { claimed: 0, closed: 0, ratings: 0, ratingSum: 0 };
  const avg = s.ratings ? (s.ratingSum / s.ratings).toFixed(2) : "لا يوجد";

  const e = new EmbedBuilder()
    .setTitle("📊 إحصائيات الإداري")
    .setDescription(`${member}`)
    .addFields(
      { name: "🎫 التذاكر المستلمة", value: String(s.claimed || 0), inline: true },
      { name: "🔒 التذاكر المغلقة", value: String(s.closed || 0), inline: true },
      { name: "⭐ عدد التقييمات", value: String(s.ratings || 0), inline: true },
      { name: "⭐ متوسط التقييم", value: avg, inline: true },
      { name: "🏷️ المستوى", value: levelName(staffLevel(member, settings)), inline: true }
    );

  return interaction.reply({ embeds: [e], ephemeral: true });
}

const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("إعداد نظام التذاكر")
    .addSubcommand(s => s.setName("junior").setDescription("رتبة الاستف الصغرى").addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true)))
    .addSubcommand(s => s.setName("middle").setDescription("رتبة الاستف الوسطى").addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true)))
    .addSubcommand(s => s.setName("senior").setDescription("رتبة الاستف العليا").addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true)))
    .addSubcommand(s => s.setName("owner").setDescription("رتبة الأونر").addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true)))
    .addSubcommand(s => s.setName("category").setDescription("Category التذاكر").addChannelOption(o => o.setName("channel").setDescription("Category").addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand(s => s.setName("logs").setDescription("روم اللوج").addChannelOption(o => o.setName("channel").setDescription("الروم").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("archive").setDescription("روم الأرشيف").addChannelOption(o => o.setName("channel").setDescription("الروم").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("application").setDescription("روم التقديم").addChannelOption(o => o.setName("channel").setDescription("الروم").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("mention").setDescription("الرتبة التي يتم منشنها عند فتح التذكرة").addRoleOption(o => o.setName("role").setDescription("الرتبة").setRequired(true)))
    .addSubcommand(s => s.setName("panel-channel").setDescription("روم Panel التذاكر").addChannelOption(o => o.setName("channel").setDescription("الروم").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand(s => s.setName("max-tickets").setDescription("عدد التذاكر المفتوحة المسموحة للعضو").addIntegerOption(o => o.setName("number").setDescription("العدد").setMinValue(1).setMaxValue(5).setRequired(true)))
    .addSubcommand(s => s.setName("require-rating").setDescription("إجبار التقييم قبل الحذف").addBooleanOption(o => o.setName("enabled").setDescription("تفعيل").setRequired(true))),

  new SlashCommandBuilder().setName("panel").setDescription("إرسال Panel التذاكر"),
  new SlashCommandBuilder().setName("panel-edit").setDescription("تعديل Panel التذاكر"),
  new SlashCommandBuilder().setName("ticket-settings").setDescription("عرض إعدادات التذاكر"),
  new SlashCommandBuilder().setName("stats").setDescription("إحصائيات الإداري").addUserOption(o => o.setName("user").setDescription("الإداري").setRequired(false)),
  new SlashCommandBuilder().setName("close").setDescription("إغلاق التذكرة"),
  new SlashCommandBuilder().setName("delete").setDescription("حذف التذكرة"),
  new SlashCommandBuilder().setName("lock").setDescription("قفل التذكرة"),
  new SlashCommandBuilder().setName("unlock").setDescription("فتح التذكرة"),
  new SlashCommandBuilder().setName("application-panel").setDescription("إرسال Panel التقديم")
].map(c => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log("✅ Slash commands registered globally.");
}

async function handleSlash(interaction) {
  const settings = getGuild(interaction.guild.id);
  const cmd = interaction.commandName;

  if (cmd === "setup") {
    if (!isServerManager(interaction.member)) {
      return interaction.reply({ content: "❌ تحتاج Manage Server أو Administrator.", ephemeral: true });
    }

    const sub = interaction.options.getSubcommand();
    const role = interaction.options.getRole("role");
    const channel = interaction.options.getChannel("channel");
    const map = {
      junior: "juniorRole",
      middle: "middleRole",
      senior: "seniorRole",
      owner: "ownerRole",
      category: "ticketCategory",
      logs: "logsChannel",
      archive: "archiveChannel",
      application: "applicationChannel",
      mention: "mentionRole",
      "panel-channel": "panelChannel"
    };

    if (sub === "max-tickets") {
      settings.maxOpenTickets = interaction.options.getInteger("number");
    } else if (sub === "require-rating") {
      settings.requireRating = interaction.options.getBoolean("enabled");
    } else {
      settings[map[sub]] = role ? role.id : channel.id;
    }

    saveDB();
    return interaction.reply({ content: `✅ تم حفظ إعداد **${sub}**.`, ephemeral: true });
  }

  if (cmd === "ticket-settings") {
    const fields = [
      ["الصغرى", settings.juniorRole ? `<@&${settings.juniorRole}>` : "❌"],
      ["الوسطى", settings.middleRole ? `<@&${settings.middleRole}>` : "❌"],
      ["العليا", settings.seniorRole ? `<@&${settings.seniorRole}>` : "❌"],
      ["الأونر", settings.ownerRole ? `<@&${settings.ownerRole}>` : "❌"],
      ["Category", settings.ticketCategory ? `<#${settings.ticketCategory}>` : "❌"],
      ["Logs", settings.logsChannel ? `<#${settings.logsChannel}>` : "❌"],
      ["Archive", settings.archiveChannel ? `<#${settings.archiveChannel}>` : "❌"],
      ["Applications", settings.applicationChannel ? `<#${settings.applicationChannel}>` : "❌"],
      ["Panel", settings.panelChannel ? `<#${settings.panelChannel}>` : "❌"],
      ["حد التذاكر", String(settings.maxOpenTickets || 1)],
      ["التقييم إجباري", settings.requireRating ? "نعم ⭐" : "لا"]
    ];
    const e = new EmbedBuilder().setTitle("⚙️ إعدادات التذاكر").addFields(fields.map(([name, value]) => ({ name, value, inline: true })));
    return interaction.reply({ embeds: [e], ephemeral: true });
  }

  if (cmd === "panel") {
    if (!isServerManager(interaction.member)) return interaction.reply({ content: "❌ تحتاج Manage Server.", ephemeral: true });
    const target = settings.panelChannel ? interaction.guild.channels.cache.get(settings.panelChannel) : interaction.channel;
    if (!target?.isTextBased()) return interaction.reply({ content: "❌ حدد روم Panel باستخدام `/setup panel-channel`.", ephemeral: true });
    const msg = await target.send({ embeds: [panelEmbed(settings)], components: [panelRow(settings)] });
    settings.panelChannel = target.id;
    settings.panelMessage = msg.id;
    saveDB();
    return interaction.reply({ content: `✅ تم إرسال Panel في ${target}.`, ephemeral: true });
  }

  if (cmd === "panel-edit") {
    if (!isServerManager(interaction.member)) return interaction.reply({ content: "❌ تحتاج Manage Server.", ephemeral: true });

    const modal = new ModalBuilder().setCustomId("panel_edit_modal").setTitle("تعديل Panel");
    const title = new TextInputBuilder().setCustomId("title").setLabel("العنوان").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(256).setValue(settings.panel.title);
    const desc = new TextInputBuilder().setCustomId("description").setLabel("الوصف").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(4000).setValue(settings.panel.description);
    const button = new TextInputBuilder().setCustomId("button").setLabel("نص الزر").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(80).setValue(settings.panel.buttonText);
    const color = new TextInputBuilder().setCustomId("color").setLabel("لون HEX مثل #5865F2").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setValue(settings.panel.color);
    const footer = new TextInputBuilder().setCustomId("footer").setLabel("Footer").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(200).setValue(settings.panel.footer);
    modal.addComponents(
      new ActionRowBuilder().addComponents(title),
      new ActionRowBuilder().addComponents(desc),
      new ActionRowBuilder().addComponents(button),
      new ActionRowBuilder().addComponents(color),
      new ActionRowBuilder().addComponents(footer)
    );
    return interaction.showModal(modal);
  }

  if (cmd === "stats") {
    const user = interaction.options.getUser("user") || interaction.user;
    return showStats(interaction, user);
  }

  if (cmd === "close" || cmd === "delete" || cmd === "lock" || cmd === "unlock") {
    const ticket = db.tickets[interaction.channel.id];
    if (!ticket) return interaction.reply({ content: "❌ هذا الروم ليس تذكرة.", ephemeral: true });

    if (cmd === "close") return requestClose(interaction, ticket, settings);
    if (cmd === "delete") return deleteTicket(interaction, ticket, settings);
    if (cmd === "lock") return lockTicket(interaction, ticket, settings, true);
    if (cmd === "unlock") return lockTicket(interaction, ticket, settings, false);
  }

  if (cmd === "application-panel") {
    if (!isServerManager(interaction.member)) return interaction.reply({ content: "❌ تحتاج Manage Server.", ephemeral: true });
    if (!settings.applicationChannel) return interaction.reply({ content: "❌ حدد روم التقديم أولًا باستخدام `/setup application`.", ephemeral: true });
    const ch = interaction.guild.channels.cache.get(settings.applicationChannel);
    if (!ch?.isTextBased()) return interaction.reply({ content: "❌ روم التقديم غير صالح.", ephemeral: true });

    const e = new EmbedBuilder()
      .setTitle(settings.application.title)
      .setDescription(settings.application.description)
      .setColor("#5865F2");

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("application_open").setLabel(settings.application.buttonText).setEmoji(settings.application.emoji).setStyle(ButtonStyle.Primary)
    );

    await ch.send({ embeds: [e], components: [row] });
    return interaction.reply({ content: `✅ تم إرسال Panel التقديم في ${ch}.`, ephemeral: true });
  }
}

client.on("interactionCreate", async interaction => {
  try {
    if (interaction.isChatInputCommand()) return handleSlash(interaction);

    if (interaction.isButton()) {
      const settings = getGuild(interaction.guild.id);

      if (interaction.customId === "ticket_open") return createTicket(interaction, settings);

      const ticket = db.tickets[interaction.channel?.id];

      if (interaction.customId === "ticket_claim") {
        if (!ticket) return interaction.reply({ content: "❌ التذكرة غير مسجلة.", ephemeral: true });
        return claimTicket(interaction, ticket, settings);
      }

      if (interaction.customId === "ticket_unclaim") {
        if (!ticket) return interaction.reply({ content: "❌ التذكرة غير مسجلة.", ephemeral: true });
        return unclaimTicket(interaction, ticket, settings);
      }

      if (interaction.customId === "ticket_lock") {
        if (!ticket) return interaction.reply({ content: "❌ التذكرة غير مسجلة.", ephemeral: true });
        return lockTicket(interaction, ticket, settings, !ticket.locked);
      }

      if (interaction.customId === "ticket_close") {
        if (!ticket) return interaction.reply({ content: "❌ التذكرة غير مسجلة.", ephemeral: true });
        return requestClose(interaction, ticket, settings);
      }

      if (interaction.customId === "close_cancel") {
        return interaction.update({ content: "❌ تم إلغاء الإغلاق.", components: [] });
      }

      if (interaction.customId === "close_confirm") {
        if (!ticket) return interaction.update({ content: "❌ التذكرة غير موجودة.", components: [] });
        await interaction.update({ content: "⏳ جاري إغلاق التذكرة...", components: [] });
        return actuallyClose(interaction, ticket, settings);
      }

      if (interaction.customId.startsWith("rating_")) {
        const [, value, channelId] = interaction.customId.split("_");
        const rating = Number(value);
        const t = db.tickets[channelId];
        if (!t) return interaction.reply({ content: "❌ التذكرة غير موجودة.", ephemeral: true });
        if (t.userId !== interaction.user.id) return interaction.reply({ content: "❌ هذا التقييم لصاحب التذكرة فقط.", ephemeral: true });
        if (t.rated) return interaction.reply({ content: "❌ تم إرسال التقييم بالفعل.", ephemeral: true });

        t.rating = rating;
        t.rated = true;
        saveDB();

        if (t.claimedBy) addStat(interaction.guild.id, t.claimedBy, "ratings"), addStat(interaction.guild.id, t.claimedBy, "ratingSum", rating);

        await interaction.update({
          content: `⭐ شكرًا لك! تم تسجيل تقييمك: ${stars(rating)} (${rating}/5)`,
          embeds: [],
          components: []
        });

        await sendLog(interaction.guild, settings, new EmbedBuilder()
          .setTitle("⭐ Ticket Rated")
          .setDescription(`التذكرة: <#${channelId}>\nالتقييم: ${stars(rating)} (${rating}/5)\nبواسطة: <@${interaction.user.id}>`)
          .setTimestamp()
        );
        return;
      }

      if (interaction.customId === "application_open") {
        if (!settings.applicationChannel) return interaction.reply({ content: "❌ لم يتم تحديد روم التقديم.", ephemeral: true });

        const modal = new ModalBuilder().setCustomId("application_modal").setTitle("📋 التقديم");
        const name = new TextInputBuilder().setCustomId("name").setLabel("اسمك / اسمك في السيرفر").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100);
        const experience = new TextInputBuilder().setCustomId("experience").setLabel("خبرتك").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
        const reason = new TextInputBuilder().setCustomId("reason").setLabel("لماذا تريد التقديم؟").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000);
        modal.addComponents(
          new ActionRowBuilder().addComponents(name),
          new ActionRowBuilder().addComponents(experience),
          new ActionRowBuilder().addComponents(reason)
        );
        return interaction.showModal(modal);
      }
    }

    if (interaction.isModalSubmit()) {
      if (interaction.customId === "panel_edit_modal") {
        if (!isServerManager(interaction.member)) return interaction.reply({ content: "❌ لا تملك الصلاحية.", ephemeral: true });
        const settings = getGuild(interaction.guild.id);
        settings.panel.title = interaction.fields.getTextInputValue("title");
        settings.panel.description = interaction.fields.getTextInputValue("description");
        settings.panel.buttonText = interaction.fields.getTextInputValue("button");
        const color = interaction.fields.getTextInputValue("color");
        if (/^#[0-9A-Fa-f]{6}$/.test(color)) settings.panel.color = color;
        settings.panel.footer = interaction.fields.getTextInputValue("footer") || "نظام التذاكر";
        saveDB();

        let updated = false;
        if (settings.panelChannel && settings.panelMessage) {
          const ch = interaction.guild.channels.cache.get(settings.panelChannel);
          if (ch?.isTextBased()) {
            const msg = await ch.messages.fetch(settings.panelMessage).catch(() => null);
            if (msg) {
              await msg.edit({ embeds: [panelEmbed(settings)], components: [panelRow(settings)] }).catch(() => {});
              updated = true;
            }
          }
        }

        return interaction.reply({
          content: updated ? "✅ تم تعديل الـPanel وتحديث الرسالة القديمة." : "✅ تم حفظ التعديلات. استخدم `/panel` لإرسال Panel جديد.",
          ephemeral: true
        });
      }

      if (interaction.customId === "application_modal") {
        const settings = getGuild(interaction.guild.id);
        const app = {
          id: `${interaction.guild.id}-${interaction.user.id}-${Date.now()}`,
          guildId: interaction.guild.id,
          userId: interaction.user.id,
          name: interaction.fields.getTextInputValue("name"),
          experience: interaction.fields.getTextInputValue("experience"),
          reason: interaction.fields.getTextInputValue("reason"),
          createdAt: Date.now()
        };
        db.applications[app.id] = app;
        saveDB();

        const target = settings.applicationChannel ? interaction.guild.channels.cache.get(settings.applicationChannel) : null;
        if (target?.isTextBased()) {
          await target.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("📋 تقديم جديد")
                .setDescription(`👤 المتقدم: <@${interaction.user.id}>`)
                .addFields(
                  { name: "الاسم", value: safeText(app.name), inline: false },
                  { name: "الخبرة", value: safeText(app.experience), inline: false },
                  { name: "سبب التقديم", value: safeText(app.reason), inline: false }
                )
                .setTimestamp()
            ]
          });
        }

        return interaction.reply({ content: "✅ تم إرسال تقديمك بنجاح.", ephemeral: true });
      }
    }
  } catch (error) {
    console.error(error);
    if (!interaction.replied && !interaction.deferred) {
      interaction.reply({ content: "❌ حدث خطأ غير متوقع.", ephemeral: true }).catch(() => {});
    }
  }
});

// ==================================================
// PREFIX COMMANDS
// ==================================================

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();
  const settings = getGuild(message.guild.id);
  const level = staffLevel(message.member, settings);

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

  if (content === "$وقتي") {
    const ticket = db.tickets[message.channel.id];
    if (!ticket || ticket.userId !== message.author.id) return;
    const claim = ticket.claimedBy ? `<@${ticket.claimedBy}>` : "غير مستلمة";
    return message.reply(`🎫 التذكرة: ${message.channel}\n📥 المستلم: ${claim}\n📌 الحالة: ${ticket.status}`);
  }

  const action = aliases[content];
  if (!action) return;

  const ticket = db.tickets[message.channel.id];
  if (!ticket) return message.reply("❌ هذا الروم ليس تذكرة.");

  const fake = {
    guild: message.guild,
    channel: message.channel,
    member: message.member,
    user: message.author,
    reply: async payload => message.reply(payload),
    followUp: async payload => message.reply(payload)
  };

  if (action === "lock") return lockTicket(fake, ticket, settings, true);
  if (action === "unlock") return lockTicket(fake, ticket, settings, false);
  if (action === "close") return requestClose(fake, ticket, settings);
  if (action === "delete") return deleteTicket(fake, ticket, settings);
});

// ==================================================
// LOGIN
// ==================================================

client.once("ready", () => {
  console.log(`🤖 ${client.user.tag} is online.`);
  console.log(`Servers: ${client.guilds.cache.size}`);
});

(async () => {
  try {
    await registerCommands();
    await client.login(TOKEN);
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
})();
