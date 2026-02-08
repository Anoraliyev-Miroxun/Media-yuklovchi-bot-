import { Telegraf, Markup } from 'telegraf';
import { sequelize } from './db/index.js';
import { envConfig } from './config/index.js';
import UserService from './service/user.service.js';
import fs from 'fs';
import { join } from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const token = envConfig.bot.token;
if (!token) throw new Error("❌ BOT_TOKEN topilmadi! .env faylini tekshiring.");

// ====================================
// BOT SOZLAMALARI (YAXSHILANGAN)
// ====================================
const botOptions = {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        webhookReply: false,
        agent: null,
        attachmentAgent: null,
    },
    handlerTimeout: 90000 // 90 soniya (5 daqiqadan kam)
};

// Production muhitida SSL xatolarini o'chirmaslik kerak
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const bot = new Telegraf(token, botOptions);
const username_bot = "@media_yuklaydibu_bot";

// ====================================
// CACHE TIZIMI (YAXSHILANGAN)
// ====================================
const cache = new Map();
const MAX_CACHE_SIZE = 1000; // Max 1000 ta element

// Cache tozalash (har 5 daqiqada)
setInterval(() => {
    const now = Date.now();
    const entriesToDelete = [];
    
    for (let [key, value] of cache.entries()) {
        // 30 daqiqadan eski elementlarni o'chirish
        if (value.timestamp && (now - value.timestamp > 30 * 60 * 1000)) {
            entriesToDelete.push(key);
        }
    }
    
    entriesToDelete.forEach(key => cache.delete(key));
    
    // Agar cache juda katta bo'lsa, eski elementlarni o'chirish
    if (cache.size > MAX_CACHE_SIZE) {
        const sorted = Array.from(cache.entries())
            .sort((a, b) => a[1].timestamp - b[1].timestamp);
        
        const toDelete = sorted.slice(0, cache.size - MAX_CACHE_SIZE);
        toDelete.forEach(([key]) => cache.delete(key));
    }
    
    if (entriesToDelete.length > 0) {
        console.log(`🧹 Cache tozalandi: ${entriesToDelete.length} ta element o'chirildi`);
    }
}, 5 * 60 * 1000);

// ====================================
// YUKLASH QUEUE TIZIMI
// ====================================
class DownloadQueue {
    constructor(maxConcurrent = 3) {
        this.queue = [];
        this.active = 0;
        this.maxConcurrent = maxConcurrent;
    }

    async add(task) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, resolve, reject });
            this.process();
        });
    }

    async process() {
        if (this.active >= this.maxConcurrent || this.queue.length === 0) {
            return;
        }

        this.active++;
        const { task, resolve, reject } = this.queue.shift();

        try {
            const result = await task();
            resolve(result);
        } catch (err) {
            reject(err);
        } finally {
            this.active--;
            this.process();
        }
    }

    getQueueLength() {
        return this.queue.length;
    }

    getActiveCount() {
        return this.active;
    }
}

const downloadQueue = new DownloadQueue(3); // Max 3 ta parallel yuklash

// ====================================
// TIZIM TEKSHIRISH FUNKSIYALARI
// ====================================
function checkYtDlp() {
    try {
        const version = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
        console.log(`✅ yt-dlp: ${version}`);
        
        const helpOutput = execSync('yt-dlp --help', { encoding: 'utf-8' });
        const hasImpersonation = helpOutput.includes('--impersonate');
        
        if (hasImpersonation) {
            console.log("✅ TikTok impersonation qo'llab-quvvatlanadi");
            
            try {
                const targets = execSync('yt-dlp --list-impersonate-targets 2>/dev/null || echo ""', 
                    { encoding: 'utf-8' }).trim();
                if (targets) {
                    const targetList = targets.split('\n').filter(line => 
                        line.includes('chrome') && !line.includes('info')
                    );
                    if (targetList.length > 0) {
                        console.log("📋 Chrome targets mavjud");
                    }
                }
            } catch (e) {
                // Ignore
            }
        } else {
            console.log("⚠️  TikTok impersonation yo'q");
            console.log("    Yangilash: sudo pip3 install -U yt-dlp --break-system-packages");
            console.log("    curl-impersonate o'rnatish kerak!");
        }
        
        return hasImpersonation;
    } catch (err) {
        console.error("❌ yt-dlp topilmadi!");
        console.error("   O'rnatish: sudo pip3 install -U yt-dlp --break-system-packages");
        process.exit(1);
    }
}

function checkFfmpeg() {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        console.log("✅ ffmpeg o'rnatilgan");
        return true;
    } catch (err) {
        console.error("⚠️  ffmpeg yo'q! O'rnatish: sudo apt install ffmpeg");
        return false;
    }
}

async function checkConnection() {
    try {
        console.log("🌐 Internet tekshirilmoqda...");
        
        execSync('ping -c 1 -W 5 8.8.8.8', { stdio: 'ignore', timeout: 5000 });
        console.log("✅ Internet ishlayapti");
        
        try {
            execSync('ping -c 1 -W 5 api.telegram.org', { stdio: 'ignore', timeout: 5000 });
            console.log("✅ Telegram API ga ping bor");
        } catch (err) {
            console.log("⚠️  Telegram API ga ping yo'q (normal, ba'zan bloklangan)");
        }
        
        return true;
    } catch (err) {
        console.error("❌ Internet yo'q!");
        return false;
    }
}

// ====================================
// YORDAMCHI FUNKSIYALAR
// ====================================
function detectPlatform(url) {
    if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) return 'tiktok';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    return 'other';
}

function cleanUrl(url) {
    if (url.includes('tiktok.com')) {
        const match = url.match(/(https?:\/\/[^\s]+)/);
        if (match) {
            let cleanedUrl = match[1].split(/\s+/)[0];
            cleanedUrl = cleanedUrl.split('?')[0];
            return cleanedUrl;
        }
    }
    return url.split(/\s+/)[0];
}

function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Cookies fayllarini tekshirish
function checkCookies() {
    const cookiesFiles = {
        instagram: './www.instagram.com_cookies.txt',
        tiktok: './www.tiktok.com_cookies.txt'
    };
    
    const available = {};
    
    for (const [platform, file] of Object.entries(cookiesFiles)) {
        if (fs.existsSync(file)) {
            console.log(`🍪 ${platform} cookies topildi`);
            available[platform] = file;
        } else {
            console.log(`⚠️  ${platform} cookies yo'q (${file})`);
        }
    }
    
    return available;
}

// ====================================
// VIDEO INFO OLISH (RETRY BILAN)
// ====================================
async function getVideoInfo(url, platform, hasImpersonation, cookiesFiles, retries = 2) {
    let lastError;
    
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            let command = `yt-dlp --dump-single-json --no-warnings --no-check-certificates --skip-download --socket-timeout 30`;

            // Cookies qo'shish
            if (cookiesFiles[platform]) {
                command += ` --cookies ${cookiesFiles[platform]}`;
            }

            // Platform-specific sozlamalar
            if (platform === 'tiktok' && hasImpersonation) {
                command += ` --impersonate chrome`;
            }

            if (platform === 'instagram') {
                command += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"`;
            }

            command += ` "${url}"`;

            const { stdout } = await execAsync(command, { 
                maxBuffer: 10 * 1024 * 1024,
                timeout: 45000 
            });
            
            const info = JSON.parse(stdout);
            return { success: true, data: info };
            
        } catch (err) {
            lastError = err;
            console.error(`⚠️  Info xato (${platform}, urinish ${attempt + 1}/${retries + 1}):`, err.message.split('\n')[0]);
            
            if (attempt < retries) {
                // Retry qilishdan oldin kutish
                await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
            }
        }
    }
    
    return { success: false, error: lastError.message };
}

// ====================================
// TO'G'RIDAN-TO'G'RI YUKLASH (YAXSHILANGAN)
// ====================================
async function downloadDirect(ctx, url, platform, hasImpersonation, cookiesFiles) {
    let waitMsg = null;
    let tempFile = null;
    
    try {
        // Queue holatini ko'rsatish
        const queueLength = downloadQueue.getQueueLength();
        const activeCount = downloadQueue.getActiveCount();
        
        if (queueLength > 0) {
            waitMsg = await ctx.reply(`⏳ Navbatda: ${queueLength} ta video\n⚙️ Yuklanmoqda: ${activeCount} ta`);
        } else {
            waitMsg = await ctx.reply("⏳ Video yuklanmoqda...");
        }
        
        console.log(`⬇️ To'g'ridan-to'g'ri yuklash: ${platform} (Queue: ${queueLength}, Active: ${activeCount})`);
        
        // Queue ga qo'shish
        const result = await downloadQueue.add(async () => {
            const shortId = `direct_${ctx.from.id}_${Date.now()}`;
            tempFile = join("/tmp", `${shortId}.mp4`);

            let command = `yt-dlp --output "${tempFile}" --format "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" --merge-output-format mp4 --no-check-certificates --retries 3`;

            // Cookies
            if (cookiesFiles[platform]) {
                command += ` --cookies ${cookiesFiles[platform]}`;
            }

            // Platform sozlamalar
            if (platform === 'tiktok' && hasImpersonation) {
                command += ` --impersonate chrome`;
            }

            if (platform === 'instagram') {
                command += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"`;
            }

            command += ` "${url}"`;

            await execAsync(command, { 
                maxBuffer: 100 * 1024 * 1024,
                timeout: 120000 // 2 daqiqa
            });

            if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
                throw new Error("Fayl yuklanmadi");
            }

            return tempFile;
        });

        const stats = fs.statSync(result);
        console.log(`   ✅ Fayl tayyor: ${formatFileSize(stats.size)}`);
        
        if (stats.size > 2 * 1024 * 1024 * 1024) {
            throw new Error(`Fayl juda katta: ${formatFileSize(stats.size)} (Telegram max 2GB)`);
        }

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        
        await ctx.replyWithVideo(
            { source: fs.createReadStream(result) },
            { 
                caption: `🎥 ${platform.toUpperCase()}\n📦 ${formatFileSize(stats.size)}\n\n📥 ${username_bot}`,
                supports_streaming: true
            }
        );

        // Faylni o'chirish
        fs.unlinkSync(result);
        console.log(`✅ Yuborildi va o'chirildi: ${formatFileSize(stats.size)}\n`);

    } catch (err) {
        console.error("❌ Yuklash xatosi:", err.message);
        
        if (tempFile && fs.existsSync(tempFile)) {
            fs.unlinkSync(tempFile);
        }
        
        if (waitMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        }
        
        let errorMsg = "❌ Video yuklanmadi.\n\n";
        
        if (err.message.includes('impersonate') || err.message.includes('Impersonate')) {
            errorMsg += "🔧 **TikTok yangi himoya**\n\n";
            errorMsg += "Yechim:\n";
            errorMsg += "1. `curl-impersonate` o'rnating\n";
            errorMsg += "2. yt-dlp ni yangilang: `sudo pip3 install -U yt-dlp --break-system-packages`";
        } else if (err.message.includes('429') || err.message.includes('Too Many Requests')) {
            errorMsg += "⏱️ **Juda ko'p so'rov**\n";
            errorMsg += "1-2 daqiqa kuting va qayta urinib ko'ring.";
        } else if (err.message.includes('login required') || err.message.includes('rate-limit')) {
            errorMsg += `🔒 **${platform.toUpperCase()} bloklagan**\n\n`;
            errorMsg += cookiesFiles[platform] 
                ? "Cookies faylni yangilang (eskirgan)." 
                : "Cookies fayl kerak. Qo'llanmaga qarang.";
        } else if (err.message.includes('private') || err.message.includes('not available')) {
            errorMsg += "🔒 Video privat yoki o'chirilgan.";
        } else if (err.message.includes('juda katta')) {
            errorMsg += err.message;
        } else {
            errorMsg += "💡 Boshqa link yoki formatni sinab ko'ring.";
        }
        
        ctx.reply(errorMsg, { parse_mode: 'Markdown' });
    }
}

// ====================================
// BOT HANDLERLAR
// ====================================
async function start(hasImpersonation, cookiesFiles) {
    // /start
    bot.start(async (ctx) => {
        console.log(`👤 Start: ${ctx.from.first_name} (@${ctx.from.username || 'yo\'q'})`);
        
        try {
            const user = await UserService.getById(ctx.from.id);
            if (!user) {
                await UserService.create(ctx.from);
                console.log("✅ Yangi user:", ctx.from.first_name);
            } else {
                await UserService.update(ctx.from.id, {
                    username: ctx.from.username,
                    first_name: ctx.from.first_name
                });
            }
        } catch (err) {
            console.error("❌ User xatosi:", err.message);
        }

        const cookieStatus = cookiesFiles.instagram 
            ? "✅ Instagram cookies bor" 
            : "⚠️ Instagram cookies yo'q";

        ctx.reply(
            `👋 Salom, <b>${ctx.from.first_name}</b>!\n\n` +
            `🎬 Video yuklovchi bot\n\n` +
            `✅ TikTok${hasImpersonation ? ' (impersonate)' : ''}\n` +
            `✅ Instagram\n` +
            `✅ YouTube\n` +
            `✅ Facebook\n` +
            `✅ Twitter\n\n` +
            `📤 Havola yuboring!\n\n` +
            `📊 Status: ${cookieStatus}`,
            { parse_mode: 'HTML' }
        );
    });

    // Text xabarlar (YAXSHILANGAN)
    bot.on("text", async (ctx) => {
        let rawUrl = ctx.message.text.trim();
        
        if (!rawUrl.startsWith("http")) {
            return ctx.reply("❌ To'g'ri havola yuboring (http:// yoki https:// bilan).");
        }

        const url = cleanUrl(rawUrl);
        const platform = detectPlatform(url);
        
        console.log(`📩 ${platform}: ${url.substring(0, 50)}... (@${ctx.from.username || ctx.from.first_name})`);
        
        try {
            await ctx.sendChatAction("typing");
            const waitMsg = await ctx.reply("🔎 Tekshirilmoqda...");

            // Info olish (retry bilan)
            const result = await getVideoInfo(url, platform, hasImpersonation, cookiesFiles, 2);

            if (!result.success) {
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                
                // Agar info olmasa, to'g'ridan-to'g'ri yuklashga o'tish
                return await downloadDirect(ctx, url, platform, hasImpersonation, cookiesFiles);
            }

            const info = result.data;

            // Formatlarni tayyorlash
            let videoFormats = [];
            let audioFormat = null;
            let seen = new Set();

            if (info.formats && info.formats.length > 0) {
                info.formats.forEach((f) => {
                    if (f.vcodec && f.vcodec !== "none" && f.height) {
                        const key = `${f.height}p`;
                        if (!seen.has(key) && f.height >= 240) { // Faqat 240p dan yuqori
                            videoFormats.push({
                                height: f.height,
                                label: key,
                                formatId: f.format_id,
                                filesize: f.filesize || f.filesize_approx || 0
                            });
                            seen.add(key);
                        }
                    }
                    
                    if (!audioFormat && f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")) {
                        audioFormat = {
                            formatId: f.format_id,
                            filesize: f.filesize || f.filesize_approx || 0
                        };
                    }
                });

                videoFormats.sort((a, b) => b.height - a.height);
                videoFormats = videoFormats.slice(0, 4); // Faqat 4 ta eng yaxshi format
            }

            if (videoFormats.length === 0) {
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                return await downloadDirect(ctx, url, platform, hasImpersonation, cookiesFiles);
            }

            // Tugmalar yaratish
            let buttons = [];
            let text = `🎬 <b>${(info.title || 'Video').substring(0, 100)}</b>\n`;
            
            if (info.uploader) text += `👤 ${info.uploader}\n`;
            if (info.duration) {
                const min = Math.floor(info.duration / 60);
                const sec = info.duration % 60;
                text += `⏱️ ${min}:${sec.toString().padStart(2, '0')}\n`;
            }
            
            if (info.view_count) {
                text += `👁️ ${info.view_count.toLocaleString()} ko'rildi\n`;
            }
            
            text += `\n📺 Formatlar:\n`;

            // Video tugmalari
            videoFormats.forEach(({ height, label, formatId, filesize }) => {
                const shortId = `${ctx.from.id}_${formatId}_${Date.now()}`;
                
                cache.set(shortId, { 
                    url, 
                    formatId, 
                    type: "video", 
                    title: info.title || 'Video',
                    uploader: info.uploader || '',
                    platform,
                    timestamp: Date.now()
                });

                const size = filesize > 0 ? ` (${formatFileSize(filesize)})` : "";
                const btn = `🎥 ${label}${size}`;
                
                buttons.push([Markup.button.callback(btn, `dl_${shortId}`)]);
            });

            // Audio tugma
            if (audioFormat) {
                const shortId = `${ctx.from.id}_${audioFormat.formatId}_${Date.now()}`;
                
                cache.set(shortId, { 
                    url, 
                    formatId: audioFormat.formatId, 
                    type: "audio", 
                    title: info.title || 'Audio',
                    uploader: info.uploader || '',
                    platform,
                    timestamp: Date.now()
                });

                const size = audioFormat.filesize > 0 ? ` (${formatFileSize(audioFormat.filesize)})` : "";
                buttons.push([Markup.button.callback(`🎵 Audio${size}`, `dl_${shortId}`)]);
            }

            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
            
            // Thumbnail bilan yuborish
            if (info.thumbnail) {
                try {
                    await ctx.replyWithPhoto(info.thumbnail, {
                        caption: text,
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard(buttons)
                    });
                } catch {
                    await ctx.reply(text, {
                        parse_mode: "HTML",
                        ...Markup.inlineKeyboard(buttons)
                    });
                }
            } else {
                await ctx.reply(text, {
                    parse_mode: "HTML",
                    ...Markup.inlineKeyboard(buttons)
                });
            }

        } catch (err) {
            console.error("❌ Xato:", err.message);
            ctx.reply("❌ Xatolik yuz berdi. Keyinroq qayta urinib ko'ring.");
        }
    });

    // Download callback (YAXSHILANGAN)
    bot.action(/dl_.+/, async (ctx) => {
        const shortId = ctx.callbackQuery.data.replace("dl_", "");
        const info = cache.get(shortId);

        if (!info) {
            return ctx.answerCbQuery("❌ Muddati tugagan. Link qayta yuboring.", { show_alert: true });
        }

        console.log(`⬇️ Yuklash: ${info.title.substring(0, 30)}... (@${ctx.from.username || ctx.from.first_name})`);

        try {
            await ctx.answerCbQuery("⏳ Yuklanmoqda...");
            
            const queueLength = downloadQueue.getQueueLength();
            
            if (queueLength > 5) {
                return ctx.answerCbQuery("⏱️ Juda ko'p navbat. Keyinroq urinib ko'ring.", { show_alert: true });
            }
            
            await ctx.sendChatAction(info.type === "video" ? "upload_video" : "upload_audio");

            let tempFile = null;

            const result = await downloadQueue.add(async () => {
                const fileId = `${shortId}_${Date.now()}`;
                tempFile = join("/tmp", `${fileId}.${info.type === "video" ? "mp4" : "m4a"}`);

                let command = `yt-dlp --output "${tempFile}" --no-check-certificates --retries 3`;

                if (info.type === "video") {
                    command += ` --format "${info.formatId}+bestaudio/best" --merge-output-format mp4`;
                } else {
                    command += ` --format "${info.formatId}"`;
                }

                // Cookies
                if (cookiesFiles[info.platform]) {
                    command += ` --cookies ${cookiesFiles[info.platform]}`;
                }

                // Platform
                if (info.platform === 'tiktok' && hasImpersonation) {
                    command += ` --impersonate chrome`;
                }

                if (info.platform === 'instagram') {
                    command += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"`;
                }

                command += ` "${info.url}"`;

                await execAsync(command, { 
                    maxBuffer: 100 * 1024 * 1024,
                    timeout: 120000
                });

                if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
                    throw new Error("Fayl yuklanmadi");
                }

                return tempFile;
            });

            const stats = fs.statSync(result);
            
            if (stats.size > 2 * 1024 * 1024 * 1024) {
                fs.unlinkSync(result);
                return ctx.reply(`❌ Juda katta: ${formatFileSize(stats.size)} (Max 2GB)`);
            }

            const caption = `${info.type === "video" ? "🎥" : "🎵"} ${info.title.substring(0, 200)}\n` +
                          `${info.uploader ? `👤 ${info.uploader}\n` : ''}` +
                          `📦 ${formatFileSize(stats.size)}\n\n📥 ${username_bot}`;

            if (info.type === "video") {
                await ctx.replyWithVideo(
                    { source: fs.createReadStream(result) },
                    { caption, supports_streaming: true }
                );
            } else {
                await ctx.replyWithAudio(
                    { source: fs.createReadStream(result) },
                    { caption, performer: info.uploader || 'Unknown', title: info.title }
                );
            }

            fs.unlinkSync(result);
            console.log(`✅ Yuborildi: ${formatFileSize(stats.size)}\n`);

        } catch (err) {
            console.error("❌ Callback xato:", err.message);
            ctx.reply("❌ Yuklashda xatolik. Boshqa format tanlang yoki keyinroq urinib ko'ring.");
        }
    });

    // Error handler
    bot.catch((err, ctx) => {
        console.error(`❌ Bot xatosi [${ctx.updateType}]:`, err);
        
        if (ctx.chat) {
            ctx.reply("❌ Ichki xatolik. Keyinroq qayta urinib ko'ring.")
                .catch(() => console.error("Xato xabarini yuborib bo'lmadi"));
        }
    });

    process.once('SIGINT', () => {
        console.log("\n👋 Bot to'xtatilmoqda (SIGINT)...");
        bot.stop('SIGINT');
    });
    
    process.once('SIGTERM', () => {
        console.log("\n👋 Bot to'xtatilmoqda (SIGTERM)...");
        bot.stop('SIGTERM');
    });
}

// ====================================
// ASOSIY ISHGA TUSHIRISH
// ====================================
(async () => {
    try {
        console.log("\n🚀 Bot ishga tushmoqda...\n");
        console.log("=".repeat(50));
        
        // Database
        await sequelize.authenticate();
        console.log("✅ Database ulanish OK");
        await sequelize.sync({ alter: true });
        console.log("✅ Database sync OK");
        
        // Tizim tekshirish
        const hasImpersonation = checkYtDlp();
        checkFfmpeg();
        const cookiesFiles = checkCookies();
        
        const hasInternet = await checkConnection();
        if (!hasInternet) {
            console.error("\n❌ Internet yo'q! Bot ishlamaydi.\n");
            process.exit(1);
        }
        
        console.log("=".repeat(50));
        console.log();

        // Handlerlarni sozlash
        await start(hasImpersonation, cookiesFiles);

        // Bot ishga tushirish (retry)
        let retries = 3;
        let launched = false;
        
        while (retries > 0 && !launched) {
            try {
                console.log(`🚀 Telegram API ga ulanilmoqda (${4 - retries}/3)...`);
                await bot.launch();
                launched = true;
            } catch (err) {
                retries--;
                console.error(`❌ Ulanish xatosi (${3 - retries}/3):`);
                console.error(`   ${err.message}`);
                
                if (retries > 0) {
                    console.log(`   🔄 5 soniyadan keyin qayta...`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    throw err;
                }
            }
        }
        
        const botInfo = await bot.telegram.getMe();
        
        console.log("\n" + "=".repeat(50));
        console.log("✅ BOT ISHGA TUSHDI!");
        console.log("=".repeat(50));
        console.log(`📱 @${botInfo.username}`);
        console.log(`🆔 Bot ID: ${botInfo.id}`);
        console.log(`🌍 Muhit: ${process.env.NODE_ENV || 'development'}`);
        console.log(`📊 Impersonation: ${hasImpersonation ? 'HA' : 'YO\'Q'}`);
        console.log(`🍪 Cookies: Instagram ${cookiesFiles.instagram ? '✅' : '❌'}, TikTok ${cookiesFiles.tiktok ? '✅' : '❌'}`);
        console.log(`⚙️  Max parallel: ${downloadQueue.maxConcurrent}`);
        console.log("=".repeat(50) + "\n");
        
        console.log("📝 Loglar:\n");

    } catch (err) {
        console.error("\n" + "=".repeat(50));
        console.error("❌ KRITIK XATO!");
        console.error("=".repeat(50));
        console.error(`Xato: ${err.message}`);
        
        if (err.code) {
            console.error(`Kod: ${err.code}`);
        }
        
        console.error("\n🔧 YECHIMLAR:");
        
        if (err.message.includes('Conflict') || err.message.includes('409')) {
            console.error("• Eski bot jarayonini to'xtating: pkill -f 'node.*bot.js'");
        } else if (err.message.includes('Unauthorized') || err.message.includes('401')) {
            console.error("• BOT_TOKEN ni .env da tekshiring");
        } else if (err.code === 'ENOTFOUND') {
            console.error("• DNS muammosi. DNS ni o'zgartiring: 8.8.8.8");
        } else if (err.code === 'ETIMEDOUT' || err.code === 'ECONNREFUSED') {
            console.error("• Firewall yoki Telegram bloklangan");
            console.error("• VPN yoqib ko'ring");
        } else {
            console.error("• Qo'llanmaga qarang: bot_sozlash_qollanma.md");
        }
        
        console.error("=".repeat(50) + "\n");
        process.exit(1);
    }
})();