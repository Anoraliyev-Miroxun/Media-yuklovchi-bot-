import { inlineKeyboard } from "telegraf/markup";

export const langkeybord = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "🇺🇿 O‘zbekcha", callback_data: "lang_uz" }],
            [
                { text: "🌐 English", callback_data: "lang_en" },
                { text: "🇷🇺 Русский", callback_data: "lang_ru" },
            ],
        ]
    }
}