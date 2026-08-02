require("dotenv").config();
const https = require("http");

// Login first
const loginData = JSON.stringify({ email: "superadmin@halqa.com", password: "Admin@2024" });
const loginOpts = { hostname: "localhost", port: 5000, path: "/api/v1/auth/login", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": loginData.length } };

const loginReq = https.request(loginOpts, (res) => {
  let body = "";
  res.on("data", d => body += d);
  res.on("end", () => {
    const token = JSON.parse(body).data?.accessToken;
    if (!token) { console.log("LOGIN FAILED:", body.substring(0, 200)); return; }
    console.log("Login OK, testing endpoints...");

    const endpoints = [
      "/api/v1/posts/feed",
      "/api/v1/explore",
      "/api/v1/group-chat/conversations",
      "/api/v1/leaderboard/global",
      "/api/v1/analytics/users/d77d00c7-221f-42c4-9e69-1946cbdfbb09/analytics",
      "/api/v1/assignments/students/d77d00c7-221f-42c4-9e69-1946cbdfbb09/submissions",
      "/api/v1/marketplace/products",
      "/api/v1/transport/buses",
      "/api/v1/backups"
    ];

    let done = 0;
    endpoints.forEach(ep => {
      const opts = { hostname: "localhost", port: 5000, path: ep, method: "GET", headers: { Authorization: "Bearer " + token } };
      const r = https.request(opts, res2 => {
        let b = "";
        res2.on("data", d => b += d);
        res2.on("end", () => {
          try {
            const j = JSON.parse(b);
            console.log(`${res2.statusCode} ${ep} - success=${j.success}`);
          } catch(e) {
            console.log(`${res2.statusCode} ${ep} - raw: ${b.substring(0, 80)}`);
          }
          done++;
          if (done === endpoints.length) process.exit(0);
        });
      });
      r.on("error", e => { console.log(`ERROR ${ep}: ${e.message}`); done++; if (done === endpoints.length) process.exit(0); });
      r.end();
    });
  });
});
loginReq.write(loginData);
loginReq.end();
