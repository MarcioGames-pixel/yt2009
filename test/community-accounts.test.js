"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
function harness(t) {
    const root=fs.mkdtempSync(path.join(os.tmpdir(),"yt2009-accounts-")), back=path.join(root,"back");
    fs.mkdirSync(path.join(back,"local-data"),{recursive:true});
    fs.copyFileSync(path.join(__dirname,"..","back","yt2009accounts.js"),path.join(back,"yt2009accounts.js"));
    fs.copyFileSync(path.join(__dirname,"..","back","yt2009mail.js"),path.join(back,"yt2009mail.js"));
    const routes=new Map(), app={}, sentTokens=new Map();
    for(const method of ["get","post","patch"]) app[method]=(route,handler)=>routes.set(method.toUpperCase()+" "+route,handler);
    require(path.join(back,"yt2009accounts.js")).set(app,{sendVerificationEmail:async(email,token)=>sentTokens.set(email,token)});
    t.after(()=>{for(const key of Object.keys(require.cache))if(key.startsWith(root))delete require.cache[key];fs.rmSync(root,{recursive:true,force:true});});
    async function call(method,route,options={}) {
        const handler=routes.get(method.toUpperCase()+" "+route); assert.equal(typeof handler,"function","registered route "+method+" "+route);
        const result={statusCode:200,headers:{},body:undefined,type:""};
        const req={body:options.body||{},headers:options.headers||{},secure:false,params:options.params||{},query:options.query||{}};
        const res={status(code){result.statusCode=code;return this;},json(value){result.body=value;return this;},type(value){result.type=value;return this;},send(value){result.body=value;return this;},redirect(code,url){result.statusCode=code;result.redirect=url;return this;},setHeader(name,value){result.headers[name]=value;return this;}};
        await handler(req,res);return result;
    }
    return {root,call,sentTokens};
}
const registerBody={username:"Retro_User",email:"retro@example.test",password:"test-password-123",display_name:"Retro User"};
function cookieHeader(result){return {cookie:result.headers["Set-Cookie"].split(";")[0]};}

test("registration sends verification and stores only a token hash and salted password hash",async t=>{
    const {root,call,sentTokens}=harness(t),registered=await call("POST","/local-api/v1/accounts/register",{body:registerBody});
    assert.equal(registered.statusCode,201);assert.equal(registered.body.verification_required,true);assert.equal(registered.headers["Set-Cookie"],undefined);
    const token=sentTokens.get("retro@example.test");assert.match(token,/^[a-f0-9]{64}$/);
    const saved=JSON.parse(fs.readFileSync(path.join(root,"back","local-data","community.json"),"utf8")),user=Object.values(saved.users)[0];
    assert.equal(user.email,"retro@example.test");assert.ok(user.password_salt);assert.ok(user.password_hash);assert.equal(user.verification_token_hash,require("node:crypto").createHash("sha256").update(token).digest("hex"));
    assert.equal(JSON.stringify(user).includes(registerBody.password),false);assert.equal(JSON.stringify(user).includes(token),false);
    assert.equal((await call("POST","/local-api/v1/accounts/register",{body:{...registerBody,username:"othername"}})).statusCode,409);
    assert.equal((await call("POST","/local-api/v1/accounts/register",{body:{...registerBody,email:"other@example.test"}})).statusCode,409);
});
test("unverified login is blocked; a valid one-time token enables username/email login",async t=>{
    const {call,sentTokens}=harness(t);await call("POST","/local-api/v1/accounts/register",{body:registerBody});
    assert.equal((await call("POST","/local-api/v1/accounts/login",{body:{username:"retro_user",password:registerBody.password}})).statusCode,403);
    const token=sentTokens.get("retro@example.test");
    assert.equal((await call("GET","/local-api/v1/accounts/verify",{query:{token}})).statusCode,200);
    assert.equal((await call("GET","/local-api/v1/accounts/verify",{query:{token}})).statusCode,400);
    assert.equal((await call("POST","/local-api/v1/accounts/login",{body:{username:"RETRO@EXAMPLE.TEST",password:registerBody.password}})).statusCode,200);
    assert.equal((await call("POST","/local-api/v1/accounts/login",{body:{username:"retro_user",password:"wrong-password"}})).statusCode,401);
});
test("profile can be edited, read publicly, and signed out",async t=>{
    const {call,sentTokens}=harness(t),reg=await call("POST","/local-api/v1/accounts/register",{body:registerBody});
    await call("GET","/local-api/v1/accounts/verify",{query:{token:sentTokens.get("retro@example.test")}});
    const login=await call("POST","/local-api/v1/accounts/login",{body:{username:"retro_user",password:registerBody.password}}),headers=cookieHeader(login);
    const changed=await call("PATCH","/local-api/v1/accounts/me",{headers,body:{display_name:"Retro Member",bio:"I like old videos",avatar_url:"/local-media/avatar.png"}});
    assert.equal(changed.statusCode,200);assert.equal(changed.body.user.bio,"I like old videos");
    const me=await call("GET","/local-api/v1/accounts/me",{headers});assert.equal(me.body.user.display_name,"Retro Member");
    const pub=await call("GET","/local-api/v1/profiles/:username",{params:{username:"retro_user"}});
    assert.equal(pub.statusCode,200);assert.equal(pub.body.profile.bio,"I like old videos");assert.equal("password_hash" in pub.body.profile,false);
    assert.equal((await call("POST","/local-api/v1/accounts/logout")).body.ok,true);
    assert.equal((await call("GET","/local-api/v1/accounts/me")).statusCode,401);
});
test("registration validates username, password and email",async t=>{
    const {call}=harness(t);
    assert.equal((await call("POST","/local-api/v1/accounts/register",{body:{...registerBody,username:"x!"}})).statusCode,400);
    assert.equal((await call("POST","/local-api/v1/accounts/register",{body:{...registerBody,password:"short"}})).statusCode,400);
    assert.equal((await call("POST","/local-api/v1/accounts/register",{body:{...registerBody,email:"not-an-email"}})).statusCode,400);
});
test("registration fails closed when email cannot be sent",async t=>{
    const {root}=harness(t),back=path.join(root,"back");
    const modulePath=path.join(back,"yt2009accounts.js"), routes=new Map(),app={};
    for(const method of ["get","post","patch"])app[method]=(route,handler)=>routes.set(method.toUpperCase()+" "+route,handler);
    require(modulePath).set(app,{sendVerificationEmail:async()=>{throw new Error("mail unavailable");}});
    const handler=routes.get("POST /local-api/v1/accounts/register"),res={statusCode:200,status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},setHeader(){}};
    await handler({body:registerBody,headers:{},params:{},query:{}},res);
    assert.equal(res.statusCode,503);
    const saved=JSON.parse(fs.readFileSync(path.join(root,"back","local-data","community.json"),"utf8"));
    assert.equal(Object.keys(saved.users).length,0);
});
