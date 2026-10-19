"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const FILE = path.join(__dirname, "local-data", "community.json");
const COOKIE = "yt2009_local_session";
const USERNAME = /^[a-z0-9_]{3,24}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function readData() {
    const dir = path.dirname(FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify({version:1,users:{},comments:{},ratings:{},playlists:{},favorites:{},subscriptions:{},quicklist:{}}, null, 2), {mode:0o600});
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
function cookieValue(req) {
    const raw = String((req.headers || {}).cookie || "");
    const part = raw.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="));
    if (!part) return "";
    try { return decodeURIComponent(part.slice(COOKIE.length + 1)); } catch (_) { return ""; }
}
function setCookie(req, res, id, maxAge) {
    const secure = !!req.secure || String((req.headers || {})["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
    res.setHeader("Set-Cookie", COOKIE + "=" + encodeURIComponent(id || "") + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + (maxAge == null ? 2592000 : maxAge) + (secure ? "; Secure" : ""));
}
function publicUser(id, user) {
    return {id, username:user.username || null, display_name:user.display_name || user.username || "Guest",
        bio:user.bio || "", avatar_url:user.avatar_url || "", created_at:user.created_at,
        account:!!user.password_hash, email_verified:!!user.email_verified};
}
function fail(res, status, error) { return res.status(status).json({ok:false,error}); }
function findUser(data, name) { return Object.entries(data.users).find(([,u]) => u && u.username === name); }
function current(req, data) { const id = cookieValue(req); return id && data.users[id] ? {id,user:data.users[id]} : null; }
function validImageUrl(value) { return typeof value === "string" && value.length <= 500 && (/^https:\/\//i.test(value) || /^\/(?!\/)/.test(value)); }
module.exports = { set(app) {
    app.post("/local-api/v1/accounts/register", (req,res) => {
        const b=body(req), username=typeof b.username==="string"?b.username.trim().toLowerCase():"",
            password=typeof b.password==="string"?b.password:"", email=typeof b.email==="string"?b.email.trim().toLowerCase():"",
            display=typeof b.display_name==="string"?b.display_name.trim().slice(0,32):"";
        if(!USERNAME.test(username)) return fail(res,400,"username_must_be_3_to_24_letters_numbers_or_underscores");
        if(password.length<8||password.length>256) return fail(res,400,"password_must_be_8_to_256_characters");
        if(!EMAIL.test(email)||email.length>254) return fail(res,400,"valid_email_required");
        try {
            const data=readData();
            if(Object.values(data.users).some(u=>u&&u.username===username)) return fail(res,409,"username_taken");
            if(Object.values(data.users).some(u=>u&&u.email&&u.email.toLowerCase()===email)) return fail(res,409,"email_taken");
            const id=crypto.randomBytes(24).toString("hex"), salt=crypto.randomBytes(16).toString("hex");
            data.users[id]={username,email,display_name:display||username,bio:"",avatar_url:"",created_at:new Date().toISOString(),
                password_salt:salt,password_hash:crypto.scryptSync(password,salt,64).toString("hex"),account_version:1,
                email_verified:false, verification_required:false};
            writeData(data); setCookie(req,res,id);
            return res.status(201).json({ok:true,user:publicUser(id,data.users[id]),notice:"Account created. Email delivery/verification is not configured on this server."});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/login", (req,res) => {
        const b=body(req), name=typeof b.username==="string"?b.username.trim().toLowerCase():"",
            password=typeof b.password==="string"?b.password:"";
        if(!name||name.length>254||!password||password.length>256) return fail(res,400,"invalid_credentials");
        try {
            const data=readData(), entry=Object.entries(data.users).find(([,u])=>u&&((u.username===name)||(u.email&&u.email.toLowerCase()===name))&&u.password_salt&&u.password_hash);
            if(!entry) return fail(res,401,"invalid_credentials");
            const [id,user]=entry, actual=crypto.scryptSync(password,user.password_salt,64), expected=Buffer.from(user.password_hash,"hex");
            if(expected.length!==actual.length||!crypto.timingSafeEqual(actual,expected)) return fail(res,401,"invalid_credentials");
            setCookie(req,res,id); return res.json({ok:true,user:publicUser(id,user)});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.get("/local-api/v1/accounts/me", (req,res) => {
        try { const data=readData(), s=current(req,data); if(!s) return fail(res,401,"login_required"); return res.json({ok:true,user:publicUser(s.id,s.user)}); }
        catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.patch("/local-api/v1/accounts/me", (req,res) => {
        try {
            const data=readData(), s=current(req,data); if(!s || !s.user.password_hash) return fail(res,401,"account_login_required");
            const b=body(req);
            if(typeof b.display_name==="string") { const value=b.display_name.trim(); if(!value||value.length>32) return fail(res,400,"display_name_must_be_1_to_32_characters"); s.user.display_name=value; }
            if(typeof b.bio==="string") { if(b.bio.length>500) return fail(res,400,"bio_too_long"); s.user.bio=b.bio.trim(); }
            if(typeof b.avatar_url==="string") { if(b.avatar_url && !validImageUrl(b.avatar_url)) return fail(res,400,"avatar_url_must_be_https_or_local_path"); s.user.avatar_url=b.avatar_url; }
            s.user.updated_at=new Date().toISOString(); data.users[s.id]=s.user; writeData(data);
            return res.json({ok:true,user:publicUser(s.id,s.user)});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/logout", (req,res) => { setCookie(req,res,"",0); return res.json({ok:true}); });
    app.get("/local-api/v1/profiles/:username", (req,res) => {
        const name=String(req.params.username||"").toLowerCase(); if(!USERNAME.test(name)) return fail(res,404,"profile_not_found");
        try {
            const data=readData(), entry=findUser(data,name); if(!entry) return fail(res,404,"profile_not_found");
            const [id,user]=entry; const playlists=Object.values(data.playlists||{}).filter(p=>p&&p.owner===id).map(p=>({id:p.id,name:p.name,video_ids:Array.isArray(p.video_ids)?p.video_ids:[]}));
            return res.json({ok:true,profile:publicUser(id,user),playlists});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.get("/local-account", (req,res) => {
        res.type("html").send(fs.readFileSync(path.join(__dirname,"..","assets","site-assets","yt2009-local-accounts.html"),"utf8"));
    });
} };
