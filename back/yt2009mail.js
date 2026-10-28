"use strict";


async function sendMail(options, message) {
    options = options || {};
    message = message || {};

    const apiKey = String(options.apiKey || "").trim();
    const from = String(options.from || "").trim();
    const to = String(message.to || "").trim();

    if (!apiKey) throw new Error("Resend API key is not configured");
    if (!from || /[\r\n]/.test(from)) throw new Error("Invalid Resend sender");
    if (!to || /[\r\n]/.test(to)) throw new Error("Invalid Resend recipient");

    // Load the SDK only when an email is actually sent. This keeps account-route tests and installations that have not configured mail independent of the provider package at import time.
    const { Resend } = require("resend");
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
        from,
        to: [to],
        subject: String(message.subject || "yt2009 account notification").replace(/[\r\n]/g, " "),
        text: String(message.text || ""),
        ...(message.html ? { html: String(message.html) } : {})
    });

    if (result && result.error) {
        const detail = result.error.message || result.error.name || "Unknown Resend error";
        throw new Error("Resend rejected the email: " + detail);
    }
    if (!result || !result.data || !result.data.id) {
        throw new Error("Resend did not return an email ID");
    }
    return result.data;
}

module.exports = { sendMail };
