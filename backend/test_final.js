require("dotenv").config();
const http = require("http");

const loginData = JSON.stringify({ email: "superadmin@halqa.com", password: "Admin@2024" });
const loginReq = http.request(
  { hostname: "localhost", port: 5000, path: "/api/v1/auth/login", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": loginData.length } },
  res => {
    let b = "";
    res.on("data", d => b += d);
    res.on("end", () => {
      const d = JSON.parse(b);
      const token = d.data?.accessToken;
      const uid = d.data?.user?.id;
      if (!token) { console.log("LOGIN FAILED:", b.substring(0,200)); return; }
      console.log("Logged in as", d.data?.user?.email, "uid=", uid);

      const tests = [
        ["/api/v1/posts/feed", "Feed"],
        ["/api/v1/explore", "Explore"],
        ["/api/v1/group-chat/conversations", "Group Chat"],
        [`/api/v1/assignments/students/${uid}/submissions`, "Assignments"],
        [`/api/v1/exams/students/${uid}/submissions`, "Exams"],
        ["/api/v1/leaderboard/global", "Leaderboard Global"],
        [`/api/v1/analytics/users/${uid}/analytics`, "Analytics User"],
        ["/api/v1/marketplace/sellers/" + uid + "/products", "Marketplace (seller)"],
        ["/api/v1/transport/schools/" + (d.data?.user?.schoolId || "none") + "/buses", "Transport (school)"],
        ["/api/v1/backups", "Backups"],
        ["/api/v1/report-block/blocked", "Report-Block"],
        ["/api/v1/voice/stats/me", "Voice Stats"],
        ["/api/v1/wallet/me", "Wallet"],
        ["/api/v1/gifts", "Gifts"],
        ["/api/v1/communities", "Communities"],
      ];

      let done = 0;
      const results = [];

      tests.forEach(([path, name]) => {
        const req = http.request(
          { hostname: "localhost", port: 5000, path, method: "GET", headers: { Authorization: "Bearer " + token } },
          res2 => {
            let rb = "";
            res2.on("data", dd => rb += dd);
            res2.on("end", () => {
              try {
                const j = JSON.parse(rb);
                results.push(`${res2.statusCode === 200 ? "✅" : "❌"} ${res2.statusCode} ${name}`);
              } catch {
                results.push(`${res2.statusCode === 200 ? "✅" : "❌"} ${res2.statusCode} ${name} (${rb.substring(0,60)})`);
              }
              done++;
              if (done === tests.length) {
                results.sort().forEach(r => console.log(r));
                process.exit(0);
              }
            });
          }
        );
        req.on("error", e => {
          results.push(`❌ ERR ${name}: ${e.message}`);
          done++;
          if (done === tests.length) { results.sort().forEach(r => console.log(r)); process.exit(0); }
        });
        req.end();
      });
    });
  }
);
loginReq.write(loginData);
loginReq.end();
