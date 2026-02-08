module.exports = {
  apps: [{
    name: 'telegram-bot',
    script: './src/bot.js',
    
    // Instances va cluster mode
    instances: 1,  // Bitta instance (bot uchun etarli)
    exec_mode: 'fork',  // 'cluster' emas, chunki bot bir nusxada ishlashi kerak
    
    // Auto restart sozlamalari
    watch: false,  // Production da watch o'chirish
    max_memory_restart: '500M',  // 500MB dan oshsa restart
    
    // Environment variables
    env: {
      NODE_ENV: 'development',
    },
    env_production: {
      NODE_ENV: 'production',
    },
    
    // Restart strategiyasi
    min_uptime: '10s',  // Minimum 10 soniya ishlashi kerak
    max_restarts: 10,   // Max 10 marta restart (keyinroq to'xtaydi)
    restart_delay: 4000, // 4 soniya kutib restart qilish
    
    // Loglar
    error_file: './logs/error.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Xotira va CPU limitlar (ixtiyoriy)
    // max_memory_restart: '500M',
    
    // Cron restart (har kecha 3:00 da)
    cron_restart: '0 3 * * *',
    
    // Source map support
    source_map_support: true,
    
    // Kill timeout
    kill_timeout: 5000,
    
    // Listen timeout
    listen_timeout: 10000,
    
    // Shutdown timeout
    shutdown_with_message: true,
  }],
  
  // Deploy configuration (ixtiyoriy, git bilan deploy uchun)
  deploy: {
    production: {
      user: 'root',
      host: 'YOUR_SERVER_IP',  // Serveringiz IP manzili
      ref: 'origin/main',
      repo: 'git@github.com:username/repo.git',  // Git repo
      path: '/home/bot',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.js --env production',
      'pre-setup': 'apt update && apt install -y git'
    }
  }
};
