"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sendMail } = require("./yt2009mail");
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
module.exports = { set(app, options) {
    options = options || {};
    const mailer = options && options.sendVerificationEmail || (async (email, token, purpose) => {
        const host = process.env.YT2009_SMTP_HOST;
        const from = process.env.YT2009_SMTP_FROM || process.env.YT2009_SMTP_USER;
        if (!host || !from) throw new Error("SMTP is not configured");
        const base = String(process.env.YT2009_PUBLIC_URL || "http://localhost:8080").replace(/\/$/, "");
        await sendMail({host,port:Number(process.env.YT2009_SMTP_PORT || 465),secure:process.env.YT2009_SMTP_SECURE !== "false",user:process.env.YT2009_SMTP_USER || "",password:process.env.YT2009_SMTP_PASSWORD || "",from},{to:email,subject:"Verify your yt2009 account",text:(purpose === "reset" ? "Reset your yt2009 password: " + base + "/local-account/reset?token=" + token : "Verify your yt2009 email: " + base + "/local-account/verify?token=" + token) + "\nThis link expires in 30 minutes."});
    });
    app.post("/local-api/v1/accounts/register", async (req,res) => {
        const b=body(req), username=typeof b.username==="string"?b.username.trim().toLowerCase():"", password=typeof b.password==="string"?b.password:"", email=typeof b.email==="string"?b.email.trim().toLowerCase():"", display=typeof b.display_name==="string"?b.display_name.trim().slice(0,32):"";
        if(!USERNAME.test(username)) return fail(res,400,"username_must_be_3_to_24_letters_numbers_or_underscores");
        if(password.length<8||password.length>256) return fail(res,400,"password_must_be_8_to_256_characters");
        if(!EMAIL.test(email)||email.length>254) return fail(res,400,"valid_email_required");
        try {
            const data=readData();
            if(Object.values(data.users).some(u=>u&&u.username===username)) return fail(res,409,"username_taken");
            if(Object.values(data.users).some(u=>u&&u.email&&u.email.toLowerCase()===email)) return fail(res,409,"email_taken");
            const id=crypto.randomBytes(24).toString("hex"), salt=crypto.randomBytes(16).toString("hex"), token=crypto.randomBytes(32).toString("hex");
            data.users[id]={username,email,display_name:display||username,bio:"",avatar_url:"",created_at:new Date().toISOString(),password_salt:salt,password_hash:crypto.scryptSync(password,salt,64).toString("hex"),account_version:1,email_verified:false,verification_required:true,verification_token_hash:crypto.createHash("sha256").update(token).digest("hex"),verification_expires_at:Date.now()+1800000,verification_last_sent_at:Date.now()};
            writeData(data);
            try { await mailer(email,token); } catch (_) { delete data.users[id]; writeData(data); return fail(res,503,"verification_email_unavailable_check_smtp_configuration"); }
            return res.status(201).json({ok:true,verification_required:true,notice:"Account created. Check your email and verify it before signing in."});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.get("/local-api/v1/accounts/verify", (req,res) => {
        const token=String((req.query||{}).token||""); if(!/^[a-f0-9]{64}$/.test(token)) return fail(res,400,"invalid_or_expired_verification_token");
        try { const data=readData(), hash=crypto.createHash("sha256").update(token).digest("hex"), entry=Object.entries(data.users).find(([,u])=>u&&u.verification_token_hash===hash);
            if(!entry) return fail(res,400,"invalid_or_expired_verification_token"); const [id,user]=entry;
            if(!user.verification_expires_at||user.verification_expires_at<Date.now()) return fail(res,400,"invalid_or_expired_verification_token");
            user.email_verified=true; user.verification_required=false; user.email_verified_at=new Date().toISOString(); delete user.verification_token_hash; delete user.verification_expires_at; delete user.verification_last_sent_at; data.users[id]=user; writeData(data);
            return res.json({ok:true,notice:"Email verified. You can now sign in."});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/resend-verification", async (req,res) => {
        const email=typeof body(req).email==="string"?body(req).email.trim().toLowerCase():"";
        if(!EMAIL.test(email)||email.length>254) return fail(res,400,"valid_email_required");
        try {
            const data=readData(), entry=Object.entries(data.users).find(([,u])=>u&&u.email===email&&u.verification_required&&!u.email_verified);
            if(entry) {
                const [id,user]=entry, now=Date.now();
                if(now-(user.verification_last_sent_at||0)>=60000) {
                    const token=crypto.randomBytes(32).toString("hex");
                    user.verification_token_hash=crypto.createHash("sha256").update(token).digest("hex"); user.verification_expires_at=now+1800000; user.verification_last_sent_at=now; data.users[id]=user; writeData(data);
                    try { await mailer(email,token); } catch (_) { return fail(res,503,"verification_email_unavailable_check_smtp_configuration"); }
                }
            }
            return res.json({ok:true,notice:"If the account needs verification, an email will be sent when the server permits it."});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/forgot-password", async (req,res) => {
        const email=typeof body(req).email==="string"?body(req).email.trim().toLowerCase():"";
        if(!EMAIL.test(email)||email.length>254) return fail(res,400,"valid_email_required");
        try {
            const data=readData(), entry=Object.entries(data.users).find(([,u])=>u&&u.email===email&&u.email_verified&&u.password_hash);
            if(entry) {
                const [id,user]=entry, now=Date.now();
                if(now-(user.reset_last_sent_at||0)>=60000) {
                    const token=crypto.randomBytes(32).toString("hex"); user.reset_token_hash=crypto.createHash("sha256").update(token).digest("hex"); user.reset_expires_at=now+1800000; user.reset_last_sent_at=now; data.users[id]=user; writeData(data);
                    try { await mailer(email,token,"reset"); } catch (_) { return fail(res,503,"password_reset_email_unavailable"); }
                }
            }
            return res.json({ok:true,notice:"If the verified account exists, a password reset message will be sent."});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/reset-password", (req,res) => {
        const b=body(req), token=typeof b.token==="string"?b.token:"", password=typeof b.password==="string"?b.password:"";
        if(!/^[a-f0-9]{64}$/.test(token)) return fail(res,400,"invalid_or_expired_reset_token");
        if(password.length<8||password.length>256) return fail(res,400,"password_must_be_8_to_256_characters");
        try { const data=readData(), hash=crypto.createHash("sha256").update(token).digest("hex"), entry=Object.entries(data.users).find(([,u])=>u&&u.reset_token_hash===hash);
            if(!entry) return fail(res,400,"invalid_or_expired_reset_token"); const [id,user]=entry;
            if(!user.reset_expires_at||user.reset_expires_at<Date.now()) return fail(res,400,"invalid_or_expired_reset_token");
            const salt=crypto.randomBytes(16).toString("hex"); user.password_salt=salt; user.password_hash=crypto.scryptSync(password,salt,64).toString("hex"); user.account_version=(user.account_version||0)+1;
            delete user.reset_token_hash; delete user.reset_expires_at; delete user.reset_last_sent_at; data.users[id]=user; writeData(data); setCookie(req,res,"",0);
            return res.json({ok:true,notice:"Password changed. Sign in with your new password."});
        } catch (_) { return fail(res,500,"account_storage_unavailable"); }
    });
    app.post("/local-api/v1/accounts/login", (req,res) => {
        const b=body(req), name=typeof b.username==="string"?b.username.trim().toLowerCase():"",
            password=typeof b.password==="string"?b.password:"";
        if(!name||name.length>254||!password||password.length>256) return fail(res,400,"invalid_credentials");
        try {
            const data=readData(), entry=Object.entries(data.users).find(([,u])=>u&&((u.username===name)||(u.email&&u.email.toLowerCase()===name))&&u.password_salt&&u.password_hash);
            if(!entry) return fail(res,401,"invalid_credentials");
            const [id,user]=entry;
            if(user.verification_required && !user.email_verified) return fail(res,403,"email_verification_required");
            const actual=crypto.scryptSync(password,user.password_salt,64), expected=Buffer.from(user.password_hash,"hex");
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
    app.get("/u/:username", (req,res) => {
        const name=String(req.params.username||"").toLowerCase(); if(!USERNAME.test(name)) return res.status(404).type("text").send("Profile not found");
        try {
            const data=readData(), entry=findUser(data,name); if(!entry) return res.status(404).type("text").send("Profile not found");
            const [id,user]=entry, profile=publicUser(id,user);
            const esc=value=>String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
            const avatar=validImageUrl(profile.avatar_url)?'<img alt="" src="'+esc(profile.avatar_url)+'" style="width:80px;height:80px;object-fit:cover;float:left;margin-right:14px;border:1px solid #aaa">':"";
            const playlists=Object.values(data.playlists||{}).filter(p=>p&&p.owner===id).map(p=>'<li>'+esc(p.name)+' ('+(Array.isArray(p.video_ids)?p.video_ids.length:0)+' videos)</li>').join("");
            const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>yt2009 - '+esc(profile.display_name)+'</title><style>body{margin:0;background:#fff;color:#333;font:12px Arial}header{padding:14px max(16px,calc((100% - 900px)/2));background:#333;color:#fff;border-bottom:4px solid #c00;font-size:20px}main{max-width:900px;margin:24px auto;padding:0 14px}.panel{border:1px solid #ccc;background:#f7f7f7;padding:16px;min-height:90px}a{color:#03c}</style></head><body><header><a style="color:white;text-decoration:none" href="/">yt2009</a> · Channel</header><main><section class="panel">'+avatar+'<h1 style="font-size:20px;margin-top:0">'+esc(profile.display_name)+'</h1><p>@'+esc(profile.username)+' · joined '+esc((profile.created_at||"").slice(0,10))+'</p><p>'+esc(profile.bio)+'</p><div style="clear:both"></div></section><h2>Public playlists</h2><ul>'+(playlists||'<li>No public playlists yet.</li>')+'</ul><p><a href="/local-account">Sign in / manage account</a> · <a href="/">Home</a></p></main></body></html>';
            return res.type("html").send(html);
        } catch (_) { return res.status(500).type("text").send("Profile unavailable"); }
    });
    app.get("/local-account/reset", (req,res) => { res.type("html").send(fs.readFileSync(path.join(__dirname,"..","assets","site-assets","yt2009-local-reset.html"),"utf8")); });
    app.get("/local-account/verify", (req,res) => { res.redirect(302,"/local-api/v1/accounts/verify?token="+encodeURIComponent(String((req.query||{}).token||""))); });
    app.get("/local-account", (req,res) => {
        res.type("html").send(fs.readFileSync(path.join(__dirname,"..","assets","site-assets","yt2009-local-accounts.html"),"utf8"));
    });
} };
