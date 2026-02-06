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

// Bot sozlamalari
const botOptions = {
    telegram: {
        apiRoot: 'https://api.telegram.org',
        webhookReply: false,
    },
    handlerTimeout: 300_000 // 5 daqiqa
};

const bot = new Telegraf(token, botOptions);
const username_bot = "@media_yuklaydibu_bot";

// Cache
let cache = new Map();

// Cache tozalash (har 10 daqiqada)
setInterval(() => {
    const now = Date.now();
    for (let [key, value] of cache.entries()) {
        if (value.timestamp && (now - value.timestamp > 30 * 60 * 1000)) {
            cache.delete(key);
        }
    }
}, 10 * 60 * 1000);

// yt-dlp versiyasini tekshirish
function checkYtDlp() {
    try {
        const version = execSync('yt-dlp --version', { encoding: 'utf-8' }).trim();
        console.log(`✅ yt-dlp: ${version}`);
        
        // Impersonation mavjudligini tekshirish
        const helpOutput = execSync('yt-dlp --help', { encoding: 'utf-8' });
        const hasImpersonation = helpOutput.includes('--impersonate');
        
        if (hasImpersonation) {
            console.log("✅ TikTok impersonation qo'llab-quvvatlanadi");
            
            // Mavjud targetlarni ko'rsatish
            try {
                const targets = execSync('yt-dlp --list-impersonate-targets 2>/dev/null || echo ""', 
                    { encoding: 'utf-8' }).trim();
                if (targets) {
                    console.log("📋 Impersonate targets:", targets.split('\n').slice(0, 3).join(', '));
                }
            } catch (e) {
                // Ignore
            }
        } else {
            console.log("⚠️  TikTok impersonation yo'q");
            console.log("    Yangilash: sudo pip3 install -U yt-dlp --break-system-packages");
        }
        
        return hasImpersonation;
    } catch (err) {
        console.error("❌ yt-dlp topilmadi!");
        console.error("   O'rnatish: sudo apt install yt-dlp YOKI");
        console.error("              sudo pip3 install -U yt-dlp --break-system-packages");
        process.exit(1);
    }
}

// ffmpeg tekshirish
function checkFfmpeg() {
    try {
        execSync('ffmpeg -version', { stdio: 'ignore' });
        console.log("✅ ffmpeg o'rnatilgan");
    } catch (err) {
        console.error("⚠️  ffmpeg yo'q! O'rnatish: sudo apt install ffmpeg");
    }
}

// Internet va Telegram API tekshirish
async function checkConnection() {
    try {
        console.log("🌐 Internet tekshirilmoqda...");
        
        // Google ping
        execSync('ping -c 1 google.com', { stdio: 'ignore', timeout: 5000 });
        console.log("✅ Internet ishlayapti");
        
        // Telegram API ping
        try {
            execSync('ping -c 1 api.telegram.org', { stdio: 'ignore', timeout: 5000 });
            console.log("✅ Telegram API ga ulanish bor");
        } catch (err) {
            console.log("⚠️  Telegram API ga ping yo'q (VPN kerak bo'lishi mumkin)");
        }
        
        return true;
    } catch (err) {
        console.error("❌ Internet yo'q!");
        console.error("   Tekshiring: ping google.com");
        return false;
    }
}

// Platforma aniqlash
function detectPlatform(url) {
    if (url.includes('tiktok.com') || url.includes('vm.tiktok.com')) return 'tiktok';
    if (url.includes('instagram.com')) return 'instagram';
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('facebook.com') || url.includes('fb.watch')) return 'facebook';
    if (url.includes('twitter.com') || url.includes('x.com')) return 'twitter';
    return 'other';
}

// URL tozalash
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

// TIZIM YT-DLP BILAN VIDEO INFO OLISH
async function getVideoInfo(url, platform, hasImpersonation) {
    let command = `yt-dlp --dump-single-json --no-warnings --no-check-certificates --skip-download --socket-timeout 60`;

    // TikTok uchun impersonation (agar mavjud bo'lsa)
    if (platform === 'tiktok' && hasImpersonation) {
        command += ` --impersonate chrome`;
        
        if (fs.existsSync('./cookies.txt')) {
            command += ` --cookies ./cookies.txt`;
        }
    }

    // Instagram uchun user-agent
    if (platform === 'instagram') {
        command += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"`;
    }

    command += ` "${url}"`;

    try {
        const { stdout } = await execAsync(command, { 
            maxBuffer: 10 * 1024 * 1024,
            timeout: 60000 
        });
        const info = JSON.parse(stdout);
        return { success: true, data: info };
    } catch (err) {
        console.error(`⚠️  Info xato (${platform}):`, err.message);
        return { success: false, error: err.message };
    }
}

// TIZIM YT-DLP BILAN TO'G'RIDAN-TO'G'RI YUKLASH
async function downloadDirect(ctx, url, platform, hasImpersonation) {
    let waitMsg = null;
    
    try {
        waitMsg = await ctx.reply("⏳ Video yuklanmoqda...");
        console.log(`⬇️ To'g'ridan-to'g'ri yuklash boshlandi: ${platform}`);
        
        const shortId = `direct_${ctx.from.id}_${Date.now()}`;
        const tempFile = join("/tmp", `${shortId}.mp4`);

        let command = `yt-dlp --output "${tempFile}" --format "best[ext=mp4]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/best" --merge-output-format mp4 --no-check-certificates`;

        // TikTok uchun impersonation
        if (platform === 'tiktok' && hasImpersonation) {
            command += ` --impersonate chrome`;
            console.log("   🔧 TikTok impersonation yoqildi");
            
            if (fs.existsSync('./cookies.txt')) {
                command += ` --cookies ./cookies.txt`;
                console.log("   🍪 Cookies ishlatilmoqda");
            }
        }

        // Instagram uchun
        if (platform === 'instagram') {
            command += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"`;
            console.log("   📱 Instagram user-agent o'rnatildi");
        }

        command += ` "${url}"`;

        console.log("   ⏳ Fayl yuklanmoqda...");
        await execAsync(command, { 
            maxBuffer: 100 * 1024 * 1024,
            timeout: 180000 // 3 daqiqa
        });

        if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
            throw new Error("Fayl yuklanmadi");
        }

        const stats = fs.statSync(tempFile);
        console.log(`   ✅ Fayl yuklandi: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);
        
        if (stats.size > 2 * 1024 * 1024 * 1024) {
            fs.unlinkSync(tempFile);
            await ctx.telegram.editMessageText(
                ctx.chat.id,
                waitMsg.message_id,
                null,
                `❌ Fayl juda katta: ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB\n\nTelegram max 2GB.`
            );
            return;
        }

        await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        
        console.log("   📤 Telegram ga yuborilmoqda...");
        await ctx.replyWithVideo(
            { source: fs.createReadStream(tempFile) },
            { 
                caption: `🎥 ${platform.toUpperCase()} video\n📦 ${(stats.size / 1024 / 1024).toFixed(1)} MB\n\n📥 ${username_bot}`,
                supports_streaming: true
            }
        );

        fs.unlinkSync(tempFile);
        console.log(`✅ Yuborildi: ${platform} (${(stats.size / 1024 / 1024).toFixed(1)} MB)\n`);

    } catch (err) {
        console.error("❌ Yuklash xatosi:", err.message);
        
        if (waitMsg) {
            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
        }
        
        let errorMsg = "❌ Video yuklanmadi.\n\n";
        
        if (err.message.includes('impersonate') || err.message.includes('Impersonate')) {
            errorMsg += "🔧 TikTok yangi himoya qo'shgan.\n\n";
            errorMsg += "**Yechim:**\n";
            errorMsg += "1. yt-dlp ni yangilang:\n";
            errorMsg += "   `sudo pip3 install -U yt-dlp --break-system-packages`\n";
            errorMsg += "2. VPN yoqing\n";
            errorMsg += "3. Botni qayta ishga tushiring";
        } else if (err.message.includes('429') || err.message.includes('Too Many Requests')) {
            errorMsg += "⏱️ Juda ko'p so'rov. 1-2 daqiqa kuting.";
        } else if (err.message.includes('private') || err.message.includes('not available')) {
            errorMsg += "🔒 Video privat yoki o'chirilgan.";
        } else if (platform === 'tiktok' || platform === 'instagram') {
            errorMsg += "🔒 Platforma bloklangan.\n\n";
            errorMsg += "**Yechim:** VPN yoqing va qayta urinib ko'ring";
        } else {
            errorMsg += "💡 Boshqa link sinab ko'ring.";
        }
        
        ctx.reply(errorMsg, { parse_mode: 'Markdown' });
    }
}

async function start() {
    // Impersonation mavjudligini tekshirish
    const hasImpersonation = checkYtDlp();
    
    // /start
    bot.start(async (ctx) => {
        console.log(`👤 Yangi: ${ctx.from.first_name} (@${ctx.from.username || 'yo\'q'})`);
        
        try {
            const user = await UserService.getById(ctx.from.id);
            if (!user) {
                await UserService.create(ctx.from);
                console.log("✅ Yangi user yaratildi:", ctx.from.first_name);
            } else {
                await UserService.update(ctx.from.id, {
                    username: ctx.from.username,
                    first_name: ctx.from.first_name
                });
                console.log("🔄 User yangilandi:", ctx.from.first_name);
            }
        } catch (err) {
            console.error("❌ User xatosi:", err.message);
        }

        ctx.reply(
            `👋 Salom, <b>${ctx.from.first_name}</b>!\n\n` +
            `🎬 Video yuklovchi bot\n\n` +
            `✅ TikTok\n✅ Instagram\n✅ YouTube\n✅ Facebook\n✅ Twitter\n\n` +
            `📤 Havola yuboring!\n\n` +
            `⚠️ <i>TikTok/Instagram uchun VPN kerak bo'lishi mumkin</i>`,
            { parse_mode: 'HTML' }
        );
    });

    // Text xabarlar
    bot.on("text", async (ctx) => {
        let rawUrl = ctx.message.text.trim();
        
        // URL ni tozalash
        const url = cleanUrl(rawUrl);
        
        console.log(`📩 ${url.substring(0, 60)}... (${ctx.from.first_name})`);
        
        if (!url.startsWith("http")) {
            return ctx.reply("❌ To'g'ri havola yuboring.");
        }

        const platform = detectPlatform(url);
        
        try {
            await ctx.sendChatAction("typing");
            const waitMsg = await ctx.reply("🔎 Ma'lumot olinmoqda...");

            // Info olish
            const result = await getVideoInfo(url, platform, hasImpersonation);

            if (!result.success) {
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                return await downloadDirect(ctx, url, platform, hasImpersonation);
            }

            const info = result.data;

            // Formatlarni tayyorlash
            let videoFormats = [];
            let audioFormat = null;
            let seen = new Set();

            if (info.formats && info.formats.length > 0) {
                info.formats.forEach((f) => {
                    // Video
                    if (f.vcodec && f.vcodec !== "none" && f.height) {
                        const key = `${f.height}p`;
                        if (!seen.has(key)) {
                            videoFormats.push({
                                height: f.height,
                                label: key,
                                formatId: f.format_id,
                                filesize: f.filesize || f.filesize_approx || 0
                            });
                            seen.add(key);
                        }
                    }
                    
                    // Audio
                    if (!audioFormat && f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none")) {
                        audioFormat = {
                            formatId: f.format_id,
                            filesize: f.filesize || f.filesize_approx || 0
                        };
                    }
                });

                videoFormats.sort((a, b) => b.height - a.height);
                videoFormats = videoFormats.slice(0, 6);
            }

            if (videoFormats.length === 0) {
                await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
                return await downloadDirect(ctx, url, platform, hasImpersonation);
            }

            // Tugmalar
            let buttons = [];
            let text = `🎬 <b>${info.title || 'Video'}</b>\n`;
            
            if (info.uploader) text += `👤 ${info.uploader}\n`;
            if (info.duration) {
                const min = Math.floor(info.duration / 60);
                const sec = info.duration % 60;
                text += `⏱️ ${min}:${sec.toString().padStart(2, '0')}\n`;
            }
            
            text += `\n📺 Sifatlar:\n`;

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

                const size = filesize > 0 ? ` (~${(filesize / 1024 / 1024).toFixed(1)}MB)` : "";
                const btn = `🎥 ${label}${size}`;
                
                buttons.push([Markup.button.callback(btn, `download_${shortId}`)]);
                text += `${btn}\n`;
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

                const size = audioFormat.filesize > 0 ? ` (~${(audioFormat.filesize / 1024 / 1024).toFixed(1)}MB)` : "";
                const btn = `🎵 Audio${size}`;
                
                buttons.push([Markup.button.callback(btn, `download_${shortId}`)]);
                text += `${btn}\n`;
            }

            await ctx.telegram.deleteMessage(ctx.chat.id, waitMsg.message_id).catch(() => {});
            
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
            
            let errorMsg = "❌ Xatolik.\n\n";
            
            if (err.message.includes('impersonate') || err.message.includes('Impersonate')) {
                errorMsg += "🔧 TikTok yangi himoya.\n";
                errorMsg += "Yechim: `sudo pip3 install -U yt-dlp --break-system-packages`";
            } else if (err.message.includes('private')) {
                errorMsg += "🚫 Video privat.";
            } else if (err.message.includes('429')) {
                errorMsg += "⏱️ Kutib qayta urinib ko'ring.";
            } else if (platform === 'tiktok' || platform === 'instagram') {
                errorMsg += "🔒 VPN yoqing.";
            } else {
                errorMsg += "💡 Boshqa link sinab ko'ring.";
            }
            
            ctx.reply(errorMsg, { parse_mode: 'Markdown' });
        }
    });

    // Download callback
    bot.action(/download_.+/, async (ctx) => {
        const shortId = ctx.callbackQuery.data.replace("download_", "");
        const info = cache.get(shortId);

        if (!info) {
            return ctx.answerCbQuery("❌ Muddati tugagan. Qayta yuboring.", { show_alert: true });
        }

        console.log(`⬇️ Yuklash boshlandi: ${info.title} (${ctx.from.first_name})`);

        try {
            await ctx.answerCbQuery("⏳ Yuklanmoqda...");
            await ctx.sendChatAction(info.type === "video" ? "upload_video" : "upload_audio");

            const tempFile = join("/tmp", `${shortId}.${info.type === "video" ? "mp4" : "m4a"}`);

            let command = `yt-dlp --output "${tempFile}" --no-check-certificates`;

            if (info.type === "video") {
                command += ` --format "${info.formatId}+bestaudio/best" --merge-output-format mp4`;
            } else {
                command += ` --format "${info.formatId}"`;
            }

            // TikTok impersonation
            if (info.platform === 'tiktok' && hasImpersonation) {
                command += ` --impersonate chrome`;
                if (fs.existsSync('./cookies.txt')) {
                    command += ` --cookies ./cookies.txt`;
                }
            }

            // Instagram
            if (info.platform === 'instagram') {
                command += ` --user-agent "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"`;
            }

            command += ` "${info.url}"`;

            console.log(`   ⏳ ${info.type === "video" ? "Video" : "Audio"} yuklanmoqda...`);
            await execAsync(command, { 
                maxBuffer: 100 * 1024 * 1024,
                timeout: 180000 
            });

            if (!fs.existsSync(tempFile) || fs.statSync(tempFile).size === 0) {
                throw new Error("Fayl yuklanmadi");
            }

            const stats = fs.statSync(tempFile);
            console.log(`   ✅ Fayl tayyor: ${(stats.size / 1024 / 1024).toFixed(1)} MB`);

            if (stats.size > 2 * 1024 * 1024 * 1024) {
                fs.unlinkSync(tempFile);
                return ctx.reply(`❌ Juda katta: ${(stats.size / 1024 / 1024 / 1024).toFixed(2)} GB`);
            }

            const caption = `${info.type === "video" ? "🎥" : "🎵"} ${info.title}\n` +
                          `${info.uploader ? `👤 ${info.uploader}\n` : ''}` +
                          `📦 ${(stats.size / 1024 / 1024).toFixed(1)} MB\n\n📥 ${username_bot}`;

            console.log("   📤 Telegram ga yuborilmoqda...");
            if (info.type === "video") {
                await ctx.replyWithVideo(
                    { source: fs.createReadStream(tempFile) },
                    { caption, supports_streaming: true }
                );
            } else {
                await ctx.replyWithAudio(
                    { source: fs.createReadStream(tempFile) },
                    { caption, performer: info.uploader || 'Unknown', title: info.title }
                );
            }

            fs.unlinkSync(tempFile);
            console.log(`✅ Yuborildi: ${info.title} (${(stats.size / 1024 / 1024).toFixed(1)} MB)\n`);

        } catch (err) {
            console.error("❌ Yuklash xato:", err.message);
            
            let errorMsg = "❌ Xatolik.\n\n";
            
            if (err.message.includes('impersonate') || err.message.includes('Impersonate')) {
                errorMsg += "TikTok yangi himoya.\nYechim: `sudo pip3 install -U yt-dlp --break-system-packages`";
            } else if (err.message.includes('ffmpeg')) {
                errorMsg += "ffmpeg yo'q: `sudo apt install ffmpeg`";
            } else {
                errorMsg += "Boshqa format tanlang.";
            }
            
            ctx.reply(errorMsg, { parse_mode: 'Markdown' });
        }
    });

    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

// Ishga tushirish
(async () => {
    try {
        console.log("\n🚀 Bot ishga tushmoqda...\n");
        
        // Database
        await sequelize.authenticate();
        console.log("✅ Database");
        await sequelize.sync({ alter: true });
        
        // Tizim tekshiruvi
        checkFfmpeg();
        
        // Internet tekshiruvi
        const hasInternet = await checkConnection();
        if (!hasInternet) {
            console.error("\n❌ Internet yo'q! Bot ishlamaydi.\n");
            process.exit(1);
        }
        
        console.log();

        await start();

        // Bot ishga tushirish (retry bilan)
        let retries = 3;
        let launched = false;
        
        while (retries > 0 && !launched) {
            try {
                await bot.launch();
                launched = true;
            } catch (err) {
                retries--;
                console.error(`⚠️  Telegram ga ulanish xatosi (${3 - retries}/3):`, err.message);
                
                if (retries > 0) {
                    console.log("   🔄 5 soniyadan keyin qayta uriniladi...");
                    await new Promise(resolve => setTimeout(resolve, 5000));
                } else {
                    throw err;
                }
            }
        }
        
        console.log("\n" + "=".repeat(50));
        console.log("✅ BOT ISHGA TUSHDI!");
        console.log("=".repeat(50));
        console.log(`📱 @${(await bot.telegram.getMe()).username}`);
        console.log("⚠️  TikTok/Instagram: VPN kerak bo'lishi mumkin");
        console.log("🔧 Ctrl+C - to'xtatish");
        console.log("=".repeat(50) + "\n");

    } catch (err) {
        console.error("\n❌ XATO:", err.message);
        console.error("\n🔧 YECHIMLAR:");
        
        if (err.message.includes('Conflict') || err.message.includes('409')) {
            console.error("1. Eski bot jarayonini to'xtating: pkill -f 'node.*bot.js'");
            console.error("2. Yoki boshqa terminalda bot ishlamayotganligini tekshiring");
        } else if (err.message.includes('Unauthorized') || err.message.includes('401')) {
            console.error("1. BOT_TOKEN .env da to'g'ri ekanligini tekshiring");
            console.error("2. Tokenni @BotFather dan qayta oling");
        } else if (err.message.includes('getMe') || err.message.includes('api.telegram.org')) {
            console.error("1. Internet: ping google.com");
            console.error("2. VPN yoqib ko'ring");
            console.error("3. Firewall: sudo ufw allow 443/tcp");
            console.error("4. DNS: echo 'nameserver 8.8.8.8' | sudo tee /etc/resolv.conf");
        } else {
            console.error("1. Internet: ping google.com");
            console.error("2. Token: BOT_TOKEN .env da to'g'ri yozilganligini tekshiring");
            console.error("3. TikTok: sudo pip3 install -U yt-dlp --break-system-packages");
            console.error("4. VPN yoqing");
        }
        
        console.error("");
        process.exit(1);
    }
})();