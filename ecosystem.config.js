module.exports = {
  apps : [{
    name   : "wabot",
    script : "./dist/index.js",
    watch  : false, // Set to true to automatically restart on file changes
    env    : {
      "NODE_ENV": "production",
      // You must manage your .env variables.
      // PM2 does not automatically load them.
      // See the note below.
    }
  }]
}
