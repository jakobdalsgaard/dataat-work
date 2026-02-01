// Data At Work - Cloudflare Worker
// Serves static assets, handles contact form with Turnstile verification and email

import { EmailMessage } from "cloudflare:email";

// Verify Turnstile token
async function verifyTurnstile(token, ip, secretKey) {
  const formData = new FormData();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (ip) {
    formData.append("remoteip", ip);
  }

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: formData,
    }
  );

  const result = await response.json();
  return result.success;
}

// Build a simple MIME email message
function buildMimeMessage(from, fromName, to, subject, body) {
  const boundary = "----=_Part_" + Math.random().toString(36).substring(2);
  const date = new Date().toUTCString();

  const headers = [
    `From: ${fromName} <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${date}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
  ].join("\r\n");

  return headers + "\r\n\r\n" + body;
}

// Handle contact form submission
async function handleContactForm(request, env) {
  try {
    const formData = await request.formData();

    // Extract form fields
    const name = formData.get("name");
    const email = formData.get("email");
    const message = formData.get("message");
    const turnstileToken = formData.get("cf-turnstile-response");

    // Validate required fields
    if (!name || !email || !message) {
      return new Response(
        JSON.stringify({ error: "Please fill in all required fields." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate Turnstile token
    if (!turnstileToken) {
      return new Response(
        JSON.stringify({ error: "Please complete the captcha verification." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Verify Turnstile
    const ip = request.headers.get("CF-Connecting-IP");
    const isValid = await verifyTurnstile(turnstileToken, ip, env.TURNSTILE_SECRET);

    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Captcha verification failed. Please try again." }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build email content
    const emailBody = `New contact form submission from dataat.work

Name: ${name}
Email: ${email}

Message:
${message}

---
Submitted from IP: ${ip || "unknown"}
Time: ${new Date().toISOString()}
`;

    const rawEmail = buildMimeMessage(
      "contact@dataat.work",
      "Data At Work Contact Form",
      "jakob@dalsgaard.net",
      `Contact form: ${name}`,
      emailBody
    );

    const emailMessage = new EmailMessage(
      "contact@dataat.work",
      "jakob@dalsgaard.net",
      rawEmail
    );

    await env.EMAIL.send(emailMessage);

    return new Response(
      JSON.stringify({ message: "Thank you for your message. We will get back to you soon." }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Contact form error:", error);
    return new Response(
      JSON.stringify({ error: "An error occurred while sending your message. Please try again later." }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Handle mail auto-configuration (for email clients)
    if (url.pathname.startsWith("/.well-known/autoconfig/") || url.pathname.startsWith("/autodiscover/")) {
      url.hostname = "lykkebovej44.dalsgaard.net";
      url.port = 8447;
      url.protocol = "https";
      return fetch(url.toString(), request);
    }

    // Handle contact form API
    if (url.pathname === "/api/contact" && request.method === "POST") {
      return handleContactForm(request, env);
    }

    // Serve static assets for all other requests
    return env.ASSETS.fetch(request);
  }
};
