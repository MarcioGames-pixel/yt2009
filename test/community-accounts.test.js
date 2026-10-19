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
    const routes=new Map(), app={};
    for(const method of ["get","post","patch"]) app[method]=(route,handler)=>routes.set(method.toUpperCase()+" "+route,handler);
    require(path.join(back,"yt2009accounts.js")).set(app);
    t.after(()=>{for(const key of Object.keys(require.cache))if(key.startsWith(root))delete require.cache[key];fs.rmSync(root,{recursive:true,force:true});});
    function call(method,route,options={}) {
        const handler=routes.get(method.toUpperCase()+" "+route); assert.equal(typeof handler,"function","registered route "+method+" "+route);
        const result={statusCode:200,headers:{},body:undefined,type:""};
        const req={body:options.body||{},headers:options.headers||{},secure:false,params:options.params||{}};
        const res={status(code){result.statusCode=code;return this;},json(value){result.body=value;return this;},type(value){result.type=value;return this;},send(value){result.body=value;return this;},setHeader(name,value){result.headers[name]=value;return this;}};
        handler(req,res);return result;
    }
    return {root,call};
}
const registerBody={username:"Retro_User",email:"retro@example.test",password:"test-password-123",display_name:"Retro User"};
function cookieHeader(result){return {cookie:result.headers["Set-Cookie"].split(";")[0]};}

test("registration stores a salted password hash, unique email and persistent account",t=>{
    const {root,call}=harness(t),registered=call("POST","/local-api/v1/accounts/register",{body:registerBody});
    assert.equal(registered.statusCode,201);assert.equal(registered.body.user.username,"retro_user");assert.equal(registered.body.user.account,true);
    assert.match(registered.headers["Set-Cookie"],/^yt2009_local_session=[a-f0-9]{48};/);
    const saved=JSON.parse(fs.readFileSync(path.join(root,"back","local-data","community.json"),"utf8")),user=saved.users[registered.body.user.id];
    assert.equal(user.email,"retro@example.test");assert.ok(user.password_salt);assert.ok(user.password_hash);
    assert.equal(JSON.stringify(user).includes(registerBody.password),false);
    assert.equal(call("POST","/local-api/v1/accounts/register",{body:{...registerBody,username:"othername"}}).statusCode,409);
    assert.equal(call("POST","/local-api/v1/accounts/register",{body:{...registerBody,email:"other@example.test"}}).statusCode,409);
});
test("login checks password and accepts username or email",t=>{
    const {call}=harness(t);call("POST","/local-api/v1/accounts/register",{body:registerBody});
    assert.equal(call("POST","/local-api/v1/accounts/login",{body:{username:"retro_user",password:"wrong-password"}}).statusCode,401);
    const good=call("POST","/local-api/v1/accounts/login",{body:{username:"RETRO@EXAMPLE.TEST",password:registerBody.password}});
    assert.equal(good.statusCode,200);assert.equal(good.body.user.username,"retro_user");assert.match(good.headers["Set-Cookie"],/HttpOnly; SameSite=Lax/);
});
test("profile can be edited, read publicly, and signed out",t=>{
    const {call}=harness(t),reg=call("POST","/local-api/v1/accounts/register",{body:registerBody}),headers=cookieHeader(reg);
    const changed=call("PATCH","/local-api/v1/accounts/me",{headers,body:{display_name:"Retro Member",bio:"I like old videos",avatar_url:"/local-media/avatar.png"}});
    assert.equal(changed.statusCode,200);assert.equal(changed.body.user.bio,"I like old videos");
    const me=call("GET","/local-api/v1/accounts/me",{headers});assert.equal(me.body.user.display_name,"Retro Member");
    const pub=call("GET","/local-api/v1/profiles/:username",{params:{username:"retro_user"}});
    assert.equal(pub.statusCode,200);assert.equal(pub.body.profile.bio,"I like old videos");assert.equal("password_hash" in pub.body.profile,false);
    assert.equal(call("POST","/local-api/v1/accounts/logout").body.ok,true);
    assert.equal(call("GET","/local-api/v1/accounts/me").statusCode,401);
});
test("registration validates username, password and email",t=>{
    const {call}=harness(t);
    assert.equal(call("POST","/local-api/v1/accounts/register",{body:{...registerBody,username:"x!"}}).statusCode,400);
    assert.equal(call("POST","/local-api/v1/accounts/register",{body:{...registerBody,password:"short"}}).statusCode,400);
    assert.equal(call("POST","/local-api/v1/accounts/register",{body:{...registerBody,email:"not-an-email"}}).statusCode,400);
});
