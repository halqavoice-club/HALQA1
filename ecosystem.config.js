// PM2 Process Manager Configuration
// Usage:
//   pm2 start ecosystem.config.js
//   pm2 save
//   pm2 startup   (auto-start on server reboot)
//   pm2 monit     (live monitoring)
//   pm2 logs      (view logs)

module.exports = {
  apps: [
    {
      name: 'halqa-backend',
      script: './backend/src/app.js',
      cwd: './',
      instances: 1,           // increase to 'max' for multi-core
      exec_mode: 'fork',      // use 'cluster' for multi-core
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'development',
        PORT: 5000
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 5000
      },
      error_file: './backend/logs/pm2-error.log',
      out_file: './backend/logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    },
    {
      name: 'halqa-frontend',
      script: 'npm',
      args: 'start',
      cwd: './frontend',
      instances: 1,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000
      },
      error_file: './frontend/.next/pm2-error.log',
      out_file: './frontend/.next/pm2-out.log',
      restart_delay: 3000,
      max_restarts: 10,
      min_uptime: '10s'
    }
  ]
}
