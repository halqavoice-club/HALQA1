// PM2 Process Manager Configuration
//
// USE CASE: VPS deployment WITHOUT Docker (Option B from README)
//
//   pm2 start ecosystem.config.js --env production
//   pm2 save          (persist process list across reboots)
//   pm2 startup       (generate init script for auto-start)
//   pm2 monit         (live monitoring dashboard)
//   pm2 logs          (view logs)
//
// NOTE: If you are using Docker (docker-compose.prod.yml), you do NOT need
// PM2. Docker handles process restarts via the `restart: always` policy.
// PM2 is only for bare-metal / VPS deployments without Docker.
//
// See README.md → "Option B — VPS with PM2" for full setup instructions.

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
