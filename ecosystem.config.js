module.exports = {
  apps: [{
    name: 'webhook-mapper',
    script: './dist/server/index.js',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    env_production: {
      NODE_ENV: 'production',
      PORT: 3000
    },
    log_date_format: 'YYYY-MM-DD HH:mm Z',
    merge_logs: true,
    kill_timeout: 5000
  }]
};