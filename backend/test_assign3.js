require("dotenv").config();
const http = require("http");

const loginData = JSON.stringify({ email: "superadmin@halqa.com", password: "Admin@2024" });
const lr = http.request(
  { hostname:"localhost", port:5000, path:"/api/v1/auth/login", method:"POST", headers:{"Content-Type":"application/json","Content-Length":loginData.length} },
  res => {
    let b=""; res.on("data",d=>b+=d); res.on("end",()=>{
      const tok = JSON.parse(b).data?.accessToken;
      const uid = JSON.parse(b).data?.user?.id;
      console.log("uid:", uid);

      // Test assignment
      const r = http.request(
        { hostname:"localhost", port:5000, path:`/api/v1/assignments/students/${uid}/submissions`, method:"GET", headers:{Authorization:"Bearer "+tok} },
        res2 => {
          let b2=""; res2.on("data",d=>b2+=d); res2.on("end",()=>{
            console.log("ASSIGN", res2.statusCode, ":", b2.substring(0,400));
          });
        }
      );
      r.on("error", e => console.log("ASSIGN ERR:", e.message));
      r.end();

      setTimeout(()=>process.exit(0), 10000);
    });
  }
);
lr.write(loginData); lr.end();
