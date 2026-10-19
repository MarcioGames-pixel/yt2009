"use strict";
const net = require("net");
const tls = require("tls");

function sendMail(options, message) {
    return new Promise((resolve, reject) => {
        const port = Number(options.port || 465);
        const secure = options.secure !== false;
        const socket = secure
            ? tls.connect({host:options.host, port, servername:options.host, rejectUnauthorized:true})
            : net.connect({host:options.host, port});
        let buffer = "", pending = [], ended = false;
        const timeout = setTimeout(() => finish(new Error("SMTP timeout")), 15000);
        function finish(err) {
            if (ended) return;
            ended = true; clearTimeout(timeout);
            try { socket.end(); } catch (_) {}
            if (err) reject(err); else resolve();
        }
        function onData(chunk) {
            buffer += chunk.toString("utf8");
            let i;
            while ((i = buffer.indexOf("\r\n")) >= 0) {
                const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
                const item = pending[0];
                if (!item) continue;
                item.lines.push(line);
                if (/^\d{3} /.test(line)) {
                    pending.shift();
                    const code = Number(line.slice(0,3));
                    if (item.expected.indexOf(code) < 0) item.reject(new Error("SMTP command rejected (" + code + ")"));
                    else item.resolve(item.lines.join("\n"));
                }
            }
        }
        socket.on("data", onData);
        socket.on("error", err => finish(err));
        socket.on("timeout", () => finish(new Error("SMTP timeout")));
        function response(expected) {
            return new Promise((res, rej) => pending.push({expected, resolve:res, reject:rej, lines:[]}));
        }
        function command(text, expected) {
            const wait = response(expected);
            socket.write(text + "\r\n");
            return wait;
        }
        async function run() {
            await response([220]);
            await command("EHLO yt2009.local", [250]);
            if (options.user) {
                const raw = Buffer.from("\0" + options.user + "\0" + options.password).toString("base64");
                await command("AUTH PLAIN " + raw, [235]);
            }
            const from = String(options.from || options.user || "").trim();
            if (!from || /[\r\n<>]/.test(from)) throw new Error("Invalid SMTP sender");
            const to = String(message.to || "").trim();
            if (!to || /[\r\n<>]/.test(to)) throw new Error("Invalid SMTP recipient");
            await command("MAIL FROM:<" + from + ">", [250]);
            await command("RCPT TO:<" + to + ">", [250, 251]);
            await command("DATA", [354]);
            const subject = String(message.subject || "yt2009 account verification").replace(/[\r\n]/g, " ");
            const body = String(message.text || "").replace(/\r?\n/g, "\r\n").split("\r\n").map(line => line.startsWith(".") ? "." + line : line).join("\r\n");
            const data = "From: yt2009 <" + from + ">\r\nTo: <" + to + ">\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n" + body + "\r\n.";
            await command(data, [250]);
            await command("QUIT", [221]);
            finish();
        }
        socket.once("connect", () => { run().catch(finish); });
        if (secure) socket.once("secureConnect", () => { run().catch(finish); });
        // The implicit-TLS socket emits connect and secureConnect; only start after TLS is ready.
        if (secure) socket.removeAllListeners("connect");
    });
}

module.exports = { sendMail };
