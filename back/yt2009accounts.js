"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const FILE = path.join(__dirname, "local-data", "community.json");
const COOKIE = "yt2009_local_session";
const USERNAME = /^[a-z0-9_]{3,24}$/;
function readData() {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({version:1,users:{},comments:{},ratings:{},playlists:{},favorites:{},subscriptions:{},quicklist:{}}, null, 2));
    const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("Invalid community data");
    for (const key of ["users","comments","ratings","playlists","favorites","subscriptions","quicklist"]) if (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key])) data[key] = {};
    return data;
}
function writeData(data) {
    const tmp = FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), {mode:0o600});
    fs.renameSync(tmp, FILE);
}
function body(req) {
    if (Buffer.isBuffer(req.body)) { try { return JSON.parse(req.body.toString("utf8")); } catch (_) { return {}; } }
    if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch (_) { return {}; } }
    return req.body && typeof req.body === "object" ? req.body : {};
}
function cookie(req, res, id) {
    const secure = !!req.secure || String((req.headers || {})["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(id) + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000" + (secure ? "; Secure" : ""));
}
function payload(id, user) { return {id, username:user.username || null, display_name:user.display_name, created_at:user.created_at, account:!!user.password_hash}; }
function error(res, status, message) { return res.status(status).json({ok:false,error:message}); }
module.exports = { set(app) {
    app.post("/local-api/v1/accounts/register", (req,res) => {
        const b=body(req), username=typeof b.username==="string"?b.username.trim().toLowerCase():"", password=typeof b.password==="string"?b.password:"";
        const display=typeof b.display_name==="string"?b.display_name.trim().slice(0,32):"";
        if(!USERNAME.test(username)) return error(res,400,"username_must_be_3_to_24_letters_numbers_or_underscores");
        if(password.length<8||password.length>256) return error(res,400,"password_must_be_8_to_256_characters");
        try {
            const data=readData();
            if(Object.values(data.users).some(u=>u&&u.username===username)) return error(res,409,"username_taken");
            const id=crypto.randomBytes(24).toString("hex"), salt=crypto.randomBytes(16).toString("hex");
            data.users[id]={username,display_name:display||username,created_at:new Date().toISOString(),password_salt:salt,password_hash:crypto.scryptSync(password,salt,64).toString("hex"),account_version:1};
            writeData(data); cookie(req,res,id); return res.status(201).json({ok:true,user:payload(id,data.users[id])});
        } catch (_) { return error(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/login", (req,res) => {
        const b=body(req), username=typeof b.username==="string"?b.username.trim().toLowerCase():"", password=typeof b.password==="string"?b.password:"";
        if(!USERNAME.test(username)||!password||password.length>256) return error(res,400,"invalid_credentials");
        try {
            const data=readData(), entry=Object.entries(data.users).find(([,u])=>u&&u.username===username&&u.password_salt&&u.password_hash);
            if(!entry) return error(res,401,"invalid_credentials");
            const [id,user]=entry, actual=crypto.scryptSync(password,user.password_salt,64), expected=Buffer.from(user.password_hash,"hex");
            if(expected.length!==actual.length||!crypto.timingSafeEqual(actual,expected)) return error(res,401,"invalid_credentials");
            cookie(req,res,id); return res.json({ok:true,user:payload(id,user)});
        } catch (_) { return error(res,500,"account_storage_unavailable"); }
    });
    app.get("/local-account", (req,res) => {
        res.type("html").send(fs.readFileSync(path.join(__dirname,"..","assets","site-assets","yt2009-local-accounts.html"),"utf8"));
    });
} };
