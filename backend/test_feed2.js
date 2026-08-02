require("dotenv").config();
const http = require("http");

const loginData = JSON.stringify({ email: "superadmin@halqa.com", password: "Admin@2024" });
const loginReq = http.request(
  { hostname: "localhost", port: 5000, path: "/api/v1/auth/login", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": loginData.length } },
  res => {
    let b = "";
    res.on("data", d => b += d);
    res.on("end", () => {
      const token = JSON.parse(b).data?.accessToken;
      const uid = JSON.parse(b).data?.user?.id;

      // Test feed with timeout
      const req = http.request(
        { hostname: "localhost", port: 5000, path: "/api/v1/posts/feed?limit=5", method: "GET", headers: { Authorization: "Bearer " + token } },
        res2 => {
          let rb = ""; res2.on("data", d => rb += d);
          res2.on("end", () => { console.log("FEED:", res2.statusCode, rb.substring(0, 200)); });
        }
      );
      req.setTimeout(8000, () => { console.log("FEED: TIMEOUT - query taking too long"); req.abort(); });
      req.on("error", e => console.log("FEED ERR:", e.message));
      req.end();

      // Test assignments - already works
      const req2 = http.request(
        { hostname: "localhost", port: 5000, path: `/api/v1/assignments/students/${uid}/submissions`, method: "GET", headers: { Authorization: "Bearer " + token } },
        res3 => {
          let rb2 = ""; res3.on("data", d => rb2 += d);
          res3.on("end", () => { console.log("ASSIGNMENTS:", res3.statusCode, rb2.substring(0, 200)); });
        }
      );
      req2.on("error", e => console.log("ASSIGN ERR:", e.message));
      req2.end();
    });
  }
);
loginReq.write(loginData);
loginReq.end();

setTimeout(() => { console.log("Test complete"); process.exit(0); }, 12000);
