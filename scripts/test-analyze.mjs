import fs from "fs";
import http from "http";

const buf = fs.readFileSync(new URL("../public/img/factcheck-logo.png", import.meta.url));
const boundary = "----testboundary";
const prefix = Buffer.from(
  `--${boundary}\r\nContent-Disposition: form-data; name="image"; filename="t.png"\r\nContent-Type: image/png\r\n\r\n`,
  "utf8"
);
const suffix = Buffer.from(`\r\n--${boundary}--\r\n`, "utf8");
const body = Buffer.concat([prefix, buf, suffix]);

const req = http.request(
  {
    hostname: "127.0.0.1",
    port: 3000,
    path: "/api/analyze",
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": body.length,
    },
  },
  (res) => {
    let d = "";
    res.on("data", (c) => (d += c));
    res.on("end", () => {
      console.log("STATUS", res.statusCode);
      console.log(d.slice(0, 800));
    });
  }
);

req.on("error", (e) => console.error("REQ ERR", e.message));
req.write(body);
req.end();
