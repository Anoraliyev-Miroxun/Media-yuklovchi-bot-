#!/bin/bash

echo "🔍 Telegram Bot Diagnostika"
echo "=============================="
echo ""

# 1. Internet tekshirish
echo "1️⃣ Internet tekshirilmoqda..."
if ping -c 1 google.com &> /dev/null; then
    echo "   ✅ Internet ishlayapti"
else
    echo "   ❌ Internet yo'q!"
    echo "   🔧 Yechim: Internet ulanishingizni tekshiring"
    exit 1
fi

echo ""

# 2. Telegram API ulanishi
echo "2️⃣ Telegram API tekshirilmoqda..."
if ping -c 1 api.telegram.org &> /dev/null; then
    echo "   ✅ Telegram API ga ulanish bor"
else
    echo "   ⚠️  Telegram API ga ping yo'q"
    echo "   💡 Sabab: Ba'zi provayderlar Telegram ni bloklagan"
    echo "   🔧 Yechim: VPN yoqing (Proton, Windscribe, ...)"
fi

echo ""

# 3. DNS tekshirish
echo "3️⃣ DNS tekshirilmoqda..."
if nslookup api.telegram.org &> /dev/null; then
    echo "   ✅ DNS ishlayapti"
    IP=$(nslookup api.telegram.org 2>/dev/null | grep -A1 "Name:" | tail -1 | awk '{print $2}')
    if [ -n "$IP" ]; then
        echo "   IP: $IP"
    fi
else
    echo "   ⚠️  DNS muammosi"
    echo "   🔧 Yechim: DNS o'zgartiring"
fi

echo ""

# 4. Port 443 ochiqligini tekshirish
echo "4️⃣ Port 443 (HTTPS) tekshirilmoqda..."
if timeout 3 bash -c "cat < /dev/null > /dev/tcp/api.telegram.org/443" 2>/dev/null; then
    echo "   ✅ Port 443 ochiq"
else
    echo "   ⚠️  Port 443 bloklangan yoki firewall"
    echo "   🔧 Yechim: sudo ufw allow 443/tcp"
fi

echo ""

# 5. BOT_TOKEN tekshirish
echo "5️⃣ BOT_TOKEN tekshirilmoqda..."
if [ -f .env ]; then
    if grep -q "BOT_TOKEN=" .env; then
        TOKEN=$(grep "BOT_TOKEN=" .env | cut -d'=' -f2 | tr -d ' "'"'"'')
        if [ ${#TOKEN} -gt 40 ]; then
            echo "   ✅ Token topildi (${#TOKEN} belgi)"
            
            if [[ $TOKEN =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
                echo "   ✅ Token formati to'g'ri"
            else
                echo "   ⚠️  Token formati shubhali"
            fi
        else
            echo "   ❌ Token juda qisqa!"
        fi
    else
        echo "   ❌ BOT_TOKEN .env da yo'q!"
    fi
else
    echo "   ❌ .env fayli topilmadi!"
fi

echo ""

# 6. Eski bot jarayonini tekshirish
echo "6️⃣ Bot jarayonlari tekshirilmoqda..."
BOT_PROCESSES=$(ps aux | grep -E 'node.*bot\.js' | grep -v grep | wc -l)
if [ $BOT_PROCESSES -gt 0 ]; then
    echo "   ⚠️  $BOT_PROCESSES ta bot jarayoni topildi!"
    echo "   🔧 To'xtatish: pkill -f 'node.*bot.js'"
else
    echo "   ✅ Eski jarayonlar yo'q"
fi

echo ""
echo "=============================="
echo "✅ Diagnostika tugadi"
echo ""
